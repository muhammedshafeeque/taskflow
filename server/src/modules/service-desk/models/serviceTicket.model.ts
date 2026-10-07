import mongoose, { Document, Schema } from 'mongoose';

export type ServiceTicketStatus = 'open' | 'pending' | 'in_progress' | 'resolved' | 'closed';
export type ServiceTicketPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface IServiceTicketComment {
  authorId?: mongoose.Types.ObjectId;
  authorName?: string;
  body: string;
  internal: boolean;
  createdAt: Date;
}

export interface IServiceTicket extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  accountId?: mongoose.Types.ObjectId;
  contactId?: mongoose.Types.ObjectId;
  contractId?: mongoose.Types.ObjectId;
  projectId?: mongoose.Types.ObjectId;
  customerOrgId?: mongoose.Types.ObjectId;
  subject: string;
  description?: string;
  status: ServiceTicketStatus;
  priority: ServiceTicketPriority;
  queue: string;
  assigneeId?: mongoose.Types.ObjectId;
  slaPolicyId?: mongoose.Types.ObjectId;
  firstResponseDueAt?: Date;
  resolutionDueAt?: Date;
  firstRespondedAt?: Date;
  resolvedAt?: Date;
  customerRequestId?: mongoose.Types.ObjectId;
  linkedIssueId?: mongoose.Types.ObjectId;
  workClassification?: 'billable_change' | 'fix';
  /** Origin channel — e.g. whatsapp_pa for the PA WhatsApp bot */
  source?: string;
  requesterEmail?: string;
  requesterName?: string;
  emailRef?: string;
  mergedIntoId?: mongoose.Types.ObjectId;
  whatsappGroupId?: string;
  whatsappMessageId?: string;
  supportConversationId?: string;
  aiAnalysis?: Record<string, unknown>;
  qaAnalysis?: Record<string, unknown>;
  csatScore?: number;
  csatComment?: string;
  comments: IServiceTicketComment[];
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ticketCommentSchema = new Schema<IServiceTicketComment>(
  {
    authorId: { type: Schema.Types.ObjectId, ref: 'User' },
    authorName: { type: String },
    body: { type: String, required: true },
    internal: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const serviceTicketSchema = new Schema<IServiceTicket>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'CrmAccount', index: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'CrmContact' },
    contractId: { type: Schema.Types.ObjectId, ref: 'CrmContract' },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
    customerOrgId: { type: Schema.Types.ObjectId, ref: 'CustomerOrg', index: true },
    subject: { type: String, required: true, trim: true },
    description: { type: String },
    status: { type: String, enum: ['open', 'pending', 'in_progress', 'resolved', 'closed'], default: 'open' },
    priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
    queue: { type: String, default: 'general' },
    assigneeId: { type: Schema.Types.ObjectId, ref: 'User' },
    slaPolicyId: { type: Schema.Types.ObjectId, ref: 'SlaPolicy' },
    firstResponseDueAt: { type: Date },
    resolutionDueAt: { type: Date },
    firstRespondedAt: { type: Date },
    resolvedAt: { type: Date },
    customerRequestId: { type: Schema.Types.ObjectId, ref: 'CustomerRequest' },
    linkedIssueId: { type: Schema.Types.ObjectId, ref: 'Issue' },
    workClassification: { type: String, enum: ['billable_change', 'fix'] },
    source: { type: String, default: undefined, index: true },
    /** Email-sourced tickets: who to reply to, and the token that threads replies (`[TKT-xxxxxxxx]`). */
    requesterEmail: { type: String, lowercase: true, trim: true },
    requesterName: { type: String, trim: true },
    emailRef: { type: String, index: true, sparse: true },
    mergedIntoId: { type: Schema.Types.ObjectId, ref: 'ServiceTicket' },
    whatsappGroupId: { type: String, default: undefined, index: true },
    whatsappMessageId: { type: String, default: undefined },
    supportConversationId: { type: String, default: undefined, index: true },
    aiAnalysis: { type: Schema.Types.Mixed },
    qaAnalysis: { type: Schema.Types.Mixed },
    csatScore: { type: Number, min: 1, max: 5 },
    csatComment: { type: String },
    comments: { type: [ticketCommentSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

serviceTicketSchema.index({ taskflowOrganizationId: 1, status: 1, queue: 1 });

// SLA reminders scan open tickets by due times.
serviceTicketSchema.index({ status: 1, firstResponseDueAt: 1 });
serviceTicketSchema.index({ status: 1, resolutionDueAt: 1 });

export const ServiceTicket = mongoose.model<IServiceTicket>('ServiceTicket', serviceTicketSchema);
