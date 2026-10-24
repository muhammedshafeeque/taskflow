import mongoose, { Document, Schema } from 'mongoose';

export const DOC_SPACE_ROLES = ['admin', 'editor', 'viewer'] as const;
export type DocSpaceRole = (typeof DOC_SPACE_ROLES)[number];

/**
 * Who can open a space besides its listed members:
 * - workspace: every member of the workspace
 * - project: members of any linked project
 * - restricted: listed members only
 */
export const DOC_SPACE_AUDIENCES = ['workspace', 'project', 'restricted'] as const;
export type DocSpaceAudience = (typeof DOC_SPACE_AUDIENCES)[number];

export interface IDocSpace extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  /** Short uppercase key used in URLs, unique per workspace. */
  key: string;
  name: string;
  description?: string;
  /** Emoji or short text shown as the space icon. */
  icon?: string;
  color?: string;
  projectIds: mongoose.Types.ObjectId[];
  audience: DocSpaceAudience;
  /** Role given to the audience (everyone allowed in by `audience` who is not a listed member). */
  audienceRole: Exclude<DocSpaceRole, 'admin'>;
  members: Array<{ user: mongoose.Types.ObjectId; role: DocSpaceRole }>;
  homePageId?: mongoose.Types.ObjectId | null;
  starredBy: mongoose.Types.ObjectId[];
  archived: boolean;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const docSpaceSchema = new Schema<IDocSpace>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    key: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    icon: { type: String, trim: true },
    color: { type: String, trim: true },
    projectIds: [{ type: Schema.Types.ObjectId, ref: 'Project' }],
    audience: { type: String, enum: DOC_SPACE_AUDIENCES, default: 'workspace' },
    audienceRole: { type: String, enum: ['editor', 'viewer'], default: 'editor' },
    members: [
      {
        _id: false,
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        role: { type: String, enum: DOC_SPACE_ROLES, required: true },
      },
    ],
    homePageId: { type: Schema.Types.ObjectId, ref: 'DocPage', default: null },
    starredBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    archived: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

docSpaceSchema.index({ taskflowOrganizationId: 1, key: 1 }, { unique: true });
docSpaceSchema.index({ taskflowOrganizationId: 1, projectIds: 1 });

export const DocSpace = mongoose.model<IDocSpace>('DocSpace', docSpaceSchema);
