import { accruedAllocation, countWorkingDays, leaveYearOf } from './policy.service';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('hr policy maths', () => {
  it('counts working days without weekends and holidays', () => {
    // Mon 5 Oct 2026 → Sun 11 Oct 2026, Sat/Sun off, Fri 9 Oct a holiday
    expect(countWorkingDays(d('2026-10-05'), d('2026-10-11'), [0, 6], new Set(['2026-10-09']))).toBe(4);
    expect(countWorkingDays(d('2026-10-05'), d('2026-10-05'), [0, 6], new Set(), true)).toBe(0.5);
    expect(countWorkingDays(d('2026-10-10'), d('2026-10-11'), [0, 6], new Set())).toBe(0);
  });

  it('finds the leave year for a custom start month', () => {
    expect(leaveYearOf(d('2026-03-15'), 4)).toBe(2025);
    expect(leaveYearOf(d('2026-04-01'), 4)).toBe(2026);
    expect(leaveYearOf(d('2026-12-31'), 1)).toBe(2026);
  });

  it('accrues monthly and pro-rates mid-year joiners', () => {
    const yearStart = d('2026-01-01');
    expect(accruedAllocation({ annualAllowance: 12, accrual: 'monthly' }, d('2026-03-10'), yearStart)).toBe(3);
    expect(accruedAllocation({ annualAllowance: 12, accrual: 'yearly' }, d('2026-03-10'), yearStart)).toBe(12);
    expect(accruedAllocation({ annualAllowance: 12, accrual: 'yearly' }, d('2026-08-01'), yearStart, d('2026-07-15'))).toBe(6);
  });
});
