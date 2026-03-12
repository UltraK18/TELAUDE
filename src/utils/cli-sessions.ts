import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from './logger.js';

export interface CliSession {
  sessionId: string;
  model: string;
  lastActive: Date;
  customTitle?: string;
}

/**
 * Encode a working directory path to Claude Code's project folder name.
 * e.g. C:\Users\foo\project → C--Users-foo-project
 */
function encodeCwd(cwd: string): string {
  // C:\path\to\dir → C--path-to-dir (Claude Code's project folder naming)
  return cwd
    .replace(/^([A-Za-z]):[\\/]/, '$1--')  // D:\ → D--
    .replace(/[\\/\s]/g, '-');              // \ and spaces → -
}

/**
 * Read the last N bytes of a file, split into complete lines.
 * Discards the first (potentially incomplete) line.
 */
function readLastBytes(filePath: string, bytes: number): string[] {
  const stat = fs.statSync(filePath);
  const readSize = Math.min(bytes, stat.size);
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(readSize);
  fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
  fs.closeSync(fd);
  const text = buf.toString('utf8');
  const lines = text.split('\n').filter(l => l.trim());
  // If we didn't read from the start, discard first (likely incomplete) line
  if (readSize < stat.size && lines.length > 0) lines.shift();
  return lines;
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
 * Extract customTitle from a JSONL line.
 * Claude Code's /rename appends a {"type":"custom-title","customTitle":"...","sessionId":"..."} record.
 */
function extractCustomTitle(line: string): string | null {
  try {
    const obj = JSON.parse(line);
    if (obj.type === 'custom-title' && typeof obj.customTitle === 'string' && obj.customTitle) {
      return obj.customTitle;
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Read customTitle for a single session by scanning its JSONL file.
 * Returns null if no custom-title record found.
 */
export function readCustomTitle(sessionId: string, workingDir: string): string | null {
  const encoded = encodeCwd(workingDir);
  const filePath = path.join(os.homedir(), '.claude', 'projects', encoded, `${sessionId}.jsonl`);
  if (!fs.existsSync(filePath)) return null;

  try {
    const lastLines = readLastLines(filePath, 20);
    for (let i = lastLines.length - 1; i >= 0; i--) {
      const t = extractCustomTitle(lastLines[i]);
      if (t !== null) return t || null; // empty string → cleared → null
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Append a custom-title record to a JSONL session file.
 * This is equivalent to running /rename in Claude Code native.
 */
export function writeCustomTitle(sessionId: string, customTitle: string | null, workingDir: string): void {
  const encoded = encodeCwd(workingDir);
  const filePath = path.join(os.homedir(), '.claude', 'projects', encoded, `${sessionId}.jsonl`);
  if (!fs.existsSync(filePath)) return;

  if (customTitle === null) {
    // Clearing: append empty custom-title to override previous
    const record = JSON.stringify({ type: 'custom-title', customTitle: '', sessionId });
    fs.appendFileSync(filePath, record + '\n', 'utf-8');
  } else {
    const record = JSON.stringify({ type: 'custom-title', customTitle, sessionId });
    fs.appendFileSync(filePath, record + '\n', 'utf-8');
  }
}

export interface ConversationTurn {
  user: string;
  assistant: string;
}

/**
 * Read the last N conversation turns from a session JSONL file.
 * A turn = user text message + first assistant text response that follows.
 * Skips tool_use/tool_result blocks, only includes human-readable text.
 */
export function readConversationHistory(sessionId: string, workingDir: string, turns: number = 5): ConversationTurn[] {
  const encoded = encodeCwd(workingDir);
  const filePath = path.join(os.homedir(), '.claude', 'projects', encoded, `${sessionId}.jsonl`);
  if (!fs.existsSync(filePath)) return [];

  try {
    // Read last ~1MB of the file to capture enough turns (tool calls inflate size)
    const lines = readLastBytes(filePath, 1024 * 1024);

    // Collect user text messages and assistant text messages in order
    const userMsgs: string[] = [];
    const assistantMsgs: string[][] = []; // assistantMsgs[i] = texts after userMsgs[i]

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'user' && obj.message?.role === 'user') {
          const content = obj.message.content;
          // Only plain text, skip tool_result arrays and system-injected messages
          if (typeof content === 'string' && content.trim() && !content.startsWith('<')) {
            userMsgs.push(content.trim());
            assistantMsgs.push([]);
          }
        } else if (obj.type === 'assistant' && obj.message?.role === 'assistant' && userMsgs.length > 0) {
          const content = obj.message.content;
          if (Array.isArray(content)) {
            const textParts = content
              .filter((c: any) => c.type === 'text' && c.text)
              .map((c: any) => c.text.trim())
              .filter(Boolean);
            if (textParts.length > 0) {
              // Append to the most recent user's assistant responses
              assistantMsgs[assistantMsgs.length - 1].push(textParts.join('\n'));
            }
          }
        }
      } catch { /* skip malformed lines */ }
    }

    // Pair: user message with first assistant text response
    const result: ConversationTurn[] = [];
    for (let i = 0; i < userMsgs.length; i++) {
      result.push({
        user: userMsgs[i],
        assistant: assistantMsgs[i].length > 0 ? assistantMsgs[i][0] : '(waiting…)',
      });
    }

    return result.slice(-turns);
  } catch {
    return [];
  }
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

      // Extract model and customTitle from last few lines
      let model = 'unknown';
      let customTitle: string | undefined;
      const lastLines = readLastLines(filePath, 10);
      for (let i = lastLines.length - 1; i >= 0; i--) {
        if (model === 'unknown') {
          const m = extractModel(lastLines[i]);
          if (m) model = simplifyModel(m);
        }
        if (customTitle === undefined) {
          const t = extractCustomTitle(lastLines[i]);
          if (t !== null) customTitle = t || undefined; // empty string → cleared
        }
        if (model !== 'unknown' && customTitle !== undefined) break;
      }

      sessions.push({
        sessionId,
        model,
        lastActive: stat.mtime,
        customTitle,
      });
    } catch (err) {
      logger.warn({ err, file }, 'Failed to read CLI session file');
    }
  }

  // Sort by last activity descending, limit 10
  sessions.sort((a, b) => b.lastActive.getTime() - a.lastActive.getTime());
  return sessions.slice(0, 10);
}
