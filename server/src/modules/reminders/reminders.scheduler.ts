import { REMINDER_JOBS, type ReminderJobName } from './reminders.service';

/** How often each job runs. SLA needs to be tight; renewals can be lazy. */
const INTERVALS_MS: Record<ReminderJobName, number> = {
  sla: 5 * 60 * 1000,
  crmFollowUps: 10 * 60 * 1000,
  issueDueDates: 15 * 60 * 1000,
  milestones: 60 * 60 * 1000,
  staleDeals: 6 * 60 * 60 * 1000,
  renewals: 6 * 60 * 60 * 1000,
  subscriptionInvoices: 60 * 60 * 1000,
  overdueInvoices: 60 * 60 * 1000,
};

const lastRun = new Map<ReminderJobName, number>();
const running = new Set<ReminderJobName>();
let timer: NodeJS.Timeout | null = null;

export async function runReminderJob(name: ReminderJobName): Promise<number> {
  if (running.has(name)) return 0;
  running.add(name);
  try {
    const count = await REMINDER_JOBS[name]();
    if (count) console.log(`reminders:${name} sent ${count}`);
    return count;
  } finally {
    lastRun.set(name, Date.now());
    running.delete(name);
  }
}

function tick() {
  const now = Date.now();
  for (const name of Object.keys(REMINDER_JOBS) as ReminderJobName[]) {
    if (now - (lastRun.get(name) ?? 0) < INTERVALS_MS[name]) continue;
    runReminderJob(name).catch((err) => console.error(`reminders:${name}`, err));
  }
}

export function startReminderScheduler(): void {
  if (process.env.REMINDERS_ENABLED === 'false' || timer) return;
  // Stagger the first run so startup isn't competing with migrations/connections.
  setTimeout(tick, 60_000);
  timer = setInterval(tick, 60_000);
}

export function getReminderSchedulerStatus() {
  return (Object.keys(REMINDER_JOBS) as ReminderJobName[]).map((name) => ({
    name,
    intervalMinutes: INTERVALS_MS[name] / 60_000,
    lastRunAt: lastRun.has(name) ? new Date(lastRun.get(name) as number).toISOString() : null,
    running: running.has(name),
  }));
}
