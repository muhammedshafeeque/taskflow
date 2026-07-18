import mongoose, { Document, Schema } from 'mongoose';

export interface IBillingTaxRule extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  name: string;
  code: string;
  rate: number;
  jurisdiction?: string;
  hsnSac?: string;
  inclusive: boolean;
  enabled: boolean;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const billingTaxRuleSchema = new Schema<IBillingTaxRule>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true },
    rate: { type: Number, required: true, min: 0 },
    jurisdiction: { type: String },
    hsnSac: { type: String },
    inclusive: { type: Boolean, default: false },
    enabled: { type: Boolean, default: true },
    notes: { type: String },
  },
  { timestamps: true }
);

billingTaxRuleSchema.index({ taskflowOrganizationId: 1, code: 1 }, { unique: true });

export const BillingTaxRule = mongoose.model<IBillingTaxRule>('BillingTaxRule', billingTaxRuleSchema);
