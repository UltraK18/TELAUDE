import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

export function initDb(): Database.Database {
  const dbPath = path.resolve(config.db.path);
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  migrate(db);
  logger.info({ dbPath }, 'Database initialized');
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      telegram_user_id INTEGER PRIMARY KEY,
      username TEXT,
      auth_token_hash TEXT NOT NULL,
      is_authorized INTEGER DEFAULT 0,
      authorized_at TEXT,
      failed_attempts INTEGER DEFAULT 0,
      last_attempt_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_user_id INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      working_dir TEXT NOT NULL,
      model TEXT DEFAULT 'sonnet',
      created_at TEXT DEFAULT (datetime('now')),
      last_active_at TEXT DEFAULT (datetime('now')),
      is_active INTEGER DEFAULT 1,
      total_cost_usd REAL DEFAULT 0.0,
      total_turns INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS user_configs (
      telegram_user_id INTEGER PRIMARY KEY,
      default_working_dir TEXT,
      default_model TEXT DEFAULT 'sonnet',
      max_budget_usd REAL DEFAULT 5.0,
      max_turns INTEGER DEFAULT 50
    );

    CREATE TABLE IF NOT EXISTS message_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      direction TEXT NOT NULL,
      timestamp TEXT DEFAULT (datetime('now'))
    );

  `);

  // Clean up duplicate session_ids (keep latest), then add unique index
  db.exec(`
    DELETE FROM sessions WHERE id NOT IN (
      SELECT MAX(id) FROM sessions GROUP BY session_id
    );
  `);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id)`);

  // Add token columns if missing
  const cols = db.pragma('table_info(sessions)') as { name: string }[];
  const colNames = new Set(cols.map(c => c.name));
  if (!colNames.has('total_input_tokens')) {
    db.exec('ALTER TABLE sessions ADD COLUMN total_input_tokens INTEGER DEFAULT 0');
  }
  if (!colNames.has('total_output_tokens')) {
    db.exec('ALTER TABLE sessions ADD COLUMN total_output_tokens INTEGER DEFAULT 0');
  }
  if (!colNames.has('session_name')) {
    db.exec("ALTER TABLE sessions ADD COLUMN session_name TEXT DEFAULT NULL");
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
    logger.info('Database closed');
  }
}
