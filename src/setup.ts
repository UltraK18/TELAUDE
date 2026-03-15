import { execSync } from 'child_process';
import crypto from 'crypto';
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ENV_PATH = path.join(os.homedir(), '.telaude', '.env');

function print(msg: string): void {
  process.stdout.write(msg + '\n');
}

function createRl(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

interface ClaudeAuthStatus {
  loggedIn: boolean;
  email?: string;
  subscriptionType?: string;
}

function getClaudeVersion(): string | null {
  try {
    const output = execSync('claude --version', {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Output format: "2.1.74 (Claude Code)"
    const match = output.trim().match(/^([\d.]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function checkClaudeAuth(): ClaudeAuthStatus {
  try {
    const output = execSync('claude auth status', {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return JSON.parse(output.trim());
  } catch {
    return { loggedIn: false };
  }
}

function generateAuthCode(): string {
  return crypto.randomBytes(20).toString('hex'); // 40-char hex
}

export function needsSetup(): boolean {
  return !fs.existsSync(ENV_PATH);
}

export async function runSetup(): Promise<void> {
  // Clear screen and move cursor to top-left
  process.stdout.write('\x1b[2J\x1b[H');
  print('');
  print('  ████████╗███████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗');
  print('  ╚══██╔══╝██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝');
  print('     ██║   █████╗  ██║     ███████║██║   ██║██║  ██║█████╗');
  print('     ██║   ██╔══╝  ██║     ██╔══██║██║   ██║██║  ██║██╔══╝');
  print('     ██║   ███████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗');
  print('     ╚═╝   ╚══════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝');
  print('');
  print('                         - SETUP -');
  print('');

  // Step 1: Claude CLI auth
  print('\x1b[31m[1/3]\x1b[0m Checking Claude CLI auth...');

  const cliVersion = getClaudeVersion();
  if (!cliVersion) {
    print('');
    print('\u2716 Claude CLI not found.');
    print('');
    print('  Install Claude Code first:');
    print('  $ npm install -g @anthropic-ai/claude-code');
    print('');
    process.exit(1);
  }

  // claude auth status requires v2.1.41+
  const [major, minor, patch] = cliVersion.split('.').map(Number);
  const versionNum = major * 10000 + minor * 100 + (patch || 0);
  const minVersion = 2 * 10000 + 1 * 100 + 41; // 2.1.41

  if (versionNum < minVersion) {
    print('');
    print(`\u2716 Claude CLI version ${cliVersion} is too old.`);
    print('');
    print('  Telaude requires Claude Code v2.1.41 or later.');
    print('  $ npm update -g @anthropic-ai/claude-code');
    print('');
    process.exit(1);
  }

  const auth = checkClaudeAuth();

  if (!auth.loggedIn) {
    print('');
    print('\u2716 Not logged in to Claude CLI.');
    print('');
    print('  Run the following command first:');
    print('  $ claude auth login');
    print('');
    print('  Then run this again.');
    process.exit(1);
  }

  const sub = auth.subscriptionType ? ` (${auth.subscriptionType})` : '';
  print(`\x1b[31m\u2713\x1b[0m Authenticated: ${auth.email}${sub}`);
  print('');

  const rl = createRl();

  try {
    // Step 2: Telegram bot token
    print('\x1b[31m[2/3]\x1b[0m Telegram Bot Token');
    print('Enter the token from \x1b[36m@BotFather\x1b[0m');
    let botToken = '';
    while (!botToken) {
      botToken = await ask(rl, '> ');
      if (!botToken) print('Token is required.');
    }

    // Step 3: Generate auth code (displayed after bot comes online)
    const authCode = generateAuthCode();
    rl.close();

    // Ensure .telaude directory exists
    const telaudeDir = path.dirname(ENV_PATH);
    if (!fs.existsSync(telaudeDir)) fs.mkdirSync(telaudeDir, { recursive: true });

    // Write .env
    const envContent = [
      '# Telegram',
      `TELEGRAM_BOT_TOKEN=${botToken}`,
      'ALLOWED_TELEGRAM_IDS=',
      '',
      '# Authentication',
      `AUTH_PASSWORD=${authCode}`,
      '',
      '# Claude CLI',
      'CLAUDE_CLI_PATH=claude',
      'DEFAULT_MODEL=default',
      'DEFAULT_MAX_BUDGET_USD=5.0',
      'DEFAULT_MAX_TURNS=50',
      '',
      '# Paths',
      'ALLOWED_PROJECT_ROOTS=',
      `DEFAULT_WORKING_DIR=${process.cwd()}`,
      '',
      '# Session',
      'SESSION_IDLE_TIMEOUT_MS=1800000',
      '',
      '# Display',
      'STREAM_UPDATE_INTERVAL_MS=500',
      'STREAM_UPDATE_MIN_CHARS=200',
      '',
      '# Database',
      `DB_PATH=${path.join(os.homedir(), '.telaude', 'data', 'telaude.db')}`,
      '',
      '# Logging',
      'LOG_LEVEL=info',
    ].join('\n') + '\n';

    fs.writeFileSync(ENV_PATH, envContent, 'utf-8');

    // Encrypt .env with machine-bound key
    const { encryptFile } = await import('./utils/machine-lock.js');
    encryptFile(ENV_PATH);

    // Reset DB auth (new .env = new auth code, old sessions invalid)
    const dbPath = path.join(os.homedir(), '.telaude', 'data', 'telaude.db');
    if (fs.existsSync(dbPath)) {
      const { Database } = await import('bun:sqlite');
      const db = new Database(dbPath);
      db.exec('UPDATE auth_tokens SET is_authorized = 0');
      db.close();
      print('\x1b[31m\u2713\x1b[0m \x1b[90mAuth reset (new credentials).\x1b[0m');
    }

    print('\x1b[31m\u2713\x1b[0m \x1b[90m.env file created (encrypted).\x1b[0m');
    print('\x1b[31m[3/3]\x1b[0m Starting bot...');
    print('');
  } catch (err) {
    rl.close();
    throw err;
  }
}
