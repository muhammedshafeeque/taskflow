import mongoose, { Schema, Document } from 'mongoose';

export type IssueHistoryAction = 'created' | 'field_change' | 'comment_added' | 'comment_updated';

export type IssueHistorySource = 'taskflow' | 'ado';

export interface IIssueHistory extends Document {
  issue: mongoose.Types.ObjectId;
  author: mongoose.Types.ObjectId;
  action: IssueHistoryAction;
  field?: string;
  fromValue?: unknown;
  toValue?: unknown;
  commentId?: mongoose.Types.ObjectId;
  source?: IssueHistorySource;
  externalKey?: string;
  adoRev?: number;
  /** When the activity occurred (ADO revised date). Used for performance reporting. */
  activityAt?: Date;
  createdAt: Date;
}

const issueHistorySchema = new Schema<IIssueHistory>(
  {
    issue: { type: Schema.Types.ObjectId, ref: 'Issue', required: true },
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, enum: ['created', 'field_change', 'comment_added', 'comment_updated'], required: true },
    field: { type: String },
    fromValue: { type: Schema.Types.Mixed },
    toValue: { type: Schema.Types.Mixed },
    commentId: { type: Schema.Types.ObjectId, ref: 'Comment' },
    source: { type: String, enum: ['taskflow', 'ado'], default: 'taskflow' },
    externalKey: { type: String },
    adoRev: { type: Number },
    activityAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

issueHistorySchema.index({ issue: 1, createdAt: -1 });
issueHistorySchema.index({ author: 1, createdAt: -1 });
issueHistorySchema.index({ author: 1, activityAt: -1 });
issueHistorySchema.index({ externalKey: 1 }, { unique: true, sparse: true });

export const IssueHistory = mongoose.model<IIssueHistory>('IssueHistory', issueHistorySchema);
