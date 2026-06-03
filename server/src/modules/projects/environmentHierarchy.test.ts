import { isPromoteToEnvironment, isReleasedToEnvironment } from './environmentHierarchy';

const envs = [
  { id: 'dev', name: 'Dev', order: 0 },
  { id: 'staging', name: 'Staging', order: 1 },
  { id: 'prod', name: 'Production', order: 2 },
];

describe('environmentHierarchy', () => {
  it('isReleasedToEnvironment reflects releasedAtByEnvironment', () => {
    expect(isReleasedToEnvironment({ releasedAtByEnvironment: { prod: '2026-01-01' } }, 'prod')).toBe(true);
    expect(isReleasedToEnvironment({ releasedAtByEnvironment: { prod: '2026-01-01' } }, 'dev')).toBe(false);
  });

  it('isPromoteToEnvironment is false for first release to any tier', () => {
    expect(isPromoteToEnvironment(envs, {}, 'prod')).toBe(false);
    expect(isPromoteToEnvironment(envs, {}, 'dev')).toBe(false);
  });

  it('isPromoteToEnvironment is true when releasing to another tier after any prior release', () => {
    const version = { releasedAtByEnvironment: { prod: '2026-01-01' } };
    expect(isPromoteToEnvironment(envs, version, 'staging')).toBe(true);
    expect(isPromoteToEnvironment(envs, version, 'dev')).toBe(true);
  });

  it('isPromoteToEnvironment is false when target tier already released', () => {
    const version = { releasedAtByEnvironment: { prod: '2026-01-01' } };
    expect(isPromoteToEnvironment(envs, version, 'prod')).toBe(false);
  });
});
