import { getDb } from './database.js';

export function setTopicName(chatId: number, threadId: number, name: string): void {
  getDb()
    .prepare('INSERT OR REPLACE INTO topic_names (chat_id, thread_id, name, updated_at) VALUES (?, ?, ?, datetime(\'now\'))')
    .run(chatId, threadId, name);
}

export function getTopicName(chatId: number, threadId: number): string | null {
  const row = getDb()
    .prepare('SELECT name FROM topic_names WHERE chat_id = ? AND thread_id = ?')
    .get(chatId, threadId) as { name: string } | undefined;
  return row?.name ?? null;
}
