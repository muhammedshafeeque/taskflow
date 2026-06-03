import { parse } from 'csv-parse/sync';

describe('csv import parsing', () => {
  it('parses header row and title column for dry-run style preview', () => {
    const csv = `title,status,type,priority
Alpha,Open,Task,Medium
Beta,Done,Bug,High`;
    const records = parse(csv, { columns: true, skip_empty_lines: true, trim: true }) as Record<
      string,
      string
    >[];
    expect(records).toHaveLength(2);
    expect(records[0].title).toBe('Alpha');
    expect(records[1].status).toBe('Done');
  });
});
