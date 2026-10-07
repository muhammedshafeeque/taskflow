import type { Message } from 'whatsapp-web.js';
import { whatsapp } from './client';
import { brand } from '../Config/brand';

function serializeId(id: unknown): string {
  if (!id) return '';
  if (typeof id === 'string') return id;
  if (typeof id === 'object' && id !== null && '_serialized' in id) {
    return String((id as { _serialized?: string })._serialized || '');
  }
  return String(id);
}

function userPart(id: string): string {
  return id.split('@')[0]?.replace(/\D/g, '') || id.split('@')[0] || '';
}

/** Cached bot JIDs including resolved @lid (WhatsApp privacy ids). */
let cachedBotIds: string[] | null = null;
let cachedBotIdsAt = 0;
const BOT_IDS_TTL_MS = 10 * 60 * 1000;

async function resolveBotIds(): Promise<string[]> {
  if (cachedBotIds && Date.now() - cachedBotIdsAt < BOT_IDS_TTL_MS) {
    return cachedBotIds;
  }

  const wid = whatsapp.info?.wid;
  if (!wid) return [];

  const serialized = serializeId(wid);
  const user = String(
    (wid as { user?: string }).user || serialized.split('@')[0] || ''
  );
  const ids = new Set<string>();
  if (serialized) ids.add(serialized);
  if (user) {
    ids.add(user);
    ids.add(`${user}@c.us`);
    ids.add(`${user}@lid`);
    ids.add(`@${user}`);
  }

  try {
    const lookupKey = serialized.includes('@')
      ? serialized
      : `${user}@c.us`;
    const pairs = await whatsapp.getContactLidAndPhone([lookupKey]);
    for (const pair of pairs || []) {
      if (pair?.lid) ids.add(String(pair.lid));
      if (pair?.pn) ids.add(String(pair.pn));
    }
  } catch (err) {
    console.warn('resolveBotIds lid lookup failed', err);
  }

  cachedBotIds = [...ids].filter(Boolean);
  cachedBotIdsAt = Date.now();
  return cachedBotIds;
}

function idsMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const ua = userPart(a);
  const ub = userPart(b);
  return Boolean(ua && ub && ua === ub);
}

/**
 * True when the bot was @mentioned or the user replied to a bot message.
 * Handles WhatsApp @lid mentions (not comparable to phone @c.us by digits alone).
 */
export async function isBotAddressedInGroup(msg: Message): Promise<boolean> {
  // Most reliable: Contact.isMe from resolved mentions
  try {
    const mentions = await msg.getMentions();
    if (mentions.some((c) => Boolean(c?.isMe))) {
      return true;
    }
  } catch (err) {
    console.warn('getMentions failed', err);
  }

  const mine = await resolveBotIds();
  if (!mine.length) {
    console.warn('isBotAddressedInGroup: bot wid unavailable');
    return false;
  }

  const mentioned = (msg.mentionedIds ?? []).map(serializeId).filter(Boolean);
  if (mentioned.some((id) => mine.some((m) => idsMatch(id, m)))) {
    return true;
  }

  // Body text fallbacks (mention may appear as @pushname / brand)
  const body = String(msg.body || '').toLowerCase();
  const pushname = String(whatsapp.info?.pushname || '')
    .trim()
    .toLowerCase();
  if (pushname && body.includes(`@${pushname}`)) {
    return true;
  }
  const b = brand();
  const aliases = [b.companyName, b.companyNameMl, ...b.mentionAliases]
    .map((a) => a.trim().toLowerCase())
    .filter((a) => a && a !== 'our company');
  if (aliases.some((a) => body.includes(`@${a}`) || body.includes(`${a} help`))) {
    return true;
  }

  const user = whatsapp.info?.wid
    ? String((whatsapp.info.wid as { user?: string }).user || '')
    : '';
  if (user && body.includes(`@${user}`)) {
    return true;
  }

  if (msg.hasQuotedMsg) {
    try {
      const quoted = await msg.getQuotedMessage();
      if (quoted?.fromMe) return true;
    } catch {
      // ignore
    }
  }

  return false;
}

/** Clear cached bot ids (e.g. after reconnect). */
export function clearBotIdCache(): void {
  cachedBotIds = null;
  cachedBotIdsAt = 0;
}
