import { type Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import fs from 'fs';
import { getUserProcess, killProcess, removeUserProcess, createUserProcess } from '../../claude/process-manager.js';
import { getActiveSession, getRecentSessions, getSessionById, deactivateAllUserSessions, createSession } from '../../db/session-repo.js';
import { getUserConfig } from '../../db/config-repo.js';
import { config } from '../../config.js';
import { botInstanceHash } from '../bot-instance.js';
import { cancelPokeTimer } from '../../scheduler/poke.js';

/** Track /resume list message per user (independent of UserProcess) */
const sessionsMessages = new Map<number, { messageId: number; chatId: number }>();

export function getSessionsMessage(userId: number) {
  return sessionsMessages.get(userId);
}

export function clearSessionsMessage(userId: number) {
  sessionsMessages.delete(userId);
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
    lines.push(`${active} <code>${shortId}...</code> ${s.model} | $${s.total_cost_usd.toFixed(4)}`);
    keyboard
      .text(`${active} ${shortId}... (${s.model})`, `${botInstanceHash}:resume:${s.session_id}`)
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

  const up = getUserProcess(userId);
  const cfg = getUserConfig(userId);
  const candidates = [up?.workingDir, cfg.default_working_dir, config.paths.defaultWorkingDir, process.cwd()];
  const currentDir = candidates.find(d => d && fs.existsSync(d)) ?? process.cwd();

  const sessions = getRecentSessions(userId, 10, currentDir);
  const list = buildSessionList(sessions);

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
  // Validate DB working_dir — fallback if path no longer exists (e.g. folder renamed)
  const dbDir = session?.working_dir;
  if (dbDir && fs.existsSync(dbDir)) {
    up.workingDir = dbDir;
  } else if (dbDir) {
    const fallback = cfg.default_working_dir && fs.existsSync(cfg.default_working_dir)
      ? cfg.default_working_dir
      : config.paths.defaultWorkingDir ?? process.cwd();
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

export async function newCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  cancelPokeTimer(userId);
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

  cancelPokeTimer(userId);
  removeUserProcess(userId);
  deactivateAllUserSessions(userId);

  await ctx.reply('Conversation cleared.');
}
