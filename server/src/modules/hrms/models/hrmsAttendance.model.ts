import mongoose, { Document, Schema } from 'mongoose';

export type AttendanceStatus = 'present' | 'remote' | 'absent' | 'half_day' | 'holiday';

export interface IHrmsAttendance extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  employeeId: mongoose.Types.ObjectId;
  date: Date;
  status: AttendanceStatus;
  hoursWorked: number;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const hrmsAttendanceSchema = new Schema<IHrmsAttendance>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'HrmsEmployee', required: true, index: true },
    date: { type: Date, required: true },
    status: { type: String, enum: ['present', 'remote', 'absent', 'half_day', 'holiday'], default: 'present' },
    hoursWorked: { type: Number, default: 8 },
    note: { type: String },
  },
  { timestamps: true }
);

hrmsAttendanceSchema.index({ taskflowOrganizationId: 1, employeeId: 1, date: 1 }, { unique: true });

export const HrmsAttendance = mongoose.model<IHrmsAttendance>('HrmsAttendance', hrmsAttendanceSchema);
