// tg-emoji wrapper for premium animated emoji
function tge(emojiId: string, fallback: string): string {
  return `<tg-emoji emoji-id="${emojiId}">${fallback}</tg-emoji>`;
}

const TOOL_ICONS: Record<string, string> = {
  Read: tge('5206186681346039457', '🧑‍🎓'),
  Write: tge('5334882760735598374', '📝'),
  Edit: tge('5956143844457189176', '✏️'),
  Bash: tge('5456140674028019486', '⚡️'),
  Glob: tge('5447410659077661506', '🌐'),
  Grep: tge('5447410659077661506', '🌐'),
  WebFetch: tge('5282843764451195532', '🖥'),
  WebSearch: tge('5282843764451195532', '🖥'),
  default: tge('5341715473882955310', '⚙️'),
};

// MCP tool-specific icons (matched by tool name suffix)
const MCP_TOOL_ICONS: Record<string, string> = {
  ask: tge('5436113877181941026', '❓'),
  schedule_add: tge('5413879192267805083', '🗓'),
  schedule_list: tge('5413879192267805083', '🗓'),
  schedule_update: tge('5413879192267805083', '🗓'),
  schedule_remove: tge('5413879192267805083', '🗓'),
  schedule_pause: tge('5413879192267805083', '🗓'),
  schedule_resume: tge('5413879192267805083', '🗓'),
  schedule_history: tge('5413879192267805083', '🗓'),
  schedule_ok: tge('5413879192267805083', '🗓'),
  schedule_completed: tge('5413879192267805083', '🗓'),
  heartbeat_check: tge('5413879192267805083', '🗓'),
  heartbeat_update: tge('5413879192267805083', '🗓'),
  heartbeat_ok: tge('5413879192267805083', '🗓'),
};

function getToolIcon(toolName: string): string {
  if (TOOL_ICONS[toolName]) return TOOL_ICONS[toolName];
  // MCP tools: mcp__server__tool → extract tool suffix
  const mcpMatch = toolName.match(/^mcp__[^_]+__(.+)$/);
  if (mcpMatch) {
    const suffix = mcpMatch[1];
    if (MCP_TOOL_ICONS[suffix]) return MCP_TOOL_ICONS[suffix];
  }
  return TOOL_ICONS.default;
}

export function formatToolStart(toolName: string): string {
  const icon = getToolIcon(toolName);
  return `${icon} <b>${toolName}</b>`;
}

export function formatToolWithInput(toolName: string, inputJson: string): string {
  const icon = getToolIcon(toolName);

  try {
    const params = JSON.parse(inputJson);
    const summary = getToolSummary(toolName, params);
    if (summary) {
      return `${icon} ${summary}`;
    }
  } catch {
    // Invalid JSON, just show tool name
  }

  return `${icon} <b>${toolName}</b>`;
}

function getToolSummary(toolName: string, params: Record<string, unknown>): string | null {
  switch (toolName) {
    case 'Read':
      return `Reading: <code>${truncatePath(params.file_path as string)}</code>`;
    case 'Write':
      return `Writing: <code>${truncatePath(params.file_path as string)}</code>`;
    case 'Edit':
      return `Editing: <code>${truncatePath(params.file_path as string)}</code>`;
    case 'Bash':
      return `Bash: <code>${truncateText(params.command as string, 60)}</code>`;
    case 'Glob':
      return `Glob: <code>${params.pattern}</code>`;
    case 'Grep':
      return `Grep: <code>${truncateText(params.pattern as string, 40)}</code>`;
    case 'WebSearch':
      return `Search: <code>${truncateText(params.query as string, 50)}</code>`;
    default:
      return null;
  }
}

function truncatePath(filePath: string | undefined): string {
  if (!filePath) return '(unknown)';
  const parts = filePath.replace(/\\/g, '/').split('/');
  if (parts.length <= 3) return filePath;
  return '.../' + parts.slice(-2).join('/');
}

function truncateText(text: string | undefined, maxLen: number): string {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}
