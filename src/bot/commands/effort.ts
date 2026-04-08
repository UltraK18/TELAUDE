import { type Context, InlineKeyboard } from 'grammy';
import { getUserProcess, buildChapterKey } from '../../claude/process-manager.js';
import { updateChapterSettings, getChapterSettings } from '../../settings/settings-store.js';
import { escHtml } from '../../utils/html.js';

export const EFFORT_OPTIONS = [
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Max', value: 'max' },
];

export function applyEffort(userId: number, chatId: number | undefined, threadId: number | undefined, level: string): string {
  const up = getUserProcess(userId, chatId, threadId);
  if (up) up.effort = level;

  const chapterKey = buildChapterKey(userId, chatId, threadId);
  updateChapterSettings(chapterKey, { effort: level });

  return `Effort changed: <b>${escHtml(level)}</b>\nApplied from next message.`;
}

export function buildEffortKeyboard(currentEffort: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const opt of EFFORT_OPTIONS) {
    const label = opt.value === currentEffort ? `✓ ${opt.label}` : opt.label;
    keyboard.text(label, `effort:${opt.value}`);
  }
  return keyboard;
}

export async function effortCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const chatId = ctx.chat?.id;
  const threadId = (ctx.message as any)?.message_thread_id ?? 0;

  const text = ctx.message?.text ?? '';
  const level = text.replace(/^\/effort\s*/, '').trim().toLowerCase();

  if (!level) {
    const chapterKey = buildChapterKey(userId, chatId, threadId);
    const current = getUserProcess(userId, chatId, threadId)?.effort
      ?? getChapterSettings(chapterKey).effort
      ?? 'high';
    const keyboard = buildEffortKeyboard(current);
    await ctx.reply(
      `Current effort: <b>${escHtml(current)}</b>`,
      { parse_mode: 'HTML', reply_markup: keyboard },
    );
    return;
  }

  const valid = EFFORT_OPTIONS.map(o => o.value);
  if (!valid.includes(level)) {
    await ctx.reply(`Invalid effort level. Use: ${valid.join(', ')}`, { parse_mode: 'HTML' });
    return;
  }

  const result = applyEffort(userId, chatId, threadId, level);
  await ctx.reply(result, { parse_mode: 'HTML' });
}
