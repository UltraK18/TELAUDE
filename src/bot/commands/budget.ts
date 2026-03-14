import { type Context } from 'grammy';
import { config } from '../../config.js';

export async function budgetCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  await ctx.reply(
    `Session budget: <b>$${config.claude.defaultMaxBudgetUsd.toFixed(2)}</b>\nChange via DEFAULT_MAX_BUDGET_USD in .env`,
    { parse_mode: 'HTML' },
  );
}
