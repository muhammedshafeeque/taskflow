import mongoose, { Document, Schema } from 'mongoose';

export interface IProjectAdoIntegration extends Document {
  projectId: mongoose.Types.ObjectId;
  enabled: boolean;
  org: string;
  adoProject: string;
  patEncrypted: string;
  webhookSecret: string;
  statusMap: Record<string, string>;
  typeMap: Record<string, string>;
  defaultWorkItemType: string;
  lastSyncedAt?: Date;
  lastWebhookAt?: Date;
  lastAutoSyncAt?: Date;
  autoSyncEnabled: boolean;
  autoSyncIntervalMinutes: number;
  syncComments: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const projectAdoIntegrationSchema = new Schema<IProjectAdoIntegration>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, unique: true, index: true },
    enabled: { type: Boolean, default: false },
    org: { type: String, default: '' },
    adoProject: { type: String, default: '' },
    patEncrypted: { type: String, default: '' },
    webhookSecret: { type: String, required: true },
    statusMap: { type: Schema.Types.Mixed, default: {} },
    typeMap: { type: Schema.Types.Mixed, default: {} },
    defaultWorkItemType: { type: String, default: 'Task' },
    lastSyncedAt: { type: Date },
    lastWebhookAt: { type: Date },
    lastAutoSyncAt: { type: Date },
    autoSyncEnabled: { type: Boolean, default: false },
    autoSyncIntervalMinutes: { type: Number, default: 15, min: 5 },
    syncComments: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const ProjectAdoIntegration = mongoose.model<IProjectAdoIntegration>(
  'ProjectAdoIntegration',
  projectAdoIntegrationSchema
);
