import crypto from 'crypto';
import { env } from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { BillingInvoice } from './models/billingInvoice.model';
import { recordPayment } from './billing.service';

/**
 * Online payment links for invoices. Razorpay (Payment Links API) or Stripe
 * (Checkout Sessions), chosen by PAYMENTS_PROVIDER. Payments are confirmed only
 * by signed provider webhooks — never by the browser redirect.
 */
type Provider = 'razorpay' | 'stripe';

const cfg = {
  provider: (process.env.PAYMENTS_PROVIDER?.trim().toLowerCase() || '') as Provider | '',
  razorpayKeyId: process.env.RAZORPAY_KEY_ID?.trim() ?? '',
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET?.trim() ?? '',
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET?.trim() ?? '',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY?.trim() ?? '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? '',
};

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'XAF', 'XOF']);

export function toMinorUnits(amount: number, currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? Math.round(amount) : Math.round(amount * 100);
}

export function fromMinorUnits(amount: number, currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? amount : amount / 100;
}

export function paymentsStatus(): { enabled: boolean; provider: Provider | null } {
  if (cfg.provider === 'razorpay' && cfg.razorpayKeyId && cfg.razorpayKeySecret) return { enabled: true, provider: 'razorpay' };
  if (cfg.provider === 'stripe' && cfg.stripeSecretKey) return { enabled: true, provider: 'stripe' };
  return { enabled: false, provider: null };
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && ab.length > 0 && crypto.timingSafeEqual(ab, bb);
}

export async function createPaymentLink(invoiceId: string, workspaceId: string | null | undefined, customerEmail?: string) {
  const status = paymentsStatus();
  if (!status.enabled || !status.provider) {
    throw new ApiError(503, 'Online payments are not configured (set PAYMENTS_PROVIDER and provider keys in server/.env).');
  }
  const orgId = requireWorkspaceId(workspaceId);
  const invoice = await BillingInvoice.findOne({ _id: invoiceId, taskflowOrganizationId: toOrgOid(orgId) });
  if (!invoice) throw new ApiError(404, 'Invoice not found');
  if (invoice.status === 'void' || invoice.status === 'draft') {
    throw new ApiError(400, `Cannot request payment for a ${invoice.status} invoice — send it first.`);
  }
  const outstanding = Math.round((invoice.total - (invoice.amountPaid ?? 0)) * 100) / 100;
  if (!(outstanding > 0)) throw new ApiError(400, 'Invoice is already paid');

  // Reuse a still-valid link for the same amount.
  if (invoice.paymentLink?.url && invoice.paymentLink.amount === outstanding) {
    const ageHours = (Date.now() - new Date(invoice.paymentLink.createdAt).getTime()) / 36e5;
    if (invoice.paymentLink.provider === 'razorpay' || ageHours < 23) return invoice.paymentLink;
  }

  const currency = (invoice.currency || 'USD').toUpperCase();
  const minor = toMinorUnits(outstanding, currency);
  const returnUrl = `${env.appUrl.replace(/\/$/, '')}/billing/invoices/${invoice._id}`;
  let link: { id: string; url: string };

  if (status.provider === 'razorpay') {
    const res = await fetch('https://api.razorpay.com/v1/payment_links', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${cfg.razorpayKeyId}:${cfg.razorpayKeySecret}`).toString('base64')}`,
      },
      body: JSON.stringify({
        amount: minor,
        currency,
        description: `Invoice ${invoice.number}`,
        reference_id: `${invoice.number}-${Date.now().toString(36)}`.slice(0, 40),
        ...(customerEmail ? { customer: { email: customerEmail }, notify: { email: true } } : {}),
        notes: { invoiceId: String(invoice._id), workspaceId: orgId },
        callback_url: returnUrl,
        callback_method: 'get',
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; short_url?: string; error?: { description?: string } };
    if (!res.ok || !data.id || !data.short_url) {
      throw new ApiError(502, `Razorpay: ${data.error?.description ?? `request failed (${res.status})`}`);
    }
    link = { id: data.id, url: data.short_url };
  } else {
    const form = new URLSearchParams({
      mode: 'payment',
      success_url: `${returnUrl}?paid=1`,
      cancel_url: returnUrl,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(minor),
      'line_items[0][price_data][product_data][name]': `Invoice ${invoice.number}`,
      'metadata[invoiceId]': String(invoice._id),
      'metadata[workspaceId]': orgId,
      'payment_intent_data[metadata][invoiceId]': String(invoice._id),
    });
    if (customerEmail) form.set('customer_email', customerEmail);
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.stripeSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; url?: string; error?: { message?: string } };
    if (!res.ok || !data.id || !data.url) {
      throw new ApiError(502, `Stripe: ${data.error?.message ?? `request failed (${res.status})`}`);
    }
    link = { id: data.id, url: data.url };
  }

  invoice.paymentLink = { provider: status.provider, ...link, amount: outstanding, currency, createdAt: new Date() };
  await invoice.save();
  return invoice.paymentLink;
}

