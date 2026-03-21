> このドキュメントは英語原文の日本語翻訳です。 | [English](./README.md)

# TELAUDE

Claude Code CLIをTelegramに安全に公開する、オープンソースのヘッドレスオーケストレーションブリッジです。標準的なメッセージングインターフェースを、フル機能のマルチコンテキスト開発ワークスペースに変換します。

`claude -p`（パイプモード）をベースに構築されており、SDKのハックや非公式APIを一切使わず、CLIのネイティブ機能を活用しています。

Telegramからメッセージを送信すると、サーバーが`claude -p`プロセスを起動し、結果をリアルタイムでチャットにストリーミングします。

## 機能

### ストリーミング＆マルチコンテキスト
- **リアルタイムストリーミング** — Claudeの応答がTelegramにリアルタイムでストリーミングされ、インクリメンタルに編集されます
- **マルチチャプターアーキテクチャ** — チャット/スレッド（DMトピック、グループフォーラム）ごとに独立したセッション。各チャプターは独自のCLIプロセス、セッション、作業ディレクトリ、設定を持ちます
- **セッション管理** — 会話の再開、セッション一覧、名前変更、以前のコンテキストの復元
- **ツールコール表示** — Claudeが使用中のツールをリアルタイムで表示。上付きカウンター、カスタムアイコン、圧縮インジケーターのアニメーション付き
- **Telegramネイティブ UX** — テキスト到着時にツールメッセージを自動削除、圧縮時にドットアニメーション表示、長い応答を自然な境界で自動分割（コードブロック > 段落 > 行）、HTML解析失敗時はプレーンテキストにフォールバック

### 拡張性＆MCP
- **組み込みMCPサーバー** — スケジューリング、ファイル送信、ユーザープロンプトなどのネイティブツール
- **外部MCP連携** — 他のMCPサーバーが内部HTTP APIを通じてTelaudeのTelegramメッセージング機能を利用可能
- **ツールUI設定** — グローバルまたはプロジェクトレベルの設定でツールの表示/非表示やアイコンをカスタマイズ可能

### プロアクティブなエージェントワークフロー
- **Cron / スケジューリング** — 定期的なcronジョブまたはワンショットのスケジュールタスクを実行。隔離ジョブモード対応
- **Poke** — Claudeが無応答になった際の自動フォローアップ（スリープ対応、強度設定可能）
- **Heartbeat** — スケジュールタスク用のヘルスチェック機構

### 入力＆コンテキスト
- **メディアサポート** — 写真、ドキュメント、音声、動画、ステッカー、ボイスノート
- **転送メッセージサポート** — 転送されたメッセージをまとめてClaudeにコンテキストとして送信
- **リンクプレビュー** — メッセージ内のURLからコンテキストを自動取得（X/Twitter、YouTube、OGメタタグ）
- **絵文字リアクション** — 双方向リアクション（ユーザー→ボット、ボット→ユーザー）

### モニタリング＆コントロール
- **TUIダッシュボード** — 3カラムのターミナルダッシュボード（ログ | セッション | スケジュール）。キーボード操作のみ
- **チャプターごとの設定** — TUIから各チャプターのMCP、ツール、モデル設定を独立して管理
- **コンテキスト使用量** — `/context`でリアルタイムのトークン使用量、モデル情報、コストを表示

### セキュリティ
- **OS ネイティブ暗号化** — OSレベルの暗号化で`.env`のシークレットを保護（Windows DPAPI / macOS Keychain / Linux machine-id）
- **パス検証** — ファイル操作は許可された境界内に制限
- **認証** — コマンド処理前に`/auth`によるパスワード認証

## 仕組み — SDKではなくネイティブCLI

TELAUDEはClaude Agent SDK、非公式API、OAuthトークンの抽出を**使用しません**。公式の`claude -p` CLIを子プロセスとして起動し、stdin/stdoutを通じて通信します。ターミナルで使うのと同じ方法です。

```
Telegram message → child_process.spawn('claude', ['-p', ...]) → stdin/stdout → Telegram
```

