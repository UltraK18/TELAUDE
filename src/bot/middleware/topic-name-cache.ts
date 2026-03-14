import type { Context, NextFunction } from 'grammy';
import { setTopicName, setChatName } from '../../db/topic-repo.js';

/**
 * Middleware that caches chat/topic names.
 * - Group/channel names from ctx.chat.title
 * - Topic names from forum_topic_created/edited service messages
 */
export async function topicNameCache(ctx: Context, next: NextFunction): Promise<void> {
  const chat = ctx.chat;
  const msg = ctx.message;

  // Cache group/channel name from chat title
  if (chat?.id && (chat as any).title) {
    setChatName(chat.id, (chat as any).title);
  }

  if (msg) {
    const chatId = chat?.id;
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
