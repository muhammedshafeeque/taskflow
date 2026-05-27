import mongoose from 'mongoose';

/** One-time: convert legacy string fixVersion to string[]. */
export async function migrateFixVersionToArrayIfNeeded(): Promise<void> {
  const col = mongoose.connection.collection('issues');
  const cursor = col.find({
    fixVersion: { $exists: true, $type: 'string' },
  });
  let updated = 0;
  for await (const doc of cursor) {
    const fv = doc.fixVersion as string;
    if (!fv) continue;
    await col.updateOne({ _id: doc._id }, { $set: { fixVersion: [fv] } });
    updated += 1;
  }
  if (updated > 0) {
    console.log(`[migrate] fixVersion: converted ${updated} issue(s) from string to array`);
  }
}
