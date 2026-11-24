import mongoose from 'mongoose';
import { isCrmAdminOnly } from '../scripts/salesRoleTemplate';

const MARKER = 'sales-role-crm-admin-rights';
const CODES = ['sales', 'account_manager'];

/**
 * The CRM rights these starter roles were seeded with, frozen: five actions on seven records,
 * then campaigns, then commissions. Not derived from today's constants, which will keep changing.
 */
const ACTIONS = ['create', 'read', 'update', 'delete', 'list'];
const on = (...records: string[]) => records.flatMap((r) => ACTIONS.map((a) => `taskflow.crm.${r}.${a}`));
const FIRST = [...on('account', 'contact', 'lead', 'deal', 'quote', 'activity', 'contract'), 'taskflow.crm.report.read', 'taskflow.crm.settings.manage'];
const WITH_CAMPAIGNS = [...FIRST, ...on('campaign')];
const WITH_COMMISSIONS = [...WITH_CAMPAIGNS, 'taskflow.crm.commission.read', 'taskflow.crm.commission.manage'];
export const LEGACY_SALES_CRM = [FIRST, WITH_CAMPAIGNS, WITH_COMMISSIONS];

/** Read-only company and currency rights seeded alongside; they don't make a role "customised". */
const CORE_READ = ['taskflow.core.company.read', 'taskflow.core.currency.read', 'taskflow.core.exchange_rate.read'];

function isUntouched(permissions: string[]): boolean {
  const own = new Set(permissions.filter((p) => !CORE_READ.includes(p)));
  return LEGACY_SALES_CRM.some((legacy) => legacy.length === own.size && legacy.every((p) => own.has(p)));
}

/**
 * One-time: starter Sales / Account Manager roles could delete CRM records, change pipelines and approve
 * their own commission. Roles still exactly as seeded lose those rights. Customised ones are left alone and
 * reported, for an administrator to decide in Auth → Roles. Runs once, so rights given back later stay.
 */
export async function migrateSalesRolePermissionsIfNeeded(): Promise<void> {
  const db = mongoose.connection;
  const done = db.collection<{ _id: string; at: Date }>('migrations');
  if (await done.findOne({ _id: MARKER })) return;

  for await (const role of db.collection('roles').find({ code: { $in: CODES } })) {
    const permissions = Array.isArray(role.permissions) ? (role.permissions as string[]) : [];
    const risky = permissions.filter(isCrmAdminOnly);
    if (risky.length === 0) continue;
    if (isUntouched(permissions)) {
      await db.collection('roles').updateOne({ _id: role._id }, { $pull: { permissions: { $in: risky } } as never });
      console.log(`[migrate] role "${role.name}": removed ${risky.length} CRM admin right(s)`);
    } else {
      console.warn(`[migrate] role "${role.name}" is customised and was not changed. Review in Auth → Roles: ${risky.join(', ')}`);
    }
  }
  await done.updateOne({ _id: MARKER }, { $set: { at: new Date() } }, { upsert: true });
}
