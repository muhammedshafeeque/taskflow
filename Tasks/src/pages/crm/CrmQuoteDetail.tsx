import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useAppDisplayName } from '../../hooks/useAppDisplayName';
import { canAny } from '../../utils/moduleAccess';
import { crmApi, type CrmQuote } from '../../lib/api';
import { money } from '../../components/moduleKit';
import { downloadQuotePdf, quotePdfBase64, quotePdfFilename } from '../../lib/quotePdf';
import { formatDateDDMMYYYY } from '../../lib/dateFormat';

function refId(ref: CrmQuote['dealId'] | CrmQuote['accountId']): string | undefined {
  if (!ref) return undefined;
  if (typeof ref === 'string') return ref;
  return ref._id;
}

function refLabel(
  ref: CrmQuote['dealId'] | CrmQuote['accountId'],
  kind: 'deal' | 'account'
): string {
  if (!ref) return '—';
  if (typeof ref === 'string') return ref;
  if (kind === 'account') return ref.name || '—';
  return ref.title || '—';
}

function statusClass(status: string): string {
  switch (status) {
    case 'accepted':
      return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    case 'sent':
      return 'bg-sky-500/15 text-sky-400 border-sky-500/30';
    case 'rejected':
    case 'expired':
      return 'bg-red-500/15 text-red-400 border-red-500/30';
    default:
      return 'bg-[color:var(--bg-page)] text-[color:var(--text-muted)] border-[color:var(--border-subtle)]';
  }
}

function billingLabel(type?: string): string {
  if (type === 'hourly') return 'Hourly';
  if (type === 'milestone') return 'Milestone';
  return 'Fixed';
}

