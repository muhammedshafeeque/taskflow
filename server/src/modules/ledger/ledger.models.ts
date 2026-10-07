import mongoose, { Schema } from 'mongoose';

const orgRef = { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true } as const;

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

/** Chart of accounts — fully company-defined (a starter template can be applied once). */
const ledgerAccountSchema = new Schema(
  {
    taskflowOrganizationId: orgRef,
    code: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['asset', 'liability', 'equity', 'income', 'expense'], required: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'LedgerAccount' },
    description: { type: String },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);
ledgerAccountSchema.index({ taskflowOrganizationId: 1, code: 1 }, { unique: true });
export const LedgerAccount = mongoose.model('LedgerAccount', ledgerAccountSchema);

/**
 * Which account each automatic posting uses. Set in Accounts → Settings; when a
 * key is missing, that document type is simply not posted (no guessing).
 */
export const POSTING_KEYS = [
  'receivable',
  'revenue',
  'taxPayable',
  'bank',
  'payable',
  'expenseDefault',
  'employeeReimbursements',
  'salaryExpense',
  'payrollDeductions',
  'inputTax',
] as const;
export type PostingKey = (typeof POSTING_KEYS)[number];

const accountsSettingsSchema = new Schema(
  {
    taskflowOrganizationId: { ...orgRef, unique: true },
    accountMap: { type: Map, of: Schema.Types.ObjectId, default: {} },
    /** Expense category → account (overrides expenseDefault). */
    expenseCategoryAccounts: { type: Map, of: Schema.Types.ObjectId, default: {} },
    expenseCategories: {
      type: [String],
      default: ['payroll', 'software', 'hardware', 'infrastructure', 'travel', 'marketing', 'office', 'professional_services', 'other'],
    },
    /** Month (1–12) the financial year starts. */
    fiscalYearStartMonth: { type: Number, default: 4, min: 1, max: 12 },
    autoPost: { type: Boolean, default: true },
    billNumberPrefix: { type: String, default: 'BILL-' },
    creditNotePrefix: { type: String, default: 'CN-' },
  },
  { timestamps: true }
);
export const AccountsSettings = mongoose.model('AccountsSettings', accountsSettingsSchema);

const journalLineSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'LedgerAccount', required: true },
    debit: { type: Number, default: 0, min: 0 },
    credit: { type: Number, default: 0, min: 0 },
    description: { type: String },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
  },
  { _id: false }
);

const journalEntrySchema = new Schema(
  {
    taskflowOrganizationId: orgRef,
    number: { type: String, required: true },
    date: { type: Date, required: true, index: true },
    memo: { type: String, required: true },
    currency: { type: String, default: 'USD' },
    lines: { type: [journalLineSchema], default: [] },
    /** Where it came from; (type,id) is unique so auto-posting is idempotent. */
    sourceType: { type: String, default: 'manual', index: true },
    sourceId: { type: String },
    status: { type: String, enum: ['posted', 'void'], default: 'posted', index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
journalEntrySchema.index(
  { taskflowOrganizationId: 1, sourceType: 1, sourceId: 1 },
  { unique: true, partialFilterExpression: { sourceId: { $type: 'string' }, status: 'posted' } }
);
export const JournalEntry = mongoose.model('JournalEntry', journalEntrySchema);

const billLineSchema = new Schema(
  {
    description: { type: String, required: true },
    quantity: { type: Number, default: 1 },
    unitPrice: { type: Number, default: 0 },
    taxRate: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
    accountId: { type: Schema.Types.ObjectId, ref: 'LedgerAccount' },
  },
  { _id: false }
);

/** Supplier invoice (accounts payable). */
const vendorBillSchema = new Schema(
  {
    taskflowOrganizationId: orgRef,
    number: { type: String, required: true },
    vendorBillRef: { type: String },
    vendorAccountId: { type: Schema.Types.ObjectId, ref: 'CrmAccount', required: true },
    purchaseOrderId: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder' },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    billDate: { type: Date, required: true },
    dueDate: { type: Date },
    currency: { type: String, default: 'USD' },
    lines: { type: [billLineSchema], default: [] },
    subtotal: { type: Number, default: 0 },
    taxTotal: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    amountPaid: { type: Number, default: 0 },
    status: { type: String, enum: ['draft', 'approved', 'paid', 'void'], default: 'draft', index: true },
    attachmentUrls: { type: [String], default: [] },
    notes: { type: String },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
export const VendorBill = mongoose.model('VendorBill', vendorBillSchema);

/** Reduces what a customer owes on an invoice. */
const creditNoteSchema = new Schema(
  {
    taskflowOrganizationId: orgRef,
    number: { type: String, required: true },
    invoiceId: { type: Schema.Types.ObjectId, ref: 'BillingInvoice', required: true, index: true },
    date: { type: Date, required: true },
    amount: { type: Number, required: true, min: 0 },
    taxAmount: { type: Number, default: 0 },
    currency: { type: String, default: 'USD' },
    reason: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
export const CreditNote = mongoose.model('CreditNote', creditNoteSchema);

const bankAccountSchema = new Schema(
  {
    taskflowOrganizationId: orgRef,
    name: { type: String, required: true, trim: true },
    ledgerAccountId: { type: Schema.Types.ObjectId, ref: 'LedgerAccount', required: true },
    currency: { type: String, default: 'USD' },
    accountNumberLast4: { type: String },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);
export const BankAccount = mongoose.model('BankAccount', bankAccountSchema);

/** Imported statement line; reconciled when matched to a journal entry. */
const bankTransactionSchema = new Schema(
  {
    taskflowOrganizationId: orgRef,
    bankAccountId: { type: Schema.Types.ObjectId, ref: 'BankAccount', required: true, index: true },
    date: { type: Date, required: true },
    description: { type: String, required: true },
    /** Positive = money in, negative = money out. */
    amount: { type: Number, required: true },
    reference: { type: String },
    importHash: { type: String, required: true },
    matchedEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry' },
    reconciledAt: { type: Date },
    reconciledBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
bankTransactionSchema.index({ bankAccountId: 1, importHash: 1 }, { unique: true });
export const BankTransaction = mongoose.model('BankTransaction', bankTransactionSchema);
