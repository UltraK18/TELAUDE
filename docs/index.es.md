> Este documento es una traducción al español del original en inglés. | [English](./index.md)

# Documentación de Telaude

## Guías

| Documento | Descripción |
|-----------|-------------|
| [Integración MCP Externa](./external-mcp-integration.es.md) | Cómo los servidores MCP externos pueden usar las capacidades de mensajería Telegram de Telaude |
| [Configuración de Visualización de Herramientas](./tool-display-settings.es.md) | Ocultar herramientas o personalizar iconos (global/nivel de proyecto, recarga en caliente) |

## Ubicaciones de Archivos de Configuración

Los archivos de configuración y datos de Telaude se almacenan en directorios dedicados que **no son rastreados por git**.

### Directorio Global (`~/.telaude/`)

Ubicado bajo el directorio home del usuario del SO. Estas configuraciones se aplican a todos los proyectos. Como no son rastreadas por git, deben crearse manualmente en cada instancia.

| Ruta | Descripción |
|------|-------------|
| `~/.telaude/data/settings.json` | Configuración jerárquica V2 (por directorio de trabajo + por capítulo) |
| `~/.telaude/data/bot.log` | Archivo de registro del bot |
| `~/.telaude/data/sticker-cache/` | Caché de miniaturas JPG de stickers |
| `~/.telaude/telaude-mcp-settings.json` | Configuración global de visualización de herramientas (oculto/icono) |
| `~/.telaude/allowed_project_roots.json` | Rutas permitidas para el comando `/cd` (sin archivo = sin restricciones) |

### Directorio de Proyecto (`.telaude/`)

Ubicado bajo cada directorio de trabajo de Claude (cwd). Estas configuraciones se aplican solo a ese proyecto específico.

| Ruta | Descripción |
|------|-------------|
| `.telaude/telaude-mcp-settings.json` | Configuración de visualización de herramientas a nivel de proyecto (anula la global) |
| `.telaude/POKE.md` | Configuración de Poke (seguimiento automático cuando Claude queda en silencio) |
| `.telaude/HEARTBEAT.md` | Archivo de estado de Heartbeat (verificación de salud para tareas programadas) |

> El directorio `.telaude/` está incluido en `.gitignore` y no es rastreado por git. Configúralo independientemente en cada instancia.

#### allowed_project_roots.json

Restringe a qué rutas puede navegar el comando `/cd`. Si el archivo no existe, todas las rutas están permitidas.

```json
[
  "/home/user/projects",
  "/home/user/work"
]
```

Ejemplo para Windows:
```json
[
  "C:\\Users\\user\\projects",
  "C:\\work"
]
```

### Otros Archivos de Datos

| Ruta | Descripción |
|------|-------------|
| `~/.telaude/.env` | Token del bot, hash de contraseña, etc. — cifrado con cifrado nativo del SO |
| `~/.telaude/data/telaude.db` | Base de datos SQLite (sesiones, programaciones, etc.) — excluida de git |
| `user_send/` | Almacenamiento temporal para archivos subidos por el usuario — excluido de git |

## Configuración y Autenticación

### Primera Ejecución

Ejecutar `bun run dev` lanza automáticamente el asistente de configuración, que te guía a través de los siguientes pasos:

