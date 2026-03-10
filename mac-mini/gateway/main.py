"""Ekus Gateway — HTTP server for remote agent execution on Mac Mini.

Accepts job requests over HTTP, spawns Claude Code agents in tmux sessions,
and tracks their progress via YAML job files.

Based on mac-mini-agent's Listen server, adapted for headless operation.
"""

import os
import shutil
import signal
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import yaml
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, PlainTextResponse
from pydantic import BaseModel

app = FastAPI(title="Ekus Gateway", version="0.1.0")

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


class JobRequest(BaseModel):
    prompt: str
    system_prompt: str | None = None
    working_dir: str | None = None
    dangerously_skip_permissions: bool = True


class AutomationRequest(BaseModel):
    """Request for GUI/terminal automation tasks."""
    action: str  # steer or drive command
    args: list[str] = []
    kwargs: dict = {}


@app.get("/health")
def health():
    return {"status": "ok", "hostname": os.uname().nodename}


@app.post("/job")
def create_job(req: JobRequest):
    job_id = uuid4().hex[:8]
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    job_data = {
        "id": job_id,
        "status": "running",
        "prompt": req.prompt,
        "created_at": now,
        "pid": 0,
        "session": f"job-{job_id}",
        "updates": [],
        "summary": "",
    }

    job_file = JOBS_DIR / f"{job_id}.yaml"
    with open(job_file, "w") as f:
        yaml.dump(job_data, f, default_flow_style=False, sort_keys=False)

    # Spawn the worker process
    worker_path = Path(__file__).parent / "worker.py"
    env = os.environ.copy()
    env.pop("CLAUDECODE", None)  # Avoid conflicts with nested claude

    proc = subprocess.Popen(
        [sys.executable, str(worker_path), job_id, req.prompt],
        cwd=str(Path(__file__).parent),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=env,
    )

    job_data["pid"] = proc.pid
    with open(job_file, "w") as f:
        yaml.dump(job_data, f, default_flow_style=False, sort_keys=False)

    return {"job_id": job_id, "status": "running"}


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


@app.get("/api/jobs")
def list_jobs_json():
    """JSON API for listing jobs (for the chat UI)."""
    if not JOBS_DIR.exists():
        return {"jobs": []}
    jobs = []
    for f in sorted(JOBS_DIR.glob("*.yaml"), reverse=True):
        with open(f) as fh:
            data = yaml.safe_load(fh)
        if data:
            jobs.append(data)
    return {"jobs": jobs}


@app.get("/api/job/{job_id}")
def get_job_json(job_id: str):
    """JSON API for single job."""
    job_file = JOBS_DIR / f"{job_id}.yaml"
    if not job_file.exists():
        raise HTTPException(status_code=404, detail="Job not found")
    with open(job_file) as f:
        return yaml.safe_load(f)


@app.get("/", response_class=HTMLResponse)
def chat_ui():
    """Serve the chat UI."""
    html_path = Path(__file__).parent / "chat.html"
    if html_path.exists():
        return html_path.read_text()
    return "<h1>Ekus Gateway</h1><p>Chat UI not found.</p>"


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7600)
