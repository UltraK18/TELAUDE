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

/** Update context usage from the last assistant event (per-turn, not cumulative) */
export function updateContextUsage(
  sessionId: string,
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number },
): void {
  let info = sessionCosts.get(sessionId);
  if (!info) {
    info = { sessionId, costUsd: 0, totalCostUsd: 0, numTurns: 0, inputTokens: 0, outputTokens: 0, contextWindow: 0, model: '' };
    sessionCosts.set(sessionId, info);
  }
  // Last assistant turn's total = actual context window usage
  info.inputTokens = (usage.input_tokens ?? 0)
    + (usage.cache_read_input_tokens ?? 0)
    + (usage.cache_creation_input_tokens ?? 0);
  info.outputTokens = usage.output_tokens ?? 0;
}

export function updateCost(
  sessionId: string,
  costUsd: number,
  totalCostUsd: number,
  numTurns: number,
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number },
  modelUsage?: Record<string, { contextWindow?: number; inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number }>,
): void {
  const prev = sessionCosts.get(sessionId);

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
    // inputTokens/outputTokens are set by updateContextUsage from last assistant event
    inputTokens: prev?.inputTokens ?? 0,
    outputTokens: prev?.outputTokens ?? 0,
    contextWindow,
    model,
  };

  sessionCosts.set(sessionId, info);

  // Persist to DB
  updateSessionCost(sessionId, totalCostUsd, numTurns, info.inputTokens, info.outputTokens);
  logger.info({ sessionId, costUsd, totalCostUsd, numTurns, inputTokens: info.inputTokens, outputTokens: info.outputTokens }, 'Cost updated');
}

export function getCost(sessionId: string): CostInfo | undefined {
  return sessionCosts.get(sessionId);
}

export function formatCostSummary(sessionId: string): string {
  const info = sessionCosts.get(sessionId);
  if (!info) return '';
  return `💰 $${info.totalCostUsd.toFixed(4)} (${info.numTurns} turns)`;
}
