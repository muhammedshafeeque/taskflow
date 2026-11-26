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
