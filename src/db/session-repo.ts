import { getDb } from './database.js';

export interface SessionRecord {
  id: number;
  telegram_user_id: number;
  session_id: string;
  working_dir: string;
  model: string;
  created_at: string;
  last_active_at: string;
  is_active: number;
  total_cost_usd: number;
  total_turns: number;
}

export function createSession(
  userId: number,
  sessionId: string,
  workingDir: string,
  model: string,
): void {
  const existing = getDb()
    .prepare('SELECT id FROM sessions WHERE session_id = ?')
    .get(sessionId);
  if (existing) {
    getDb()
      .prepare("UPDATE sessions SET last_active_at = datetime('now'), is_active = 1 WHERE session_id = ?")
      .run(sessionId);
    return;
  }
  getDb()
    .prepare('INSERT INTO sessions (telegram_user_id, session_id, working_dir, model) VALUES (?, ?, ?, ?)')
    .run(userId, sessionId, workingDir, model);
}

export function getActiveSession(userId: number): SessionRecord | undefined {
  return getDb()
    .prepare('SELECT * FROM sessions WHERE telegram_user_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1')
    .get(userId) as SessionRecord | undefined;
}

export function getRecentSessions(userId: number, limit = 10): SessionRecord[] {
  return getDb()
    .prepare(`
      SELECT * FROM sessions
      WHERE telegram_user_id = ?
      GROUP BY session_id
      ORDER BY MAX(id) DESC
      LIMIT ?
    `)
    .all(userId, limit) as SessionRecord[];
}

export function getSessionById(sessionId: string): SessionRecord | undefined {
  return getDb()
    .prepare('SELECT * FROM sessions WHERE session_id = ?')
    .get(sessionId) as SessionRecord | undefined;
}

export function updateSessionActivity(sessionId: string): void {
  getDb()
    .prepare("UPDATE sessions SET last_active_at = datetime('now') WHERE session_id = ?")
    .run(sessionId);
}

export function updateSessionCost(sessionId: string, costUsd: number, turns: number): void {
  getDb()
    .prepare('UPDATE sessions SET total_cost_usd = ?, total_turns = ? WHERE session_id = ?')
    .run(costUsd, turns, sessionId);
}

export function deactivateSession(sessionId: string): void {
  getDb()
    .prepare('UPDATE sessions SET is_active = 0 WHERE session_id = ?')
    .run(sessionId);
}

export function deleteSession(sessionId: string): void {
  getDb()
    .prepare('DELETE FROM sessions WHERE session_id = ?')
    .run(sessionId);
}

export function deactivateAllUserSessions(userId: number): void {
  getDb()
    .prepare('UPDATE sessions SET is_active = 0 WHERE telegram_user_id = ?')
    .run(userId);
}
