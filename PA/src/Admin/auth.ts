import type { NextFunction, Request, Response } from 'express';

export function requireAdminSecret(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const configured = process.env.PA_ADMIN_SECRET?.trim();
  if (!configured) {
    res.status(503).json({
      success: false,
      error: 'PA_ADMIN_SECRET is not configured',
    });
    return;
  }
  const provided = String(
    req.headers['x-pa-admin-secret'] ??
      (typeof req.query.secret === 'string' ? req.query.secret : '') ??
      ''
  ).trim();
  if (!provided || provided !== configured) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }
  next();
}
