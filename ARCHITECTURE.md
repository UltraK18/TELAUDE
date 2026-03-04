# Telaude Architecture

Telegram Claude Code Bridge - 텔레그램에서 Claude Code CLI를 제어하는 봇

## Tech Stack

- **Runtime**: Node.js + TypeScript (ESM)
- **Bot Framework**: grammY + @grammyjs/auto-retry
- **Database**: better-sqlite3 (WAL mode)
- **Auth**: bcrypt (비밀번호 해싱)
- **Logging**: pino
- **CLI**: Claude Code (`claude -p --output-format stream-json --verbose`)

## Directory Structure

```
src/
├── index.ts              # 진입점 (.env 체크 → 셋업 or 봇 시작)
├── setup.ts              # 첫 실행 인터랙티브 셋업 위저드
├── config.ts             # 환경변수 → Config (Proxy lazy-load)
│
├── claude/               # Claude CLI 프로세스 관리
│   ├── process-manager.ts  # spawn/kill/send, UserProcess 상태
│   ├── stream-parser.ts    # NDJSON stdout → EventEmitter
│   ├── stream-handler.ts   # 파서 이벤트 → 텔레그램 메시지
│   ├── tool-formatter.ts   # 도구 호출 HTML 포맷
│   └── cost-tracker.ts     # 비용/턴 DB 업데이트
│
├── bot/                  # grammY 봇
│   ├── bot.ts              # Bot 인스턴스 생성 + 미들웨어/핸들러 등록
│   ├── commands/           # 슬래시 명령어 핸들러
│   │   ├── index.ts          # registerCommands (모든 명령어 등록)
│   │   ├── start.ts          # /start
│   │   ├── auth.ts           # /auth <비밀번호>
│   │   ├── help.ts           # /help
│   │   ├── session.ts        # /session, /sessions, /resume, /new, /clear
│   │   ├── cd.ts             # /cd, /pwd, /projects
│   │   ├── model.ts          # /model
│   │   ├── budget.ts         # /budget
│   │   ├── stop.ts           # /stop
│   │   └── status.ts         # /status, /cost
│   ├── handlers/
│   │   ├── message.ts        # 일반 텍스트 → Claude 프로세스
│   │   └── callback.ts       # 인라인 키보드 콜백 (resume, delete)
│   └── middleware/
│       ├── auth.ts           # 인증 체크
│       ├── logging.ts        # 요청 로깅
│       ├── rate-limit.ts     # 속도 제한
│       └── error-handler.ts  # 전역 에러 처리
│
├── db/                   # SQLite 데이터베이스
│   ├── database.ts         # DB 초기화 + 마이그레이션
│   ├── auth-repo.ts        # auth_tokens 테이블
│   ├── session-repo.ts     # sessions 테이블 (upsert, 유니크 인덱스)
│   └── config-repo.ts      # user_configs 테이블
│
└── utils/
    ├── logger.ts           # pino 로거
    ├── markdown-to-html.ts # Markdown → Telegram HTML 변환
    ├── message-splitter.ts # 4000자 메시지 분할
    └── path-validator.ts   # 경로 유효성 검증
```

## Core Flow

### 첫 실행 (셋업 위저드)

```
npm start
  → .env 없음 감지
  → runSetup()
    1. claude auth status → CLI 인증 확인
    2. 텔레그램 봇 토큰 입력
    3. AUTH 비밀번호 설정
    4. 선택 설정 (모델, 작업 디렉토리 등)
    5. .env 생성
  → 봇 시작
```

### 메시지 처리 (Per-message Process Spawning)

```
사용자 텍스트 메시지
  → messageHandler
  → UserProcess 가져오기/생성 (DB에서 마지막 세션 복원)
  → spawnClaudeProcess (claude -p --resume <sessionId>)
  → stdin.write(text) + stdin.end()
  → StreamParser: stdout NDJSON 라인 파싱
  → StreamHandler: 텔레그램으로 스트리밍
    - tool_use → 단일 메시지 edit 애니메이션 (1초 간격)
    - text → 별도 메시지 스트리밍 (500ms 간격)
    - result → 도구 메시지 삭제 + 비용 요약
  → 프로세스 종료
```

