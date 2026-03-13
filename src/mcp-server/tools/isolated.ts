import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mcpPost } from '../http-client.js';

export function registerIsolatedTools(server: McpServer): void {
  server.tool(
    'isolated_completed',
    'Mark an isolated/scheduled job as completed with a summary. The summary will be sent to the user.',
    {
      summary: z.string().describe('Brief summary of what the job accomplished'),
    },
    async ({ summary }) => {
      // This is handled by the turn-delete mechanism — just signal completion
      await mcpPost('/mcp/turn-delete', { type: 'cron' });
      return { content: [{ type: 'text', text: `Isolated job completed. Summary: ${summary}` }] };
    }
  );

  server.tool(
    'isolated_nothing_to_report',
    'Signal that an isolated job found nothing to report. The turn will be cleaned up.',
    {},
    async () => {
      await mcpPost('/mcp/turn-delete', { type: 'cron' });
      return { content: [{ type: 'text', text: 'Isolated job: nothing to report — turn will be cleaned up' }] };
    }
  );

  server.tool(
    'isolated_escalate',
    'Escalate an urgent issue from an isolated job to the user via Telegram notification.',
    {
      message: z.string().describe('Urgent message to send to the user'),
    },
    async ({ message }) => {
      await mcpPost('/mcp/isolated-escalate', { message });
      return { content: [{ type: 'text', text: `Escalation sent: ${message}` }] };
    }
  );
}
