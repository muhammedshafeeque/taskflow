import { validateLines } from './ledger.service';
import { parseStatementCsv } from './payables.service';

describe('ledger', () => {
  it('accepts balanced journals and rejects unbalanced or mixed lines', () => {
    expect(() => validateLines([{ accountId: 'a', debit: 100 }, { accountId: 'b', credit: 60 }, { accountId: 'c', credit: 40 }])).not.toThrow();
    expect(() => validateLines([{ accountId: 'a', debit: 100 }, { accountId: 'b', credit: 90 }])).toThrow(/must equal/);
    expect(() => validateLines([{ accountId: 'a', debit: 10, credit: 10 }, { accountId: 'b', credit: 0 }])).toThrow();
    expect(() => validateLines([{ accountId: 'a', debit: 10 }])).toThrow(/two lines/);
  });

  it('parses statement CSVs with amount or debit/credit columns', () => {
    const single = parseStatementCsv('Date,Description,Amount\n2026-10-01,"Client, Inc payment",1500.50\n2026-10-02,Bank fee,-12');
    expect(single).toEqual([
      expect.objectContaining({ description: 'Client, Inc payment', amount: 1500.5 }),
      expect.objectContaining({ description: 'Bank fee', amount: -12 }),
    ]);
    const split = parseStatementCsv('Txn Date,Narration,Withdrawal,Deposit,Ref No\n2026-10-03,AWS,"1,200.00",,R1\n2026-10-04,Salary refund,,300,R2');
    expect(split.map((r) => r.amount)).toEqual([-1200, 300]);
    expect(split[0].reference).toBe('R1');
    expect(() => parseStatementCsv('foo,bar\n1,2')).toThrow(/columns/);
  });
});
