import mongoose from 'mongoose';

const MARKER = 'expense-approve-permission';
const UPDATE = 'taskflow.accounts.expense.update';
const APPROVE = 'taskflow.accounts.expense.approve';

/**
 * One-time (AUT-26): approving expense claims used to need only `expense.update`; it now has its own
 * `expense.approve` permission. Roles that could approve before keep that right, so nobody is locked out.
 * Administrators can then take `expense.approve` (or `expense.update`) away in Auth → Roles to split the duties.
 * Runs once, so a right removed later is not given back.
 */
export async function migrateExpenseApprovePermissionIfNeeded(): Promise<void> {
  const db = mongoose.connection;
  const done = db.collection<{ _id: string; at: Date }>('migrations');
  if (await done.findOne({ _id: MARKER })) return;

  const res = await db
    .collection('roles')
    .updateMany({ permissions: UPDATE }, { $addToSet: { permissions: APPROVE } } as never);
  if (res.modifiedCount > 0) {
    console.log(`[migrate] gave ${res.modifiedCount} role(s) with ${UPDATE} the new ${APPROVE} permission`);
  }
  await done.updateOne({ _id: MARKER }, { $set: { at: new Date() } }, { upsert: true });
}
