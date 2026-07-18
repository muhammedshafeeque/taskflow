import mongoose, { Document, Schema } from 'mongoose';

export type CalendarEventKind = 'meeting' | 'demo' | 'review' | 'standup' | 'other';

export interface ICalendarEvent extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  title: string;
  kind: CalendarEventKind;
  start: Date;
  end?: Date;
  allDay: boolean;
  location?: string;
  meetingUrl?: string;
  accountId?: mongoose.Types.ObjectId;
  dealId?: mongoose.Types.ObjectId;
  projectId?: mongoose.Types.ObjectId;
  attendeeIds: mongoose.Types.ObjectId[];
  ownerId?: mongoose.Types.ObjectId;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const calendarEventSchema = new Schema<ICalendarEvent>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    title: { type: String, required: true, trim: true },
    kind: { type: String, enum: ['meeting', 'demo', 'review', 'standup', 'other'], default: 'meeting', index: true },
    start: { type: Date, required: true, index: true },
    end: { type: Date },
    allDay: { type: Boolean, default: false },
    location: { type: String },
    meetingUrl: { type: String },
    accountId: { type: Schema.Types.ObjectId, ref: 'CrmAccount' },
    dealId: { type: Schema.Types.ObjectId, ref: 'CrmDeal' },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    attendeeIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String },
  },
  { timestamps: true }
);

export const CalendarEvent = mongoose.model<ICalendarEvent>('CalendarEvent', calendarEventSchema);
