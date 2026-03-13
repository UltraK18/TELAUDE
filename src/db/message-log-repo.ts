import { getDb } from './database.js';

export function logMessage(userId: number, direction: 'user' | 'claude', chatId?: number, threadId?: number): void {
  const cid = chatId ?? userId;
  const tid = threadId ?? 0;
  getDb()
    .prepare('INSERT INTO message_logs (user_id, direction, chat_id, thread_id) VALUES (?, ?, ?, ?)')
    .run(userId, direction, cid, tid);
}

export function getLastUserMessageTime(userId: number, chatId?: number, threadId?: number): string | null {
  if (chatId != null && threadId != null) {
    const row = getDb()
      .prepare("SELECT timestamp FROM message_logs WHERE user_id = ? AND chat_id = ? AND thread_id = ? AND direction = 'user' ORDER BY id DESC LIMIT 1")
      .get(userId, chatId, threadId) as { timestamp: string } | undefined;
    return row?.timestamp ?? null;
  }
  const row = getDb()
    .prepare("SELECT timestamp FROM message_logs WHERE user_id = ? AND direction = 'user' ORDER BY id DESC LIMIT 1")
    .get(userId) as { timestamp: string } | undefined;
  return row?.timestamp ?? null;
}

export function getLastClaudeMessageTime(userId: number, chatId?: number, threadId?: number): string | null {
  if (chatId != null && threadId != null) {
    const row = getDb()
      .prepare("SELECT timestamp FROM message_logs WHERE user_id = ? AND chat_id = ? AND thread_id = ? AND direction = 'claude' ORDER BY id DESC LIMIT 1")
      .get(userId, chatId, threadId) as { timestamp: string } | undefined;
    return row?.timestamp ?? null;
  }
  const row = getDb()
    .prepare("SELECT timestamp FROM message_logs WHERE user_id = ? AND direction = 'claude' ORDER BY id DESC LIMIT 1")
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
