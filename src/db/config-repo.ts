import { getDb } from './database.js';
import { config } from '../config.js';

export interface UserConfig {
  telegram_user_id: number;
  default_working_dir: string | null;
  default_model: string;
  max_budget_usd: number;
  max_turns: number;
}

export function getUserConfig(userId: number): UserConfig {
  const row = getDb()
    .prepare('SELECT * FROM user_configs WHERE telegram_user_id = ?')
    .get(userId) as UserConfig | undefined;

  if (row) return row;

  return {
    telegram_user_id: userId,
    default_working_dir: config.paths.defaultWorkingDir,
    default_model: config.claude.defaultModel,
    max_budget_usd: config.claude.defaultMaxBudgetUsd,
    max_turns: config.claude.defaultMaxTurns,
  };
}

export function upsertUserConfig(userId: number, updates: Partial<Omit<UserConfig, 'telegram_user_id'>>): void {
  const current = getUserConfig(userId);
  getDb()
    .prepare(`
      INSERT INTO user_configs (telegram_user_id, default_working_dir, default_model, max_budget_usd, max_turns)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(telegram_user_id) DO UPDATE SET
        default_working_dir = excluded.default_working_dir,
        default_model = excluded.default_model,
        max_budget_usd = excluded.max_budget_usd,
        max_turns = excluded.max_turns
    `)
    .run(
      userId,
      updates.default_working_dir ?? current.default_working_dir,
      updates.default_model ?? current.default_model,
      updates.max_budget_usd ?? current.max_budget_usd,
      updates.max_turns ?? current.max_turns,
    );
}
