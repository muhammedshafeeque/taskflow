/** Normalize fix version from API (legacy string or array). */
export function normalizeFixVersionIds(value: string | string[] | undefined | null): string[] {
  if (value == null || value === '') return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}
