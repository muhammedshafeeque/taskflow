import mongoose from 'mongoose';
import { User } from '../auth/user.model';
import { Organization } from '../organizations/organization.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { ApiError } from '../../utils/ApiError';

/** Display name for the PA's non-human actor (audit log, comments, ticket history). */
export const PA_ACTOR_LABEL = 'WhatsApp PA';

export type PaServiceAccount = { id: string; email: string; name: string };

const cache = new Map<string, Promise<PaServiceAccount>>();

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number })?.code === 11000;
}

/** `.invalid` is a reserved TLD, so this address can never receive mail or match an SSO identity. */
function serviceEmail(organizationId: string): string {
  return `pa+${organizationId}@service.atrium.invalid`;
}

/**
 * The PA's system user for one workspace, created on first use. It has no
 * password, cannot sign in, and is hidden from user lists; its effective
 * permissions are decided per request by internal auth, never stored.
 */
export function ensurePaServiceAccount(organizationId: string): Promise<PaServiceAccount> {
  // Concurrent first requests share one creation.
  let pending = cache.get(organizationId);
  if (!pending) {
    pending = createPaServiceAccount(organizationId).catch(async (err) => {
      // Another API instance won the upsert race — the row exists now.
      if (isDuplicateKey(err)) return createPaServiceAccount(organizationId);
      throw err;
    });
    cache.set(organizationId, pending);
    pending.catch(() => cache.delete(organizationId));
  }
  return pending;
}

async function createPaServiceAccount(organizationId: string): Promise<PaServiceAccount> {
  const email = serviceEmail(organizationId);
  const user = await User.findOneAndUpdate(
    { email },
    {
      $setOnInsert: {
        email,
        name: PA_ACTOR_LABEL,
        role: 'user',
        enabled: true,
        mustChangePassword: false,
        password: null,
        isServiceAccount: true,
        serviceKind: 'pa',
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  )
    .select('_id email name')
    .lean();
  if (!user) throw new ApiError(500, 'Could not create the PA service account');

  // Membership makes org-scoped lookups (audit scope, sockets, pickers) treat it like staff.
  await OrganizationMember.updateOne(
    { organization: organizationId, user: user._id },
    { $setOnInsert: { organization: organizationId, user: user._id, role: 'org_member', status: 'active' } },
    { upsert: true }
  );

  return { id: String(user._id), email: user.email, name: user.name };
}

/**
 * Workspace the PA works in when the caller does not name one: PA_DEFAULT_ORG_ID,
 * else the oldest active workspace (single-company installs need no setting).
 */
export async function resolveDefaultOrganizationId(): Promise<string> {
  const configured = String(process.env.PA_DEFAULT_ORG_ID ?? '').trim();
  if (configured && mongoose.Types.ObjectId.isValid(configured)) {
    if (await Organization.exists({ _id: configured, status: { $ne: 'archived' } })) return configured;
    console.warn('[pa] PA_DEFAULT_ORG_ID does not match an active workspace — using the oldest one');
  }
  const org = await Organization.findOne({ status: { $ne: 'archived' } })
    .sort({ createdAt: 1 })
    .select('_id')
    .lean();
  if (!org) throw new ApiError(503, 'No Atrium workspace exists yet — create one first');
  return String(org._id);
}

export function resetPaServiceAccountCacheForTests(): void {
  cache.clear();
}
