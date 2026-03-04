import { type Context } from 'grammy';

const HELP_TEXT = `<b>Telaude Commands</b>

<b>General</b>
/start - Start
/help - This help

<b>Working Directory</b>
/cd - Change working directory
/pwd - Current directory
/projects - Allowed project paths

<b>Sessions</b>
/session - Current session info
/sessions - Recent sessions
/resume [id] - Resume session
/new - New session
/stop - Stop current task
/clear - Clear conversation

<b>Settings</b>
/model [name] - View/change model
/budget [amount] - View/set budget
/status - Bot status
/cost - Total cost`;

export async function helpCommand(ctx: Context): Promise<void> {
  await ctx.reply(HELP_TEXT, { parse_mode: 'HTML' });
}
