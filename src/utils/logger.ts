import pino from 'pino';
import fs from 'fs';
import path from 'path';

const logDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

const logFile = path.join(logDir, 'bot.log');
const isDev = process.env.NODE_ENV === 'development';

const targets: pino.TransportTargetOptions[] = [
  { target: 'pino/file', options: { destination: logFile }, level: 'info' },      // always log to file
];

if (isDev) {
  targets.push({ target: 'pino/file', options: { destination: 1 }, level: 'info' });  // stdout in dev only
} else {
  targets.push({ target: 'pino/file', options: { destination: 2 }, level: 'error' }); // stderr errors in production
}

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { targets },
});

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).slice(2)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

/** Print to console regardless of environment (for important events) */
export function notify(msg: string): void {
  console.log(`[${timestamp()}] ${msg}`);
}

/** Print error to console regardless of environment */
export function notifyError(msg: string): void {
  console.error(`[${timestamp()}] ❌ ${msg}`);
}
