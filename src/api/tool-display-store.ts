/**
 * Tool display settings loaded from telaude-mcp-settings.json.
 * Priority: project .telaude/telaude-mcp-settings.json > global ~/.telaude/telaude-mcp-settings.json
 * Hot-reloads on mtime change.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { logger } from '../utils/logger.js';

interface IconObject {
  emojiId: string;
  fallback: string;
}

interface ToolConfig {
  hidden?: boolean;
  icon?: string | IconObject;
}

interface SettingsFile {
  tools?: Record<string, ToolConfig>;
}

/** Generate premium emoji HTML tag */
function tge(emojiId: string, fallback: string): string {
  return `<tg-emoji emoji-id="${emojiId}">${fallback}</tg-emoji>`;
}

const CONFIG_NAME = 'telaude-mcp-settings.json';
const GLOBAL_PATH = path.join(os.homedir(), '.telaude', CONFIG_NAME);

let store = new Map<string, ToolConfig>();
let lastGlobalMtimeMs = 0;
let lastProjectMtimeMs = 0;
let lastProjectDir = '';

function resolveIcon(icon: string | IconObject): string {
  if (typeof icon === 'string') return icon;
  return tge(icon.emojiId, icon.fallback);
}

function getProjectPath(): string {
  return path.join(process.cwd(), '.telaude', CONFIG_NAME);
}

function getMtime(filePath: string): number {
  try {
    if (fs.existsSync(filePath)) return fs.statSync(filePath).mtimeMs;
  } catch { /* ignore */ }
  return 0;
}

function loadFromFile(filePath: string): Map<string, ToolConfig> {
  const result = new Map<string, ToolConfig>();
  try {
    if (!fs.existsSync(filePath)) return result;
    const raw = fs.readFileSync(filePath, 'utf-8');
    let parsed: SettingsFile;
    try {
      parsed = JSON.parse(raw);
    } catch {
      logger.warn(`Invalid JSON in ${filePath}`);
      return result;
    }
    if (parsed.tools && typeof parsed.tools === 'object') {
      for (const [name, config] of Object.entries(parsed.tools)) {
        result.set(name, config);
      }
    }
  } catch (err) {
    logger.warn(`Failed to load tool display settings from ${filePath}: ${err}`);
  }
  return result;
}

/** Reload settings if any file changed or cwd changed */
function ensureFresh(): void {
  try {
    const projectPath = getProjectPath();
    const cwd = process.cwd();
    const globalMtime = getMtime(GLOBAL_PATH);
    const projectMtime = getMtime(projectPath);

    if (
      globalMtime === lastGlobalMtimeMs &&
      projectMtime === lastProjectMtimeMs &&
      cwd === lastProjectDir
    ) return;

    lastGlobalMtimeMs = globalMtime;
    lastProjectMtimeMs = projectMtime;
    lastProjectDir = cwd;

    // Load global first, then project overrides
    store = loadFromFile(GLOBAL_PATH);
    const projectStore = loadFromFile(projectPath);
    for (const [name, config] of projectStore) {
      store.set(name, config);
    }
  } catch { /* ignore */ }
}

export function isToolHidden(toolName: string): boolean {
  ensureFresh();
  const exact = store.get(toolName);
  if (exact?.hidden) return true;

  const mcpMatch = toolName.match(/^mcp__[^_]+__(.+)$/);
  if (mcpMatch) {
    const suffix = store.get(mcpMatch[1]);
    if (suffix?.hidden) return true;
  }

  return false;
}

export function getToolCustomIcon(toolName: string): string | undefined {
  ensureFresh();
  const exact = store.get(toolName);
  if (exact?.icon) return resolveIcon(exact.icon);

  const mcpMatch = toolName.match(/^mcp__[^_]+__(.+)$/);
  if (mcpMatch) {
    const suffix = store.get(mcpMatch[1]);
    if (suffix?.icon) return resolveIcon(suffix.icon);
  }

  return undefined;
}

// Initial load
ensureFresh();
