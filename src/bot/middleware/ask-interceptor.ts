import { type Context, type NextFunction } from 'grammy';
import { hasPendingAsk, resolveAsk } from '../../api/ask-queue.js';

export async function askInterceptor(ctx: Context, next: NextFunction): Promise<void> {
  const userId = ctx.from?.id;
  const text = ctx.message?.text;

  // Only intercept plain text messages (not commands) when there's a pending ask
  if (userId && text && !text.startsWith('/') && hasPendingAsk(userId)) {
    resolveAsk(userId, text);
    await ctx.reply('✅ Answer sent to Claude.');
    return; // Don't pass to message handler
  }

  return next();
}
