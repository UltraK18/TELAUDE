import { type Api } from 'grammy';
import { config } from '../config.js';
import { markdownToTelegramHtml } from '../utils/markdown-to-html.js';
import { formatToolWithInput, formatToolStart } from './tool-formatter.js';
import { updateCost } from './cost-tracker.js';
import { createSession } from '../db/session-repo.js';
import { StreamParser, type ResultEvent } from './stream-parser.js';
import { logger, notify, notifyError } from '../utils/logger.js';
import { updateSession } from '../utils/dashboard.js';
import type { UserProcess } from './process-manager.js';

const TELEGRAM_MAX_LEN = 4000;
const TOOL_UPDATE_INTERVAL = 1000; // 1 second between tool edits

const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
function toSuperscript(n: number): string {
  return String(n).split('').map(d => SUPERSCRIPT_DIGITS[+d]).join('');
}

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

  // Unified tool/agent log state (single message)
  private toolEntries = new Map<string, { line: string; isAgent: boolean }>();
  private toolMessageId: number | null = null;
  private lastToolUpdateTime = 0;
  private toolDirty = false;
  private agentToolIds = new Set<string>();  // active agent toolIds for suppress check
  private toolCount = 0;  // total tool calls counter

  private compactMessageId: number | null = null;
  private compactAnimTimer: ReturnType<typeof setInterval> | null = null;
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
          updateSession({ id: sessionId, model: this.up.model, dir: this.up.workingDir });
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

      parser.on('tool_use', (name: string, input: unknown, toolId?: string) => {
        this.enqueue(async () => {
          // TodoWrite: skip display entirely
          if (name === 'TodoWrite') return;


          // Finalize any pending text before switching to tool mode
          await this.flushText();
          if (this.textMessageId) {
            this.sentMessages.push(this.textMessageId);
          }
          this.textMessageId = null;
          this.textBuffer = '';
          this.lastSentTextLength = 0;

          const id = toolId ?? `anon_${Date.now()}`;

          if (name === 'Agent') {
            this.agentToolIds.add(id);
            const desc = (input as any)?.description ?? 'working';
            this.toolEntries.set(id, { line: `🔄 ${desc}...`, isAgent: true });
          } else {
            // Remove previous non-agent tool entries (only latest tool shown)
            for (const [key, entry] of this.toolEntries) {
              if (!entry.isAgent) this.toolEntries.delete(key);
            }
            this.toolCount++;
            const inputStr = input ? JSON.stringify(input) : '';
            let line = inputStr
              ? formatToolWithInput(name, inputStr)
              : formatToolStart(name);
            // Insert superscript counter after first emoji (skip for first tool)
            if (this.toolCount > 1) {
              const sup = toSuperscript(this.toolCount);
              line = line.replace(/^(\S+)/, `$1${sup}`);
            }
            this.toolEntries.set(id, { line, isAgent: false });
          }

          this.toolDirty = true;
          this.maybeFlushToolLog();
        });
      });

      parser.on('tool_result', (toolId?: string) => {
        this.enqueue(async () => {
          if (!toolId) return;
          const entry = this.toolEntries.get(toolId);
          if (!entry) return;

          // Agent done → remove from entries
          if (entry.isAgent) {
            this.agentToolIds.delete(toolId);
            this.toolEntries.delete(toolId);
            if (this.toolEntries.size === 0) {
              await this.deleteToolMessage();
            } else {
              this.toolDirty = true;
              await this.flushToolLog();
            }
          }
        });
      });

      parser.on('compact_start', () => {
        this.enqueue(async () => {
          if (this.silent) return;
          try {
            const msg = await this.api.sendMessage(this.chatId, '<tg-emoji emoji-id="5386367538735104399">⌛</tg-emoji> Compacting.', { parse_mode: 'HTML' });
            this.compactMessageId = msg.message_id;
            // Animate dots
            let dots = 1;
            this.compactAnimTimer = setInterval(async () => {
              if (!this.compactMessageId) { clearInterval(this.compactAnimTimer!); this.compactAnimTimer = null; return; }
              dots = (dots % 3) + 1;
              try {
                await this.api.editMessageText(this.chatId, this.compactMessageId!, '<tg-emoji emoji-id="5386367538735104399">⌛</tg-emoji> Compacting' + '.'.repeat(dots), { parse_mode: 'HTML' });
              } catch { /* ignore edit errors */ }
            }, 2000);
          } catch (err) {
            logger.error({ err }, 'Failed to send compact start notification');
          }
        });
      });

      parser.on('compact_end', (trigger: string, preTokens: number) => {
        this.enqueue(async () => {
          if (this.silent) return;
          if (this.compactAnimTimer) { clearInterval(this.compactAnimTimer); this.compactAnimTimer = null; }
          const tokenInfo = preTokens > 0 ? ` (${Math.round(preTokens / 1000)}k tokens)` : '';
          const text = `<tg-emoji emoji-id="5336985409220001678">✅</tg-emoji> Compacted${tokenInfo}`;
          try {
            if (this.compactMessageId) {
              await this.api.editMessageText(this.chatId, this.compactMessageId, text, { parse_mode: 'HTML' });
              this.compactMessageId = null;
            } else {
              await this.api.sendMessage(this.chatId, text, { parse_mode: 'HTML' });
            }
          } catch (err) {
            logger.error({ err }, 'Failed to send compact end notification');
          }
        });
      });

      parser.on('result', (event: ResultEvent) => {
        this.enqueue(async () => {
          logger.info({ userId: this.userId, responseLen: this.textBuffer.length, response: this.textBuffer.slice(0, 200) }, 'Claude response');

          // Store last response
          if (this.textBuffer.length > 0) {
            if (this.silent) {
              if (this.up.silentOkCalled) {
                // cron_ok/heartbeat_ok was called — save to reportText for history, not for auto-report
                this.up.lastReportText = this.textBuffer;
              } else {
                // ok not called — save for auto-report on exit
                this.up.lastResponseText = this.textBuffer;
              }
            } else {
              // Always store last response for poke context
              this.up.lastResponseText = this.textBuffer;
            }
          }

          await this.flushToolLog();
          await this.deleteToolMessage();
          await this.flushText();

          if (event.is_error && event.result && !this.silent) {
            notifyError(`CLI error: ${event.result.slice(0, 100)}`);
            try {
              await this.api.sendMessage(this.chatId, `\u274C ${event.result}`);
            } catch (err) {
              logger.error({ err }, 'Failed to send error result');
            }
          }

          const sessionId = event.session_id ?? this.up.sessionId;
          const costStr = event.total_cost_usd != null ? ` $${event.total_cost_usd.toFixed(4)}` : '';
          notify(`Response done (${this.textBuffer.length} chars${costStr})`);
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
          if (this.up.interrupted) {
            // Keep tool message visible with ❌ marker
            if (this.toolMessageId && this.toolEntries.size > 0) {
              this.toolEntries.set('_interrupted', { line: '\n❌ Interrupted', isAgent: false });
              this.toolDirty = true;
              await this.flushToolLog();
            } else if (!this.toolMessageId && !this.silent) {
              // No tool message visible — send standalone notice
              try {
                await this.api.sendMessage(this.chatId, '❌ Interrupted');
              } catch { /* ignore */ }
            }
            // Don't reset up.interrupted here — message.ts reads it on next send
          } else {
            await this.flushToolLog();
            await this.deleteToolMessage();
          }
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

  private buildToolText(): string {
    // Agent lines on top, then normal tool lines
    const agentLines: string[] = [];
    const toolLines: string[] = [];
    for (const entry of this.toolEntries.values()) {
      if (entry.isAgent) agentLines.push(entry.line);
      else toolLines.push(entry.line);
    }
    return [...agentLines, ...toolLines].join('\n');
  }

  private async flushToolLog(): Promise<void> {
    if (!this.toolDirty || this.toolEntries.size === 0) return;
    this.toolDirty = false;
    this.lastToolUpdateTime = Date.now();
    if (this.silent) return;

    const text = this.buildToolText();

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
    if (this.silent) { this.toolMessageId = null; this.toolEntries.clear(); this.agentToolIds.clear(); return; }
    try {
      await this.api.deleteMessage(this.chatId, this.toolMessageId);
    } catch {
      // Message may already be deleted — ignore
    }
    this.toolMessageId = null;
    this.toolEntries.clear();
    this.agentToolIds.clear();
    this.toolCount = 0;
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
        this.up.lastBotMessageId = msg.message_id;
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
