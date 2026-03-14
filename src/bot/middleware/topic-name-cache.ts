import type { Context, NextFunction } from 'grammy';
import { setTopicName } from '../../db/topic-repo.js';

/**
 * Middleware that caches topic/thread names from service messages.
 * Captures forum_topic_created and forum_topic_edited events.
 */
export async function topicNameCache(ctx: Context, next: NextFunction): Promise<void> {
  const msg = ctx.message;
  if (msg) {
    const chatId = ctx.chat?.id;
    const threadId = (msg as any).message_thread_id;

    if (chatId && threadId) {
      // forum_topic_created service message
      const created = (msg as any).forum_topic_created;
      if (created?.name) {
        setTopicName(chatId, threadId, created.name);
      }

      // forum_topic_edited service message
      const edited = (msg as any).forum_topic_edited;
      if (edited?.name) {
        setTopicName(chatId, threadId, edited.name);
      }

      // reply_to_message may contain topic info for the first message in a topic
      const reply = (msg as any).reply_to_message;
      if (reply?.forum_topic_created?.name) {
        setTopicName(chatId, threadId, reply.forum_topic_created.name);
      }
    }
  }

  return next();
}
