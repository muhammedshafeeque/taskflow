import {
  BotSettings,
  type BotSettingsDoc,
  type QuietHours,
  type SttLanguage,
} from '../Models/BotSettings';
import { DEFAULT_QUIET_HOURS, isValidHhmm, isValidTimezone } from './quietHours';

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
    quietHours: { ...DEFAULT_QUIET_HOURS },
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

  const value = withQuietDefaults((doc as BotSettingsDoc | null) ?? defaults());
  cache = { at: Date.now(), value };
  return value;
}

function withQuietDefaults(doc: BotSettingsDoc): BotSettingsDoc {
  return { ...doc, quietHours: { ...DEFAULT_QUIET_HOURS, ...(doc.quietHours ?? {}) } };
}

export async function updateBotSettings(
  patch: Partial<{
    botPaused: boolean;
    voiceRepliesEnabled: boolean;
    sttLanguage: SttLanguage;
    quietHours: Partial<QuietHours>;
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

  const qh = patch.quietHours;
  if (qh && typeof qh === 'object') {
    if (typeof qh.enabled === 'boolean') $set['quietHours.enabled'] = qh.enabled;
    if (qh.start !== undefined) {
      if (!isValidHhmm(qh.start)) throw new Error('quietHours.start must be HH:MM (24h)');
      $set['quietHours.start'] = qh.start;
    }
    if (qh.end !== undefined) {
      if (!isValidHhmm(qh.end)) throw new Error('quietHours.end must be HH:MM (24h)');
      $set['quietHours.end'] = qh.end;
    }
    if (qh.timezone !== undefined) {
      if (!isValidTimezone(qh.timezone)) throw new Error('quietHours.timezone must be an IANA timezone, e.g. Asia/Kolkata');
      $set['quietHours.timezone'] = qh.timezone;
    }
    if (typeof qh.awayMessage === 'string') $set['quietHours.awayMessage'] = qh.awayMessage.trim().slice(0, 1000);
  }

  const doc = await BotSettings.findOneAndUpdate(
    { key: 'default' },
    { $set, $setOnInsert: { key: 'default' } },
    { upsert: true, returnDocument: 'after' }
  ).lean();

  const value = withQuietDefaults((doc as BotSettingsDoc | null) ?? defaults());
  cache = { at: Date.now(), value };
  return value;
}

export function invalidateBotSettingsCache(): void {
  cache = null;
}
