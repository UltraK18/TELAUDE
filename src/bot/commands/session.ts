import { type Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import fs from 'fs';
import { getUserProcess, killProcess, removeUserProcess, createUserProcess, buildSessionKey, isSessionInUse } from '../../claude/process-manager.js';
import { getActiveSession, getRecentSessions, getSessionById, deactivateAllUserSessions, createSession, renameSession } from '../../db/session-repo.js';
import { writeCustomTitle, readCustomTitle } from '../../utils/cli-sessions.js';
import { config } from '../../config.js';
import { botInstanceHash } from '../bot-instance.js';
import { cancelPokeTimer } from '../../scheduler/poke.js';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Track /resume list message per session context (independent of UserProcess) */
const sessionsMessages = new Map<string, { messageId: number; chatId: number }>();

export function getSessionsMessage(userId: number, chatId?: number, threadId?: number) {
  return sessionsMessages.get(buildSessionKey(userId, chatId, threadId));
}

export function clearSessionsMessage(userId: number, chatId?: number, threadId?: number) {
  sessionsMessages.delete(buildSessionKey(userId, chatId, threadId));
}

/** Build bot DB session list text + keyboard. */
export function buildSessionList(
  sessions: import('../../db/session-repo.js').SessionRecord[],
): { text: string; keyboard: InlineKeyboard } {
  const keyboard = new InlineKeyboard();
  const lines: string[] = [];

  for (const s of sessions) {
    const active = s.is_active ? '\uD83D\uDFE2' : '\u26AA';
    const shortId = s.session_id.slice(0, 8);
    // session_name (Telaude DB) takes priority, fallback to customTitle (JSONL)
    const displayName = s.session_name || readCustomTitle(s.session_id, s.working_dir) || null;
    const nameStr = displayName ? ` <b>${escapeHtml(displayName)}</b>` : '';
    lines.push(`${active}${nameStr} <code>${shortId}...</code> ${s.model} | $${s.total_cost_usd.toFixed(4)}`);
    const btnLabel = displayName
      ? `${active} ${displayName}`
      : `${active} ${shortId}... (${s.model})`;
    keyboard
      .text(btnLabel, `${botInstanceHash}:resume:${s.session_id}`)
      .text('\u274C', `${botInstanceHash}:ds:${s.session_id}`)
      .row();
  }

  // Always add Browse CLI sessions button
  keyboard.text('\uD83D\uDD0D Browse CLI sessions', `${botInstanceHash}:sess:cli`).row();

  const header = sessions.length > 0
    ? `<b>Sessions (${sessions.length})</b>\n\n${lines.join('\n')}\n\nTap to resume.`
    : 'No bot sessions.\n\nBrowse CLI sessions to find existing ones.';
  return { text: header, keyboard };
}

export async function sessionsCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const chatId = ctx.chat?.id;
  const threadId = (ctx.message as any)?.message_thread_id ?? 0;

  const up = getUserProcess(userId, chatId, threadId);
  const candidates = [up?.workingDir, config.paths.defaultWorkingDir, process.cwd()];
  const currentDir = candidates.find(d => d && fs.existsSync(d)) ?? process.cwd();

  const sessions = getRecentSessions(userId, 10, currentDir, chatId, threadId);
  const list = buildSessionList(sessions);

  const msg = await ctx.reply(list.text, { parse_mode: 'HTML', reply_markup: list.keyboard });
  sessionsMessages.set(buildSessionKey(userId, chatId, threadId), { messageId: msg.message_id, chatId: ctx.chat!.id });
}

/** /resume — show session list (same as /sessions) */
export async function resumeCommand(ctx: Context): Promise<void> {
  return sessionsCommand(ctx);
}

export async function resumeSession(userId: number, sessionId: string, ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  const threadId = (ctx.callbackQuery?.message as any)?.message_thread_id ?? (ctx.message as any)?.message_thread_id ?? 0;

  // Prevent resuming a session that's already active in another thread
  const currentKey = buildSessionKey(userId, chatId, threadId);
  if (isSessionInUse(sessionId, currentKey)) {
    await ctx.reply('⚠️ This session is already active in another thread.');
    return;
  }

  killProcess(userId, chatId, threadId);

  const session = getSessionById(sessionId);
  let up = getUserProcess(userId, chatId, threadId);
  if (!up) {
    up = createUserProcess(
      userId,
      session?.working_dir ?? config.paths.defaultWorkingDir ?? process.cwd(),
      session?.model ?? config.claude.defaultModel,
      chatId,
      threadId,
    );
  }
  up.sessionId = sessionId;
  // Validate DB working_dir — fallback if path no longer exists (e.g. folder renamed)
  const dbDir = session?.working_dir;
  if (dbDir && fs.existsSync(dbDir)) {
    up.workingDir = dbDir;
  } else if (dbDir) {
    const fallback = config.paths.defaultWorkingDir && fs.existsSync(config.paths.defaultWorkingDir)
      ? config.paths.defaultWorkingDir
      : process.cwd();
    up.workingDir = fallback;
  }
  up.model = session?.model ?? up.model;

  // Mark this session active in DB (deactivates others) so it survives bot restart
  createSession(userId, sessionId, up.workingDir, up.model);

  await ctx.reply(
    `Session resumed: <code>${sessionId.slice(0, 8)}...</code>\nContinuing from next message.`,
    { parse_mode: 'HTML' },
  );
}

export async function renameCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const chatId = ctx.chat?.id;
  const threadId = (ctx.message as any)?.message_thread_id ?? 0;

  const args = ctx.message?.text?.split(/\s+/).slice(1).join(' ').trim();
  if (!args) {
    await ctx.reply('Usage: /rename <name>\nRenames the current active session.\nUse /rename clear to remove the name.');
    return;
  }

  const session = getActiveSession(userId, chatId, threadId);
  if (!session) {
    await ctx.reply('No active session to rename.');
    return;
  }

  const name = args.toLowerCase() === 'clear' ? null : args;

  // Write to Telaude DB
  renameSession(session.session_id, name);

  // Write custom-title record to JSONL (same as Claude Code native /rename)
  writeCustomTitle(session.session_id, name, session.working_dir);

  if (name) {
    await ctx.reply(`Session renamed to: <b>${escapeHtml(name)}</b>`, { parse_mode: 'HTML' });
  } else {
    await ctx.reply('Session name cleared.');
  }
}

export async function newCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const chatId = ctx.chat?.id;
  const threadId = (ctx.message as any)?.message_thread_id ?? 0;

  cancelPokeTimer(userId, chatId, threadId);
  killProcess(userId, chatId, threadId);
  const up = getUserProcess(userId, chatId, threadId);
  if (up) {
    up.sessionId = null;
  }
  deactivateAllUserSessions(userId, chatId, threadId);

  await ctx.reply('New session started. Send a message.');
}
