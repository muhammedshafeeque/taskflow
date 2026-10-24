import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { coreApi, crmApi, usersApi, type CoreCurrency, type CrmAccount, type CrmContact, type CrmDeal, type CrmPipeline, type User } from '../../lib/api';
import { PersonSelect, toPeople } from '../../components/people';
import { CurrencyAutocomplete } from '../../components/CurrencyAutocomplete';
import { Field, Modal, btnPrimary, btnSecondary, errorOf, inputCls, refId, toDateInput } from './crmKit';

type Form = {
  title: string;
  customerOrgId: string;
  accountId: string;
  contactId: string;
  ownerId: string;
  pipelineId: string;
  stageId: string;
  value: string;
  currency: string;
  probability: string;
  expectedCloseDate: string;
};

/**
 * Create or edit a deal. Pass `deal` to edit; otherwise `defaults` seed a new one
 * (e.g. the stage column it was opened from).
 */
type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: (deal: CrmDeal) => void;
  deal?: CrmDeal | null;
  pipelines: CrmPipeline[];
  defaults?: Partial<Form>;
};

export default function DealFormModal(props: Props) {
  // Mounting the form on open seeds its state fresh from the deal / defaults each time.
  return props.open ? <DealForm key={props.deal?._id ?? 'new'} {...props} /> : null;
}

function initialForm(deal: CrmDeal | null | undefined, pipelines: CrmPipeline[], defaults: Partial<Form> | undefined, userId: string | undefined): Form {
  const pipe = pipelines.find((p) => p._id === (deal?.pipelineId ?? defaults?.pipelineId)) ?? pipelines.find((p) => p.isDefault) ?? pipelines[0];
  const firstStage = pipe ? [...pipe.stages].sort((a, b) => a.order - b.order).find((s) => !s.isWon && !s.isLost) : undefined;
  const stageId = String(deal?.stageId ?? defaults?.stageId ?? firstStage?._id ?? '');
  return {
    title: deal?.title ?? '',
    customerOrgId: refId(deal?.customerOrgId) || defaults?.customerOrgId || '',
    accountId: refId(deal?.accountId) || defaults?.accountId || '',
    contactId: refId(deal?.contactId) || '',
    ownerId: refId(deal?.ownerId) || (deal ? '' : (userId ?? '')),
    pipelineId: pipe?._id ?? '',
    stageId,
    value: String(deal?.value ?? defaults?.value ?? ''),
    currency: deal?.currency ?? defaults?.currency ?? 'USD',
    probability: String(deal?.probability ?? pipe?.stages.find((s) => s._id === stageId)?.probability ?? 0),
    expectedCloseDate: toDateInput(deal?.expectedCloseDate) || defaults?.expectedCloseDate || '',
  };
}

