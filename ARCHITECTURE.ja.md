> このドキュメントは英語原文の日本語翻訳です。 | [English](./ARCHITECTURE.md)

# TELAUDE アーキテクチャ

Telegram Claude Code ブリッジ — TelegramからClaude Code CLIをリモート操作するボットです。

## 技術スタック

- **ランタイム**: Bun (TypeScript, ESM)
- **ボットフレームワーク**: grammY + @grammyjs/auto-retry
- **データベース**: better-sqlite3 (WALモード)
- **認証**: bcrypt（パスワードハッシュ化）+ OSネイティブ暗号化（Windows DPAPI / macOS Keychain / Linux）
- **ロギング**: pino
- **CLI**: Claude Code (`claude -p --output-format stream-json --verbose`)
- **スケジューラー**: croner（cron式）+ setTimeout（ワンショット）
- **MCP**: 組み込みMCPサーバー（stdio）+ 外部MCP連携用内部HTTP API

## ディレクトリ構造

```
src/
├── index.ts              # Entry point (.env check → setup or bot start)
├── setup.ts              # First-run interactive setup wizard
├── config.ts             # Env → Config (Proxy lazy-load)
│
├── claude/               # Claude CLI process management
│   ├── process-manager.ts  # UserProcess map (chapterKey-based), spawn/kill/send, global MCP tool cache
│   ├── stream-parser.ts    # NDJSON stdout → EventEmitter (system/assistant/result + tools/compact)
│   ├── stream-handler.ts   # Parser events → Telegram messages (tool display + text streaming + MCP tool collection)
│   ├── tool-formatter.ts   # Tool call HTML formatting (superscript counters, agent pinning)
│   └── cost-tracker.ts     # Cost/turn/context DB updates
│
├── bot/                  # grammY bot
│   ├── bot.ts              # Bot instance + middleware/handler registration
│   ├── commands/           # Slash command handlers
│   │   ├── index.ts          # registerCommands (all commands)
│   │   ├── start.ts          # /start
│   │   ├── auth.ts           # /auth <password>
│   │   ├── help.ts           # /help
│   │   ├── session.ts        # /resume, /new, /rename, buildSessionList
│   │   ├── cd.ts             # /cd, /pwd, /projects
│   │   ├── model.ts          # /model (inline keyboard)
│   │   ├── budget.ts         # /budget
│   │   ├── stop.ts           # /stop, /stop <text>, /reload
│   │   ├── status.ts         # /stats
│   │   ├── context.ts        # /context (token usage, model, cost)
│   │   ├── compact.ts        # /compact [instructions]
│   │   ├── history.ts        # /history
│   │   └── topic.ts          # /newtopic (DM topic creation)
│   ├── handlers/
│   │   ├── message.ts        # Text/media → Claude process (session restore, queue, link preview, scheduled task drain)
│   │   ├── callback.ts       # Inline keyboard callbacks (resume, delete, browse CLI sessions)
│   │   ├── reaction.ts       # Emoji reaction handling (user↔bot)
│   │   ├── forward-collector.ts  # Batches forwarded messages into single stdin
│   │   ├── media-group-collector.ts # Batches media groups (albums) into single stdin
│   │   └── media-types.ts    # MediaInfo extraction, labels, buildMediaText
│   └── middleware/
│       ├── auth.ts             # Auth check + public commands bypass
│       ├── stale-update-filter.ts # Drop updates older than 2 minutes
│       └── topic-name-cache.ts   # Capture topic names from service messages
│
├── api/                  # Internal HTTP API (for external MCP servers)
│   ├── internal-server.ts  # HTTP server on 127.0.0.1 (socket tracking for clean shutdown)
│   ├── route-handlers.ts   # /mcp/* routes (send-photo, send-file, ask, pin, cron, etc.)
│   ├── ask-queue.ts        # Ask tool queue (inline keyboard → response promise)
│   └── tool-display-store.ts # Tool icon/hidden settings (hot-reload, mtime check)
│
├── mcp-server/           # Built-in MCP server (stdio, registered via --mcp-config)
│   ├── index.ts            # MCP server setup + tool registration
│   ├── http-client.ts      # HTTP client for internal API calls (auto-injects _chatId/_threadId)
│   └── tools/
│       ├── communication.ts  # send_file, send_photo, ask, pin/unpin, set_reaction, zip_and_send
│       ├── scheduling.ts     # schedule_add/list/update/remove/pause/resume/history/completed/nothing_to_report
│       ├── poke.ts           # poke_ok
│       └── system.ts        # get_system_info, reload
│
├── scheduler/            # Cron & one-shot job scheduling
│   ├── scheduler.ts        # Job runner (croner + one-shot timers), per-chapter independent spawn
│   ├── cron-store.ts       # Job persistence (JSON file), triggerOnChange for dashboard sync
│   ├── isolated-spawn.ts   # Isolated job spawner (independent process, no session interference)
│   ├── heartbeat.ts        # HEARTBEAT.md-based health check
│   ├── poke.ts             # Proactive follow-up timer (stdin injection)
│   └── turn-deleter.ts     # JSONL turn cleanup after scheduled tasks
│
├── settings/             # TUI settings panel
│   ├── settings-store.ts   # V2 hierarchical settings (~/.telaude/data/settings.json)
│   └── settings-tui.ts     # Blessed overlay — tab UI: [Model] [MCP Servers] [Base Tools]
│
├── db/                   # SQLite database
│   ├── database.ts         # DB init + migrations (unique indexes, column additions)
│   ├── auth-repo.ts        # auth_tokens table
│   ├── session-repo.ts     # sessions table (upsert, session_name, chapter fields)
│   ├── topic-repo.ts       # Topic name cache (chat_id + thread_id → name)
│   ├── config-repo.ts      # user_configs table
│   └── message-log-repo.ts # Message logging
│
└── utils/
    ├── logger.ts             # pino logger (file + dashboard notify)
    ├── dashboard.ts          # Blessed TUI dashboard (banner, session, schedule, logs, status bar)
    ├── link-preview.ts       # URL → context injection (X/fxtwitter, YouTube/noembed, OG meta tags)
    ├── cli-sessions.ts       # Read/write Claude Code JSONL sessions (customTitle, slug)
    ├── file-downloader.ts    # Telegram file download → user_send/ with project-relative paths
    ├── sticker-cache.ts      # Sticker → JPG thumbnail cache
    ├── markdown-to-html.ts   # Markdown → Telegram HTML conversion
    ├── message-splitter.ts   # 4000-char message splitting (code block > paragraph > line)
    ├── path-validator.ts     # Working directory validation + fallback chain
    └── machine-lock.ts       # OS-native .env encryption (DPAPI / Keychain / Linux)
```

