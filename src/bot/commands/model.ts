import { type Context } from 'grammy';
import { getUserProcess, killProcess } from '../../claude/process-manager.js';
import { getUserConfig, upsertUserConfig } from '../../db/config-repo.js';

const VALID_MODELS = ['sonnet', 'opus', 'haiku'];

export async function modelCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const text = ctx.message?.text ?? '';
  const modelName = text.replace(/^\/model\s*/, '').trim().toLowerCase();

  if (!modelName) {
    const current = getUserProcess(userId)?.model ?? getUserConfig(userId).default_model;
    await ctx.reply(
      `Current model: <b>${current}</b>\nAvailable: ${VALID_MODELS.join(', ')}\nChange: <code>/model name</code>`,
      { parse_mode: 'HTML' },
    );
    return;
  }

  if (!VALID_MODELS.includes(modelName)) {
    await ctx.reply(`Invalid model. Available: ${VALID_MODELS.join(', ')}`);
    return;
  }

  // Kill current process since model change requires new process
  killProcess(userId);
  upsertUserConfig(userId, { default_model: modelName });

  const up = getUserProcess(userId);
  if (up) up.model = modelName;

  await ctx.reply(`Model changed: <b>${modelName}</b>\nApplied from next message.`, { parse_mode: 'HTML' });
}
