import mongoose, { Document, Schema } from 'mongoose';

/** Who performed the action: a person, an AI agent (the WhatsApp PA), or the platform itself. */
export type AuditActorType = 'user' | 'ai' | 'system';

export interface IAuditLog extends Document {
  /** Human user, or the service account an AI/system actor runs as. Optional for pure system events. */
  user?: mongoose.Types.ObjectId;
  actorType: AuditActorType;
  /** Display name for non-human actors, e.g. "WhatsApp PA". */
  actorLabel?: string;
  /** Human the AI acted for (owner in the PA apps / on their own WhatsApp number). */
  onBehalfOf?: mongoose.Types.ObjectId;
  action: string;
  resourceType: string;
  resourceId?: string;
  projectId?: mongoose.Types.ObjectId;
  meta?: Record<string, unknown>;
  ip?: string;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    actorType: { type: String, enum: ['user', 'ai', 'system'], default: 'user', index: true },
    actorLabel: { type: String },
    onBehalfOf: { type: Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true },
    resourceType: { type: String, required: true },
    resourceId: { type: String },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    meta: { type: Schema.Types.Mixed },
    ip: { type: String },
  },
  { timestamps: true }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ user: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ resourceType: 1, createdAt: -1 });
auditLogSchema.index({ projectId: 1, createdAt: -1 });

export const AuditLog = mongoose.model<IAuditLog>('AuditLog', auditLogSchema);
