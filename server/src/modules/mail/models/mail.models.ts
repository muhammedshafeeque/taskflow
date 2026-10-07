import mongoose, { Schema } from 'mongoose';

/**
 * A user's own mailbox connected over IMAP (read) + SMTP (send). Any provider
 * that speaks IMAP/SMTP works (Google Workspace / Microsoft 365 with app
 * passwords, Zoho, cPanel hosts …). Credentials are stored encrypted.
 */
const serverSchema = new Schema(
  {
    host: { type: String, trim: true, required: true },
    port: { type: Number, required: true },
    secure: { type: Boolean, default: true },
    user: { type: String, trim: true },
  },
  { _id: false }
);

const mailAccountSchema = new Schema(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    label: { type: String, trim: true },
    emailAddress: { type: String, required: true, lowercase: true, trim: true },
    displayName: { type: String, trim: true },
    imap: { type: serverSchema, required: true },
    smtp: { type: serverSchema, required: true },
    /** encryptSecret(JSON.stringify({ imap, smtp })) */
    credentials: { type: String, required: true, select: false },
    /** Folders to sync (inbound + sent). */
    folders: { type: [String], default: ['INBOX', 'Sent'] },
    /** Only keep messages that match a CRM contact / lead (keeps personal mail out). */
    crmOnly: { type: Boolean, default: true },
    /** Let teammates with mail read permission see the synced CRM emails. */
    shareWithTeam: { type: Boolean, default: true },
    /** Addresses/domains never logged (e.g. your own company domain). */
    ignore: { type: [String], default: [] },
    syncEnabled: { type: Boolean, default: true },
    /** Only sync mail newer than this on first run. */
    syncSince: { type: Date },
    cursors: { type: Schema.Types.Mixed, default: {} }, // folder -> { uidValidity, lastUid }
    signature: { type: String },
    lastSyncAt: { type: Date },
    lastError: { type: String },
  },
  { timestamps: true, minimize: false }
);
mailAccountSchema.index({ taskflowOrganizationId: 1, userId: 1, emailAddress: 1 }, { unique: true });
export const MailAccount = mongoose.model('MailAccount', mailAccountSchema);

const addrSchema = new Schema({ email: { type: String, lowercase: true, trim: true }, name: String }, { _id: false });

const mailMessageSchema = new Schema(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    mailAccountId: { type: Schema.Types.ObjectId, ref: 'MailAccount', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    direction: { type: String, enum: ['inbound', 'outbound'], required: true },
    folder: { type: String },
    uid: { type: Number },
    messageId: { type: String, required: true },
    inReplyTo: { type: String },
    references: { type: [String], default: [] },
    from: { type: addrSchema },
    to: { type: [addrSchema], default: [] },
    cc: { type: [addrSchema], default: [] },
    subject: { type: String, default: '' },
    text: { type: String, default: '' },
    snippet: { type: String, default: '' },
    date: { type: Date, required: true, index: true },
    links: {
      type: [{ _id: false, type: { type: String, enum: ['contact', 'lead', 'deal', 'account'] }, id: Schema.Types.ObjectId }],
      default: [],
    },
  },
  { timestamps: true }
);
mailMessageSchema.index({ mailAccountId: 1, messageId: 1 }, { unique: true });
mailMessageSchema.index({ taskflowOrganizationId: 1, 'links.type': 1, 'links.id': 1, date: -1 });
export const MailMessage = mongoose.model('MailMessage', mailMessageSchema);
