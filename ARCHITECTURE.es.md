> Este documento es una traducción al español del original en inglés. | [English](./ARCHITECTURE.md)

# Arquitectura de TELAUDE

Puente Telegram-Claude Code — un bot que controla remotamente el CLI de Claude Code desde Telegram.

## Stack Tecnológico

- **Runtime**: Bun (TypeScript, ESM)
- **Framework de Bot**: grammY + @grammyjs/auto-retry
- **Base de Datos**: better-sqlite3 (modo WAL)
- **Autenticación**: bcrypt (hashing de contraseñas) + cifrado nativo del SO (Windows DPAPI / macOS Keychain / Linux)
- **Logging**: pino
- **CLI**: Claude Code (`claude -p --output-format stream-json --verbose`)
- **Programador**: croner (expresiones cron) + setTimeout (disparo único)
- **MCP**: Servidor MCP integrado (stdio) + API HTTP interna para integración MCP externa

## Estructura de Directorios

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

## Conceptos Fundamentales

### Terminología

| Término | Definición | Identificador |
|---------|-----------|--------------|
| **Session** | Conversación JSONL del CLI de Claude + metadatos en BD | `sessionId` (UUID) |
| **Chapter** | Unidad de hilo de Telaude — un contexto de usuario + chat + hilo | `chapterKey` = `userId:chatId:threadId` |
| **UP (UserProcess)** | Estado del proceso en memoria por capítulo | `processes.get(chapterKey)` |

- Cada capítulo tiene su propio proceso CLI, sesión, directorio de trabajo, cola de mensajes y configuración
- Se pueden crear/reanudar múltiples sesiones dentro de un solo capítulo
- Los capítulos son independientes — la programación, generación de procesos y mensajería no bloquean a otros capítulos

### Generación de Procesos por Mensaje

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

### Interfaz del CLI de Claude

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

- **Entrada**: Texto plano vía stdin → stdin.end()
- **Salida**: NDJSON (un evento JSON por línea)
- **Limpieza de env**: Elimina `CLAUDECODE`, `CLAUDE_CODE*`, `ANTHROPIC_API_KEY` (previene anidamiento)
- **windowsHide**: true (previene herencia de handles de socket del servidor en Windows)

### Formato de Eventos de Stream

```
system   → { type: "system", subtype: "init", session_id, tools: string[] }
assistant → { type: "assistant", message: { content: [{type:"text",...}, {type:"tool_use",...}], usage } }
result   → { type: "result", cost_usd, total_cost_usd, num_turns, duration_ms, session_id, modelUsage }
```

### Estrategia de Visualización en Telegram

1. **Llamadas a herramientas**: Mensaje único con animación de edición (límite de 1s)
   - Contadores en superíndice: `🔍² Grep` (la primera herramienta no tiene superíndice)
   - Las herramientas Agent (subagente) se fijan arriba, las herramientas regulares abajo
2. **Respuesta de texto**: El mensaje de herramientas se elimina → mensaje separado con ediciones en streaming
3. **División de mensajes**: División automática a los 4000 caracteres (bloque de código > párrafo > límites de línea)
4. **Fallo de parseo HTML**: Fallback a texto plano
5. **Animación de compactación**: Puntos animados a intervalos de 2s, recuento de tokens al completar

## Arquitectura Multi-Capítulo

Cada capítulo (`userId:chatId:threadId`) es completamente independiente:

- **UP separado**: Proceso CLI propio, sesión, directorio de trabajo, modelo, cola de mensajes
- **Programación independiente**: Los trabajos cron/poke verifican `isProcessing` por capítulo, no por usuario
- **Configuración independiente**: Configuración de herramientas/MCP/modelo por capítulo vía TUI (almacenada en settings.json)
- **Restauración de sesión**: Al reiniciar el bot, las sesiones activas de la BD se restauran como UPs con workingDir, modelo, sessionId
- **Caché de herramientas MCP**: Global (compartida entre capítulos), poblada desde eventos init — cualquier generación de proceso de capítulo actualiza la caché

### Flujo de Tareas Programadas

```
Cron triggers → check if target chapter is processing
  → Yes: enqueue (same chapter only, other chapters unaffected)
  → No: spawn directly in target chapter's context
    → StreamHandler (silent mode) → collect response
    → On exit: send report to correct thread (message_thread_id)
```

## Panel de Configuración TUI

UI basada en pestañas con navegación por teclado:

```
[Model]  [MCP Servers]  [Base Tools]
─────────────────────────────────────
 (items for selected tab)
```