async function applyPayment(invoiceId: string, workspaceId: string, paymentRef: string, amount: number): Promise<void> {
  // Claim the payment ref atomically so retried webhooks don't double-count.
  const claimed = await BillingInvoice.findOneAndUpdate(
    { _id: invoiceId, taskflowOrganizationId: toOrgOid(workspaceId), paymentRefs: { $ne: paymentRef } },
    { $push: { paymentRefs: paymentRef } }
  );
  if (!claimed) return;
  try {
    await recordPayment(invoiceId, workspaceId, { amount });
  } catch (err) {
    // An already-paid invoice rejects extra payments; keep the ref so we don't retry forever.
    console.error('[payments] recordPayment failed', invoiceId, err);
  }
}

/** Razorpay webhook: verifies X-Razorpay-Signature over the raw body. */
export async function handleRazorpayWebhook(rawBody: Buffer | undefined, signature: string | undefined): Promise<void> {
  if (!cfg.razorpayWebhookSecret) throw new ApiError(503, 'RAZORPAY_WEBHOOK_SECRET not set');
  if (!rawBody || !signature) throw new ApiError(400, 'Missing signature');
  const expected = crypto.createHmac('sha256', cfg.razorpayWebhookSecret).update(rawBody).digest('hex');
  if (!timingSafeEqualHex(expected, signature)) throw new ApiError(400, 'Invalid signature');

  const event = JSON.parse(rawBody.toString('utf8')) as {
    event?: string;
    payload?: {
      payment_link?: { entity?: { notes?: Record<string, string>; currency?: string } };
      payment?: { entity?: { id?: string; amount?: number; currency?: string } };
    };
  };
  if (event.event !== 'payment_link.paid') return;
  const notes = event.payload?.payment_link?.entity?.notes ?? {};
  const payment = event.payload?.payment?.entity;
  if (!notes.invoiceId || !notes.workspaceId || !payment?.id || !payment.amount) return;
  await applyPayment(notes.invoiceId, notes.workspaceId, `razorpay:${payment.id}`, fromMinorUnits(payment.amount, payment.currency ?? 'INR'));
}

/** Stripe webhook: verifies the `Stripe-Signature` header (t=…,v1=…) with a 5-minute tolerance. */
export async function handleStripeWebhook(rawBody: Buffer | undefined, header: string | undefined): Promise<void> {
  if (!cfg.stripeWebhookSecret) throw new ApiError(503, 'STRIPE_WEBHOOK_SECRET not set');
  if (!rawBody || !header) throw new ApiError(400, 'Missing signature');
  const parts = Object.fromEntries(
    header.split(',').map((kv) => {
      const [k, ...v] = kv.split('=');
      return [k.trim(), v.join('=')];
    })
  ) as Record<string, string>;
  const signatures = header
    .split(',')
    .filter((kv) => kv.trim().startsWith('v1='))
    .map((kv) => kv.trim().slice(3));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) throw new ApiError(400, 'Stale or missing timestamp');
  const expected = crypto.createHmac('sha256', cfg.stripeWebhookSecret).update(`${t}.${rawBody.toString('utf8')}`).digest('hex');
  if (!signatures.some((sig) => timingSafeEqualHex(expected, sig))) throw new ApiError(400, 'Invalid signature');

  const event = JSON.parse(rawBody.toString('utf8')) as {
    type?: string;
    data?: { object?: { id?: string; payment_status?: string; amount_total?: number; currency?: string; metadata?: Record<string, string> } };
  };
  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') return;
  const session = event.data?.object;
  if (!session?.id || session.payment_status !== 'paid' || !session.amount_total) return;
  const { invoiceId, workspaceId } = session.metadata ?? {};
  if (!invoiceId || !workspaceId) return;
  await applyPayment(invoiceId, workspaceId, `stripe:${session.id}`, fromMinorUnits(session.amount_total, session.currency ?? 'usd'));
}
