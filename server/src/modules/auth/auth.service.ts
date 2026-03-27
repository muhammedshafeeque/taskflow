import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { User } from './user.model';
import { Role } from '../roles/role.model';
import { Designation } from '../designations/designation.model';
import { ApiError } from '../../utils/ApiError';
import { env } from '../../config/env';
import { sendForgotPasswordEmail } from '../../services/email.service';
import type { RegisterInput, LoginInput, MicrosoftSsoInput } from './auth.validation';
import type { IUser } from './user.model';
import { resolveEffectiveGlobalPermissions } from './effectivePermissions';

const SALT_ROUNDS = 10;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null; text: string }> {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data, text };
}

function ensureMicrosoftConfigured() {
  if (!env.azureAdClientId || !env.azureAdClientSecret) {
    throw new ApiError(500, 'Microsoft SSO is not configured (missing AZURE_AD_CLIENT_ID/AZURE_AD_CLIENT_SECRET)');
  }
  if (!env.msTokenEndpoint || !env.msUserInfoEndpoint) {
    throw new ApiError(500, 'Microsoft SSO is not configured (missing MS_TOKEN_ENDPOINT/MS_USER_INFO_ENDPOINT)');
  }
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  role: string;
  roleId?: string;
  roleName?: string;
  designationName?: string;
  permissions: string[];
  mustChangePassword: boolean;
  createdAt?: string;
}

function signTokens(userId: string): AuthTokens {
  const options = { expiresIn: env.jwtExpiresIn };
  const accessToken = jwt.sign(
    { sub: userId },
    env.jwtSecret,
    options as jwt.SignOptions
  );
  const refreshToken = jwt.sign(
    { sub: userId, type: 'refresh' },
    env.jwtSecret,
    { expiresIn: '30d' } as jwt.SignOptions
  );
  return {
    accessToken,
    refreshToken,
    expiresIn: env.jwtExpiresIn,
  };
}

async function toAuthUser(user: IUser & { roleId?: unknown; designation?: unknown; mustChangePassword?: boolean }): Promise<AuthUser> {
  let rolePermissions: string[] = [];
  let roleName: string | undefined;
  if (user.roleId) {
    const role = await Role.findById(user.roleId).select('permissions name').lean();
    if (role?.permissions) rolePermissions = role.permissions;
    if (role?.name) roleName = role.name;
  }
  if (!roleName) roleName = user.role === 'admin' ? 'Administrator' : 'Member';
  let designationName: string | undefined;
  if (user.designation) {
    const des = await Designation.findById(user.designation).select('name').lean();
    if (des?.name) designationName = des.name;
  }
  const mustChange = user.mustChangePassword ?? false;
  const permissions = resolveEffectiveGlobalPermissions({
    rolePermissions,
    role: user.role,
    mustChangePassword: mustChange,
  });
  const u = user as IUser & { avatarUrl?: string; createdAt?: Date };
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    avatarUrl: u.avatarUrl || undefined,
    role: user.role,
    roleId: user.roleId ? String(user.roleId) : undefined,
    roleName,
    designationName,
    permissions,
    mustChangePassword: mustChange,
    createdAt: u.createdAt ? u.createdAt.toISOString() : undefined,
  };
}

export async function register(input: RegisterInput): Promise<{ user: AuthUser; tokens: AuthTokens }> {
  const existing = await User.findOne({ email: input.email }).lean();
  if (existing) {
    throw new ApiError(409, 'Email already registered');
  }

  const hashedPassword = await bcrypt.hash(input.password, SALT_ROUNDS);
  const user = await User.create({
    email: input.email,
    password: hashedPassword,
    name: input.name,
    role: input.role ?? 'user',
  });

  const tokens = signTokens(user._id.toString());
  const authUser = await toAuthUser(user);
  return { user: authUser, tokens };
}

export async function login(input: LoginInput): Promise<{ user: AuthUser; tokens: AuthTokens }> {
  const user = await User.findOne({ email: input.email }).select('+password').lean();
  if (!user) {
    throw new ApiError(401, 'Invalid email or password');
  }
  const u = user as { enabled?: boolean };
  if (u.enabled === false) {
    throw new ApiError(401, 'Account is disabled');
  }

  const match = await bcrypt.compare(input.password, user.password);
  if (!match) {
    throw new ApiError(401, 'Invalid email or password');
  }

  const tokens = signTokens(user._id.toString());
  const authUser = await toAuthUser(user as unknown as IUser & { roleId?: unknown; mustChangePassword?: boolean });
  return { user: authUser, tokens };
}

