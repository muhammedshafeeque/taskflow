import { addBusinessMinutes } from './desk.service';

const sched = { enabled: true, utcOffsetMinutes: 0, days: [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '17:00' })) };

describe('business-hours SLA clock', () => {
  it('counts only working time', () => {
    // Mon 5 Oct 2026 16:00 + 2h → Tue 10:00
    expect(addBusinessMinutes(new Date('2026-10-05T16:00:00Z'), 120, sched).toISOString()).toBe('2026-10-06T10:00:00.000Z');
  });
  it('starts the clock at opening time and skips weekends', () => {
    expect(addBusinessMinutes(new Date('2026-10-10T12:00:00Z'), 60, sched).toISOString()).toBe('2026-10-12T10:00:00.000Z'); // Sat → Mon
    expect(addBusinessMinutes(new Date('2026-10-05T07:00:00Z'), 30, sched).toISOString()).toBe('2026-10-05T09:30:00.000Z');
  });
  it('respects the UTC offset and falls back to wall-clock when disabled', () => {
    const ist = { ...sched, utcOffsetMinutes: 330 };
    // 03:30 UTC = 09:00 IST → +60 min = 10:00 IST = 04:30 UTC
    expect(addBusinessMinutes(new Date('2026-10-05T03:30:00Z'), 60, ist).toISOString()).toBe('2026-10-05T04:30:00.000Z');
    expect(addBusinessMinutes(new Date('2026-10-10T12:00:00Z'), 60, { ...sched, enabled: false }).toISOString()).toBe('2026-10-10T13:00:00.000Z');
  });
});
