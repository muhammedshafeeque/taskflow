import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import { userHasPermission } from '../../shared/constants/legacyPermissionMap';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { CrmAccount } from '../crm/models/crmAccount.model';
import { Asset } from '../assets/models/asset.model';
import { AssetLicense } from '../assets/models/assetLicense.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { PurchaseOrder, IPurchaseOrderLine, type PoCategory, type PoStatus } from './models/purchaseOrder.model';
import { ProcurementSettings } from './models/procurementSettings.model';
import {
  canDecideRecord,
  cancelForRecord,
  decideForRecord,
  isApprovalChainEnabled,
  submitForApproval,
} from '../approvals/approvals.service';

const P_PO = TASK_FLOW_PERMISSIONS.TASKFLOW.PROCUREMENT.PO;

/** Valid purchase order status transitions; approval cannot be bypassed. */
export const PO_TRANSITIONS: Record<PoStatus, readonly PoStatus[]> = {
  draft: ['pending_approval', 'cancelled'],
  pending_approval: ['approved', 'draft', 'cancelled'],
  approved: ['ordered', 'cancelled'],
  ordered: ['received', 'cancelled'],
  received: [],
  cancelled: [],
};

const VALID_STATUSES = Object.keys(PO_TRANSITIONS) as PoStatus[];

export interface ApproverLimitRule {
  userId?: string;
  roleId?: string;
  maxAmount: number;
}

export interface ProcurementSettingsValues {
  singleApproverLimit: number | null;
  maxOrderAmount: number | null;
  secondApproverIds: string[];
  approverLimits: ApproverLimitRule[];
}

export interface PoTransitionActor {
  userId?: string;
  roleId?: string;
  permissions?: string[];
}

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
      if (!Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new ApiError(400, 'Line item quantity and unit price must be non-negative numbers');
      }
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
  if (!Number.isFinite(taxRate) || taxRate < 0) throw new ApiError(400, 'Tax rate must be non-negative');
  const subtotal = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  const taxTotal = Math.round(subtotal * (taxRate / 100) * 100) / 100;
  return { subtotal, taxTotal, total: Math.round((subtotal + taxTotal) * 100) / 100 };
}

const PO_POPULATE = [
  { path: 'vendorAccountId', select: 'name' },
  { path: 'contractId', select: 'title' },
  { path: 'projectId', select: 'name key' },
  { path: 'requestedBy', select: 'name email' },
  { path: 'firstApprovedBy', select: 'name email' },
  { path: 'approvedBy', select: 'name email' },
];

function parseOptionalLimit(raw: unknown, field: string): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new ApiError(400, `${field} must be a non-negative number`);
  return Math.round(n * 100) / 100;
}

function parseObjectId(raw: unknown, field: string): mongoose.Types.ObjectId {
  const s = String(raw ?? '').trim();
  if (!mongoose.Types.ObjectId.isValid(s)) throw new ApiError(400, `Invalid ${field}`);
  return new mongoose.Types.ObjectId(s);
}

/** Validate a requested PO status change against the workflow state machine. */
export function assertValidPoTransition(current: PoStatus, next: string): PoStatus {
  if (!VALID_STATUSES.includes(next as PoStatus)) {
    throw new ApiError(400, 'Invalid status');
  }
  if (!PO_TRANSITIONS[current].includes(next as PoStatus)) {
    throw new ApiError(400, `Cannot transition purchase order from ${current} to ${next}`);
  }
  return next as PoStatus;
}

/** Resolve the single-approver limit for a user, preferring explicit user rules over role rules. */
export function resolveUserApprovalLimit(
  userId: string,
  roleId: string | undefined,
  limits: ApproverLimitRule[]
): number | null {
  const byUser = limits.find((l) => l.userId && l.userId === userId);
  if (byUser) return byUser.maxAmount;
  if (roleId) {
    const byRole = limits.find((l) => l.roleId && l.roleId === roleId);
    if (byRole) return byRole.maxAmount;
  }
  return null;
}

