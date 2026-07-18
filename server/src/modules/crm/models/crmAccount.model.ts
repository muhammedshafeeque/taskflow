import mongoose, { Document, Schema } from 'mongoose';

export type CrmAccountType = 'prospect' | 'client' | 'partner' | 'vendor';

export interface ICrmAccount extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  name: string;
  type: CrmAccountType;
  industry?: string;
  size?: string;
  website?: string;
  billingAddress?: string;
  tags: string[];
  ownerId?: mongoose.Types.ObjectId;
  healthScore?: number;
  parentAccountId?: mongoose.Types.ObjectId;
  customerOrgId?: mongoose.Types.ObjectId;
  projectIds: mongoose.Types.ObjectId[];
  customFields?: Record<string, unknown>;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const crmAccountSchema = new Schema<ICrmAccount>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['prospect', 'client', 'partner', 'vendor'], default: 'client' },
    industry: { type: String },
    size: { type: String },
    website: { type: String },
    billingAddress: { type: String },
    tags: { type: [String], default: [] },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User' },
    healthScore: { type: Number, min: 0, max: 100 },
    parentAccountId: { type: Schema.Types.ObjectId, ref: 'CrmAccount' },
    customerOrgId: { type: Schema.Types.ObjectId, ref: 'CustomerOrg', sparse: true },
    projectIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Project' }], default: [] },
    customFields: { type: Schema.Types.Mixed },
    notes: { type: String },
  },
  { timestamps: true }
);

crmAccountSchema.index({ taskflowOrganizationId: 1, name: 1 });
crmAccountSchema.index({ taskflowOrganizationId: 1, customerOrgId: 1 }, { sparse: true });

export const CrmAccount = mongoose.model<ICrmAccount>('CrmAccount', crmAccountSchema);
