import { Router } from 'express';
import {
  registerHandler,
  loginHandler,
  refreshHandler,
  changePasswordHandler,
  forgotPasswordHandler,
  resetPasswordHandler,
  updateProfileHandler,
  microsoftSsoHandler,
  microsoftSsoAuthorizeUrlHandler,
} from './auth.controller';

const router = Router();

router.post('/register', registerHandler);
router.post('/login', loginHandler);
router.post('/refresh', refreshHandler);
router.patch('/me', updateProfileHandler);
router.patch('/me/password', changePasswordHandler);
router.post('/forgot-password', forgotPasswordHandler);
router.post('/reset-password', resetPasswordHandler);
router.post('/sso/microsoft', microsoftSsoHandler);
router.get('/sso/microsoft/url', microsoftSsoAuthorizeUrlHandler);

export const authRoutes = router;
