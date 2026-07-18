import mongoose, { Document, Schema } from 'mongoose';

export type LeaveType = 'annual' | 'sick' | 'casual' | 'unpaid' | 'comp_off';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface IHrmsLeaveRequest extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  employeeId: mongoose.Types.ObjectId;
  type: LeaveType;
  status: LeaveStatus;
  startDate: Date;
  endDate: Date;
  days: number;
  reason?: string;
  decidedBy?: mongoose.Types.ObjectId;
  decidedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const hrmsLeaveRequestSchema = new Schema<IHrmsLeaveRequest>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'HrmsEmployee', required: true, index: true },
    type: { type: String, enum: ['annual', 'sick', 'casual', 'unpaid', 'comp_off'], default: 'annual' },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending', index: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    days: { type: Number, required: true, min: 0.5 },
    reason: { type: String },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: { type: Date },
  },
  { timestamps: true }
);

export const HrmsLeaveRequest = mongoose.model<IHrmsLeaveRequest>('HrmsLeaveRequest', hrmsLeaveRequestSchema);
