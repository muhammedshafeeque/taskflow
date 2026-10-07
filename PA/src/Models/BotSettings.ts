import mongoose from 'mongoose';

export type SttLanguage = 'ml' | 'en' | 'auto';

export type QuietHours = {
  enabled: boolean;
  /** 24h "HH:MM" in `timezone`. A window may cross midnight (22:00 → 08:00). */
  start: string;
  end: string;
  timezone: string;
  /** Sent once per quiet window to a customer who messages during it. Empty = stay silent. */
  awayMessage: string;
};

export type BotSettingsDoc = {
  key: string;
  botPaused: boolean;
  voiceRepliesEnabled: boolean;
  sttLanguage: SttLanguage;
  quietHours?: QuietHours;
  brand?: Partial<import('../Config/brand').BrandProfile>;
  updatedAt?: Date;
};

const botSettingsSchema = new mongoose.Schema({
  key: { type: String, unique: true, required: true, default: 'default' },
  botPaused: { type: Boolean, default: false },
  voiceRepliesEnabled: { type: Boolean, default: true },
  sttLanguage: {
    type: String,
    enum: ['ml', 'en', 'auto'],
    default: 'ml',
  },
  brand: { type: mongoose.Schema.Types.Mixed, default: undefined },
  quietHours: {
    enabled: { type: Boolean, default: false },
    start: { type: String, default: '22:00' },
    end: { type: String, default: '08:00' },
    timezone: { type: String, default: 'Asia/Kolkata' },
    awayMessage: { type: String, default: '' },
  },
  updatedAt: { type: Date, default: Date.now },
});

export const BotSettings = mongoose.model('BotSettings', botSettingsSchema);
