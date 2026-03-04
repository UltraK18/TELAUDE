import { type Context, type NextFunction } from 'grammy';
import { logger } from '../../utils/logger.js';

export async function loggingMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  const start = Date.now();
  const userId = ctx.from?.id;
  const text = ctx.message?.text;

  logger.info({
    userId,
    username: ctx.from?.username,
    text: text?.slice(0, 100),
    chatId: ctx.chat?.id,
  }, 'Incoming message');

  await next();

  logger.info({
    userId,
    duration: Date.now() - start,
  }, 'Request completed');
}
