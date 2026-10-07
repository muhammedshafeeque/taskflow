import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireAnyPermission } from '../../middleware/requirePermission';
import { asyncHandler } from '../../utils/asyncHandler';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import * as ctrl from './core.controller';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { getPlatformSettings, updatePlatformSettings } from '../platformSettings/platformSettings.service';

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
router.get('/preferences', asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await getPlatformSettings() });
}));
router.patch(
  '/preferences',
  requireAnyPermission([TASK_FLOW_PERMISSIONS.TASKFLOW.PLATFORM.SETTINGS.MANAGE]),
  asyncHandler(async (req, res) => {
    const userId = (req as typeof req & { user?: { id: string } }).user?.id;
    res.json({ success: true, data: await updatePlatformSettings(req.body ?? {}, userId) });
  })
);
/** Lightweight people picker for forms: active members of the current workspace. */
router.get('/people', asyncHandler(async (req, res) => {
  const orgId = (req as typeof req & { activeOrganizationId?: string }).activeOrganizationId;
  if (!orgId) return void res.json({ success: true, data: [] });
  const members = await OrganizationMember.find({ organization: orgId, status: 'active' }).populate('user', 'name email enabled').lean();
  const data = members
    .map((m) => m.user as unknown as { _id: unknown; name?: string; email?: string; enabled?: boolean } | null)
    .filter((u) => u && u.enabled !== false)
    .map((u) => ({ _id: String(u!._id), name: u!.name ?? u!.email, email: u!.email }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  res.json({ success: true, data });
}));
router.patch('/modules', requireAnyPermission(modulesManage), asyncHandler(ctrl.updatePlatformModules));

router.get('/company', requireAnyPermission(companyRead), asyncHandler(ctrl.getCompany));
router.patch('/company', requireAnyPermission(companyUpdate), asyncHandler(ctrl.updateCompany));

router.get('/currencies', requireAnyPermission(currencyRead), asyncHandler(ctrl.listCurrencies));
router.get('/countries', requireAnyPermission(currencyRead), asyncHandler(ctrl.listCountries));
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
