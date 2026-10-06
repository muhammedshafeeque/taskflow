import mongoose, { Schema } from 'mongoose';

/**
 * A salary component, applied to each employee's monthly CTC.
 * `percent_of_ctc` / `percent_of_basic` take `value` as a percentage; `fixed` is an amount.
 * The earning named "Basic" (case-insensitive) is the base for `percent_of_basic`.
 */
export type PayComponent = {
  name: string;
  kind: 'earning' | 'deduction';
  calc: 'fixed' | 'percent_of_ctc' | 'percent_of_basic';
  value: number;
};

export const DEFAULT_COMPONENTS: PayComponent[] = [
  { name: 'Basic', kind: 'earning', calc: 'percent_of_ctc', value: 50 },
  { name: 'HRA', kind: 'earning', calc: 'percent_of_basic', value: 40 },
  { name: 'Special allowance', kind: 'earning', calc: 'percent_of_ctc', value: 30 },
];

const componentSchema = new Schema<PayComponent>(
  {
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: ['earning', 'deduction'], required: true },
    calc: { type: String, enum: ['fixed', 'percent_of_ctc', 'percent_of_basic'], required: true },
    value: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const payrollSettingsSchema = new Schema(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, unique: true },
    components: { type: [componentSchema], default: DEFAULT_COMPONENTS },
    /** Working days used to pro-rate loss of pay (unpaid leave / absences). */
    workingDaysPerMonth: { type: Number, default: 22, min: 1, max: 31 },
  },
  { timestamps: true }
);

export const HrmsPayrollSettings = mongoose.model('HrmsPayrollSettings', payrollSettingsSchema);

const lineSchema = new Schema({ name: String, amount: Number }, { _id: false });

const payslipSchema = new Schema(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: 'HrmsEmployee', required: true },
    name: String,
    employeeCode: String,
    department: String,
    designation: String,
    currency: String,
    monthlyCtc: Number,
    workingDays: Number,
    lopDays: { type: Number, default: 0 },
    earnings: { type: [lineSchema], default: [] },
    deductions: { type: [lineSchema], default: [] },
    /** Manual one-off lines for this month (bonus, reimbursement, advance recovery…). */
    adjustments: { type: [new Schema({ name: String, amount: Number, kind: { type: String, enum: ['earning', 'deduction'] } }, { _id: false })], default: [] },
    gross: Number,
    totalDeductions: Number,
    net: Number,
  },
  { _id: false }
);

const payrollRunSchema = new Schema(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    /** "YYYY-MM" */
    period: { type: String, required: true },
    status: { type: String, enum: ['draft', 'finalized', 'paid'], default: 'draft' },
    payslips: { type: [payslipSchema], default: [] },
    totals: {
      gross: { type: Number, default: 0 },
      deductions: { type: Number, default: 0 },
      net: { type: Number, default: 0 },
      employees: { type: Number, default: 0 },
    },
    finalizedAt: Date,
    finalizedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    paidAt: Date,
  },
  { timestamps: true }
);
payrollRunSchema.index({ taskflowOrganizationId: 1, period: 1 }, { unique: true });

export const HrmsPayrollRun = mongoose.model('HrmsPayrollRun', payrollRunSchema);
