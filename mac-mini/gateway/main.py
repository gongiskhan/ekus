"""Ekus Gateway — HTTP server for remote agent execution on Mac Mini.

Accepts job requests over HTTP, spawns Claude Code agents in tmux sessions,
and tracks their progress via YAML job files. Also serves the task/memory
dashboard, scheduler CRUD, file uploads, and SSE streaming.

Based on mac-mini-agent's Listen server, adapted for headless operation.
"""

import asyncio
import json
import os
from pathlib import Path

# Load .env from project root
_env_file = Path(__file__).resolve().parent.parent.parent / ".env"
if _env_file.exists():
    for line in _env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

# Fall back to Claude Code OAuth token for ANTHROPIC_API_KEY
if not os.environ.get("ANTHROPIC_API_KEY"):
    _creds = Path.home() / ".claude" / ".credentials.json"
    if _creds.exists():
        try:
            _oauth = json.loads(_creds.read_text()).get("claudeAiOauth", {})
            if _oauth.get("accessToken"):
                os.environ["ANTHROPIC_API_KEY"] = _oauth["accessToken"]
        except Exception:
            pass
import logging
import shutil
import signal
import subprocess
import sys
import urllib.request
import urllib.error

# Configure root logger so voice.* modules can output logs
logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
from datetime import datetime, timezone
from urllib.parse import unquote
from uuid import uuid4

import yaml
from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, PlainTextResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

app = FastAPI(title="Ekus Gateway", version="0.3.0")

# Allow CORS for dashboard access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

JOBS_DIR = Path(__file__).parent / "jobs"
JOBS_DIR.mkdir(exist_ok=True)
ARCHIVED_DIR = JOBS_DIR / "archived"

# Data directories for tasks and memory (migrated from Cloudflare KV)
EKUS_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = EKUS_ROOT / "data"
DATA_DIR.mkdir(exist_ok=True)
TASKS_FILE = DATA_DIR / "tasks.md"
MEMORY_DIR = EKUS_ROOT / "memory"

# Upload directory
UPLOAD_DIR = DATA_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
ALLOWED_UPLOAD_TYPES = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic', '.heif', '.pdf', '.txt', '.md', '.csv', '.json'}
MAX_UPLOAD_SIZE = 20 * 1024 * 1024  # 20MB

# Scheduler config paths
CONFIG_DIR = EKUS_ROOT / "config"
JOBS_CONFIG = CONFIG_DIR / "jobs.json"
SCHEDULER_STATE = CONFIG_DIR / ".scheduler-state.json"
LOGS_DIR = EKUS_ROOT / "logs"


SESSIONS_FILE = DATA_DIR / "sessions.json"

# ── Channel communication ────────────────────────────────────────────
CHANNEL_SERVER_URL = os.environ.get("CHANNEL_SERVER_URL", "http://localhost:8788")
_channel_replies: dict[str, dict] = {}  # chat_id -> reply data
_channel_ws_clients: set = set()  # connected WebSocket clients

# ── Channel session controller ──────────────────────────────────────
_session_lock = asyncio.Lock()
_session_state = {
    "status": "idle",           # idle | starting | ready | switching | error
    "active_session_id": None,  # Ekus conversation session ID
    "claude_session_id": None,  # Claude Code session UUID
    "message_queue": [],        # Messages queued during transitions
    "error": None,
}

# Channel history directory
CHANNEL_HISTORY_DIR = DATA_DIR / "channel-history"
CHANNEL_HISTORY_DIR.mkdir(exist_ok=True)


class JobRequest(BaseModel):
    prompt: str
    system_prompt: str | None = None
    working_dir: str | None = None
    dangerously_skip_permissions: bool = True
    conversation_id: str | None = None


class AutomationRequest(BaseModel):
    """Request for GUI/terminal automation tasks."""
    action: str  # steer or drive command
    args: list[str] = []
    kwargs: dict = {}


@app.get("/health")
def health():
    return {"status": "ok", "hostname": os.uname().nodename}


# ── Job management ───────────────────────────────────────────────────

def _load_sessions() -> dict:
    if SESSIONS_FILE.exists():
        with open(SESSIONS_FILE) as f:
            return json.load(f)
    return {"sessions": []}


def _save_sessions(data: dict):
    with open(SESSIONS_FILE, "w") as f:
        json.dump(data, f, indent=2)


