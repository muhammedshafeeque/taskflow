import mongoose, { Document, Schema } from 'mongoose';

export type BillingInvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'void';

export interface IBillingInvoiceLine {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  amount: number;
  sourceType?: 'manual' | 'subscription' | 'time' | 'milestone';
  sourceId?: string;
}

export interface IBillingInvoice extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  accountId: mongoose.Types.ObjectId;
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
  postedToAccounts: boolean;
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
    sourceType: { type: String, enum: ['manual', 'subscription', 'time', 'milestone'], default: 'manual' },
    sourceId: { type: String },
  },
  { _id: false }
);

const billingInvoiceSchema = new Schema<IBillingInvoice>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'CrmAccount', required: true, index: true },
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
    postedToAccounts: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

billingInvoiceSchema.index({ taskflowOrganizationId: 1, number: 1 }, { unique: true });
billingInvoiceSchema.index({ taskflowOrganizationId: 1, status: 1, dueDate: 1 });

export const BillingInvoice = mongoose.model<IBillingInvoice>('BillingInvoice', billingInvoiceSchema);
