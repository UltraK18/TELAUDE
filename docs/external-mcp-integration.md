# External MCP Integration

Telaude provides Telegram messaging capabilities to external MCP servers through its internal HTTP API (`127.0.0.1:19816`).

## Environment Variables (Auto-Injected)

When Telaude spawns the Claude CLI, it automatically injects the following variables into every external MCP server's environment via `--mcp-config`:

| Variable | Description |
|----------|-------------|
| `TELAUDE_API_URL` | Internal API address (`http://127.0.0.1:19816`) |
| `TELAUDE_API_TOKEN` | Request authentication token (generated at runtime, destroyed on process exit) |
| `TELAUDE_USER_ID` | Telegram user ID |
| `TELAUDE_CHAT_ID` | Current chapter's chat ID (DM = userId, group = groupId) |
| `TELAUDE_THREAD_ID` | Current chapter's thread/topic ID (0 = no thread) |

## Available Endpoints

All requests require the following headers:

```
Content-Type: application/json
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
| `POST /mcp/set-reaction` | `{ emoji: string }` | Set an emoji reaction on the user's most recent message |
| `POST /mcp/pin-message` | `{}` | Pin the bot's most recent message |
| `POST /mcp/unpin-message` | `{}` | Unpin the pinned message |

## Usage Examples

```typescript
// Using the Telaude API from within an MCP server
const apiUrl = process.env.TELAUDE_API_URL;
const headers = {
  'Content-Type': 'application/json',
  'X-Telaude-Token': process.env.TELAUDE_API_TOKEN!,
  'X-Telaude-User-Id': process.env.TELAUDE_USER_ID!,
};

// Send an image
await fetch(`${apiUrl}/mcp/send-photo`, {
  method: 'POST', headers,
  body: JSON.stringify({ path: '/tmp/image.png' }),
});

// Send a sticker
await fetch(`${apiUrl}/mcp/send-sticker`, {
  method: 'POST', headers,
  body: JSON.stringify({ sticker_id: 'CAACAgIAAxkB...' }),
});

// Ask the user a question (with button choices)
const res = await fetch(`${apiUrl}/mcp/ask`, {
  method: 'POST', headers,
  body: JSON.stringify({ question: 'Which option?', choices: ['A', 'B', 'C'] }),
});
const { answer } = await res.json();
```

## Integration Requirements

- Only available from MCP servers spawned by Claude Code processes running under Telaude
- When testing locally without Telaude, `TELAUDE_API_TOKEN` will not be set — graceful fallback is recommended

```typescript
function isTelaudeAvailable(): boolean {
  return !!(process.env.TELAUDE_API_TOKEN && process.env.TELAUDE_USER_ID);
}
```

## Security

- **Localhost only**: Binds to `127.0.0.1` exclusively — no external access possible
- **Runtime tokens**: Generated when the Telaude process starts, destroyed on exit (never persisted to disk)
- Existing MCP server environment variables (e.g., `GOOGLE_API_KEY`) are preserved
