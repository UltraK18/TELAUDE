import { getDb } from './database.js';

export interface ChapterRecord {
  user_id: number;
  chat_id: number;
  thread_id: number;
  chapter_dir: string;
  model: string;
  updated_at: string;
}

/** Save or update chapter's current directory and model */
export function saveChapter(userId: number, chatId: number, threadId: number, chapterDir: string, model?: string): void {
  getDb()
    .prepare(`INSERT OR REPLACE INTO chapters (user_id, chat_id, thread_id, chapter_dir, model, updated_at)
              VALUES (?, ?, ?, ?, ?, datetime('now'))`)
    .run(userId, chatId, threadId, chapterDir, model ?? 'default');
}

/** Get chapter record */
export function getChapter(userId: number, chatId: number, threadId: number): ChapterRecord | null {
  const row = getDb()
    .prepare('SELECT * FROM chapters WHERE user_id = ? AND chat_id = ? AND thread_id = ?')
    .get(userId, chatId, threadId) as ChapterRecord | undefined;
  return row ?? null;
}

/** Update chapter directory only */
export function updateChapterDir(userId: number, chatId: number, threadId: number, chapterDir: string): void {
  getDb()
    .prepare(`INSERT OR REPLACE INTO chapters (user_id, chat_id, thread_id, chapter_dir, model, updated_at)
              VALUES (?, ?, ?, ?, COALESCE((SELECT model FROM chapters WHERE user_id = ? AND chat_id = ? AND thread_id = ?), 'default'), datetime('now'))`)
    .run(userId, chatId, threadId, chapterDir, userId, chatId, threadId);
}

/** Update chapter model only */
export function updateChapterModel(userId: number, chatId: number, threadId: number, model: string): void {
  getDb()
    .prepare(`INSERT OR REPLACE INTO chapters (user_id, chat_id, thread_id, chapter_dir, model, updated_at)
              VALUES (?, ?, ?, COALESCE((SELECT chapter_dir FROM chapters WHERE user_id = ? AND chat_id = ? AND thread_id = ?), '.'), ?, datetime('now'))`)
    .run(userId, chatId, threadId, userId, chatId, threadId, model);
}

/** Get all chapters for a user (for startup restoration) */
export function getUserChapters(userId: number): ChapterRecord[] {
  return getDb()
    .prepare('SELECT * FROM chapters WHERE user_id = ?')
    .all(userId) as ChapterRecord[];
}

/** Delete a chapter record */
export function deleteChapter(userId: number, chatId: number, threadId: number): void {
  getDb()
    .prepare('DELETE FROM chapters WHERE user_id = ? AND chat_id = ? AND thread_id = ?')
    .run(userId, chatId, threadId);
}
