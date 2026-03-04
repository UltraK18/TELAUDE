import { type Context } from 'grammy';
import { getAllProcesses } from '../../claude/process-manager.js';
import { getRecentSessions } from '../../db/session-repo.js';

export async function statusCommand(ctx: Context): Promise<void> {
  const processes = getAllProcesses();
  const active = [...processes.values()].filter(p => p.process !== null);
  const memUsage = process.memoryUsage();

  await ctx.reply(
    `<b>Telaude Status</b>\n` +
    `Active processes: ${active.length}\n` +
    `Total user processes: ${processes.size}\n` +
    `Memory: ${(memUsage.heapUsed / 1024 / 1024).toFixed(1)}MB / ${(memUsage.heapTotal / 1024 / 1024).toFixed(1)}MB\n` +
    `Uptime: ${formatUptime(process.uptime())}`,
    { parse_mode: 'HTML' },
  );
}

export async function costCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const sessions = getRecentSessions(userId, 100);
  const totalCost = sessions.reduce((sum, s) => sum + s.total_cost_usd, 0);
  const totalTurns = sessions.reduce((sum, s) => sum + s.total_turns, 0);

  await ctx.reply(
    `<b>Total Cost</b>\n` +
    `Cost: $${totalCost.toFixed(4)}\n` +
    `Turns: ${totalTurns}\n` +
    `Sessions: ${sessions.length}`,
    { parse_mode: 'HTML' },
  );
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}
