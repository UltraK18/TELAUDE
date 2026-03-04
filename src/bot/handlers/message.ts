import { type Api, type Context } from 'grammy';
import {
  getUserProcess,
  createUserProcess,
  spawnClaudeProcess,
  sendMessage,
  type UserProcess,
} from '../../claude/process-manager.js';
import { StreamHandler } from '../../claude/stream-handler.js';
import { getUserConfig } from '../../db/config-repo.js';
import { getActiveSession } from '../../db/session-repo.js';
import { downloadTelegramFile } from '../../utils/file-downloader.js';
import { extractMediaInfo, buildMediaText } from './media-types.js';
import { MediaGroupCollector } from './media-group-collector.js';
import { updateUserChatMapping } from '../../api/route-handlers.js';
import { logger } from '../../utils/logger.js';

// Per-user message queue: messages sent while processing are queued
const messageQueues = new Map<number, { chatId: number; texts: string[] }>();

/**
 * Check if a user has an active Claude process running.
 * Used by scheduler to defer cron/heartbeat jobs.
 */
export function isUserActive(userId: number): boolean {
  const up = getUserProcess(userId);
  return up?.isProcessing ?? false;
}

// Scheduled task queue: cron/heartbeat jobs deferred while user is active
interface ScheduledTask {
  userId: number;
  chatId: number;
  text: string;
  api: Api;
  mode: 'heartbeat' | 'cron';
  model?: string;
  sessionId?: string;
  workingDir?: string;
}
const scheduledQueue: ScheduledTask[] = [];

export function enqueueScheduledTask(task: ScheduledTask): void {
  scheduledQueue.push(task);
  logger.info({ userId: task.userId, mode: task.mode, queueSize: scheduledQueue.length }, 'Scheduled task queued');
}

function getOrCreateUp(userId: number): UserProcess {
  let up = getUserProcess(userId);
  if (!up) {
    const cfg = getUserConfig(userId);
    const lastSession = getActiveSession(userId);
    up = createUserProcess(
      userId,
      lastSession?.working_dir ?? cfg.default_working_dir ?? process.cwd(),
      lastSession?.model ?? cfg.default_model,
    );
    if (lastSession) {
      up.sessionId = lastSession.session_id;
    }
  }
  return up;
}

/**
 * Launch Claude CLI, attach stream handler, and handle exit (including queue drain).
 * Returns true if spawn succeeded.
 */
