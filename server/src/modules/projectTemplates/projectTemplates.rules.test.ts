import { getDefaultEstimateApprovalRules } from '../projectRules/projectRules.defaultPack';

describe('project template rule snapshots', () => {
  it('default estimate approval pack has expected rule count and triggers', () => {
    const rules = getDefaultEstimateApprovalRules();
    expect(rules.length).toBe(4);
    expect(rules.some((r) => r.trigger === 'issue.updated')).toBe(true);
    expect(rules.some((r) => r.trigger === 'worklog.creating')).toBe(true);
    expect(rules.some((r) => r.trigger === 'estimate.submitted')).toBe(true);
    expect(rules.every((r) => r.enabled)).toBe(true);
  });
});
