import { Currency } from './models/currency.model';
import { CoreCompanySettings } from './models/coreCompanySettings.model';
import { CurrencyExchangeRate } from './models/currencyExchangeRate.model';
import {
  PlatformModuleSettings,
  PLATFORM_MODULE_SETTINGS_KEY,
} from './models/platformModuleSettings.model';
import { Organization } from '../organizations/organization.model';
import { ApiError } from '../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import {
  ALWAYS_ON_MODULES,
  TOGGLEABLE_MODULES,
  type EnabledModulesMap,
  type ModuleId,
  type ToggleableModuleId,
  isModuleEnabled,
} from '../../shared/constants/moduleAccess';

function asDate(value: unknown, fallback = new Date()): Date {
  if (value === null || value === undefined || value === '') return fallback;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? fallback : d;
}

export async function getCompanySettings(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const existing = await CoreCompanySettings.findOne({ taskflowOrganizationId: orgOid }).lean();
  if (existing) return existing;
  const org = await Organization.findById(orgOid).lean();
  if (!org) throw new ApiError(404, 'Organization not found');
  await CoreCompanySettings.create({
    taskflowOrganizationId: orgOid,
    companyName: org.name,
    logoUrl: (org as { logoUrl?: string }).logoUrl,
    baseCurrencyCode: 'USD',
  });
  const created = await CoreCompanySettings.findOne({ taskflowOrganizationId: orgOid }).lean();
  if (!created) throw new ApiError(500, 'Failed to create company settings');
  return created;
}

