import {
  EXPENSE_TRANSITIONS,
  assertExpenseTransitionPermission,
  assertValidExpenseTransition,
  evaluateExpenseApproval,
  resolveExpenseApproverLimit,
  type ExpenseApprovalSettings,
} from './expenseApproval';

const NONE: ExpenseApprovalSettings = { singleApproverLimit: null, maxClaimAmount: null, secondApproverIds: [], approverLimits: [] };
const APPROVE = 'taskflow.accounts.expense.approve';
const UPDATE = 'taskflow.accounts.expense.update';

describe('expense approval rules (AUT-26)', () => {
  it('allows only the defined status moves', () => {
    expect(assertValidExpenseTransition('submitted', 'approved')).toBe('approved');
    expect(() => assertValidExpenseTransition('draft', 'approved')).toThrow(/Cannot move/);
    expect(() => assertValidExpenseTransition('approved', 'draft')).toThrow(/Cannot move/);
    expect(() => assertValidExpenseTransition('submitted', 'nope')).toThrow(/Invalid expense status/);
    expect(EXPENSE_TRANSITIONS.paid).toEqual([]);
  });

  it('approving needs the approve permission, not update', () => {
    expect(() => assertExpenseTransitionPermission('submitted', 'approved', { userId: 'u', permissions: [UPDATE] })).toThrow();
    expect(() => assertExpenseTransitionPermission('submitted', 'approved', { userId: 'u', permissions: [APPROVE] })).not.toThrow();
    expect(() => assertExpenseTransitionPermission('approved', 'paid', { userId: 'u', permissions: [APPROVE] })).toThrow();
    // The claimant can submit their own draft without update rights.
    expect(() => assertExpenseTransitionPermission('draft', 'submitted', { userId: 'me', permissions: [] }, 'me')).not.toThrow();
    expect(() => assertExpenseTransitionPermission('draft', 'submitted', { userId: 'x', permissions: [] }, 'me')).toThrow();
  });

  it('blocks self-approval', () => {
    expect(() => evaluateExpenseApproval({ amount: 1, submittedBy: 'u', userId: 'u', settings: NONE })).toThrow(/own expense claim/);
  });

  it('applies max, personal and two-step limits', () => {
    const s: ExpenseApprovalSettings = {
      singleApproverLimit: 100,
      maxClaimAmount: 1000,
      secondApproverIds: ['b'],
      approverLimits: [{ roleId: 'r', maxAmount: 50 }, { userId: 'x', maxAmount: 500 }],
    };
    expect(() => evaluateExpenseApproval({ amount: 2000, userId: 'a', settings: s })).toThrow(/workspace limit/);
    expect(() => evaluateExpenseApproval({ amount: 60, userId: 'a', roleId: 'r', settings: s })).toThrow(/your approval limit/);
    expect(evaluateExpenseApproval({ amount: 60, userId: 'x', roleId: 'r', settings: s })).toBe('approved'); // user rule wins
    expect(evaluateExpenseApproval({ amount: 200, userId: 'a', settings: s })).toBe('first_stage');
    expect(() => evaluateExpenseApproval({ amount: 200, firstApprovedBy: 'a', userId: 'a', settings: s })).toThrow(/different person/);
    expect(() => evaluateExpenseApproval({ amount: 200, firstApprovedBy: 'a', userId: 'c', settings: s })).toThrow(/designated/);
    expect(evaluateExpenseApproval({ amount: 200, firstApprovedBy: 'a', userId: 'b', settings: s })).toBe('approved');
    expect(resolveExpenseApproverLimit('z', undefined, s.approverLimits)).toBeNull();
  });
});
