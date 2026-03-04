import { Cron } from 'croner';
import { getAllJobs, getJob, addHistory, removeJob, archiveJob, type CronJob } from './cron-store.js';
import { logger } from '../utils/logger.js';

type TriggerCallback = (job: CronJob) => Promise<string | null>;

const activeCrons = new Map<string, Cron>();
const activeTimers = new Map<string, ReturnType<typeof setTimeout>>();
let triggerCallback: TriggerCallback | null = null;

/**
 * Set the callback that will be invoked when a cron job triggers.
 * The callback is responsible for spawning the Claude process.
 */
export function setTriggerCallback(cb: TriggerCallback): void {
  triggerCallback = cb;
}

/**
 * Start/restart a single cron job.
 */
async function executeJob(job: CronJob): Promise<void> {
  logger.info({ jobId: job.id, name: job.name }, 'Cron job triggered');
  const startTime = Date.now();

  try {
    if (!triggerCallback) {
      throw new Error('No trigger callback registered');
    }
    const currentJob = getJob(job.id);
    if (!currentJob || currentJob.isPaused) {
      logger.info({ jobId: job.id }, 'Job paused or deleted, skipping execution');
      return;
    }
    const response = await triggerCallback(currentJob);
    addHistory(job.id, {
      timestamp: new Date().toISOString(),
      status: 'success',
      durationMs: Date.now() - startTime,
      response: response ?? undefined,
    });
  } catch (err: any) {
    logger.error({ err, jobId: job.id }, 'Cron job execution failed');
    addHistory(job.id, {
      timestamp: new Date().toISOString(),
      status: 'error',
      durationMs: Date.now() - startTime,
      error: err.message,
    });
  }

  // Auto-delete one-time jobs after execution (archive first)
  if (job.once) {
    stopJob(job.id);
    archiveJob(job.id);
    removeJob(job.id);
    logger.info({ jobId: job.id, name: job.name }, 'One-time job archived and removed');
  }
}

function startJob(job: CronJob): void {
  // Stop existing if any
  stopJob(job.id);

  if (job.isPaused) {
    logger.info({ jobId: job.id, name: job.name }, 'Cron job is paused, not scheduling');
    return;
  }

  // One-time job with runAt: use setTimeout
  if (job.once && job.runAt) {
    const delayMs = new Date(job.runAt).getTime() - Date.now();
    if (delayMs <= 0) {
      logger.info({ jobId: job.id, name: job.name, runAt: job.runAt }, 'One-time job already past, skipping');
      return;
    }
    const timer = setTimeout(() => {
      activeTimers.delete(job.id);
      executeJob(job);
    }, delayMs);
    activeTimers.set(job.id, timer);
    logger.info({ jobId: job.id, name: job.name, runAt: job.runAt, delayMs }, 'One-time job scheduled');
    return;
  }

  // Recurring job: use Cron
  try {
    const cronInstance = new Cron(job.schedule, () => executeJob(job));
    activeCrons.set(job.id, cronInstance);
    const next = cronInstance.nextRun();
    logger.info({ jobId: job.id, name: job.name, schedule: job.schedule, nextRun: next?.toISOString() }, 'Cron job scheduled');
  } catch (err) {
    logger.error({ err, jobId: job.id, schedule: job.schedule }, 'Invalid cron expression');
  }
}

/**
 * Stop a single cron job.
 */
function stopJob(jobId: string): void {
  const existing = activeCrons.get(jobId);
  if (existing) {
    existing.stop();
    activeCrons.delete(jobId);
  }
  const timer = activeTimers.get(jobId);
  if (timer) {
    clearTimeout(timer);
    activeTimers.delete(jobId);
  }
}

/**
 * Load all jobs from store and schedule them.
 */
export function startAll(): void {
  const jobs = getAllJobs();
  for (const job of jobs) {
    startJob(job);
  }
  logger.info({ count: jobs.length }, 'All cron jobs loaded');
}

/**
 * Stop all active cron jobs.
 */
export function stopAll(): void {
  for (const [, cron] of activeCrons) {
    cron.stop();
  }
  activeCrons.clear();
  for (const [, timer] of activeTimers) {
    clearTimeout(timer);
  }
  activeTimers.clear();
  logger.info('All cron jobs stopped');
}

/**
 * Reload: stop all, re-read from store, start all.
 */
export function reloadAll(): void {
  stopAll();
  startAll();
}

/**
 * Schedule a specific job by ID (after add/update).
 */
export function scheduleJob(jobId: string): void {
  const job = getJob(jobId);
  if (job) {
    startJob(job);
  }
}

/**
 * Unschedule a specific job (after remove/pause).
 */
export function unscheduleJob(jobId: string): void {
  stopJob(jobId);
}

/**
 * Get next run time for a job.
 */
export function getNextRun(jobId: string): Date | null {
  const cron = activeCrons.get(jobId);
  if (!cron) return null;
  return cron.nextRun() ?? null;
}
