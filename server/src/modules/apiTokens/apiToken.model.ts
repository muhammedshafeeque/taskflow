import mongoose, { Schema } from 'mongoose';

/** Personal access token. Only a SHA-256 hash is stored; the secret is shown once at creation. */
export interface IApiToken {
  userId: mongoose.Types.ObjectId;
  organizationId?: mongoose.Types.ObjectId;
  name: string;
  tokenHash: string;
  /** First characters of the token, shown in the UI to tell tokens apart. */
  prefix: string;
  /** Read-only tokens can only make GET requests (and use read tools over MCP). */
  readOnly?: boolean;
  /** Set when an MCP client got this token through OAuth sign-in rather than the user creating it. */
  oauthClientId?: string;
  expiresAt?: Date;
  lastUsedAt?: Date;
  revokedAt?: Date;
  createdAt: Date;
}

const apiTokenSchema = new Schema<IApiToken>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization' },
    name: { type: String, required: true, trim: true },
    tokenHash: { type: String, required: true, unique: true },
    prefix: { type: String, required: true },
    readOnly: { type: Boolean, default: false },
    oauthClientId: { type: String },
    expiresAt: { type: Date },
    lastUsedAt: { type: Date },
    revokedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const ApiToken = mongoose.model<IApiToken>('ApiToken', apiTokenSchema);
