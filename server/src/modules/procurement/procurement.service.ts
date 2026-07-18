import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { CrmAccount } from '../crm/models/crmAccount.model';
import { Asset } from '../assets/models/asset.model';
import { AssetLicense } from '../assets/models/assetLicense.model';
import { PurchaseOrder, IPurchaseOrderLine, type PoCategory } from './models/purchaseOrder.model';

function asDate(value: unknown): Date | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function normalizeLines(raw: unknown): IPurchaseOrderLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((l) => {
      const line = l as Record<string, unknown>;
      const quantity = Number(line.quantity ?? 1);
      const unitPrice = Number(line.unitPrice ?? 0);
      return {
        description: String(line.description ?? '').trim(),
        quantity,
        unitPrice,
        amount: Math.round(quantity * unitPrice * 100) / 100,
      };
    })
    .filter((l) => l.description);
}

function totals(lines: IPurchaseOrderLine[], taxRate: number) {
  const subtotal = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  const taxTotal = Math.round(subtotal * (taxRate / 100) * 100) / 100;
  return { subtotal, taxTotal, total: Math.round((subtotal + taxTotal) * 100) / 100 };
}

// ── Vendors (CRM accounts of type vendor) ────────────────────────────────────

export async function listVendors(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  return CrmAccount.find({ taskflowOrganizationId: toOrgOid(orgId), type: 'vendor' }).sort({ name: 1 }).lean();
}

export async function createVendor(workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  if (!input.name || !String(input.name).trim()) throw new ApiError(400, 'Vendor name is required');
  const doc = await CrmAccount.create({
    taskflowOrganizationId: toOrgOid(orgId),
    name: String(input.name).trim(),
    type: 'vendor',
    industry: input.industry,
    website: input.website,
    billingAddress: input.billingAddress,
    notes: input.notes,
  });
  return doc.toObject();
}

// ── Purchase orders ──────────────────────────────────────────────────────────

export async function listPurchaseOrders(
  workspaceId: string | null | undefined,
  query: { status?: string; vendorAccountId?: string; category?: string } = {}
) {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId) };
  if (query.status) filter.status = query.status;
  if (query.vendorAccountId) filter.vendorAccountId = query.vendorAccountId;
  if (query.category) filter.category = query.category;
  return PurchaseOrder.find(filter)
    .populate('vendorAccountId', 'name')
    .populate('contractId', 'title')
    .sort({ createdAt: -1 })
    .lean();
}

export async function createPurchaseOrder(
  workspaceId: string | null | undefined,
  input: Record<string, unknown>,
  userId?: string
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const vendor = await CrmAccount.findOne({ _id: input.vendorAccountId, taskflowOrganizationId: orgOid });
  if (!vendor) throw new ApiError(404, 'Vendor not found');
  const lines = normalizeLines(input.lines);
  const { subtotal, taxTotal, total } = totals(lines, Number(input.taxRate ?? 0));
  const number = input.poNumber
    ? String(input.poNumber).trim()
    : `PO-${String((await PurchaseOrder.countDocuments({ taskflowOrganizationId: orgOid })) + 1).padStart(4, '0')}`;
  try {
    const doc = await PurchaseOrder.create({
      taskflowOrganizationId: orgOid,
      poNumber: number,
      title: String(input.title ?? 'Purchase order').trim(),
      vendorAccountId: vendor._id,
      category: input.category ?? 'hardware',
      status: input.status ?? 'draft',
      currency: input.currency ?? 'USD',
      lines,
      subtotal,
      taxTotal,
      total,
      expectedDate: asDate(input.expectedDate),
      contractId: input.contractId || undefined,
      projectId: input.projectId || undefined,
      requestedBy: userId,
      notes: input.notes,
    });
    return PurchaseOrder.findById(doc._id).populate('vendorAccountId', 'name').lean();
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw new ApiError(409, 'PO number already exists');
    throw err;
  }
}

export async function updatePurchaseOrder(id: string, workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  const po = await PurchaseOrder.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!po) throw new ApiError(404, 'Purchase order not found');
  const fields = ['title', 'category', 'currency', 'notes', 'vendorAccountId', 'contractId', 'projectId'] as const;
  for (const key of fields) if (key in input) (po as unknown as Record<string, unknown>)[key] = input[key] === '' ? undefined : input[key];
  if ('lines' in input || 'taxRate' in input) {
    const lines = 'lines' in input ? normalizeLines(input.lines) : po.lines;
    const taxRate = 'taxRate' in input ? Number(input.taxRate) : po.subtotal ? (po.taxTotal / po.subtotal) * 100 : 0;
    po.lines = lines;
    const t = totals(lines, taxRate);
    po.subtotal = t.subtotal;
    po.taxTotal = t.taxTotal;
    po.total = t.total;
  }
  if ('expectedDate' in input) po.expectedDate = asDate(input.expectedDate);
  await po.save();
  return PurchaseOrder.findById(po._id).populate('vendorAccountId', 'name').lean();
}

const PO_TO_ASSET_CATEGORY: Record<PoCategory, string> = {
  hardware: 'peripheral',
  software: 'other',
  services: 'other',
  subscription: 'other',
  other: 'other',
};

/**
 * When a PO is received we materialize what was bought into the CMDB so hardware
 * shows up in Assets and software/subscriptions show up as licenses — keeping
 * Procurement, Assets and CRM (vendor) in sync automatically.
 */
