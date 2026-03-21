> Este documento es una traducción al español del original en inglés. | [English](./external-mcp-integration.md)

# Integración MCP Externa

Telaude proporciona capacidades de mensajería Telegram a servidores MCP externos a través de su API HTTP interna (`127.0.0.1:19816`).

## Variables de Entorno (Auto-Inyectadas)

Cuando Telaude genera el CLI de Claude, inyecta automáticamente las siguientes variables en el entorno de cada servidor MCP externo vía `--mcp-config`:

| Variable | Descripción |
|----------|-------------|
| `TELAUDE_API_URL` | Dirección de la API interna (`http://127.0.0.1:19816`) |
| `TELAUDE_API_TOKEN` | Token de autenticación de solicitudes (generado en tiempo de ejecución, destruido al salir del proceso) |
| `TELAUDE_USER_ID` | ID de usuario de Telegram |
| `TELAUDE_CHAT_ID` | ID de chat del capítulo actual (DM = userId, grupo = groupId) |
| `TELAUDE_THREAD_ID` | ID de hilo/tema del capítulo actual (0 = sin hilo) |

## Endpoints Disponibles

Todas las solicitudes requieren las siguientes cabeceras:

```
Content-Type: application/json
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
| `POST /mcp/set-reaction` | `{ emoji: string }` | Establecer una reacción emoji en el mensaje más reciente del usuario |
| `POST /mcp/pin-message` | `{}` | Fijar el mensaje más reciente del bot |
| `POST /mcp/unpin-message` | `{}` | Desfijar el mensaje fijado |

## Ejemplos de Uso

```typescript
// Using the Telaude API from within an MCP server
const apiUrl = process.env.TELAUDE_API_URL;
const headers = {
  'Content-Type': 'application/json',
  'X-Telaude-Token': process.env.TELAUDE_API_TOKEN!,
  'X-Telaude-User-Id': process.env.TELAUDE_USER_ID!,
};

// Send an image
await fetch(`${apiUrl}/mcp/send-photo`, {
  method: 'POST', headers,
  body: JSON.stringify({ path: '/tmp/image.png' }),
});

// Send a sticker
await fetch(`${apiUrl}/mcp/send-sticker`, {
  method: 'POST', headers,
  body: JSON.stringify({ sticker_id: 'CAACAgIAAxkB...' }),
});

// Ask the user a question (with button choices)
const res = await fetch(`${apiUrl}/mcp/ask`, {
  method: 'POST', headers,
  body: JSON.stringify({ question: 'Which option?', choices: ['A', 'B', 'C'] }),
});
const { answer } = await res.json();
```

## Requisitos de Integración

- Solo disponible desde servidores MCP generados por procesos de Claude Code ejecutándose bajo Telaude
- Al probar localmente sin Telaude, `TELAUDE_API_TOKEN` no estará configurado — se recomienda un fallback elegante

```typescript
function isTelaudeAvailable(): boolean {
  return !!(process.env.TELAUDE_API_TOKEN && process.env.TELAUDE_USER_ID);
}
```

## Seguridad

- **Solo localhost**: Se vincula exclusivamente a `127.0.0.1` — no es posible el acceso externo
- **Tokens de tiempo de ejecución**: Generados cuando el proceso de Telaude se inicia, destruidos al salir (nunca persistidos en disco)
- Las variables de entorno existentes del servidor MCP (p. ej., `GOOGLE_API_KEY`) se preservan
