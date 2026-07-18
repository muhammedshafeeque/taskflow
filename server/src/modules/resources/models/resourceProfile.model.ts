import mongoose, { Document, Schema } from 'mongoose';

export interface IResourceProfile extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  /** Planned working hours per week (default 40) */
  capacityHoursPerWeek: number;
  skills: string[];
  seniority?: string;
  department?: string;
  location?: string;
  availableFrom?: Date | null;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const resourceProfileSchema = new Schema<IResourceProfile>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    capacityHoursPerWeek: { type: Number, default: 40, min: 1, max: 168 },
    skills: { type: [String], default: [] },
    seniority: { type: String, trim: true },
    department: { type: String, trim: true },
    location: { type: String, trim: true },
    availableFrom: { type: Date, default: null },
    notes: { type: String },
  },
  { timestamps: true }
);

resourceProfileSchema.index({ taskflowOrganizationId: 1, userId: 1 }, { unique: true });

export const ResourceProfile = mongoose.model<IResourceProfile>('ResourceProfile', resourceProfileSchema);
