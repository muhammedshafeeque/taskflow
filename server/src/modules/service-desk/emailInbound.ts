import crypto from 'crypto';
import mongoose from 'mongoose';
import { ImapFlow, type MessageStructureObject } from 'imapflow';
import type { Readable } from 'stream';
import { ServiceTicket } from './models/serviceTicket.model';
import { CrmContact } from '../crm/models/crmContact.model';
import { sendCustomerEmail } from '../../services/email.service';
import { emitWorkspaceEvent } from '../webhooks/workspaceEvents';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { notifyUser } from '../notifications/notificationDispatch.service';

/**
 * Email → ticket. Polls one support mailbox over IMAP:
 *  - a new email opens a ticket (source "email") and gets an acknowledgement
 *  - a reply whose subject carries `[TKT-xxxxxxxx]` is added to that ticket as a comment
 *  - public agent replies on email tickets are emailed back to the requester (see `emailTicketReply`)
 *
 * Configure with SUPPORT_MAIL_* in server/.env (see .env.example).
 */
const cfg = {
  enabled: process.env.SUPPORT_MAIL_ENABLED === 'true',
  host: process.env.SUPPORT_MAIL_IMAP_HOST?.trim() ?? '',
  port: Number(process.env.SUPPORT_MAIL_IMAP_PORT) || 993,
  secure: process.env.SUPPORT_MAIL_IMAP_SECURE !== 'false',
  user: process.env.SUPPORT_MAIL_USER?.trim() ?? '',
  pass: process.env.SUPPORT_MAIL_PASSWORD ?? '',
  mailbox: process.env.SUPPORT_MAIL_FOLDER?.trim() || 'INBOX',
  workspaceId: process.env.SUPPORT_MAIL_WORKSPACE_ID?.trim() ?? '',
  intervalMs: Math.max(30_000, Number(process.env.SUPPORT_MAIL_POLL_MS) || 60_000),
};

const REF_RX = /\[TKT-([a-z0-9]{8})\]/i;
const MAX_BODY = 20_000;

export function ticketEmailSubject(subject: string, ref: string): string {
  return REF_RX.test(subject) ? subject : `${subject} [TKT-${ref}]`;
}

/** Drop quoted history so threaded replies only add the new text. */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const cut = lines.findIndex(
    (l) =>
      /^On .{5,200} wrote:\s*$/i.test(l.trim()) ||
      /^-{2,}\s*Original Message\s*-{2,}/i.test(l.trim()) ||
      /^From:\s.+/i.test(l.trim()) ||
      /^>/.test(l)
  );
  return (cut === -1 ? lines : lines.slice(0, cut)).join('\n').trim();
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

function findPart(node: MessageStructureObject | undefined, type: string): string | undefined {
  if (!node) return undefined;
  if (node.type?.toLowerCase() === type && node.disposition?.toLowerCase() !== 'attachment') return node.part ?? '1';
  for (const child of node.childNodes ?? []) {
    const hit = findPart(child, type);
    if (hit) return hit;
  }
  return undefined;
}

async function readStream(stream: Readable, max = MAX_BODY * 4): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > max) break;
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function asHtml(text: string): string {
  return `<div style="font-family:Arial,sans-serif;font-size:14px;white-space:pre-wrap">${escapeHtml(text)}</div>`;
}

/** Email the requester when an agent posts a public reply on an email-sourced ticket. */
export async function emailTicketReply(ticket: {
  subject: string;
  requesterEmail?: string;
  emailRef?: string;
  source?: string;
}, body: string, agentName?: string): Promise<void> {
  if (ticket.source !== 'email' || !ticket.requesterEmail || !ticket.emailRef) return;
  await sendCustomerEmail(
    ticket.requesterEmail,
    ticketEmailSubject(`Re: ${ticket.subject}`, ticket.emailRef),
    asHtml(`${body}\n\n— ${agentName ?? 'Support team'}\n\nReply to this email to add to your ticket.`)
  );
}

