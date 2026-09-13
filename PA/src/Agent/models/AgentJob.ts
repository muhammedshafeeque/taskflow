import mongoose from 'mongoose';

const logSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    line: { type: String, required: true },
  },
  { _id: false }
);

const agentJobSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['fix_issue', 'follow_up', 'run_command', 'deploy'],
    required: true,
    index: true,
  },
  status: {
    type: String,
    enum: [
      'queued',
      'running',
      'needs_review',
      'approved_deploy',
      'failed',
      'cancelled',
      'done',
    ],
    default: 'queued',
    index: true,
  },
  deviceId: { type: String, required: true, index: true },
  issueKey: { type: String },
  projectId: { type: String },
  projectKey: { type: String },
  instruction: { type: String, default: '' },
  command: { type: String },
  issueContext: { type: mongoose.Schema.Types.Mixed },
  parentJobId: { type: String },
  logs: { type: [logSchema], default: [] },
  summary: { type: String, default: '' },
  diffStat: { type: String, default: '' },
  artifacts: { type: [mongoose.Schema.Types.Mixed], default: [] },
  error: { type: String },
  claimedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

export type AgentJobType = 'fix_issue' | 'follow_up' | 'run_command' | 'deploy';
export type AgentJobStatus =
  | 'queued'
  | 'running'
  | 'needs_review'
  | 'approved_deploy'
  | 'failed'
  | 'cancelled'
  | 'done';

export type AgentJobDoc = {
  _id: mongoose.Types.ObjectId;
  type: AgentJobType;
  status: AgentJobStatus;
  deviceId: string;
  issueKey?: string;
  projectId?: string;
  projectKey?: string;
  instruction?: string;
  command?: string;
  issueContext?: unknown;
  parentJobId?: string;
  logs: Array<{ at: Date; line: string }>;
  summary?: string;
  diffStat?: string;
  artifacts?: unknown[];
  error?: string;
  claimedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
};

export const AgentJob = mongoose.model('AgentJob', agentJobSchema);