function DealForm({ open, onClose, onSaved, deal, pipelines, defaults }: Props) {
  const { token, user } = useAuth();
  const [orgs, setOrgs] = useState<Array<{ _id: string; name: string }>>([]);
  const [accounts, setAccounts] = useState<CrmAccount[]>([]);
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [currencies, setCurrencies] = useState<CoreCurrency[]>([]);
  const [form, setForm] = useState<Form>(() => initialForm(deal, pipelines, defaults, user?.id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !token) return;
    void Promise.all([
      crmApi.listCustomerOrgs(token),
      crmApi.listAccounts(token, { limit: 200 }),
      crmApi.listContacts(token),
      usersApi.list(1, 100, token),
      coreApi.listCurrencies(token),
      deal ? Promise.resolve(null) : coreApi.getCompany(token),
    ]).then(([o, a, c, u, cur, company]) => {
      if (cur.success && cur.data) setCurrencies(cur.data);
      // New deals default to the company's base currency.
      const base = company?.success ? company.data?.baseCurrencyCode : undefined;
      if (base && !defaults?.currency) setForm((f) => (f.title || f.value ? f : { ...f, currency: base }));
      if (o.success && o.data) setOrgs(o.data);
      if (a.success && a.data) setAccounts(a.data.data ?? []);
      if (c.success && c.data) setContacts(c.data);
      if (u.success && u.data) setUsers(u.data.data ?? []);
    });
  }, [open, token, deal, defaults?.currency]);

  const pipeline = pipelines.find((p) => p._id === form.pipelineId);
  const stages = pipeline ? [...pipeline.stages].sort((a, b) => a.order - b.order) : [];
  const orgContacts = contacts.filter((c) => !form.customerOrgId || !c.customerOrgId || refId(c.customerOrgId) === form.customerOrgId);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (!form.title.trim()) return setError('Give the deal a title.');
    if (!deal && !form.customerOrgId) return setError('Choose a customer.');
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = {
      title: form.title.trim(),
      customerOrgId: form.customerOrgId || undefined,
      accountId: form.accountId,
      contactId: form.contactId,
      ownerId: form.ownerId,
      pipelineId: form.pipelineId,
      stageId: form.stageId,
      value: Number(form.value) || 0,
      currency: form.currency || 'USD',
      probability: Math.min(100, Math.max(0, Number(form.probability) || 0)),
      expectedCloseDate: form.expectedCloseDate || null,
    };
    const res = deal ? await crmApi.updateDeal(deal._id, body as Partial<CrmDeal>, token) : await crmApi.createDeal(body as Partial<CrmDeal>, token);
    setSaving(false);
    if (!res.success || !res.data) return setError(errorOf(res, 'Could not save the deal.'));
    onSaved(res.data);
  }

  return (
    <Modal open={open} onClose={onClose} title={deal ? 'Edit deal' : 'New deal'} width="max-w-2xl">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Title">
          <input autoFocus required value={form.title} onChange={(e) => set({ title: e.target.value })} className={inputCls} placeholder="e.g. Website rebuild — Phase 2" />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Customer" hint={orgs.length === 0 ? 'Create a customer organisation in portal admin first.' : undefined}>
            <select required={!deal} value={form.customerOrgId} onChange={(e) => set({ customerOrgId: e.target.value, contactId: '' })} className={inputCls}>
              <option value="">Select customer…</option>
              {orgs.map((o) => (
                <option key={o._id} value={o._id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Account">
            <select value={form.accountId} onChange={(e) => set({ accountId: e.target.value })} className={inputCls}>
              <option value="">No account</option>
              {accounts.map((a) => (
                <option key={a._id} value={a._id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Primary contact">
            <PersonSelect
              value={form.contactId}
              onChange={(v) => set({ contactId: v })}
              people={toPeople(orgContacts)}
              specialOptions={[{ value: '', label: 'No contact' }]}
              clearValue=""
              placeholder="Search contacts…"
            />
          </Field>
          <Field label="Owner">
            <PersonSelect
              value={form.ownerId}
              onChange={(v) => set({ ownerId: v })}
              people={toPeople(users)}
              specialOptions={[{ value: '', label: 'Unassigned' }]}
              clearValue=""
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {pipelines.length > 1 && (
            <Field label="Pipeline">
              <select
                value={form.pipelineId}
                onChange={(e) => {
                  const p = pipelines.find((x) => x._id === e.target.value);
                  const first = p ? [...p.stages].sort((a, b) => a.order - b.order)[0] : undefined;
                  set({ pipelineId: e.target.value, stageId: first?._id ?? '', probability: String(first?.probability ?? 0) });
                }}
                className={inputCls}
              >
                {pipelines.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Stage">
            <select
              value={form.stageId}
              onChange={(e) => set({ stageId: e.target.value, probability: String(stages.find((s) => s._id === e.target.value)?.probability ?? form.probability) })}
              className={inputCls}
            >
              {stages.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.name} ({s.probability}%)
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          <Field label="Value" className="col-span-2 sm:col-span-1">
            <input type="number" min={0} step="any" value={form.value} onChange={(e) => set({ value: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Currency">
            {currencies.length ? (
              <CurrencyAutocomplete currencies={currencies} value={form.currency} onChange={(code) => set({ currency: code })} />
            ) : (
              <input value={form.currency} maxLength={3} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} className={`${inputCls} uppercase`} />
            )}
          </Field>
          <Field label="Probability %">
            <input type="number" min={0} max={100} value={form.probability} onChange={(e) => set({ probability: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Expected close" className="col-span-2 sm:col-span-1">
            <input type="date" value={form.expectedCloseDate} onChange={(e) => set({ expectedCloseDate: e.target.value })} className={inputCls} />
          </Field>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={btnPrimary}>
            {saving ? 'Saving…' : deal ? 'Save changes' : 'Create deal'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
