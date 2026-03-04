import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mcpPost } from '../http-client.js';

export function registerPokeTools(server: McpServer): void {
  server.tool(
    'poke_ok',
    'Report that poke is unnecessary (e.g. user said goodbye). Turn deleted from history. Only use during poke-mode spawn.',
    {},
    async () => {
      await mcpPost('/mcp/turn-delete', { type: 'poke' });
      return { content: [{ type: 'text', text: 'Poke OK — turn will be cleaned up' }] };
    }
  );
}
