import crypto from 'crypto';
import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { env } from '../../config/env';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { sendCustomerEmail } from '../../services/email.service';
import { DocumentRecord } from './models/documentRecord.model';
import { DocumentSignatureRequest, DocumentVersion } from './models/documentVersion.model';
import { notifyUser } from '../notifications/notificationDispatch.service';

const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function contentHash(doc: { title?: string | null; content?: string | null }): string {
  return hash(`${doc.title ?? ''}\n---\n${doc.content ?? ''}`);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Versions ─────────────────────────────────────────────────────────────

/** Call before saving an edit: stores the current state if title/content are about to change. */
export async function snapshotBeforeEdit(
  doc: { _id: unknown; taskflowOrganizationId: unknown; version: number; title: string; summary?: string; content?: string; status: string },
  input: Record<string, unknown>,
  userId?: string
): Promise<boolean> {
  const changes =
    ('title' in input && input.title !== doc.title) || ('content' in input && (input.content ?? '') !== (doc.content ?? ''));
  if (!changes) return false;
  await DocumentVersion.updateOne(
    { documentId: doc._id, version: doc.version },
    {
      $setOnInsert: {
        taskflowOrganizationId: doc.taskflowOrganizationId,
        documentId: doc._id,
        version: doc.version,
        title: doc.title,
        summary: doc.summary,
        content: doc.content,
        status: doc.status,
        ...(userId && mongoose.Types.ObjectId.isValid(userId) ? { editedBy: new mongoose.Types.ObjectId(userId) } : {}),
      },
    },
    { upsert: true }
  );
  return true;
}

export async function listVersions(workspaceId: string | null | undefined, documentId: string) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  return DocumentVersion.find({ taskflowOrganizationId: orgOid, documentId })
    .sort({ version: -1 })
    .populate('editedBy', 'name')
    .lean();
}

export async function restoreVersion(workspaceId: string | null | undefined, documentId: string, version: number, userId?: string) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const [doc, snap] = await Promise.all([
    DocumentRecord.findOne({ _id: documentId, taskflowOrganizationId: orgOid }),
    DocumentVersion.findOne({ taskflowOrganizationId: orgOid, documentId, version }).lean(),
  ]);
  if (!doc) throw new ApiError(404, 'Document not found');
  if (!snap) throw new ApiError(404, 'Version not found');
  if (doc.status === 'signed') throw new ApiError(409, 'Signed documents cannot be changed');
  await snapshotBeforeEdit(doc, { title: snap.title, content: snap.content }, userId);
  doc.title = snap.title ?? doc.title;
  doc.summary = snap.summary ?? undefined;
  doc.content = snap.content ?? undefined;
  doc.version = (doc.version ?? 1) + 1;
  await doc.save();
  return doc.toObject();
}

// ── Signatures ───────────────────────────────────────────────────────────

export async function requestSignatures(
  workspaceId: string | null | undefined,
  documentId: string,
  input: { signers?: Array<{ name?: string; email?: string }>; message?: string; expiresInDays?: number },
  user: { id: string; name?: string }
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const doc = await DocumentRecord.findOne({ _id: documentId, taskflowOrganizationId: orgOid });
  if (!doc) throw new ApiError(404, 'Document not found');
  if (!doc.content?.trim()) throw new ApiError(400, 'Add content before requesting signatures');
  const signers = (input.signers ?? [])
    .map((s) => ({ name: String(s.name ?? '').trim(), email: String(s.email ?? '').trim().toLowerCase() }))
    .filter((s) => s.name && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.email));
  if (!signers.length || signers.length > 10) throw new ApiError(400, 'Add 1–10 signers with a name and valid email');

  await DocumentSignatureRequest.updateMany(
    { documentId: doc._id, status: 'pending' },
    { $set: { status: 'cancelled' } }
  );

  const tokens = signers.map(() => crypto.randomBytes(24).toString('base64url'));
  const days = Math.min(Math.max(1, Number(input.expiresInDays) || 30), 180);
  const request = await DocumentSignatureRequest.create({
    taskflowOrganizationId: orgOid,
    documentId: doc._id,
    version: doc.version,
    contentHash: contentHash(doc),
    message: input.message?.toString().slice(0, 1000),
    signers: signers.map((s, i) => ({ ...s, tokenHash: hash(tokens[i]) })),
    requestedBy: new mongoose.Types.ObjectId(user.id),
    expiresAt: new Date(Date.now() + days * 86_400_000),
  });

  doc.status = 'sent';
  doc.sentAt = new Date();
  await doc.save();

  const base = env.appUrl.replace(/\/$/, '');
  await Promise.all(
    signers.map((s, i) =>
      sendCustomerEmail(
        s.email,
        `Signature requested: ${doc.title}`,
        `<div style="font-family:Arial,sans-serif;font-size:14px">
<p>Hi ${esc(s.name)},</p>
<p>${esc(user.name ?? 'Someone')} asked you to review and sign <strong>${esc(doc.title)}</strong>.</p>
${input.message ? `<p style="white-space:pre-wrap">${esc(String(input.message))}</p>` : ''}
<p><a href="${base}/sign/${tokens[i]}" style="display:inline-block;padding:10px 16px;background:#4f46e5;color:#fff;border-radius:6px;text-decoration:none">Review & sign</a></p>
<p style="color:#666;font-size:12px">This link is personal to you and expires on ${request.expiresAt!.toDateString()}.</p></div>`
      ).catch((err) => console.error('[sign] email failed', s.email, err))
    )
  );

  const plain = request.toObject();
  return { ...plain, signers: plain.signers.map(({ tokenHash: _t, ...rest }) => (void _t, rest)) };
}

