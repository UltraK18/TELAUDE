import { type Context } from 'grammy';
import { authorizeUser, isUserAuthorized } from '../../db/auth-repo.js';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';

export async function authCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  if (isUserAuthorized(userId)) {
    await ctx.reply('Already authorized.');
    return;
  }

  const text = ctx.message?.text ?? '';
  const password = text.replace(/^\/auth\s*/, '').trim();

  if (!password) {
    await ctx.reply('Usage: /auth <code>');
    return;
  }

  // Delete the message containing the password for security
  try {
    await ctx.deleteMessage();
  } catch {
    // May not have permission to delete
  }

  const success = await authorizeUser(
    userId,
    ctx.from?.username,
    password,
    config.auth.password,
  );

  if (success) {
    logger.info({ userId, username: ctx.from?.username }, 'User authorized');
    await ctx.reply(
      'Authorized! Send a message to start using Claude.\n' +
      'Type /help to see available commands.',
    );
  } else {
    logger.warn({ userId }, 'Auth failed');
    await ctx.reply('Auth failed. Check your code.\nMax 3 attempts per hour.');
  }
}
