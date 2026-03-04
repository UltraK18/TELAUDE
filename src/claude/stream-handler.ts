import { type Api } from 'grammy';
import { config } from '../config.js';
import { markdownToTelegramHtml } from '../utils/markdown-to-html.js';
import { formatToolWithInput, formatToolStart } from './tool-formatter.js';
import { updateCost } from './cost-tracker.js';
import { createSession } from '../db/session-repo.js';
import { StreamParser, type ResultEvent } from './stream-parser.js';
import { logger } from '../utils/logger.js';
import type { UserProcess } from './process-manager.js';

const TELEGRAM_MAX_LEN = 4000;
const TOOL_UPDATE_INTERVAL = 1000; // 1 second between tool edits

export interface StreamHandlerOptions {
  silent?: boolean;
}

export class StreamHandler {
  private api: Api;
  private chatId: number;
  private userId: number;
  private up: UserProcess;
  private silent: boolean;

  // Text response state
  private textBuffer = '';
  private textMessageId: number | null = null;
  private lastTextUpdateTime = 0;
  private lastSentTextLength = 0;
  private sentMessages: number[] = [];

  // Tool log state
  private toolLines: string[] = [];
  private toolMessageId: number | null = null;
  private lastToolUpdateTime = 0;
  private toolDirty = false;

  private resolveComplete: (() => void) | null = null;
  private sessionCaptured = false;

  // Sequential event processing queue
  private eventQueue: (() => Promise<void>)[] = [];
  private processingEvent = false;

  constructor(api: Api, chatId: number, userId: number, up: UserProcess, opts?: StreamHandlerOptions) {
    this.api = api;
    this.chatId = chatId;
    this.userId = userId;
    this.up = up;
    this.silent = opts?.silent ?? false;
  }

  attachToParser(parser: StreamParser): Promise<void> {
    return new Promise<void>((resolve) => {
      this.resolveComplete = resolve;

      parser.on('session_id', (sessionId: string) => {
        if (!this.sessionCaptured) {
          this.sessionCaptured = true;
          this.up.sessionId = sessionId;
          createSession(this.userId, sessionId, this.up.workingDir, this.up.model);
          logger.info({ userId: this.userId, sessionId }, 'Session captured');
        }
      });

      parser.on('text', (text: string) => {
        this.enqueue(async () => {
          // Text arrived: delete tool message, switch to text mode
          if (this.toolMessageId) {
            await this.deleteToolMessage();
          }
          this.textBuffer += text;
          await this.maybeFlushText();
        });
      });

      parser.on('tool_use', (name: string, input: unknown) => {
        this.enqueue(async () => {
          // Finalize any pending text before switching to tool mode
          await this.flushText();
          if (this.textMessageId) {
            this.sentMessages.push(this.textMessageId);
          }
          this.textMessageId = null;
          this.textBuffer = '';
          this.lastSentTextLength = 0;

          const inputStr = input ? JSON.stringify(input) : '';
          const line = inputStr
            ? formatToolWithInput(name, inputStr)
            : formatToolStart(name);
          this.toolLines.push(line);
          this.toolDirty = true;
          this.maybeFlushToolLog();
        });
      });

      parser.on('result', (event: ResultEvent) => {
        this.enqueue(async () => {
          logger.info({ userId: this.userId, responseLen: this.textBuffer.length, response: this.textBuffer.slice(0, 200) }, 'Claude response');

          // Store last response for silent mode
          if (this.silent && this.textBuffer.length > 0) {
            if (this.up.silentOkCalled) {
              // cron_ok/heartbeat_ok was called — save to reportText for history, not for auto-report
              this.up.lastReportText = this.textBuffer;
            } else {
              // ok not called — save for auto-report on exit
              this.up.lastResponseText = this.textBuffer;
            }
          }

          await this.flushToolLog();
          await this.deleteToolMessage();
          await this.flushText();

          if (event.is_error && event.result && !this.silent) {
            try {
              await this.api.sendMessage(this.chatId, `\u274C ${event.result}`);
            } catch (err) {
              logger.error({ err }, 'Failed to send error result');
            }
          }

          const sessionId = event.session_id ?? this.up.sessionId;
          logger.info({ sessionId, total_cost_usd: event.total_cost_usd, usage: event.usage, num_turns: event.num_turns }, 'Result event received');
          if (sessionId && (event.cost_usd != null || event.total_cost_usd != null)) {
            const costVal = event.total_cost_usd ?? event.cost_usd ?? 0;
            updateCost(
              sessionId,
              event.cost_usd ?? 0,
              costVal,
              event.num_turns ?? 0,
              event.usage,
            );
          }

          // isProcessing cleared by exit handler in message.ts (not here)
          this.complete();
        });
      });

      parser.on('stream_end', () => {
        this.enqueue(async () => {
          await this.flushToolLog();
          await this.deleteToolMessage();
          await this.flushText();
          // isProcessing cleared by exit handler in message.ts (not here)
          this.complete();
        });
      });

      parser.on('parse_error', (line: string, err: Error) => {
        logger.warn({ line: line.slice(0, 200), err }, 'Stream parse error');
      });
    });
  }

  // ── Tool log (single message, edit with animation) ──

  private maybeFlushToolLog(): void {
    const now = Date.now();
    if (now - this.lastToolUpdateTime >= TOOL_UPDATE_INTERVAL) {
      this.flushToolLog();
    }
  }

