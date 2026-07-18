import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';

export function requireWorkspaceId(taskflowOrganizationId: string | null | undefined): string {
  if (!taskflowOrganizationId || !mongoose.Types.ObjectId.isValid(taskflowOrganizationId)) {
    throw new ApiError(400, 'Active workspace required');
  }
  return taskflowOrganizationId;
}

export function toOrgOid(taskflowOrganizationId: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(taskflowOrganizationId);
}
