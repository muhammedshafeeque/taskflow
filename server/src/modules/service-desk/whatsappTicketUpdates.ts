import { INTERNAL_KEY_HEADER, loadOrCreateInternalSecret } from '../../config/internalSecret';

/**
 * Keep WhatsApp customers in the loop: tickets that came in through the PA bot
 * (they carry `whatsappGroupId`) get status changes and public agent replies
 * posted back to the same chat via PA's admin API, authenticated with the
 * shared internal key. PA_API_URL defaults to the local PA in development
 * (docker-compose sets it); set PA_API_URL=off to disable.
 */
const PA_API_URL = (
  process.env.PA_API_URL?.trim() || (process.env.NODE_ENV === 'production' ? '' : 'http://127.0.0.1:3000')
).replace(/\/$/, '');

const STATUS_TEXT: Record<string, string> = {
  in_progress: 'is now being worked on',
  pending: 'is waiting on more information from you',
  resolved: 'has been resolved ✅ — reply here if anything is still not right',
  closed: 'has been closed',
};

export function whatsappUpdatesEnabled(): boolean {
  return Boolean(PA_API_URL && PA_API_URL !== 'off');
}

async function sendToChat(chatId: string, text: string): Promise<void> {
  const res = await fetch(`${PA_API_URL}/api/admin/conversations/${encodeURIComponent(chatId)}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [INTERNAL_KEY_HEADER]: loadOrCreateInternalSecret() },
    // Keep the bot active in the chat — this is a notification, not a human takeover.
    body: JSON.stringify({ text, pauseBot: false }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`PA send failed (${res.status})`);
}

export async function notifyWhatsappStatus(
  ticket: { _id: unknown; subject: string; whatsappGroupId?: string },
  status: string
): Promise<void> {
  if (!whatsappUpdatesEnabled() || !ticket.whatsappGroupId || !STATUS_TEXT[status]) return;
  await sendToChat(ticket.whatsappGroupId, `🎫 Update on "${ticket.subject}": your ticket ${STATUS_TEXT[status]}.`);
}

export async function notifyWhatsappReply(
  ticket: { subject: string; whatsappGroupId?: string },
  body: string,
  agentName?: string
): Promise<void> {
  if (!whatsappUpdatesEnabled() || !ticket.whatsappGroupId) return;
  await sendToChat(ticket.whatsappGroupId, `💬 ${agentName ?? 'Support'} on "${ticket.subject}":\n${body.slice(0, 3000)}`);
}
