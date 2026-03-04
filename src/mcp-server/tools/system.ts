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
    'Restart the Claude CLI process with fresh MCP configuration. Use after installing MCP servers, changing claude config, or modifying settings. The current CLI process will be killed and re-spawned with the same session (--resume). A confirmation message will be injected so you can verify changes.',
    { message: z.string().optional().describe('Custom message to inject after restart (default: generic reload confirmation)') },
    async ({ message }) => {
      const result = await mcpPost('/mcp/reload', { message });
      return { content: [{ type: 'text', text: `Reload initiated: ${JSON.stringify(result)}` }] };
    }
  );
}
