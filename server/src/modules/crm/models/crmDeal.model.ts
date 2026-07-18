import mongoose, { Document, Schema } from 'mongoose';

export type CrmDealStatus = 'open' | 'won' | 'lost';

export interface ICrmDealLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  billingType: 'fixed' | 'hourly' | 'milestone';
}

export interface ICrmDeal extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  accountId: mongoose.Types.ObjectId;
  pipelineId: mongoose.Types.ObjectId;
  stageId: mongoose.Types.ObjectId;
  title: string;
  value: number;
  currency: string;
  probability: number;
  expectedCloseDate?: Date;
  ownerId?: mongoose.Types.ObjectId;
  status: CrmDealStatus;
  winReason?: string;
  lossReason?: string;
  competitorNotes?: string;
  lineItems: ICrmDealLineItem[];
  projectId?: mongoose.Types.ObjectId;
  leadId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const lineItemSchema = new Schema(
  {
    description: { type: String, required: true },
    quantity: { type: Number, default: 1 },
    unitPrice: { type: Number, default: 0 },
    billingType: { type: String, enum: ['fixed', 'hourly', 'milestone'], default: 'fixed' },
  },
  { _id: false }
);

const crmDealSchema = new Schema<ICrmDeal>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'CrmAccount', required: true, index: true },
    pipelineId: { type: Schema.Types.ObjectId, ref: 'CrmPipeline', required: true },
    stageId: { type: Schema.Types.ObjectId, ref: 'CrmStage', required: true },
    title: { type: String, required: true, trim: true },
    value: { type: Number, default: 0 },
    currency: { type: String, default: 'USD' },
    probability: { type: Number, default: 0, min: 0, max: 100 },
    expectedCloseDate: { type: Date },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['open', 'won', 'lost'], default: 'open' },
    winReason: { type: String },
    lossReason: { type: String },
    competitorNotes: { type: String },
    lineItems: { type: [lineItemSchema], default: [] },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    leadId: { type: Schema.Types.ObjectId, ref: 'CrmLead' },
  },
  { timestamps: true }
);

export const CrmDeal = mongoose.model<ICrmDeal>('CrmDeal', crmDealSchema);
