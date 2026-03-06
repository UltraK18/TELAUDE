/**
 * Tool display settings loaded from ~/.telaude/telaude-mcp-settings.json.
 * Determines which tools are hidden and custom icon overrides.
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

const CONFIG_PATH = path.join(os.homedir(), '.telaude', 'telaude-mcp-settings.json');

let store = new Map<string, ToolConfig>();
let lastMtimeMs = 0;

function resolveIcon(icon: string | IconObject): string {
  if (typeof icon === 'string') return icon;
  return tge(icon.emojiId, icon.fallback);
}

/** Reload settings from file if mtime changed */
function ensureFresh(): void {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      if (store.size > 0) { store.clear(); lastMtimeMs = 0; }
      return;
    }
    const mtime = fs.statSync(CONFIG_PATH).mtimeMs;
    if (mtime !== lastMtimeMs) {
      lastMtimeMs = mtime;
      loadToolDisplaySettings();
    }
  } catch { /* ignore stat errors */ }
}

export function loadToolDisplaySettings(): void {
  store.clear();
  try {
    if (!fs.existsSync(CONFIG_PATH)) return;
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    let parsed: SettingsFile;
    try {
      parsed = JSON.parse(raw);
    } catch {
      logger.warn(`Invalid JSON in ${CONFIG_PATH}`);
      return;
    }
    if (parsed.tools && typeof parsed.tools === 'object') {
      for (const [name, config] of Object.entries(parsed.tools)) {
        store.set(name, config);
      }
    }
    lastMtimeMs = fs.statSync(CONFIG_PATH).mtimeMs;
  } catch (err) {
    logger.warn(`Failed to load tool display settings: ${err}`);
  }
}

export function isToolHidden(toolName: string): boolean {
  ensureFresh();
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

// Load settings on import
loadToolDisplaySettings();
