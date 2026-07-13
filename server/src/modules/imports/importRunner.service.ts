import { ImportJob } from './importJob.model';
import { runAzureDevOpsImport } from './azureDevOpsImport.service';
import { runCsvImport } from './csvImport.service';
import { runJiraImport } from './jiraImport.service';

async function appendImportLog(jobId: string, message: string): Promise<void> {
  const ts = new Date().toISOString().slice(11, 19);
  const line = `[${ts}] ${message}`;
  await ImportJob.findByIdAndUpdate(jobId, {
    $set: { progress: message },
    $push: { logs: { $each: [line], $slice: -300 } },
  });
}

export async function runImportJob(jobId: string): Promise<void> {
  const job = await ImportJob.findById(jobId);
  if (!job) return;

  await appendImportLog(jobId, 'Starting import…');
  await ImportJob.findByIdAndUpdate(jobId, { status: 'running' });

  try {
    const projectId = String(job.project);
    const opts = (job.options ?? {}) as Record<string, unknown>;
    const reporterEmail = String(opts.reporterEmail ?? '');
    const dryRun = !!job.dryRun;
    const onProgress = (message: string) => appendImportLog(jobId, message);

    let result: unknown;
    if (job.source === 'ado') {
      result = await runAzureDevOpsImport(projectId, {
        reporterEmail,
        dryRun,
        skipExisting: !!opts.skipExisting,
        org: opts.org != null ? String(opts.org) : undefined,
        adoProject: opts.adoProject != null ? String(opts.adoProject) : undefined,
        pat: opts.pat != null ? String(opts.pat) : undefined,
        wiql: opts.wiql != null ? String(opts.wiql) : undefined,
        onProgress,
      });
    } else if (job.source === 'csv') {
      await appendImportLog(jobId, 'Parsing CSV…');
      result = await runCsvImport(projectId, {
        reporterEmail,
        dryRun,
        skipExisting: !!opts.skipExisting,
        csvContent: String(opts.csvContent ?? ''),
        externalIdColumn: opts.externalIdColumn != null ? String(opts.externalIdColumn) : undefined,
      });
      await appendImportLog(jobId, 'CSV import finished.');
    } else if (job.source === 'jira') {
      await appendImportLog(jobId, 'Fetching Jira issues…');
      result = await runJiraImport(projectId, {
        reporterEmail,
        dryRun,
        skipExisting: !!opts.skipExisting,
        jql: opts.jql != null ? String(opts.jql) : undefined,
        baseUrl: opts.baseUrl != null ? String(opts.baseUrl) : undefined,
        email: opts.email != null ? String(opts.email) : undefined,
        apiToken: opts.apiToken != null ? String(opts.apiToken) : undefined,
        jiraProjectKey: opts.jiraProjectKey != null ? String(opts.jiraProjectKey) : undefined,
      });
      await appendImportLog(jobId, 'Jira import finished.');
    } else {
      throw new Error(`Unknown import source: ${job.source}`);
    }

    await ImportJob.findByIdAndUpdate(jobId, {
      status: 'completed',
      progress: 'Done',
      result,
    });
    await appendImportLog(jobId, 'Import completed successfully.');
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await ImportJob.findByIdAndUpdate(jobId, {
      status: 'failed',
      error: message,
      progress: 'Failed',
    });
    await appendImportLog(jobId, `Import failed: ${message}`);
  }
}

export function scheduleImportJob(jobId: string): void {
  setImmediate(() => {
    void runImportJob(jobId);
  });
}
