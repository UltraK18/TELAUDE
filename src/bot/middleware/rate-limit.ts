import { type Context, type NextFunction } from 'grammy';

const userTimestamps = new Map<number, number[]>();
const MAX_REQUESTS = 30;
const WINDOW_MS = 60_000; // 1 minute

export async function rateLimitMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const now = Date.now();
  const timestamps = userTimestamps.get(userId) ?? [];

  // Remove old timestamps
  const recent = timestamps.filter(t => now - t < WINDOW_MS);

  if (recent.length >= MAX_REQUESTS) {
    await ctx.reply('Too many requests. Please wait a moment.');
    return;
  }

  recent.push(now);
  userTimestamps.set(userId, recent);

  await next();
}
