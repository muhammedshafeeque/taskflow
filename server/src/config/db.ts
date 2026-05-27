import mongoose from 'mongoose';
import { env } from './env';
import { migrateNotificationSchemaIfNeeded } from '../migrations/migrateNotificationSchema';
import { migrateTaskNotificationEmailDefaultsIfNeeded } from '../migrations/migrateTaskNotificationEmailDefaults';
import { migrateFixVersionToArrayIfNeeded } from '../migrations/migrateFixVersionToArray';
import { migrateOrganizationTenancyIfNeeded } from '../migrations/migrateOrganizationTenancy';
import { migrateUserOAuthIndexesIfNeeded } from '../migrations/migrateUserOAuthIndexes';
import '../modules/projects/projectDesignation.model';
import '../modules/organizations/organization.model';
import '../modules/organizations/organizationMember.model';
import '../modules/auth/user.model';

export async function connectDb(): Promise<void> {
  await mongoose.connect(env.mongodbUri);
  console.log('Connected to MongoDB');
  await migrateNotificationSchemaIfNeeded().catch((e) => console.error('[migrate] notifications failed:', e));
  await migrateTaskNotificationEmailDefaultsIfNeeded().catch((e) =>
    console.error('[migrate] task notification email defaults failed:', e)
  );
  await migrateFixVersionToArrayIfNeeded().catch((e) =>
    console.error('[migrate] fixVersion to array failed:', e)
  );
  await migrateOrganizationTenancyIfNeeded().catch((e) => console.error('[migrate] organizations failed:', e));
  await migrateUserOAuthIndexesIfNeeded().catch((e) => console.error('[migrate] users OAuth indexes failed:', e));
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
