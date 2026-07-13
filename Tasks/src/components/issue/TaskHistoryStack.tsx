import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { issuesApi, type Issue, type IssueHistoryItem } from '../../lib/api';
import { formatDateTimeDDMMYYYY } from '../../lib/dateFormat';

function relativeTime(s: string | undefined) {
  if (!s) return '';
  const d = new Date(s);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `about ${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  return formatDateTimeDDMMYYYY(s);
}

function formatMessage(entry: IssueHistoryItem): string {
  if (entry.action === 'created') {
    return entry.source === 'ado' ? 'created the work item in Azure DevOps' : 'created the work item';
  }
  if (entry.action === 'comment_added') return 'added a comment';
  if (entry.action === 'comment_updated') return 'edited a comment';
  if (entry.action === 'field_change' && entry.field && entry.fromValue !== undefined && entry.toValue !== undefined) {
    return `changed ${entry.field} from ${entry.fromValue} to ${entry.toValue}`;
  }
  if (entry.action === 'field_change' && entry.field && entry.toValue !== undefined) {
    return `set ${entry.field} to ${entry.toValue}`;
  }
  if (entry.action === 'field_change' && entry.field) {
    return `updated ${entry.field}`;
  }
  return 'updated the work item';
}

function truncateBody(body: string, maxLen = 120): string {
  const plain = body.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (plain.length <= maxLen) return plain;
  return plain.slice(0, maxLen) + '…';
}

interface TaskHistoryStackProps {
  issue: Issue;
}

export default function TaskHistoryStack({ issue }: TaskHistoryStackProps) {
  const { token } = useAuth();
  const [history, setHistory] = useState<IssueHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const linkedAdoId =
    typeof issue.customFieldValues?.adoWorkItemId === 'number'
      ? issue.customFieldValues.adoWorkItemId
      : undefined;
  const adoUrl =
    typeof issue.customFieldValues?.adoUrl === 'string' ? issue.customFieldValues.adoUrl : undefined;

  useEffect(() => {
    if (!token || !issue._id) return;
    setLoading(true);
    issuesApi
      .getHistory(issue._id, 1, 100, token)
      .then((res) => {
        if (res.success && res.data?.data) setHistory(res.data.data);
      })
      .finally(() => setLoading(false));
  }, [token, issue._id]);

  if (loading) {
    return <p className="type-meta py-4">Loading history…</p>;
  }

  return (
    <div className="space-y-3">
      {linkedAdoId != null && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--text-muted)]">
          <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--border-subtle)] px-2 py-0.5">
            Azure DevOps #{linkedAdoId}
          </span>
          {adoUrl && (
            <a
              href={adoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[color:var(--accent)] hover:underline"
            >
              Open in DevOps
            </a>
          )}
        </div>
      )}
      {history.length === 0 ? (
        <p className="type-meta py-4">No history yet.</p>
      ) : (
        <ul className="space-y-0">
          {history.map((entry, index) => (
            <li key={entry._id} className="relative flex gap-4 py-3 first:pt-0">
              {index < history.length - 1 && (
                <div
                  className="absolute left-[7px] top-8 bottom-0 w-0.5 bg-[color:var(--border-subtle)]/70"
                  aria-hidden
                />
              )}
              <div
                className={`relative z-10 shrink-0 w-4 h-4 rounded-full bg-[color:var(--bg-page)] border-2 flex items-center justify-center mt-0.5 ${
                  entry.source === 'ado' ? 'border-blue-500/60' : 'border-[color:var(--border-subtle)]'
                }`}
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full ${
                    entry.source === 'ado' ? 'bg-blue-500/80' : 'bg-[color:var(--text-primary)]'
                  }`}
                />
              </div>
              <div className="flex-1 min-w-0 pb-2">
                <p className="type-history-action">
                  <span className="type-history-actor">{entry.author.name}</span>{' '}
                  <span>{formatMessage(entry)}</span>
                  {entry.source === 'ado' && (
                    <span className="ml-1.5 text-[10px] uppercase tracking-wide text-blue-500/90 font-medium">
                      ADO
                    </span>
                  )}
                </p>
                {(entry.action === 'comment_added' || entry.action === 'comment_updated') && entry.commentBody && (
                  <p className="type-meta mt-1.5 pl-3 border-l-2 border-[color:var(--border-subtle)] italic">
                    {truncateBody(entry.commentBody)}
                  </p>
                )}
                <p className="type-meta mt-0.5">
                  {relativeTime(entry.createdAt)}
                  {entry.source === 'ado' && entry.adoRev != null && entry.adoRev > 0 && (
                    <span className="ml-1.5">· rev {entry.adoRev}</span>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
