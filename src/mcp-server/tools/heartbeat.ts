import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mcpPost } from '../http-client.js';

export function registerHeartbeatTools(server: McpServer): void {
  server.tool(
    'heartbeat_check',
    'Trigger a heartbeat check now. Returns the current HEARTBEAT.md content.',
    {},
    async () => {
      const result = await mcpPost('/mcp/heartbeat/check');
      return { content: [{ type: 'text', text: result.content ?? 'No heartbeat checklist configured' }] };
    }
  );

  server.tool(
    'heartbeat_update',
    'Update the HEARTBEAT.md checklist content',
    { checklist: z.string().describe('New HEARTBEAT.md content (markdown)') },
    async ({ checklist }) => {
      await mcpPost('/mcp/heartbeat/update', { checklist });
      return { content: [{ type: 'text', text: 'HEARTBEAT.md updated' }] };
    }
  );

  server.tool(
    'heartbeat_ok',
    'Report that the heartbeat check found nothing to report. This turn will be deleted from conversation history to save context.',
    {},
    async () => {
      await mcpPost('/mcp/turn-delete', { type: 'heartbeat' });
      return { content: [{ type: 'text', text: 'Heartbeat OK — turn will be cleaned up' }] };
    }
  );

  server.tool(
    'cron_ok',
    'Report that the cron job found nothing to report. This turn will be deleted from conversation history to save context.',
    {},
    async () => {
      await mcpPost('/mcp/turn-delete', { type: 'cron' });
      return { content: [{ type: 'text', text: 'Cron OK — turn will be cleaned up' }] };
    }
  );
}
