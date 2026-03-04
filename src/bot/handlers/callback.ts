import { type Context } from 'grammy';
import { resumeSession, getSessionsMessage, clearSessionsMessage, buildSessionList } from '../commands/session.js';
import { buildBrowserKeyboard } from '../commands/cd.js';
import { deleteSession, deactivateAllUserSessions, getRecentSessions } from '../../db/session-repo.js';
import { getUserProcess, killProcess } from '../../claude/process-manager.js';
import { upsertUserConfig, getUserConfig } from '../../db/config-repo.js';
import { validatePath } from '../../utils/path-validator.js';
import { resolveAsk, getAskChoices } from '../../api/ask-queue.js';
import { logger } from '../../utils/logger.js';
import { botInstanceHash } from '../bot-instance.js';

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

  // ask:<choiceIndex> — inline button answer to ask()
  if (data.startsWith('ask:')) {
    const idx = parseInt(data.slice(4), 10);
    const choices = getAskChoices(userId);
    if (!choices || idx < 0 || idx >= choices.length) {
      await ctx.answerCallbackQuery({ text: 'Expired' });
      return;
    }
    const chosen = choices[idx];
    resolveAsk(userId, chosen);
    // Remove keyboard, keep question text
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    } catch { /* ignore */ }
    await ctx.answerCallbackQuery({ text: `✅ ${chosen}` });
    return;
  }

  if (data === 'noop') {
    await ctx.answerCallbackQuery();
    return;
  }

  // Legacy buttons without hash (from previous bot versions) — expire them
  if (data.startsWith('resume:') || data.startsWith('delete_session:')) {
    await ctx.answerCallbackQuery({ text: 'This button has expired.' });
    try { await ctx.editMessageReplyMarkup({ reply_markup: undefined }); } catch { /* ignore */ }
    return;
  }

  // Session buttons use hash prefix: {hash}:resume:{id} / {hash}:ds:{id} / {hash}:sess:{mode}
  // Reject buttons from previous bot instances
  if (data.includes(':resume:') || data.includes(':ds:') || data.includes(':sess:')) {
    const firstColon = data.indexOf(':');
    const hash = data.slice(0, firstColon);

    if (hash !== botInstanceHash) {
      await ctx.answerCallbackQuery({ text: 'This button has expired.' });
      try { await ctx.editMessageReplyMarkup({ reply_markup: undefined }); } catch { /* ignore */ }
      return;
    }

    const rest = data.slice(firstColon + 1); // "resume:{id}" or "ds:{id}" or "sess:all/dir"

    if (rest.startsWith('resume:')) {
      const sessionId = rest.slice(7);
      await ctx.answerCallbackQuery({ text: 'Resuming session...' });

      // Delete /resume list message
      const smsg = getSessionsMessage(userId);
      if (smsg) {
        ctx.api.deleteMessage(smsg.chatId, smsg.messageId).catch(() => {});
        clearSessionsMessage(userId);
      }

      await resumeSession(userId, sessionId, ctx);
      return;
    }

    if (rest.startsWith('ds:')) {
      const sessionId = rest.slice(3);
      deleteSession(sessionId);

      // If this was the active session, clear it
      const up = getUserProcess(userId);
      if (up?.sessionId === sessionId) {
        killProcess(userId);
        up.sessionId = null;
      }

      await ctx.answerCallbackQuery({ text: 'Session deleted' });
      await refreshSessionList(ctx, userId, false);
      return;
    }

    // Toggle show all / current dir
    if (rest === 'sess:all') {
      await ctx.answerCallbackQuery();
      await refreshSessionList(ctx, userId, true);
      return;
    }
    if (rest === 'sess:dir') {
      await ctx.answerCallbackQuery();
      await refreshSessionList(ctx, userId, false);
      return;
    }
  }

  await ctx.answerCallbackQuery();
}

async function refreshSessionList(ctx: Context, userId: number, showAll: boolean): Promise<void> {
  const up = getUserProcess(userId);
  const cfg = getUserConfig(userId);
  const currentDir = up?.workingDir ?? cfg.default_working_dir ?? process.cwd();

  const dirSessions = getRecentSessions(userId, 10, currentDir);
  const allSessions = getRecentSessions(userId, 10);
  const hasOtherDirSessions = allSessions.length > dirSessions.length;

  const sessions = showAll ? allSessions : dirSessions;
  if (sessions.length === 0) {
    try { await ctx.editMessageText('No session history.'); } catch { /* ignore */ }
    return;
  }

  const list = buildSessionList(sessions, showAll, hasOtherDirSessions);
  if (!list) return;

  try {
    await ctx.editMessageText(list.text, { parse_mode: 'HTML', reply_markup: list.keyboard });
  } catch { /* message not modified — ignore */ }
}
