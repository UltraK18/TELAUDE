import blessed from 'blessed';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { type TelaudeSettings, loadSettingsV2, saveSettingsV2 } from './settings-store.js';
import { config } from '../config.js';
import { setSettingsOpen, getSessionDir } from '../utils/dashboard.js';
import { getUserProcessBySessionKey, getMcpToolCache } from '../claude/process-manager.js';
import { MODEL_OPTIONS } from '../bot/commands/model.js';

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
  // 'send_sticker', // disabled: route kept for external MCP (e.g. Yvonne)
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
  'poke_ok',
];

/** Built-in MCPs provided by Claude service (not in config files) */
const BUILTIN_MCPS = [
  'claude.ai Gmail',
  'claude.ai Google Calendar',
  'plugin:figma:figma',
];

/** Read MCP servers dynamically: config files + built-in (telaude excluded — managed via Base Tools tab) */
function getMcpServers(): string[] {
  const servers: string[] = [];
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

function getWorkingDirForSession(chapterKey: string): string {
  return getSessionDir(chapterKey) ?? chapterKey;
}

// ── Tab definitions ──

type TabId = 'model' | 'mcp' | 'tools';

interface Tab {
  id: TabId;
  label: string;
}

const TABS: Tab[] = [
  { id: 'model', label: 'Model' },
  { id: 'mcp',   label: 'MCP Servers' },
  { id: 'tools', label: 'Base Tools' },
];

// ── Menu items ──

interface MenuItem {
  label: string;
  type: 'toggle' | 'select';
  category: 'mcp' | 'mcp-tool' | 'tool' | 'telaude-tool' | 'model' | 'effort';
  key: string;
}

const EFFORT_OPTIONS = [
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High (default)', value: 'high' },
  { label: 'Max', value: 'max' },
];

/** Group external MCP tools by server name */
function groupToolsByServer(tools: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const fullName of tools) {
    const parts = fullName.slice(5).split('__'); // remove "mcp__"
    if (parts.length < 2) continue;
    const server = parts[0];
    const tool = parts.slice(1).join('__');
    if (!groups.has(server)) groups.set(server, []);
    groups.get(server)!.push(tool);
  }
  return groups;
}

function buildTabItems(tabId: TabId, mcpServers: string[], externalMcpTools: string[], settings: TelaudeSettings): MenuItem[] {
  const items: MenuItem[] = [];
  switch (tabId) {
    case 'model':
      for (const m of MODEL_OPTIONS) {
        items.push({ label: m.label, type: 'select', category: 'model', key: m.value });
      }
      for (const e of EFFORT_OPTIONS) {
        items.push({ label: e.label, type: 'select', category: 'effort', key: e.value });
      }
      break;
    case 'mcp':
      for (const srv of mcpServers) {
        items.push({ label: srv, type: 'toggle', category: 'mcp', key: srv });
        // If server is enabled, show its tools indented
        const isDisabled = settings.disabledMcpServers.includes(srv);
        if (!isDisabled) {
          const serverTools = externalMcpTools.filter(t => t.startsWith(`mcp__${srv}__`));
          for (const fullName of serverTools) {
            const toolName = fullName.slice(5 + srv.length + 2); // remove "mcp__server__"
            items.push({ label: toolName, type: 'toggle', category: 'mcp-tool', key: fullName });
          }
        }
      }
      break;
    case 'tools':
      // Built-in tools
      for (const tool of BUILTIN_TOOLS) {
        items.push({ label: tool, type: 'toggle', category: 'tool', key: tool });
      }
      // Telaude MCP tools
      for (const tool of TELAUDE_MCP_TOOLS) {
        items.push({ label: tool, type: 'toggle', category: 'telaude-tool', key: `mcp__telaude__${tool}` });
      }
      break;
  }
  return items;
}

