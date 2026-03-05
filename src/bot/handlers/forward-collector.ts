import { type Api } from 'grammy';
import { logger } from '../../utils/logger.js';

interface ForwardedMsg {
  text: string;
  source: string; // e.g. "@username", "ChannelName", "Unknown"
}

interface PendingForward {
  userId: number;
  chatId: number;
  messages: ForwardedMsg[];
  api: Api;
  debounceTimer: ReturnType<typeof setTimeout>;
  maxTimer: ReturnType<typeof setTimeout>;
}

type ForwardCompleteCallback = (
  userId: number,
  chatId: number,
  text: string,
  api: Api,
) => void;

const DEBOUNCE_MS = 1500;
const MAX_COLLECT_MS = 5000;

export class ForwardCollector {
  private pending = new Map<number, PendingForward>(); // keyed by userId
  private onComplete: ForwardCompleteCallback;

  constructor(onComplete: ForwardCompleteCallback) {
    this.onComplete = onComplete;
  }

  add(
    userId: number,
    chatId: number,
    source: string,
    text: string,
    api: Api,
  ): void {
    let group = this.pending.get(userId);

    if (!group) {
      group = {
        userId,
        chatId,
        messages: [],
        api,
        debounceTimer: setTimeout(() => this.flush(userId), DEBOUNCE_MS),
        maxTimer: setTimeout(() => this.flush(userId), MAX_COLLECT_MS),
      };
      this.pending.set(userId, group);
    } else {
      clearTimeout(group.debounceTimer);
      group.debounceTimer = setTimeout(() => this.flush(userId), DEBOUNCE_MS);
    }

    group.messages.push({ text, source });
    logger.info(
      { userId, source, msgCount: group.messages.length },
      'Added forwarded message to batch',
    );
  }

  private flush(userId: number): void {
    const group = this.pending.get(userId);
    if (!group) return;

    clearTimeout(group.debounceTimer);
    clearTimeout(group.maxTimer);
    this.pending.delete(userId);

    logger.info(
      { userId, msgCount: group.messages.length },
      'Flushing forwarded messages',
    );

    // Single message → simple format
    if (group.messages.length === 1) {
      const msg = group.messages[0];
      const result = `[Forwarded from ${msg.source}]\n${msg.text}`;
      this.onComplete(group.userId, group.chatId, result, group.api);
      return;
    }

    // Multiple messages → grouped format
    const lines: string[] = ['[Forwarded messages]'];
    let currentSource = '';

    for (const msg of group.messages) {
      if (msg.source !== currentSource) {
        currentSource = msg.source;
        lines.push(`${currentSource}: ${msg.text}`);
      } else {
        lines.push(msg.text);
      }
    }

    const result = lines.join('\n');
    this.onComplete(group.userId, group.chatId, result, group.api);
  }

  cleanup(): void {
    for (const group of this.pending.values()) {
      clearTimeout(group.debounceTimer);
      clearTimeout(group.maxTimer);
    }
    this.pending.clear();
  }
}
