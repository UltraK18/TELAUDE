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
}

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { targets },
});
