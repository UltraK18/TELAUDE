> 이 문서는 영문 원본의 한국어 번역입니다. | [English](./ARCHITECTURE.md)

# TELAUDE 아키텍처

텔레그램 Claude Code 브릿지 — 텔레그램에서 Claude Code CLI를 원격 제어하는 봇입니다.

## 기술 스택

- **런타임**: Bun (TypeScript, ESM)
- **봇 프레임워크**: grammY + @grammyjs/auto-retry
- **데이터베이스**: better-sqlite3 (WAL 모드)
- **인증**: bcrypt (비밀번호 해싱) + OS 네이티브 암호화 (Windows DPAPI / macOS Keychain / Linux)
- **로깅**: pino
- **CLI**: Claude Code (`claude -p --output-format stream-json --verbose`)
- **스케줄러**: croner (cron 표현식) + setTimeout (일회성)
- **MCP**: 내장 MCP 서버 (stdio) + 외부 MCP 연동을 위한 내부 HTTP API

## 디렉토리 구조

```
src/
├── index.ts              # Entry point (.env check → setup or bot start)
├── setup.ts              # First-run interactive setup wizard
├── config.ts             # Env → Config (Proxy lazy-load)
│
├── claude/               # Claude CLI process management
│   ├── process-manager.ts  # UserProcess map (chapterKey-based), spawn/kill/send, global MCP tool cache
│   ├── stream-parser.ts    # NDJSON stdout → EventEmitter (system/assistant/result + tools/compact)
│   ├── stream-handler.ts   # Parser events → Telegram messages (tool display + text streaming + MCP tool collection)
│   ├── tool-formatter.ts   # Tool call HTML formatting (superscript counters, agent pinning)
│   └── cost-tracker.ts     # Cost/turn/context DB updates
│
├── bot/                  # grammY bot
│   ├── bot.ts              # Bot instance + middleware/handler registration
│   ├── commands/           # Slash command handlers
│   │   ├── index.ts          # registerCommands (all commands)
│   │   ├── start.ts          # /start
│   │   ├── auth.ts           # /auth <password>
│   │   ├── help.ts           # /help
│   │   ├── session.ts        # /resume, /new, /rename, buildSessionList
│   │   ├── cd.ts             # /cd, /pwd, /projects
│   │   ├── model.ts          # /model (inline keyboard)
│   │   ├── budget.ts         # /budget
│   │   ├── stop.ts           # /stop, /stop <text>, /reload
│   │   ├── status.ts         # /stats
│   │   ├── context.ts        # /context (token usage, model, cost)
│   │   ├── compact.ts        # /compact [instructions]
│   │   ├── history.ts        # /history
│   │   └── topic.ts          # /newtopic (DM topic creation)
│   ├── handlers/
│   │   ├── message.ts        # Text/media → Claude process (session restore, queue, link preview, scheduled task drain)
│   │   ├── callback.ts       # Inline keyboard callbacks (resume, delete, browse CLI sessions)
│   │   ├── reaction.ts       # Emoji reaction handling (user↔bot)
│   │   ├── forward-collector.ts  # Batches forwarded messages into single stdin
│   │   ├── media-group-collector.ts # Batches media groups (albums) into single stdin
│   │   └── media-types.ts    # MediaInfo extraction, labels, buildMediaText
│   └── middleware/
│       ├── auth.ts             # Auth check + public commands bypass
│       ├── stale-update-filter.ts # Drop updates older than 2 minutes
│       └── topic-name-cache.ts   # Capture topic names from service messages
│
├── api/                  # Internal HTTP API (for external MCP servers)
│   ├── internal-server.ts  # HTTP server on 127.0.0.1 (socket tracking for clean shutdown)
│   ├── route-handlers.ts   # /mcp/* routes (send-photo, send-file, ask, pin, cron, etc.)
│   ├── ask-queue.ts        # Ask tool queue (inline keyboard → response promise)
│   └── tool-display-store.ts # Tool icon/hidden settings (hot-reload, mtime check)
│
├── mcp-server/           # Built-in MCP server (stdio, registered via --mcp-config)
│   ├── index.ts            # MCP server setup + tool registration
│   ├── http-client.ts      # HTTP client for internal API calls (auto-injects _chatId/_threadId)
│   └── tools/
│       ├── communication.ts  # send_file, send_photo, ask, pin/unpin, set_reaction, zip_and_send
│       ├── scheduling.ts     # schedule_add/list/update/remove/pause/resume/history/completed/nothing_to_report
│       ├── poke.ts           # poke_ok
│       └── system.ts        # get_system_info, reload
│
├── scheduler/            # Cron & one-shot job scheduling
│   ├── scheduler.ts        # Job runner (croner + one-shot timers), per-chapter independent spawn
│   ├── cron-store.ts       # Job persistence (JSON file), triggerOnChange for dashboard sync
│   ├── isolated-spawn.ts   # Isolated job spawner (independent process, no session interference)
│   ├── heartbeat.ts        # HEARTBEAT.md-based health check
│   ├── poke.ts             # Proactive follow-up timer (stdin injection)
│   └── turn-deleter.ts     # JSONL turn cleanup after scheduled tasks
│
├── settings/             # TUI settings panel
│   ├── settings-store.ts   # V2 hierarchical settings (~/.telaude/data/settings.json)
│   └── settings-tui.ts     # Blessed overlay — tab UI: [Model] [MCP Servers] [Base Tools]
│
├── db/                   # SQLite database
│   ├── database.ts         # DB init + migrations (unique indexes, column additions)
│   ├── auth-repo.ts        # auth_tokens table
│   ├── session-repo.ts     # sessions table (upsert, session_name, chapter fields)
│   ├── topic-repo.ts       # Topic name cache (chat_id + thread_id → name)
│   ├── config-repo.ts      # user_configs table
│   └── message-log-repo.ts # Message logging
│
└── utils/
    ├── logger.ts             # pino logger (file + dashboard notify)
    ├── dashboard.ts          # Blessed TUI dashboard (banner, session, schedule, logs, status bar)
    ├── link-preview.ts       # URL → context injection (X/fxtwitter, YouTube/noembed, OG meta tags)
    ├── cli-sessions.ts       # Read/write Claude Code JSONL sessions (customTitle, slug)
    ├── file-downloader.ts    # Telegram file download → user_send/ with project-relative paths
    ├── sticker-cache.ts      # Sticker → JPG thumbnail cache
    ├── markdown-to-html.ts   # Markdown → Telegram HTML conversion
    ├── message-splitter.ts   # 4000-char message splitting (code block > paragraph > line)
    ├── path-validator.ts     # Working directory validation + fallback chain
    └── machine-lock.ts       # OS-native .env encryption (DPAPI / Keychain / Linux)
```

