import pino from 'pino';
import fs from 'fs';
import path from 'path';

const logDir = path.join(process.cwd(), '.telaude', 'data');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

const logFile = path.join(logDir, 'bot.log');
const isDev = process.env.NODE_ENV === 'development';

const targets: pino.TransportTargetOptions[] = [
  { target: 'pino/file', options: { destination: logFile }, level: 'info' },      // always log to file
];

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { targets },
});

function tsRaw(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `[${String(d.getFullYear()).slice(2)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}] (${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())})`;
}

let _dashboardLog: ((msg: string) => void) | null = null;
let _dashboardError: ((msg: string) => void) | null = null;

export function setDashboardOutput(log: (msg: string) => void, error: (msg: string) => void): void {
  _dashboardLog = log;
  _dashboardError = error;
}

/** Print to console regardless of environment (for important events) */
export function notify(msg: string): void {
  if (_dashboardLog) {
    _dashboardLog(`{gray-fg}${tsRaw()}{/gray-fg} ${msg}`);
  } else {
    console.log(`\x1b[90m${tsRaw()}\x1b[0m ${msg}`);
  }
}

/** Print error to console regardless of environment */
export function notifyError(msg: string): void {
  if (_dashboardError) {
    _dashboardError(`{gray-fg}${tsRaw()}{/gray-fg} {red-fg}❌ ${msg}{/red-fg}`);
  } else {
    console.error(`\x1b[90m${tsRaw()}\x1b[0m ❌ ${msg}`);
  }
}
