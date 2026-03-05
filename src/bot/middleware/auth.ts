import { type Context, type NextFunction } from 'grammy';
import { isUserAuthorized, authorizeUser } from '../../db/auth-repo.js';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { updateUserChatMapping } from '../../api/route-handlers.js';

const PUBLIC_COMMANDS = new Set(['/start', '/auth', '/help']);

export async function authMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  // Ignore service messages (pin notifications, member joins, etc.)
  if (!ctx.message?.text && !ctx.message?.photo && !ctx.message?.document && !ctx.message?.voice && !ctx.callbackQuery) return;

  // Check if command is public
  const text = ctx.message?.text ?? '';
  const command = text.split(' ')[0];
  if (PUBLIC_COMMANDS.has(command)) {
    await next();
    return;
  }

  // Check allowlist if configured
  if (config.telegram.allowedUserIds.length > 0) {
    if (!config.telegram.allowedUserIds.includes(userId)) {
      await ctx.reply('Access denied.');
      return;
    }
  }

  // Already authorized → pass through
  if (isUserAuthorized(userId)) {
    await next();
    return;
  }

  // Not authorized: check if this message is the auth code
  const trimmed = text.trim();
  if (trimmed && !trimmed.startsWith('/')) {
    const success = await authorizeUser(
      userId,
      ctx.from?.username,
      trimmed,
      config.auth.password,
    );

    if (success) {
      const chatId = ctx.chat?.id;
      if (chatId) updateUserChatMapping(userId, chatId);
      logger.info({ userId, username: ctx.from?.username }, 'User authorized via code');
      try { await ctx.deleteMessage(); } catch { /* may lack permission */ }
      await ctx.reply(
        'Authorized! Send a message to start using Claude.\n' +
        'Type /help to see available commands.',
      );
      return;
    }
  }

  await ctx.reply('Authentication required. Enter your auth code.');
}
