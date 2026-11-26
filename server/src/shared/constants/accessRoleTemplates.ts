import { ALL_TASK_FLOW_PERMISSIONS, flattenPermissions, TASK_FLOW_PERMISSIONS } from './permissions';

const { AUTH, ORG, TASKFLOW } = TASK_FLOW_PERMISSIONS;
const all = (o: object) => flattenPermissions(o as Record<string, unknown>);

export interface RoleTemplate {
  code: string;
  name: string;
  description: string;
  permissions: string[];
}

/** Runs the platform — people, roles, settings, audit — without seeing pay, finance or customers. */
export const SYSTEM_ADMIN_PERMISSIONS: string[] = [
  ...all(AUTH),
  ...all(ORG),
  ...all(TASKFLOW.CORE),
  ...all(TASKFLOW.SELF),
  TASKFLOW.PLATFORM.SETTINGS.MANAGE,
  TASKFLOW.PLATFORM.ANNOUNCEMENT.MANAGE,
  TASKFLOW.PLATFORM.AUDIT.READ,
  TASKFLOW.LICENSE.VIEW,
];

const VIEW = /\.(read|list|view|list_all)$/;
/** Individual pay, and personal mailboxes, are added on purpose or not at all. */
const PRIVATE = [...all(TASKFLOW.HR.PAYROLL), ...all(TASKFLOW.HR.SALARY), ...all(TASKFLOW.MAIL)];

/** Views every business module and edits none (own self-service excepted). New view permissions join by themselves. */
export const EXECUTIVE_PERMISSIONS: string[] = [
  ...new Set([
    ...ALL_TASK_FLOW_PERMISSIONS.filter((p) => VIEW.test(p) && !PRIVATE.includes(p)),
    ...all(TASKFLOW.SELF),
    // What the views reach: the whole company.
    TASKFLOW.HR.SCOPE.ALL,
    TASKFLOW.TIMESHEET.SCOPE.ALL,
  ]),
];

/** Starting points offered when creating a role; what is saved is an ordinary, editable role. */
export const ACCESS_ROLE_TEMPLATES: RoleTemplate[] = [
  { code: 'system_admin', name: 'System Admin', description: 'Users, roles, settings and audit. No payroll, finance or CRM.', permissions: SYSTEM_ADMIN_PERMISSIONS },
  { code: 'executive', name: 'Executive (read-only)', description: 'Views every business module and all projects, edits none. No individual pay.', permissions: EXECUTIVE_PERMISSIONS },
];
