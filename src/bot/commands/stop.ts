import fs from 'fs';
import path from 'path';
import os from 'os';
import { type Context } from 'grammy';
import { getUserProcess, killProcess } from '../../claude/process-manager.js';

const RELOAD_FLAG = path.join(os.homedir(), '.telaude', 'data', '.reload-flag');

export async function stopCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const chatId = ctx.chat?.id;
  const threadId = (ctx.message as any)?.message_thread_id ?? 0;

  const up = getUserProcess(userId, chatId, threadId);
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
  killProcess(userId, chatId, threadId);
}


export async function reloadCommand(ctx: Context): Promise<void> {
  if (process.env['NODE_ENV'] !== 'development') return;
  const userId = ctx.from?.id;
  if (!userId) return;

  const chatId = ctx.chat?.id;
  const threadId = (ctx.message as any)?.message_thread_id ?? 0;

  // Extract message after /reload command
  const text = ctx.message?.text ?? '';
  const userMsg = text.replace(/^\/reload\s*/, '').trim();

  // Get current sessionId to persist across restart
  const up = getUserProcess(userId, chatId, threadId);
  const sessionId = up?.sessionId ?? '';

  // Leave flag: userId\nsessionId\nmessage
  const flagContent = [userId, sessionId, userMsg].join('\n');
  fs.writeFileSync(RELOAD_FLAG, flagContent);

  await ctx.reply('Restarting bot process...');
  setTimeout(() => process.exit(0), 500);
}

export async function reloadSilentCommand(ctx: Context): Promise<void> {
  if (process.env['NODE_ENV'] !== 'development') return;
  const userId = ctx.from?.id;
  if (!userId) return;

  // Write reload flag with silent marker — dev-loop restarts but no stdin injection
  fs.writeFileSync(RELOAD_FLAG, `${userId}\n__silent__`);

  await ctx.reply('Restarting bot process...');
  setTimeout(() => process.exit(0), 500);
}

export function consumeReloadFlag(): { userId: number; sessionId?: string; message?: string } | null {
  try {
    const raw = fs.readFileSync(RELOAD_FLAG, 'utf-8').trim();
    fs.unlinkSync(RELOAD_FLAG);
    const lines = raw.split('\n');
    const userId = Number(lines[0]);
    if (!userId) return null;
    const sessionId = lines[1] || undefined;
    const message = lines.slice(2).join('\n').trim() || undefined;
    return { userId, sessionId, message };
  } catch {
    return null;
  }
}
