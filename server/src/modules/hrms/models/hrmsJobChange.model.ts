import mongoose, { Document, Schema } from 'mongoose';

export const JOB_CHANGE_KINDS = ['promotion', 'transfer', 'conversion', 'salary', 'change'] as const;
export const JOB_CHANGE_STATUSES = ['pending', 'scheduled', 'applied', 'rejected', 'cancelled', 'failed'] as const;
/** What a job change may set on the employee. */
export const JOB_FIELDS = ['designation', 'department', 'level', 'employmentType', 'managerId', 'annualCtc', 'currency'] as const;
export type JobField = (typeof JOB_FIELDS)[number];
export type JobState = Partial<Record<JobField, unknown>> & { roleId?: string | null; seniority?: string | null };

/**
 * One promotion, transfer, intern conversion or pay change: what it changes, when, who asked and who approved.
 * Applied ones are the employee's job and salary history (`from` → `to`).
 */
export interface IHrmsJobChange extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  employeeId: mongoose.Types.ObjectId;
  kind: (typeof JOB_CHANGE_KINDS)[number];
  /** Only the fields that change. `roleId` is the person's platform role. */
  to: JobState;
  /** The same fields as they were, recorded when applied. */
  from?: JobState;
  /** Move the person's project designations to what their new job suggests. */
  updateProjectDesignations: boolean;
  projectChanges: Array<{ projectId: mongoose.Types.ObjectId; projectName?: string; from?: string; to: string }>;
  /** Calendar day (UTC midnight) it takes effect. */
  effectiveDate: Date;
  status: (typeof JOB_CHANGE_STATUSES)[number];
  reason?: string;
  requestedBy: mongoose.Types.ObjectId;
  decidedBy?: mongoose.Types.ObjectId;
  decidedAt?: Date;
  decisionNote?: string;
  appliedAt?: Date;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IHrmsJobChange>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'HrmsEmployee', required: true, index: true },
    kind: { type: String, enum: JOB_CHANGE_KINDS, default: 'change' },
    to: { type: Schema.Types.Mixed, default: {} },
    from: { type: Schema.Types.Mixed },
    updateProjectDesignations: { type: Boolean, default: true },
    projectChanges: {
      type: [{ projectId: { type: Schema.Types.ObjectId, ref: 'Project' }, projectName: String, from: String, to: String, _id: false }],
      default: [],
    },
    effectiveDate: { type: Date, required: true },
    status: { type: String, enum: JOB_CHANGE_STATUSES, default: 'pending', index: true },
    reason: { type: String },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: { type: Date },
    decisionNote: { type: String },
    appliedAt: { type: Date },
    error: { type: String },
  },
  { timestamps: true, minimize: false }
);
schema.index({ status: 1, effectiveDate: 1 });

export const HrmsJobChange = mongoose.model<IHrmsJobChange>('HrmsJobChange', schema);
