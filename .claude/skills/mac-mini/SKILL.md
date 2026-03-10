# Mac Mini — Remote Agent Execution & macOS Automation

Ekus can dispatch agent jobs and automation tasks to a Mac Mini over the network.
The Mac Mini runs a **Gateway server** that accepts HTTP requests to:

1. **Run Claude Code agents** — spawn autonomous agents in tmux sessions
2. **GUI automation (steer)** — screenshots, OCR, click, type, hotkey, window management
3. **Terminal automation (drive)** — create tmux sessions, run commands, read output, parallel execution

## Architecture

```
MacBook Pro (you)                    Mac Mini (agent sandbox)
  ekus/scripts/mac-mini.sh   --->   ekus/mac-mini/gateway (port 7600)
  curl / Python client       --->     |-- worker.py (spawns claude agents)
                                      |-- steer (Swift CLI, GUI control)
                                      |-- drive (Python CLI, tmux control)
```

## Connection

- **Mac Mini IP**: `100.90.155.85` (Tailscale: `goncalos-mac-mini-1`)
- **SSH**: `ssh ggomes@100.90.155.85` (key-based auth)
- **Gateway**: `http://100.90.155.85:7600`
- **Password**: same as MacBook Pro (ggomes / 2WS4rf3ed!!!)

## Quick Reference

### Management Script

```bash
./scripts/mac-mini.sh status          # Check gateway health
./scripts/mac-mini.sh start           # Start gateway on Mac Mini
./scripts/mac-mini.sh stop            # Stop gateway
./scripts/mac-mini.sh restart         # Restart gateway
./scripts/mac-mini.sh deploy          # Rsync ekus to Mac Mini
./scripts/mac-mini.sh ssh [cmd]       # SSH into Mac Mini
./scripts/mac-mini.sh send "prompt"   # Send a job
./scripts/mac-mini.sh jobs            # List jobs
./scripts/mac-mini.sh job <id>        # Job details
./scripts/mac-mini.sh stop-job <id>   # Stop a job
./scripts/mac-mini.sh logs            # Gateway logs
```

### Gateway API

```bash
MAC_MINI="http://100.90.155.85:7600"

# Health check
curl -s "$MAC_MINI/health"

# Start a job (spawns Claude Code agent)
curl -s -X POST "$MAC_MINI/job" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Open Safari and search for the latest news"}'

# Check job status
curl -s "$MAC_MINI/job/<job_id>"

# List all jobs
curl -s "$MAC_MINI/jobs"

# Stop a job
curl -s -X DELETE "$MAC_MINI/job/<job_id>"

# GUI automation (steer)
curl -s -X POST "$MAC_MINI/automation/steer" \
  -H "Content-Type: application/json" \
  -d '{"action": "see", "kwargs": {"app": "Safari"}}'

# Terminal automation (drive)
curl -s -X POST "$MAC_MINI/automation/drive" \
  -H "Content-Type: application/json" \
  -d '{"action": "session", "args": ["create", "--name", "test", "--detach"]}'
```

### Python Client

```python
from mac_mini.client.gateway import GatewayClient

gw = GatewayClient()  # Uses MAC_MINI_GATEWAY_URL env var or default IP

# Start an agent job
job = gw.start_job("Open Safari and navigate to github.com")
print(job)  # {"job_id": "abc123", "status": "running"}

# Check status
print(gw.get_job(job["job_id"]))

# GUI automation
result = gw.steer("see", kwargs={"app": "Safari"})
result = gw.steer("click", kwargs={"text": "Submit"})
result = gw.steer("ocr", kwargs={"app": "VS Code", "store": True})

# Terminal automation
result = gw.drive("session", args=["create", "--name", "dev", "--detach"])
result = gw.drive("run", args=["dev", "npm test"])
result = gw.drive("logs", args=["dev"])
```

## Steer Commands (GUI Automation)

The steer binary (`apps/steer/.build/release/steer`) provides macOS GUI control:

| Command     | Purpose                                        |
|-------------|------------------------------------------------|
| `see`       | Screenshot + accessibility tree                |
| `click`     | Click by element ID, label, or coordinates     |
| `type`      | Type text into focused element                 |
| `hotkey`    | Keyboard shortcuts (cmd+s, return, etc.)       |
| `scroll`    | Scroll in any direction                        |
| `drag`      | Drag between elements/coordinates              |
| `apps`      | List running applications                      |
| `screens`   | List displays with resolution                  |
| `window`    | Move, resize, manage windows                   |
| `ocr`       | Extract text from screen via Vision OCR        |
| `focus`     | Get currently focused element                  |
| `find`      | Search UI elements by text                     |
| `clipboard` | Read/write system clipboard                    |
| `wait`      | Wait for app launch or element to appear       |

Always use `--json` for structured output.
For Electron apps (VS Code, Slack), use `ocr --store` since their accessibility trees are empty.

## Drive Commands (Terminal Automation)

The drive CLI provides programmatic tmux control:

| Command   | Purpose                                    |
|-----------|--------------------------------------------|
| `session` | Create, list, kill tmux sessions           |
| `run`     | Execute command and wait for completion     |
| `send`    | Send raw keystrokes (for interactive tools) |
| `logs`    | Capture pane output                        |
| `poll`    | Wait for pattern in output                 |
| `fanout`  | Parallel execution across sessions         |
| `proc`    | Process management (list, kill, tree)      |

### Sentinel Pattern

Drive uses `__DONE_<token>:<exit_code>` markers to reliably detect command completion in tmux.

## Deployment Workflow

1. Make changes to ekus locally
2. Deploy: `./scripts/mac-mini.sh deploy`
3. Restart gateway: `./scripts/mac-mini.sh restart`
4. Test: `./scripts/mac-mini.sh status`

## Troubleshooting

- **Gateway not responding**: Check `./scripts/mac-mini.sh logs` and restart
- **SSH fails**: Verify Tailscale is running (`tailscale status`)
- **steer permission errors**: Grant Terminal Accessibility/Screen Recording in System Settings
- **tmux issues**: `./scripts/mac-mini.sh ssh "tmux list-sessions"` to debug
- **Claude not found**: `./scripts/mac-mini.sh ssh "which claude"` (needs /opt/homebrew/bin in PATH)
