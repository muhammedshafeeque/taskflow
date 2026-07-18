import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { crmApi, type CrmDeal, type CrmQuote } from '../../lib/api';

type Line = { description: string; quantity: number; unitPrice: number };

export default function CrmQuotes() {
  const { token, user } = useAuth();
  const canCreate = canAny(user, 'taskflow.crm.quote.create');
  const canUpdate = canAny(user, 'taskflow.crm.quote.update');
  const canDelete = canAny(user, 'taskflow.crm.quote.delete');
  const [quotes, setQuotes] = useState<CrmQuote[]>([]);
  const [deals, setDeals] = useState<CrmDeal[]>([]);
  const [modal, setModal] = useState(false);
  const [sendFor, setSendFor] = useState<string | null>(null);
  const [sendEmail, setSendEmail] = useState('');
  const [form, setForm] = useState({
    dealId: '',
    title: '',
    currency: 'USD',
    notes: '',
    lines: [{ description: '', quantity: 1, unitPrice: 0 }] as Line[],
  });

  const load = () => {
    if (!token) return;
    crmApi.listQuotes(token).then((res) => {
      if (res.success && res.data) setQuotes(res.data as CrmQuote[]);
    });
  };

  useEffect(() => {
    load();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    crmApi.listDeals(token).then((res) => {
      if (res.success && res.data) setDeals(res.data as CrmDeal[]);
    });
  }, [token]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !form.dealId) return;
    const lineItems = form.lines
      .filter((l) => l.description.trim())
      .map((l) => ({ description: l.description.trim(), quantity: l.quantity, unitPrice: l.unitPrice, billingType: 'fixed' }));
    await crmApi.createQuote(
      {
        dealId: form.dealId,
        title: form.title.trim() || undefined,
        currency: form.currency,
        notes: form.notes.trim() || undefined,
        lineItems,
      },
      token
    );
    setModal(false);
    load();
  }

  async function send(id: string) {
    if (!token || !sendEmail.trim()) return;
    await crmApi.sendQuote(id, sendEmail.trim(), token);
    setSendFor(null);
    setSendEmail('');
    load();
  }

  async function setStatus(id: string, status: string) {
    if (!token || !canUpdate) return;
    await crmApi.updateQuote(id, { status }, token);
    load();
  }

  async function remove(id: string) {
    if (!token || !canDelete) return;
    if (!confirm('Delete draft quote?')) return;
    await crmApi.deleteQuote(id, token);
    load();
  }

  return (
    <div className="p-8 w-full px-4 sm:px-6 lg:px-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Quotes</h1>
          <p className="text-[13px] text-[color:var(--text-muted)]">Proposals linked to deals.</p>
        </div>
        {canCreate && (
          <button
            type="button"
            className="btn-primary px-4 py-2 rounded-lg text-sm"
            disabled={deals.length === 0}
            onClick={() => {
              setForm({
                dealId: deals[0]?._id ?? '',
                title: '',
                currency: 'USD',
                notes: '',
                lines: [{ description: '', quantity: 1, unitPrice: 0 }],
              });
              setModal(true);
            }}
          >
            New quote
          </button>
        )}
      </div>
      <div className="space-y-2">
        {quotes.map((q) => (
          <div key={q._id} className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 flex flex-wrap justify-between items-center gap-3">
            <div>
              <p className="font-medium">{q.title}</p>
              <p className="text-sm text-[color:var(--text-muted)]">
                {q.status} · {q.subtotal} {q.currency}
                {q.lineItems?.length ? ` · ${q.lineItems.length} line(s)` : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              {q.status === 'draft' && canUpdate && (
                <button type="button" onClick={() => setSendFor(q._id)} className="text-[color:var(--accent)] hover:underline">
                  Send
                </button>
              )}
              {(q.status === 'sent' || q.status === 'draft') && canUpdate && (
                <>
                  <button type="button" onClick={() => void setStatus(q._id, 'accepted')} className="text-emerald-400 hover:underline">
                    Accept
                  </button>
                  <button type="button" onClick={() => void setStatus(q._id, 'rejected')} className="text-[color:var(--text-muted)] hover:underline">
                    Reject
                  </button>
                </>
              )}
              {q.status === 'draft' && canDelete && (
                <button type="button" onClick={() => void remove(q._id)} className="text-red-400 hover:underline">
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
        {quotes.length === 0 && <p className="text-sm text-[color:var(--text-muted)]">No quotes yet.</p>}
      </div>

      {sendFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setSendFor(null)}>
          <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-2xl max-w-sm w-full p-6 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold">Send quote</h2>
            <input
              type="email"
              required
              placeholder="Recipient email"
              value={sendEmail}
              onChange={(e) => setSendEmail(e.target.value)}
              className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <button type="button" className="btn-primary px-4 py-2 rounded-lg text-sm" onClick={() => void send(sendFor)}>
                Send
              </button>
              <button type="button" className="px-4 py-2 text-sm" onClick={() => setSendFor(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setModal(false)}>
          <form onSubmit={create} className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-2xl max-w-lg w-full p-6 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">New quote</h2>
            <label className="block text-xs space-y-1">
              <span className="text-[color:var(--text-muted)]">Deal</span>
              <select required value={form.dealId} onChange={(e) => setForm((f) => ({ ...f, dealId: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm">
                {deals.map((d) => (
                  <option key={d._id} value={d._id}>{d.title}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs space-y-1">
              <span className="text-[color:var(--text-muted)]">Title</span>
              <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm" placeholder="Optional" />
            </label>
            <div className="space-y-2">
              <p className="text-xs text-[color:var(--text-muted)]">Line items</p>
              {form.lines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2">
                  <input
                    className="col-span-6 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-2 py-1.5 text-sm"
                    placeholder="Description"
                    value={line.description}
                    onChange={(e) =>
                      setForm((f) => {
                        const lines = [...f.lines];
                        lines[idx] = { ...lines[idx], description: e.target.value };
                        return { ...f, lines };
                      })
                    }
                  />
                  <input
                    type="number"
                    min={1}
                    className="col-span-3 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-2 py-1.5 text-sm"
                    value={line.quantity}
                    onChange={(e) =>
                      setForm((f) => {
                        const lines = [...f.lines];
                        lines[idx] = { ...lines[idx], quantity: Number(e.target.value) };
                        return { ...f, lines };
                      })
                    }
                  />
                  <input
                    type="number"
                    min={0}
                    className="col-span-3 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-2 py-1.5 text-sm"
                    value={line.unitPrice}
                    onChange={(e) =>
                      setForm((f) => {
                        const lines = [...f.lines];
                        lines[idx] = { ...lines[idx], unitPrice: Number(e.target.value) };
                        return { ...f, lines };
                      })
                    }
                  />
                </div>
              ))}
              <button
                type="button"
                className="text-xs text-[color:var(--accent)] hover:underline"
                onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, { description: '', quantity: 1, unitPrice: 0 }] }))}
              >
                + Add line
              </button>
            </div>
            <div className="flex gap-2 pt-2">
              <button type="submit" className="btn-primary px-4 py-2 rounded-lg text-sm">Create</button>
              <button type="button" onClick={() => setModal(false)} className="px-4 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
