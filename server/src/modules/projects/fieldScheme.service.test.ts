import { resolveFieldsForIssueType, resolveIssueTypeId } from './fieldScheme.service';
import type { IProjectCustomField, IFieldScheme } from './project.model';

const fields: IProjectCustomField[] = [
  { id: '1', key: 'a', label: 'A', fieldType: 'text', required: false, order: 0 },
  { id: '2', key: 'b', label: 'B', fieldType: 'number', required: true, order: 1 },
  { id: '3', key: 'calc', label: 'Calc', fieldType: 'formula', required: false, order: 2, formula: '{a} + 1' },
];

const schemes: IFieldScheme[] = [
  {
    issueTypeId: 'bug',
    rules: [
      { fieldKey: 'a', visible: false, required: false },
      { fieldKey: 'b', visible: true, required: false },
    ],
  },
];

describe('resolveIssueTypeId', () => {
  it('maps issue type name to id', () => {
    expect(resolveIssueTypeId([{ id: 'bug', name: 'Bug' }], 'Bug')).toBe('bug');
  });
});

describe('resolveFieldsForIssueType', () => {
  it('returns all fields when no scheme', () => {
    const resolved = resolveFieldsForIssueType(fields, [], 'task');
    expect(resolved.map((f) => f.key)).toEqual(['a', 'b', 'calc']);
    expect(resolved.find((f) => f.key === 'b')?.effectiveRequired).toBe(true);
  });

  it('hides fields per scheme and overrides required', () => {
    const resolved = resolveFieldsForIssueType(fields, schemes, 'bug');
    expect(resolved.map((f) => f.key)).toEqual(['b', 'calc']);
    expect(resolved.find((f) => f.key === 'b')?.effectiveRequired).toBe(false);
    expect(resolved.find((f) => f.key === 'calc')?.readOnly).toBe(true);
  });
});
