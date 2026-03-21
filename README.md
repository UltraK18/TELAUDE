# TELAUDE

[한국어](./README.ko.md) | [日本語](./README.ja.md) | [Español](./README.es.md) | [Français](./README.fr.md)

An open-source headless orchestration bridge that securely exposes the Claude Code CLI to Telegram, transforming standard messaging interfaces into fully-featured, multi-context developer workspaces.

Built entirely on `claude -p` (pipe mode) — leveraging the CLI's native capabilities without any SDK hacks or unofficial APIs.

Send a message via Telegram, and the server spawns a `claude -p` process, streaming the results back to your chat in real time.

## Features

### Streaming & Multi-Context
- **Real-time Streaming** — Claude responses are streamed live to Telegram with incremental edits
- **Multi-Chapter Architecture** — Independent sessions per chat/thread (DM topics, group forums). Each chapter has its own CLI process, session, working directory, and settings
- **Session Management** — Resume conversations, list sessions, rename them, and restore previous context
- **Tool Call Visualization** — See which tools Claude is using in real time, with superscript counters, custom icons, and animated compaction indicators
- **Telegram-Native UX** — Tool messages auto-delete when text arrives, compaction shows animated dots, long responses auto-split at natural boundaries (code blocks > paragraphs > lines), and HTML parse failures gracefully fall back to plain text

### Extensibility & MCP
- **Built-in MCP Server** — Native tools for scheduling, file sending, user prompts, and more
- **External MCP Integration** — Other MCP servers can use Telaude's Telegram messaging capabilities via internal HTTP API
- **Configurable Tool UI** — Tool visibility and icons are fully customizable via global or project-level settings

### Proactive Agentic Workflows
- **Cron / Scheduling** — Run scheduled tasks (recurring cron or one-shot), with isolated job mode
- **Poke** — Automatic follow-up when Claude goes silent (sleep-aware, configurable intensity)
- **Heartbeat** — Health check mechanism for scheduled tasks

### Input & Context
- **Media Support** — Photos, documents, audio, video, stickers, and voice notes
- **Forward Message Support** — Forwarded messages are collected and sent as context to Claude
- **Link Preview** — Auto-fetches context for URLs shared in messages (X/Twitter, YouTube, OG meta tags)
- **Emoji Reactions** — Bidirectional reactions (user-to-bot and bot-to-user messages)

### Monitoring & Control
- **TUI Dashboard** — Three-column terminal dashboard (Logs | Sessions | Schedule) with keyboard-only navigation
- **Per-Chapter Settings** — Each chapter has independent MCP, tool, and model settings via TUI
- **Context Usage** — `/context` shows real-time token usage, model info, and cost

### Security
- **OS-Native Encryption** — Protects `.env` secrets using OS-level cryptography (Windows DPAPI / macOS Keychain / Linux machine-id)
- **Path Validation** — File operations are restricted to allowed boundaries
- **Authentication** — Password challenge via `/auth` before any commands are processed

## How It Works — Native CLI, Not SDK

TELAUDE does **not** use the Claude Agent SDK, unofficial APIs, or OAuth token extraction. It spawns the official `claude -p` CLI as a child process and communicates via stdin/stdout — the same way you'd use it in a terminal.

```
Telegram message → child_process.spawn('claude', ['-p', ...]) → stdin/stdout → Telegram
```

By building on `-p` (pipe mode), TELAUDE inherits all native CLI features — session management, MCP server integration, context compaction, tool permissions, prompt caching, and more — without reimplementing any of them. Every effort is made to reflect the full native CLI experience through Telegram, while adding Telegram-native UX enhancements like real-time tool animations, smart message splitting, and interactive inline keyboards.

This matters because Anthropic's [Terms of Service](https://autonomee.ai/blog/claude-code-terms-of-service-explained/) explicitly prohibit third-party use of subscription OAuth tokens with the Agent SDK, and have [actively blocked](https://autonomee.ai/blog/claude-code-terms-of-service-explained/) projects that do so (OpenClaw, OpenCode, Cline, Roo Code, etc.). TELAUDE avoids this entirely — it calls the CLI binary on your machine, which uses your existing Claude Code authentication as intended.

## Documentation

For detailed usage and configuration, see **[docs/index.md](./docs/index.md)**.

## Quick Start

Ensure [Bun](https://bun.sh/) is installed.

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
| `/context` | Context window usage (tokens/model/cost) |
| `/schedule` | View scheduled jobs |

## Build & Run

```bash
bun run build        # TypeScript build
bun start            # Production
bun run dev          # Development (stdin supported)
bun run dev:watch    # Development (auto-reload, no stdin)
bun run build:exe    # Compile single executable
```

> **Note:** `build:exe` currently produces a Windows executable. Cross-platform binary builds (Linux, macOS) are planned but not yet tested — contributions and testing help are welcome.

## External MCP Integration

Telaude exposes an internal HTTP API that **lets external MCP servers send messages through Telegram**.

When Telaude spawns a Claude CLI process, it injects the following environment variables into **all external MCP servers** via `--mcp-config`:

| Variable | Description |
|----------|-------------|
| `TELAUDE_API_URL` | Internal API address (`http://127.0.0.1:19816`) |
| `TELAUDE_API_TOKEN` | Request auth token (generated at runtime) |
| `TELAUDE_USER_ID` | Telegram user ID |
| `TELAUDE_CHAT_ID` | Current chapter's chat ID (DM = userId, group = groupId) |
| `TELAUDE_THREAD_ID` | Current chapter's thread/topic ID (0 = no thread) |

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

```text
[ Telegram Client ]
       │ (Message)
       ▼
[ Telaude Bot (grammY) ]
       │ (Spawns isolated process per chapter)
       ▼
[ claude -p --resume <sessionId> ]
       │ (Streams stdout via NDJSON)
       ▼
[ Telaude Stream Handler ]
       │ (Parses chunks, applies UI formatting)
       ▼
[ Telegram Client ] (Real-time message edit)
```

## Contributing

TELAUDE is fully open source. Contributions, bug reports, and cross-platform testing are welcome — especially for:
- **macOS / Linux binary builds** — `build:exe` is currently Windows-only
- **macOS Keychain integration** — OS-native encryption needs real-device testing
- **Terminal compatibility** — TUI input issues on non-Windows terminals (macOS, Termux)

## License

MIT

---

*TELAUDE was 100% built using Claude Code through Telegram — developed entirely via the system it creates.*
