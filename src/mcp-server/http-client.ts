const apiUrl = process.env.TELAUDE_API_URL ?? 'http://127.0.0.1:19816';
const apiToken = process.env.TELAUDE_API_TOKEN ?? '';
const userId = process.env.TELAUDE_USER_ID ?? '';

export async function mcpPost(path: string, body: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telaude-Token': apiToken,
      'X-Telaude-User-Id': userId,
    },
    body: JSON.stringify(body),
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
