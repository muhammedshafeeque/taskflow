import { Request, Response } from 'express';
import type { AuthPayload } from '../../types/express';
import { ApiError } from '../../utils/ApiError';
import * as hrms from './hrms.service';
import * as exit from './exit.service';
import { grantActorOf } from '../auth/grantGuard';
import { assertReaches, reachFor } from './dataScope';

const hr = (req: Request) => reachFor(req as never, 'hr');

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
  res.json({ success: true, data: await hrms.getHrmsDashboard(ws(req), req.user?.permissions ?? [], await hr(req)) });
}

export async function listEmployees(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  res.json({ success: true, data: await hrms.listEmployees(ws(req), req.query as Record<string, string>, req.user?.permissions ?? [], await hr(req)) });
}
export async function createEmployee(req: Request & { user?: AuthPayload }, res: Response) {
  res.status(201).json({ success: true, data: await hrms.createEmployee(ws(req), req.body ?? {}, req.user?.permissions ?? [], grantActorOf(req), await hr(req)) });
}
export async function updateEmployee(req: Request & { user?: AuthPayload }, res: Response) {
  res.json({ success: true, data: await hrms.updateEmployee(req.params.id, ws(req), req.body ?? {}, grantActorOf(req), await hr(req)) });
}
export async function deleteEmployee(req: Request & { user?: AuthPayload }, res: Response) {
  res.json({ success: true, data: await hrms.deleteEmployee(req.params.id, ws(req), await hr(req), req.user?.id) });
}

export async function restoreEmployee(req: Request & { user?: AuthPayload }, res: Response) {
  res.json({ success: true, data: await hrms.restoreEmployee(req.params.id, ws(req), await hr(req), req.user?.id) });
}

export async function getOpenWork(req: Request, res: Response) {
  assertReaches(await hr(req), req.params.id);
  res.json({ success: true, data: await exit.getOpenWork(ws(req), req.params.id) });
}
export async function reassignWork(req: Request, res: Response) {
  assertReaches(await hr(req), req.params.id);
  res.json({ success: true, data: await exit.reassignWork(ws(req), req.params.id, req.body ?? {}, grantActorOf(req)) });
}

export async function listLeave(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  res.json({ success: true, data: await hrms.listLeave(ws(req), req.query as Record<string, string>, await hr(req)) });
}
export async function createLeave(req: Request & { user?: AuthPayload }, res: Response) {
  res.status(201).json({ success: true, data: await hrms.createLeave(ws(req), req.body, await hr(req), uid(req)) });
}
export async function decideLeave(req: Request & { user?: AuthPayload }, res: Response) {
  const status = req.body?.status as 'approved' | 'rejected' | 'cancelled';
  res.json({ success: true, data: await hrms.decideLeave(req.params.id, ws(req), status, uid(req), false, await hr(req), req.user?.permissions) });
}

export async function listAttendance(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  res.json({ success: true, data: await hrms.listAttendance(ws(req), req.query as Record<string, string>, await hr(req)) });
}
export async function markAttendance(req: Request & { user?: AuthPayload }, res: Response) {
  res.status(201).json({ success: true, data: await hrms.markAttendance(ws(req), req.body, await hr(req)) });
}

export async function markAttendanceBulk(req: Request & { user?: AuthPayload }, res: Response) {
  res.json({ success: true, data: await hrms.markAttendanceBulk(ws(req), req.body ?? {}, await hr(req)) });
}

export async function getPayroll(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  res.json({ success: true, data: await hrms.getPayrollRun(ws(req)) });
}
