import mongoose from 'mongoose';
import { permissionToDot } from '../shared/constants/legacyPermissionMap';

const MARKER = 'data-scopes-v1';
const HR_ALL = 'taskflow.hr.scope.all';
const TIMESHEET_ALL = 'taskflow.timesheet.scope.all';
const TIMESHEET_APPROVE = 'taskflow.timesheet.approve';

/** Scope codes to add so a permission list keeps reaching everyone, as it did before scopes existed. */
export function scopesToKeep(permissions: string[]): string[] {
  const dots = permissions.map(permissionToDot);
  const has = (code: string) => dots.includes(code);
  const add: string[] = [];
  const hr = dots.some((p) => p.startsWith('taskflow.hr.') && !p.startsWith('taskflow.hr.scope.'));
  if (hr && !has(HR_ALL) && !has('taskflow.hr.*')) add.push(HR_ALL);
  if (has(TIMESHEET_APPROVE) && !has(TIMESHEET_ALL) && !has('taskflow.timesheet.*')) add.push(TIMESHEET_ALL);
  return add;
}

/**
 * One-time: HR permissions and timesheet approval used to reach the whole workspace. Since data scopes, a role
 * reaches only as far as its scope codes say (none = own record). Existing roles, and people's extra permissions,
 * get "reach everyone" so nothing changes for them; administrators can narrow them in Auth → Roles.
 */
export async function migrateDataScopesIfNeeded(): Promise<{ roles: number; users: number }> {
  const db = mongoose.connection;
  const done = db.collection<{ _id: string; at: Date }>('appmigrations');
  if (await done.findOne({ _id: MARKER })) return { roles: 0, users: 0 };
  let roles = 0;
  let users = 0;
  for await (const r of db.collection('roles').find({}, { projection: { permissions: 1 } })) {
    const add = scopesToKeep((r.permissions as string[]) ?? []);
    if (add.length) {
      await db.collection('roles').updateOne({ _id: r._id }, { $addToSet: { permissions: { $each: add } } });
      roles++;
    }
  }
  for await (const u of db.collection('users').find({ 'permissionOverrides.granted.0': { $exists: true } }, { projection: { permissionOverrides: 1 } })) {
    const add = scopesToKeep((u.permissionOverrides?.granted as string[]) ?? []);
    if (add.length) {
      await db.collection('users').updateOne({ _id: u._id }, { $addToSet: { 'permissionOverrides.granted': { $each: add } } });
      users++;
    }
  }
  await done.updateOne({ _id: MARKER }, { $set: { at: new Date(), roles, users } }, { upsert: true });
  if (roles || users) console.log(`[migrate] data scopes: ${roles} role(s) and ${users} user(s) keep reaching everyone`);
  return { roles, users };
}

const CRM_MARKER = 'crm-scopes-v1';
const CRM_ALL = 'taskflow.crm.scope.all';

/** CRM scope to add so a permission list keeps reaching every lead and deal, as it did before AUT-29. */
export function crmScopesToKeep(permissions: string[]): string[] {
  const dots = permissions.map(permissionToDot);
  if (dots.includes(CRM_ALL) || dots.includes('taskflow.crm.*') || dots.includes('taskflow.crm.scope.*')) return [];
  const touchesRecords = dots.some((p) => p.startsWith('taskflow.crm.lead.') || p.startsWith('taskflow.crm.deal.'));
  return touchesRecords ? [CRM_ALL] : [];
}

/**
 * One-time (AUT-29): lead and deal permissions used to reach every record in the workspace. Since CRM scopes,
 * they reach only the person's own leads and deals unless a scope code says more. Existing roles, and people's
 * extra permissions, get "reach everyone" so nothing changes; administrators narrow them in Auth → Roles.
 */
export async function migrateCrmScopesIfNeeded(): Promise<{ roles: number; users: number }> {
  const db = mongoose.connection;
  const done = db.collection<{ _id: string; at: Date }>('appmigrations');
  if (await done.findOne({ _id: CRM_MARKER })) return { roles: 0, users: 0 };
  let roles = 0;
  let users = 0;
  for await (const r of db.collection('roles').find({}, { projection: { permissions: 1 } })) {
    const add = crmScopesToKeep((r.permissions as string[]) ?? []);
    if (add.length) {
      await db.collection('roles').updateOne({ _id: r._id }, { $addToSet: { permissions: { $each: add } } });
      roles++;
    }
  }
  for await (const u of db.collection('users').find({ 'permissionOverrides.granted.0': { $exists: true } }, { projection: { permissionOverrides: 1 } })) {
    const add = crmScopesToKeep((u.permissionOverrides?.granted as string[]) ?? []);
    if (add.length) {
      await db.collection('users').updateOne({ _id: u._id }, { $addToSet: { 'permissionOverrides.granted': { $each: add } } });
      users++;
    }
  }
  await done.updateOne({ _id: CRM_MARKER }, { $set: { at: new Date(), roles, users } }, { upsert: true });
  if (roles || users) console.log(`[migrate] CRM scopes: ${roles} role(s) and ${users} user(s) keep reaching every lead and deal`);
  return { roles, users };
}
