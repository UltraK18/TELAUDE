import fs from 'fs';
import path from 'path';
import { type Api, InputFile, InlineKeyboard } from 'grammy';
import { registerRoute } from './internal-server.js';
import { createAsk, setAskMessageId } from './ask-queue.js';
import { readHeartbeat, writeHeartbeat } from '../scheduler/heartbeat.js';
import {
  getAllJobs, getJob, addJob, updateJob, removeJob, getCompletedJobs,
} from '../scheduler/cron-store.js';
import {
  reloadAll, getNextRun, scheduleJob, unscheduleJob,
} from '../scheduler/scheduler.js';
import { getUserProcess, killForReload } from '../claude/process-manager.js';
import { logger } from '../utils/logger.js';

// In-memory userId → chatId mapping (updated on every message)
const userChatMap = new Map<number, number>();

export function updateUserChatMapping(userId: number, chatId: number): void {
  userChatMap.set(userId, chatId);
}

function getChatId(userId: number): number {
  return userChatMap.get(userId) ?? userId; // DM: userId === chatId
}

/**
 * Register all route handlers. Must be called after bot is created.
 * @param api - grammY Bot API instance for sending messages
 */
export function registerAllRoutes(api: Api): void {
  // --- Communication routes ---

  registerRoute('/mcp/ask', async (body) => {
    const userId = body._userId as number;
    const chatId = getChatId(userId);
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
    const msg = await api.sendMessage(chatId, `❓ ${body.question}`, {
      reply_markup: keyboard,
    });

    // Start waiting for answer (text or button click)
    const answerPromise = createAsk(userId, body.question, choices);
    setAskMessageId(userId, msg.message_id, chatId);

    const answer = await answerPromise;
    return { answer };
  });

  registerRoute('/mcp/send-file', async (body) => {
    const userId = body._userId as number;
    const chatId = getChatId(userId);
    const filePath = body.path as string;

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);

    await api.sendDocument(chatId, new InputFile(fileBuffer, fileName));
    return { ok: true, fileName };
  });

  registerRoute('/mcp/send-photo', async (body) => {
    const userId = body._userId as number;
    const chatId = getChatId(userId);
    const filePath = body.path as string;

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);

    await api.sendPhoto(chatId, new InputFile(fileBuffer, fileName));
    return { ok: true, fileName };
  });

  registerRoute('/mcp/zip-and-send', async (body) => {
    const userId = body._userId as number;
    const chatId = getChatId(userId);
    const dirPath = body.dir as string;

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

    await api.sendDocument(chatId, new InputFile(zipBuffer, fileName));
    return { ok: true, fileName };
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

  // --- Heartbeat routes ---

  registerRoute('/mcp/heartbeat/check', async (body) => {
    const userId = body._userId as number;
    const up = getUserProcess(userId);
    const workingDir = up?.workingDir ?? process.cwd();
    const content = readHeartbeat(workingDir);
    return { content };
  });

  registerRoute('/mcp/heartbeat/update', async (body) => {
    const userId = body._userId as number;
    const up = getUserProcess(userId);
    const workingDir = up?.workingDir ?? process.cwd();
    writeHeartbeat(workingDir, body.checklist);
    return { ok: true };
  });

  // --- Cron routes ---

  registerRoute('/mcp/cron/add', async (body) => {
    const userId = body._userId as number;
    const up = getUserProcess(userId);
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
    return { jobs: jobs.map(j => ({ id: j.id, name: j.name, schedule: j.schedule, isPaused: j.isPaused, workingDir: j.workingDir })) };
  });

  registerRoute('/mcp/cron/update', async (body) => {
    const { jobId, ...updates } = body;
    const job = updateJob(jobId, updates);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    scheduleJob(jobId); // Re-schedule with new settings
    return { ok: true };
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
    if (!job) throw new Error(`Job not found: ${body.jobId}`);
    return { history: job.history };
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
    const { deleteTurn } = await import('../scheduler/turn-deleter.js');
    const userId = body._userId as number;
    const up = getUserProcess(userId);
    if (up) {
      up.silentOkCalled = true;
      // Preserve response for history, but prevent auto-report to Telegram
      up.lastReportText = up.lastResponseText;
      up.lastResponseText = null;
    }
    if (up?.sessionId && up?.workingDir) {
      await deleteTurn(up.sessionId, up.workingDir, body.type);
    }
    return { ok: true };
  });

  // --- Reload ---

  registerRoute('/mcp/reload', async (body) => {
    const userId = body._userId as number;
    const up = getUserProcess(userId);
    if (!up?.process) {
      return { ok: false, error: 'No active Claude CLI process to reload' };
    }

    // Also reload cron jobs
    reloadAll();

    // Schedule kill after HTTP response is sent (MCP server needs to receive the response first)
    setTimeout(() => {
      killForReload(userId, body.message);
    }, 300);

    return { ok: true, message: 'Claude CLI will restart with updated MCP configuration. A confirmation message will be injected into the new session.' };
  });
}
