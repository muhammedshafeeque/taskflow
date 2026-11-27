import mongoose, { Document, Schema } from 'mongoose';

export type CrmContractBillingCycle = 'monthly' | 'quarterly' | 'annual' | 'one_time';
export type CrmContractKind = 'msa' | 'retainer' | 'amc' | 'hourly' | 'other';
export type CrmContractStatus = 'draft' | 'active' | 'expired' | 'cancelled';
export type CrmContractSupportPeriod = 'lifelong_with_payment' | 'from_prod_release' | 'from_last_invoice';

export interface ICrmContract extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  accountId?: mongoose.Types.ObjectId;
  customerOrgId?: mongoose.Types.ObjectId;
  dealId?: mongoose.Types.ObjectId;
  projectId?: mongoose.Types.ObjectId;
  /** The accepted quotation this draft contract was made from (one contract per quotation). */
  quoteId?: mongoose.Types.ObjectId;
  title: string;
  kind: CrmContractKind;
  value: number;
  currency: string;
  billingCycle: CrmContractBillingCycle;
  startDate: Date;
  endDate?: Date;
  renewalDate?: Date;
  autoRenew: boolean;
  hoursIncluded?: number;
  hoursUsed?: number;
  hourlyRate?: number;
  supportPeriod?: CrmContractSupportPeriod;
  supportDurationMonths?: number;
  prodReleaseDate?: Date;
  status: CrmContractStatus;
  slaPolicyId?: mongoose.Types.ObjectId;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const crmContractSchema = new Schema<ICrmContract>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'CrmAccount', index: true },
    customerOrgId: { type: Schema.Types.ObjectId, ref: 'CustomerOrg', index: true },
    dealId: { type: Schema.Types.ObjectId, ref: 'CrmDeal' },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    quoteId: { type: Schema.Types.ObjectId, ref: 'CrmQuote' },
    title: { type: String, required: true },
    kind: { type: String, enum: ['msa', 'retainer', 'amc', 'hourly', 'other'], default: 'other', index: true },
    value: { type: Number, default: 0 },
    currency: { type: String, default: 'USD' },
    billingCycle: { type: String, enum: ['monthly', 'quarterly', 'annual', 'one_time'], default: 'monthly' },
    startDate: { type: Date, required: true },
    endDate: { type: Date },
    renewalDate: { type: Date, index: true },
    autoRenew: { type: Boolean, default: false },
    hoursIncluded: { type: Number },
    hoursUsed: { type: Number, default: 0 },
    hourlyRate: { type: Number },
    supportPeriod: {
      type: String,
      enum: ['lifelong_with_payment', 'from_prod_release', 'from_last_invoice'],
    },
    supportDurationMonths: { type: Number },
    prodReleaseDate: { type: Date },
    status: { type: String, enum: ['draft', 'active', 'expired', 'cancelled'], default: 'draft', index: true },
    slaPolicyId: { type: Schema.Types.ObjectId, ref: 'SlaPolicy' },
    notes: { type: String },
  },
  { timestamps: true }
);

crmContractSchema.index({ taskflowOrganizationId: 1, kind: 1, status: 1 });
crmContractSchema.index({ taskflowOrganizationId: 1, renewalDate: 1 });

// Retrying a quotation's handoff must never make a second contract for it (AUT-33).
crmContractSchema.index({ quoteId: 1 }, { unique: true, partialFilterExpression: { quoteId: { $type: 'objectId' } } });

export const CrmContract = mongoose.model<ICrmContract>('CrmContract', crmContractSchema);
