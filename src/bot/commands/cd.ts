import { type Context, InlineKeyboard } from 'grammy';
import path from 'path';
import fs from 'fs';
import { validatePath, loadAllowedRoots } from '../../utils/path-validator.js';
import { getUserProcess, killProcess, createUserProcess } from '../../claude/process-manager.js';
import { deactivateAllUserSessions } from '../../db/session-repo.js';
import { config } from '../../config.js';
import { cancelPokeTimer } from '../../scheduler/poke.js';

const PAGE_SIZE = 10;

/** Convert backslashes to forward slashes for callback_data (Telegram rejects backslashes) */
function fwd(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Build folder browser keyboard for the given directory */
export function buildBrowserKeyboard(dirPath: string, page = 0): { text: string; keyboard: InlineKeyboard } | null {
  const resolved = path.resolve(dirPath);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(resolved, { withFileTypes: true });
  } catch {
    return null;
  }

  // Filter to visible directories that fit in callback_data
  const dirs = entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => e.name)
    .filter(name => Buffer.byteLength(`cd:0:${fwd(path.join(resolved, name))}`) <= 64)
    .sort();

  const totalPages = Math.max(1, Math.ceil(dirs.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * PAGE_SIZE;
  const pageDirs = dirs.slice(start, start + PAGE_SIZE);

  const keyboard = new InlineKeyboard();

  // Top row: parent folder + select here
  const parent = path.dirname(resolved);
  if (parent !== resolved) {
    keyboard.text('\uD83D\uDD19 Up', `cd:0:${fwd(parent)}`);
  }
  const selectCb = `cd_select:${fwd(resolved)}`;
  if (Buffer.byteLength(selectCb) <= 64) {
    keyboard.text('\u2705 Select', selectCb);
  }
  keyboard.row();

  // Folder buttons (2 per row) — truncate long names for display
  const MAX_LABEL_LEN = 20;
  for (let i = 0; i < pageDirs.length; i++) {
    const fullPath = path.join(resolved, pageDirs[i]);
    const label = pageDirs[i].length > MAX_LABEL_LEN ? pageDirs[i].slice(0, MAX_LABEL_LEN - 3) + '...' : pageDirs[i];
    keyboard.text(`\uD83D\uDCC1 ${label}`, `cd:0:${fwd(fullPath)}`);
    if (i % 2 === 1) keyboard.row();
  }
  if (pageDirs.length % 2 === 1) keyboard.row();

  // Pagination row
  if (totalPages > 1) {
    if (safePage > 0) {
      keyboard.text('\u25C0 Prev', `cd:${safePage - 1}:${fwd(resolved)}`);
    }
    keyboard.text(`${safePage + 1}/${totalPages}`, 'noop');
    if (safePage < totalPages - 1) {
      keyboard.text('Next \u25B6', `cd:${safePage + 1}:${fwd(resolved)}`);
    }
    keyboard.row();
  }

  const text = `\uD83D\uDCC2 <code>${resolved}</code>\n\nSelect a folder or tap "Select" to use this directory.`;
  return { text, keyboard };
}

export async function cdCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const chatId = ctx.chat?.id;
  const threadId = (ctx.message as any)?.message_thread_id ?? 0;

  const text = ctx.message?.text ?? '';
  const targetPath = text.replace(/^\/cd\s*/, '').trim();

  // If a direct path was given, set it immediately
  if (targetPath) {
    const result = validatePath(targetPath);
    if (!result.valid) {
      await ctx.reply(result.error!);
      return;
    }

    killProcess(userId, chatId, threadId);

    const up = getUserProcess(userId, chatId, threadId);
    if (up) {
      up.workingDir = result.resolved;
      up.sessionId = null;
    }
    deactivateAllUserSessions(userId, chatId, threadId);
    cancelPokeTimer(userId, chatId, threadId);

    await ctx.reply(`Directory changed: <code>${result.resolved}</code>`, {
      parse_mode: 'HTML',
    });
    return;
  }

  // No path given: show folder browser
  const up = getUserProcess(userId, chatId, threadId);
  const candidates = [
    up?.workingDir,
    config.paths.defaultWorkingDir,
    process.cwd(),
  ];
  const currentDir = candidates.find(d => d && fs.existsSync(d)) ?? process.cwd();

  // If the stored dir was invalid, update the process to use the fallback
  if (up && up.workingDir !== currentDir) {
    up.workingDir = currentDir;
    up.sessionId = null;
    deactivateAllUserSessions(userId, chatId, threadId);
  }

  const browser = buildBrowserKeyboard(currentDir, 0);
  if (!browser) {
    await ctx.reply('Cannot read directory.');
    return;
  }

  await ctx.reply(browser.text, {
    parse_mode: 'HTML',
    reply_markup: browser.keyboard,
  });
}

export async function pwdCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const chatId = ctx.chat?.id;
  const threadId = (ctx.message as any)?.message_thread_id ?? 0;
  const up = getUserProcess(userId, chatId, threadId);
  const dir = up?.workingDir ?? config.paths.defaultWorkingDir;

  await ctx.reply(`Current directory: <code>${dir}</code>`, { parse_mode: 'HTML' });
}

export async function projectsCommand(ctx: Context): Promise<void> {
  const roots = loadAllowedRoots();
  if (roots.length === 0) {
    await ctx.reply('All paths are allowed.');
    return;
  }

  const list = roots.map(r => `\u2022 <code>${r}</code>`).join('\n');
  await ctx.reply(`<b>Allowed project paths:</b>\n${list}`, { parse_mode: 'HTML' });
}
