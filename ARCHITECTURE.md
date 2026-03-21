# TELAUDE Architecture

Telegram Claude Code Bridge — a bot that remotely controls the Claude Code CLI from Telegram.

## Tech Stack

- **Runtime**: Bun (TypeScript, ESM)
- **Bot Framework**: grammY + @grammyjs/auto-retry
- **Database**: better-sqlite3 (WAL mode)
- **Auth**: bcrypt (password hashing) + OS-native encryption (Windows DPAPI / macOS Keychain / Linux)
- **Logging**: pino
- **CLI**: Claude Code (`claude -p --output-format stream-json --verbose`)
- **Scheduler**: croner (cron expressions) + setTimeout (one-shot)
- **MCP**: Built-in MCP server (stdio) + internal HTTP API for external MCP integration

## Directory Structure

```
src/
├── index.ts              # Entry point (.env check → setup or bot start)
├── setup.ts              # First-run interactive setup wizard
├── config.ts             # Env → Config (Proxy lazy-load)
│
├── claude/               # Claude CLI process management
│   ├── process-manager.ts  # UserProcess map (chapterKey-based), spawn/kill/send, global MCP tool cache
│   ├── stream-parser.ts    # NDJSON stdout → EventEmitter (system/assistant/result + tools/compact)
│   ├── stream-handler.ts   # Parser events → Telegram messages (tool display + text streaming + MCP tool collection)
│   ├── tool-formatter.ts   # Tool call HTML formatting (superscript counters, agent pinning)
│   └── cost-tracker.ts     # Cost/turn/context DB updates
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
│   │   ├── model.ts          # /model (inline keyboard)
│   │   ├── budget.ts         # /budget
│   │   ├── stop.ts           # /stop, /stop <text>, /reload
│   │   ├── status.ts         # /stats
│   │   ├── context.ts        # /context (token usage, model, cost)
│   │   ├── compact.ts        # /compact [instructions]
│   │   ├── history.ts        # /history
│   │   └── topic.ts          # /newtopic (DM topic creation)
│   ├── handlers/
│   │   ├── message.ts        # Text/media → Claude process (session restore, queue, link preview, scheduled task drain)
│   │   ├── callback.ts       # Inline keyboard callbacks (resume, delete, browse CLI sessions)
│   │   ├── reaction.ts       # Emoji reaction handling (user↔bot)
│   │   ├── forward-collector.ts  # Batches forwarded messages into single stdin
│   │   ├── media-group-collector.ts # Batches media groups (albums) into single stdin
│   │   └── media-types.ts    # MediaInfo extraction, labels, buildMediaText
│   └── middleware/
│       ├── auth.ts             # Auth check + public commands bypass
│       ├── stale-update-filter.ts # Drop updates older than 2 minutes
│       └── topic-name-cache.ts   # Capture topic names from service messages
│
├── api/                  # Internal HTTP API (for external MCP servers)
│   ├── internal-server.ts  # HTTP server on 127.0.0.1 (socket tracking for clean shutdown)
│   ├── route-handlers.ts   # /mcp/* routes (send-photo, send-file, ask, pin, cron, etc.)
│   ├── ask-queue.ts        # Ask tool queue (inline keyboard → response promise)
│   └── tool-display-store.ts # Tool icon/hidden settings (hot-reload, mtime check)
│
├── mcp-server/           # Built-in MCP server (stdio, registered via --mcp-config)
│   ├── index.ts            # MCP server setup + tool registration
│   ├── http-client.ts      # HTTP client for internal API calls (auto-injects _chatId/_threadId)
│   └── tools/
│       ├── communication.ts  # send_file, send_photo, ask, pin/unpin, set_reaction, zip_and_send
│       ├── scheduling.ts     # schedule_add/list/update/remove/pause/resume/history/completed/nothing_to_report
│       ├── poke.ts           # poke_ok
│       └── system.ts        # get_system_info, reload
│
├── scheduler/            # Cron & one-shot job scheduling
│   ├── scheduler.ts        # Job runner (croner + one-shot timers), per-chapter independent spawn
│   ├── cron-store.ts       # Job persistence (JSON file), triggerOnChange for dashboard sync
│   ├── isolated-spawn.ts   # Isolated job spawner (independent process, no session interference)
│   ├── heartbeat.ts        # HEARTBEAT.md-based health check
│   ├── poke.ts             # Proactive follow-up timer (stdin injection)
│   └── turn-deleter.ts     # JSONL turn cleanup after scheduled tasks
│
├── settings/             # TUI settings panel
│   ├── settings-store.ts   # V2 hierarchical settings (~/.telaude/data/settings.json)
│   └── settings-tui.ts     # Blessed overlay — tab UI: [Model] [MCP Servers] [Base Tools]
│
├── db/                   # SQLite database
│   ├── database.ts         # DB init + migrations (unique indexes, column additions)
│   ├── auth-repo.ts        # auth_tokens table
│   ├── session-repo.ts     # sessions table (upsert, session_name, chapter fields)
│   ├── topic-repo.ts       # Topic name cache (chat_id + thread_id → name)
│   ├── config-repo.ts      # user_configs table
│   └── message-log-repo.ts # Message logging
│
└── utils/
    ├── logger.ts             # pino logger (file + dashboard notify)
    ├── dashboard.ts          # Blessed TUI dashboard (banner, session, schedule, logs, status bar)
    ├── link-preview.ts       # URL → context injection (X/fxtwitter, YouTube/noembed, OG meta tags)
    ├── cli-sessions.ts       # Read/write Claude Code JSONL sessions (customTitle, slug)
    ├── file-downloader.ts    # Telegram file download → user_send/ with project-relative paths
    ├── sticker-cache.ts      # Sticker → JPG thumbnail cache
    ├── markdown-to-html.ts   # Markdown → Telegram HTML conversion
    ├── message-splitter.ts   # 4000-char message splitting (code block > paragraph > line)
    ├── path-validator.ts     # Working directory validation + fallback chain
    └── machine-lock.ts       # OS-native .env encryption (DPAPI / Keychain / Linux)
```