- **Pestaña Model**: Seleccionar modelo de Claude (selección por radio)
- **Pestaña MCP Servers**: Activar/desactivar servidores + sub-lista de herramientas por servidor
  - Servidor habilitado: muestra herramientas con indentación (de la caché global del evento init)
  - Sin herramientas recopiladas aún: pista "(requires first conversation)"
  - Servidor deshabilitado: herramientas ocultas
- **Pestaña Base Tools**: Herramientas integradas (Bash, Read, etc.) + herramientas MCP de Telaude
- **Navegación**: ←→/Tab para pestañas, ↑↓ para elementos, Espacio/Enter para alternar, Esc para cerrar
- **Persistencia**: disabledTools/disabledMcpServers guardados por capítulo en settings.json

## Esquema de Base de Datos

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

## Carga de Configuración

`config.ts` usa un patrón Proxy para carga diferida:

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

Esto permite que `setup.ts` cree .env → `loadConfig()` → otros módulos accedan a config.

## API Interna e Integración MCP Externa

Telaude ejecuta un servidor HTTP en `127.0.0.1:19816` que expone la mensajería de Telegram a servidores MCP externos.

**Variables de entorno auto-inyectadas** (vía `--mcp-config`):
- `TELAUDE_API_URL` — Dirección de la API interna
- `TELAUDE_API_TOKEN` — Token de autenticación en tiempo de ejecución (destruido al salir)
- `TELAUDE_USER_ID` — ID de usuario de Telegram
- `TELAUDE_CHAT_ID` — ID de chat del capítulo actual
- `TELAUDE_THREAD_ID` — ID de hilo del capítulo actual

**MCP http-client** auto-inyecta `_chatId` y `_threadId` en todas las solicitudes API desde las variables de entorno, asegurando el enrutamiento correcto del capítulo.

**Endpoints**: send-photo, send-file, send-sticker, zip-and-send, ask, pin/unpin, set-reaction, cron CRUD

## Programador y Poke

- **Trabajos Cron**: Tareas recurrentes vía croner, persistidas en archivo JSON
- **Trabajos de Disparo Único**: Temporizadores de disparo único con `runAt` (soporta relativo: "5m", "1h" y solo hora: "09:15")
- **Generación independiente por capítulo**: Las tareas programadas solo se encolan cuando su capítulo objetivo está ocupado, no cuando otros capítulos están activos
- **Sincronización del panel**: `triggerOnChange()` llamado después de scheduleJob para actualizar la sección Incoming
- **Poke**: Seguimiento automático cuando Claude queda en silencio — inyecta lenguaje natural en stdin vía `--resume`
- **Heartbeat**: Verificación de salud basada en HEARTBEAT.md

## Seguridad

- `.env` cifrado con APIs nativas del SO (Windows DPAPI / macOS Keychain / Linux machine-id+UID)
- La API interna se vincula solo a localhost con seguimiento de sockets para cierre limpio
- Tokens de tiempo de ejecución generados por proceso, nunca persistidos
- Validación de rutas de archivos en todas las rutas send-file/send-photo/zip-and-send
- Hashing de contraseñas con bcrypt con seguimiento de intentos fallidos
- `spawn()` usa `windowsHide: true` para prevenir herencia de handles de socket del servidor
- Reload usa un retraso de ACK de 500ms antes de salir para prevenir la re-entrega de actualizaciones de grammY

## Vista Previa de Enlaces

Detección de URL → obtención vía API proxy → anteponer contexto al stdin de Claude.

| Plataforma | Método | Datos |
|------------|--------|-------|
| X/Twitter | fxtwitter API | Texto completo, estadísticas de engagement, imágenes, cuerpo del artículo (bloques Draft.js) |
| YouTube | noembed.com | Título, nombre del canal |
| URL genérica | Parseo de metaetiquetas OG | Título, descripción, nombre del sitio (límite de 50KB en obtención de HTML) |

## Configuración de Visualización de Herramientas

Configurable vía `telaude-mcp-settings.json` (global `~/.telaude/` o proyecto `.telaude/`).

- `hidden: true` — ocultar de los mensajes de herramientas en Telegram
- `icon` — Emoji Unicode o emoji personalizado Premium de Telegram (`emojiId` + `fallback`)
- Herramientas MCP emparejadas por sufijo (`mcp__server__tool` → `tool`)
- Recarga en caliente vía comparación de mtime (no requiere reinicio)