## 핵심 개념

### 용어

| 용어 | 정의 | 식별자 |
|------|------|--------|
| **Session** | Claude CLI JSONL 대화 + DB 메타데이터 | `sessionId` (UUID) |
| **Chapter** | Telaude의 스레드 단위 — 하나의 사용자 + 채팅 + 스레드 컨텍스트 | `chapterKey` = `userId:chatId:threadId` |
| **UP (UserProcess)** | 챕터별 인메모리 프로세스 상태 | `processes.get(chapterKey)` |

- 각 챕터는 자체 CLI 프로세스, 세션, 작업 디렉토리, 메시지 큐, 설정을 가집니다
- 하나의 챕터 안에서 여러 세션이 생성/이어가기(resume)될 수 있습니다
- 챕터는 독립적입니다 — 스케줄링, 프로세스 생성, 메시징이 다른 챕터를 차단하지 않습니다

### 메시지별 프로세스 생성

```
User text message
  → messageHandler
  → Get/create UserProcess by chapterKey (restore last session from DB)
  → Link preview: fetch URL context (X/YouTube/OG) → prepend to stdin
  → spawnClaudeProcess (claude -p --resume <sessionId>)
  → stdin.write(text) + stdin.end()
  → StreamParser: parse stdout NDJSON lines
  → StreamHandler: stream to Telegram
    - init → collect MCP tool names into global cache
    - tool_use → single message, edit animation (1s throttle, superscript counters)
    - text start → delete tool message
    - text → separate message, streaming edits (500ms / 200 char intervals)
    - result → cost summary
  → Process exits → drain scheduled queue (same chapter only)
```

### Claude CLI 인터페이스

```bash
claude --verbose \
       --output-format stream-json \
       --include-partial-messages \
       --dangerously-skip-permissions \
       --model <model> \
       --max-turns <turns> \
       --resume <sessionId> \
       --strict-mcp-config \
       --mcp-config <json>   # Telaude MCP + external MCPs with injected env
       --disallowedTools <tools...>  # Per-chapter tool/MCP restrictions
       -p                    # Read prompt from stdin
```

