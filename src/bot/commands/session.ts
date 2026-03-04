import { type Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { getUserProcess, killProcess, removeUserProcess, createUserProcess } from '../../claude/process-manager.js';
import { getActiveSession, getRecentSessions, getSessionById, deactivateAllUserSessions } from '../../db/session-repo.js';
import { getUserConfig } from '../../db/config-repo.js';

export async function sessionCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const up = getUserProcess(userId);
  const dbSession = getActiveSession(userId);

  if (!up?.sessionId && !dbSession) {
    await ctx.reply('No active session. Send a message to start one.');
    return;
  }

  const sessionId = up?.sessionId ?? dbSession?.session_id ?? '(none)';
  const model = up?.model ?? dbSession?.model ?? 'unknown';
  const dir = up?.workingDir ?? dbSession?.working_dir ?? 'unknown';
  const cost = dbSession?.total_cost_usd ?? 0;
  const turns = dbSession?.total_turns ?? 0;
  const processing = up?.isProcessing ? 'processing' : 'idle';

  await ctx.reply(
    `<b>Current Session</b>\n` +
    `Session ID: <code>${sessionId}</code>\n` +
    `Model: ${model}\n` +
    `Directory: <code>${dir}</code>\n` +
    `Cost: $${cost.toFixed(4)}\n` +
    `Turns: ${turns}\n` +
    `Status: ${processing}`,
    { parse_mode: 'HTML' },
  );
}

export async function sessionsCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const sessions = getRecentSessions(userId, 10);
  if (sessions.length === 0) {
    await ctx.reply('No session history.');
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

  await ctx.reply(
    `<b>Recent Sessions (${sessions.length})</b>\n\n${lines.join('\n')}\n\nTap to resume a session.`,
    { parse_mode: 'HTML', reply_markup: keyboard },
  );
}

export async function resumeCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const text = ctx.message?.text ?? '';
  const sessionId = text.replace(/^\/resume\s*/, '').trim();

  if (!sessionId) {
    const recent = getActiveSession(userId);
    if (!recent) {
      await ctx.reply('No session to resume. Use /sessions to see the list.');
      return;
    }
    await resumeSession(userId, recent.session_id, ctx);
    return;
  }

  await resumeSession(userId, sessionId, ctx);
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
