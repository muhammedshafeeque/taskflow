import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { Request, Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { validate } from '../../../middleware/validate';
import { z } from 'zod';
import { ApiError } from '../../../utils/ApiError';
import { env } from '../../../config/env';
import { CustomerUser } from '../customer-user/customerUser.model';
import { sendCustomerEmail } from '../../../services/email.service';
import * as customerUserService from '../customer-user/customerUser.service';

const SALT_ROUNDS = 10;

const forgotPasswordSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

const updateMeSchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  avatarUrl: z.string().url().optional().or(z.literal('')),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

async function forgotPasswordHandler(req: Request, res: Response): Promise<void> {
  const { email } = req.body as { email: string };
  const user = await CustomerUser.findOne({ email }).lean();

  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000);
    await CustomerUser.findByIdAndUpdate(user._id, {
      $set: { passwordResetToken: tokenHash, passwordResetExpires: expires },
    });
    const resetLink = `${env.appUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
    sendCustomerEmail(
      user.email,
      'Reset your Customer Portal password',
      `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Reset your password</title></head>
<body style="font-family: system-ui, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #4f46e5;">Reset your password</h2>
  <p>Hi ${user.name},</p>
  <p>You requested a password reset. Click the link below to set a new password:</p>
  <p><a href="${resetLink}" style="color: #4f46e5;">Reset password</a></p>
  <p>If you didn't request this, you can ignore this email.</p>
  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
  <p style="font-size: 12px; color: #64748b;">This link will expire in 1 hour.</p>
</body>
</html>
      `.trim()
    ).catch((err) => console.error('Failed to send customer forgot password email:', err));
  }

  // Always return 200 to avoid email enumeration
  res.status(200).json({ success: true, data: { message: 'If the email exists, a reset link has been sent.' } });
}

async function resetPasswordHandler(req: Request, res: Response): Promise<void> {
  const { token, newPassword } = req.body as { token: string; newPassword: string };

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const user = await CustomerUser.findOne({
    passwordResetToken: tokenHash,
    passwordResetExpires: { $gt: new Date() },
  })
    .select('+passwordResetToken +passwordResetExpires')
    .lean();

  if (!user) throw new ApiError(400, 'Invalid or expired reset token');

  const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await CustomerUser.findByIdAndUpdate(user._id, {
    $set: { password: hashed, mustChangePassword: false },
    $unset: { passwordResetToken: 1, passwordResetExpires: 1 },
  });

  res.status(200).json({ success: true, data: { message: 'Password reset successfully' } });
}

type CustomerUserDoc = {
  _id: { toString(): string };
  email: string;
  name: string;
  avatarUrl?: string | null;
  customerOrgId: { toString(): string };
  isOrgAdmin?: boolean;
  mustChangePassword?: boolean;
  createdAt?: Date;
};

function toAuthUser(doc: CustomerUserDoc, permissions: string[]) {
  return {
    id: doc._id.toString(),
    email: doc.email,
    name: doc.name,
    avatarUrl: doc.avatarUrl ?? undefined,
    userType: 'customer' as const,
    orgId: doc.customerOrgId.toString(),
    isOrgAdmin: doc.isOrgAdmin ?? false,
    customerPermissions: permissions,
    mustChangePassword: doc.mustChangePassword ?? false,
    createdAt: doc.createdAt?.toISOString(),
  };
}

async function getMeHandler(req: Request, res: Response): Promise<void> {
  const result = await customerUserService.getMe(req.customerUser!.id);
  const user = toAuthUser(result as CustomerUserDoc, req.customerUser!.permissions);
  res.status(200).json({ success: true, data: { user } });
}

async function updateMeHandler(req: Request, res: Response): Promise<void> {
  const result = await customerUserService.updateMe(req.customerUser!.id, req.body);
  const user = toAuthUser(result as CustomerUserDoc, req.customerUser!.permissions);
  res.status(200).json({ success: true, data: { user } });
}

async function changePasswordHandler(req: Request, res: Response): Promise<void> {
  await customerUserService.changePassword(
    req.customerUser!.id,
    req.body.currentPassword,
    req.body.newPassword
  );
  res.status(200).json({ success: true, data: { message: 'Password changed successfully' } });
}

export const forgotPassword = [validate(forgotPasswordSchema, 'body'), asyncHandler(forgotPasswordHandler)];
export const resetPassword = [validate(resetPasswordSchema, 'body'), asyncHandler(resetPasswordHandler)];
export const getMe = [asyncHandler(getMeHandler)];
export const updateMe = [validate(updateMeSchema, 'body'), asyncHandler(updateMeHandler)];
export const changePassword = [validate(changePasswordSchema, 'body'), asyncHandler(changePasswordHandler)];
