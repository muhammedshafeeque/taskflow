import crypto from 'crypto';
import mongoose from 'mongoose';

const workspaceSchema = new mongoose.Schema(
  {
    projectKey: { type: String, required: true },
    projectId: { type: String },
    localPath: { type: String, required: true },
  },
  { _id: false }
);

const agentDeviceSchema = new mongoose.Schema({
  deviceId: { type: String, unique: true, required: true, index: true },
  name: { type: String, default: 'PC' },
  userLabel: { type: String, default: '' },
  deviceTokenHash: { type: String, required: true },
  pairingCodeHash: { type: String },
  pairingExpiresAt: { type: Date },
  lastSeenAt: { type: Date },
  online: { type: Boolean, default: false, index: true },
  workspaces: { type: [workspaceSchema], default: [] },
  allowCommands: { type: [String], default: [] },
  aiProviders: {
    type: [String],
    default: ['claude', 'gemini'],
  },
  revokedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
});

export type AgentWorkspace = {
  projectKey: string;
  projectId?: string;
  localPath: string;
};

export type AgentDeviceDoc = {
  _id: mongoose.Types.ObjectId;
  deviceId: string;
  name: string;
  userLabel?: string;
  deviceTokenHash: string;
  pairingCodeHash?: string;
  pairingExpiresAt?: Date;
  lastSeenAt?: Date;
  online?: boolean;
  workspaces: AgentWorkspace[];
  allowCommands: string[];
  aiProviders: string[];
  revokedAt?: Date;
  createdAt?: Date;
};

export const AgentDevice = mongoose.model('AgentDevice', agentDeviceSchema);

export function hashSecret(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function generatePairingCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

export function generateDeviceToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generateDeviceId(): string {
  return `dev_${crypto.randomBytes(8).toString('hex')}`;
}
