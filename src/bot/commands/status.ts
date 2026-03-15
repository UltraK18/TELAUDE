import { type Context } from 'grammy';
import { execSync } from 'child_process';
import { getAllProcesses, getUserProcess } from '../../claude/process-manager.js';
import { getActiveSession } from '../../db/session-repo.js';
import { getCost } from '../../claude/cost-tracker.js';
import packageJson from '../../../package.json';

function getGitInfo(): { branch: string; commit: string } {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    return { branch, commit };
  } catch {
    return { branch: 'unknown', commit: 'unknown' };
  }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export async function statsCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const chatId = ctx.chat?.id;
  const threadId = (ctx.message as any)?.message_thread_id ?? 0;

  const up = getUserProcess(userId, chatId, threadId);
  const dbSession = getActiveSession(userId, chatId, threadId);

  // Session section
  let sessionBlock: string;
  if (up?.sessionId || dbSession) {
    const sessionId = up?.sessionId ?? dbSession?.session_id ?? '(none)';
    const model = up?.model ?? dbSession?.model ?? 'unknown';
    const dir = up?.workingDir ?? dbSession?.session_root ?? 'unknown';
    const processing = up?.isProcessing ? 'processing' : 'idle';

    const cost = getCost(sessionId);
    const input = cost?.inputTokens ?? dbSession?.total_input_tokens ?? 0;
    const output = cost?.outputTokens ?? dbSession?.total_output_tokens ?? 0;
    const totalCost = cost?.totalCostUsd ?? dbSession?.total_cost_usd ?? 0;
    const turns = cost?.numTurns ?? dbSession?.total_turns ?? 0;

    sessionBlock =
      `<b>Session</b>\n` +
      `ID: <code>${sessionId.slice(0, 8)}...</code> | ${model} | ${processing}\n` +
      `Dir: <code>${dir}</code>\n` +
      `Tokens: ${formatTokens(input)} in / ${formatTokens(output)} out\n` +
      `Cost: $${totalCost.toFixed(4)} | ${turns} turns`;
  } else {
    sessionBlock = `<b>Session</b>\nNo active session.`;
  }

  // System section
  const processes = getAllProcesses();
  const active = [...processes.values()].filter(p => p.process !== null);
  const mem = process.memoryUsage();

  const git = getGitInfo();
  const systemBlock =
    `<b>System</b>\n` +
    `Version: <b>${packageJson.version}</b> (<code>${git.branch}</code> @ <code>${git.commit}</code>)\n` +
    `Processes: ${active.length} active / ${processes.size} total\n` +
    `Memory: ${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB\n` +
    `Uptime: ${formatUptime(process.uptime())}`;

  await ctx.reply(`${sessionBlock}\n\n${systemBlock}`, { parse_mode: 'HTML' });
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}
