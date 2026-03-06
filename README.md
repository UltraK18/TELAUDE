# Telaude

Telegram에서 Claude Code CLI를 원격 제어하는 봇.

텔레그램으로 메시지를 보내면, 서버에서 `claude -p` 프로세스를 spawn하여 결과를 스트리밍한다.

## Features

- **실시간 스트리밍** — Claude 응답을 텔레그램에 실시간으로 표시
- **세션 관리** — 대화 이어가기, 세션 목록, 복원
- **도구 호출 시각화** — Claude가 사용하는 도구를 텔레그램에 실시간 표시
- **MCP 서버** — 스케줄링, 파일 전송, 사용자 질문 등 MCP 도구 제공
- **외부 MCP 연동** — 다른 MCP 서버가 Telaude의 텔레그램 전송 기능을 사용 가능
- **cron/스케줄** — 예약 작업 실행 (반복/일회성)
- **Poke** — 무응답 시 자동 follow-up
- **이모지 리액션** — 양방향 리액션 (유저→봇 메시지, 봇→유저 메시지)
- **보안** — 비밀번호 인증 + OS 네이티브 암호화 (.env)

## Documentation

자세한 사용법과 설정은 **[docs/index.md](./docs/index.md)** 를 참고한다.

## Quick Start

```bash
# 의존성 설치
npm install

# 첫 실행 (셋업 위저드가 .env 생성을 안내)
npm run dev
```

셋업 위저드가 다음을 물어본다:
1. Telegram Bot Token ([@BotFather](https://t.me/BotFather)에서 생성)
2. 인증 비밀번호
3. Claude CLI 인증 상태 확인

## Commands

| Command | Description |
|---------|-------------|
| `/start` | 봇 시작 안내 |
| `/auth <pw>` | 비밀번호 인증 |
| `/help` | 명령어 목록 |
| `/new` | 새 세션 시작 |
| `/stats` | 세션 정보 + 토큰 사용량 |
| `/resume` | 최근 세션 목록 (재개/삭제) |
| `/clear` | 프로세스 + 세션 초기화 |
| `/stop` | 현재 처리 중단 |
| `/cd <path>` | 작업 디렉토리 변경 |
| `/pwd` | 현재 디렉토리 |
| `/model <name>` | 모델 변경 |
| `/budget <usd>` | 예산 설정 |

## Build & Run

```bash
npm run build     # TypeScript 빌드
npm start         # 프로덕션 실행
npm run dev       # 개발 모드 (tsx, stdin 가능)
npm run dev:watch # 개발 모드 (tsx watch)
```

## External MCP Integration

Telaude는 내부 HTTP API를 통해 **외부 MCP 서버에도 텔레그램 전송 기능을 제공**한다.

Telaude가 Claude CLI를 spawn할 때, `--mcp-config`를 통해 **모든 외부 MCP 서버에 다음 환경변수를 자동 주입**한다:

| 변수 | 설명 |
|------|------|
| `TELAUDE_API_URL` | 내부 API 주소 (`http://127.0.0.1:19816`) |
| `TELAUDE_API_TOKEN` | 요청 인증 토큰 (런타임 생성) |
| `TELAUDE_USER_ID` | 텔레그램 유저 ID |

### Available Endpoints

| Endpoint | Body | Description |
|----------|------|-------------|
| `POST /mcp/send-photo` | `{ path }` | 이미지 전송 |
| `POST /mcp/send-file` | `{ path }` | 파일 전송 |
| `POST /mcp/send-sticker` | `{ sticker_id }` | 스티커 전송 (Telegram file_id) |
| `POST /mcp/zip-and-send` | `{ dir }` | 디렉토리 zip 후 전송 |
| `POST /mcp/ask` | `{ question, choices? }` | 사용자에게 질문 |
| `POST /mcp/set-reaction` | `{ emoji }` | 유저의 최근 메시지에 이모지 리액션 |
| `POST /mcp/pin-message` | `{}` | 메시지 고정 |
| `POST /mcp/unpin-message` | `{}` | 고정 해제 |

### Tool Display Settings

설정 파일로 도구의 표시 여부와 아이콘을 설정할 수 있다. 프로젝트별 설정이 전역보다 우선한다.

- **전역**: `~/.telaude/telaude-mcp-settings.json`
- **프로젝트**: `<cwd>/.telaude/telaude-mcp-settings.json` (우선)

```jsonc
{
  "tools": {
    "yvonne_selfie": { "hidden": true },
    "yvonne_sticker": { "hidden": true },
    "some_tool": { "icon": "🚀" },
    "fancy_tool": { "icon": { "emojiId": "5206186681346039457", "fallback": "🧑‍🎓" } }
  }
}
```

- `hidden: true` — 텔레그램 도구 호출 메시지에서 숨김
- `icon` (문자열) — 유니코드 이모지로 아이콘 변경
- `icon` (객체) — 텔레그램 프리미엄 커스텀 이모지 (emojiId + fallback)
- MCP 도구는 접미사로 매칭 (`mcp__server__tool` → `tool`)
- 파일 변경 시 핫리로드 (재시작 불필요)

### Usage Example

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

Telaude가 Claude CLI를 spawn할 때 `--mcp-config`에 포함된 모든 MCP 서버의 env에 `TELAUDE_*` 변수를 자동 주입한다. MCP 서버 자체의 env(예: `GOOGLE_API_KEY`)는 보존된다. 로컬 단독 실행 시에는 환경변수가 없으므로 `isTelaudeAvailable()` 같은 graceful fallback을 구현하면 된다.

## Architecture

```
Telegram User
    ↓ message
Telaude Bot (grammY)
    ↓ spawn
claude -p --resume <sessionId>
    ↓ stream-json stdout
Telaude Stream Handler
    ↓ edit/send
Telegram Chat
```

## License

Private
