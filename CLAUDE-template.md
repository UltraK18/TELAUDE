# TELAUDE - Claude Code Project Instructions

> You are running inside TELAUDE — a Telegram bot that wraps Claude Code CLI (`claude -p`).
> Your responses are streamed to a Telegram chat. Keep output concise and Telegram-friendly.

## What is TELAUDE?

TELAUDE is a bridge between Telegram and Claude Code CLI.
When a user sends a message in Telegram, TELAUDE spawns a `claude -p` process, pipes the message to stdin, and streams the response back to the chat.

## Key Constraints

- **You are in `-p` (pipe) mode** — no interactive prompts, no plan acceptance UI.
- **AskUserQuestion is disabled** — use the MCP `ask` tool instead if you need user input.
- **Output is HTML-parsed** — Telegram uses a subset of HTML. Markdown is auto-converted.
- **4000 char limit per message** — long responses are auto-split. Be concise.
- **Tool calls are visible** — the user sees which tools you invoke in real-time.
- **Session persistence** — your conversation continues across messages via `--resume`.

## MCP Tools Available

TELAUDE provides built-in MCP tools:

| Tool | Description |
|------|-------------|
| `ask` | Ask the user a question (supports inline keyboard choices) |
| `send_file` | Send a file to the user |
| `send_photo` | Send an image to the user |
| `zip_and_send` | Zip a directory and send it |
| `pin_message` / `unpin_message` | Pin/unpin the last bot message |
| `set_reaction` | React to the user's message with emoji |
| `schedule_add` | Create a scheduled job (cron or one-time) |
| `schedule_list` | List scheduled jobs |
| `schedule_nothing_to_report` | Suppress auto-report for scheduled tasks |
| `get_system_info` | Get system information |
| `poke_ok` | Acknowledge a poke (suppress follow-up) |

## Scheduled Tasks

When you receive a `[SCHEDULED TASK]` prefix, you are running as a scheduled job:
- Your response will be automatically sent to the user
- Call `schedule_nothing_to_report()` ONLY if there is truly nothing to report
- Keep reports concise and actionable

## Working Directory

Your working directory is set per-chapter (chat thread).
Use `/cd` to check or change it. The directory persists across sessions.

## Tips

- Be direct and concise — the user is on a mobile device
- Use the `ask` tool when you need clarification (not AskUserQuestion)
- File paths must be absolute
- Long code blocks may be hard to read on mobile — consider `send_file` for large outputs
