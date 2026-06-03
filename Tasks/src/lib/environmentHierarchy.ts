import type { ProjectEnvironment, ProjectVersion } from './api';

export function sortEnvironmentsAsc(environments: ProjectEnvironment[]): ProjectEnvironment[] {
  return [...environments].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export function sortEnvironmentsDesc(environments: ProjectEnvironment[]): ProjectEnvironment[] {
  return [...environments].sort((a, b) => b.order - a.order || a.name.localeCompare(b.name));
}

export function isReleasedToEnvironment(version: ProjectVersion, environmentId: string): boolean {
  return Boolean(version.releasedAtByEnvironment?.[environmentId]);
}

/** Next environment (by tier order) that this version has not been released to yet. */
export function getNextReleaseEnvironment(
  environments: ProjectEnvironment[],
  version: ProjectVersion
): ProjectEnvironment | null {
  const sorted = sortEnvironmentsAsc(environments);
  return sorted.find((env) => !isReleasedToEnvironment(version, env.id)) ?? null;
}

export function canReleaseToEnvironment(
  environments: ProjectEnvironment[],
  version: ProjectVersion,
  environmentId: string
): boolean {
  if (!environments.some((e) => e.id === environmentId)) return false;
  return !isReleasedToEnvironment(version, environmentId);
}

export function hasPendingPromotion(
  environments: ProjectEnvironment[],
  version: ProjectVersion
): boolean {
  return getNextReleaseEnvironment(environments, version) != null;
}
