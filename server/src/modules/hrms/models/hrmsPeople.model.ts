import mongoose, { Schema } from 'mongoose';

const orgRef = { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true } as const;

// ── Onboarding / offboarding ─────────────────────────────────────────────

/**
 * Reusable checklist. `assignTo` decides who owns each task when it's applied:
 * 'employee' (the person themselves), 'manager', 'hr' (the person who started it),
 * or a specific user id.
 */
const templateTaskSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String },
    assignTo: { type: String, default: 'hr' },
    dueOffsetDays: { type: Number, default: 0 },
  },
  { _id: false }
);

const checklistTemplateSchema = new Schema(
  {
    taskflowOrganizationId: orgRef,
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: ['onboarding', 'offboarding'], required: true },
    tasks: { type: [templateTaskSchema], default: [] },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);
export const HrmsChecklistTemplate = mongoose.model('HrmsChecklistTemplate', checklistTemplateSchema);

const checklistTaskSchema = new Schema({
  title: { type: String, required: true },
  description: { type: String },
  assigneeId: { type: Schema.Types.ObjectId, ref: 'User' },
  dueDate: { type: Date },
  done: { type: Boolean, default: false },
  doneAt: { type: Date },
  doneBy: { type: Schema.Types.ObjectId, ref: 'User' },
});

const checklistSchema = new Schema(
  {
    taskflowOrganizationId: orgRef,
    employeeId: { type: Schema.Types.ObjectId, ref: 'HrmsEmployee', required: true, index: true },
    templateId: { type: Schema.Types.ObjectId, ref: 'HrmsChecklistTemplate' },
    kind: { type: String, enum: ['onboarding', 'offboarding'], required: true },
    name: { type: String, required: true },
    startDate: { type: Date, required: true },
    tasks: { type: [checklistTaskSchema], default: [] },
    status: { type: String, enum: ['open', 'completed', 'cancelled'], default: 'open', index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
export const HrmsChecklist = mongoose.model('HrmsChecklist', checklistSchema);

// ── Recruitment ──────────────────────────────────────────────────────────

const jobOpeningSchema = new Schema(
  {
    taskflowOrganizationId: orgRef,
    title: { type: String, required: true, trim: true },
    department: { type: String, trim: true },
    location: { type: String, trim: true },
    employmentType: { type: String, default: 'full_time' },
    description: { type: String },
    openings: { type: Number, default: 1, min: 1 },
    status: { type: String, enum: ['draft', 'open', 'on_hold', 'closed'], default: 'open', index: true },
    hiringManagerId: { type: Schema.Types.ObjectId, ref: 'User' },
    /** Stage names for this opening; defaults come from HR settings. */
    stages: { type: [String], default: [] },
    salaryMin: { type: Number },
    salaryMax: { type: Number },
    currency: { type: String },
  },
  { timestamps: true }
);
export const HrmsJobOpening = mongoose.model('HrmsJobOpening', jobOpeningSchema);

const interviewSchema = new Schema({
  at: { type: Date, required: true },
  mode: { type: String, default: 'video' },
  interviewerIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
  rating: { type: Number, min: 1, max: 5 },
  feedback: { type: String },
  recommendation: { type: String, enum: ['strong_yes', 'yes', 'no', 'strong_no'] },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
});

const candidateSchema = new Schema(
  {
    taskflowOrganizationId: orgRef,
    jobId: { type: Schema.Types.ObjectId, ref: 'HrmsJobOpening', required: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    source: { type: String, trim: true },
    resumeUrl: { type: String },
    stage: { type: String, required: true },
    status: { type: String, enum: ['active', 'hired', 'rejected', 'withdrawn'], default: 'active', index: true },
    notes: { type: String },
    interviews: { type: [interviewSchema], default: [] },
    expectedSalary: { type: Number },
    hiredEmployeeId: { type: Schema.Types.ObjectId, ref: 'HrmsEmployee' },
    rejectionReason: { type: String },
  },
  { timestamps: true }
);
export const HrmsCandidate = mongoose.model('HrmsCandidate', candidateSchema);

// ── Appraisals ───────────────────────────────────────────────────────────

const reviewCycleSchema = new Schema(
  {
    taskflowOrganizationId: orgRef,
    name: { type: String, required: true, trim: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    status: { type: String, enum: ['draft', 'active', 'closed'], default: 'draft', index: true },
    ratingScale: { type: Number, default: 5, min: 3, max: 10 },
    /** Free-text questions both sides answer (company-defined). */
    questions: { type: [String], default: [] },
    selfReview: { type: Boolean, default: true },
  },
  { timestamps: true }
);
export const HrmsReviewCycle = mongoose.model('HrmsReviewCycle', reviewCycleSchema);

const goalSchema = new Schema({
  title: { type: String, required: true },
  weight: { type: Number, default: 1, min: 0 },
  selfScore: { type: Number },
  managerScore: { type: Number },
  comment: { type: String },
});

const reviewSchema = new Schema(
  {
    taskflowOrganizationId: orgRef,
    cycleId: { type: Schema.Types.ObjectId, ref: 'HrmsReviewCycle', required: true, index: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'HrmsEmployee', required: true, index: true },
    employeeUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewerId: { type: Schema.Types.ObjectId, ref: 'User' },
    goals: { type: [goalSchema], default: [] },
    selfAnswers: { type: [String], default: [] },
    managerAnswers: { type: [String], default: [] },
    finalRating: { type: Number },
    status: { type: String, enum: ['pending_self', 'pending_manager', 'completed'], default: 'pending_self', index: true },
    completedAt: { type: Date },
  },
  { timestamps: true }
);
reviewSchema.index({ cycleId: 1, employeeId: 1 }, { unique: true });
export const HrmsReview = mongoose.model('HrmsReview', reviewSchema);
