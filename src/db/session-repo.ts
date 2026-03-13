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
  session_name: string | null;
  chat_id: number;
  thread_id: number;
}

export function createSession(
  userId: number,
  sessionId: string,
  workingDir: string,
  model: string,
  chatId?: number,
  threadId?: number,
): void {
  const cid = chatId ?? userId;
  const tid = threadId ?? 0;

  // Deactivate sessions within same chat/thread context only
  deactivateAllUserSessions(userId, cid, tid);

  const existing = getDb()
    .prepare('SELECT id FROM sessions WHERE session_id = ?')
    .get(sessionId);
  if (existing) {
    getDb()
      .prepare("UPDATE sessions SET last_active_at = datetime('now'), is_active = 1, chat_id = ?, thread_id = ? WHERE session_id = ?")
      .run(cid, tid, sessionId);
    return;
  }
  getDb()
    .prepare('INSERT INTO sessions (telegram_user_id, session_id, working_dir, model, chat_id, thread_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, sessionId, workingDir, model, cid, tid);
}

export function getActiveSession(userId: number, chatId?: number, threadId?: number): SessionRecord | undefined {
  if (chatId != null && threadId != null) {
    return getDb()
      .prepare('SELECT * FROM sessions WHERE telegram_user_id = ? AND chat_id = ? AND thread_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1')
      .get(userId, chatId, threadId) as SessionRecord | undefined;
  }
  return getDb()
    .prepare('SELECT * FROM sessions WHERE telegram_user_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1')
    .get(userId) as SessionRecord | undefined;
}

export function getRecentSessions(userId: number, limit = 10, workingDir?: string, chatId?: number, threadId?: number): SessionRecord[] {
  let sql = 'SELECT * FROM sessions WHERE telegram_user_id = ?';
  const params: (string | number)[] = [userId];

  if (workingDir) {
    sql += ' AND working_dir = ?';
    params.push(workingDir);
  }
  if (chatId != null) {
    sql += ' AND chat_id = ?';
    params.push(chatId);
  }
  if (threadId != null) {
    sql += ' AND thread_id = ?';
    params.push(threadId);
  }

  sql += ' GROUP BY session_id ORDER BY MAX(id) DESC LIMIT ?';
  params.push(limit);

  return getDb().prepare(sql).all(...params) as SessionRecord[];
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

export function updateSessionModel(sessionId: string, model: string): void {
  getDb()
    .prepare('UPDATE sessions SET model = ? WHERE session_id = ?')
    .run(model, sessionId);
}

export function updateSessionCost(sessionId: string, costUsd: number, turns: number, inputTokens?: number, outputTokens?: number): void {
  getDb()
    .prepare('UPDATE sessions SET total_cost_usd = ?, total_turns = ?, total_input_tokens = ?, total_output_tokens = ? WHERE session_id = ?')
    .run(costUsd, turns, inputTokens ?? 0, outputTokens ?? 0, sessionId);
}

export function updateSessionWorkingDir(sessionId: string, workingDir: string): void {
  getDb()
    .prepare('UPDATE sessions SET working_dir = ? WHERE session_id = ?')
    .run(workingDir, sessionId);
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

export function renameSession(sessionId: string, name: string | null): void {
  getDb()
    .prepare('UPDATE sessions SET session_name = ? WHERE session_id = ?')
    .run(name, sessionId);
}

export function deactivateAllUserSessions(userId: number, chatId?: number, threadId?: number): void {
  if (chatId != null && threadId != null) {
    getDb()
      .prepare('UPDATE sessions SET is_active = 0 WHERE telegram_user_id = ? AND chat_id = ? AND thread_id = ?')
      .run(userId, chatId, threadId);
  } else {
    getDb()
      .prepare('UPDATE sessions SET is_active = 0 WHERE telegram_user_id = ?')
      .run(userId);
  }
}