async function handleMessage(
  orgOid: mongoose.Types.ObjectId,
  msg: { subject: string; fromEmail: string; fromName?: string; text: string; autoReply: boolean }
): Promise<void> {
  if (msg.autoReply || !msg.fromEmail || msg.fromEmail === cfg.user.toLowerCase()) return;

  const ref = msg.subject.match(REF_RX)?.[1]?.toLowerCase();
  if (ref) {
    const ticket = await ServiceTicket.findOne({ taskflowOrganizationId: orgOid, emailRef: ref });
    if (ticket) {
      const body = stripQuotedReply(msg.text).slice(0, MAX_BODY) || '(empty reply)';
      ticket.comments.push({ authorName: msg.fromName || msg.fromEmail, body, internal: false, createdAt: new Date() });
      if (ticket.status === 'resolved' || ticket.status === 'pending') ticket.status = 'open';
      await ticket.save();
      emitWorkspaceEvent(String(orgOid), 'ticket.commented', { ticketId: String(ticket._id), subject: ticket.subject, author: msg.fromEmail, body });
      if (ticket.assigneeId) {
        void notifyUser({
          userId: String(ticket.assigneeId),
          eventKey: 'system_alert',
          title: `Customer replied: ${ticket.subject}`,
          body: body.slice(0, 200),
          link: `/service/tickets?ticket=${ticket._id}`,
        }).catch(() => undefined);
      }
      return;
    }
  }

  const contact = await CrmContact.findOne({ taskflowOrganizationId: orgOid, email: msg.fromEmail }).select('_id').lean();
  const emailRef = crypto.randomBytes(4).toString('hex');
  const subject = msg.subject.replace(REF_RX, '').trim() || '(no subject)';
  const ticket = await ServiceTicket.create({
    taskflowOrganizationId: orgOid,
    subject: subject.slice(0, 300),
    description: msg.text.slice(0, MAX_BODY),
    status: 'open',
    priority: 'medium',
    queue: 'email',
    source: 'email',
    contactId: contact?._id,
    requesterEmail: msg.fromEmail,
    requesterName: msg.fromName,
    emailRef,
  });
  emitWorkspaceEvent(String(orgOid), 'ticket.created', { ticketId: String(ticket._id), subject: ticket.subject, source: 'email' });

  await sendCustomerEmail(
    msg.fromEmail,
    ticketEmailSubject(`We received your request: ${subject}`, emailRef),
    asHtml(`Hi ${msg.fromName?.split(' ')[0] || 'there'},\n\nThanks for reaching out — we've opened ticket TKT-${emailRef} and will get back to you soon. Reply to this email to add details.\n\n— Support team`)
  ).catch((err) => console.error('[email→ticket] acknowledgement failed', err));

  const admins = await OrganizationMember.find({ organization: orgOid, role: 'org_admin', status: 'active' }).select('user').lean();
  for (const a of admins) {
    void notifyUser({
      userId: String(a.user),
      eventKey: 'system_alert',
      title: `New email ticket: ${subject}`,
      body: `From ${msg.fromEmail}`,
      link: `/service/tickets?ticket=${ticket._id}`,
    }).catch(() => undefined);
  }
}

let running = false;

export async function pollSupportMailbox(): Promise<number> {
  if (running) return 0;
  running = true;
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  });
  let processed = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock(cfg.mailbox);
    try {
      const uids = (await client.search({ seen: false }, { uid: true })) || [];
      const orgOid = new mongoose.Types.ObjectId(cfg.workspaceId);
      for (const uid of uids.slice(0, 50)) {
        const m = await client.fetchOne(String(uid), { envelope: true, bodyStructure: true, headers: ['auto-submitted', 'x-autoreply', 'precedence'] }, { uid: true });
        if (!m) continue;
        const headers = m.headers?.toString('utf8').toLowerCase() ?? '';
        const autoReply = /auto-submitted:\s*auto-|x-autoreply:|precedence:\s*(bulk|auto_reply|list)/.test(headers);
        const from = m.envelope?.from?.[0];
        const plainPart = findPart(m.bodyStructure, 'text/plain');
        const htmlPart = plainPart ? undefined : findPart(m.bodyStructure, 'text/html');
        let text = '';
        const part = plainPart ?? htmlPart;
        if (part) {
          const dl = await client.download(String(uid), part, { uid: true, maxBytes: MAX_BODY * 4 });
          text = await readStream(dl.content);
          if (htmlPart) text = htmlToText(text);
        }
        try {
          await handleMessage(orgOid, {
            subject: m.envelope?.subject ?? '',
            fromEmail: String(from?.address ?? '').toLowerCase(),
            fromName: from?.name || undefined,
            text: text.trim(),
            autoReply,
          });
          processed++;
        } finally {
          // Mark seen even on failure so one bad email can't block the queue forever.
          await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        }
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    console.error('[email→ticket] poll failed:', err instanceof Error ? err.message : err);
  } finally {
    running = false;
    await client.logout().catch(() => undefined);
  }
  return processed;
}

export function startSupportMailPoller(): void {
  if (!cfg.enabled) return;
  if (!cfg.host || !cfg.user || !cfg.pass || !mongoose.Types.ObjectId.isValid(cfg.workspaceId)) {
    console.warn('[email→ticket] SUPPORT_MAIL_ENABLED is true but host/user/password/workspace id are missing — disabled');
    return;
  }
  setTimeout(() => void pollSupportMailbox(), 20_000);
  setInterval(() => void pollSupportMailbox(), cfg.intervalMs);
  console.log(`[email→ticket] polling ${cfg.user}/${cfg.mailbox} every ${cfg.intervalMs / 1000}s`);
}
