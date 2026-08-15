import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireAnyPermission } from '../../middleware/requirePermission';
import { asyncHandler } from '../../utils/asyncHandler';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import * as ctrl from './core.controller';

const C = TASK_FLOW_PERMISSIONS.TASKFLOW.CORE;

const companyRead = [C.COMPANY.READ, C.COMPANY.UPDATE];
const companyUpdate = [C.COMPANY.UPDATE];
const currencyRead = [C.CURRENCY.READ, C.CURRENCY.MANAGE, C.COMPANY.READ];
const currencyManage = [C.CURRENCY.MANAGE];
const rateRead = [C.EXCHANGE_RATE.READ, C.EXCHANGE_RATE.MANAGE, C.COMPANY.READ];
const rateManage = [C.EXCHANGE_RATE.MANAGE];
const modulesManage = [C.MODULES.MANAGE];

const router = Router();
router.use(authMiddleware);

router.get('/modules', asyncHandler(ctrl.getPlatformModules));
router.patch('/modules', requireAnyPermission(modulesManage), asyncHandler(ctrl.updatePlatformModules));

router.get('/company', requireAnyPermission(companyRead), asyncHandler(ctrl.getCompany));
router.patch('/company', requireAnyPermission(companyUpdate), asyncHandler(ctrl.updateCompany));

router.get('/currencies', requireAnyPermission(currencyRead), asyncHandler(ctrl.listCurrencies));
router.patch(
  '/currencies/:code',
  requireAnyPermission(currencyManage),
  asyncHandler(ctrl.setCurrencyActive)
);

router.get('/exchange-rates', requireAnyPermission(rateRead), asyncHandler(ctrl.listExchangeRates));
router.post(
  '/exchange-rates/sync',
  requireAnyPermission(rateManage),
  asyncHandler(ctrl.syncExchangeRates)
);
router.put(
  '/exchange-rates/:code',
  requireAnyPermission(rateManage),
  asyncHandler(ctrl.setExchangeRate)
);
router.delete(
  '/exchange-rates/record/:id',
  requireAnyPermission(rateManage),
  asyncHandler(ctrl.deleteExchangeRate)
);
router.get(
  '/exchange-rates/:code/history',
  requireAnyPermission(rateRead),
  asyncHandler(ctrl.getExchangeRateHistory)
);

export const coreRoutes = router;
