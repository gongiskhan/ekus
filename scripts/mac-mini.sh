#!/bin/bash
# Mac Mini management script for Ekus
# Usage:
#   ./scripts/mac-mini.sh status          — Check if gateway is running
#   ./scripts/mac-mini.sh start           — Start the gateway server
#   ./scripts/mac-mini.sh stop            — Stop the gateway server
#   ./scripts/mac-mini.sh restart         — Restart the gateway server
#   ./scripts/mac-mini.sh ssh [cmd]       — SSH into Mac Mini (optionally run a command)
#   ./scripts/mac-mini.sh deploy          — Rsync ekus to Mac Mini
#   ./scripts/mac-mini.sh send "prompt"   — Send a job to the gateway
#   ./scripts/mac-mini.sh jobs            — List all jobs
#   ./scripts/mac-mini.sh job <id>        — Get job details
#   ./scripts/mac-mini.sh stop-job <id>   — Stop a running job
#   ./scripts/mac-mini.sh logs            — Show gateway logs
#   ./scripts/mac-mini.sh channel-start   — Start Claude with channel
#   ./scripts/mac-mini.sh channel-stop    — Stop Claude channel session
#   ./scripts/mac-mini.sh channel-status  — Check channel status

set -euo pipefail

MAC_MINI_HOST="${MAC_MINI_HOST:-100.90.155.85}"
MAC_MINI_USER="${MAC_MINI_USER:-ggomes}"
GATEWAY_PORT="${GATEWAY_PORT:-7600}"
TERMINAL_PORT="${TERMINAL_PORT:-7601}"
GATEWAY_URL="http://${MAC_MINI_HOST}:${GATEWAY_PORT}"
TERMINAL_URL="http://${MAC_MINI_HOST}:${TERMINAL_PORT}"
REMOTE_EKUS_DIR="/Users/${MAC_MINI_USER}/Projects/ekus"

ssh_cmd() {
    ssh -o ConnectTimeout=5 -o ServerAliveInterval=15 -o IdentityFile=~/.ssh/id_ed25519 -o IdentitiesOnly=yes "${MAC_MINI_USER}@${MAC_MINI_HOST}" "$@"
}

