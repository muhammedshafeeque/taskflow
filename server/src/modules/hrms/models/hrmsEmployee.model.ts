import mongoose, { Document, Schema } from 'mongoose';

export type EmploymentStatus = 'active' | 'on_leave' | 'terminated' | 'probation';
export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'intern';

export interface IHrmsEmployee extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  userId?: mongoose.Types.ObjectId;
  employeeCode: string;
  name: string;
  email?: string;
  phone?: string;
  department?: string;
  designation?: string;
  managerId?: mongoose.Types.ObjectId;
  employmentType: EmploymentType;
  status: EmploymentStatus;
  joinedDate: Date;
  exitDate?: Date;
  location?: string;
  annualCtc?: number;
  currency: string;
  leaveBalanceDays: number;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const hrmsEmployeeSchema = new Schema<IHrmsEmployee>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    employeeCode: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String },
    department: { type: String, index: true },
    designation: { type: String },
    managerId: { type: Schema.Types.ObjectId, ref: 'HrmsEmployee' },
    employmentType: { type: String, enum: ['full_time', 'part_time', 'contract', 'intern'], default: 'full_time' },
    status: { type: String, enum: ['active', 'on_leave', 'terminated', 'probation'], default: 'active', index: true },
    joinedDate: { type: Date, required: true },
    exitDate: { type: Date },
    location: { type: String },
    annualCtc: { type: Number, default: 0 },
    currency: { type: String, default: 'USD' },
    leaveBalanceDays: { type: Number, default: 20 },
    notes: { type: String },
  },
  { timestamps: true }
);

hrmsEmployeeSchema.index({ taskflowOrganizationId: 1, employeeCode: 1 }, { unique: true });

export const HrmsEmployee = mongoose.model<IHrmsEmployee>('HrmsEmployee', hrmsEmployeeSchema);
