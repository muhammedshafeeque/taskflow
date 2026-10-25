import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CrmEmailPanel } from './CrmSalesTools';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { money } from '../../components/moduleKit';
import { formatDateDDMMYYYY } from '../../lib/dateFormat';
import {
  crmApi,
  type CrmActivity,
  type CrmLead,
  type CrmPipeline,
  type CrmQuote,
} from '../../lib/api';
import {
  LEAD_COMPANY_SIZES,
  LEAD_ROLES,
  LEAD_SERVICES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  LEAD_TIMELINES,
  OPEN_LEAD_STATUSES,
  assigneeName,
  leadLabel,
  scoreClass,
  statusClass,
} from './leadCatalog';
import RecordLinksPanel from '../../components/RecordLinksPanel';

const inputClass =
  'w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm';

function refOrgId(ref?: string | { _id: string }): string {
  if (!ref) return '';
  return typeof ref === 'string' ? ref : ref._id;
}

function Dl({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] text-[color:var(--text-muted)]">{label}</dt>
      <dd className="text-sm mt-0.5 break-words">{value || '—'}</dd>
    </div>
  );
}

export default function CrmLeadDetail() {
  const { id } = useParams<{ id: string }>();
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const canUpdate = canAny(user, 'taskflow.crm.lead.update');
  const canDelete = canAny(user, 'taskflow.crm.lead.delete');
  const canActivity = canAny(user, 'taskflow.crm.activity.create');
  const canQuote = canAny(user, 'taskflow.crm.quote.create');
  const canListQuotes = canAny(user, 'taskflow.crm.quote.list', 'taskflow.crm.quote.create');

  const [lead, setLead] = useState<CrmLead | null>(null);
  const [activities, setActivities] = useState<CrmActivity[]>([]);
  const [quotes, setQuotes] = useState<CrmQuote[]>([]);
  const [pipelines, setPipelines] = useState<CrmPipeline[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertStep, setConvertStep] = useState(1);
  const [convertError, setConvertError] = useState('');
  const [portalSkipAck, setPortalSkipAck] = useState(false);
  const [convert, setConvert] = useState({
    pipelineId: '',
    dealValue: '',
    expectedCloseDate: '',
    createProject: true,
    createPortalOrg: true,
    orgName: '',
    contactEmail: '',
    contactPhone: '',
    description: '',
    adminName: '',
    adminEmail: '',
  });
  const [note, setNote] = useState('');
  const [followDue, setFollowDue] = useState('');
  const [unqualifyReason, setUnqualifyReason] = useState('');

  const load = () => {
    if (!token || !id) return;
    crmApi.getLead(id, token).then((res) => {
      if (res.success && res.data) {
        setLead(res.data);
        setConvert((c) => ({
          ...c,
          dealValue: res.data!.estimatedBudget != null ? String(res.data!.estimatedBudget) : c.dealValue,
          orgName: res.data!.companyName || res.data!.title || c.orgName,
          contactEmail: res.data!.contactEmail || c.contactEmail,
          contactPhone: res.data!.contactPhone || c.contactPhone,
          adminName: res.data!.contactName || c.adminName,
          adminEmail: res.data!.contactEmail || c.adminEmail,
        }));
      } else setError('Lead not found');
    });
    crmApi.listActivities(token, { relatedType: 'lead', relatedId: id }).then((res) => {
      if (res.success && res.data) setActivities(res.data);
    });
    if (canListQuotes) {
      crmApi.listQuotes(token, { leadId: id }).then((res) => {
        if (res.success && res.data) setQuotes(res.data as CrmQuote[]);
        else setQuotes([]);
      });
    }
  };

  useEffect(() => {
    load();
  }, [token, id]);

  useEffect(() => {
    if (!token) return;
    crmApi.listPipelines(token).then((res) => {
      if (res.success && res.data) {
        setPipelines(res.data);
        const def = res.data.find((p) => p.isDefault) ?? res.data[0];
        if (def) setConvert((c) => ({ ...c, pipelineId: c.pipelineId || def._id }));
      }
    });
  }, [token]);

  async function setStatus(status: string, extra?: Partial<CrmLead>) {
    if (!token || !id || !canUpdate) return;
    setBusy(true);
    setError('');
    const res = await crmApi.updateLead(id, { status, ...extra }, token);
    setBusy(false);
    if (!res.success) {
      setError((res as { message?: string }).message ?? 'Update failed');
      return;
    }
    setMsg(`Status updated`);
    load();
  }

  function openConvertWizard() {
    setConvertStep(1);
    setConvertError('');
    setPortalSkipAck(false);
    setConvertOpen(true);
  }

  function closeConvertWizard() {
    setConvertOpen(false);
    setConvertStep(1);
    setConvertError('');
    setPortalSkipAck(false);
  }

  function nextConvertStep() {
    const existingOrgId = refOrgId(lead?.customerOrgId);
    setConvertError('');
    if (convertStep === 1) {
      setConvertStep(existingOrgId ? 3 : 2);
      return;
    }
    if (convertStep === 2) {
      if (convert.createPortalOrg) {
        const email = (convert.adminEmail || convert.contactEmail).trim();
        if (!email) {
          setConvertError('Customer email is required to create a portal organisation');
          return;
        }
        if (!convert.orgName.trim()) {
          setConvertError('Organisation name is required');
          return;
        }
      } else if (!portalSkipAck) {
        setConvertError('Confirm that the customer will not receive portal access yet');
        return;
      }
      setConvertStep(3);
    }
  }

  async function doConvert(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !id || !canUpdate) return;
    const existingOrgId = refOrgId(lead?.customerOrgId);
    if (convert.createPortalOrg && !existingOrgId) {
      const email = (convert.adminEmail || convert.contactEmail).trim();
      if (!email) {
        setConvertError('Customer email is required to create a portal organisation');
        setConvertStep(2);
        return;
      }
    }
    setBusy(true);
    setConvertError('');
    const res = await crmApi.convertLead(
      id,
      {
        pipelineId: convert.pipelineId || undefined,
        dealValue: convert.dealValue ? Number(convert.dealValue) : undefined,
        expectedCloseDate: convert.expectedCloseDate || undefined,
        createProject: convert.createProject,
        createPortalOrg: convert.createPortalOrg && !existingOrgId,
        customerOrgId: existingOrgId || undefined,
        portalOrg:
          convert.createPortalOrg && !existingOrgId
            ? {
                name: convert.orgName.trim() || lead?.companyName || lead?.title,
                contactEmail: convert.contactEmail.trim() || convert.adminEmail.trim(),
                contactPhone: convert.contactPhone.trim() || undefined,
                description: convert.description.trim() || undefined,
                adminName: convert.adminName.trim() || lead?.contactName || convert.orgName,
                adminEmail: convert.adminEmail.trim() || convert.contactEmail.trim(),
              }
            : undefined,
      },
      token
    );
    setBusy(false);
    if (!res.success) {
      setConvertError((res as { message?: string }).message ?? 'Convert failed');
      return;
    }
    const data = res.data;
    const handoff = data?.handoff;
    if (handoff?.warnings?.length) {
      setMsg(handoff.warnings.join(' '));
    }
    closeConvertWizard();
    if (data?.handoff?.projectId) navigate(`/projects/${data.handoff.projectId}/dashboard`);
    else if (data?.customerOrg?._id || data?.handoff?.customerOrgId)
      navigate(`/admin/customer-orgs/${data.customerOrg?._id || data.handoff?.customerOrgId}`);
    else navigate('/crm/deals');
  }

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !id || !note.trim()) return;
    await crmApi.createActivity(
      { type: 'note', subject: note.trim(), relatedType: 'lead', relatedId: id },
      token
    );
    setNote('');
    load();
  }

  async function logFollowUp(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !id || !followDue) return;
    await crmApi.createActivity(
      {
        type: 'follow_up',
        subject: `Follow up: ${lead?.title || 'Lead'}`,
        dueAt: new Date(followDue).toISOString(),
        relatedType: 'lead',
        relatedId: id,
      },
      token
    );
    setFollowDue('');
    load();
  }

  async function remove() {
    if (!token || !id || !canDelete) return;
    if (!window.confirm('Delete this lead?')) return;
    const res = await crmApi.deleteLead(id, token);
    if (res.success) navigate('/crm/leads');
    else setError((res as { message?: string }).message ?? 'Delete failed');
  }

  if (error && !lead) {
    return (
      <div className="p-8">
        <Link to="/crm/leads" className="text-sm text-[color:var(--accent)] hover:underline">← Leads</Link>
        <p className="mt-4 text-sm text-red-400">{error}</p>
      </div>
    );
  }
  if (!lead) return <div className="p-8 text-[color:var(--text-muted)]">Loading lead…</div>;

  const open = OPEN_LEAD_STATUSES.includes(lead.status);
  const customerOrg = lead.customerOrgId && typeof lead.customerOrgId === 'object' ? lead.customerOrgId : null;
  const deal = lead.dealId && typeof lead.dealId === 'object' ? lead.dealId : null;
  const overdue =
    open && lead.nextFollowUpAt && new Date(lead.nextFollowUpAt).getTime() < Date.now();

  return (
    <div className="p-8 w-full px-4 sm:px-6 lg:px-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/crm/leads" className="text-sm text-[color:var(--accent)] hover:underline">← Leads</Link>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <h1 className="text-xl font-semibold">{lead.title}</h1>
            <span className={`text-[11px] px-2 py-0.5 rounded-full border ${statusClass(lead.status)}`}>
              {leadLabel(LEAD_STATUSES, lead.status)}
            </span>
            <span className={`text-sm font-semibold ${scoreClass(lead.score)}`}>Score {lead.score ?? 0}</span>
          </div>
          <p className="text-[13px] text-[color:var(--text-muted)] mt-1">
            {lead.companyName || 'No company'} · {leadLabel(LEAD_SOURCES, lead.source)}
            {overdue ? ' · Follow-up overdue' : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canUpdate && open && (
            <>
              {lead.status === 'new' && (
                <button type="button" disabled={busy} onClick={() => void setStatus('contacted')} className="px-3 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm">
                  Mark contacted
                </button>
              )}
              {(lead.status === 'contacted' || lead.status === 'new') && (
                <button type="button" disabled={busy} onClick={() => void setStatus('discovery')} className="px-3 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm">
                  Start discovery
                </button>
              )}
              <button type="button" disabled={busy} onClick={() => void setStatus('qualified')} className="px-3 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm">
                Qualify
              </button>
              <button type="button" disabled={busy} onClick={openConvertWizard} className="btn-primary px-3 py-2 rounded-lg text-sm">
                Convert to deal
              </button>
            </>
          )}
          {canQuote && (
            <Link
              to={`/crm/quotes/new?leadId=${lead._id}`}
              className="px-3 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm"
            >
              Create quotation
            </Link>
          )}
          {canUpdate && !['converted', 'unqualified'].includes(lead.status) && (
            <Link to={`/crm/leads/${lead._id}/edit`} className="px-3 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm">
              Edit
            </Link>
          )}
          {canUpdate && lead.status === 'converted' && (
            <Link to={`/crm/leads/${lead._id}/edit`} className="px-3 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm">
              View fields
            </Link>
          )}
          {canDelete && open && (
            <button type="button" onClick={() => void remove()} className="px-3 py-2 rounded-lg text-sm text-red-400">
              Delete
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {msg && <p className="text-sm text-[color:var(--accent)]">{msg}</p>}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-4 min-w-0">
        {id && <CrmEmailPanel relatedType="lead" relatedId={id} defaultTo={lead.contactEmail} />}
        <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5">
          <h2 className="text-sm font-semibold mb-4">Details</h2>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Dl label="Contact" value={[lead.contactName, lead.jobTitle].filter(Boolean).join(' · ')} />
            <Dl label="Email" value={lead.contactEmail} />
            <Dl label="Phone" value={lead.contactPhone} />
            <Dl label="Buying role" value={leadLabel(LEAD_ROLES, lead.decisionRole)} />
            <Dl label="Website" value={lead.website} />
            <Dl label="Industry" value={lead.industry} />
            <Dl label="Company size" value={leadLabel(LEAD_COMPANY_SIZES, lead.companySize)} />
            <Dl label="Country" value={lead.country} />
            <Dl
              label="Services"
              value={(lead.serviceInterest ?? []).map((s) => leadLabel(LEAD_SERVICES, s)).join(', ')}
            />
            <Dl label="Tech stack" value={lead.techStack} />
            <Dl label="Timeline" value={leadLabel(LEAD_TIMELINES, lead.timeline)} />
            <Dl
              label="Estimated budget"
              value={lead.estimatedBudget != null ? money(lead.estimatedBudget, lead.currency || 'USD') : undefined}
            />
            <Dl label="Owner" value={assigneeName(lead.assigneeId)} />
            <Dl label="Campaign" value={lead.campaign} />
            <Dl label="Follow-up" value={lead.nextFollowUpAt ? formatDateDDMMYYYY(lead.nextFollowUpAt) : undefined} />
            <Dl
              label="Campaign"
              value={
                lead.campaignId && typeof lead.campaignId === 'object' ? (
                  <Link to={`/crm/campaigns/${lead.campaignId._id}`} className="text-[color:var(--accent)] hover:underline">
                    {lead.campaignId.name || lead.campaignId.code}
                  </Link>
                ) : (
                  lead.campaign
                )
              }
            />
            <Dl label="Competitor" value={lead.competitor} />
            <Dl label="RFP" value={lead.rfpReceived ? 'Yes' : 'No'} />
            <Dl label="NDA required" value={lead.ndaRequired ? 'Yes' : 'No'} />
            <Dl label="Tags" value={(lead.tags ?? []).join(', ')} />
            {customerOrg && (
              <Dl
                label="Customer"
                value={
                  <Link to={`/admin/customer-orgs/${customerOrg._id}`} className="text-[color:var(--accent)] hover:underline">
                    {customerOrg.name}
                  </Link>
                }
              />
            )}
            {deal && (
              <Dl
                label="Deal"
                value={
                  <Link to="/crm/deals" className="text-[color:var(--accent)] hover:underline">
                    {`${deal.title}${deal.status ? ` · ${deal.status}` : ''}`}
                  </Link>
                }
              />
            )}
          </dl>
          {(lead.additionalContacts ?? []).length > 0 && (
            <div className="mt-5 pt-4 border-t border-[color:var(--border-subtle)]">
              <p className="text-[11px] text-[color:var(--text-muted)] mb-2">Other contacts</p>
              <ul className="space-y-2">
                {lead.additionalContacts!.map((c, i) => (
                  <li key={c.contactId || c.email || i} className="text-sm">
                    {[c.name, c.jobTitle].filter(Boolean).join(' · ') || 'Contact'}
                    {c.email ? <span className="text-[color:var(--text-muted)]"> · {c.email}</span> : null}
                    {c.phone ? <span className="text-[color:var(--text-muted)]"> · {c.phone}</span> : null}
                    {c.decisionRole ? (
                      <span className="text-[color:var(--text-muted)]"> · {leadLabel(LEAD_ROLES, c.decisionRole)}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {lead.notes && (
            <div className="mt-5 pt-4 border-t border-[color:var(--border-subtle)]">
              <p className="text-[11px] text-[color:var(--text-muted)] mb-1">Notes</p>
              <p className="text-sm whitespace-pre-wrap">{lead.notes}</p>
            </div>
          )}
          {lead.disqualifyReason && (
            <p className="mt-3 text-sm text-red-400">Unqualified: {lead.disqualifyReason}</p>
          )}
        </section>

        {canListQuotes && (
          <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div>
                <h2 className="text-sm font-semibold">Quotations</h2>
                <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5">
                  Quotes created against this lead
                </p>
              </div>
              {canQuote && (
                <Link
                  to={`/crm/quotes/new?leadId=${lead._id}`}
                  className="text-xs px-3 py-1.5 rounded-lg border border-[color:var(--border-subtle)] text-[color:var(--accent)] hover:bg-[color:var(--bg-page)]"
                >
                  + New quotation
                </Link>
              )}
            </div>
            {quotes.length === 0 ? (
              <p className="text-sm text-[color:var(--text-muted)]">
                No quotations linked yet.{' '}
                {canQuote && (
                  <Link to={`/crm/quotes/new?leadId=${lead._id}`} className="text-[color:var(--accent)] hover:underline">
                    Create one
                  </Link>
                )}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-[color:var(--text-muted)] border-b border-[color:var(--border-subtle)]">
                      <th className="pb-2 font-medium">Title</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium text-right">Total</th>
                      <th className="pb-2 font-medium">Valid until</th>
                      <th className="pb-2 font-medium text-right"> </th>
                    </tr>
                  </thead>
                  <tbody>
                    {quotes.map((q) => (
                      <tr key={q._id} className="border-t border-[color:var(--border-subtle)]">
                        <td className="py-2.5 pr-3">
                          <Link
                            to={`/crm/quotes/${q._id}`}
                            className="font-medium text-[color:var(--accent)] hover:underline"
                          >
                            {q.title || 'Untitled'}
                          </Link>
                          <span className="block text-[11px] text-[color:var(--text-muted)]">
                            {q.currency}
                            {q.version ? ` · v${q.version}` : ''}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 capitalize text-[color:var(--text-muted)]">{q.status}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums font-medium">
                          {money(q.total ?? q.subtotal ?? 0, q.currency || 'USD')}
                        </td>
                        <td className="py-2.5 pr-3 text-[color:var(--text-muted)]">
                          {q.validUntil ? formatDateDDMMYYYY(q.validUntil) : '—'}
                        </td>
                        <td className="py-2.5 text-right">
                          <Link
                            to={`/crm/quotes/${q._id}`}
                            className="text-xs text-[color:var(--accent)] hover:underline"
                          >
                            Open
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
        </div>

        <aside className="space-y-4">
          {canUpdate && open && (
            <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5 space-y-3">
              <h2 className="text-sm font-semibold">Pipeline actions</h2>
              <label className="block text-xs space-y-1">
                <span className="text-[color:var(--text-muted)]">Move to status</span>
                <select
                  className={inputClass}
                  value={lead.status}
                  disabled={busy}
                  onChange={(e) => void setStatus(e.target.value)}
                >
                  {LEAD_STATUSES.filter((s) => s.id !== 'converted').map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </label>
              {lead.status !== 'unqualified' && (
                <div className="space-y-2">
                  <input
                    className={inputClass}
                    placeholder="Disqualify reason"
                    value={unqualifyReason}
                    onChange={(e) => setUnqualifyReason(e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void setStatus('unqualified', { disqualifyReason: unqualifyReason.trim() || undefined })}
                    className="text-sm text-red-400 hover:underline"
                  >
                    Mark unqualified
                  </button>
                </div>
              )}
            </section>
          )}

          <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5 space-y-3">
            <h2 className="text-sm font-semibold">Activity</h2>
            {canActivity && (
              <form onSubmit={addNote} className="space-y-2">
                <textarea rows={2} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Log a call, discovery note, next step…" />
                <button type="submit" className="text-sm text-[color:var(--accent)] hover:underline">Add note</button>
              </form>
            )}
            {canActivity && (
              <form onSubmit={logFollowUp} className="space-y-2">
                <input type="date" className={inputClass} value={followDue} onChange={(e) => setFollowDue(e.target.value)} />
                <button type="submit" className="text-sm text-[color:var(--accent)] hover:underline">Log follow-up</button>
              </form>
            )}
            <ul className="space-y-2 max-h-80 overflow-auto">
              {activities.map((a) => (
                <li key={a._id} className="text-sm border-t border-[color:var(--border-subtle)] pt-2">
                  <p className="font-medium">{a.subject}</p>
                  <p className="text-[11px] text-[color:var(--text-muted)]">
                    {a.type}
                    {a.createdAt || a.dueAt ? ` · ${formatDateDDMMYYYY(a.createdAt || a.dueAt)}` : ''}
                  </p>
                  {a.body && <p className="text-[12px] mt-1 text-[color:var(--text-muted)]">{a.body}</p>}
                </li>
              ))}
              {activities.length === 0 && <li className="text-sm text-[color:var(--text-muted)]">No activity yet.</li>}
            </ul>
          </section>
          {id && <RecordLinksPanel type="lead" id={id} />}
        </aside>
      </div>

      {convertOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={closeConvertWizard}>
          <form
            onSubmit={convertStep === 3 ? doConvert : (e) => { e.preventDefault(); nextConvertStep(); }}
            className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-2xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h2 className="text-lg font-semibold">Customer onboarding</h2>
              <p className="text-sm text-[color:var(--text-muted)] mt-1">
                Step {refOrgId(lead.customerOrgId) ? (convertStep === 3 ? 2 : 1) : convertStep} of {refOrgId(lead.customerOrgId) ? 2 : 3}
                {' · '}
                {convertStep === 1 && 'Deal terms'}
                {convertStep === 2 && 'Portal organisation'}
                {convertStep === 3 && 'Delivery setup'}
              </p>
            </div>

            {convertError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{convertError}</div>
            )}

            {convertStep === 1 && (
              <>
                <p className="text-sm text-[color:var(--text-muted)]">
                  {refOrgId(lead.customerOrgId)
                    ? 'Creates a deal against the existing customer organisation.'
                    : 'Creates a deal and provisions the customer portal organisation.'}
                </p>
                <label className="block text-xs space-y-1">
                  <span className="text-[color:var(--text-muted)]">Pipeline</span>
                  <select className={inputClass} value={convert.pipelineId} onChange={(e) => setConvert((c) => ({ ...c, pipelineId: e.target.value }))}>
                    {pipelines.map((p) => (
                      <option key={p._id} value={p._id}>{p.name}{p.isDefault ? ' (default)' : ''}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs space-y-1">
                  <span className="text-[color:var(--text-muted)]">Deal value</span>
                  <input className={inputClass} type="number" min={0} value={convert.dealValue} onChange={(e) => setConvert((c) => ({ ...c, dealValue: e.target.value }))} />
                </label>
                <label className="block text-xs space-y-1">
                  <span className="text-[color:var(--text-muted)]">Expected close</span>
                  <input className={inputClass} type="date" value={convert.expectedCloseDate} onChange={(e) => setConvert((c) => ({ ...c, expectedCloseDate: e.target.value }))} />
                </label>
              </>
            )}

            {convertStep === 2 && !refOrgId(lead.customerOrgId) && (
              <>
                <p className="text-sm text-[color:var(--text-muted)]">
                  A portal organisation gives the customer access to raise requests, view projects, and manage their team.
                </p>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={convert.createPortalOrg}
                    onChange={(e) => {
                      setConvert((c) => ({ ...c, createPortalOrg: e.target.checked }));
                      setPortalSkipAck(false);
                    }}
                  />
                  Create customer portal organisation
                </label>
                {!convert.createPortalOrg && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200/90 space-y-2">
                    <p>The customer will not get portal access. You can create or link an organisation later from Admin.</p>
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={portalSkipAck} onChange={(e) => setPortalSkipAck(e.target.checked)} />
                      I understand — continue without portal org
                    </label>
                  </div>
                )}
                {convert.createPortalOrg && (
                  <div className="grid gap-2 sm:grid-cols-2 pt-1">
                    <label className="block text-xs space-y-1 sm:col-span-2">
                      <span className="text-[color:var(--text-muted)]">Organisation name</span>
                      <input className={inputClass} value={convert.orgName} onChange={(e) => setConvert((c) => ({ ...c, orgName: e.target.value }))} required />
                    </label>
                    <label className="block text-xs space-y-1">
                      <span className="text-[color:var(--text-muted)]">Contact email</span>
                      <input className={inputClass} type="email" value={convert.contactEmail} onChange={(e) => setConvert((c) => ({ ...c, contactEmail: e.target.value }))} required />
                    </label>
                    <label className="block text-xs space-y-1">
                      <span className="text-[color:var(--text-muted)]">Contact phone</span>
                      <input className={inputClass} value={convert.contactPhone} onChange={(e) => setConvert((c) => ({ ...c, contactPhone: e.target.value }))} />
                    </label>
                    <label className="block text-xs space-y-1">
                      <span className="text-[color:var(--text-muted)]">Admin name</span>
                      <input className={inputClass} value={convert.adminName} onChange={(e) => setConvert((c) => ({ ...c, adminName: e.target.value }))} required />
                    </label>
                    <label className="block text-xs space-y-1">
                      <span className="text-[color:var(--text-muted)]">Admin email</span>
                      <input className={inputClass} type="email" value={convert.adminEmail} onChange={(e) => setConvert((c) => ({ ...c, adminEmail: e.target.value }))} required />
                    </label>
                    <label className="block text-xs space-y-1 sm:col-span-2">
                      <span className="text-[color:var(--text-muted)]">Description</span>
                      <textarea className={inputClass} rows={2} value={convert.description} onChange={(e) => setConvert((c) => ({ ...c, description: e.target.value }))} />
                    </label>
                  </div>
                )}
              </>
            )}

            {convertStep === 3 && (
              <>
                <p className="text-sm text-[color:var(--text-muted)]">
                  Optionally create a starter project and map it to this customer for delivery tracking.
                </p>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={convert.createProject} onChange={(e) => setConvert((c) => ({ ...c, createProject: e.target.checked }))} />
                  Create starter project and map to customer
                </label>
                <div className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-xs text-[color:var(--text-muted)] space-y-1">
                  <p><span className="text-[color:var(--text-primary)]">Pipeline:</span> {pipelines.find((p) => p._id === convert.pipelineId)?.name ?? 'Default'}</p>
                  {convert.dealValue && <p><span className="text-[color:var(--text-primary)]">Deal value:</span> {convert.dealValue}</p>}
                  {!refOrgId(lead.customerOrgId) && (
                    <p>
                      <span className="text-[color:var(--text-primary)]">Portal org:</span>{' '}
                      {convert.createPortalOrg ? convert.orgName || lead.companyName || lead.title : 'Skipped'}
                    </p>
                  )}
                </div>
              </>
            )}

            <div className="flex gap-2 pt-2">
              {convertStep > 1 && (
                <button
                  type="button"
                  onClick={() => setConvertStep((s) => (s === 3 && refOrgId(lead.customerOrgId) ? 1 : s - 1))}
                  className="px-4 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm"
                >
                  Back
                </button>
              )}
              <div className="flex-1" />
              {convertStep < 3 ? (
                <button type="submit" className="btn-primary px-4 py-2 rounded-lg text-sm">Next</button>
              ) : (
                <button type="submit" disabled={busy} className="btn-primary px-4 py-2 rounded-lg text-sm">
                  {busy ? 'Converting…' : 'Complete onboarding'}
                </button>
              )}
              <button type="button" onClick={closeConvertWizard} className="px-4 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
