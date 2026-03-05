import { EventEmitter } from 'events';
import readline from 'readline';
import type { Readable } from 'stream';

// Claude CLI --output-format stream-json event types (--verbose mode)

export interface SystemEvent {
  type: 'system';
  subtype: string;  // 'init', etc.
  session_id?: string;
  tools?: unknown[];
}

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  name?: string;     // tool name
  id?: string;       // tool use id
  input?: unknown;   // tool input
  content?: unknown;  // tool result content
}

export interface AssistantEvent {
  type: 'assistant';
  message: {
    content: ContentBlock[];
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
    stop_reason?: string;
  };
  session_id?: string;
}

export interface ResultEvent {
  type: 'result';
  subtype?: string;
  session_id?: string;
  cost_usd?: number;
  total_cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  is_error?: boolean;
  num_turns?: number;
  result?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

export type StreamEvent = SystemEvent | AssistantEvent | ResultEvent | { type: string; [key: string]: unknown };

export class StreamParser extends EventEmitter {
  constructor() {
    super();
  }

  attachToStream(stream: Readable): void {
    const rl = readline.createInterface({ input: stream });

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const event = JSON.parse(trimmed) as StreamEvent;
        this.handleEvent(event);
      } catch (err) {
        this.emit('parse_error', trimmed, err as Error);
      }
    });

    rl.on('close', () => {
      this.emit('stream_end');
    });
  }

  private handleEvent(event: StreamEvent): void {
    this.emit('event', event);

    switch (event.type) {
      case 'system': {
        const sys = event as SystemEvent;
        if (sys.session_id) {
          this.emit('session_id', sys.session_id);
        }
        if (sys.subtype === 'status' && (event as any).status === 'compacting') {
          this.emit('compact_start');
        }
        if (sys.subtype === 'compact_boundary') {
          const meta = (event as any).compact_metadata as { trigger?: string; pre_tokens?: number } | undefined;
          this.emit('compact_end', meta?.trigger ?? 'unknown', meta?.pre_tokens ?? 0);
        }
        break;
      }

      case 'assistant': {
        const asst = event as AssistantEvent;
        if (asst.session_id) {
          this.emit('session_id', asst.session_id);
        }

        for (const block of asst.message.content) {
          if (block.type === 'text' && block.text) {
            this.emit('text', block.text);
          } else if (block.type === 'tool_use') {
            this.emit('tool_use', block.name ?? 'unknown', block.input);
          }
        }
        break;
      }

      case 'result': {
        const res = event as ResultEvent;
        this.emit('result', res);
        break;
      }
    }
  }
}
