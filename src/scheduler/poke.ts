import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import { getLastUserMessageTime, getHourlyDistribution } from '../db/message-log-repo.js';

// --- Types ---

type Level = 'minimal' | 'very_low' | 'low' | 'medium' | 'high' | 'very_high' | 'extreme';

interface PokeConfig {
  intensity: Level;
  frequency: Level;
  timezone?: string;
  track: string[];
  context?: string;
  body: string;
}

interface PokeState {
  timer: ReturnType<typeof setTimeout> | null;
  count: number;
  maxCount: number;
  workingDir: string;
  config: PokeConfig | null;
  watcher: fs.FSWatcher | null;
  watchDebounce: ReturnType<typeof setTimeout> | null;
  lastPokeTime: number | null;
}

type PokeCallback = (userId: number, stdin: string, workingDir: string) => Promise<void>;

// --- Constants ---

const POKE_FILENAME = 'POKE.md';

const INTENSITY_DELAY: Record<Level, [number, number]> = {
  minimal:   [0, 3600000],
  very_low:  [2700000, 3600000],
  low:       [1200000, 1800000],
  medium:    [420000, 600000],
  high:      [180000, 300000],
  very_high: [60000, 120000],
  extreme:   [30000, 60000],
};

const FREQUENCY_MAX: Record<Level, number> = {
  minimal: 1,
  very_low: 3,
  low: 5,
  medium: 7,
  high: 10,
  very_high: 12,
  extreme: 15,
};

// Sleep window probability by intensity level: [earlyPhase, lightPhase, midPhase]
// 0 = never, values are probability 0-1
const SLEEP_PROBABILITY: Record<Level, [number, number, number]> = {
  minimal:   [0, 0, 0],
  very_low:  [0, 0, 0],
  low:       [0, 0, 0],
  medium:    [0.05, 0, 0],
  high:      [0.15, 0.05, 0],
  very_high: [0.35, 0.15, 0],
  extreme:   [0.6, 0.35, 0.15],
};

// --- State ---

const pokeStates = new Map<number, PokeState>();
let pokeCallback: PokeCallback | null = null;

// --- Public API ---

export function setPokeCallback(cb: PokeCallback): void {
  pokeCallback = cb;
}

export function startPokeTimer(userId: number, workingDir: string): void {
  const config = readPokeConfig(workingDir);
  if (!config) {
    // No POKE.md or invalid — clean up any existing state
    cancelPokeTimer(userId);
    return;
  }

  let state = pokeStates.get(userId);
  if (!state) {
    state = {
      timer: null,
      count: 0,
      maxCount: FREQUENCY_MAX[config.frequency],
      workingDir,
      config,
      watcher: null,
      watchDebounce: null,
      lastPokeTime: null,
    };
    pokeStates.set(userId, state);
  } else {
    state.config = config;
    state.workingDir = workingDir;
    state.maxCount = FREQUENCY_MAX[config.frequency];
    // Don't reset count — only user message resets count
  }

  // Start/restart file watcher
  watchPokeMd(userId, workingDir, state);

  // Schedule next poke
  scheduleNextPoke(userId, state);
}

export function resetPokeTimer(userId: number): void {
  const state = pokeStates.get(userId);
  if (!state) return;

  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  state.count = 0;
  logger.info({ userId }, 'Poke timer reset (user message received)');
}

export function cancelPokeTimer(userId: number): void {
  const state = pokeStates.get(userId);
  if (!state) return;

  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  if (state.watcher) {
    state.watcher.close();
    state.watcher = null;
  }
  if (state.watchDebounce) {
    clearTimeout(state.watchDebounce);
    state.watchDebounce = null;
  }
  pokeStates.delete(userId);
  logger.info({ userId }, 'Poke timer cancelled');
}

export function stopAllPokes(): void {
  for (const [userId] of pokeStates) {
    cancelPokeTimer(userId);
  }
  logger.info('All poke timers stopped');
}

// --- Internal ---

function scheduleNextPoke(userId: number, state: PokeState): void {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }

  if (!state.config) return;
  if (state.count >= state.maxCount) {
    logger.info({ userId, count: state.count, max: state.maxCount }, 'Poke max count reached');
    return;
  }

  // Minimal level: 50% chance to skip entirely on first poke
  if (state.config.intensity === 'minimal' && state.count === 0 && Math.random() < 0.5) {
    logger.info({ userId }, 'Poke skipped (minimal intensity, 50% roll)');
    return;
  }

  const delay = calculateDelay(state.config.intensity, state.count);

  state.timer = setTimeout(async () => {
    state.timer = null;
    await firePoke(userId, state);
  }, delay);

  logger.info({ userId, delayMs: delay, count: state.count, intensity: state.config.intensity }, 'Poke scheduled');
}

function calculateDelay(intensity: Level, count: number): number {
  const [min, max] = INTENSITY_DELAY[intensity];
  const base = min + Math.random() * (max - min);

  // Subsequent pokes: variable ratio — sometimes faster, sometimes slower
  if (count > 0) {
    const jitter = 0.5 + Math.random() * 1.5; // 0.5x to 2x multiplier
    return Math.round(base * jitter);
  }

  return Math.round(base);
}

