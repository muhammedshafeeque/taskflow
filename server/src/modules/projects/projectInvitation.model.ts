import mongoose, { Document, Schema } from 'mongoose';

export type ProjectInvitationStatus = 'pending' | 'accepted' | 'declined';

export interface IProjectInvitation extends Document {
  project: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  invitedBy: mongoose.Types.ObjectId;
  role: mongoose.Types.ObjectId;
  /** Project designation the member gets on accept (its permissions are snapshotted then). */
  designationId?: mongoose.Types.ObjectId | null;
  status: ProjectInvitationStatus;
  createdAt: Date;
  updatedAt: Date;
}

const projectInvitationSchema = new Schema<IProjectInvitation>(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: Schema.Types.ObjectId, ref: 'Role', required: true },
    designationId: { type: Schema.Types.ObjectId, ref: 'ProjectDesignation', default: null },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'declined'],
      default: 'pending',
    },
  },
  { timestamps: true }
);

projectInvitationSchema.index({ project: 1, user: 1 }, { unique: true });
projectInvitationSchema.index({ project: 1, status: 1 });

export const ProjectInvitation = mongoose.model<IProjectInvitation>(
  'ProjectInvitation',
  projectInvitationSchema
);