## コアコンセプト

### 用語

| 用語 | 定義 | 識別子 |
|------|------|--------|
| **Session** | Claude CLI JSONLの会話 + DBメタデータ | `sessionId` (UUID) |
| **Chapter** | Telaudeのスレッド単位 — ユーザー + チャット + スレッドのコンテキスト | `chapterKey` = `userId:chatId:threadId` |
| **UP (UserProcess)** | チャプターごとのインメモリプロセス状態 | `processes.get(chapterKey)` |

- 各チャプターは独自のCLIプロセス、セッション、作業ディレクトリ、メッセージキュー、設定を持ちます
- 1つのチャプター内で複数のセッションを作成/再開できます
- チャプターは独立しています — スケジューリング、プロセス起動、メッセージングが他のチャプターをブロックしません

### メッセージごとのプロセス起動

```
User text message
  → messageHandler
  → Get/create UserProcess by chapterKey (restore last session from DB)
  → Link preview: fetch URL context (X/YouTube/OG) → prepend to stdin
  → spawnClaudeProcess (claude -p --resume <sessionId>)
  → stdin.write(text) + stdin.end()
  → StreamParser: parse stdout NDJSON lines
  → StreamHandler: stream to Telegram
    - init → collect MCP tool names into global cache
    - tool_use → single message, edit animation (1s throttle, superscript counters)
    - text start → delete tool message
    - text → separate message, streaming edits (500ms / 200 char intervals)
    - result → cost summary
  → Process exits → drain scheduled queue (same chapter only)
```

### Claude CLIインターフェース

