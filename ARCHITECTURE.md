# Telaude Architecture

Telegram Claude Code Bridge — a bot that remotely controls the Claude Code CLI from Telegram.

## Tech Stack

- **Runtime**: Node.js + TypeScript (ESM)
- **Bot Framework**: grammY + @grammyjs/auto-retry
- **Database**: better-sqlite3 (WAL mode)
- **Auth**: bcrypt (password hashing) + OS-native encryption (Windows DPAPI / macOS Keychain / Linux)
- **Logging**: pino
- **CLI**: Claude Code (`claude -p --output-format stream-json --verbose`)
- **MCP**: Built-in MCP server (stdio) + internal HTTP API for external MCP integration

## Directory Structure

```
src/
├── index.ts              # Entry point (.env check → setup or bot start)
├── setup.ts              # First-run interactive setup wizard
├── config.ts             # Env → Config (Proxy lazy-load)
│
├── claude/               # Claude CLI process management
│   ├── process-manager.ts  # spawn/kill/send, UserProcess state, queue
│   ├── stream-parser.ts    # NDJSON stdout → EventEmitter
│   ├── stream-handler.ts   # Parser events → Telegram messages (tool display + text streaming)
│   ├── tool-formatter.ts   # Tool call HTML formatting (superscript counters, agent pinning)
│   └── cost-tracker.ts     # Cost/turn DB updates
│
├── bot/                  # grammY bot
│   ├── bot.ts              # Bot instance + middleware/handler registration
│   ├── commands/           # Slash command handlers
│   │   ├── index.ts          # registerCommands (all commands)
│   │   ├── start.ts          # /start
│   │   ├── auth.ts           # /auth <password>
│   │   ├── help.ts           # /help
│   │   ├── session.ts        # /resume, /new, /rename, buildSessionList
│   │   ├── cd.ts             # /cd, /pwd, /projects
│   │   ├── model.ts          # /model
│   │   ├── budget.ts         # /budget
│   │   ├── stop.ts           # /stop, /stop <text>
│   │   ├── status.ts         # /stats
│   │   └── compact.ts        # /compact [instructions]
│   ├── handlers/
│   │   ├── message.ts        # Text/media → Claude process (session restore, queue, link preview)
│   │   ├── callback.ts       # Inline keyboard callbacks (resume, delete, browse CLI sessions)
│   │   ├── reaction.ts       # Emoji reaction handling (user↔bot)
│   │   ├── forward-collector.ts  # Batches forwarded messages into single stdin
│   │   ├── media-group-collector.ts # Batches media groups (albums) into single stdin
│   │   └── media-types.ts    # MediaInfo extraction, labels, buildMediaText
│   └── middleware/
│       └── auth.ts           # Auth check + public commands bypass
│
├── api/                  # Internal HTTP API (for external MCP servers)
│   ├── internal-server.ts  # Express-like HTTP server on 127.0.0.1
│   ├── route-handlers.ts   # /mcp/* routes (send-photo, send-file, ask, pin, etc.)
│   ├── ask-queue.ts        # Ask tool queue (inline keyboard → response promise)
│   └── tool-display-store.ts # Tool icon/hidden settings (hot-reload, mtime check)
│
├── mcp-server/           # Built-in MCP server (stdio, registered via --mcp-config)
│   ├── index.ts            # MCP server setup + tool registration
│   ├── http-client.ts      # HTTP client for internal API calls
│   └── tools/
│       ├── communication.ts  # send_file, send_photo, send_sticker, ask, pin/unpin, set_reaction, zip_and_send
│       ├── scheduling.ts     # schedule_add/list/update/remove/pause/resume/history/completed/nothing_to_report
│       ├── poke.ts           # poke_ok
│       └── system.ts         # get_system_info, reload
│
├── scheduler/            # Cron & one-shot job scheduling
│   ├── scheduler.ts        # Job runner (node-cron + one-shot timers)
│   ├── cron-store.ts       # Job persistence (JSON file)
│   ├── heartbeat.ts        # HEARTBEAT.md-based health check
│   ├── poke.ts             # Proactive follow-up timer (stdin injection)
│   └── turn-deleter.ts     # Auto-delete tool messages after N turns
│
├── settings/             # TUI settings panel
│   ├── settings-store.ts   # Load/save settings JSON (~/.telaude/data/settings.json)
│   └── settings-tui.ts     # Blessed overlay (keyboard-only, scroll, toggle tools/MCPs/model)
│
├── db/                   # SQLite database
│   ├── database.ts         # DB init + migrations (unique indexes, column additions)
│   ├── auth-repo.ts        # auth_tokens table
│   ├── session-repo.ts     # sessions table (upsert, session_name, deduplication)
│   ├── config-repo.ts      # user_configs table
│   └── message-log-repo.ts # Message logging
│
└── utils/
    ├── logger.ts             # pino logger (file + optional console)
    ├── dashboard.ts          # Blessed TUI dashboard (banner, session, schedule, logs, status bar)
    ├── link-preview.ts       # URL → context injection (X/fxtwitter, YouTube/noembed, OG meta tags)
    ├── cli-sessions.ts       # Read/write Claude Code JSONL sessions (customTitle, slug)
    ├── file-downloader.ts    # Telegram file download → user_send/ with project-relative paths
    ├── sticker-cache.ts      # Sticker → JPG thumbnail cache
    ├── markdown-to-html.ts   # Markdown → Telegram HTML conversion
    ├── message-splitter.ts   # 4000-char message splitting (code block > paragraph > line)
    ├── path-validator.ts     # Working directory validation + fallback chain
    └── machine-lock.ts       # Single-instance lock (prevents duplicate bots)
```

