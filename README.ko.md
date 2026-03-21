> 이 문서는 영문 원본의 한국어 번역입니다. | [English](./README.md)

# TELAUDE

Claude Code CLI를 텔레그램에 안전하게 연결하는 오픈소스 헤드리스 오케스트레이션 브릿지입니다. 표준 메시징 인터페이스를 완전한 기능을 갖춘 멀티컨텍스트 개발 워크스페이스로 변환합니다.

`claude -p` (파이프 모드) 위에 전적으로 구축되어 있으며, SDK 해킹이나 비공식 API 없이 CLI의 네이티브 기능을 활용합니다.

텔레그램으로 메시지를 보내면, 서버가 `claude -p` 프로세스를 생성하여 결과를 실시간으로 채팅에 스트리밍합니다.

## 기능

### 스트리밍 & 멀티컨텍스트
- **실시간 스트리밍** — Claude 응답이 점진적 편집으로 텔레그램에 실시간 스트리밍됩니다
- **멀티챕터 아키텍처** — 채팅/스레드별(DM 토픽, 그룹 포럼) 독립 세션. 각 챕터는 자체 CLI 프로세스, 세션, 작업 디렉토리, 설정을 가집니다
- **세션 관리** — 대화 이어가기, 세션 목록 보기, 이름 변경, 이전 컨텍스트 복원
- **도구 호출 시각화** — Claude가 사용 중인 도구를 실시간으로 확인 가능. 위첨자 카운터, 커스텀 아이콘, 압축 애니메이션 지원
- **텔레그램 네이티브 UX** — 텍스트 도착 시 도구 메시지 자동 삭제, 압축 시 애니메이션 점 표시, 긴 응답 자연 경계에서 자동 분할 (코드 블록 > 문단 > 줄), HTML 파싱 실패 시 플레인 텍스트 fallback

### 확장성 & MCP
- **내장 MCP 서버** — 스케줄링, 파일 전송, 사용자 프롬프트 등을 위한 네이티브 도구
- **외부 MCP 연동** — 다른 MCP 서버가 내부 HTTP API를 통해 Telaude의 텔레그램 메시징 기능을 사용 가능
- **도구 UI 커스터마이징** — 도구 표시 여부와 아이콘을 전역 또는 프로젝트 단위로 완전히 커스터마이징 가능

### 능동적 에이전트 워크플로우
- **Cron / 스케줄링** — 예약 작업 실행 (반복 cron 또는 일회성), 격리 잡 모드 지원
- **Poke** — Claude가 침묵할 때 자동 후속 조치 (슬립 인식, 강도 조절 가능)
- **Heartbeat** — 예약 작업을 위한 상태 확인 메커니즘

### 입력 & 컨텍스트
- **미디어 지원** — 사진, 문서, 오디오, 비디오, 스티커, 음성 메모
- **전달 메시지 지원** — 전달된 메시지를 수집하여 Claude에 컨텍스트로 전달
- **링크 프리뷰** — 메시지에 공유된 URL의 컨텍스트를 자동 가져오기 (X/Twitter, YouTube, OG 메타 태그)
- **이모지 리액션** — 양방향 리액션 (사용자→봇, 봇→사용자 메시지)

### 모니터링 & 제어
- **TUI 대시보드** — 3열 터미널 대시보드 (로그 | 세션 | 스케줄), 키보드 전용 내비게이션
- **챕터별 설정** — 각 챕터가 TUI를 통해 독립적인 MCP, 도구, 모델 설정 보유
- **컨텍스트 사용량** — `/context`로 실시간 토큰 사용량, 모델 정보, 비용 확인

### 보안
- **OS 네이티브 암호화** — OS 수준 암호화(Windows DPAPI / macOS Keychain / Linux machine-id)로 `.env` 보안 보호
- **경로 검증** — 파일 작업이 허용된 범위로 제한
- **인증** — 모든 명령어 처리 전 `/auth`를 통한 비밀번호 인증

## 작동 원리 — 네이티브 CLI, SDK 아님

