> Ce document est une traduction française de l'original en anglais. | [English](./ARCHITECTURE.md)

# Architecture de TELAUDE

Pont Telegram Claude Code — un bot qui contrôle à distance le CLI Claude Code depuis Telegram.

## Stack technique

- **Runtime** : Bun (TypeScript, ESM)
- **Framework bot** : grammY + @grammyjs/auto-retry
- **Base de données** : better-sqlite3 (mode WAL)
- **Authentification** : bcrypt (hachage de mot de passe) + chiffrement natif du système (Windows DPAPI / macOS Keychain / Linux)
- **Journalisation** : pino
- **CLI** : Claude Code (`claude -p --output-format stream-json --verbose`)
- **Planificateur** : croner (expressions cron) + setTimeout (ponctuel)
- **MCP** : Serveur MCP intégré (stdio) + API HTTP interne pour l'intégration MCP externe

## Structure des répertoires

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

## Concepts fondamentaux

### Terminologie

| Terme | Définition | Identifiant |
|-------|-----------|-------------|
| **Session** | Conversation JSONL du CLI Claude + métadonnées en base de données | `sessionId` (UUID) |
| **Chapter (Chapitre)** | Unité de thread de Telaude — un utilisateur + un chat + un contexte de thread | `chapterKey` = `userId:chatId:threadId` |
| **UP (UserProcess)** | État du processus en mémoire par chapitre | `processes.get(chapterKey)` |

- Chaque chapitre possède son propre processus CLI, sa session, son répertoire de travail, sa file de messages et ses paramètres
- Plusieurs sessions peuvent être créées/reprises au sein d'un même chapitre
- Les chapitres sont indépendants — la planification, le lancement et la messagerie ne bloquent pas les autres chapitres

### Lancement de processus par message

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

### Interface CLI Claude

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

