import mongoose, { Document, Schema } from 'mongoose';

export type BillingInvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'void';

export type BillingInvoiceLineType =
  | 'hourly'
  | 'fixed'
  | 'milestone'
  | 'retainer'
  | 'amc'
  | 'support'
  | 'expense';

export interface IBillingInvoiceLine {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  amount: number;
  billingType?: BillingInvoiceLineType;
  category?: string;
  discountPercent?: number;
  periodStart?: Date;
  periodEnd?: Date;
  hsnSac?: string;
  sourceType?: 'manual' | 'subscription' | 'time' | 'milestone';
  sourceId?: string;
}

export interface IBillingInvoice extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  accountId: mongoose.Types.ObjectId;
  customerOrgId?: mongoose.Types.ObjectId;
  subscriptionId?: mongoose.Types.ObjectId;
  contractId?: mongoose.Types.ObjectId;
  projectId?: mongoose.Types.ObjectId;
  number: string;
  status: BillingInvoiceStatus;
  issueDate: Date;
  dueDate?: Date;
  currency: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  lines: IBillingInvoiceLine[];
  notes?: string;
  taxCode?: string;
  paymentTerms?: string;
  poNumber?: string;
  servicePeriodStart?: Date;
  servicePeriodEnd?: Date;
  postedToAccounts: boolean;
  paymentLink?: { provider: 'razorpay' | 'stripe'; id: string; url: string; amount: number; currency: string; createdAt: Date };
  /** Provider payment ids already applied — makes webhook retries idempotent. */
  paymentRefs?: string[];
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const lineSchema = new Schema(
  {
    description: { type: String, required: true },
    quantity: { type: Number, default: 1 },
    unitPrice: { type: Number, default: 0 },
    taxRate: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
    billingType: {
      type: String,
      enum: ['hourly', 'fixed', 'milestone', 'retainer', 'amc', 'support', 'expense'],
      default: 'fixed',
    },
    category: { type: String },
    discountPercent: { type: Number, default: 0 },
    periodStart: { type: Date },
    periodEnd: { type: Date },
    hsnSac: { type: String },
    sourceType: { type: String, enum: ['manual', 'subscription', 'time', 'milestone'], default: 'manual' },
    sourceId: { type: String },
  },
  { _id: false }
);

const billingInvoiceSchema = new Schema<IBillingInvoice>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'CrmAccount', required: true, index: true },
    customerOrgId: { type: Schema.Types.ObjectId, ref: 'CustomerOrg', index: true },
    subscriptionId: { type: Schema.Types.ObjectId, ref: 'BillingSubscription' },
    contractId: { type: Schema.Types.ObjectId, ref: 'CrmContract' },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    number: { type: String, required: true },
    status: {
      type: String,
      enum: ['draft', 'sent', 'paid', 'overdue', 'void'],
      default: 'draft',
      index: true,
    },
    issueDate: { type: Date, required: true },
    dueDate: { type: Date },
    currency: { type: String, default: 'USD' },
    subtotal: { type: Number, default: 0 },
    taxTotal: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    amountPaid: { type: Number, default: 0 },
    lines: { type: [lineSchema], default: [] },
    notes: { type: String },
    taxCode: { type: String },
    paymentTerms: { type: String },
    poNumber: { type: String },
    servicePeriodStart: { type: Date },
    servicePeriodEnd: { type: Date },
    postedToAccounts: { type: Boolean, default: false },
    paymentLink: {
      provider: { type: String, enum: ['razorpay', 'stripe'] },
      id: { type: String },
      url: { type: String },
      amount: { type: Number },
      currency: { type: String },
      createdAt: { type: Date },
    },
    paymentRefs: { type: [String], default: undefined },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

billingInvoiceSchema.index({ taskflowOrganizationId: 1, number: 1 }, { unique: true });
billingInvoiceSchema.index({ taskflowOrganizationId: 1, status: 1, dueDate: 1 });

export const BillingInvoice = mongoose.model<IBillingInvoice>('BillingInvoice', billingInvoiceSchema);
