import { assertValidPoTransition, evaluatePoApproval, resolveUserApprovalLimit, type ProcurementSettingsValues } from './procurement.service';

const baseSettings: ProcurementSettingsValues = {
  singleApproverLimit: null,
  maxOrderAmount: null,
  secondApproverIds: [],
  approverLimits: [],
};

describe('procurement PO state machine & approval policy (AUT-25)', () => {
  it('allows only valid status transitions', () => {
    expect(assertValidPoTransition('draft', 'pending_approval')).toBe('pending_approval');
    expect(assertValidPoTransition('draft', 'cancelled')).toBe('cancelled');
    expect(assertValidPoTransition('pending_approval', 'approved')).toBe('approved');
    expect(assertValidPoTransition('pending_approval', 'draft')).toBe('draft');
    expect(assertValidPoTransition('pending_approval', 'cancelled')).toBe('cancelled');
    expect(assertValidPoTransition('approved', 'ordered')).toBe('ordered');
    expect(assertValidPoTransition('ordered', 'received')).toBe('received');

    for (const [from, to] of [
      ['draft', 'approved'],
      ['draft', 'ordered'],
      ['draft', 'received'],
      ['draft', 'draft'],
      ['pending_approval', 'ordered'],
      ['pending_approval', 'received'],
      ['approved', 'received'],
      ['approved', 'pending_approval'],
      ['received', 'cancelled'],
      ['received', 'draft'],
      ['cancelled', 'draft'],
      ['cancelled', 'approved'],
    ] as const) {
      expect(() => assertValidPoTransition(from, to)).toThrow(/Cannot transition purchase order/);
    }
    expect(() => assertValidPoTransition('draft', 'bogus')).toThrow('Invalid status');
  });

  it('forbids the creator from approving their own order', () => {
    expect(() =>
      evaluatePoApproval({ total: 100, requestedBy: 'u1', userId: 'u1', settings: baseSettings })
    ).toThrow('The creator of a purchase order cannot approve it');
  });

  it('requires two distinct approvers above singleApproverLimit and honors secondApproverIds', () => {
    const settings: ProcurementSettingsValues = {
      ...baseSettings,
      singleApproverLimit: 1000,
      secondApproverIds: ['farah'],
    };

    expect(
      evaluatePoApproval({ total: 1000, requestedBy: 'abel', userId: 'alma', settings })
    ).toBe('approved');

    expect(
      evaluatePoApproval({ total: 1500, requestedBy: 'abel', userId: 'alma', settings })
    ).toBe('first_stage');

    expect(() =>
      evaluatePoApproval({ total: 1500, requestedBy: 'abel', firstApprovedBy: 'alma', userId: 'alma', settings })
    ).toThrow('A different user must provide the second approval');

    expect(() =>
      evaluatePoApproval({ total: 1500, requestedBy: 'abel', firstApprovedBy: 'alma', userId: 'other', settings })
    ).toThrow('Only designated second approvers');

    expect(
      evaluatePoApproval({ total: 1500, requestedBy: 'abel', firstApprovedBy: 'alma', userId: 'farah', settings })
    ).toBe('approved');
  });

  it('enforces per-user and per-role approval limits with user overriding role', () => {
    const settings: ProcurementSettingsValues = {
      ...baseSettings,
      approverLimits: [
        { roleId: 'role-mgr', maxAmount: 2000 },
        { userId: 'alma', maxAmount: 1000 },
      ],
    };

    expect(resolveUserApprovalLimit('alma', 'role-mgr', settings.approverLimits)).toBe(1000);
    expect(resolveUserApprovalLimit('bob', 'role-mgr', settings.approverLimits)).toBe(2000);
    expect(resolveUserApprovalLimit('farah', 'role-exec', settings.approverLimits)).toBeNull();

    expect(() =>
      evaluatePoApproval({ total: 1500, requestedBy: 'abel', userId: 'alma', roleId: 'role-mgr', settings })
    ).toThrow('exceeds your approval limit (1000)');

    expect(
      evaluatePoApproval({ total: 1500, requestedBy: 'abel', userId: 'bob', roleId: 'role-mgr', settings })
    ).toBe('approved');
  });
});
