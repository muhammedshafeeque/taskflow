import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { money } from '../../components/moduleKit';
import { formatDateDDMMYYYY } from '../../lib/dateFormat';
import { crmApi, type CrmLead, type CrmLeadStats } from '../../lib/api';
import {
  LEAD_SERVICES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  OPEN_LEAD_STATUSES,
  assigneeName,
  leadLabel,
  scoreClass,
  statusClass,
} from './leadCatalog';

const PAGE_SIZE_OPTIONS = [10, 20, 50];
const selectClass =
  'h-8 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-2.5 text-[13px]';
const inputClass =
  'h-8 w-full rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-2.5 text-[13px]';

function refOrgId(ref?: string | { _id: string }): string {
  if (!ref) return '';
  return typeof ref === 'string' ? ref : ref._id;
}

export default function CrmLeads() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const canCreate = canAny(user, 'taskflow.crm.lead.create');
  const canUpdate = canAny(user, 'taskflow.crm.lead.update');

  const [draft, setDraft] = useState({ search: '', status: '', source: '', serviceInterest: '', mine: false });
  const [applied, setApplied] = useState(draft);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [stats, setStats] = useState<CrmLeadStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const load = () => {
    if (!token) return;
    setLoading(true);
    crmApi
      .listLeads(token, {
        search: applied.search.trim() || undefined,
        status: applied.status || undefined,
        source: applied.source || undefined,
        serviceInterest: applied.serviceInterest || undefined,
        mine: applied.mine || undefined,
        page,
        limit,
      })
      .then((res) => {
        setLoading(false);
        if (res.success && res.data) {
          setLeads(res.data.data ?? []);
          setTotal(res.data.total ?? 0);
          setTotalPages(res.data.totalPages ?? 1);
        }
      });
  };

  useEffect(() => {
    load();
  }, [token, applied, page, limit]);

  useEffect(() => {
    if (!token) return;
    crmApi.getLeadStats(token).then((res) => {
      if (res.success && res.data) setStats(res.data);
    });
  }, [token, applied, msg]);

  function search(e?: React.FormEvent) {
    e?.preventDefault();
    setPage(1);
    setApplied({ ...draft });
  }

  function clearFilters() {
    const empty = { search: '', status: '', source: '', serviceInterest: '', mine: false };
    setDraft(empty);
    setApplied(empty);
    setPage(1);
  }

  async function convert(lead: CrmLead) {
    if (!token || !canUpdate) return;
    const existingOrgId = refOrgId(lead.customerOrgId);
    if (!lead.contactEmail && !existingOrgId) {
      setMsg('Add a customer email on the lead before converting, or open the lead to complete onboarding.');
      navigate(`/crm/leads/${lead._id}`);
      return;
    }
    setMsg('');
    const res = await crmApi.convertLead(
      lead._id,
      {
        createPortalOrg: !existingOrgId,
        portalOrg: !existingOrgId && lead.contactEmail
          ? {
              name: lead.companyName || lead.title,
              contactEmail: lead.contactEmail,
              contactPhone: lead.contactPhone,
              adminName: lead.contactName || lead.companyName || lead.title,
              adminEmail: lead.contactEmail,
            }
          : undefined,
      },
      token
    );
    if (!res.success) {
      setMsg((res as { message?: string }).message ?? 'Convert failed — open the lead to complete onboarding.');
      return;
    }
    const data = res.data;
    load();
    if (data?.handoff?.projectId) navigate(`/projects/${data.handoff.projectId}/dashboard`);
    else if (data?.customerOrg?._id || data?.handoff?.customerOrgId)
      navigate(`/admin/customer-orgs/${data.customerOrg?._id || data.handoff?.customerOrgId}`);
    else navigate('/crm/deals');
  }

  const kpis = [
    { label: 'Open', value: stats?.open ?? 0 },
    { label: 'New', value: stats?.statusCounts?.new ?? 0 },
    { label: 'Discovery', value: stats?.statusCounts?.discovery ?? 0 },
    { label: 'Qualified', value: stats?.statusCounts?.qualified ?? 0 },
    { label: 'Overdue follow-ups', value: stats?.overdueFollowUps ?? 0 },
    { label: 'Converted this month', value: stats?.convertedThisMonth ?? 0 },
    { label: 'Win-in rate', value: `${stats?.conversionRate ?? 0}%` },
  ];

  return (
    <div className="p-8 w-full px-4 sm:px-6 lg:px-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Leads</h1>
          <p className="text-[13px] text-[color:var(--text-muted)]">
            Capture inbound IT opportunities, score fit, and convert to deals.
          </p>
        </div>
        {canCreate && (
          <Link to="/crm/leads/new" className="btn-primary px-4 py-2 rounded-lg text-sm">
            Add lead
          </Link>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-7">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2">
            <p className="text-[11px] text-[color:var(--text-muted)]">{k.label}</p>
            <p className="text-lg font-semibold">{k.value}</p>
          </div>
        ))}
      </div>

      {msg && <p className="text-sm text-[color:var(--accent)]">{msg}</p>}

      <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-hidden">
        <form onSubmit={search} className="flex flex-wrap items-end gap-2 p-3 border-b border-[color:var(--border-subtle)]">
          <label className="min-w-[12rem] flex-1 text-[11px] text-[color:var(--text-muted)]">
            Search
            <input
              className={`${inputClass} mt-1`}
              value={draft.search}
              onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value }))}
              placeholder="Title, company, email…"
            />
          </label>
          <label className="text-[11px] text-[color:var(--text-muted)]">
            Status
            <select className={`${selectClass} mt-1 block`} value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}>
              <option value="">All</option>
              {LEAD_STATUSES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </label>
          <label className="text-[11px] text-[color:var(--text-muted)]">
            Source
            <select className={`${selectClass} mt-1 block`} value={draft.source} onChange={(e) => setDraft((d) => ({ ...d, source: e.target.value }))}>
              <option value="">All</option>
              {LEAD_SOURCES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </label>
          <label className="text-[11px] text-[color:var(--text-muted)]">
            Service
            <select className={`${selectClass} mt-1 block`} value={draft.serviceInterest} onChange={(e) => setDraft((d) => ({ ...d, serviceInterest: e.target.value }))}>
              <option value="">All</option>
              {LEAD_SERVICES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </label>
          <label className="inline-flex items-center gap-2 h-8 text-[13px]">
            <input type="checkbox" checked={draft.mine} onChange={(e) => setDraft((d) => ({ ...d, mine: e.target.checked }))} />
            My leads
          </label>
          <button type="submit" className="btn-primary h-8 px-3 rounded-md text-[12px]">Search</button>
          <button type="button" onClick={clearFilters} className="h-8 px-3 rounded-md text-[12px] border border-[color:var(--border-subtle)]">
            Clear
          </button>
          <select
            className={selectClass}
            value={limit}
            onChange={(e) => {
              setLimit(Number(e.target.value));
              setPage(1);
            }}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n} / page</option>
            ))}
          </select>
        </form>

        <div className="overflow-auto">
          <table className="w-full text-[13px]">
            <thead className="text-left text-[11px] text-[color:var(--text-muted)] bg-[color:var(--bg-page)]/40">
              <tr>
                <th className="px-3 py-2 font-medium">Lead</th>
                <th className="px-3 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Score</th>
                <th className="px-3 py-2 font-medium">Budget</th>
                <th className="px-3 py-2 font-medium">Owner</th>
                <th className="px-3 py-2 font-medium">Follow-up</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-[color:var(--text-muted)]">Loading…</td>
                </tr>
              )}
              {!loading &&
                leads.map((l) => {
                  const open = OPEN_LEAD_STATUSES.includes(l.status);
                  const overdue = open && l.nextFollowUpAt && new Date(l.nextFollowUpAt).getTime() < Date.now();
                  return (
                    <tr key={l._id} className="border-t border-[color:var(--border-subtle)]/70 hover:bg-[color:var(--bg-page)]/40">
                      <td className="px-3 py-2">
                        <Link to={`/crm/leads/${l._id}`} className="font-medium hover:underline">
                          {l.title}
                        </Link>
                        <p className="text-[11px] text-[color:var(--text-muted)]">
                          {l.contactName || l.contactEmail || 'No contact'}
                        </p>
                      </td>
                      <td className="px-3 py-2">{l.companyName || '—'}</td>
                      <td className="px-3 py-2">{leadLabel(LEAD_SOURCES, l.source)}</td>
                      <td className="px-3 py-2">
                        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${statusClass(l.status)}`}>
                          {leadLabel(LEAD_STATUSES, l.status)}
                        </span>
                      </td>
                      <td className={`px-3 py-2 font-semibold ${scoreClass(l.score)}`}>{l.score ?? '—'}</td>
                      <td className="px-3 py-2">
                        {l.estimatedBudget != null ? money(l.estimatedBudget, l.currency || 'USD') : '—'}
                      </td>
                      <td className="px-3 py-2">{assigneeName(l.assigneeId)}</td>
                      <td className={`px-3 py-2 ${overdue ? 'text-red-400' : ''}`}>
                        {l.nextFollowUpAt ? formatDateDDMMYYYY(l.nextFollowUpAt) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <Link to={`/crm/leads/${l._id}`} className="text-[color:var(--accent)] hover:underline">
                          View
                        </Link>
                        {canUpdate && open && (
                          <>
                            <span className="text-[color:var(--text-muted)]"> · </span>
                            <button
                              type="button"
                              title={
                                !l.contactEmail && !refOrgId(l.customerOrgId)
                                  ? 'Add customer email before converting'
                                  : 'Quick convert with portal org and project'
                              }
                              disabled={!l.contactEmail && !refOrgId(l.customerOrgId)}
                              onClick={() => void convert(l)}
                              className="text-[color:var(--accent)] hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
                            >
                              Convert
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              {!loading && leads.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-[12px] text-[color:var(--text-muted)]">
                    {applied.search || applied.status || applied.source || applied.serviceInterest || applied.mine
                      ? 'No leads match these filters.'
                      : 'No leads yet. Add an inbound opportunity to get started.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-t border-[color:var(--border-subtle)]">
          <p className="text-[11px] text-[color:var(--text-muted)]">
            {total} lead{total === 1 ? '' : 's'} · Page {page} / {totalPages}
          </p>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="h-7 px-2.5 rounded-md text-[12px] border border-[color:var(--border-subtle)] disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="h-7 px-2.5 rounded-md text-[12px] border border-[color:var(--border-subtle)] disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
