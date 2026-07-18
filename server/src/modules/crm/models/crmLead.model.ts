import mongoose, { Document, Schema } from 'mongoose';

export type CrmLeadStatus = 'new' | 'contacted' | 'qualified' | 'unqualified' | 'converted';

export interface ICrmLead extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  title: string;
  source: string;
  status: CrmLeadStatus;
  score?: number;
  assigneeId?: mongoose.Types.ObjectId;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  companyName?: string;
  accountId?: mongoose.Types.ObjectId;
  dealId?: mongoose.Types.ObjectId;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const crmLeadSchema = new Schema<ICrmLead>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    title: { type: String, required: true, trim: true },
    source: { type: String, default: 'web' },
    status: { type: String, enum: ['new', 'contacted', 'qualified', 'unqualified', 'converted'], default: 'new' },
    score: { type: Number },
    assigneeId: { type: Schema.Types.ObjectId, ref: 'User' },
    contactName: { type: String },
    contactEmail: { type: String, lowercase: true, trim: true },
    contactPhone: { type: String },
    companyName: { type: String },
    accountId: { type: Schema.Types.ObjectId, ref: 'CrmAccount' },
    dealId: { type: Schema.Types.ObjectId, ref: 'CrmDeal' },
    notes: { type: String },
  },
  { timestamps: true }
);

export const CrmLead = mongoose.model<ICrmLead>('CrmLead', crmLeadSchema);
