import mongoose from 'mongoose';
import { env } from '../../config/env';
import {
  NOTIFICATION_EVENT_DESCRIPTORS,
  NOTIFICATION_EVENTS,
  NOTIFICATION_METHODS,
  type NotificationEventKey,
  type NotificationMethod,
  type NotificationMethodState,
} from '../../shared/constants/notificationCatalog';
import { NotificationPreference } from './notificationPreference.model';

export type NotificationMatrixEntry = {
  eventKey: NotificationEventKey;
  methods: NotificationMethodState;
};

export type AvailableMethods = Record<NotificationMethod, { enabled: boolean; reason?: string }>;

export function defaultMethodState(): NotificationMethodState {
  return {
    in_app: true,
    push: false,
    email: false,
    sms: false,
    whatsapp: false,
    discord: false,
    slack: false,
    teams: false,
    telegram: false,
  };
}

const EMAIL_ON_BY_DEFAULT_EVENTS: NotificationEventKey[] = [
  'task_assigned',
  'task_unassigned',
  'task_status_changed',
  'task_mentioned',
  'watch_comment',
  'watch_status',
  'watch_field',
  'project_invitation',
];

function defaultPreferences(): Record<NotificationEventKey, NotificationMethodState> {
  const prefs = Object.fromEntries(NOTIFICATION_EVENTS.map((e) => [e, defaultMethodState()])) as Record<
    NotificationEventKey,
    NotificationMethodState
  >;
  if (getAvailableMethods().email.enabled) {
    for (const eventKey of EMAIL_ON_BY_DEFAULT_EVENTS) {
      prefs[eventKey] = { ...prefs[eventKey], email: true };
    }
  }
  return prefs;
}

export function legacyDefaultPreferences(): Record<NotificationEventKey, NotificationMethodState> {
  return Object.fromEntries(NOTIFICATION_EVENTS.map((e) => [e, defaultMethodState()])) as Record<
    NotificationEventKey,
    NotificationMethodState
  >;
}

export function getAvailableMethods(): AvailableMethods {
  const pushEnabled = Boolean(env.vapidPublicKey && env.vapidPrivateKey);
  const emailEnabled = Boolean(
    (env.isSmtpEnabled && env.smtpHost && env.smtpPort && env.smtpUser && env.smtpPass) ||
      (env.isAzureGraphEnabled &&
        env.azureGraphTenantId &&
        env.azureGraphClientId &&
        env.azureGraphClientSecret &&
        env.azureGraphFromEmail) ||
      env.isSendgridEnabled
  );
  const smsEnabled = Boolean(
    env.isSmsEnabled &&
      ((env.smsProvider === 'twilio' && env.twilioAccountSid && env.twilioAuthToken && env.twilioFromNumber) ||
        (env.smsProvider === 'fast2sms' && env.fast2smsApiKey) ||
        (env.smsProvider === 'whatstosms' && env.whatstosmsApiKey && env.whatstosmsSenderId))
  );
  const whatsappEnabled = Boolean(env.isWhatsappEnabled && env.whatsappAccessToken && env.whatsappPhoneNumberId);
  const discordEnabled = Boolean(env.isDiscordEnabled && env.discordWebhookUrl);
  const slackEnabled = Boolean(env.isSlackEnabled && env.slackBotToken && env.slackDefaultChannel);
  const teamsEnabled = Boolean(
    (env.isTeamsEnabled && env.teamsWebhookUrl) ||
      (env.isTeamsGraphEnabled &&
        env.teamsGraphTenantId &&
        env.teamsGraphClientId &&
        env.teamsGraphClientSecret &&
        env.teamsGraphTeamId &&
        env.teamsGraphChannelId)
  );
  const telegramEnabled = Boolean(env.isTelegramEnabled && env.telegramBotToken && env.telegramChatId);

  return {
    in_app: { enabled: true },
    push: { enabled: pushEnabled, reason: pushEnabled ? undefined : 'VAPID keys not configured' },
    email: { enabled: emailEnabled, reason: emailEnabled ? undefined : 'SMTP/Azure mail not configured' },
    sms: { enabled: smsEnabled, reason: smsEnabled ? undefined : 'SMS provider not configured' },
    whatsapp: {
      enabled: whatsappEnabled,
      reason: whatsappEnabled ? undefined : 'WhatsApp Cloud API not configured',
    },
    discord: { enabled: discordEnabled, reason: discordEnabled ? undefined : 'Discord webhook not configured' },
    slack: { enabled: slackEnabled, reason: slackEnabled ? undefined : 'Slack not configured' },
    teams: { enabled: teamsEnabled, reason: teamsEnabled ? undefined : 'Teams webhook/graph not configured' },
    telegram: { enabled: telegramEnabled, reason: telegramEnabled ? undefined : 'Telegram bot/chat not configured' },
  };
}

