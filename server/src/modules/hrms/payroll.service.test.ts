import { computePayslip, isValidPeriod } from './payroll.service';
import { DEFAULT_COMPONENTS } from './models/hrmsPayroll.model';

describe('payroll maths', () => {
  it('splits CTC into components and a balancing allowance', () => {
    const p = computePayslip({ monthlyCtc: 100_000, components: DEFAULT_COMPONENTS, workingDays: 22, lopDays: 0 });
    expect(p.earnings).toEqual([
      { name: 'Basic', amount: 50_000 },
      { name: 'HRA', amount: 20_000 },
      { name: 'Special allowance', amount: 30_000 },
    ]);
    expect(p.gross).toBe(100_000);
    expect(p.net).toBe(100_000);
  });

  it('pro-rates loss of pay and applies deductions and adjustments', () => {
    const p = computePayslip({
      monthlyCtc: 22_000,
      components: [
        { name: 'Basic', kind: 'earning', calc: 'percent_of_ctc', value: 100 },
        { name: 'PF', kind: 'deduction', calc: 'percent_of_basic', value: 12 },
      ],
      workingDays: 22,
      lopDays: 2,
      adjustments: [{ name: 'Bonus', amount: 1000, kind: 'earning' }],
    });
    expect(p.earnings[0]).toEqual({ name: 'Basic', amount: 20_000 });
    expect(p.deductions).toEqual([{ name: 'PF', amount: 2400 }]);
    expect(p.gross).toBe(21_000);
    expect(p.net).toBe(18_600);
  });

  it('validates periods', () => {
    expect(isValidPeriod('2026-10')).toBe(true);
    expect(isValidPeriod('2026-13')).toBe(false);
    expect(isValidPeriod('26-1')).toBe(false);
  });
});
