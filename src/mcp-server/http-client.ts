const apiUrl = process.env.TELAUDE_API_URL ?? 'http://127.0.0.1:19816';
const apiToken = process.env.TELAUDE_API_TOKEN ?? '';
const userId = process.env.TELAUDE_USER_ID ?? '';
const chatId = process.env.TELAUDE_CHAT_ID ?? '';
const threadId = process.env.TELAUDE_THREAD_ID ?? '';

export async function mcpPost(path: string, body: Record<string, unknown> = {}): Promise<any> {
  const enriched: Record<string, unknown> = { ...body };
  if (chatId && !('_chatId' in enriched)) enriched._chatId = Number(chatId);
  if (threadId && !('_threadId' in enriched)) enriched._threadId = Number(threadId);
  const res = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telaude-Token': apiToken,
      'X-Telaude-User-Id': userId,
    },
    body: JSON.stringify(enriched),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }

  return res.json();
}

export function getUserId(): string {
  return userId;
}
