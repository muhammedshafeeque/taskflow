import type { IProjectRule } from '../projects/project.model';
import { PROJECT_PERMISSIONS } from '../../shared/constants/permissions';

function rid(): string {
  return `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Default estimate-approval rule pack (soft lock). */
export function getDefaultEstimateApprovalRules(): IProjectRule[] {
  return [
    {
      id: rid(),
      name: 'Block work lane until estimate approved',
      enabled: true,
      order: 0,
      mode: 'enforce',
      trigger: 'issue.updated',
      conditions: [
        { field: 'status.enteringWorkLane', op: 'eq', value: true },
        { field: 'estimate.lanePending', op: 'eq', value: true },
      ],
      actions: [
        {
          type: 'deny',
          message: 'Cannot enter work lane until the lane estimate is approved',
          unlessPermission: PROJECT_PERMISSIONS.ISSUE.ESTIMATE.APPROVE,
        },
      ],
    },
    {
      id: rid(),
      name: 'Block work logs until lane estimate approved',
      enabled: true,
      order: 1,
      mode: 'enforce',
      trigger: 'worklog.creating',
      conditions: [{ field: 'estimate.lanePending', op: 'eq', value: true }],
      actions: [
        {
          type: 'deny',
          message: 'Cannot log time until the lane estimate is approved',
          unlessPermission: PROJECT_PERMISSIONS.ISSUE.ESTIMATE.APPROVE,
        },
      ],
    },
    {
      id: rid(),
      name: 'Require overrun reason',
      enabled: true,
      order: 2,
      mode: 'enforce',
      trigger: 'worklog.creating',
      conditions: [{ field: 'worklog.exceedsApproved', op: 'eq', value: true }],
      actions: [{ type: 'require_field', field: 'overrunReason' }],
    },
    {
      id: rid(),
      name: 'Notify on estimate submit',
      enabled: true,
      order: 3,
      mode: 'enforce',
      trigger: 'estimate.submitted',
      conditions: [],
      actions: [{ type: 'notify', eventKey: 'approval_requested' }],
    },
  ];
}

export const ESTIMATE_APPROVAL_RULE_PACK_NAME = 'Estimate approval (default)';
