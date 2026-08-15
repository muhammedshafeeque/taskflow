import mongoose, { Document, Schema } from 'mongoose';

export type CrmQuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';
export type CrmQuoteBillingType = 'fixed' | 'hourly' | 'milestone';

export interface ICrmQuoteLine {
  /** Feature / module / deliverable name */
  description: string;
  /** Optional grouping e.g. Frontend, Backend, Integration */
  category?: string;
  quantity: number;
  unitPrice: number;
  billingType: CrmQuoteBillingType;
  /** Line-level tax percent (e.g. 18 for GST) */
  taxRate: number;
  /** Line-level discount percent */
  discountPercent: number;
  /** Net line amount after discount, before tax */
  amount: number;
}

export interface ICrmQuote extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  dealId: mongoose.Types.ObjectId;
  accountId: mongoose.Types.ObjectId;
  title: string;
  status: CrmQuoteStatus;
  version: number;
  validUntil?: Date;
  lineItems: ICrmQuoteLine[];
  /** Sum of line amounts (after line discounts, before quote discount & tax) */
  subtotal: number;
  /** Quote-level discount percent */
  discountPercent: number;
  /** Computed quote-level discount money */
  discountAmount: number;
  /** Sum of tax on lines (after discounts) */
  taxTotal: number;
  /** subtotal - discountAmount + taxTotal */
  total: number;
  currency: string;
  taxCode?: string;
  notes?: string;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const quoteLineSchema = new Schema(
  {
    description: { type: String, required: true },
    category: { type: String },
    quantity: { type: Number, default: 1 },
    unitPrice: { type: Number, default: 0 },
    billingType: { type: String, enum: ['fixed', 'hourly', 'milestone'], default: 'fixed' },
    taxRate: { type: Number, default: 0, min: 0 },
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    amount: { type: Number, default: 0 },
  },
  { _id: false }
);

const crmQuoteSchema = new Schema<ICrmQuote>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    dealId: { type: Schema.Types.ObjectId, ref: 'CrmDeal', required: true, index: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'CrmAccount', required: true },
    title: { type: String, required: true },
    status: { type: String, enum: ['draft', 'sent', 'accepted', 'rejected', 'expired'], default: 'draft' },
    version: { type: Number, default: 1 },
    validUntil: { type: Date },
    lineItems: { type: [quoteLineSchema], default: [] },
    subtotal: { type: Number, default: 0 },
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    discountAmount: { type: Number, default: 0 },
    taxTotal: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    currency: { type: String, default: 'USD' },
    taxCode: { type: String },
    notes: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

export const CrmQuote = mongoose.model<ICrmQuote>('CrmQuote', crmQuoteSchema);
