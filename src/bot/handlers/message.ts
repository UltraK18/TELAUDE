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
import { logger } from '../../utils/logger.js';

// Per-user message queue: messages sent while processing are queued
const messageQueues = new Map<number, { chatId: number; texts: string[] }>();

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

export async function messageHandler(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  const text = ctx.message?.text;

  if (!userId || !chatId || !text) return;

  // Ignore commands (handled by command handlers)
  if (text.startsWith('/')) return;

  const up = getUserProcess(userId);

  // If processing, queue the message
  if (up?.isProcessing) {
    let queue = messageQueues.get(userId);
    if (!queue) {
      queue = { chatId, texts: [] };
      messageQueues.set(userId, queue);
    }
    queue.texts.push(text);
    logger.info({ userId, queueSize: queue.texts.length }, 'Message queued');
    return;
  }

  // Direct send — not processing
  const ready = getOrCreateUp(userId);
  ready.isProcessing = true;

  const resumeId = ready.sessionId ?? undefined;

  if (!launchAndSend(ready, text, chatId, userId, ctx.api, resumeId)) {
    ready.isProcessing = false;
    await ctx.reply('\u274C Failed to start Claude CLI. Check your settings.');
  }
}
