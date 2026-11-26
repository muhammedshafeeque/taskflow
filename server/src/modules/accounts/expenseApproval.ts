/**
 * Expense claim approval rules (AUT-26): the status workflow, who may make each move,
 * self-approval, and the configurable amount limits. Pure functions so they can be unit tested.
 */
import { ApiError } from '../../utils/ApiError';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import { userHasPermission } from '../../shared/constants/legacyPermissionMap';
import type { ExpenseStatus } from './models/accountExpense.model';

const E = TASK_FLOW_PERMISSIONS.TASKFLOW.ACCOUNTS.EXPENSE;

/**
 * Allowed status moves. Approval can't be skipped, and approved/paid claims (already posted
 * to the ledger) can't be moved back. A rejected claim goes back to draft to be fixed and resubmitted.
 */
export const EXPENSE_TRANSITIONS: Record<ExpenseStatus, readonly ExpenseStatus[]> = {
  draft: ['submitted'],
  submitted: ['approved', 'rejected', 'draft'],
  approved: ['paid'],
  rejected: ['draft'],
  paid: [],
};

export const EXPENSE_STATUSES = Object.keys(EXPENSE_TRANSITIONS) as ExpenseStatus[];

/** Statuses in which the claim's details can still be edited. */
export const EDITABLE_EXPENSE_STATUSES: readonly ExpenseStatus[] = ['draft', 'submitted', 'rejected'];

export interface ExpenseApproverLimit {
  userId?: string;
  roleId?: string;
  maxAmount: number;
}

export interface ExpenseApprovalSettings {
  /** Claims above this need two approvals from two different people. null = one approval. */
  singleApproverLimit: number | null;
  /** Claims above this can't be submitted or approved at all. null = no limit. */
  maxClaimAmount: number | null;
  /** When set, only these people can give the second approval. */
  secondApproverIds: string[];
  /** Per-person or per-role ceiling on what they can approve. */
  approverLimits: ExpenseApproverLimit[];
}

export const EMPTY_EXPENSE_APPROVAL_SETTINGS: ExpenseApprovalSettings = {
  singleApproverLimit: null,
  maxClaimAmount: null,
  secondApproverIds: [],
  approverLimits: [],
};

export interface ExpenseActor {
  userId: string;
  roleId?: string;
  /** Effective permissions; undefined skips the permission check (internal callers). */
  permissions?: string[];
}

export function assertValidExpenseStatus(status: unknown): ExpenseStatus {
  if (typeof status !== 'string' || !EXPENSE_STATUSES.includes(status as ExpenseStatus)) {
    throw new ApiError(400, `Invalid expense status. Use one of: ${EXPENSE_STATUSES.join(', ')}`);
  }
  return status as ExpenseStatus;
}

export function assertValidExpenseTransition(current: ExpenseStatus, next: unknown): ExpenseStatus {
  const status = assertValidExpenseStatus(next);
  if (!EXPENSE_TRANSITIONS[current]?.includes(status)) {
    throw new ApiError(400, `Cannot move an expense from ${current} to ${status}`);
  }
  return status;
}

/** Who may make each move. The claimant can submit, withdraw and reopen their own claim. */
export function assertExpenseTransitionPermission(
  current: ExpenseStatus,
  next: ExpenseStatus,
  actor: ExpenseActor,
  submittedBy?: string | null
): void {
  const perms = actor.permissions;
  if (!perms) return;
  const has = (...codes: string[]) => codes.some((c) => userHasPermission(perms, c));
  const isClaimant = Boolean(submittedBy && String(submittedBy) === String(actor.userId));

  if (current === 'submitted' && (next === 'approved' || next === 'rejected')) {
    if (!has(E.APPROVE)) throw new ApiError(403, 'You need the expense approve permission to approve or reject claims');
    return;
  }
  if (current === 'submitted' && next === 'draft') {
    if (!isClaimant && !has(E.APPROVE)) throw new ApiError(403, 'Only the claimant or an approver can send this claim back to draft');
    return;
  }
  if ((current === 'draft' && next === 'submitted') || (current === 'rejected' && next === 'draft')) {
    if (!isClaimant && !has(E.UPDATE)) throw new ApiError(403, 'Insufficient permissions');
    return;
  }
  if (current === 'approved' && next === 'paid') {
    if (!has(E.UPDATE)) throw new ApiError(403, 'You need the expense update permission to mark claims paid');
    return;
  }
  throw new ApiError(403, 'Insufficient permissions');
}

export function assertWithinMaxClaim(amount: number, settings: ExpenseApprovalSettings): void {
  if (settings.maxClaimAmount != null && amount > settings.maxClaimAmount) {
    throw new ApiError(400, `Expense amount (${amount}) exceeds the workspace limit (${settings.maxClaimAmount})`);
  }
}

/** An explicit per-user limit wins over a role limit. null = no personal limit. */
export function resolveExpenseApproverLimit(
  userId: string,
  roleId: string | undefined,
  limits: ExpenseApproverLimit[]
): number | null {
  const byUser = limits.find((l) => l.userId && l.userId === userId);
  if (byUser) return byUser.maxAmount;
  if (roleId) {
    const byRole = limits.find((l) => l.roleId && l.roleId === roleId);
    if (byRole) return byRole.maxAmount;
  }
  return null;
}

/**
 * Decide what an "approve" click does: record the first of two approvals, or fully approve.
 * Throws when the approver is the claimant, is over their limit, or is not allowed to give the second approval.
 */
export function evaluateExpenseApproval(params: {
  amount: number;
  submittedBy?: string | null;
  firstApprovedBy?: string | null;
  userId: string;
  roleId?: string;
  settings: ExpenseApprovalSettings;
}): 'first_stage' | 'approved' {
  const { amount, submittedBy, firstApprovedBy, userId, roleId, settings } = params;
  if (submittedBy && String(submittedBy) === String(userId)) {
    throw new ApiError(403, 'You cannot approve your own expense claim');
  }
  assertWithinMaxClaim(amount, settings);

  const userLimit = resolveExpenseApproverLimit(String(userId), roleId, settings.approverLimits);
  if (userLimit != null && amount > userLimit) {
    throw new ApiError(403, `Expense amount (${amount}) exceeds your approval limit (${userLimit})`);
  }

  const needsTwo = settings.singleApproverLimit != null && amount > settings.singleApproverLimit;
  if (!needsTwo) return 'approved';
  if (!firstApprovedBy) return 'first_stage';

  if (String(firstApprovedBy) === String(userId)) {
    throw new ApiError(403, `A different person must give the second approval for claims above ${settings.singleApproverLimit}`);
  }
  if (settings.secondApproverIds.length > 0 && !settings.secondApproverIds.includes(String(userId))) {
    throw new ApiError(403, `Only designated second approvers can approve claims above ${settings.singleApproverLimit}`);
  }
  return 'approved';
}
