import crypto from 'crypto';
import mongoose from 'mongoose';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { ApiError } from '../../utils/ApiError';
import { encryptSecret, decryptSecret } from '../../utils/secretCrypto';
import { CrmContact } from '../crm/models/crmContact.model';
import { CrmLead } from '../crm/models/crmLead.model';
import { CrmDeal } from '../crm/models/crmDeal.model';
import { CrmActivity } from '../crm/models/crmActivity.model';
import { MailAccount, MailMessage } from './models/mail.models';
import { stripQuotedReply } from '../service-desk/emailInbound';

type Server = { host: string; port: number; secure?: boolean; user?: string };
type Creds = { imapPassword: string; smtpPassword?: string };
type Addr = { email: string; name?: string };
export type LinkType = 'contact' | 'lead' | 'deal' | 'account';
type Link = { type: LinkType; id: mongoose.Types.ObjectId };

const MAX_TEXT = 50_000;
const BATCH = Number(process.env.MAIL_SYNC_BATCH) || 100;

export type MailAccountInput = {
  label?: string;
  emailAddress: string;
  displayName?: string;
  imap: Server;
  smtp: Server;
  imapPassword?: string;
  smtpPassword?: string;
  folders?: string[];
  crmOnly?: boolean;
  shareWithTeam?: boolean;
  ignore?: string[];
  syncEnabled?: boolean;
  syncSince?: string | Date;
  signature?: string;
};

function clean(a: MailAccountInput) {
  const out: Record<string, unknown> = {};
  for (const k of ['label', 'displayName', 'folders', 'crmOnly', 'shareWithTeam', 'syncEnabled', 'signature'] as const) {
    if (a[k] !== undefined) out[k] = a[k];
  }
  if (a.emailAddress) out.emailAddress = a.emailAddress.trim().toLowerCase();
  if (a.imap) out.imap = { host: a.imap.host, port: Number(a.imap.port) || 993, secure: a.imap.secure !== false, user: a.imap.user || a.emailAddress };
  if (a.smtp) out.smtp = { host: a.smtp.host, port: Number(a.smtp.port) || 465, secure: a.smtp.secure !== false, user: a.smtp.user || a.imap?.user || a.emailAddress };
  if (a.ignore) out.ignore = a.ignore.map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (a.syncSince !== undefined) out.syncSince = a.syncSince ? new Date(a.syncSince) : null;
  return out;
}

export function publicAccount(doc: Record<string, unknown>) {
  const { credentials: _c, ...rest } = doc;
  return rest;
}

type AccountDoc = {
  _id: mongoose.Types.ObjectId;
  taskflowOrganizationId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  emailAddress: string;
  displayName?: string | null;
  imap: Server;
  smtp: Server;
  credentials: string;
  folders: string[];
  crmOnly: boolean;
  ignore: string[];
  syncSince?: Date | null;
  cursors?: Record<string, { uidValidity: string; lastUid: number }>;
  signature?: string | null;
};

function creds(acc: { credentials: string }): Creds {
  return JSON.parse(decryptSecret(acc.credentials)) as Creds;
}

function imapClient(acc: AccountDoc) {
  return new ImapFlow({
    host: acc.imap.host,
    port: acc.imap.port,
    secure: acc.imap.secure !== false,
    auth: { user: acc.imap.user || acc.emailAddress, pass: creds(acc).imapPassword },
    logger: false,
  });
}

function smtpTransport(acc: AccountDoc) {
  const c = creds(acc);
  return nodemailer.createTransport({
    host: acc.smtp.host,
    port: acc.smtp.port,
    secure: acc.smtp.secure !== false,
    auth: { user: acc.smtp.user || acc.emailAddress, pass: c.smtpPassword || c.imapPassword },
  });
}

/** Check both servers accept the credentials before saving. */
export async function testConnection(acc: AccountDoc): Promise<{ imap: string; smtp: string }> {
  const result = { imap: 'ok', smtp: 'ok' };
  const client = imapClient(acc);
  try {
    await client.connect();
  } catch (err) {
    result.imap = err instanceof Error ? err.message : String(err);
  } finally {
    await client.logout().catch(() => undefined);
  }
  try {
    await smtpTransport(acc).verify();
  } catch (err) {
    result.smtp = err instanceof Error ? err.message : String(err);
  }
  return result;
}

