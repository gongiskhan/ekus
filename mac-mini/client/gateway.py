"""Ekus Gateway client — send jobs and automation commands to the Mac Mini.

Usage from ekus scripts or CLI:
    from mac_mini.client.gateway import GatewayClient

    gw = GatewayClient()
    job = gw.start_job("Open Safari and search for...")
    print(gw.get_job(job["job_id"]))
    gw.stop_job(job["job_id"])
"""

import json
import os
import subprocess


GATEWAY_URL = os.environ.get("MAC_MINI_GATEWAY_URL", "http://100.90.155.85:7600")


class GatewayClient:
    def __init__(self, url: str | None = None):
        self.url = (url or GATEWAY_URL).rstrip("/")

    def _curl(self, method: str, path: str, data: dict | None = None) -> str:
        """Make HTTP request via curl (no Python dependencies needed)."""
        cmd = ["curl", "-s", "-X", method, f"{self.url}{path}"]
        if data:
            cmd.extend(["-H", "Content-Type: application/json", "-d", json.dumps(data)])
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        return result.stdout

    def health(self) -> dict:
        return json.loads(self._curl("GET", "/health"))

    def start_job(self, prompt: str) -> dict:
        return json.loads(self._curl("POST", "/job", {"prompt": prompt}))

    def get_job(self, job_id: str) -> str:
        return self._curl("GET", f"/job/{job_id}")

    def list_jobs(self, archived: bool = False) -> str:
        path = "/jobs?archived=true" if archived else "/jobs"
        return self._curl("GET", path)

    def stop_job(self, job_id: str) -> dict:
        return json.loads(self._curl("DELETE", f"/job/{job_id}"))

    def clear_jobs(self) -> dict:
        return json.loads(self._curl("POST", "/jobs/clear"))

    def steer(self, action: str, args: list[str] | None = None,
              kwargs: dict | None = None) -> dict:
        """Run a steer (GUI automation) command on Mac Mini."""
        data = {"action": action, "args": args or [], "kwargs": kwargs or {}}
        return json.loads(self._curl("POST", "/automation/steer", data))

    def drive(self, action: str, args: list[str] | None = None,
              kwargs: dict | None = None) -> dict:
        """Run a drive (terminal automation) command on Mac Mini."""
        data = {"action": action, "args": args or [], "kwargs": kwargs or {}}
        return json.loads(self._curl("POST", "/automation/drive", data))
