# Ekus 🦎

A personal AI assistant powered by [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

Ekus turns Claude Code into a capable personal assistant with browser control, email, calendar, task management, and more — all through Claude Code's native features (skills, hooks, memory, agent teams).

## Quick Start

1. **Clone this repo**
   ```bash
   git clone https://github.com/gongiskhan/ekus.git
   cd ekus
   ```

2. **Set up secrets**
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

3. **Configure Trello** (optional)
   ```bash
   # Edit config/trello.json with your board/list IDs
   ```

4. **Configure MCP servers** (in Claude Code settings)
   - Gmail MCP for email access
   - Google Calendar MCP for calendar
   - Claude for Chrome for browser control

5. **Run Claude Code**
   ```bash
   claude
   ```

That's it. Claude reads `CLAUDE.md` automatically and knows how to use all the skills.

## Features

| Feature | How | Skill |
|---------|-----|-------|
| 🌐 Browser | Claude for Chrome / agent-browser | `.claude/skills/browser/` |
| 📧 Email | Gmail MCP | `.claude/skills/email/` |
| 📅 Calendar | Google Calendar MCP | `.claude/skills/calendar/` |
| 📋 Tasks | Trello REST API | `.claude/skills/trello/` |
| 🔍 Search | Brave API / Browser | `.claude/skills/search/` |
| 🎙️ Voice | ElevenLabs API | `.claude/skills/voice/` |
| ⏰ Reminders | Calendar + Trello + local | `.claude/skills/reminders/` |
| 🧠 Memory | Claude Code `/memory` | Built-in |

## Architecture

```
ekus/
├── CLAUDE.md              # Main instructions (Claude reads this automatically)
├── .claude/
│   ├── settings.json      # Permissions
│   └── skills/            # Skill definitions
│       ├── browser/
│       ├── email/
│       ├── calendar/
│       ├── trello/
│       ├── search/
│       ├── voice/
│       └── reminders/
├── config/
│   └── trello.json        # Trello board/list IDs
├── memory/
│   └── reminders.md       # Local reminder backup
├── .env.example           # Template for secrets
├── .env                   # Your secrets (gitignored)
└── .gitignore
```

## Philosophy

- **Skills over code** — teach Claude what to do via markdown, not scripts
- **Agent teams** — complex tasks are broken into subagent work units
- **Belt and suspenders** — reminders go to calendar AND Trello AND local file
- **Fail gracefully** — if Chrome extension is down, fall back to agent-browser
- **Never commit secrets** — everything sensitive lives in `.env`

## Customization

- Edit `CLAUDE.md` to change personality and behavior
- Add skills in `.claude/skills/` for new capabilities
- Use Claude Code's `/memory` to teach it your preferences over time
- Add new integrations as MCP servers

## Credits

Built by [Gonçalo Gomes](https://github.com/gongiskhan).
Inspired by [OpenClaw](https://github.com/openclaw/openclaw) — Ekus's bigger, always-on sibling.
