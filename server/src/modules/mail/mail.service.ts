import mongoose from 'mongoose';
import nodemailer from 'nodemailer';
import { MailMailbox } from './models/mailMailbox.model';
import { MailMessage } from './models/mailMessage.model';
import { CrmContact } from '../crm/models/crmContact.model';
import { CrmActivity } from '../crm/models/crmActivity.model';
import { CrmLead } from '../crm/models/crmLead.model';
import { encryptSecret, decryptSecret } from '../../utils/secretCrypto';
import { ApiError } from '../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { resolveMailboxHosts } from './posteio.adapter';
import * as ticketsService from '../service-desk/tickets.service';

export async function listMailboxes(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  return MailMailbox.find({ taskflowOrganizationId: toOrgOid(orgId) })
    .select('-passwordEncrypted')
    .sort({ name: 1 })
    .lean();
}

export async function createMailbox(workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  const hosts = resolveMailboxHosts({
    imapHost: input.imapHost as string | undefined,
    imapPort: input.imapPort as number | undefined,
    smtpHost: input.smtpHost as string | undefined,
    smtpPort: input.smtpPort as number | undefined,
  });
  const password = String(input.password ?? '');
  if (!password) throw new ApiError(400, 'Mailbox password is required');
  const doc = await MailMailbox.create({
    taskflowOrganizationId: toOrgOid(orgId),
    name: String(input.name ?? '').trim(),
    email: String(input.email ?? '').trim().toLowerCase(),
    type: input.type ?? 'shared',
    userId: input.userId,
    ...hosts,
    username: String(input.username ?? input.email ?? '').trim(),
    passwordEncrypted: encryptSecret(password),
    syncEnabled: input.syncEnabled !== false,
    signature: input.signature,
  });
  const obj = doc.toObject();
  delete (obj as { passwordEncrypted?: string }).passwordEncrypted;
  return obj;
}

export async function listMessages(
  workspaceId: string | null | undefined,
  opts: { mailboxId?: string; threadId?: string; page?: number; limit?: number } = {}
) {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId) };
  if (opts.mailboxId) filter.mailboxId = opts.mailboxId;
  if (opts.threadId) filter.threadId = opts.threadId;
  const page = opts.page ?? 1;
  const limit = Math.min(opts.limit ?? 50, 100);
  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    MailMessage.find(filter).sort({ sentAt: -1 }).skip(skip).limit(limit).lean(),
    MailMessage.countDocuments(filter),
  ]);
  return { data, total, page, limit };
}

export async function getMessage(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const msg = await MailMessage.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) }).lean();
  if (!msg) throw new ApiError(404, 'Message not found');
  await MailMessage.findByIdAndUpdate(id, { $set: { isRead: true } });
  return msg;
}

export async function linkMessage(
  id: string,
  workspaceId: string | null | undefined,
  entityType: 'account' | 'contact' | 'lead' | 'deal' | 'ticket',
  entityId: string
) {
  const orgId = requireWorkspaceId(workspaceId);
  const updated = await MailMessage.findOneAndUpdate(
    { _id: id, taskflowOrganizationId: toOrgOid(orgId) },
    { $addToSet: { linkedEntities: { entityType, entityId: new mongoose.Types.ObjectId(entityId) } } },
    { new: true }
  ).lean();
  if (!updated) throw new ApiError(404, 'Message not found');
  return updated;
}

async function autoLinkByEmail(workspaceId: string, fromEmail: string, messageId: string) {
  const contact = await CrmContact.findOne({
    taskflowOrganizationId: toOrgOid(workspaceId),
    email: fromEmail.toLowerCase(),
  }).lean();
  if (!contact) return;
  await MailMessage.findByIdAndUpdate(messageId, {
    $addToSet: {
      linkedEntities: [
        { entityType: 'contact', entityId: contact._id },
        { entityType: 'account', entityId: contact.accountId },
      ],
    },
  });
  await CrmActivity.create({
    taskflowOrganizationId: toOrgOid(workspaceId),
    type: 'email',
    subject: `Inbound email from ${fromEmail}`,
    relatedType: 'contact',
    relatedId: contact._id,
    mailMessageId: messageId,
  });
}

