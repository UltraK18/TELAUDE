import { type Context } from 'grammy';
import { queueOrLaunch } from '../handlers/message.js';

export async function compactCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (!userId || !chatId) return;

  const args = ctx.message?.text?.replace(/^\/compact\s*/, '').trim() ?? '';
  const stdin = args ? `/compact ${args}` : '/compact';
  queueOrLaunch(userId, chatId, stdin, ctx.api);
}
