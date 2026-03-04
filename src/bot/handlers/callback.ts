import { type Context, InlineKeyboard } from 'grammy';
import { resumeSession } from '../commands/session.js';
import { buildBrowserKeyboard } from '../commands/cd.js';
import { deleteSession, deactivateAllUserSessions, getRecentSessions } from '../../db/session-repo.js';
import { getUserProcess, killProcess } from '../../claude/process-manager.js';
import { upsertUserConfig } from '../../db/config-repo.js';
import { validatePath } from '../../utils/path-validator.js';
import { logger } from '../../utils/logger.js';

export async function callbackHandler(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  const userId = ctx.from?.id;
  if (!data || !userId) return;

  // cd:page:path — browse into folder with pagination
  if (data.startsWith('cd:') && !data.startsWith('cd_select:')) {
    const rest = data.slice(3);
    const colonIdx = rest.indexOf(':');
    const page = colonIdx >= 0 ? parseInt(rest.slice(0, colonIdx), 10) || 0 : 0;
    const dirPath = colonIdx >= 0 ? rest.slice(colonIdx + 1) : rest;

    // Validate browsing path against allowedRoots
    const pathCheck = validatePath(dirPath);
    if (!pathCheck.valid) {
      await ctx.answerCallbackQuery({ text: 'Access denied' });
      return;
    }

    const browser = buildBrowserKeyboard(dirPath, page);
    if (!browser) {
      await ctx.answerCallbackQuery({ text: 'Cannot read directory' });
      return;
    }
    try {
      await ctx.editMessageText(browser.text, {
        parse_mode: 'HTML',
        reply_markup: browser.keyboard,
      });
      await ctx.answerCallbackQuery();
    } catch (err: any) {
      console.error('cd browse error:', err?.message ?? err, 'dirPath:', dirPath, 'page:', page);
      await ctx.answerCallbackQuery({ text: 'Cannot open folder' });
    }
    return;
  }

  // cd_select: set working directory
  if (data.startsWith('cd_select:')) {
    const dirPath = data.slice(10);
    const result = validatePath(dirPath);
    if (!result.valid) {
      await ctx.answerCallbackQuery({ text: result.error ?? 'Path error' });
      return;
    }

    await ctx.answerCallbackQuery();
    // Replace browser with status message
    let statusMsgId: number | undefined;
    try {
      const edited = await ctx.editMessageText(`\u23F3 Switching to <code>${result.resolved}</code>...`, { parse_mode: 'HTML' });
      if (typeof edited !== 'boolean') statusMsgId = edited.message_id;
    } catch { /* ignore */ }

    killProcess(userId);
    upsertUserConfig(userId, { default_working_dir: result.resolved });

    const up = getUserProcess(userId);
    if (up) {
      up.workingDir = result.resolved;
      up.sessionId = null;
    }
    deactivateAllUserSessions(userId);

    logger.info({ userId, newDir: result.resolved, sessionCleared: up?.sessionId === null }, 'cd_select: directory changed');

    // Delete the status message
    if (statusMsgId) {
      try { await ctx.api.deleteMessage(ctx.chat!.id, statusMsgId); } catch { /* ignore */ }
    } else {
      try { await ctx.deleteMessage(); } catch { /* ignore */ }
    }
    return;
  }

  if (data === 'noop') {
    await ctx.answerCallbackQuery();
    return;
  }

  if (data.startsWith('resume:')) {
    const sessionId = data.slice(7);
    await ctx.answerCallbackQuery({ text: 'Resuming session...' });
    await resumeSession(userId, sessionId, ctx);
    return;
  }

  if (data.startsWith('delete_session:')) {
    const sessionId = data.slice(15);
    deleteSession(sessionId);

    // If this was the active session, clear it
    const up = getUserProcess(userId);
    if (up?.sessionId === sessionId) {
      killProcess(userId);
      up.sessionId = null;
    }

    await ctx.answerCallbackQuery({ text: 'Session deleted' });

    // Refresh the sessions list in-place
    const sessions = getRecentSessions(userId, 10);
    if (sessions.length === 0) {
      await ctx.editMessageText('No session history.');
      return;
    }

    const keyboard = new InlineKeyboard();
    const lines: string[] = [];
    for (const s of sessions) {
      const active = s.is_active ? '\uD83D\uDFE2' : '\u26AA';
      const shortId = s.session_id.slice(0, 8);
      lines.push(`${active} <code>${shortId}...</code> ${s.model} | $${s.total_cost_usd.toFixed(4)}`);
      keyboard
        .text(`${active} ${shortId}... (${s.model})`, `resume:${s.session_id}`)
        .text('\u274C', `delete_session:${s.session_id}`)
        .row();
    }

    try {
      await ctx.editMessageText(
        `<b>Recent Sessions (${sessions.length})</b>\n\n${lines.join('\n')}\n\nTap to resume a session.`,
        { parse_mode: 'HTML', reply_markup: keyboard },
      );
    } catch { /* message not modified — ignore */ }
    return;
  }

  await ctx.answerCallbackQuery();
}
