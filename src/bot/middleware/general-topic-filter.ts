import { type Context, type NextFunction } from 'grammy';
import { logger } from '../../utils/logger.js';

/**
 * Block all activity in the "General" topic when the chat uses topics/forums.
 * Forces users to interact in named topics only.
 *
 * Applies to:
 * - DM topic mode (is_topic_message field present on other messages)
 * - Group forums (chat.is_forum === true)
 *
 * message_reaction updates lack thread info, so they pass through.
 */
export async function generalTopicFilter(ctx: Context, next: NextFunction): Promise<void> {
  // Allow message_reaction through (no thread info available)
  if ((ctx.update as any).message_reaction) {
    await next();
    return;
  }

  const chat = ctx.chat;
  const msg = ctx.message ?? ctx.callbackQuery?.message;

  if (!chat || !msg) {
    await next();
    return;
  }

  const isForumChat = (chat as any).is_forum === true;
  const isTopicMessage = (msg as any).is_topic_message === true;
  const messageThreadId = (msg as any).message_thread_id;

  // Not a topic/forum chat → pass through
  if (!isForumChat && !isTopicMessage) {
    await next();
    return;
  }

  // In topic/forum mode: block messages without a thread (General topic)
  if (!messageThreadId && !isTopicMessage) {
    logger.debug({ chatId: chat.id, userId: ctx.from?.id }, 'Blocked message in General topic');
    return;
  }

  await next();
}
