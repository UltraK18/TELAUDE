> 이 문서는 영문 원본의 한국어 번역입니다. | [English](./external-mcp-integration.md)

# 외부 MCP 연동

Telaude는 내부 HTTP API (`127.0.0.1:19816`)를 통해 외부 MCP 서버에 텔레그램 메시징 기능을 제공합니다.

## 환경변수 (자동 주입)

Telaude가 Claude CLI를 생성할 때, `--mcp-config`를 통해 모든 외부 MCP 서버의 환경에 다음 변수를 자동 주입합니다:

| 변수 | 설명 |
|------|------|
| `TELAUDE_API_URL` | 내부 API 주소 (`http://127.0.0.1:19816`) |
| `TELAUDE_API_TOKEN` | 요청 인증 토큰 (런타임에 생성, 프로세스 종료 시 파기) |
| `TELAUDE_USER_ID` | 텔레그램 유저 ID |
| `TELAUDE_CHAT_ID` | 현재 챕터의 채팅 ID (DM = userId, 그룹 = groupId) |
| `TELAUDE_THREAD_ID` | 현재 챕터의 스레드/토픽 ID (0 = 스레드 없음) |

## 사용 가능한 엔드포인트

모든 요청에 다음 헤더가 필요합니다:

```
Content-Type: application/json
X-Telaude-Token: <TELAUDE_API_TOKEN>
X-Telaude-User-Id: <TELAUDE_USER_ID>
```

| 엔드포인트 | Body | 설명 |
|-----------|------|------|
| `POST /mcp/send-photo` | `{ path: string }` | 이미지 파일 전송 (절대 경로) |
| `POST /mcp/send-file` | `{ path: string }` | 파일 전송 (절대 경로) |
| `POST /mcp/send-sticker` | `{ sticker_id: string }` | 스티커 전송 (Telegram file_id) |
| `POST /mcp/zip-and-send` | `{ dir: string }` | 디렉토리 zip 압축 후 전송 |
| `POST /mcp/ask` | `{ question: string, choices?: string[] }` | 사용자에게 질문하고 응답 대기 |
| `POST /mcp/set-reaction` | `{ emoji: string }` | 사용자의 최근 메시지에 이모지 리액션 |
| `POST /mcp/pin-message` | `{}` | 봇의 최근 메시지 고정 |
| `POST /mcp/unpin-message` | `{}` | 고정 메시지 해제 |

## 사용 예시

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

## 연동 요구사항

- Telaude 하에서 실행되는 Claude Code 프로세스가 생성한 MCP 서버에서만 사용 가능
- Telaude 없이 로컬에서 테스트할 때는 `TELAUDE_API_TOKEN`이 설정되지 않음 — 그레이스풀 fallback 구현 권장

```typescript
function isTelaudeAvailable(): boolean {
  return !!(process.env.TELAUDE_API_TOKEN && process.env.TELAUDE_USER_ID);
}
```

## 보안

- **localhost 전용**: `127.0.0.1`에만 바인딩 — 외부 접근 불가
- **런타임 토큰**: Telaude 프로세스 시작 시 생성, 종료 시 파기 (디스크에 저장하지 않음)
- 기존 MCP 서버 환경변수(예: `GOOGLE_API_KEY`)는 보존됨
