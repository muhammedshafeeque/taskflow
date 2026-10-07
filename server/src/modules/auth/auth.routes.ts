import { authLimiter } from '../../middleware/rateLimit';
import { Router } from 'express';
import {
  registerHandler,
  loginHandler,
  twoFactorVerifyHandler,
  twoFactorSetupHandler,
  twoFactorConfirmHandler,
  twoFactorDisableHandler,
  refreshHandler,
  meHandler,
  changePasswordHandler,
  forgotPasswordHandler,
  resetPasswordHandler,
  updateProfileHandler,
  microsoftSsoHandler,
  microsoftSsoAuthorizeUrlHandler,
  publicConfigHandler,
  debugPermissionsHandler,
  setPasswordHandler,
  ideAuthStartHandler,
  ideAuthApproveHandler,
  ideAuthExchangeHandler,
} from './auth.controller';
import { oauthRoutes } from './oauth.routes';

const router = Router();

router.use('/oauth', oauthRoutes);

router.post('/register', authLimiter, registerHandler);
router.get('/public-config', publicConfigHandler);
router.post('/login', authLimiter, loginHandler);
router.post('/2fa/verify', authLimiter, twoFactorVerifyHandler);
router.post('/2fa/setup', twoFactorSetupHandler);
router.post('/2fa/confirm', authLimiter, twoFactorConfirmHandler);
router.post('/2fa/disable', authLimiter, twoFactorDisableHandler);
router.post('/refresh', refreshHandler);
router.get('/me', meHandler);
router.get('/debug-permissions/:id', debugPermissionsHandler);
router.patch('/me', updateProfileHandler);
router.patch('/me/password', changePasswordHandler);
router.post('/set-password', setPasswordHandler);
router.post('/forgot-password', authLimiter, forgotPasswordHandler);
router.post('/reset-password', authLimiter, resetPasswordHandler);
/** @deprecated Prefer Passport browser flow at `/auth/oauth/microsoft` (redirect + JWT). Kept for clients still using auth-code exchange. */
router.post('/sso/microsoft', microsoftSsoHandler);
router.get('/sso/microsoft/url', microsoftSsoAuthorizeUrlHandler);

router.post('/ide/start', ideAuthStartHandler);
router.post('/ide/approve', ideAuthApproveHandler);
router.post('/ide/exchange', ideAuthExchangeHandler);

export const authRoutes = router;
