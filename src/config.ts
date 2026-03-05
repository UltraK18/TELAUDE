import path from 'path';

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env: ${key}`);
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

function optionalNumber(key: string, fallback: number): number {
  const val = process.env[key];
  return val ? Number(val) : fallback;
}

export type Config = ReturnType<typeof buildConfig>;

function buildConfig() {
  return {
    telegram: {
      botToken: required('TELEGRAM_BOT_TOKEN'),
      chatId: process.env.CHAT_ID ? Number(process.env.CHAT_ID) : null as number | null,
      allowedUserIds: process.env.ALLOWED_TELEGRAM_IDS
        ? process.env.ALLOWED_TELEGRAM_IDS.split(',').map(Number).filter(Boolean)
        : [],
    },

    auth: {
      password: required('AUTH_PASSWORD'),
    },

    claude: {
      cliPath: optional('CLAUDE_CLI_PATH', 'claude'),
      defaultModel: optional('DEFAULT_MODEL', 'sonnet'),
      defaultMaxBudgetUsd: optionalNumber('DEFAULT_MAX_BUDGET_USD', 5.0),
      defaultMaxTurns: optionalNumber('DEFAULT_MAX_TURNS', 50),
    },

    paths: {
      allowedRoots: optional('ALLOWED_PROJECT_ROOTS', '')
        .split(',')
        .map(p => p.trim())
        .filter(Boolean)
        .map(p => path.resolve(p)),
      defaultWorkingDir: optional('DEFAULT_WORKING_DIR', process.cwd()),
    },

    session: {
      idleTimeoutMs: optionalNumber('SESSION_IDLE_TIMEOUT_MS', 1800000),
    },

    display: {
      streamUpdateIntervalMs: optionalNumber('STREAM_UPDATE_INTERVAL_MS', 500),
      streamUpdateMinChars: optionalNumber('STREAM_UPDATE_MIN_CHARS', 200),
    },

    db: {
      path: optional('DB_PATH', './data/telaude.db'),
    },

    logging: {
      level: optional('LOG_LEVEL', 'info'),
    },

    mcp: {
      internalApiPort: optionalNumber('MCP_INTERNAL_API_PORT', 19816),
      internalApiToken: '', // Set at runtime (random per boot)
    },
  } as const;
}

let _config: Config | null = null;

export function loadConfig(): Config {
  _config = buildConfig();
  return _config;
}

export const config = new Proxy({} as Config, {
  get(_target, prop, receiver) {
    if (!_config) {
      throw new Error('Config not loaded. Call loadConfig() first.');
    }
    return Reflect.get(_config, prop, receiver);
  },
});
