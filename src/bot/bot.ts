import { Bot } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import { config } from '../config.js';
import { registerCommands } from './commands/index.js';
import { authMiddleware } from './middleware/auth.js';
import { loggingMiddleware } from './middleware/logging.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import { errorHandler } from './middleware/error-handler.js';
import { messageHandler } from './handlers/message.js';
import { callbackHandler } from './handlers/callback.js';
import { logger } from '../utils/logger.js';

export function createBot(): Bot {
  const bot = new Bot(config.telegram.botToken);

  // Auto-retry on rate limits
  bot.api.config.use(autoRetry());

  // Error handler
  bot.catch(errorHandler);

  // Middleware chain
  bot.use(loggingMiddleware);
  bot.use(rateLimitMiddleware);
  bot.use(authMiddleware);

  // Normalize commands to lowercase (e.g. /NEW → /new)
  bot.use((ctx, next) => {
    if (ctx.message?.text?.startsWith('/')) {
      const lower = ctx.message.text.toLowerCase();
      if (lower !== ctx.message.text) {
        (ctx.message as any).text = lower;
      }
    }
    return next();
  });

  // Commands
  registerCommands(bot);

  // Callback queries
  bot.on('callback_query:data', callbackHandler);

  // Text messages → Claude
  bot.on('message:text', messageHandler);

  logger.info('Bot configured');
  return bot;
}
