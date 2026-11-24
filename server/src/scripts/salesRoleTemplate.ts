import { flattenPermissions, TASK_FLOW_PERMISSIONS } from '../shared/constants/permissions';

const CRM = TASK_FLOW_PERMISSIONS.TASKFLOW.CRM;

/** Kept for CRM Admin: reshaping pipelines, deciding commission, destroying records. */
export function isCrmAdminOnly(permission: string): boolean {
  return (
    permission === CRM.SETTINGS.MANAGE ||
    permission === CRM.COMMISSION.MANAGE ||
    (permission.startsWith('taskflow.crm.') && permission.endsWith('.delete'))
  );
}

export const ALL_CRM_PERMISSIONS = flattenPermissions(CRM as unknown as Record<string, unknown>);

/** CRM rights of the starter Sales and Account Manager roles. */
export const SALES_CRM_PERMISSIONS = ALL_CRM_PERMISSIONS.filter((p) => !isCrmAdminOnly(p));
