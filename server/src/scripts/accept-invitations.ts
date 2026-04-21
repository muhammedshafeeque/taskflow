/**
 * Accept pending project invitations in bulk.
 *
 * Args:
 *   --emails / --invited-user-emails   (required) JSON array or CSV
 *   --project-ids / --proct_ids / --project_ids (required) JSON array, CSV, or '*'
 *
 * Examples:
 *   npm run accept-invitations -- --emails='["a@x.com","b@x.com"]' --project-ids='["PROJECT_ID_1","PROJECT_ID_2"]'
 *   npm run accept-invitations -- --emails='a@x.com,b@x.com' --proct_ids='*'
 */
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../config/db';
import { User } from '../modules/auth/user.model';
import { Project } from '../modules/projects/project.model';
import { ProjectInvitation } from '../modules/projects/projectInvitation.model';
import { acceptInvitation } from '../modules/projects/projectInvitations.service';

type CliArgs = Record<string, string | undefined>;

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (const part of argv) {
    if (!part.startsWith('--')) continue;
    const body = part.slice(2);
    const separatorIndex = body.indexOf('=');
    if (separatorIndex === -1) {
      args[body] = 'true';
      continue;
    }
    const key = body.slice(0, separatorIndex);
    const value = body.slice(separatorIndex + 1);
    args[key] = value;
  }
  return args;
}

function parseListArg(raw: string | undefined): string[] {
  if (!raw) return [];
  const input = raw.trim();
  if (!input) return [];

  if (input.startsWith('[') && input.endsWith(']')) {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) {
        return parsed
          .map((value) => (typeof value === 'string' ? value.trim() : String(value).trim()))
          .filter(Boolean);
      }
    } catch {
      // Fallback to CSV parsing.
    }
  }

  return input
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

async function resolveProjectIds(projectIdsInput: string[]): Promise<string[]> {
  const normalized = projectIdsInput.map((value) => value.replace(/\s+/g, ''));
  const hasWildcard = normalized.some((value) => value === '*' || value === '[*]' || value === '["*"]' || value === "['*']");
  if (hasWildcard) {
    const projects = await Project.find({}).select('_id').lean();
    return projects.map((project) => project._id.toString());
  }

  const invalidIds = projectIdsInput.filter((id) => !mongoose.Types.ObjectId.isValid(id));
  if (invalidIds.length > 0) {
    throw new Error(`Invalid project id(s): ${invalidIds.join(', ')}`);
  }

  return projectIdsInput;
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const emailsRaw = args.emails ?? args['invited-user-emails'] ?? args.invited_user_emails;
  const projectIdsRaw = args['project-ids'] ?? args.proct_ids ?? args.project_ids;

  const emails = parseListArg(emailsRaw).map((email) => email.toLowerCase());
  const projectIdsInput = parseListArg(projectIdsRaw);

  if (emails.length === 0) {
    throw new Error('Missing required --emails (or --invited-user-emails) argument.');
  }
  if (projectIdsInput.length === 0) {
    throw new Error('Missing required --project-ids (or --proct_ids / --project_ids) argument.');
  }

  await connectDb();

  const users = await User.find({ email: { $in: emails } }).select('_id email').lean();
  const emailToUserId = new Map(users.map((user) => [user.email.toLowerCase(), user._id.toString()]));

  const missingEmails = emails.filter((email) => !emailToUserId.has(email));
  if (missingEmails.length > 0) {
    console.warn(`Users not found (skipped): ${missingEmails.join(', ')}`);
  }

  const userIds = Array.from(emailToUserId.values());
  if (userIds.length === 0) {
    console.log('No valid users found. Nothing to process.');
    await disconnectDb();
    process.exit(0);
    return;
  }

  const projectIds = await resolveProjectIds(projectIdsInput);
  if (projectIds.length === 0) {
    console.log('No projects found. Nothing to process.');
    await disconnectDb();
    process.exit(0);
    return;
  }

  const invitations = await ProjectInvitation.find({
    user: { $in: userIds.map((id) => new mongoose.Types.ObjectId(id)) },
    project: { $in: projectIds.map((id) => new mongoose.Types.ObjectId(id)) },
    status: 'pending',
  })
    .select('_id user')
    .lean();

  if (invitations.length === 0) {
    console.log('No pending invitations matched your filters.');
    await disconnectDb();
    process.exit(0);
    return;
  }

  let acceptedCount = 0;
  let failedCount = 0;

  for (const invitation of invitations) {
    const invitationId = invitation._id.toString();
    const userId = invitation.user.toString();
    try {
      await acceptInvitation(invitationId, userId);
      acceptedCount += 1;
      console.log(`Accepted invitation ${invitationId}`);
    } catch (error) {
      failedCount += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed invitation ${invitationId}: ${message}`);
    }
  }

  console.log(`Done. Accepted=${acceptedCount}, Failed=${failedCount}`);
  await disconnectDb();
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
