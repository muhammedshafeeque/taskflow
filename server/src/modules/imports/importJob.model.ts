import mongoose from 'mongoose';

export type ImportSource = 'ado' | 'csv' | 'jira';
export type ImportJobStatus = 'pending' | 'running' | 'completed' | 'failed';

const importJobSchema = new mongoose.Schema(
  {
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    source: { type: String, enum: ['ado', 'csv', 'jira'], required: true },
    status: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed'],
      default: 'pending',
    },
    dryRun: { type: Boolean, default: false },
    options: { type: mongoose.Schema.Types.Mixed },
    progress: { type: String },
    logs: { type: [String], default: [] },
    result: { type: mongoose.Schema.Types.Mixed },
    error: { type: String },
  },
  { timestamps: true }
);

export const ImportJob = mongoose.model('ImportJob', importJobSchema);
