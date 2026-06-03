import { computeCriticalPath } from './criticalPath';

describe('computeCriticalPath (client)', () => {
  it('returns critical ids for linear dependency chain', () => {
    const { criticalIds } = computeCriticalPath([
      { id: '1', start: '2026-02-01', end: '2026-02-02', predecessors: [] },
      { id: '2', start: '2026-02-03', end: '2026-02-05', predecessors: ['1'] },
    ]);
    expect(criticalIds.has('1')).toBe(true);
    expect(criticalIds.has('2')).toBe(true);
  });
});
