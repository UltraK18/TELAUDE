import { type Context } from 'grammy';
import { getUserConfig, upsertUserConfig } from '../../db/config-repo.js';

export async function budgetCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const text = ctx.message?.text ?? '';
  const amount = text.replace(/^\/budget\s*/, '').trim();

  const cfg = getUserConfig(userId);

  if (!amount) {
    await ctx.reply(
      `Session budget: <b>$${cfg.max_budget_usd.toFixed(2)}</b>\nChange: /budget <amount>`,
      { parse_mode: 'HTML' },
    );
    return;
  }

  const value = parseFloat(amount);
  if (isNaN(value) || value <= 0) {
    await ctx.reply('Enter a valid amount. e.g. /budget 10.0');
    return;
  }

  upsertUserConfig(userId, { max_budget_usd: value });
  await ctx.reply(`Budget set: <b>$${value.toFixed(2)}</b>`, { parse_mode: 'HTML' });
}
