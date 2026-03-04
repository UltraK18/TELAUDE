import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mcpPost } from '../http-client.js';
import * as os from 'os';

export function registerSystemTools(server: McpServer): void {
  server.tool(
    'get_system_info',
    'Get system information: timezone, current time, OS, platform',
    {},
    async () => {
      const info = {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        currentTime: new Date().toISOString(),
        os: `${os.type()} ${os.release()}`,
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
      };
      return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] };
    }
  );

  server.tool(
    'reload',
    'Hot-reload Telaude configuration, cron jobs, and MCP settings. Returns reload result.',
    {},
    async () => {
      const result = await mcpPost('/mcp/reload');
      return { content: [{ type: 'text', text: `Reload complete: ${JSON.stringify(result)}` }] };
    }
  );
}