export async function connectAccount(orgId: string, userId: string, input: MailAccountInput) {
  if (!input.emailAddress || !input.imap?.host || !input.smtp?.host || !input.imapPassword) {
    throw new ApiError(400, 'emailAddress, imap.host, smtp.host and imapPassword are required');
  }
  const draft = {
    ...clean(input),
    taskflowOrganizationId: new mongoose.Types.ObjectId(orgId),
    userId: new mongoose.Types.ObjectId(userId),
    credentials: encryptSecret(JSON.stringify({ imapPassword: input.imapPassword, smtpPassword: input.smtpPassword || undefined })),
    syncSince: input.syncSince ? new Date(input.syncSince) : new Date(Date.now() - 30 * 86_400_000),
  } as unknown as AccountDoc;
  const check = await testConnection(draft);
  if (check.imap !== 'ok' || check.smtp !== 'ok') throw new ApiError(400, `Connection failed — IMAP: ${check.imap}; SMTP: ${check.smtp}`);
  const doc = await MailAccount.create(draft);
  const { credentials: _c, ...rest } = doc.toObject();
  return rest;
}

export async function updateAccount(id: string, input: MailAccountInput) {
  const acc = await MailAccount.findById(id).select('+credentials');
  if (!acc) throw new ApiError(404, 'Mailbox not found');
  acc.set(clean(input));
  if (input.imapPassword || input.smtpPassword) {
    const prev = creds(acc as unknown as AccountDoc);
    acc.set('credentials', encryptSecret(JSON.stringify({ imapPassword: input.imapPassword || prev.imapPassword, smtpPassword: input.smtpPassword || prev.smtpPassword })));
  }
  if (input.imap || input.smtp || input.imapPassword || input.smtpPassword) {
    const check = await testConnection(acc.toObject() as unknown as AccountDoc);
    if (check.imap !== 'ok' || check.smtp !== 'ok') throw new ApiError(400, `Connection failed — IMAP: ${check.imap}; SMTP: ${check.smtp}`);
  }
  acc.set('lastError', undefined);
  await acc.save();
  const { credentials: _c, ...rest } = acc.toObject();
  return rest;
}

/** Address → CRM records (contacts, leads, the contacts' accounts and open deals). */
export async function matchAddresses(orgOid: mongoose.Types.ObjectId, emails: string[]): Promise<Link[]> {
  const list = [...new Set(emails.map((e) => e.toLowerCase()).filter(Boolean))];
  if (!list.length) return [];
  const [contacts, leads] = await Promise.all([
    CrmContact.find({ taskflowOrganizationId: orgOid, email: { $in: list } }).select('_id accountId').lean(),
    CrmLead.find({ taskflowOrganizationId: orgOid, contactEmail: { $in: list }, status: { $nin: ['converted', 'unqualified'] } }).select('_id').lean(),
  ]);
  const links: Link[] = [];
  for (const c of contacts) {
    links.push({ type: 'contact', id: c._id as mongoose.Types.ObjectId });
    if (c.accountId) links.push({ type: 'account', id: c.accountId as mongoose.Types.ObjectId });
  }
  for (const l of leads) links.push({ type: 'lead', id: l._id as mongoose.Types.ObjectId });
  if (contacts.length) {
    const deals = await CrmDeal.find({ taskflowOrganizationId: orgOid, status: 'open', contactId: { $in: contacts.map((c) => c._id) } }).select('_id').lean();
    for (const d of deals) links.push({ type: 'deal', id: d._id as mongoose.Types.ObjectId });
  }
  const seen = new Set<string>();
  return links.filter((l) => !seen.has(`${l.type}:${l.id}`) && seen.add(`${l.type}:${l.id}`));
}

function ignored(acc: Pick<AccountDoc, 'emailAddress' | 'ignore'>, email: string): boolean {
  const e = email.toLowerCase();
  if (e === acc.emailAddress) return true;
  return (acc.ignore ?? []).some((rule) => (rule.startsWith('@') ? e.endsWith(rule) : rule.includes('@') ? e === rule : e.endsWith(`@${rule}`)));
}

