import { Project } from '../../projects/project.model';
import { User } from '../../auth/user.model';
import { ProjectAdoIntegration } from './projectAdoIntegration.model';
import { runAzureDevOpsImport, type AzureDevOpsImportResult } from '../../imports/azureDevOpsImport.service';
import { syncAdoHistoryForProject } from './adoWorkItemHistory.service';

async function resolveReporterEmail(projectId: string): Promise<string> {
  const project = await Project.findById(projectId).populate('lead', 'email').lean();
  const lead = project?.lead as { email?: string } | undefined;
  if (lead?.email) return lead.email.toLowerCase();

  const admin = await User.findOne({ role: 'admin' }).select('email').lean();
  if (admin?.email) return admin.email.toLowerCase();

  throw new Error('No reporter email available for ADO auto sync');
}

export async function runAdoPullSyncForProject(
  projectId: string,
  options: { syncAllHistory?: boolean } = {}
): Promise<AzureDevOpsImportResult & { historyImported?: number }> {
  const reporterEmail = await resolveReporterEmail(projectId);
  const result = await runAzureDevOpsImport(projectId, {
    reporterEmail,
    skipExisting: false,
  });

  let extraHistory = 0;
  if (options.syncAllHistory) {
    extraHistory = await syncAdoHistoryForProject(projectId, undefined, { backfill: true });
  }

  await ProjectAdoIntegration.updateOne(
    { projectId },
    { $set: { lastAutoSyncAt: new Date(), lastSyncedAt: new Date() } }
  );

  return {
    ...result,
    historyImported: result.historyImported + extraHistory,
  };
}

const runningProjects = new Set<string>();
const TICK_MS = 60_000;

async function tickAdoAutoSync(): Promise<void> {
  const integrations = await ProjectAdoIntegration.find({
    enabled: true,
    autoSyncEnabled: true,
  }).lean();

  const now = Date.now();
  for (const integration of integrations) {
    const projectId = String(integration.projectId);
    if (runningProjects.has(projectId)) continue;

    const intervalMin = Math.max(5, integration.autoSyncIntervalMinutes ?? 15);
    const lastMs = integration.lastAutoSyncAt?.getTime() ?? 0;
    if (now - lastMs < intervalMin * 60_000) continue;

    runningProjects.add(projectId);
    try {
      const result = await runAdoPullSyncForProject(projectId);
      console.log(
        `[ado-auto-sync] project=${projectId} created=${result.created} updated=${result.updated} skipped=${result.skippedExisting}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ado-auto-sync] project=${projectId} failed: ${message}`);
    } finally {
      runningProjects.delete(projectId);
    }
  }
}

export function startAdoAutoSyncScheduler(): void {
  setInterval(() => {
    void tickAdoAutoSync();
  }, TICK_MS);
  console.log('[ado-auto-sync] scheduler started (checks every 60s)');
}
