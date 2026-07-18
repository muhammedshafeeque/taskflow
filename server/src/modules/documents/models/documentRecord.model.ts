import mongoose, { Document, Schema } from 'mongoose';

export type DocumentKind = 'proposal' | 'sow' | 'policy' | 'template';
export type DocumentStatus = 'draft' | 'in_review' | 'sent' | 'signed' | 'approved' | 'archived';
export type DocumentEntityType = 'account' | 'deal' | 'contract' | 'project' | 'none';

export interface IDocumentRecord extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  title: string;
  kind: DocumentKind;
  status: DocumentStatus;
  version: number;
  entityType: DocumentEntityType;
  entityId?: mongoose.Types.ObjectId;
  accountId?: mongoose.Types.ObjectId;
  ownerId?: mongoose.Types.ObjectId;
  value?: number;
  currency: string;
  tags: string[];
  summary?: string;
  content?: string;
  fileUrl?: string;
  isTemplate: boolean;
  sentAt?: Date;
  signedAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const documentRecordSchema = new Schema<IDocumentRecord>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    title: { type: String, required: true, trim: true },
    kind: { type: String, enum: ['proposal', 'sow', 'policy', 'template'], default: 'proposal', index: true },
    status: { type: String, enum: ['draft', 'in_review', 'sent', 'signed', 'approved', 'archived'], default: 'draft', index: true },
    version: { type: Number, default: 1 },
    entityType: { type: String, enum: ['account', 'deal', 'contract', 'project', 'none'], default: 'none' },
    entityId: { type: Schema.Types.ObjectId },
    accountId: { type: Schema.Types.ObjectId, ref: 'CrmAccount' },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User' },
    value: { type: Number, default: 0 },
    currency: { type: String, default: 'USD' },
    tags: { type: [String], default: [] },
    summary: { type: String },
    content: { type: String },
    fileUrl: { type: String },
    isTemplate: { type: Boolean, default: false, index: true },
    sentAt: { type: Date },
    signedAt: { type: Date },
    expiresAt: { type: Date },
  },
  { timestamps: true }
);

documentRecordSchema.index({ taskflowOrganizationId: 1, kind: 1, status: 1 });

export const DocumentRecord = mongoose.model<IDocumentRecord>('DocumentRecord', documentRecordSchema);
