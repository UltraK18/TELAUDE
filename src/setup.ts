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
  print('');
  print('\u2554' + '\u2550'.repeat(38) + '\u2557');
  print('\u2551       Telaude - Setup               \u2551');
  print('\u255A' + '\u2550'.repeat(38) + '\u255D');
  print('');

  // Step 1: Claude CLI auth
  print('[1/3] Checking Claude CLI auth...');
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
  print(`\u2713 Authenticated: ${auth.email}${sub}`);
  print('');

  const rl = createRl();

  try {
    // Step 2: Telegram bot token
    print('[2/3] Telegram Bot Token');
    print('Enter the token from @BotFather.');
    let botToken = '';
    while (!botToken) {
      botToken = await ask(rl, '> ');
      if (!botToken) print('Token is required.');
    }

    // Step 3: Generate auth code
    const authCode = generateAuthCode();
    print('');
    print('[3/3] Auth Code Generated');
    print('');
    print(`  Auth code: ${authCode}`);
    print('');
    print('  Send this code to your bot on Telegram to authenticate.');
    print('');
    await ask(rl, 'Press Enter to start the bot...');
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
      'DEFAULT_MODEL=sonnet',
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
      const Database = (await import('better-sqlite3')).default;
      const db = Database(dbPath);
      db.exec('UPDATE auth_tokens SET is_authorized = 0');
      db.close();
      print('\u2713 Auth reset (new credentials).');
    }

    print('\u2713 .env file created (encrypted).');
    print('Starting bot...');
    print('');
  } catch (err) {
    rl.close();
    throw err;
  }
}
