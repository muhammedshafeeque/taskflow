export type EnvLike = { id: string; name: string; order: number };

export type VersionReleaseState = {
  releasedAtByEnvironment?: Record<string, string>;
};

/** Lowest tier first (e.g. Dev → QA → Prod). */
export function sortEnvironmentsAsc<T extends EnvLike>(environments: T[]): T[] {
  return [...environments].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/** Highest tier first for display. */
export function sortEnvironmentsDesc<T extends EnvLike>(environments: T[]): T[] {
  return [...environments].sort((a, b) => b.order - a.order || a.name.localeCompare(b.name));
}

export function getEnvironmentTierIndex(environments: EnvLike[], environmentId: string): number {
  return sortEnvironmentsAsc(environments).findIndex((e) => e.id === environmentId);
}

export function isReleasedToEnvironment(version: VersionReleaseState, environmentId: string): boolean {
  return Boolean(version.releasedAtByEnvironment?.[environmentId]);
}

/**
 * Release to the next lower tier (order - 1) must exist before releasing here.
 * Lowest tier has no prerequisite.
 */
export function validateEnvironmentReleaseOrder(
  environments: EnvLike[],
  version: VersionReleaseState,
  targetEnvironmentId: string
): { ok: true } | { ok: false; message: string } {
  const sorted = sortEnvironmentsAsc(environments);
  const idx = sorted.findIndex((e) => e.id === targetEnvironmentId);
  if (idx < 0) return { ok: false, message: 'Environment not found' };
  if (idx === 0) return { ok: true };
  const prerequisite = sorted[idx - 1];
  if (!isReleasedToEnvironment(version, prerequisite.id)) {
    return {
      ok: false,
      message: `Release version to "${prerequisite.name}" before "${sorted[idx].name}".`,
    };
  }
  return { ok: true };
}

/** Promote = version already released to at least one lower tier; first deploy to this tier. */
export function isPromoteToEnvironment(
  environments: EnvLike[],
  version: VersionReleaseState,
  targetEnvironmentId: string
): boolean {
  const sorted = sortEnvironmentsAsc(environments);
  const idx = getEnvironmentTierIndex(environments, targetEnvironmentId);
  if (idx <= 0) return false;
  if (isReleasedToEnvironment(version, targetEnvironmentId)) return false;
  return sorted.slice(0, idx).some((e) => isReleasedToEnvironment(version, e.id));
}
