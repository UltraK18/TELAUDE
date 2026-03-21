> このドキュメントは英語原文の日本語翻訳です。 | [English](./index.md)

# Telaude ドキュメント

## ガイド

| ドキュメント | 説明 |
|-------------|------|
| [外部MCP連携](./external-mcp-integration.ja.md) | 外部MCPサーバーがTelaudeのTelegramメッセージング機能を利用する方法 |
| [ツール表示設定](./tool-display-settings.ja.md) | ツールの非表示やアイコンのカスタマイズ（グローバル/プロジェクトレベル、ホットリロード） |

## 設定ファイルの場所

Telaudeの設定ファイルとデータは、**gitで追跡されない**専用ディレクトリに保存されます。

### グローバルディレクトリ (`~/.telaude/`)

OSユーザーのホームディレクトリ配下に配置されます。これらの設定はすべてのプロジェクトに適用されます。gitで追跡されないため、各インスタンスで手動作成が必要です。

| パス | 説明 |
|------|------|
| `~/.telaude/data/settings.json` | V2階層型設定（作業ディレクトリごと + チャプターごと） |
| `~/.telaude/data/bot.log` | ボットログファイル |
| `~/.telaude/data/sticker-cache/` | ステッカーJPGサムネイルキャッシュ |
| `~/.telaude/telaude-mcp-settings.json` | グローバルツール表示設定（非表示/アイコン） |
| `~/.telaude/allowed_project_roots.json` | `/cd`コマンドの許可パス（ファイルなし = 制限なし） |

### プロジェクトディレクトリ (`.telaude/`)

各Claudeの作業ディレクトリ（cwd）配下に配置されます。これらの設定はその特定のプロジェクトにのみ適用されます。

| パス | 説明 |
|------|------|
| `.telaude/telaude-mcp-settings.json` | プロジェクトレベルのツール表示設定（グローバルを上書き） |
| `.telaude/POKE.md` | Poke設定（Claudeが無応答時の自動フォローアップ） |
| `.telaude/HEARTBEAT.md` | Heartbeatステータスファイル（スケジュールタスク用ヘルスチェック） |

> `.telaude/`ディレクトリは`.gitignore`に含まれており、gitで追跡されません。各インスタンスで独立して設定してください。

#### allowed_project_roots.json

`/cd`コマンドが移動できるパスを制限します。ファイルが存在しない場合、すべてのパスが許可されます。

```json
[
  "/home/user/projects",
  "/home/user/work"
]
```

Windowsの例：
```json
[
  "C:\\Users\\user\\projects",
  "C:\\work"
]
```

### その他のデータファイル

| パス | 説明 |
|------|------|
| `~/.telaude/.env` | ボットトークン、パスワードハッシュなど — OSネイティブ暗号化で保護 |
| `~/.telaude/data/telaude.db` | SQLiteデータベース（セッション、スケジュールなど）— gitから除外 |
| `user_send/` | ユーザーがアップロードしたファイルの一時保存場所 — gitから除外 |

## セットアップ＆認証

### 初回実行

`bun run dev`を実行すると、セットアップウィザードが自動的に起動し、以下の手順をガイドします：

1. **Telegram Botトークン** — [@BotFather](https://t.me/BotFather)から取得
2. **認証パスワード** — ボットアクセス用パスワードの設定
3. **Claude CLI認証ステータス** — CLIが認証済みかチェック（未認証の場合は`claude`の実行を促します）

すべての入力が完了すると、`.env`ファイルが自動生成されてボットが起動します。

> **`.env`ファイルを手動で編集する必要はありません。** ウィザードが作成し、パスワードは内部で安全に保護されます。

### ボット認証

ボット起動後、Telegramで`/auth <password>`を送信して認証します。認証が完了すると、すべてのClaudeコマンドが利用可能になります。

### 環境変数 (.env)

必須変数（セットアップウィザードで作成）：

| 変数 | 説明 |
|------|------|
| `TELEGRAM_BOT_TOKEN` | BotFatherが発行したボットトークン |
| `AUTH_PASSWORD` | Telegramボット認証パスワード（bcryptハッシュとして保存） |

任意変数：

| 変数 | デフォルト | 説明 |
|------|---------|------|
| `ALLOWED_TELEGRAM_IDS` | （なし、誰でも許可） | 許可するTelegramユーザーID（カンマ区切り） |
| `CHAT_ID` | 自動検出 | ボット通知用チャットID（認証時に自動保存） |
| `CLAUDE_CLI_PATH` | `claude` | Claude CLI実行ファイルのパス |
| `DEFAULT_MODEL` | `default` | デフォルトClaudeモデル（CLIネイティブデフォルト） |
| `DEFAULT_MAX_BUDGET_USD` | `5.0` | デフォルト予算制限（USD） |
| `DEFAULT_MAX_TURNS` | `50` | デフォルト最大ターン数 |
| `DEFAULT_WORKING_DIR` | 現在のディレクトリ | デフォルト作業ディレクトリ |
| `SESSION_IDLE_TIMEOUT_MS` | `1800000` | セッションアイドルタイムアウト（ms） |
| `STREAM_UPDATE_INTERVAL_MS` | `500` | ストリーミング更新間隔（ms） |
| `STREAM_UPDATE_MIN_CHARS` | `200` | ストリーミング更新前の最小文字数 |
| `MCP_INTERNAL_API_PORT` | `19816` | 内部MCP APIポート |
| `LOG_LEVEL` | `info` | ログレベル |

### セキュリティ

Telaudeは`.env`ファイル全体をOSネイティブ暗号化（Windows DPAPI / macOS Keychain / Linux）で保護します。同じOSユーザーアカウントへのアクセスなしには復号は不可能です。

## 内部MCP APIエンドポイント

Telaudeが起動したClaudeプロセス配下で実行されるMCPサーバーは、内部HTTP API（`http://127.0.0.1:19816`）を使用してTelegram経由でメッセージを送信できます。

認証ヘッダー：

```
X-Telaude-Token: <TELAUDE_API_TOKEN>
X-Telaude-User-Id: <TELAUDE_USER_ID>
```

| エンドポイント | ボディ | 説明 |
|---------|------|------|
| `POST /mcp/send-photo` | `{ path: string }` | 画像ファイルを送信（絶対パス） |
| `POST /mcp/send-file` | `{ path: string }` | ファイルを送信（絶対パス） |
| `POST /mcp/send-sticker` | `{ sticker_id: string }` | ステッカーを送信（Telegram file_id） |
| `POST /mcp/zip-and-send` | `{ dir: string }` | ディレクトリをzip圧縮してアーカイブを送信 |
| `POST /mcp/ask` | `{ question: string, choices?: string[] }` | ユーザーに質問して応答を待つ |
| `POST /mcp/pin-message` | `{}` | ボットの最新メッセージをピン留め |
| `POST /mcp/unpin-message` | `{}` | ピン留めを解除 |
| `POST /mcp/set-reaction` | `{ emoji: string }` | ユーザーのメッセージに絵文字リアクションを設定 |

環境変数`TELAUDE_API_URL`、`TELAUDE_API_TOKEN`、`TELAUDE_USER_ID`、`TELAUDE_CHAT_ID`、`TELAUDE_THREAD_ID`は、Claude CLIの起動時にTelaudeが`--mcp-config`を通じて自動注入します。詳細は[外部MCP連携](./external-mcp-integration.ja.md)をご覧ください。
