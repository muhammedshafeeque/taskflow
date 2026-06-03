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

/** Promote = version already released to at least one other environment (any tier). */
export function isPromoteToEnvironment(
  _environments: EnvLike[],
  version: VersionReleaseState,
  targetEnvironmentId: string
): boolean {
  if (isReleasedToEnvironment(version, targetEnvironmentId)) return false;
  const released = version.releasedAtByEnvironment ?? {};
  return Object.keys(released).length > 0;
}
