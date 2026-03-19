import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../utils/logger.js';

let _onChange: (() => void) | null = null;
export function setOnChange(cb: () => void): void { _onChange = cb; }
export function triggerOnChange(): void { _onChange?.(); }

export interface CronJobHistory {
  timestamp: string;
  status: 'success' | 'error';
  durationMs: number;
  error?: string;
  response?: string;
}

export interface CompletedJob {
  id: string;
  name: string;
  schedule: string;
  message: string;
  workingDir: string;
  model?: string;
  userId: number;
  chatId: number;
  threadId: number;
  once: boolean;
  runAt?: string;
  createdAt: string;
  completedAt: string;
  history: CronJobHistory[];
}

export type JobMode = 'main' | 'isolated';
export type SecurityLevel = 'low' | 'medium' | 'high';

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  message: string;
  workingDir: string;
  model?: string;
  userId: number;
  chatId: number;
  threadId: number;
  sessionId: string | null;
  isPaused: boolean;
  once: boolean;
  runAt?: string;
  createdAt: string;
  history: CronJobHistory[];
  /** 'main' = runs in current session, 'isolated' = independent process */
  mode: JobMode;
  /** Tool access level for isolated jobs */
  toolSecurity: SecurityLevel;
  /** Prompt injection protection level for isolated jobs */
  promptSecurity: SecurityLevel;
  /** Additional MCP servers allowed in isolated mode (on top of Telaude's own) */
  allowedMcps: string[];
}

const STORE_PATH = path.join(os.homedir(), '.telaude', 'data', 'cron-jobs.json');
const HISTORY_PATH = path.join(os.homedir(), '.telaude', 'data', 'cron-history.json');

function readStore(): CronJob[] {
  try {
    if (!fs.existsSync(STORE_PATH)) return [];
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeStore(jobs: CronJob[]): void {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(STORE_PATH, JSON.stringify(jobs, null, 2), 'utf-8');
}

let counter = 0;

function generateId(): string {
  counter++;
  return `cron_${Date.now()}_${counter}`;
}

export function getAllJobs(): CronJob[] {
  return readStore();
}

export function getJob(jobId: string): CronJob | undefined {
  return readStore().find(j => j.id === jobId);
}

export function addJob(params: {
  name: string;
  schedule: string;
  message: string;
  workingDir: string;
  model?: string;
  userId: number;
  chatId: number;
  threadId: number;
  sessionId?: string | null;
  once?: boolean;
  runAt?: string;
  mode?: JobMode;
  toolSecurity?: SecurityLevel;
  promptSecurity?: SecurityLevel;
  allowedMcps?: string[];
}): CronJob {
  const jobs = readStore();
  const job: CronJob = {
    id: generateId(),
    name: params.name,
    schedule: params.schedule,
    message: params.message,
    workingDir: params.workingDir,
    model: params.model,
    userId: params.userId,
    chatId: params.chatId,
    threadId: params.threadId,
    sessionId: params.sessionId ?? null,
    isPaused: false,
    once: params.once ?? false,
    runAt: params.runAt,
    createdAt: new Date().toISOString(),
    history: [],
    mode: params.mode ?? 'main',
    toolSecurity: params.toolSecurity ?? 'medium',
    promptSecurity: params.promptSecurity ?? 'medium',
    allowedMcps: params.allowedMcps ?? [],
  };
  jobs.push(job);
  writeStore(jobs);
  logger.info({ jobId: job.id, name: job.name }, 'Cron job added');
  _onChange?.();
  return job;
}

export function updateJob(jobId: string, updates: Partial<Pick<CronJob, 'name' | 'schedule' | 'message' | 'workingDir' | 'model' | 'isPaused' | 'sessionId'>>): CronJob | null {
  const jobs = readStore();
  const idx = jobs.findIndex(j => j.id === jobId);
  if (idx === -1) return null;
  Object.assign(jobs[idx], updates);
  writeStore(jobs);
  _onChange?.();
  return jobs[idx];
}

export function removeJob(jobId: string): boolean {
  const jobs = readStore();
  const filtered = jobs.filter(j => j.id !== jobId);
  if (filtered.length === jobs.length) return false;
  writeStore(filtered);
  logger.info({ jobId }, 'Cron job removed');
  _onChange?.();
  return true;
}

export function addHistory(jobId: string, entry: CronJobHistory): void {
  const jobs = readStore();
  const job = jobs.find(j => j.id === jobId);
  if (!job) return;
  job.history.push(entry);
  // Keep last 50 entries
  if (job.history.length > 50) {
    job.history = job.history.slice(-50);
  }
  writeStore(jobs);
}

// --- Completed jobs archive ---

function readHistory(): CompletedJob[] {
  try {
    if (!fs.existsSync(HISTORY_PATH)) return [];
    const raw = fs.readFileSync(HISTORY_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeHistory(jobs: CompletedJob[]): void {
  const dir = path.dirname(HISTORY_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(jobs, null, 2), 'utf-8');
}

/**
 * Archive a job to completed history before removing it.
 */
export function archiveJob(jobId: string): void {
  const job = getJob(jobId);
  if (!job) return;

  const completed: CompletedJob = {
    id: job.id,
    name: job.name,
    schedule: job.schedule,
    message: job.message,
    workingDir: job.workingDir,
    model: job.model,
    userId: job.userId,
    chatId: job.chatId,
    threadId: job.threadId,
    once: job.once,
    runAt: job.runAt,
    createdAt: job.createdAt,
    completedAt: new Date().toISOString(),
    history: job.history,
  };

  const history = readHistory();
  history.push(completed);
  // Keep last 200 entries
  if (history.length > 200) {
    history.splice(0, history.length - 200);
  }
  writeHistory(history);
  logger.info({ jobId, name: job.name }, 'Job archived to history');
}

/**
 * Get all completed jobs, optionally filtered by userId.
 */
export function getCompletedJobs(userId?: number): CompletedJob[] {
  const history = readHistory();
  if (userId != null) {
    return history.filter(j => j.userId === userId);
  }
  return history;
}
