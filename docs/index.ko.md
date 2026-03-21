> 이 문서는 영문 원본의 한국어 번역입니다. | [English](./index.md)

# Telaude 문서

## 가이드

| 문서 | 설명 |
|------|------|
| [외부 MCP 연동](./external-mcp-integration.ko.md) | 외부 MCP 서버가 Telaude의 텔레그램 메시징 기능을 사용하는 방법 |
| [도구 표시 설정](./tool-display-settings.ko.md) | 도구 숨기기 또는 아이콘 커스터마이징 (전역/프로젝트 단위, 핫리로드) |

## 설정 파일 위치

Telaude의 설정 파일과 데이터는 **git으로 추적되지 않는** 전용 디렉토리에 저장됩니다.

### 전역 디렉토리 (`~/.telaude/`)

OS 사용자의 홈 디렉토리 아래에 위치합니다. 이 설정은 모든 프로젝트에 적용됩니다. git으로 추적되지 않으므로 각 인스턴스에서 수동으로 생성해야 합니다.

| 경로 | 설명 |
|------|------|
| `~/.telaude/data/settings.json` | V2 계층형 설정 (작업 디렉토리별 + 챕터별) |
| `~/.telaude/data/bot.log` | 봇 로그 파일 |
| `~/.telaude/data/sticker-cache/` | 스티커 JPG 썸네일 캐시 |
| `~/.telaude/telaude-mcp-settings.json` | 전역 도구 표시 설정 (숨김/아이콘) |
| `~/.telaude/allowed_project_roots.json` | `/cd` 명령어에 허용된 경로 (파일 없으면 제한 없음) |

### 프로젝트 디렉토리 (`.telaude/`)

각 Claude 작업 디렉토리(cwd) 아래에 위치합니다. 이 설정은 해당 프로젝트에만 적용됩니다.

| 경로 | 설명 |
|------|------|
| `.telaude/telaude-mcp-settings.json` | 프로젝트 단위 도구 표시 설정 (전역 설정보다 우선) |
| `.telaude/POKE.md` | Poke 설정 (Claude 침묵 시 자동 후속 조치) |
| `.telaude/HEARTBEAT.md` | Heartbeat 상태 파일 (예약 작업 상태 확인) |

> `.telaude/` 디렉토리는 `.gitignore`에 포함되어 있으며 git으로 추적되지 않습니다. 각 인스턴스에서 독립적으로 구성하세요.

#### allowed_project_roots.json

`/cd` 명령어가 이동할 수 있는 경로를 제한합니다. 파일이 존재하지 않으면 모든 경로가 허용됩니다.

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
| `~/.telaude/.env` | 봇 토큰, 비밀번호 해시 등 — OS 네이티브 암호화로 보호 |
| `~/.telaude/data/telaude.db` | SQLite 데이터베이스 (세션, 스케줄 등) — git에서 제외 |
| `user_send/` | 사용자 업로드 파일 임시 저장소 — git에서 제외 |

## 셋업 & 인증

### 첫 실행

`bun run dev`를 실행하면 자동으로 셋업 위저드가 시작되며, 다음 단계를 안내합니다:

1. **텔레그램 봇 토큰** — [@BotFather](https://t.me/BotFather)에서 발급
2. **인증 비밀번호** — 봇 접근을 위한 비밀번호 설정
3. **Claude CLI 인증 상태** — CLI가 인증되었는지 확인 (인증되지 않았으면 `claude` 실행 안내)

모든 입력이 완료되면 `.env` 파일이 자동 생성되고 봇이 시작됩니다.

> **`.env` 파일을 수동으로 편집할 필요가 없습니다.** 위저드가 생성하며, 비밀번호는 내부적으로 안전하게 보호됩니다.

### 봇 인증

봇이 시작된 후, 텔레그램에서 `/auth <password>`를 보내 인증합니다. 인증이 완료되면 모든 Claude 명령어를 사용할 수 있습니다.

### 환경변수 (.env)

필수 변수 (셋업 위저드가 생성):

| 변수 | 설명 |
|------|------|
| `TELEGRAM_BOT_TOKEN` | BotFather가 발급한 봇 토큰 |
| `AUTH_PASSWORD` | 텔레그램 봇 인증 비밀번호 (bcrypt 해시로 저장) |

선택 변수:

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `ALLOWED_TELEGRAM_IDS` | (없음, 누구나 허용) | 허용된 텔레그램 유저 ID (쉼표 구분) |
| `CHAT_ID` | 자동 감지 | 봇 알림용 채팅 ID (인증 시 자동 저장) |
| `CLAUDE_CLI_PATH` | `claude` | Claude CLI 실행 파일 경로 |
| `DEFAULT_MODEL` | `default` | 기본 Claude 모델 (CLI 네이티브 기본값) |
| `DEFAULT_MAX_BUDGET_USD` | `5.0` | 기본 예산 한도 (USD) |
| `DEFAULT_MAX_TURNS` | `50` | 기본 최대 턴 수 |
| `DEFAULT_WORKING_DIR` | 현재 디렉토리 | 기본 작업 디렉토리 |
| `SESSION_IDLE_TIMEOUT_MS` | `1800000` | 세션 유휴 타임아웃 (ms) |
| `STREAM_UPDATE_INTERVAL_MS` | `500` | 스트리밍 업데이트 간격 (ms) |
| `STREAM_UPDATE_MIN_CHARS` | `200` | 스트리밍 업데이트 전 최소 문자 수 |
| `MCP_INTERNAL_API_PORT` | `19816` | 내부 MCP API 포트 |
| `LOG_LEVEL` | `info` | 로그 레벨 |

### 보안

Telaude는 `.env` 파일 전체를 OS 네이티브 암호화(Windows DPAPI / macOS Keychain / Linux)로 보호합니다. 동일한 OS 사용자 계정에 접근하지 않으면 복호화가 불가능합니다.

## 내부 MCP API 엔드포인트

Telaude가 생성한 Claude 프로세스 하위에서 실행되는 MCP 서버는 내부 HTTP API (`http://127.0.0.1:19816`)를 사용하여 텔레그램으로 메시지를 보낼 수 있습니다.

인증 헤더:

```
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
| `POST /mcp/pin-message` | `{}` | 봇의 최근 메시지 고정 |
| `POST /mcp/unpin-message` | `{}` | 고정 메시지 해제 |
| `POST /mcp/set-reaction` | `{ emoji: string }` | 사용자 메시지에 이모지 리액션 |

환경변수 `TELAUDE_API_URL`, `TELAUDE_API_TOKEN`, `TELAUDE_USER_ID`, `TELAUDE_CHAT_ID`, `TELAUDE_THREAD_ID`는 Claude CLI 생성 시 Telaude가 `--mcp-config`를 통해 자동 주입합니다. 자세한 내용은 [외부 MCP 연동](./external-mcp-integration.ko.md)을 참조하세요.
