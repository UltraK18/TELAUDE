import { spawn, ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { StreamParser, type ResultEvent } from './stream-parser.js';
import { getApiToken, getApiPort } from '../api/internal-server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface UserProcess {
  telegramUserId: number;
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
  /** Set to true when cron_ok/heartbeat_ok is called — silent exit won't send response */
  silentOkCalled: boolean;
  /** Last response text from Claude (used by silent mode to send on exit if ok not called) */
  lastResponseText: string | null;
}

const processes = new Map<number, UserProcess>();

export function getUserProcess(userId: number): UserProcess | undefined {
  return processes.get(userId);
}

export function getAllProcesses(): Map<number, UserProcess> {
  return processes;
}

export function createUserProcess(
  userId: number,
  workingDir: string,
  model: string,
): UserProcess {
  const up: UserProcess = {
    telegramUserId: userId,
    process: null,
    parser: null,
    sessionId: null,
    workingDir,
    model,
    isProcessing: false,
    lastActivity: Date.now(),
    reloadPending: false,
    reloadMessage: null,
    silentOkCalled: false,
    lastResponseText: null,
  };
  processes.set(userId, up);
  return up;
}

export interface SpawnOptions {
  resumeSessionId?: string;
  mode?: 'user' | 'heartbeat' | 'cron';
  model?: string;
}

export function spawnClaudeProcess(up: UserProcess, opts?: SpawnOptions): { process: ChildProcess; parser: StreamParser } {
  const model = opts?.model ?? up.model;

  const args = [
    '--verbose',
    '--output-format', 'stream-json',
    '--dangerously-skip-permissions',
    '--model', model,
  ];

  if (opts?.resumeSessionId) {
    args.push('--resume', opts.resumeSessionId);
  }

  // MCP config for telaude tools
  // Detect dev (tsx → src/) vs prod (node → dist/) and pick correct MCP entry
  const jsPath = path.resolve(__dirname, '..', 'mcp-server', 'index.js');
  const tsPath = jsPath.replace(/\.js$/, '.ts');
  const useTs = !fs.existsSync(jsPath) && fs.existsSync(tsPath);
  const mcpCommand = useTs ? 'npx' : 'node';
  const mcpArgs = useTs ? ['tsx', tsPath] : [jsPath];

  const mcpConfig = {
    mcpServers: {
      telaude: {
        command: mcpCommand,
        args: mcpArgs,
        env: {
          TELAUDE_API_URL: `http://127.0.0.1:${getApiPort()}`,
          TELAUDE_API_TOKEN: getApiToken(),
          TELAUDE_USER_ID: String(up.telegramUserId),
        },
      },
    },
  };
  args.push('--mcp-config', JSON.stringify(mcpConfig));

  args.push('-p');

  logger.info({ userId: up.telegramUserId, args, cwd: up.workingDir }, 'Spawning Claude CLI');

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

export function killProcess(userId: number): boolean {
  const up = processes.get(userId);
  if (!up?.process) return false;

  try {
    const pid = up.process.pid;
    if (pid && process.platform === 'win32') {
      // taskkill /T kills the entire process tree, avoiding "Terminate batch job?" prompt
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      up.process.kill('SIGTERM');
    }
    up.process = null;
    up.parser = null;
    up.isProcessing = false;
    return true;
  } catch (err) {
    logger.error({ userId, err }, 'Failed to kill process');
    return false;
  }
}

export function killForReload(userId: number, message?: string): boolean {
  const up = processes.get(userId);
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

export function removeUserProcess(userId: number): void {
  killProcess(userId);
  processes.delete(userId);
}

export function cleanupIdleProcesses(): void {
  const now = Date.now();
  for (const [userId, up] of processes) {
    if (up.process && !up.isProcessing && now - up.lastActivity > config.session.idleTimeoutMs) {
      logger.info({ userId, idle: now - up.lastActivity }, 'Cleaning up idle process');
      killProcess(userId);
    }
  }
}
