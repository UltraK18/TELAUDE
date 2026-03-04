import { getDb } from './database.js';

export function logMessage(userId: number, direction: 'user' | 'claude'): void {
  getDb()
    .prepare('INSERT INTO message_logs (user_id, direction) VALUES (?, ?)')
    .run(userId, direction);
}

export function getLastUserMessageTime(userId: number): string | null {
  const row = getDb()
    .prepare("SELECT timestamp FROM message_logs WHERE user_id = ? AND direction = 'user' ORDER BY id DESC LIMIT 1")
    .get(userId) as { timestamp: string } | undefined;
  return row?.timestamp ?? null;
}

/**
 * Get hourly message distribution for pattern analysis.
 * Returns array of { hour: 0-23, count: number } for the given number of days.
 */
export function getHourlyDistribution(userId: number, days = 14): { hour: number; count: number }[] {
  const rows = getDb()
    .prepare(`
      SELECT CAST(strftime('%H', timestamp) AS INTEGER) as hour, COUNT(*) as count
      FROM message_logs
      WHERE user_id = ? AND timestamp >= datetime('now', '-' || ? || ' days')
      GROUP BY hour
      ORDER BY hour
    `)
    .all(userId, days) as { hour: number; count: number }[];
  return rows;
}
