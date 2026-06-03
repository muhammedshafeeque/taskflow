import { normalizeSchedulingDependencies } from './timelineDependencies';

describe('normalizeSchedulingDependencies', () => {
  const ids = new Set(['a', 'b', 'c']);

  it('maps blocks to predecessor → dependent', () => {
    const edges = normalizeSchedulingDependencies(
      [{ sourceIssue: 'a', targetIssue: 'b', linkType: 'blocks' }],
      ids
    );
    expect(edges).toEqual([{ from: 'b', to: 'a' }]);
  });

  it('maps is_blocked_by to predecessor → dependent', () => {
    const edges = normalizeSchedulingDependencies(
      [{ sourceIssue: 'b', targetIssue: 'a', linkType: 'is_blocked_by' }],
      ids
    );
    expect(edges).toEqual([{ from: 'b', to: 'a' }]);
  });

  it('ignores relates_to', () => {
    const edges = normalizeSchedulingDependencies(
      [{ sourceIssue: 'a', targetIssue: 'b', linkType: 'relates_to' }],
      ids
    );
    expect(edges).toHaveLength(0);
  });
});
