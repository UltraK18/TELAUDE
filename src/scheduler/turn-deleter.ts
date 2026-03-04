import fs from 'fs';
import path from 'path';
import * as os from 'os';
import { logger } from '../utils/logger.js';

/**
 * Encode a working directory path the same way Claude CLI does.
 * On Windows: D:\foo\bar → D--foo-bar
 * On Unix: /foo/bar → -foo-bar
 */
function encodeCwd(cwd: string): string {
  // Normalize path separators
  let encoded = cwd.replace(/\\/g, '/');
  // Remove trailing slash
  encoded = encoded.replace(/\/$/, '');
  // Replace colons (Windows drive), slashes, and spaces with hyphens
  encoded = encoded.replace(/:/g, '-').replace(/\//g, '-').replace(/ /g, '-');
  // Remove leading hyphen if present
  if (encoded.startsWith('-')) {
    encoded = encoded.slice(1);
  }
  return encoded;
}

/**
 * Find the JSONL file for a session.
 */
function findSessionJsonl(sessionId: string, workingDir: string): string | null {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  const encodedDir = encodeCwd(workingDir);
  const projectDir = path.join(claudeDir, encodedDir);

  // Try exact session ID
  const jsonlPath = path.join(projectDir, `${sessionId}.jsonl`);
  if (fs.existsSync(jsonlPath)) {
    return jsonlPath;
  }

  // Search in project directory for matching session
  if (!fs.existsSync(projectDir)) {
    logger.warn({ projectDir }, 'Project directory not found for turn deletion');
    return null;
  }

  // List files and find one matching the session ID
  const files = fs.readdirSync(projectDir);
  for (const file of files) {
    if (file.endsWith('.jsonl') && file.includes(sessionId)) {
      return path.join(projectDir, file);
    }
  }

  logger.warn({ sessionId, projectDir }, 'JSONL file not found for session');
  return null;
}

interface JsonlMessage {
  uuid: string;
  parentUuid?: string;
  type?: string;
  role?: string;
  message?: {
    role?: string;
    content?: string | Array<{ type: string; text?: string }>;
  };
  [key: string]: unknown;
}

/**
 * Delete the most recent heartbeat or cron turn from the JSONL file.
 * A "turn" = the injected user message + all subsequent assistant/tool messages
 * until the next user message.
 */
export async function deleteTurn(
  sessionId: string,
  workingDir: string,
  type: 'heartbeat' | 'cron',
): Promise<boolean> {
  const jsonlPath = findSessionJsonl(sessionId, workingDir);
  if (!jsonlPath) {
    logger.warn({ sessionId, type }, 'Cannot delete turn: JSONL not found');
    return false;
  }

  try {
    const content = fs.readFileSync(jsonlPath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());

    const messages: JsonlMessage[] = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter((m): m is JsonlMessage => m !== null);

    if (messages.length === 0) return false;

    // Find the last user message (most recent turn = heartbeat/cron injection)
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const role = msg.role ?? msg.message?.role;
      if (role === 'user') {
        lastUserIdx = i;
        break;
      }
    }

    if (lastUserIdx === -1) {
      logger.info({ sessionId, type }, 'No user message found to delete');
      return false;
    }

    // Collect the turn: from lastUserIdx to end (or next user message)
    const turnStart = lastUserIdx;
    let turnEnd = messages.length; // Default: to the end
    for (let i = lastUserIdx + 1; i < messages.length; i++) {
      const role = messages[i].role ?? messages[i].message?.role;
      if (role === 'user') {
        turnEnd = i;
        break;
      }
    }

    // Get the parentUuid of the deleted turn's first message
    const deletedFirstMsg = messages[turnStart];
    const parentOfDeleted = deletedFirstMsg.parentUuid;

    // Get the message after the turn (if any) to re-link
    const afterTurn = turnEnd < messages.length ? messages[turnEnd] : null;

    // Remove the turn
    const remaining = [
      ...messages.slice(0, turnStart),
      ...messages.slice(turnEnd),
    ];

    // Re-link: the first message after the deleted turn should point to
    // the parent of the deleted turn's first message
    if (afterTurn && parentOfDeleted) {
      const afterIdx = remaining.findIndex(m => m.uuid === afterTurn.uuid);
      if (afterIdx >= 0) {
        remaining[afterIdx].parentUuid = parentOfDeleted;
      }
    }

    // Write atomically
    const tmpPath = jsonlPath + '.tmp';
    const newContent = remaining.map(m => JSON.stringify(m)).join('\n') + '\n';
    fs.writeFileSync(tmpPath, newContent, 'utf-8');
    fs.renameSync(tmpPath, jsonlPath);

    logger.info({
      sessionId,
      type,
      deletedMessages: turnEnd - turnStart,
      remainingMessages: remaining.length,
    }, 'Turn deleted from JSONL');

    return true;
  } catch (err) {
    logger.error({ err, sessionId, type }, 'Failed to delete turn');
    return false;
  }
}
