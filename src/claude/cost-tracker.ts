import { updateSessionCost } from '../db/session-repo.js';
import { logger } from '../utils/logger.js';

export interface CostInfo {
  sessionId: string;
  costUsd: number;
  totalCostUsd: number;
  numTurns: number;
  inputTokens: number;
  outputTokens: number;
  contextWindow: number;
  model: string;
}

const sessionCosts = new Map<string, CostInfo>();

export function updateCost(
  sessionId: string,
  costUsd: number,
  totalCostUsd: number,
  numTurns: number,
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number },
  modelUsage?: Record<string, { contextWindow?: number; inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number }>,
): void {
  const prev = sessionCosts.get(sessionId);
  // Context window usage = latest turn's total (not cumulative)
  // input_tokens + cache_read + cache_creation = full context sent to API this turn
  const inputTokens = (usage?.input_tokens ?? 0)
    + (usage?.cache_read_input_tokens ?? 0)
    + (usage?.cache_creation_input_tokens ?? 0);
  const outputTokens = usage?.output_tokens ?? 0;

  // Extract contextWindow and model from modelUsage
  let contextWindow = prev?.contextWindow ?? 0;
  let model = prev?.model ?? '';
  if (modelUsage) {
    const modelKey = Object.keys(modelUsage)[0];
    if (modelKey) {
      model = modelKey;
      contextWindow = modelUsage[modelKey]?.contextWindow ?? contextWindow;
    }
  }

  const info: CostInfo = {
    sessionId,
    costUsd,
    totalCostUsd,
    numTurns,
    inputTokens,
    outputTokens,
    contextWindow,
    model,
  };

  sessionCosts.set(sessionId, info);

  // Persist to DB
  updateSessionCost(sessionId, totalCostUsd, numTurns, inputTokens, outputTokens);
  logger.info({ sessionId, costUsd, totalCostUsd, numTurns, inputTokens, outputTokens }, 'Cost updated');
}

export function getCost(sessionId: string): CostInfo | undefined {
  return sessionCosts.get(sessionId);
}

export function formatCostSummary(sessionId: string): string {
  const info = sessionCosts.get(sessionId);
  if (!info) return '';
  return `💰 $${info.totalCostUsd.toFixed(4)} (${info.numTurns} turns)`;
}
