import { type Context } from 'grammy';
import { getUserProcess } from '../../claude/process-manager.js';
import { readConversationHistory } from '../../utils/cli-sessions.js';

const MAX_TEXT_LEN = 200;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '…';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function historyCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const up = getUserProcess(userId);
  if (!up?.sessionId) {
    await ctx.reply('No active session.', { parse_mode: 'HTML' });
    return;
  }

  const turns = readConversationHistory(up.sessionId, up.workingDir, 5);
  if (turns.length === 0) {
    await ctx.reply('No conversation history found.', { parse_mode: 'HTML' });
    return;
  }

  const lines: string[] = [`<b>Recent ${turns.length} turns</b>`];
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    lines.push('');
    lines.push(`<b>👤 User</b>`);
    lines.push(escapeHtml(truncate(t.user, MAX_TEXT_LEN)));
    lines.push(`<b>🤖 Claude</b>`);
    lines.push(escapeHtml(truncate(t.assistant, MAX_TEXT_LEN)));
  }

  const text = lines.join('\n');
  try {
    await ctx.reply(text, { parse_mode: 'HTML' });
  } catch {
    // HTML parse failure fallback
    await ctx.reply(text.replace(/<[^>]+>/g, ''));
  }
}
