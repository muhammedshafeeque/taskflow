import mongoose, { Schema } from 'mongoose';

/**
 * An MCP client that registered itself (OAuth dynamic client registration), e.g. claude.ai or Claude Code.
 * Public clients only: no secret, PKCE on every authorization.
 */
export interface IMcpOAuthClient {
  clientId: string;
  name: string;
  redirectUris: string[];
  /** Registrations that never get approved are dropped after a while; cleared once a user approves one. */
  expiresAt?: Date;
  createdAt: Date;
}

const clientSchema = new Schema<IMcpOAuthClient>(
  {
    clientId: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    redirectUris: { type: [String], required: true },
    expiresAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
clientSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/** One-time authorization code, valid for a few minutes. Only a hash is stored. */
export interface IMcpOAuthCode {
  codeHash: string;
  clientId: string;
  userId: mongoose.Types.ObjectId;
  organizationId?: mongoose.Types.ObjectId;
  redirectUri: string;
  codeChallenge: string;
  readOnly: boolean;
  expiresInDays: number;
  expiresAt: Date;
  usedAt?: Date;
}

const codeSchema = new Schema<IMcpOAuthCode>({
  codeHash: { type: String, required: true, unique: true },
  clientId: { type: String, required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization' },
  redirectUri: { type: String, required: true },
  codeChallenge: { type: String, required: true },
  readOnly: { type: Boolean, default: false },
  expiresInDays: { type: Number, default: 90 },
  expiresAt: { type: Date, required: true },
  usedAt: { type: Date },
});
codeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const McpOAuthClient = mongoose.model<IMcpOAuthClient>('McpOAuthClient', clientSchema);
export const McpOAuthCode = mongoose.model<IMcpOAuthCode>('McpOAuthCode', codeSchema);