/** Store one message and log it on the matched CRM timelines. Returns false when skipped. */
export async function recordMessage(
  acc: Pick<AccountDoc, '_id' | 'taskflowOrganizationId' | 'userId' | 'emailAddress' | 'ignore' | 'crmOnly'>,
  m: {
    messageId: string;
    folder?: string;
    uid?: number;
    inReplyTo?: string;
    references?: string[];
    from?: Addr;
    to: Addr[];
    cc: Addr[];
    subject: string;
    text: string;
    date: Date;
    extraLinks?: Link[];
  }
): Promise<boolean> {
  const outbound = m.from?.email?.toLowerCase() === acc.emailAddress;
  const counterparts = (outbound ? [...m.to, ...m.cc] : [m.from, ...m.cc].filter(Boolean) as Addr[])
    .map((a) => a.email)
    .filter((e) => e && !ignored(acc, e));
  const matched = await matchAddresses(acc.taskflowOrganizationId, counterparts);
  const links = [...(m.extraLinks ?? []), ...matched].filter((l, i, arr) => arr.findIndex((x) => x.type === l.type && String(x.id) === String(l.id)) === i);
  if (acc.crmOnly && !links.length) return false;
  const text = m.text.slice(0, MAX_TEXT);
  const snippet = stripQuotedReply(text).replace(/\s+/g, ' ').slice(0, 280);
  const res = await MailMessage.updateOne(
    { mailAccountId: acc._id, messageId: m.messageId },
    {
      $setOnInsert: {
        taskflowOrganizationId: acc.taskflowOrganizationId,
        userId: acc.userId,
        direction: outbound ? 'outbound' : 'inbound',
        folder: m.folder,
        uid: m.uid,
        inReplyTo: m.inReplyTo,
        references: m.references ?? [],
        from: m.from,
        to: m.to,
        cc: m.cc,
        subject: m.subject,
        text,
        snippet,
        date: m.date,
        links,
      },
    },
    { upsert: true }
  );
  if (!res.upsertedId) return false; // already stored (e.g. same mail in INBOX and a label folder)
  // Activities show up on the timelines that the CRM already renders.
  const activityTargets = links.filter((l) => l.type !== 'account' || !links.some((x) => x.type === 'contact'));
  await CrmActivity.insertMany(
    activityTargets.map((l) => ({
      taskflowOrganizationId: acc.taskflowOrganizationId,
      type: 'email',
      subject: `${outbound ? '→' : '←'} ${m.subject || '(no subject)'}`.slice(0, 300),
      body: snippet,
      completedAt: m.date,
      assigneeId: acc.userId,
      createdBy: acc.userId,
      relatedType: l.type,
      relatedId: l.id,
      mailMessageId: res.upsertedId,
    }))
  );
  return true;
}

function addrList(list?: { address?: string; name?: string }[]): Addr[] {
  return (list ?? []).filter((a) => a.address).map((a) => ({ email: String(a.address).toLowerCase(), name: a.name || undefined }));
}

async function streamText(stream: NodeJS.ReadableStream, max = MAX_TEXT * 2): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > max) break;
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

type Node = { type?: string; part?: string; disposition?: string; childNodes?: Node[] };
function findPart(node: Node | undefined, type: string): string | undefined {
  if (!node) return undefined;
  if (node.type?.toLowerCase() === type && node.disposition?.toLowerCase() !== 'attachment') return node.part ?? '1';
  for (const child of node.childNodes ?? []) {
    const hit = findPart(child, type);
    if (hit) return hit;
  }
  return undefined;
}

