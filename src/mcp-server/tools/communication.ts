import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mcpPost } from '../http-client.js';

export function registerCommunicationTools(server: McpServer): void {
  server.tool(
    'send_file',
    'Send a file to the user via Telegram',
    { path: z.string().describe('Absolute path to the file') },
    async ({ path }) => {
      await mcpPost('/mcp/send-file', { path });
      return { content: [{ type: 'text', text: `File sent: ${path}` }] };
    }
  );

  server.tool(
    'send_photo',
    'Send an image to the user with inline preview in Telegram',
    { path: z.string().describe('Absolute path to the image file') },
    async ({ path }) => {
      await mcpPost('/mcp/send-photo', { path });
      return { content: [{ type: 'text', text: `Photo sent: ${path}` }] };
    }
  );

  server.tool(
    'ask',
    'Ask the user a question via Telegram and wait for their reply. Times out after 5 minutes.',
    { question: z.string().describe('Question to ask the user') },
    async ({ question }) => {
      const result = await mcpPost('/mcp/ask', { question });
      return { content: [{ type: 'text', text: `User replied: ${result.answer}` }] };
    }
  );

  server.tool(
    'zip_and_send',
    'Zip a directory (respecting .gitignore) and send to the user via Telegram',
    { dir: z.string().describe('Absolute path to the directory to zip') },
    async ({ dir }) => {
      const result = await mcpPost('/mcp/zip-and-send', { dir });
      return { content: [{ type: 'text', text: `Zip sent: ${result.fileName ?? dir}` }] };
    }
  );
}
