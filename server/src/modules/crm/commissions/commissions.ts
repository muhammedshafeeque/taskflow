import mongoose, { Schema } from 'mongoose';
import { Router, type Request, type Response } from 'express';
import { authMiddleware } from '../../../middleware/auth.middleware';
import { requireTaskflowUser } from '../../../middleware/requireTaskflowUser';
import { requireAnyPermission } from '../../../middleware/requirePermission';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ApiError } from '../../../utils/ApiError';
import { TASK_FLOW_PERMISSIONS } from '../../../shared/constants/permissions';
import { userHasPermission } from '../../../shared/constants/legacyPermissionMap';
import { requireWorkspaceId, toOrgOid } from '../crmWorkspace';
import { CrmDeal } from '../models/crmDeal.model';
import { User } from '../../auth/user.model';

/**
 * Sales commission plans. Who a plan applies to is data: explicit users and/or
 * roles. Rates are flat or tiered (marginal) on the won deal value.
 */
const planSchema = new Schema(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true },
    active: { type: Boolean, default: true },
    userIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    roleIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Role' }], default: [] },
    /** Limit to some pipelines (empty = all). */
    pipelineIds: { type: [{ type: Schema.Types.ObjectId }], default: [] },
    ratePct: { type: Number, default: 0, min: 0, max: 100 },
    /** Marginal tiers by deal value: [{ from: 0, ratePct: 5 }, { from: 100000, ratePct: 8 }] */
    tiers: { type: [{ _id: false, from: { type: Number, min: 0 }, ratePct: { type: Number, min: 0, max: 100 } }], default: [] },
    minDealValue: { type: Number, default: 0 },
    /** Higher wins when several plans match a user. */
    priority: { type: Number, default: 0 },
  },
  { timestamps: true }
);
export const CommissionPlan = mongoose.model('CommissionPlan', planSchema);

const entrySchema = new Schema(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    planId: { type: Schema.Types.ObjectId, ref: 'CommissionPlan' },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    dealId: { type: Schema.Types.ObjectId, ref: 'CrmDeal', required: true },
    base: { type: Number, required: true },
    amount: { type: Number, required: true },
    currency: { type: String },
    status: { type: String, enum: ['pending', 'approved', 'paid', 'void'], default: 'pending', index: true },
    period: { type: String, index: true }, // YYYY-MM of the win
    note: { type: String },
    paidAt: { type: Date },
  },
  { timestamps: true }
);
entrySchema.index({ dealId: 1, userId: 1 }, { unique: true });
export const CommissionEntry = mongoose.model('CommissionEntry', entrySchema);

export function commissionFor(value: number, plan: { ratePct?: number | null; tiers?: { from?: number | null; ratePct?: number | null }[] }): number {
  const tiers = (plan.tiers ?? []).filter((t) => t.from != null && t.ratePct != null).sort((a, b) => (a.from ?? 0) - (b.from ?? 0));
  if (!tiers.length) return Math.round(value * (plan.ratePct ?? 0)) / 100;
  let total = 0;
  for (let i = 0; i < tiers.length; i++) {
    const lo = tiers[i].from ?? 0;
    const hi = tiers[i + 1]?.from ?? Infinity;
    if (value <= lo) break;
    total += (Math.min(value, hi) - lo) * ((tiers[i].ratePct ?? 0) / 100);
  }
  return Math.round(total * 100) / 100;
}

/** Called when a deal becomes won. Idempotent per (deal, owner). */
export async function accrueDealCommission(dealId: string): Promise<void> {
  const deal = await CrmDeal.findById(dealId).select('taskflowOrganizationId ownerId value currency pipelineId status').lean();
  if (!deal || deal.status !== 'won' || !deal.ownerId) return;
  const owner = await User.findById(deal.ownerId).select('roleId').lean();
  const plans = await CommissionPlan.find({ taskflowOrganizationId: deal.taskflowOrganizationId, active: true }).sort({ priority: -1 }).lean();
  const plan = plans.find(
    (p) =>
      (deal.value ?? 0) >= (p.minDealValue ?? 0) &&
      (!p.pipelineIds?.length || p.pipelineIds.some((x) => String(x) === String(deal.pipelineId))) &&
      ((p.userIds ?? []).some((u) => String(u) === String(deal.ownerId)) || (p.roleIds ?? []).some((r) => String(r) === String(owner?.roleId)))
  );
  if (!plan) return;
  const amount = commissionFor(deal.value ?? 0, plan);
  if (amount <= 0) return;
  await CommissionEntry.updateOne(
    { dealId: deal._id, userId: deal.ownerId },
    {
      $setOnInsert: {
        taskflowOrganizationId: deal.taskflowOrganizationId,
        planId: plan._id,
        base: deal.value,
        amount,
        currency: deal.currency,
        period: new Date().toISOString().slice(0, 7),
      },
    },
    { upsert: true }
  );
}