async function applyRoutingRules(
  workspaceId: string,
  mailbox: { email: string; name: string },
  fromEmail: string,
  subject: string,
  userId?: string
) {
  const email = mailbox.email.toLowerCase();
  const subj = subject.toLowerCase();
  if (email.includes('support') || subj.includes('support') || subj.includes('help')) {
    await ticketsService.createTicket(
      workspaceId,
      { subject: subject || `Email from ${fromEmail}`, description: `Auto-created from ${mailbox.email}`, queue: 'email', priority: 'medium' },
      userId ?? 'system'
    );
    return;
  }
  if (email.includes('sales') || subj.includes('quote') || subj.includes('pricing')) {
    await CrmLead.create({
      taskflowOrganizationId: toOrgOid(workspaceId),
      title: subject || `Lead from ${fromEmail}`,
      source: 'email',
      status: 'new',
      contactEmail: fromEmail,
    });
  }
}

export async function sendMail(
  workspaceId: string | null | undefined,
  input: {
    mailboxId: string;
    to: string[];
    cc?: string[];
    subject: string;
    bodyHtml: string;
    inReplyTo?: string;
    threadId?: string;
  },
  userId: string
) {
  const orgId = requireWorkspaceId(workspaceId);
  const mailbox = await MailMailbox.findOne({ _id: input.mailboxId, taskflowOrganizationId: toOrgOid(orgId) });
  if (!mailbox) throw new ApiError(404, 'Mailbox not found');
  const password = decryptSecret(mailbox.passwordEncrypted);
  const transporter = nodemailer.createTransport({
    host: mailbox.smtpHost,
    port: mailbox.smtpPort,
    secure: mailbox.smtpPort === 465,
    auth: { user: mailbox.username, pass: password },
  });
  const signature = mailbox.signature ? `<br/><br/>${mailbox.signature}` : '';
  const html = `${input.bodyHtml}${signature}`;
  const info = await transporter.sendMail({
    from: mailbox.email,
    to: input.to.join(', '),
    cc: input.cc?.join(', '),
    subject: input.subject,
    html,
    inReplyTo: input.inReplyTo,
  });
  const messageId = info.messageId ?? `local-${Date.now()}`;
  const doc = await MailMessage.create({
    taskflowOrganizationId: toOrgOid(orgId),
    mailboxId: mailbox._id,
    messageId,
    threadId: input.threadId ?? messageId,
    inReplyTo: input.inReplyTo,
    direction: 'outbound',
    from: mailbox.email,
    to: input.to,
    cc: input.cc ?? [],
    subject: input.subject,
    bodyHtml: html,
    sentAt: new Date(),
    isRead: true,
  });
  await CrmActivity.create({
    taskflowOrganizationId: toOrgOid(orgId),
    type: 'email',
    subject: `Sent: ${input.subject}`,
    body: input.bodyHtml,
    createdBy: userId,
    mailMessageId: doc._id,
  });
  return doc.toObject();
}

export async function processInboundMessage(
  workspaceId: string,
  mailbox: InstanceType<typeof MailMailbox>,
  parsed: {
    messageId: string;
    from: string;
    to: string[];
    subject: string;
    bodyText?: string;
    bodyHtml?: string;
    sentAt: Date;
    inReplyTo?: string;
  }
) {
  const existing = await MailMessage.findOne({ mailboxId: mailbox._id, messageId: parsed.messageId });
  if (existing) return existing.toObject();
  const fromMatch = parsed.from.match(/<([^>]+)>/) ?? [null, parsed.from];
  const fromEmail = (fromMatch[1] ?? parsed.from).trim().toLowerCase();
  const doc = await MailMessage.create({
    taskflowOrganizationId: mailbox.taskflowOrganizationId,
    mailboxId: mailbox._id,
    messageId: parsed.messageId,
    threadId: parsed.inReplyTo ?? parsed.messageId,
    inReplyTo: parsed.inReplyTo,
    direction: 'inbound',
    from: fromEmail,
    to: parsed.to,
    subject: parsed.subject,
    bodyText: parsed.bodyText,
    bodyHtml: parsed.bodyHtml,
    sentAt: parsed.sentAt,
    isRead: false,
  });
  await autoLinkByEmail(workspaceId, fromEmail, String(doc._id));
  await applyRoutingRules(workspaceId, mailbox, fromEmail, parsed.subject);
  return doc.toObject();
}

export { autoLinkByEmail, applyRoutingRules };
