import mongoose, { Document, Schema } from 'mongoose';

export type CrmQuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';
export type CrmQuoteBillingType = 'fixed' | 'hourly' | 'milestone';

/** Steps run after a quotation is accepted, in order (AUT-33). */
export const QUOTE_HANDOFF_STEPS = ['account', 'contract', 'invoice', 'delivery', 'deal'] as const;
export type QuoteHandoffStep = (typeof QUOTE_HANDOFF_STEPS)[number];

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

export type CrmQuoteHistoryAction =
  | 'created'
  | 'updated'
  | 'sent'
  | 'status_changed'
  | 'emailed';

export interface ICrmQuoteHistoryEntry {
  at: Date;
  action: CrmQuoteHistoryAction;
  message: string;
  userId?: mongoose.Types.ObjectId;
  meta?: Record<string, unknown>;
}

export interface ICrmQuote extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  /** Optional — quotes may be linked to a deal and/or a lead */
  dealId?: mongoose.Types.ObjectId;
  leadId?: mongoose.Types.ObjectId;
  accountId?: mongoose.Types.ObjectId;
  customerOrgId?: mongoose.Types.ObjectId;
  contactId?: mongoose.Types.ObjectId;
  title: string;
  status: CrmQuoteStatus;
  version: number;
  /** Date printed on the quotation; defaults to creation date, editable while draft/sent */
  issueDate?: Date;
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
  projectId?: mongoose.Types.ObjectId;
  /**
   * What happened after acceptance (AUT-33): each step of the handoff to billing and delivery, so a
   * failure is visible and can be retried without duplicates.
   */
  handoff?: {
    status: 'done' | 'failed';
    steps: Array<{ key: QuoteHandoffStep; status: 'done' | 'failed' | 'skipped'; at: Date; refId?: string; error?: string }>;
    failedStep?: QuoteHandoffStep;
    error?: string;
    attempts: number;
    lastAttemptAt: Date;
  };
  /** How the quotation was accepted or rejected (AUT-32): by staff, or by the customer online. */
  response?: {
    decision: 'accepted' | 'rejected';
    via: 'staff' | 'link' | 'portal';
    name?: string;
    email?: string;
    note?: string;
    at: Date;
    userId?: mongoose.Types.ObjectId;
    customerUserId?: mongoose.Types.ObjectId;
  };
  /** Audit trail of status / send / content changes */
  history: ICrmQuoteHistoryEntry[];
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
    dealId: { type: Schema.Types.ObjectId, ref: 'CrmDeal', index: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'CrmLead', index: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'CrmAccount' },
    customerOrgId: { type: Schema.Types.ObjectId, ref: 'CustomerOrg', index: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'CrmContact' },
    title: { type: String, required: true },
    status: { type: String, enum: ['draft', 'sent', 'accepted', 'rejected', 'expired'], default: 'draft' },
    version: { type: Number, default: 1 },
    issueDate: { type: Date },
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
    projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    handoff: {
      type: new Schema(
        {
          status: { type: String, enum: ['done', 'failed'], required: true },
          steps: {
            type: [
              new Schema(
                {
                  key: { type: String, enum: QUOTE_HANDOFF_STEPS, required: true },
                  status: { type: String, enum: ['done', 'failed', 'skipped'], required: true },
                  at: { type: Date, required: true },
                  refId: String,
                  error: String,
                },
                { _id: false }
              ),
            ],
            default: [],
          },
          failedStep: { type: String, enum: QUOTE_HANDOFF_STEPS },
          error: String,
          attempts: { type: Number, default: 0 },
          lastAttemptAt: Date,
        },
        { _id: false }
      ),
      default: undefined,
    },
    response: {
      type: new Schema(
        {
          decision: { type: String, enum: ['accepted', 'rejected'], required: true },
          via: { type: String, enum: ['staff', 'link', 'portal'], required: true },
          name: String,
          email: String,
          note: String,
          at: { type: Date, required: true },
          userId: { type: Schema.Types.ObjectId, ref: 'User' },
          customerUserId: { type: Schema.Types.ObjectId, ref: 'CustomerUser' },
        },
        { _id: false }
      ),
      default: undefined,
    },
    history: {
      type: [
        {
          at: { type: Date, default: Date.now },
          action: {
            type: String,
            enum: ['created', 'updated', 'sent', 'status_changed', 'emailed'],
            required: true,
          },
          message: { type: String, required: true },
          userId: { type: Schema.Types.ObjectId, ref: 'User' },
          meta: { type: Schema.Types.Mixed },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

export const CrmQuote = mongoose.model<ICrmQuote>('CrmQuote', crmQuoteSchema);
