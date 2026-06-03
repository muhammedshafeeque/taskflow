import mongoose, { Document, Schema } from 'mongoose';

export type IssueType = 'Bug' | 'Story' | 'Task' | 'Epic'; // legacy / default
export type IssuePriority = string; // project-configured (e.g. Lowest, Low, Medium, High, Highest)
export type IssueStatus = 'Todo' | 'In Progress' | 'Done' | 'Backlog'; // legacy / default

export interface IChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface IIssue extends Document {
  title: string;
  description: string;
  type: string; // project-specific issue type name
  priority: IssuePriority;
  status: string; // project-specific status name
  assignee?: mongoose.Types.ObjectId;
  reporter: mongoose.Types.ObjectId;
  project: mongoose.Types.ObjectId;
  key?: string;
  sprint?: mongoose.Types.ObjectId;
  boardColumn: string;
  labels: string[];
  dueDate?: Date;
  startDate?: Date;
  baselineStartDate?: Date;
  baselineDueDate?: Date;
  storyPoints?: number;
  timeEstimateMinutes?: number;
  checklist: IChecklistItem[];
  customFieldValues: Record<string, unknown>;
  fixVersion?: string[];     // project version ids targeted for fix
  affectsVersions?: string[]; // project version ids this issue affects
  parent?: mongoose.Types.ObjectId; // parent issue (Epic/Story only)
  milestone?: mongoose.Types.ObjectId; // milestone
  backlogOrder?: number; // lower = higher in backlog (sprint=null only)
  createdAt: Date;
  updatedAt: Date;
}

const issueSchema = new Schema<IIssue>(
  {
    title: { type: String, required: true },
    description: { type: String, default: '' },
    type: { type: String, default: 'Task' },
    priority: { type: String, default: 'Medium' },
    status: { type: String, default: 'Backlog' },
    assignee: { type: Schema.Types.ObjectId, ref: 'User' },
    reporter: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    key: { type: String },
    sprint: { type: Schema.Types.ObjectId, ref: 'Sprint' },
    boardColumn: { type: String, default: 'Backlog' },
    labels: { type: [String], default: [] },
    dueDate: { type: Date },
    startDate: { type: Date },
    baselineStartDate: { type: Date },
    baselineDueDate: { type: Date },
    storyPoints: { type: Number },
    timeEstimateMinutes: { type: Number },
    checklist: {
      type: [{
        id: String,
        text: String,
        done: { type: Boolean, default: false },
      }],
      default: [],
    },
    customFieldValues: { type: Schema.Types.Mixed, default: {} },
    fixVersion: { type: [String], default: undefined },
    affectsVersions: { type: [String], default: undefined },
    parent: { type: Schema.Types.ObjectId, ref: 'Issue' },
    milestone: { type: Schema.Types.ObjectId, ref: 'Milestone' },
    backlogOrder: { type: Number },
  },
  { timestamps: true }
);

issueSchema.index({ project: 1, status: 1 });
issueSchema.index({ project: 1, assignee: 1 });
issueSchema.index({ project: 1, sprint: 1 });
issueSchema.index({ project: 1, type: 1 });
issueSchema.index({ project: 1, priority: 1 });
issueSchema.index({ parent: 1 });
issueSchema.index({ project: 1, sprint: 1, backlogOrder: 1 });
issueSchema.index({ key: 1 }, { unique: true, sparse: true });

export const Issue = mongoose.model<IIssue>('Issue', issueSchema);
