/**
 * In-memory store for external MCP tool display settings.
 * External MCP servers register their tool display preferences via /mcp/tool-display.
 */

export interface ToolDisplayConfig {
  hidden?: boolean;
  icon?: string;       // custom tg-emoji tag or plain emoji
}

const store = new Map<string, ToolDisplayConfig>();

export function setToolDisplay(toolName: string, config: ToolDisplayConfig): void {
  store.set(toolName, config);
}

export function getToolDisplay(toolName: string): ToolDisplayConfig | undefined {
  return store.get(toolName);
}

export function isToolHidden(toolName: string): boolean {
  // Check exact match first
  const exact = store.get(toolName);
  if (exact?.hidden) return true;

  // Check by suffix (MCP tools: mcp__server__toolname → toolname)
  const mcpMatch = toolName.match(/^mcp__[^_]+__(.+)$/);
  if (mcpMatch) {
    const suffix = store.get(mcpMatch[1]);
    if (suffix?.hidden) return true;
  }

  return false;
}

export function getToolCustomIcon(toolName: string): string | undefined {
  const exact = store.get(toolName);
  if (exact?.icon) return exact.icon;

  const mcpMatch = toolName.match(/^mcp__[^_]+__(.+)$/);
  if (mcpMatch) {
    const suffix = store.get(mcpMatch[1]);
    if (suffix?.icon) return suffix.icon;
  }

  return undefined;
}

export function clearToolDisplay(): void {
  store.clear();
}
