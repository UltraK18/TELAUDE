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
import { config } from '../../config.js';
import { MediaGroupCollector } from './media-group-collector.js';
import { updateUserChatMapping } from '../../api/route-handlers.js';
import { logger, notify } from '../../utils/logger.js';
import { getSessionsMessage, clearSessionsMessage } from '../commands/session.js';
import { logMessage } from '../../db/message-log-repo.js';
import { startPokeTimer, resetPokeTimer } from '../../scheduler/poke.js';

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
  mode: 'heartbeat' | 'cron' | 'poke';
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

        // If interrupted, prepend context to queued messages and wait for next user input
        if (up.interrupted) {
          if (queue && queue.texts.length > 0) {
            const INTERRUPT_CTX = '[The user interrupted the previous task. The tool use was rejected — do not continue or retry it.]';
            queue.texts.unshift(INTERRUPT_CTX);
            // interrupted flag stays false; queueOrLaunch will drain on next user message
          }
          up.interrupted = false;
          up.isProcessing = false;
        } else if (queue && queue.texts.length > 0) {
          // Queued user messages — launch new process with context marker
          const queued = queue.texts.join('\n\n');
          queue.texts = [];
          messageQueues.delete(userId);
          const combined = `<system-reminder>The user sent new messages while you were working on the previous task. IMPORTANT: You MUST address ALL of these messages in your response:\n${queued}\n</system-reminder>`;
          logger.info({ userId, queueSize: queued.length }, 'Draining queued messages after exit');
          const nextResume = up.sessionId ?? undefined;
          if (!launchAndSend(up, combined, chatId, userId, api, nextResume)) {
            up.isProcessing = false;
          }
        } else {
          up.isProcessing = false;
          messageQueues.delete(userId);
          // Log Claude response and start poke timer (only for user conversations)
          if (up.currentMode === 'user') {
            logMessage(userId, 'claude');
            startPokeTimer(userId, up.workingDir, up.sessionId, up.lastResponseText);
          }
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

  notify(`Message → Claude (${text.length} chars)`);
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

    // Deferred turn deletion — now safe since process has exited
    if (up.pendingTurnDelete && up.sessionId) {
      import('../../scheduler/turn-deleter.js').then(({ deleteTurn }) => {
        deleteTurn(up.sessionId!, up.workingDir, up.pendingTurnDelete!).catch(err => {
          logger.error({ err, sessionId: up.sessionId }, 'Deferred turn deletion failed');
        });
      });
      up.pendingTurnDelete = null;
    }

    // Send report if Claude produced any text response (and ok wasn't called)
    if (up.lastResponseText) {
      const prefix = task.mode === 'poke' ? '' : '🔔 ';
      api.sendMessage(task.chatId, `${prefix}${up.lastResponseText}`)
        .catch(err => logger.error({ err, userId }, 'Failed to send scheduled report'));
    }
    up.silentOkCalled = false;
    up.lastResponseText = null;
    up.lastReportText = null;

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

  const okTool = task.mode === 'heartbeat' ? 'heartbeat_ok()' : task.mode === 'poke' ? 'poke_ok()' : 'schedule_ok()';
  // Poke uses the text as-is (already has system-reminder), others get wrapped
  const wrappedText = task.mode === 'poke'
    ? task.text
    : `[SCHEDULED TASK] Execute the task and respond with your report. Your response will be automatically sent to the user. Only call ${okTool} if there is truly nothing to report — it suppresses the response.\n${task.text}`;
  if (!sendMessage(up, wrappedText)) {
    up.isProcessing = false;
    logger.error({ userId, mode: task.mode }, 'Failed to send scheduled message');
  }
}

/**
 * Shared: queue text if Claude is processing, otherwise launch new process.
 * Used by messageHandler, mediaHandler, and MediaGroupCollector callback.
 */
export function queueOrLaunch(
  userId: number,
  chatId: number,
  text: string,
  api: Api,
): void {
  resetPokeTimer(userId);
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

  // Prepend interrupt context if previous task was stopped by user
  if (ready.interrupted) {
    text = `[The user interrupted the previous task. The tool use was rejected — do not continue or retry it.]\n${text}`;
    ready.interrupted = false;
  }

  ready.isProcessing = true;
  const resumeId = ready.sessionId ?? undefined;

  // Show "typing..." indicator while processing
  api.sendChatAction(chatId, 'typing').catch(() => {});
  const typingInterval = setInterval(() => {
    if (!ready.isProcessing) { clearInterval(typingInterval); return; }
    api.sendChatAction(chatId, 'typing').catch(() => {});
  }, 4500);

  if (!launchAndSend(ready, text, chatId, userId, api, resumeId)) {
    clearInterval(typingInterval);
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

  logMessage(userId, 'user');
  updateUserChatMapping(userId, chatId);

  // Delete /resume list message if present
  const smsg = getSessionsMessage(userId);
  if (smsg) {
    ctx.api.deleteMessage(smsg.chatId, smsg.messageId).catch(() => {});
    clearSessionsMessage(userId);
  }

  queueOrLaunch(userId, chatId, text, ctx.api);
}

export async function mediaHandler(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (!userId || !chatId) return;

  logMessage(userId, 'user');
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

  // Sticker → convert webp to jpg thumbnail, cache by file_unique_id
  if (media.mediaType === 'sticker') {
    const { getCachedSticker, cacheSticker } = await import('../../utils/sticker-cache.js');
    const uniqueId = media.fileUniqueId ?? media.fileId;
    const emoji = media.stickerEmoji ?? '';

    let stickerPath = getCachedSticker(uniqueId);
    if (!stickerPath) {
      try {
        // Try thumbnail first (always static webp), then fall back to original
        const fileId = media.stickerThumbnailFileId ?? media.fileId;
        const file = await ctx.api.getFile(fileId);
        const url = `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}`;
        const res = await fetch(url);
        const buffer = Buffer.from(await res.arrayBuffer());
        stickerPath = await cacheSticker(uniqueId, buffer);
      } catch (err) {
        logger.error({ err, userId }, 'Failed to convert sticker');
        const text = `[스티커 수신: ${emoji}]`;
        queueOrLaunch(userId, chatId, text, ctx.api);
        return;
      }
    }

    const text = caption
      ? `[스티커 수신: ${stickerPath}] ${emoji}\n${caption}`
      : `[스티커 수신: ${stickerPath}] ${emoji}`;
    queueOrLaunch(userId, chatId, text, ctx.api);
    return;
  }

  // All other media → download file
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
