import { Request, Response } from 'express';
import type { AuthPayload } from '../../types/express';
import { ApiError } from '../../utils/ApiError';
import * as contractsService from '../crm/contracts/contracts.service';
import * as slaService from '../service-desk/sla.service';

function ws(req: Request & { user?: AuthPayload; activeOrganizationId?: string }) {
  return req.activeOrganizationId;
}

function uid(req: Request & { user?: AuthPayload }) {
  const id = req.user?.id;
  if (!id) throw new ApiError(401, 'Unauthorized');
  return id;
}

export async function getDashboard(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await contractsService.getContractsHubDashboard(ws(req));
  res.json({ success: true, data });
}

export async function list(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const q = req.query as { accountId?: string; kind?: string; status?: string; renewingWithinDays?: string };
  const data = await contractsService.listContracts(ws(req), {
    accountId: q.accountId,
    kind: q.kind,
    status: q.status,
    renewingWithinDays: q.renewingWithinDays ? Number(q.renewingWithinDays) : undefined,
  });
  res.json({ success: true, data });
}

export async function create(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await contractsService.createContract(ws(req), req.body);
  res.status(201).json({ success: true, data });
}

export async function update(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await contractsService.updateContract(req.params.id, ws(req), req.body);
  res.json({ success: true, data });
}

export async function remove(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await contractsService.deleteContract(req.params.id, ws(req));
  res.json({ success: true, data });
}

export async function burnDown(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await contractsService.getContractBurnDown(req.params.id, ws(req));
  res.json({ success: true, data });
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
