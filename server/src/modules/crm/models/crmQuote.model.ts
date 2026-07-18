import mongoose, { Document, Schema } from 'mongoose';

export type CrmQuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';

export interface ICrmQuoteLine {
  description: string;
  quantity: number;
  unitPrice: number;
  billingType: 'fixed' | 'hourly' | 'milestone';
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
  subtotal: number;
  currency: string;
  notes?: string;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const quoteLineSchema = new Schema(
  {
    description: { type: String, required: true },
    quantity: { type: Number, default: 1 },
    unitPrice: { type: Number, default: 0 },
    billingType: { type: String, enum: ['fixed', 'hourly', 'milestone'], default: 'fixed' },
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
    currency: { type: String, default: 'USD' },
    notes: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

export const CrmQuote = mongoose.model<ICrmQuote>('CrmQuote', crmQuoteSchema);
