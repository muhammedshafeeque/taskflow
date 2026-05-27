/** Normalize API / legacy DB values to a fix-version id list. */
export function normalizeFixVersionsInput(
  value: string | string[] | null | undefined
): string[] | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return [];
  if (Array.isArray(value)) return value.map((id) => String(id).trim()).filter(Boolean);
  const one = String(value).trim();
  return one ? [one] : [];
}

/** Coerce stored fixVersion (string legacy or array) for API responses. */
export function normalizeFixVersionsOnRead(value: unknown): string[] | undefined {
  if (value == null || value === '') return undefined;
  if (Array.isArray(value)) {
    const ids = value.map((id) => String(id).trim()).filter(Boolean);
    return ids.length ? ids : undefined;
  }
  if (typeof value === 'string') {
    const id = value.trim();
    return id ? [id] : undefined;
  }
  return undefined;
}

export function withNormalizedFixVersion<T extends Record<string, unknown>>(issue: T): T {
  const normalized = normalizeFixVersionsOnRead(issue.fixVersion);
  if (normalized) {
    return { ...issue, fixVersion: normalized };
  }
  const { fixVersion: _removed, ...rest } = issue;
  return rest as T;
}
