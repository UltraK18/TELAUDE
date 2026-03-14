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

/** Store chat/group name (threadId=0 = group name itself) */
export function setChatName(chatId: number, name: string): void {
  setTopicName(chatId, 0, name);
}

export function getChatName(chatId: number): string | null {
  return getTopicName(chatId, 0);
}

/** Build display label for TUI: DM / topic name / group/topic */
export function buildChapterLabel(chatId: number, threadId: number, userId: number): string {
  const isDM = chatId === userId;

  if (isDM && threadId === 0) return 'DM';

  const chatName = getChatName(chatId);
  const topicName = threadId > 0 ? getTopicName(chatId, threadId) : null;

  if (isDM && threadId > 0) {
    return topicName ?? `T:${threadId}`;
  }

  // Group
  const groupLabel = chatName ?? `G:${chatId}`;
  if (threadId > 0) {
    const topicLabel = topicName ?? `T:${threadId}`;
    return `${groupLabel}/${topicLabel}`;
  }
  return groupLabel;
}
