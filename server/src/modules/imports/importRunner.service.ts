import { ImportJob } from './importJob.model';
import { runAzureDevOpsImport } from './azureDevOpsImport.service';
import { runCsvImport } from './csvImport.service';
import { runJiraImport } from './jiraImport.service';

export async function runImportJob(jobId: string): Promise<void> {
  const job = await ImportJob.findById(jobId);
  if (!job) return;

  await ImportJob.findByIdAndUpdate(jobId, { status: 'running', progress: 'Starting import…' });

  try {
    const projectId = String(job.project);
    const opts = (job.options ?? {}) as Record<string, unknown>;
    const reporterEmail = String(opts.reporterEmail ?? '');
    const dryRun = !!job.dryRun;

    let result: unknown;
    if (job.source === 'ado') {
      await ImportJob.findByIdAndUpdate(jobId, { progress: 'Fetching Azure DevOps work items…' });
      result = await runAzureDevOpsImport(projectId, {
        reporterEmail,
        dryRun,
        skipExisting: !!opts.skipExisting,
        org: opts.org != null ? String(opts.org) : undefined,
        adoProject: opts.adoProject != null ? String(opts.adoProject) : undefined,
        pat: opts.pat != null ? String(opts.pat) : undefined,
        wiql: opts.wiql != null ? String(opts.wiql) : undefined,
      });
    } else if (job.source === 'csv') {
      await ImportJob.findByIdAndUpdate(jobId, { progress: 'Parsing CSV…' });
      result = await runCsvImport(projectId, {
        reporterEmail,
        dryRun,
        skipExisting: !!opts.skipExisting,
        csvContent: String(opts.csvContent ?? ''),
        externalIdColumn: opts.externalIdColumn != null ? String(opts.externalIdColumn) : undefined,
      });
    } else if (job.source === 'jira') {
      await ImportJob.findByIdAndUpdate(jobId, { progress: 'Fetching Jira issues…' });
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
    } else {
      throw new Error(`Unknown import source: ${job.source}`);
    }

    await ImportJob.findByIdAndUpdate(jobId, {
      status: 'completed',
      progress: 'Done',
      result,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await ImportJob.findByIdAndUpdate(jobId, {
      status: 'failed',
      error: message,
      progress: 'Failed',
    });
  }
}

export function scheduleImportJob(jobId: string): void {
  setImmediate(() => {
    void runImportJob(jobId);
  });
}
