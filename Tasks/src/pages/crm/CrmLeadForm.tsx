import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { CountryAutocomplete } from '../../components/CountryAutocomplete';
import { CurrencyAutocomplete } from '../../components/CurrencyAutocomplete';
import {
  coreApi,
  crmApi,
  usersApi,
  type CoreCountry,
  type CoreCurrency,
  type CrmCampaign,
  type CrmContact,
  type CrmLead,
  type User,
} from '../../lib/api';
import { toIsoDatePart } from '../../lib/dateFormat';
import {
  LEAD_COMPANY_SIZES,
  LEAD_ROLES,
  LEAD_SERVICES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  LEAD_TIMELINES,
  refId,
} from './leadCatalog';
import { ModuleLoader } from '../../components/loaders/ModuleLoader';

const inputClass =
  'w-full rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3.5 py-2.5 text-sm text-[color:var(--text-primary)] placeholder:text-[color:var(--text-muted)]/70 transition-shadow focus:outline-none focus:border-[color:var(--accent)]/50 focus:ring-4 focus:ring-[color:var(--accent)]/15 disabled:opacity-60 disabled:cursor-not-allowed';

type FormState = {
  title: string;
  source: string;
  status: string;
  assigneeId: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  jobTitle: string;
  companyName: string;
  website: string;
  industry: string;
  companySize: string;
  country: string;
  serviceInterest: string[];
  techStack: string;
  estimatedBudget: string;
  currency: string;
  timeline: string;
  decisionRole: string;
  campaign: string;
  tags: string;
  competitor: string;
  ndaRequired: boolean;
  rfpReceived: boolean;
  nextFollowUpAt: string;
  disqualifyReason: string;
  notes: string;
  customerOrgId: string;
  campaignId: string;
  contactId: string;
  additionalContacts: ExtraContact[];
};

type ExtraContact = {
  contactId: string;
  name: string;
  jobTitle: string;
  email: string;
  phone: string;
  decisionRole: string;
};

function emptyExtra(): ExtraContact {
  return { contactId: '', name: '', jobTitle: '', email: '', phone: '', decisionRole: '' };
}

const EMPTY: FormState = {
  title: '',
  source: 'website',
  status: 'new',
  assigneeId: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  jobTitle: '',
  companyName: '',
  website: '',
  industry: '',
  companySize: '',
  country: '',
  serviceInterest: [],
  techStack: '',
  estimatedBudget: '',
  currency: 'USD',
  timeline: '',
  decisionRole: '',
  campaign: '',
  tags: '',
  competitor: '',
  ndaRequired: false,
  rfpReceived: false,
  nextFollowUpAt: '',
  disqualifyReason: '',
  notes: '',
  customerOrgId: '',
  campaignId: '',
  contactId: '',
  additionalContacts: [],
};

function fromLead(lead: CrmLead): FormState {
  return {
    title: lead.title ?? '',
    source: lead.source || 'website',
    status: lead.status || 'new',
    assigneeId: refId(lead.assigneeId),
    contactName: lead.contactName ?? '',
    contactEmail: lead.contactEmail ?? '',
    contactPhone: lead.contactPhone ?? '',
    jobTitle: lead.jobTitle ?? '',
    companyName: lead.companyName ?? '',
    website: lead.website ?? '',
    industry: lead.industry ?? '',
    companySize: lead.companySize ?? '',
    country: lead.country ?? '',
    serviceInterest: lead.serviceInterest ?? [],
    techStack: lead.techStack ?? '',
    estimatedBudget: lead.estimatedBudget != null ? String(lead.estimatedBudget) : '',
    currency: lead.currency || 'USD',
    timeline: lead.timeline ?? '',
    decisionRole: lead.decisionRole ?? '',
    campaign: lead.campaign ?? '',
    tags: (lead.tags ?? []).join(', '),
    competitor: lead.competitor ?? '',
    ndaRequired: Boolean(lead.ndaRequired),
    rfpReceived: Boolean(lead.rfpReceived),
    nextFollowUpAt: toIsoDatePart(lead.nextFollowUpAt),
    disqualifyReason: lead.disqualifyReason ?? '',
    notes: lead.notes ?? '',
    customerOrgId: refId(lead.customerOrgId),
    campaignId: refId(lead.campaignId),
    contactId: '',
    additionalContacts: (lead.additionalContacts ?? []).map((c) => ({
      contactId: c.contactId ?? '',
      name: c.name ?? '',
      jobTitle: c.jobTitle ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
      decisionRole: c.decisionRole ?? '',
    })),
  };
}