## Core Concepts

### Terminology

| Term | Definition | Identifier |
|------|-----------|------------|
| **Session** | Claude CLI JSONL conversation + DB metadata | `sessionId` (UUID) |
| **Chapter** | Telaude's thread unit — one user + chat + thread context | `chapterKey` = `userId:chatId:threadId` |
| **UP (UserProcess)** | Per-chapter in-memory process state | `processes.get(chapterKey)` |

- Each chapter has its own CLI process, session, working directory, message queue, and settings
- Multiple sessions can be created/resumed within a single chapter
- Chapters are independent — scheduling, spawning, and messaging do not block other chapters

### Per-message Process Spawning

```
User text message
  → messageHandler
  → Get/create UserProcess by chapterKey (restore last session from DB)
  → Link preview: fetch URL context (X/YouTube/OG) → prepend to stdin
  → spawnClaudeProcess (claude -p --resume <sessionId>)
  → stdin.write(text) + stdin.end()
  → StreamParser: parse stdout NDJSON lines
  → StreamHandler: stream to Telegram
    - init → collect MCP tool names into global cache
    - tool_use → single message, edit animation (1s throttle, superscript counters)
    - text start → delete tool message
    - text → separate message, streaming edits (500ms / 200 char intervals)
    - result → cost summary
  → Process exits → drain scheduled queue (same chapter only)
```

### Claude CLI Interface

```bash
claude --verbose \
       --output-format stream-json \
       --include-partial-messages \
       --dangerously-skip-permissions \
       --model <model> \
       --max-turns <turns> \
       --resume <sessionId> \
       --strict-mcp-config \
       --mcp-config <json>   # Telaude MCP + external MCPs with injected env
       --disallowedTools <tools...>  # Per-chapter tool/MCP restrictions
       -p                    # Read prompt from stdin
```

- **Input**: Plain text via stdin → stdin.end()
- **Output**: NDJSON (one JSON event per line)
- **Env cleanup**: Remove `CLAUDECODE`, `CLAUDE_CODE*`, `ANTHROPIC_API_KEY` (prevent nesting)
- **windowsHide**: true (prevent server socket handle inheritance on Windows)

### Stream Event Format

```
system   → { type: "system", subtype: "init", session_id, tools: string[] }
assistant → { type: "assistant", message: { content: [{type:"text",...}, {type:"tool_use",...}], usage } }
result   → { type: "result", cost_usd, total_cost_usd, num_turns, duration_ms, session_id, modelUsage }
```

### Telegram Display Strategy

1. **Tool calls**: Single message with edit animation (1s throttle)
   - Superscript counters: `🔍² Grep` (first tool has no superscript)
   - Agent (subagent) tools pinned at top, regular tools at bottom
2. **Text response**: Tool message deleted → separate message with streaming edits
3. **Message splitting**: Auto-split at 4000 chars (code block > paragraph > line boundaries)
4. **HTML parse failure**: Plain text fallback
5. **Compacting animation**: Animated dots at 2s interval, token count on completion

## Multi-Chapter Architecture

Each chapter (`userId:chatId:threadId`) is fully independent:

