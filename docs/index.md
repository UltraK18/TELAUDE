# Telaude Documentation

## Guides

| Document | Description |
|----------|-------------|
| [External MCP Integration](./external-mcp-integration.md) | 외부 MCP 서버에서 Telaude의 텔레그램 전송 기능을 사용하는 방법 |
| [Tool Display Settings](./tool-display-settings.md) | 도구 표시 숨김/아이콘 변경 설정 (전역/프로젝트, 핫리로드) |

## Configuration File Locations

Telaude의 설정 파일 및 데이터는 **git 추적 대상이 아닌** 별도 디렉토리에 저장된다.

### 전역 디렉토리 (`~/.telaude/`)

OS 사용자 홈 하위에 위치하며, 모든 프로젝트에 공통 적용된다. git 추적 대상이 아니므로 인스턴스마다 직접 생성해야 한다.

| 경로 | 설명 |
|------|------|
| `~/.telaude/data/settings.json` | TUI 설정 (비활성 도구/MCP, 모델 선택) |
| `~/.telaude/data/bot.log` | 봇 로그 파일 |
| `~/.telaude/data/sticker-cache/` | 스티커 JPG 썸네일 캐시 |
| `~/.telaude/telaude-mcp-settings.json` | 전역 도구 표시 설정 (hidden/icon) |
| `~/.telaude/allowed_project_roots.json` | `/cd` 접근 허용 경로 목록 (없으면 제한 없음) |

### 프로젝트 디렉토리 (`.telaude/`)

각 Claude 작업 디렉토리(cwd) 하위에 위치하며, 해당 프로젝트에만 적용된다.

| 경로 | 설명 |
|------|------|
| `.telaude/telaude-mcp-settings.json` | 프로젝트별 도구 표시 설정 (전역보다 우선) |

> `.telaude/` 디렉토리는 `.gitignore`에 포함되어 있어 git에 추적되지 않는다. 인스턴스마다 독립적으로 설정하면 된다.

#### allowed_project_roots.json

`/cd` 명령으로 이동 가능한 경로를 제한한다. 파일이 없으면 모든 경로가 허용된다.

```json
[
  "/home/user/projects",
  "/home/user/work"
]
```

Windows 예시:
```json
[
  "C:\\Users\\user\\projects",
  "C:\\work"
]
```

### 기타 데이터 파일

| 경로 | 설명 |
|------|------|
| `.env` (프로젝트 루트) | 봇 토큰, 비밀번호 해시 등 — git 제외 |
| `~/.telaude/data/telaude.db` | SQLite DB (세션, 스케줄 등) — git 제외 |
| `user_send/` | 사용자가 전송한 파일 임시 저장 — git 제외 |

## Setup & Authentication

### 첫 실행

`npm run dev`를 실행하면 셋업 위저드가 자동으로 실행된다. 위저드가 다음을 순서대로 안내한다:

1. **Telegram Bot Token** 입력 — [@BotFather](https://t.me/BotFather)에서 발급
2. **인증 비밀번호** 설정
3. **Claude CLI 인증 상태** 확인 (미인증 시 `claude` 실행 안내)

입력이 완료되면 `.env` 파일이 자동으로 생성되고 봇이 시작된다.

> **`.env` 파일은 직접 편집하지 않아도 된다.** 위저드가 생성하며, 비밀번호는 내부적으로 강력하게 보호된다.

### 봇 인증

봇이 시작된 후 텔레그램에서 `/auth <비밀번호>`를 입력하면 인증이 완료된다.
인증 이후에는 모든 Claude 명령을 사용할 수 있다.

### 환경변수 (.env)

셋업 위저드가 생성하는 필수 항목:

| 변수 | 설명 |
|------|------|
| `TELEGRAM_BOT_TOKEN` | BotFather에서 발급한 봇 토큰 |
| `AUTH_PASSWORD` | 텔레그램 봇 인증 비밀번호 (bcrypt 해시로 저장) |

선택적으로 추가 가능한 항목:

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `ALLOWED_TELEGRAM_IDS` | (없음, 누구나 가능) | 허용할 Telegram User ID (쉼표 구분) |
| `CHAT_ID` | 자동 감지 | 봇 알림을 보낼 채팅 ID (auth 시 자동 저장) |
| `CLAUDE_CLI_PATH` | `claude` | Claude CLI 실행 경로 |
| `DEFAULT_MODEL` | `sonnet` | 기본 Claude 모델 |
| `DEFAULT_MAX_BUDGET_USD` | `5.0` | 기본 예산 (USD) |
| `DEFAULT_MAX_TURNS` | `50` | 기본 최대 턴 수 |
| `DEFAULT_WORKING_DIR` | 실행 디렉토리 | 기본 작업 디렉토리 |
| `SESSION_IDLE_TIMEOUT_MS` | `1800000` | 세션 유휴 타임아웃 (ms) |
| `STREAM_UPDATE_INTERVAL_MS` | `500` | 스트리밍 업데이트 간격 (ms) |
| `STREAM_UPDATE_MIN_CHARS` | `200` | 스트리밍 최소 업데이트 문자 수 |
| `MCP_INTERNAL_API_PORT` | `19816` | 내부 MCP API 포트 |
| `LOG_LEVEL` | `info` | 로그 레벨 |

### 보안

Telaude는 `.env` 파일 전체를 OS 네이티브 암호화로 강력하게 보호한다 (Windows DPAPI / macOS Keychain / Linux). 동일 OS 계정이 아니면 복호화가 불가능하다.

## Internal MCP API Endpoints

Telaude 위에서 구동되는 Claude 프로세스의 MCP 서버는 내부 HTTP API(`http://127.0.0.1:19816`)를 통해 텔레그램 전송 기능을 사용할 수 있다.

인증 헤더:

```
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
| `POST /mcp/pin-message` | `{}` | 봇의 최근 메시지 고정 |
| `POST /mcp/unpin-message` | `{}` | 고정 메시지 해제 |
| `POST /mcp/set-reaction` | `{ emoji: string }` | 유저 메시지에 이모지 리액션 |

환경변수 `TELAUDE_API_URL`, `TELAUDE_API_TOKEN`, `TELAUDE_USER_ID`는 Telaude가 Claude CLI spawn 시 `--mcp-config`를 통해 자동 주입한다. 자세한 내용은 [External MCP Integration](./external-mcp-integration.md)을 참고한다.