TELAUDE는 Claude Agent SDK, 비공식 API, OAuth 토큰 추출을 사용하지 **않습니다**. 공식 `claude -p` CLI를 자식 프로세스로 생성하고 stdin/stdout으로 통신합니다 — 터미널에서 사용하는 것과 동일한 방식입니다.

```
Telegram message → child_process.spawn('claude', ['-p', ...]) → stdin/stdout → Telegram
```

`-p` (파이프 모드)를 기반으로 구축함으로써, TELAUDE는 세션 관리, MCP 서버 통합, 컨텍스트 압축, 도구 권한, 프롬프트 캐싱 등 모든 네이티브 CLI 기능을 상속받으며, 이를 재구현하지 않습니다. 텔레그램을 통해 완전한 네이티브 CLI 경험을 반영하는 데 모든 노력을 기울이며, 실시간 도구 애니메이션, 스마트 메시지 분할, 인터랙티브 인라인 키보드 같은 텔레그램 네이티브 UX 개선을 추가합니다.

이것이 중요한 이유는 Anthropic의 [서비스 약관](https://autonomee.ai/blog/claude-code-terms-of-service-explained/)이 Agent SDK에서 구독용 OAuth 토큰의 서드파티 사용을 명시적으로 금지하고 있으며, 이를 위반한 프로젝트(OpenClaw, OpenCode, Cline, Roo Code 등)를 [적극 차단](https://autonomee.ai/blog/claude-code-terms-of-service-explained/)해 왔기 때문입니다. TELAUDE는 이를 완전히 회피합니다 — 사용자의 머신에서 CLI 바이너리를 호출하며, 의도된 대로 기존 Claude Code 인증을 사용합니다.

## 문서

자세한 사용법과 설정은 **[docs/index.md](./docs/index.ko.md)**를 참조하세요.

## 빠른 시작

[Bun](https://bun.sh/)이 설치되어 있는지 확인하세요.

```bash
# Install dependencies
bun install

# First run (setup wizard guides you through .env creation)
bun run dev
```

셋업 위저드가 다음을 요청합니다:
1. 텔레그램 봇 토큰 ([@BotFather](https://t.me/BotFather)에서 생성)
2. 인증 비밀번호
3. Claude CLI 인증 상태 확인

## 명령어

| 명령어 | 설명 |
|--------|------|
| `/start` | 봇 환영 메시지 |
| `/auth <pw>` | 비밀번호로 인증 |
| `/help` | 사용 가능한 명령어 목록 |
| `/new` | 새 세션 시작 |
| `/stats` | 세션 정보 + 토큰 사용량 |
| `/resume` | 최근 세션 목록 (이어가기 / 삭제) |
| `/stop` | 현재 처리 중단 |
| `/stop <text>` | 중단 후 새 입력 전달 |
| `/rename <name>` | 현재 세션 이름 변경 (Claude Code JSONL과 동기화) |
| `/compact [instructions]` | 대화 컨텍스트 압축 |
| `/history` | 최근 대화 5턴 표시 |
| `/cd <path>` | 작업 디렉토리 변경 |
| `/pwd` | 현재 디렉토리 표시 |
| `/projects` | 허용된 프로젝트 경로 목록 |
| `/model [name]` | 모델 보기 또는 변경 |
| `/budget [amount]` | 토큰 예산 보기 또는 설정 |
| `/context` | 컨텍스트 윈도우 사용량 (토큰/모델/비용) |
| `/schedule` | 예약 작업 보기 |

## 빌드 & 실행

```bash
bun run build        # TypeScript build
bun start            # Production
bun run dev          # Development (stdin supported)
bun run dev:watch    # Development (auto-reload, no stdin)
bun run build:exe    # Compile single executable
```

> **참고:** `build:exe`는 현재 Windows 실행 파일을 생성합니다. 크로스 플랫폼 바이너리 빌드(Linux, macOS)는 계획 중이나 아직 테스트되지 않았습니다 — 기여와 테스트 도움을 환영합니다.

## 외부 MCP 연동

Telaude는 **외부 MCP 서버가 텔레그램을 통해 메시지를 보낼 수 있도록** 내부 HTTP API를 노출합니다.

Telaude가 Claude CLI 프로세스를 생성할 때, `--mcp-config`를 통해 **모든 외부 MCP 서버**에 다음 환경변수를 주입합니다:

| 변수 | 설명 |
|------|------|
| `TELAUDE_API_URL` | 내부 API 주소 (`http://127.0.0.1:19816`) |
| `TELAUDE_API_TOKEN` | 요청 인증 토큰 (런타임에 생성) |
| `TELAUDE_USER_ID` | 텔레그램 유저 ID |
| `TELAUDE_CHAT_ID` | 현재 챕터의 채팅 ID (DM = userId, 그룹 = groupId) |
| `TELAUDE_THREAD_ID` | 현재 챕터의 스레드/토픽 ID (0 = 스레드 없음) |

### 사용 가능한 엔드포인트

| 엔드포인트 | Body | 설명 |
|-----------|------|------|
| `POST /mcp/send-photo` | `{ path }` | 이미지 파일 전송 (절대 경로) |
| `POST /mcp/send-file` | `{ path }` | 파일 전송 (절대 경로) |
| `POST /mcp/send-sticker` | `{ sticker_id }` | 스티커 전송 (Telegram file_id) |
| `POST /mcp/zip-and-send` | `{ dir }` | 디렉토리 zip 압축 후 전송 |
| `POST /mcp/ask` | `{ question, choices? }` | 사용자에게 질문 (인라인 키보드 선택지 지원) |
| `POST /mcp/set-reaction` | `{ emoji }` | 사용자의 최근 메시지에 이모지 리액션 |
| `POST /mcp/pin-message` | `{}` | 봇의 최근 메시지 고정 |
| `POST /mcp/unpin-message` | `{}` | 고정 메시지 해제 |

### 도구 표시 설정

설정 파일로 도구 표시 여부와 아이콘을 구성합니다. 프로젝트 단위 설정이 전역 설정보다 우선합니다.

- **전역**: `~/.telaude/telaude-mcp-settings.json`
- **프로젝트**: `<cwd>/.telaude/telaude-mcp-settings.json` (우선 적용)

```jsonc
{
  "tools": {
    "hidden_tool": { "hidden": true },
    "some_tool": { "icon": "🚀" },
    "fancy_tool": { "icon": { "emojiId": "5206186681346039457", "fallback": "🧑‍🎓" } }
  }
}
```

- `hidden: true` — 텔레그램 도구 호출 메시지에서 해당 도구 숨김
- `icon` (문자열) — 유니코드 이모지로 도구 아이콘 변경
- `icon` (객체) — 텔레그램 프리미엄 커스텀 이모지 사용 (`emojiId` + `fallback`)
- MCP 도구는 접미사로 매칭 (`mcp__server__tool`이 `tool`과 매칭)
- 파일 변경 시 핫리로드 (재시작 불필요)

### 사용 예시

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

Telaude는 Claude CLI를 생성할 때 `--mcp-config`에 나열된 모든 MCP 서버에 `TELAUDE_*` 환경변수를 자동 주입합니다. 각 MCP 서버의 자체 환경변수(예: `GOOGLE_API_KEY`)는 보존됩니다. Telaude 없이 로컬에서 단독 사용할 때는 `isTelaudeAvailable()`을 사용한 그레이스풀 fallback 구현을 권장합니다.

## 아키텍처

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

## 기여

TELAUDE는 완전한 오픈소스입니다. 기여, 버그 리포트, 크로스 플랫폼 테스트를 환영합니다 — 특히 다음 영역에서:
- **macOS / Linux 바이너리 빌드** — `build:exe`는 현재 Windows 전용
- **macOS Keychain 통합** — OS 네이티브 암호화에 실제 디바이스 테스트 필요
- **터미널 호환성** — 비Windows 터미널(macOS, Termux)에서의 TUI 입력 문제

## 라이선스

MIT

---

*TELAUDE는 100% 텔레그램을 통해 Claude Code를 사용하여 만들어졌습니다 — 이 시스템이 만드는 바로 그 시스템을 통해 전적으로 개발되었습니다.*
