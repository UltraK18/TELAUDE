import { type Context } from 'grammy';
import { getRecentSessions } from '../../db/session-repo.js';

export async function usageCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const chatId = ctx.chat?.id ?? userId;
  const threadId = (ctx.message as any)?.message_thread_id ?? 0;

  // Get sessions for this context
  const sessions = getRecentSessions(userId, 20, undefined, chatId, threadId);

  if (sessions.length === 0) {
    await ctx.reply('No session history found.');
    return;
  }

  let totalCost = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalTurns = 0;

  const lines: string[] = ['<b>Token Usage</b>\n'];

  for (const s of sessions) {
    totalCost += s.total_cost_usd;
    totalInput += s.total_input_tokens;
    totalOutput += s.total_output_tokens;
    totalTurns += s.total_turns;

    if (s.total_cost_usd > 0) {
      const name = s.session_name ?? s.session_id.slice(0, 8);
      const cost = s.total_cost_usd.toFixed(4);
      const tokens = formatTokens(s.total_input_tokens + s.total_output_tokens);
      lines.push(`\u2022 <code>${name}</code> $${cost} (${tokens})`);
    }
  }

  lines.push('');
  lines.push(`<b>Total</b>: $${totalCost.toFixed(4)}`);
  lines.push(`Input: ${formatTokens(totalInput)} | Output: ${formatTokens(totalOutput)}`);
  lines.push(`Turns: ${totalTurns}`);

  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
