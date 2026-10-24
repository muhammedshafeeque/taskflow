import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError';
import type { ModuleId } from '../shared/constants/moduleAccess';
import { isPlatformModuleEnabled } from '../modules/core/core.service';

/** Hard-gate: reject requests when the platform module kill-switch is off. */
/** Read by the MCP API catalog to know which module a mounted router belongs to. */
export const MODULE_TAG = Symbol.for('atrium.moduleId');

export function requireModuleEnabled(moduleId: ModuleId) {
  const gate = async (_req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const enabled = await isPlatformModuleEnabled(moduleId);
      if (!enabled) {
        next(new ApiError(403, `Module "${moduleId}" is disabled`));
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
  Object.defineProperty(gate, MODULE_TAG, { value: moduleId });
  return gate;
}
