import { type Context } from 'grammy';

const isDev = process.env['NODE_ENV'] === 'development';

const HELP_TEXT = `<b>Telaude Commands</b>

<b>General</b>
/start - Start
/help - This help

<b>Working Directory</b>
/cd - Change working directory
/pwd - Current directory
/projects - Allowed project paths

<b>Sessions</b>
/stats - Session stats &amp; tokens
/resume - Resume session
/new - New session
/stop - Stop current task
/clear - Clear conversation
/history - Last 5 turns

<b>Settings</b>
/model [name] - View/change model
/budget [amount] - View/set budget`;

const DEV_SECTION = `

<b>Dev</b>
/reload - Restart bot (notify Claude)
/reload_sil - Restart bot (silent)`;

export async function helpCommand(ctx: Context): Promise<void> {
  const text = isDev ? HELP_TEXT + DEV_SECTION : HELP_TEXT;
  await ctx.reply(text, { parse_mode: 'HTML' });
}
