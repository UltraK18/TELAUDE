> Ce document est une traduction française de l'original en anglais. | [English](./README.md)

# TELAUDE

Un pont d'orchestration headless open source qui expose de manière sécurisée le CLI Claude Code vers Telegram, transformant les interfaces de messagerie standard en espaces de travail de développement multi-contextes entièrement fonctionnels.

Entièrement construit sur `claude -p` (mode pipe) — exploitant les capacités natives du CLI sans aucun hack de SDK ni API non officielle.

Envoyez un message via Telegram, et le serveur lance un processus `claude -p`, diffusant les résultats en temps réel dans votre conversation.

## Fonctionnalités

### Streaming et Multi-Contexte
- **Streaming en temps réel** — Les réponses de Claude sont diffusées en direct sur Telegram avec des modifications incrémentales
- **Architecture Multi-Chapitre** — Sessions indépendantes par chat/thread (sujets DM, forums de groupe). Chaque chapitre possède son propre processus CLI, sa session, son répertoire de travail et ses paramètres
- **Gestion des sessions** — Reprenez des conversations, listez les sessions, renommez-les et restaurez le contexte précédent
- **Visualisation des appels d'outils** — Voyez quels outils Claude utilise en temps réel, avec des compteurs en exposant, des icônes personnalisées et des indicateurs animés de compaction
- **UX native Telegram** — Les messages d'outils sont automatiquement supprimés à l'arrivée du texte, la compaction affiche des points animés, les réponses longues sont automatiquement découpées aux frontières naturelles (blocs de code > paragraphes > lignes), et les échecs d'analyse HTML basculent gracieusement en texte brut

### Extensibilité et MCP
- **Serveur MCP intégré** — Outils natifs pour la planification, l'envoi de fichiers, les invites utilisateur, et plus encore
- **Intégration MCP externe** — D'autres serveurs MCP peuvent utiliser les capacités de messagerie Telegram de Telaude via l'API HTTP interne
- **Interface d'outils configurable** — La visibilité et les icônes des outils sont entièrement personnalisables via des paramètres globaux ou au niveau du projet

### Flux de travail agentiques proactifs
- **Cron / Planification** — Exécutez des tâches planifiées (cron récurrent ou ponctuel), avec un mode de tâche isolée
- **Poke** — Relance automatique quand Claude reste silencieux (sensible au sommeil, intensité configurable)
- **Heartbeat** — Mécanisme de vérification de l'état de santé pour les tâches planifiées

### Entrée et Contexte
- **Support multimédia** — Photos, documents, audio, vidéo, stickers et notes vocales
- **Support des messages transférés** — Les messages transférés sont collectés et envoyés comme contexte à Claude
- **Aperçu de lien** — Récupération automatique du contexte pour les URLs partagées dans les messages (X/Twitter, YouTube, balises meta OG)
- **Réactions emoji** — Réactions bidirectionnelles (messages utilisateur-vers-bot et bot-vers-utilisateur)

### Surveillance et Contrôle
- **Tableau de bord TUI** — Tableau de bord en terminal à trois colonnes (Logs | Sessions | Planning) avec navigation au clavier uniquement
- **Paramètres par chapitre** — Chaque chapitre possède des paramètres MCP, d'outils et de modèle indépendants via le TUI
- **Utilisation du contexte** — `/context` affiche l'utilisation des tokens en temps réel, les informations sur le modèle et le coût

### Sécurité
- **Chiffrement natif du système d'exploitation** — Protège les secrets du `.env` en utilisant la cryptographie au niveau du système (Windows DPAPI / macOS Keychain / Linux machine-id)
- **Validation des chemins** — Les opérations sur les fichiers sont restreintes aux limites autorisées
- **Authentification** — Défi par mot de passe via `/auth` avant le traitement de toute commande

## Fonctionnement — CLI natif, pas de SDK

