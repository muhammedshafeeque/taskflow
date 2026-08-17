import type { IssueRef } from '../api/issues';
import { stripHtmlLike } from './packetHtml';

export function buildIssuePacket(issue: IssueRef, branch?: string): string {
  const key = issue.key || issue._id;
  const desc = stripHtmlLike(issue.description || '');
  return `# Atrium issue ${key}

Title: ${issue.title}
Status: ${issue.status}
Type: ${issue.type || ''}
Priority: ${issue.priority || ''}
Assignee: ${issue.assignee?.name || 'Unassigned'}
Project: ${issue.project?.name || ''} (${issue.project?.key || ''})
${branch ? `Branch: ${branch}` : ''}

## Description
${desc || '(none)'}

## Instruction
Implement this issue in the current workspace. Follow acceptance criteria if present in the description.
Ask before destructive changes. Do not push or force-push. Do not mark the issue Done unless the user confirms.
When finished, summarize files changed and remaining risks.
`;
}
