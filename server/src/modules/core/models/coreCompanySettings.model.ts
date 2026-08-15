import mongoose, { Document, Schema } from 'mongoose';

export interface ICoreCompanySettings extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  companyName: string;
  legalName?: string;
  logoUrl?: string;
  address?: string;
  city?: string;
  country?: string;
  taxId?: string;
  website?: string;
  baseCurrencyCode: string;
  timezone?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const coreCompanySettingsSchema = new Schema<ICoreCompanySettings>(
  {
    taskflowOrganizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      unique: true,
      index: true,
    },
    companyName: { type: String, required: true, trim: true },
    legalName: { type: String, trim: true },
    logoUrl: { type: String, trim: true },
    address: { type: String, trim: true },
    city: { type: String, trim: true },
    country: { type: String, trim: true },
    taxId: { type: String, trim: true },
    website: { type: String, trim: true },
    baseCurrencyCode: { type: String, default: 'USD', uppercase: true, trim: true },
    timezone: { type: String, trim: true },
    notes: { type: String },
  },
  { timestamps: true }
);

export const CoreCompanySettings = mongoose.model<ICoreCompanySettings>(
  'CoreCompanySettings',
  coreCompanySettingsSchema
);
