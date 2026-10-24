/** Data helpers for the people pickers in PersonSelect.tsx. */

export type PersonOption = {
  id: string;
  name: string;
  /** Shown under the name and searchable (email, department, role…). */
  hint?: string;
  avatarUrl?: string;
};

/** Non-person choices such as "Unassigned", "Reporter", "— No change —". */
export type SpecialOption = { value: string; label: string; hint?: string };

/** Maps the common `{ _id | id, name, email }` shapes to PersonOption. */
export function toPeople(
  list: ReadonlyArray<{ _id?: unknown; id?: unknown; name?: unknown; email?: unknown; department?: unknown; avatarUrl?: unknown }>
): PersonOption[] {
  return list.map((u) => ({
    id: String(u._id ?? u.id ?? ''),
    name: String(u.name ?? ''),
    hint: u.email ? String(u.email) : u.department ? String(u.department) : undefined,
    avatarUrl: u.avatarUrl ? String(u.avatarUrl) : undefined,
  }));
}