export async function listSignatureRequests(workspaceId: string | null | undefined, documentId: string) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  return DocumentSignatureRequest.find({ taskflowOrganizationId: orgOid, documentId })
    .select('-signers.tokenHash')
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();
}

async function findByToken(token: string) {
  const req = await DocumentSignatureRequest.findOne({ 'signers.tokenHash': hash(token) });
  if (!req) throw new ApiError(404, 'This signing link is invalid');
  const signer = req.signers.find((s) => s.tokenHash === hash(token))!;
  return { req, signer };
}

/** Public: what the signer sees. */
export async function getSigningView(token: string) {
  const { req, signer } = await findByToken(token);
  const doc = await DocumentRecord.findById(req.documentId).select('title content summary').lean();
  if (!doc) throw new ApiError(404, 'Document no longer exists');
  const expired = req.expiresAt && req.expiresAt < new Date();
  const changed = contentHash(doc) !== req.contentHash;
  return {
    title: doc.title,
    content: doc.content ?? '',
    message: req.message,
    signerName: signer.name,
    status: signer.signedAt ? 'signed' : signer.declinedAt ? 'declined' : req.status !== 'pending' || expired || changed ? 'unavailable' : 'pending',
    reason: changed ? 'The document changed after this request was sent.' : expired ? 'This request has expired.' : undefined,
    signedAt: signer.signedAt,
    otherSigners: req.signers.filter((s) => s.tokenHash !== signer.tokenHash).map((s) => ({ name: s.name, signed: Boolean(s.signedAt) })),
  };
}

export async function submitSignature(
  token: string,
  input: { action: 'sign' | 'decline'; signatureName?: string; reason?: string },
  meta: { ip?: string; userAgent?: string }
) {
  const { req, signer } = await findByToken(token);
  if (req.status !== 'pending') throw new ApiError(409, 'This signature request is closed');
  if (req.expiresAt && req.expiresAt < new Date()) throw new ApiError(410, 'This signing link has expired');
  if (signer.signedAt || signer.declinedAt) throw new ApiError(409, 'You already responded');
  const doc = await DocumentRecord.findById(req.documentId);
  if (!doc) throw new ApiError(404, 'Document no longer exists');
  if (contentHash(doc) !== req.contentHash) throw new ApiError(409, 'The document changed after this request was sent');

  if (input.action === 'decline') {
    signer.declinedAt = new Date();
    signer.declineReason = String(input.reason ?? '').slice(0, 1000);
    req.status = 'declined';
  } else {
    const typed = String(input.signatureName ?? '').trim();
    if (typed.length < 2) throw new ApiError(400, 'Type your full name to sign');
    signer.signedAt = new Date();
    signer.signatureName = typed.slice(0, 120);
    signer.ip = meta.ip;
    signer.userAgent = meta.userAgent?.slice(0, 300);
    if (req.signers.every((s) => s.signedAt)) {
      req.status = 'completed';
      req.completedAt = new Date();
      doc.status = 'signed';
      doc.signedAt = new Date();
      await doc.save();
    }
  }
  await req.save();

  if (req.requestedBy) {
    void notifyUser({
      userId: String(req.requestedBy),
      eventKey: 'document_shared',
      title:
        input.action === 'decline'
          ? `${signer.name} declined to sign ${doc.title}`
          : req.status === 'completed'
            ? `${doc.title} is fully signed`
            : `${signer.name} signed ${doc.title}`,
      body: input.action === 'decline' ? signer.declineReason || '' : '',
      link: '/documents',
    }).catch(() => undefined);
  }
  return { status: req.status };
}
