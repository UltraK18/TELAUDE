> このドキュメントは英語原文の日本語翻訳です。 | [English](./external-mcp-integration.md)

# 外部MCP連携

Telaudeは、内部HTTP API（`127.0.0.1:19816`）を通じて外部MCPサーバーにTelegramメッセージング機能を提供します。

## 環境変数（自動注入）

TelaudeがClaude CLIを起動する際、`--mcp-config`を通じてすべての外部MCPサーバーの環境に以下の変数を自動注入します：

| 変数 | 説明 |
|------|------|
| `TELAUDE_API_URL` | 内部APIアドレス（`http://127.0.0.1:19816`） |
| `TELAUDE_API_TOKEN` | リクエスト認証トークン（ランタイムで生成、プロセス終了時に破棄） |
| `TELAUDE_USER_ID` | TelegramユーザーID |
| `TELAUDE_CHAT_ID` | 現在のチャプターのチャットID（DM = userId、グループ = groupId） |
| `TELAUDE_THREAD_ID` | 現在のチャプターのスレッド/トピックID（0 = スレッドなし） |

## 利用可能なエンドポイント

すべてのリクエストには以下のヘッダーが必要です：

```
Content-Type: application/json
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
| `POST /mcp/set-reaction` | `{ emoji: string }` | ユーザーの最新メッセージに絵文字リアクションを設定 |
| `POST /mcp/pin-message` | `{}` | ボットの最新メッセージをピン留め |
| `POST /mcp/unpin-message` | `{}` | ピン留めを解除 |

## 使用例

```typescript
// Using the Telaude API from within an MCP server
const apiUrl = process.env.TELAUDE_API_URL;
const headers = {
  'Content-Type': 'application/json',
  'X-Telaude-Token': process.env.TELAUDE_API_TOKEN!,
  'X-Telaude-User-Id': process.env.TELAUDE_USER_ID!,
};

// Send an image
await fetch(`${apiUrl}/mcp/send-photo`, {
  method: 'POST', headers,
  body: JSON.stringify({ path: '/tmp/image.png' }),
});

// Send a sticker
await fetch(`${apiUrl}/mcp/send-sticker`, {
  method: 'POST', headers,
  body: JSON.stringify({ sticker_id: 'CAACAgIAAxkB...' }),
});

// Ask the user a question (with button choices)
const res = await fetch(`${apiUrl}/mcp/ask`, {
  method: 'POST', headers,
  body: JSON.stringify({ question: 'Which option?', choices: ['A', 'B', 'C'] }),
});
const { answer } = await res.json();
```

## 連携要件

- Telaudeの下で実行されるClaude Codeプロセスが起動したMCPサーバーからのみ利用可能
- Telaudeなしでローカルテストを行う場合、`TELAUDE_API_TOKEN`は設定されません — グレースフルフォールバックを推奨

```typescript
function isTelaudeAvailable(): boolean {
  return !!(process.env.TELAUDE_API_TOKEN && process.env.TELAUDE_USER_ID);
}
```

## セキュリティ

- **ローカルホスト限定**: `127.0.0.1`にのみバインド — 外部からのアクセスは不可能
- **ランタイムトークン**: Telaudeプロセスの起動時に生成、終了時に破棄（ディスクに永続化されない）
- 既存のMCPサーバー環境変数（例：`GOOGLE_API_KEY`）は保持されます
