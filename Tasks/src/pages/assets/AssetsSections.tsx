import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { assetsApi } from '../../lib/api';
import type { Asset, AssetLicense } from '../../lib/api';
import {
  ExportButton, Field, GhostButton, Modal, PrimaryButton, Select, SectionPage, StatusPill, TextInput, money, nameOf,
} from '../../components/moduleKit';

const assetStatusTone: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'slate'> = {
  in_stock: 'blue', assigned: 'green', in_repair: 'amber', retired: 'slate',
  active: 'green', expired: 'red', cancelled: 'slate',
};

function tableWrap(children: React.ReactNode) {
  return (
    <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-x-auto">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

function AssetList({ title, subtitle, fixedCategory, warrantyMode = false }: { title: string; subtitle: string; fixedCategory?: string; warrantyMode?: boolean }) {
  const { token } = useAuth();
  const [rows, setRows] = useState<Asset[]>([]);
  const [editing, setEditing] = useState<Partial<Asset> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!token) return;
    const params = warrantyMode ? { warrantyWithinDays: 3650 } : fixedCategory ? { category: fixedCategory } : undefined;
    assetsApi.list(token, params).then((r) => {
      setLoading(false);
      if (r.success && r.data) {
        const data = warrantyMode ? r.data.filter((a) => a.warrantyExpiry).sort((a, b) => new Date(a.warrantyExpiry!).getTime() - new Date(b.warrantyExpiry!).getTime()) : r.data;
        setRows(data);
      }
    });
  }, [token, fixedCategory, warrantyMode]);
  useEffect(load, [load]);

  const save = async () => {
    if (!token || !editing) return;
    const payload = { ...editing };
    if (fixedCategory && !payload.category) payload.category = fixedCategory;
    const res = editing._id ? await assetsApi.update(editing._id, payload, token) : await assetsApi.create(payload, token);
    if (res.success) { setEditing(null); load(); } else alert(res.message);
  };
  const remove = async (id: string) => {
    if (!token || !confirm('Delete this asset?')) return;
    await assetsApi.remove(id, token);
    load();
  };

  return (
    <SectionPage title={title} subtitle={subtitle} toolbar={<div className="flex gap-2"><ExportButton rows={rows} filename="assets" columns={[
      { header: 'Tag', value: (r) => r.assetTag },
      { header: 'Name', value: (r) => r.name },
      { header: 'Category', value: (r) => r.category },
      { header: 'Status', value: (r) => r.status },
      { header: 'Assigned to', value: (r) => nameOf(r.assignedUserId, '') },
      { header: 'Serial', value: (r) => r.serialNumber ?? '' },
      { header: 'Value', value: (r) => r.purchaseCost ?? 0 },
      { header: 'Warranty expiry', value: (r) => (r.warrantyExpiry ? new Date(r.warrantyExpiry).toLocaleDateString() : '') },
    ]} /><PrimaryButton onClick={() => setEditing({ category: fixedCategory ?? 'laptop', status: 'in_stock', currency: 'USD' })}>+ Add asset</PrimaryButton></div>}>
      {loading ? <p className="text-sm text-[color:var(--text-muted)]">Loading…</p> : rows.length === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)]">No assets yet.</p>
      ) : (
        tableWrap(
          <>
            <thead className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Asset</th>
                <th className="text-left px-4 py-2.5 font-medium">{warrantyMode ? 'Warranty' : 'Category'}</th>
                <th className="text-left px-4 py-2.5 font-medium">Assigned to</th>
                <th className="text-left px-4 py-2.5 font-medium">Status</th>
                <th className="text-right px-4 py-2.5 font-medium">{warrantyMode ? 'AMC' : 'Value'}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a._id} className="border-t border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-page)]">
                  <td className="px-4 py-2.5"><p className="font-medium">{a.name}</p><p className="text-[11px] text-[color:var(--text-muted)]">{a.assetTag}{a.hostname ? ` · ${a.hostname}` : ''}</p></td>
                  <td className="px-4 py-2.5">{warrantyMode ? (a.warrantyExpiry ? new Date(a.warrantyExpiry).toLocaleDateString() : '—') : <span className="capitalize">{a.category}</span>}</td>
                  <td className="px-4 py-2.5">{nameOf(a.assignedUserId, '—')}</td>
                  <td className="px-4 py-2.5"><StatusPill label={a.status} tone={assetStatusTone[a.status]} /></td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{warrantyMode ? (a.amcExpiry ? new Date(a.amcExpiry).toLocaleDateString() : '—') : money(a.purchaseCost, a.currency)}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button onClick={() => setEditing(a)} className="text-[color:var(--accent)] hover:underline text-xs mr-3">Edit</button>
                    <button onClick={() => remove(a._id)} className="text-rose-500 hover:underline text-xs">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </>
        )
      )}

      {editing && (
        <Modal title={editing._id ? 'Edit asset' : 'Add asset'} onClose={() => setEditing(null)} wide footer={<><GhostButton onClick={() => setEditing(null)}>Cancel</GhostButton><PrimaryButton onClick={save}>Save</PrimaryButton></>}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name"><TextInput value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="Category">
              <Select value={editing.category ?? 'laptop'} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                {['laptop', 'desktop', 'mobile', 'server', 'network', 'peripheral', 'other'].map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Status">
              <Select value={editing.status ?? 'in_stock'} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                {['in_stock', 'assigned', 'in_repair', 'retired'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </Select>
            </Field>
            <Field label="Serial number"><TextInput value={editing.serialNumber ?? ''} onChange={(e) => setEditing({ ...editing, serialNumber: e.target.value })} /></Field>
            <Field label="Manufacturer"><TextInput value={editing.manufacturer ?? ''} onChange={(e) => setEditing({ ...editing, manufacturer: e.target.value })} /></Field>
            <Field label="Model"><TextInput value={editing.deviceModel ?? ''} onChange={(e) => setEditing({ ...editing, deviceModel: e.target.value })} /></Field>
            <Field label="Purchase cost"><TextInput type="number" value={editing.purchaseCost ?? 0} onChange={(e) => setEditing({ ...editing, purchaseCost: Number(e.target.value) })} /></Field>
            <Field label="Location"><TextInput value={editing.location ?? ''} onChange={(e) => setEditing({ ...editing, location: e.target.value })} /></Field>
            <Field label="Warranty expiry"><TextInput type="date" value={(editing.warrantyExpiry ?? '').slice(0, 10)} onChange={(e) => setEditing({ ...editing, warrantyExpiry: e.target.value })} /></Field>
            <Field label="AMC expiry"><TextInput type="date" value={(editing.amcExpiry ?? '').slice(0, 10)} onChange={(e) => setEditing({ ...editing, amcExpiry: e.target.value })} /></Field>
            {(editing.category === 'server' || editing.category === 'network') && (
              <>
                <Field label="Hostname"><TextInput value={editing.hostname ?? ''} onChange={(e) => setEditing({ ...editing, hostname: e.target.value })} /></Field>
                <Field label="IP address"><TextInput value={editing.ipAddress ?? ''} onChange={(e) => setEditing({ ...editing, ipAddress: e.target.value })} /></Field>
                <Field label="Environment"><TextInput value={editing.environment ?? ''} onChange={(e) => setEditing({ ...editing, environment: e.target.value })} /></Field>
              </>
            )}
          </div>
        </Modal>
      )}
    </SectionPage>
  );
}

export function AssetsInventory() {
  return <AssetList title="Inventory" subtitle="All assignable hardware and equipment. Assets can be tied to a customer account or vendor." />;
}
export function AssetsServers() {
  return <AssetList title="Servers" subtitle="Servers and infrastructure configuration items." fixedCategory="server" />;
}
export function AssetsWarranty() {
  return <AssetList title="Warranty & AMC" subtitle="Assets with warranty or AMC coverage, sorted by expiry." warrantyMode />;
}

export function AssetsLicenses() {
  const { token } = useAuth();
  const [rows, setRows] = useState<AssetLicense[]>([]);
  const [editing, setEditing] = useState<Partial<AssetLicense> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!token) return;
    assetsApi.listLicenses(token).then((r) => { setLoading(false); if (r.success && r.data) setRows(r.data); });
  }, [token]);
  useEffect(load, [load]);

  const save = async () => {
    if (!token || !editing) return;
    const res = editing._id ? await assetsApi.updateLicense(editing._id, editing, token) : await assetsApi.createLicense(editing, token);
    if (res.success) { setEditing(null); load(); } else alert(res.message);
  };
  const remove = async (id: string) => { if (!token || !confirm('Delete license?')) return; await assetsApi.removeLicense(id, token); load(); };

  return (
    <SectionPage title="Licenses" subtitle="Software licenses and seat allocation." toolbar={<PrimaryButton onClick={() => setEditing({ status: 'active', currency: 'USD', seatsTotal: 1, seatsUsed: 0 })}>+ Add license</PrimaryButton>}>
      {loading ? <p className="text-sm text-[color:var(--text-muted)]">Loading…</p> : rows.length === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)]">No licenses tracked yet.</p>
      ) : (
        tableWrap(
          <>
            <thead className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">
              <tr><th className="text-left px-4 py-2.5 font-medium">License</th><th className="text-left px-4 py-2.5 font-medium">Seats</th><th className="text-left px-4 py-2.5 font-medium">Renewal</th><th className="text-left px-4 py-2.5 font-medium">Status</th><th className="text-right px-4 py-2.5 font-medium">Annual</th><th className="px-4 py-2.5" /></tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l._id} className="border-t border-[color:var(--border-subtle)]">
                  <td className="px-4 py-2.5"><p className="font-medium">{l.name}</p><p className="text-[11px] text-[color:var(--text-muted)]">{l.vendor || '—'}</p></td>
                  <td className="px-4 py-2.5 tabular-nums">{l.seatsUsed}/{l.seatsTotal}</td>
                  <td className="px-4 py-2.5 text-[color:var(--text-muted)]">{l.renewalDate ? new Date(l.renewalDate).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-2.5"><StatusPill label={l.status} tone={assetStatusTone[l.status]} /></td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{money((l.seatCost ?? 0) * l.seatsTotal, l.currency)}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button onClick={() => setEditing(l)} className="text-[color:var(--accent)] hover:underline text-xs mr-3">Edit</button>
                    <button onClick={() => remove(l._id)} className="text-rose-500 hover:underline text-xs">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </>
        )
      )}

      {editing && (
        <Modal title={editing._id ? 'Edit license' : 'Add license'} onClose={() => setEditing(null)} footer={<><GhostButton onClick={() => setEditing(null)}>Cancel</GhostButton><PrimaryButton onClick={save}>Save</PrimaryButton></>}>
          <Field label="Name"><TextInput value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
          <Field label="Vendor"><TextInput value={editing.vendor ?? ''} onChange={(e) => setEditing({ ...editing, vendor: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Seats total"><TextInput type="number" value={editing.seatsTotal ?? 1} onChange={(e) => setEditing({ ...editing, seatsTotal: Number(e.target.value) })} /></Field>
            <Field label="Seats used"><TextInput type="number" value={editing.seatsUsed ?? 0} onChange={(e) => setEditing({ ...editing, seatsUsed: Number(e.target.value) })} /></Field>
            <Field label="Seat cost / yr"><TextInput type="number" value={editing.seatCost ?? 0} onChange={(e) => setEditing({ ...editing, seatCost: Number(e.target.value) })} /></Field>
            <Field label="Renewal date"><TextInput type="date" value={(editing.renewalDate ?? '').slice(0, 10)} onChange={(e) => setEditing({ ...editing, renewalDate: e.target.value })} /></Field>
          </div>
          <Field label="Status">
            <Select value={editing.status ?? 'active'} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
              {['active', 'expired', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
        </Modal>
      )}
    </SectionPage>
  );
}
