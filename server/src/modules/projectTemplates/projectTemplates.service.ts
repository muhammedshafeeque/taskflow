import mongoose from 'mongoose';
import { ProjectTemplate } from './projectTemplate.model';

const DEFAULT_STATUSES = [
  { id: 'backlog', name: 'Backlog', order: 0 },
  { id: 'todo', name: 'Todo', order: 1 },
  { id: 'inprogress', name: 'In Progress', order: 2 },
  { id: 'done', name: 'Done', order: 3 },
];

const DEFAULT_ISSUE_TYPES = [
  { id: 'task', name: 'Task', order: 0 },
  { id: 'bug', name: 'Bug', order: 1 },
  { id: 'story', name: 'Story', order: 2 },
  { id: 'epic', name: 'Epic', order: 3 },
];

const DEFAULT_PRIORITIES = [
  { id: 'lowest', name: 'Lowest', order: 0 },
  { id: 'low', name: 'Low', order: 1 },
  { id: 'medium', name: 'Medium', order: 2 },
  { id: 'high', name: 'High', order: 3 },
  { id: 'highest', name: 'Highest', order: 4 },
];

export async function list(): Promise<unknown[]> {
  const dbList = await ProjectTemplate.find().sort({ name: 1 }).lean();
  const defaultConfig = getDefaultConfig();
  const builtIn = {
    _id: 'default',
    name: 'Built-in default',
    description: 'Standard backlog workflow, issue types, and priorities',
    statuses: defaultConfig.statuses,
    issueTypes: defaultConfig.issueTypes,
    priorities: defaultConfig.priorities,
  };
  return [builtIn, ...dbList];
}

export async function getById(templateId: string): Promise<unknown | null> {
  if (templateId === 'default') {
    const config = getDefaultConfig();
    return { _id: 'default', name: 'Default', description: '', ...config };
  }
  const doc = await ProjectTemplate.findById(templateId).lean();
  return doc;
}

export function getDefaultConfig(): {
  statuses: typeof DEFAULT_STATUSES;
  issueTypes: typeof DEFAULT_ISSUE_TYPES;
  priorities: typeof DEFAULT_PRIORITIES;
} {
  return {
    statuses: DEFAULT_STATUSES,
    issueTypes: DEFAULT_ISSUE_TYPES,
    priorities: DEFAULT_PRIORITIES,
  };
}

export async function createTemplateRecord(input: {
  name: string;
  description?: string;
  statuses: unknown[];
  issueTypes: unknown[];
  priorities: unknown[];
}): Promise<unknown> {
  const doc = await ProjectTemplate.create({
    name: input.name,
    description: input.description ?? '',
    statuses: input.statuses,
    issueTypes: input.issueTypes,
    priorities: input.priorities,
  });
  return doc.toObject();
}

export async function removeById(id: string): Promise<'not_found' | 'forbidden' | 'ok'> {
  if (id === 'default') return 'forbidden';
  if (!mongoose.Types.ObjectId.isValid(id)) return 'not_found';
  const r = await ProjectTemplate.findByIdAndDelete(id);
  return r ? 'ok' : 'not_found';
}

export async function updateById(
  id: string,
  input: {
    name?: string;
    description?: string;
    statuses?: unknown[];
    issueTypes?: unknown[];
    priorities?: unknown[];
  }
): Promise<'not_found' | 'forbidden' | 'noop' | unknown> {
  if (id === 'default') return 'forbidden';
  if (!mongoose.Types.ObjectId.isValid(id)) return 'not_found';
  const updates: Record<string, unknown> = {};
  if (input.name !== undefined) updates.name = input.name.trim();
  if (input.description !== undefined) updates.description = input.description.trim();
  if (input.statuses !== undefined) updates.statuses = input.statuses;
  if (input.issueTypes !== undefined) updates.issueTypes = input.issueTypes;
  if (input.priorities !== undefined) updates.priorities = input.priorities;
  if (Object.keys(updates).length === 0) return 'noop';
  const doc = await ProjectTemplate.findByIdAndUpdate(id, { $set: updates }, { new: true, runValidators: true }).lean();
  return doc ?? 'not_found';
}