  private async flushToolLog(): Promise<void> {
    if (!this.toolDirty || this.toolLines.length === 0) return;
    this.toolDirty = false;
    this.lastToolUpdateTime = Date.now();
    if (this.silent) return; // Skip Telegram output in silent mode

    const text = this.toolLines.join('\n');

    try {
      if (!this.toolMessageId) {
        const msg = await this.api.sendMessage(this.chatId, text, { parse_mode: 'HTML' });
        this.toolMessageId = msg.message_id;
      } else {
        await this.api.editMessageText(this.chatId, this.toolMessageId, text, {
          parse_mode: 'HTML',
        });
      }
    } catch (err: any) {
      if (!err?.description?.includes('message is not modified')) {
        logger.error({ err }, 'Failed to flush tool log');
      }
    }
  }

  private async deleteToolMessage(): Promise<void> {
    if (!this.toolMessageId) return;
    if (this.silent) { this.toolMessageId = null; this.toolLines = []; return; }
    try {
      await this.api.deleteMessage(this.chatId, this.toolMessageId);
    } catch {
      // Message may already be deleted — ignore
    }
    this.toolMessageId = null;
    this.toolLines = [];
  }

  // ── Text response ──

  private async maybeFlushText(): Promise<void> {
    const now = Date.now();
    const timeSinceLastUpdate = now - this.lastTextUpdateTime;
    const newChars = this.textBuffer.length - this.lastSentTextLength;

    if (this.textBuffer.length > TELEGRAM_MAX_LEN) {
      await this.splitAndSendCurrent();
      return;
    }

    if (
      timeSinceLastUpdate >= config.display.streamUpdateIntervalMs ||
      newChars >= config.display.streamUpdateMinChars
    ) {
      await this.flushText();
    }
  }

  private async splitAndSendCurrent(): Promise<void> {
    const splitPoint = this.findSplitPoint(this.textBuffer, TELEGRAM_MAX_LEN);
    const toSend = this.textBuffer.slice(0, splitPoint);
    this.textBuffer = this.textBuffer.slice(splitPoint);
    this.lastSentTextLength = 0;

    if (this.textMessageId) {
      await this.editTextMessage(this.textMessageId, toSend);
      this.sentMessages.push(this.textMessageId);
    }

    this.textMessageId = null;
    if (this.textBuffer.length > 0) {
      await this.flushText();
    }
  }

  private findSplitPoint(text: string, maxLen: number): number {
    const searchRange = text.slice(0, maxLen);

    const codeBlockEnd = searchRange.lastIndexOf('\n```\n');
    if (codeBlockEnd > maxLen * 0.5) return codeBlockEnd + 5;

    const paragraphBreak = searchRange.lastIndexOf('\n\n');
    if (paragraphBreak > maxLen * 0.3) return paragraphBreak + 2;

    const lineBreak = searchRange.lastIndexOf('\n');
    if (lineBreak > maxLen * 0.3) return lineBreak + 1;

    return maxLen;
  }

  private async flushText(): Promise<void> {
    if (this.textBuffer.length === 0) return;
    if (this.textBuffer.length === this.lastSentTextLength) return;
    if (this.silent) { this.lastSentTextLength = this.textBuffer.length; this.lastTextUpdateTime = Date.now(); return; }

    const text = this.textBuffer;
    this.lastSentTextLength = text.length;
    this.lastTextUpdateTime = Date.now();

    try {
      const html = markdownToTelegramHtml(text);

      if (!this.textMessageId) {
        const msg = await this.api.sendMessage(this.chatId, html, {
          parse_mode: 'HTML',
        });
        this.textMessageId = msg.message_id;
      } else {
        await this.api.editMessageText(this.chatId, this.textMessageId, html, {
          parse_mode: 'HTML',
        });
      }
    } catch (err: any) {
      if (err?.description?.includes('parse')) {
        await this.sendOrEditPlainText(text);
      } else if (!err?.description?.includes('message is not modified')) {
        logger.error({ err }, 'Failed to flush text');
      }
    }
  }

  private async editTextMessage(messageId: number, text: string): Promise<void> {
    try {
      const html = markdownToTelegramHtml(text);
      await this.api.editMessageText(this.chatId, messageId, html, { parse_mode: 'HTML' });
    } catch {
      try {
        await this.api.editMessageText(this.chatId, messageId, text);
      } catch (err) {
        logger.error({ err }, 'Failed to edit text message');
      }
    }
  }

  private async sendOrEditPlainText(text: string): Promise<void> {
    try {
      if (!this.textMessageId) {
        const msg = await this.api.sendMessage(this.chatId, text);
        this.textMessageId = msg.message_id;
      } else {
        await this.api.editMessageText(this.chatId, this.textMessageId, text);
      }
    } catch (err) {
      logger.error({ err }, 'Failed to send plain text');
    }
  }

  private enqueue(fn: () => Promise<void>): void {
    this.eventQueue.push(fn);
    if (!this.processingEvent) {
      this.drainQueue();
    }
  }

  private async drainQueue(): Promise<void> {
    this.processingEvent = true;
    while (this.eventQueue.length > 0) {
      const fn = this.eventQueue.shift()!;
      try {
        await fn();
      } catch (err) {
        logger.error({ err }, 'Event queue handler error');
      }
    }
    this.processingEvent = false;
  }

  private complete(): void {
    if (this.resolveComplete) {
      this.resolveComplete();
      this.resolveComplete = null;
    }
  }
}
