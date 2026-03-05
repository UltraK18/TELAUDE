import fs from 'fs';
import path from 'path';
import { type Context } from 'grammy';
import { getUserProcess, killProcess } from '../../claude/process-manager.js';

const RELOAD_FLAG = path.join(process.cwd(), 'data', '.reload-flag');

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
  if (process.env.NODE_ENV !== 'development') return;
  const userId = ctx.from?.id;
  if (!userId) return;

  // Leave flag so post-restart sends stdin notification
  fs.writeFileSync(RELOAD_FLAG, String(userId));

  await ctx.reply('Restarting bot process...');
  setTimeout(() => process.exit(0), 500);
}

export async function reloadSilentCommand(ctx: Context): Promise<void> {
  if (process.env.NODE_ENV !== 'development') return;
  const userId = ctx.from?.id;
  if (!userId) return;

  await ctx.reply('Restarting bot process...');
  setTimeout(() => process.exit(0), 500);
}

export function consumeReloadFlag(): number | null {
  try {
    const userId = Number(fs.readFileSync(RELOAD_FLAG, 'utf-8').trim());
    fs.unlinkSync(RELOAD_FLAG);
    return userId || null;
  } catch {
    return null;
  }
}