## Core Flow

### First Run (Setup Wizard)

```
npm run dev
  → .env not found
  → runSetup()
    1. claude auth status → check CLI auth
    2. Telegram bot token input
    3. AUTH password setup
    4. Optional settings (model, working dir, etc.)
    5. .env generated (OS-native encrypted)
  → Bot starts
```

### Message Processing (Per-message Process Spawning)

```
User text message
  → messageHandler
  → Get/create UserProcess (restore last session from DB)
  → Link preview: fetch URL context (X/YouTube/OG) → prepend to stdin
  → spawnClaudeProcess (claude -p --resume <sessionId>)
  → stdin.write(text) + stdin.end()
  → StreamParser: parse stdout NDJSON lines
  → StreamHandler: stream to Telegram
    - tool_use → single message, edit animation (1s throttle, superscript counters)
    - text start → delete tool message
    - text → separate message, streaming edits (500ms / 200 char intervals)
    - result → cost summary
  → Process exits
```

### Claude CLI Interface

```bash
claude --verbose \
       --output-format stream-json \
       --dangerously-skip-permissions \
       --model <model> \
       --max-turns <turns> \
       --resume <sessionId> \
       --mcp-config <path>   # Telaude MCP + external MCPs with injected env
       -p                    # Read prompt from stdin
```

- **Input**: Plain text via stdin → stdin.end()
- **Output**: NDJSON (one JSON event per line)
- **Env cleanup**: Remove `CLAUDECODE`, `CLAUDE_CODE*`, `ANTHROPIC_API_KEY` (prevent nesting)

### Stream Event Format

```
system   → { type: "system", subtype: "init", session_id: "..." }
assistant → { type: "assistant", message: { content: [{type:"text",...}, {type:"tool_use",...}] } }
result   → { type: "result", cost_usd, total_cost_usd, num_turns, duration_ms, session_id }
```

### Telegram Display Strategy

1. **Tool calls**: Single message with edit animation (1s throttle)
   - Superscript counters: `🔍² Grep` (first tool has no superscript)
   - Agent (subagent) tools pinned at top, regular tools at bottom
2. **Text response**: Tool message deleted → separate message with streaming edits
3. **Message splitting**: Auto-split at 4000 chars (code block > paragraph > line boundaries)
4. **HTML parse failure**: Plain text fallback
5. **Compacting animation**: 2s interval

## Database Schema

