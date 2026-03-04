import fs from 'fs';
import path from 'path';
import { needsSetup, runSetup } from './setup.js';

async function main(): Promise<void> {
  // First-run setup: if no .env, launch interactive wizard
  const isFirstRun = needsSetup();
  if (isFirstRun) {
    await runSetup();
  }

  // Now load .env into process.env
  const dotenv = await import('dotenv');
  dotenv.config({ path: path.join(process.cwd(), '.env') });

  // Load config (reads from process.env)
  const { loadConfig } = await import('./config.js');
  loadConfig();

  // Suppress JSON logs during first-run setup
  if (isFirstRun) {
    process.env.LOG_LEVEL = 'silent';
  }

  // Now import everything that depends on config
  const { initDb, closeDb } = await import('./db/database.js');
  const { createBot } = await import('./bot/bot.js');
  const { cleanupIdleProcesses, getAllProcesses, killProcess } = await import('./claude/process-manager.js');
  const { logger } = await import('./utils/logger.js');

  // Initialize database
  const db = initDb();

  // Reset all auth on fresh setup (new .env = new auth code)
  if (isFirstRun) {
    db.exec('UPDATE auth_tokens SET is_authorized = 0');
  }

  // Create and start bot
  const bot = createBot();

  // Periodic cleanup of idle processes
  const cleanupInterval = setInterval(() => {
    cleanupIdleProcesses();
  }, 60_000);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');

    clearInterval(cleanupInterval);

    for (const [userId] of getAllProcesses()) {
      killProcess(userId);
    }

    await bot.stop();
    closeDb();

    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Start polling
  await bot.start({
    onStart: (botInfo) => {
      console.log(`Bot started: @${botInfo.username}`);
      if (isFirstRun) {
        console.log('Enter the auth code in Telegram to activate.');
      }
      logger.info({ username: botInfo.username }, 'Telaude bot is running!');
    },
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
