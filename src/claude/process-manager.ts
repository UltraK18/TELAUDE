import { spawn, ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { config } from '../config.js';
import { logger, notify } from '../utils/logger.js';
import { StreamParser, type ResultEvent } from './stream-parser.js';
import { getApiToken, getApiPort } from '../api/internal-server.js';
import { loadSettings } from '../settings/settings-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function buildSessionKey(userId: number, chatId?: number, threadId?: number): string {
  return `${userId}:${chatId ?? userId}:${threadId ?? 0}`;
}

export interface UserProcess {
  telegramUserId: number;
  chatId: number;
  threadId: number;
  process: ChildProcess | null;
  parser: StreamParser | null;
  sessionId: string | null;
  workingDir: string;
  model: string;
  isProcessing: boolean;
  lastActivity: number;
  /** Set to true when reload is requested — exit handler should re-spawn with same session */
  reloadPending: boolean;
  /** Message to inject via stdin after reload re-spawn */
  reloadMessage: string | null;
  /** Set to true when schedule_nothing_to_report is called — silent exit won't send response */
  nothingToReport: boolean;
  /** Last response text from Claude (used by silent mode to send on exit if nothing_to_report not called) */
  lastResponseText: string | null;
  /** Preserved response text after nothing_to_report (for history, not sent to user) */
  lastReportText: string | null;
  /** Deferred turn deletion — JSONL cleaned after process exits to avoid race condition */
  pendingTurnDelete: 'heartbeat' | 'cron' | 'poke' | null;
  /** Set by /stop — stream_end keeps tool message with ❌ instead of deleting */
  interrupted: boolean;
  /** Current spawn mode — used by exit handler to decide poke timer behavior */
  currentMode: 'user' | 'heartbeat' | 'cron' | 'poke';
  /** Last bot message ID in Telegram (for pin/unpin) */
  lastBotMessageId: number | null;
  /** Message from /stop <text> — sent as new input after process exits */
  stopMessage: string | null;
  /** Last user message ID in Telegram (for set_reaction) */
  lastUserMessageId: number | null;
  /** Queued reactions from user on bot's last text message */
  reactionQueue: { emojis: string[]; messagePreview: string } | null;
  /** Session mode — default uses full prompts, minimal strips CLAUDE.md */
  mode: 'default' | 'minimal';
}

const processes = new Map<string, UserProcess>();

// --- Isolated processes (for scheduled/cron jobs that run independently) ---
const isolatedProcesses = new Map<string, UserProcess>();
let isolatedCount = 0;
const MAX_ISOLATED = 3;

