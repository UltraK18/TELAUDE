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
import { reactionHandler } from './handlers/reaction.js';
import { askInterceptor } from './middleware/ask-interceptor.js';
import { staleUpdateFilter } from './middleware/stale-update-filter.js';
import { generalTopicFilter } from './middleware/general-topic-filter.js';
import { topicNameCache } from './middleware/topic-name-cache.js';
import { logger } from '../utils/logger.js';

export function createBot(): Bot {
  const bot = new Bot(config.telegram.botToken);

  // Auto-retry on rate limits
  bot.api.config.use(autoRetry());

  // Error handler
  bot.catch(errorHandler);

  // Middleware chain
  bot.use(staleUpdateFilter);
  bot.use(generalTopicFilter);
  bot.use(topicNameCache);
  bot.use(loggingMiddleware);
  bot.use(rateLimitMiddleware);
  bot.use(authMiddleware);
  bot.use(askInterceptor);

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

  // Reactions on bot messages
  bot.on('message_reaction', reactionHandler);

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

  // Register command menu for autocomplete
  const commands = [
    { command: 'new', description: 'New session' },
    { command: 'resume', description: 'Resume session' },
    { command: 'rename', description: 'Rename current session' },
    { command: 'stats', description: 'Session stats & tokens' },
    { command: 'stop', description: 'Stop current task' },
    { command: 'cd', description: 'Change working directory' },
    { command: 'pwd', description: 'Current directory' },
    { command: 'projects', description: 'List allowed project paths' },
    { command: 'model', description: 'View/change model' },
    { command: 'budget', description: 'Set token budget (USD)' },
    { command: 'compact', description: 'Compress context' },
    { command: 'history', description: 'Last 5 conversation turns' },
    { command: 'help', description: 'Command list' },
    { command: 'mode', description: 'Session mode (default/minimal)' },
    { command: 'schedule', description: 'View scheduled jobs' },
    { command: 'usage', description: 'Token usage stats' },
  ];
  if (process.env['NODE_ENV'] === 'development') {
    commands.push(
      { command: 'reload', description: 'Restart bot (notify Claude)' },
      { command: 'reload_sil', description: 'Restart bot (silent)' },
    );
  }
  bot.api.setMyCommands(commands).catch(err => logger.error({ err }, 'Failed to set bot commands'));

  logger.info('Bot configured');
  return bot;
}
