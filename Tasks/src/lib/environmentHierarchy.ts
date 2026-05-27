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

export function validateEnvironmentReleaseOrder(
  environments: ProjectEnvironment[],
  version: ProjectVersion,
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
      message: `Release to "${prerequisite.name}" first, then promote to "${sorted[idx].name}".`,
    };
  }
  return { ok: true };
}

/** Next environment in the chain that this version has not been released to yet. */
export function getNextReleaseEnvironment(
  environments: ProjectEnvironment[],
  version: ProjectVersion
): ProjectEnvironment | null {
  const sorted = sortEnvironmentsAsc(environments);
  for (const env of sorted) {
    if (!isReleasedToEnvironment(version, env.id)) {
      const check = validateEnvironmentReleaseOrder(environments, version, env.id);
      if (check.ok) return env;
      return null;
    }
  }
  return null;
}

export function canReleaseToEnvironment(
  environments: ProjectEnvironment[],
  version: ProjectVersion,
  environmentId: string
): boolean {
  if (isReleasedToEnvironment(version, environmentId)) return false;
  return validateEnvironmentReleaseOrder(environments, version, environmentId).ok;
}

export function hasPendingPromotion(
  environments: ProjectEnvironment[],
  version: ProjectVersion
): boolean {
  return getNextReleaseEnvironment(environments, version) != null;
}
