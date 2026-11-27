import { Link } from 'react-router-dom';
import type { CustomerOrgMatch, LeadDuplicate, LeadDuplicateReason } from '../../lib/api';
import { LEAD_STATUSES, leadLabel, statusClass } from './leadCatalog';

const REASON_LABEL: Record<LeadDuplicateReason, string> = {
  email: 'Same email',
  phone: 'Same phone',
  company: 'Same company',
  domain: 'Same web domain',
  contact: 'Contact filed here',
};

export function ReasonChips({ reasons }: { reasons: LeadDuplicateReason[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {reasons.map((r) => (
        <span
          key={r}
          className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/25"
        >
          {REASON_LABEL[r]}
        </span>
      ))}
    </span>
  );
}

/** Rows of likely duplicate leads; `action` renders a per-row control such as Merge. */
export function DuplicateLeadList({
  leads,
  action,
}: {
  leads: LeadDuplicate[];
  action?: (lead: LeadDuplicate) => React.ReactNode;
}) {
  return (
    <ul className="divide-y divide-[color:var(--border-subtle)]">
      {leads.map((l) => (
        <li key={l._id} className="py-2 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {l.outOfScope ? (
                <span className="text-sm font-medium text-[color:var(--text-primary)] truncate">{l.title}</span>
              ) : (
                <Link
                  to={`/crm/leads/${l._id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-[color:var(--accent)] hover:underline truncate"
                >
                  {l.title}
                </Link>
              )}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${statusClass(l.status)}`}>
                {leadLabel(LEAD_STATUSES, l.status)}
              </span>
              <ReasonChips reasons={l.reasons} />
            </div>
            <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5 truncate">
              {l.outOfScope
                ? 'Outside your access. Ask the person who has it, or a manager, before adding another lead.'
                : [l.companyName, l.contactName, l.contactEmail, l.contactPhone].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
          {!l.outOfScope && action?.(l)}
        </li>
      ))}
    </ul>
  );
}

export function CustomerOrgMatchList({
  orgs,
  selectedId,
  onSelect,
}: {
  orgs: CustomerOrgMatch[];
  selectedId?: string;
  onSelect?: (id: string) => void;
}) {
  return (
    <ul className="space-y-1.5">
      {orgs.map((o) => {
        const body = (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{o.name}</span>
              {o.status && o.status !== 'active' && (
                <span className="text-[10px] text-[color:var(--text-muted)] capitalize">{o.status}</span>
              )}
              <ReasonChips reasons={o.reasons} />
            </div>
            <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5">
              {[o.contactEmail, o.contactPhone].filter(Boolean).join(' · ') || '—'}
            </p>
          </>
        );
        if (!onSelect) {
          return (
            <li key={o._id}>
              <Link to={`/admin/customer-orgs/${o._id}`} target="_blank" rel="noreferrer" className="block hover:underline">
                {body}
              </Link>
            </li>
          );
        }
        return (
          <li key={o._id}>
            <label
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer ${
                selectedId === o._id
                  ? 'border-[color:var(--accent)]/60 bg-[color:var(--accent)]/10'
                  : 'border-[color:var(--border-subtle)] hover:border-[color:var(--accent)]/30'
              }`}
            >
              <input
                type="radio"
                name="existing-customer-org"
                className="mt-1"
                checked={selectedId === o._id}
                onChange={() => onSelect(o._id)}
              />
              <span className="min-w-0">{body}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
