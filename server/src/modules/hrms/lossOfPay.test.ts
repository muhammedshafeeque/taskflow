import { calendarDay, lossOfPayDays, type Absence, type UnpaidLeave } from './lossOfPay';

// December 2026: the 1st is a Tuesday; 5–6 and 12–13 are weekends.
const cal = (holidays: string[] = []) => ({ from: '2026-12-01', to: '2027-01-01', weekendDays: [0, 6], holidaysFor: () => new Set(holidays) });
const utc = (d: string) => new Date(`${d}T00:00:00Z`);
const ist = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 5.5 * 3_600_000); // local midnight in India
const absent = (date: Date, status: Absence['status'] = 'absent'): Absence => ({ employeeId: 'e', date, status });
const leave = (from: string, to: string, halfDay = false): UnpaidLeave => ({ employeeId: 'e', startDate: utc(from), endDate: utc(to), halfDay });
const lop = (a: Absence[], l: UnpaidLeave[], holidays?: string[]) => lossOfPayDays(a, l, cal(holidays)).get('e') ?? 0;

describe('loss of pay (AUT-17)', () => {
  it('counts a day that is both unpaid leave and absent once', () => {
    expect(lop([absent(utc('2026-12-02'))], [leave('2026-12-02', '2026-12-02')])).toBe(1);
    expect(lop([absent(utc('2026-12-02')), absent(utc('2026-12-03'))], [leave('2026-12-02', '2026-12-04')])).toBe(3);
  });

  it('matches HR attendance saved at local midnight with leave on the same date', () => {
    expect(calendarDay(ist('2026-12-02'))).toBe('2026-12-02');
    expect(calendarDay(new Date('2026-12-02T05:00:00Z'))).toBe('2026-12-02'); // UTC−5 midnight
    expect(lop([absent(ist('2026-12-02'))], [leave('2026-12-02', '2026-12-02')])).toBe(1);
  });

  it('handles half days: never more than the larger share of a date', () => {
    expect(lop([absent(utc('2026-12-02'), 'half_day')], [])).toBe(0.5);
    expect(lop([], [leave('2026-12-02', '2026-12-02', true)])).toBe(0.5);
    expect(lop([absent(utc('2026-12-02'), 'half_day')], [leave('2026-12-02', '2026-12-02', true)])).toBe(0.5);
    expect(lop([absent(utc('2026-12-02'))], [leave('2026-12-02', '2026-12-02', true)])).toBe(1);
    expect(lop([absent(utc('2026-12-02'), 'half_day')], [leave('2026-12-02', '2026-12-02')])).toBe(1);
    expect(lop([], [leave('2026-12-02', '2026-12-03', true)])).toBe(2); // half day ignored on longer requests
  });

  it('skips weekends and holidays inside leave, and stops at the month edges', () => {
    expect(lop([], [leave('2026-12-04', '2026-12-08')])).toBe(3); // Fri, Mon, Tue
    expect(lop([], [leave('2026-12-07', '2026-12-08')], ['2026-12-08'])).toBe(1);
    expect(lop([], [leave('2026-11-30', '2026-12-01')])).toBe(1);
    expect(lop([absent(ist('2026-12-01')), absent(utc('2027-01-01'))], [])).toBe(1);
  });

  it('keeps people apart', () => {
    const r = lossOfPayDays([absent(utc('2026-12-02')), { employeeId: 'f', date: utc('2026-12-02'), status: 'absent' }], [], cal());
    expect([...r]).toEqual([['e', 1], ['f', 1]]);
  });
});
