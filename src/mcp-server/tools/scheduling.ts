import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Cron } from 'croner';
import { mcpPost } from '../http-client.js';

function nowStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function nextRunStr(schedule?: string, runAt?: string): string {
  if (runAt) {
    const d = new Date(runAt);
    if (!isNaN(d.getTime())) return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  }
  if (schedule && schedule !== 'once') {
    try {
      const next = new Cron(schedule).nextRun();
      if (next) return next.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    } catch { /* ignore */ }
  }
  return '—';
}

export function registerSchedulingTools(server: McpServer): void {
  server.tool(
    'schedule_add',
    'Schedule a job. Uses system timezone. Jobs run in silent mode — output is auto-sent to user on exit. Call schedule_ok() only if nothing to report. Do NOT use ask/send_file during scheduled jobs.',
    {
      name: z.string().describe('Job name'),
      schedule: z.string().optional().describe('Cron expression for recurring jobs (e.g. "0 9 * * *")'),
      runAt: z.string().optional().describe('One-time job. Prefer relative: "1m","5m","1h","30s" (no need to check current time). Also accepts local datetime. Auto-deleted after execution.'),
      message: z.string().describe('Prompt sent to Claude when triggered'),
      workingDir: z.string().optional().describe('Working directory'),
      model: z.string().optional().describe('Model override'),
    },
    async ({ name, schedule, runAt, message, workingDir, model }) => {
      if (!schedule && !runAt) {
        return { content: [{ type: 'text', text: 'Error: provide either schedule (recurring) or runAt (one-time)' }] };
      }
      // Parse relative time (e.g. "5m", "1h", "30s") into absolute datetime
      let resolvedRunAt = runAt;
      if (runAt) {
        const match = runAt.match(/^(\d+)\s*(s|m|h)$/);
        if (match) {
          const val = parseInt(match[1], 10);
          const unit = match[2];
          const ms = unit === 's' ? val * 1000 : unit === 'm' ? val * 60000 : val * 3600000;
          resolvedRunAt = new Date(Date.now() + ms).toISOString();
        }
      }
      const once = !!resolvedRunAt;
      const finalSchedule = schedule ?? 'once';
      const result = await mcpPost('/mcp/cron/add', { name, schedule: finalSchedule, runAt: resolvedRunAt, message, workingDir, model, once });
      const next = nextRunStr(schedule, resolvedRunAt);
      return { content: [{ type: 'text', text: `Job created: ${result.jobId} (${name}) — ${once ? 'once' : `recurring: ${schedule}`}\nNow: ${nowStr()} | Next: ${next}` }] };
    }
  );

  server.tool(
    'schedule_list',
    'List all scheduled jobs',
    {
      currentWorkingDir: z.string().optional().describe('Filter jobs by working directory'),
    },
    async ({ currentWorkingDir }) => {
      const result = await mcpPost('/mcp/cron/list', { currentWorkingDir });
      const jobs = result.jobs ?? [];
      if (jobs.length === 0) {
        return { content: [{ type: 'text', text: 'No scheduled jobs' }] };
      }
      const lines = jobs.map((j: any) => {
        const next = nextRunStr(j.schedule, j.runAt);
        return `[${j.id}] ${j.name} | ${j.schedule} | ${j.isPaused ? 'PAUSED' : 'ACTIVE'} | next: ${next}`;
      });
      return { content: [{ type: 'text', text: `Now: ${nowStr()}\n${lines.join('\n')}` }] };
    }
  );

  server.tool(
    'schedule_update',
    'Update an existing scheduled job',
    {
      jobId: z.string().describe('Job ID to update'),
      name: z.string().optional().describe('New job name'),
      schedule: z.string().optional().describe('New cron expression'),
      message: z.string().optional().describe('New message'),
      workingDir: z.string().optional().describe('New working directory'),
      model: z.string().optional().describe('New model'),
    },
    async ({ jobId, ...updates }) => {
      const result = await mcpPost('/mcp/cron/update', { jobId, ...updates });
      const job = result.job;
      const next = job ? nextRunStr(job.schedule, job.runAt) : '—';
      return { content: [{ type: 'text', text: `Job ${jobId} updated\nNow: ${nowStr()} | Next: ${next}` }] };
    }
  );

  server.tool(
    'schedule_remove',
    'Delete a scheduled job',
    { jobId: z.string().describe('Job ID to delete') },
    async ({ jobId }) => {
      await mcpPost('/mcp/cron/remove', { jobId });
      return { content: [{ type: 'text', text: `Job ${jobId} deleted` }] };
    }
  );

  server.tool(
    'schedule_pause',
    'Pause a scheduled job (will not trigger until resumed)',
    { jobId: z.string().describe('Job ID to pause') },
    async ({ jobId }) => {
      await mcpPost('/mcp/cron/pause', { jobId });
      return { content: [{ type: 'text', text: `Job ${jobId} paused` }] };
    }
  );

  server.tool(
    'schedule_resume',
    'Resume a paused scheduled job',
    { jobId: z.string().describe('Job ID to resume') },
    async ({ jobId }) => {
      await mcpPost('/mcp/cron/resume', { jobId });
      return { content: [{ type: 'text', text: `Job ${jobId} resumed` }] };
    }
  );

  server.tool(
    'schedule_history',
    'View execution history for a scheduled job',
    { jobId: z.string().describe('Job ID') },
    async ({ jobId }) => {
      const result = await mcpPost('/mcp/cron/history', { jobId });
      const history = result.history ?? [];
      if (history.length === 0) {
        return { content: [{ type: 'text', text: `No execution history for job ${jobId}` }] };
      }
      const lines = history.map((h: any) =>
        `${h.timestamp} | ${h.status} | ${h.durationMs ?? 0}ms`
      );
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  server.tool(
    'schedule_completed',
    'View past completed/executed jobs (including one-time jobs that were auto-deleted)',
    {},
    async () => {
      const result = await mcpPost('/mcp/cron/completed', {});
      const jobs = result.jobs ?? [];
      if (jobs.length === 0) {
        return { content: [{ type: 'text', text: 'No completed jobs' }] };
      }
      const lines = jobs.map((j: any) =>
        `[${j.id}] ${j.name} | ${j.completedAt} | ${j.once ? 'one-time' : j.schedule} | ${j.history?.length ?? 0} runs`
      );
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );
}
