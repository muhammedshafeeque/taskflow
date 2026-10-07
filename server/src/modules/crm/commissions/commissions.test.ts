import { commissionFor } from './commissions';

describe('commissionFor', () => {
  it('applies a flat rate', () => {
    expect(commissionFor(10000, { ratePct: 5 })).toBe(500);
  });
  it('applies marginal tiers', () => {
    const plan = { tiers: [{ from: 0, ratePct: 5 }, { from: 100000, ratePct: 10 }] };
    expect(commissionFor(50000, plan)).toBe(2500);
    expect(commissionFor(150000, plan)).toBe(5000 + 5000);
  });
});
