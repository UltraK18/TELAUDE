import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerCommunicationTools } from './tools/communication.js';
import { registerSchedulingTools } from './tools/scheduling.js';
import { registerSystemTools } from './tools/system.js';
import { registerPokeTools } from './tools/poke.js';
import { registerIsolatedTools } from './tools/isolated.js';

const server = new McpServer({
  name: 'telaude',
  version: '1.0.0',
});

// Register all tool groups
registerCommunicationTools(server);
registerSchedulingTools(server);
registerSystemTools(server);
registerPokeTools(server);
registerIsolatedTools(server);

// Start with stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
