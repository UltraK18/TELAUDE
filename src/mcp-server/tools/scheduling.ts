import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mcpPost } from '../http-client.js';

export function registerSchedulingTools(server: McpServer): void {
  server.tool(
    'cron_add',
    'Register a new scheduled job. The message will be sent to Claude as user input at the scheduled time.',
    {
      name: z.string().describe('Human-readable job name'),
      schedule: z.string().describe('Cron expression (e.g. "0 9 * * *" for daily 9am)'),
      message: z.string().describe('Message to inject as user input when triggered'),
      workingDir: z.string().optional().describe('Working directory for the Claude process'),
      model: z.string().optional().describe('Model to use (default: current model)'),
    },
    async ({ name, schedule, message, workingDir, model }) => {
      const result = await mcpPost('/mcp/cron/add', { name, schedule, message, workingDir, model });
      return { content: [{ type: 'text', text: `Job created: ${result.jobId} (${name})` }] };
    }
  );

  server.tool(
    'cron_list',
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
      const lines = jobs.map((j: any) =>
        `[${j.id}] ${j.name} | ${j.schedule} | ${j.isPaused ? 'PAUSED' : 'ACTIVE'} | dir: ${j.workingDir ?? 'default'}`
      );
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  server.tool(
    'cron_update',
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
      await mcpPost('/mcp/cron/update', { jobId, ...updates });
      return { content: [{ type: 'text', text: `Job ${jobId} updated` }] };
    }
  );

  server.tool(
    'cron_remove',
    'Delete a scheduled job',
    { jobId: z.string().describe('Job ID to delete') },
    async ({ jobId }) => {
      await mcpPost('/mcp/cron/remove', { jobId });
      return { content: [{ type: 'text', text: `Job ${jobId} deleted` }] };
    }
  );

  server.tool(
    'cron_pause',
    'Pause a scheduled job (will not trigger until resumed)',
    { jobId: z.string().describe('Job ID to pause') },
    async ({ jobId }) => {
      await mcpPost('/mcp/cron/pause', { jobId });
      return { content: [{ type: 'text', text: `Job ${jobId} paused` }] };
    }
  );

  server.tool(
    'cron_resume',
    'Resume a paused scheduled job',
    { jobId: z.string().describe('Job ID to resume') },
    async ({ jobId }) => {
      await mcpPost('/mcp/cron/resume', { jobId });
      return { content: [{ type: 'text', text: `Job ${jobId} resumed` }] };
    }
  );

  server.tool(
    'cron_history',
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
    'cron_next',
    'Check when a scheduled job will next execute',
    { jobId: z.string().describe('Job ID') },
    async ({ jobId }) => {
      const result = await mcpPost('/mcp/cron/next', { jobId });
      return { content: [{ type: 'text', text: `Next execution: ${result.next ?? 'unknown'}` }] };
    }
  );
}