export default function CrmQuoteDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const companyName = useAppDisplayName();
  const canUpdate = canAny(user, 'taskflow.crm.quote.update');
  const canDelete = canAny(user, 'taskflow.crm.quote.delete');

  const [quote, setQuote] = useState<CrmQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState('');
  const [sendOpen, setSendOpen] = useState(false);
  const [sendEmail, setSendEmail] = useState('');
  const [sendMessage, setSendMessage] = useState('');
  const [attachPdf, setAttachPdf] = useState(true);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState('');

  const load = () => {
    if (!token || !id) return;
    setLoading(true);
    setError('');
    crmApi.getQuote(id, token).then((res) => {
      setLoading(false);
      if (res.success && res.data) setQuote(res.data as CrmQuote);
      else setError((res as { message?: string }).message ?? 'Quote not found');
    });
  };

  useEffect(() => {
    load();
  }, [token, id]);

  const hours = useMemo(
    () =>
      (quote?.lineItems ?? [])
        .filter((l) => l.billingType === 'hourly')
        .reduce((s, l) => s + (l.quantity || 0), 0),
    [quote]
  );

  const displayTotal = quote?.total ?? quote?.subtotal ?? 0;

  async function handleDownloadPdf() {
    if (!quote) return;
    downloadQuotePdf(quote, companyName);
    setActionMsg('PDF downloaded.');
  }

  async function handleStatus(status: 'accepted' | 'rejected') {
    if (!token || !quote || !canUpdate) return;
    setActionBusy(true);
    setActionMsg('');
    const res = await crmApi.updateQuote(quote._id, { status }, token);
    setActionBusy(false);
    if (res.success) {
      const data = res.data as CrmQuote & { converted?: { contractId?: string; invoiceId?: string } };
      setQuote({ ...quote, ...data, status });
      if (status === 'accepted' && data.converted?.contractId) {
        setActionMsg('Quote accepted. Draft contract and invoice were created.');
      } else {
        setActionMsg(`Quote marked as ${status}.`);
      }
    } else {
      setActionMsg((res as { message?: string }).message ?? 'Update failed');
    }
  }

  async function handleDelete() {
    if (!token || !quote || !canDelete) return;
    if (!confirm('Delete this draft quote?')) return;
    setActionBusy(true);
    const res = await crmApi.deleteQuote(quote._id, token);
    setActionBusy(false);
    if (res.success) navigate('/crm/quotes');
    else setActionMsg((res as { message?: string }).message ?? 'Delete failed');
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !quote || !sendEmail.trim()) return;
    setSendBusy(true);
    setSendError('');
    try {
      const body: {
        toEmail: string;
        message?: string;
        pdfBase64?: string;
        pdfFilename?: string;
      } = {
        toEmail: sendEmail.trim(),
        message: sendMessage.trim() || undefined,
      };
      if (attachPdf) {
        body.pdfBase64 = quotePdfBase64(quote, companyName);
        body.pdfFilename = quotePdfFilename(quote);
      }
      const res = await crmApi.sendQuote(quote._id, body, token);
      setSendBusy(false);
      if (res.success) {
        setSendOpen(false);
        setSendEmail('');
        setSendMessage('');
        setActionMsg('Quotation emailed successfully.');
        load();
      } else {
        setSendError((res as { message?: string }).message ?? 'Failed to send');
      }
    } catch {
      setSendBusy(false);
      setSendError('Failed to send email');
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <p className="text-sm text-[color:var(--text-muted)]">Loading quotation…</p>
      </div>
    );
  }

  if (error || !quote) {
    return (
      <div className="p-8 space-y-3">
        <p className="text-sm text-red-400">{error || 'Quote not found'}</p>
        <Link to="/crm/quotes" className="text-sm text-[color:var(--accent)] hover:underline">
          ← Back to quotes
        </Link>
      </div>
    );
  }

  const accountId = refId(quote.accountId);
  const dealId = refId(quote.dealId);

  return (
    <div className="p-6 lg:p-8 w-full space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <Link to="/crm/quotes" className="text-xs text-[color:var(--text-muted)] hover:text-[color:var(--accent)]">
            ← Quotes
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-[color:var(--text-primary)]">{quote.title}</h1>
            <span
              className={`text-[11px] font-medium px-2 py-0.5 rounded-full border capitalize ${statusClass(quote.status)}`}
            >
              {quote.status}
            </span>
          </div>
          <p className="text-sm text-[color:var(--text-muted)]">
            {money(displayTotal, quote.currency)}
            {hours > 0 ? ` · ${hours} hrs` : ''}
            {quote.lineItems?.length ? ` · ${quote.lineItems.length} line(s)` : ''}
            {quote.version ? ` · v${quote.version}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void handleDownloadPdf()}
            className="px-3 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)]"
          >
            Download PDF
          </button>
          {quote.status === 'draft' && canUpdate && (
            <Link
              to={`/crm/quotes/${quote._id}/edit`}
              className="px-3 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)]"
            >
              Edit
            </Link>
          )}
          {canUpdate && (
            <button
              type="button"
              onClick={() => {
                setSendOpen(true);
                setSendError('');
              }}
              className="btn-primary px-3 py-2 rounded-lg text-sm"
            >
              Send via email
            </button>
          )}
          {(quote.status === 'draft' || quote.status === 'sent') && canUpdate && (
            <>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => void handleStatus('accepted')}
                className="px-3 py-2 rounded-lg border border-emerald-500/40 text-sm text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50"
              >
                Accept
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => void handleStatus('rejected')}
                className="px-3 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)] disabled:opacity-50"
              >
                Reject
              </button>
            </>
          )}
          {quote.status === 'draft' && canDelete && (
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => void handleDelete()}
              className="px-3 py-2 rounded-lg border border-red-500/40 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {actionMsg && (
        <div className="p-3 rounded-lg bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] text-sm text-[color:var(--text-primary)]">
          {actionMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="lg:col-span-2 rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] overflow-hidden">
          <div className="px-5 py-3 border-b border-[color:var(--border-subtle)]">
            <h2 className="text-sm font-semibold">Line items</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-[color:var(--text-muted)] border-b border-[color:var(--border-subtle)]">
                  <th className="px-5 py-2.5 font-medium">Feature</th>
                  <th className="px-3 py-2.5 font-medium">Type</th>
                  <th className="px-3 py-2.5 font-medium">Qty</th>
                  <th className="px-3 py-2.5 font-medium">Rate</th>
                  <th className="px-3 py-2.5 font-medium">Tax</th>
                  <th className="px-5 py-2.5 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {(quote.lineItems ?? []).map((line, i) => (
                  <tr key={i} className="border-b border-[color:var(--border-subtle)]/60 last:border-0">
                    <td className="px-5 py-3">
                      <p className="text-[color:var(--text-primary)]">{line.description}</p>
                      {line.category && (
                        <p className="text-[11px] text-[color:var(--text-muted)]">{line.category}</p>
                      )}
                    </td>
                    <td className="px-3 py-3 text-[color:var(--text-muted)]">{billingLabel(line.billingType)}</td>
                    <td className="px-3 py-3 text-[color:var(--text-muted)]">
                      {line.billingType === 'hourly' ? `${line.quantity} hrs` : line.quantity}
                    </td>
                    <td className="px-3 py-3 text-[color:var(--text-muted)]">
                      {line.billingType === 'hourly'
                        ? `${money(line.unitPrice, quote.currency)}/hr`
                        : money(line.unitPrice, quote.currency)}
                    </td>
                    <td className="px-3 py-3 text-[color:var(--text-muted)]">{line.taxRate ?? 0}%</td>
                    <td className="px-5 py-3 text-right text-[color:var(--text-primary)]">
                      {money(line.amount ?? 0, quote.currency)}
                    </td>
                  </tr>
                ))}
                {(quote.lineItems ?? []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-[color:var(--text-muted)]">
                      No line items
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <div className="space-y-4">
          <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] p-5 space-y-3">
            <h2 className="text-sm font-semibold">Details</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-[color:var(--text-muted)]">Account</dt>
                <dd className="text-right">
                  {accountId ? (
                    <Link to={`/crm/accounts/${accountId}`} className="text-[color:var(--accent)] hover:underline">
                      {refLabel(quote.accountId, 'account')}
                    </Link>
                  ) : (
                    refLabel(quote.accountId, 'account')
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[color:var(--text-muted)]">Deal</dt>
                <dd className="text-right text-[color:var(--text-primary)]">
                  {dealId ? (
                    <Link to="/crm/deals" className="text-[color:var(--accent)] hover:underline">
                      {refLabel(quote.dealId, 'deal')}
                    </Link>
                  ) : (
                    refLabel(quote.dealId, 'deal')
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[color:var(--text-muted)]">Currency</dt>
                <dd>{quote.currency}</dd>
              </div>
              {quote.taxCode && (
                <div className="flex justify-between gap-3">
                  <dt className="text-[color:var(--text-muted)]">Tax code</dt>
                  <dd>{quote.taxCode}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt className="text-[color:var(--text-muted)]">Valid until</dt>
                <dd>{quote.validUntil ? formatDateDDMMYYYY(quote.validUntil) : '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[color:var(--text-muted)]">Created</dt>
                <dd>{quote.createdAt ? formatDateDDMMYYYY(quote.createdAt) : '—'}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] p-5 space-y-2">
            <h2 className="text-sm font-semibold">Totals</h2>
            <div className="flex justify-between text-sm">
              <span className="text-[color:var(--text-muted)]">Subtotal</span>
              <span>{money(quote.subtotal ?? 0, quote.currency)}</span>
            </div>
            {(quote.discountAmount ?? 0) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-[color:var(--text-muted)]">
                  Discount{quote.discountPercent ? ` (${quote.discountPercent}%)` : ''}
                </span>
                <span>−{money(quote.discountAmount ?? 0, quote.currency)}</span>
              </div>
            )}
            {(quote.taxTotal ?? 0) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-[color:var(--text-muted)]">Tax</span>
                <span>{money(quote.taxTotal ?? 0, quote.currency)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-semibold pt-2 border-t border-[color:var(--border-subtle)]">
              <span>Total</span>
              <span>{money(displayTotal, quote.currency)}</span>
            </div>
          </section>

          {quote.notes?.trim() && (
            <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] p-5 space-y-2">
              <h2 className="text-sm font-semibold">Notes</h2>
              <p className="text-sm text-[color:var(--text-muted)] whitespace-pre-wrap">{quote.notes}</p>
            </section>
          )}
        </div>
      </div>

      {sendOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => !sendBusy && setSendOpen(false)}
        >
          <form
            onSubmit={handleSend}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] p-6 space-y-4 shadow-xl"
          >
            <h2 className="text-lg font-semibold">Send quotation</h2>
            <p className="text-sm text-[color:var(--text-muted)]">
              Emails the quotation summary{attachPdf ? ' with a PDF attachment' : ''}.            </p>
            {sendError && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                {sendError}
              </div>
            )}
            <label className="block text-sm space-y-1.5">
              <span className="font-medium">Recipient email</span>
              <input
                type="email"
                required
                value={sendEmail}
                onChange={(e) => setSendEmail(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40"
                placeholder="client@company.com"
              />
            </label>
            <label className="block text-sm space-y-1.5">
              <span className="font-medium">Message (optional)</span>
              <textarea
                value={sendMessage}
                onChange={(e) => setSendMessage(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded-lg bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40"
                placeholder="Short note to include in the email…"
              />
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={attachPdf}
                onChange={(e) => setAttachPdf(e.target.checked)}
                className="rounded border-[color:var(--border-subtle)]"
              />
              Attach PDF quotation
            </label>
            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={sendBusy} className="btn-primary px-4 py-2 rounded-lg text-sm disabled:opacity-50">
                {sendBusy ? 'Sending…' : 'Send'}
              </button>
              <button
                type="button"
                disabled={sendBusy}
                onClick={() => setSendOpen(false)}
                className="px-4 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm text-[color:var(--text-muted)]"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
