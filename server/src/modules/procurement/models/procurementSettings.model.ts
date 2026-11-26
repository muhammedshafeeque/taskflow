import mongoose, { Document, Schema } from 'mongoose';

export interface IProcurementApproverLimit {
  userId?: mongoose.Types.ObjectId;
  roleId?: mongoose.Types.ObjectId;
  maxAmount: number;
}

/** Per-workspace approval limits and two-step approval thresholds for purchase orders. */
export interface IProcurementSettings extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  /** PO totals above this require a second distinct approver; null disables the threshold. */
  singleApproverLimit: number | null;
  /** Maximum PO total allowed when submitting or approving; null means unlimited. */
  maxOrderAmount: number | null;
  /** Users eligible to provide the second approval when total > singleApproverLimit; empty allows any other approver. */
  secondApproverIds: mongoose.Types.ObjectId[];
  /** Optional per-user or per-role maximum approval amounts (userId takes precedence over roleId). */
  approverLimits: IProcurementApproverLimit[];
  createdAt: Date;
  updatedAt: Date;
}

const approverLimitSchema = new Schema<IProcurementApproverLimit>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    roleId: { type: Schema.Types.ObjectId, ref: 'Role' },
    maxAmount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const procurementSettingsSchema = new Schema<IProcurementSettings>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, unique: true },
    singleApproverLimit: { type: Number, default: null, min: 0 },
    maxOrderAmount: { type: Number, default: null, min: 0 },
    secondApproverIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    approverLimits: { type: [approverLimitSchema], default: [] },
  },
  { timestamps: true }
);

export const ProcurementSettings = mongoose.model<IProcurementSettings>(
  'ProcurementSettings',
  procurementSettingsSchema
);
