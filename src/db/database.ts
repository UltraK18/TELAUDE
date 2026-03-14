import { Database } from 'bun:sqlite';
import path from 'path';
import fs from 'fs';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

let db: Database;

export function getDb(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

export function initDb(): Database {
  const dbPath = path.resolve(config.db.path);
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  migrate(db);
  logger.info({ dbPath }, 'Database initialized');
  return db;
}

function migrate(db: Database): void {
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
      model TEXT DEFAULT 'default',
      created_at TEXT DEFAULT (datetime('now')),
      last_active_at TEXT DEFAULT (datetime('now')),
      is_active INTEGER DEFAULT 1,
      total_cost_usd REAL DEFAULT 0.0,
      total_turns INTEGER DEFAULT 0
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
  const cols = db.query('PRAGMA table_info(sessions)').all() as { name: string }[];
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

  // Multi-session: add chat_id and thread_id columns
  if (!colNames.has('chat_id')) {
    db.exec('ALTER TABLE sessions ADD COLUMN chat_id INTEGER NOT NULL DEFAULT 0');
    // Backfill: existing sessions are DM, so chat_id = telegram_user_id
    db.exec('UPDATE sessions SET chat_id = telegram_user_id WHERE chat_id = 0');
  }
  if (!colNames.has('thread_id')) {
    db.exec('ALTER TABLE sessions ADD COLUMN thread_id INTEGER NOT NULL DEFAULT 0');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_context ON sessions(telegram_user_id, chat_id, thread_id)');

  // Multi-session: add chat_id and thread_id columns to message_logs
  const msgCols = db.query('PRAGMA table_info(message_logs)').all() as { name: string }[];
  const msgColNames = new Set(msgCols.map(c => c.name));
  if (!msgColNames.has('chat_id')) {
    db.exec('ALTER TABLE message_logs ADD COLUMN chat_id INTEGER NOT NULL DEFAULT 0');
  }
  if (!msgColNames.has('thread_id')) {
    db.exec('ALTER TABLE message_logs ADD COLUMN thread_id INTEGER NOT NULL DEFAULT 0');
  }

  // Received files table — recreate if schema is from corrupted v006 (missing telegram_user_id)
  const rfCols = db.query('PRAGMA table_info(received_files)').all() as { name: string }[];
  const rfColNames = new Set(rfCols.map(c => c.name));
  if (rfColNames.size > 0 && !rfColNames.has('telegram_user_id')) {
    // Old corrupted schema — drop and recreate
    db.exec('DROP TABLE IF EXISTS received_files');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS received_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_user_id INTEGER NOT NULL,
      chat_id INTEGER NOT NULL DEFAULT 0,
      thread_id INTEGER NOT NULL DEFAULT 0,
      file_unique_id TEXT,
      file_id TEXT NOT NULL,
      file_type TEXT NOT NULL,
      file_name TEXT,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      working_dir TEXT NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_received_files_user ON received_files(telegram_user_id, chat_id, thread_id)`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_received_files_unique ON received_files(file_unique_id, chat_id) WHERE file_unique_id IS NOT NULL`);

  // Topic name cache — maps chat_id + thread_id → topic name
  db.exec(`
    CREATE TABLE IF NOT EXISTS topic_names (
      chat_id INTEGER NOT NULL,
      thread_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (chat_id, thread_id)
    )
  `);
}

export function closeDb(): void {
  if (db) {
    db.close();
    logger.info('Database closed');
  }
}
