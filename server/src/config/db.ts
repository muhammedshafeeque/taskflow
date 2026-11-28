import mongoose from 'mongoose';
import { env } from './env';
import { migrateNotificationSchemaIfNeeded } from '../migrations/migrateNotificationSchema';
import { migrateTaskNotificationEmailDefaultsIfNeeded } from '../migrations/migrateTaskNotificationEmailDefaults';
import { migrateFixVersionToArrayIfNeeded } from '../migrations/migrateFixVersionToArray';
import { migrateOrganizationTenancyIfNeeded } from '../migrations/migrateOrganizationTenancy';
import { migrateUserOAuthIndexesIfNeeded } from '../migrations/migrateUserOAuthIndexes';
import { migrateProjectMemberCommentPermissionsIfNeeded } from '../migrations/migrateProjectMemberCommentPermissions';
import { migrateAttendanceDaysIfNeeded } from '../migrations/migrateAttendanceDays';
import { migrateExpenseApprovePermissionIfNeeded } from '../migrations/migrateExpenseApprovePermission';
import { migrateSalesRolePermissionsIfNeeded } from '../migrations/migrateSalesRolePermissions';
import { migrateCrmScopesIfNeeded, migrateDataScopesIfNeeded, migrateIssueKeyIndexIfNeeded, migratePayrollApproveIfNeeded } from '../migrations/migrateDataScopes';
import '../modules/projects/projectDesignation.model';
import '../modules/organizations/organization.model';
import '../modules/organizations/organizationMember.model';
import '../modules/auth/user.model';

export async function connectDb(): Promise<void> {
  await mongoose.connect(env.mongodbUri);
  console.log('Connected to MongoDB');
  await migrateNotificationSchemaIfNeeded().catch((e) => console.error('[migrate] notifications failed:', e));
  await migrateTaskNotificationEmailDefaultsIfNeeded().catch((e) =>
    console.error('[migrate] task notification email defaults failed:', e)
  );
  await migrateFixVersionToArrayIfNeeded().catch((e) =>
    console.error('[migrate] fixVersion to array failed:', e)
  );
  await migrateOrganizationTenancyIfNeeded().catch((e) => console.error('[migrate] organizations failed:', e));
  await migrateUserOAuthIndexesIfNeeded().catch((e) => console.error('[migrate] users OAuth indexes failed:', e));
  await migrateProjectMemberCommentPermissionsIfNeeded().catch((e) =>
    console.error('[migrate] project member comment permissions failed:', e)
  );
  await migrateAttendanceDaysIfNeeded().catch((e) => console.error('[migrate] attendance days failed:', e));
  await migrateSalesRolePermissionsIfNeeded().catch((e) => console.error('[migrate] sales role permissions failed:', e));
  await migrateDataScopesIfNeeded().catch((e) => console.error('[migrate] data scopes failed:', e));
  await migrateCrmScopesIfNeeded().catch((e) => console.error('[migrate] CRM scopes failed:', e));
  await migratePayrollApproveIfNeeded().catch((e) => console.error('[migrate] payroll approve failed:', e));
  await migrateIssueKeyIndexIfNeeded().catch((e) => console.error('[migrate] issue key index failed:', e));
  await migrateExpenseApprovePermissionIfNeeded().catch((e) => console.error('[migrate] expense approve permission failed:', e));
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
