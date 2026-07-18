import { mailSyncIntervalMs } from './posteio.adapter';
import { syncAllMailboxes } from './imapSync.worker';
import { checkSlaBreaches } from '../service-desk/tickets.service';
import { runStaleDealAlerts } from '../crm/ecosystem/ecosystem.service';
import { Organization } from '../organizations/organization.model';

let mailTimer: ReturnType<typeof setInterval> | null = null;
let ecosystemTimer: ReturnType<typeof setInterval> | null = null;

async function runEcosystemJobs(): Promise<void> {
  const orgs = await Organization.find({ status: 'active' }).select('_id').lean();
  for (const org of orgs) {
    const id = String(org._id);
    try {
      await checkSlaBreaches(id);
      await runStaleDealAlerts(id);
    } catch (err) {
      console.error('[ecosystem] job failed for org', id, err);
    }
  }
}

export function startMailSyncScheduler(): void {
  if (mailTimer) return;
  const interval = Math.max(15000, mailSyncIntervalMs);
  mailTimer = setInterval(() => {
    syncAllMailboxes().catch((err) => console.error('[mail] scheduler error:', err));
  }, interval);
  ecosystemTimer = setInterval(() => {
    runEcosystemJobs().catch((err) => console.error('[ecosystem] scheduler error:', err));
  }, interval * 5);
  console.log(`[mail] sync scheduler started (interval ${interval}ms)`);
}
