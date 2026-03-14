import blessed from 'blessed';
import { openSettingsScreen } from '../settings/settings-tui.js';

const SHADOW_CHARS = new Set('╗╝╚═╔╠╣╩╦║');

function colorizeSegment(text: string, fg: string): string {
  let result = '';
  let inShadow = false;
  for (const ch of text) {
    const isShadow = SHADOW_CHARS.has(ch);
    if (isShadow && !inShadow) {
      if (result) result += `{/${fg}}`;
      result += '{gray-fg}';
      inShadow = true;
    } else if (!isShadow && inShadow) {
      result += '{/gray-fg}';
      result += `{${fg}}`;
      inShadow = false;
    } else if (!isShadow && !inShadow && result === '') {
      result += `{${fg}}`;
    }
    result += ch;
  }
  // Close open tag
  if (inShadow) result += '{/gray-fg}';
  else result += `{/${fg}}`;
  return result;
}

function colorizeBanner(line: string, splitAt: number): string {
  const left = line.slice(0, splitAt);
  const right = line.slice(splitAt);
  return colorizeSegment(left, 'blue-fg') + colorizeSegment(right, '208-fg');
}

const BANNER_LINES = [
  '████████╗███████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗',
  '╚══██╔══╝██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝',
  '   ██║   █████╗  ██║     ███████║██║   ██║██║  ██║█████╗',
  '   ██║   ██╔══╝  ██║     ██╔══██║██║   ██║██║  ██║██╔══╝',
  '   ██║   ███████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗',
  '   ╚═╝   ╚══════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝',
];

const TEL_SPLIT = 24;

let screen: blessed.Widgets.Screen | null = null;
let sessionBox: blessed.Widgets.BoxElement | null = null;
let scheduleBox: blessed.Widgets.BoxElement | null = null;
let logBox: blessed.Widgets.Log | null = null;
let statusBar: blessed.Widgets.BoxElement | null = null;
let startTime: Date | null = null;

export function initDashboard(): void {
  // Windows cmd.exe has no TERM env — set it so blessed can initialize
  if (!process.env.TERM) process.env.TERM = 'xterm-256color';

  screen = blessed.screen({
    smartCSR: true,
    title: 'Telaude',
    fullUnicode: true,
  });



  // Top banner box
  const bannerContent = BANNER_LINES.map(l => colorizeBanner(l, TEL_SPLIT)).join('\n');
  blessed.box({
    parent: screen,
    top: 0,
    left: 'center',
    width: '100%',
    height: 8,
    content: bannerContent,
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 208 } },
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
  });

  // Session info box (top-left)
  sessionBox = blessed.box({
    parent: screen,
    top: 8,
    left: 0,
    width: '50%',
    height: '50%-4',
    label: ' Sessions ',
    content: '{gray-fg}No active session{/gray-fg}',
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 208 }, label: { fg: 'cyan' } },
    padding: { left: 1 },
  });

  // Schedule info box (right full height)
  scheduleBox = blessed.box({
    parent: screen,
    top: 8,
    left: '50%',
    width: '50%',
    height: '100%-11',
    label: ' Schedule ',
    content: '{gray-fg}No scheduled jobs{/gray-fg}',
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 208 }, label: { fg: 208 } },
    padding: { left: 1 },
  });

  // Log area (bottom-left)
  logBox = blessed.log({
    parent: screen,
    top: '50%+4',
    left: 0,
    width: '50%',
    height: '50%-7',
    label: ' Logs ',
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 208 }, label: { fg: 'green' } },
    padding: { left: 1, right: 1 },
  });

  // Status bar (bottom)
  startTime = new Date();
  statusBar = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 3,
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 208 } },
    padding: { left: 1 },
  });

  renderStatusBar();

  // Update uptime every second
  setInterval(() => renderStatusBar(), 1000);

  // Re-render on terminal resize
  screen.on('resize', () => {
    screen!.render();
  });

  // All keyboard handling in a single keypress listener to avoid duplicate events
  screen.on('keypress', (_ch: string, key: blessed.Widgets.Events.IKeyEventArg) => {
    if (!key || settingsOpen) return;
    const keys = getSessionKeys();

    switch (key.name) {
      case 'up':
        if (keys.length > 0) {
          selectedSessionIdx = (selectedSessionIdx - 1 + keys.length) % keys.length;
          renderSessionBox();
        }
        break;
      case 'down':
        if (keys.length > 0) {
          selectedSessionIdx = (selectedSessionIdx + 1) % keys.length;
          renderSessionBox();
        }
        break;
      case 'return':
        if (screen) {
          const selectedKey = keys[selectedSessionIdx] ?? undefined;
          openSettingsScreen(screen, selectedKey);
        }
        break;
      case 'pageup':
        if (logBox) { logBox.scroll(-((logBox.height as number) - 2)); screen!.render(); }
        break;
      case 'pagedown':
        if (logBox) { logBox.scroll((logBox.height as number) - 2); screen!.render(); }
        break;
    }

    if (key.ctrl && key.name === 'c') {
      process.exit(0);
    }
  });

  screen.render();
}