/** Deal re-opened/lost after a win → void its pending commission. */
export async function voidDealCommission(dealId: string): Promise<void> {
  await CommissionEntry.updateMany({ dealId, status: 'pending' }, { $set: { status: 'void' } });
}

type R = Request & { activeOrganizationId?: string; user?: { id: string; permissions?: string[] } };
const C = TASK_FLOW_PERMISSIONS.TASKFLOW.CRM.COMMISSION;
export const commissionRoutes = Router();
commissionRoutes.use(authMiddleware, requireTaskflowUser);

const org = (req: R) => toOrgOid(requireWorkspaceId(req.activeOrganizationId));
const pick = (b: Record<string, unknown>) => {
  const out: Record<string, unknown> = {};
  for (const k of ['name', 'active', 'userIds', 'roleIds', 'pipelineIds', 'ratePct', 'tiers', 'minDealValue', 'priority']) if (b[k] !== undefined) out[k] = b[k];
  return out;
};

commissionRoutes.get('/plans', requireAnyPermission([C.READ, C.MANAGE]), asyncHandler(async (req: R, res: Response) => {
  res.json({ success: true, data: await CommissionPlan.find({ taskflowOrganizationId: org(req) }).sort({ priority: -1, name: 1 }).lean() });
}));
commissionRoutes.post('/plans', requireAnyPermission([C.MANAGE]), asyncHandler(async (req: R, res: Response) => {
  res.status(201).json({ success: true, data: await CommissionPlan.create({ ...pick(req.body ?? {}), taskflowOrganizationId: org(req) }) });
}));
commissionRoutes.patch('/plans/:id', requireAnyPermission([C.MANAGE]), asyncHandler(async (req: R, res: Response) => {
  const doc = await CommissionPlan.findOneAndUpdate({ _id: req.params.id, taskflowOrganizationId: org(req) }, { $set: pick(req.body ?? {}) }, { new: true });
  if (!doc) throw new ApiError(404, 'Plan not found');
  res.json({ success: true, data: doc });
}));
commissionRoutes.delete('/plans/:id', requireAnyPermission([C.MANAGE]), asyncHandler(async (req: R, res: Response) => {
  await CommissionPlan.deleteOne({ _id: req.params.id, taskflowOrganizationId: org(req) });
  res.json({ success: true });
}));

/** Entries: managers see everyone's; others with READ see their own. */
commissionRoutes.get('/entries', requireAnyPermission([C.READ, C.MANAGE]), asyncHandler(async (req: R, res: Response) => {
  const filter: Record<string, unknown> = { taskflowOrganizationId: org(req) };
  const manage = userHasPermission(req.user?.permissions ?? [], C.MANAGE);
  if (!manage || req.query.mine === '1') filter.userId = req.user!.id;
  else if (req.query.userId) filter.userId = req.query.userId;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.period) filter.period = req.query.period;
  const data = await CommissionEntry.find(filter).populate('userId', 'name').populate('dealId', 'title value currency').sort({ createdAt: -1 }).limit(500).lean();
  res.json({ success: true, data });
}));
commissionRoutes.patch('/entries/:id', requireAnyPermission([C.MANAGE]), asyncHandler(async (req: R, res: Response) => {
  const set: Record<string, unknown> = {};
  if (req.body?.status) set.status = req.body.status;
  if (req.body?.status === 'paid') set.paidAt = new Date();
  if (req.body?.amount !== undefined) set.amount = Number(req.body.amount);
  if (req.body?.note !== undefined) set.note = req.body.note;
  const doc = await CommissionEntry.findOneAndUpdate({ _id: req.params.id, taskflowOrganizationId: org(req) }, { $set: set }, { new: true, runValidators: true });
  if (!doc) throw new ApiError(404, 'Entry not found');
  res.json({ success: true, data: doc });
}));
/** Accrue for won deals that predate the plan (or missed). */
commissionRoutes.post('/recalculate', requireAnyPermission([C.MANAGE]), asyncHandler(async (req: R, res: Response) => {
  const since = req.body?.since ? new Date(req.body.since) : new Date(Date.now() - 90 * 86_400_000);
  const deals = await CrmDeal.find({ taskflowOrganizationId: org(req), status: 'won', updatedAt: { $gte: since } }).select('_id').lean();
  for (const d of deals) await accrueDealCommission(String(d._id));
  res.json({ success: true, data: { deals: deals.length } });
}));
