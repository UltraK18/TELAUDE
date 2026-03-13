import { type Context } from 'grammy';
import { getUserProcess } from '../../claude/process-manager.js';

const MODES = ['default', 'minimal'] as const;
type SessionMode = typeof MODES[number];

export async function modeCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const chatId = ctx.chat!.id;
  const threadId = (ctx.message as any)?.message_thread_id ?? 0;
  const up = getUserProcess(userId, chatId, threadId);
  if (!up) {
    await ctx.reply('No active session. Send a message first.');
    return;
  }

  const text = ctx.message?.text ?? '';
  const arg = text.replace(/^\/mode\s*/i, '').trim().toLowerCase();

  if (!arg) {
    await ctx.reply(
      `Current mode: <b>${up.mode}</b>\n\n` +
      `<b>default</b> — Full system prompts (CLAUDE.md + all modules)\n` +
      `<b>minimal</b> — Stripped prompts (no CLAUDE.md)\n\n` +
      `Usage: /mode default | /mode minimal\n` +
      `Applied on next message.`,
      { parse_mode: 'HTML' },
    );
    return;
  }

  if (!MODES.includes(arg as SessionMode)) {
    await ctx.reply(`Unknown mode: ${arg}\nAvailable: default, minimal`);
    return;
  }

  up.mode = arg as SessionMode;
  await ctx.reply(`Mode set to <b>${arg}</b>. Applied on next message.`, { parse_mode: 'HTML' });
}