/** Evaluate whether an approval action satisfies creator, limit, and two-step approver policies. */
export function evaluatePoApproval(params: {
  total: number;
  requestedBy?: string | null;
  firstApprovedBy?: string | null;
  userId?: string;
  roleId?: string;
  settings: ProcurementSettingsValues;
}): 'first_stage' | 'approved' {
  const { total, requestedBy, firstApprovedBy, userId, roleId, settings } = params;
  if (!userId) throw new ApiError(401, 'Authentication required to approve a purchase order');
  if (requestedBy && String(requestedBy) === String(userId)) {
    throw new ApiError(403, 'The creator of a purchase order cannot approve it');
  }
  if (settings.maxOrderAmount != null && total > settings.maxOrderAmount) {
    throw new ApiError(400, `Purchase order total (${total}) exceeds the workspace limit (${settings.maxOrderAmount})`);
  }

  const needsTwoStep = settings.singleApproverLimit != null && total > settings.singleApproverLimit;
  const userLimit = resolveUserApprovalLimit(String(userId), roleId, settings.approverLimits);

  if (needsTwoStep && !firstApprovedBy) {
    return 'first_stage';
  }

  if (needsTwoStep && firstApprovedBy) {
    if (String(firstApprovedBy) === String(userId)) {
      throw new ApiError(403, `A different user must provide the second approval for orders above ${settings.singleApproverLimit}`);
    }
    if (settings.secondApproverIds.length > 0 && !settings.secondApproverIds.includes(String(userId))) {
      throw new ApiError(403, `Only designated second approvers can approve orders above ${settings.singleApproverLimit}`);
    }
  }

  if (userLimit != null && total > userLimit) {
    throw new ApiError(403, `Purchase order total (${total}) exceeds your approval limit (${userLimit})`);
  }

  return 'approved';
}

function assertTransitionPermission(current: PoStatus, next: PoStatus, permissions?: string[]): void {
  if (!permissions) return;
  const has = (...required: string[]) => required.some((p) => userHasPermission(permissions, p));
  if (current === 'draft' && (next === 'pending_approval' || next === 'cancelled')) {
    if (!has(P_PO.CREATE, P_PO.MANAGE)) throw new ApiError(403, 'Insufficient permissions');
    return;
  }
  if (current === 'pending_approval' && (next === 'approved' || next === 'cancelled' || next === 'draft')) {
    if (!has(P_PO.APPROVE, P_PO.MANAGE)) throw new ApiError(403, 'Insufficient permissions to approve or reject purchase orders');
    return;
  }
  if (!has(P_PO.MANAGE)) throw new ApiError(403, 'Insufficient permissions');
}

// ── Settings & Approvers ─────────────────────────────────────────────────────

export async function getProcurementSettings(workspaceId: string | null | undefined): Promise<ProcurementSettingsValues> {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const doc = await ProcurementSettings.findOne({ taskflowOrganizationId: orgOid }).lean();
  return {
    singleApproverLimit: doc?.singleApproverLimit ?? null,
    maxOrderAmount: doc?.maxOrderAmount ?? null,
    secondApproverIds: (doc?.secondApproverIds ?? []).map(String),
    approverLimits: (doc?.approverLimits ?? []).map((r) => ({
      ...(r.userId ? { userId: String(r.userId) } : {}),
      ...(r.roleId ? { roleId: String(r.roleId) } : {}),
      maxAmount: r.maxAmount,
    })),
  };
}

export async function updateProcurementSettings(
  workspaceId: string | null | undefined,
  input: Record<string, unknown>
): Promise<ProcurementSettingsValues> {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const update: Record<string, unknown> = {};

  const singleLimit = parseOptionalLimit(input.singleApproverLimit, 'singleApproverLimit');
  if (singleLimit !== undefined) update.singleApproverLimit = singleLimit;

  const maxOrder = parseOptionalLimit(input.maxOrderAmount, 'maxOrderAmount');
  if (maxOrder !== undefined) update.maxOrderAmount = maxOrder;

  if (input.secondApproverIds !== undefined) {
    if (!Array.isArray(input.secondApproverIds)) throw new ApiError(400, 'secondApproverIds must be an array');
    const unique = [...new Set(input.secondApproverIds.map((id) => String(parseObjectId(id, 'secondApproverId'))))];
    update.secondApproverIds = unique.map((id) => new mongoose.Types.ObjectId(id));
  }

  if (input.approverLimits !== undefined) {
    if (!Array.isArray(input.approverLimits)) throw new ApiError(400, 'approverLimits must be an array');
    update.approverLimits = input.approverLimits.map((raw) => {
      const rule = raw as Record<string, unknown>;
      const maxAmount = parseOptionalLimit(rule.maxAmount, 'approverLimits.maxAmount');
      if (maxAmount === null || maxAmount === undefined) throw new ApiError(400, 'Each approver limit requires a non-negative maxAmount');
      if (!rule.userId && !rule.roleId) throw new ApiError(400, 'Each approver limit requires userId or roleId');
      return {
        ...(rule.userId ? { userId: parseObjectId(rule.userId, 'approverLimits.userId') } : {}),
        ...(rule.roleId ? { roleId: parseObjectId(rule.roleId, 'approverLimits.roleId') } : {}),
        maxAmount,
      };
    });
  }

  const current = await getProcurementSettings(workspaceId);
  const nextSingle = singleLimit !== undefined ? singleLimit : current.singleApproverLimit;
  const nextMax = maxOrder !== undefined ? maxOrder : current.maxOrderAmount;
  if (nextSingle != null && nextMax != null && nextSingle > nextMax) {
    throw new ApiError(400, 'Single-approver limit cannot exceed maximum order amount');
  }

  await ProcurementSettings.findOneAndUpdate(
    { taskflowOrganizationId: orgOid },
    { $set: update, $setOnInsert: { taskflowOrganizationId: orgOid } },
    { upsert: true }
  );
  return getProcurementSettings(workspaceId);
}

