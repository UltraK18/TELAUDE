import { type Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { getUserProcess, killProcess, removeUserProcess, createUserProcess } from '../../claude/process-manager.js';
import { getActiveSession, getRecentSessions, getSessionById, deactivateAllUserSessions, createSession } from '../../db/session-repo.js';
import { getUserConfig } from '../../db/config-repo.js';
import { botInstanceHash } from '../bot-instance.js';

/** Track /resume list message per user (independent of UserProcess) */
const sessionsMessages = new Map<number, { messageId: number; chatId: number }>();

export function getSessionsMessage(userId: number) {
  return sessionsMessages.get(userId);
}

export function clearSessionsMessage(userId: number) {
  sessionsMessages.delete(userId);
}

/** Build session list text + keyboard. Returns null if no sessions. */
export function buildSessionList(
  sessions: import('../../db/session-repo.js').SessionRecord[],
  showAll: boolean,
  hasOtherDirSessions: boolean,
): { text: string; keyboard: InlineKeyboard } | null {
  if (sessions.length === 0) return null;

  const keyboard = new InlineKeyboard();
  const lines: string[] = [];

  for (const s of sessions) {
    const active = s.is_active ? '\uD83D\uDFE2' : '\u26AA';
    const shortId = s.session_id.slice(0, 8);
    if (showAll) {
      // Show dir path in all-sessions view
      const dirName = s.working_dir.split(/[\\/]/).pop() ?? s.working_dir;
      lines.push(`${active} <code>${shortId}...</code> ${s.model} | ${dirName}`);
    } else {
      lines.push(`${active} <code>${shortId}...</code> ${s.model} | $${s.total_cost_usd.toFixed(4)}`);
    }
    keyboard
      .text(`${active} ${shortId}... (${s.model})`, `${botInstanceHash}:resume:${s.session_id}`)
      .text('\u274C', `${botInstanceHash}:ds:${s.session_id}`)
      .row();
  }

  // Show toggle button
  if (showAll) {
    keyboard.text('\uD83D\uDCC2 Current dir only', `${botInstanceHash}:sess:dir`).row();
  } else if (hasOtherDirSessions) {
    keyboard.text('\uD83D\uDCCB Show all dirs', `${botInstanceHash}:sess:all`).row();
  }

  const title = showAll ? 'All Sessions' : 'Sessions';
  const text = `<b>${title} (${sessions.length})</b>\n\n${lines.join('\n')}\n\nTap to resume.`;
  return { text, keyboard };
}

export async function sessionsCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const up = getUserProcess(userId);
  const cfg = getUserConfig(userId);
  const currentDir = up?.workingDir ?? cfg.default_working_dir ?? process.cwd();

  const dirSessions = getRecentSessions(userId, 10, currentDir);
  const allSessions = getRecentSessions(userId, 10);
  const hasOtherDirSessions = allSessions.length > dirSessions.length;

  // If no sessions in current dir but exist elsewhere, show all
  const showAll = dirSessions.length === 0 && allSessions.length > 0;
  const sessions = showAll ? allSessions : dirSessions;

  if (sessions.length === 0) {
    await ctx.reply('No session history.');
    return;
  }

  const list = buildSessionList(sessions, showAll, hasOtherDirSessions);
  if (!list) return;

  const msg = await ctx.reply(list.text, { parse_mode: 'HTML', reply_markup: list.keyboard });
  sessionsMessages.set(userId, { messageId: msg.message_id, chatId: ctx.chat!.id });
}

/** /resume — show session list (same as /sessions) */
export async function resumeCommand(ctx: Context): Promise<void> {
  return sessionsCommand(ctx);
}

export async function resumeSession(userId: number, sessionId: string, ctx: Context): Promise<void> {
  killProcess(userId);

  const cfg = getUserConfig(userId);
  const session = getSessionById(sessionId);
  let up = getUserProcess(userId);
  if (!up) {
    up = createUserProcess(
      userId,
      session?.working_dir ?? cfg.default_working_dir ?? process.cwd(),
      session?.model ?? cfg.default_model,
    );
  }
  up.sessionId = sessionId;
  up.workingDir = session?.working_dir ?? up.workingDir;
  up.model = session?.model ?? up.model;

  // Mark this session active in DB (deactivates others) so it survives bot restart
  createSession(userId, sessionId, up.workingDir, up.model);

  await ctx.reply(
    `Session resumed: <code>${sessionId.slice(0, 8)}...</code>\nContinuing from next message.`,
    { parse_mode: 'HTML' },
  );
}

export async function newCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  killProcess(userId);
  const up = getUserProcess(userId);
  if (up) {
    up.sessionId = null;
  }
  deactivateAllUserSessions(userId);

  await ctx.reply('New session started. Send a message.');
}

export async function clearCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  removeUserProcess(userId);
  deactivateAllUserSessions(userId);

  await ctx.reply('Conversation cleared.');
}
