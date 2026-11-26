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
    // Empty for command-line tools that sign in with a device code.
    redirectUris: { type: [String], default: [] },
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

/**
 * Device sign-in (RFC 8628) for command-line tools that cannot open a browser: the tool shows a short code,
 * the user approves it in Atrium on any device, and the tool, polling, receives a personal API token.
 * Only a hash of the device code is stored; the user code is short and lives for minutes.
 */
export interface IMcpDeviceCode {
  deviceCodeHash: string;
  /** e.g. "BCDF-GHJK", stored without the dash. */
  userCode: string;
  clientId: string;
  status: 'pending' | 'approved' | 'denied';
  userId?: mongoose.Types.ObjectId;
  organizationId?: mongoose.Types.ObjectId;
  readOnly: boolean;
  expiresInDays: number;
  /** Seconds the tool must wait between polls; raised when it polls too fast. */
  interval: number;
  lastPolledAt?: Date;
  issuedAt?: Date;
  expiresAt: Date;
}

const deviceSchema = new Schema<IMcpDeviceCode>({
  deviceCodeHash: { type: String, required: true, unique: true },
  userCode: { type: String, required: true, unique: true },
  clientId: { type: String, required: true },
  status: { type: String, enum: ['pending', 'approved', 'denied'], default: 'pending' },
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization' },
  readOnly: { type: Boolean, default: false },
  expiresInDays: { type: Number, default: 90 },
  interval: { type: Number, default: 5 },
  lastPolledAt: { type: Date },
  issuedAt: { type: Date },
  expiresAt: { type: Date, required: true },
});
deviceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const McpDeviceCode = mongoose.model<IMcpDeviceCode>('McpDeviceCode', deviceSchema);
export const McpOAuthClient = mongoose.model<IMcpOAuthClient>('McpOAuthClient', clientSchema);
export const McpOAuthCode = mongoose.model<IMcpOAuthCode>('McpOAuthCode', codeSchema);
