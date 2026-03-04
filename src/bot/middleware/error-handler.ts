import { type BotError, type Context } from 'grammy';
import { logger } from '../../utils/logger.js';

export async function errorHandler(err: BotError<Context>): Promise<void> {
  const { ctx, error } = err;
  logger.error({ error, userId: ctx.from?.id }, 'Bot error');

  try {
    await ctx.reply('An error occurred. Please try again.');
  } catch {
    // Failed to send error message, ignore
  }
}
