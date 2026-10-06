import mongoose, { Schema } from 'mongoose';

/**
 * One row per reminder already sent. The unique `key` makes every reminder
 * idempotent across ticks and across multiple API instances.
 */
export interface IReminderLog {
  key: string;
  kind: string;
  createdAt: Date;
}

const reminderLogSchema = new Schema<IReminderLog>(
  {
    key: { type: String, required: true, unique: true },
    kind: { type: String, required: true, index: true },
    // Old keys expire; reminders are keyed by due date so they never re-fire anyway.
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 180 },
  },
  { versionKey: false }
);

export const ReminderLog = mongoose.model<IReminderLog>('ReminderLog', reminderLogSchema);

/** Returns true the first time a key is claimed, false if it was already sent. */
export async function claimReminder(kind: string, key: string): Promise<boolean> {
  try {
    await ReminderLog.create({ kind, key: `${kind}:${key}` });
    return true;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false;
    throw err;
  }
}