export function dashboardLog(msg: string): void {
  if (logBox) {
    logBox.log(msg);
    screen?.render();
  } else {
    console.log(msg);
  }
}

export function dashboardError(msg: string): void {
  if (logBox) {
    logBox.log(`{red-fg}${msg}{/red-fg}`);
    screen?.render();
  } else {
    console.error(`❌ ${msg}`);
  }
}

interface SessionInfo {
  id?: string;
  model?: string;
  dir?: string;
  isActive?: boolean;
  label?: string;  // e.g. "DM", "Group/T:3"
}

let botUsername: string | null = null;
const sessionStates = new Map<string, SessionInfo>();
let selectedSessionIdx = 0;
let settingsOpen = false;

export function setSettingsOpen(open: boolean): void {
  settingsOpen = open;
}

function getSessionKeys(): string[] {
  return [...sessionStates.entries()]
    .filter(([k, s]) => k !== '_default' || s.id)
    .map(([k]) => k);
}

export function getSessionDir(sessionKey: string): string | undefined {
  return sessionStates.get(sessionKey)?.dir;
}

export function updateSession(info: { id?: string; model?: string; dir?: string; botUsername?: string; sessionKey?: string; isActive?: boolean; label?: string }): void {
  if (!sessionBox) return;
  if (info.botUsername) botUsername = info.botUsername;

  // Only update sessionStates if there's actual session data (not just botUsername)
  if (info.id || info.model || info.dir || info.sessionKey || info.label || info.isActive !== undefined) {
    const key = info.sessionKey ?? '_default';
    const current = sessionStates.get(key) ?? {};
    if (info.id) current.id = info.id;
    if (info.model) current.model = info.model;
    if (info.dir) current.dir = info.dir;
    if (info.isActive !== undefined) current.isActive = info.isActive;
    if (info.label) current.label = info.label;
    sessionStates.set(key, current);
  }

  renderSessionBox();
}

function renderSessionBox(): void {
  if (!sessionBox) return;
  const lines: string[] = [];
  if (botUsername) lines.push(`Bot: {cyan-fg}@${botUsername}{/cyan-fg}`);
  lines.push('');

  // Filter out _default if it has no session id (ghost entry)
  const realSessions = [...sessionStates.entries()].filter(([k, s]) => k !== '_default' || s.id);

  if (realSessions.length === 0) {
    lines.push('{gray-fg}No active session{/gray-fg}');
  } else {
    // Clamp selected index
    if (selectedSessionIdx >= realSessions.length) selectedSessionIdx = realSessions.length - 1;
    if (selectedSessionIdx < 0) selectedSessionIdx = 0;

    realSessions.forEach(([k, s], idx) => {
      const active = s.isActive !== false;
      const icon = active ? '{green-fg}●{/green-fg}' : '{gray-fg}○{/gray-fg}';
      const label = s.label ?? k;
      const cursor = idx === selectedSessionIdx ? '{bold}{white-fg}▸{/white-fg}{/bold} ' : '  ';
      lines.push(`${cursor}${icon} {bold}${label}{/bold}`);
      if (s.id) lines.push(`    sess:${s.id.slice(0, 8)}.. ${s.model ?? ''}`);
      if (s.dir) lines.push(`    {gray-fg}${s.dir}{/gray-fg}`);
    });
  }

  lines.push('');
  lines.push('{gray-fg}↑↓ select  Enter settings  PgUp/PgDn logs{/gray-fg}');

  sessionBox.setContent(lines.join('\n'));
  screen?.render();
}

export function removeSession(sessionKey: string): void {
  sessionStates.delete(sessionKey);
  renderSessionBox();
}

interface ScheduleJob {
  name: string;
  schedule?: string;
  isPaused?: boolean;
  once?: boolean;
  runAt?: string;
  nextRun?: Date | null;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const DAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];