- **입력**: 평문 텍스트를 stdin으로 전달 → stdin.end()
- **출력**: NDJSON (줄당 하나의 JSON 이벤트)
- **환경변수 정리**: `CLAUDECODE`, `CLAUDE_CODE*`, `ANTHROPIC_API_KEY` 제거 (중첩 실행 방지)
- **windowsHide**: true (Windows에서 서버 소켓 핸들 상속 방지)

### 스트림 이벤트 포맷

```
system   → { type: "system", subtype: "init", session_id, tools: string[] }
assistant → { type: "assistant", message: { content: [{type:"text",...}, {type:"tool_use",...}], usage } }
result   → { type: "result", cost_usd, total_cost_usd, num_turns, duration_ms, session_id, modelUsage }
```

### 텔레그램 표시 전략

1. **도구 호출**: 단일 메시지에 편집 애니메이션 (1초 쓰로틀)
   - 위첨자 카운터: `🔍² Grep` (첫 번째 도구는 위첨자 없음)
   - Agent(서브에이전트) 도구는 상단에 고정, 일반 도구는 하단에 표시
2. **텍스트 응답**: 도구 메시지 삭제 → 별도 메시지로 스트리밍 편집
3. **메시지 분할**: 4000자 초과 시 자동 분할 (코드 블록 > 문단 > 줄 경계 기준)
4. **HTML 파싱 실패**: 플레인 텍스트 fallback
5. **압축 애니메이션**: 2초 간격 애니메이션 점, 완료 시 토큰 수 표시

## 멀티챕터 아키텍처

각 챕터(`userId:chatId:threadId`)는 완전히 독립적입니다:

- **별도 UP**: 자체 CLI 프로세스, 세션, 작업 디렉토리, 모델, 메시지 큐
- **독립 스케줄링**: Cron/poke 작업이 유저 단위가 아닌 챕터별 `isProcessing`을 확인
- **독립 설정**: TUI를 통한 챕터별 도구/MCP/모델 설정 (settings.json에 저장)
- **세션 복원**: 봇 재시작 시 DB의 활성 세션이 workingDir, model, sessionId와 함께 UP로 복원
- **MCP 도구 캐시**: 전역 (챕터 간 공유), init 이벤트에서 수집 — 어떤 챕터의 spawn이든 캐시 갱신

### 예약 작업 흐름

```
Cron triggers → check if target chapter is processing
  → Yes: enqueue (same chapter only, other chapters unaffected)
  → No: spawn directly in target chapter's context
    → StreamHandler (silent mode) → collect response
    → On exit: send report to correct thread (message_thread_id)
```

## TUI 설정 패널

탭 기반 UI, 키보드 내비게이션:

```
[Model]  [MCP Servers]  [Base Tools]
─────────────────────────────────────
 (items for selected tab)
```

- **Model 탭**: Claude 모델 선택 (라디오 셀렉션)
- **MCP Servers 탭**: 서버 온/오프 토글 + 서버별 도구 서브리스트
  - 활성 서버: 들여쓰기된 도구 표시 (init 이벤트 전역 캐시 기반)
  - 도구 미수집 상태: "(requires first conversation)" 힌트
  - 비활성 서버: 도구 숨김
- **Base Tools 탭**: 내장 도구 (Bash, Read 등) + Telaude MCP 도구
- **내비게이션**: ←→/Tab으로 탭 이동, ↑↓로 항목 이동, Space/Enter로 토글, Esc로 닫기
- **영속성**: disabledTools/disabledMcpServers가 settings.json에 챕터별로 저장

## 데이터베이스 스키마

```sql
-- User authentication
auth_tokens (
  telegram_user_id INTEGER PRIMARY KEY,
  username TEXT,
  auth_token_hash TEXT NOT NULL,  -- bcrypt hash
  is_authorized INTEGER DEFAULT 0,
  failed_attempts INTEGER DEFAULT 0
)

-- Session management (UNIQUE index on session_id)
sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id INTEGER NOT NULL,
  session_id TEXT NOT NULL UNIQUE,
  working_dir TEXT NOT NULL,
  model TEXT DEFAULT 'default',
  is_active INTEGER DEFAULT 1,
  total_cost_usd REAL DEFAULT 0.0,
  total_turns INTEGER DEFAULT 0,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  session_name TEXT DEFAULT NULL,
  chat_id INTEGER,
  thread_id INTEGER DEFAULT 0
)

-- Chapters (persistent thread metadata)
chapters (
  user_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  thread_id INTEGER NOT NULL DEFAULT 0,
  chapter_dir TEXT,
  model TEXT,
  PRIMARY KEY (user_id, chat_id, thread_id)
)
```

