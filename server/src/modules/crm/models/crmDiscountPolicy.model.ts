import mongoose, { Schema } from 'mongoose';

/**
 * Quotation discount limits for one workspace (AUT-31): how far below list price someone may quote
 * without approval. A person's limit is the highest of the rules that match them (their roles and
 * their employee level), else the default. Admins are not limited.
 */
export interface ICrmDiscountPolicy {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  enabled: boolean;
  /** Limit for anyone no rule matches, in percent of list price. */
  defaultMaxPercent: number;
  roleLimits: Array<{ roleId: mongoose.Types.ObjectId; maxPercent: number }>;
  levelLimits: Array<{ level: string; maxPercent: number }>;
  updatedBy?: mongoose.Types.ObjectId;
  updatedAt?: Date;
}

const pct = { type: Number, required: true, min: 0, max: 100 } as const;

const schema = new Schema<ICrmDiscountPolicy>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, unique: true },
    enabled: { type: Boolean, default: false },
    defaultMaxPercent: { type: Number, default: 10, min: 0, max: 100 },
    roleLimits: { type: [{ _id: false, roleId: { type: Schema.Types.ObjectId, ref: 'Role', required: true }, maxPercent: pct }], default: [] },
    levelLimits: { type: [{ _id: false, level: { type: String, required: true, trim: true }, maxPercent: pct }], default: [] },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export const CrmDiscountPolicy = mongoose.model<ICrmDiscountPolicy>('CrmDiscountPolicy', schema);
