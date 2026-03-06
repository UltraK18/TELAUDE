import fs from 'fs';
import path from 'path';
import { type Context } from 'grammy';
import { getUserProcess, killProcess } from '../../claude/process-manager.js';

const RELOAD_FLAG = path.join(process.cwd(), '.telaude', 'data', '.reload-flag');

export async function stopCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const up = getUserProcess(userId);
  if (!up?.process) {
    await ctx.reply('No active task.');
    return;
  }

  // If text follows /stop, clear existing queue and register stop message
  const text = (ctx.message?.text ?? '').replace(/^\/stop\s*/, '').trim();
  if (text) {
    up.stopMessage = text;
  }

  up.interrupted = true;
  killProcess(userId);
}


export async function reloadCommand(ctx: Context): Promise<void> {
  if (process.env.NODE_ENV !== 'development') return;
  const userId = ctx.from?.id;
  if (!userId) return;

  // Extract message after /reload command
  const text = ctx.message?.text ?? '';
  const userMsg = text.replace(/^\/reload\s*/, '').trim();

  // Leave flag so post-restart sends stdin notification (userId\nmessage)
  fs.writeFileSync(RELOAD_FLAG, userMsg ? `${userId}\n${userMsg}` : String(userId));

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

export function consumeReloadFlag(): { userId: number; message?: string } | null {
  try {
    const raw = fs.readFileSync(RELOAD_FLAG, 'utf-8').trim();
    fs.unlinkSync(RELOAD_FLAG);
    const [uidStr, ...rest] = raw.split('\n');
    const userId = Number(uidStr);
    if (!userId) return null;
    const message = rest.join('\n').trim() || undefined;
    return { userId, message };
  } catch {
    return null;
  }
}
