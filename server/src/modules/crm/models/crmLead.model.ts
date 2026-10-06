import mongoose, { Document, Schema } from 'mongoose';
import {
  CRM_LEAD_COMPANY_SIZES,
  CRM_LEAD_DECISION_ROLES,
  CRM_LEAD_STATUSES,
  CRM_LEAD_TIMELINES,
  type CrmLeadStatus,
} from '../leads/leads.constants';

export type { CrmLeadStatus };

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
  jobTitle?: string;
  companyName?: string;
  website?: string;
  industry?: string;
  companySize?: string;
  country?: string;
  serviceInterest: string[];
  techStack?: string;
  estimatedBudget?: number;
  currency?: string;
  timeline?: string;
  decisionRole?: string;
  campaign?: string;
  campaignId?: mongoose.Types.ObjectId;
  tags: string[];
  competitor?: string;
  ndaRequired?: boolean;
  rfpReceived?: boolean;
  nextFollowUpAt?: Date;
  disqualifyReason?: string;
  additionalContacts: Array<{
    name?: string;
    email?: string;
    phone?: string;
    jobTitle?: string;
    decisionRole?: string;
    contactId?: mongoose.Types.ObjectId;
  }>;
  accountId?: mongoose.Types.ObjectId;
  customerOrgId?: mongoose.Types.ObjectId;
  dealId?: mongoose.Types.ObjectId;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const crmLeadSchema = new Schema<ICrmLead>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    title: { type: String, required: true, trim: true },
    source: { type: String, default: 'website', trim: true },
    status: { type: String, enum: CRM_LEAD_STATUSES, default: 'new', index: true },
    score: { type: Number, min: 0, max: 100 },
    assigneeId: { type: Schema.Types.ObjectId, ref: 'User' },
    contactName: { type: String, trim: true },
    contactEmail: { type: String, lowercase: true, trim: true },
    contactPhone: { type: String, trim: true },
    jobTitle: { type: String, trim: true },
    companyName: { type: String, trim: true },
    website: { type: String, trim: true },
    industry: { type: String, trim: true },
    companySize: { type: String, enum: CRM_LEAD_COMPANY_SIZES },
    country: { type: String, trim: true },
    serviceInterest: { type: [String], default: [] },
    techStack: { type: String, trim: true },
    estimatedBudget: { type: Number, min: 0 },
    currency: { type: String, default: 'USD', trim: true, uppercase: true },
    timeline: { type: String, enum: CRM_LEAD_TIMELINES },
    decisionRole: { type: String, enum: CRM_LEAD_DECISION_ROLES },
    campaign: { type: String, trim: true },
    campaignId: { type: Schema.Types.ObjectId, ref: 'CrmCampaign' },
    tags: { type: [String], default: [] },
    competitor: { type: String, trim: true },
    ndaRequired: { type: Boolean, default: false },
    rfpReceived: { type: Boolean, default: false },
    nextFollowUpAt: { type: Date },
    disqualifyReason: { type: String, trim: true },
    additionalContacts: {
      type: [
        {
          name: { type: String, trim: true },
          email: { type: String, lowercase: true, trim: true },
          phone: { type: String, trim: true },
          jobTitle: { type: String, trim: true },
          decisionRole: { type: String, enum: CRM_LEAD_DECISION_ROLES },
          contactId: { type: Schema.Types.ObjectId, ref: 'CrmContact' },
        },
      ],
      default: [],
    },
    accountId: { type: Schema.Types.ObjectId, ref: 'CrmAccount' },
    customerOrgId: { type: Schema.Types.ObjectId, ref: 'CustomerOrg' },
    dealId: { type: Schema.Types.ObjectId, ref: 'CrmDeal' },
    notes: { type: String },
  },
  { timestamps: true }
);

crmLeadSchema.index({ taskflowOrganizationId: 1, status: 1, createdAt: -1 });
crmLeadSchema.index({ taskflowOrganizationId: 1, assigneeId: 1, status: 1 });
crmLeadSchema.index({ taskflowOrganizationId: 1, contactEmail: 1 });
crmLeadSchema.index({ taskflowOrganizationId: 1, nextFollowUpAt: 1 });

crmLeadSchema.index({ nextFollowUpAt: 1 });

export const CrmLead = mongoose.model<ICrmLead>('CrmLead', crmLeadSchema);
