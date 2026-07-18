import { Request, Response } from 'express';
import type { AuthPayload } from '../../types/express';
import { ApiError } from '../../utils/ApiError';
import * as ticketsService from './tickets.service';
import * as slaService from './sla.service';
import * as kbService from './kb.service';

function ws(req: Request & { activeOrganizationId?: string }) {
  return req.activeOrganizationId;
}

function uid(req: Request & { user?: AuthPayload }) {
  const id = req.user?.id;
  if (!id) throw new ApiError(401, 'Unauthorized');
  return id;
}

export async function getDashboard(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await ticketsService.getServiceDashboard(ws(req));
  res.json({ success: true, data });
}

export async function listTickets(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const q = req.query as { status?: string; queue?: string };
  const data = await ticketsService.listTickets(ws(req), q);
  res.json({ success: true, data });
}

export async function createTicket(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await ticketsService.createTicket(ws(req), req.body, uid(req));
  res.status(201).json({ success: true, data });
}

export async function updateTicket(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await ticketsService.updateTicket(req.params.id, ws(req), req.body);
  res.json({ success: true, data });
}

export async function getTicket(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await ticketsService.getTicket(req.params.id, ws(req));
  res.json({ success: true, data });
}

export async function addComment(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await ticketsService.addComment(req.params.id, ws(req), req.body, {
    id: req.user?.id,
    name: req.user?.name,
  });
  res.status(201).json({ success: true, data });
}

export async function submitCsat(req: Request & { user?: AuthPayload }, res: Response) {
  const body = req.body as { score?: number; comment?: string };
  const data = await ticketsService.submitCsat(req.params.id, ws(req), Number(body.score), body.comment);
  res.json({ success: true, data });
}

export async function createFromRequest(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await ticketsService.createTicketFromCustomerRequest(
    req.params.requestId,
    String(ws(req)),
    uid(req)
  );
  res.status(201).json({ success: true, data });
}

export async function listSla(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  await slaService.ensureDefaultSla(ws(req));
  const data = await slaService.listSlaPolicies(ws(req));
  res.json({ success: true, data });
}

export async function createSla(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await slaService.createSlaPolicy(ws(req), req.body);
  res.status(201).json({ success: true, data });
}

export async function updateSla(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await slaService.updateSlaPolicy(req.params.id, ws(req), req.body);
  res.json({ success: true, data });
}

export async function listKb(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const publishedOnly = req.query.published === 'true';
  const data = await kbService.listKbArticles(ws(req), publishedOnly);
  res.json({ success: true, data });
}

export async function searchKb(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const q = String(req.query.q ?? '');
  const data = await kbService.searchKbArticles(ws(req), q);
  res.json({ success: true, data });
}

export async function createKb(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await kbService.createKbArticle(ws(req), req.body, uid(req));
  res.status(201).json({ success: true, data });
}

export async function updateKb(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await kbService.updateKbArticle(req.params.id, ws(req), req.body);
  res.json({ success: true, data });
}

export async function listKbPortal(req: Request, res: Response) {
  const orgId = req.headers['x-organization-id'] as string | undefined;
  if (!orgId) throw new ApiError(400, 'Organization required');
  const data = await kbService.listKbArticles(orgId, true);
  res.json({ success: true, data });
}
