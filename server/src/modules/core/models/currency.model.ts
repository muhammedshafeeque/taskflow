import mongoose, { Document, Schema } from 'mongoose';

export interface ICurrency extends Document {
  code: string;
  name: string;
  symbol: string;
  decimalDigits: number;
  countries: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const currencySchema = new Schema<ICurrency>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    symbol: { type: String, required: true, trim: true },
    decimalDigits: { type: Number, required: true, default: 2, min: 0 },
    countries: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Currency = mongoose.model<ICurrency>('Currency', currencySchema);
