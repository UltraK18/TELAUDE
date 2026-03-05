import { type Context } from 'grammy';
import { getUserProcess, killProcess } from '../../claude/process-manager.js';

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


export async function forceReloadCommand(ctx: Context): Promise<void> {
  if (process.env.NODE_ENV !== 'development') return;
  const userId = ctx.from?.id;
  if (!userId) return;

  await ctx.reply('Restarting bot process...');
  // Allow the reply to be sent before exiting
  setTimeout(() => process.exit(0), 500);
}
