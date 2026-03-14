import fs from 'fs';
import path from 'path';
import os from 'os';

const SETTINGS_FILE = path.join(os.homedir(), '.telaude', 'data', 'settings.json');

/** Root-level defaults (new sessions inherit these) */
export interface RootSettings {
  defaultModel: string;
  defaultMode: 'default' | 'minimal';
}

/** Project-level settings (same workingDir shares these) */
export interface ProjectSettings {
  disabledTools: string[];
  disabledMcpServers: string[];
}

/** Session-level settings (per chatId:threadId) */
export interface SessionSettings {
  model: string | null;
  mode: 'default' | 'minimal';
}

/** Full hierarchical settings file */
export interface TelaudeSettingsV2 {
  version: 2;
  root: RootSettings;
  projects: Record<string, ProjectSettings>;   // key = workingDir
  sessions: Record<string, SessionSettings>;    // key = "chatId:threadId"
}

/** Legacy flat settings (v1) — for migration */
export interface TelaudeSettings {
  disabledTools: string[];
  disabledMcpServers: string[];
  model: string | null;
}

const DEFAULT_ROOT: RootSettings = {
  defaultModel: 'default',
  defaultMode: 'default',
};

const DEFAULT_PROJECT: ProjectSettings = {
  disabledTools: [],
  disabledMcpServers: [],
};

const DEFAULT_SESSION: SessionSettings = {
  model: null,
  mode: 'default',
};

let cached: TelaudeSettingsV2 | null = null;

function ensureDataDir(): void {
  const dir = path.dirname(SETTINGS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** Migrate v1 flat settings to v2 hierarchical */
function migrateV1(v1: TelaudeSettings): TelaudeSettingsV2 {
  return {
    version: 2,
    root: { ...DEFAULT_ROOT },
    projects: {
      '_default': {
        disabledTools: [...v1.disabledTools],
        disabledMcpServers: [...v1.disabledMcpServers],
      },
    },
    sessions: v1.model ? { '_default': { model: v1.model, mode: 'default' } } : {},
  };
}

export function loadSettingsV2(): TelaudeSettingsV2 {
  if (cached) return cached;
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      if (raw.version === 2) {
        cached = {
          version: 2,
          root: { ...DEFAULT_ROOT, ...raw.root },
          projects: raw.projects ?? {},
          sessions: raw.sessions ?? {},
        };
        return cached;
      }
      // v1 migration
      cached = migrateV1(raw as TelaudeSettings);
      saveSettingsV2(cached);
      return cached;
    }
  } catch {
    // corrupt file — use defaults
  }
  cached = { version: 2, root: { ...DEFAULT_ROOT }, projects: {}, sessions: {} };
  return cached;
}

export function saveSettingsV2(settings: TelaudeSettingsV2): void {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
  cached = settings;
}

/** Get project settings (creates with defaults if missing) */
export function getProjectSettings(workingDir: string): ProjectSettings {
  const s = loadSettingsV2();
  return s.projects[workingDir] ?? { ...DEFAULT_PROJECT };
}

/** Get session settings */
export function getSessionSettings(sessionKey: string): SessionSettings {
  const s = loadSettingsV2();
  return s.sessions[sessionKey] ?? { ...DEFAULT_SESSION };
}

/** Resolve effective settings for a session (cascade: session → project → root) */
export function resolveSettings(workingDir: string, sessionKey: string): {
  disabledTools: string[];
  disabledMcpServers: string[];
  model: string | null;
  mode: 'default' | 'minimal';
} {
  const s = loadSettingsV2();
  const proj = s.projects[workingDir] ?? DEFAULT_PROJECT;
  const sess = s.sessions[sessionKey] ?? DEFAULT_SESSION;
  return {
    disabledTools: [...proj.disabledTools],
    disabledMcpServers: [...proj.disabledMcpServers],
    model: sess.model,
    mode: sess.mode,
  };
}

/** Update project settings */
export function updateProjectSettings(workingDir: string, updates: Partial<ProjectSettings>): void {
  const s = loadSettingsV2();
  const current = s.projects[workingDir] ?? { ...DEFAULT_PROJECT };
  s.projects[workingDir] = { ...current, ...updates };
  saveSettingsV2(s);
}

/** Update session settings */
export function updateSessionSettings(sessionKey: string, updates: Partial<SessionSettings>): void {
  const s = loadSettingsV2();
  const current = s.sessions[sessionKey] ?? { ...DEFAULT_SESSION };
  s.sessions[sessionKey] = { ...current, ...updates };
  saveSettingsV2(s);
}

// --- Backward-compatible API (used by process-manager.ts and settings-tui.ts) ---

/** Legacy loadSettings — returns flat view for backward compatibility */
export function loadSettings(): TelaudeSettings {
  const s = loadSettingsV2();
  const defaultProj = s.projects['_default'] ?? DEFAULT_PROJECT;
  const defaultSess = s.sessions['_default'];
  return {
    disabledTools: [...defaultProj.disabledTools],
    disabledMcpServers: [...defaultProj.disabledMcpServers],
    model: defaultSess?.model ?? null,
  };
}

/** Legacy saveSettings — saves to _default project/session */
export function saveSettings(settings: TelaudeSettings): void {
  const s = loadSettingsV2();
  s.projects['_default'] = {
    disabledTools: [...settings.disabledTools],
    disabledMcpServers: [...settings.disabledMcpServers],
  };
  if (settings.model) {
    const sess = s.sessions['_default'] ?? { ...DEFAULT_SESSION };
    sess.model = settings.model;
    s.sessions['_default'] = sess;
  }
  saveSettingsV2(s);
}

export function toggleTool(toolName: string, workingDir?: string): boolean {
  const key = workingDir ?? '_default';
  const s = loadSettingsV2();
  const proj = s.projects[key] ?? { ...DEFAULT_PROJECT };
  const idx = proj.disabledTools.indexOf(toolName);
  if (idx >= 0) {
    proj.disabledTools.splice(idx, 1);
  } else {
    proj.disabledTools.push(toolName);
  }
  s.projects[key] = proj;
  saveSettingsV2(s);
  return idx < 0; // true = now disabled
}

export function toggleMcpServer(serverName: string, workingDir?: string): boolean {
  const key = workingDir ?? '_default';
  const s = loadSettingsV2();
  const proj = s.projects[key] ?? { ...DEFAULT_PROJECT };
  const idx = proj.disabledMcpServers.indexOf(serverName);
  if (idx >= 0) {
    proj.disabledMcpServers.splice(idx, 1);
  } else {
    proj.disabledMcpServers.push(serverName);
  }
  s.projects[key] = proj;
  saveSettingsV2(s);
  return idx < 0; // true = now disabled
}

export function setModel(model: string | null, sessionKey?: string): void {
  const key = sessionKey ?? '_default';
  const s = loadSettingsV2();
  const sess = s.sessions[key] ?? { ...DEFAULT_SESSION };
  sess.model = model;
  s.sessions[key] = sess;
  saveSettingsV2(s);
}
