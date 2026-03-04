import { type Context } from 'grammy';
import { isUserAuthorized } from '../../db/auth-repo.js';

export async function startCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  if (isUserAuthorized(userId)) {
    await ctx.reply(
      'Welcome back! Send a message to talk to Claude.\n/help to see commands.',
    );
    return;
  }

  await ctx.reply(
    'Welcome to Telaude!\n\n' +
    'A Telegram bridge for Claude Code.\n\n' +
    'Enter your auth code to get started.',
  );
}
