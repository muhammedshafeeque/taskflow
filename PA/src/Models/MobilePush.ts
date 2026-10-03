import mongoose from 'mongoose';

const mobilePushTokenSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true },
    platform: { type: String, default: 'android' },
    deviceName: { type: String, default: '' },
    /** Which alert kinds this device wants pushed. Empty = all. */
    kinds: { type: [String], default: [] },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const MobilePushToken = mongoose.model('MobilePushToken', mobilePushTokenSchema);

/** Cursor so the watcher only pushes items it has not pushed before. */
const monitorWatchStateSchema = new mongoose.Schema({
  key: { type: String, unique: true, required: true, default: 'default' },
  lastDeliveryAt: { type: Date },
  lastErrorAt: { type: Date },
  downCheckIds: { type: [String], default: [] },
  updatedAt: { type: Date, default: Date.now },
});

export const MonitorWatchState = mongoose.model('MonitorWatchState', monitorWatchStateSchema);
