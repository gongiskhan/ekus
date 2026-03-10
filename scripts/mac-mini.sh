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

set -euo pipefail

MAC_MINI_HOST="${MAC_MINI_HOST:-100.90.155.85}"
MAC_MINI_USER="${MAC_MINI_USER:-ggomes}"
GATEWAY_PORT="${GATEWAY_PORT:-7600}"
GATEWAY_URL="http://${MAC_MINI_HOST}:${GATEWAY_PORT}"
REMOTE_EKUS_DIR="/Users/${MAC_MINI_USER}/Projects/ekus"

ssh_cmd() {
    ssh -o ConnectTimeout=5 -o ServerAliveInterval=15 "${MAC_MINI_USER}@${MAC_MINI_HOST}" "$@"
}

case "${1:-help}" in
    status)
        echo "Checking Mac Mini gateway at ${GATEWAY_URL}..."
        if curl -s --max-time 5 "${GATEWAY_URL}/health" 2>/dev/null; then
            echo ""
            echo "Gateway is running."
            echo ""
            echo "Jobs:"
            curl -s "${GATEWAY_URL}/jobs"
        else
            echo "Gateway is NOT running."
            echo ""
            echo "Checking SSH connectivity..."
            if ssh_cmd "echo SSH_OK" 2>/dev/null; then
                echo "SSH works. Start the gateway with: ./scripts/mac-mini.sh start"
            else
                echo "SSH failed. Is the Mac Mini online?"
            fi
        fi
        ;;

    start)
        echo "Starting gateway on Mac Mini..."
        ssh_cmd "
            export PATH=/opt/homebrew/bin:\$PATH
            # Kill any existing gateway
            lsof -ti:${GATEWAY_PORT} | xargs kill -9 2>/dev/null || true
            sleep 1
            # Start gateway
            cd ${REMOTE_EKUS_DIR}/mac-mini/gateway
            nohup uv run python main.py > /tmp/ekus-gateway.log 2>&1 &
            echo \"Gateway PID: \$!\"
            sleep 2
            curl -s http://localhost:${GATEWAY_PORT}/health
        "
        echo ""
        echo "Gateway started at ${GATEWAY_URL}"
        ;;

    stop)
        echo "Stopping gateway on Mac Mini..."
        ssh_cmd "lsof -ti:${GATEWAY_PORT} | xargs kill -9 2>/dev/null || true"
        echo "Gateway stopped."
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
        rsync -avz --delete \
            --exclude 'node_modules' \
            --exclude '.DS_Store' \
            --exclude 'dashboard/node_modules' \
            --exclude 'faturas/' \
            --exclude '.env' \
            --exclude 'mac-mini/gateway/jobs/' \
            /Users/ggomes/ekus/ "${MAC_MINI_USER}@${MAC_MINI_HOST}:${REMOTE_EKUS_DIR}/" \
            | tail -5
        echo "Deploy complete."
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
        ;;
esac
