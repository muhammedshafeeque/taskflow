import { computeCriticalPath } from './criticalPath';

describe('computeCriticalPath', () => {
  it('marks simple chain A→B→C as all critical', () => {
    const result = computeCriticalPath([
      { id: 'a', start: '2026-01-01', end: '2026-01-03', predecessors: [] },
      { id: 'b', start: '2026-01-04', end: '2026-01-06', predecessors: ['a'] },
      { id: 'c', start: '2026-01-07', end: '2026-01-10', predecessors: ['b'] },
    ]);
    expect(result.criticalIds.has('a')).toBe(true);
    expect(result.criticalIds.has('b')).toBe(true);
    expect(result.criticalIds.has('c')).toBe(true);
  });

  it('gives slack on parallel branch off critical path', () => {
    const result = computeCriticalPath([
      { id: 'a', start: '2026-01-01', end: '2026-01-05', predecessors: [] },
      { id: 'b', start: '2026-01-01', end: '2026-01-02', predecessors: [] },
      { id: 'c', start: '2026-01-06', end: '2026-01-08', predecessors: ['a', 'b'] },
    ]);
    expect(result.criticalIds.has('a')).toBe(true);
    expect(result.criticalIds.has('c')).toBe(true);
    expect(result.slackById.b).toBeGreaterThan(0);
  });
});
