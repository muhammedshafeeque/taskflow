import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { crmApi, quoteDiscountPercent, type CrmQuote } from '../../lib/api';

/**
 * Tells the person working on an open quotation how its discount compares with their limit
 * (AUT-31), before they try to send or accept it.
 */
export default function QuoteDiscountNotice({ quote }: { quote: CrmQuote }) {
  const { token } = useAuth();
  const [limit, setLimit] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    if (!token) return;
    void crmApi.discountPolicy(token).then((res) => res.success && res.data && setLimit(res.data.enabled ? (res.data.myLimit ?? null) : null));
  }, [token]);

  if (quote.status !== 'draft' && quote.status !== 'sent') return null;
  const discount = quoteDiscountPercent(quote);
  if (limit === undefined || limit === null || discount <= limit) return null;
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm" role="status">
      <p className="font-semibold">{discount}% off is above your discount limit of {limit}%</p>
      <p className="text-[12px] text-[color:var(--text-muted)]">
        Sending or accepting it first asks someone whose limit covers the discount to approve it. Lower the discount to send it straight away.
      </p>
    </div>
  );
}
