# External MCP Integration

Telaude는 내부 HTTP API (`127.0.0.1:19816`)를 통해 외부 MCP 서버에도 텔레그램 전송 기능을 제공한다.

## 환경변수 (자동 주입)

Telaude가 Claude CLI를 spawn할 때, `--mcp-config`를 통해 모든 외부 MCP 서버의 env에 아래 변수를 자동 주입한다:

| 변수 | 설명 |
|------|------|
| `TELAUDE_API_URL` | 내부 API 주소 (`http://127.0.0.1:19816`) |
| `TELAUDE_API_TOKEN` | 요청 인증 토큰 (런타임 생성, 프로세스 종료 시 소멸) |
| `TELAUDE_USER_ID` | 텔레그램 유저 ID |

## 사용 가능한 엔드포인트

모든 요청에는 다음 헤더가 필요하다:

```
Content-Type: application/json
X-Telaude-Token: <TELAUDE_API_TOKEN>
X-Telaude-User-Id: <TELAUDE_USER_ID>
```

| Endpoint | Body | 설명 |
|----------|------|------|
| `POST /mcp/send-photo` | `{ path: string }` | 이미지 파일 전송 (절대 경로) |
| `POST /mcp/send-file` | `{ path: string }` | 일반 파일 전송 (절대 경로) |
| `POST /mcp/send-sticker` | `{ sticker_id: string }` | 스티커 전송 (Telegram file_id) |
| `POST /mcp/zip-and-send` | `{ dir: string }` | 디렉토리 zip 압축 후 전송 |
| `POST /mcp/ask` | `{ question: string, choices?: string[] }` | 사용자에게 질문하고 답변 대기 |
| `POST /mcp/pin-message` | `{}` | 최근 봇 메시지 고정 |
| `POST /mcp/unpin-message` | `{}` | 고정 메시지 해제 |

## 호출 예시

```typescript
// MCP 서버 내부에서 Telaude API 사용
const apiUrl = process.env.TELAUDE_API_URL;
const headers = {
  'Content-Type': 'application/json',
  'X-Telaude-Token': process.env.TELAUDE_API_TOKEN!,
  'X-Telaude-User-Id': process.env.TELAUDE_USER_ID!,
};

// 이미지 전송
await fetch(`${apiUrl}/mcp/send-photo`, {
  method: 'POST', headers,
  body: JSON.stringify({ path: '/tmp/image.png' }),
});

// 스티커 전송
await fetch(`${apiUrl}/mcp/send-sticker`, {
  method: 'POST', headers,
  body: JSON.stringify({ sticker_id: 'CAACAgIAAxkB...' }),
});

// 사용자에게 질문 (버튼 선택지 포함)
const res = await fetch(`${apiUrl}/mcp/ask`, {
  method: 'POST', headers,
  body: JSON.stringify({ question: '어떤 옵션?', choices: ['A', 'B', 'C'] }),
});
const { answer } = await res.json();
```

## 연동 조건

- Telaude 위에서 구동되는 Claude Code 프로세스가 spawn한 MCP 서버에서만 사용 가능
- 로컬 단독 테스트 시에는 `TELAUDE_API_TOKEN`이 없음 → graceful fallback 권장

```typescript
function isTelaudeAvailable(): boolean {
  return !!(process.env.TELAUDE_API_TOKEN && process.env.TELAUDE_USER_ID);
}
```

## 보안

- **localhost 전용**: `127.0.0.1`에만 바인딩, 외부 접근 불가
- **런타임 토큰**: Telaude 프로세스 시작 시 생성, 종료 시 소멸 (디스크 저장 없음)
- MCP 서버의 기존 env (예: `GOOGLE_API_KEY`)는 보존됨