async function firePoke(userId: number, state: PokeState): Promise<void> {
  if (!state.config || !pokeCallback) return;

  // Check sleep window
  if (shouldSkipForSleep(userId, state.config)) {
    logger.info({ userId }, 'Poke skipped (sleep window)');
    // Still schedule next if count allows
    state.count++;
    scheduleNextPoke(userId, state);
    return;
  }

  const stdin = buildPokeStdin(userId, state.config, state.workingDir, state.lastPokeTime);

  try {
    state.count++;
    state.lastPokeTime = Date.now();
    logger.info({ userId, count: state.count }, 'Firing poke');
    await pokeCallback(userId, stdin, state.workingDir);
  } catch (err) {
    logger.error({ err, userId }, 'Poke callback failed');
  }

  // Schedule next poke after current one completes
  scheduleNextPoke(userId, state);
}

function shouldSkipForSleep(userId: number, config: PokeConfig): boolean {
  if (!config.track.includes('sleep_time')) return false;

  const tz = config.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const currentHour = getCurrentHour(tz);
  const sleepWindow = estimateSleepWindow(userId);

  if (!sleepWindow) return false;

  const phase = getSleepPhase(currentHour, sleepWindow);
  if (phase === null) return false; // Not in sleep window

  const probs = SLEEP_PROBABILITY[config.intensity];
  const probability = probs[phase] ?? 0;

  // Roll dice — return true to skip if roll fails
  return Math.random() > probability;
}

function getSleepPhase(hour: number, sleepWindow: { start: number; end: number }): number | null {
  const { start, end } = sleepWindow;

  // Normalize hours relative to sleep start
  let hoursIntoSleep: number;
  if (end > start) {
    // e.g. 23-7
    if (hour >= start && hour < end) {
      hoursIntoSleep = hour - start;
    } else {
      return null;
    }
  } else {
    // e.g. 0-7 (wraps midnight)
    if (hour >= start) {
      hoursIntoSleep = hour - start;
    } else if (hour < end) {
      hoursIntoSleep = (24 - start) + hour;
    } else {
      return null;
    }
  }

  const duration = end > start ? end - start : (24 - start) + end;
  const fraction = hoursIntoSleep / duration;

  if (fraction < 0.15) return 0;       // early (극초반)
  if (fraction < 0.35) return 1;       // light (초반)
  if (fraction < 0.7) return 2;        // mid (중반)
  return 3;                            // deep (후반) — always skip
}

function estimateSleepWindow(userId: number): { start: number; end: number } | null {
  const dist = getHourlyDistribution(userId, 14);
  if (dist.length === 0) return null;

  // Need enough data to make a meaningful estimate
  const totalMessages = dist.reduce((sum, d) => sum + d.count, 0);
  if (totalMessages < 50) return null;

  // Find the longest consecutive gap in activity — that's likely sleep
  const hourCounts = new Array(24).fill(0);
  for (const { hour, count } of dist) {
    hourCounts[hour] = count;
  }

  // Find the longest run of zero/very-low activity hours
  let bestStart = -1;
  let bestLen = 0;
  let currentStart = -1;
  let currentLen = 0;
  const threshold = Math.max(1, Math.max(...hourCounts) * 0.1); // 10% of peak

  for (let i = 0; i < 48; i++) { // Double loop for wraparound
    const h = i % 24;
    if (hourCounts[h] <= threshold) {
      if (currentStart === -1) currentStart = h;
      currentLen++;
      if (currentLen > bestLen) {
        bestLen = currentLen;
        bestStart = currentStart;
      }
    } else {
      currentStart = -1;
      currentLen = 0;
    }
  }

  if (bestLen < 4 || bestStart === -1) return null; // Need at least 4 hours gap

  return { start: bestStart, end: (bestStart + bestLen) % 24 };
}

function getCurrentHour(timezone: string): number {
  try {
    const timeStr = new Date().toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', hour12: false });
    return parseInt(timeStr, 10);
  } catch {
    return new Date().getHours();
  }
}

function estimateUserState(userId: number, timezone: string, tracks: string[]): string {
  const hour = getCurrentHour(timezone);

  if (tracks.includes('sleep_time')) {
    const sleepWindow = estimateSleepWindow(userId);
    if (sleepWindow) {
      const phase = getSleepPhase(hour, sleepWindow);
      if (phase !== null) {
        return ['early_sleep', 'light_sleep', 'mid_sleep', 'deep_sleep'][phase];
      }
    }
  }

  // Rough time-of-day estimation
  if (hour >= 6 && hour < 9) return 'morning';
  if (hour >= 9 && hour < 12) return 'work_hours';
  if (hour >= 12 && hour < 14) return 'lunch';
  if (hour >= 14 && hour < 18) return 'work_hours';
  if (hour >= 18 && hour < 21) return 'leisure';
  if (hour >= 21 || hour < 6) return 'night';

  return 'unknown';
}

