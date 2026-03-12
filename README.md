# Telaude

A Telegram bot that remotely controls the Claude Code CLI.

Send a message via Telegram, and the server spawns a `claude -p` process, streaming the results back to your chat in real time.

## Features

- **Real-time Streaming** — Claude responses are streamed live to Telegram with incremental edits
- **Session Management** — Resume conversations, list sessions, rename them, and restore previous context
- **Tool Call Visualization** — See which tools Claude is using in real time, with counters and icons
- **MCP Server** — Built-in MCP tools for scheduling, file sending, user prompts, and more
- **External MCP Integration** — Other MCP servers can use Telaude's Telegram messaging capabilities
- **Cron / Scheduling** — Run scheduled tasks (recurring cron or one-shot)
- **Poke** — Automatic follow-up when Claude goes silent
- **Emoji Reactions** — Bidirectional reactions (user-to-bot and bot-to-user messages)
- **Link Preview** — Auto-fetches context for URLs shared in messages (X/Twitter via fxtwitter, YouTube via noembed, generic sites via OG meta tags)
- **Forward Message Support** — Forwarded messages are collected and sent as context to Claude
- **TUI Dashboard** — Terminal dashboard displaying session info, schedule status, logs, and settings
- **Settings TUI** — Keyboard-only settings panel with scroll support for toggling MCP servers, tools, and model selection
- **File Path Validation** — send-file, send-photo, and zip-and-send routes validate paths within allowed boundaries
- **Security** — Password authentication + OS-native encryption (Windows DPAPI / macOS Keychain / Linux machine-id)

## Documentation

For detailed usage and configuration, see **[docs/index.md](./docs/index.md)**.

## Quick Start

```bash
# Install dependencies
bun install

# First run (setup wizard guides you through .env creation)
bun run dev
```

The setup wizard will ask for:
1. Telegram Bot Token (create one with [@BotFather](https://t.me/BotFather))
2. Authentication password
3. Claude CLI auth status verification

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Bot welcome message |
| `/auth <pw>` | Authenticate with password |
| `/help` | List available commands |
| `/new` | Start a new session |
| `/stats` | Session info + token usage |
| `/resume` | List recent sessions (resume / delete) |
| `/stop` | Stop current processing |
| `/stop <text>` | Stop and send new input |
| `/rename <name>` | Rename the current session (syncs with Claude Code JSONL) |
| `/compact [instructions]` | Compact conversation context |
| `/history` | Show last 5 conversation turns |
| `/cd <path>` | Change working directory |
| `/pwd` | Show current directory |
| `/projects` | List allowed project paths |
| `/model [name]` | View or change the model |
| `/budget [amount]` | View or set token budget |

## Build & Run

```bash
bun run build        # TypeScript build
bun start            # Production
bun run dev          # Development (stdin supported)
bun run dev:watch    # Development (auto-reload, no stdin)
bun run build:exe    # Compile single executable (telaude.exe)
```

## External MCP Integration

Telaude exposes an internal HTTP API that **lets external MCP servers send messages through Telegram**.

When Telaude spawns a Claude CLI process, it injects the following environment variables into **all external MCP servers** via `--mcp-config`:

| Variable | Description |
|----------|-------------|
| `TELAUDE_API_URL` | Internal API address (`http://127.0.0.1:19816`) |
| `TELAUDE_API_TOKEN` | Request auth token (generated at runtime) |
| `TELAUDE_USER_ID` | Telegram user ID |

### Available Endpoints

| Endpoint | Body | Description |
|----------|------|-------------|
| `POST /mcp/send-photo` | `{ path }` | Send an image file (absolute path) |
| `POST /mcp/send-file` | `{ path }` | Send a file (absolute path) |
| `POST /mcp/send-sticker` | `{ sticker_id }` | Send a sticker (Telegram file_id) |
| `POST /mcp/zip-and-send` | `{ dir }` | Zip a directory and send it |
| `POST /mcp/ask` | `{ question, choices? }` | Ask the user a question (supports inline keyboard choices) |
| `POST /mcp/set-reaction` | `{ emoji }` | React to the user's latest message with an emoji |
| `POST /mcp/pin-message` | `{}` | Pin the bot's latest message |
| `POST /mcp/unpin-message` | `{}` | Unpin the pinned message |

### Tool Display Settings

Configure tool visibility and icons via settings files. Project-level settings override global ones.

- **Global**: `~/.telaude/telaude-mcp-settings.json`
- **Project**: `<cwd>/.telaude/telaude-mcp-settings.json` (takes priority)

```jsonc
{
  "tools": {
    "hidden_tool": { "hidden": true },
    "some_tool": { "icon": "🚀" },
    "fancy_tool": { "icon": { "emojiId": "5206186681346039457", "fallback": "🧑‍🎓" } }
  }
}
```

- `hidden: true` — Hide the tool from Telegram tool-call messages
- `icon` (string) — Override the tool icon with a Unicode emoji
- `icon` (object) — Use a Telegram Premium custom emoji (`emojiId` + `fallback`)
- MCP tools are matched by suffix (`mcp__server__tool` matches `tool`)
- Hot-reloads on file change (no restart needed)

### Usage Example

```typescript
const res = await fetch(process.env.TELAUDE_API_URL + '/mcp/send-photo', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Telaude-Token': process.env.TELAUDE_API_TOKEN!,
    'X-Telaude-User-Id': process.env.TELAUDE_USER_ID!,
  },
  body: JSON.stringify({ path: '/tmp/image.png' }),
});
```

Telaude automatically injects `TELAUDE_*` environment variables into all MCP servers listed in `--mcp-config` when spawning Claude CLI. Each MCP server's own env vars (e.g., `GOOGLE_API_KEY`) are preserved. For standalone local usage without Telaude, implement a graceful fallback using `isTelaudeAvailable()`.

## Architecture

```
Telegram User
    ↓ message
Telaude Bot (grammY)
    ↓ spawn
claude -p --resume <sessionId>
    ↓ stream-json stdout
Telaude Stream Handler
    ↓ edit/send
Telegram Chat
```

## License

MIT
