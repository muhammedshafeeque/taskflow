import mongoose, { Document, Schema } from 'mongoose';

/**
 * An internal team: a named group of workspace members that works on a set of projects.
 * A person can be in many teams, a team can handle many projects, and a project can be shared by many teams.
 */
export interface IResourceTeam extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  /** Any CSS colour; used for the team chip. */
  color?: string;
  leadId?: mongoose.Types.ObjectId | null;
  memberIds: mongoose.Types.ObjectId[];
  projectIds: mongoose.Types.ObjectId[];
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const resourceTeamSchema = new Schema<IResourceTeam>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    color: { type: String, trim: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    memberIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    projectIds: [{ type: Schema.Types.ObjectId, ref: 'Project' }],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

resourceTeamSchema.index({ taskflowOrganizationId: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
resourceTeamSchema.index({ taskflowOrganizationId: 1, memberIds: 1 });
resourceTeamSchema.index({ taskflowOrganizationId: 1, projectIds: 1 });

export const ResourceTeam = mongoose.model<IResourceTeam>('ResourceTeam', resourceTeamSchema);
