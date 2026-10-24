import mongoose, { Document, Schema } from 'mongoose';

export interface IDocPage extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  spaceId: mongoose.Types.ObjectId;
  parentId: mongoose.Types.ObjectId | null;
  /** Sort order among siblings. */
  position: number;
  title: string;
  emoji?: string;
  /** Rich-text HTML (same format as issue descriptions). */
  content: string;
  /** Plain text of `content`, used for search and previews. */
  text: string;
  status: 'draft' | 'published';
  /** Only space admins can edit a locked page. */
  locked: boolean;
  /** Pages fill the reading pane; `narrow` limits them to a readable column. */
  narrow: boolean;
  labels: string[];
  /** Issues and projects linked by hand. */
  issueIds: mongoose.Types.ObjectId[];
  projectIds: mongoose.Types.ObjectId[];
  /** Issues whose key appears in the page text (kept in sync on save). */
  mentionedIssueIds: mongoose.Types.ObjectId[];
  version: number;
  starredBy: mongoose.Types.ObjectId[];
  createdBy: mongoose.Types.ObjectId;
  updatedBy: mongoose.Types.ObjectId;
  /** Set when the page is in the space trash. */
  deletedAt?: Date | null;
  deletedBy?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const docPageSchema = new Schema<IDocPage>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    spaceId: { type: Schema.Types.ObjectId, ref: 'DocSpace', required: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'DocPage', default: null },
    position: { type: Number, default: 0 },
    title: { type: String, required: true, trim: true },
    emoji: { type: String, trim: true },
    content: { type: String, default: '' },
    text: { type: String, default: '' },
    status: { type: String, enum: ['draft', 'published'], default: 'published' },
    locked: { type: Boolean, default: false },
    narrow: { type: Boolean, default: false },
    labels: [{ type: String, trim: true, lowercase: true }],
    issueIds: [{ type: Schema.Types.ObjectId, ref: 'Issue' }],
    projectIds: [{ type: Schema.Types.ObjectId, ref: 'Project' }],
    mentionedIssueIds: [{ type: Schema.Types.ObjectId, ref: 'Issue' }],
    version: { type: Number, default: 1 },
    starredBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

docPageSchema.index({ spaceId: 1, parentId: 1, position: 1 });
docPageSchema.index({ taskflowOrganizationId: 1, issueIds: 1 });
docPageSchema.index({ taskflowOrganizationId: 1, mentionedIssueIds: 1 });
docPageSchema.index({ taskflowOrganizationId: 1, projectIds: 1 });
docPageSchema.index({ taskflowOrganizationId: 1, updatedAt: -1 });

export const DocPage = mongoose.model<IDocPage>('DocPage', docPageSchema);
