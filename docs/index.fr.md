> Ce document est une traduction française de l'original en anglais. | [English](./index.md)

# Documentation de Telaude

## Guides

| Document | Description |
|----------|-------------|
| [Intégration MCP externe](./external-mcp-integration.fr.md) | Comment les serveurs MCP externes peuvent utiliser les capacités de messagerie Telegram de Telaude |
| [Paramètres d'affichage des outils](./tool-display-settings.fr.md) | Masquer des outils ou personnaliser les icônes (global/niveau projet, rechargement à chaud) |

## Emplacements des fichiers de configuration

Les fichiers de configuration et les données de Telaude sont stockés dans des répertoires dédiés qui **ne sont pas suivis par git**.

### Répertoire global (`~/.telaude/`)

Situé sous le répertoire personnel de l'utilisateur du système. Ces paramètres s'appliquent à tous les projets. Comme ils ne sont pas suivis par git, ils doivent être créés manuellement sur chaque instance.

| Chemin | Description |
|--------|-------------|
| `~/.telaude/data/settings.json` | Paramètres hiérarchiques V2 (par répertoire de travail + par chapitre) |
| `~/.telaude/data/bot.log` | Fichier de journalisation du bot |
| `~/.telaude/data/sticker-cache/` | Cache de miniatures JPG des stickers |
| `~/.telaude/telaude-mcp-settings.json` | Paramètres globaux d'affichage des outils (masqué/icône) |
| `~/.telaude/allowed_project_roots.json` | Chemins autorisés pour la commande `/cd` (pas de fichier = aucune restriction) |

### Répertoire du projet (`.telaude/`)

Situé sous chaque répertoire de travail Claude (cwd). Ces paramètres s'appliquent uniquement à ce projet spécifique.

| Chemin | Description |
|--------|-------------|
| `.telaude/telaude-mcp-settings.json` | Paramètres d'affichage des outils au niveau projet (priment sur le global) |
| `.telaude/POKE.md` | Configuration du poke (relance automatique quand Claude reste silencieux) |
| `.telaude/HEARTBEAT.md` | Fichier d'état heartbeat (vérification de santé pour les tâches planifiées) |

> Le répertoire `.telaude/` est inclus dans `.gitignore` et n'est pas suivi par git. Configurez-le indépendamment sur chaque instance.

#### allowed_project_roots.json

Restreint les chemins auxquels la commande `/cd` peut naviguer. Si le fichier n'existe pas, tous les chemins sont autorisés.

```json
[
  "/home/user/projects",
  "/home/user/work"
]
```

Exemple Windows :
```json
[
  "C:\\Users\\user\\projects",
  "C:\\work"
]
```

### Autres fichiers de données

| Chemin | Description |
|--------|-------------|
| `~/.telaude/.env` | Token du bot, hash du mot de passe, etc. — chiffré avec le chiffrement natif du système |
| `~/.telaude/data/telaude.db` | Base de données SQLite (sessions, planifications, etc.) — exclu de git |
| `user_send/` | Stockage temporaire pour les fichiers téléversés par l'utilisateur — exclu de git |

## Configuration et Authentification

### Premier lancement

L'exécution de `bun run dev` lance automatiquement l'assistant de configuration, qui vous guide à travers les étapes suivantes :

1. **Token du Bot Telegram** — obtenez-en un auprès de [@BotFather](https://t.me/BotFather)
2. **Mot de passe d'authentification** — définissez un mot de passe pour l'accès au bot
3. **Statut d'authentification du CLI Claude** — vérifie si le CLI est authentifié (vous invite à exécuter `claude` sinon)

Une fois toutes les informations fournies, un fichier `.env` est automatiquement généré et le bot démarre.

> **Vous n'avez pas besoin de modifier manuellement le fichier `.env`.** L'assistant le crée, et le mot de passe est protégé de manière sécurisée en interne.

### Authentification du bot

Après le démarrage du bot, envoyez `/auth <password>` dans Telegram pour vous authentifier. Une fois authentifié, toutes les commandes Claude deviennent disponibles.

### Variables d'environnement (.env)

Variables requises (créées par l'assistant de configuration) :

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Token du bot émis par BotFather |
| `AUTH_PASSWORD` | Mot de passe d'authentification du bot Telegram (stocké en hash bcrypt) |

Variables optionnelles :

| Variable | Défaut | Description |
|----------|--------|-------------|
| `ALLOWED_TELEGRAM_IDS` | (aucun, tout le monde autorisé) | Identifiants utilisateur Telegram autorisés (séparés par des virgules) |
| `CHAT_ID` | Auto-détecté | Identifiant du chat pour les notifications du bot (auto-sauvegardé à l'authentification) |
| `CLAUDE_CLI_PATH` | `claude` | Chemin vers l'exécutable du CLI Claude |
| `DEFAULT_MODEL` | `default` | Modèle Claude par défaut (défaut natif du CLI) |
| `DEFAULT_MAX_BUDGET_USD` | `5.0` | Limite budgétaire par défaut (USD) |
| `DEFAULT_MAX_TURNS` | `50` | Nombre maximum de tours par défaut |
| `DEFAULT_WORKING_DIR` | Répertoire actuel | Répertoire de travail par défaut |
| `SESSION_IDLE_TIMEOUT_MS` | `1800000` | Délai d'inactivité de la session (ms) |
| `STREAM_UPDATE_INTERVAL_MS` | `500` | Intervalle de mise à jour du streaming (ms) |
| `STREAM_UPDATE_MIN_CHARS` | `200` | Caractères minimum avant la mise à jour du streaming |
| `MCP_INTERNAL_API_PORT` | `19816` | Port de l'API MCP interne |
| `LOG_LEVEL` | `info` | Niveau de journalisation |

### Sécurité

Telaude protège l'intégralité du fichier `.env` avec le chiffrement natif du système (Windows DPAPI / macOS Keychain / Linux). Le déchiffrement est impossible sans accès au même compte utilisateur du système.

## Points de terminaison de l'API MCP interne

Les serveurs MCP fonctionnant sous les processus Claude lancés par Telaude peuvent utiliser l'API HTTP interne (`http://127.0.0.1:19816`) pour envoyer des messages via Telegram.

En-têtes d'authentification :

```
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
| `POST /mcp/pin-message` | `{}` | Épingler le message le plus récent du bot |
| `POST /mcp/unpin-message` | `{}` | Désépingler le message épinglé |
| `POST /mcp/set-reaction` | `{ emoji: string }` | Définir une réaction emoji sur le message de l'utilisateur |

Les variables d'environnement `TELAUDE_API_URL`, `TELAUDE_API_TOKEN`, `TELAUDE_USER_ID`, `TELAUDE_CHAT_ID` et `TELAUDE_THREAD_ID` sont automatiquement injectées par Telaude via `--mcp-config` lors du lancement du CLI Claude. Voir [Intégration MCP externe](./external-mcp-integration.fr.md) pour les détails.
