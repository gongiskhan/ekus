"""Job worker — runs a Claude Code agent in a headless tmux session.

Creates a detached tmux session, sends the claude command with sentinel
markers, polls for completion, then updates the job YAML.

Adapted from mac-mini-agent for headless operation (no Terminal.app needed).
"""

import os
import re
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import yaml

SENTINEL_PREFIX = "__JOBDONE_"
POLL_INTERVAL = 2.0
EKUS_ROOT = Path(__file__).parent.parent.parent


def _tmux(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    """Run a tmux command."""
    return subprocess.run(["tmux", *args], capture_output=True, text=True, check=check)


def _session_exists(name: str) -> bool:
    result = _tmux("has-session", "-t", name, check=False)
    return result.returncode == 0


def _create_session(name: str, cwd: str) -> None:
    """Create a detached tmux session (headless, no Terminal.app)."""
    _tmux("new-session", "-d", "-s", name, "-c", cwd)
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        if _session_exists(name):
            return
        time.sleep(0.2)
    raise RuntimeError(f"tmux session '{name}' did not appear within 5s")


def _send_keys(session: str, keys: str) -> None:
    """Send keys to tmux session then press Enter."""
    _tmux("send-keys", "-t", f"{session}:", keys)
    _tmux("send-keys", "-t", f"{session}:", "Enter")


def _capture_pane(session: str) -> str:
    result = _tmux("capture-pane", "-p", "-t", f"{session}:", "-S", "-500")
    return result.stdout


def _wait_for_sentinel(session: str, token: str, timeout: int = 0) -> int:
    """Poll until sentinel appears. timeout=0 means wait forever."""
    pattern = re.compile(
        rf"^{re.escape(SENTINEL_PREFIX)}{token}:(\d+)\s*$", re.MULTILINE
    )
    start = time.time()
    while True:
        time.sleep(POLL_INTERVAL)
        if timeout > 0 and (time.time() - start) > timeout:
            return -1  # Timeout
        captured = _capture_pane(session)
        match = pattern.search(captured)
        if match:
            return int(match.group(1))


def main():
    if len(sys.argv) < 3:
        print("Usage: worker.py <job_id> <prompt>")
        sys.exit(1)

    job_id = sys.argv[1]
    prompt = sys.argv[2]

    jobs_dir = Path(__file__).parent / "jobs"
    job_file = jobs_dir / f"{job_id}.yaml"

    if not job_file.exists():
        print(f"Job file not found: {job_file}")
        sys.exit(1)

    # Use ekus project root as working directory for claude
    working_dir = str(EKUS_ROOT)

    # Write user prompt to a temp file to avoid tmux send-keys truncation
    prompt_tmp = Path(f"/tmp/ekus-prompt-{job_id}.txt")
    prompt_tmp.write_text(prompt)

    session_name = f"job-{job_id}"
    token = uuid.uuid4().hex[:8]

    # Build the claude command — read prompt from file to avoid truncation
    # Source .env for ANTHROPIC_API_KEY and use -p flag for non-interactive mode
    env_file = EKUS_ROOT / ".env"
    source_env = f"source {env_file} && " if env_file.exists() else ""

    claude_cmd = (
        f"claude -p --dangerously-skip-permissions"
        f' "$(cat {prompt_tmp})"'
    )

    # Wrap with sentinel: <cmd> ; echo "__JOBDONE_<token>:$?"
    wrapped = f'export PATH=/opt/homebrew/bin:$PATH && {source_env}{claude_cmd} ; echo "{SENTINEL_PREFIX}{token}:$?"'

    start_time = time.time()

    try:
        # Create headless tmux session
        _create_session(session_name, working_dir)

        # Send the wrapped command
        _send_keys(session_name, wrapped)

        # Update job with session info
        with open(job_file) as f:
            data = yaml.safe_load(f)
        data["session"] = session_name
        with open(job_file, "w") as f:
            yaml.dump(data, f, default_flow_style=False, sort_keys=False)

        # Wait for completion — no timeout (agent runs until done)
        exit_code = _wait_for_sentinel(session_name, token)

    except Exception as e:
        exit_code = 1
        print(f"Worker error: {e}", file=sys.stderr)

    duration = round(time.time() - start_time)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    with open(job_file) as f:
        data = yaml.safe_load(f)

    data["status"] = "completed" if exit_code == 0 else "failed"
    data["exit_code"] = exit_code
    data["duration_seconds"] = duration
    data["completed_at"] = now

    with open(job_file, "w") as f:
        yaml.dump(data, f, default_flow_style=False, sort_keys=False)

    # Clean up
    prompt_tmp.unlink(missing_ok=True)
    if _session_exists(session_name):
        _tmux("kill-session", "-t", session_name, check=False)


if __name__ == "__main__":
    main()