def _update_session_timestamp(conversation_id: str):
    """Update a session's updated_at when a job is added to it."""
    data = _load_sessions()
    for s in data["sessions"]:
        if s["id"] == conversation_id:
            s["updated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            break
    _save_sessions(data)


# ── Projects directory ──────────────────────────────────────────────
PROJECTS_DIR = Path("/Users/ggomes/Projects")


def _claude_project_hash(project_path: str) -> str:
    """Convert a project path to the Claude Code project hash (dash-separated path)."""
    return project_path.replace("/", "-").lstrip("-")


def _auto_rename_session(conversation_id: str, prompt: str):
    """Rename a 'New conversation' session to the first ~30 chars of the prompt."""
    data = _load_sessions()
    for s in data["sessions"]:
        if s["id"] == conversation_id and s["name"] == "New conversation":
            name = prompt[:30].strip()
            if len(prompt) > 30:
                name = name.rsplit(" ", 1)[0] + "…"
            s["name"] = name
            break
    _save_sessions(data)


TERMINAL_SERVER_URL = os.environ.get("TERMINAL_SERVER_URL", "http://localhost:7601")

# Max chars of conversation history to include (leave room for current prompt + response)
MAX_HISTORY_CHARS = 80_000


def _build_conversation_prompt(conversation_id: str, current_prompt: str) -> str:
    """Build a prompt that includes conversation history from the session.

    Collects previous prompts and outputs from completed jobs in the same session,
    formats them as a conversation log, and prepends to the current prompt.
    """
    # Find all previous jobs in this session, sorted by created_at
    prev_jobs = []
    for f in JOBS_DIR.glob("*.yaml"):
        with open(f) as fh:
            data = yaml.safe_load(fh)
        if not data:
            continue
        if data.get("conversation_id") != conversation_id:
            continue
        # Only include completed jobs (not the one we're about to create)
        if data.get("status") not in ("completed", "failed"):
            continue
        prev_jobs.append(data)

    if not prev_jobs:
        return current_prompt

    # Sort by created_at ascending
    prev_jobs.sort(key=lambda j: j.get("created_at", ""))

    # Build conversation history
    turns = []
    total_chars = 0
    for job in prev_jobs:
        prompt = job.get("full_prompt") or job.get("prompt", "")
        # Read output from log file
        log_file = JOBS_DIR / f"{job['id']}.log"
        output = ""
        if log_file.exists():
            try:
                output = log_file.read_text(errors='replace').strip()
            except OSError:
                pass

        turn_text = f"User: {prompt}\n\nAssistant: {output}"
        turn_len = len(turn_text)

        # Check if adding this turn would exceed the limit
        if total_chars + turn_len > MAX_HISTORY_CHARS:
            # Truncate from the beginning (keep most recent turns)
            break
        turns.append(turn_text)
        total_chars += turn_len

    if not turns:
        return current_prompt

    # If we had to skip early turns due to size, only keep the latest ones
    # Re-collect from the end to prioritize recent context
    if len(turns) < len(prev_jobs):
        turns = []
        total_chars = 0
        for job in reversed(prev_jobs):
            prompt = job.get("full_prompt") or job.get("prompt", "")
            log_file = JOBS_DIR / f"{job['id']}.log"
            output = ""
            if log_file.exists():
                try:
                    output = log_file.read_text(errors='replace').strip()
                except OSError:
                    pass
            turn_text = f"User: {prompt}\n\nAssistant: {output}"
            if total_chars + len(turn_text) > MAX_HISTORY_CHARS:
                break
            turns.insert(0, turn_text)
            total_chars += len(turn_text)

    history = "\n\n---\n\n".join(turns)
    return f"""<conversation_history>
The following is the conversation so far in this session. Continue naturally from where we left off.

{history}
</conversation_history>

User: {current_prompt}"""


def _try_terminal_server(job_id: str, prompt: str) -> bool:
    """Try to start a job via the terminal server (node-pty). Returns True on success."""
    import urllib.request
    try:
        payload = json.dumps({
            "jobId": job_id,
            "prompt": prompt,
            "cwd": str(EKUS_ROOT),
        }).encode()
        req = urllib.request.Request(
            f"{TERMINAL_SERVER_URL}/api/jobs",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        resp = urllib.request.urlopen(req, timeout=5)
        return resp.status == 200
    except Exception as e:
        print(f"Terminal server unavailable ({e}), falling back to worker.py")
        return False


def _start_worker_fallback(job_id: str, job_file: Path):
    """Fallback: spawn the Python worker (tmux-based)."""
    worker_path = Path(__file__).parent / "worker.py"
    env = os.environ.copy()
    env.pop("CLAUDECODE", None)  # Avoid conflicts with nested claude

    proc = subprocess.Popen(
        [sys.executable, str(worker_path), job_id],
        cwd=str(Path(__file__).parent),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=env,
    )

    with open(job_file) as f:
        data = yaml.safe_load(f)
    data["pid"] = proc.pid
    with open(job_file, "w") as f:
        yaml.dump(data, f, default_flow_style=False, sort_keys=False)


@app.post("/job")
def create_job(req: JobRequest):
    job_id = uuid4().hex[:8]
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    log_file = str(JOBS_DIR / f"{job_id}.log")

    job_data = {
        "id": job_id,
        "status": "running",
        "prompt": req.prompt[:100],
        "full_prompt": req.prompt,
        "log_file": log_file,
        "created_at": now,
        "pid": 0,
        "session": f"job-{job_id}",
        "updates": [],
        "summary": "",
    }

    if req.conversation_id:
        job_data["conversation_id"] = req.conversation_id
        _update_session_timestamp(req.conversation_id)
        _auto_rename_session(req.conversation_id, req.prompt)

    job_file = JOBS_DIR / f"{job_id}.yaml"
    with open(job_file, "w") as f:
        yaml.dump(job_data, f, default_flow_style=False, sort_keys=False)

    # Build prompt with conversation history if in a session
    full_prompt = req.prompt
    if req.conversation_id:
        full_prompt = _build_conversation_prompt(req.conversation_id, req.prompt)

    # Try terminal server first (real-time streaming via WebSocket)
    # Falls back to worker.py (tmux + polling) if terminal server is down
    if not _try_terminal_server(job_id, full_prompt):
        _start_worker_fallback(job_id, job_file)

    result = {"job_id": job_id, "status": "running"}
    if req.conversation_id:
        result["conversation_id"] = req.conversation_id
    return result


@app.get("/job/{job_id}", response_class=PlainTextResponse)
def get_job(job_id: str):
    job_file = JOBS_DIR / f"{job_id}.yaml"
    if not job_file.exists():
        raise HTTPException(status_code=404, detail="Job not found")
    return job_file.read_text()


@app.get("/jobs", response_class=PlainTextResponse)
def list_jobs(archived: bool = False):
    search_dir = ARCHIVED_DIR if archived else JOBS_DIR
    if not search_dir.exists():
        return yaml.dump({"jobs": []}, default_flow_style=False, sort_keys=False)
    jobs = []
    for f in sorted(search_dir.glob("*.yaml")):
        with open(f) as fh:
            data = yaml.safe_load(fh)
        if data:
            jobs.append({
                "id": data.get("id"),
                "status": data.get("status"),
                "prompt": data.get("prompt", "")[:100],
                "created_at": data.get("created_at"),
            })
    return yaml.dump({"jobs": jobs}, default_flow_style=False, sort_keys=False)


@app.post("/jobs/clear")
def clear_jobs():
    ARCHIVED_DIR.mkdir(exist_ok=True)
    count = 0
    for f in JOBS_DIR.glob("*.yaml"):
        shutil.move(str(f), str(ARCHIVED_DIR / f.name))
        count += 1
    return {"archived": count}


@app.delete("/job/{job_id}")
def stop_job(job_id: str):
    job_file = JOBS_DIR / f"{job_id}.yaml"
    if not job_file.exists():
        raise HTTPException(status_code=404, detail="Job not found")

    with open(job_file) as f:
        data = yaml.safe_load(f)

    pid = data.get("pid")
    if pid:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass

    # Also kill the tmux session
    session = data.get("session", f"job-{job_id}")
    subprocess.run(["tmux", "kill-session", "-t", session],
                    capture_output=True, check=False)

    data["status"] = "stopped"
    with open(job_file, "w") as f:
        yaml.dump(data, f, default_flow_style=False, sort_keys=False)

    return {"job_id": job_id, "status": "stopped"}


# ── Automation ───────────────────────────────────────────────────────

@app.post("/automation/steer")
def run_steer(req: AutomationRequest):
    """Run a steer command (GUI automation)."""
    steer_bin = _find_steer()
    if not steer_bin:
        raise HTTPException(status_code=500, detail="steer binary not found")

    cmd = [str(steer_bin), req.action, "--json"] + req.args
    for k, v in req.kwargs.items():
        cmd.extend([f"--{k}", str(v)])

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    return {
        "exit_code": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }


@app.post("/automation/drive")
def run_drive(req: AutomationRequest):
    """Run a drive command (terminal automation)."""
    drive_dir = Path(__file__).parent.parent / "drive"
    cmd = ["uv", "run", "python", "main.py", req.action, "--json"] + req.args
    for k, v in req.kwargs.items():
        cmd.extend([f"--{k}", str(v)])

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60,
                            cwd=str(drive_dir))
    return {
        "exit_code": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }


def _find_steer() -> Path | None:
    """Find the steer binary."""
    candidates = [
        Path.home() / "Projects" / "mac-mini-agent" / "apps" / "steer" / ".build" / "release" / "steer",
        Path("/usr/local/bin/steer"),
        Path.home() / ".local" / "bin" / "steer",
    ]
    for p in candidates:
        if p.exists():
            return p
    return None


# ── JSON API: Jobs ───────────────────────────────────────────────────

@app.get("/api/jobs")
def list_jobs_json(conversation_id: str | None = None):
    """JSON API for listing jobs (for the chat UI). Optional conversation_id filter."""
    if not JOBS_DIR.exists():
        return {"jobs": []}
    jobs = []
    for f in sorted(JOBS_DIR.glob("*.yaml"), reverse=True):
        with open(f) as fh:
            data = yaml.safe_load(fh)
        if data:
            if conversation_id is not None:
                job_conv = data.get("conversation_id")
                if conversation_id == "__history__":
                    if job_conv is not None:
                        continue
                else:
                    if job_conv != conversation_id:
                        continue
            # Don't send full_prompt in list view
            data.pop("full_prompt", None)
            jobs.append(data)
    return {"jobs": jobs}


@app.get("/api/job/{job_id}")
def get_job_json(job_id: str):
    """JSON API for single job."""
    job_file = JOBS_DIR / f"{job_id}.yaml"
    if not job_file.exists():
        raise HTTPException(status_code=404, detail="Job not found")
    with open(job_file) as f:
        data = yaml.safe_load(f)
    # Don't send full_prompt in API response
    data.pop("full_prompt", None)
    return data


@app.get("/api/job/{job_id}/stream")
async def stream_job(job_id: str, offset: int = 0):
    """SSE endpoint for streaming job output."""
    job_file = JOBS_DIR / f"{job_id}.yaml"
    if not job_file.exists():
        raise HTTPException(status_code=404, detail="Job not found")

    log_file = JOBS_DIR / f"{job_id}.log"

    async def event_generator():
        current_offset = offset
        keepalive_counter = 0

        while True:
            # Check job status
            with open(job_file) as f:
                data = yaml.safe_load(f)

            # Read new content from log
            if log_file.exists():
                with open(log_file, 'rb') as f:
                    f.seek(current_offset)
                    new_content = f.read()
                    if new_content:
                        new_offset = current_offset + len(new_content)
                        text = new_content.decode('utf-8', errors='replace')
                        yield f"data: {json.dumps({'type': 'output', 'content': text, 'offset': new_offset})}\n\n"
                        current_offset = new_offset
                        keepalive_counter = 0

            # Check if done
            if data.get("status") in ("completed", "failed", "stopped"):
                yield f"data: {json.dumps({'type': 'done', 'status': data['status'], 'exit_code': data.get('exit_code', -1)})}\n\n"
                return

            keepalive_counter += 1
            if keepalive_counter >= 30:  # 15s at 0.5s interval
                yield ": keepalive\n\n"
                keepalive_counter = 0

            await asyncio.sleep(0.5)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/job/{job_id}/output", response_class=PlainTextResponse)
def get_job_output(job_id: str):
    """Get full output for a completed job."""
    log_file = JOBS_DIR / f"{job_id}.log"
    if not log_file.exists():
        return ""
    return log_file.read_text(errors='replace')


# ── File uploads ─────────────────────────────────────────────────────

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload a file."""
    ext = Path(file.filename or "file").suffix.lower()
    if ext not in ALLOWED_UPLOAD_TYPES:
        raise HTTPException(status_code=400, detail=f"File type {ext} not allowed")

    content = await file.read()
    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 20MB)")

    date_dir = datetime.now().strftime("%Y-%m-%d")
    upload_dir = UPLOAD_DIR / date_dir
    upload_dir.mkdir(parents=True, exist_ok=True)

    safe_name = f"{uuid4().hex[:8]}_{Path(file.filename or 'file').name}"
    file_path = upload_dir / safe_name
    file_path.write_bytes(content)

    return {"path": f"{date_dir}/{safe_name}", "size": len(content)}


@app.get("/api/uploads/{path:path}")
def serve_upload(path: str):
    """Serve an uploaded file."""
    file_path = UPLOAD_DIR / path
    # Path traversal protection
    try:
        file_path.resolve().relative_to(UPLOAD_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    import mimetypes
    content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
    return StreamingResponse(open(file_path, "rb"), media_type=content_type)


@app.post("/api/job/with-files")
async def create_job_with_files(
    prompt: str = Form(...),
    files: list[UploadFile] = File(default=[]),
    conversation_id: str = Form(default=None),
):
    """Create a job with optional file attachments."""
    file_paths = []
    for file in files:
        ext = Path(file.filename or "file").suffix.lower()
        if ext not in ALLOWED_UPLOAD_TYPES:
            continue
        content = await file.read()
        if len(content) > MAX_UPLOAD_SIZE:
            continue

        date_dir = datetime.now().strftime("%Y-%m-%d")
        upload_dir = UPLOAD_DIR / date_dir
        upload_dir.mkdir(parents=True, exist_ok=True)
        safe_name = f"{uuid4().hex[:8]}_{Path(file.filename or 'file').name}"
        file_path = upload_dir / safe_name
        file_path.write_bytes(content)
        file_paths.append(str(UPLOAD_DIR / date_dir / safe_name))

    # Build enhanced prompt with file references
    full_prompt = prompt
    if file_paths:
        full_prompt += "\n\nAttached files:\n" + "\n".join(f"- {p}" for p in file_paths)

    # Reuse create_job logic
    req = JobRequest(prompt=full_prompt, conversation_id=conversation_id)
    return create_job(req)


# ── Sessions API ─────────────────────────────────────────────────────

@app.get("/api/sessions")
def list_sessions():
    """List chat sessions with metadata."""
    data = _load_sessions()

    # Enrich sessions with job metadata
    job_files = list(JOBS_DIR.glob("*.yaml"))
    for session in data["sessions"]:
        sid = session["id"]
        job_count = 0
        has_running = False
        last_prompt = ""
        latest_time = ""
        for jf in job_files:
            with open(jf) as f:
                jd = yaml.safe_load(f)
            if jd and jd.get("conversation_id") == sid:
                job_count += 1
                if jd.get("status") == "running":
                    has_running = True
                if jd.get("created_at", "") > latest_time:
                    latest_time = jd["created_at"]
                    last_prompt = jd.get("prompt", "")
        session["job_count"] = job_count
        session["has_running"] = has_running
        session["last_prompt"] = last_prompt

    # Check for orphan jobs (no conversation_id) → virtual __history__ entry
    orphan_count = 0
    has_orphan_running = False
    for jf in job_files:
        with open(jf) as f:
            jd = yaml.safe_load(f)
        if jd and not jd.get("conversation_id"):
            orphan_count += 1
            if jd.get("status") == "running":
                has_orphan_running = True

    result = {"sessions": data["sessions"]}
    if orphan_count > 0:
        result["history"] = {
            "id": "__history__",
            "name": "History",
            "job_count": orphan_count,
            "has_running": has_orphan_running,
        }
    return result


@app.post("/api/sessions")
async def create_session(request: Request):
    """Create a new chat session."""
    body = await request.json()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    session = {
        "id": uuid4().hex[:8],
        "name": body.get("name", "New conversation"),
        "claude_session_id": str(uuid4()),  # Maps to Claude Code session
        "created_at": now,
        "updated_at": now,
    }
    data = _load_sessions()
    data["sessions"].insert(0, session)
    _save_sessions(data)
    return session


@app.put("/api/sessions/{session_id}")
async def rename_session(session_id: str, request: Request):
    """Rename a chat session."""
    body = await request.json()
    data = _load_sessions()
    for s in data["sessions"]:
        if s["id"] == session_id:
            s["name"] = body.get("name", s["name"])
            s["updated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            _save_sessions(data)
            return s
    raise HTTPException(status_code=404, detail="Session not found")


@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: str):
    """Delete a session and archive its jobs."""
    data = _load_sessions()
    original_len = len(data["sessions"])
    data["sessions"] = [s for s in data["sessions"] if s["id"] != session_id]
    if len(data["sessions"]) == original_len:
        raise HTTPException(status_code=404, detail="Session not found")
    _save_sessions(data)

    # Archive jobs belonging to this session
    ARCHIVED_DIR.mkdir(exist_ok=True)
    for jf in JOBS_DIR.glob("*.yaml"):
        with open(jf) as f:
            jd = yaml.safe_load(f)
        if jd and jd.get("conversation_id") == session_id:
            shutil.move(str(jf), str(ARCHIVED_DIR / jf.name))
            log = JOBS_DIR / f"{jd['id']}.log"
            if log.exists():
                shutil.move(str(log), str(ARCHIVED_DIR / log.name))

    return {"ok": True}


# ── Tasks API (migrated from Cloudflare KV) ─────────────────────────

@app.get("/api/tasks", response_class=PlainTextResponse)
def get_tasks():
    """Return tasks markdown."""
    if not TASKS_FILE.exists():
        return ""
    return TASKS_FILE.read_text()


@app.put("/api/tasks")
async def put_tasks(request: Request):
    """Update tasks markdown."""
    body = await request.body()
    TASKS_FILE.write_text(body.decode("utf-8"))
    return {"ok": True}


# ── Memory API (migrated from Cloudflare KV) ────────────────────────

def _is_safe_memory_path(name: str) -> bool:
    """Validate memory file name — must be .md and no path traversal."""
    if not name.endswith(".md"):
        return False
    resolved = (MEMORY_DIR / name).resolve()
    try:
        resolved.relative_to(MEMORY_DIR.resolve())
    except ValueError:
        return False
    return True


@app.get("/api/memory")
def list_memory():
    """List all memory files and their contents (auto-discovered from memory/)."""
    files = {}
    if MEMORY_DIR.exists():
        for path in sorted(MEMORY_DIR.glob("*.md")):
            if path.is_file() or path.is_symlink():
                try:
                    files[path.name] = path.read_text()
                except OSError:
                    files[path.name] = "(unreadable)"
    return files


@app.get("/api/memory/{name:path}", response_class=PlainTextResponse)
def get_memory(name: str):
    """Get a single memory file."""
    name = unquote(name)
    if not _is_safe_memory_path(name):
        raise HTTPException(status_code=403, detail="File not allowed")
    path = MEMORY_DIR / name
    if not path.exists():
        raise HTTPException(status_code=404, detail="Not found")
    return path.read_text()


@app.put("/api/memory/{name:path}")
async def put_memory(name: str, request: Request):
    """Update a single memory file (creates if it doesn't exist)."""
    name = unquote(name)
    if not _is_safe_memory_path(name):
        raise HTTPException(status_code=403, detail="File not allowed")
    body = await request.body()
    (MEMORY_DIR / name).write_text(body.decode("utf-8"))
    return {"ok": True}


@app.delete("/api/memory/{name:path}")
def delete_memory(name: str):
    """Delete a single memory file."""
    name = unquote(name)
    if not _is_safe_memory_path(name):
        raise HTTPException(status_code=403, detail="File not allowed")
    path = MEMORY_DIR / name
    if path.exists():
        path.unlink()
    return {"ok": True}


# ── Scheduler CRUD API ──────────────────────────────────────────────

@app.get("/api/scheduler/jobs")
def list_scheduler_jobs():
    """List all scheduler jobs with last_run info."""
    if not JOBS_CONFIG.exists():
        return {"jobs": []}

    with open(JOBS_CONFIG) as f:
        config = json.load(f)

    state = {}
    if SCHEDULER_STATE.exists():
        with open(SCHEDULER_STATE) as f:
            state = json.load(f)

    jobs = config.get("jobs", [])
    for job in jobs:
        job["last_run"] = state.get(job["id"])

    return {"jobs": jobs}


@app.post("/api/scheduler/jobs")
async def add_scheduler_job(request: Request):
    """Add a new scheduler job."""
    body = await request.json()
    required = ["id", "description", "schedule", "prompt"]
    for field in required:
        if field not in body:
            raise HTTPException(status_code=400, detail=f"Missing field: {field}")

    if not JOBS_CONFIG.exists():
        config = {"jobs": []}
    else:
        with open(JOBS_CONFIG) as f:
            config = json.load(f)

    # Check duplicate ID
    if any(j["id"] == body["id"] for j in config["jobs"]):
        raise HTTPException(status_code=409, detail="Job ID already exists")

    new_job = {
        "id": body["id"],
        "description": body["description"],
        "schedule": body["schedule"],
        "prompt": body["prompt"],
        "enabled": body.get("enabled", True),
    }
    config["jobs"].append(new_job)

    with open(JOBS_CONFIG, "w") as f:
        json.dump(config, f, indent=2)

    return {"ok": True, "job": new_job}


@app.put("/api/scheduler/jobs/{job_id}")
async def update_scheduler_job(job_id: str, request: Request):
    """Update a scheduler job."""
    if not JOBS_CONFIG.exists():
        raise HTTPException(status_code=404, detail="Job not found")

    with open(JOBS_CONFIG) as f:
        config = json.load(f)

    job = next((j for j in config["jobs"] if j["id"] == job_id), None)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    body = await request.json()
    for field in ["description", "schedule", "prompt", "enabled"]:
        if field in body:
            job[field] = body[field]

    with open(JOBS_CONFIG, "w") as f:
        json.dump(config, f, indent=2)

    return {"ok": True, "job": job}


@app.delete("/api/scheduler/jobs/{job_id}")
def delete_scheduler_job(job_id: str):
    """Delete a scheduler job."""
    if not JOBS_CONFIG.exists():
        raise HTTPException(status_code=404, detail="Job not found")

    with open(JOBS_CONFIG) as f:
        config = json.load(f)

    original_len = len(config["jobs"])
    config["jobs"] = [j for j in config["jobs"] if j["id"] != job_id]

    if len(config["jobs"]) == original_len:
        raise HTTPException(status_code=404, detail="Job not found")

    with open(JOBS_CONFIG, "w") as f:
        json.dump(config, f, indent=2)

    return {"ok": True}


@app.post("/api/scheduler/jobs/{job_id}/run")
def run_scheduler_job(job_id: str):
    """Trigger immediate run of a scheduler job."""
    if not JOBS_CONFIG.exists():
        raise HTTPException(status_code=404, detail="Job not found")

    with open(JOBS_CONFIG) as f:
        config = json.load(f)

    job = next((j for j in config["jobs"] if j["id"] == job_id), None)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    req = JobRequest(prompt=job["prompt"])
    return create_job(req)


@app.get("/api/scheduler/jobs/{job_id}/logs")
def get_scheduler_job_logs(job_id: str):
    """Get recent log files for a scheduler job."""
    log_files = sorted(LOGS_DIR.glob(f"{job_id}*.log"), reverse=True)[:10]
    logs = []
    for lf in log_files:
        content = lf.read_text(errors='replace')
        if len(content) > 10240:
            content = content[:10240] + "\n... (truncated)"
        logs.append({"filename": lf.name, "content": content, "modified": lf.stat().st_mtime})
    return {"logs": logs}


# ── Voice API ────────────────────────────────────────────────────────

VOICE_DIR = DATA_DIR / "voice"
VOICE_DIR.mkdir(exist_ok=True)

# ── Voice dictation router (faster-whisper, corrections DB, cleanup) ──
from voice.routes import voice_router
from voice.routes import init_voice_dir as _init_voice_dir
from voice import db as _voice_db

_init_voice_dir(VOICE_DIR)
_voice_db.init_db(VOICE_DIR / "dictation.db")
app.include_router(voice_router, prefix="/api/voice")


@app.post("/api/voice/transcribe")
async def voice_transcribe(file: UploadFile = File(...)):
    """Transcribe audio using OpenAI Whisper API."""
    import httpx

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured")

    content = await file.read()
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Audio file too large (max 25MB)")

    # Save locally for reference
    audio_id = uuid4().hex[:8]
    ext = Path(file.filename or "audio.webm").suffix or ".webm"
    audio_path = VOICE_DIR / f"{audio_id}{ext}"
    audio_path.write_bytes(content)

    # Call OpenAI Whisper
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            "https://api.openai.com/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {api_key}"},
            files={"file": (file.filename or f"audio{ext}", content, file.content_type or "audio/webm")},
            data={"model": "whisper-1"},
        )

    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=f"Whisper API error: {resp.text}")

    result = resp.json()
    return {"audio_id": audio_id, "text": result.get("text", "")}