function launchAndSend(
  up: UserProcess,
  text: string,
  chatId: number,
  userId: number,
  api: Api,
  resume?: string,
): boolean {
  const doLaunch = (res?: string): boolean => {
    try {
      const { process: childProc, parser } = spawnClaudeProcess(up, {
        resumeSessionId: res,
      });

      const handler = new StreamHandler(api, chatId, userId, up);
      handler.attachToParser(parser).catch(err => {
        logger.error({ err, userId }, 'Stream handler error');
      });

      childProc.on('exit', (code: number | null) => {
        // Reload: re-spawn with same session and inject reload message
        if (up.reloadPending) {
          const reloadMsg = up.reloadMessage ?? 'MCP reload complete.';
          up.reloadPending = false;
          up.reloadMessage = null;
          up.process = null;
          up.parser = null;

          const resumeId = up.sessionId ?? undefined;
          logger.info({ userId, sessionId: resumeId }, 'Reload: re-spawning Claude CLI');

          if (launchAndSend(up, reloadMsg, chatId, userId, api, resumeId)) {
            // re-launched ok — isProcessing stays true
          } else {
            up.isProcessing = false;
            api.sendMessage(chatId, '\u26A0\uFE0F Reload failed: could not restart Claude CLI.')
              .catch(() => {});
          }
          return;
        }

        if (code !== 0 && up.isProcessing) {
          // Resume failed → retry without resume (new session)
          if (res) {
            logger.info({ userId, oldSession: res }, 'Resume failed, retrying as new session');
            up.sessionId = null;
            if (doLaunch(undefined)) {
              if (!sendMessage(up, text)) {
                if (up.process) {
                  try { up.process.kill(); } catch { /* ignore */ }
                }
                up.process = null;
                up.parser = null;
                up.isProcessing = false;
                api.sendMessage(chatId, '\u274C Failed to start Claude. Try /new.')
                  .catch(() => {});
              }
              return; // retry launched, don't drain queue yet
            } else {
              up.isProcessing = false;
              api.sendMessage(chatId, '\u274C Failed to start Claude. Try /new.')
                .catch(() => {});
              return;
            }
          }
          // Non-resume failure
          up.isProcessing = false;
          api.sendMessage(chatId, '\u26A0\uFE0F Claude process exited. Please send another message.')
            .catch(() => {});
          return;
        }

        // Success (code === 0) — drain queue
        const queue = messageQueues.get(userId);
        if (queue && queue.texts.length > 0) {
          // Keep isProcessing = true, process next batch
          const combined = queue.texts.join('\n\n');
          queue.texts = [];
          messageQueues.delete(userId);
          logger.info({ userId, textLen: combined.length }, 'Processing queued messages');

          const nextResume = up.sessionId ?? undefined;
          if (launchAndSend(up, combined, chatId, userId, api, nextResume)) {
            // launched ok
          } else {
            up.isProcessing = false;
          }
        } else {
          messageQueues.delete(userId);
          up.isProcessing = false;

          // Drain scheduled queue for this user
          drainScheduledQueue(userId, api);
        }
      });

      return true;
    } catch (err) {
      logger.error({ err, userId }, 'Failed to spawn Claude process');
      return false;
    }
  };

  if (!doLaunch(resume)) {
    return false;
  }

  const sent = sendMessage(up, text);
  if (!sent) {
    if (up.process) {
      try { up.process.kill(); } catch { /* ignore */ }
    }
    up.process = null;
    up.parser = null;
    return false;
  }

  logger.info({ userId, textLen: text.length }, 'Message sent to Claude');
  return true;
}

function drainScheduledQueue(userId: number, api: Api): void {
  const idx = scheduledQueue.findIndex(t => t.userId === userId);
  if (idx === -1) return;

  const task = scheduledQueue.splice(idx, 1)[0];
  logger.info({ userId, mode: task.mode }, 'Draining scheduled task');

  const up = getOrCreateUp(userId);
  if (task.workingDir) up.workingDir = task.workingDir;

  up.isProcessing = true;
  const resumeId = task.sessionId ?? up.sessionId ?? undefined;

  const { process: childProc, parser } = spawnClaudeProcess(up, {
    resumeSessionId: resumeId,
    mode: task.mode,
    model: task.model,
  });

  const handler = new StreamHandler(api, task.chatId, userId, up, { silent: true });
  handler.attachToParser(parser).catch(err => {
    logger.error({ err, userId }, 'Silent stream handler error');
  });

  childProc.on('exit', () => {
    // Reload: re-spawn with same session
    if (up.reloadPending) {
      const reloadMsg = up.reloadMessage ?? 'MCP reload complete.';
      up.reloadPending = false;
      up.reloadMessage = null;
      up.process = null;
      up.parser = null;

      const resumeId2 = up.sessionId ?? undefined;
      logger.info({ userId, sessionId: resumeId2 }, 'Reload (scheduled): re-spawning Claude CLI');

      if (launchAndSend(up, reloadMsg, task.chatId, userId, api, resumeId2)) {
        // re-launched ok
      } else {
        up.isProcessing = false;
      }
      return;
    }

    // Send report if Claude produced any text response
    if (up.lastResponseText) {
      api.sendMessage(task.chatId, `🔔 ${up.lastResponseText}`)
        .catch(err => logger.error({ err, userId }, 'Failed to send scheduled report'));
    }
    up.silentOkCalled = false;
    up.lastResponseText = null;

    // After scheduled task completes, check for more
    const queue = messageQueues.get(userId);
    if (queue && queue.texts.length > 0) {
      const combined = queue.texts.join('\n\n');
      queue.texts = [];
      messageQueues.delete(userId);
      const nextResume = up.sessionId ?? undefined;
      launchAndSend(up, combined, task.chatId, userId, api, nextResume);
    } else {
      up.isProcessing = false;
      drainScheduledQueue(userId, api);
    }
  });

  const okTool = task.mode === 'heartbeat' ? 'heartbeat_ok()' : 'cron_ok()';
  const wrappedText = `[SCHEDULED TASK] Respond with your report first, then call ${okTool} as the very last action. Do NOT output text after calling ${okTool}. If truly nothing to report, call ${okTool} directly without responding.\n${task.text}`;
  if (!sendMessage(up, wrappedText)) {
    up.isProcessing = false;
    logger.error({ userId, mode: task.mode }, 'Failed to send scheduled message');
  }
}

