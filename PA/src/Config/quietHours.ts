import type { QuietHours } from '../Models/BotSettings';

export const DEFAULT_QUIET_HOURS: QuietHours = {
  enabled: false,
  start: '22:00',
  end: '08:00',
  timezone: 'Asia/Kolkata',
  awayMessage: '',
};

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidHhmm(v: unknown): v is string {
  return typeof v === 'string' && HHMM.test(v);
}

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Minutes since local midnight in the given IANA timezone. */
export function localMinutes(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

/** True when `now` falls inside the quiet window (start inclusive, end exclusive). */
export function isQuietNow(qh: QuietHours | undefined, now = new Date()): boolean {
  if (!qh?.enabled || !isValidHhmm(qh.start) || !isValidHhmm(qh.end)) return false;
  const start = minutes(qh.start);
  const end = minutes(qh.end);
  if (start === end) return false;
  const tz = isValidTimezone(qh.timezone) ? qh.timezone : DEFAULT_QUIET_HOURS.timezone;
  const t = localMinutes(now, tz);
  return start < end ? t >= start && t < end : t >= start || t < end;
}
