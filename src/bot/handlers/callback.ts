import fs from 'fs';
import { type Context, InlineKeyboard } from 'grammy';
import { resumeSession, getSessionsMessage, clearSessionsMessage, buildSessionList } from '../commands/session.js';
import { buildBrowserKeyboard } from '../commands/cd.js';
import { deleteSession, deactivateAllUserSessions, getRecentSessions } from '../../db/session-repo.js';
import { getUserProcess, killProcess } from '../../claude/process-manager.js';
import { upsertUserConfig, getUserConfig } from '../../db/config-repo.js';
import { validatePath } from '../../utils/path-validator.js';
import { resolveAsk, getAskChoices } from '../../api/ask-queue.js';
import { scanCliSessions } from '../../utils/cli-sessions.js';
import { updateJob } from '../../scheduler/cron-store.js';
import { scheduleJob, unscheduleJob } from '../../scheduler/scheduler.js';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { botInstanceHash } from '../bot-instance.js';

export async function callbackHandler(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  const userId = ctx.from?.id;
  if (!data || !userId) return;

  const chatId = ctx.callbackQuery?.message?.chat?.id;
  const threadId = (ctx.callbackQuery?.message as any)?.message_thread_id ?? 0;

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

    killProcess(userId, chatId, threadId);
    upsertUserConfig(userId, { default_working_dir: result.resolved });

    const up = getUserProcess(userId, chatId, threadId);
    if (up) {
      up.workingDir = result.resolved;
      up.sessionId = null;
    }
    deactivateAllUserSessions(userId, chatId, threadId);

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
    const choices = getAskChoices(userId, chatId, threadId);
    if (!choices || idx < 0 || idx >= choices.length) {
      await ctx.answerCallbackQuery({ text: 'Expired' });
      return;
    }
    const chosen = choices[idx];
    resolveAsk(userId, chosen, chatId, threadId);
    // Remove keyboard, keep question text
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    } catch { /* ignore */ }
    await ctx.answerCallbackQuery({ text: `✅ ${chosen}` });
    return;
  }

  // sched:pause:<id> / sched:resume:<id> — toggle scheduled job pause state
  if (data.startsWith('sched:')) {
    const parts = data.split(':');
    const action = parts[1]; // 'pause' or 'resume'
    const jobId = parts.slice(2).join(':'); // rejoin in case id contains ':'

    if (action === 'pause') {
      updateJob(jobId, { isPaused: true });
      unscheduleJob(jobId);
      await ctx.answerCallbackQuery({ text: 'Job paused' });
    } else if (action === 'resume') {
      updateJob(jobId, { isPaused: false });
      scheduleJob(jobId);
      await ctx.answerCallbackQuery({ text: 'Job resumed' });
    } else {
      await ctx.answerCallbackQuery({ text: 'Unknown action' });
    }
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
      const smsg = getSessionsMessage(userId, chatId, threadId);
      if (smsg) {
        ctx.api.deleteMessage(smsg.chatId, smsg.messageId).catch(() => {});
        clearSessionsMessage(userId, chatId, threadId);
      }

      await resumeSession(userId, sessionId, ctx);
      return;
    }

    if (rest.startsWith('ds:')) {
      const sessionId = rest.slice(3);
      deleteSession(sessionId);

      // If this was the active session, clear it
      const up = getUserProcess(userId, chatId, threadId);
      if (up?.sessionId === sessionId) {
        killProcess(userId, chatId, threadId);
        up.sessionId = null;
      }

      await ctx.answerCallbackQuery({ text: 'Session deleted' });
      await refreshBotSessions(ctx, userId, chatId, threadId);
      return;
    }

    // Browse CLI sessions from filesystem
    if (rest === 'sess:cli') {
      await ctx.answerCallbackQuery();
      await showCliSessions(ctx, userId, chatId, threadId);
      return;
    }

    // Back to bot sessions
    if (rest === 'sess:bot') {
      await ctx.answerCallbackQuery();
      await refreshBotSessions(ctx, userId, chatId, threadId);
      return;
    }
  }

  await ctx.answerCallbackQuery();
}

function getCurrentDir(userId: number, chatId?: number, threadId?: number): string {
  const up = getUserProcess(userId, chatId, threadId);
  const cfg = getUserConfig(userId);
  const candidates = [up?.workingDir, cfg.default_working_dir, config.paths.defaultWorkingDir, process.cwd()];
  return candidates.find(d => d && fs.existsSync(d)) ?? process.cwd();
}

async function refreshBotSessions(ctx: Context, userId: number, chatId?: number, threadId?: number): Promise<void> {
  const sessions = getRecentSessions(userId, 10, getCurrentDir(userId, chatId, threadId));
  const list = buildSessionList(sessions);

  try {
    await ctx.editMessageText(list.text, { parse_mode: 'HTML', reply_markup: list.keyboard });
  } catch { /* message not modified — ignore */ }
}

async function showCliSessions(ctx: Context, userId: number, chatId?: number, threadId?: number): Promise<void> {
  const currentDir = getCurrentDir(userId, chatId, threadId);
  const cliSessions = scanCliSessions(currentDir);

  // Exclude sessions already in bot DB
  const dbSessions = getRecentSessions(userId, 100, currentDir);
  const dbIds = new Set(dbSessions.map(s => s.session_id));
  const filtered = cliSessions.filter(s => !dbIds.has(s.sessionId));

  const keyboard = new InlineKeyboard();

  if (filtered.length === 0) {
    keyboard.text('\uD83D\uDCCB Telaude sessions', `${botInstanceHash}:sess:bot`).row();
    try {
      await ctx.editMessageText(
        'No additional CLI sessions found for this directory.',
        { reply_markup: keyboard },
      );
    } catch { /* ignore */ }
    return;
  }

  const lines: string[] = [];
  for (const s of filtered) {
    const shortId = s.sessionId.slice(0, 8);
    const ago = formatTimeAgo(s.lastActive);
    const nameStr = s.customTitle ? ` <b>${s.customTitle}</b>` : '';
    lines.push(`\u26AA${nameStr} <code>${shortId}...</code> ${s.model} | ${ago}`);
    const btnLabel = s.customTitle ? s.customTitle : `${shortId}... (${s.model})`;
    keyboard
      .text(btnLabel, `${botInstanceHash}:resume:${s.sessionId}`)
      .row();
  }

  keyboard.text('\uD83D\uDCCB Telaude sessions', `${botInstanceHash}:sess:bot`).row();

  try {
    await ctx.editMessageText(
      `<b>CLI Sessions (${filtered.length})</b>\n\n${lines.join('\n')}\n\nTap to resume. Session will be registered.`,
      { parse_mode: 'HTML', reply_markup: keyboard },
    );
  } catch { /* ignore */ }
}

function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