```bash
claude --verbose \
       --output-format stream-json \
       --include-partial-messages \
       --dangerously-skip-permissions \
       --model <model> \
       --max-turns <turns> \
       --resume <sessionId> \
       --strict-mcp-config \
       --mcp-config <json>   # Telaude MCP + external MCPs with injected env
       --disallowedTools <tools...>  # Per-chapter tool/MCP restrictions
       -p                    # Read prompt from stdin
```

- **入力**: stdin経由のプレーンテキスト → stdin.end()
- **出力**: NDJSON（1行に1つのJSONイベント）
- **環境変数クリーンアップ**: `CLAUDECODE`、`CLAUDE_CODE*`、`ANTHROPIC_API_KEY`を削除（ネスト防止）
- **windowsHide**: true（Windowsでのサーバーソケットハンドル継承を防止）

### ストリームイベントフォーマット

```
system   → { type: "system", subtype: "init", session_id, tools: string[] }
assistant → { type: "assistant", message: { content: [{type:"text",...}, {type:"tool_use",...}], usage } }
result   → { type: "result", cost_usd, total_cost_usd, num_turns, duration_ms, session_id, modelUsage }
```

### Telegram表示戦略

1. **ツールコール**: 編集アニメーション付き単一メッセージ（1秒スロットル）
   - 上付きカウンター: `🔍² Grep`（最初のツールは上付きなし）
   - Agent（サブエージェント）ツールは上部に固定、通常ツールは下部に表示
2. **テキスト応答**: ツールメッセージを削除 → ストリーミング編集で別メッセージ表示
3. **メッセージ分割**: 4000文字で自動分割（コードブロック > 段落 > 行境界）
4. **HTML解析エラー**: プレーンテキストフォールバック
5. **圧縮アニメーション**: 2秒間隔のドットアニメーション、完了時にトークン数表示

## マルチチャプターアーキテクチャ

各チャプター（`userId:chatId:threadId`）は完全に独立しています：

- **個別のUP**: 独自のCLIプロセス、セッション、作業ディレクトリ、モデル、メッセージキュー
- **独立したスケジューリング**: Cron/Pokeジョブはユーザー単位ではなくチャプター単位で`isProcessing`をチェック
- **独立した設定**: TUIからチャプターごとのツール/MCP/モデル設定（settings.jsonに保存）
- **セッション復元**: ボット再起動時、DBのアクティブセッションがworkingDir、model、sessionIdを保持してUPとして復元
- **MCPツールキャッシュ**: グローバル（チャプター間で共有）、initイベントから収集 — どのチャプターの起動でもキャッシュが更新

### スケジュールタスクフロー

```
Cron triggers → check if target chapter is processing
  → Yes: enqueue (same chapter only, other chapters unaffected)
  → No: spawn directly in target chapter's context
    → StreamHandler (silent mode) → collect response
    → On exit: send report to correct thread (message_thread_id)
```

## TUI設定パネル

キーボードナビゲーション付きタブベースUI：

```
[Model]  [MCP Servers]  [Base Tools]
─────────────────────────────────────
 (items for selected tab)
```

- **Modelタブ**: Claudeモデルを選択（ラジオ選択）
- **MCP Serversタブ**: サーバーのオン/オフ切り替え + サーバーごとのツールサブリスト
  - 有効なサーバー: インデント付きでツールを表示（initイベントのグローバルキャッシュから）
  - ツール未収集時: "(requires first conversation)" ヒント表示
  - 無効なサーバー: ツール非表示
- **Base Toolsタブ**: 組み込みツール（Bash、Readなど）+ Telaude MCPツール
- **ナビゲーション**: ←→/Tabでタブ切り替え、↑↓で項目選択、Space/Enterでトグル、Escで閉じる
- **永続化**: disabledTools/disabledMcpServersがチャプターごとにsettings.jsonに保存

## データベーススキーマ

```sql
-- User authentication
auth_tokens (
  telegram_user_id INTEGER PRIMARY KEY,
  username TEXT,
  auth_token_hash TEXT NOT NULL,  -- bcrypt hash
  is_authorized INTEGER DEFAULT 0,
  failed_attempts INTEGER DEFAULT 0
)

-- Session management (UNIQUE index on session_id)
sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id INTEGER NOT NULL,
  session_id TEXT NOT NULL UNIQUE,
  working_dir TEXT NOT NULL,
  model TEXT DEFAULT 'default',
  is_active INTEGER DEFAULT 1,
  total_cost_usd REAL DEFAULT 0.0,
  total_turns INTEGER DEFAULT 0,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  session_name TEXT DEFAULT NULL,
  chat_id INTEGER,
  thread_id INTEGER DEFAULT 0
)

-- Chapters (persistent thread metadata)
chapters (
  user_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  thread_id INTEGER NOT NULL DEFAULT 0,
  chapter_dir TEXT,
  model TEXT,
  PRIMARY KEY (user_id, chat_id, thread_id)
)
```

