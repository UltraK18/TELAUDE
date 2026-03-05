import fs from 'fs';
import path from 'path';

const SETTINGS_FILE = path.join(process.cwd(), 'data', 'settings.json');

export interface TelaudeSettings {
  /** Tools disabled by user (added to --disallowedTools) */
  disabledTools: string[];
  /** MCP servers disabled by user (excluded from --mcp-config) */
  disabledMcpServers: string[];
  /** Model override (null = use default from config) */
  model: string | null;
}

const DEFAULT_SETTINGS: TelaudeSettings = {
  disabledTools: [],
  disabledMcpServers: [],
  model: null,
};

let cached: TelaudeSettings | null = null;

function ensureDataDir(): void {
  const dir = path.dirname(SETTINGS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadSettings(): TelaudeSettings {
  if (cached) return cached;
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      cached = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      return cached!;
    }
  } catch {
    // corrupt file — use defaults
  }
  cached = { ...DEFAULT_SETTINGS };
  return cached;
}

export function saveSettings(settings: TelaudeSettings): void {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
  cached = settings;
}

export function toggleTool(toolName: string): boolean {
  const s = loadSettings();
  const idx = s.disabledTools.indexOf(toolName);
  if (idx >= 0) {
    s.disabledTools.splice(idx, 1);
  } else {
    s.disabledTools.push(toolName);
  }
  saveSettings(s);
  return idx < 0; // true = now disabled
}

export function toggleMcpServer(serverName: string): boolean {
  const s = loadSettings();
  const idx = s.disabledMcpServers.indexOf(serverName);
  if (idx >= 0) {
    s.disabledMcpServers.splice(idx, 1);
  } else {
    s.disabledMcpServers.push(serverName);
  }
  saveSettings(s);
  return idx < 0; // true = now disabled
}

export function setModel(model: string | null): void {
  const s = loadSettings();
  s.model = model;
  saveSettings(s);
}
