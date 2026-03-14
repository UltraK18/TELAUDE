import { type Api } from 'grammy';
import { logger } from '../../utils/logger.js';
import { fetchLinkPreviews } from '../../utils/link-preview.js';
import { buildSessionKey } from '../../claude/process-manager.js';

interface ForwardedMsg {
  text: string;
  source: string; // e.g. "@username", "ChannelName", "Unknown"
}

interface PendingForward {
  userId: number;
  chatId: number;
  threadId: number;
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
  threadId: number,
) => void;

const DEBOUNCE_MS = 1500;
const MAX_COLLECT_MS = 5000;

export class ForwardCollector {
  private pending = new Map<string, PendingForward>(); // keyed by sessionKey
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
    threadId?: number,
  ): void {
    const key = buildSessionKey(userId, chatId, threadId);
    let group = this.pending.get(key);

    if (!group) {
      group = {
        userId,
        chatId,
        threadId: threadId ?? 0,
        messages: [],
        api,
        debounceTimer: setTimeout(() => this.flush(key), DEBOUNCE_MS),
        maxTimer: setTimeout(() => this.flush(key), MAX_COLLECT_MS),
      };
      this.pending.set(key, group);
    } else {
      clearTimeout(group.debounceTimer);
      group.debounceTimer = setTimeout(() => this.flush(key), DEBOUNCE_MS);
    }

    group.messages.push({ text, source });
    logger.info(
      { userId, source, msgCount: group.messages.length },
      'Added forwarded message to batch',
    );
  }

  hasPending(userId: number, chatId?: number, threadId?: number): boolean {
    const key = buildSessionKey(userId, chatId, threadId);
    return this.pending.has(key);
  }

  addUserMessage(
    userId: number,
    chatId: number,
    text: string,
    api: Api,
    threadId?: number,
  ): void {
    const key = buildSessionKey(userId, chatId, threadId);
    const group = this.pending.get(key);
    if (!group) return; // no pending forward → should not be called

    // Reset debounce
    clearTimeout(group.debounceTimer);
    group.debounceTimer = setTimeout(() => this.flush(key), DEBOUNCE_MS);

    group.messages.push({ text, source: 'User' });
    logger.info(
      { userId, msgCount: group.messages.length },
      'Added user message to forward batch',
    );
  }

  private async flush(key: string): Promise<void> {
    const group = this.pending.get(key);
    if (!group) return;

    clearTimeout(group.debounceTimer);
    clearTimeout(group.maxTimer);
    this.pending.delete(key);

    logger.info(
      { userId: group.userId, msgCount: group.messages.length },
      'Flushing forwarded messages',
    );

    // Single message → simple format
    if (group.messages.length === 1) {
      const msg = group.messages[0];
      let result = `[Forwarded from ${msg.source}]\n${msg.text}`;

      // Fetch link previews for URLs in forwarded text
      const preview = await fetchLinkPreviews(msg.text);
      if (preview) {
        result = `${preview}\n\n${result}`;
      }

      this.onComplete(group.userId, group.chatId, result, group.api, group.threadId);
      return;
    }

    // Separate forwarded and user messages
    const forwarded = group.messages.filter(m => m.source !== 'User');
    const userMsgs = group.messages.filter(m => m.source === 'User');

    // Multiple messages → grouped format
    const lines: string[] = ['[Forwarded messages]'];
    let currentSource = '';

    for (const msg of forwarded) {
      if (msg.source !== currentSource) {
        currentSource = msg.source;
        lines.push(`${currentSource}: ${msg.text}`);
      } else {
        lines.push(msg.text);
      }
    }

    // Append user's own messages at the end
    if (userMsgs.length > 0) {
      lines.push('');
      lines.push(userMsgs.map(m => m.text).join('\n'));
    }

    let result = lines.join('\n');

    // Fetch link previews for URLs across all forwarded messages
    const allText = group.messages.map(m => m.text).join('\n');
    const preview = await fetchLinkPreviews(allText);
    if (preview) {
      result = `${preview}\n\n${result}`;
    }

    this.onComplete(group.userId, group.chatId, result, group.api, group.threadId);
  }

  cleanup(): void {
    for (const group of this.pending.values()) {
      clearTimeout(group.debounceTimer);
      clearTimeout(group.maxTimer);
    }
    this.pending.clear();
  }
}
