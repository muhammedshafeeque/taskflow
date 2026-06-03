import { Request, Response } from 'express';
import mongoose from 'mongoose';
import type { AuthPayload } from '../../types/express';
import { ApiError } from '../../utils/ApiError';
import { ProjectMember } from '../projects/projectMember.model';
import { ImportJob } from './importJob.model';
import { scheduleImportJob } from './importRunner.service';
import { runAzureDevOpsImport } from './azureDevOpsImport.service';
import { runCsvImport } from './csvImport.service';
import { runJiraImport } from './jiraImport.service';

async function assertProjectMember(projectId: string, userId: string): Promise<void> {
  const member = await ProjectMember.exists({
    project: projectId,
    user: new mongoose.Types.ObjectId(userId),
  });
  if (!member) throw new ApiError(403, 'Access denied');
}

export async function startImport(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const projectId = req.params.id;
  await assertProjectMember(projectId, userId);

  const { source, dryRun, skipExisting, reporterEmail, options, csvContent } = req.body as {
    source: 'ado' | 'csv' | 'jira';
    dryRun?: boolean;
    skipExisting?: boolean;
    reporterEmail: string;
    options?: Record<string, unknown>;
    csvContent?: string;
  };

  const mergedOptions: Record<string, unknown> = { ...(options ?? {}), reporterEmail, skipExisting };
  if (source === 'csv' && csvContent) mergedOptions.csvContent = csvContent;

  if (dryRun) {
    let preview: unknown;
    if (source === 'ado') {
      preview = await runAzureDevOpsImport(projectId, {
        reporterEmail,
        dryRun: true,
        skipExisting,
        org: mergedOptions.org != null ? String(mergedOptions.org) : undefined,
        adoProject: mergedOptions.adoProject != null ? String(mergedOptions.adoProject) : undefined,
        pat: mergedOptions.pat != null ? String(mergedOptions.pat) : undefined,
        wiql: mergedOptions.wiql != null ? String(mergedOptions.wiql) : undefined,
      });
    } else if (source === 'csv') {
      preview = await runCsvImport(projectId, {
        reporterEmail,
        dryRun: true,
        skipExisting,
        csvContent: String(mergedOptions.csvContent ?? ''),
      });
    } else {
      preview = await runJiraImport(projectId, {
        reporterEmail,
        dryRun: true,
        skipExisting,
        jql: mergedOptions.jql != null ? String(mergedOptions.jql) : undefined,
        baseUrl: mergedOptions.baseUrl != null ? String(mergedOptions.baseUrl) : undefined,
        email: mergedOptions.email != null ? String(mergedOptions.email) : undefined,
        apiToken: mergedOptions.apiToken != null ? String(mergedOptions.apiToken) : undefined,
        jiraProjectKey:
          mergedOptions.jiraProjectKey != null ? String(mergedOptions.jiraProjectKey) : undefined,
      });
    }
    res.status(200).json({ success: true, data: { dryRun: true, preview } });
    return;
  }

  const job = await ImportJob.create({
    project: projectId,
    user: userId,
    source,
    dryRun: false,
    options: mergedOptions,
    status: 'pending',
    progress: 'Queued',
  });

  scheduleImportJob(String(job._id));

  res.status(202).json({
    success: true,
    data: {
      jobId: String(job._id),
      status: job.status,
    },
  });
}

export async function getImportJob(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const projectId = req.params.id;
  await assertProjectMember(projectId, userId);

  const job = await ImportJob.findOne({
    _id: req.params.jobId,
    project: projectId,
  }).lean();
  if (!job) throw new ApiError(404, 'Import job not found');

  res.status(200).json({
    success: true,
    data: {
      jobId: String(job._id),
      source: job.source,
      status: job.status,
      dryRun: job.dryRun,
      progress: job.progress,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    },
  });
}