`-p`（パイプモード）の上に構築することで、TELAUDEはセッション管理、MCPサーバー連携、コンテキスト圧縮、ツール権限、プロンプトキャッシングなど、すべてのネイティブCLI機能を継承しています。再実装は一切行っていません。Telegram上でネイティブCLI体験を完全に再現することを目指しつつ、リアルタイムのツールアニメーション、スマートなメッセージ分割、インタラクティブなインラインキーボードなど、TelegramネイティブのUX拡張を追加しています。

これが重要な理由は、Anthropicの[利用規約](https://autonomee.ai/blog/claude-code-terms-of-service-explained/)がAgent SDKでのサブスクリプションOAuthトークンのサードパーティ使用を明確に禁止しており、そのようなプロジェクト（OpenClaw、OpenCode、Cline、Roo Codeなど）を[積極的にブロック](https://autonomee.ai/blog/claude-code-terms-of-service-explained/)しているためです。TELAUDEはこれを完全に回避しています。マシン上のCLIバイナリを呼び出し、意図された通りに既存のClaude Code認証を使用します。

## ドキュメント

詳細な使用方法と設定については、**[docs/index.ja.md](./docs/index.ja.md)**をご覧ください。

## クイックスタート

[Bun](https://bun.sh/)がインストールされていることを確認してください。

```bash
# Install dependencies
bun install

# First run (setup wizard guides you through .env creation)
bun run dev
```

セットアップウィザードでは以下を設定します：
1. Telegram Botトークン（[@BotFather](https://t.me/BotFather)で作成）
2. 認証パスワード
3. Claude CLI認証ステータスの確認

## コマンド

| コマンド | 説明 |
|---------|------|
| `/start` | ボットのウェルカムメッセージ |
| `/auth <pw>` | パスワードで認証 |
| `/help` | 利用可能なコマンド一覧 |
| `/new` | 新しいセッションを開始 |
| `/stats` | セッション情報 + トークン使用量 |
| `/resume` | 最近のセッション一覧（再開 / 削除） |
| `/stop` | 現在の処理を停止 |
| `/stop <text>` | 停止して新しい入力を送信 |
| `/rename <name>` | 現在のセッション名を変更（Claude Code JSONLと同期） |
| `/compact [instructions]` | 会話コンテキストを圧縮 |
| `/history` | 直近5ターンの会話を表示 |
| `/cd <path>` | 作業ディレクトリを変更 |
| `/pwd` | 現在のディレクトリを表示 |
| `/projects` | 許可されたプロジェクトパス一覧 |
| `/model [name]` | モデルの表示または変更 |
| `/budget [amount]` | トークン予算の表示または設定 |
| `/context` | コンテキストウィンドウ使用量（トークン/モデル/コスト） |
| `/schedule` | スケジュールされたジョブを表示 |

## ビルド＆実行

```bash
bun run build        # TypeScript build
bun start            # Production
bun run dev          # Development (stdin supported)
bun run dev:watch    # Development (auto-reload, no stdin)
bun run build:exe    # Compile single executable
```

> **注意:** `build:exe`は現在Windowsの実行ファイルを生成します。クロスプラットフォームのバイナリビルド（Linux、macOS）は計画中ですがまだテストされていません。コントリビューションやテストへのご協力を歓迎します。

## 外部MCP連携

Telaudeは、**外部MCPサーバーがTelegramを通じてメッセージを送信できるようにする**内部HTTP APIを公開しています。

TelaudeがClaude CLIプロセスを起動する際、`--mcp-config`を通じて以下の環境変数を**すべての外部MCPサーバー**に注入します：

| 変数 | 説明 |
|------|------|
| `TELAUDE_API_URL` | 内部APIアドレス（`http://127.0.0.1:19816`） |
| `TELAUDE_API_TOKEN` | リクエスト認証トークン（ランタイムで生成） |
| `TELAUDE_USER_ID` | TelegramユーザーID |
| `TELAUDE_CHAT_ID` | 現在のチャプターのチャットID（DM = userId、グループ = groupId） |
| `TELAUDE_THREAD_ID` | 現在のチャプターのスレッド/トピックID（0 = スレッドなし） |

### 利用可能なエンドポイント

| エンドポイント | ボディ | 説明 |
|---------|------|------|
| `POST /mcp/send-photo` | `{ path }` | 画像ファイルを送信（絶対パス） |
| `POST /mcp/send-file` | `{ path }` | ファイルを送信（絶対パス） |
| `POST /mcp/send-sticker` | `{ sticker_id }` | ステッカーを送信（Telegram file_id） |
| `POST /mcp/zip-and-send` | `{ dir }` | ディレクトリをzip圧縮して送信 |
| `POST /mcp/ask` | `{ question, choices? }` | ユーザーに質問する（インラインキーボード選択肢対応） |
| `POST /mcp/set-reaction` | `{ emoji }` | ユーザーの最新メッセージに絵文字でリアクション |
| `POST /mcp/pin-message` | `{}` | ボットの最新メッセージをピン留め |
| `POST /mcp/unpin-message` | `{}` | ピン留めを解除 |

### ツール表示設定

設定ファイルでツールの表示/非表示やアイコンを設定できます。プロジェクトレベルの設定はグローバル設定より優先されます。

- **グローバル**: `~/.telaude/telaude-mcp-settings.json`
- **プロジェクト**: `<cwd>/.telaude/telaude-mcp-settings.json`（優先）

```jsonc
{
  "tools": {
    "hidden_tool": { "hidden": true },
    "some_tool": { "icon": "🚀" },
    "fancy_tool": { "icon": { "emojiId": "5206186681346039457", "fallback": "🧑‍🎓" } }
  }
}
```

- `hidden: true` — Telegramのツールコールメッセージからツールを非表示
- `icon`（文字列） — ツールアイコンをUnicode絵文字で上書き
- `icon`（オブジェクト） — Telegramプレミアムカスタム絵文字を使用（`emojiId` + `fallback`）
- MCPツールはサフィックスで照合（`mcp__server__tool`は`tool`にマッチ）
- ファイル変更時にホットリロード（再起動不要）

### 使用例

```typescript
const res = await fetch(process.env.TELAUDE_API_URL + '/mcp/send-photo', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Telaude-Token': process.env.TELAUDE_API_TOKEN!,
    'X-Telaude-User-Id': process.env.TELAUDE_USER_ID!,
  },
  body: JSON.stringify({ path: '/tmp/image.png' }),
});
```

TelaudeはClaude CLIを起動する際、`--mcp-config`に記載されたすべてのMCPサーバーに`TELAUDE_*`環境変数を自動注入します。各MCPサーバー独自の環境変数（例：`GOOGLE_API_KEY`）は保持されます。Telaudeなしのスタンドアロンローカル使用時は、`isTelaudeAvailable()`を使用してグレースフルフォールバックを実装してください。

## アーキテクチャ

```text
[ Telegram Client ]
       │ (Message)
       ▼
[ Telaude Bot (grammY) ]
       │ (Spawns isolated process per chapter)
       ▼
[ claude -p --resume <sessionId> ]
       │ (Streams stdout via NDJSON)
       ▼
[ Telaude Stream Handler ]
       │ (Parses chunks, applies UI formatting)
       ▼
[ Telegram Client ] (Real-time message edit)
```

## コントリビューション

TELAUDEは完全なオープンソースです。コントリビューション、バグレポート、クロスプラットフォームテストを歓迎します。特に以下の分野：
- **macOS / Linux バイナリビルド** — `build:exe`は現在Windows専用
- **macOS Keychain連携** — OSネイティブ暗号化には実機テストが必要
- **ターミナル互換性** — 非Windowsターミナル（macOS、Termux）でのTUI入力問題

## ライセンス

MIT

---

*TELAUDEはTelegramを通じてClaude Codeで100%構築されました — このシステムが生み出すものを使って、完全に開発されています。*