export async function refresh(refreshToken: string): Promise<{ user: AuthUser; tokens: AuthTokens }> {
  const decoded = jwt.verify(refreshToken, env.jwtSecret) as { sub?: string; type?: string };
  if (decoded.type !== 'refresh' || !decoded.sub) {
    throw new ApiError(401, 'Invalid refresh token');
  }

  const user = await User.findById(decoded.sub).lean();
  if (!user) {
    throw new ApiError(401, 'User not found');
  }
  const u = user as { enabled?: boolean };
  if (u.enabled === false) {
    throw new ApiError(401, 'Account is disabled');
  }

  const tokens = signTokens(user._id.toString());
  const authUser = await toAuthUser(user as unknown as IUser & { roleId?: unknown; mustChangePassword?: boolean });
  return { user: authUser, tokens };
}

export async function me(userId: string): Promise<AuthUser> {
  const user = await User.findById(userId).lean();
  if (!user) throw new ApiError(401, 'User not found');
  const u = user as { enabled?: boolean };
  if (u.enabled === false) {
    throw new ApiError(401, 'Account is disabled');
  }
  return toAuthUser(user as unknown as IUser & { roleId?: unknown; designation?: unknown; mustChangePassword?: boolean });
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<AuthUser> {
  const user = await User.findById(userId).select('+password').lean();
  if (!user) throw new ApiError(401, 'User not found');
  const match = await bcrypt.compare(currentPassword, user.password);
  if (!match) throw new ApiError(401, 'Current password is incorrect');
  const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await User.findByIdAndUpdate(userId, {
    $set: { password: hashed, mustChangePassword: false },
    $unset: { passwordResetToken: 1, passwordResetExpires: 1 },
  });
  const updated = await User.findById(userId).lean();
  if (!updated) throw new ApiError(500, 'User not found after update');
  return toAuthUser(updated as unknown as IUser & { roleId?: unknown; mustChangePassword?: boolean });
}

export async function forgotPassword(email: string): Promise<void> {
  const user = await User.findOne({ email: email.toLowerCase().trim() }).lean();
  if (!user) return;
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 60 * 60 * 1000);
  await User.findByIdAndUpdate(user._id, {
    $set: { passwordResetToken: token, passwordResetExpires: expires },
  });
  const resetLink = `${env.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
  await sendForgotPasswordEmail(user.email, {
    name: user.name,
    appUrl: env.appUrl,
    resetLink,
  }).catch((err) => console.error('Failed to send forgot password email:', err));
}

export async function resetPassword(token: string, newPassword: string): Promise<AuthUser> {
  const user = await User.findOne({
    passwordResetToken: token,
    passwordResetExpires: { $gt: new Date() },
  })
    .select('+password +passwordResetToken +passwordResetExpires')
    .lean();
  if (!user) throw new ApiError(400, 'Invalid or expired reset token');
  const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await User.findByIdAndUpdate(user._id, {
    $set: { password: hashed, mustChangePassword: false },
    $unset: { passwordResetToken: 1, passwordResetExpires: 1 },
  });
  const updated = await User.findById(user._id).lean();
  if (!updated) throw new ApiError(500, 'User not found after update');
  return toAuthUser(updated as unknown as IUser & { roleId?: unknown; designation?: unknown; mustChangePassword?: boolean });
}

export async function updateProfile(
  userId: string,
  input: { name?: string; avatarUrl?: string }
): Promise<AuthUser> {
  const user = await User.findById(userId).lean();
  if (!user) throw new ApiError(401, 'User not found');
  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.avatarUrl !== undefined) update.avatarUrl = input.avatarUrl === '' ? null : input.avatarUrl;
  if (Object.keys(update).length === 0) {
    return toAuthUser(user as unknown as IUser & { roleId?: unknown; designation?: unknown; mustChangePassword?: boolean });
  }
  const updated = await User.findByIdAndUpdate(userId, { $set: update }, { new: true }).lean();
  if (!updated) throw new ApiError(500, 'User not found after update');
  return toAuthUser(updated as unknown as IUser & { roleId?: unknown; designation?: unknown; mustChangePassword?: boolean });
}

type MicrosoftTokenResponse = {
  token_type?: string;
  scope?: string;
  expires_in?: number;
  ext_expires_in?: number;
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
};

type MicrosoftUserInfo = {
  sub?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  preferred_username?: string;
  picture?: string;
};

export async function microsoftSso(input: MicrosoftSsoInput): Promise<{ user: AuthUser; tokens: AuthTokens }> {
  ensureMicrosoftConfigured();
  const code = input.code;
  const redirectUri = input.redirectUri || env.azureRedirectUri || env.appUrl;

  const params = new URLSearchParams();
  params.set('client_id', env.azureAdClientId);
  params.set('client_secret', env.azureAdClientSecret);
  params.set('grant_type', 'authorization_code');
  params.set('code', code);
  params.set('redirect_uri', redirectUri);
  params.set('scope', 'openid profile email offline_access');

  const tokenRes = await fetchJson<MicrosoftTokenResponse>(env.msTokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!tokenRes.ok || !tokenRes.data?.access_token) {
    const msg = tokenRes.data?.error_description || tokenRes.data?.error || tokenRes.text || 'Token exchange failed';
    throw new ApiError(401, `Microsoft SSO failed: ${msg}`);
  }

  const userInfoRes = await fetchJson<MicrosoftUserInfo>(env.msUserInfoEndpoint, {
    headers: { Authorization: `Bearer ${tokenRes.data.access_token}` },
  });
  if (!userInfoRes.ok || !userInfoRes.data) {
    throw new ApiError(401, 'Microsoft SSO failed: could not fetch user profile');
  }

  const rawEmail = (userInfoRes.data.email || userInfoRes.data.preferred_username || '').toLowerCase().trim();
  if (!rawEmail || !rawEmail.includes('@')) {
    throw new ApiError(400, 'Microsoft SSO failed: email not returned by Microsoft');
  }

  let user: any = await User.findOne({ email: rawEmail }).lean();

  if (!user) {
    if (env.maxUsers !== null) {
      const count = await User.countDocuments();
      if (count >= env.maxUsers) {
        throw new ApiError(403, 'User limit reached. Cannot create new user via SSO.');
      }
    }

    const displayName =
      (userInfoRes.data.name || '').trim() ||
      `${userInfoRes.data.given_name ?? ''} ${userInfoRes.data.family_name ?? ''}`.trim() ||
      rawEmail.split('@')[0];

    const randomPassword = crypto.randomBytes(32).toString('hex');
    const hashedPassword = await bcrypt.hash(randomPassword, SALT_ROUNDS);

    const created = await User.create({
      email: rawEmail,
      password: hashedPassword,
      name: displayName,
      avatarUrl: userInfoRes.data.picture || null,
      role: 'user',
      mustChangePassword: false,
    });
    user = created;
  } else {
    const u = user as { enabled?: boolean };
    if (u.enabled === false) throw new ApiError(401, 'Account is disabled');

    // Keep profile up to date (non-destructive).
    const update: Record<string, unknown> = {};
    const nextName = (userInfoRes.data.name || '').trim();
    if (nextName && user.name !== nextName) update.name = nextName;
    const nextAvatar = (userInfoRes.data.picture || '').trim();
    if (nextAvatar && user.avatarUrl !== nextAvatar) update.avatarUrl = nextAvatar;
    if (Object.keys(update).length > 0) {
      await User.findByIdAndUpdate(user._id, { $set: update }).lean();
      user = await User.findById(user._id).lean();
    }
  }

  if (!user) throw new ApiError(500, 'User not found after SSO');
  const tokens = signTokens(String(user._id));
  const authUser = await toAuthUser(user as any);
  return { user: authUser, tokens };
}

export async function microsoftSsoAuthorizeUrl(input: { redirectUri?: string } = {}): Promise<{ url: string; state: string }> {
  ensureMicrosoftConfigured();

  const redirectUri = input.redirectUri || env.azureRedirectUri || env.appUrl;
  const tenantId = env.azureAdTenantId || 'common';

  const state = crypto.randomBytes(18).toString('hex');
  const url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize`);
  url.searchParams.set('client_id', env.azureAdClientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', 'openid profile email offline_access');
  url.searchParams.set('state', state);

  return { url: url.toString(), state };
}
