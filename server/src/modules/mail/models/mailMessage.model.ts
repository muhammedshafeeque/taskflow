import mongoose, { Document, Schema } from 'mongoose';

export interface IMailLinkedEntity {
  entityType: 'account' | 'contact' | 'lead' | 'deal' | 'ticket';
  entityId: mongoose.Types.ObjectId;
}

export interface IMailMessage extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  mailboxId: mongoose.Types.ObjectId;
  messageId: string;
  threadId?: string;
  inReplyTo?: string;
  direction: 'inbound' | 'outbound';
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  bodyHtml?: string;
  bodyText?: string;
  sentAt: Date;
  linkedEntities: IMailLinkedEntity[];
  isRead: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const linkedEntitySchema = new Schema(
  {
    entityType: { type: String, enum: ['account', 'contact', 'lead', 'deal', 'ticket'], required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
  },
  { _id: false }
);

const mailMessageSchema = new Schema<IMailMessage>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    mailboxId: { type: Schema.Types.ObjectId, ref: 'MailMailbox', required: true, index: true },
    messageId: { type: String, required: true },
    threadId: { type: String, index: true },
    inReplyTo: { type: String },
    direction: { type: String, enum: ['inbound', 'outbound'], required: true },
    from: { type: String, required: true },
    to: { type: [String], default: [] },
    cc: { type: [String], default: [] },
    subject: { type: String, default: '' },
    bodyHtml: { type: String },
    bodyText: { type: String },
    sentAt: { type: Date, required: true },
    linkedEntities: { type: [linkedEntitySchema], default: [] },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

mailMessageSchema.index({ mailboxId: 1, messageId: 1 }, { unique: true });
mailMessageSchema.index({ taskflowOrganizationId: 1, sentAt: -1 });

export const MailMessage = mongoose.model<IMailMessage>('MailMessage', mailMessageSchema);