/** Pull new mail from each configured folder since the stored cursor. */
export async function syncAccount(accountId: string): Promise<number> {
  const acc = (await MailAccount.findById(accountId).select('+credentials').lean()) as unknown as AccountDoc | null;
  if (!acc) return 0;
  const client = imapClient(acc);
  const cursors = { ...(acc.cursors ?? {}) };
  let stored = 0;
  try {
    await client.connect();
    const available = await client.list().catch(() => []);
    for (const wanted of acc.folders ?? ['INBOX']) {
      // Accept "Sent" for "[Gmail]/Sent Mail", "Sent Items" etc. via special-use flags.
      const folder =
        available.find((f) => f.path === wanted)?.path ??
        (/^sent/i.test(wanted) ? available.find((f) => f.specialUse === '\\Sent')?.path : undefined);
      if (!folder) continue;
      const lock = await client.getMailboxLock(folder);
      try {
        const box = client.mailbox && typeof client.mailbox === 'object' ? client.mailbox : null;
        const validity = String(box?.uidValidity ?? '');
        const cur = cursors[folder];
        const fresh = !cur || cur.uidValidity !== validity;
        const uids = fresh
          ? ((await client.search({ since: acc.syncSince ?? new Date(Date.now() - 30 * 86_400_000) }, { uid: true })) || [])
          : ((await client.search({ uid: `${cur.lastUid + 1}:*` }, { uid: true })) || []).filter((u) => u > cur.lastUid);
        let lastUid = fresh ? 0 : cur.lastUid;
        for (const uid of uids.sort((a, b) => a - b).slice(0, BATCH)) {
          const msg = await client.fetchOne(String(uid), { envelope: true, bodyStructure: true, headers: ['references'] }, { uid: true });
          lastUid = Math.max(lastUid, uid);
          if (!msg || !msg.envelope) continue;
          const env = msg.envelope;
          const plain = findPart(msg.bodyStructure as Node, 'text/plain');
          const html = plain ? undefined : findPart(msg.bodyStructure as Node, 'text/html');
          let text = '';
          if (plain || html) {
            const dl = await client.download(String(uid), (plain ?? html)!, { uid: true, maxBytes: MAX_TEXT * 2 });
            text = await streamText(dl.content);
            if (html) text = htmlToText(text);
          }
          const refs = (msg.headers?.toString('utf8').match(/<[^>]+>/g) ?? []).slice(0, 20);
          const ok = await recordMessage(acc, {
            messageId: env.messageId || `${folder}:${validity}:${uid}`,
            folder,
            uid,
            inReplyTo: env.inReplyTo || undefined,
            references: refs,
            from: addrList(env.from)[0],
            to: addrList(env.to),
            cc: addrList(env.cc),
            subject: env.subject ?? '',
            text: text.trim(),
            date: env.date ? new Date(env.date) : new Date(),
          }).catch((err) => {
            console.error('[mail-sync] record failed', err);
            return false;
          });
          if (ok) stored++;
        }
        cursors[folder] = { uidValidity: validity, lastUid };
      } finally {
        lock.release();
      }
    }
    await MailAccount.updateOne({ _id: acc._id }, { $set: { cursors, lastSyncAt: new Date() }, $unset: { lastError: 1 } });
  } catch (err) {
    await MailAccount.updateOne({ _id: acc._id }, { $set: { lastError: err instanceof Error ? err.message : String(err), lastSyncAt: new Date() } });
  } finally {
    await client.logout().catch(() => undefined);
  }
  return stored;
}

/** Scheduler job: sync every enabled mailbox. */
export async function syncAllMailAccounts(): Promise<number> {
  if (process.env.MAIL_SYNC_ENABLED === 'false') return 0;
  const accounts = await MailAccount.find({ syncEnabled: true }).select('_id').lean();
  let total = 0;
  for (const a of accounts) total += await syncAccount(String(a._id));
  return total;
}

/** Send from the user's own mailbox and log it on the CRM record(s). */
export async function sendFromAccount(
  accountId: string,
  input: { to: string[]; cc?: string[]; subject: string; body: string; html?: string; inReplyTo?: string; related?: { type: LinkType; id: string } }
) {
  const acc = (await MailAccount.findById(accountId).select('+credentials').lean()) as unknown as AccountDoc | null;
  if (!acc) throw new ApiError(404, 'Mailbox not found');
  const to = (input.to ?? []).map((e) => e.trim()).filter(Boolean);
  if (!to.length || !input.subject?.trim()) throw new ApiError(400, 'to and subject are required');
  const body = acc.signature ? `${input.body}\n\n${acc.signature}` : input.body;
  const domain = acc.emailAddress.split('@')[1] || 'localhost';
  const messageId = `<${crypto.randomUUID()}@${domain}>`;
  const from = acc.displayName ? `"${acc.displayName.replace(/"/g, '')}" <${acc.emailAddress}>` : acc.emailAddress;
  await smtpTransport(acc).sendMail({
    from,
    to,
    cc: input.cc,
    subject: input.subject,
    text: body,
    html: input.html,
    messageId,
    inReplyTo: input.inReplyTo,
    references: input.inReplyTo ? [input.inReplyTo] : undefined,
  });
  const extraLinks: Link[] =
    input.related && mongoose.Types.ObjectId.isValid(input.related.id) ? [{ type: input.related.type, id: new mongoose.Types.ObjectId(input.related.id) }] : [];
  await recordMessage(
    { ...acc, crmOnly: false },
    {
      messageId,
      inReplyTo: input.inReplyTo,
      from: { email: acc.emailAddress, name: acc.displayName ?? undefined },
      to: to.map((email) => ({ email: email.toLowerCase() })),
      cc: (input.cc ?? []).map((email) => ({ email: email.toLowerCase() })),
      subject: input.subject,
      text: body,
      date: new Date(),
      extraLinks,
    }
  );
  return { messageId };
}
