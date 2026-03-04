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
): void {
  const info: CostInfo = {
    sessionId,
    costUsd,
    totalCostUsd,
    numTurns,
    inputTokens: 0,
    outputTokens: 0,
  };

  sessionCosts.set(sessionId, info);

  // Persist to DB
  updateSessionCost(sessionId, totalCostUsd, numTurns);
  logger.info({ sessionId, costUsd, totalCostUsd, numTurns }, 'Cost updated');
}

export function getCost(sessionId: string): CostInfo | undefined {
  return sessionCosts.get(sessionId);
}

export function formatCostSummary(sessionId: string): string {
  const info = sessionCosts.get(sessionId);
  if (!info) return '';
  return `💰 $${info.totalCostUsd.toFixed(4)} (${info.numTurns} turns)`;
}
