import mongoose, { Document, Schema } from 'mongoose';

export type ExpenseStatus = 'draft' | 'submitted' | 'approved' | 'paid' | 'rejected';
export type ExpenseCategory =
  | 'payroll'
  | 'software'
  | 'hardware'
  | 'infrastructure'
  | 'travel'
  | 'marketing'
  | 'office'
  | 'professional_services'
  | 'other';

export interface IAccountExpense extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  reference: string;
  description: string;
  category: ExpenseCategory;
  status: ExpenseStatus;
  vendorAccountId?: mongoose.Types.ObjectId;
  purchaseOrderId?: mongoose.Types.ObjectId;
  projectId?: mongoose.Types.ObjectId;
  amount: number;
  currency: string;
  expenseDate: Date;
  paidDate?: Date;
  submittedBy?: mongoose.Types.ObjectId;
  approvedBy?: mongoose.Types.ObjectId;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const accountExpenseSchema = new Schema<IAccountExpense>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    reference: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: ['payroll', 'software', 'hardware', 'infrastructure', 'travel', 'marketing', 'office', 'professional_services', 'other'],
      default: 'other',
      index: true,
    },
    status: { type: String, enum: ['draft', 'submitted', 'approved', 'paid', 'rejected'], default: 'submitted', index: true },
    vendorAccountId: { type: Schema.Types.ObjectId, ref: 'CrmAccount' },
    purchaseOrderId: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder' },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    amount: { type: Number, required: true, default: 0 },
    currency: { type: String, default: 'USD' },
    expenseDate: { type: Date, required: true },
    paidDate: { type: Date },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String },
  },
  { timestamps: true }
);

accountExpenseSchema.index({ taskflowOrganizationId: 1, reference: 1 }, { unique: true });

export const AccountExpense = mongoose.model<IAccountExpense>('AccountExpense', accountExpenseSchema);