export async function updateCompanySettings(
  workspaceId: string | null | undefined,
  input: Record<string, unknown>
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  await getCompanySettings(workspaceId);

  const patch: Record<string, unknown> = {};
  const stringFields = [
    'companyName',
    'legalName',
    'logoUrl',
    'address',
    'city',
    'country',
    'taxId',
    'website',
    'baseCurrencyCode',
    'timezone',
    'notes',
  ] as const;

  for (const key of stringFields) {
    if (input[key] !== undefined) {
      const raw = input[key];
      if (raw === null || raw === '') {
        if (key === 'companyName') throw new ApiError(400, 'Company name is required');
        if (key === 'baseCurrencyCode') patch[key] = 'USD';
        else if (key === 'logoUrl') patch[key] = '';
        else patch[key] = undefined;
      } else {
        const value = String(raw).trim();
        patch[key] = key === 'baseCurrencyCode' ? value.toUpperCase() : value;
      }
    }
  }

  if (patch.baseCurrencyCode) {
    const code = String(patch.baseCurrencyCode);
    if (code !== 'USD') {
      const currency = await Currency.findOne({ code, isActive: true }).lean();
      if (!currency) throw new ApiError(400, `Unknown or inactive currency: ${code}`);
    }
  }

  if (patch.logoUrl) {
    const url = String(patch.logoUrl);
    if (!url.startsWith('/') && !/^https?:\/\//i.test(url)) {
      throw new ApiError(400, 'logoUrl must be a path or http(s) URL');
    }
  }

  const orgPatch: Record<string, unknown> = {};
  if (patch.companyName) orgPatch.name = patch.companyName;
  if (input.logoUrl !== undefined) {
    orgPatch.logoUrl = patch.logoUrl === '' ? undefined : patch.logoUrl;
  }
  if (Object.keys(orgPatch).length > 0) {
    const $set: Record<string, unknown> = {};
    const $unset: Record<string, 1> = {};
    for (const [k, v] of Object.entries(orgPatch)) {
      if (v === undefined) $unset[k] = 1;
      else $set[k] = v;
    }
    const update: Record<string, unknown> = {};
    if (Object.keys($set).length) update.$set = $set;
    if (Object.keys($unset).length) update.$unset = $unset;
    await Organization.findByIdAndUpdate(orgOid, update);
  }

  // Persist empty logoUrl as unset on company settings
  const companyUpdate: Record<string, unknown> = { $set: { ...patch } };
  if (patch.logoUrl === '') {
    delete (companyUpdate.$set as Record<string, unknown>).logoUrl;
    companyUpdate.$unset = { logoUrl: 1 };
  }

  const updated = await CoreCompanySettings.findOneAndUpdate(
    { taskflowOrganizationId: orgOid },
    companyUpdate,
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

  if (!updated) {
    // upsert with only $set may miss required companyName on first insert
    const org = await Organization.findById(orgOid).lean();
    if (!org) throw new ApiError(404, 'Organization not found');
    const created = await CoreCompanySettings.create({
      taskflowOrganizationId: orgOid,
      companyName: String(patch.companyName ?? org.name),
      ...patch,
      baseCurrencyCode: String(patch.baseCurrencyCode ?? 'USD'),
    });
    return created.toObject();
  }

  return updated;
}

export async function listCurrencies(opts?: { activeOnly?: boolean }) {
  const filter: Record<string, unknown> = {};
  if (opts?.activeOnly) filter.isActive = true;
  return Currency.find(filter).sort({ code: 1 }).lean();
}

export async function setCurrencyActive(code: string, isActive: boolean) {
  const normalized = code.trim().toUpperCase();
  const updated = await Currency.findOneAndUpdate(
    { code: normalized },
    { $set: { isActive } },
    { new: true }
  ).lean();
  if (!updated) throw new ApiError(404, 'Currency not found');
  return updated;
}

export async function listLatestExchangeRates(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const rates = await CurrencyExchangeRate.find({ taskflowOrganizationId: orgOid })
    .sort({ currencyCode: 1, effectiveFrom: -1 })
    .lean();

  const latestByCode = new Map<string, (typeof rates)[number]>();
  for (const row of rates) {
    if (!latestByCode.has(row.currencyCode)) latestByCode.set(row.currencyCode, row);
  }

  const currencies = await Currency.find({ isActive: true }).sort({ code: 1 }).lean();
  return currencies.map((c) => {
    if (c.code === 'USD') {
      return {
        currencyCode: 'USD',
        name: c.name,
        symbol: c.symbol,
        rateToUsd: 1,
        effectiveFrom: null,
        notes: 'Base USD',
        isImplied: true,
      };
    }
    const rate = latestByCode.get(c.code);
    return {
      currencyCode: c.code,
      name: c.name,
      symbol: c.symbol,
      rateToUsd: rate?.rateToUsd ?? null,
      effectiveFrom: rate?.effectiveFrom ?? null,
      notes: rate?.notes,
      isImplied: false,
      _id: rate?._id,
    };
  });
}

/** Day-wise ROE records (not one row per currency). */
export async function listExchangeRateRecords(
  workspaceId: string | null | undefined,
  opts?: {
    from?: string;
    to?: string;
    code?: string;
    name?: string;
    country?: string;
    page?: number;
    limit?: number;
  }
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);

  const filter: Record<string, unknown> = { taskflowOrganizationId: orgOid };
  if (opts?.code?.trim()) {
    filter.currencyCode = opts.code.trim().toUpperCase();
  }
  if (opts?.from || opts?.to) {
    const range: Record<string, Date> = {};
    if (opts.from) {
      const d = asDate(opts.from);
      d.setUTCHours(0, 0, 0, 0);
      range.$gte = d;
    }
    if (opts.to) {
      const d = asDate(opts.to);
      d.setUTCHours(23, 59, 59, 999);
      range.$lte = d;
    }
    filter.effectiveFrom = range;
  }

  let rates = await CurrencyExchangeRate.find(filter).sort({ effectiveFrom: -1, currencyCode: 1 }).lean();

  const codes = [...new Set(rates.map((r) => r.currencyCode))];
  const currencies = await Currency.find({ code: { $in: codes } }).lean();
  const byCode = new Map(currencies.map((c) => [c.code, c]));

  const nameQ = opts?.name?.trim().toLowerCase() ?? '';
  const countryQ = opts?.country?.trim().toLowerCase() ?? '';

  let enriched = rates.map((r) => {
    const c = byCode.get(r.currencyCode);
    return {
      _id: String(r._id),
      currencyCode: r.currencyCode,
      name: c?.name ?? r.currencyCode,
      symbol: c?.symbol ?? '',
      countries: c?.countries ?? [],
      rateToUsd: r.rateToUsd,
      effectiveFrom: r.effectiveFrom,
      notes: r.notes,
      updatedAt: r.updatedAt,
    };
  });

  if (nameQ) {
    enriched = enriched.filter(
      (r) => r.name.toLowerCase().includes(nameQ) || r.currencyCode.toLowerCase().includes(nameQ)
    );
  }
  if (countryQ) {
    enriched = enriched.filter((r) =>
      (r.countries ?? []).some((country) => country.toLowerCase().includes(countryQ))
    );
  }

  const page = Math.max(1, Number(opts?.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(opts?.limit) || 20));
  const total = enriched.length;
  const start = (page - 1) * limit;
  const items = enriched.slice(start, start + limit);

  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

export async function deleteExchangeRate(
  workspaceId: string | null | undefined,
  id: string
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const deleted = await CurrencyExchangeRate.findOneAndDelete({
    _id: id,
    taskflowOrganizationId: orgOid,
  }).lean();
  if (!deleted) throw new ApiError(404, 'Exchange rate record not found');
  return { ok: true };
}

const OPEN_ER_API_URL = 'https://open.er-api.com/v6/latest/USD';

/**
 * Pull latest USD-based rates from open.er-api.com and upsert day-wise ROE records.
 * API returns units of currency per 1 USD; we store rateToUsd = 1 / units (amount × rateToUsd = USD).
 */
export async function syncExchangeRatesFromInternet(
  workspaceId: string | null | undefined,
  userId: string,
  opts?: { effectiveFrom?: string }
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);

  let payload: {
    result?: string;
    rates?: Record<string, number>;
    time_last_update_utc?: string;
    provider?: string;
  };
  try {
    const res = await fetch(OPEN_ER_API_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    payload = (await res.json()) as typeof payload;
  } catch (err) {
    throw new ApiError(502, `Failed to fetch rates from open.er-api.com: ${(err as Error).message}`);
  }

  if (payload.result !== 'success' || !payload.rates || typeof payload.rates !== 'object') {
    throw new ApiError(502, 'Unexpected response from open.er-api.com');
  }

  const effectiveFrom = asDate(opts?.effectiveFrom, new Date());
  effectiveFrom.setUTCHours(0, 0, 0, 0);

  const catalog = await Currency.find({ isActive: true, code: { $ne: 'USD' } }).lean();
  const notes = `Synced from open.er-api.com${payload.time_last_update_utc ? ` (${payload.time_last_update_utc})` : ''}`;

  let upserted = 0;
  let skipped = 0;
  const details: Array<{ code: string; rateToUsd: number }> = [];

  for (const c of catalog) {
    const unitsPerUsd = Number(payload.rates[c.code]);
    if (!Number.isFinite(unitsPerUsd) || unitsPerUsd <= 0) {
      skipped += 1;
      continue;
    }
    // 1 foreign unit = 1/unitsPerUsd USD
    const rateToUsd = Math.round((1 / unitsPerUsd) * 1e10) / 1e10;
    await CurrencyExchangeRate.findOneAndUpdate(
      {
        taskflowOrganizationId: orgOid,
        currencyCode: c.code,
        effectiveFrom,
      },
      {
        $set: {
          rateToUsd,
          notes,
          updatedBy: userId,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    upserted += 1;
    details.push({ code: c.code, rateToUsd });
  }

  return {
    ok: true,
    source: OPEN_ER_API_URL,
    provider: payload.provider ?? 'exchangerate-api.com',
    effectiveFrom,
    timeLastUpdateUtc: payload.time_last_update_utc,
    upserted,
    skipped,
    details,
  };
}

export async function setExchangeRate(
  workspaceId: string | null | undefined,
  code: string,
  input: Record<string, unknown>,
  userId: string
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const currencyCode = code.trim().toUpperCase();

  if (currencyCode === 'USD') {
    throw new ApiError(400, 'USD rate is fixed at 1 and cannot be changed');
  }

  const currency = await Currency.findOne({ code: currencyCode }).lean();
  if (!currency) throw new ApiError(404, 'Currency not found in catalog');

  const rateToUsd = Number(input.rateToUsd);
  if (!Number.isFinite(rateToUsd) || rateToUsd < 0) {
    throw new ApiError(400, 'rateToUsd must be a non-negative number');
  }

  const effectiveFrom = asDate(input.effectiveFrom, new Date());
  // Normalize to start of day UTC for uniqueness stability
  effectiveFrom.setUTCHours(0, 0, 0, 0);

  const doc = await CurrencyExchangeRate.findOneAndUpdate(
    {
      taskflowOrganizationId: orgOid,
      currencyCode,
      effectiveFrom,
    },
    {
      $set: {
        rateToUsd,
        notes: input.notes != null ? String(input.notes) : undefined,
        updatedBy: userId,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  return doc;
}

export async function getExchangeRateHistory(
  workspaceId: string | null | undefined,
  code: string
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const currencyCode = code.trim().toUpperCase();
  return CurrencyExchangeRate.find({ taskflowOrganizationId: orgOid, currencyCode })
    .sort({ effectiveFrom: -1 })
    .lean();
}

/**
 * Convert an amount in `currencyCode` to USD using the latest rate on or before `asOf`.
 */
export async function toUsd(
  workspaceId: string | null | undefined,
  amount: number,
  currencyCode: string,
  asOf?: Date
) {
  const code = currencyCode.trim().toUpperCase();
  if (code === 'USD') return amount;
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const filter: Record<string, unknown> = {
    taskflowOrganizationId: orgOid,
    currencyCode: code,
  };
  if (asOf) filter.effectiveFrom = { $lte: asOf };

  const rate = await CurrencyExchangeRate.findOne(filter).sort({ effectiveFrom: -1 }).lean();
  if (!rate) throw new ApiError(400, `No exchange rate for ${code}`);
  return Math.round(amount * rate.rateToUsd * 100) / 100;
}

// ── Platform-wide module enable/disable ──────────────────────────────────────

let moduleFlagsCache: { map: EnabledModulesMap; at: number } | null = null;
const MODULE_FLAGS_CACHE_MS = 5_000;

export function invalidatePlatformModuleCache() {
  moduleFlagsCache = null;
}

function mapFromDoc(enabledModules: unknown): EnabledModulesMap {
  const out: EnabledModulesMap = {};
  for (const id of TOGGLEABLE_MODULES) {
    out[id] = true;
  }
  if (!enabledModules) return out;

  const raw =
    enabledModules instanceof Map
      ? Object.fromEntries(enabledModules.entries())
      : (enabledModules as Record<string, boolean>);

  for (const id of TOGGLEABLE_MODULES) {
    if (raw[id] === false) out[id] = false;
    else if (raw[id] === true) out[id] = true;
  }
  for (const id of ALWAYS_ON_MODULES) {
    out[id] = true;
  }
  return out;
}

export async function getPlatformEnabledModules(): Promise<EnabledModulesMap> {
  const now = Date.now();
  if (moduleFlagsCache && now - moduleFlagsCache.at < MODULE_FLAGS_CACHE_MS) {
    return moduleFlagsCache.map;
  }

  let doc = await PlatformModuleSettings.findOne({ key: PLATFORM_MODULE_SETTINGS_KEY }).lean();
  if (!doc) {
    await PlatformModuleSettings.create({
      key: PLATFORM_MODULE_SETTINGS_KEY,
      enabledModules: {},
    });
    doc = await PlatformModuleSettings.findOne({ key: PLATFORM_MODULE_SETTINGS_KEY }).lean();
  }

  const map = mapFromDoc(doc?.enabledModules);
  moduleFlagsCache = { map, at: now };
  return map;
}

export async function isPlatformModuleEnabled(moduleId: ModuleId): Promise<boolean> {
  const map = await getPlatformEnabledModules();
  return isModuleEnabled(moduleId, map);
}

export async function updatePlatformEnabledModules(
  input: Record<string, unknown>,
  userId: string
): Promise<EnabledModulesMap> {
  const patch: Record<string, boolean> = {};
  const source =
    input.enabledModules && typeof input.enabledModules === 'object'
      ? (input.enabledModules as Record<string, unknown>)
      : input;

  for (const id of TOGGLEABLE_MODULES) {
    if (source[id] === undefined) continue;
    patch[id] = Boolean(source[id]);
  }

  if (Object.keys(patch).length === 0) {
    throw new ApiError(400, 'No toggleable module flags provided');
  }

  // Reject attempts to disable always-on modules if sent
  for (const id of ALWAYS_ON_MODULES) {
    if (source[id] === false) {
      throw new ApiError(400, `Module "${id}" cannot be disabled`);
    }
  }

  const existing = await getPlatformEnabledModules();
  const next: Record<ToggleableModuleId, boolean> = {} as Record<ToggleableModuleId, boolean>;
  for (const id of TOGGLEABLE_MODULES) {
    next[id] = patch[id] !== undefined ? patch[id] : existing[id] !== false;
  }

  await PlatformModuleSettings.findOneAndUpdate(
    { key: PLATFORM_MODULE_SETTINGS_KEY },
    {
      $set: {
        enabledModules: next,
        updatedBy: userId,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  invalidatePlatformModuleCache();
  return getPlatformEnabledModules();
}
