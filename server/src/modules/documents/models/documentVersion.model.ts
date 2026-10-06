import mongoose, { Schema } from 'mongoose';

/** Snapshot of a document before an edit changed its title or content. */
const documentVersionSchema = new Schema(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    documentId: { type: Schema.Types.ObjectId, ref: 'DocumentRecord', required: true, index: true },
    version: { type: Number, required: true },
    title: { type: String },
    summary: { type: String },
    content: { type: String },
    status: { type: String },
    editedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
documentVersionSchema.index({ documentId: 1, version: -1 }, { unique: true });

export const DocumentVersion = mongoose.model('DocumentVersion', documentVersionSchema);

/**
 * Lightweight e-signature: each signer gets a private link, sees the exact
 * content (hashed), types their name and agrees. We record when, from where,
 * and the content hash they signed.
 */
const signerSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    tokenHash: { type: String, required: true },
    signedAt: { type: Date },
    signatureName: { type: String },
    ip: { type: String },
    userAgent: { type: String },
    declinedAt: { type: Date },
    declineReason: { type: String },
  },
  { _id: true }
);

const signatureRequestSchema = new Schema(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    documentId: { type: Schema.Types.ObjectId, ref: 'DocumentRecord', required: true, index: true },
    version: { type: Number, required: true },
    /** SHA-256 of title + content at request time; signing is refused if the document changed. */
    contentHash: { type: String, required: true },
    message: { type: String },
    status: { type: String, enum: ['pending', 'completed', 'declined', 'cancelled'], default: 'pending', index: true },
    signers: { type: [signerSchema], default: [] },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    expiresAt: { type: Date },
    completedAt: { type: Date },
  },
  { timestamps: true }
);
signatureRequestSchema.index({ 'signers.tokenHash': 1 });

export const DocumentSignatureRequest = mongoose.model('DocumentSignatureRequest', signatureRequestSchema);
