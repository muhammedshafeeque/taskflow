import mongoose, { Schema } from 'mongoose';

const orgRef = { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true } as const;

/** Company-defined leave type (Casual, Sick, Earned, Unpaid, …). */
const leaveTypeSchema = new Schema(
  {
    taskflowOrganizationId: orgRef,
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, lowercase: true },
    /** Unpaid types count as loss of pay in payroll and have no balance. */
    paid: { type: Boolean, default: true },
    /** Days granted per leave year. */
    annualAllowance: { type: Number, default: 12, min: 0 },
    /** 'yearly' = full allowance on day one; 'monthly' = allowance/12 earned each month. */
    accrual: { type: String, enum: ['yearly', 'monthly'], default: 'yearly' },
    /** Unused days that roll into next year (0 = none). */
    carryForwardMax: { type: Number, default: 0, min: 0 },
    /** Allow going below zero (borrowing against future accrual). */
    allowNegative: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    color: { type: String },
  },
  { timestamps: true }
);
leaveTypeSchema.index({ taskflowOrganizationId: 1, code: 1 }, { unique: true });
export const HrmsLeaveType = mongoose.model('HrmsLeaveType', leaveTypeSchema);

/** Days taken per employee, leave type and leave year. Allocation is computed from the type. */
const leaveLedgerSchema = new Schema(
  {
    taskflowOrganizationId: orgRef,
    employeeId: { type: Schema.Types.ObjectId, ref: 'HrmsEmployee', required: true, index: true },
    leaveTypeId: { type: Schema.Types.ObjectId, ref: 'HrmsLeaveType', required: true },
    year: { type: Number, required: true },
    used: { type: Number, default: 0 },
    /** Manual +/- corrections by HR. */
    adjustment: { type: Number, default: 0 },
    carriedForward: { type: Number, default: 0 },
  },
  { timestamps: true }
);
leaveLedgerSchema.index({ employeeId: 1, leaveTypeId: 1, year: 1 }, { unique: true });
export const HrmsLeaveLedger = mongoose.model('HrmsLeaveLedger', leaveLedgerSchema);

/** Public / company holidays; `location` empty = applies everywhere. */
const holidaySchema = new Schema(
  {
    taskflowOrganizationId: orgRef,
    date: { type: Date, required: true },
    name: { type: String, required: true, trim: true },
    optional: { type: Boolean, default: false },
    location: { type: String, trim: true },
  },
  { timestamps: true }
);
holidaySchema.index({ taskflowOrganizationId: 1, date: 1 });
export const HrmsHoliday = mongoose.model('HrmsHoliday', holidaySchema);

/** Per-workspace HR settings (weekends, leave year start, recruitment stages). */
const hrSettingsSchema = new Schema(
  {
    taskflowOrganizationId: { ...orgRef, unique: true },
    /** 0 = Sunday … 6 = Saturday */
    weekendDays: { type: [Number], default: [0, 6] },
    /** Month (1–12) the leave year starts. */
    leaveYearStartMonth: { type: Number, default: 1, min: 1, max: 12 },
    recruitmentStages: {
      type: [String],
      default: ['Applied', 'Screening', 'Interview', 'Offer', 'Hired'],
    },
    /** Weekday (0–6) to remind people with incomplete timesheets; null = off. */
    timesheetReminderWeekday: { type: Number, default: null, min: 0, max: 6 },
    expectedWeeklyHours: { type: Number, default: 40, min: 1, max: 80 },
    /** Used to turn annual CTC into an hourly cost rate. */
    standardHoursPerDay: { type: Number, default: 8, min: 1, max: 24 },
    workingDaysPerYear: { type: Number, default: 260, min: 100, max: 366 },
    /** Who approves leave when the employee has no manager with an account. */
    leaveApproverUserIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
  },
  { timestamps: true }
);
export const HrmsSettings = mongoose.model('HrmsSettings', hrSettingsSchema);
