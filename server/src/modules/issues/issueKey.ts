/**
 * Issue keys (AUT-66). A key is "<project key>-<number>" and is unique within its project. Project keys
 * are unique only within a workspace, so two workspaces can both have a "PC-18".
 *
 * The number comes from the project's counter. If that key is already taken in the project (e.g. issues
 * imported with their own keys put the counter behind), the next number is tried instead of failing.
 */
import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { Project } from '../projects/project.model';

const isKeyClash = (err: unknown) => {
  const e = err as { code?: number; keyPattern?: Record<string, unknown>; message?: string };
  return e?.code === 11000 && (Boolean(e.keyPattern && 'key' in e.keyPattern) || /\bkey_1\b|project_1_key_1/.test(String(e.message ?? '')));
};

/**
 * Take the next number from the project's counter and create the issue with that key. Retries with the
 * following number while the key is already used in the project; never more than `attempts` times.
 */
export async function createWithNextKey<T>(
  projectId: unknown,
  create: (key: string, project: { _id: unknown; key: string; nextIssueNumber: number }) => Promise<T>,
  attempts = 25
): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    const project = await Project.findByIdAndUpdate(projectId, { $inc: { nextIssueNumber: 1 } }, { new: true })
      .select('key nextIssueNumber')
      .lean();
    if (!project) throw new ApiError(404, 'Project not found');
    const key = `${project.key}-${project.nextIssueNumber ?? 1}`;
    try {
      return await create(key, project as never);
    } catch (err) {
      if (!isKeyClash(err)) throw err;
      // Taken in this project already: move on to the next number.
    }
  }
  throw new ApiError(409, 'Could not find a free issue number for this project. Please try again or contact an administrator.');
}

/** Find the id of a project in a workspace from its id or its key (any case). Null when not found there. */
export async function resolveProjectRef(ref: unknown, workspaceId: string | null | undefined): Promise<string | null> {
  const value = String(ref ?? '').trim();
  if (!value) return null;
  if (mongoose.isValidObjectId(value) && /^[a-f0-9]{24}$/i.test(value)) return value;
  if (!workspaceId || !mongoose.isValidObjectId(workspaceId)) return null;
  const p = await Project.findOne({ taskflowOrganizationId: new mongoose.Types.ObjectId(workspaceId), key: value.toUpperCase() }).select('_id').lean();
  return p ? String(p._id) : null;
}
