import type { Client, Message } from 'whatsapp-web.js';

/**
 * Resolve the sender's real mobile number from a WhatsApp message.
 * Prefers phone (c.us / Contact.number) over opaque @lid ids.
 */
export async function resolveSenderMobile(msg: Message): Promise<{
  phone: string;
  contactName?: string;
  chatId: string;
}> {
  const chatId = msg.from;
  let contactName: string | undefined;
  let phone = '';
  const client = (msg as Message & { client?: Client }).client;

  try {
    const contact = await msg.getContact();
    contactName =
      contact.pushname?.trim() ||
      contact.name?.trim() ||
      contact.shortName?.trim() ||
      undefined;

    const n = String(contact.number || '').replace(/\D/g, '');
    if (n.length >= 8) phone = n;

    // LID chats: map lid → phone via WhatsApp client
    if ((!phone || chatId.endsWith('@lid')) && client?.getContactLidAndPhone) {
      try {
        const pairs = await client.getContactLidAndPhone([chatId]);
        const pair = Array.isArray(pairs) ? pairs[0] : null;
        const pn =
          (pair as { pn?: string; phone?: string } | null)?.pn ||
          (pair as { pn?: string; phone?: string } | null)?.phone ||
          '';
        const digits = String(pn).replace(/@.*/, '').replace(/\D/g, '');
        if (digits.length >= 8) phone = digits;
      } catch (err) {
        console.warn('getContactLidAndPhone failed:', err);
      }
    }
  } catch (err) {
    console.warn('getContact failed:', err);
  }

  if (!phone && chatId.endsWith('@c.us')) {
    phone = chatId.replace(/@.*/, '').replace(/\D/g, '');
  }

  if (!phone) {
    // Last resort: keep raw id so sales still has a handle
    phone = chatId.replace(/@.*/, '');
  }

  return { phone, contactName, chatId };
}
