import { updateSessionCost } from '../db/session-repo.js';
import { logger } from '../utils/logger.js';

export interface CostInfo {
  sessionId: string;
  costUsd: number;
  totalCostUsd: number;
  numTurns: number;
  inputTokens: number;
  outputTokens: number;
}

const sessionCosts = new Map<string, CostInfo>();

export function updateCost(
  sessionId: string,
  costUsd: number,
  totalCostUsd: number,
  numTurns: number,
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number },
): void {
  const prev = sessionCosts.get(sessionId);
  // input_tokens = new input only; add cache tokens for total context size
  const turnInput = (usage?.input_tokens ?? 0)
    + (usage?.cache_read_input_tokens ?? 0)
    + (usage?.cache_creation_input_tokens ?? 0);
  const inputTokens = (prev?.inputTokens ?? 0) + turnInput;
  const outputTokens = (prev?.outputTokens ?? 0) + (usage?.output_tokens ?? 0);

  const info: CostInfo = {
    sessionId,
    costUsd,
    totalCostUsd,
    numTurns,
    inputTokens,
    outputTokens,
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
