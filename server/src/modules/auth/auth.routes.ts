import { Router } from 'express';
import {
  registerHandler,
  loginHandler,
  refreshHandler,
  meHandler,
  changePasswordHandler,
  forgotPasswordHandler,
  resetPasswordHandler,
  updateProfileHandler,
  microsoftSsoHandler,
  microsoftSsoAuthorizeUrlHandler,
  debugPermissionsHandler,
} from './auth.controller';

const router = Router();

router.post('/register', registerHandler);
router.post('/login', loginHandler);
router.post('/refresh', refreshHandler);
router.get('/me', meHandler);
router.get('/debug-permissions/:id', debugPermissionsHandler);
router.patch('/me', updateProfileHandler);
router.patch('/me/password', changePasswordHandler);
router.post('/forgot-password', forgotPasswordHandler);
router.post('/reset-password', resetPasswordHandler);
router.post('/sso/microsoft', microsoftSsoHandler);
router.get('/sso/microsoft/url', microsoftSsoAuthorizeUrlHandler);

export const authRoutes = router;
