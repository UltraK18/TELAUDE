import { type Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { getAllJobs } from '../../scheduler/cron-store.js';
import { getNextRun } from '../../scheduler/scheduler.js';
import { escHtml } from '../../utils/html.js';

export async function scheduleCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const jobs = getAllJobs().filter(j => j.userId === userId);

  if (jobs.length === 0) {
    await ctx.reply('No scheduled jobs. Use the schedule MCP tools to create one.');
    return;
  }

  const lines: string[] = [];
  const kb = new InlineKeyboard();

  for (const job of jobs) {
    const status = job.isPaused ? '\u23F8' : '\u25CF';
    const next = getNextRun(job.id);
    const nextStr = next ? formatTime(next) : (job.once && job.runAt ? formatTime(new Date(job.runAt)) : '\u2014');
    const schedLabel = job.once ? '1\uD68C' : (job.schedule ?? '\u2014');

    lines.push(`${status} <b>${escHtml(job.name)}</b>`);
    lines.push(`  ${schedLabel} \u2192 next: ${nextStr}`);
    lines.push(`  dir: <code>${escHtml(job.workingDir)}</code>`);
    lines.push('');

    // Toggle pause/resume button
    const toggleLabel = job.isPaused ? `\u25B6 ${job.name}` : `\u23F8 ${job.name}`;
    const toggleData = `sched:${job.isPaused ? 'resume' : 'pause'}:${job.id}`;
    // Only add if callback_data fits in 64 bytes
    if (Buffer.byteLength(toggleData) <= 64) {
      kb.text(toggleLabel, toggleData).row();
    }
  }

  await ctx.reply(lines.join('\n'), {
    parse_mode: 'HTML',
    reply_markup: jobs.length > 0 ? kb : undefined,
  });
}

function formatTime(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

