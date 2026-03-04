import { type Context, type NextFunction } from 'grammy';
import { hasPendingAsk, resolveAsk, getAskMessageInfo } from '../../api/ask-queue.js';

export async function askInterceptor(ctx: Context, next: NextFunction): Promise<void> {
  const userId = ctx.from?.id;
  const text = ctx.message?.text;

  // Only intercept plain text messages (not commands) when there's a pending ask
  if (userId && text && !text.startsWith('/') && hasPendingAsk(userId)) {
    // Get message info before resolving (resolve deletes the pending ask)
    const msgInfo = getAskMessageInfo(userId);
    resolveAsk(userId, text);

    // Remove inline keyboard if the ask had buttons
    if (msgInfo) {
      try {
        await ctx.api.editMessageReplyMarkup(msgInfo.chatId, msgInfo.messageId, { reply_markup: undefined });
      } catch { /* ignore — message may not have keyboard */ }
    }

    await ctx.reply('✅ Answer sent to Claude.');
    return; // Don't pass to message handler
  }

  return next();
}
