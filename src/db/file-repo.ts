import { getDb } from './database.js';

export interface ReceivedFile {
  id: number;
  telegram_user_id: number;
  chat_id: number;
  thread_id: number;
  file_unique_id: string | null;
  file_id: string;
  file_type: string;
  file_name: string | null;
  file_path: string;
  file_size: number | null;
  created_at: string;
  working_dir: string;
}

export function addReceivedFile(params: {
  userId: number;
  chatId: number;
  threadId: number;
  fileUniqueId?: string;
  fileId: string;
  fileType: string;
  fileName?: string;
  filePath: string;
  fileSize?: number;
  workingDir: string;
}): number {
  const result = getDb()
    .prepare(`INSERT OR IGNORE INTO received_files
      (telegram_user_id, chat_id, thread_id, file_unique_id, file_id, file_type, file_name, file_path, file_size, working_dir)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      params.userId, params.chatId, params.threadId,
      params.fileUniqueId ?? null, params.fileId, params.fileType,
      params.fileName ?? null, params.filePath, params.fileSize ?? null,
      params.workingDir,
    );
  // If INSERT OR IGNORE skipped (duplicate), return existing id
  if (result.changes === 0 && params.fileUniqueId) {
    const existing = getDb()
      .prepare('SELECT id FROM received_files WHERE file_unique_id = ? AND chat_id = ?')
      .get(params.fileUniqueId, params.chatId) as { id: number } | undefined;
    return existing?.id ?? 0;
  }
  return Number(result.lastInsertRowid);
}

export function getReceivedFiles(
  userId: number,
  chatId?: number,
  threadId?: number,
  fileType?: string,
  limit = 50,
): ReceivedFile[] {
  let sql = 'SELECT * FROM received_files WHERE telegram_user_id = ?';
  const params: (string | number)[] = [userId];

  if (chatId != null) {
    sql += ' AND chat_id = ?';
    params.push(chatId);
  }
  if (threadId != null) {
    sql += ' AND thread_id = ?';
    params.push(threadId);
  }
  if (fileType) {
    sql += ' AND file_type = ?';
    params.push(fileType);
  }

  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(limit);

  return getDb().prepare(sql).all(...params) as ReceivedFile[];
}

export function getReceivedFileById(fileId: number): ReceivedFile | undefined {
  return getDb()
    .prepare('SELECT * FROM received_files WHERE id = ?')
    .get(fileId) as ReceivedFile | undefined;
}

export function getFileCount(userId: number, chatId?: number): number {
  if (chatId != null) {
    const row = getDb()
      .prepare('SELECT COUNT(*) as count FROM received_files WHERE telegram_user_id = ? AND chat_id = ?')
      .get(userId, chatId) as { count: number };
    return row.count;
  }
  const row = getDb()
    .prepare('SELECT COUNT(*) as count FROM received_files WHERE telegram_user_id = ?')
    .get(userId) as { count: number };
  return row.count;
}

export function deleteReceivedFile(fileId: number): boolean {
  const result = getDb()
    .prepare('DELETE FROM received_files WHERE id = ?')
    .run(fileId);
  return result.changes > 0;
}