/**
 * Shared: queue text if Claude is processing, otherwise launch new process.
 * Used by messageHandler, mediaHandler, and MediaGroupCollector callback.
 */
function queueOrLaunch(
  userId: number,
  chatId: number,
  text: string,
  api: Api,
): void {
  const currentUp = getUserProcess(userId);

  if (currentUp?.isProcessing) {
    let queue = messageQueues.get(userId);
    if (!queue) {
      queue = { chatId, texts: [] };
      messageQueues.set(userId, queue);
    }
    queue.texts.push(text);
    logger.info({ userId, queueSize: queue.texts.length }, 'Message queued');
    return;
  }

  const ready = getOrCreateUp(userId);
  ready.isProcessing = true;
  const resumeId = ready.sessionId ?? undefined;

  if (!launchAndSend(ready, text, chatId, userId, api, resumeId)) {
    ready.isProcessing = false;
    api.sendMessage(chatId, '\u274C Failed to start Claude CLI. Check your settings.')
      .catch(() => {});
  }
}

// Media group collector — batches files with same media_group_id
const mediaGroupCollector = new MediaGroupCollector(
  (userId, chatId, text, api) => queueOrLaunch(userId, chatId, text, api),
);

export async function messageHandler(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  const text = ctx.message?.text;

  if (!userId || !chatId || !text) return;

  // Ignore commands (handled by command handlers)
  if (text.startsWith('/')) return;

  updateUserChatMapping(userId, chatId);
  queueOrLaunch(userId, chatId, text, ctx.api);
}

export async function mediaHandler(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (!userId || !chatId) return;

  updateUserChatMapping(userId, chatId);

  const media = extractMediaInfo(ctx);
  if (!media) return;

  const caption = ctx.message?.caption ?? '';
  const mediaGroupId = ctx.message?.media_group_id;
  const up = getOrCreateUp(userId);

  // Media group → delegate to collector for batching
  if (mediaGroupId) {
    mediaGroupCollector.add(
      mediaGroupId,
      {
        fileId: media.fileId,
        mediaType: media.mediaType,
        originalFileName: media.originalFileName,
      },
      caption || undefined,
      userId,
      chatId,
      ctx.api,
      up.workingDir,
    );
    return;
  }

  // Single file → download immediately
  let savedPath: string;
  try {
    savedPath = await downloadTelegramFile(
      ctx.api, media.fileId, up.workingDir, media.originalFileName, media.mediaType,
    );
  } catch (err) {
    logger.error({ err, userId, mediaType: media.mediaType }, 'Failed to download file');
    await ctx.reply('\u274C 파일 다운로드에 실패했습니다.');
    return;
  }

  const text = buildMediaText(
    [{ mediaType: media.mediaType, savedPath }],
    caption,
  );

  queueOrLaunch(userId, chatId, text, ctx.api);
}
