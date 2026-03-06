import blessed from 'blessed';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadSettings, saveSettings, type TelaudeSettings } from './settings-store.js';
import { config } from '../config.js';

/** Known built-in tools that can be toggled */
const BUILTIN_TOOLS = [
  'Bash',
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  'NotebookEdit',
];

/** Telaude's own MCP tools — toggled via --disallowedTools with mcp__telaude__ prefix */
const TELAUDE_MCP_TOOLS = [
  'send_file',
  'send_photo',
  'send_sticker',
  'ask',
  'zip_and_send',
  'set_reaction',
  'pin_message',
  'unpin_message',
  'schedule_add',
  'schedule_list',
  'schedule_update',
  'schedule_remove',
  'schedule_pause',
  'schedule_resume',
  'schedule_history',
  'schedule_completed',
  'schedule_nothing_to_report',
  'get_system_info',
  'reload',
  'poke_ok',
];

/** Built-in MCPs provided by Claude service (not in config files) */
const BUILTIN_MCPS = [
  'claude.ai Gmail',
  'claude.ai Google Calendar',
  'plugin:figma:figma',
];

/** Read MCP servers dynamically: telaude + config files + built-in */
function getMcpServers(): string[] {
  const servers = ['telaude'];
  const sources = [
    path.join(os.homedir(), '.claude.json'),
    path.join(os.homedir(), '.claude', 'settings.json'),
  ];
  for (const src of sources) {
    try {
      if (fs.existsSync(src)) {
        const raw = JSON.parse(fs.readFileSync(src, 'utf-8'));
        if (raw.mcpServers) {
          for (const name of Object.keys(raw.mcpServers)) {
            if (!servers.includes(name)) servers.push(name);
          }
        }
      }
    } catch {
      // ignore parse errors
    }
  }
  for (const name of BUILTIN_MCPS) {
    if (!servers.includes(name)) servers.push(name);
  }
  return servers;
}

/** Available models */
const MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-haiku-4-5-20251001',
];

interface MenuItem {
  label: string;
  type: 'toggle' | 'select';
  category: 'mcp' | 'tool' | 'telaude-tool' | 'model';
  key: string; // server/tool name or model id
}

function buildMenuItems(settings: TelaudeSettings, mcpServers: string[]): MenuItem[] {
  const items: MenuItem[] = [];

  // MCP Servers section
  for (const srv of mcpServers) {
    items.push({ label: srv, type: 'toggle', category: 'mcp', key: srv });
  }

  // Telaude MCP Tools section
  for (const tool of TELAUDE_MCP_TOOLS) {
    items.push({ label: tool, type: 'toggle', category: 'telaude-tool', key: `mcp__telaude__${tool}` });
  }

  // Tools section
  for (const tool of BUILTIN_TOOLS) {
    items.push({ label: tool, type: 'toggle', category: 'tool', key: tool });
  }

  // Model section
  for (const m of MODELS) {
    items.push({ label: m, type: 'select', category: 'model', key: m });
  }

  return items;
}

function formatLine(item: MenuItem, settings: TelaudeSettings, selected: boolean): string {
  const cursor = selected ? '{bold}{white-fg}>{/white-fg}{/bold} ' : '  ';

  if (item.type === 'toggle') {
    const disabled = item.category === 'mcp'
      ? settings.disabledMcpServers.includes(item.key)
      : settings.disabledTools.includes(item.key); // works for both 'tool' and 'telaude-tool'
    const icon = disabled
      ? '{red-fg}○{/red-fg}'
      : '{green-fg}●{/green-fg}';
    return `${cursor}${icon} ${item.label}`;
  }

  // model select — match full name or alias (e.g. "sonnet" matches "claude-sonnet-4-6")
  const current = settings.model ?? config.claude.defaultModel;
  const isActive = item.key === current || item.key.includes(current);
  const icon = isActive
    ? '{green-fg}◉{/green-fg}'
    : '{gray-fg}○{/gray-fg}';
  return `${cursor}${icon} ${item.label}`;
}

export function openSettingsScreen(screen: blessed.Widgets.Screen): void {
  let settings = loadSettings();
  const mcpServers = getMcpServers();
  const items = buildMenuItems(settings, mcpServers);
  let selectedIdx = 0;

  // Find section boundaries for headers
  const mcpStart = 0;
  const telaudeToolStart = mcpServers.length;
  const toolStart = telaudeToolStart + TELAUDE_MCP_TOOLS.length;
  const modelStart = toolStart + BUILTIN_TOOLS.length;

  const overlay = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: '60%',
    height: '80%',
    label: ' Settings (↑↓ Navigate, Space/Enter Toggle, Esc Close) ',
    tags: true,
    border: { type: 'line' },
    style: {
      border: { fg: 208 },
      bg: 'black',
    },
    padding: { left: 2, right: 2, top: 1 },
    keys: true,
    vi: false,
  });

  function render(): void {
    const lines: string[] = [];

    lines.push('{bold}{208-fg}MCP Servers{/208-fg}{/bold}');
    for (let i = mcpStart; i < telaudeToolStart; i++) {
      lines.push(formatLine(items[i], settings, i === selectedIdx));
    }

    lines.push('');
    lines.push('{bold}{208-fg}Telaude Tools{/208-fg}{/bold}');
    for (let i = telaudeToolStart; i < toolStart; i++) {
      lines.push(formatLine(items[i], settings, i === selectedIdx));
    }

    lines.push('');
    lines.push('{bold}{208-fg}Claude Tools{/208-fg}{/bold}');
    for (let i = toolStart; i < modelStart; i++) {
      lines.push(formatLine(items[i], settings, i === selectedIdx));
    }

    lines.push('');
    lines.push('{bold}{208-fg}Model{/208-fg}{/bold}');
    for (let i = modelStart; i < items.length; i++) {
      lines.push(formatLine(items[i], settings, i === selectedIdx));
    }

    overlay.setContent(lines.join('\n'));
    screen.render();
  }

  function toggle(): void {
    const item = items[selectedIdx];
    if (item.type === 'toggle') {
      if (item.category === 'mcp') {
        const idx = settings.disabledMcpServers.indexOf(item.key);
        if (idx >= 0) settings.disabledMcpServers.splice(idx, 1);
        else settings.disabledMcpServers.push(item.key);
      } else { // 'tool' and 'telaude-tool' both use disabledTools
        const idx = settings.disabledTools.indexOf(item.key);
        if (idx >= 0) settings.disabledTools.splice(idx, 1);
        else settings.disabledTools.push(item.key);
      }
    } else if (item.type === 'select') {
      settings.model = item.key;
    }
    saveSettings(settings);
    render();
  }

  let active = true;

  function onKey(_ch: string, key: blessed.Widgets.Events.IKeyEventArg): void {
    if (!active) return;
    if (key.name === 'escape' || key.name === 'q') {
      active = false;
      overlay.detach();
      screen.render();
      return;
    }
    if (key.name === 'up' || key.name === 'k') {
      selectedIdx = (selectedIdx - 1 + items.length) % items.length;
      render();
    } else if (key.name === 'down' || key.name === 'j') {
      selectedIdx = (selectedIdx + 1) % items.length;
      render();
    } else if (key.name === 'space' || key.name === 'return') {
      toggle();
    }
  }

  screen.on('keypress', onKey);

  render();
  overlay.focus();
}
