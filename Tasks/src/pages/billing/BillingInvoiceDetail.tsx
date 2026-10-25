import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useAppDisplayName } from '../../hooks/useAppDisplayName';
import { canAny } from '../../utils/moduleAccess';
import { money } from '../../components/moduleKit';
import { api, billingApi, type BillingInvoice, type BillingInvoiceLine } from '../../lib/api';
import { billingTypeLabel } from '../../lib/billingLineUtils';
import { buildInvoicePdf, downloadInvoicePdfFromInvoice } from '../../lib/invoicePdf';
import { ModuleLoader } from '../../components/loaders/ModuleLoader';
import RecordLinksPanel from '../../components/RecordLinksPanel';

function refId(ref?: string | { _id: string }): string {
  if (!ref) return '';
  return typeof ref === 'string' ? ref : ref._id;
}

function refName(ref?: string | { _id?: string; name?: string; title?: string; key?: string }): string {
  if (!ref) return '—';
  if (typeof ref === 'string') return ref;
  if ('key' in ref && ref.key) return `${ref.name ?? ref.key} (${ref.key})`;
  return ref.name || ref.title || '—';
}

function fmtDate(d?: string): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString();
}

function statusClass(status: string): string {
  switch (status) {
    case 'paid':
      return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    case 'sent':
      return 'bg-sky-500/15 text-sky-400 border-sky-500/30';
    case 'overdue':
      return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    case 'void':
      return 'bg-red-500/15 text-red-400 border-red-500/30';
    default:
      return 'bg-[color:var(--bg-page)] text-[color:var(--text-muted)] border-[color:var(--border-subtle)]';
  }
}

function lineQtyDisplay(line: BillingInvoiceLine): string {
  const type = line.billingType ?? 'fixed';
  if (type === 'hourly' || type === 'support') return `${line.quantity} hrs`;
  if (type === 'retainer' || type === 'amc') return `${line.quantity} mo`;
  return String(line.quantity);
}

function lineRateDisplay(line: BillingInvoiceLine, currency: string): string {
  const type = line.billingType ?? 'fixed';
  const fmt = (n: number) => {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
    } catch {
      return `${n.toFixed(2)} ${currency}`;
    }
  };
  if (type === 'hourly' || type === 'support') return `${fmt(line.unitPrice)}/hr`;
  if (type === 'retainer' || type === 'amc') return `${fmt(line.unitPrice)}/mo`;
  return fmt(line.unitPrice);
}