function toPayload(form: FormState): Partial<CrmLead> {
  const budget = form.estimatedBudget.trim() ? Number(form.estimatedBudget) : undefined;
  return {
    title: form.title.trim(),
    source: form.source,
    status: form.status,
    assigneeId: form.assigneeId || undefined,
    contactName: form.contactName.trim() || undefined,
    contactEmail: form.contactEmail.trim() || undefined,
    contactPhone: form.contactPhone.trim() || undefined,
    jobTitle: form.jobTitle.trim() || undefined,
    companyName: form.companyName.trim() || undefined,
    website: form.website.trim() || undefined,
    industry: form.industry.trim() || undefined,
    companySize: form.companySize || undefined,
    country: form.country.trim() || undefined,
    serviceInterest: form.serviceInterest,
    techStack: form.techStack.trim() || undefined,
    estimatedBudget: Number.isFinite(budget) ? budget : undefined,
    currency: form.currency.trim() || 'USD',
    timeline: form.timeline || undefined,
    decisionRole: form.decisionRole || undefined,
    campaign: form.campaign.trim() || undefined,
    tags: form.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    competitor: form.competitor.trim() || undefined,
    ndaRequired: form.ndaRequired,
    rfpReceived: form.rfpReceived,
    nextFollowUpAt: form.nextFollowUpAt || undefined,
    disqualifyReason: form.status === 'unqualified' ? form.disqualifyReason.trim() || undefined : undefined,
    notes: form.notes.trim() || undefined,
    customerOrgId: form.customerOrgId || '',
    campaignId: form.campaignId || '',
    additionalContacts: form.additionalContacts
      .map((c) => ({
        contactId: c.contactId || undefined,
        name: c.name.trim() || undefined,
        email: c.email.trim() || undefined,
        phone: c.phone.trim() || undefined,
        jobTitle: c.jobTitle.trim() || undefined,
        decisionRole: c.decisionRole || undefined,
      }))
      .filter((c) => c.name || c.email || c.phone || c.jobTitle || c.contactId),
  };
}

