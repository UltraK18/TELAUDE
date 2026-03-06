import { type Context } from 'grammy';
import { getUserProcess } from '../../claude/process-manager.js';
import { logger } from '../../utils/logger.js';

/**
 * Handle message_reaction updates.
 * Only captures reactions on the bot's last text response message (lastBotMessageId).
 * Queues emoji info to be prepended to the next user stdin.
 */
export async function reactionHandler(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const update = (ctx.update as any).message_reaction;
  if (!update) return;

  const messageId = update.message_id as number;
  const up = getUserProcess(userId);
  if (!up) return;

  // Only react to the bot's last text message
  if (up.lastBotMessageId !== messageId) return;

  // Extract new emoji reactions
  const newReactions = update.new_reaction as Array<{ type: string; emoji?: string; custom_emoji_id?: string }>;
  if (!newReactions || newReactions.length === 0) {
    // Reactions removed — clear queue
    up.reactionQueue = null;
    return;
  }

  const emojis = newReactions
    .map(r => r.emoji ?? r.custom_emoji_id ?? '')
    .filter(Boolean);

  if (emojis.length === 0) return;

  // Get message preview from lastResponseText
  const preview = up.lastResponseText
    ? up.lastResponseText.slice(0, 80).replace(/\n/g, ' ')
    : '(message)';

  up.reactionQueue = { emojis, messagePreview: preview };
  logger.info({ userId, emojis, messageId }, 'Reaction queued');
}
