import { env } from '../../config/env';
import { sendPushToUser } from '../../services/push.service';
import { notifyPush } from '../../websocket';
import { sendCustomerEmail } from '../../services/email.service';
import {
  sendThirdPartyNotification,
  sendSmsNotification,
  sendWhatsappNotification,
  type ThirdPartyProvider,
} from '../../services/notifications/thirdPartyNotifier';
import type { NotificationEventKey, NotificationMethod } from '../../shared/constants/notificationCatalog';
import { createNotification } from './notifications.service';
import {
  getOrCreateUserPreferences,
  isChannelEnabledForUser,
} from './notificationPreference.service';
import { User } from '../auth/user.model';

export type NotifyUserParams = {
  userId: string;
  eventKey: NotificationEventKey;
  title: string;
  body?: string;
  link?: string;
  metadata?: Record<string, unknown>;
  /** When set, used as the email HTML body instead of the minimal default template. */
  html?: string;
  /** When true, skips the email channel (e.g. a dedicated transactional email was already sent). */
  skipEmail?: boolean;
  /**
   * When set, only these delivery methods are considered (each still requires the user's
   * notification preference for this event). Used by project release rules, etc.
   */
  allowedChannels?: NotificationMethod[];
};

export async function notifyUser(params: NotifyUserParams): Promise<void> {
  const {
    userId,
    eventKey,
    title,
    body = '',
    link,
    metadata,
    html,
    skipEmail,
    allowedChannels,
  } = params;

  const prefs = await getOrCreateUserPreferences(userId);

  const canDeliver = (method: NotificationMethod) =>
    isChannelEnabledForUser(prefs, eventKey, method, allowedChannels);

  if (canDeliver('in_app')) {
    await createNotification({
      userId,
      type: eventKey,
      title,
      body,
      link,
      metadata,
    });
  }

  if (canDeliver('push')) {
    const payload = { title, body, url: link, data: { eventKey, ...(metadata ?? {}) } };
    sendPushToUser(userId, payload).catch((err) => console.error('Push failed:', err));
    notifyPush(userId, payload);
  }

  if (!skipEmail && canDeliver('email')) {
    const user = await User.findById(userId).select('email').lean();
    const to = (user as { email?: string } | null)?.email;
    if (to) {
      const emailHtml =
        html ?? `<div><h3>${title}</h3><p>${body}</p>${link ? `<p><a href="${link}">Open</a></p>` : ''}</div>`;
      sendCustomerEmail(to, title, emailHtml).catch((err) => console.error('Email send failed:', err));
    }
  }

  if (canDeliver('sms')) {
    const smsToFromMeta = typeof metadata?.smsTo === 'string' ? metadata.smsTo : '';
    const smsTo = smsToFromMeta || env.smsDefaultTo;
    if (smsTo) {
      sendSmsNotification(smsTo, `${title}${body ? ` - ${body}` : ''}${link ? ` ${link}` : ''}`).catch((err) =>
        console.error('SMS send failed:', err)
      );
    }
  }
  if (canDeliver('whatsapp')) {
    const whatsappToFromMeta = typeof metadata?.whatsappTo === 'string' ? metadata.whatsappTo : '';
    const whatsappTo = whatsappToFromMeta || env.whatsappDefaultTo;
    if (whatsappTo) {
      sendWhatsappNotification(whatsappTo, `${title}${body ? ` - ${body}` : ''}${link ? ` ${link}` : ''}`).catch(
        (err) => console.error('WhatsApp send failed:', err)
      );
    }
  }

  const providerMethods: ThirdPartyProvider[] = ['slack', 'teams', 'telegram', 'discord'];
  for (const provider of providerMethods) {
    if (canDeliver(provider)) {
      sendThirdPartyNotification(provider, {
        title,
        body,
        url: link,
        eventKey,
        userId,
        metadata,
      }).catch((err) => console.error(`Third-party send failed (${provider}):`, err));
    }
  }
}

export function mapLegacyNotificationType(type: string): NotificationEventKey {
  switch (type) {
    case 'issue_assigned':
      return 'task_assigned';
    case 'issue_unassigned':
      return 'task_unassigned';
    case 'issue_closed':
      return 'task_status_changed';
    case 'mention':
    case 'issue_mentioned':
      return 'task_mentioned';
    case 'watch_comment':
      return 'watch_comment';
    case 'watch_status':
      return 'watch_status';
    case 'watch_field':
      return 'watch_field';
    case 'invitation_accepted':
      return 'project_invitation_accepted';
    default:
      return 'system_alert';
  }
}

export function appUrl(path?: string): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  return `${env.appUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}