export default function BillingInvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const companyName = useAppDisplayName();
  const canManage = canAny(user, 'taskflow.billing.invoice.manage');
  const canCreate = canAny(user, 'taskflow.billing.invoice.create', 'taskflow.billing.invoice.manage');

  const [invoice, setInvoice] = useState<BillingInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState(0);
  const [payments, setPayments] = useState<{ enabled: boolean; provider: string | null } | null>(null);
  const [payLink, setPayLink] = useState('');

  useEffect(() => {
    if (token) billingApi.paymentsStatus(token).then((r) => setPayments(r.success && r.data ? r.data : null));
  }, [token]);

  async function handlePaymentLink() {
    if (!token || !invoice) return;
    setActionBusy(true);
    const res = await billingApi.createPaymentLink(invoice._id, undefined, token);
    setActionBusy(false);
    if (res.success && res.data) {
      setPayLink(res.data.url);
      void navigator.clipboard?.writeText(res.data.url).catch(() => undefined);
      setActionMsg('Payment link copied — share it with the customer. The invoice updates automatically when they pay.');
    } else setActionMsg(res.message ?? 'Could not create payment link');
  }

  async function handleEmail() {
    if (!token || !invoice) return;
    const toEmail = prompt('Send invoice to (email)');
    if (!toEmail) return;
    const message = prompt('Message (optional)') ?? undefined;
    setActionBusy(true);
    // Attach the same PDF the user can download.
    const doc = buildInvoicePdf(invoice, companyName);
    const pdfBase64 = doc.output('datauristring').split(',')[1];
    const r = await api.post(`/billing/invoices/${invoice._id}/email`, { toEmail, message, pdfBase64, companyName }, token);
    setActionBusy(false);
    if (!r.success) return alert(r.message);
    alert('Invoice emailed.');
    load();
  }

  const load = () => {
    if (!token || !id) return;
    setLoading(true);
    billingApi.getInvoice(id, token).then((res) => {
      setLoading(false);
      if (res.success && res.data) setInvoice(res.data as BillingInvoice);
      else setError((res as { message?: string }).message ?? 'Invoice not found');
    });
  };

  useEffect(() => {
    load();
  }, [token, id]);

  async function handleSend() {
    if (!token || !invoice || !canManage) return;
    setActionBusy(true);
    setActionMsg('');
    const res = await billingApi.updateInvoice(invoice._id, { status: 'sent' }, token);
    setActionBusy(false);
    if (res.success && res.data) {
      setInvoice(res.data as BillingInvoice);
      setActionMsg('Invoice marked as sent.');
    } else {
      setActionMsg((res as { message?: string }).message ?? 'Failed to send');
    }
  }

  async function handleDelete() {
    if (!token || !invoice || !canManage) return;
    if (!confirm('Delete this invoice?')) return;
    setActionBusy(true);
    const res = await billingApi.deleteInvoice(invoice._id, token);
    setActionBusy(false);
    if (res.success) navigate('/billing/invoices');
    else setActionMsg((res as { message?: string }).message ?? 'Delete failed');
  }

  async function recordPayment(e: FormEvent) {
    e.preventDefault();
    if (!token || !invoice) return;
    const balance = invoice.total - (invoice.amountPaid ?? 0);
    setActionBusy(true);
    const res = await billingApi.recordPayment(
      invoice._id,
      { amount: payAmount, markPaid: payAmount >= balance },
      token
    );
    setActionBusy(false);
    if (res.success && res.data) {
      setInvoice(res.data as BillingInvoice);
      setPayOpen(false);
      setActionMsg('Payment recorded.');
    } else {
      setActionMsg((res as { message?: string }).message ?? 'Payment failed');
    }
  }

  if (loading) {
    return <ModuleLoader label="Loading invoice…" />;
  }

  if (error || !invoice) {
    return (
      <div className="p-8 space-y-3">
        <Link to="/billing/invoices" className="text-xs text-[color:var(--accent)] hover:underline">
          ← Invoices
        </Link>
        <p className="text-red-400">{error || 'Invoice not found'}</p>
      </div>
    );
  }

  const isDraft = invoice.status === 'draft';
  const balance = Math.round((invoice.total - (invoice.amountPaid ?? 0)) * 100) / 100;
  const currency = invoice.currency || 'USD';

  return (
    <div className="p-8 animate-fade-in w-full px-4 sm:px-6 lg:px-8 max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/billing/invoices" className="text-xs text-[color:var(--accent)] hover:underline">
            ← Invoices
          </Link>
          <h1 className="text-xl font-semibold mt-1">{invoice.number}</h1>
          <p className="text-[13px] text-[color:var(--text-muted)]">
            {refName(invoice.accountId)}
            {invoice.projectId && (
              <>
                {' · '}
                <Link to={`/projects/${refId(invoice.projectId)}/dashboard`} className="text-[color:var(--accent)] hover:underline">
                  {refName(invoice.projectId)}
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex px-2.5 py-1 rounded-full text-xs border capitalize ${statusClass(invoice.status)}`}>
            {invoice.status}
          </span>
          <button
            type="button"
            className="px-3 py-1.5 rounded-lg border border-[color:var(--border-subtle)] text-sm"
            onClick={() => downloadInvoicePdfFromInvoice(invoice, companyName)}
          >
            Download PDF
          </button>
          {canManage && invoice.status !== 'void' && (
            <button type="button" disabled={actionBusy} className="px-3 py-1.5 rounded-lg border border-[color:var(--border-subtle)] text-sm" onClick={() => void handleEmail()}>
              Email
            </button>
          )}
          {isDraft && canCreate && (
            <Link to={`/billing/invoices/${invoice._id}/edit`} className="btn-primary px-3 py-1.5 rounded-lg text-sm">
              Edit draft
            </Link>
          )}
          {canManage && isDraft && (
            <button type="button" disabled={actionBusy} className="btn-primary px-3 py-1.5 rounded-lg text-sm" onClick={() => void handleSend()}>
              Mark sent
            </button>
          )}
          {canManage && invoice.status !== 'paid' && invoice.status !== 'void' && (
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 text-sm"
              onClick={() => {
                setPayAmount(balance);
                setPayOpen(true);
              }}
            >
              Record payment
            </button>
          )}
          {canManage && payments?.enabled && !isDraft && invoice.status !== 'paid' && invoice.status !== 'void' && (
            <button
              type="button"
              disabled={actionBusy}
              className="px-3 py-1.5 rounded-lg border border-[color:var(--accent)]/40 text-[color:var(--accent)] text-sm"
              onClick={() => void handlePaymentLink()}
              title={`Create a ${payments.provider} payment link for the outstanding balance`}
            >
              {payLink ? 'Copy payment link' : 'Payment link'}
            </button>
          )}
          {canManage && invoice.status !== 'paid' && (
            <button type="button" disabled={actionBusy} className="text-sm text-red-400 hover:underline" onClick={() => void handleDelete()}>
              Delete
            </button>
          )}
        </div>
      </div>

      {actionMsg && <p className="text-sm text-[color:var(--accent)]">{actionMsg}</p>}

      <section className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 text-sm">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">Issue date</p>
          <p className="mt-1">{fmtDate(invoice.issueDate)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">Due date</p>
          <p className="mt-1">{fmtDate(invoice.dueDate)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">Payment terms</p>
          <p className="mt-1">{invoice.paymentTerms || '—'}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">PO number</p>
          <p className="mt-1">{invoice.poNumber || '—'}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">Service period</p>
          <p className="mt-1">
            {invoice.servicePeriodStart || invoice.servicePeriodEnd
              ? `${fmtDate(invoice.servicePeriodStart)} – ${fmtDate(invoice.servicePeriodEnd)}`
              : '—'}
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">Contract</p>
          <p className="mt-1">
            {invoice.contractId ? (
              <Link to={`/contracts/${refId(invoice.contractId)}`} className="text-[color:var(--accent)] hover:underline">
                {refName(invoice.contractId)}
              </Link>
            ) : (
              '—'
            )}
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-[color:var(--border-subtle)] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[color:var(--bg-elevated)] text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Description</th>
              <th className="text-left px-4 py-3 font-medium">Type</th>
              <th className="text-left px-4 py-3 font-medium">Period</th>
              <th className="text-right px-4 py-3 font-medium">{isDraft ? 'Qty' : 'Quantity'}</th>
              <th className="text-right px-4 py-3 font-medium">Rate</th>
              <th className="text-right px-4 py-3 font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(invoice.lines ?? []).map((line, i) => (
              <tr key={i} className="border-t border-[color:var(--border-subtle)]">
                <td className="px-4 py-3">
                  <span className="font-medium">{line.description}</span>
                  {line.category && <span className="block text-[11px] text-[color:var(--text-muted)]">{line.category}</span>}
                  {(line.discountPercent ?? 0) > 0 && (
                    <span className="block text-[11px] text-emerald-600 dark:text-emerald-400">{line.discountPercent}% discount</span>
                  )}
                </td>
                <td className="px-4 py-3 text-[color:var(--text-muted)]">{billingTypeLabel(line.billingType)}</td>
                <td className="px-4 py-3 text-[color:var(--text-muted)] text-xs">
                  {line.periodStart || line.periodEnd
                    ? `${fmtDate(line.periodStart)} – ${fmtDate(line.periodEnd)}`
                    : '—'}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{lineQtyDisplay(line)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{lineRateDisplay(line, currency)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-medium">{money(line.amount, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-[color:var(--border-subtle)] px-4 py-4 flex flex-col items-end gap-1 text-sm">
          <div className="text-[color:var(--text-muted)]">
            Subtotal <span className="text-[color:var(--text-primary)] tabular-nums ml-3">{money(invoice.subtotal, currency)}</span>
          </div>
          <div className="text-[color:var(--text-muted)]">
            Tax{invoice.taxCode ? ` (${invoice.taxCode})` : ''}{' '}
            <span className="text-[color:var(--text-primary)] tabular-nums ml-3">{money(invoice.taxTotal, currency)}</span>
          </div>
          <div className="font-semibold text-base">
            Total <span className="tabular-nums ml-3">{money(invoice.total, currency)}</span>
          </div>
          {(invoice.amountPaid ?? 0) > 0 && (
            <>
              <div className="text-emerald-600 dark:text-emerald-400">
                Paid <span className="tabular-nums ml-3">{money(invoice.amountPaid, currency)}</span>
              </div>
              <div className="font-semibold">
                Balance due <span className="tabular-nums ml-3">{money(balance, currency)}</span>
              </div>
            </>
          )}
        </div>
      </section>

      {id && <RecordLinksPanel type="invoice" id={id} />}

      {invoice.notes?.trim() && (
        <section className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5">
          <h2 className="text-sm font-semibold mb-2">Notes / payment instructions</h2>
          <p className="text-sm text-[color:var(--text-muted)] whitespace-pre-wrap">{invoice.notes}</p>
        </section>
      )}

      {payOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={recordPayment} className="w-full max-w-sm rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6 space-y-3">
            <h2 className="text-lg font-semibold">Record payment</h2>
            <p className="text-[13px] text-[color:var(--text-muted)]">
              Total {money(invoice.total, currency)} · paid {money(invoice.amountPaid ?? 0, currency)}
            </p>
            <label className="block text-xs text-[color:var(--text-muted)]">
              Amount received
              <input
                type="number"
                min={0}
                step="0.01"
                max={balance}
                className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                value={payAmount}
                onChange={(e) => setPayAmount(Number(e.target.value))}
                autoFocus
              />
            </label>
            <p className="text-[11px] text-[color:var(--text-muted)]">
              Outstanding: {money(balance, currency)}. Full payment marks invoice paid.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="px-3 py-2 text-sm rounded-lg border border-[color:var(--border-subtle)]" onClick={() => setPayOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary px-4 py-2 rounded-lg text-sm" disabled={payAmount <= 0 || actionBusy}>
                Record payment
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
