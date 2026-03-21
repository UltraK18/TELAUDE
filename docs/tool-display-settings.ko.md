> 이 문서는 영문 원본의 한국어 번역입니다. | [English](./tool-display-settings.md)

# 도구 표시 설정

텔레그램에 표시되는 도구 호출 메시지의 표시 여부와 아이콘을 구성합니다.

## 설정 파일

프로젝트 단위 설정이 전역 설정보다 우선합니다.

- **전역**: `~/.telaude/telaude-mcp-settings.json`
- **프로젝트**: `<cwd>/.telaude/telaude-mcp-settings.json` (우선 적용)

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

`true`로 설정하면 해당 도구의 호출이 텔레그램 도구 메시지에서 숨겨집니다.

```jsonc
{ "hidden": true }
```

### icon (유니코드 이모지)

도구의 아이콘을 표준 유니코드 이모지로 변경합니다.

```jsonc
{ "icon": "🚀" }
```

### icon (프리미엄 커스텀 이모지)

텔레그램 프리미엄 커스텀 이모지(애니메이션 이모지 포함)를 사용합니다.

- `emojiId`: 텔레그램 커스텀 이모지 ID
- `fallback`: 프리미엄 미사용 클라이언트에 표시되는 유니코드 이모지

```jsonc
{ "icon": { "emojiId": "5206186681346039457", "fallback": "🧑‍🎓" } }
```

### hidden + icon

두 옵션을 동시에 설정할 수 있습니다. `hidden: true`이면 아이콘은 무시됩니다.

## MCP 도구 매칭

MCP 도구는 접미사로 매칭됩니다:

- 설정에서 `"ask"`를 지정하면 `mcp__telaude__ask`와 `mcp__other__ask` 모두 매칭
- `"mcp__telaude__ask"` 같은 정확한 이름도 사용 가능 (정확한 매칭이 우선)

## 핫리로드 동작

- 파일 변경 시 설정이 **핫리로드**됩니다 (mtime 비교로 감지, 재시작 불필요)
- 작업 디렉토리(cwd)가 변경되면 프로젝트 단위 설정이 자동으로 재감지됩니다

## 오류 처리

- **파일 없음** — 기본 동작으로 fallback (모든 도구 표시, 내장 아이콘 사용)
- **JSON 파싱 오류** — 경고 로그 출력, 기본 동작으로 fallback
- **`tools` 키 누락 또는 유효하지 않음** — 기본 동작으로 fallback
