import {
  BotSettings,
  type BotSettingsDoc,
  type SttLanguage,
} from '../Models/BotSettings';

const CACHE_MS = 3000;

let cache: { at: number; value: BotSettingsDoc } | null = null;

function envSttDefault(): SttLanguage {
  const v = process.env.GROQ_STT_LANGUAGE?.trim().toLowerCase();
  if (v === 'en' || v === 'auto' || v === 'ml') return v;
  return 'ml';
}

function defaults(): BotSettingsDoc {
  return {
    key: 'default',
    botPaused: false,
    voiceRepliesEnabled: true,
    sttLanguage: envSttDefault(),
    updatedAt: new Date(),
  };
}

export async function getBotSettings(): Promise<BotSettingsDoc> {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return cache.value;
  }

  let doc = await BotSettings.findOne({ key: 'default' }).lean();
  if (!doc) {
    await BotSettings.findOneAndUpdate(
      { key: 'default' },
      { $setOnInsert: defaults() },
      { upsert: true }
    );
    doc = await BotSettings.findOne({ key: 'default' }).lean();
  }

  const value = (doc as BotSettingsDoc | null) ?? defaults();
  cache = { at: Date.now(), value };
  return value;
}

export async function updateBotSettings(
  patch: Partial<{
    botPaused: boolean;
    voiceRepliesEnabled: boolean;
    sttLanguage: SttLanguage;
  }>
): Promise<BotSettingsDoc> {
  const $set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof patch.botPaused === 'boolean') $set.botPaused = patch.botPaused;
  if (typeof patch.voiceRepliesEnabled === 'boolean') {
    $set.voiceRepliesEnabled = patch.voiceRepliesEnabled;
  }
  if (
    patch.sttLanguage === 'ml' ||
    patch.sttLanguage === 'en' ||
    patch.sttLanguage === 'auto'
  ) {
    $set.sttLanguage = patch.sttLanguage;
  }

  const doc = await BotSettings.findOneAndUpdate(
    { key: 'default' },
    { $set, $setOnInsert: { key: 'default' } },
    { upsert: true, returnDocument: 'after' }
  ).lean();

  const value = (doc as BotSettingsDoc | null) ?? defaults();
  cache = { at: Date.now(), value };
  return value;
}

export function invalidateBotSettingsCache(): void {
  cache = null;
}
