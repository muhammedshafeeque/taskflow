import { Request, Response, NextFunction } from 'express';
import { requirePermission, requireAnyPermission } from './requirePermission';

function mockReq(permissions: string[]): Request {
  return { user: { permissions } } as unknown as Request;
}

describe('requirePermission', () => {
  it('allows when user has matching dot permission', () => {
    const next = jest.fn() as NextFunction;
    const mw = requirePermission('auth.user.list');
    mw(mockReq(['auth.user.list']), {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('allows legacy colon code when user holds dot equivalent', () => {
    const next = jest.fn() as NextFunction;
    const mw = requirePermission('users:list');
    mw(mockReq(['auth.user.list']), {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('allows when required is colon and user holds colon', () => {
    const next = jest.fn() as NextFunction;
    const mw = requirePermission('users:list');
    mw(mockReq(['users:list']), {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects when permission missing', () => {
    const next = jest.fn() as NextFunction;
    const mw = requirePermission('auth.user.list');
    mw(mockReq(['project.project.list']), {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('supports wildcard user permissions', () => {
    const next = jest.fn() as NextFunction;
    const mw = requirePermission('taskflow.crm.account.list');
    mw(mockReq(['taskflow.crm.*']), {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });
});

describe('requireAnyPermission', () => {
  it('allows if any required permission matches', () => {
    const next = jest.fn() as NextFunction;
    const mw = requireAnyPermission(['auth.user.list', 'roles:manage']);
    mw(mockReq(['auth.role.manage_all']), {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });
});
