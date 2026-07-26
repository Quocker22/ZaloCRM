// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * bulk-campaign-cron.ts — runs enabled "Chiến dịch gửi hàng loạt" auto-send schedules.
 * Every hour it sweeps bulk_campaign_schedules for rows enabled AND not run since the
 * start of today, and runs ONE batch each (respecting per-day + daily-cap throttling
 * inside the batch functions). Idempotent start; mutex so overlapping ticks skip.
 */
import cron from 'node-cron';
import { logger } from '../../shared/utils/logger.js';
import { runScheduleCycle } from './bulk-campaign-service.js';

// Hourly. A schedule runs at most once/day (guarded by last_run_at < start-of-today),
// so an hourly sweep just means "send today's batch whenever the nick is first ready".
const CRON_SCHEDULE = '15 * * * *'; // every hour at :15

let cronTask: ReturnType<typeof cron.schedule> | null = null;
let running = false;

export function startBulkCampaignCron(): void {
  if (cronTask) { logger.info('[bulk-campaign-cron] Already started, skipping'); return; }
  cronTask = cron.schedule(CRON_SCHEDULE, async () => {
    if (running) { logger.warn('[bulk-campaign-cron] Previous cycle still running, skipping'); return; }
    running = true;
    const startedAt = Date.now();
    try {
      const { ran, totalSent } = await runScheduleCycle();
      if (ran > 0) logger.info(`[bulk-campaign-cron] Ran ${ran} schedule(s), sent ${totalSent} in ${Date.now() - startedAt}ms`);
    } catch (err) {
      logger.error('[bulk-campaign-cron] Cycle error:', err);
    } finally {
      running = false;
    }
  });
  logger.info(`[bulk-campaign-cron] Started, schedule="${CRON_SCHEDULE}"`);
}
