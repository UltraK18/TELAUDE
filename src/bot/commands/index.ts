import { type Bot } from 'grammy';
import { startCommand } from './start.js';
import { authCommand } from './auth.js';
import { helpCommand } from './help.js';
import { cdCommand, pwdCommand, projectsCommand } from './cd.js';
import { sessionsCommand, resumeCommand, newCommand, renameCommand } from './session.js';
import { stopCommand, reloadCommand, reloadSilentCommand } from './stop.js';
import { modelCommand } from './model.js';
import { budgetCommand } from './budget.js';
import { statsCommand } from './status.js';
import { compactCommand } from './compact.js';
import { historyCommand } from './history.js';
import { modeCommand } from './mode.js';
import { scheduleCommand } from './schedule.js';
import { usageCommand } from './usage.js';

export function registerCommands(bot: Bot): void {
  bot.command('start', startCommand);
  bot.command('auth', authCommand);
  bot.command('help', helpCommand);

  bot.command('cd', cdCommand);
  bot.command('pwd', pwdCommand);
  bot.command('projects', projectsCommand);

  bot.command('resume', resumeCommand);
  bot.command('rename', renameCommand);
  bot.command('new', newCommand);

  bot.command('stop', stopCommand);
  if (process.env['NODE_ENV'] === 'development') {
    bot.command('reload', reloadCommand);
    bot.command('reload_sil', reloadSilentCommand);
  }
  bot.command('model', modelCommand);
  bot.command('budget', budgetCommand);
  bot.command('stats', statsCommand);
  bot.command('compact', compactCommand);
  bot.command('history', historyCommand);
  bot.command('mode', modeCommand);
  bot.command('schedule', scheduleCommand);
  bot.command('usage', usageCommand);
}
