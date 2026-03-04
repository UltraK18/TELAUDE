# POKE Feature Design

## POKE.md Structure

```markdown
---
intensity: high
frequency: medium
timezone: Asia/Seoul
track:
  - sleep_time
  - weekly_distribution
context: ./HEARTBEAT.md
---

You finished your work but the user vanished.
Read the context and send a natural first message.
```

### Frontmatter Fields
- `intensity` — first poke timing level
- `frequency` — total poke count level
- `timezone` — IANA timezone string (e.g. `Asia/Seoul`). Falls back to system timezone if omitted.
- `track` — optional pattern analysis from message_logs
  - `sleep_time` — infer sleep window (also indirectly covers meal times)
  - `weekly_distribution` — day-of-week activity pattern
- `context` — single glob pattern; matched files are injected into the prompt body

---

## intensity Levels (first poke delay, randomized range)

| level | first poke range | notes |
|-------|-----------------|-------|
| `minimal` | 0–60 min random | 50% chance of not sending at all |
| `very_low` | 45–60 min | always sends |
| `low` | 20–30 min | |
| `medium` | 7–10 min | |
| `high` | 3–5 min | |
| `very_high` | 1–2 min | |
| `extreme` | 30–60 sec | |

---

## frequency Levels (total poke count)

| level | max count |
|-------|----------|
| `minimal` | 1 |
| `very_low` | 2–3 |
| `low` | 3–5 |
| `medium` | 5–7 |
| `high` | 7–10 |
| `very_high` | 10–12 |
| `extreme` | up to 15 |

---

## Sleep Window Poke Probability

| level | early sleep | light sleep | mid sleep | deep sleep |
|-------|------------|------------|-----------|-----------|
| `minimal`~`low` | ❌ | ❌ | ❌ | ❌ |
| `medium` | very low | ❌ | ❌ | ❌ |
| `high` | low | very low | ❌ | ❌ |
| `very_high` | medium | low | ❌ | ❌ |
| `extreme` | high | medium | low | ❌ |

> Deep sleep is excluded even at `extreme`

---

## Trigger Modes

### 1. Event-based
Estimated time-of-day events inferred from message_logs pattern analysis:
- estimated wake-up
- estimated bedtime
- estimated commute start
- estimated commute end
- estimated lunch
- estimated leisure
- estimated work hours
- estimated frequent chat time
- estimated weekend pattern (separate from weekday)

### 2. Fully Random
Fires regardless of pattern/events, based on intensity/frequency probability.
Uses **Variable Ratio (slot machine)** scheduling — unpredictable timing is the point.

---

## stdin Structure

```
<system-reminder>
Current time: 2026-03-04 23:41 (Asia/Seoul)
Estimated user state: leisure
Time since user's last message: 2h 15m
Use this context to compose a natural proactive message.
If poking is unnecessary (e.g. user said goodbye), call poke_ok to skip.
</system-reminder>

{POKE.md body + context file contents}
```

- **Current time**: derived from frontmatter `timezone`, fallback to system timezone
- **Estimated state**: from message_logs pattern analysis (requires `track`)
- **Elapsed time**: calculated from user's last message timestamp in message_logs

---

## MCP Tool

- `poke_ok` — call when poke is unnecessary (turn deleted, timer suppressed)
  - Same pattern as `heartbeat_ok` / `schedule_ok`
  - Description notes: "only call during poke-mode spawn"
  - Claude should call autonomously when farewell context is detected (e.g. "see you later!")

---

## Timer / Reset Conditions

- ✅ **Timer starts/updates**: when Claude finishes responding to a user message
- ✅ **Reset**: when user sends a message directly → timer + poke counter reset
- ❌ **Ignored**: heartbeat spawn/response, schedule spawn/response, heartbeat_ok, schedule_ok, poke_ok

---

## File Detection Rules

- ✅ `POKE.md` only — valid
- ❌ `POKE.md.old`, `.poke.md`, `poke.md.bak`, etc. — fully ignored, poke disabled
- **Hot reload**: `fs.watch` monitors `POKE.md` → re-parses frontmatter + resets timer on change

---

## message_logs Table (new)

```sql
CREATE TABLE message_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  direction TEXT NOT NULL,  -- 'user' | 'claude'
  timestamp TEXT DEFAULT (datetime('now'))
);
```

Pattern analysis targets:
- Hourly activity distribution → infer estimated events
- Day-of-week distribution → weekend pattern
- Long inactivity gaps → sleep window estimation
