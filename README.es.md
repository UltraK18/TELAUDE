> Este documento es una traducción al español del original en inglés. | [English](./README.md)

# TELAUDE

Un puente de orquestación headless de código abierto que expone de forma segura el CLI de Claude Code a Telegram, transformando interfaces de mensajería estándar en espacios de trabajo para desarrolladores completamente funcionales y multi-contexto.

Construido enteramente sobre `claude -p` (modo pipe) — aprovechando las capacidades nativas del CLI sin hacks de SDK ni APIs no oficiales.

Envía un mensaje a través de Telegram y el servidor genera un proceso `claude -p`, transmitiendo los resultados a tu chat en tiempo real.

## Características

### Streaming y Multi-Contexto
- **Streaming en Tiempo Real** — Las respuestas de Claude se transmiten en vivo a Telegram con ediciones incrementales
- **Arquitectura Multi-Capítulo** — Sesiones independientes por chat/hilo (temas de DM, foros de grupo). Cada capítulo tiene su propio proceso CLI, sesión, directorio de trabajo y configuración
- **Gestión de Sesiones** — Reanuda conversaciones, lista sesiones, renómbralas y restaura el contexto previo
- **Visualización de Llamadas a Herramientas** — Observa qué herramientas está usando Claude en tiempo real, con contadores en superíndice, iconos personalizados e indicadores de compactación animados
- **UX Nativa de Telegram** — Los mensajes de herramientas se eliminan automáticamente cuando llega texto, la compactación muestra puntos animados, las respuestas largas se dividen automáticamente en límites naturales (bloques de código > párrafos > líneas), y los fallos de parseo HTML recurren elegantemente a texto plano

### Extensibilidad y MCP
- **Servidor MCP Integrado** — Herramientas nativas para programación, envío de archivos, consultas al usuario y más
- **Integración MCP Externa** — Otros servidores MCP pueden usar las capacidades de mensajería Telegram de Telaude a través de la API HTTP interna
- **UI de Herramientas Configurable** — La visibilidad e iconos de herramientas son totalmente personalizables mediante configuración global o por proyecto

### Flujos de Trabajo Proactivos y Agénticos
- **Cron / Programación** — Ejecuta tareas programadas (cron recurrente o disparo único), con modo de trabajo aislado
- **Poke** — Seguimiento automático cuando Claude queda en silencio (consciente del estado de suspensión, intensidad configurable)
- **Heartbeat** — Mecanismo de verificación de salud para tareas programadas

### Entrada y Contexto
- **Soporte de Medios** — Fotos, documentos, audio, video, stickers y notas de voz
- **Soporte de Mensajes Reenviados** — Los mensajes reenviados se recopilan y envían como contexto a Claude
- **Vista Previa de Enlaces** — Obtiene automáticamente contexto para URLs compartidas en mensajes (X/Twitter, YouTube, metaetiquetas OG)
- **Reacciones con Emoji** — Reacciones bidireccionales (usuario-a-bot y bot-a-usuario)

### Monitoreo y Control
- **Panel TUI** — Panel de terminal de tres columnas (Registros | Sesiones | Programación) con navegación exclusiva por teclado
- **Configuración por Capítulo** — Cada capítulo tiene configuración independiente de MCP, herramientas y modelo a través del TUI
- **Uso de Contexto** — `/context` muestra el uso de tokens en tiempo real, información del modelo y costo

### Seguridad
- **Cifrado Nativo del SO** — Protege los secretos del `.env` usando criptografía a nivel de sistema operativo (Windows DPAPI / macOS Keychain / Linux machine-id)
- **Validación de Rutas** — Las operaciones de archivos están restringidas a límites permitidos
- **Autenticación** — Desafío de contraseña vía `/auth` antes de procesar cualquier comando

## Cómo Funciona — CLI Nativo, No SDK

TELAUDE **no** usa el Claude Agent SDK, APIs no oficiales ni extracción de tokens OAuth. Genera el CLI oficial `claude -p` como un proceso hijo y se comunica vía stdin/stdout — de la misma forma que lo usarías en una terminal.

```
Telegram message → child_process.spawn('claude', ['-p', ...]) → stdin/stdout → Telegram
```

Al construirse sobre `-p` (modo pipe), TELAUDE hereda todas las características nativas del CLI — gestión de sesiones, integración de servidores MCP, compactación de contexto, permisos de herramientas, caché de prompts y más — sin reimplementar ninguna de ellas. Se hace todo el esfuerzo posible para reflejar la experiencia completa del CLI nativo a través de Telegram, añadiendo al mismo tiempo mejoras de UX nativas de Telegram como animaciones de herramientas en tiempo real, división inteligente de mensajes y teclados inline interactivos.

