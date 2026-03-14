import type { Api } from 'grammy';
import { getNonDmSessions, deactivateAllUserSessions } from '../db/session-repo.js';
import { logger } from '../utils/logger.js';
import { removeSession } from '../utils/dashboard.js';
import { killProcess, buildChapterKey } from '../claude/process-manager.js';

const CHECK_INTERVAL = 60_000; // 1 minute
let intervalTimer: ReturnType<typeof setInterval> | null = null;

export async function checkTopicHealth(api: Api): Promise<void> {
  const sessions = getNonDmSessions();
  logger.info({ count: sessions.length }, 'Health check running');
  for (const { chat_id, thread_id, telegram_user_id } of sessions) {
    try {
      const opts: Record<string, unknown> = {};
      if (thread_id > 0) opts.message_thread_id = thread_id;
      await api.sendChatAction(chat_id, 'typing', opts);
      logger.debug({ chat_id, thread_id }, 'Health check OK');
    } catch (err: any) {
      const code = err.error_code;
      const desc = err.description ?? '';

      // Deleted topic
      if (code === 400 && desc.includes('thread not found')) {
        logger.info({ chat_id, thread_id, telegram_user_id }, 'Topic deleted, cleaning up sessions');
        cleanup(telegram_user_id, chat_id, thread_id);
        continue;
      }

      // Bot kicked from group, group deleted, or chat not found
      if (code === 403 || (code === 400 && (desc.includes('chat not found') || desc.includes('bot was kicked')))) {
        logger.info({ chat_id, thread_id, telegram_user_id, desc }, 'Chat inaccessible, cleaning up sessions');
        cleanup(telegram_user_id, chat_id, thread_id);
        continue;
      }

      // Other errors — non-fatal
      logger.warn({ err, chat_id, thread_id }, 'Health check failed (non-fatal)');
    }
  }
}

function cleanup(userId: number, chatId: number, threadId: number): void {
  killProcess(userId, chatId, threadId);
  deactivateAllUserSessions(userId, chatId, threadId);
  removeSession(buildChapterKey(userId, chatId, threadId));
}

export function startTopicHealthChecker(api: Api): void {
  checkTopicHealth(api).catch(err => {
    logger.warn({ err }, 'Initial health check failed');
  });
  intervalTimer = setInterval(() => {
    checkTopicHealth(api).catch(err => {
      logger.warn({ err }, 'Health check failed');
    });
  }, CHECK_INTERVAL);
}

export function stopTopicHealthChecker(): void {
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
}
