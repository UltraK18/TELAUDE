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
