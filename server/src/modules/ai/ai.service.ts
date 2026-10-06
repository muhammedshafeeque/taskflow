import mongoose from 'mongoose';
import { Issue } from '../issues/issue.model';
import { Comment } from '../comments/comment.model';
import { Project } from '../projects/project.model';
import { Sprint } from '../sprints/sprint.model';
import { ServiceTicket } from '../service-desk/models/serviceTicket.model';
import { KbArticle } from '../service-desk/models/kbArticle.model';
import { getClosedStatusNamesFromStatuses } from '../projects/statusClassification';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { ApiError } from '../../utils/ApiError';
import { aiComplete, aiJson } from '../../services/ai.service';

/** TipTap/HTML → plain text, collapsed, so prompts stay small. */
export function plain(html: unknown, max = 4000): string {
  return String(html ?? '')
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
    .slice(0, max);
}

const STOP = new Set(
  'the a an and or to of in on for with is are was be it this that when not can cannot from at by as we our you your i my me please issue bug task fix add update need'.split(
    ' '
  )
);

export function tokens(text: string): Set<string> {
  return new Set(
    plain(text, 8000)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

// ── Issues ────────────────────────────────────────────────────────────────

export async function summarizeIssue(issueId: string): Promise<{ summary: string }> {
  const issue = await Issue.findById(issueId).populate('assignee', 'name').populate('reporter', 'name').lean();
  if (!issue) throw new ApiError(404, 'Issue not found');
  const comments = await Comment.find({ issue: issueId })
    .sort({ createdAt: 1 })
    .limit(60)
    .populate('author', 'name')
    .lean();
  const thread = comments
    .map((c) => `- ${(c.author as { name?: string } | null)?.name ?? 'Someone'}: ${plain(c.body, 800)}`)
    .join('\n');
  const summary = await aiComplete({
    system:
      'You summarise software work items for a busy team. Write concise Markdown: a one-line TL;DR, then "Current state", "Decisions", and "Open questions / next steps" as short bullet lists. Only use facts from the input; say "None" for empty sections.',
    user: `Issue ${issue.key ?? ''}: ${issue.title}
Type: ${issue.type} · Status: ${issue.status} · Priority: ${issue.priority}
Assignee: ${(issue.assignee as { name?: string } | null)?.name ?? 'Unassigned'} · Reporter: ${(issue.reporter as { name?: string } | null)?.name ?? '?'}
Due: ${issue.dueDate ? new Date(issue.dueDate).toDateString() : 'none'}

Description:
${plain(issue.description) || '(empty)'}

Comments (${comments.length}):
${thread || '(none)'}`,
    maxTokens: 1500,
  });
  return { summary };
}

export async function findSimilarIssues(
  projectId: string,
  text: string,
  excludeId?: string
): Promise<Array<{ _id: string; key?: string; title: string; status: string; score: number }>> {
  const target = tokens(text);
  if (target.size < 2) return [];
  const candidates = await Issue.find({
    project: new mongoose.Types.ObjectId(projectId),
    ...(excludeId ? { _id: { $ne: new mongoose.Types.ObjectId(excludeId) } } : {}),
  })
    .select('key title description status')
    .sort({ updatedAt: -1 })
    .limit(1500)
    .lean();
  return candidates
    .map((c) => {
      const titleScore = jaccard(target, tokens(c.title));
      const bodyScore = jaccard(target, tokens(`${c.title} ${plain(c.description, 1500)}`));
      return { _id: String(c._id), key: c.key, title: c.title, status: c.status, score: Math.max(titleScore * 1.2, bodyScore) };
    })
    .filter((c) => c.score >= 0.18)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((c) => ({ ...c, score: Math.round(Math.min(1, c.score) * 100) / 100 }));
}

export type IssueDraft = {
  title: string;
  description: string;
  type: string;
  priority: string;
  labels: string[];
  checklist: string[];
};

export async function draftIssue(projectId: string, text: string): Promise<IssueDraft> {
  const project = await Project.findById(projectId).select('name issueTypes priorities').lean();
  if (!project) throw new ApiError(404, 'Project not found');
  const types = ((project.issueTypes ?? []) as Array<{ name: string }>).map((t) => t.name);
  const priorities = ((project.priorities ?? []) as Array<{ name: string }>).map((p) => p.name);
  const typeList = types.length ? types : ['Task', 'Bug', 'Story'];
  const prioList = priorities.length ? priorities : ['Low', 'Medium', 'High', 'Critical'];
  const draft = await aiJson<Partial<IssueDraft>>({
    system: `You turn rough notes into a well-formed work item for project "${project.name}".
Return JSON: {"title": string (imperative, <= 90 chars), "description": string (Markdown with "Context", and for bugs "Steps to reproduce"/"Expected"/"Actual", otherwise "Acceptance criteria"), "type": one of ${JSON.stringify(typeList)}, "priority": one of ${JSON.stringify(prioList)}, "labels": string[] (0-3, lowercase-kebab), "checklist": string[] (0-6 concrete steps)}.
Do not invent facts that are not implied by the notes.`,
    user: text.slice(0, 6000),
    maxTokens: 2000,
  });
  return {
    title: String(draft.title ?? '').slice(0, 200) || text.slice(0, 90),
    description: String(draft.description ?? ''),
    type: typeList.includes(String(draft.type)) ? String(draft.type) : typeList[0],
    priority: prioList.includes(String(draft.priority)) ? String(draft.priority) : prioList[Math.min(1, prioList.length - 1)],
    labels: Array.isArray(draft.labels) ? draft.labels.map(String).slice(0, 3) : [],
    checklist: Array.isArray(draft.checklist) ? draft.checklist.map(String).slice(0, 6) : [],
  };
}

// ── Sprints ───────────────────────────────────────────────────────────────

export async function sprintRetro(sprintId: string): Promise<{ retro: string; stats: Record<string, number> }> {
  const sprint = await Sprint.findById(sprintId).lean();
  if (!sprint) throw new ApiError(404, 'Sprint not found');
  const project = await Project.findById(sprint.project).select('name statuses').lean();
  const closed = new Set(getClosedStatusNamesFromStatuses(project?.statuses));
  const issues = await Issue.find({ sprint: sprint._id })
    .select('key title type status priority storyPoints dueDate assignee')
    .populate('assignee', 'name')
    .lean();
  const done = issues.filter((i) => closed.has(i.status));
  const notDone = issues.filter((i) => !closed.has(i.status));
  const points = (list: typeof issues) => list.reduce((s, i) => s + (i.storyPoints ?? 0), 0);
  const bugs = issues.filter((i) => /bug|defect/i.test(i.type)).length;
  const stats = {
    committed: issues.length,
    completed: done.length,
    carriedOver: notDone.length,
    pointsCommitted: points(issues),
    pointsCompleted: points(done),
    bugs,
  };
  const line = (i: (typeof issues)[number]) =>
    `- ${i.key ?? ''} [${i.type}/${i.priority}] ${i.title} — ${i.status}${i.storyPoints ? ` (${i.storyPoints}pt)` : ''}${
      (i.assignee as { name?: string } | null)?.name ? ` @${(i.assignee as { name?: string }).name}` : ''
    }`;
  const retro = await aiComplete({
    system:
      'You facilitate agile retrospectives. From the sprint data, draft Markdown with: "Summary" (2-3 sentences with the numbers), "What went well", "What didn\'t go well", "Carry-over", and "Suggested actions" (3-5 specific, owner-less actions). Base everything on the data; do not invent events.',
    user: `Sprint "${sprint.name}" in ${project?.name ?? 'project'} (${sprint.startDate ? new Date(sprint.startDate).toDateString() : '?'} → ${
      sprint.endDate ? new Date(sprint.endDate).toDateString() : '?'
    }), status ${sprint.status}.
Stats: ${JSON.stringify(stats)}

Completed:
${done.slice(0, 80).map(line).join('\n') || '(none)'}

Not completed:
${notDone.slice(0, 80).map(line).join('\n') || '(none)'}`,
    maxTokens: 2000,
  });
  return { retro, stats };
}

// ── Service desk ──────────────────────────────────────────────────────────

export async function suggestTicketReply(
  ticketId: string,
  workspaceId: string | null | undefined
): Promise<{ reply: string; articles: Array<{ _id: string; title: string }> }> {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const ticket = await ServiceTicket.findOne({ _id: ticketId, taskflowOrganizationId: orgOid }).lean();
  if (!ticket) throw new ApiError(404, 'Ticket not found');

  // Pick the most relevant published KB articles by keyword overlap.
  const query = tokens(`${ticket.subject} ${ticket.description ?? ''}`);
  const kb = await KbArticle.find({ taskflowOrganizationId: orgOid, published: true })
    .select('title body category')
    .limit(300)
    .lean();
  const ranked = kb
    .map((a) => ({ a, score: jaccard(query, tokens(`${a.title} ${a.title} ${plain(a.body, 3000)}`)) }))
    .filter((x) => x.score > 0.04)
    .sort((x, y) => y.score - x.score)
    .slice(0, 3)
    .map((x) => x.a);

  const thread = (ticket.comments ?? [])
    .slice(-20)
    .map((c) => `- ${c.internal ? '[internal] ' : ''}${c.authorName ?? 'Agent'}: ${plain(c.body, 800)}`)
    .join('\n');
  const reply = await aiComplete({
    system:
      'You are a friendly, precise support agent. Draft the next reply to the customer (plain text, no subject line, 60-180 words). Use the knowledge-base excerpts when relevant and do not promise dates or fixes that are not in the input. Internal notes are context only — never quote them. End by inviting the customer to reply if anything is unclear.',
    user: `Ticket: ${ticket.subject}
Priority: ${ticket.priority} · Status: ${ticket.status}
Description:
${plain(ticket.description) || '(empty)'}

Conversation so far:
${thread || '(no replies yet)'}

Knowledge base:
${ranked.map((a, i) => `[${i + 1}] ${a.title}\n${plain(a.body, 1500)}`).join('\n\n') || '(no matching articles)'}`,
    maxTokens: 1200,
  });
  return { reply, articles: ranked.map((a) => ({ _id: String(a._id), title: a.title })) };
}
