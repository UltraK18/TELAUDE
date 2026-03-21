> Ce document est une traduction française de l'original en anglais. | [English](./external-mcp-integration.md)

# Intégration MCP externe

Telaude fournit des capacités de messagerie Telegram aux serveurs MCP externes via son API HTTP interne (`127.0.0.1:19816`).

## Variables d'environnement (auto-injectées)

Quand Telaude lance le CLI Claude, il injecte automatiquement les variables suivantes dans l'environnement de chaque serveur MCP externe via `--mcp-config` :

| Variable | Description |
|----------|-------------|
| `TELAUDE_API_URL` | Adresse de l'API interne (`http://127.0.0.1:19816`) |
| `TELAUDE_API_TOKEN` | Token d'authentification des requêtes (généré à l'exécution, détruit à la sortie du processus) |
| `TELAUDE_USER_ID` | Identifiant utilisateur Telegram |
| `TELAUDE_CHAT_ID` | Identifiant du chat du chapitre actuel (DM = userId, groupe = groupId) |
| `TELAUDE_THREAD_ID` | Identifiant du thread/sujet du chapitre actuel (0 = pas de thread) |

## Points de terminaison disponibles

Toutes les requêtes nécessitent les en-têtes suivants :

```
Content-Type: application/json
X-Telaude-Token: <TELAUDE_API_TOKEN>
X-Telaude-User-Id: <TELAUDE_USER_ID>
```

| Point de terminaison | Corps | Description |
|----------------------|-------|-------------|
| `POST /mcp/send-photo` | `{ path: string }` | Envoyer un fichier image (chemin absolu) |
| `POST /mcp/send-file` | `{ path: string }` | Envoyer un fichier (chemin absolu) |
| `POST /mcp/send-sticker` | `{ sticker_id: string }` | Envoyer un sticker (file_id Telegram) |
| `POST /mcp/zip-and-send` | `{ dir: string }` | Compresser un répertoire et envoyer l'archive |
| `POST /mcp/ask` | `{ question: string, choices?: string[] }` | Poser une question à l'utilisateur et attendre une réponse |
| `POST /mcp/set-reaction` | `{ emoji: string }` | Définir une réaction emoji sur le message le plus récent de l'utilisateur |
| `POST /mcp/pin-message` | `{}` | Épingler le message le plus récent du bot |
| `POST /mcp/unpin-message` | `{}` | Désépingler le message épinglé |

## Exemples d'utilisation

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

## Conditions d'intégration

- Disponible uniquement depuis les serveurs MCP lancés par les processus Claude Code fonctionnant sous Telaude
- Lors de tests en local sans Telaude, `TELAUDE_API_TOKEN` ne sera pas défini — un repli gracieux est recommandé

```typescript
function isTelaudeAvailable(): boolean {
  return !!(process.env.TELAUDE_API_TOKEN && process.env.TELAUDE_USER_ID);
}
```

## Sécurité

- **Localhost uniquement** : Lié exclusivement à `127.0.0.1` — aucun accès externe possible
- **Tokens d'exécution** : Générés au démarrage du processus Telaude, détruits à la sortie (jamais persistés sur disque)
- Les variables d'environnement existantes des serveurs MCP (par ex. `GOOGLE_API_KEY`) sont préservées
