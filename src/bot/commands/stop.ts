import { type Context } from 'grammy';
import { getUserProcess, killProcess, killForReload } from '../../claude/process-manager.js';

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
  if (!up?.sessionId) {
    await ctx.reply('No active session to reload.');
    return;
  }

  if (!up.process) {
    // No running process — just notify, next message will resume normally
    await ctx.reply('No running process. Session will reload on next message.');
    return;
  }

  killForReload(userId, 'Session reloaded by user.');
  await ctx.reply('Reloading session...');
}