## 設定の読み込み

`config.ts`は遅延読み込みのためにProxyパターンを使用しています：

```typescript
// Before loadConfig(): Proxy throws error
// After loadConfig(): normal access
export const config = new Proxy({} as Config, {
  get(_target, prop, receiver) {
    if (!_config) throw new Error('Config not loaded');
    return Reflect.get(_config, prop, receiver);
  },
});
```

これにより、`setup.ts`が.envを作成 → `loadConfig()` → 他のモジュールがconfigにアクセスという順序が可能になります。

## 内部API＆外部MCP連携

Telaudeは`127.0.0.1:19816`でHTTPサーバーを実行し、外部MCPサーバーにTelegramメッセージング機能を公開しています。

**自動注入される環境変数**（`--mcp-config`経由）：
- `TELAUDE_API_URL` — 内部APIアドレス
- `TELAUDE_API_TOKEN` — ランタイム認証トークン（終了時に破棄）
- `TELAUDE_USER_ID` — TelegramユーザーID
- `TELAUDE_CHAT_ID` — 現在のチャプターのチャットID
- `TELAUDE_THREAD_ID` — 現在のチャプターのスレッドID

**MCP http-client**は環境変数からすべてのAPIリクエストに`_chatId`と`_threadId`を自動注入し、正しいチャプターへのルーティングを保証します。

**エンドポイント**: send-photo, send-file, send-sticker, zip-and-send, ask, pin/unpin, set-reaction, cron CRUD

## スケジューラー＆Poke

- **Cronジョブ**: cronerによる定期タスク、JSONファイルに永続化
- **ワンショットジョブ**: `runAt`による単発タイマー（相対指定 "5m", "1h" および時刻指定 "09:15" に対応）
- **独立したチャプター起動**: スケジュールタスクは対象チャプターがビジー時のみキューイング、他のチャプターがアクティブでも影響なし
- **ダッシュボード同期**: scheduleJob後に`triggerOnChange()`を呼び出してIncomingセクションを更新
- **Poke**: Claudeが無応答時の自動フォローアップ — `--resume`経由でstdinに自然言語を注入
- **Heartbeat**: HEARTBEAT.mdベースのヘルスチェック

## セキュリティ

- `.env`はOSネイティブAPIで暗号化（Windows DPAPI / macOS Keychain / Linux machine-id+UID）
- 内部APIはlocalhostのみにバインド、ソケットトラッキングでクリーンシャットダウン
- ランタイムトークンはプロセスごとに生成、永続化なし
- すべてのsend-file/send-photo/zip-and-sendルートでファイルパス検証
- bcryptパスワードハッシュ化と失敗回数トラッキング
- `spawn()`は`windowsHide: true`を使用してサーバーソケットハンドル継承を防止
- Reloadは500msのACK遅延を使用してgrammYのアップデート再配信を防止

## リンクプレビュー

URL検出 → プロキシAPI取得 → Claudeのstdinにコンテキストを前置。

| プラットフォーム | 方法 | データ |
|---------|------|------|
| X/Twitter | fxtwitter API | 全文、エンゲージメント統計、画像、記事本文（Draft.jsブロック） |
| YouTube | noembed.com | タイトル、チャンネル名 |
| 一般URL | OGメタタグ解析 | タイトル、説明、サイト名（HTML取得50KB制限） |

## ツール表示設定

`telaude-mcp-settings.json`で設定可能（グローバル`~/.telaude/`またはプロジェクト`.telaude/`）。

- `hidden: true` — Telegramのツールメッセージから非表示
- `icon` — Unicode絵文字またはTelegramプレミアムカスタム絵文字（`emojiId` + `fallback`）
- MCPツールはサフィックスで照合（`mcp__server__tool` → `tool`）
- mtime比較によるホットリロード（再起動不要）
