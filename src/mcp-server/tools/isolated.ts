import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mcpPost } from '../http-client.js';

export function registerIsolatedTools(server: McpServer): void {
  server.tool(
    'escalate_to_main',
    'Escalate an urgent issue to the main session. Sends a Telegram notification AND injects the message into the main session stdin so the main Claude can act on it.',
    {
      message: z.string().describe('Message to escalate — will be sent to Telegram and injected into main session'),
    },
    async ({ message }) => {
      await mcpPost('/mcp/escalate-to-main', { message });
      return { content: [{ type: 'text', text: `Escalated to main session: ${message}` }] };
    }
  );

  // schedule_nothing_to_report is registered in scheduling.ts (shared by main and isolated jobs)
}
