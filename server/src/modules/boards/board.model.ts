import mongoose, { Document, Schema } from 'mongoose';

export type BoardType = 'Kanban' | 'Scrum';

export interface IBoardColumn {
  name: string;
  statusId: string;
  /** Additional statuses that should be displayed in this column (optional). */
  visibleStatuses?: string[];
  order: number;
}

export interface IBoard extends Document {
  name: string;
  type: BoardType;
  project: mongoose.Types.ObjectId;
  columns: IBoardColumn[];
  createdAt: Date;
  updatedAt: Date;
}

const boardColumnSchema = new Schema<IBoardColumn>(
  {
    name: { type: String, required: true },
    statusId: { type: String, required: true },
    visibleStatuses: { type: [String], default: [] },
    order: { type: Number, required: true, default: 0 },
  },
  { _id: false }
);

const boardSchema = new Schema<IBoard>(
  {
    name: { type: String, required: true },
    type: { type: String, enum: ['Kanban', 'Scrum'], required: true },
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    columns: { type: [boardColumnSchema], default: [] },
  },
  { timestamps: true }
);

boardSchema.index({ project: 1 });

export const Board = mongoose.model<IBoard>('Board', boardSchema);
