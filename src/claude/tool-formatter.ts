const TOOL_ICONS: Record<string, string> = {
  Read: '📖',
  Write: '✏️',
  Edit: '✏️',
  Bash: '⚡',
  Glob: '🔍',
  Grep: '🔍',
  WebFetch: '🌐',
  WebSearch: '🌐',
  default: '🔧',
};

export function formatToolStart(toolName: string): string {
  const icon = TOOL_ICONS[toolName] ?? TOOL_ICONS.default;
  return `${icon} <b>${toolName}</b>`;
}

export function formatToolWithInput(toolName: string, inputJson: string): string {
  const icon = TOOL_ICONS[toolName] ?? TOOL_ICONS.default;

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
