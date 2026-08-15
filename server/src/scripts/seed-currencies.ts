/**
 * Seed global currency catalog from assets/dataFiles/currencies.json.
 * Run: npm run seed-currencies
 */
import fs from 'fs';
import path from 'path';
import { connectDb, disconnectDb } from '../config/db';
import { Currency } from '../modules/core/models/currency.model';

type JsonCurrency = {
  code: string;
  name: string;
  symbol: string;
  decimal_digits: number;
  countries?: string[];
};

async function main() {
  await connectDb();

  const filePath = path.join(
    __dirname,
    '../modules/assets/dataFiles/currencies.json'
  );
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as { currencies: JsonCurrency[] };
  const list = parsed.currencies ?? [];

  let upserted = 0;
  for (const c of list) {
    const code = String(c.code).trim().toUpperCase();
    if (!code) continue;
    await Currency.findOneAndUpdate(
      { code },
      {
        $set: {
          code,
          name: String(c.name).trim(),
          symbol: String(c.symbol).trim() || code,
          decimalDigits: Number(c.decimal_digits ?? 2),
          countries: Array.isArray(c.countries) ? c.countries.map(String) : [],
          isActive: true,
        },
      },
      { upsert: true, new: true }
    );
    upserted += 1;
  }

  // Ensure USD exists even if JSON was empty/missing it
  await Currency.findOneAndUpdate(
    { code: 'USD' },
    {
      $setOnInsert: {
        code: 'USD',
        name: 'US Dollar',
        symbol: '$',
        decimalDigits: 2,
        countries: ['United States'],
        isActive: true,
      },
    },
    { upsert: true }
  );

  console.log(`Upserted ${upserted} currencies from currencies.json`);
  await disconnectDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
