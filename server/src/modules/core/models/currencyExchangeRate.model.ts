import mongoose, { Document, Schema } from 'mongoose';

export interface ICurrencyExchangeRate extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  currencyCode: string;
  /** Multiply amount in this currency by rateToUsd to get USD. USD is always 1. */
  rateToUsd: number;
  effectiveFrom: Date;
  notes?: string;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const currencyExchangeRateSchema = new Schema<ICurrencyExchangeRate>(
  {
    taskflowOrganizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    currencyCode: { type: String, required: true, uppercase: true, trim: true },
    rateToUsd: { type: Number, required: true, min: 0 },
    effectiveFrom: { type: Date, required: true, default: Date.now },
    notes: { type: String },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

currencyExchangeRateSchema.index(
  { taskflowOrganizationId: 1, currencyCode: 1, effectiveFrom: 1 },
  { unique: true }
);

export const CurrencyExchangeRate = mongoose.model<ICurrencyExchangeRate>(
  'CurrencyExchangeRate',
  currencyExchangeRateSchema
);