@app.post("/api/voice/analyze")
async def voice_analyze(request: Request):
    """Analyze transcribed text using Claude CLI (uses Max account auth)."""
    body = await request.json()
    text = body.get("text", "")
    if not text:
        raise HTTPException(status_code=400, detail="No text provided")

    prompt = body.get("prompt", "Compress this voice note into a shorter, cleaner message. Keep the same meaning, tone, and language but remove filler words, repetition, and rambling. Output ONLY the compressed message — no commentary, no quotes, no explanation.")
    full_prompt = f"{prompt}\n\nVoice note transcription:\n{text}"

    claude_bin = "/opt/homebrew/bin/claude"
    # Strip API keys so claude CLI uses its own OAuth auth
    cli_env = {k: v for k, v in os.environ.items() if k not in ("ANTHROPIC_API_KEY", "ANTH_API_KEY")}
    proc = await asyncio.create_subprocess_exec(
        claude_bin, "-p", "--output-format", "text",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=cli_env,
    )
    stdout, stderr = await asyncio.wait_for(proc.communicate(full_prompt.encode()), timeout=60)

    if proc.returncode != 0:
        raise HTTPException(status_code=500, detail=f"Claude CLI error: {stderr.decode()[:300] or stdout.decode()[:200]}")

    return {"analysis": stdout.decode().strip()}


