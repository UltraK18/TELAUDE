import { Cron } from 'croner';
import { getAllJobs, type CronJob } from './cron-store.js';
import { logger } from '../utils/logger.js';

interface MissedJob {
  job: CronJob;
  missedAt: Date;
}

/**
 * Detect recurring cron jobs that missed their scheduled run during downtime.
 * Only checks jobs that:
 * 1. Are not paused
 * 2. Are not one-time (once=false)
 * 3. Have a valid cron schedule
 * 4. Last history entry is older than the most recent scheduled run
 *
 * @param maxStalenessMs — ignore jobs missed more than this long ago (default 24h)
 */
export function detectMissedJobs(maxStalenessMs = 24 * 60 * 60 * 1000): MissedJob[] {
  const jobs = getAllJobs();
  const now = new Date();
  const missed: MissedJob[] = [];

  for (const job of jobs) {
    if (job.isPaused || job.once) continue;
    if (!job.schedule) continue;

    try {
      // Use croner to find what the previous run should have been
      const cron = new Cron(job.schedule);
      const prev = cron.previousRun();
      if (!prev) continue;

      // Check if it's within staleness window
      const staleMs = now.getTime() - prev.getTime();
      if (staleMs > maxStalenessMs) continue;

      // Check if the last history entry covers this run
      const lastRun = job.history.length > 0
        ? new Date(job.history[job.history.length - 1].timestamp)
        : null;

      if (!lastRun || lastRun < prev) {
        missed.push({ job, missedAt: prev });
        logger.info({ jobId: job.id, name: job.name, missedAt: prev.toISOString() }, 'Missed job detected');
      }
    } catch {
      // Invalid cron expression — skip
    }
  }

  return missed;
}

/**
 * Format missed jobs as a notification message.
 */
export function formatMissedJobsMessage(missed: MissedJob[]): string | null {
  if (missed.length === 0) return null;

  const lines = missed.map(m => {
    const ago = formatAgo(Date.now() - m.missedAt.getTime());
    return `• ${m.job.name} (missed ${ago} ago, archived)`;
  });

  return `⚠️ ${missed.length} scheduled job(s) missed during downtime:\n${lines.join('\n')}`;
}

function formatAgo(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
