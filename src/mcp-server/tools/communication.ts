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
    'send_sticker',
    'Send a Telegram sticker to the user by sticker file_id',
    { sticker_id: z.string().describe('Telegram sticker file_id') },
    async ({ sticker_id }) => {
      await mcpPost('/mcp/send-sticker', { sticker_id });
      return { content: [{ type: 'text', text: 'Sticker sent' }] };
    }
  );

  server.tool(
    'ask',
    'Ask the user a question via Telegram and wait for their reply. Optionally provide choices as inline buttons. User can click a button or type freely. Times out after 5 minutes.',
    {
      question: z.string().describe('Question to ask the user'),
      choices: z.array(z.string()).optional().describe('Optional button choices (e.g. ["Yes", "No", "Skip"])'),
    },
    async ({ question, choices }) => {
      const result = await mcpPost('/mcp/ask', { question, choices });
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

  server.tool(
    'set_reaction',
    'React to the user\'s most recent message with an emoji.',
    { emoji: z.string().describe('Single emoji to react with (e.g. "👍", "❤", "🔥")') },
    async ({ emoji }) => {
      await mcpPost('/mcp/set-reaction', { emoji });
      return { content: [{ type: 'text', text: `Reacted with ${emoji}` }] };
    }
  );

  server.tool(
    'pin_message',
    'Pin the most recent bot message in the Telegram chat. Useful for important info the user should see.',
    {},
    async () => {
      await mcpPost('/mcp/pin-message', {});
      return { content: [{ type: 'text', text: 'Message pinned' }] };
    }
  );

  server.tool(
    'unpin_message',
    'Unpin all pinned messages in the Telegram chat',
    {},
    async () => {
      await mcpPost('/mcp/unpin-message', {});
      return { content: [{ type: 'text', text: 'Messages unpinned' }] };
    }
  );
}
