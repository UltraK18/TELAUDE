# Telaude - Claude Code Project Instructions

## Project Overview

Telaude는 텔레그램에서 Claude Code CLI를 원격 제어하는 봇이다.
사용자가 텔레그램으로 메시지를 보내면, 서버에서 `claude -p` 프로세스를 spawn하여 결과를 스트리밍한다.

## Build & Run

```bash
# 첫 실행 (셋업 위저드 → .env 생성 → 봇 시작)
npm run dev

# 빌드
npm run build

# 프로덕션 실행
npm start

# 개발 (watch 모드)
npm run dev:watch
```

- `npm run dev`는 `tsx src/index.ts` (watch 아님, stdin 입력 가능)
- `npm run dev:watch`는 `tsx watch` (셋업 위저드에서 stdin 사용 불가)

## Key Architecture Decisions

### Per-message Process Spawning

매 메시지마다 새 `claude -p` 프로세스를 spawn한다. persistent 프로세스가 아님.
세션 연속성은 `--resume <sessionId>` 플래그로 유지.

```
사용자 메시지 → spawn(claude -p --resume <id>) → stdin.write(text) → stdin.end() → stdout 읽기 → 프로세스 종료
```

### Environment Variable Cleaning

Claude CLI spawn 시 다음 환경변수를 제거해야 한다 (중첩 실행 에러 방지):
- `CLAUDECODE`
- `CLAUDE_CODE*` (prefix로 시작하는 모든 것)
- `ANTHROPIC_API_KEY`

### Config Lazy Loading (Proxy)

`config.ts`는 모듈 로드 시점에 env를 읽지 않고, `loadConfig()` 호출 시점에 읽는다.
이유: 셋업 위저드가 `.env`를 생성한 후에야 config를 로드할 수 있기 때문.
`index.ts`에서 `.env` 체크 → 셋업 → dotenv.config() → loadConfig() → dynamic import 순서.

### Stream Output Format

Claude CLI `--output-format stream-json --verbose` 출력은 NDJSON:
- `system`: 세션 초기화 (session_id)
- `assistant`: 텍스트/도구 호출 (message.content 배열)
- `result`: 비용, 턴 수, 소요 시간

입력은 `--input-format stream-json`이 **아니라** 평문 텍스트 stdin이다.

### Telegram Display Strategy

- **도구 호출**: 단일 메시지를 1초 간격으로 edit (애니메이션 효과)
- **텍스트 응답 시작 시**: 도구 메시지를 `deleteMessage`로 삭제
- **텍스트 응답**: 별도 메시지로 스트리밍 (500ms / 200자 간격 edit)
- **4000자 초과**: 자동 분할 (코드블록 > 문단 > 줄 단위 기준)
- **HTML 파싱 실패 시**: 플레인 텍스트 fallback

### Session Deduplication

- `sessions` 테이블에 `session_id` UNIQUE 인덱스
- `createSession`은 upsert: 기존이면 UPDATE(last_active_at, is_active=1), 없으면 INSERT
- `getRecentSessions`는 `GROUP BY session_id`로 중복 제거

## Commands

| Command | Description |
|---------|-------------|
| `/start` | 봇 시작 안내 |
| `/auth <pw>` | 비밀번호 인증 (bcrypt 해시 저장) |
| `/help` | 명령어 목록 |
| `/new` | 새 세션 시작 |
| `/session` | 현재 세션 정보 |
| `/sessions` | 최근 세션 목록 (인라인 키보드: resume + 삭제) |
| `/resume [id]` | 세션 이어가기 |
| `/clear` | 프로세스 + 세션 완전 초기화 |
| `/stop` | 현재 처리 중단 |
| `/cd <path>` | 작업 디렉토리 변경 |
| `/pwd` | 현재 디렉토리 |
| `/model <name>` | 모델 변경 |
| `/budget <usd>` | 예산 설정 |
| `/status` | 프로세스 상태 |
| `/cost` | 현재 세션 비용 |

## File Responsibilities

- `src/index.ts` - 진입점, 셋업 분기, 봇 라이프사이클
- `src/setup.ts` - 첫 실행 위저드 (readline, claude auth status 체크)
- `src/config.ts` - env → Config 객체, Proxy lazy-load
- `src/claude/process-manager.ts` - UserProcess 맵, spawn/kill/send
- `src/claude/stream-parser.ts` - NDJSON → EventEmitter (system/assistant/result)
- `src/claude/stream-handler.ts` - 파서 이벤트 → 텔레그램 메시지 (도구 애니메이션 + 텍스트 스트리밍)
- `src/bot/bot.ts` - grammY Bot 생성, 미들웨어/핸들러 조립
- `src/bot/handlers/message.ts` - 텍스트 → Claude 프로세스 (세션 자동 복원)
- `src/bot/handlers/callback.ts` - 인라인 키보드 콜백 (resume, delete_session)
- `src/db/database.ts` - SQLite 초기화, 마이그레이션 (유니크 인덱스, 중복 정리)
- `src/db/session-repo.ts` - 세션 CRUD (upsert 패턴)

## Known Patterns & Gotchas

- `tsx watch`에서는 stdin이 제대로 전달되지 않아 셋업 위저드가 작동하지 않음 → `tsx` 사용
- `claude` CLI에 `--cwd` 옵션 없음 → `spawn()`의 `cwd` 옵션 사용
- `--output-format stream-json`은 반드시 `--verbose`와 함께 사용
- 세션 자동 복원: 봇 재시작 시 DB의 `getActiveSession()`으로 마지막 세션 로드
- 봇 종료 시 모든 Claude 프로세스 SIGTERM으로 정리
- Telegram `editMessageText`에서 "message is not modified" 에러는 무시 (동일 내용 재전송 시 발생)
