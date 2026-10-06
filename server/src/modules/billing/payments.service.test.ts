process.env.RAZORPAY_WEBHOOK_SECRET = 'rzp_secret';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

import crypto from 'crypto';
import { fromMinorUnits, handleRazorpayWebhook, handleStripeWebhook, toMinorUnits } from './payments.service';

describe('payments', () => {
  it('converts to and from minor units', () => {
    expect(toMinorUnits(12.34, 'INR')).toBe(1234);
    expect(toMinorUnits(500, 'JPY')).toBe(500);
    expect(fromMinorUnits(1234, 'usd')).toBe(12.34);
  });

  it('rejects Razorpay webhooks with a bad signature', async () => {
    const body = Buffer.from(JSON.stringify({ event: 'payment_link.paid' }));
    await expect(handleRazorpayWebhook(body, 'deadbeef')).rejects.toThrow('Invalid signature');
  });

  it('accepts a correctly signed Razorpay event it does not handle', async () => {
    const body = Buffer.from(JSON.stringify({ event: 'payment.captured' }));
    const sig = crypto.createHmac('sha256', 'rzp_secret').update(body).digest('hex');
    await expect(handleRazorpayWebhook(body, sig)).resolves.toBeUndefined();
  });

  it('verifies Stripe signatures and timestamps', async () => {
    const body = Buffer.from(JSON.stringify({ type: 'payment_intent.created' }));
    const t = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', 'whsec_test').update(`${t}.${body.toString()}`).digest('hex');
    await expect(handleStripeWebhook(body, `t=${t},v1=${sig}`)).resolves.toBeUndefined();
    await expect(handleStripeWebhook(body, `t=${t},v1=${'0'.repeat(64)}`)).rejects.toThrow('Invalid signature');
    await expect(handleStripeWebhook(body, `t=${t - 3600},v1=${sig}`)).rejects.toThrow('Stale');
  });
});
