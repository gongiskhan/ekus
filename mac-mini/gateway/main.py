"""Ekus Gateway — HTTP server for remote agent execution on Mac Mini.

Accepts job requests over HTTP, spawns Claude Code agents in tmux sessions,
and tracks their progress via YAML job files. Also serves the task/memory
dashboard, scheduler CRUD, file uploads, and SSE streaming.

Based on mac-mini-agent's Listen server, adapted for headless operation.
"""

import asyncio
import json
import os
import shutil
import signal
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote
from uuid import uuid4

import yaml
from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form
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
ALLOWED_UPLOAD_TYPES = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf', '.txt', '.md', '.csv', '.json'}
MAX_UPLOAD_SIZE = 20 * 1024 * 1024  # 20MB

# Scheduler config paths
CONFIG_DIR = EKUS_ROOT / "config"
JOBS_CONFIG = CONFIG_DIR / "jobs.json"
SCHEDULER_STATE = CONFIG_DIR / ".scheduler-state.json"
LOGS_DIR = EKUS_ROOT / "logs"


SESSIONS_FILE = DATA_DIR / "sessions.json"


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

    # Try terminal server first (real-time streaming via WebSocket)
    # Falls back to worker.py (tmux + polling) if terminal server is down
    if not _try_terminal_server(job_id, req.prompt):
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7600)
