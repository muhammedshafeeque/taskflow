import mongoose, { Document, Schema } from 'mongoose';

export type LicenseStatus = 'active' | 'expired' | 'cancelled';

export interface IAssetLicense extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  name: string;
  vendor?: string;
  vendorAccountId?: mongoose.Types.ObjectId;
  status: LicenseStatus;
  seatsTotal: number;
  seatsUsed: number;
  seatCost?: number;
  currency: string;
  renewalDate?: Date;
  purchaseOrderId?: mongoose.Types.ObjectId;
  assignedUserIds: mongoose.Types.ObjectId[];
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const assetLicenseSchema = new Schema<IAssetLicense>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true },
    vendor: { type: String },
    vendorAccountId: { type: Schema.Types.ObjectId, ref: 'CrmAccount' },
    status: { type: String, enum: ['active', 'expired', 'cancelled'], default: 'active', index: true },
    seatsTotal: { type: Number, default: 1 },
    seatsUsed: { type: Number, default: 0 },
    seatCost: { type: Number, default: 0 },
    currency: { type: String, default: 'USD' },
    renewalDate: { type: Date, index: true },
    purchaseOrderId: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder' },
    assignedUserIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    notes: { type: String },
  },
  { timestamps: true }
);

export const AssetLicense = mongoose.model<IAssetLicense>('AssetLicense', assetLicenseSchema);
