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

  // --- Internal API ---
  const crypto = await import('crypto');
  const { startInternalApi, stopInternalApi } = await import('./api/internal-server.js');
  const { registerAllRoutes } = await import('./api/route-handlers.js');

  // Generate random token for this boot
  const apiToken = crypto.randomBytes(32).toString('hex');

  // Register route handlers (needs bot.api for Telegram operations)
  registerAllRoutes(bot.api);

  // Start Internal API server
  await startInternalApi(apiToken);

  // --- Scheduler ---
  const { startAll: startScheduler, stopAll: stopScheduler, setTriggerCallback } = await import('./scheduler/scheduler.js');
  const { isUserActive, enqueueScheduledTask } = await import('./bot/handlers/message.js');

  // Set up the trigger callback for cron jobs
  setTriggerCallback(async (job) => {
    const { spawnClaudeProcess, sendMessage: sendToProcess, getUserProcess, createUserProcess } = await import('./claude/process-manager.js');
    const { StreamHandler } = await import('./claude/stream-handler.js');

    // Check if user is active — if so, queue the task
    if (isUserActive(job.userId)) {
      enqueueScheduledTask({
        userId: job.userId,
        chatId: job.userId, // DM: userId === chatId
        text: job.message,
        api: bot.api,
        mode: 'cron',
        model: job.model,
        sessionId: job.sessionId ?? undefined,
        workingDir: job.workingDir,
      });
      return;
    }

    // Spawn in silent mode
    let up = getUserProcess(job.userId);
    if (!up) {
      up = createUserProcess(job.userId, job.workingDir, job.model ?? 'sonnet');
    }
    if (job.sessionId) up.sessionId = job.sessionId;
    up.workingDir = job.workingDir;
    up.isProcessing = true;

    const { process: childProc, parser } = spawnClaudeProcess(up, {
      resumeSessionId: job.sessionId ?? undefined,
      mode: 'cron',
      model: job.model,
    });

    const streamHandler = new StreamHandler(bot.api, job.userId, job.userId, up, { silent: true });
    streamHandler.attachToParser(parser).catch(err => {
      logger.error({ err, jobId: job.id }, 'Cron stream handler error');
    });

    // Send message to Claude stdin (wrapped with silent mode hint)
    const wrappedMessage = `[SCHEDULED TASK] Your text response will be sent to the user as a report. After responding, call cron_ok() to clean up this turn from history. Only skip responding and call cron_ok() directly if there is truly nothing to report.\n${job.message}`;
    if (!sendToProcess(up, wrappedMessage)) {
      up.isProcessing = false;
      throw new Error('Failed to send cron message to Claude');
    }

    // Wait for process to complete
    await new Promise<void>((resolve) => {
      childProc.on('exit', () => {
        // If reload pending, re-spawn with same session
        if (up!.reloadPending) {
          const reloadMsg = up!.reloadMessage ?? 'MCP reload complete.';
          up!.reloadPending = false;
          up!.reloadMessage = null;
          up!.process = null;
          up!.parser = null;

          const resumeId = up!.sessionId ?? undefined;
          logger.info({ userId: job.userId, sessionId: resumeId }, 'Reload (cron): re-spawning Claude CLI');

          const spawn2 = spawnClaudeProcess(up!, { resumeSessionId: resumeId, mode: 'cron', model: job.model });
          const sh2 = new StreamHandler(bot.api, job.userId, job.userId, up!, { silent: true });
          sh2.attachToParser(spawn2.parser).catch(() => {});

          if (sendToProcess(up!, reloadMsg)) {
            spawn2.process.on('exit', () => {
              up!.isProcessing = false;
              resolve();
            });
          } else {
            up!.isProcessing = false;
            resolve();
          }
          return;
        }

        // Send report if Claude produced any text response
        if (up!.lastResponseText) {
          bot.api.sendMessage(job.userId, `🔔 ${up!.lastResponseText}`)
            .catch(err => logger.error({ err, userId: job.userId }, 'Failed to send cron report'));
        }
        up!.silentOkCalled = false;
        up!.lastResponseText = null;

        up!.isProcessing = false;
        resolve();
      });
    });
  });

  // Start all cron jobs
  startScheduler();

  // Periodic cleanup of idle processes
  const cleanupInterval = setInterval(() => {
    cleanupIdleProcesses();
  }, 60_000);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');

    clearInterval(cleanupInterval);
    stopScheduler();

    for (const [userId] of getAllProcesses()) {
      killProcess(userId);
    }

    await stopInternalApi();
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
