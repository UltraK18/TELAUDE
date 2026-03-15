import { type Context } from 'grammy';
import { getUserProcess } from '../../claude/process-manager.js';
import { getActiveSession } from '../../db/session-repo.js';
import { getCost } from '../../claude/cost-tracker.js';
import { escHtml } from '../../utils/html.js';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function buildProgressBar(used: number, max: number, width = 20): string {
  if (max <= 0) return '';
  const ratio = Math.min(used / max, 1);
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

export async function contextCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const chatId = ctx.chat?.id;
  const threadId = (ctx.message as any)?.message_thread_id ?? 0;

  const up = getUserProcess(userId, chatId, threadId);
  const sessionId = up?.sessionId ?? getActiveSession(userId, chatId, threadId)?.session_id;

  if (!sessionId) {
    await ctx.reply('No active session. Send a message first.');
    return;
  }

  const cost = getCost(sessionId);
  if (!cost || !cost.contextWindow) {
    await ctx.reply('No context data yet. Send a message first.');
    return;
  }

  const usedTokens = cost.inputTokens + cost.outputTokens;
  const maxTokens = cost.contextWindow;
  const pct = maxTokens > 0 ? ((usedTokens / maxTokens) * 100).toFixed(1) : '0';
  const bar = buildProgressBar(usedTokens, maxTokens);

  const lines = [
    `<b>Context Usage</b>`,
    ``,
    `<code>${bar}</code> ${pct}%`,
    `${formatTokens(usedTokens)} / ${formatTokens(maxTokens)} tokens`,
    ``,
    `Model: <b>${escHtml(cost.model)}</b>`,
    `Cost: <b>$${cost.totalCostUsd.toFixed(4)}</b>`,
    `Turns: <b>${cost.numTurns}</b>`,
    `Input: ${formatTokens(cost.inputTokens)} | Output: ${formatTokens(cost.outputTokens)}`,
  ];

  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
}
