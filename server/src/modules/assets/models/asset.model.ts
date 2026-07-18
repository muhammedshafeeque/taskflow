import mongoose, { Document, Schema } from 'mongoose';

export type AssetCategory = 'laptop' | 'desktop' | 'mobile' | 'server' | 'network' | 'peripheral' | 'other';
export type AssetStatus = 'in_stock' | 'assigned' | 'in_repair' | 'retired';

export interface IAsset extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  assetTag: string;
  name: string;
  category: AssetCategory;
  status: AssetStatus;
  serialNumber?: string;
  manufacturer?: string;
  deviceModel?: string;
  assignedUserId?: mongoose.Types.ObjectId;
  accountId?: mongoose.Types.ObjectId;
  vendorAccountId?: mongoose.Types.ObjectId;
  purchaseOrderId?: mongoose.Types.ObjectId;
  location?: string;
  purchaseDate?: Date;
  purchaseCost?: number;
  currency: string;
  warrantyExpiry?: Date;
  amcExpiry?: Date;
  // server/infra specifics
  ipAddress?: string;
  hostname?: string;
  environment?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const assetSchema = new Schema<IAsset>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    assetTag: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, enum: ['laptop', 'desktop', 'mobile', 'server', 'network', 'peripheral', 'other'], default: 'laptop', index: true },
    status: { type: String, enum: ['in_stock', 'assigned', 'in_repair', 'retired'], default: 'in_stock', index: true },
    serialNumber: { type: String },
    manufacturer: { type: String },
    deviceModel: { type: String },
    assignedUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    accountId: { type: Schema.Types.ObjectId, ref: 'CrmAccount' },
    vendorAccountId: { type: Schema.Types.ObjectId, ref: 'CrmAccount' },
    purchaseOrderId: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder' },
    location: { type: String },
    purchaseDate: { type: Date },
    purchaseCost: { type: Number, default: 0 },
    currency: { type: String, default: 'USD' },
    warrantyExpiry: { type: Date, index: true },
    amcExpiry: { type: Date },
    ipAddress: { type: String },
    hostname: { type: String },
    environment: { type: String },
    notes: { type: String },
  },
  { timestamps: true }
);

assetSchema.index({ taskflowOrganizationId: 1, assetTag: 1 }, { unique: true });

export const Asset = mongoose.model<IAsset>('Asset', assetSchema);