1. **Token del Bot de Telegram** — obtén uno de [@BotFather](https://t.me/BotFather)
2. **Contraseña de autenticación** — establece una contraseña para el acceso al bot
3. **Estado de autenticación del CLI de Claude** — verifica si el CLI está autenticado (te solicita ejecutar `claude` si no lo está)

Una vez proporcionados todos los datos, se genera automáticamente un archivo `.env` y el bot se inicia.

> **No necesitas editar manualmente el archivo `.env`.** El asistente lo crea, y la contraseña está protegida de forma segura internamente.

### Autenticación del Bot

Después de que el bot se inicie, envía `/auth <password>` en Telegram para autenticarte. Una vez autenticado, todos los comandos de Claude estarán disponibles.

### Variables de Entorno (.env)

Variables requeridas (creadas por el asistente de configuración):

| Variable | Descripción |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Token del bot emitido por BotFather |
| `AUTH_PASSWORD` | Contraseña de autenticación del bot de Telegram (almacenada como hash bcrypt) |

Variables opcionales:

| Variable | Predeterminado | Descripción |
|----------|---------------|-------------|
| `ALLOWED_TELEGRAM_IDS` | (ninguno, cualquiera permitido) | IDs de usuario de Telegram permitidos (separados por comas) |
| `CHAT_ID` | Auto-detectado | ID de chat para notificaciones del bot (guardado automáticamente al autenticar) |
| `CLAUDE_CLI_PATH` | `claude` | Ruta al ejecutable del CLI de Claude |
| `DEFAULT_MODEL` | `default` | Modelo predeterminado de Claude (predeterminado nativo del CLI) |
| `DEFAULT_MAX_BUDGET_USD` | `5.0` | Límite de presupuesto predeterminado (USD) |
| `DEFAULT_MAX_TURNS` | `50` | Número máximo de turnos predeterminado |
| `DEFAULT_WORKING_DIR` | Directorio actual | Directorio de trabajo predeterminado |
| `SESSION_IDLE_TIMEOUT_MS` | `1800000` | Tiempo de espera de inactividad de sesión (ms) |
| `STREAM_UPDATE_INTERVAL_MS` | `500` | Intervalo de actualización de streaming (ms) |
| `STREAM_UPDATE_MIN_CHARS` | `200` | Caracteres mínimos antes de actualización de streaming |
| `MCP_INTERNAL_API_PORT` | `19816` | Puerto de API interna MCP |
| `LOG_LEVEL` | `info` | Nivel de registro |

### Seguridad

Telaude protege el archivo `.env` completo con cifrado nativo del SO (Windows DPAPI / macOS Keychain / Linux). El descifrado es imposible sin acceso a la misma cuenta de usuario del SO.

## Endpoints de API MCP Interna

Los servidores MCP que se ejecutan bajo procesos de Claude generados por Telaude pueden usar la API HTTP interna (`http://127.0.0.1:19816`) para enviar mensajes a través de Telegram.

Cabeceras de autenticación:

```
X-Telaude-Token: <TELAUDE_API_TOKEN>
X-Telaude-User-Id: <TELAUDE_USER_ID>
```

| Endpoint | Body | Descripción |
|----------|------|-------------|
| `POST /mcp/send-photo` | `{ path: string }` | Enviar un archivo de imagen (ruta absoluta) |
| `POST /mcp/send-file` | `{ path: string }` | Enviar un archivo (ruta absoluta) |
| `POST /mcp/send-sticker` | `{ sticker_id: string }` | Enviar un sticker (file_id de Telegram) |
| `POST /mcp/zip-and-send` | `{ dir: string }` | Comprimir un directorio y enviar el archivo |
| `POST /mcp/ask` | `{ question: string, choices?: string[] }` | Hacer una pregunta al usuario y esperar una respuesta |
| `POST /mcp/pin-message` | `{}` | Fijar el mensaje más reciente del bot |
| `POST /mcp/unpin-message` | `{}` | Desfijar el mensaje fijado |
| `POST /mcp/set-reaction` | `{ emoji: string }` | Establecer una reacción emoji en el mensaje del usuario |

Las variables de entorno `TELAUDE_API_URL`, `TELAUDE_API_TOKEN`, `TELAUDE_USER_ID`, `TELAUDE_CHAT_ID` y `TELAUDE_THREAD_ID` son inyectadas automáticamente por Telaude vía `--mcp-config` al generar el CLI de Claude. Consulta [Integración MCP Externa](./external-mcp-integration.es.md) para más detalles.
