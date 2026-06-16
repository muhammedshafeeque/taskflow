import { evaluateFormula, enrichCalculatedCustomFields } from './customFieldFormula.service';

describe('evaluateFormula', () => {
  it('evaluates arithmetic with field refs', () => {
    const issue = { storyPoints: 5, customFieldValues: { hours: 2 } };
    expect(evaluateFormula('{storyPoints} * 8', issue)).toBe(40);
  });

  it('supports daysBetween on dates', () => {
    const issue = { startDate: '2026-01-01', dueDate: '2026-01-11' };
    expect(evaluateFormula('daysBetween({startDate},{dueDate})', issue)).toBe(10);
  });

  it('returns null for unsafe expressions', () => {
    expect(evaluateFormula('process.exit()', { customFieldValues: {} })).toBeNull();
  });
});

describe('enrichCalculatedCustomFields', () => {
  it('writes formula results into customFieldValues', () => {
    const fields = [{ key: 'total', fieldType: 'formula', formula: '{storyPoints} + 1' }];
    const issue = { storyPoints: 3, customFieldValues: {} };
    const out = enrichCalculatedCustomFields(fields, issue);
    expect(out.total).toBe(4);
  });
});
