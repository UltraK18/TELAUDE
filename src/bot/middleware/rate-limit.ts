import { type Context, type NextFunction } from 'grammy';
import { buildSessionKey } from '../../claude/process-manager.js';

const sessionTimestamps = new Map<string, number[]>();
const MAX_REQUESTS = 30;
const WINDOW_MS = 60_000; // 1 minute

export async function rateLimitMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const chatId = ctx.chat?.id ?? userId;
  const threadId = (ctx.message ?? ctx.callbackQuery?.message as any)?.message_thread_id ?? 0;
  const key = buildSessionKey(userId, chatId, threadId);

  const now = Date.now();
  const timestamps = sessionTimestamps.get(key) ?? [];

  // Remove old timestamps
  const recent = timestamps.filter(t => now - t < WINDOW_MS);

  if (recent.length >= MAX_REQUESTS) {
    await ctx.reply('Too many requests. Please wait a moment.');
    return;
  }

  recent.push(now);
  sessionTimestamps.set(key, recent);

  await next();
}
