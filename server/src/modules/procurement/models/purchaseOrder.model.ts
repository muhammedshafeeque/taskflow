import mongoose, { Document, Schema } from 'mongoose';

export type PoStatus = 'draft' | 'pending_approval' | 'approved' | 'ordered' | 'received' | 'cancelled';
export type PoCategory = 'hardware' | 'software' | 'services' | 'subscription' | 'other';

export interface IPurchaseOrderLine {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface IPurchaseOrder extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  poNumber: string;
  title: string;
  vendorAccountId: mongoose.Types.ObjectId;
  category: PoCategory;
  status: PoStatus;
  currency: string;
  lines: IPurchaseOrderLine[];
  subtotal: number;
  taxTotal: number;
  total: number;
  expectedDate?: Date;
  orderedDate?: Date;
  receivedDate?: Date;
  contractId?: mongoose.Types.ObjectId;
  projectId?: mongoose.Types.ObjectId;
  requestedBy?: mongoose.Types.ObjectId;
  approvedBy?: mongoose.Types.ObjectId;
  approvedAt?: Date;
  provisionedAt?: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const lineSchema = new Schema<IPurchaseOrderLine>(
  {
    description: { type: String, required: true },
    quantity: { type: Number, default: 1 },
    unitPrice: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
  },
  { _id: false }
);

const purchaseOrderSchema = new Schema<IPurchaseOrder>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    poNumber: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    vendorAccountId: { type: Schema.Types.ObjectId, ref: 'CrmAccount', required: true, index: true },
    category: { type: String, enum: ['hardware', 'software', 'services', 'subscription', 'other'], default: 'hardware' },
    status: { type: String, enum: ['draft', 'pending_approval', 'approved', 'ordered', 'received', 'cancelled'], default: 'draft', index: true },
    currency: { type: String, default: 'USD' },
    lines: { type: [lineSchema], default: [] },
    subtotal: { type: Number, default: 0 },
    taxTotal: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    expectedDate: { type: Date },
    orderedDate: { type: Date },
    receivedDate: { type: Date },
    contractId: { type: Schema.Types.ObjectId, ref: 'CrmContract' },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    provisionedAt: { type: Date },
    notes: { type: String },
  },
  { timestamps: true }
);

purchaseOrderSchema.index({ taskflowOrganizationId: 1, poNumber: 1 }, { unique: true });

export const PurchaseOrder = mongoose.model<IPurchaseOrder>('PurchaseOrder', purchaseOrderSchema);
