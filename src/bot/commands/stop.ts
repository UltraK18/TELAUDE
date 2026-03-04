import { type Context } from 'grammy';
import { getUserProcess, killProcess, killForReload } from '../../claude/process-manager.js';
import { getActiveSession } from '../../db/session-repo.js';

export async function stopCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const up = getUserProcess(userId);
  if (!up?.process) {
    await ctx.reply('No active task.');
    return;
  }

  up.interrupted = true;
  killProcess(userId);
}

export async function reloadCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const up = getUserProcess(userId);
  const sessionId = up?.sessionId ?? getActiveSession(userId)?.session_id;

  if (!sessionId) {
    await ctx.reply('No active session to reload.');
    return;
  }

  if (!up?.process) {
    await ctx.reply('No running process. Session will resume on next message.');
    return;
  }

  killForReload(userId, 'Session reloaded by user.');
  await ctx.reply('Reloading session...');
}

export async function forceReloadCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  await ctx.reply('Restarting bot process...');
  // Allow the reply to be sent before exiting
  setTimeout(() => process.exit(0), 500);
}
