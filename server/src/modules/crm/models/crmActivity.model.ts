import mongoose, { Document, Schema } from 'mongoose';

export type CrmActivityType = 'call' | 'meeting' | 'email' | 'task' | 'note' | 'demo' | 'follow_up';

export interface ICrmActivity extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  type: CrmActivityType;
  subject: string;
  body?: string;
  dueAt?: Date;
  completedAt?: Date;
  assigneeId?: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  relatedType: 'account' | 'contact' | 'lead' | 'deal' | 'ticket';
  relatedId: mongoose.Types.ObjectId;
  mailMessageId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const crmActivitySchema = new Schema<ICrmActivity>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    type: { type: String, enum: ['call', 'meeting', 'email', 'task', 'note', 'demo', 'follow_up'], required: true },
    subject: { type: String, required: true, trim: true },
    body: { type: String },
    dueAt: { type: Date },
    completedAt: { type: Date },
    assigneeId: { type: Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    relatedType: { type: String, enum: ['account', 'contact', 'lead', 'deal', 'ticket'], required: true },
    relatedId: { type: Schema.Types.ObjectId, required: true, index: true },
    mailMessageId: { type: Schema.Types.ObjectId, ref: 'MailMessage' },
  },
  { timestamps: true }
);

crmActivitySchema.index({ taskflowOrganizationId: 1, relatedType: 1, relatedId: 1, createdAt: -1 });

export const CrmActivity = mongoose.model<ICrmActivity>('CrmActivity', crmActivitySchema);
