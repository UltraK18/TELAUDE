import { getDb } from './database.js';

export interface SessionRecord {
  id: number;
  telegram_user_id: number;
  session_id: string;
  session_root: string;
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
  sessionRoot: string,
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
    .prepare('INSERT INTO sessions (telegram_user_id, session_id, session_root, model, chat_id, thread_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, sessionId, sessionRoot, model, cid, tid);
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

export function getRecentSessions(userId: number, limit = 10, sessionRoot?: string, chatId?: number, threadId?: number): SessionRecord[] {
  let sql = 'SELECT * FROM sessions WHERE telegram_user_id = ?';
  const params: (string | number)[] = [userId];

  if (sessionRoot) {
    sql += ' AND session_root = ?';
    params.push(sessionRoot);
  }

  if (chatId != null && threadId != null) {
    sql += ' AND chat_id = ? AND thread_id = ?';
    params.push(chatId, threadId);
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

export function updateSessionRoot(sessionId: string, sessionRoot: string): void {
  getDb()
    .prepare('UPDATE sessions SET session_root = ? WHERE session_id = ?')
    .run(sessionRoot, sessionId);
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

/** Get distinct chat_id + thread_id pairs for thread-based sessions (for topic health checking) */
export function getThreadSessions(): { chat_id: number; thread_id: number; telegram_user_id: number }[] {
  return getDb()
    .prepare('SELECT DISTINCT chat_id, thread_id, telegram_user_id FROM sessions WHERE thread_id > 0')
    .all() as { chat_id: number; thread_id: number; telegram_user_id: number }[];
}

/** Get distinct non-DM chat sessions for health checking (groups + threads) */
export function getNonDmSessions(): { chat_id: number; thread_id: number; telegram_user_id: number }[] {
  return getDb()
    .prepare('SELECT DISTINCT chat_id, thread_id, telegram_user_id FROM sessions WHERE chat_id != telegram_user_id OR thread_id > 0')
    .all() as { chat_id: number; thread_id: number; telegram_user_id: number }[];
}

/** Get the most recent active session's chatId and threadId for a user */
export function getLastActiveTarget(userId: number): { chatId: number; threadId: number } | null {
  const row = getDb()
    .prepare('SELECT chat_id, thread_id FROM sessions WHERE telegram_user_id = ? AND is_active = 1 ORDER BY last_active_at DESC LIMIT 1')
    .get(userId) as { chat_id: number; thread_id: number } | undefined;
  return row ? { chatId: row.chat_id, threadId: row.thread_id } : null;
}