@app.post("/api/voice/tts")
async def voice_tts(request: Request):
    """Convert text to speech using OpenAI TTS API."""
    import httpx

    body = await request.json()
    text = body.get("text", "")
    if not text:
        raise HTTPException(status_code=400, detail="No text provided")

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured")

    voice = body.get("voice", "onyx")

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.openai.com/v1/audio/speech",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={"model": "tts-1", "input": text, "voice": voice},
        )

    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=f"TTS API error: {resp.text}")

    return StreamingResponse(
        iter([resp.content]),
        media_type="audio/mpeg",
        headers={"Content-Disposition": "inline; filename=speech.mp3"},
    )


# ── WhatsApp API ─────────────────────────────────────────────────────

@app.get("/api/whatsapp/conversations")
def list_whatsapp_conversations():
    """List recent WhatsApp conversations via wacli."""
    wacli = "/opt/homebrew/bin/wacli"
    try:
        result = subprocess.run(
            [wacli, "chats", "list", "--json", "--limit", "20"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            return {"conversations": [], "error": result.stderr.strip()}
        data = json.loads(result.stdout)
        if not data.get("success") or not data.get("data"):
            return {"conversations": [], "error": data.get("error") or "No chats found"}
        convos = []
        for chat in data["data"]:
            convos.append({
                "name": chat.get("Name") or chat.get("JID", ""),
                "jid": chat.get("JID", ""),
            })
        return {"conversations": convos}
    except FileNotFoundError:
        return {"conversations": [], "error": "wacli not installed"}
    except subprocess.TimeoutExpired:
        return {"conversations": [], "error": "wacli timed out"}
    except Exception as e:
        return {"conversations": [], "error": str(e)}


@app.post("/api/whatsapp/send")
async def send_whatsapp(request: Request):
    """Send a WhatsApp message via wacli."""
    wacli = "/opt/homebrew/bin/wacli"
    body = await request.json()
    recipient = body.get("recipient", "")
    message = body.get("message", "")

    if not recipient or not message:
        raise HTTPException(status_code=400, detail="recipient and message required")

    try:
        result = subprocess.run(
            [wacli, "send", "text", "--to", recipient, "--message", message],
            capture_output=True, text=True, timeout=15,
        )
        if result.returncode != 0:
            return {"ok": False, "error": result.stderr.strip() or result.stdout.strip()}
        return {"ok": True}
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="wacli not installed")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="wacli timed out")


