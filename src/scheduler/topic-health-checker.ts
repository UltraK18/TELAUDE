import type { Api } from 'grammy';
import { getThreadSessions, deactivateAllUserSessions } from '../db/session-repo.js';
import { logger } from '../utils/logger.js';
import { removeSession } from '../utils/dashboard.js';
import { killProcess, buildSessionKey } from '../claude/process-manager.js';

const CHECK_INTERVAL = 300_000; // 5 minutes
let intervalTimer: ReturnType<typeof setInterval> | null = null;

export async function checkTopicHealth(api: Api): Promise<void> {
  const threads = getThreadSessions();
  for (const { chat_id, thread_id, telegram_user_id } of threads) {
    try {
      await api.sendChatAction(chat_id, 'typing', { message_thread_id: thread_id });
    } catch (err: any) {
      if (err.error_code === 400 && err.description?.includes('thread not found')) {
        logger.info({ chat_id, thread_id, telegram_user_id }, 'Topic deleted, cleaning up sessions');
        killProcess(telegram_user_id, chat_id, thread_id);
        deactivateAllUserSessions(telegram_user_id, chat_id, thread_id);
        removeSession(buildSessionKey(telegram_user_id, chat_id, thread_id));
      } else {
        logger.warn({ err, chat_id, thread_id }, 'Topic health check failed (non-fatal)');
      }
    }
  }
}

export function startTopicHealthChecker(api: Api): void {
  checkTopicHealth(api).catch(err => {
    logger.warn({ err }, 'Initial topic health check failed');
  });
  intervalTimer = setInterval(() => {
    checkTopicHealth(api).catch(err => {
      logger.warn({ err }, 'Topic health check failed');
    });
  }, CHECK_INTERVAL);
}

export function stopTopicHealthChecker(): void {
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
}
