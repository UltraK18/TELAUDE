import fs from 'fs';
import path from 'path';
import os from 'os';
import { type Api, InputFile, InlineKeyboard } from 'grammy';
import { decryptFile, encryptFile, isEncrypted } from '../utils/machine-lock.js';
import { registerRoute } from './internal-server.js';
import { createAsk, setAskMessageId } from './ask-queue.js';
import {
  getAllJobs, getJob, addJob, updateJob, removeJob, getCompletedJobs,
} from '../scheduler/cron-store.js';
import {
  reloadAll, getNextRun, scheduleJob, unscheduleJob,
} from '../scheduler/scheduler.js';
import { getUserProcess, getActiveProcessForUser, buildSessionKey } from '../claude/process-manager.js';
import type { UserProcess } from '../claude/process-manager.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { getReceivedFiles, getReceivedFileById } from '../db/file-repo.js';

// In-memory userId → chatId mapping (updated on every message)
const userChatMap = new Map<number, number>();
const userThreadMap = new Map<number, number>();

/** Update in-memory mapping + persist to .env if needed (call on auth) */
export function updateUserChatMapping(userId: number, chatId: number): void {
  userChatMap.set(userId, chatId);

  // Persist to .env if changed or missing
  if (config.telegram.chatId !== chatId) {
    persistChatId(chatId);
  }
}

/** Lightweight in-memory only update (call on every message) */
export function setUserChat(userId: number, chatId: number, threadId?: number): void {
  userChatMap.set(userId, chatId);
  if (threadId != null) userThreadMap.set(userId, threadId);
}

export function getChatId(userId: number): number {
  return config.telegram.chatId ?? userChatMap.get(userId) ?? userId;
}

/** Write CHAT_ID to .env file (add or update, supports encrypted .env) */
function persistChatId(chatId: number): void {
  const envPath = path.join(os.homedir(), '.telaude', '.env');
  try {
    const wasEncrypted = isEncrypted(envPath);

    let content = wasEncrypted ? decryptFile(envPath) : fs.readFileSync(envPath, 'utf-8');
    if (!content) {
      logger.error('Failed to decrypt .env for CHAT_ID persistence');
      return;
    }

    if (/^CHAT_ID=/m.test(content)) {
      content = content.replace(/^CHAT_ID=.*/m, `CHAT_ID=${chatId}`);
    } else {
      content = content.replace(
        /^(TELEGRAM_BOT_TOKEN=.*)$/m,
        `$1\nCHAT_ID=${chatId}`,
      );
    }

    fs.writeFileSync(envPath, content, 'utf-8');
    if (wasEncrypted) encryptFile(envPath);

    (config.telegram as any).chatId = chatId;
    logger.info({ chatId }, 'CHAT_ID persisted to .env');
  } catch (err) {
    logger.error({ err }, 'Failed to persist CHAT_ID to .env');
  }
}

function getSessionTarget(userId: number, body: Record<string, unknown>): { chatId: number; threadId: number; up: UserProcess | undefined } {
  const chatId = (body._chatId as number) ?? getChatId(userId);
  const threadId = (body._threadId as number) ?? userThreadMap.get(userId) ?? 0;
  let up = getUserProcess(userId, chatId, threadId);
  if (!up) up = getActiveProcessForUser(userId);
  return { chatId, threadId, up };
}

function threadOpts(threadId: number, extra?: Record<string, unknown>): Record<string, unknown> {
  const opts: Record<string, unknown> = {};
  if (threadId > 0) opts.message_thread_id = threadId;
  if (extra) Object.assign(opts, extra);
  return opts;
}

/** Validate that a file path is within allowed boundaries (workingDir, homedir, tmpdir) */
function validateFilePath(filePath: string, userId: number, chatId?: number, threadId?: number): string {
  const resolved = path.resolve(filePath);
  const up = getUserProcess(userId, chatId, threadId) ?? getActiveProcessForUser(userId);
  const allowed = [
    up?.workingDir,
    os.homedir(),
    os.tmpdir(),
  ].filter(Boolean) as string[];

  const normalized = resolved.replace(/\\/g, '/').toLowerCase();
  const isAllowed = allowed.some(root => {
    const normalizedRoot = path.resolve(root).replace(/\\/g, '/').toLowerCase();
    return normalized.startsWith(normalizedRoot + '/') || normalized === normalizedRoot;
  });

  if (!isAllowed) {
    throw new Error(`Access denied: path "${filePath}" is outside allowed directories`);
  }
  return resolved;
}

/** Validate that a directory path is within allowed boundaries */
function validateDirPath(dirPath: string, userId: number): string {
  return validateFilePath(dirPath, userId);
}

/**
 * Register all route handlers. Must be called after bot is created.
 * @param api - grammY Bot API instance for sending messages
 */
