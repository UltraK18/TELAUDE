> このドキュメントは英語原文の日本語翻訳です。 | [English](./tool-display-settings.md)

# ツール表示設定

Telegramに表示されるツールコールメッセージの表示/非表示とアイコンを設定します。

## 設定ファイル

プロジェクトレベルの設定はグローバル設定より優先されます。

- **グローバル**: `~/.telaude/telaude-mcp-settings.json`
- **プロジェクト**: `<cwd>/.telaude/telaude-mcp-settings.json`（優先）

```jsonc
{
  "tools": {
    "tool_name": { "hidden": true },
    "other_tool": { "icon": "🚀" },
    "fancy_tool": { "icon": { "emojiId": "5206186681346039457", "fallback": "🧑‍🎓" } }
  }
}
```

## オプション

### hidden

`true`に設定すると、そのツールの呼び出しをTelegramのツールメッセージから非表示にします。

```jsonc
{ "hidden": true }
```

### icon（Unicode絵文字）

ツールのアイコンを標準Unicode絵文字に変更します。

```jsonc
{ "icon": "🚀" }
```

### icon（プレミアムカスタム絵文字）

Telegramプレミアムカスタム絵文字（アニメーション絵文字含む）を使用します。

- `emojiId`: Telegramカスタム絵文字ID
- `fallback`: プレミアム非対応クライアントに表示されるUnicode絵文字

```jsonc
{ "icon": { "emojiId": "5206186681346039457", "fallback": "🧑‍🎓" } }
```

### hidden + icon

両方を同時に設定できます。`hidden: true`の場合、アイコンは無視されます。

## MCPツールの照合

MCPツールはサフィックスで照合されます：

- 設定で`"ask"`を指定すると、`mcp__telaude__ask`と`mcp__other__ask`の両方にマッチします
- `"mcp__telaude__ask"`のような正確な名前も使用可能（完全一致が優先）

## ホットリロード動作

- 設定はファイル変更時に**ホットリロード**されます（mtime比較で検出、再起動不要）
- 作業ディレクトリ（cwd）が変更されると、プロジェクトレベルの設定が自動的に再検出されます

## エラーハンドリング

- **ファイルが見つからない** — デフォルト動作にフォールバック（すべてのツールが表示、組み込みアイコンを使用）
- **JSON解析エラー** — 警告をログ出力し、デフォルト動作にフォールバック
- **`tools`キーが存在しないか無効** — デフォルト動作にフォールバック
