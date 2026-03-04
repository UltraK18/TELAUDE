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
  total_input_tokens: number;
  total_output_tokens: number;
}

export function createSession(
  userId: number,
  sessionId: string,
  workingDir: string,
  model: string,
): void {
  // Deactivate all other sessions first — only one active at a time
  deactivateAllUserSessions(userId);

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

export function getRecentSessions(userId: number, limit = 10, workingDir?: string): SessionRecord[] {
  if (workingDir) {
    return getDb()
      .prepare(`
        SELECT * FROM sessions
        WHERE telegram_user_id = ? AND working_dir = ?
        GROUP BY session_id
        ORDER BY MAX(id) DESC
        LIMIT ?
      `)
      .all(userId, workingDir, limit) as SessionRecord[];
  }
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

export function updateSessionCost(sessionId: string, costUsd: number, turns: number, inputTokens?: number, outputTokens?: number): void {
  getDb()
    .prepare('UPDATE sessions SET total_cost_usd = ?, total_turns = ?, total_input_tokens = ?, total_output_tokens = ? WHERE session_id = ?')
    .run(costUsd, turns, inputTokens ?? 0, outputTokens ?? 0, sessionId);
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
