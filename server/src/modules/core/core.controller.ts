import { Request, Response } from 'express';
import type { AuthPayload } from '../../types/express';
import { ApiError } from '../../utils/ApiError';
import * as core from './core.service';

function ws(req: Request & { user?: AuthPayload; activeOrganizationId?: string }) {
  return req.activeOrganizationId;
}

function uid(req: Request & { user?: AuthPayload }) {
  const id = req.user?.id;
  if (!id) throw new ApiError(401, 'Unauthorized');
  return id;
}

export async function getCompany(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await core.getCompanySettings(ws(req));
  res.json({ success: true, data });
}

export async function updateCompany(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await core.updateCompanySettings(ws(req), req.body ?? {});
  res.json({ success: true, data });
}

export async function listCurrencies(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const activeOnly = String(req.query.activeOnly ?? 'true') !== 'false';
  const data = await core.listCurrencies({ activeOnly });
  res.json({ success: true, data });
}

export async function setCurrencyActive(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const isActive = Boolean(req.body?.isActive);
  const data = await core.setCurrencyActive(req.params.code, isActive);
  res.json({ success: true, data });
}

export async function listExchangeRates(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const q = req.query as {
    from?: string;
    to?: string;
    code?: string;
    name?: string;
    country?: string;
    page?: string;
    limit?: string;
    mode?: string;
  };
  if (q.mode === 'latest') {
    const data = await core.listLatestExchangeRates(ws(req));
    res.json({ success: true, data });
    return;
  }
  const data = await core.listExchangeRateRecords(ws(req), {
    from: q.from,
    to: q.to,
    code: q.code,
    name: q.name,
    country: q.country,
    page: q.page ? Number(q.page) : 1,
    limit: q.limit ? Number(q.limit) : 20,
  });
  res.json({ success: true, data });
}

export async function setExchangeRate(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await core.setExchangeRate(ws(req), req.params.code, req.body ?? {}, uid(req));
  res.json({ success: true, data });
}

export async function deleteExchangeRate(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await core.deleteExchangeRate(ws(req), req.params.id);
  res.json({ success: true, data });
}

export async function syncExchangeRates(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await core.syncExchangeRatesFromInternet(ws(req), uid(req), {
    effectiveFrom: req.body?.effectiveFrom ? String(req.body.effectiveFrom) : undefined,
  });
  res.json({ success: true, data });
}

export async function getExchangeRateHistory(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await core.getExchangeRateHistory(ws(req), req.params.code);
  res.json({ success: true, data });
}

export async function getPlatformModules(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await core.getPlatformEnabledModules();
  res.json({ success: true, data });
}

export async function updatePlatformModules(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await core.updatePlatformEnabledModules(req.body ?? {}, uid(req));
  res.json({ success: true, data });
}