function formatLine(item: MenuItem, settings: TelaudeSettings, selected: boolean): string {
  const cursor = selected ? '{bold}{white-fg}>{/white-fg}{/bold} ' : '  ';

  if (item.type === 'toggle') {
    const disabled = item.category === 'mcp'
      ? settings.disabledMcpServers.includes(item.key)
      : settings.disabledTools.includes(item.key); // works for tool, telaude-tool, mcp-tool
    const icon = disabled
      ? '{red-fg}○{/red-fg}'
      : '{green-fg}●{/green-fg}';
    // Indent MCP tools under their server
    const indent = item.category === 'mcp-tool' ? '    ' : '';
    return `${cursor}${indent}${icon} ${item.label}`;
  }

  if (item.category === 'effort') {
    const currentEffort = settings.effort ?? 'high';
    const isActive = item.key === currentEffort;
    const icon = isActive
      ? '{green-fg}◉{/green-fg}'
      : '{gray-fg}○{/gray-fg}';
    return `${cursor}${icon} ${item.label}`;
  }

  // model select
  const current = settings.model ?? config.claude.defaultModel;
  const isActive = item.key === current;
  const icon = isActive
    ? '{green-fg}◉{/green-fg}'
    : '{gray-fg}○{/gray-fg}';
  return `${cursor}${icon} ${item.label}`;
}

// ── Content lines for the active tab ──

interface LineEntry {
  text: string;
  itemIdx: number | null;
}

function buildContentLines(items: MenuItem[], settings: TelaudeSettings, selectedIdx: number, tabId: TabId, mcpServers: string[], externalMcpTools: string[]): LineEntry[] {
  const lines: LineEntry[] = [];

  const pushHeader = (label: string) => {
    lines.push({ text: `{bold}{208-fg}${label}{/208-fg}{/bold}`, itemIdx: null });
  };
  const pushSpacer = () => {
    lines.push({ text: '', itemIdx: null });
  };

  if (tabId === 'tools') {
    const builtinEnd = BUILTIN_TOOLS.length;
    // Built-in tools section
    pushHeader('Built-in');
    for (let i = 0; i < builtinEnd; i++) {
      lines.push({ text: formatLine(items[i], settings, i === selectedIdx), itemIdx: i });
    }
    // Telaude tools section
    pushSpacer();
    pushHeader('Telaude');
    for (let i = builtinEnd; i < items.length; i++) {
      lines.push({ text: formatLine(items[i], settings, i === selectedIdx), itemIdx: i });
    }
  } else if (tabId === 'mcp') {
    // MCP servers with inline tool sub-lists
    let itemIdx = 0;
    for (const srv of mcpServers) {
      // Server toggle line
      lines.push({ text: formatLine(items[itemIdx], settings, itemIdx === selectedIdx), itemIdx });
      itemIdx++;
      // If enabled, show tools or hint
      const isDisabled = settings.disabledMcpServers.includes(srv);
      if (!isDisabled) {
        const serverTools = externalMcpTools.filter(t => t.startsWith(`mcp__${srv}__`));
        if (serverTools.length > 0) {
          for (const _ of serverTools) {
            lines.push({ text: formatLine(items[itemIdx], settings, itemIdx === selectedIdx), itemIdx });
            itemIdx++;
          }
        } else {
          // No tools collected yet
          lines.push({ text: '      {gray-fg}(requires first conversation){/gray-fg}', itemIdx: null });
        }
      }
    }
  } else if (tabId === 'model') {
    // Model section
    pushHeader('Model');
    const modelEnd = MODEL_OPTIONS.length;
    for (let i = 0; i < modelEnd; i++) {
      lines.push({ text: formatLine(items[i], settings, i === selectedIdx), itemIdx: i });
    }
    // Effort section
    pushSpacer();
    pushHeader('Effort');
    for (let i = modelEnd; i < items.length; i++) {
      lines.push({ text: formatLine(items[i], settings, i === selectedIdx), itemIdx: i });
    }
  }

  return lines;
}

// ── Tab bar rendering ──

function renderTabBar(activeTabId: TabId, focusOnTabs: boolean): string[] {
  const row = TABS.map(t => {
    if (t.id === activeTabId) {
      if (focusOnTabs) {
        return `{bold}{black-fg}{208-bg} ${t.label} {/208-bg}{/black-fg}{/bold}`;
      }
      return `{bold}{208-fg}[${t.label}]{/208-fg}{/bold}`;
    }
    return `{gray-fg} ${t.label} {/gray-fg}`;
  }).join('  ');

  return [row, '{gray-fg}─────────────────────────────────────{/gray-fg}'];
}

