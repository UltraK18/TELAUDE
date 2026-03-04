import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

export interface CronJobHistory {
  timestamp: string;
  status: 'success' | 'error';
  durationMs: number;
  error?: string;
}

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  message: string;
  workingDir: string;
  model?: string;
  userId: number;
  sessionId: string | null;
  isPaused: boolean;
  createdAt: string;
  history: CronJobHistory[];
}

const STORE_PATH = path.join(process.cwd(), 'data', 'cron-jobs.json');

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
  sessionId?: string | null;
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
    sessionId: params.sessionId ?? null,
    isPaused: false,
    createdAt: new Date().toISOString(),
    history: [],
  };
  jobs.push(job);
  writeStore(jobs);
  logger.info({ jobId: job.id, name: job.name }, 'Cron job added');
  return job;
}

export function updateJob(jobId: string, updates: Partial<Pick<CronJob, 'name' | 'schedule' | 'message' | 'workingDir' | 'model' | 'isPaused' | 'sessionId'>>): CronJob | null {
  const jobs = readStore();
  const idx = jobs.findIndex(j => j.id === jobId);
  if (idx === -1) return null;
  Object.assign(jobs[idx], updates);
  writeStore(jobs);
  return jobs[idx];
}

export function removeJob(jobId: string): boolean {
  const jobs = readStore();
  const filtered = jobs.filter(j => j.id !== jobId);
  if (filtered.length === jobs.length) return false;
  writeStore(filtered);
  logger.info({ jobId }, 'Cron job removed');
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
