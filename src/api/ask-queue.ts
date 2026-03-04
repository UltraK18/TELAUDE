import { logger } from '../utils/logger.js';

interface PendingAsk {
  question: string;
  choices?: string[];
  messageId?: number;
  chatId?: number;
  resolve: (answer: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pendingAsks = new Map<number, PendingAsk>();

const ASK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Register a question for a user. Returns a promise that resolves when the user replies.
 * Only one pending ask per user at a time.
 */
export function createAsk(userId: number, question: string, choices?: string[]): Promise<string> {
  // Cancel existing ask if any
  cancelAsk(userId);

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingAsks.delete(userId);
      reject(new Error('Ask timed out after 5 minutes'));
    }, ASK_TIMEOUT_MS);

    pendingAsks.set(userId, { question, choices, resolve, reject, timer });
    logger.info({ userId, question: question.slice(0, 100), hasChoices: !!choices }, 'Ask registered');
  });
}

/**
 * Store the message ID of the ask message (for removing keyboard later).
 */
export function setAskMessageId(userId: number, messageId: number, chatId: number): void {
  const pending = pendingAsks.get(userId);
  if (pending) {
    pending.messageId = messageId;
    pending.chatId = chatId;
  }
}

/**
 * Check if a user has a pending ask.
 */
export function hasPendingAsk(userId: number): boolean {
  return pendingAsks.has(userId);
}

/**
 * Get choices for a pending ask (for callback resolution).
 */
export function getAskChoices(userId: number): string[] | undefined {
  return pendingAsks.get(userId)?.choices;
}

/**
 * Get messageId and chatId for keyboard removal.
 */
export function getAskMessageInfo(userId: number): { messageId: number; chatId: number } | null {
  const pending = pendingAsks.get(userId);
  if (!pending?.messageId || !pending?.chatId) return null;
  return { messageId: pending.messageId, chatId: pending.chatId };
}

/**
 * Resolve a pending ask with the user's answer.
 * Returns true if there was a pending ask.
 */
export function resolveAsk(userId: number, answer: string): boolean {
  const pending = pendingAsks.get(userId);
  if (!pending) return false;

  clearTimeout(pending.timer);
  pendingAsks.delete(userId);
  pending.resolve(answer);
  logger.info({ userId, answerLen: answer.length }, 'Ask resolved');
  return true;
}

/**
 * Cancel a pending ask (e.g., on process exit).
 */
export function cancelAsk(userId: number): void {
  const pending = pendingAsks.get(userId);
  if (pending) {
    clearTimeout(pending.timer);
    pendingAsks.delete(userId);
    pending.reject(new Error('Ask cancelled'));
  }
}

/**
 * Get the pending question text for display.
 */
export function getPendingQuestion(userId: number): string | null {
  return pendingAsks.get(userId)?.question ?? null;
}
