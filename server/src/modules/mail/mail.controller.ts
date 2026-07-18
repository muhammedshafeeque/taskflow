import { Request, Response } from 'express';
import type { AuthPayload } from '../../types/express';
import { ApiError } from '../../utils/ApiError';
import * as mailService from './mail.service';
import { syncMailbox } from './imapSync.worker';

function ws(req: Request & { activeOrganizationId?: string }) {
  return req.activeOrganizationId;
}

function uid(req: Request & { user?: AuthPayload }) {
  const id = req.user?.id;
  if (!id) throw new ApiError(401, 'Unauthorized');
  return id;
}

export async function listMailboxes(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await mailService.listMailboxes(ws(req));
  res.json({ success: true, data });
}

export async function createMailbox(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await mailService.createMailbox(ws(req), req.body);
  res.status(201).json({ success: true, data });
}

export async function listMessages(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const q = req.query as { mailboxId?: string; threadId?: string; page?: string; limit?: string };
  const data = await mailService.listMessages(ws(req), {
    mailboxId: q.mailboxId,
    threadId: q.threadId,
    page: q.page ? parseInt(q.page, 10) : undefined,
    limit: q.limit ? parseInt(q.limit, 10) : undefined,
  });
  res.json({ success: true, data });
}

export async function getMessage(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await mailService.getMessage(req.params.id, ws(req));
  res.json({ success: true, data });
}

export async function linkMessage(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const body = req.body as { entityType?: string; entityId?: string };
  const data = await mailService.linkMessage(
    req.params.id,
    ws(req),
    body.entityType as 'account' | 'contact' | 'lead' | 'deal' | 'ticket',
    String(body.entityId)
  );
  res.json({ success: true, data });
}

export async function sendMail(req: Request & { user?: AuthPayload }, res: Response) {
  const body = req.body as {
    mailboxId?: string;
    to?: string[];
    cc?: string[];
    subject?: string;
    bodyHtml?: string;
    inReplyTo?: string;
    threadId?: string;
  };
  const data = await mailService.sendMail(
    ws(req),
    {
      mailboxId: String(body.mailboxId),
      to: body.to ?? [],
      cc: body.cc,
      subject: String(body.subject ?? ''),
      bodyHtml: String(body.bodyHtml ?? ''),
      inReplyTo: body.inReplyTo,
      threadId: body.threadId,
    },
    uid(req)
  );
  res.status(201).json({ success: true, data });
}

export async function syncMailboxNow(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const count = await syncMailbox(req.params.id);
  res.json({ success: true, data: { imported: count } });
}
