import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from './logger.js';

export interface CliSession {
  sessionId: string;
  model: string;
  lastActive: Date;
}

/**
 * Encode a working directory path to Claude Code's project folder name.
 * D:\Development\MyProject → D--Development-Telaude-code
 */
function encodeCwd(cwd: string): string {
  // D:\path\to\dir → D--path-to-dir (Claude Code's project folder naming)
  return cwd
    .replace(/^([A-Za-z]):[\\/]/, '$1--')  // D:\ → D--
    .replace(/[\\/\s]/g, '-');              // \ and spaces → -
}

/**
 * Read the last N lines of a file efficiently (reads from end).
 */
function readLastLines(filePath: string, maxLines: number): string[] {
  const CHUNK = 4096;
  const fd = fs.openSync(filePath, 'r');
  const stat = fs.fstatSync(fd);
  const lines: string[] = [];
  let remaining = '';
  let pos = stat.size;

  while (pos > 0 && lines.length < maxLines) {
    const readSize = Math.min(CHUNK, pos);
    pos -= readSize;
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, pos);
    remaining = buf.toString('utf8') + remaining;
    const parts = remaining.split('\n');
    remaining = parts.shift()!;
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i].trim()) lines.unshift(parts[i]);
      if (lines.length >= maxLines) break;
    }
  }
  if (remaining.trim() && lines.length < maxLines) {
    lines.unshift(remaining);
  }
  fs.closeSync(fd);
  return lines;
}

/**
 * Extract model from a JSONL line (assistant type with message.model).
 */
function extractModel(line: string): string | null {
  try {
    const obj = JSON.parse(line);
    if (obj.type === 'assistant' && obj.message?.model) {
      return obj.message.model as string;
    }
  } catch { /* ignore parse errors */ }
  return null;
}

/**
 * Simplify model name for display.
 * claude-sonnet-4-6 → sonnet, claude-opus-4-6 → opus, etc.
 */
function simplifyModel(model: string): string {
  if (model.includes('opus')) return 'opus';
  if (model.includes('sonnet')) return 'sonnet';
  if (model.includes('haiku')) return 'haiku';
  return model.split('-').slice(1, 3).join('-') || model;
}

/**
 * Scan CLI session JSONL files for a given working directory.
 * Returns sessions sorted by last activity (newest first), max 10.
 */
export function scanCliSessions(workingDir: string): CliSession[] {
  const encoded = encodeCwd(workingDir);
  const projectDir = path.join(os.homedir(), '.claude', 'projects', encoded);

  if (!fs.existsSync(projectDir)) {
    return [];
  }

  const files = fs.readdirSync(projectDir).filter(f => f.endsWith('.jsonl'));
  const sessions: CliSession[] = [];

  for (const file of files) {
    const filePath = path.join(projectDir, file);
    const sessionId = file.replace('.jsonl', '');

    // Skip non-UUID filenames
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(sessionId)) {
      continue;
    }

    try {
      const stat = fs.statSync(filePath);

      // Extract model from last few lines
      let model = 'unknown';
      const lastLines = readLastLines(filePath, 10);
      for (let i = lastLines.length - 1; i >= 0; i--) {
        const m = extractModel(lastLines[i]);
        if (m) { model = simplifyModel(m); break; }
      }

      sessions.push({
        sessionId,
        model,
        lastActive: stat.mtime,
      });
    } catch (err) {
      logger.warn({ err, file }, 'Failed to read CLI session file');
    }
  }

  // Sort by last activity descending, limit 10
  sessions.sort((a, b) => b.lastActive.getTime() - a.lastActive.getTime());
  return sessions.slice(0, 10);
}
