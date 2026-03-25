import mongoose, { Document, Schema } from 'mongoose';

export type ReportType =
  | 'issues_by_status'
  | 'issues_by_type'
  | 'issues_by_priority'
  | 'issues_by_assignee'
  | 'workload'
  | 'defects';

export interface IReportConfig {
  filters?: Record<string, unknown>;
  groupBy?: string;
  chartType?: 'bar' | 'pie' | 'table';
}

export interface IReport extends Document {
  user: mongoose.Types.ObjectId;
  project?: mongoose.Types.ObjectId;
  name: string;
  type: ReportType;
  config: IReportConfig;
  createdAt: Date;
  updatedAt: Date;
}

const reportSchema = new Schema<IReport>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    project: { type: Schema.Types.ObjectId, ref: 'Project' },
    name: { type: String, required: true },
    type: {
      type: String,
      enum: [
        'issues_by_status',
        'issues_by_type',
        'issues_by_priority',
        'issues_by_assignee',
        'workload',
        'defects',
      ],
      required: true,
    },
    config: {
      filters: { type: Schema.Types.Mixed },
      groupBy: { type: String },
      chartType: { type: String, enum: ['bar', 'pie', 'table'], default: 'bar' },
    },
  },
  { timestamps: true }
);

reportSchema.index({ user: 1 });
reportSchema.index({ user: 1, project: 1 });

export const Report = mongoose.model<IReport>('Report', reportSchema);