- **Entrée** : Texte brut via stdin → stdin.end()
- **Sortie** : NDJSON (un événement JSON par ligne)
- **Nettoyage de l'env** : Suppression de `CLAUDECODE`, `CLAUDE_CODE*`, `ANTHROPIC_API_KEY` (prévention de l'imbrication)
- **windowsHide** : true (empêche l'héritage du handle de socket serveur sous Windows)

### Format des événements du flux

```
system   → { type: "system", subtype: "init", session_id, tools: string[] }
assistant → { type: "assistant", message: { content: [{type:"text",...}, {type:"tool_use",...}], usage } }
result   → { type: "result", cost_usd, total_cost_usd, num_turns, duration_ms, session_id, modelUsage }
```

### Stratégie d'affichage Telegram

1. **Appels d'outils** : Message unique avec animation de modification (limitation à 1s)
   - Compteurs en exposant : `🔍² Grep` (le premier outil n'a pas d'exposant)
   - Les outils Agent (sous-agent) sont épinglés en haut, les outils réguliers en bas
2. **Réponse textuelle** : Le message d'outils est supprimé → message séparé avec modifications en streaming
3. **Découpage des messages** : Auto-découpage à 4000 caractères (blocs de code > paragraphes > lignes)
4. **Échec d'analyse HTML** : Repli en texte brut
5. **Animation de compaction** : Points animés à intervalles de 2s, nombre de tokens à la fin

## Architecture Multi-Chapitre

Chaque chapitre (`userId:chatId:threadId`) est entièrement indépendant :

- **UP séparé** : Propre processus CLI, session, répertoire de travail, modèle, file de messages
- **Planification indépendante** : Les tâches cron/poke vérifient le `isProcessing` par chapitre, pas par utilisateur
- **Paramètres indépendants** : Configuration outils/MCP/modèle par chapitre via le TUI (stocké dans settings.json)
- **Restauration de session** : Au redémarrage du bot, les sessions actives en base sont restaurées en tant que UP avec workingDir, model, sessionId
- **Cache d'outils MCP** : Global (partagé entre les chapitres), alimenté par les événements init — le lancement de n'importe quel chapitre met à jour le cache

### Flux des tâches planifiées

```
Cron triggers → check if target chapter is processing
  → Yes: enqueue (same chapter only, other chapters unaffected)
  → No: spawn directly in target chapter's context
    → StreamHandler (silent mode) → collect response
    → On exit: send report to correct thread (message_thread_id)
```

## Panneau de paramètres TUI

Interface à onglets avec navigation au clavier :

```
[Model]  [MCP Servers]  [Base Tools]
─────────────────────────────────────
 (items for selected tab)
```

- **Onglet Model** : Sélection du modèle Claude (sélection radio)
- **Onglet MCP Servers** : Activation/désactivation des serveurs + sous-liste d'outils par serveur
  - Serveur activé : affiche les outils indentés (depuis le cache global de l'événement init)
  - Aucun outil collecté encore : indication "(requires first conversation)"
  - Serveur désactivé : outils masqués
- **Onglet Base Tools** : Outils intégrés (Bash, Read, etc.) + outils MCP Telaude
- **Navigation** : ←→/Tab pour les onglets, ↑↓ pour les éléments, Espace/Entrée pour basculer, Échap pour fermer
- **Persistance** : disabledTools/disabledMcpServers sauvegardés par chapitre dans settings.json

## Schéma de la base de données

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

## Chargement de la configuration

`config.ts` utilise un pattern Proxy pour le chargement paresseux :

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

Cela permet à `setup.ts` de créer le .env → `loadConfig()` → les autres modules accèdent à la config.

## API interne et Intégration MCP externe

Telaude fait tourner un serveur HTTP sur `127.0.0.1:19816` qui expose la messagerie Telegram aux serveurs MCP externes.

**Variables d'env auto-injectées** (via `--mcp-config`) :
- `TELAUDE_API_URL` — Adresse de l'API interne
- `TELAUDE_API_TOKEN` — Token d'authentification à l'exécution (détruit à la sortie)
- `TELAUDE_USER_ID` — Identifiant utilisateur Telegram
- `TELAUDE_CHAT_ID` — Identifiant du chat du chapitre actuel
- `TELAUDE_THREAD_ID` — Identifiant du thread du chapitre actuel

**Le http-client MCP** auto-injecte `_chatId` et `_threadId` dans toutes les requêtes API depuis les variables d'environnement, assurant le routage correct des chapitres.

**Points de terminaison** : send-photo, send-file, send-sticker, zip-and-send, ask, pin/unpin, set-reaction, cron CRUD

## Planificateur et Poke

- **Tâches cron** : Tâches récurrentes via croner, persistées dans un fichier JSON
- **Tâches ponctuelles** : Minuteries à déclenchement unique avec `runAt` (supporte le relatif : "5m", "1h" et l'heure seule : "09:15")
- **Lancement indépendant par chapitre** : Les tâches planifiées ne s'enfilent que lorsque leur chapitre cible est occupé, pas lorsque d'autres chapitres sont actifs
- **Synchronisation du tableau de bord** : `triggerOnChange()` appelé après scheduleJob pour mettre à jour la section Incoming
- **Poke** : Relance automatique quand Claude reste silencieux — injecte du langage naturel dans stdin via `--resume`
- **Heartbeat** : Vérification de santé basée sur HEARTBEAT.md

## Sécurité

- `.env` chiffré avec les API natives du système (Windows DPAPI / macOS Keychain / Linux machine-id+UID)
- L'API interne est liée uniquement à localhost avec suivi des sockets pour un arrêt propre
- Les tokens d'exécution sont générés par processus, jamais persistés
- Validation du chemin de fichier sur toutes les routes send-file/send-photo/zip-and-send
- Hachage du mot de passe par bcrypt avec suivi des tentatives échouées
- `spawn()` utilise `windowsHide: true` pour empêcher l'héritage du handle de socket serveur
- Le rechargement utilise un délai ACK de 500ms avant la sortie pour empêcher la re-livraison des mises à jour grammY

## Aperçu de lien

Détection d'URL → récupération via API proxy → injection de contexte en préfixe dans le stdin de Claude.

| Plateforme | Méthode | Données |
|------------|---------|---------|
| X/Twitter | API fxtwitter | Texte complet, statistiques d'engagement, images, corps de l'article (blocs Draft.js) |
| YouTube | noembed.com | Titre, nom de la chaîne |
| URL générique | Analyse des balises meta OG | Titre, description, nom du site (limite de 50 Ko sur la récupération HTML) |

## Paramètres d'affichage des outils

Configurables via `telaude-mcp-settings.json` (global `~/.telaude/` ou projet `.telaude/`).

- `hidden: true` — masquer des messages d'outils Telegram
- `icon` — Emoji Unicode ou emoji personnalisé Telegram Premium (`emojiId` + `fallback`)
- Les outils MCP sont appariés par suffixe (`mcp__server__tool` → `tool`)
- Rechargement à chaud via comparaison mtime (aucun redémarrage nécessaire)
