import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { procurementApi } from '../../lib/api';
import type { PurchaseOrder, CrmAccount } from '../../lib/api';
import {
  ExportButton, Field, GhostButton, Modal, PrimaryButton, Select, SectionPage, StatusPill, TextArea, TextInput, money, nameOf,
} from '../../components/moduleKit';

const poStatusTone: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'slate' | 'violet'> = {
  draft: 'slate', pending_approval: 'amber', approved: 'blue', ordered: 'violet', received: 'green', cancelled: 'red',
};

const NEXT_STATUS: Record<string, { label: string; status: string }[]> = {
  draft: [{ label: 'Submit', status: 'pending_approval' }],
  pending_approval: [{ label: 'Approve', status: 'approved' }, { label: 'Reject', status: 'cancelled' }],
  approved: [{ label: 'Mark ordered', status: 'ordered' }],
  ordered: [{ label: 'Mark received', status: 'received' }],
};

function tableWrap(children: React.ReactNode) {
  return (
    <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-x-auto">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

type Line = { description: string; quantity: number; unitPrice: number };

function PoList({ title, subtitle, fixedCategory }: { title: string; subtitle: string; fixedCategory?: string }) {
  const { token } = useAuth();
  const [rows, setRows] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<CrmAccount[]>([]);
  const [editing, setEditing] = useState<{ _id?: string; title: string; vendorAccountId: string; category: string; currency: string; lines: Line[]; notes: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    if (!token) return;
    procurementApi.listPos(token, fixedCategory ? { category: fixedCategory } : undefined).then((r) => { setLoading(false); if (r.success && r.data) setRows(r.data); });
    procurementApi.listVendors(token).then((r) => r.success && r.data && setVendors(r.data));
  }, [token, fixedCategory]);
  useEffect(load, [load]);

  const openNew = () => setEditing({ title: '', vendorAccountId: '', category: fixedCategory ?? 'hardware', currency: 'USD', lines: [{ description: '', quantity: 1, unitPrice: 0 }], notes: '' });

  const save = async () => {
    if (!token || !editing) return;
    if (!editing.vendorAccountId) return alert('Choose a vendor');
    const payload = { ...editing, lines: editing.lines.filter((l) => l.description) };
    const res = editing._id ? await procurementApi.updatePo(editing._id, payload, token) : await procurementApi.createPo(payload, token);
    if (res.success) { setEditing(null); load(); } else alert(res.message);
  };
  const transition = async (id: string, status: string) => {
    if (!token) return;
    const res = await procurementApi.transitionPo(id, status, token);
    const prov = (res.data as { provisioned?: { assetsCreated: number; licensesCreated: number } } | undefined)?.provisioned;
    if (prov && (prov.assetsCreated || prov.licensesCreated)) {
      const parts = [
        prov.assetsCreated ? `${prov.assetsCreated} asset${prov.assetsCreated > 1 ? 's' : ''}` : '',
        prov.licensesCreated ? `${prov.licensesCreated} license${prov.licensesCreated > 1 ? 's' : ''}` : '',
      ].filter(Boolean).join(' and ');
      setMsg(`Received — provisioned ${parts} into Assets.`);
      setTimeout(() => setMsg(''), 6000);
    }
    load();
  };
  const remove = async (id: string) => { if (!token || !confirm('Delete PO?')) return; await procurementApi.removePo(id, token); load(); };

  const lineTotal = editing ? editing.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0) : 0;

  return (
    <SectionPage title={title} subtitle={subtitle} toolbar={<div className="flex gap-2"><ExportButton rows={rows} filename="purchase-orders" columns={[
      { header: 'PO', value: (r) => r.poNumber },
      { header: 'Title', value: (r) => r.title },
      { header: 'Vendor', value: (r) => nameOf(r.vendorAccountId, '') },
      { header: 'Category', value: (r) => r.category },
      { header: 'Status', value: (r) => r.status },
      { header: 'Currency', value: (r) => r.currency },
      { header: 'Total', value: (r) => r.total },
    ]} /><PrimaryButton onClick={openNew}>+ New PO</PrimaryButton></div>}>
      {msg && <div className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-600 dark:text-emerald-400">{msg}</div>}
      {loading ? <p className="text-sm text-[color:var(--text-muted)]">Loading…</p> : rows.length === 0 ? (
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
                  <td className="px-4 py-2.5"><p className="font-medium">{p.title}</p><p className="text-[11px] text-[color:var(--text-muted)]">{p.poNumber} · {p.category}</p></td>
                  <td className="px-4 py-2.5">{nameOf(p.vendorAccountId, '—')}</td>
                  <td className="px-4 py-2.5"><StatusPill label={p.status} tone={poStatusTone[p.status]} /></td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{money(p.total, p.currency)}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {(NEXT_STATUS[p.status] ?? []).map((t) => (
                      <button key={t.status} onClick={() => transition(p._id, t.status)} className="text-[color:var(--accent)] hover:underline text-xs mr-3">{t.label}</button>
                    ))}
                    <button onClick={() => remove(p._id)} className="text-rose-500 hover:underline text-xs">Delete</button>
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
      {loading ? <p className="text-sm text-[color:var(--text-muted)]">Loading…</p> : rows.length === 0 ? (
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