```sql
-- User authentication
auth_tokens (
  telegram_user_id INTEGER PRIMARY KEY,
  username TEXT,
  auth_token_hash TEXT NOT NULL,  -- bcrypt hash
  is_authorized INTEGER DEFAULT 0,
  failed_attempts INTEGER DEFAULT 0
)

-- Session management (UNIQUE index on session_id)
sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id INTEGER NOT NULL,
  session_id TEXT NOT NULL UNIQUE,
  working_dir TEXT NOT NULL,
  model TEXT DEFAULT 'sonnet',
  is_active INTEGER DEFAULT 1,
  total_cost_usd REAL DEFAULT 0.0,
  total_turns INTEGER DEFAULT 0,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  session_name TEXT DEFAULT NULL
)

-- Per-user settings
user_configs (
  telegram_user_id INTEGER PRIMARY KEY,
  default_working_dir TEXT,
  default_model TEXT DEFAULT 'sonnet',
  max_budget_usd REAL DEFAULT 5.0,
  max_turns INTEGER DEFAULT 50
)
```

## Config Loading

`config.ts` uses a Proxy pattern for lazy-loading:

```typescript
// Before loadConfig(): Proxy throws error
// After loadConfig(): normal access
export const config = new Proxy({} as Config, {
  get(_target, prop, receiver) {
    if (!_config) throw new Error('Config not loaded');
    return Reflect.get(_config, prop, receiver);
  },
});
```

This allows `setup.ts` to create .env → `loadConfig()` → other modules access config.

## Session Management

- **Auto-restore**: On bot restart, load last active session from DB → `--resume` flag
- **Session list**: `/resume` → inline keyboard (resume button + delete button + browse CLI sessions)
- **Session rename**: `/rename` → updates both DB `session_name` and Claude Code JSONL `custom-title` record
- **Deduplication**: `createSession` uses upsert (existing → UPDATE, new → INSERT)
- **Idle cleanup**: Check idle processes every 60s → kill after 30min

## Internal API & External MCP Integration

Telaude runs an HTTP server on `127.0.0.1:19816` that exposes Telegram messaging to external MCP servers.

**Auto-injected env vars** (via `--mcp-config`):
- `TELAUDE_API_URL` — Internal API address
- `TELAUDE_API_TOKEN` — Runtime auth token (destroyed on exit)
- `TELAUDE_USER_ID` — Telegram user ID

**Endpoints**: send-photo, send-file, send-sticker, zip-and-send, ask, pin/unpin, set-reaction

File paths are validated against allowed boundaries (workingDir, homedir, tmpdir).

## Scheduler & Poke

- **Cron jobs**: Recurring tasks via node-cron, persisted to JSON file
- **One-shot jobs**: Single-fire timers with `runAt` timestamp
- **Poke**: Auto follow-up when Claude goes silent — injects natural language into stdin via `--resume`
- **Heartbeat**: HEARTBEAT.md-based health check (MCP tools: heartbeat_check/update/ok)

## Middleware Chain

```
authMiddleware → handler
```

- `/start`, `/auth`, `/help` bypass auth (PUBLIC_COMMANDS)
- `ALLOWED_TELEGRAM_IDS` whitelist check (if configured)
- All other commands/messages require `/auth <password>` first
- `message_reaction` updates pass through without auth

## Tool Display Settings

Configurable via `telaude-mcp-settings.json` (global `~/.telaude/` or project `.telaude/`).

- `hidden: true` — hide from Telegram tool messages
- `icon` — Unicode emoji or Telegram Premium custom emoji (`emojiId` + `fallback`)
- MCP tools matched by suffix (`mcp__server__tool` → `tool`)
- Hot-reload via mtime comparison (no restart needed)

## Link Preview

URL detection → proxy API fetch → context prepend to Claude stdin.

| Platform | Method | Data |
|----------|--------|------|
| X/Twitter | fxtwitter API | Full text, engagement stats, images, article body (Draft.js blocks) |
| YouTube | noembed.com | Title, channel name |
| Generic URL | OG meta tag parsing | Title, description, site name (50KB cap on HTML fetch) |

## Security

- `.env` encrypted with OS-native APIs (Windows DPAPI / macOS Keychain / Linux machine-id+UID)
- Internal API binds to localhost only
- Runtime tokens generated per process, never persisted
- File path validation on all send-file/send-photo/zip-and-send routes
- bcrypt password hashing with failed attempt tracking
