import { MailMailbox } from './models/mailMailbox.model';
import { decryptSecret } from '../../utils/secretCrypto';
import * as mailService from './mail.service';

async function getImapFlowClass(): Promise<(new (opts: Record<string, unknown>) => {
  connect: () => Promise<void>;
  mailboxOpen: (path: string) => Promise<unknown>;
  fetch: (range: string, opts: Record<string, unknown>) => AsyncIterable<{
    uid: number;
    envelope?: {
      messageId?: string;
      subject?: string;
      date?: Date;
      from?: { address?: string }[];
      to?: { address?: string }[];
    };
    source?: Buffer;
  }>;
  logout: () => Promise<void>;
}) | null> {
  try {
    const mod = await import('imapflow');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return mod.ImapFlow as any;
  } catch {
    return null;
  }
}

function extractBody(source?: Buffer): { text?: string; html?: string } {
  if (!source) return {};
  const raw = source.toString('utf8');
  const textMatch = raw.match(/Content-Type: text\/plain[\s\S]*?\r\n\r\n([\s\S]*?)(?=\r\n--|\r\nContent-Type:|$)/i);
  const htmlMatch = raw.match(/Content-Type: text\/html[\s\S]*?\r\n\r\n([\s\S]*?)(?=\r\n--|\r\nContent-Type:|$)/i);
  return {
    text: textMatch?.[1]?.trim(),
    html: htmlMatch?.[1]?.trim(),
  };
}

export async function syncMailbox(mailboxId: string): Promise<number> {
  const mailbox = await MailMailbox.findById(mailboxId);
  if (!mailbox || !mailbox.syncEnabled) return 0;

  const ImapFlow = await getImapFlowClass();
  if (!ImapFlow) {
    console.warn('[mail] imapflow not installed; skipping IMAP sync for', mailbox.email);
    return 0;
  }

  const password = decryptSecret(mailbox.passwordEncrypted);
  const client = new ImapFlow({
    host: mailbox.imapHost,
    port: mailbox.imapPort,
    secure: mailbox.imapPort === 993,
    auth: { user: mailbox.username, pass: password },
    logger: false,
  });

  let imported = 0;
  try {
    await client.connect();
    await client.mailboxOpen('INBOX');
    const sinceUid = (mailbox.lastUid ?? 0) + 1;
    const range = `${sinceUid}:*`;
    let maxUid = mailbox.lastUid ?? 0;

    for await (const msg of client.fetch(range, { uid: true, envelope: true, source: true })) {
      if (!msg.uid || msg.uid <= (mailbox.lastUid ?? 0)) continue;
      const env = msg.envelope;
      const bodies = extractBody(msg.source);
      await mailService.processInboundMessage(String(mailbox.taskflowOrganizationId), mailbox, {
        messageId: env?.messageId ?? `uid-${msg.uid}@${mailbox.email}`,
        from: env?.from?.[0]?.address ?? 'unknown',
        to: (env?.to ?? []).map((t) => t.address ?? '').filter(Boolean),
        subject: env?.subject ?? '(no subject)',
        bodyText: bodies.text,
        bodyHtml: bodies.html,
        sentAt: env?.date ?? new Date(),
      });
      maxUid = Math.max(maxUid, msg.uid);
      imported += 1;
    }

    mailbox.lastSyncAt = new Date();
    mailbox.lastUid = maxUid;
    await mailbox.save();
  } finally {
    await client.logout().catch(() => undefined);
  }
  return imported;
}

export async function syncAllMailboxes(): Promise<void> {
  const mailboxes = await MailMailbox.find({ syncEnabled: true }).select('_id email').lean();
  for (const mb of mailboxes) {
    try {
      const n = await syncMailbox(String(mb._id));
      if (n > 0) console.log(`[mail] synced ${n} messages for ${mb.email}`);
    } catch (err) {
      console.error(`[mail] sync failed for ${mb.email}:`, err);
    }
  }
}