function buildPokeStdin(userId: number, config: PokeConfig, workingDir: string, lastPokeTime: number | null): string {
  const tz = config.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date();
  const timeStr = now.toLocaleString('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

  const state = config.track.length > 0
    ? estimateUserState(userId, tz, config.track)
    : 'unknown';

  const lastMsg = getLastUserMessageTime(userId);
  const elapsed = lastMsg
    ? formatElapsed(Date.now() - new Date(lastMsg + 'Z').getTime())
    : 'unknown';

  const lastPokeElapsed = lastPokeTime
    ? formatElapsed(Date.now() - lastPokeTime)
    : null;

  let contextContent = '';
  if (config.context) {
    contextContent = resolveContextFile(workingDir, config.context);
    if (contextContent) {
      contextContent = `\n\n<context>\n${contextContent}\n</context>`;
    }
  }

  return `<system-reminder>
Current time: ${timeStr} (${tz})
Estimated user state: ${state}
Time since user's last message: ${elapsed}${lastPokeElapsed ? `\nTime since last poke: ${lastPokeElapsed}` : ''}
Use this context to compose a natural proactive message.
If poking is unnecessary (e.g. user said goodbye), call poke_ok to skip.
</system-reminder>

${config.body}${contextContent}`;
}

function formatElapsed(ms: number): string {
  if (ms < 0) return '0s';
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  if (hours < 24) return remainMins > 0 ? `${hours}h ${remainMins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function resolveContextFile(workingDir: string, contextPath: string): string {
  try {
    const resolved = path.resolve(workingDir, contextPath);
    if (!fs.existsSync(resolved)) return '';
    return fs.readFileSync(resolved, 'utf-8');
  } catch {
    return '';
  }
}

// --- POKE.md Parsing ---

function readPokeConfig(workingDir: string): PokeConfig | null {
  const filePath = path.join(workingDir, POKE_FILENAME);
  try {
    if (!fs.existsSync(filePath)) return null;

    // Check for invalid variants
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const files = fs.readdirSync(dir);
    for (const f of files) {
      if (f.toLowerCase().includes('poke') && f !== base) {
        // Found a variant like .poke.md or POKE.md.old — ignore entirely
        if (f === '.poke.md' || f.endsWith('.old') || f.endsWith('.bak')) {
          continue; // Just skip the variant, still read POKE.md
        }
      }
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    return parsePokeMd(raw);
  } catch (err) {
    logger.error({ err, filePath }, 'Failed to read POKE.md');
    return null;
  }
}

function parsePokeMd(raw: string): PokeConfig | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    // No frontmatter — use defaults with body as full content
    return {
      intensity: 'medium',
      frequency: 'medium',
      track: [],
      body: raw.trim(),
    };
  }

  const frontmatter = match[1];
  const body = match[2].trim();

  const config: PokeConfig = {
    intensity: 'medium',
    frequency: 'medium',
    track: [],
    body,
  };

  // Simple YAML-like parsing (no external dependency)
  for (const line of frontmatter.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('intensity:')) {
      config.intensity = trimmed.split(':')[1].trim() as Level;
    } else if (trimmed.startsWith('frequency:')) {
      config.frequency = trimmed.split(':')[1].trim() as Level;
    } else if (trimmed.startsWith('timezone:')) {
      config.timezone = trimmed.split(':').slice(1).join(':').trim(); // Handle tz with colons
    } else if (trimmed.startsWith('context:')) {
      config.context = trimmed.split(':').slice(1).join(':').trim();
    } else if (trimmed.startsWith('- ')) {
      // Array item (under track:)
      config.track.push(trimmed.slice(2).trim());
    }
  }

  // Validate levels
  if (!INTENSITY_DELAY[config.intensity]) config.intensity = 'medium';
  if (!FREQUENCY_MAX[config.frequency]) config.frequency = 'medium';

  return config;
}

// --- fs.watch ---

function watchPokeMd(userId: number, workingDir: string, state: PokeState): void {
  // Close existing watcher if any
  if (state.watcher) {
    state.watcher.close();
    state.watcher = null;
  }

  const filePath = path.join(workingDir, POKE_FILENAME);
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) return;

  try {
    state.watcher = fs.watch(dir, (eventType, filename) => {
      if (filename !== POKE_FILENAME) return;

      // Debounce (Windows fires duplicate events)
      if (state.watchDebounce) clearTimeout(state.watchDebounce);
      state.watchDebounce = setTimeout(() => {
        state.watchDebounce = null;
        logger.info({ userId, workingDir }, 'POKE.md changed — reloading');
        const newConfig = readPokeConfig(workingDir);
        if (newConfig) {
          state.config = newConfig;
          state.maxCount = FREQUENCY_MAX[newConfig.frequency];
          scheduleNextPoke(userId, state);
        } else {
          // POKE.md deleted or invalid
          cancelPokeTimer(userId);
        }
      }, 500);
    });
  } catch (err) {
    logger.error({ err, workingDir }, 'Failed to watch POKE.md directory');
  }
}