### Claude CLI 인터페이스

```bash
claude --verbose \
       --output-format stream-json \
       --dangerously-skip-permissions \
       --model <model> \
       --max-turns <turns> \
       --resume <sessionId>  # 세션 이어가기 (선택)
       -p                     # stdin에서 프롬프트 읽기
```

- **입력**: stdin에 평문 텍스트 → stdin.end()
- **출력**: NDJSON (한 줄에 하나의 JSON 이벤트)
- **환경변수 정리**: `CLAUDECODE`, `CLAUDE_CODE*`, `ANTHROPIC_API_KEY` 제거 (중첩 방지)

### 스트림 이벤트 형식

```
system  → { type: "system", subtype: "init", session_id: "..." }
assistant → { type: "assistant", message: { content: [{type:"text",...}, {type:"tool_use",...}] } }
result  → { type: "result", cost_usd, total_cost_usd, num_turns, duration_ms, session_id }
```

### 텔레그램 응답 표시

1. **도구 호출**: 단일 메시지에 edit으로 누적 표시 (1초 간격 throttle)
2. **텍스트 응답**: 도구 메시지 삭제 후 별도 메시지로 스트리밍
3. **비용 요약**: 완료 시 `💰 $0.0042 | 3 turns | 5.2s` 형태
4. **메시지 분할**: 4000자 초과 시 자동 분할 (코드블록/문단/줄 단위)

## Database Schema

```sql
-- 사용자 인증
auth_tokens (
  telegram_user_id INTEGER PRIMARY KEY,
  username TEXT,
  auth_token_hash TEXT NOT NULL,  -- bcrypt 해시
  is_authorized INTEGER DEFAULT 0,
  failed_attempts INTEGER DEFAULT 0
)

-- 세션 관리 (session_id에 유니크 인덱스)
sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id INTEGER NOT NULL,
  session_id TEXT NOT NULL UNIQUE,
  working_dir TEXT NOT NULL,
  model TEXT DEFAULT 'sonnet',
  is_active INTEGER DEFAULT 1,
  total_cost_usd REAL DEFAULT 0.0,
  total_turns INTEGER DEFAULT 0
)

-- 사용자별 설정
user_configs (
  telegram_user_id INTEGER PRIMARY KEY,
  default_working_dir TEXT,
  default_model TEXT DEFAULT 'sonnet',
  max_budget_usd REAL DEFAULT 5.0,
  max_turns INTEGER DEFAULT 50
)
```

## Config Loading

`config.ts`는 Proxy 패턴으로 lazy-load:

```typescript
// loadConfig() 호출 전: Proxy가 에러 throw
// loadConfig() 호출 후: 정상 접근
export const config = new Proxy({} as Config, {
  get(_target, prop, receiver) {
    if (!_config) throw new Error('Config not loaded');
    return Reflect.get(_config, prop, receiver);
  },
});
```

이렇게 하면 `setup.ts`가 .env 생성 → `loadConfig()` → 나머지 모듈이 config에 접근 가능.

## Session Management

- **자동 복원**: 봇 재시작 시 DB에서 마지막 활성 세션 로드 → `--resume` 플래그로 이어가기
- **세션 목록**: `/sessions` → 인라인 키보드 (resume 버튼 + ❌ 삭제 버튼)
- **중복 방지**: `createSession`이 upsert 패턴 (기존이면 UPDATE, 없으면 INSERT)
- **유휴 정리**: 60초마다 idle 프로세스 체크 → 30분 초과 시 kill

## Middleware Chain

```
loggingMiddleware → rateLimitMiddleware → authMiddleware → handler
```

- `/start`, `/auth`, `/help`는 인증 불필요 (PUBLIC_COMMANDS)
- ALLOWED_TELEGRAM_IDS가 설정되면 화이트리스트 체크
- 그 외 모든 명령/메시지는 `/auth <비밀번호>`로 인증 필요
