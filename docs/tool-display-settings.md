# Tool Display Settings

Configure visibility and icons for tool call messages displayed in Telegram.

## Configuration Files

Project-level settings take priority over global settings.

- **Global**: `~/.telaude/telaude-mcp-settings.json`
- **Project**: `<cwd>/.telaude/telaude-mcp-settings.json` (takes priority)

```jsonc
{
  "tools": {
    "tool_name": { "hidden": true },
    "other_tool": { "icon": "🚀" },
    "fancy_tool": { "icon": { "emojiId": "5206186681346039457", "fallback": "🧑‍🎓" } }
  }
}
```

## Options

### hidden

Set to `true` to hide the tool's invocations from the Telegram tool message.

```jsonc
{ "hidden": true }
```

### icon (Unicode Emoji)

Change the tool's icon to a standard Unicode emoji.

```jsonc
{ "icon": "🚀" }
```

### icon (Premium Custom Emoji)

Use a Telegram Premium custom emoji (including animated emoji).

- `emojiId`: Telegram custom emoji ID
- `fallback`: Unicode emoji displayed for non-Premium clients

```jsonc
{ "icon": { "emojiId": "5206186681346039457", "fallback": "🧑‍🎓" } }
```

### hidden + icon

Both can be set simultaneously. If `hidden: true`, the icon is ignored.

## MCP Tool Matching

MCP tools are matched by suffix:

- Setting `"ask"` in the config matches both `mcp__telaude__ask` and `mcp__other__ask`
- Exact names like `"mcp__telaude__ask"` can also be used (exact match takes priority)

## Hot-Reload Behavior

- Settings are **hot-reloaded** on file changes (detected via mtime comparison, no restart required)
- When the working directory (cwd) changes, project-level settings are automatically re-detected

## Error Handling

- **File not found** — falls back to default behavior (all tools visible, built-in icons used)
- **JSON parse error** — logs a warning, falls back to default behavior
- **Missing or invalid `tools` key** — falls back to default behavior
