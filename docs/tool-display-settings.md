# Tool Display Settings

텔레그램에 표시되는 도구 호출 메시지의 숨김/아이콘을 설정한다.

## 설정 파일

`~/.telaude/telaude-mcp-settings.json`

```jsonc
{
  "tools": {
    "tool_name": { "hidden": true },
    "other_tool": { "icon": "🚀" },
    "fancy_tool": { "icon": { "emojiId": "5206186681346039457", "fallback": "🧑‍🎓" } }
  }
}
```

## 옵션

### hidden

`true`로 설정하면 해당 도구의 호출이 텔레그램 도구 메시지에 표시되지 않는다.

```jsonc
{ "hidden": true }
```

### icon (유니코드 이모지)

도구 아이콘을 일반 유니코드 이모지로 변경한다.

```jsonc
{ "icon": "🚀" }
```

### icon (프리미엄 커스텀 이모지)

텔레그램 프리미엄 커스텀 이모지(애니메이션 이모지 포함)를 사용한다.

- `emojiId`: 텔레그램 커스텀 이모지 ID
- `fallback`: 프리미엄이 아닌 클라이언트에서 표시될 유니코드 이모지

```jsonc
{ "icon": { "emojiId": "5206186681346039457", "fallback": "🧑‍🎓" } }
```

### hidden + icon

둘 다 설정 가능하다. `hidden: true`이면 아이콘은 무시된다.

## MCP 도구 매칭

MCP 도구는 접미사로 매칭된다:

- 설정에 `"ask"`를 등록하면 → `mcp__telaude__ask`, `mcp__other__ask` 모두 매칭
- 정확한 이름 `"mcp__telaude__ask"`도 사용 가능 (exact match 우선)

## 적용 시점

- Telaude **시작 시** 한 번 로드
- 설정 변경 후에는 **Telaude 재시작** 필요

## 오류 처리

- 파일이 없으면 → 기본 동작 (모든 도구 표시, 내장 아이콘 사용)
- JSON 파싱 실패 → 경고 로그 출력, 기본 동작으로 fallback
- `tools` 키가 없거나 잘못된 타입 → 기본 동작으로 fallback