@app.post("/api/whatsapp/send-audio")
async def send_whatsapp_audio(request: Request):
    """Generate TTS audio from text and send as WhatsApp audio file."""
    import httpx

    body = await request.json()
    text = body.get("text", "")
    recipient = body.get("recipient", "")
    voice = body.get("voice", "onyx")

    if not text or not recipient:
        raise HTTPException(status_code=400, detail="text and recipient required")

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured")

    # Generate TTS audio
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.openai.com/v1/audio/speech",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={"model": "tts-1", "input": text, "voice": voice},
        )

    if resp.status_code != 200:
        raise HTTPException(status_code=500, detail=f"TTS error: {resp.text[:200]}")

    # Save audio to file
    audio_path = VOICE_DIR / f"whatsapp_{uuid4().hex[:8]}.mp3"
    audio_path.write_bytes(resp.content)

    # Send via wacli
    wacli = "/opt/homebrew/bin/wacli"
    try:
        result = subprocess.run(
            [wacli, "send", "file", "--to", recipient, "--file", str(audio_path)],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            return {"ok": False, "error": result.stderr.strip() or result.stdout.strip()}
        return {"ok": True}
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="wacli not installed")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="wacli timed out")


# ── Channel session lifecycle ─────────────────────────────────────────

async def _start_claude_session(ekus_session_id: str, claude_session_id: str, resume: bool, working_dir: str | None = None):
    """Start Claude Code in tmux with channel, optionally resuming a session."""
    # Build the claude command
    resume_flag = f"--resume {claude_session_id}" if resume else f"--session-id {claude_session_id}"
    project_dir = working_dir or str(EKUS_ROOT)
    cmd = (
        f"export PATH=/opt/homebrew/bin:$HOME/.local/bin:$HOME/.bun/bin:$PATH; "
        f"cd {project_dir} && "
        f"set -a && source {EKUS_ROOT}/.env 2>/dev/null && set +a; "
        f"exec claude --dangerously-load-development-channels server:ekus-channel "
        f"--dangerously-skip-permissions {resume_flag}"
    )

    # Kill existing session + attached Terminal windows
    env = {**os.environ, "PATH": f"/opt/homebrew/bin:{os.environ.get('PATH', '')}"}
    subprocess.run(["pkill", "-f", "tmux attach -t ekus-claude"], capture_output=True, env=env)
    subprocess.run(["tmux", "kill-session", "-t", "ekus-claude"],
                   capture_output=True, env=env)
    subprocess.run(
        ["osascript", "-e",
         'tell application "Terminal" to close (every window whose processes = {})'],
        capture_output=True,
    )
    await asyncio.sleep(1)

    # Start new tmux session
    subprocess.run(
        ["tmux", "new-session", "-d", "-s", "ekus-claude", cmd],
        capture_output=True, env=env,
    )

    # Accept the development channels prompt (sends Enter after 3s)
    await asyncio.sleep(3)
    subprocess.run(["tmux", "send-keys", "-t", "ekus-claude", "Enter"], capture_output=True, env=env)

    # Wait for channel server to be healthy
    _session_state["status"] = "starting"
    _session_state["active_session_id"] = ekus_session_id
    _session_state["claude_session_id"] = claude_session_id

    healthy = await _wait_for_channel_health(timeout=20.0)
    if healthy:
        _session_state["status"] = "ready"
        _session_state["error"] = None
        # Open visible Terminal window on Mac Mini
        subprocess.run(
            ["osascript", "-e", 'tell application "Terminal" to do script "tmux attach -t ekus-claude"'],
            capture_output=True,
        )
        await _flush_message_queue()
    else:
        _session_state["status"] = "error"
        _session_state["error"] = "Channel server did not start within timeout"
        print(f"[SESSION] Failed to start session {ekus_session_id}")