case "${1:-help}" in
    status)
        echo "Checking Mac Mini services..."
        echo ""
        echo "Gateway (${GATEWAY_URL}):"
        if curl -s --max-time 5 "${GATEWAY_URL}/health" 2>/dev/null; then
            echo ""
        else
            echo "  NOT running."
        fi
        echo ""
        echo "Terminal (${TERMINAL_URL}):"
        if curl -s --max-time 5 "${TERMINAL_URL}/health" 2>/dev/null; then
            echo ""
        else
            echo "  NOT running."
        fi
        echo ""
        if ! curl -s --max-time 5 "${GATEWAY_URL}/health" >/dev/null 2>&1; then
            echo "Checking SSH connectivity..."
            if ssh_cmd "echo SSH_OK" 2>/dev/null; then
                echo "SSH works. Start services with: ./scripts/mac-mini.sh start"
            else
                echo "SSH failed. Is the Mac Mini online?"
            fi
        fi
        ;;

    start)
        echo "Starting services on Mac Mini..."
        ssh_cmd "
            export PATH=/opt/homebrew/bin:\$PATH

            # Kill any existing processes
            lsof -ti:${GATEWAY_PORT} | xargs kill -9 2>/dev/null || true
            lsof -ti:${TERMINAL_PORT} | xargs kill -9 2>/dev/null || true
            sleep 1

            # Install terminal server deps if needed
            cd ${REMOTE_EKUS_DIR}/mac-mini/terminal
            if [ ! -d node_modules ]; then
                echo 'Installing terminal server dependencies...'
                npm install 2>&1 | tail -3
            fi

            # Start terminal server
            nohup node server.js > /tmp/ekus-terminal.log 2>&1 &
            echo \"Terminal PID: \$!\"

            # Start gateway
            cd ${REMOTE_EKUS_DIR}/mac-mini/gateway
            nohup uv run python main.py > /tmp/ekus-gateway.log 2>&1 &
            echo \"Gateway PID: \$!\"

            sleep 2
            echo 'Gateway:'
            curl -s http://localhost:${GATEWAY_PORT}/health 2>/dev/null || echo 'NOT RUNNING'
            echo ''
            echo 'Terminal:'
            curl -s http://localhost:${TERMINAL_PORT}/health 2>/dev/null || echo 'NOT RUNNING'
        "
        echo ""
        echo "Gateway: ${GATEWAY_URL}"
        echo "Terminal: ${TERMINAL_URL}"
        ;;

    stop)
        echo "Stopping services on Mac Mini..."
        ssh_cmd "
            lsof -ti:${GATEWAY_PORT} | xargs kill -9 2>/dev/null || true
            lsof -ti:${TERMINAL_PORT} | xargs kill -9 2>/dev/null || true
        "
        echo "Services stopped."
        ;;

    restart)
        "$0" stop
        sleep 1
        "$0" start
        ;;

    ssh)
        shift
        if [ $# -gt 0 ]; then
            ssh_cmd "export PATH=/opt/homebrew/bin:\$PATH && $*"
        else
            ssh -t "${MAC_MINI_USER}@${MAC_MINI_HOST}"
        fi
        ;;

    deploy)
        echo "Deploying ekus to Mac Mini..."
        EKUS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
        # Build Next.js app if ekus-app/ exists
        if [ -d "${EKUS_DIR}/ekus-app" ]; then
            echo "Building Next.js app..."
            (cd "${EKUS_DIR}/ekus-app" && npm run build 2>&1 | tail -5)
            echo "Copying static export to gateway..."
            rm -rf "${EKUS_DIR}/mac-mini/gateway/static"
            cp -r "${EKUS_DIR}/ekus-app/out" "${EKUS_DIR}/mac-mini/gateway/static"
        fi
        rsync -avzL --delete \
            -e "ssh -o IdentityFile=~/.ssh/id_ed25519 -o IdentitiesOnly=yes" \
            --exclude 'node_modules' \
            --exclude '.DS_Store' \
            --exclude 'dashboard/node_modules' \
            --exclude 'ekus-app/node_modules' \
            --exclude 'ekus-app/.next' \
            --exclude 'ekus-app/out' \
            --exclude 'faturas/' \
            --exclude '.env' \
            --exclude 'obsidian-vault/' \
            --exclude 'mac-mini/gateway/jobs/' \
            --exclude 'mac-mini/terminal/node_modules' \
            --exclude 'mac-mini/channel/node_modules' \
            "${EKUS_DIR}/" "${MAC_MINI_USER}@${MAC_MINI_HOST}:${REMOTE_EKUS_DIR}/" \
            | tail -5
        echo "Deploy complete. Restarting services..."
        ssh_cmd "
            export PATH=/opt/homebrew/bin:\$PATH

            # Stop existing services
            lsof -ti:${GATEWAY_PORT} | xargs kill -9 2>/dev/null || true
            lsof -ti:${TERMINAL_PORT} | xargs kill -9 2>/dev/null || true
            lsof -ti:7443 | xargs kill -9 2>/dev/null || true
            sleep 1

            # Install terminal server deps
            cd ${REMOTE_EKUS_DIR}/mac-mini/terminal && npm install --production 2>&1 | tail -3

            # Start terminal server
            nohup node server.js > /tmp/ekus-terminal.log 2>&1 &

            # Start gateway (serves HTTP on 7600 + HTTPS on 7443 if certs exist)
            cd ${REMOTE_EKUS_DIR}/mac-mini/gateway
            nohup uv run python main.py > /tmp/ekus-gateway.log 2>&1 &
        "
        sleep 2
        echo "Services restarted."
        ;;

    send)
        shift
        PROMPT="$*"
        if [ -z "$PROMPT" ]; then
            echo "Usage: $0 send \"your prompt here\""
            exit 1
        fi
        echo "Sending job to Mac Mini..."
        curl -s -X POST "${GATEWAY_URL}/job" \
            -H "Content-Type: application/json" \
            -d "{\"prompt\": $(echo "$PROMPT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))')}"
        echo ""
        ;;

    jobs)
        curl -s "${GATEWAY_URL}/jobs"
        ;;

    job)
        if [ -z "${2:-}" ]; then
            echo "Usage: $0 job <job_id>"
            exit 1
        fi
        curl -s "${GATEWAY_URL}/job/$2"
        ;;

    stop-job)
        if [ -z "${2:-}" ]; then
            echo "Usage: $0 stop-job <job_id>"
            exit 1
        fi
        curl -s -X DELETE "${GATEWAY_URL}/job/$2"
        echo ""
        ;;

    logs)
        ssh_cmd "cat /tmp/ekus-gateway.log 2>/dev/null | tail -50"
        ;;

    channel-start)
        echo "Starting Claude Code with channel on Mac Mini..."
        ssh_cmd "
            export PATH=/opt/homebrew/bin:\$HOME/.local/bin:\$HOME/.bun/bin:\$PATH
            cd ${REMOTE_EKUS_DIR}

            # Install channel deps if needed
            if [ ! -d mac-mini/channel/node_modules ]; then
                echo 'Installing channel dependencies...'
                cd mac-mini/channel && bun install 2>&1 | tail -3 && cd ${REMOTE_EKUS_DIR}
            fi

            # Ensure Keychain doesn't trap credentials (SSH can't read Keychain)
            security delete-generic-password -s 'Claude Code-credentials' 2>/dev/null || true

            # Kill existing session + any stale Terminal windows attached to it
            pgrep -f 'tmux attach -t ekus-claude' | xargs kill 2>/dev/null || true
            tmux kill-session -t ekus-claude 2>/dev/null || true

            # Start Claude with channel in tmux
            tmux new-session -d -s ekus-claude \
                \"export PATH=/opt/homebrew/bin:\\\$HOME/.local/bin:\\\$HOME/.bun/bin:\\\$PATH; \
                 cd ${REMOTE_EKUS_DIR} && \
                 set -a && source .env 2>/dev/null && set +a; \
                 exec claude --dangerously-load-development-channels server:ekus-channel \
                        --dangerously-skip-permissions\"

            sleep 3
            if tmux has-session -t ekus-claude 2>/dev/null; then
                echo 'Channel session started.'
                # Auto-confirm the development channels safety prompt
                sleep 2
                tmux send-keys -t ekus-claude Enter 2>/dev/null || true
                # If Keychain has credentials but files don't, extract them
                if [ ! -f \$HOME/.claude/.credentials.json ]; then
                    TMPF=\$(mktemp)
                    osascript -e 'tell application \"Terminal\"
                        do script \"security find-generic-password -s \\\\\"Claude Code-credentials\\\\\" -a \\\\\"ggomes\\\\\" -w > /tmp/kc-extract.txt 2>&1\"
                    end tell' 2>/dev/null || true
                    sleep 3
                    if [ -s /tmp/kc-extract.txt ] && python3 -c \"import json; json.load(open('/tmp/kc-extract.txt'))\" 2>/dev/null; then
                        cp /tmp/kc-extract.txt \$HOME/.claude/.credentials.json
                        cp /tmp/kc-extract.txt \$HOME/.claude/credentials.json
                        chmod 600 \$HOME/.claude/.credentials.json \$HOME/.claude/credentials.json
                        echo 'Extracted Keychain credentials to files.'
                    fi
                    rm -f /tmp/kc-extract.txt \$TMPF
                fi
                # Open a visible Terminal window attached to the tmux session
                osascript -e 'tell application \"Terminal\"
                    activate
                    do script \"tmux attach -t ekus-claude\"
                end tell' 2>/dev/null || true
            else
                echo 'Failed to start channel session.'
                exit 1
            fi
        "
        echo "Channel session started (visible on Mac Mini)."
        ;;

    channel-stop)
        echo "Stopping Claude channel session..."
        ssh_cmd "
            export PATH=/opt/homebrew/bin:\$PATH
            # Kill processes attached to the tmux session (Terminal windows)
            pgrep -f 'tmux attach -t ekus-claude' | xargs kill 2>/dev/null || true
            # Kill the tmux session itself
            tmux kill-session -t ekus-claude 2>/dev/null || true
        "
        echo "Channel session stopped."
        ;;

    channel-status)
        echo "Channel server:"
        if curl -s --max-time 3 "http://${MAC_MINI_HOST}:8788/health" 2>/dev/null; then
            echo ""
        else
            echo "  NOT running."
        fi
        echo ""
        echo "Channel status via gateway:"
        curl -s --max-time 5 "${GATEWAY_URL}/api/channel/status" 2>/dev/null || echo "  Gateway not reachable."
        echo ""
        echo "Tmux session:"
        ssh_cmd "tmux has-session -t ekus-claude 2>/dev/null && echo '  ekus-claude: ACTIVE' || echo '  ekus-claude: NOT FOUND'"
        ;;

    *)
        echo "Ekus Mac Mini Manager"
        echo ""
        echo "Usage: $0 <command>"
        echo ""
        echo "Commands:"
        echo "  status          Check if gateway is running"
        echo "  start           Start the gateway server"
        echo "  stop            Stop the gateway server"
        echo "  restart         Restart the gateway server"
        echo "  ssh [cmd]       SSH into Mac Mini"
        echo "  deploy          Rsync ekus to Mac Mini"
        echo "  send \"prompt\"   Send a job to the gateway"
        echo "  jobs            List all jobs"
        echo "  job <id>        Get job details"
        echo "  stop-job <id>   Stop a running job"
        echo "  logs            Show gateway logs"
        echo "  channel-start   Start Claude with channel"
        echo "  channel-stop    Stop Claude channel session"
        echo "  channel-status  Check channel status"
        ;;
esac
