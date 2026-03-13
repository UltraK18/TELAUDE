import { type Context } from 'grammy';
import { getUserProcess } from '../../claude/process-manager.js';
import { readConversationHistory } from '../../utils/cli-sessions.js';

const MAX_USER_LEN = 150;
const MAX_ASST_LEN = 300;
const TG_MSG_LIMIT = 4096;

function truncate(text: string, max: number): string {
  // Collapse to single line for preview
  const oneLine = text.replace(/\n+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max) + '…';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function historyCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const chatId = ctx.chat?.id;
  const threadId = (ctx.message as any)?.message_thread_id ?? 0;
  const up = getUserProcess(userId, chatId, threadId);
  if (!up?.sessionId) {
    await ctx.reply('No active session.', { parse_mode: 'HTML' });
    return;
  }

  const allTurns = readConversationHistory(up.sessionId, up.workingDir, 5);
  if (allTurns.length === 0) {
    await ctx.reply('No conversation history found.', { parse_mode: 'HTML' });
    return;
  }

  // Build message, dropping oldest turns if it exceeds Telegram limit
  let turns = allTurns;
  let text = '';
  while (turns.length > 0) {
    const lines: string[] = [`<b>Recent ${turns.length} turns</b>`];
    for (let i = 0; i < turns.length; i++) {
      const t = turns[i];
      lines.push('');
      lines.push(`<b>👤 User</b>`);
      lines.push(escapeHtml(truncate(t.user, MAX_USER_LEN)));
      lines.push(`<b>🤖 Claude</b>`);
      const asstText = t.assistant === '(waiting…)'
        ? '<i>(waiting…)</i>'
        : escapeHtml(truncate(t.assistant, MAX_ASST_LEN));
      lines.push(asstText);
    }
    text = lines.join('\n');
    if (text.length <= TG_MSG_LIMIT) break;
    // Drop oldest turn
    turns = turns.slice(1);
  }

  try {
    await ctx.reply(text, { parse_mode: 'HTML' });
  } catch {
    await ctx.reply(text.replace(/<[^>]+>/g, ''));
  }
}