async def _stop_claude_session():
    """Stop the current Claude Code session and clean up Terminal windows."""
    env = {**os.environ, "PATH": f"/opt/homebrew/bin:{os.environ.get('PATH', '')}"}
    # Kill Terminal.app windows attached to the tmux session (prevents orphans)
    subprocess.run(
        ["pkill", "-f", "tmux attach -t ekus-claude"],
        capture_output=True, env=env,
    )
    # Close Terminal.app windows that have no running process
    subprocess.run(
        ["osascript", "-e",
         'tell application "Terminal" to close (every window whose processes = {})'],
        capture_output=True,
    )
    # Kill the tmux session itself
    subprocess.run(["tmux", "kill-session", "-t", "ekus-claude"], capture_output=True, env=env)
    _session_state["status"] = "idle"
    _session_state["active_session_id"] = None
    _session_state["claude_session_id"] = None


async def _switch_session(target_ekus_session_id: str, working_dir: str | None = None):
    """Switch to a different Claude Code session."""
    async with _session_lock:
        print(f"[SESSION] Switching to session {target_ekus_session_id}")
        _session_state["status"] = "switching"
        _session_state["error"] = None

        # Stop current session
        await _stop_claude_session()
        await asyncio.sleep(1)

        # Look up the target session's claude_session_id
        data = _load_sessions()
        target_session = None
        for s in data["sessions"]:
            if s["id"] == target_ekus_session_id:
                target_session = s
                break

        if not target_session:
            _session_state["status"] = "error"
            _session_state["error"] = f"Session {target_ekus_session_id} not found"
            return

        # Store working_dir in session if provided
        if working_dir:
            target_session["working_dir"] = working_dir
            _save_sessions(data)

        session_working_dir = working_dir or target_session.get("working_dir")

        claude_sid = target_session.get("claude_session_id")
        resume = False
        if claude_sid:
            # Check if session file exists on disk — use project-specific dir
            project_hash = _claude_project_hash(session_working_dir or str(EKUS_ROOT))
            sessions_dir = Path.home() / ".claude" / "projects" / project_hash
            if (sessions_dir / f"{claude_sid}.jsonl").exists():
                resume = True
            else:
                # Session file gone, create fresh
                claude_sid = str(uuid4())
                target_session["claude_session_id"] = claude_sid
                _save_sessions(data)
        else:
            # New conversation, no Claude session yet
            claude_sid = str(uuid4())
            target_session["claude_session_id"] = claude_sid
            _save_sessions(data)

        await _start_claude_session(target_ekus_session_id, claude_sid, resume, session_working_dir)