## Config 로딩

`config.ts`는 지연 로딩을 위해 Proxy 패턴을 사용합니다:

```typescript
// Before loadConfig(): Proxy throws error
// After loadConfig(): normal access
export const config = new Proxy({} as Config, {
  get(_target, prop, receiver) {
    if (!_config) throw new Error('Config not loaded');
    return Reflect.get(_config, prop, receiver);
  },
});
```

이를 통해 `setup.ts`가 .env 생성 → `loadConfig()` → 다른 모듈이 config에 접근하는 순서가 가능합니다.

## 내부 API & 외부 MCP 연동

Telaude는 `127.0.0.1:19816`에서 HTTP 서버를 실행하여 외부 MCP 서버에 텔레그램 메시징을 노출합니다.

**자동 주입 환경변수** (`--mcp-config` 경유):
- `TELAUDE_API_URL` — 내부 API 주소
- `TELAUDE_API_TOKEN` — 런타임 인증 토큰 (종료 시 파기)
- `TELAUDE_USER_ID` — 텔레그램 유저 ID
- `TELAUDE_CHAT_ID` — 현재 챕터의 채팅 ID
- `TELAUDE_THREAD_ID` — 현재 챕터의 스레드 ID

**MCP http-client**가 환경변수에서 `_chatId`와 `_threadId`를 모든 API 요청에 자동 주입하여 올바른 챕터 라우팅을 보장합니다.

**엔드포인트**: send-photo, send-file, send-sticker, zip-and-send, ask, pin/unpin, set-reaction, cron CRUD

## 스케줄러 & Poke

- **Cron 작업**: croner를 통한 반복 작업, JSON 파일에 영속 저장
- **일회성 작업**: `runAt`을 사용한 단발 타이머 (상대 시간: "5m", "1h" 및 시각 지정: "09:15" 지원)
- **독립 챕터 spawn**: 예약 작업은 대상 챕터가 바쁠 때만 큐잉, 다른 챕터가 활성 상태여도 영향 없음
- **대시보드 동기화**: scheduleJob 후 `triggerOnChange()` 호출로 Incoming 섹션 갱신
- **Poke**: Claude가 침묵할 때 자동 후속 조치 — `--resume`을 통해 자연어를 stdin에 주입
- **Heartbeat**: HEARTBEAT.md 기반 상태 확인

## 보안

- `.env`는 OS 네이티브 API로 암호화 (Windows DPAPI / macOS Keychain / Linux machine-id+UID)
- 내부 API는 깔끔한 종료를 위한 소켓 트래킹과 함께 localhost에만 바인딩
- 런타임 토큰은 프로세스별로 생성, 디스크에 저장하지 않음
- 모든 send-file/send-photo/zip-and-send 라우트에 파일 경로 검증
- 실패 시도 트래킹과 함께 bcrypt 비밀번호 해싱
- `spawn()`에 `windowsHide: true` 사용으로 서버 소켓 핸들 상속 방지
- Reload 시 grammY update 재전달 방지를 위해 500ms ACK 지연

## 링크 프리뷰

URL 감지 → 프록시 API 가져오기 → Claude stdin에 컨텍스트 삽입.

| 플랫폼 | 방식 | 데이터 |
|---------|------|--------|
| X/Twitter | fxtwitter API | 전문, 참여 통계, 이미지, 기사 본문 (Draft.js 블록) |
| YouTube | noembed.com | 제목, 채널명 |
| 일반 URL | OG 메타 태그 파싱 | 제목, 설명, 사이트명 (HTML 가져오기 50KB 제한) |

## 도구 표시 설정

`telaude-mcp-settings.json`으로 구성 (전역 `~/.telaude/` 또는 프로젝트 `.telaude/`).

- `hidden: true` — 텔레그램 도구 메시지에서 숨김
- `icon` — 유니코드 이모지 또는 텔레그램 프리미엄 커스텀 이모지 (`emojiId` + `fallback`)
- MCP 도구는 접미사로 매칭 (`mcp__server__tool` → `tool`)
- mtime 비교를 통한 핫리로드 (재시작 불필요)