// ── Main ──

export function openSettingsScreen(screen: blessed.Widgets.Screen, chapterKey?: string): void {
  if (!chapterKey) return;
  const editKey = chapterKey;
  setSettingsOpen(true);

  // Load session-specific settings from V2 store
  const v2 = loadSettingsV2();
  const projKey = getWorkingDirForSession(editKey);
  const proj = v2.projects[projKey] ?? { disabledTools: [], disabledMcpServers: [] };
  const sess = v2.sessions[editKey];
  let settings: TelaudeSettings = {
    disabledTools: [...proj.disabledTools],
    disabledMcpServers: [...proj.disabledMcpServers],
    model: sess?.model ?? null,
    effort: sess?.effort ?? null,
  };

  const mcpServers = getMcpServers();
  // Merge: global cache (shared across chapters) + previously toggled tools from settings
  const allTools = new Set<string>();
  for (const [, tools] of getMcpToolCache()) {
    for (const t of tools) allTools.add(t);
  }
  for (const key of settings.disabledTools) {
    if (key.startsWith('mcp__') && !key.startsWith('mcp__telaude__')) {
      allTools.add(key);
    }
  }
  const externalMcpTools = [...allTools];

  // Tab state
  let activeTabIdx = 0; // index into TABS
  let focusOnTabs = false; // true = navigating tab bar, false = navigating items
  const tabSelectedIdx: Record<TabId, number> = { model: 0, mcp: 0, tools: 0 };
  let scrollTop = 0;

  function activeTab(): Tab { return TABS[activeTabIdx]; }
  function activeItems(): MenuItem[] { return buildTabItems(activeTab().id, mcpServers, externalMcpTools, settings); }

  const overlay = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: '60%',
    height: '80%',
    label: ` Settings [${editKey}] `,
    tags: true,
    border: { type: 'line' },
    style: {
      border: { fg: 208 },
      bg: 'black',
    },
    padding: { left: 2, right: 2, top: 0 },
    keys: true,
    vi: false,
  });

  function getViewportHeight(): number {
    // height minus borders (2) minus tab bar (2 lines) minus scroll hint (1)
    const h = (overlay.height as number) - 5;
    return Math.max(1, h);
  }

  function render(): void {
    const tab = activeTab();
    const items = activeItems();
    const selIdx = tabSelectedIdx[tab.id];
    const lines = buildContentLines(items, settings, selIdx, tab.id, mcpServers, externalMcpTools);
    const vh = getViewportHeight();
    const totalLines = lines.length;

    // Keep selected item visible
    const selectedLineIdx = lines.findIndex((l) => l.itemIdx === selIdx);
    if (selectedLineIdx >= 0) {
      if (selectedLineIdx < scrollTop) {
        scrollTop = selectedLineIdx;
      } else if (selectedLineIdx >= scrollTop + vh) {
        scrollTop = selectedLineIdx - vh + 1;
      }
    }
    scrollTop = Math.max(0, Math.min(scrollTop, Math.max(0, totalLines - vh)));

    const visible = lines.slice(scrollTop, scrollTop + vh).map((l) => l.text);

    // Scroll indicator
    const canScrollUp = scrollTop > 0;
    const canScrollDown = scrollTop + vh < totalLines;
    let scrollHint = '';
    if (canScrollUp && canScrollDown) scrollHint = '{gray-fg}↑↓ more{/gray-fg}';
    else if (canScrollUp) scrollHint = '{gray-fg}↑ more above{/gray-fg}';
    else if (canScrollDown) scrollHint = '{gray-fg}↓ more below{/gray-fg}';

    if (scrollHint) visible.push(scrollHint);

    // Compose: tab bar + content
    const tabBar = renderTabBar(tab.id, focusOnTabs);
    const output = [...tabBar, ...visible];

    overlay.setContent(output.join('\n'));
    screen.render();
  }

  function toggle(): void {
    const tab = activeTab();
    const items = activeItems();
    const selIdx = tabSelectedIdx[tab.id];
    const item = items[selIdx];
    if (!item) return;

    if (item.type === 'toggle') {
      if (item.category === 'mcp') {
        const idx = settings.disabledMcpServers.indexOf(item.key);
        if (idx >= 0) settings.disabledMcpServers.splice(idx, 1);
        else settings.disabledMcpServers.push(item.key);
      } else {
        // tool, telaude-tool, mcp-tool all use disabledTools
        const idx = settings.disabledTools.indexOf(item.key);
        if (idx >= 0) settings.disabledTools.splice(idx, 1);
        else settings.disabledTools.push(item.key);
      }
    } else if (item.type === 'select') {
      if (item.category === 'effort') {
        settings.effort = item.key;
        const upRef = getUserProcessBySessionKey(editKey);
        if (upRef) upRef.effort = item.key;
      } else {
        settings.model = item.key;
        const upRef = getUserProcessBySessionKey(editKey);
        if (upRef) upRef.model = item.key;
      }
    }

    // Save
    const sv2 = loadSettingsV2();
    sv2.projects[projKey] = {
      disabledTools: [...settings.disabledTools],
      disabledMcpServers: [...settings.disabledMcpServers],
    };
    if (settings.model || settings.effort) {
      const current = sv2.sessions[editKey] ?? { model: null, effort: null };
      if (settings.model) current.model = settings.model;
      if (settings.effort) current.effort = settings.effort;
      sv2.sessions[editKey] = current;
    }
    saveSettingsV2(sv2);
    render();
  }

  function switchTab(direction: -1 | 1): void {
    activeTabIdx = (activeTabIdx + direction + TABS.length) % TABS.length;
    scrollTop = 0;
    render();
  }

  let active = true;
  let ignoreFirst = true;

  function onKey(_ch: string, key: blessed.Widgets.Events.IKeyEventArg): void {
    if (!active) return;
    if (ignoreFirst) { ignoreFirst = false; return; }

    if (key.name === 'escape' || key.name === 'q') {
      active = false;
      screen.removeListener('keypress', onKey);
      overlay.detach();
      setSettingsOpen(false);
      screen.render();
      return;
    }

    if (focusOnTabs) {
      // Tab bar navigation
      if (key.name === 'left' || key.name === 'h') {
        switchTab(-1);
      } else if (key.name === 'right' || key.name === 'l') {
        switchTab(1);
      } else if (key.name === 'down' || key.name === 'j' || key.name === 'return') {
        focusOnTabs = false;
        render();
      } else if (key.name === 'tab') {
        switchTab(1);
      }
      return;
    }

    // Item list navigation
    const tab = activeTab();
    const items = activeItems();
    const itemCount = items.length;

    if (key.name === 'up' || key.name === 'k') {
      if (tabSelectedIdx[tab.id] === 0) {
        // At top of list — move focus to tab bar
        focusOnTabs = true;
        render();
      } else {
        tabSelectedIdx[tab.id]--;
        render();
      }
    } else if (key.name === 'down' || key.name === 'j') {
      if (tabSelectedIdx[tab.id] < itemCount - 1) {
        tabSelectedIdx[tab.id]++;
      }
      render();
    } else if (key.name === 'left' || key.name === 'h') {
      switchTab(-1);
    } else if (key.name === 'right' || key.name === 'l') {
      switchTab(1);
    } else if (key.name === 'tab') {
      switchTab(1);
    } else if (key.name === 'pageup') {
      tabSelectedIdx[tab.id] = Math.max(0, tabSelectedIdx[tab.id] - getViewportHeight());
      render();
    } else if (key.name === 'pagedown') {
      tabSelectedIdx[tab.id] = Math.min(itemCount - 1, tabSelectedIdx[tab.id] + getViewportHeight());
      render();
    } else if (key.name === 'home') {
      tabSelectedIdx[tab.id] = 0;
      render();
    } else if (key.name === 'end') {
      tabSelectedIdx[tab.id] = itemCount - 1;
      render();
    } else if (key.name === 'space' || key.name === 'return') {
      toggle();
    }
  }

  screen.on('keypress', onKey);

  render();
  overlay.focus();
}
