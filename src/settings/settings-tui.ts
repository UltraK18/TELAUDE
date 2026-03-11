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

/** Build a flat line list with section headers interleaved, mapping each item line to an item index */
interface LineEntry {
  text: string;        // rendered blessed markup
  itemIdx: number | null; // null = header/spacer
}

function buildLines(items: MenuItem[], settings: TelaudeSettings, selectedIdx: number, mcpServers: string[]): LineEntry[] {
  const lines: LineEntry[] = [];
  const telaudeToolStart = mcpServers.length;
  const toolStart = telaudeToolStart + TELAUDE_MCP_TOOLS.length;
  const modelStart = toolStart + BUILTIN_TOOLS.length;

  const pushHeader = (label: string) => {
    lines.push({ text: `{bold}{208-fg}${label}{/208-fg}{/bold}`, itemIdx: null });
  };
  const pushSpacer = () => {
    lines.push({ text: '', itemIdx: null });
  };

  pushHeader('MCP Servers');
  for (let i = 0; i < telaudeToolStart; i++) {
    lines.push({ text: formatLine(items[i], settings, i === selectedIdx), itemIdx: i });
  }

  pushSpacer();
  pushHeader('Telaude Tools');
  for (let i = telaudeToolStart; i < toolStart; i++) {
    lines.push({ text: formatLine(items[i], settings, i === selectedIdx), itemIdx: i });
  }

  pushSpacer();
  pushHeader('Claude Tools');
  for (let i = toolStart; i < modelStart; i++) {
    lines.push({ text: formatLine(items[i], settings, i === selectedIdx), itemIdx: i });
  }

  pushSpacer();
  pushHeader('Model');
  for (let i = modelStart; i < items.length; i++) {
    lines.push({ text: formatLine(items[i], settings, i === selectedIdx), itemIdx: i });
  }

  return lines;
}

export function openSettingsScreen(screen: blessed.Widgets.Screen): void {
  let settings = loadSettings();
  const mcpServers = getMcpServers();
  const items = buildMenuItems(settings, mcpServers);
  let selectedIdx = 0;
  let scrollTop = 0; // top line index in the viewport

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

  function getViewportHeight(): number {
    // height minus borders (2) minus padding top (1) minus scrollbar hint line (1)
    const h = (overlay.height as number) - 4;
    return Math.max(1, h);
  }

  function render(): void {
    const lines = buildLines(items, settings, selectedIdx, mcpServers);
    const vh = getViewportHeight();
    const totalLines = lines.length;

    // Find the line index of the selected item to keep it visible
    const selectedLineIdx = lines.findIndex((l) => l.itemIdx === selectedIdx);
    if (selectedLineIdx >= 0) {
      if (selectedLineIdx < scrollTop) {
        scrollTop = selectedLineIdx;
      } else if (selectedLineIdx >= scrollTop + vh) {
        scrollTop = selectedLineIdx - vh + 1;
      }
    }
    scrollTop = Math.max(0, Math.min(scrollTop, Math.max(0, totalLines - vh)));

    const visible = lines.slice(scrollTop, scrollTop + vh).map((l) => l.text);

    // Scroll indicator line
    const canScrollUp = scrollTop > 0;
    const canScrollDown = scrollTop + vh < totalLines;
    let scrollHint = '';
    if (canScrollUp && canScrollDown) scrollHint = '{gray-fg}↑↓ more{/gray-fg}';
    else if (canScrollUp) scrollHint = '{gray-fg}↑ more above{/gray-fg}';
    else if (canScrollDown) scrollHint = '{gray-fg}↓ more below{/gray-fg}';

    if (scrollHint) visible.push(scrollHint);

    overlay.setContent(visible.join('\n'));
    screen.render();
  }

  function toggle(): void {
    const item = items[selectedIdx];
    if (item.type === 'toggle') {
      if (item.category === 'mcp') {
        const idx = settings.disabledMcpServers.indexOf(item.key);
        if (idx >= 0) settings.disabledMcpServers.splice(idx, 1);
        else settings.disabledMcpServers.push(item.key);
      } else {
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
    } else if (key.name === 'pageup') {
      selectedIdx = Math.max(0, selectedIdx - getViewportHeight());
      render();
    } else if (key.name === 'pagedown') {
      selectedIdx = Math.min(items.length - 1, selectedIdx + getViewportHeight());
      render();
    } else if (key.name === 'home' || (key.name === 'g' && !key.shift)) {
      selectedIdx = 0;
      render();
    } else if (key.name === 'end' || (key.name === 'g' && key.shift)) {
      selectedIdx = items.length - 1;
      render();
    } else if (key.name === 'space' || key.name === 'return') {
      toggle();
    }
  }

  screen.on('keypress', onKey);

  render();
  overlay.focus();
}
