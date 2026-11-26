import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { procurementApi } from '../../lib/api';
import type { PurchaseOrder, CrmAccount, ProcurementSettings, ProcurementApprover } from '../../lib/api';
import {
  ExportButton, Field, GhostButton, Modal, PrimaryButton, Select, SectionPage, StatusPill, TextArea, TextInput, money, nameOf,
} from '../../components/moduleKit';
import { ModuleLoader } from '../../components/loaders/ModuleLoader';
import { PersonMultiSelect, PersonSelect, toPeople } from '../../components/people';
import RecordLinksDrawer from '../../components/RecordLinksDrawer';
import { useRecordLinksParam } from '../../hooks/useRecordLinksParam';

const poStatusTone: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'slate' | 'violet'> = {
  draft: 'slate', pending_approval: 'amber', approved: 'blue', ordered: 'violet', received: 'green', cancelled: 'red',
};

function idOf(ref: string | { _id?: string } | undefined): string {
  if (!ref) return '';
  return typeof ref === 'string' ? ref : (ref._id ?? '');
}

function tableWrap(children: React.ReactNode) {
  return (
    <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-x-auto">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

type Line = { description: string; quantity: number; unitPrice: number };

const EMPTY_SETTINGS: ProcurementSettings = {
  singleApproverLimit: null,
  maxOrderAmount: null,
  secondApproverIds: [],
  approverLimits: [],
};

function PoList({ title, subtitle, fixedCategory }: { title: string; subtitle: string; fixedCategory?: string }) {
  const [linksId, setLinksId] = useRecordLinksParam('po');
  const { token, user } = useAuth();
  const [rows, setRows] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<CrmAccount[]>([]);
  const [settings, setSettings] = useState<ProcurementSettings>(EMPTY_SETTINGS);
  const [approvers, setApprovers] = useState<ProcurementApprover[]>([]);
  const [editing, setEditing] = useState<{ _id?: string; title: string; vendorAccountId: string; category: string; currency: string; lines: Line[]; notes: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState<{
    singleApproverLimit: string;
    maxOrderAmount: string;
    secondApproverIds: string[];
    approverLimits: Array<{ userId: string; maxAmount: string }>;
  }>({ singleApproverLimit: '', maxOrderAmount: '', secondApproverIds: [], approverLimits: [] });
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [errMsg, setErrMsg] = useState('');

  const canCreate = canAny(user, 'taskflow.procurement.po.create', 'taskflow.procurement.po.manage');
  const canApprove = canAny(user, 'taskflow.procurement.po.approve', 'taskflow.procurement.po.manage');
  const canManage = canAny(user, 'taskflow.procurement.po.manage');
  const canSettings = canAny(user, 'taskflow.procurement.settings.manage', 'taskflow.procurement.po.manage');

  const load = useCallback(() => {
    if (!token) return;
    procurementApi.listPos(token, fixedCategory ? { category: fixedCategory } : undefined).then((r) => { setLoading(false); if (r.success && r.data) setRows(r.data); });
    procurementApi.listVendors(token).then((r) => r.success && r.data && setVendors(r.data));
    procurementApi.settings(token).then((r) => r.success && r.data && setSettings(r.data));
    if (canSettings) {
      procurementApi.listApprovers(token).then((r) => r.success && r.data && setApprovers(r.data));
    }
  }, [token, fixedCategory, canSettings]);
  useEffect(load, [load]);

  const openNew = () => setEditing({ title: '', vendorAccountId: '', category: fixedCategory ?? 'hardware', currency: 'USD', lines: [{ description: '', quantity: 1, unitPrice: 0 }], notes: '' });

  const openSettings = () => {
    setSettingsForm({
      singleApproverLimit: settings.singleApproverLimit != null ? String(settings.singleApproverLimit) : '',
      maxOrderAmount: settings.maxOrderAmount != null ? String(settings.maxOrderAmount) : '',
      secondApproverIds: [...settings.secondApproverIds],
      approverLimits: settings.approverLimits
        .filter((l) => l.userId)
        .map((l) => ({ userId: l.userId!, maxAmount: String(l.maxAmount) })),
    });
    setSettingsOpen(true);
  };

  const saveSettings = async () => {
    if (!token) return;
    setErrMsg('');
    const payload = {
      singleApproverLimit: settingsForm.singleApproverLimit.trim() === '' ? null : Number(settingsForm.singleApproverLimit),
      maxOrderAmount: settingsForm.maxOrderAmount.trim() === '' ? null : Number(settingsForm.maxOrderAmount),
      secondApproverIds: settingsForm.secondApproverIds,
      approverLimits: settingsForm.approverLimits
        .filter((l) => l.userId && l.maxAmount.trim() !== '')
        .map((l) => ({ userId: l.userId, maxAmount: Number(l.maxAmount) })),
    };
    const res = await procurementApi.updateSettings(payload, token);
    if (!res.success) {
      setErrMsg(res.message || 'Failed to save approval limits');
      return;
    }
    if (res.data) setSettings(res.data);
    setSettingsOpen(false);
    setMsg('Approval limits saved.');
    setTimeout(() => setMsg(''), 4000);
  };

  const save = async () => {
    if (!token || !editing) return;
    if (!editing.vendorAccountId) return alert('Choose a vendor');
    const payload = { ...editing, lines: editing.lines.filter((l) => l.description) };
    const res = editing._id ? await procurementApi.updatePo(editing._id, payload, token) : await procurementApi.createPo(payload, token);
    if (res.success) { setEditing(null); load(); } else alert(res.message);
  };

  const transition = async (id: string, status: string) => {
    if (!token) return;
    setErrMsg('');
    const res = await procurementApi.transitionPo(id, status, token);
    if (!res.success) {
      setErrMsg(res.message || 'Status update failed');
      return;
    }
    const data = res.data as (PurchaseOrder & { awaitingSecondApproval?: boolean; provisioned?: { assetsCreated: number; licensesCreated: number } }) | undefined;
    if (data?.awaitingSecondApproval) {
      setMsg('First approval recorded. A second approver is required to complete approval.');
      setTimeout(() => setMsg(''), 6000);
    } else if (data?.provisioned && (data.provisioned.assetsCreated || data.provisioned.licensesCreated)) {
      const parts = [
        data.provisioned.assetsCreated ? `${data.provisioned.assetsCreated} asset${data.provisioned.assetsCreated > 1 ? 's' : ''}` : '',
        data.provisioned.licensesCreated ? `${data.provisioned.licensesCreated} license${data.provisioned.licensesCreated > 1 ? 's' : ''}` : '',
      ].filter(Boolean).join(' and ');
      setMsg(`Received — provisioned ${parts} into Assets.`);
      setTimeout(() => setMsg(''), 6000);
    }
    load();
  };

  const remove = async (id: string) => {
    if (!token || !confirm('Delete PO?')) return;
    setErrMsg('');
    const res = await procurementApi.removePo(id, token);
    if (!res.success) setErrMsg(res.message || 'Failed to delete PO');
    load();
  };

  const lineTotal = editing ? editing.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0) : 0;

  const actionsFor = (p: PurchaseOrder) => {
    const actions: Array<{ label: string; status: string; disabled?: boolean; title?: string }> = [];
    const uid = user?.id ?? '';
    const isCreator = Boolean(uid && idOf(p.requestedBy) === uid);
    const isFirstApprover = Boolean(uid && idOf(p.firstApprovedBy) === uid);
    const hasFirstApproval = Boolean(idOf(p.firstApprovedBy));

    if (p.status === 'draft' && canCreate) {
      actions.push({ label: 'Submit', status: 'pending_approval' });
    } else if (p.status === 'pending_approval' && canApprove) {
      const approveDisabled = isCreator || isFirstApprover;
      const approveTitle = isCreator
        ? 'The creator of a purchase order cannot approve it'
        : isFirstApprover
          ? 'A different user must provide the second approval'
          : undefined;
      actions.push({
        label: hasFirstApproval ? '2nd Approve' : 'Approve',
        status: 'approved',
        disabled: approveDisabled,
        title: approveTitle,
      });
      actions.push({ label: 'Reject', status: 'cancelled' });
    } else if (p.status === 'approved' && canManage) {
      actions.push({ label: 'Mark ordered', status: 'ordered' });
    } else if (p.status === 'ordered' && canManage) {
      actions.push({ label: 'Mark received', status: 'received' });
    }
    return actions;
  };

  return (
    <SectionPage
      title={title}
      subtitle={subtitle}
      toolbar={
        <div className="flex gap-2">
          {canSettings && <GhostButton onClick={openSettings}>Approval limits</GhostButton>}
          <ExportButton rows={rows} filename="purchase-orders" columns={[
            { header: 'PO', value: (r) => r.poNumber },
            { header: 'Title', value: (r) => r.title },
            { header: 'Vendor', value: (r) => nameOf(r.vendorAccountId, '') },
            { header: 'Category', value: (r) => r.category },
            { header: 'Status', value: (r) => r.status },
            { header: 'Currency', value: (r) => r.currency },
            { header: 'Total', value: (r) => r.total },
          ]} />
          {canCreate && <PrimaryButton onClick={openNew}>+ New PO</PrimaryButton>}
        </div>
      }
    >
      {(settings.singleApproverLimit != null || settings.maxOrderAmount != null) && (
        <div className="mb-3 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-4 py-2 text-xs text-[color:var(--text-muted)] flex flex-wrap gap-4">
          {settings.singleApproverLimit != null && (
            <span>2nd approver required above: <strong className="text-[color:var(--text-primary)]">{money(settings.singleApproverLimit)}</strong></span>
          )}
          {settings.maxOrderAmount != null && (
            <span>Max PO total: <strong className="text-[color:var(--text-primary)]">{money(settings.maxOrderAmount)}</strong></span>
          )}
        </div>
      )}
      {msg && <div className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-600 dark:text-emerald-400">{msg}</div>}
      {errMsg && <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-500">{errMsg}</div>}
      {loading ? <ModuleLoader size="block" label="Loading purchase orders…" /> : rows.length === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)]">No purchase orders yet.</p>
      ) : (
        tableWrap(
          <>
            <thead className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">
              <tr><th className="text-left px-4 py-2.5 font-medium">PO</th><th className="text-left px-4 py-2.5 font-medium">Vendor</th><th className="text-left px-4 py-2.5 font-medium">Status</th><th className="text-right px-4 py-2.5 font-medium">Total</th><th className="px-4 py-2.5" /></tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p._id} className="border-t border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-page)]">
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{p.title}</p>
                    <p className="text-[11px] text-[color:var(--text-muted)]">
                      {p.poNumber} · {p.category}
                      {p.requestedBy && typeof p.requestedBy === 'object' && p.requestedBy.name ? ` · by ${p.requestedBy.name}` : ''}
                    </p>
                  </td>
                  <td className="px-4 py-2.5">
                    {p.vendorAccountId && typeof p.vendorAccountId === 'object' && p.vendorAccountId._id ? (
                      <Link to={`/crm/accounts/${p.vendorAccountId._id}`} className="text-[color:var(--accent)] hover:underline">
                        {nameOf(p.vendorAccountId, '—')}
                      </Link>
                    ) : (
                      nameOf(p.vendorAccountId, '—')
                    )}
                    {p.projectId && typeof p.projectId === 'object' && p.projectId._id && (
                      <p className="text-[11px]">
                        <Link to={`/projects/${p.projectId._id}/dashboard`} className="text-[color:var(--accent)] hover:underline">
                          {p.projectId.key ?? 'Project'}
                        </Link>
                      </p>
                    )}
                    {p.contractId && typeof p.contractId === 'object' && p.contractId._id && (
                      <p className="text-[11px]">
                        <Link to="/contracts" className="text-[color:var(--accent)] hover:underline">
                          {p.contractId.title ?? 'Contract'}
                        </Link>
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusPill label={p.status} tone={poStatusTone[p.status]} />
                    {p.status === 'pending_approval' && p.firstApprovedBy && typeof p.firstApprovedBy === 'object' && (
                      <p className="text-[11px] text-[color:var(--text-muted)] mt-1">
                        1st approved by {p.firstApprovedBy.name || p.firstApprovedBy.email || 'approver'}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{money(p.total, p.currency)}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {actionsFor(p).map((t) => (
                      <button
                        key={t.status}
                        disabled={t.disabled}
                        title={t.title}
                        onClick={() => transition(p._id, t.status)}
                        className={`text-xs mr-3 ${t.disabled ? 'text-[color:var(--text-muted)] opacity-50 cursor-not-allowed' : 'text-[color:var(--accent)] hover:underline'}`}
                      >
                        {t.label}
                      </button>
                    ))}
                    <button onClick={() => setLinksId(p._id)} className="text-[color:var(--accent)] hover:underline text-xs mr-3">Links</button>
                    {canManage && <button onClick={() => remove(p._id)} className="text-rose-500 hover:underline text-xs">Delete</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </>
        )
      )}

      {editing && (
        <Modal title={editing._id ? 'Edit PO' : 'New purchase order'} onClose={() => setEditing(null)} wide footer={<><GhostButton onClick={() => setEditing(null)}>Cancel</GhostButton><PrimaryButton onClick={save}>Save</PrimaryButton></>}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Title"><TextInput value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></Field>
            <Field label="Vendor">
              <Select value={editing.vendorAccountId} onChange={(e) => setEditing({ ...editing, vendorAccountId: e.target.value })}>
                <option value="">Select…</option>
                {vendors.map((v) => <option key={v._id} value={v._id}>{v.name}</option>)}
              </Select>
            </Field>
            <Field label="Category">
              <Select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                {['hardware', 'software', 'services', 'subscription', 'other'].map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Currency"><TextInput value={editing.currency} onChange={(e) => setEditing({ ...editing, currency: e.target.value })} /></Field>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-muted)]">Line items</span>
              <button onClick={() => setEditing({ ...editing, lines: [...editing.lines, { description: '', quantity: 1, unitPrice: 0 }] })} className="text-xs text-[color:var(--accent)] hover:underline">+ Add line</button>
            </div>
            <div className="space-y-2">
              {editing.lines.map((l, i) => (
                <div key={i} className="grid grid-cols-[1fr_70px_90px_auto] gap-2 items-center">
                  <TextInput placeholder="Description" value={l.description} onChange={(e) => { const lines = [...editing.lines]; lines[i] = { ...l, description: e.target.value }; setEditing({ ...editing, lines }); }} />
                  <TextInput type="number" value={l.quantity} onChange={(e) => { const lines = [...editing.lines]; lines[i] = { ...l, quantity: Number(e.target.value) }; setEditing({ ...editing, lines }); }} />
                  <TextInput type="number" value={l.unitPrice} onChange={(e) => { const lines = [...editing.lines]; lines[i] = { ...l, unitPrice: Number(e.target.value) }; setEditing({ ...editing, lines }); }} />
                  <button onClick={() => setEditing({ ...editing, lines: editing.lines.filter((_, j) => j !== i) })} className="text-rose-500 text-sm px-2">✕</button>
                </div>
              ))}
            </div>
            <p className="text-right text-sm font-semibold mt-2">Subtotal: {money(lineTotal, editing.currency)}</p>
          </div>
          <Field label="Notes"><TextArea rows={2} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field>
        </Modal>
      )}

      {settingsOpen && (
        <Modal
          title="Purchase order approval limits"
          onClose={() => setSettingsOpen(false)}
          wide
          footer={<><GhostButton onClick={() => setSettingsOpen(false)}>Cancel</GhostButton><PrimaryButton onClick={saveSettings}>Save limits</PrimaryButton></>}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Two-step approval threshold (leave empty for 1 approver)">
              <TextInput
                type="number"
                min={0}
                placeholder="e.g. 1000"
                value={settingsForm.singleApproverLimit}
                onChange={(e) => setSettingsForm({ ...settingsForm, singleApproverLimit: e.target.value })}
              />
            </Field>
            <Field label="Maximum PO amount (leave empty for unlimited)">
              <TextInput
                type="number"
                min={0}
                placeholder="e.g. 50000"
                value={settingsForm.maxOrderAmount}
                onChange={(e) => setSettingsForm({ ...settingsForm, maxOrderAmount: e.target.value })}
              />
            </Field>
          </div>

          <div className="mt-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-muted)] mb-1">
              Designated 2nd approvers (optional — if none selected, any other approver can give 2nd approval)
            </p>
            <PersonMultiSelect
              values={settingsForm.secondApproverIds}
              onChange={(v) => setSettingsForm({ ...settingsForm, secondApproverIds: v })}
              people={toPeople(approvers)}
              placeholder={approvers.length === 0 ? 'No workspace members found' : 'Search people…'}
              disabled={approvers.length === 0}
              aria-label="Designated second approvers"
            />
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-muted)]">Per-approver amount limits</span>
              <button
                type="button"
                onClick={() => setSettingsForm({ ...settingsForm, approverLimits: [...settingsForm.approverLimits, { userId: '', maxAmount: '' }] })}
                className="text-xs text-[color:var(--accent)] hover:underline"
              >
                + Add limit
              </button>
            </div>
            <div className="space-y-2">
              {settingsForm.approverLimits.map((rule, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_140px_auto] gap-2 items-center">
                  <PersonSelect
                    value={rule.userId}
                    onChange={(v) => {
                      const next = [...settingsForm.approverLimits];
                      next[idx] = { ...rule, userId: v };
                      setSettingsForm({ ...settingsForm, approverLimits: next });
                    }}
                    people={toPeople(approvers)}
                    placeholder="Search approver…"
                    aria-label="Approver"
                  />
                  <TextInput
                    type="number"
                    min={0}
                    placeholder="Max amount"
                    value={rule.maxAmount}
                    onChange={(e) => {
                      const next = [...settingsForm.approverLimits];
                      next[idx] = { ...rule, maxAmount: e.target.value };
                      setSettingsForm({ ...settingsForm, approverLimits: next });
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setSettingsForm({ ...settingsForm, approverLimits: settingsForm.approverLimits.filter((_, j) => j !== idx) })}
                    className="text-rose-500 text-sm px-2"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}

      {linksId && (
        <RecordLinksDrawer type="purchase_order" id={linksId} title={rows.find((r) => r._id === linksId)?.title} onClose={() => setLinksId(null)} />
      )}
    </SectionPage>
  );
}

export function ProcurementPos() {
  return <PoList title="Purchase orders" subtitle="Draft, approve, order, and receive POs with a full approval flow." />;
}
export function ProcurementLicenses() {
  return <PoList title="License purchases" subtitle="Software and subscription purchases feeding the Assets license register." fixedCategory="software" />;
}

export function ProcurementVendors() {
  const { token } = useAuth();
  const [rows, setRows] = useState<CrmAccount[]>([]);
  const [editing, setEditing] = useState<{ name: string; industry: string; website: string; notes: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!token) return;
    procurementApi.listVendors(token).then((r) => { setLoading(false); if (r.success && r.data) setRows(r.data); });
  }, [token]);
  useEffect(load, [load]);

  const save = async () => {
    if (!token || !editing) return;
    if (!editing.name) return alert('Name required');
    const res = await procurementApi.createVendor(editing, token);
    if (res.success) { setEditing(null); load(); } else alert(res.message);
  };

  return (
    <SectionPage title="Vendors" subtitle="Vendor master shared with CRM (accounts of type vendor)." toolbar={<PrimaryButton onClick={() => setEditing({ name: '', industry: '', website: '', notes: '' })}>+ Add vendor</PrimaryButton>}>
      {loading ? <ModuleLoader size="block" label="Loading vendors…" /> : rows.length === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)]">No vendors yet.</p>
      ) : (
        tableWrap(
          <>
            <thead className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">
              <tr><th className="text-left px-4 py-2.5 font-medium">Vendor</th><th className="text-left px-4 py-2.5 font-medium">Industry</th><th className="text-left px-4 py-2.5 font-medium">Website</th></tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v._id} className="border-t border-[color:var(--border-subtle)]">
                  <td className="px-4 py-2.5 font-medium">{v.name}</td>
                  <td className="px-4 py-2.5">{v.industry || '—'}</td>
                  <td className="px-4 py-2.5 text-[color:var(--accent)]">{v.website || '—'}</td>
                </tr>
              ))}
            </tbody>
          </>
        )
      )}

      {editing && (
        <Modal title="Add vendor" onClose={() => setEditing(null)} footer={<><GhostButton onClick={() => setEditing(null)}>Cancel</GhostButton><PrimaryButton onClick={save}>Save</PrimaryButton></>}>
          <Field label="Name"><TextInput value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
          <Field label="Industry"><TextInput value={editing.industry} onChange={(e) => setEditing({ ...editing, industry: e.target.value })} /></Field>
          <Field label="Website"><TextInput value={editing.website} onChange={(e) => setEditing({ ...editing, website: e.target.value })} /></Field>
          <Field label="Notes"><TextArea rows={2} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field>
        </Modal>
      )}
    </SectionPage>
  );
}
