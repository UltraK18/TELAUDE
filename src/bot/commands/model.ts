import { type Context, InlineKeyboard } from 'grammy';
import { getUserProcess, killProcess } from '../../claude/process-manager.js';
import { config } from '../../config.js';
import { getActiveSession, updateSessionModel } from '../../db/session-repo.js';

export const MODEL_OPTIONS = [
  { label: 'Default', value: 'default', row: 0 },
  { label: 'Sonnet', value: 'sonnet', row: 1 },
  { label: 'Sonnet 1M', value: 'sonnet[1m]', row: 1 },
  { label: 'Opus', value: 'opus', row: 2 },
  { label: 'Opus 1M', value: 'opus[1m]', row: 2 },
  { label: 'Haiku', value: 'haiku', row: 3 },
];

export function applyModel(userId: number, chatId: number | undefined, threadId: number | undefined, modelName: string): string {
  const up = getUserProcess(userId, chatId, threadId);
  if (up?.isProcessing) {
    up.model = modelName;
    return `Model will change to <b>${modelName}</b> after current task finishes.`;
  }

  killProcess(userId, chatId, threadId);
  if (up) up.model = modelName;

  const activeSession = getActiveSession(userId, chatId, threadId);
  if (activeSession) {
    updateSessionModel(activeSession.session_id, modelName);
  }

  return `Model changed: <b>${modelName}</b>\nApplied from next message.`;
}

export function buildModelKeyboard(currentModel: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  let lastRow = -1;
  for (const opt of MODEL_OPTIONS) {
    if (opt.row !== lastRow && lastRow !== -1) keyboard.row();
    lastRow = opt.row;
    const label = opt.value === currentModel ? `✓ ${opt.label}` : opt.label;
    keyboard.text(label, `model:${opt.value}`);
  }
  return keyboard;
}

export async function modelCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const chatId = ctx.chat?.id;
  const threadId = (ctx.message as any)?.message_thread_id ?? 0;

  const text = ctx.message?.text ?? '';
  const modelName = text.replace(/^\/model\s*/, '').trim().toLowerCase();

  if (!modelName) {
    const current = getUserProcess(userId, chatId, threadId)?.model ?? config.claude.defaultModel;
    const keyboard = buildModelKeyboard(current);
    await ctx.reply(
      `Current model: <b>${current}</b>\nOr type: <code>/model model-name</code>`,
      { parse_mode: 'HTML', reply_markup: keyboard },
    );
    return;
  }

  const result = applyModel(userId, chatId, threadId, modelName);
  await ctx.reply(result, { parse_mode: 'HTML' });
}
