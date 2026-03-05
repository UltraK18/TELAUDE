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
  screen = blessed.screen({
    smartCSR: true,
    title: 'Telaude',
    fullUnicode: true,
    terminal: 'xterm-256color',
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
    height: 6,
    label: ' Session ',
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
    scrollable: true,
    alwaysScroll: true,
    mouse: true,
    padding: { left: 1 },
  });

  // Log area (bottom-left)
  logBox = blessed.log({
    parent: screen,
    top: 14,
    left: 0,
    width: '50%',
    height: '100%-17',
    label: ' Logs ',
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 208 }, label: { fg: 'green' } },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      style: { bg: 'gray' },
    },
    mouse: true,
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
    mouse: true,
  });

  // Settings button (right-aligned inside status bar)
  const settingsBtn = blessed.box({
    parent: statusBar,
    top: 0,
    right: 1,
    width: 12,
    height: 1,
    tags: true,
    content: '{208-fg}[Settings]{/208-fg}',
    style: { hover: { fg: 'white' } },
    mouse: true,
  });
  settingsBtn.on('click', () => {
    if (screen) openSettingsScreen(screen);
  });

  renderStatusBar();

  // Update uptime every second
  setInterval(() => renderStatusBar(), 1000);

  // Re-render on terminal resize
  screen.on('resize', () => {
    screen!.render();
  });

  // Open settings on 's'
  screen.key(['s'], () => {
    if (screen) openSettingsScreen(screen);
  });

  // Quit on q or Ctrl-C
  screen.key(['C-c'], () => {
    process.exit(0);
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

let sessionState: { botUsername?: string; id?: string; model?: string; dir?: string } = {};

export function updateSession(info: { id?: string; model?: string; dir?: string; botUsername?: string }): void {
  if (!sessionBox) return;
  // Merge with previous state
  if (info.botUsername) sessionState.botUsername = info.botUsername;
  if (info.id) sessionState.id = info.id;
  if (info.model) sessionState.model = info.model;
  if (info.dir) sessionState.dir = info.dir;

  const lines: string[] = [];
  if (sessionState.botUsername) lines.push(`Bot: {cyan-fg}@${sessionState.botUsername}{/cyan-fg}`);
  if (sessionState.id) lines.push(`Session: {white-fg}${sessionState.id.slice(0, 8)}...{/white-fg}`);
  if (sessionState.model) lines.push(`Model: {white-fg}${sessionState.model}{/white-fg}`);
  if (sessionState.dir) lines.push(`Dir: {gray-fg}${sessionState.dir}{/gray-fg}`);
  sessionBox.setContent(lines.length > 0 ? lines.join('\n') : '{gray-fg}No active session{/gray-fg}');
  screen?.render();
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

let statusCheckers: (() => { heartbeat: boolean; poke: boolean }) | null = null;

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

function indicator(on: boolean): string {
  return on ? '{green-fg}●{/green-fg}' : '{red-fg}●{/red-fg}';
}

function renderStatusBar(): void {
  if (!statusBar) return;
  const state = statusCheckers ? statusCheckers() : { heartbeat: false, poke: false };
  const uptime = `{gray-fg}Uptime:{/gray-fg} {white-fg}${formatUptime()}{/white-fg}`;
  const hb = `{gray-fg}Heartbeat:{/gray-fg} ${indicator(state.heartbeat)}`;
  const pk = `{gray-fg}Poke:{/gray-fg} ${indicator(state.poke)}`;
  statusBar.setContent(`${uptime}    ${hb}    ${pk}`);
  screen?.render();
}

export function setStatusCheckers(fn: () => { heartbeat: boolean; poke: boolean }): void {
  statusCheckers = fn;
}
