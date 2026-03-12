# Ekus Dashboard Migration — Status & Continuation Guide

## What Was Done

Migrated the Ekus gateway from two vanilla HTML files (`chat.html` + `dashboard.html`) to a unified Next.js static export app (`ekus-app/`) with 4 tabs: Chat, Tasks, Scheduler, Memory.

### Backend Changes (`mac-mini/gateway/`)

**`main.py`** (v0.3.0):
- Added SSE streaming endpoint: `GET /api/job/{id}/stream?offset=0`
- Added full output endpoint: `GET /api/job/{id}/output`
- Added file upload: `POST /api/upload`, `GET /api/uploads/{path}`
- Added multipart job creation: `POST /api/job/with-files`
- Added scheduler CRUD: `GET/POST/PUT/DELETE /api/scheduler/jobs`, `POST .../run`, `GET .../logs`
- Removed old `chat_ui()` and `dashboard_ui()` HTML route handlers
- Mounted `StaticFiles(directory="static", html=True)` at `/` for the Next.js app

**`worker.py`**:
- Changed `POLL_INTERVAL` from 2.0 to 0.5
- Captures full tmux scrollback (`-S -` instead of `-S -500`)
- Sets `history-limit 50000` on tmux sessions
- Reads prompt from YAML `full_prompt` field instead of sys.argv
- Writes incremental output to `jobs/{job_id}.log` for SSE streaming
- Filters output: captures baseline line count after command echo, skips sentinel markers and shell prompt lines

**`pyproject.toml`**: Added `python-multipart` dependency.

### Frontend (`ekus-app/`)

Next.js 15 static export app with Tailwind CSS v4, Framer Motion, SWR, Zustand.

**Key files:**
- `src/app/page.tsx` — App shell with tab switching
- `src/app/globals.css` — Tailwind imports + CSS custom properties (Ekus green theme)
- `src/lib/api.ts` — Typed API client for all endpoints
- `src/lib/store.ts` — Zustand store (active tab)
- `src/lib/types.ts` — TypeScript interfaces
- `src/components/` — Shared UI: glass-card, glass-panel, bottom-nav, status-badge, markdown-renderer, modal, pull-to-refresh
- `src/features/chat/` — Chat tab: chat-tab, chat-input, chat-message, use-job-stream (SSE hook)
- `src/features/tasks/` — Tasks kanban: tasks-tab, task-card, task-utils (markdown parser)
- `src/features/scheduler/` — Scheduler CRUD: scheduler-tab, job-row, cron-utils
- `src/features/memory/` — Memory viewer/editor: memory-tab

**Build & deploy:**
```bash
cd ekus-app && npm run build   # Static export to out/
cp -r out/* ../mac-mini/gateway/static/
# Then rsync mac-mini/ to Mac Mini and restart gateway
# Or just: ./scripts/mac-mini.sh deploy
```

### Other Changes
- `scripts/mac-mini.sh deploy` — Updated to build Next.js, copy to static/, rsync, restart
- `config/jobs.json` — Dashboard link changed from `/dashboard` to `/`

---

## What's Working

- **Chat tab**: Send prompts, jobs created, history displayed
- **Tasks tab**: Kanban board with 3 columns (Active, Waiting On, Done), arrow buttons move cards between columns, checkbox toggle, delete with confirmation
- **Scheduler tab**: Lists all jobs from config/jobs.json, toggle enable/disable, run now, add new job modal
- **Memory tab**: File tabs (lessons-learned.md, workflows.md, reminders.md), markdown preview, edit modal
- **OAuth**: Refreshed Mac Mini Claude Code token (manual PKCE flow) — working as of 2026-03-11

---

## What Still Needs Work

### 1. SSE Streaming Display (Partially Fixed)

**What was done:**
- Fixed field name mismatch: frontend was reading `data.text` but backend sends `data.content`. Fixed in `use-job-stream.ts` line 48.
- Fixed offset tracking: now uses `data.offset` from backend instead of `text.length`.

**What still needs verification:**
- The streaming output should now show only Claude's response (no shell commands, no sentinel). The worker now uses a baseline approach: captures tmux line count 1.5s after sending the command, only logs lines beyond that baseline.
- The shell prompt line (`ggomes@host dir %`) is also filtered via regex `r"^\S+@\S+\s+\S+\s*(%|\$)\s*$"`.
- **TEST THIS**: Send a new prompt from the chat UI and verify streaming shows clean output progressively.

### 2. Trailing Empty Lines / Whitespace in Output

The tmux capture may include trailing blank lines. Consider trimming the log output or stripping trailing whitespace in the `/api/job/{id}/output` endpoint.

### 3. Chat UX Polish

- No way to cancel a running job from the UI
- No retry button for failed jobs
- The chat doesn't show any status text during the 1.5s baseline wait (user sees nothing happening)
- Consider adding a "thinking..." indicator immediately when a job starts, before streaming begins

### 4. File Attachments (Not Tested)

The backend supports `POST /api/job/with-files` and `POST /api/upload`, and the chat-input has attachment buttons, but this hasn't been tested end-to-end. Camera capture may not work over HTTP (non-HTTPS) on iOS.

### 5. PWA (Phase 7 — Not Started)

- `manifest.json` exists with `share_target` but no service worker
- Apple meta tags are in the layout but no offline caching
- PWA "Add to Home Screen" hasn't been tested

### 6. Mobile Testing

The app was built mobile-first but only tested on desktop Chrome. Need to verify:
- Touch interactions (task card buttons, pull-to-refresh)
- Safe area handling (bottom nav over iPhone home bar)
- Responsive layout on small screens
- Camera/photo upload from iPhone

---

## Key Technical Gotchas (from lessons-learned.md)

1. **Tailwind v4 + Next.js**: Must use `postcss.config.mjs` (NOT `.ts`). Also need `@source "../../src"` in globals.css.
2. **SWR fallbackData**: Don't use `fallbackData: []` — it can prevent re-rendering with real data. Use `data?.field ?? []` instead.
3. **Memory API**: Returns `{ filename: content }` dict, not array. Parse with `Object.keys()`.
4. **Framer Motion drag**: `drag="x"` on containers blocks child button clicks. Removed from task cards — arrow buttons work fine without it.
5. **Worker output**: Baseline approach (1.5s delay + line count) filters command echo. Shell prompt regex filters the trailing prompt. Sentinel prefix filters the marker.
6. **SSE fields**: Backend sends `content`, not `text`. Frontend must match exactly.

---

## Architecture

```
Browser (Tailscale) → Mac Mini :7600 (FastAPI)
  ├── /api/*              → Python API (jobs, tasks, memory, scheduler, uploads)
  ├── /api/job/{id}/stream → SSE streaming
  └── /*                  → Next.js static export (StaticFiles mount)

ekus-app/out/ → mac-mini/gateway/static/  (copied at deploy time)
```

The Next.js app is a pure static export — no SSR, no API routes, no server components at runtime. All API calls go to the same origin (FastAPI gateway).