Esto importa porque los [Términos de Servicio](https://autonomee.ai/blog/claude-code-terms-of-service-explained/) de Anthropic prohíben explícitamente el uso de tokens OAuth de suscripción por terceros con el Agent SDK, y han [bloqueado activamente](https://autonomee.ai/blog/claude-code-terms-of-service-explained/) proyectos que lo hacen (OpenClaw, OpenCode, Cline, Roo Code, etc.). TELAUDE evita esto completamente — llama al binario del CLI en tu máquina, que usa tu autenticación existente de Claude Code tal como fue diseñada.

## Documentación

Para uso detallado y configuración, consulta **[docs/index.md](./docs/index.md)**.

## Inicio Rápido

Asegúrate de que [Bun](https://bun.sh/) esté instalado.

```bash
# Install dependencies
bun install

# First run (setup wizard guides you through .env creation)
bun run dev
```

El asistente de configuración te pedirá:
1. Token del Bot de Telegram (crea uno con [@BotFather](https://t.me/BotFather))
2. Contraseña de autenticación
3. Verificación del estado de autenticación del CLI de Claude

## Comandos

| Comando | Descripción |
|---------|-------------|
| `/start` | Mensaje de bienvenida del bot |
| `/auth <pw>` | Autenticarse con contraseña |
| `/help` | Listar comandos disponibles |
| `/new` | Iniciar una nueva sesión |
| `/stats` | Información de sesión + uso de tokens |
| `/resume` | Listar sesiones recientes (reanudar / eliminar) |
| `/stop` | Detener el procesamiento actual |
| `/stop <text>` | Detener y enviar nueva entrada |
| `/rename <name>` | Renombrar la sesión actual (sincroniza con el JSONL de Claude Code) |
| `/compact [instructions]` | Compactar el contexto de conversación |
| `/history` | Mostrar los últimos 5 turnos de conversación |
| `/cd <path>` | Cambiar directorio de trabajo |
| `/pwd` | Mostrar directorio actual |
| `/projects` | Listar rutas de proyectos permitidas |
| `/model [name]` | Ver o cambiar el modelo |
| `/budget [amount]` | Ver o establecer presupuesto de tokens |
| `/context` | Uso de ventana de contexto (tokens/modelo/costo) |
| `/schedule` | Ver trabajos programados |

## Compilación y Ejecución

```bash
bun run build        # TypeScript build
bun start            # Production
bun run dev          # Development (stdin supported)
bun run dev:watch    # Development (auto-reload, no stdin)
bun run build:exe    # Compile single executable
```

> **Nota:** `build:exe` actualmente produce un ejecutable para Windows. Las compilaciones de binarios multiplataforma (Linux, macOS) están planificadas pero aún no han sido probadas — se agradecen contribuciones y ayuda con las pruebas.

## Integración MCP Externa

Telaude expone una API HTTP interna que **permite a servidores MCP externos enviar mensajes a través de Telegram**.

Cuando Telaude genera un proceso del CLI de Claude, inyecta las siguientes variables de entorno en **todos los servidores MCP externos** vía `--mcp-config`:

| Variable | Descripción |
|----------|-------------|
| `TELAUDE_API_URL` | Dirección de la API interna (`http://127.0.0.1:19816`) |
| `TELAUDE_API_TOKEN` | Token de autenticación de solicitudes (generado en tiempo de ejecución) |
| `TELAUDE_USER_ID` | ID de usuario de Telegram |
| `TELAUDE_CHAT_ID` | ID de chat del capítulo actual (DM = userId, grupo = groupId) |
| `TELAUDE_THREAD_ID` | ID de hilo/tema del capítulo actual (0 = sin hilo) |

### Endpoints Disponibles

| Endpoint | Body | Descripción |
|----------|------|-------------|
| `POST /mcp/send-photo` | `{ path }` | Enviar un archivo de imagen (ruta absoluta) |
| `POST /mcp/send-file` | `{ path }` | Enviar un archivo (ruta absoluta) |
| `POST /mcp/send-sticker` | `{ sticker_id }` | Enviar un sticker (file_id de Telegram) |
| `POST /mcp/zip-and-send` | `{ dir }` | Comprimir un directorio y enviarlo |
| `POST /mcp/ask` | `{ question, choices? }` | Preguntar al usuario (soporta opciones con teclado inline) |
| `POST /mcp/set-reaction` | `{ emoji }` | Reaccionar al mensaje más reciente del usuario con un emoji |
| `POST /mcp/pin-message` | `{}` | Fijar el mensaje más reciente del bot |
| `POST /mcp/unpin-message` | `{}` | Desfijar el mensaje fijado |

### Configuración de Visualización de Herramientas

Configura la visibilidad e iconos de herramientas a través de archivos de configuración. La configuración a nivel de proyecto tiene prioridad sobre la global.

- **Global**: `~/.telaude/telaude-mcp-settings.json`
- **Proyecto**: `<cwd>/.telaude/telaude-mcp-settings.json` (tiene prioridad)

```jsonc
{
  "tools": {
    "hidden_tool": { "hidden": true },
    "some_tool": { "icon": "🚀" },
    "fancy_tool": { "icon": { "emojiId": "5206186681346039457", "fallback": "🧑‍🎓" } }
  }
}
```

- `hidden: true` — Ocultar la herramienta de los mensajes de llamadas a herramientas en Telegram
- `icon` (cadena) — Reemplazar el icono de la herramienta con un emoji Unicode
- `icon` (objeto) — Usar un emoji personalizado Premium de Telegram (`emojiId` + `fallback`)
- Las herramientas MCP se emparejan por sufijo (`mcp__server__tool` coincide con `tool`)
- Recarga en caliente al cambiar el archivo (no requiere reinicio)

### Ejemplo de Uso

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

Telaude inyecta automáticamente las variables de entorno `TELAUDE_*` en todos los servidores MCP listados en `--mcp-config` al generar el CLI de Claude. Las variables de entorno propias de cada servidor MCP (p. ej., `GOOGLE_API_KEY`) se preservan. Para uso local independiente sin Telaude, implementa un fallback elegante usando `isTelaudeAvailable()`.

## Arquitectura

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

## Contribuir

TELAUDE es completamente de código abierto. Se aceptan contribuciones, reportes de errores y pruebas multiplataforma — especialmente para:
- **Compilaciones de binarios para macOS / Linux** — `build:exe` actualmente es solo para Windows
- **Integración con macOS Keychain** — El cifrado nativo del SO necesita pruebas en dispositivos reales
- **Compatibilidad de terminal** — Problemas de entrada del TUI en terminales no-Windows (macOS, Termux)

## Licencia

MIT

---

*TELAUDE fue 100% construido usando Claude Code a través de Telegram — desarrollado completamente mediante el sistema que crea.*