async def _wait_for_channel_health(timeout: float = 20.0) -> bool:
    """Poll channel server health until ready or timeout."""
    import time
    start = time.time()
    while time.time() - start < timeout:
        try:
            req = urllib.request.Request(f"{CHANNEL_SERVER_URL}/health", method="GET")
            resp = urllib.request.urlopen(req, timeout=2)
            if resp.status == 200:
                return True
        except Exception:
            pass
        await asyncio.sleep(0.5)
    return False


async def _flush_message_queue():
    """Forward all queued messages to the channel server."""
    while _session_state["message_queue"]:
        msg = _session_state["message_queue"].pop(0)
        try:
            payload = json.dumps({
                "chat_id": msg["chat_id"],
                "message": msg["message"],
                "session_id": msg.get("session_id"),
                "files": msg.get("files", []),
            }).encode()
            req = urllib.request.Request(
                f"{CHANNEL_SERVER_URL}/message",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=5)
        except Exception as e:
            print(f"[SESSION] Failed to flush message {msg['chat_id']}: {e}")


def _append_channel_history(session_id: str, role: str, chat_id: str, content: str, files: list = None):
    """Append a message to the channel history file for a session."""
    if not session_id:
        return
    history_file = CHANNEL_HISTORY_DIR / f"{session_id}.jsonl"
    entry = {
        "role": role,
        "chat_id": chat_id,
        "content": content,
        "files": files or [],
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    with open(history_file, "a") as f:
        f.write(json.dumps(entry) + "\n")


# ── Channel communication API ─────────────────────────────────────────

@app.post("/api/channel/message")
async def send_channel_message(request: Request):
    """Send a message to Claude via the channel server."""
    body = await request.json()
    message = body.get("message", "")
    session_id = body.get("session_id")
    files = body.get("files", [])

    if not message:
        raise HTTPException(status_code=400, detail="No message provided")

    chat_id = uuid4().hex[:8]

    # Save to channel history
    _append_channel_history(session_id, "user", chat_id, message, files)

    # Check if we need to switch sessions
    if session_id and session_id != _session_state["active_session_id"]:
        _session_state["message_queue"].append({
            "chat_id": chat_id, "message": message,
            "session_id": session_id, "files": files,
        })
        asyncio.create_task(_switch_session(session_id))
        return {"ok": True, "chat_id": chat_id, "switching": True}

    if _session_state["status"] in ("starting", "switching"):
        _session_state["message_queue"].append({
            "chat_id": chat_id, "message": message,
            "session_id": session_id, "files": files,
        })
        return {"ok": True, "chat_id": chat_id, "queued": True}

    if _session_state["status"] == "idle" and session_id:
        _session_state["message_queue"].append({
            "chat_id": chat_id, "message": message,
            "session_id": session_id, "files": files,
        })
        asyncio.create_task(_switch_session(session_id))
        return {"ok": True, "chat_id": chat_id, "starting": True}

    # Forward to channel server (existing logic)
    try:
        payload = json.dumps({
            "chat_id": chat_id,
            "message": message,
            "session_id": session_id,
            "files": files,
        }).encode()
        req = urllib.request.Request(
            f"{CHANNEL_SERVER_URL}/message",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        resp = urllib.request.urlopen(req, timeout=5)
        if resp.status != 200:
            raise HTTPException(status_code=502, detail="Channel server error")
    except urllib.error.URLError as e:
        raise HTTPException(status_code=503, detail=f"Channel server unavailable: {e}")

    return {"ok": True, "chat_id": chat_id}


@app.post("/api/channel/reply")
async def receive_channel_reply(request: Request):
    """Receive a reply from the channel server (called by channel server's reply tool)."""
    import traceback
    try:
        body = await request.json()
        chat_id = body.get("chat_id", "")
        text = body.get("text", "")
        files = body.get("files", [])

        reply_data = {
            "type": "reply",
            "chat_id": chat_id,
            "text": text,
            "files": files,
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }

        _channel_replies[chat_id] = reply_data

        # Save reply to channel history
        _append_channel_history(_session_state.get("active_session_id", ""), "assistant", chat_id, text, files)

        # Broadcast to all connected WebSocket clients
        global _channel_ws_clients
        msg = json.dumps(reply_data)
        dead_clients = set()
        for ws in _channel_ws_clients:
            try:
                await ws.send_text(msg)
            except Exception:
                dead_clients.add(ws)
        if dead_clients:
            _channel_ws_clients -= dead_clients

        return {"ok": True}
    except Exception as e:
        print(f"[CHANNEL REPLY ERROR] {e}")
        traceback.print_exc()
        raise


@app.get("/api/channel/status")
def channel_status():
    """Check if channel server is available and return session state."""
    result = {
        "available": False,
        "session_state": _session_state["status"],
        "active_session_id": _session_state.get("active_session_id"),
        "claude_session_id": _session_state.get("claude_session_id"),
    }
    if _session_state.get("error"):
        result["error"] = _session_state["error"]
    try:
        req = urllib.request.Request(f"{CHANNEL_SERVER_URL}/health", method="GET")
        resp = urllib.request.urlopen(req, timeout=3)
        if resp.status == 200:
            data = json.loads(resp.read().decode())
            result["available"] = True
            result.update(data)
    except Exception:
        pass
    return result


@app.post("/api/channel/switch")
async def switch_channel_session(request: Request):
    """Proactively switch to a different Claude Code session."""
    body = await request.json()
    session_id = body.get("session_id")
    working_dir = body.get("working_dir")
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")

    if session_id == _session_state["active_session_id"] and _session_state["status"] == "ready" and not working_dir:
        return {"ok": True, "already_active": True}

    asyncio.create_task(_switch_session(session_id, working_dir))
    return {"ok": True, "switching": True}


@app.get("/api/channel/history/{session_id}")
def get_channel_history(session_id: str):
    """Get channel message history for a session."""
    history_file = CHANNEL_HISTORY_DIR / f"{session_id}.jsonl"
    if not history_file.exists():
        return {"messages": []}
    messages = []
    for line in history_file.read_text().splitlines():
        if line.strip():
            try:
                messages.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return {"messages": messages}


@app.websocket("/api/channel/ws")
async def channel_websocket(websocket: WebSocket):
    """WebSocket for real-time channel replies to frontend."""
    await websocket.accept()
    _channel_ws_clients.add(websocket)
    try:
        while True:
            # Keep connection alive, handle pings
            data = await websocket.receive_text()
            # Client can send ping, we just acknowledge
            if data == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        pass
    finally:
        _channel_ws_clients.discard(websocket)


@app.get("/api/channel/reply/{chat_id}")
def get_channel_reply(chat_id: str):
    """Poll for a specific reply (fallback if WebSocket unavailable)."""
    reply = _channel_replies.get(chat_id)
    if reply:
        return reply
    return {"type": "pending", "chat_id": chat_id}


# ── Projects API ─────────────────────────────────────────────────────

@app.get("/api/projects")
def list_projects():
    """List project folders in /Users/ggomes/Projects."""
    projects = []
    if PROJECTS_DIR.exists():
        for entry in sorted(PROJECTS_DIR.iterdir()):
            if entry.is_dir() and not entry.name.startswith("."):
                projects.append({
                    "name": entry.name,
                    "path": str(entry),
                    "has_git": (entry / ".git").exists(),
                    "modified": datetime.fromtimestamp(entry.stat().st_mtime, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                })
    return {"projects": projects}


@app.post("/api/projects")
async def create_project(request: Request):
    """Create a new project folder."""
    body = await request.json()
    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    # Sanitize: only allow alphanumeric, dashes, underscores, dots
    safe_name = "".join(c for c in name if c.isalnum() or c in "-_.")
    if not safe_name:
        raise HTTPException(status_code=400, detail="Invalid project name")
    project_path = PROJECTS_DIR / safe_name
    if project_path.exists():
        raise HTTPException(status_code=409, detail="Project already exists")
    project_path.mkdir(parents=True)
    return {"ok": True, "name": safe_name, "path": str(project_path)}


# ── Static files (Next.js app) ───────────────────────────────────────

STATIC_DIR = Path(__file__).parent / "static"


@app.get("/sw.js")
def serve_sw():
    """Serve service worker with no-cache so browsers always get the latest."""
    sw_path = STATIC_DIR / "sw.js"
    if not sw_path.exists():
        raise HTTPException(status_code=404)
    from fastapi.responses import Response
    return Response(
        content=sw_path.read_text(),
        media_type="application/javascript",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")


@app.on_event("startup")
async def warm_up_models():
    """Pre-load heavy models (faster-whisper, silero-vad) in background."""
    import asyncio
    async def _warm():
        from voice.transcriber import warm_up as whisper_warm
        from voice.vad import _get_model as vad_warm
        await asyncio.to_thread(whisper_warm)
        await asyncio.to_thread(vad_warm)
    asyncio.create_task(_warm())


@app.on_event("startup")
async def detect_running_channel():
    """On gateway startup, detect if a channel session is already running."""
    try:
        req = urllib.request.Request(f"{CHANNEL_SERVER_URL}/health", method="GET")
        resp = urllib.request.urlopen(req, timeout=2)
        if resp.status == 200:
            _session_state["status"] = "ready"
            print("[SESSION] Detected running channel server on startup")
    except Exception:
        pass


if __name__ == "__main__":
    import uvicorn
    cert_dir = Path(__file__).parent / "certs"
    cert_file = cert_dir / "cert.pem"
    key_file = cert_dir / "key.pem"

    if cert_file.exists() and key_file.exists():
        # Serve both HTTP (7600) and HTTPS (7443) — no separate proxy needed
        config_http = uvicorn.Config(app, host="0.0.0.0", port=7600)
        config_https = uvicorn.Config(
            app, host="0.0.0.0", port=7443,
            ssl_keyfile=str(key_file), ssl_certfile=str(cert_file),
        )

        async def _serve_dual():
            http_server = uvicorn.Server(config_http)
            https_server = uvicorn.Server(config_https)
            await asyncio.gather(http_server.serve(), https_server.serve())

        asyncio.run(_serve_dual())
    else:
        uvicorn.run(app, host="0.0.0.0", port=7600)
