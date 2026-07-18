import { ApiError } from '../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { Asset } from './models/asset.model';
import { AssetLicense } from './models/assetLicense.model';

function asDate(value: unknown): Date | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const ASSET_FIELDS = [
  'name', 'category', 'status', 'serialNumber', 'manufacturer', 'deviceModel', 'assignedUserId',
  'accountId', 'vendorAccountId', 'purchaseOrderId', 'location', 'purchaseCost', 'currency',
  'ipAddress', 'hostname', 'environment', 'notes',
] as const;

// ── Assets (inventory / servers / warranty share one collection) ─────────────

export async function listAssets(
  workspaceId: string | null | undefined,
  query: { category?: string; status?: string; warrantyWithinDays?: string; search?: string } = {}
) {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId) };
  if (query.category) filter.category = query.category;
  if (query.status) filter.status = query.status;
  if (query.search) filter.name = new RegExp(query.search, 'i');
  if (query.warrantyWithinDays) {
    const days = Number(query.warrantyWithinDays);
    const until = new Date();
    until.setDate(until.getDate() + days);
    filter.warrantyExpiry = { $lte: until };
  }
  return Asset.find(filter)
    .populate('assignedUserId', 'name email')
    .populate('vendorAccountId', 'name')
    .populate('accountId', 'name')
    .sort({ updatedAt: -1 })
    .lean();
}

export async function createAsset(workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  if (!input.name || !String(input.name).trim()) throw new ApiError(400, 'Name is required');
  const tag = input.assetTag
    ? String(input.assetTag).trim()
    : `AST-${String((await Asset.countDocuments({ taskflowOrganizationId: orgOid })) + 1).padStart(4, '0')}`;
  try {
    const doc = await Asset.create({
      taskflowOrganizationId: orgOid,
      assetTag: tag,
      name: String(input.name).trim(),
      category: input.category ?? 'laptop',
      status: input.status ?? 'in_stock',
      serialNumber: input.serialNumber,
      manufacturer: input.manufacturer,
      deviceModel: input.deviceModel,
      assignedUserId: input.assignedUserId || undefined,
      accountId: input.accountId || undefined,
      vendorAccountId: input.vendorAccountId || undefined,
      purchaseOrderId: input.purchaseOrderId || undefined,
      location: input.location,
      purchaseDate: asDate(input.purchaseDate),
      purchaseCost: Number(input.purchaseCost ?? 0),
      currency: input.currency ?? 'USD',
      warrantyExpiry: asDate(input.warrantyExpiry),
      amcExpiry: asDate(input.amcExpiry),
      ipAddress: input.ipAddress,
      hostname: input.hostname,
      environment: input.environment,
      notes: input.notes,
    });
    return doc.toObject();
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw new ApiError(409, 'Asset tag already exists');
    throw err;
  }
}

export async function updateAsset(id: string, workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  const asset = await Asset.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!asset) throw new ApiError(404, 'Asset not found');
  for (const key of ASSET_FIELDS) {
    if (!(key in input)) continue;
    const val = input[key];
    if (key === 'purchaseCost') (asset as unknown as Record<string, unknown>)[key] = Number(val);
    else (asset as unknown as Record<string, unknown>)[key] = val === '' ? undefined : val;
  }
  if ('purchaseDate' in input) asset.purchaseDate = asDate(input.purchaseDate);
  if ('warrantyExpiry' in input) asset.warrantyExpiry = asDate(input.warrantyExpiry);
  if ('amcExpiry' in input) asset.amcExpiry = asDate(input.amcExpiry);
  await asset.save();
  return asset.toObject();
}

export async function deleteAsset(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const deleted = await Asset.findOneAndDelete({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!deleted) throw new ApiError(404, 'Asset not found');
  return { deleted: true };
}

// ── Licenses ─────────────────────────────────────────────────────────────────

export async function listLicenses(workspaceId: string | null | undefined, query: { status?: string } = {}) {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId) };
  if (query.status) filter.status = query.status;
  return AssetLicense.find(filter).populate('vendorAccountId', 'name').sort({ renewalDate: 1 }).lean();
}