export function registerAllRoutes(api: Api): void {
  // --- Communication routes ---

  registerRoute('/mcp/ask', async (body) => {
    const userId = body._userId as number;
    const { chatId, threadId } = getSessionTarget(userId, body);
    const choices: string[] | undefined = body.choices;

    // Build keyboard if choices provided
    const keyboard = choices?.length
      ? (() => {
          const kb = new InlineKeyboard();
          choices.forEach((c, i) => kb.text(c, `ask:${i}`).row());
          return kb;
        })()
      : undefined;

    // Send question (with or without buttons)
    const msg = await api.sendMessage(chatId, body.question, threadOpts(threadId, {
      reply_markup: keyboard,
    }));

    // Start waiting for answer (text or button click)
    const answerPromise = createAsk(userId, body.question, choices);
    setAskMessageId(userId, msg.message_id, chatId);

    const answer = await answerPromise;
    return { answer };
  });

  registerRoute('/mcp/send-file', async (body) => {
    const userId = body._userId as number;
    const { chatId, threadId } = getSessionTarget(userId, body);
    const filePath = validateFilePath(body.path as string, userId, chatId, threadId);

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);

    await api.sendDocument(chatId, new InputFile(fileBuffer, fileName), threadOpts(threadId));
    return { ok: true, fileName };
  });

  registerRoute('/mcp/send-photo', async (body) => {
    const userId = body._userId as number;
    const { chatId, threadId } = getSessionTarget(userId, body);
    const filePath = validateFilePath(body.path as string, userId, chatId, threadId);

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);

    await api.sendPhoto(chatId, new InputFile(fileBuffer, fileName), threadOpts(threadId));
    return { ok: true, fileName };
  });

  registerRoute('/mcp/send-sticker', async (body) => {
    const userId = body._userId as number;
    const { chatId, threadId } = getSessionTarget(userId, body);
    const stickerId = body.sticker_id as string;

    await api.sendSticker(chatId, stickerId, threadOpts(threadId));
    return { ok: true };
  });

  registerRoute('/mcp/set-reaction', async (body) => {
    const userId = body._userId as number;
    const { chatId, up } = getSessionTarget(userId, body);
    const messageId = up?.lastUserMessageId;
    if (!messageId) throw new Error('No recent user message to react to');

    const emoji = body.emoji as string;
    if (!emoji) {
      throw new Error('Missing "emoji" string (e.g. "👍")');
    }

    const reaction = [{ type: 'emoji' as const, emoji }] as any;
    await api.setMessageReaction(chatId, messageId, reaction);
    return { ok: true };
  });

  registerRoute('/mcp/zip-and-send', async (body) => {
    const userId = body._userId as number;
    const { chatId, threadId } = getSessionTarget(userId, body);
    const dirPath = validateDirPath(body.dir as string, userId);

    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      throw new Error(`Directory not found: ${dirPath}`);
    }

    const archiver = await import('archiver');
    const ignore = await import('ignore');

    // Read .gitignore if exists
    const ig = ignore.default();
    const gitignorePath = path.join(dirPath, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const patterns = fs.readFileSync(gitignorePath, 'utf-8');
      ig.add(patterns);
    }
    ig.add('.git'); // Always ignore .git

    // Create zip buffer
    const zipBuffer = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const archive = archiver.default('zip', { zlib: { level: 9 } });
      archive.on('data', (chunk: Buffer) => chunks.push(chunk));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);

      // Walk directory and add files
      const walkDir = (dir: string, prefix: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (ig.ignores(relativePath)) continue;

          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walkDir(fullPath, relativePath);
          } else {
            archive.file(fullPath, { name: relativePath });
          }
        }
      };

      walkDir(dirPath, '');
      archive.finalize();
    });

    const dirName = path.basename(dirPath);
    const fileName = `${dirName}.zip`;

    await api.sendDocument(chatId, new InputFile(zipBuffer, fileName), threadOpts(threadId));
    return { ok: true, fileName };
  });

  // --- Received files ---

  registerRoute('/mcp/files/list', async (body) => {
    const userId = body._userId as number;
    const { chatId, threadId } = getSessionTarget(userId, body);
    const fileType = body.type as string | undefined;
    const limit = (body.limit as number) ?? 50;
    const files = getReceivedFiles(userId, chatId, threadId, fileType, limit);
    return { files: files.map(f => ({ id: f.id, type: f.file_type, name: f.file_name, path: f.file_path, size: f.file_size, createdAt: f.created_at })) };
  });

  registerRoute('/mcp/files/download', async (body) => {
    const userId = body._userId as number;
    const { chatId } = getSessionTarget(userId, body);
    const fileId = body.fileId as number;
    const file = getReceivedFileById(fileId);
    if (!file) throw new Error(`File not found: ${fileId}`);
    // Verify ownership
    if (file.telegram_user_id !== userId || file.chat_id !== chatId) {
      throw new Error('Access denied: file belongs to another chat');
    }
    return { file: { id: file.id, type: file.file_type, name: file.file_name, path: file.file_path, size: file.file_size, workingDir: file.working_dir } };
  });

  // --- System info ---

  registerRoute('/mcp/system-info', async () => {
    const os = await import('os');
    return {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      currentTime: new Date().toISOString(),
      os: `${os.type()} ${os.release()}`,
      platform: os.platform(),
    };
  });

  // --- Cron routes ---

  registerRoute('/mcp/cron/add', async (body) => {
    const userId = body._userId as number;
    const { up } = getSessionTarget(userId, body);
    const job = addJob({
      name: body.name,
      schedule: body.schedule,
      message: body.message,
      workingDir: body.workingDir ?? up?.workingDir ?? process.cwd(),
      model: body.model ?? up?.model,
      userId,
      sessionId: up?.sessionId,
      once: body.once ?? false,
      runAt: body.runAt,
    });
    scheduleJob(job.id);
    return { jobId: job.id };
  });

  registerRoute('/mcp/cron/list', async (body) => {
    let jobs = getAllJobs();
    if (body.currentWorkingDir) {
      jobs = jobs.filter(j => j.workingDir === body.currentWorkingDir);
    }
    return { jobs: jobs.map(j => ({ id: j.id, name: j.name, schedule: j.schedule, isPaused: j.isPaused, workingDir: j.workingDir, runAt: j.runAt, once: j.once })) };
  });

  registerRoute('/mcp/cron/update', async (body) => {
    const { jobId, ...updates } = body;
    const job = updateJob(jobId, updates);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    scheduleJob(jobId); // Re-schedule with new settings
    return { ok: true, job: { schedule: job.schedule, runAt: job.runAt } };
  });

  registerRoute('/mcp/cron/remove', async (body) => {
    unscheduleJob(body.jobId);
    const removed = removeJob(body.jobId);
    if (!removed) throw new Error(`Job not found: ${body.jobId}`);
    return { ok: true };
  });

  registerRoute('/mcp/cron/pause', async (body) => {
    const job = updateJob(body.jobId, { isPaused: true });
    if (!job) throw new Error(`Job not found: ${body.jobId}`);
    unscheduleJob(body.jobId);
    return { ok: true };
  });

  registerRoute('/mcp/cron/resume', async (body) => {
    const job = updateJob(body.jobId, { isPaused: false });
    if (!job) throw new Error(`Job not found: ${body.jobId}`);
    scheduleJob(body.jobId);
    return { ok: true };
  });

  registerRoute('/mcp/cron/history', async (body) => {
    const job = getJob(body.jobId);
    if (job) return { history: job.history };

    // Check completed jobs archive
    const completed = getCompletedJobs().find(j => j.id === body.jobId);
    if (completed) return { history: completed.history };

    throw new Error(`Job not found: ${body.jobId}`);
  });

  registerRoute('/mcp/cron/next', async (body) => {
    const next = getNextRun(body.jobId);
    return { next: next?.toISOString() ?? null };
  });

  registerRoute('/mcp/cron/completed', async (body) => {
    const userId = body._userId as number;
    const jobs = getCompletedJobs(userId);
    return { jobs };
  });

  // --- Turn deletion ---

  registerRoute('/mcp/turn-delete', async (body) => {
    const userId = body._userId as number;
    const { up } = getSessionTarget(userId, body);
    if (up) {
      up.nothingToReport = true;
      // Preserve response for history, but prevent auto-report to Telegram
      up.lastReportText = up.lastResponseText;
      up.lastResponseText = null;
      // Mark for deferred turn deletion — JSONL will be cleaned after process exits
      up.pendingTurnDelete = body.type as 'heartbeat' | 'cron' | 'poke';
    }
    return { ok: true };
  });

  // --- Inject stdin ---

  registerRoute('/mcp/inject-stdin', async (body) => {
    const userId = body._userId as number;
    const { up } = getSessionTarget(userId, body);
    if (!up) throw new Error('No active session for this user');

    const text = body.text as string;
    if (!text) throw new Error('Missing "text" field');
    if (text.length > 100_000) throw new Error('Text too long (max 100,000 characters)');

    if (!up.process || !up.process.stdin || up.process.stdin.destroyed) {
      throw new Error('No active Claude process to inject into');
    }

    // Write directly to stdin without ending it (unlike sendMessage which calls .end())
    up.process.stdin.write(text);
    return { ok: true, length: text.length };
  });

  // --- Isolated job ---

  registerRoute('/mcp/isolated-escalate', async (body) => {
    const userId = body._userId as number;
    const { chatId, threadId } = getSessionTarget(userId, body);
    const message = body.message as string;
    if (!message) throw new Error('Missing "message" field');

    // Send escalation message to the user's chat
    await api.sendMessage(chatId, `🚨 ${message}`, threadOpts(threadId));
    return { ok: true };
  });

  // --- Pin/Unpin ---

  registerRoute('/mcp/pin-message', async (body) => {
    const userId = body._userId as number;
    const { chatId, up } = getSessionTarget(userId, body);
    const messageId = up?.lastBotMessageId;
    if (!messageId) throw new Error('No recent bot message to pin');
    await api.pinChatMessage(chatId, messageId, { disable_notification: true });
    return { ok: true };
  });

  registerRoute('/mcp/unpin-message', async (body) => {
    const userId = body._userId as number;
    const { chatId } = getSessionTarget(userId, body);
    await api.unpinAllChatMessages(chatId);
    return { ok: true };
  });

}
