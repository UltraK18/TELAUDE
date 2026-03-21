> Este documento es una traducción al español del original en inglés. | [English](./tool-display-settings.md)

# Configuración de Visualización de Herramientas

Configura la visibilidad e iconos de los mensajes de llamadas a herramientas mostrados en Telegram.

## Archivos de Configuración

La configuración a nivel de proyecto tiene prioridad sobre la configuración global.

- **Global**: `~/.telaude/telaude-mcp-settings.json`
- **Proyecto**: `<cwd>/.telaude/telaude-mcp-settings.json` (tiene prioridad)

```jsonc
{
  "tools": {
    "tool_name": { "hidden": true },
    "other_tool": { "icon": "🚀" },
    "fancy_tool": { "icon": { "emojiId": "5206186681346039457", "fallback": "🧑‍🎓" } }
  }
}
```

## Opciones

### hidden

Establece a `true` para ocultar las invocaciones de la herramienta del mensaje de herramientas en Telegram.

```jsonc
{ "hidden": true }
```

### icon (Emoji Unicode)

Cambia el icono de la herramienta a un emoji Unicode estándar.

```jsonc
{ "icon": "🚀" }
```

### icon (Emoji Personalizado Premium)

Usa un emoji personalizado Premium de Telegram (incluyendo emoji animados).

- `emojiId`: ID de emoji personalizado de Telegram
- `fallback`: Emoji Unicode mostrado para clientes no-Premium

```jsonc
{ "icon": { "emojiId": "5206186681346039457", "fallback": "🧑‍🎓" } }
```

### hidden + icon

Ambos se pueden establecer simultáneamente. Si `hidden: true`, el icono se ignora.

## Emparejamiento de Herramientas MCP

Las herramientas MCP se emparejan por sufijo:

- Configurar `"ask"` en la configuración coincide tanto con `mcp__telaude__ask` como con `mcp__other__ask`
- También se pueden usar nombres exactos como `"mcp__telaude__ask"` (la coincidencia exacta tiene prioridad)

## Comportamiento de Recarga en Caliente

- Las configuraciones se **recargan en caliente** al cambiar el archivo (detectado vía comparación de mtime, no requiere reinicio)
- Cuando el directorio de trabajo (cwd) cambia, la configuración a nivel de proyecto se re-detecta automáticamente

## Manejo de Errores

- **Archivo no encontrado** — recurre al comportamiento predeterminado (todas las herramientas visibles, iconos integrados usados)
- **Error de parseo JSON** — registra una advertencia, recurre al comportamiento predeterminado
- **Clave `tools` faltante o inválida** — recurre al comportamiento predeterminado
