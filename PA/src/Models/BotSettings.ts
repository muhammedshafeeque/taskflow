import mongoose from 'mongoose';

export type SttLanguage = 'ml' | 'en' | 'auto';

export type BotSettingsDoc = {
  key: string;
  botPaused: boolean;
  voiceRepliesEnabled: boolean;
  sttLanguage: SttLanguage;
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
  updatedAt: { type: Date, default: Date.now },
});

export const BotSettings = mongoose.model('BotSettings', botSettingsSchema);
