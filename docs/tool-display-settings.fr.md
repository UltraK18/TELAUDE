> Ce document est une traduction française de l'original en anglais. | [English](./tool-display-settings.md)

# Paramètres d'affichage des outils

Configurez la visibilité et les icônes des messages d'appels d'outils affichés dans Telegram.

## Fichiers de configuration

Les paramètres au niveau du projet priment sur les paramètres globaux.

- **Global** : `~/.telaude/telaude-mcp-settings.json`
- **Projet** : `<cwd>/.telaude/telaude-mcp-settings.json` (prioritaire)

```jsonc
{
  "tools": {
    "tool_name": { "hidden": true },
    "other_tool": { "icon": "🚀" },
    "fancy_tool": { "icon": { "emojiId": "5206186681346039457", "fallback": "🧑‍🎓" } }
  }
}
```

## Options

### hidden

Définir à `true` pour masquer les invocations de l'outil dans le message d'outils Telegram.

```jsonc
{ "hidden": true }
```

### icon (Emoji Unicode)

Changer l'icône de l'outil en un emoji Unicode standard.

```jsonc
{ "icon": "🚀" }
```

### icon (Emoji personnalisé Premium)

Utiliser un emoji personnalisé Telegram Premium (y compris les emojis animés).

- `emojiId` : Identifiant de l'emoji personnalisé Telegram
- `fallback` : Emoji Unicode affiché pour les clients non-Premium

```jsonc
{ "icon": { "emojiId": "5206186681346039457", "fallback": "🧑‍🎓" } }
```

### hidden + icon

Les deux peuvent être définis simultanément. Si `hidden: true`, l'icône est ignorée.

## Correspondance des outils MCP

Les outils MCP sont appariés par suffixe :

- Le paramètre `"ask"` dans la configuration correspond à la fois à `mcp__telaude__ask` et à `mcp__other__ask`
- Les noms exacts comme `"mcp__telaude__ask"` peuvent aussi être utilisés (la correspondance exacte est prioritaire)

## Comportement du rechargement à chaud

- Les paramètres sont **rechargés à chaud** lors des modifications de fichiers (détectées par comparaison mtime, aucun redémarrage nécessaire)
- Quand le répertoire de travail (cwd) change, les paramètres au niveau du projet sont automatiquement re-détectés

## Gestion des erreurs

- **Fichier non trouvé** — repli vers le comportement par défaut (tous les outils visibles, icônes intégrées utilisées)
- **Erreur d'analyse JSON** — journalise un avertissement, repli vers le comportement par défaut
- **Clé `tools` manquante ou invalide** — repli vers le comportement par défaut
