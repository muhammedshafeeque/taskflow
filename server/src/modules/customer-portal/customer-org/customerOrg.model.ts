import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ICustomerOrg extends Document {
  name: string;
  slug: string;
  /** Parent TaskFlow workspace that owns this customer company */
  taskflowOrganizationId?: Types.ObjectId;
  logo?: string;
  description?: string;
  contactEmail: string;
  contactPhone?: string;
  status: 'active' | 'inactive' | 'suspended';
  crmAccountId?: Types.ObjectId;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const customerOrgSchema = new Schema<ICustomerOrg>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
    logo: { type: String },
    description: { type: String },
    contactEmail: { type: String, required: true, lowercase: true, trim: true },
    contactPhone: { type: String },
    status: { type: String, enum: ['active', 'inactive', 'suspended'], default: 'active' },
    crmAccountId: { type: Schema.Types.ObjectId, ref: 'CrmAccount', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

export const CustomerOrg = mongoose.model<ICustomerOrg>('CustomerOrg', customerOrgSchema);
