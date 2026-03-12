# Telaude Documentation

## Guides

| Document | Description |
|----------|-------------|
| [External MCP Integration](./external-mcp-integration.md) | How external MCP servers can use Telaude's Telegram messaging capabilities |
| [Tool Display Settings](./tool-display-settings.md) | Hide tools or customize icons (global/project-level, hot-reload) |

## Configuration File Locations

Telaude's configuration files and data are stored in dedicated directories that are **not tracked by git**.

### Global Directory (`~/.telaude/`)

Located under the OS user's home directory. These settings apply to all projects. Since they are not git-tracked, they must be created manually on each instance.

| Path | Description |
|------|-------------|
| `~/.telaude/data/settings.json` | TUI settings (disabled tools/MCPs, model selection) |
| `~/.telaude/data/bot.log` | Bot log file |
| `~/.telaude/data/sticker-cache/` | Sticker JPG thumbnail cache |
| `~/.telaude/telaude-mcp-settings.json` | Global tool display settings (hidden/icon) |
| `~/.telaude/allowed_project_roots.json` | Allowed paths for `/cd` command (no file = no restrictions) |

### Project Directory (`.telaude/`)

Located under each Claude working directory (cwd). These settings apply only to that specific project.

| Path | Description |
|------|-------------|
| `.telaude/telaude-mcp-settings.json` | Project-level tool display settings (overrides global) |

> The `.telaude/` directory is included in `.gitignore` and is not tracked by git. Configure it independently on each instance.

#### allowed_project_roots.json

Restricts which paths the `/cd` command can navigate to. If the file does not exist, all paths are allowed.

```json
[
  "/home/user/projects",
  "/home/user/work"
]
```

Windows example:
```json
[
  "C:\\Users\\user\\projects",
  "C:\\work"
]
```

### Other Data Files

| Path | Description |
|------|-------------|
| `.env` (project root) | Bot token, password hash, etc. — excluded from git |
| `~/.telaude/data/telaude.db` | SQLite database (sessions, schedules, etc.) — excluded from git |
| `user_send/` | Temporary storage for user-uploaded files — excluded from git |

## Setup & Authentication

### First Run

Running `bun run dev` automatically launches the setup wizard, which guides you through the following steps:

1. **Telegram Bot Token** — obtain one from [@BotFather](https://t.me/BotFather)
2. **Authentication password** — set a password for bot access
3. **Claude CLI auth status** — checks whether the CLI is authenticated (prompts you to run `claude` if not)

Once all inputs are provided, a `.env` file is automatically generated and the bot starts.

> **You do not need to manually edit the `.env` file.** The wizard creates it, and the password is securely protected internally.

### Bot Authentication

After the bot starts, send `/auth <password>` in Telegram to authenticate. Once authenticated, all Claude commands become available.

### Environment Variables (.env)

Required variables (created by the setup wizard):

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot token issued by BotFather |
| `AUTH_PASSWORD` | Telegram bot authentication password (stored as bcrypt hash) |

Optional variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `ALLOWED_TELEGRAM_IDS` | (none, anyone allowed) | Allowed Telegram User IDs (comma-separated) |
| `CHAT_ID` | Auto-detected | Chat ID for bot notifications (auto-saved on auth) |
| `CLAUDE_CLI_PATH` | `claude` | Path to the Claude CLI executable |
| `DEFAULT_MODEL` | `sonnet` | Default Claude model |
| `DEFAULT_MAX_BUDGET_USD` | `5.0` | Default budget limit (USD) |
| `DEFAULT_MAX_TURNS` | `50` | Default maximum number of turns |
| `DEFAULT_WORKING_DIR` | Current directory | Default working directory |
| `SESSION_IDLE_TIMEOUT_MS` | `1800000` | Session idle timeout (ms) |
| `STREAM_UPDATE_INTERVAL_MS` | `500` | Streaming update interval (ms) |
| `STREAM_UPDATE_MIN_CHARS` | `200` | Minimum characters before streaming update |
| `MCP_INTERNAL_API_PORT` | `19816` | Internal MCP API port |
| `LOG_LEVEL` | `info` | Log level |

### Security

Telaude protects the entire `.env` file with OS-native encryption (Windows DPAPI / macOS Keychain / Linux). Decryption is impossible without access to the same OS user account.

## Internal MCP API Endpoints

MCP servers running under Claude processes spawned by Telaude can use the internal HTTP API (`http://127.0.0.1:19816`) to send messages via Telegram.

Auth headers:

```
X-Telaude-Token: <TELAUDE_API_TOKEN>
X-Telaude-User-Id: <TELAUDE_USER_ID>
```

| Endpoint | Body | Description |
|----------|------|-------------|
| `POST /mcp/send-photo` | `{ path: string }` | Send an image file (absolute path) |
| `POST /mcp/send-file` | `{ path: string }` | Send a file (absolute path) |
| `POST /mcp/send-sticker` | `{ sticker_id: string }` | Send a sticker (Telegram file_id) |
| `POST /mcp/zip-and-send` | `{ dir: string }` | Zip a directory and send the archive |
| `POST /mcp/ask` | `{ question: string, choices?: string[] }` | Ask the user a question and wait for a response |
| `POST /mcp/pin-message` | `{}` | Pin the bot's most recent message |
| `POST /mcp/unpin-message` | `{}` | Unpin the pinned message |
| `POST /mcp/set-reaction` | `{ emoji: string }` | Set an emoji reaction on the user's message |

The environment variables `TELAUDE_API_URL`, `TELAUDE_API_TOKEN`, and `TELAUDE_USER_ID` are automatically injected by Telaude via `--mcp-config` when spawning the Claude CLI. See [External MCP Integration](./external-mcp-integration.md) for details.
