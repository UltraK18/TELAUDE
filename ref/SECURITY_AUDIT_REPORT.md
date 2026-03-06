# Telaude 보안 감사 리포트 v2

**감사일:** 2026-03-06 (2차 감사 - v2 암호화 적용 후)
**감사자:** Claude Code (보안 테스트)
**대상:** `C:\Users\ULTRA\.telaude\` (배포 인스턴스)

---

## v1 → v2 변경 요약

| 항목 | v1 (이전) | v2 (현재) |
|------|-----------|-----------|
| 암호화 방식 | AES-256-GCM + scrypt(hostname:MAC:path) | **Windows DPAPI (CurrentUser)** |
| .env 헤더 | `TELAUDE_ENC:` | `TELAUDE_ENCv2:` |
| 키 재료 | hostname, MAC, 설치경로 (공개값) | **Windows 계정 마스터키 (LSASS 보호)** |
| 크로스플랫폼 | 단일 방식 | Windows DPAPI / macOS Keychain / Linux machine-id |
| AUTH_PASSWORD | 변경 안 됨 (평문 저장) | **새 값으로 교체됨** |
| bcrypt 해시 | `$2b$10$.3UD2F2Nd...` | `$2b$10$xFIa3cWCXE...` (재해싱됨) |

---

## 공격 결과 요약

| # | 공격 벡터 | v1 결과 | v2 결과 |
|---|-----------|---------|---------|
| 1 | v1 fingerprint 키 파생 | **SUCCESS** | **BLOCKED** |
| 2 | scrypt 키 파생 변형 (6개 fingerprint × 5개 salt) | - | **BLOCKED** |
| 3 | @primno/dpapi 동일 유저 호출 | - | **SUCCESS** |
| 4 | DPAPI 마스터키 직접 접근 | - | **BLOCKED** (LSASS 필요) |
| 5 | PowerShell DPAPI 호출 | - | **BLOCKED** (인코딩 오류) |
| 6 | DB 평문 읽기 | **SUCCESS** | **SUCCESS** (변경 없음) |

---

## 개선된 점 (v1 대비)

### [RESOLVED] V-001: 키 파생에 비밀 요소 없음 → DPAPI로 대체

**이전:** `scrypt(hostname:MAC:path)` → 공개값만으로 복호화 가능
**현재:** Windows DPAPI `CryptProtectData(CurrentUser)` 사용

```typescript
// v2: OS-native protection
function getWindowsBackend(): CryptoBackend {
  const { Dpapi } = require('@primno/dpapi');
  return {
    encrypt(data) { return Dpapi.protectData(data, null, 'CurrentUser'); },
    decrypt(data) { return Dpapi.unprotectData(data, null, 'CurrentUser'); },
  };
}
```

**DPAPI 보호 속성:**
- 키가 Windows 계정 비밀번호에서 파생 → 비밀번호 모르면 복호화 불가
- 마스터키가 LSASS 프로세스 메모리에서만 복호화 → 파일 복사만으로는 불가
- 다른 Windows 사용자 계정에서 접근 불가

### [RESOLVED] V-007: MAC 주소 변경 시 자가 잠금

DPAPI는 NIC/MAC과 무관 → 네트워크 어댑터 변경해도 정상 작동

### [IMPROVED] v1→v2 자동 마이그레이션 지원

```typescript
// v1 format (legacy) → decrypt then re-encrypt as v2
if (raw.startsWith(ENC_HEADER)) {
  const v1Result = decryptV1(raw.slice(ENC_HEADER.length));
  if (v1Result !== null) {
    fs.writeFileSync(filePath, v1Result, 'utf-8');
    encryptFile(filePath);  // re-encrypt as v2
  }
}
```

### [IMPROVED] 크로스플랫폼 대응

| OS | 백엔드 | 보호 수준 |
|----|--------|-----------|
| Windows | DPAPI (CurrentUser) | OS 계정 수준 |
| macOS | Keychain (@napi-rs/keyring) | OS 계정 수준 |
| Linux | scrypt(machine-id:UID) | 머신+유저 수준 |

---

## 잔존 취약점

### [HIGH] V-001-R: 동일 Windows 계정에서 DPAPI 복호화 가능

**상태:** 동일 유저(ULTRA) 컨텍스트에서 `@primno/dpapi` 로드 → **복호화 성공**

```
[SUCCESS] DPAPI decryption succeeded!
TELEGRAM_BOT_TOKEN=8225973361:AAFy8E9y07wU0vIS5YMlKYcOet_1QAJdqsQ
AUTH_PASSWORD=1a7639ba9a9e8d34f69cb4850e2176e09dfae6bb
...
```

**분석:**
이것은 DPAPI의 **의도된 동작**입니다. DPAPI는 "같은 Windows 계정 = 같은 사용자 = 신뢰"라는 전제하에 설계되었습니다.

**공격 조건:**
- 동일 Windows 계정(ULTRA)으로 코드 실행 권한 필요
- `@primno/dpapi` 네이티브 모듈 또는 `CryptUnprotectData` Win32 API 호출 가능해야 함
- 원격 공격자가 이 조건을 만족하려면 먼저 계정 탈취가 선행되어야 함

**심각도 평가:**
- v1: 소스코드만 읽으면 복호화 가능 (READ 권한) → **CRITICAL**
- v2: 동일 계정에서 코드 실행 필요 (EXECUTE 권한) → **HIGH** (한 단계 하향)

**추가 방어 옵션 (선택적):**
- DPAPI의 `optionalEntropy` 파라미터에 추가 비밀 주입
- 예: `Dpapi.protectData(data, entropyBuffer, 'CurrentUser')` → entropy 없으면 복호화 불가

---

### [HIGH] V-002: AUTH_PASSWORD 평문 비교 (변경 없음)

**파일:** `src/db/auth-repo.ts:57`

```typescript
if (password === correctPassword) {  // 여전히 평문 비교
```

- AUTH_PASSWORD는 새 값으로 교체됨: `1a7639ba9a9e8d34f69cb4850e2176e09dfae6bb`
- 하지만 여전히 .env에 평문 저장 → .env 복호화 시 즉시 노출
- bcrypt도 새로 해싱됨: `$2b$10$xFIa3cWCXEpSCSXoJtrcB.ABiAthkKSsQ7BjB7.cuf2l8KE/ki5o2`

---

### [HIGH] V-003: SQLite DB 비암호화 (변경 없음)

DB는 여전히 평문 SQLite. 파일 읽기 권한만으로 전체 데이터 접근 가능:

| 데이터 | 현재 값 |
|--------|---------|
| 인증 유저 | `REDACTED_USERNAME` (ID: REDACTED_USER_ID) |
| 비인가 시도 | `makeGainer` (2회), `Mobb154670` (3회) |
| 활성 세션 | opus, 비용 $1.63, 세션 `f3257ece-...` |
| 메시지 로그 | 1,423건 (방향+타임스탬프) |

---

### [MEDIUM] V-004: Rate Limiting (변경 없음)

3회/시간 제한 유지. 40자 hex AUTH_PASSWORD에 대해서는 충분하나, 원칙적으로 개선 여지 있음.

---

### [LOW] V-005: v1 레거시 코드 잔존

`machine-lock.ts:192-227`에 `decryptV1()`, `deriveKeyV1()` 함수가 남아있음.
마이그레이션 목적이지만, v1으로 암호화된 파일이 없다면 제거 권장.

---

## 보안 수준 비교

```
v1:  파일 읽기(READ) → 복호화 → 전체 탈취
     ┌─────────────────────────────────┐
     │  공격자: 소스코드 + .env 파일   │ ← 낮은 장벽
     │  결과: 즉시 복호화              │
     └─────────────────────────────────┘

v2:  코드 실행(EXECUTE) + 동일 계정 → DPAPI 호출 → 복호화
     ┌─────────────────────────────────┐
     │  공격자: 계정 탈취 필요         │ ← 높은 장벽
     │  파일만 복사: 복호화 불가       │
     │  다른 계정: 복호화 불가         │
     │  다른 머신: 복호화 불가         │
     └─────────────────────────────────┘
```

---

## 최종 권장 조치

| 우선순위 | 항목 | 상태 | 조치 |
|----------|------|------|------|
| **P0** | DPAPI 도입 | ✅ 완료 | - |
| **P0** | 봇 토큰/AUTH_PASSWORD 교체 | ✅ 완료 (AUTH_PASSWORD 변경 확인) | 봇 토큰도 교체 권장 |
| ~~P1~~ | ~~AUTH_PASSWORD 해싱 저장~~ | ❌ 미적용 | .env에 해시 저장, bcrypt.compare로 비교 |
| **P1** | SQLCipher 또는 DB DPAPI 암호화 | ❌ 미적용 | DB도 DPAPI 또는 SQLCipher 적용 |
| **P2** | DPAPI entropy 추가 | ❌ 미적용 | `optionalEntropy` 파라미터로 2차 비밀 추가 |
| **P2** | v1 레거시 코드 제거 | ❌ 미적용 | 마이그레이션 완료 후 `decryptV1` 삭제 |
| **P3** | Rate Limiting 강화 | ❌ 미적용 | 지수 백오프 적용 |

---

## 결론

**v1 → v2 전환으로 핵심 취약점(V-001)이 대폭 개선되었습니다.**

v1에서는 소스코드를 읽을 수 있는 누구나 .env를 복호화할 수 있었지만, v2에서는 **동일 Windows 계정에서 코드를 실행할 수 있어야** 합니다. 이는 "파일 읽기"에서 "계정 탈취"로 공격 난이도를 크게 높였습니다.

그러나 DPAPI의 설계 특성상 **동일 계정 = 동일 신뢰**이므로, 계정이 탈취되면 여전히 복호화됩니다. 이것은 DPAPI의 한계이자 의도된 동작이며, `optionalEntropy` 파라미터를 활용하면 추가 방어층을 구축할 수 있습니다.

**잔존 과제:** DB 암호화, AUTH_PASSWORD 해싱 저장 방식 전환, v1 레거시 코드 제거.
