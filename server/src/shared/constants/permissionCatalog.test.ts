import {
  WORKSPACE_ROLE_PERMISSION_CATALOG,
  permissionGroup,
  permissionLabel,
} from './permissionCatalog';

describe('permissionCatalog', () => {
  it('includes CRM, HRMS, and mail catalog entries', () => {
    const codes = WORKSPACE_ROLE_PERMISSION_CATALOG.map((e) => e.code);
    expect(codes).toContain('taskflow.crm.account.list');
    expect(codes).toContain('taskflow.hr.employee.list');
    expect(codes).toContain('taskflow.mail.mailbox.read');
    expect(codes).toContain('taskflow.platform.executive.read');
    expect(codes).toContain('taskflow.platform.audit.read');
  });

  it('assigns known groups', () => {
    expect(permissionGroup('taskflow.crm.account.list')).toBe('CRM');
    expect(permissionGroup('taskflow.hr.employee.list')).toBe('HRMS');
    expect(permissionGroup('auth.user.list')).toBe('Auth');
    expect(permissionGroup('project.project.list')).toBe('Project Manager');
    expect(permissionGroup('issue.issue.create')).toBe('Project (member)');
    expect(permissionGroup('taskflow.platform.audit.read')).toBe('Platform');
  });

  it('produces human-readable labels', () => {
    expect(permissionLabel('users:list')).toBe('List users');
    expect(permissionLabel('taskflow.crm.account.list')).toMatch(/Account/i);
    expect(permissionLabel('taskflow.platform.executive.read')).toBe('View executive dashboard');
  });

  it('includes group on every catalog entry', () => {
    for (const entry of WORKSPACE_ROLE_PERMISSION_CATALOG) {
      expect(entry.group).toBeTruthy();
      expect(entry.label).toBeTruthy();
      expect(entry.code).toBeTruthy();
    }
  });
});
