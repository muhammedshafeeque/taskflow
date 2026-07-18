import mongoose, { Document, Schema } from 'mongoose';

export type BillingSubscriptionStatus = 'active' | 'paused' | 'cancelled' | 'trial';
export type BillingSubscriptionCycle = 'monthly' | 'quarterly' | 'annual';

export interface IBillingSubscription extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  accountId: mongoose.Types.ObjectId;
  contractId?: mongoose.Types.ObjectId;
  name: string;
  planCode?: string;
  status: BillingSubscriptionStatus;
  billingCycle: BillingSubscriptionCycle;
  amount: number;
  currency: string;
  seats: number;
  unitPrice: number;
  startDate: Date;
  nextBillingDate?: Date;
  endDate?: Date;
  autoRenew: boolean;
  notes?: string;
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const billingSubscriptionSchema = new Schema<IBillingSubscription>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'CrmAccount', required: true, index: true },
    contractId: { type: Schema.Types.ObjectId, ref: 'CrmContract' },
    name: { type: String, required: true, trim: true },
    planCode: { type: String, trim: true },
    status: { type: String, enum: ['active', 'paused', 'cancelled', 'trial'], default: 'active', index: true },
    billingCycle: { type: String, enum: ['monthly', 'quarterly', 'annual'], default: 'monthly' },
    amount: { type: Number, default: 0 },
    currency: { type: String, default: 'USD' },
    seats: { type: Number, default: 1, min: 1 },
    unitPrice: { type: Number, default: 0 },
    startDate: { type: Date, required: true },
    nextBillingDate: { type: Date, index: true },
    endDate: { type: Date },
    autoRenew: { type: Boolean, default: true },
    notes: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

billingSubscriptionSchema.index({ taskflowOrganizationId: 1, status: 1 });

export const BillingSubscription = mongoose.model<IBillingSubscription>(
  'BillingSubscription',
  billingSubscriptionSchema
);