- **Separate UP**: Own CLI process, session, working directory, model, message queue
- **Independent scheduling**: Cron/poke jobs check per-chapter `isProcessing`, not per-user
- **Independent settings**: Per-chapter tool/MCP/model configuration via TUI (stored in settings.json)
- **Session restore**: On bot restart, DB active sessions are restored as UPs with workingDir, model, sessionId
- **MCP tool cache**: Global (shared across chapters), populated from init events — any chapter's spawn updates the cache

### Scheduled Task Flow

```
Cron triggers → check if target chapter is processing
  → Yes: enqueue (same chapter only, other chapters unaffected)
  → No: spawn directly in target chapter's context
    → StreamHandler (silent mode) → collect response
    → On exit: send report to correct thread (message_thread_id)
```

## TUI Settings Panel

Tab-based UI with keyboard navigation:

```
[Model]  [MCP Servers]  [Base Tools]
─────────────────────────────────────
 (items for selected tab)
```

- **Model tab**: Select Claude model (radio selection)
- **MCP Servers tab**: Toggle servers on/off + per-server tool sub-list
  - Enabled server: shows tools with indent (from init event global cache)
  - No tools collected yet: "(requires first conversation)" hint
  - Disabled server: tools hidden
- **Base Tools tab**: Built-in tools (Bash, Read, etc.) + Telaude MCP tools
- **Navigation**: ←→/Tab for tabs, ↑↓ for items, Space/Enter to toggle, Esc to close
- **Persistence**: disabledTools/disabledMcpServers saved per-chapter in settings.json

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
  model TEXT DEFAULT 'default',
  is_active INTEGER DEFAULT 1,
  total_cost_usd REAL DEFAULT 0.0,
  total_turns INTEGER DEFAULT 0,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  session_name TEXT DEFAULT NULL,
  chat_id INTEGER,
  thread_id INTEGER DEFAULT 0
)

-- Chapters (persistent thread metadata)
chapters (
  user_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  thread_id INTEGER NOT NULL DEFAULT 0,
  chapter_dir TEXT,
  model TEXT,
  PRIMARY KEY (user_id, chat_id, thread_id)
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

## Internal API & External MCP Integration

Telaude runs an HTTP server on `127.0.0.1:19816` that exposes Telegram messaging to external MCP servers.

**Auto-injected env vars** (via `--mcp-config`):
- `TELAUDE_API_URL` — Internal API address
- `TELAUDE_API_TOKEN` — Runtime auth token (destroyed on exit)
- `TELAUDE_USER_ID` — Telegram user ID
- `TELAUDE_CHAT_ID` — Current chapter's chat ID
- `TELAUDE_THREAD_ID` — Current chapter's thread ID

**MCP http-client** auto-injects `_chatId` and `_threadId` into all API requests from env vars, ensuring correct chapter routing.

**Endpoints**: send-photo, send-file, send-sticker, zip-and-send, ask, pin/unpin, set-reaction, cron CRUD

## Scheduler & Poke

- **Cron jobs**: Recurring tasks via croner, persisted to JSON file
- **One-shot jobs**: Single-fire timers with `runAt` (supports relative: "5m", "1h" and time-only: "09:15")
- **Independent chapter spawn**: Scheduled tasks only queue when their target chapter is busy, not when other chapters are active
- **Dashboard sync**: `triggerOnChange()` called after scheduleJob to update Incoming section
- **Poke**: Auto follow-up when Claude goes silent — injects natural language into stdin via `--resume`
- **Heartbeat**: HEARTBEAT.md-based health check

## Security

- `.env` encrypted with OS-native APIs (Windows DPAPI / macOS Keychain / Linux machine-id+UID)
- Internal API binds to localhost only with socket tracking for clean shutdown
- Runtime tokens generated per process, never persisted
- File path validation on all send-file/send-photo/zip-and-send routes
- bcrypt password hashing with failed attempt tracking
- `spawn()` uses `windowsHide: true` to prevent server socket handle inheritance
- Reload uses 500ms ACK delay before exit to prevent grammY update re-delivery

## Link Preview

URL detection → proxy API fetch → context prepend to Claude stdin.

| Platform | Method | Data |
|----------|--------|------|
| X/Twitter | fxtwitter API | Full text, engagement stats, images, article body (Draft.js blocks) |
| YouTube | noembed.com | Title, channel name |
| Generic URL | OG meta tag parsing | Title, description, site name (50KB cap on HTML fetch) |

## Tool Display Settings

Configurable via `telaude-mcp-settings.json` (global `~/.telaude/` or project `.telaude/`).

- `hidden: true` — hide from Telegram tool messages
- `icon` — Unicode emoji or Telegram Premium custom emoji (`emojiId` + `fallback`)
- MCP tools matched by suffix (`mcp__server__tool` → `tool`)
- Hot-reload via mtime comparison (no restart needed)
