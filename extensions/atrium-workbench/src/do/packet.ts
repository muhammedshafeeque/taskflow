import type { IssueRef } from '../api/issues';
import type { LocalAttachment } from './attachments';
import { stripHtmlLike } from './packetHtml';

export function buildIssuePacket(
  issue: IssueRef,
  branch?: string,
  attachments?: LocalAttachment[]
): string {
  const key = issue.key || issue._id;
  const desc = stripHtmlLike(issue.description || '');
  const attachSection =
    attachments && attachments.length
      ? `
## Attachments (downloaded locally — PNG/JPEG only)
Review these screenshots from the issue:
${attachments.map((a) => `- @${a.relPath} (${a.originalName}${a.mimeType ? `, ${a.mimeType}` : ''})`).join('\n')}
`
      : '';

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
${attachSection}
## Instruction
Implement this issue in the current workspace. Follow acceptance criteria if present in the description.
Read every PNG/JPEG attachment listed above for visual/acceptance context.
Ask before destructive changes. Do not push or force-push. Do not mark the issue Done unless the user confirms.
When finished, summarize files changed and remaining risks.
`;
}
