import mongoose, { Document, Schema } from 'mongoose';

export interface IOrganization extends Document {
  name: string;
  slug: string;
  description?: string;
  logoUrl?: string;
  createdBy: mongoose.Types.ObjectId;
  status: 'active' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

const organizationSchema = new Schema<IOrganization>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, default: '' },
    logoUrl: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
  },
  { timestamps: true }
);

organizationSchema.index({ createdBy: 1 });

export const Organization = mongoose.model<IOrganization>('Organization', organizationSchema);
