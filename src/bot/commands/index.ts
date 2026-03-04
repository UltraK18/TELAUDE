import { type Bot } from 'grammy';
import { startCommand } from './start.js';
import { authCommand } from './auth.js';
import { helpCommand } from './help.js';
import { cdCommand, pwdCommand, projectsCommand } from './cd.js';
import { sessionsCommand, resumeCommand, newCommand, clearCommand } from './session.js';
import { stopCommand, reloadCommand } from './stop.js';
import { modelCommand } from './model.js';
import { budgetCommand } from './budget.js';
import { statsCommand } from './status.js';

export function registerCommands(bot: Bot): void {
  bot.command('start', startCommand);
  bot.command('auth', authCommand);
  bot.command('help', helpCommand);

  bot.command('cd', cdCommand);
  bot.command('pwd', pwdCommand);
  bot.command('projects', projectsCommand);

  bot.command('resume', resumeCommand);
  bot.command('new', newCommand);
  bot.command('clear', clearCommand);

  bot.command('stop', stopCommand);
  bot.command('reload', reloadCommand);
  bot.command('model', modelCommand);
  bot.command('budget', budgetCommand);
  bot.command('stats', statsCommand);
}