export async function listProcurementApprovers(workspaceId: string | null | undefined) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const members = await OrganizationMember.find({ organization: orgOid, status: 'active' })
    .populate('user', 'name email enabled')
    .lean();
  return members
    .map((m) => m.user as unknown as { _id?: unknown; name?: string; email?: string; enabled?: boolean } | null)
    .filter((u): u is { _id: unknown; name?: string; email?: string; enabled?: boolean } => Boolean(u?._id && u.enabled !== false))
    .map((u) => ({ _id: String(u._id), name: u.name ?? u.email ?? 'User', email: u.email ?? '' }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
  return PurchaseOrder.find(filter).populate(PO_POPULATE).sort({ createdAt: -1 }).lean();
}

export async function createPurchaseOrder(
  workspaceId: string | null | undefined,
  input: Record<string, unknown>,
  userId?: string
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const initialStatus = String(input.status ?? 'draft');
  if (initialStatus !== 'draft' && initialStatus !== 'pending_approval') {
    throw new ApiError(400, 'New purchase orders can only start as draft or pending_approval');
  }
  const vendor = await CrmAccount.findOne({ _id: input.vendorAccountId, taskflowOrganizationId: orgOid });
  if (!vendor) throw new ApiError(404, 'Vendor not found');
  const lines = normalizeLines(input.lines);
  const { subtotal, taxTotal, total } = totals(lines, Number(input.taxRate ?? 0));
  if (initialStatus === 'pending_approval') {
    const settings = await getProcurementSettings(orgId);
    if (settings.maxOrderAmount != null && total > settings.maxOrderAmount) {
      throw new ApiError(400, `Purchase order total (${total}) exceeds the workspace limit (${settings.maxOrderAmount})`);
    }
  }
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
      status: initialStatus,
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
    if (initialStatus === 'pending_approval' && userId && (await isApprovalChainEnabled(orgId, 'purchase_order'))) {
      try {
        await submitForApproval(orgId, 'purchase_order', String(doc._id), userId);
      } catch (err) {
        await PurchaseOrder.updateOne({ _id: doc._id }, { $set: { status: 'draft' } });
        throw err;
      }
    }
    return PurchaseOrder.findById(doc._id).populate(PO_POPULATE).lean();
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw new ApiError(409, 'PO number already exists');
    throw err;
  }
}