async function provisionFromPurchaseOrder(
  po: InstanceType<typeof PurchaseOrder>,
  orgOid: mongoose.Types.ObjectId
): Promise<{ assetsCreated: number; licensesCreated: number }> {
  let assetsCreated = 0;
  let licensesCreated = 0;
  const isLicense = po.category === 'software' || po.category === 'subscription';

  for (const line of po.lines) {
    const qty = Math.max(1, Math.round(Number(line.quantity ?? 1)));
    if (isLicense) {
      await AssetLicense.create({
        taskflowOrganizationId: orgOid,
        name: line.description,
        vendorAccountId: po.vendorAccountId,
        status: 'active',
        seatsTotal: qty,
        seatsUsed: 0,
        seatCost: Number(line.unitPrice ?? 0),
        currency: po.currency,
        purchaseOrderId: po._id,
        notes: `Provisioned from ${po.poNumber}`,
      });
      licensesCreated += 1;
    } else {
      const baseCount = await Asset.countDocuments({ taskflowOrganizationId: orgOid });
      for (let i = 0; i < qty; i++) {
        await Asset.create({
          taskflowOrganizationId: orgOid,
          assetTag: `AST-${String(baseCount + assetsCreated + 1).padStart(4, '0')}`,
          name: qty > 1 ? `${line.description} #${i + 1}` : line.description,
          category: PO_TO_ASSET_CATEGORY[po.category],
          status: 'in_stock',
          vendorAccountId: po.vendorAccountId,
          purchaseOrderId: po._id,
          purchaseCost: Number(line.unitPrice ?? 0),
          currency: po.currency,
          purchaseDate: new Date(),
          notes: `Provisioned from ${po.poNumber}`,
        });
        assetsCreated += 1;
      }
    }
  }
  return { assetsCreated, licensesCreated };
}

export async function transitionPurchaseOrder(
  id: string,
  workspaceId: string | null | undefined,
  status: string,
  userId?: string
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const po = await PurchaseOrder.findOne({ _id: id, taskflowOrganizationId: orgOid });
  if (!po) throw new ApiError(404, 'Purchase order not found');
  const allowed = ['draft', 'pending_approval', 'approved', 'ordered', 'received', 'cancelled'];
  if (!allowed.includes(status)) throw new ApiError(400, 'Invalid status');
  po.status = status as never;
  if (status === 'approved') {
    po.approvedBy = userId as never;
    po.approvedAt = new Date();
  }
  if (status === 'ordered' && !po.orderedDate) po.orderedDate = new Date();

  let provisioned = { assetsCreated: 0, licensesCreated: 0 };
  if (status === 'received') {
    if (!po.receivedDate) po.receivedDate = new Date();
    if (!po.provisionedAt) {
      provisioned = await provisionFromPurchaseOrder(po, orgOid);
      po.provisionedAt = new Date();
    }
  }
  await po.save();
  const result = await PurchaseOrder.findById(po._id).populate('vendorAccountId', 'name').lean();
  return { ...result, provisioned } as typeof result & { provisioned: typeof provisioned };
}

export async function deletePurchaseOrder(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const deleted = await PurchaseOrder.findOneAndDelete({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!deleted) throw new ApiError(404, 'Purchase order not found');
  return { deleted: true };
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export async function getProcurementDashboard(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const [pos, vendors] = await Promise.all([
    PurchaseOrder.find({ taskflowOrganizationId: orgOid }).populate('vendorAccountId', 'name').sort({ createdAt: -1 }).lean(),
    CrmAccount.find({ taskflowOrganizationId: orgOid, type: 'vendor' }).lean(),
  ]);

  const open = pos.filter((p) => !['received', 'cancelled'].includes(p.status));
  const committedSpend = Math.round(open.reduce((s, p) => s + (p.total ?? 0), 0) * 100) / 100;
  const totalSpend = Math.round(pos.filter((p) => p.status !== 'cancelled').reduce((s, p) => s + (p.total ?? 0), 0) * 100) / 100;

  const byStatus = ['draft', 'pending_approval', 'approved', 'ordered', 'received', 'cancelled'].map((s) => ({
    name: s.replace('_', ' '),
    value: pos.filter((p) => p.status === s).length,
  }));

  const byCategory = ['hardware', 'software', 'services', 'subscription', 'other'].map((c) => ({
    name: c,
    value: Math.round(pos.filter((p) => p.category === c && p.status !== 'cancelled').reduce((s, p) => s + (p.total ?? 0), 0) * 100) / 100,
  })).filter((r) => r.value > 0);

  const spendByVendor = Object.values(
    pos.filter((p) => p.status !== 'cancelled').reduce<Record<string, { name: string; value: number }>>((acc, p) => {
      const v = p.vendorAccountId as unknown as { _id?: unknown; name?: string } | null;
      const key = v?._id ? String(v._id) : 'unknown';
      const name = v?.name || 'Unknown';
      if (!acc[key]) acc[key] = { name, value: 0 };
      acc[key].value = Math.round((acc[key].value + (p.total ?? 0)) * 100) / 100;
      return acc;
    }, {})
  )
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const pendingApproval = pos
    .filter((p) => p.status === 'pending_approval')
    .slice(0, 10)
    .map((p) => ({
      _id: String(p._id),
      poNumber: p.poNumber,
      title: p.title,
      vendor: (p.vendorAccountId as unknown as { name?: string })?.name,
      total: p.total,
      currency: p.currency,
    }));

  return {
    counts: {
      totalPos: pos.length,
      open: open.length,
      pendingApproval: pos.filter((p) => p.status === 'pending_approval').length,
      vendors: vendors.length,
      received: pos.filter((p) => p.status === 'received').length,
    },
    committedSpend,
    totalSpend,
    byStatus,
    byCategory,
    spendByVendor,
    pendingApprovalList: pendingApproval,
  };
}
