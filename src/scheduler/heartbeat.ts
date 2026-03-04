import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

const HEARTBEAT_FILENAME = 'HEARTBEAT.md';

function getHeartbeatPath(workingDir: string): string {
  return path.join(workingDir, HEARTBEAT_FILENAME);
}

export function readHeartbeat(workingDir: string): string | null {
  const filePath = getHeartbeatPath(workingDir);
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    logger.error({ err, filePath }, 'Failed to read HEARTBEAT.md');
    return null;
  }
}

export function writeHeartbeat(workingDir: string, content: string): void {
  const filePath = getHeartbeatPath(workingDir);
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    logger.info({ filePath }, 'HEARTBEAT.md updated');
  } catch (err) {
    logger.error({ err, filePath }, 'Failed to write HEARTBEAT.md');
    throw err;
  }
}

export function heartbeatExists(workingDir: string): boolean {
  return fs.existsSync(getHeartbeatPath(workingDir));
}