export async function updatePurchaseOrder(id: string, workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  const po = await PurchaseOrder.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!po) throw new ApiError(404, 'Purchase order not found');
  if (po.status !== 'draft' && po.status !== 'pending_approval') {
    throw new ApiError(400, 'Only draft or pending-approval purchase orders can be edited');
  }
  if ('status' in input && input.status !== po.status) {
    throw new ApiError(400, 'Use the status transition endpoint to change purchase order status');
  }
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
    if (po.status === 'pending_approval') {
      // Clear partial approval when the order amount/lines change so the revised total is re-reviewed.
      po.firstApprovedBy = undefined;
      po.firstApprovedAt = undefined;
    }
  }
  if ('expectedDate' in input) po.expectedDate = asDate(input.expectedDate);
  await po.save();
  return PurchaseOrder.findById(po._id).populate(PO_POPULATE).lean();
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
          projectId: po.projectId,
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
  userId?: string,
  actor?: Omit<PoTransitionActor, 'userId'>
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const po = await PurchaseOrder.findOne({ _id: id, taskflowOrganizationId: orgOid });
  if (!po) throw new ApiError(404, 'Purchase order not found');

  const nextStatus = assertValidPoTransition(po.status, status);
  assertTransitionPermission(po.status, nextStatus, actor?.permissions);

  let awaitingSecondApproval = false;

  // With an approval chain turned on (Approvals → chains), the chain decides instead of the limits below.
  if (po.status === 'pending_approval' || nextStatus === 'pending_approval') {
    if (await isApprovalChainEnabled(orgId, 'purchase_order')) {
      if (!userId) throw new ApiError(401, 'Authentication required');
      const chainActor = { userId, permissions: actor?.permissions };
      const rejectsAsApprover = nextStatus === 'cancelled' && (await canDecideRecord(orgId, 'purchase_order', id, userId));
      if (nextStatus === 'approved' || rejectsAsApprover) {
        const r = await decideForRecord(orgId, 'purchase_order', id, chainActor, nextStatus === 'approved' ? 'approve' : 'reject');
        const result = await PurchaseOrder.findById(po._id).populate(PO_POPULATE).lean();
        return {
          ...result,
          provisioned: { assetsCreated: 0, licensesCreated: 0 },
          awaitingSecondApproval: r.outcome === 'pending',
          approvalRequestId: String(r.request._id),
        } as typeof result & { provisioned: { assetsCreated: number; licensesCreated: number }; awaitingSecondApproval: boolean };
      }
      if (nextStatus === 'pending_approval') {
        const settings = await getProcurementSettings(orgId);
        if (settings.maxOrderAmount != null && po.total > settings.maxOrderAmount) {
          throw new ApiError(400, `Purchase order total (${po.total}) exceeds the workspace limit (${settings.maxOrderAmount})`);
        }
        await submitForApproval(orgId, 'purchase_order', id, userId);
      } else {
        await cancelForRecord(orgId, 'purchase_order', id, userId, `Purchase order moved to ${nextStatus}`);
      }
    }
  }

  if (nextStatus === 'pending_approval') {
    const settings = await getProcurementSettings(orgId);
    if (settings.maxOrderAmount != null && po.total > settings.maxOrderAmount) {
      throw new ApiError(400, `Purchase order total (${po.total}) exceeds the workspace limit (${settings.maxOrderAmount})`);
    }
    po.status = 'pending_approval';
  } else if (nextStatus === 'approved') {
    const settings = await getProcurementSettings(orgId);
    const outcome = evaluatePoApproval({
      total: po.total,
      requestedBy: po.requestedBy ? String(po.requestedBy) : null,
      firstApprovedBy: po.firstApprovedBy ? String(po.firstApprovedBy) : null,
      userId,
      roleId: actor?.roleId,
      settings,
    });
    if (outcome === 'first_stage') {
      po.firstApprovedBy = userId as never;
      po.firstApprovedAt = new Date();
      awaitingSecondApproval = true;
    } else {
      po.status = 'approved';
      po.approvedBy = userId as never;
      po.approvedAt = new Date();
    }
  } else if (nextStatus === 'draft' || nextStatus === 'cancelled') {
    po.status = nextStatus;
    po.firstApprovedBy = undefined;
    po.firstApprovedAt = undefined;
    if (nextStatus === 'draft') {
      po.approvedBy = undefined;
      po.approvedAt = undefined;
    }
  } else {
    po.status = nextStatus;
  }

  if (po.status === 'ordered' && !po.orderedDate) po.orderedDate = new Date();

  let provisioned = { assetsCreated: 0, licensesCreated: 0 };
  if (po.status === 'received') {
    if (!po.receivedDate) po.receivedDate = new Date();
    if (!po.provisionedAt) {
      provisioned = await provisionFromPurchaseOrder(po, orgOid);
      po.provisionedAt = new Date();
    }
  }
  await po.save();
  const result = await PurchaseOrder.findById(po._id).populate(PO_POPULATE).lean();
  return {
    ...result,
    provisioned,
    awaitingSecondApproval,
  } as typeof result & { provisioned: typeof provisioned; awaitingSecondApproval: boolean };
}

/** Approval chain finished (called by the approval engine). Rejected orders are cancelled, as before. */
export async function applyPoChainOutcome(orgId: string, id: string, outcome: 'approved' | 'rejected', userId: string) {
  const po = await PurchaseOrder.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId), status: 'pending_approval' });
  if (!po) return;
  po.firstApprovedBy = undefined;
  po.firstApprovedAt = undefined;
  if (outcome === 'approved') {
    po.status = 'approved';
    po.approvedBy = userId as never;
    po.approvedAt = new Date();
  } else {
    po.status = 'cancelled';
  }
  await po.save();
}

export async function deletePurchaseOrder(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const deleted = await PurchaseOrder.findOneAndDelete({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!deleted) throw new ApiError(404, 'Purchase order not found');
  await cancelForRecord(orgId, 'purchase_order', id, undefined, 'Purchase order deleted');
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
      awaitingSecondApproval: Boolean(p.firstApprovedBy),
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