export async function createLicense(workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  if (!input.name || !String(input.name).trim()) throw new ApiError(400, 'Name is required');
  const doc = await AssetLicense.create({
    taskflowOrganizationId: toOrgOid(orgId),
    name: String(input.name).trim(),
    vendor: input.vendor,
    vendorAccountId: input.vendorAccountId || undefined,
    status: input.status ?? 'active',
    seatsTotal: Number(input.seatsTotal ?? 1),
    seatsUsed: Number(input.seatsUsed ?? 0),
    seatCost: Number(input.seatCost ?? 0),
    currency: input.currency ?? 'USD',
    renewalDate: asDate(input.renewalDate),
    purchaseOrderId: input.purchaseOrderId || undefined,
    notes: input.notes,
  });
  return doc.toObject();
}

export async function updateLicense(id: string, workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  const lic = await AssetLicense.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!lic) throw new ApiError(404, 'License not found');
  const fields = ['name', 'vendor', 'vendorAccountId', 'status', 'currency', 'notes'] as const;
  for (const key of fields) if (key in input) (lic as unknown as Record<string, unknown>)[key] = input[key] === '' ? undefined : input[key];
  if ('seatsTotal' in input) lic.seatsTotal = Number(input.seatsTotal);
  if ('seatsUsed' in input) lic.seatsUsed = Number(input.seatsUsed);
  if ('seatCost' in input) lic.seatCost = Number(input.seatCost);
  if ('renewalDate' in input) lic.renewalDate = asDate(input.renewalDate);
  await lic.save();
  return lic.toObject();
}

export async function deleteLicense(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const deleted = await AssetLicense.findOneAndDelete({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!deleted) throw new ApiError(404, 'License not found');
  return { deleted: true };
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export async function getAssetsDashboard(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const now = new Date();
  const in60 = new Date();
  in60.setDate(in60.getDate() + 60);

  const [assets, licenses] = await Promise.all([
    Asset.find({ taskflowOrganizationId: orgOid }).populate('assignedUserId', 'name').lean(),
    AssetLicense.find({ taskflowOrganizationId: orgOid }).lean(),
  ]);

  const byCategory = ['laptop', 'desktop', 'mobile', 'server', 'network', 'peripheral', 'other'].map((c) => ({
    name: c,
    value: assets.filter((a) => a.category === c).length,
  })).filter((r) => r.value > 0);

  const byStatus = ['in_stock', 'assigned', 'in_repair', 'retired'].map((s) => ({
    name: s.replace('_', ' '),
    value: assets.filter((a) => a.status === s).length,
  }));

  const expiringWarranty = assets
    .filter((a) => a.warrantyExpiry && new Date(a.warrantyExpiry) <= in60 && a.status !== 'retired')
    .sort((a, b) => new Date(a.warrantyExpiry!).getTime() - new Date(b.warrantyExpiry!).getTime())
    .slice(0, 12)
    .map((a) => ({
      _id: String(a._id),
      name: a.name,
      assetTag: a.assetTag,
      category: a.category,
      warrantyExpiry: a.warrantyExpiry,
      daysLeft: Math.ceil((new Date(a.warrantyExpiry!).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
    }));

  const totalAssetValue = Math.round(assets.reduce((s, a) => s + (a.purchaseCost ?? 0), 0) * 100) / 100;
  const seatsTotal = licenses.reduce((s, l) => s + (l.seatsTotal ?? 0), 0);
  const seatsUsed = licenses.reduce((s, l) => s + (l.seatsUsed ?? 0), 0);
  const annualLicenseSpend = Math.round(licenses.reduce((s, l) => s + (l.seatCost ?? 0) * (l.seatsTotal ?? 0), 0) * 100) / 100;

  const licenseUtilization = licenses
    .map((l) => ({
      name: l.name,
      used: l.seatsUsed ?? 0,
      free: Math.max(0, (l.seatsTotal ?? 0) - (l.seatsUsed ?? 0)),
    }))
    .sort((a, b) => b.used + b.free - (a.used + a.free))
    .slice(0, 8);

  return {
    counts: {
      totalAssets: assets.length,
      assigned: assets.filter((a) => a.status === 'assigned').length,
      inStock: assets.filter((a) => a.status === 'in_stock').length,
      inRepair: assets.filter((a) => a.status === 'in_repair').length,
      servers: assets.filter((a) => a.category === 'server').length,
      licenses: licenses.length,
      warrantyExpiring: expiringWarranty.length,
    },
    totalAssetValue,
    seatsTotal,
    seatsUsed,
    annualLicenseSpend,
    byCategory,
    byStatus,
    licenseUtilization,
    expiringWarranty,
  };
}
