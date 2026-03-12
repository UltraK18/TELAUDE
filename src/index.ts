import path from 'path';
// Force production mode in compiled exe — prevents dev-only features (reload, etc.)
// from activating when NODE_ENV leaks from the parent terminal session
const isBunExe = /\.exe$/i.test(process.execPath) && !process.execPath.toLowerCase().includes('bun');
if (isBunExe) process.env.NODE_ENV = 'production';
process.title = 'TELAUDE';
import { needsSetup, runSetup } from './setup.js';

// MCP server mode: when invoked as `TELAUDE.exe --mcp`, run MCP server only
if (process.argv.includes('--mcp')) {
  await import('./mcp-server/index.js');
  // MCP server runs until parent process kills it — never reaches main()
} else {

async function main(): Promise<void> {
  // First-run setup: if no .env, launch interactive wizard
  const isFirstRun = needsSetup();
  if (isFirstRun) {
    await runSetup();
    // Restart process with clean terminal state for TUI
    const { spawn } = await import('child_process');
    const child = spawn(process.argv[0], process.argv.slice(1), {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => process.exit(code ?? 0));
    return;
  }

  // Now load .env into process.env (supports encrypted .env)
  const dotenv = await import('dotenv');
  const { decryptFile } = await import('./utils/machine-lock.js');
  const os = await import('os');
  const envPath = path.join(os.homedir(), '.telaude', '.env');
  const envContent = decryptFile(envPath);
  if (envContent === null) {
    console.error('Failed to decrypt .env — wrong machine or corrupted file.');
    process.exit(1);
  }
  const parsed = dotenv.parse(envContent);
  for (const [key, value] of Object.entries(parsed)) {
    process.env[key] = value;
  }

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
  const { logger, notify, setDashboardOutput } = await import('./utils/logger.js');
  const { initDashboard, dashboardLog, dashboardError, updateSession, updateSchedule, setStatusCheckers } = await import('./utils/dashboard.js');

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
  const { registerAllRoutes, getChatId } = await import('./api/route-handlers.js');

  // Generate random token for this boot
  const apiToken = crypto.randomBytes(32).toString('hex');

  // Register route handlers (needs bot.api for Telegram operations)
  registerAllRoutes(bot.api);

  // Start Internal API server
  await startInternalApi(apiToken);

  // --- Scheduler ---
  const { startAll: startScheduler, stopAll: stopScheduler, setTriggerCallback } = await import('./scheduler/scheduler.js');
  const { setPokeCallback, stopAllPokes } = await import('./scheduler/poke.js');
  const { isUserActive, enqueueScheduledTask } = await import('./bot/handlers/message.js');

  // Set up the trigger callback for cron jobs
  setTriggerCallback(async (job) => {
    const { spawnClaudeProcess, sendMessage: sendToProcess, getUserProcess, createUserProcess } = await import('./claude/process-manager.js');
    const { StreamHandler } = await import('./claude/stream-handler.js');

    // Check if user is active — if so, queue the task
    if (isUserActive(job.userId)) {
      enqueueScheduledTask({
        userId: job.userId,
        chatId: getChatId(job.userId),
        text: job.message,
        api: bot.api,
        mode: 'cron',
        model: job.model,
        sessionId: job.sessionId ?? undefined,
        workingDir: job.workingDir,
      });
      return null;
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

    const streamHandler = new StreamHandler(bot.api, getChatId(job.userId), job.userId, up, { silent: true });
    streamHandler.attachToParser(parser).catch(err => {
      logger.error({ err, jobId: job.id }, 'Cron stream handler error');
    });

    // Send message to Claude stdin (wrapped with silent mode hint)
    const wrappedMessage = `[SCHEDULED TASK] Execute the task and respond with your report. Your response will be automatically sent to the user. Only call schedule_nothing_to_report() if there is truly nothing to report — it suppresses the response.\n${job.message}`;
    if (!sendToProcess(up, wrappedMessage)) {
      up.isProcessing = false;
      throw new Error('Failed to send cron message to Claude');
    }

    // Wait for process to complete and capture response
    const response = await new Promise<string | null>((resolve) => {
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
          const sh2 = new StreamHandler(bot.api, getChatId(job.userId), job.userId, up!, { silent: true });
          sh2.attachToParser(spawn2.parser).catch(() => {});

          if (sendToProcess(up!, reloadMsg)) {
            spawn2.process.on('exit', () => {
              up!.isProcessing = false;
              resolve(up!.lastResponseText);
            });
          } else {
            up!.isProcessing = false;
            resolve(null);
          }
          return;
        }

        // Deferred turn deletion — now safe since process has exited
        if (up!.pendingTurnDelete && up!.sessionId) {
          import('./scheduler/turn-deleter.js').then(({ deleteTurn }) => {
            deleteTurn(up!.sessionId!, up!.workingDir, up!.pendingTurnDelete!).catch(err => {
              logger.error({ err, sessionId: up!.sessionId }, 'Deferred turn deletion failed');
            });
          });
          up!.pendingTurnDelete = null;
        }

        // lastResponseText = text before nothing_to_report; lastReportText = text preserved after
        const responseText = up!.lastResponseText ?? up!.lastReportText;

        // Send report if Claude produced any text response (and nothing_to_report wasn't called)
        if (up!.lastResponseText) {
          bot.api.sendMessage(getChatId(job.userId), `🔔 ${up!.lastResponseText}`)
            .catch(err => logger.error({ err, userId: job.userId }, 'Failed to send cron report'));
        }
        up!.nothingToReport = false;
        up!.lastResponseText = null;
        up!.lastReportText = null;

        up!.isProcessing = false;
        resolve(responseText);
      });
    });
    return response;
  });

  // --- Poke (proactive follow-up) ---
  setPokeCallback(async (userId, stdin, workingDir, sessionId) => {
    const { spawnClaudeProcess, sendMessage: sendToProcess, getUserProcess, createUserProcess } = await import('./claude/process-manager.js');
    const { StreamHandler } = await import('./claude/stream-handler.js');
    const { getUserConfig } = await import('./db/config-repo.js');

    if (isUserActive(userId)) {
      enqueueScheduledTask({
        userId,
        chatId: getChatId(userId),
        text: stdin,
        api: bot.api,
        mode: 'poke',
        workingDir,
      });
      return;
    }

    const userModel = getUserConfig(userId).default_model;
    let up = getUserProcess(userId);
    if (!up) {
      up = createUserProcess(userId, workingDir, userModel);
    }
    if (sessionId && !up.sessionId) up.sessionId = sessionId;
    up.workingDir = workingDir;
    up.isProcessing = true;
    up.currentMode = 'poke';

    const { process: childProc, parser } = spawnClaudeProcess(up, {
      resumeSessionId: up.sessionId ?? undefined,
      mode: 'poke',
    });

    const streamHandler = new StreamHandler(bot.api, getChatId(userId), userId, up, { silent: true });
    streamHandler.attachToParser(parser).catch(err => {
      logger.error({ err, userId }, 'Poke stream handler error');
    });

    if (!sendToProcess(up, stdin)) {
      up.isProcessing = false;
      up.currentMode = 'user';
      throw new Error('Failed to send poke message to Claude');
    }

    await new Promise<void>((resolve) => {
      childProc.on('exit', () => {
        if (up!.pendingTurnDelete && up!.sessionId) {
          import('./scheduler/turn-deleter.js').then(({ deleteTurn }) => {
            deleteTurn(up!.sessionId!, up!.workingDir, up!.pendingTurnDelete!).catch(err => {
              logger.error({ err, sessionId: up!.sessionId }, 'Deferred poke turn deletion failed');
            });
          });
          up!.pendingTurnDelete = null;
        }

        if (up!.lastResponseText) {
          bot.api.sendMessage(getChatId(userId), up!.lastResponseText)
            .catch(err => logger.error({ err, userId }, 'Failed to send poke message'));
        }
        up!.nothingToReport = false;
        up!.lastResponseText = null;
        up!.lastReportText = null;
        up!.isProcessing = false;
        up!.currentMode = 'user';
        resolve();
      });
    });
  });

  // Start all cron jobs
  startScheduler();

  // Prepare dashboard schedule refresh (called after initDashboard in onStart)
  const { getAllJobs: getAllCronJobs, setOnChange } = await import('./scheduler/cron-store.js');
  const { getNextRunTimes } = await import('./scheduler/scheduler.js');
  const refreshScheduleDashboard = () => {
    const jobs = getAllCronJobs();
    const nextRuns = getNextRunTimes();
    updateSchedule(jobs.map(j => {
      const nextRun = nextRuns.get(j.id) ?? (j.once && j.runAt ? new Date(j.runAt) : null);
      return { name: j.name, schedule: j.schedule, isPaused: j.isPaused, once: j.once, runAt: j.runAt, nextRun };
    }));
  };
  setOnChange(refreshScheduleDashboard);

  // Pre-load modules for initial dashboard display
  const { getAuthorizedUserIds: getAuthIds } = await import('./db/auth-repo.js');
  const { getActiveSession: getActive, getRecentSessions: getRecent } = await import('./db/session-repo.js');
  const { loadSettings: loadSets } = await import('./settings/settings-store.js');
  const { config: cfg } = await import('./config.js');
  const { pokeExists: pokeFileExists } = await import('./scheduler/poke.js');
  const { heartbeatExists: hbFileExists } = await import('./scheduler/heartbeat.js');

  // Periodic cleanup of idle processes + sticker cache
  const { cleanStickerCache } = await import('./utils/sticker-cache.js');
  cleanStickerCache(); // clean on startup
  const cleanupInterval = setInterval(() => {
    cleanupIdleProcesses();
  }, 60_000);
  setInterval(() => cleanStickerCache(), 24 * 60 * 60 * 1000); // daily

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');

    clearInterval(cleanupInterval);
    stopScheduler();
    stopAllPokes();

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
    allowed_updates: ['message', 'callback_query', 'message_reaction'],
    onStart: (botInfo) => {
      // Initialize TUI dashboard
      initDashboard();
      setDashboardOutput(dashboardLog, dashboardError);

      // Load last session from DB for initial dashboard display
      const authIds = getAuthIds();
      let lastDir = cfg.paths.defaultWorkingDir;
      let lastModel = loadSets().model ?? cfg.claude.defaultModel;
      let lastSessionId: string | null = null;

      for (const uid of authIds) {
        const active = getActive(uid);
        if (active) {
          lastDir = active.working_dir;
          lastModel = active.model;
          lastSessionId = active.session_id;
          break;
        }
        const recent = getRecent(uid, 1);
        if (recent.length > 0) {
          lastDir = recent[0].working_dir;
          lastModel = recent[0].model;
          lastSessionId = recent[0].session_id;
          break;
        }
      }

      updateSession({
        botUsername: botInfo.username,
        model: lastModel,
        dir: lastDir,
        ...(lastSessionId ? { id: lastSessionId } : {}),
      });
      notify(`Bot online: @${botInfo.username}`);
      if (isFirstRun) {
        notify('Enter the auth code in Telegram to activate.');
      }
      refreshScheduleDashboard();

      // Status bar: heartbeat & poke indicators (use last session dir)
      setStatusCheckers(() => ({
        heartbeat: hbFileExists(lastDir),
        poke: pokeFileExists(lastDir),
      }));

      logger.info({ username: botInfo.username }, 'Telaude bot is running!');

      // Notify authorized users on dev restart
      if (process.env.NODE_ENV === 'development') {
        import('./db/auth-repo.js').then(({ getAuthorizedUserIds }) => {
          for (const uid of getAuthorizedUserIds()) {
            bot.api.sendMessage(getChatId(uid), '<tg-emoji emoji-id="5336985409220001678">✅</tg-emoji> Telaude Online', { parse_mode: 'HTML' }).catch(() => {});
          }
        });

        // Send reload notification to Claude session if /reload was used (not /reload_sil)
        import('./bot/commands/stop.js').then(({ consumeReloadFlag }) => {
          const flag = consumeReloadFlag();
          if (flag && flag.message !== '__silent__') {
            const stdin = flag.message
              ? `[The user has restarted the application]\nUser said: ${flag.message}`
              : '[The user has restarted the application]';
            import('./bot/handlers/message.js').then(({ queueOrLaunch }) => {
              queueOrLaunch(flag.userId, getChatId(flag.userId), stdin, bot.api);
            });
          }
        });
      }
    },
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

} // end of else (non-MCP mode)
