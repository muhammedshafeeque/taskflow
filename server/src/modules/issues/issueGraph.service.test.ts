describe('issueGraph link type filter', () => {
  function parseLinkTypes(raw?: string): string[] | null {
    if (!raw?.trim()) return null;
    const allowed = [
      'blocks',
      'is_blocked_by',
      'duplicates',
      'is_duplicated_by',
      'relates_to',
    ];
    const parts = raw.split(',').map((s) => s.trim());
    const filtered = parts.filter((p) => allowed.includes(p));
    return filtered.length ? filtered : null;
  }

  it('returns null for empty filter', () => {
    expect(parseLinkTypes()).toBeNull();
    expect(parseLinkTypes('  ')).toBeNull();
  });

  it('filters unknown link types', () => {
    expect(parseLinkTypes('blocks,relates_to')).toEqual(['blocks', 'relates_to']);
    expect(parseLinkTypes('parent_child,blocks')).toEqual(['blocks']);
  });
});
