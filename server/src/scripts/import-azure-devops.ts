/**
 * Import work items from Azure DevOps into a taskfow Project (MongoDB).
 *
 * Usage:
 *   cd server && npm run import-ado -- --taskflow-project PROJ --reporter-email admin@example.com
 *
 * Environment:
 *   MONGODB_URI              — MongoDB connection (same as app)
 *   AZURE_DEVOPS_ORG         — Azure DevOps organization name (dev.azure.com/{org})
 *   AZURE_DEVOPS_PROJECT     — Azure DevOps team project name (source)
 *   AZURE_DEVOPS_PAT         — Personal Access Token (Work Items: Read)
 *   IMPORT_REPORTER_EMAIL    — Optional default for --reporter-email
 *
 * Optional:
 *   DEFAULT_WIQL             — Override default WIQL (single line or use --wiql-file)
 *
 * Flags:
 *   --taskflow-project <idOrKey>  — Required. Destination taskfow project ObjectId or key.
 *   --reporter-email <email>      — User who becomes reporter on every imported issue.
 *   --dry-run                     — Log actions only; no database writes.
 *   --skip-existing               — Skip ADO work items already imported (customFieldValues.adoWorkItemId).
 *   --wiql-file <path>            — File containing WIQL query (overrides DEFAULT_WIQL).
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { runAzureDevOpsImport } from '../modules/imports/azureDevOpsImport.service';

interface CliOptions {
  taskflowProject: string;
  reporterEmail?: string;
  dryRun: boolean;
  skipExisting: boolean;
  wiqlFile?: string;
}

function parseArgs(argv: string[]): CliOptions {
  let taskflowProject = '';
  let reporterEmail: string | undefined;
  let dryRun = false;
  let skipExisting = false;
  let wiqlFile: string | undefined;

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (a === '--skip-existing') {
      skipExisting = true;
      continue;
    }
    if (a === '--taskflow-project' && argv[i + 1]) {
      taskflowProject = argv[++i];
      continue;
    }
    if (a === '--reporter-email' && argv[i + 1]) {
      reporterEmail = argv[++i];
      continue;
    }
    if (a === '--wiql-file' && argv[i + 1]) {
      wiqlFile = argv[++i];
      continue;
    }
    if (a === '--help' || a === '-h') {
      console.log(`
Usage: npm run import-ado -- --taskflow-project <idOrKey> [options]

Options:
  --taskflow-project <idOrKey>  Destination taskfow project (MongoDB id or project key)
  --reporter-email <email>      Reporter user (or IMPORT_REPORTER_EMAIL)
  --dry-run                     No writes
  --skip-existing               Skip items already imported (adoWorkItemId)
  --wiql-file <path>            Custom WIQL query file
`);
      process.exit(0);
    }
  }

  reporterEmail = reporterEmail || process.env.IMPORT_REPORTER_EMAIL?.trim();

  return { taskflowProject, reporterEmail, dryRun, skipExisting, wiqlFile };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  if (!opts.taskflowProject) {
    console.error('Error: --taskflow-project is required.');
    process.exit(1);
  }
  if (!opts.reporterEmail) {
    console.error('Error: --reporter-email or IMPORT_REPORTER_EMAIL is required.');
    process.exit(1);
  }

  const mongoUri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/pm-tool';

  let wiql: string | undefined;
  if (opts.wiqlFile) {
    wiql = fs.readFileSync(path.resolve(opts.wiqlFile), 'utf8').trim();
  } else if (process.env.DEFAULT_WIQL?.trim()) {
    wiql = process.env.DEFAULT_WIQL.trim();
  }

  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB');
  console.log(`Destination project: ${opts.taskflowProject}`);
  console.log(`Reporter: ${opts.reporterEmail}`);
  console.log(opts.dryRun ? 'DRY RUN — no writes' : 'Writing to database');

  const result = await runAzureDevOpsImport(opts.taskflowProject, {
    reporterEmail: opts.reporterEmail,
    dryRun: opts.dryRun,
    skipExisting: opts.skipExisting,
    wiql,
  });

  console.log(JSON.stringify(result, null, 2));
  await mongoose.disconnect();
  console.log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
