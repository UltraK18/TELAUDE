import fs from 'fs';
import path from 'path';
import os from 'os';

const SETTINGS_FILE = path.join(os.homedir(), '.telaude', 'data', 'settings.json');

/** Root-level defaults (new sessions inherit these) */
export interface RootSettings {
  defaultModel: string;
}

/** Project-level settings (same workingDir shares these) */
export interface ProjectSettings {
  disabledTools: string[];
  disabledMcpServers: string[];
}

/** Session-level settings (per chapterKey = userId:chatId:threadId) */
export interface ChapterSettings {
  model: string | null;
}

/** Full hierarchical settings file */
export interface TelaudeSettingsV2 {
  version: 2;
  root: RootSettings;
  projects: Record<string, ProjectSettings>;   // key = workingDir
  sessions: Record<string, ChapterSettings>;    // key = chapterKey
}

/** Flat settings view (used by TUI for display) */
export interface TelaudeSettings {
  disabledTools: string[];
  disabledMcpServers: string[];
  model: string | null;
}

const DEFAULT_ROOT: RootSettings = {
  defaultModel: 'default',
};

const DEFAULT_PROJECT: ProjectSettings = {
  disabledTools: [],
  disabledMcpServers: [],
};

const DEFAULT_CHAPTER: ChapterSettings = {
  model: null,
};

let cached: TelaudeSettingsV2 | null = null;

function ensureDataDir(): void {
  const dir = path.dirname(SETTINGS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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
      // v1 migration — old flat format, convert to v2 with empty projects/sessions
      const v1 = raw as { disabledTools?: string[]; disabledMcpServers?: string[]; model?: string };
      cached = {
        version: 2,
        root: { ...DEFAULT_ROOT },
        projects: {},
        sessions: {},
      };
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

/** Get project settings */
export function getProjectSettings(workingDir: string): ProjectSettings {
  const s = loadSettingsV2();
  return s.projects[workingDir] ?? { ...DEFAULT_PROJECT };
}

/** Get session settings */
export function getChapterSettings(chapterKey: string): ChapterSettings {
  const s = loadSettingsV2();
  return s.sessions[chapterKey] ?? { ...DEFAULT_CHAPTER };
}

/** Resolve effective settings for a session (project + session) */
export function resolveSettings(workingDir: string, chapterKey: string): {
  disabledTools: string[];
  disabledMcpServers: string[];
  model: string | null;
} {
  const s = loadSettingsV2();
  const proj = s.projects[workingDir] ?? DEFAULT_PROJECT;
  const sess = s.sessions[chapterKey] ?? DEFAULT_CHAPTER;
  return {
    disabledTools: [...proj.disabledTools],
    disabledMcpServers: [...proj.disabledMcpServers],
    model: sess.model,
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
export function updateChapterSettings(chapterKey: string, updates: Partial<ChapterSettings>): void {
  const s = loadSettingsV2();
  const current = s.sessions[chapterKey] ?? { ...DEFAULT_CHAPTER };
  s.sessions[chapterKey] = { ...current, ...updates };
  saveSettingsV2(s);
}

export function toggleTool(toolName: string, workingDir: string): boolean {
  const s = loadSettingsV2();
  const proj = s.projects[workingDir] ?? { ...DEFAULT_PROJECT };
  const idx = proj.disabledTools.indexOf(toolName);
  if (idx >= 0) {
    proj.disabledTools.splice(idx, 1);
  } else {
    proj.disabledTools.push(toolName);
  }
  s.projects[workingDir] = proj;
  saveSettingsV2(s);
  return idx < 0; // true = now disabled
}

export function toggleMcpServer(serverName: string, workingDir: string): boolean {
  const s = loadSettingsV2();
  const proj = s.projects[workingDir] ?? { ...DEFAULT_PROJECT };
  const idx = proj.disabledMcpServers.indexOf(serverName);
  if (idx >= 0) {
    proj.disabledMcpServers.splice(idx, 1);
  } else {
    proj.disabledMcpServers.push(serverName);
  }
  s.projects[workingDir] = proj;
  saveSettingsV2(s);
  return idx < 0; // true = now disabled
}

export function setModel(model: string | null, chapterKey: string): void {
  const s = loadSettingsV2();
  const sess = s.sessions[chapterKey] ?? { ...DEFAULT_CHAPTER };
  sess.model = model;
  s.sessions[chapterKey] = sess;
  saveSettingsV2(s);
}