function formatTime(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function getNextRun(job: ScheduleJob): Date | null {
  if (job.nextRun) return job.nextRun;
  if (job.once && job.runAt) {
    const d = new Date(job.runAt);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function cronToLabel(cron: string): string {
  const parts = cron.split(/\s+/);
  if (parts.length < 5) return cron;
  const [min, hour, dom, , dow] = parts;
  const time = `${pad2(Number(hour))}:${pad2(Number(min))}`;

  // 매월 N일
  if (dom !== '*') return `매월 ${dom}일 ${time}`;
  // 매주 X요일
  if (dow !== '*') {
    const dayIdx = Number(dow);
    const dayName = DAYS_KO[dayIdx] ?? dow;
    return `매주 ${dayName} ${time}`;
  }
  // 매일
  if (hour !== '*' && min !== '*') return `매일 ${time}`;
  // 매시
  if (hour === '*' && min !== '*') return `매시 ${min}분`;
  return cron;
}

function formatJobLine(j: ScheduleJob, showNextRun: boolean): string {
  const status = j.isPaused ? '{yellow-fg}⏸{/yellow-fg}' : '{green-fg}●{/green-fg}';

  if (showNextRun) {
    const next = getNextRun(j);
    const timeStr = next ? formatTime(next) : '—';
    return `${status} ${j.name} {gray-fg}${timeStr}{/gray-fg}`;
  }

  if (j.once) {
    const next = getNextRun(j);
    const timeStr = next ? formatTime(next) : 'once';
    return `${status} ${j.name} {gray-fg}1회 ${timeStr}{/gray-fg}`;
  }
  const label = j.schedule ? cronToLabel(j.schedule) : 'once';
  return `${status} ${j.name} {gray-fg}${label}{/gray-fg}`;
}

export function updateSchedule(jobs: ScheduleJob[]): void {
  if (!scheduleBox) return;
  if (jobs.length === 0) {
    scheduleBox.setContent('{gray-fg}No scheduled jobs{/gray-fg}');
    screen?.render();
    return;
  }

  const now = new Date();
  const active = jobs.filter(j => !j.isPaused);

  // Find the closest upcoming job
  let incoming: ScheduleJob | null = null;
  let incomingTime: Date | null = null;
  for (const j of active) {
    const next = getNextRun(j);
    if (next && next > now && (!incomingTime || next < incomingTime)) {
      incoming = j;
      incomingTime = next;
    }
  }

  const sections: string[] = [];

  // Incoming section
  sections.push('{white-fg}▶ Incoming{/white-fg}');
  if (incoming && incomingTime) {
    sections.push(`  ${formatJobLine(incoming, true)}`);
  } else {
    sections.push('  {gray-fg}—{/gray-fg}');
  }

  // Jobs section
  sections.push('');
  sections.push('{white-fg}▶ Jobs{/white-fg}');
  for (const j of jobs) {
    sections.push(`  ${formatJobLine(j, false)}`);
  }

  scheduleBox.setContent(sections.join('\n'));
  screen?.render();
}

export function isDashboardActive(): boolean {
  return screen !== null;
}

// --- Status bar ---

let statusCheckers: (() => { sessionCount: number; pokeActive: number; pokeTotal: number }) | null = null;

function formatUptime(): string {
  if (!startTime) return '00:00:00';
  const diff = Math.floor((Date.now() - startTime.getTime()) / 1000);
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  return d > 0
    ? `${d}d ${pad2(h)}:${pad2(m)}:${pad2(s)}`
    : `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

function renderStatusBar(): void {
  if (!statusBar) return;
  const state = statusCheckers ? statusCheckers() : { sessionCount: 0, pokeActive: 0, pokeTotal: 0 };
  const uptime = `{gray-fg}Uptime:{/gray-fg} {white-fg}${formatUptime()}{/white-fg}`;
  const sessions = `{gray-fg}Sessions:{/gray-fg} {white-fg}${state.sessionCount}{/white-fg}`;
  const poke = `{gray-fg}Poke:{/gray-fg} {white-fg}${state.pokeActive}/${state.pokeTotal}{/white-fg}`;
  statusBar.setContent(`${uptime}    ${sessions}    ${poke}`);
  screen?.render();
}

export function setStatusCheckers(fn: () => { sessionCount: number; pokeActive: number; pokeTotal: number }): void {
  statusCheckers = fn;
}

export function stopDashboard(): void {
  if (screen) {
    screen.destroy();
    screen = null;
  }
}
