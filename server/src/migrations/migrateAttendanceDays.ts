import mongoose from 'mongoose';
import { calendarDay } from '../modules/hrms/lossOfPay';

const MARKER = 'attendance-days';

/**
 * One-time: HR used to save attendance at the server's local midnight and self-service at UTC midnight, so one day
 * could be stored twice. Every record moves to its calendar day at UTC midnight; where two records are one day,
 * the most recently changed one is kept.
 */
export async function migrateAttendanceDaysIfNeeded(): Promise<{ moved: number; merged: number }> {
  const db = mongoose.connection;
  const done = db.collection<{ _id: string; at: Date }>('appmigrations');
  if (await done.findOne({ _id: MARKER })) return { moved: 0, merged: 0 };
  const col = db.collection('hrmsattendances');
  const groups = new Map<string, Array<{ _id: mongoose.Types.ObjectId; date: Date; updatedAt?: Date }>>();
  for await (const r of col.find({}, { projection: { taskflowOrganizationId: 1, employeeId: 1, date: 1, updatedAt: 1 } })) {
    const key = `${r.taskflowOrganizationId}|${r.employeeId}|${calendarDay(r.date)}`;
    groups.set(key, [...(groups.get(key) ?? []), r as never]);
  }
  let moved = 0;
  let merged = 0;
  for (const [key, rows] of groups) {
    const target = new Date(`${key.split('|')[2]}T00:00:00Z`);
    rows.sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime());
    const [keep, ...extra] = rows;
    if (extra.length) {
      await col.deleteMany({ _id: { $in: extra.map((r) => r._id) } });
      merged += extra.length;
    }
    if (new Date(keep.date).getTime() !== target.getTime()) {
      await col.updateOne({ _id: keep._id }, { $set: { date: target } });
      moved++;
    }
  }
  await done.updateOne({ _id: MARKER }, { $set: { at: new Date(), moved, merged } }, { upsert: true });
  if (moved || merged) console.log(`[migrate] attendance: ${moved} moved to their calendar day, ${merged} duplicate(s) merged`);
  return { moved, merged };
}