export function createIsolatedProcess(
  userId: number,
  workingDir: string,
  model: string,
  chatId?: number,
  threadId?: number,
): UserProcess | null {
  if (isolatedCount >= MAX_ISOLATED) return null;

  const id = `isolated_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const cid = chatId ?? userId;
  const tid = threadId ?? 0;
  const up: UserProcess = {
    telegramUserId: userId,
    chatId: cid,
    threadId: tid,
    process: null,
    parser: null,
    sessionId: null,
    workingDir,
    model,
    isProcessing: false,
    lastActivity: Date.now(),
    reloadPending: false,
    reloadMessage: null,
    nothingToReport: false,
    lastResponseText: null,
    lastReportText: null,
    pendingTurnDelete: null,
    interrupted: false,
    currentMode: 'user',
    lastBotMessageId: null,
    stopMessage: null,
    lastUserMessageId: null,
    reactionQueue: null,
    mode: 'default',
  };
  isolatedProcesses.set(id, up);
  isolatedCount++;
  return up;
}

export function removeIsolatedProcess(id: string): void {
  if (isolatedProcesses.delete(id)) {
    isolatedCount = Math.max(0, isolatedCount - 1);
  }
}

export function getIsolatedCount(): number {
  return isolatedCount;
}

export function getIsolatedProcess(id: string): UserProcess | undefined {
  return isolatedProcesses.get(id);
}

export function killAllIsolated(): void {
  for (const [id, up] of isolatedProcesses) {
    if (up.process) {
      try {
        const pid = up.process.pid;
        if (pid && process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
        } else {
          up.process.kill('SIGTERM');
        }
      } catch { /* ignore */ }
      up.process = null;
      up.parser = null;
    }
  }
  isolatedProcesses.clear();
  isolatedCount = 0;
}

export function getUserProcess(userId: number, chatId?: number, threadId?: number): UserProcess | undefined {
  const key = buildSessionKey(userId, chatId, threadId);
  return processes.get(key);
}

export function getAllProcesses(): Map<string, UserProcess> {
  return processes;
}

export function createUserProcess(
  userId: number,
  workingDir: string,
  model: string,
  chatId?: number,
  threadId?: number,
): UserProcess {
  const cid = chatId ?? userId;
  const tid = threadId ?? 0;
  const key = buildSessionKey(userId, cid, tid);
  const up: UserProcess = {
    telegramUserId: userId,
    chatId: cid,
    threadId: tid,
    process: null,
    parser: null,
    sessionId: null,
    workingDir,
    model,
    isProcessing: false,
    lastActivity: Date.now(),
    reloadPending: false,
    reloadMessage: null,
    nothingToReport: false,
    lastResponseText: null,
    lastReportText: null,
    pendingTurnDelete: null,
    interrupted: false,
    currentMode: 'user',
    lastBotMessageId: null,
    stopMessage: null,
    lastUserMessageId: null,
    reactionQueue: null,
    mode: 'default',
  };
  processes.set(key, up);
  return up;
}

export interface SpawnOptions {
  resumeSessionId?: string;
  mode?: 'user' | 'heartbeat' | 'cron' | 'poke';
  model?: string;
}

export function spawnClaudeProcess(up: UserProcess, opts?: SpawnOptions): { process: ChildProcess; parser: StreamParser } {
  const settings = loadSettings();
  // Priority: opts.model (scheduled tasks) > up.model (/model command) > settings.model (TUI) > fallback
  const model = opts?.model ?? up.model ?? settings.model ?? 'default';

  const args = [
    '--verbose',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--dangerously-skip-permissions',
  ];

  // 'default' = let CLI use its native default model (currently Opus 4.6 1M)
  if (model !== 'default') {
    args.push('--model', model);
  }

  if (opts?.resumeSessionId) {
    args.push('--resume', opts.resumeSessionId);
  }

  // MCP config for telaude tools
  // Detect runtime: compiled exe uses itself with --mcp flag, dev uses bun + source
  const isBunExe = !!process.execPath && /\.exe$/i.test(process.execPath) && !process.execPath.toLowerCase().includes('bun');
  let mcpCommand: string;
  let mcpArgs: string[];
  if (isBunExe) {
    // Single binary mode: re-invoke self with --mcp
    mcpCommand = process.execPath;
    mcpArgs = ['--mcp'];
  } else {
    // Dev/source mode: bun run the TS source directly
    const tsPath = path.resolve(__dirname, '..', 'mcp-server', 'index.ts');
    const jsPath = tsPath.replace(/\.ts$/, '.js');
    mcpCommand = 'bun';
    mcpArgs = [fs.existsSync(tsPath) ? tsPath : jsPath];
  }

  // Shared env for Telaude internal API — injected into all MCP servers
  const telaudeEnv = {
    TELAUDE_API_URL: `http://127.0.0.1:${getApiPort()}`,
    TELAUDE_API_TOKEN: getApiToken(),
    TELAUDE_USER_ID: String(up.telegramUserId),
    TELAUDE_CHAT_ID: String(up.chatId),
    TELAUDE_THREAD_ID: String(up.threadId),
  };

  // Build MCP config: telaude (inline) + global servers from ~/.claude.json & ~/.claude/settings.json
  const mcpServers: Record<string, unknown> = {};
  if (!settings.disabledMcpServers.includes('telaude')) {
    mcpServers.telaude = {
      command: mcpCommand,
      args: mcpArgs,
      env: telaudeEnv,
    };
  }

  // Load global MCP servers and include only non-disabled ones
  const globalSources = [
    path.join(os.homedir(), '.claude.json'),
    path.join(os.homedir(), '.claude', 'settings.json'),
  ];
  for (const src of globalSources) {
    try {
      if (fs.existsSync(src)) {
        const raw = JSON.parse(fs.readFileSync(src, 'utf-8'));
        if (raw.mcpServers) {
          for (const [name, cfg] of Object.entries(raw.mcpServers)) {
            if (name !== 'telaude' && !settings.disabledMcpServers.includes(name)) {
              // Inject TELAUDE_* env vars so external MCP servers can use the internal API
              const serverCfg = cfg as Record<string, unknown>;
              const existingEnv = (serverCfg.env as Record<string, string>) ?? {};
              const merged: Record<string, unknown> = { ...serverCfg, env: { ...telaudeEnv, ...existingEnv } };
              // Override Serena's --project to match current working directory
              if (name === 'serena' && Array.isArray(merged.args)) {
                const args = [...(merged.args as string[])];
                const projIdx = args.indexOf('--project');
                if (projIdx !== -1 && projIdx + 1 < args.length) {
                  args[projIdx + 1] = up.workingDir;
                  merged.args = args;
                }
              }
              mcpServers[name] = merged;
            }
          }
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  const mcpConfig = { mcpServers };
  args.push('--strict-mcp-config');
  args.push('--mcp-config', JSON.stringify(mcpConfig));

  // Disable interactive/UI tools that don't work in -p mode
  const disallowed = [
    'AskUserQuestion',   // auto-completes with empty answer, use MCP ask instead
    'EnterPlanMode',     // plan mode UI, no user interaction possible
    'ExitPlanMode',      // plan approval UI, no user interaction possible
    'EnterWorktree',     // worktree UI management, unmanaged in headless mode
    'SendMessageTool',   // swarm/agent team feature, not applicable
    'TeammateTool',      // swarm/agent team feature, not applicable
    'TeamDelete',        // swarm/agent team feature, not applicable
  ];
  // Add user-disabled tools from settings
  if (settings.disabledTools.length > 0) {
    disallowed.push(...settings.disabledTools);
  }
  args.push('--disallowedTools', ...disallowed);

  args.push('-p');

  const mode = opts?.mode ?? 'user';
  {
    const resumeLabel = opts?.resumeSessionId ? ` (resume ${opts.resumeSessionId.slice(0, 8)}...)` : ' (new)';
    notify(`CLI spawned${resumeLabel} [${mode}]`);
  }
  // Validate cwd exists — fallback to Telaude root if not
  if (!fs.existsSync(up.workingDir)) {
    const fallback = config.paths.defaultWorkingDir ?? process.cwd();
    logger.warn({ oldCwd: up.workingDir, fallback }, 'Working directory does not exist, falling back');
    up.workingDir = fallback;
  }

  logger.debug({ userId: up.telegramUserId, args, cwd: up.workingDir }, 'Spawning Claude CLI');
  logger.info({ userId: up.telegramUserId, cwd: up.workingDir, model, upModel: up.model, settingsModel: settings.model }, 'Spawning Claude CLI');

  // Clean env: remove vars that cause nesting errors or OAuth contamination
  const env = { ...process.env };
  delete env.CLAUDECODE;
  for (const key of Object.keys(env)) {
    if (key.startsWith('CLAUDE_CODE')) delete env[key];
  }
  delete env.ANTHROPIC_API_KEY;

  const child = spawn(config.claude.cliPath, args, {
    cwd: up.workingDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  });

  const parser = new StreamParser();

  if (child.stdout) {
    parser.attachToStream(child.stdout);
  }

  if (child.stderr) {
    const stderrChunks: string[] = [];
    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      stderrChunks.push(text);
      logger.warn({ userId: up.telegramUserId, stderr: text }, 'Claude CLI stderr');
    });
  }

  child.on('exit', (code, signal) => {
    notify(`CLI exited (code=${code ?? 'null'})`);
    logger.info({ userId: up.telegramUserId, code, signal }, 'Claude CLI process exited');
    // Don't reset state if reload is pending — message handler will re-spawn
    if (!up.reloadPending) {
      up.process = null;
      up.parser = null;
      up.isProcessing = false;
    }
  });

  child.on('error', (err) => {
    logger.error({ userId: up.telegramUserId, err }, 'Claude CLI process error');
    up.process = null;
    up.parser = null;
    up.isProcessing = false;
  });

  up.process = child;
  up.parser = parser;
  up.lastActivity = Date.now();

  return { process: child, parser };
}

export function sendMessage(up: UserProcess, text: string): boolean {
  if (!up.process || !up.process.stdin || up.process.stdin.destroyed) {
    return false;
  }

  try {
    up.process.stdin.write(text);
    up.process.stdin.end();
    up.isProcessing = true;
    up.lastActivity = Date.now();
    return true;
  } catch (err) {
    logger.error({ userId: up.telegramUserId, err }, 'Failed to write to stdin');
    return false;
  }
}

export function killProcess(userId: number, chatId?: number, threadId?: number): boolean {
  const key = buildSessionKey(userId, chatId, threadId);
  const up = processes.get(key);
  if (!up?.process) return false;

  try {
    const pid = up.process.pid;
    if (pid && process.platform === 'win32') {
      // taskkill /T kills the entire process tree, avoiding "Terminate batch job?" prompt
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      up.process.kill('SIGTERM');
    }
    logger.info({ userId, key, pid, wasProcessing: up.isProcessing }, 'killProcess: isProcessing → false');
    up.process = null;
    up.parser = null;
    up.isProcessing = false;
    return true;
  } catch (err) {
    logger.error({ userId, err }, 'Failed to kill process');
    return false;
  }
}

export function killForReload(userId: number, chatId?: number, threadId?: number, message?: string): boolean {
  const key = buildSessionKey(userId, chatId, threadId);
  const up = processes.get(key);
  if (!up?.process) return false;

  up.reloadPending = true;
  up.reloadMessage = message ?? 'MCP reload complete. The Claude CLI has been restarted with updated MCP configuration. Verify your changes if needed.';

  try {
    const pid = up.process.pid;
    if (pid && process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      up.process.kill('SIGTERM');
    }
    // Don't clear process/parser/isProcessing here — let the exit handler do it
    return true;
  } catch (err) {
    logger.error({ userId, err }, 'Failed to kill process for reload');
    up.reloadPending = false;
    up.reloadMessage = null;
    return false;
  }
}

export function removeUserProcess(userId: number, chatId?: number, threadId?: number): void {
  killProcess(userId, chatId, threadId);
  const key = buildSessionKey(userId, chatId, threadId);
  processes.delete(key);
}

export function cleanupIdleProcesses(): void {
  const now = Date.now();
  for (const [key, up] of processes) {
    if (up.process && !up.isProcessing && now - up.lastActivity > config.session.idleTimeoutMs) {
      logger.info({ key, idle: now - up.lastActivity }, 'Cleaning up idle process');
      killProcess(up.telegramUserId, up.chatId, up.threadId);
    }
  }
}

export function getProcessesByUserId(userId: number): UserProcess[] {
  const result: UserProcess[] = [];
  for (const up of processes.values()) {
    if (up.telegramUserId === userId) result.push(up);
  }
  return result;
}

export function getActiveProcessForUser(userId: number): UserProcess | undefined {
  let best: UserProcess | undefined;
  for (const up of processes.values()) {
    if (up.telegramUserId !== userId) continue;
    if (up.isProcessing) return up;
    if (!best || up.lastActivity > best.lastActivity) best = up;
  }
  return best;
}