TELAUDE n'utilise **pas** le Claude Agent SDK, les API non officielles, ni l'extraction de tokens OAuth. Il lance le CLI officiel `claude -p` en tant que processus enfant et communique via stdin/stdout — de la même manière que vous l'utiliseriez dans un terminal.

```
Telegram message → child_process.spawn('claude', ['-p', ...]) → stdin/stdout → Telegram
```

En s'appuyant sur `-p` (mode pipe), TELAUDE hérite de toutes les fonctionnalités natives du CLI — gestion des sessions, intégration de serveurs MCP, compaction du contexte, permissions des outils, mise en cache des prompts, et plus encore — sans en réimplémenter aucune. Chaque effort est fait pour refléter l'expérience complète du CLI natif à travers Telegram, tout en ajoutant des améliorations UX natives Telegram comme les animations d'outils en temps réel, le découpage intelligent des messages et les claviers en ligne interactifs.

Ceci est important car les [Conditions d'utilisation](https://autonomee.ai/blog/claude-code-terms-of-service-explained/) d'Anthropic interdisent explicitement l'utilisation par des tiers des tokens OAuth d'abonnement avec l'Agent SDK, et ont [activement bloqué](https://autonomee.ai/blog/claude-code-terms-of-service-explained/) les projets qui le font (OpenClaw, OpenCode, Cline, Roo Code, etc.). TELAUDE évite cela entièrement — il appelle le binaire CLI sur votre machine, qui utilise votre authentification Claude Code existante comme prévu.

## Documentation

Pour une utilisation et une configuration détaillées, consultez **[docs/index.md](./docs/index.md)**.

## Démarrage rapide

Assurez-vous que [Bun](https://bun.sh/) est installé.

```bash
# Install dependencies
bun install

# First run (setup wizard guides you through .env creation)
bun run dev
```

L'assistant de configuration vous demandera :
1. Le Token du Bot Telegram (créez-en un avec [@BotFather](https://t.me/BotFather))
2. Le mot de passe d'authentification
3. La vérification du statut d'authentification du CLI Claude

## Commandes

| Commande | Description |
|----------|-------------|
| `/start` | Message de bienvenue du bot |
| `/auth <pw>` | Authentification par mot de passe |
| `/help` | Liste des commandes disponibles |
| `/new` | Démarrer une nouvelle session |
| `/stats` | Informations sur la session + utilisation des tokens |
| `/resume` | Lister les sessions récentes (reprendre / supprimer) |
| `/stop` | Arrêter le traitement en cours |
| `/stop <text>` | Arrêter et envoyer une nouvelle entrée |
| `/rename <name>` | Renommer la session actuelle (synchronisé avec le JSONL de Claude Code) |
| `/compact [instructions]` | Compacter le contexte de conversation |
| `/history` | Afficher les 5 derniers tours de conversation |
| `/cd <path>` | Changer le répertoire de travail |
| `/pwd` | Afficher le répertoire actuel |
| `/projects` | Lister les chemins de projet autorisés |
| `/model [name]` | Voir ou changer le modèle |
| `/budget [amount]` | Voir ou définir le budget de tokens |
| `/context` | Utilisation de la fenêtre de contexte (tokens/modèle/coût) |
| `/schedule` | Voir les tâches planifiées |

## Build et Exécution

```bash
bun run build        # TypeScript build
bun start            # Production
bun run dev          # Development (stdin supported)
bun run dev:watch    # Development (auto-reload, no stdin)
bun run build:exe    # Compile single executable
```

> **Note :** `build:exe` produit actuellement un exécutable Windows. Les builds binaires multi-plateformes (Linux, macOS) sont prévus mais pas encore testés — les contributions et l'aide pour les tests sont les bienvenues.

## Intégration MCP externe

Telaude expose une API HTTP interne qui **permet aux serveurs MCP externes d'envoyer des messages via Telegram**.

Quand Telaude lance un processus Claude CLI, il injecte les variables d'environnement suivantes dans **tous les serveurs MCP externes** via `--mcp-config` :

| Variable | Description |
|----------|-------------|
| `TELAUDE_API_URL` | Adresse de l'API interne (`http://127.0.0.1:19816`) |
| `TELAUDE_API_TOKEN` | Token d'authentification des requêtes (généré à l'exécution) |
| `TELAUDE_USER_ID` | Identifiant utilisateur Telegram |
| `TELAUDE_CHAT_ID` | Identifiant du chat du chapitre actuel (DM = userId, groupe = groupId) |
| `TELAUDE_THREAD_ID` | Identifiant du thread/sujet du chapitre actuel (0 = pas de thread) |

### Points de terminaison disponibles

| Point de terminaison | Corps | Description |
|----------------------|-------|-------------|
| `POST /mcp/send-photo` | `{ path }` | Envoyer un fichier image (chemin absolu) |
| `POST /mcp/send-file` | `{ path }` | Envoyer un fichier (chemin absolu) |
| `POST /mcp/send-sticker` | `{ sticker_id }` | Envoyer un sticker (file_id Telegram) |
| `POST /mcp/zip-and-send` | `{ dir }` | Compresser un répertoire et l'envoyer |
| `POST /mcp/ask` | `{ question, choices? }` | Poser une question à l'utilisateur (prend en charge les choix par clavier en ligne) |
| `POST /mcp/set-reaction` | `{ emoji }` | Réagir au dernier message de l'utilisateur avec un emoji |
| `POST /mcp/pin-message` | `{}` | Épingler le dernier message du bot |
| `POST /mcp/unpin-message` | `{}` | Désépingler le message épinglé |

### Paramètres d'affichage des outils

Configurez la visibilité et les icônes des outils via des fichiers de paramètres. Les paramètres au niveau du projet priment sur les paramètres globaux.

- **Global** : `~/.telaude/telaude-mcp-settings.json`
- **Projet** : `<cwd>/.telaude/telaude-mcp-settings.json` (prioritaire)

```jsonc
{
  "tools": {
    "hidden_tool": { "hidden": true },
    "some_tool": { "icon": "🚀" },
    "fancy_tool": { "icon": { "emojiId": "5206186681346039457", "fallback": "🧑‍🎓" } }
  }
}
```

- `hidden: true` — Masquer l'outil des messages d'appels d'outils Telegram
- `icon` (chaîne) — Remplacer l'icône de l'outil par un emoji Unicode
- `icon` (objet) — Utiliser un emoji personnalisé Telegram Premium (`emojiId` + `fallback`)
- Les outils MCP sont appariés par suffixe (`mcp__server__tool` correspond à `tool`)
- Rechargement à chaud lors de la modification du fichier (aucun redémarrage nécessaire)

### Exemple d'utilisation

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

Telaude injecte automatiquement les variables d'environnement `TELAUDE_*` dans tous les serveurs MCP listés dans `--mcp-config` lors du lancement du CLI Claude. Les variables d'environnement propres à chaque serveur MCP (par ex. `GOOGLE_API_KEY`) sont préservées. Pour une utilisation locale autonome sans Telaude, implémentez un repli gracieux en utilisant `isTelaudeAvailable()`.

## Architecture

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

## Contribuer

TELAUDE est entièrement open source. Les contributions, rapports de bugs et tests multi-plateformes sont les bienvenus — en particulier pour :
- **Builds binaires macOS / Linux** — `build:exe` est actuellement réservé à Windows
- **Intégration macOS Keychain** — Le chiffrement natif du système nécessite des tests sur un appareil réel
- **Compatibilité des terminaux** — Problèmes de saisie TUI sur les terminaux non-Windows (macOS, Termux)

## Licence

MIT

---

*TELAUDE a été 100% construit en utilisant Claude Code via Telegram — développé entièrement via le système qu'il crée.*