export async function getOrCreateUserPreferences(userId: string) {
  const objectUserId = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
  let doc = await NotificationPreference.findOne({ userId: objectUserId }).lean();
  if (!doc) {
    const created = await NotificationPreference.create({
      userId: objectUserId,
      preferences: defaultPreferences(),
    });
    doc = created.toObject() as unknown as typeof doc;
  }

  const docPrefs = (doc?.preferences ?? {}) as Record<string, Partial<NotificationMethodState>>;
  const defaults = defaultPreferences();
  const fullPrefs = {} as Record<NotificationEventKey, NotificationMethodState>;
  for (const eventKey of NOTIFICATION_EVENTS) {
    fullPrefs[eventKey] = {
      ...defaultMethodState(),
      ...defaults[eventKey],
      ...(docPrefs[eventKey] ?? {}),
    };
  }
  return fullPrefs;
}

export async function getPreferencesResponse(userId: string) {
  const prefs = await getOrCreateUserPreferences(userId);
  const matrix: NotificationMatrixEntry[] = NOTIFICATION_EVENTS.map((eventKey) => ({
    eventKey,
    methods: prefs[eventKey] ?? defaultMethodState(),
  }));
  return {
    availableMethods: getAvailableMethods(),
    events: NOTIFICATION_EVENT_DESCRIPTORS,
    matrix,
  };
}

type PreferencesUpdatePayload = {
  matrix: Array<{ eventKey: string; methods: Partial<Record<string, boolean>> }>;
};

export async function updateUserPreferences(userId: string, payload: PreferencesUpdatePayload) {
  const current = await getOrCreateUserPreferences(userId);
  const next = { ...current };
  for (const row of payload.matrix ?? []) {
    if (!(NOTIFICATION_EVENTS as readonly string[]).includes(row.eventKey)) continue;
    const key = row.eventKey as NotificationEventKey;
    const prev = next[key] ?? defaultMethodState();
    const merged: NotificationMethodState = { ...prev };
    for (const method of NOTIFICATION_METHODS) {
      if (typeof row.methods?.[method] === 'boolean') merged[method] = Boolean(row.methods?.[method]);
    }
    next[key] = merged;
  }

  const objectUserId = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
  await NotificationPreference.findOneAndUpdate(
    { userId: objectUserId },
    { $set: { preferences: next } },
    { upsert: true, new: true }
  );

  return getPreferencesResponse(userId);
}

export function isChannelEnabledForUser(
  prefs: Record<NotificationEventKey, NotificationMethodState>,
  eventKey: NotificationEventKey,
  method: NotificationMethod,
  allowedChannels?: NotificationMethod[]
): boolean {
  if (!getAvailableMethods()[method]?.enabled) return false;
  if (allowedChannels && !allowedChannels.includes(method)) return false;
  const state = prefs[eventKey] ?? defaultMethodState();
  return Boolean(state[method]);
}

export async function shouldSend(
  userId: string,
  eventKey: NotificationEventKey,
  method: NotificationMethod,
  allowedChannels?: NotificationMethod[]
): Promise<boolean> {
  const prefs = await getOrCreateUserPreferences(userId);
  return isChannelEnabledForUser(prefs, eventKey, method, allowedChannels);
}
