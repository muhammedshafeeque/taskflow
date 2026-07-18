import mongoose, { Document, Schema } from 'mongoose';

export interface IMailMailbox extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  name: string;
  email: string;
  type: 'shared' | 'user';
  userId?: mongoose.Types.ObjectId;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  username: string;
  passwordEncrypted: string;
  syncEnabled: boolean;
  lastSyncAt?: Date;
  lastUid?: number;
  signature?: string;
  createdAt: Date;
  updatedAt: Date;
}

const mailMailboxSchema = new Schema<IMailMailbox>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true },
    email: { type: String, required: true, lowercase: true },
    type: { type: String, enum: ['shared', 'user'], default: 'shared' },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    imapHost: { type: String, required: true },
    imapPort: { type: Number, default: 993 },
    smtpHost: { type: String, required: true },
    smtpPort: { type: Number, default: 587 },
    username: { type: String, required: true },
    passwordEncrypted: { type: String, required: true },
    syncEnabled: { type: Boolean, default: true },
    lastSyncAt: { type: Date },
    lastUid: { type: Number },
    signature: { type: String },
  },
  { timestamps: true }
);

export const MailMailbox = mongoose.model<IMailMailbox>('MailMailbox', mailMailboxSchema);
