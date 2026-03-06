# Telaude Documentation

## Guides

| Document | Description |
|----------|-------------|
| [External MCP Integration](./external-mcp-integration.md) | 외부 MCP 서버에서 Telaude의 텔레그램 전송 기능을 사용하는 방법 |
| [Tool Display Settings](./tool-display-settings.md) | 도구 표시 숨김/아이콘 변경 설정 (전역/프로젝트, 핫리로드) |

## Configuration File Locations

Telaude의 설정 파일 및 데이터는 **git 추적 대상이 아닌** 별도 디렉토리에 저장된다.

### 전역 디렉토리 (`~/.telaude/`)

OS 사용자 홈 하위에 위치하며, 모든 프로젝트에 공통 적용된다.

| 경로 | 설명 |
|------|------|
| `~/.telaude/data/settings.json` | TUI 설정 (비활성 도구/MCP, 모델 선택) |
| `~/.telaude/data/bot.log` | 봇 로그 파일 |
| `~/.telaude/data/sticker-cache/` | 스티커 JPG 썸네일 캐시 |
| `~/.telaude/telaude-mcp-settings.json` | 전역 도구 표시 설정 (hidden/icon) |

### 프로젝트 디렉토리 (`.telaude/`)

각 Claude 작업 디렉토리(cwd) 하위에 위치하며, 해당 프로젝트에만 적용된다.

| 경로 | 설명 |
|------|------|
| `.telaude/telaude-mcp-settings.json` | 프로젝트별 도구 표시 설정 (전역보다 우선) |

> `.telaude/` 디렉토리는 `.gitignore`에 포함되어 있어 git에 추적되지 않는다.
> 서버/인스턴스마다 독립적으로 설정하면 된다.

### 기타 데이터 파일

| 경로 | 설명 |
|------|------|
| `~/.env` (프로젝트 루트) | 봇 토큰, 비밀번호 해시 등 — git 제외 |
| `data/telaude.db` | SQLite DB (세션, 스케줄 등) — git 제외 |
| `user_send/` | 사용자가 전송한 파일 임시 저장 — git 제외 |
