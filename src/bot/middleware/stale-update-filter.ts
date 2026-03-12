import { type Context, type NextFunction } from 'grammy';
import { logger } from '../../utils/logger.js';

const STALE_THRESHOLD_SEC = 120; // 2 minutes

export async function staleUpdateFilter(ctx: Context, next: NextFunction): Promise<void> {
  const messageDate = ctx.message?.date ?? ctx.callbackQuery?.message?.date;
  if (messageDate) {
    const nowSec = Math.floor(Date.now() / 1000);
    const ageSec = nowSec - messageDate;
    if (ageSec >= STALE_THRESHOLD_SEC) {
      logger.info({ ageSec, chatId: ctx.chat?.id, userId: ctx.from?.id }, 'Dropped stale update');
      return;
    }
  }
  await next();
}
