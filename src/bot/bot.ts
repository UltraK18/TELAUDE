import { Bot } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import { config } from '../config.js';
import { registerCommands } from './commands/index.js';
import { authMiddleware } from './middleware/auth.js';
import { loggingMiddleware } from './middleware/logging.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import { errorHandler } from './middleware/error-handler.js';
import { messageHandler, mediaHandler } from './handlers/message.js';
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

  // Media messages → download & forward to Claude
  bot.on('message:photo', mediaHandler);
  bot.on('message:document', mediaHandler);
  bot.on('message:audio', mediaHandler);
  bot.on('message:voice', mediaHandler);
  bot.on('message:video', mediaHandler);
  bot.on('message:video_note', mediaHandler);
  bot.on('message:sticker', mediaHandler);
  bot.on('message:animation', mediaHandler);

  logger.info('Bot configured');
  return bot;
}
