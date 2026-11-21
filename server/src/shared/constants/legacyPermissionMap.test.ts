import { mapLegacyProjectOrGlobalPermissions, permissionToDot, userHasPermission } from './legacyPermissionMap';

describe('colon-era codes keep the comment rights they had before comments got their own permissions', () => {
  it('viewing issues includes reading their comments', () => {
    const perms = mapLegacyProjectOrGlobalPermissions(['issues:view']);
    expect(perms).toEqual(expect.arrayContaining(['issue.issue.read', 'issue.comment.read', 'issue.comment.list']));
    expect(perms).not.toContain('issue.comment.create');
  });

  it('editing issues includes commenting', () => {
    const perms = mapLegacyProjectOrGlobalPermissions(['issues:edit']);
    expect(perms).toEqual(expect.arrayContaining(['issue.issue.update', 'issue.comment.create', 'issue.comment.read']));
  });

  it('works when the stored permissions are still colon codes', () => {
    expect(userHasPermission(['issues:view'], 'issue.comment.read')).toBe(true);
    expect(userHasPermission(['issues:view'], 'issue.comment.create')).toBe(false);
    expect(userHasPermission(['issues:edit'], 'issue.comment.create')).toBe(true);
  });

  it('leaves dot-notation (designation) permissions configurable', () => {
    expect(mapLegacyProjectOrGlobalPermissions(['issue.issue.read'])).not.toContain('issue.comment.read');
    expect(userHasPermission(['issue.issue.read'], 'issue.comment.read')).toBe(false);
  });

  it('keeps staff-before-customer precedence for codes in both maps', () => {
    expect(userHasPermission(['roles:manage'], permissionToDot('roles:manage'))).toBe(true);
  });
});
