import bcrypt from 'bcryptjs';
import { getDb } from './database.js';

let _onFirstAuthCallback: (() => void) | null = null;

/** Register a one-shot callback that fires when the first user authorizes (setup flow). */
export function setOnFirstAuth(callback: () => void): void {
  _onFirstAuthCallback = callback;
}

interface AuthRecord {
  telegram_user_id: number;
  username: string | null;
  auth_token_hash: string;
  is_authorized: number;
  authorized_at: string | null;
  failed_attempts: number;
  last_attempt_at: string | null;
}

export function isUserAuthorized(userId: number): boolean {
  const row = getDb()
    .prepare('SELECT is_authorized FROM auth_tokens WHERE telegram_user_id = ?')
    .get(userId) as { is_authorized: number } | undefined;
  return row?.is_authorized === 1;
}

export function getFailedAttempts(userId: number): { count: number; lastAt: string | null } {
  const row = getDb()
    .prepare('SELECT failed_attempts, last_attempt_at FROM auth_tokens WHERE telegram_user_id = ?')
    .get(userId) as Pick<AuthRecord, 'failed_attempts' | 'last_attempt_at'> | undefined;
  return { count: row?.failed_attempts ?? 0, lastAt: row?.last_attempt_at ?? null };
}

export async function authorizeUser(
  userId: number,
  username: string | undefined,
  password: string,
  correctPassword: string,
): Promise<boolean> {
  const db = getDb();
  const now = new Date().toISOString();

  // Ensure row exists
  db.prepare(`
    INSERT OR IGNORE INTO auth_tokens (telegram_user_id, username, auth_token_hash)
    VALUES (?, ?, '')
  `).run(userId, username ?? null);

  // Check rate limit: 3 attempts per hour
  const record = db
    .prepare('SELECT failed_attempts, last_attempt_at FROM auth_tokens WHERE telegram_user_id = ?')
    .get(userId) as Pick<AuthRecord, 'failed_attempts' | 'last_attempt_at'> | undefined;

  if (record && record.failed_attempts >= 3 && record.last_attempt_at) {
    const lastAttempt = new Date(record.last_attempt_at).getTime();
    if (Date.now() - lastAttempt < 3600000) {
      return false; // Rate limited
    }
    // Reset after 1 hour
    db.prepare('UPDATE auth_tokens SET failed_attempts = 0 WHERE telegram_user_id = ?').run(userId);
  }

  if (password === correctPassword) {
    const hash = await bcrypt.hash(password, 10);
    db.prepare(`
      UPDATE auth_tokens
      SET auth_token_hash = ?, is_authorized = 1, authorized_at = ?,
          failed_attempts = 0, username = ?
      WHERE telegram_user_id = ?
    `).run(hash, now, username ?? null, userId);
    // Trigger first-auth callback (TUI initialization on first run)
    if (_onFirstAuthCallback) {
      const cb = _onFirstAuthCallback;
      _onFirstAuthCallback = null; // one-shot
      cb();
    }
    return true;
  }

  // Failed attempt
  db.prepare(`
    UPDATE auth_tokens
    SET failed_attempts = failed_attempts + 1, last_attempt_at = ?
    WHERE telegram_user_id = ?
  `).run(now, userId);
  return false;
}

export function getAuthorizedUserIds(): number[] {
  const rows = getDb()
    .prepare('SELECT telegram_user_id FROM auth_tokens WHERE is_authorized = 1')
    .all() as { telegram_user_id: number }[];
  return rows.map(r => r.telegram_user_id);
}

export function revokeUser(userId: number): void {
  getDb()
    .prepare('UPDATE auth_tokens SET is_authorized = 0 WHERE telegram_user_id = ?')
    .run(userId);
}
