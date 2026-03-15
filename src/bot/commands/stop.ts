import fs from 'fs';
import path from 'path';
import os from 'os';
import { type Context } from 'grammy';
import { getUserProcess, killProcess } from '../../claude/process-manager.js';
import { stopInternalApi } from '../../api/internal-server.js';
import { logger } from '../../utils/logger.js';

const RELOAD_FLAG = path.join(os.homedir(), '.telaude', 'data', '.reload-flag');
const RELOAD_DELAY_MS = 500; // Wait for grammY to ACK the update before exit

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

  // Leave flag: userId\nsessionId\nchatId\nthreadId\nmessage
  const flagContent = [userId, sessionId, chatId ?? userId, threadId, userMsg].join('\n');
  fs.writeFileSync(RELOAD_FLAG, flagContent);

  await ctx.reply('Restarting bot process...');
  logger.info('Reload: waiting for ACK delay');
  // Wait for grammY to ACK the update, then release port and exit
  setTimeout(async () => {
    logger.info('Reload: stopping internal API');
    await stopInternalApi();
    logger.info('Reload: internal API stopped, exiting');
    process.exit(0);
  }, RELOAD_DELAY_MS);
}

export async function reloadSilentCommand(ctx: Context): Promise<void> {
  if (process.env['NODE_ENV'] !== 'development') return;
  const userId = ctx.from?.id;
  if (!userId) return;

  const chatId = ctx.chat?.id;
  const threadId = (ctx.message as any)?.message_thread_id ?? 0;

  // Write reload flag with silent marker — dev-loop restarts but no stdin injection
  // Still include chatId/threadId so Online notification routes correctly
  fs.writeFileSync(RELOAD_FLAG, [userId, '__silent__', chatId ?? userId, threadId, ''].join('\n'));

  await ctx.reply('Restarting bot process...');
  logger.info('Reload silent: waiting for ACK delay');
  setTimeout(async () => {
    logger.info('Reload silent: stopping internal API');
    await stopInternalApi();
    logger.info('Reload silent: internal API stopped, exiting');
    process.exit(0);
  }, RELOAD_DELAY_MS);
}

export function consumeReloadFlag(): { userId: number; sessionId?: string; chatId?: number; threadId?: number; message?: string } | null {
  try {
    const raw = fs.readFileSync(RELOAD_FLAG, 'utf-8').trim();
    fs.unlinkSync(RELOAD_FLAG);
    const lines = raw.split('\n');
    const userId = Number(lines[0]);
    if (!userId) return null;
    const sessionId = lines[1] || undefined;
    const chatId = Number(lines[2]) || undefined;
    const threadId = Number(lines[3]) || undefined;
    const message = lines.slice(4).join('\n').trim() || undefined;
    return { userId, sessionId, chatId, threadId, message };
  } catch {
    return null;
  }
}