function Field({
  label,
  hint,
  className = '',
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block space-y-1.5 ${className}`}>
      <span className="block text-[13px] font-medium text-[color:var(--text-primary)]">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-[color:var(--text-muted)]">{hint}</span>}
    </label>
  );
}

function SectionCard({
  step,
  title,
  description,
  children,
}: {
  step: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-hidden shadow-[0_1px_0_rgba(255,255,255,0.04)_inset] h-full flex flex-col">
      <header className="flex gap-3 items-start px-5 sm:px-6 py-4 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]/40">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[color:var(--accent)]/15 text-[11px] font-semibold text-[color:var(--accent)]">
          {step}
        </span>
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5">{description}</p>
        </div>
      </header>
      <div className="p-5 sm:p-6 flex-1">{children}</div>
    </section>
  );
}

function refObjId(ref?: string | { _id: string } | null): string | undefined {
  if (!ref) return undefined;
  return typeof ref === 'string' ? ref : ref._id;
}

export default function CrmLeadForm() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const canCreate = canAny(user, 'taskflow.crm.lead.create');
  const canUpdate = canAny(user, 'taskflow.crm.lead.update');
  const allowed = isEdit ? canUpdate : canCreate;

  const [form, setForm] = useState<FormState>(EMPTY);
  const [users, setUsers] = useState<User[]>([]);
  const [orgs, setOrgs] = useState<Array<{ _id: string; name: string }>>([]);
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [orgQuery, setOrgQuery] = useState('');
  const [countryNames, setCountryNames] = useState<string[]>([]);
  const [countries, setCountries] = useState<CoreCountry[]>([]);
  const [currencies, setCurrencies] = useState<CoreCurrency[]>([]);
  const [campaigns, setCampaigns] = useState<CrmCampaign[]>([]);
  const [useExistingOrg, setUseExistingOrg] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [links, setLinks] = useState<{ customerOrgId?: string; dealId?: string; orgName?: string; dealTitle?: string }>(
    {}
  );

  useEffect(() => {
    if (!token) return;
    usersApi.list(1, 100, token).then((res) => {
      if (res.success && res.data) setUsers(res.data.data ?? []);
    });
    coreApi.listCountries(token, true).then((res) => {
      if (res.success && res.data) {
        setCountries(res.data);
        setCountryNames(res.data.map((c) => c.name).filter(Boolean));
      }
    });
    coreApi.listCurrencies(token, true).then((res) => {
      if (res.success && res.data) setCurrencies(res.data);
    });
    crmApi.listCampaigns(token).then((res) => {
      if (res.success && res.data) setCampaigns(res.data);
    });
  }, [token]);

  useEffect(() => {
    if (!token) return;
    crmApi.listCustomerOrgs(token).then((res) => {
      if (res.success && res.data) setOrgs(Array.isArray(res.data) ? res.data : []);
    });
  }, [token]);

  useEffect(() => {
    if (!token) {
      setContacts([]);
      return;
    }
    crmApi.listContacts(token, form.customerOrgId ? { customerOrgId: form.customerOrgId } : undefined).then((res) => {
      if (res.success && res.data) setContacts(Array.isArray(res.data) ? res.data : []);
    });
  }, [token, form.customerOrgId]);

  useEffect(() => {
    if (!token || !id) return;
    setLoading(true);
    crmApi.getLead(id, token).then((res) => {
      setLoading(false);
      if (res.success && res.data) {
        setForm(fromLead(res.data));
        const org = res.data.customerOrgId;
        setUseExistingOrg(Boolean(refId(org)));
        const deal = res.data.dealId;
        setLinks({
          customerOrgId: refObjId(org),
          dealId: refObjId(deal),
          orgName: org && typeof org === 'object' ? org.name : undefined,
          dealTitle: deal && typeof deal === 'object' ? deal.title : undefined,
        });
      } else setError('Lead not found');
    });
  }, [token, id]);

  const converted = form.status === 'converted';
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const toggleService = (sid: string) => {
    setForm((f) => ({
      ...f,
      serviceInterest: f.serviceInterest.includes(sid)
        ? f.serviceInterest.filter((x) => x !== sid)
        : [...f.serviceInterest, sid],
    }));
  };

  const statusOptions = useMemo(
    () => (converted ? LEAD_STATUSES : LEAD_STATUSES.filter((s) => s.id !== 'converted')),
    [converted]
  );

  const currencyOptions = useMemo(() => {
    const preferred = new Set(
      (countries.find((c) => c.name === form.country)?.currencyCodes ?? []).map((c) => c.toUpperCase())
    );
    return [...currencies].sort((a, b) => {
      const ap = preferred.has(a.code) ? 0 : 1;
      const bp = preferred.has(b.code) ? 0 : 1;
      return ap - bp || a.code.localeCompare(b.code);
    });
  }, [currencies, countries, form.country]);

  const existingCustomer = useExistingOrg;

  const filteredOrgs = useMemo(() => {
    const q = orgQuery.trim().toLowerCase();
    const ranked = [...orgs].sort((a, b) => a.name.localeCompare(b.name));
    if (!q) return ranked;
    return ranked.filter((a) => a.name.toLowerCase().includes(q));
  }, [orgs, orgQuery]);

  function applyOrg(customerOrgId: string) {
    if (!customerOrgId) {
      setForm((f) => ({ ...f, customerOrgId: '', contactId: '' }));
      return;
    }
    setUseExistingOrg(true);
    const org = orgs.find((a) => a._id === customerOrgId);
    setForm((f) => ({
      ...f,
      customerOrgId,
      contactId: '',
      companyName: org?.name ?? f.companyName,
    }));
  }

  function applyContact(contactId: string) {
    if (!contactId) {
      setForm((f) => ({ ...f, contactId: '' }));
      return;
    }
    const c = contacts.find((x) => x._id === contactId);
    if (!c) {
      setForm((f) => ({ ...f, contactId }));
      return;
    }
    setForm((f) => ({
      ...f,
      contactId: c._id,
      contactName: c.name,
      contactEmail: c.email ?? f.contactEmail,
      contactPhone: c.phone ?? f.contactPhone,
      jobTitle: c.title ?? f.jobTitle,
    }));
  }

  function patchExtra(index: number, patch: Partial<ExtraContact>) {
    setForm((f) => ({
      ...f,
      additionalContacts: f.additionalContacts.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    }));
  }

  function applyExtraContact(index: number, contactId: string) {
    if (!contactId) {
      patchExtra(index, { contactId: '' });
      return;
    }
    const c = contacts.find((x) => x._id === contactId);
    if (!c) {
      patchExtra(index, { contactId });
      return;
    }
    patchExtra(index, {
      contactId: c._id,
      name: c.name,
      email: c.email ?? '',
      phone: c.phone ?? '',
      jobTitle: c.title ?? '',
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !form.title.trim()) return;
    setSaving(true);
    setError('');
    const payload = toPayload(form);
    const res = isEdit && id ? await crmApi.updateLead(id, payload, token) : await crmApi.createLead(payload, token);
    setSaving(false);
    if (!res.success || !res.data) {
      setError((res as { message?: string }).message ?? 'Could not save lead');
      return;
    }
    navigate(`/crm/leads/${res.data._id}`);
  }

  if (!allowed) return <Navigate to="/crm/leads" replace />;
  if (loading) {
    return <ModuleLoader label="Loading lead…" />;
  }

  const backTo = id ? `/crm/leads/${id}` : '/crm/leads';

  return (
    <form onSubmit={submit} className="pb-24">
      <div className="sticky top-0 z-20 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]/90 backdrop-blur-md">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <Link to={backTo} className="text-[12px] font-medium text-[color:var(--accent)] hover:underline">
              ← {id ? 'Back to lead' : 'All leads'}
            </Link>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight mt-1 truncate">
              {isEdit ? form.title || 'Edit lead' : 'New lead'}
            </h1>
            <p className="text-[13px] text-[color:var(--text-muted)] mt-0.5">
              {isEdit ? 'Update discovery details. Converted leads stay read-only.' : 'Capture the opportunity so scoring and convert can use it.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to={backTo}
              className="px-4 py-2 rounded-xl border border-[color:var(--border-subtle)] text-sm font-medium hover:bg-[color:var(--bg-surface)]"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={saving || converted}
              className="btn-primary px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50"
            >
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create lead'}
            </button>
          </div>
        </div>
      </div>

      <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-5">
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
        )}

        {converted && (
          <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-5 py-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-emerald-300">This lead is converted</p>
              <p className="text-[13px] text-[color:var(--text-muted)] mt-1">
                Fields are locked. Continue on the customer organisation or deal created from this opportunity.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {links.customerOrgId && (
                <Link
                  to={`/admin/customer-orgs/${links.customerOrgId}`}
                  className="px-3 py-1.5 rounded-lg bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] text-xs font-medium hover:border-[color:var(--accent)]/40"
                >
                  {links.orgName ? `Customer · ${links.orgName}` : 'Open customer'}
                </Link>
              )}
              {id && (
                <Link
                  to={`/crm/leads/${id}`}
                  className="px-3 py-1.5 rounded-lg bg-[color:var(--accent)] text-white text-xs font-medium"
                >
                  {links.dealTitle ? `Deal · ${links.dealTitle}` : 'Open lead overview'}
                </Link>
              )}
            </div>
          </div>
        )}

        <fieldset disabled={converted} className="space-y-5 disabled:opacity-100">
          <div className="grid gap-5 xl:grid-cols-2 xl:items-start">
          <SectionCard step="1" title="Opportunity" description="What this lead is about, who owns it, and when to follow up.">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Title" className="sm:col-span-2 lg:col-span-4">
                <input
                  required
                  className={inputClass}
                  value={form.title}
                  onChange={(e) => set({ title: e.target.value })}
                  placeholder="e.g. Super 20 mobile app"
                />
              </Field>
              <Field label="Source" className="lg:col-span-1">
                <select className={inputClass} value={form.source} onChange={(e) => set({ source: e.target.value })}>
                  {LEAD_SOURCES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
              {isEdit && (
                <Field label="Status" className="lg:col-span-1">
                  <select
                    className={inputClass}
                    value={form.status}
                    disabled={converted}
                    onChange={(e) => set({ status: e.target.value })}
                  >
                    {statusOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Owner" className={isEdit ? 'lg:col-span-1' : 'sm:col-span-2 lg:col-span-3'}>
                <select className={inputClass} value={form.assigneeId} onChange={(e) => set({ assigneeId: e.target.value })}>
                  <option value="">Unassigned</option>
                  {users.map((u) => (
                    <option key={u._id} value={u._id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Campaign" className="sm:col-span-2 lg:col-span-2" hint="Catalog campaign for attribution. Active campaigns are listed first.">
                <select
                  className={inputClass}
                  value={form.campaignId}
                  disabled={converted}
                  onChange={(e) => {
                    const id = e.target.value;
                    const c = campaigns.find((x) => x._id === id);
                    set({
                      campaignId: id,
                      campaign: c ? c.utmCampaign || c.code : form.campaign,
                    });
                  }}
                >
                  <option value="">— None —</option>
                  {[...campaigns]
                    .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || a.name.localeCompare(b.name))
                    .map((c) => (
                      <option key={c._id} value={c._id}>
                        {c.name} ({c.code}){c.status !== 'active' ? ` · ${c.status}` : ''}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Extra UTM / note" className="lg:col-span-1">
                <input
                  className={inputClass}
                  value={form.campaign}
                  onChange={(e) => set({ campaign: e.target.value })}
                  placeholder="Optional"
                />
              </Field>
              <Field label="Next follow-up" className="lg:col-span-1">
                <input
                  type="date"
                  className={inputClass}
                  value={form.nextFollowUpAt}
                  onChange={(e) => set({ nextFollowUpAt: e.target.value })}
                />
              </Field>
            </div>
          </SectionCard>

          <SectionCard step="2" title="Company" description="Link an existing Customer Portal organisation, or enter a new company.">
            <div className="mb-4 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]/60 p-3.5">
              <p className="text-[13px] font-medium mb-2">Existing customer?</p>
              <div className="flex flex-wrap gap-2 mb-3">
                <button
                  type="button"
                  disabled={converted}
                  onClick={() => {
                    setUseExistingOrg(false);
                    applyOrg('');
                  }}
                  className={`px-3 py-1.5 rounded-full text-[13px] border transition-colors ${
                    !existingCustomer
                      ? 'border-[color:var(--accent)] bg-[color:var(--accent)]/15 text-[color:var(--accent)]'
                      : 'border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:border-[color:var(--text-muted)]'
                  }`}
                >
                  New company
                </button>
                <button
                  type="button"
                  disabled={converted}
                  onClick={() => setUseExistingOrg(true)}
                  className={`px-3 py-1.5 rounded-full text-[13px] border transition-colors ${
                    existingCustomer
                      ? 'border-[color:var(--accent)] bg-[color:var(--accent)]/15 text-[color:var(--accent)]'
                      : 'border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:border-[color:var(--text-muted)]'
                  }`}
                >
                  Already a customer
                </button>
              </div>
              {useExistingOrg && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Search customers">
                  <input
                    className={inputClass}
                    value={orgQuery}
                    disabled={converted}
                    onChange={(e) => setOrgQuery(e.target.value)}
                    placeholder="Organisation name…"
                  />
                </Field>
                <Field
                  label="Customer organisation"
                  hint={existingCustomer ? 'Convert will reuse this portal customer.' : 'From Customer Portal management.'}
                >
                  <select
                    className={inputClass}
                    value={form.customerOrgId}
                    disabled={converted}
                    onChange={(e) => applyOrg(e.target.value)}
                  >
                    <option value="">— Select customer —</option>
                    {filteredOrgs.map((a) => (
                      <option key={a._id} value={a._id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Company name">
                <input className={inputClass} value={form.companyName} onChange={(e) => set({ companyName: e.target.value })} />
              </Field>
              <Field label="Website">
                <input
                  className={inputClass}
                  value={form.website}
                  onChange={(e) => set({ website: e.target.value })}
                  placeholder="https://"
                />
              </Field>
              <Field label="Industry">
                <input
                  className={inputClass}
                  value={form.industry}
                  onChange={(e) => set({ industry: e.target.value })}
                  placeholder="SaaS, fintech…"
                />
              </Field>
              <Field label="Company size">
                <select className={inputClass} value={form.companySize} onChange={(e) => set({ companySize: e.target.value })}>
                  <option value="">Unknown</option>
                  {LEAD_COMPANY_SIZES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Country" hint="From the country catalog. Type to search.">
                <CountryAutocomplete
                  value={form.country}
                  countries={countryNames}
                  disabled={converted}
                  inputClass={inputClass}
                  onChange={(country) => set({ country })}
                  onPick={(country) => {
                    const match = countries.find((c) => c.name === country);
                    const code = match?.currencyCodes?.[0];
                    const hasCode = code && currencies.some((cur) => cur.code === code);
                    set({ country, ...(hasCode ? { currency: code } : {}) });
                  }}
                />
              </Field>
              <Field label="Tags" className="sm:col-span-2 lg:col-span-3" hint="Comma-separated. Used for filtering later.">
                <input
                  className={inputClass}
                  value={form.tags}
                  onChange={(e) => set({ tags: e.target.value })}
                  placeholder="mobile, referral, q3"
                />
              </Field>
            </div>
          </SectionCard>
          </div>

          <div className="grid gap-5 xl:grid-cols-2 xl:items-start">
          <SectionCard step="3" title="Contacts" description="Primary contact is used for scoring and portal invite on convert. Add others who are in the buying group.">
            {contacts.length > 0 && (
              <Field label="Existing contact (primary)" className="mb-4" hint="Fills name, email, phone, and title from Contacts.">
                <select
                  className={inputClass}
                  value={form.contactId}
                  disabled={converted}
                  onChange={(e) => applyContact(e.target.value)}
                >
                  <option value="">— Enter a new person —</option>
                  {contacts.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                      {c.email ? ` · ${c.email}` : ''}
                      {c.isPrimary ? ' (primary)' : ''}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <p className="text-[12px] font-medium text-[color:var(--text-muted)] mb-2">Primary</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Name">
                <input className={inputClass} value={form.contactName} onChange={(e) => set({ contactName: e.target.value })} />
              </Field>
              <Field label="Job title">
                <input
                  className={inputClass}
                  value={form.jobTitle}
                  onChange={(e) => set({ jobTitle: e.target.value })}
                  placeholder="CTO, VP Engineering…"
                />
              </Field>
              <Field label="Email">
                <input
                  type="email"
                  className={inputClass}
                  value={form.contactEmail}
                  onChange={(e) => set({ contactEmail: e.target.value })}
                  placeholder="name@company.com"
                />
              </Field>
              <Field label="Phone">
                <input className={inputClass} value={form.contactPhone} onChange={(e) => set({ contactPhone: e.target.value })} />
              </Field>
              <Field label="Buying role" className="sm:col-span-2 lg:col-span-1">
                <select className={inputClass} value={form.decisionRole} onChange={(e) => set({ decisionRole: e.target.value })}>
                  <option value="">Unknown</option>
                  {LEAD_ROLES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {form.additionalContacts.map((extra, index) => (
              <div
                key={index}
                className="mt-5 pt-5 border-t border-[color:var(--border-subtle)] space-y-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12px] font-medium text-[color:var(--text-muted)]">Contact {index + 2}</p>
                  {!converted && (
                    <button
                      type="button"
                      className="text-[12px] text-red-400 hover:text-red-300"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          additionalContacts: f.additionalContacts.filter((_, i) => i !== index),
                        }))
                      }
                    >
                      Remove
                    </button>
                  )}
                </div>
                {contacts.length > 0 && (
                  <Field label="Existing contact">
                    <select
                      className={inputClass}
                      value={extra.contactId}
                      disabled={converted}
                      onChange={(e) => applyExtraContact(index, e.target.value)}
                    >
                      <option value="">— Enter a new person —</option>
                      {contacts
                        .filter((c) => c._id === extra.contactId || (c._id !== form.contactId && !form.additionalContacts.some((o, i) => i !== index && o.contactId === c._id)))
                        .map((c) => (
                          <option key={c._id} value={c._id}>
                            {c.name}
                            {c.email ? ` · ${c.email}` : ''}
                            {c.isPrimary ? ' (primary)' : ''}
                          </option>
                        ))}
                    </select>
                  </Field>
                )}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Name">
                    <input
                      className={inputClass}
                      value={extra.name}
                      disabled={converted}
                      onChange={(e) => patchExtra(index, { name: e.target.value })}
                    />
                  </Field>
                  <Field label="Job title">
                    <input
                      className={inputClass}
                      value={extra.jobTitle}
                      disabled={converted}
                      onChange={(e) => patchExtra(index, { jobTitle: e.target.value })}
                      placeholder="CFO, Procurement…"
                    />
                  </Field>
                  <Field label="Email">
                    <input
                      type="email"
                      className={inputClass}
                      value={extra.email}
                      disabled={converted}
                      onChange={(e) => patchExtra(index, { email: e.target.value })}
                    />
                  </Field>
                  <Field label="Phone">
                    <input
                      className={inputClass}
                      value={extra.phone}
                      disabled={converted}
                      onChange={(e) => patchExtra(index, { phone: e.target.value })}
                    />
                  </Field>
                  <Field label="Buying role" className="sm:col-span-2 lg:col-span-1">
                    <select
                      className={inputClass}
                      value={extra.decisionRole}
                      disabled={converted}
                      onChange={(e) => patchExtra(index, { decisionRole: e.target.value })}
                    >
                      <option value="">Unknown</option>
                      {LEAD_ROLES.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </div>
            ))}

            {!converted && (
              <button
                type="button"
                className="mt-4 text-sm text-[color:var(--accent)] hover:underline"
                onClick={() => setForm((f) => ({ ...f, additionalContacts: [...f.additionalContacts, emptyExtra()] }))}
              >
                + Add another contact
              </button>
            )}
          </SectionCard>

          <SectionCard step="4" title="IT engagement" description="What they need, how soon, and roughly how much.">
            <div className="space-y-5">
              <div>
                <p className="text-[13px] font-medium mb-2">Services of interest</p>
                <div className="flex flex-wrap gap-2">
                  {LEAD_SERVICES.map((s) => {
                    const on = form.serviceInterest.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggleService(s.id)}
                        className={`px-3 py-1.5 rounded-full text-[13px] border transition-colors ${
                          on
                            ? 'border-[color:var(--accent)] bg-[color:var(--accent)]/15 text-[color:var(--accent)]'
                            : 'border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:border-[color:var(--text-muted)]'
                        }`}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Tech stack">
                  <input
                    className={inputClass}
                    value={form.techStack}
                    onChange={(e) => set({ techStack: e.target.value })}
                    placeholder="React, Node, AWS…"
                  />
                </Field>
                <Field label="Timeline">
                  <select className={inputClass} value={form.timeline} onChange={(e) => set({ timeline: e.target.value })}>
                    <option value="">Unknown</option>
                    {LEAD_TIMELINES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Estimated budget">
                  <input
                    type="number"
                    min={0}
                    className={inputClass}
                    value={form.estimatedBudget}
                    onChange={(e) => set({ estimatedBudget: e.target.value })}
                    placeholder="0"
                  />
                </Field>
                <Field label="Currency" hint="From the currency catalog. Search by code, name, or symbol.">
                  <CurrencyAutocomplete
                    currencies={currencyOptions}
                    value={form.currency}
                    disabled={converted}
                    triggerClass={`${inputClass} flex items-center justify-between gap-2 text-left`}
                    onChange={(currency) => set({ currency })}
                  />
                </Field>
                <Field label="Competitor / incumbent" className="sm:col-span-2">
                  <input className={inputClass} value={form.competitor} onChange={(e) => set({ competitor: e.target.value })} />
                </Field>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <label
                  className={`flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer ${
                    form.rfpReceived ? 'border-[color:var(--accent)]/40 bg-[color:var(--accent)]/10' : 'border-[color:var(--border-subtle)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={form.rfpReceived}
                    onChange={(e) => set({ rfpReceived: e.target.checked })}
                  />
                  <span>
                    <span className="block text-sm font-medium">RFP / tender received</span>
                    <span className="block text-[12px] text-[color:var(--text-muted)]">Raises lead score and flags a formal process.</span>
                  </span>
                </label>
                <label
                  className={`flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer ${
                    form.ndaRequired ? 'border-[color:var(--accent)]/40 bg-[color:var(--accent)]/10' : 'border-[color:var(--border-subtle)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={form.ndaRequired}
                    onChange={(e) => set({ ndaRequired: e.target.checked })}
                  />
                  <span>
                    <span className="block text-sm font-medium">NDA required</span>
                    <span className="block text-[12px] text-[color:var(--text-muted)]">Remind the team before sharing a proposal.</span>
                  </span>
                </label>
              </div>
            </div>
          </SectionCard>
          </div>

          <SectionCard step="5" title="Notes" description="Context that does not fit a field — constraints, next steps, politics.">
            <div className="space-y-4">
              {form.status === 'unqualified' && (
                <Field label="Disqualify reason">
                  <input
                    className={inputClass}
                    value={form.disqualifyReason}
                    onChange={(e) => set({ disqualifyReason: e.target.value })}
                    placeholder="Budget, timing, no fit…"
                  />
                </Field>
              )}
              <textarea
                rows={4}
                className={inputClass}
                value={form.notes}
                onChange={(e) => set({ notes: e.target.value })}
                placeholder="Discovery notes, constraints, next steps…"
              />
            </div>
          </SectionCard>
        </fieldset>
      </div>
    </form>
  );
}
