import { jsPDF } from 'jspdf';
import type { CrmQuote, CrmQuoteLine } from '../lib/api';

function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

function refName(
  ref: string | { _id?: string; name?: string; title?: string } | undefined,
  fallback = '—'
): string {
  if (!ref) return fallback;
  if (typeof ref === 'string') return fallback;
  return ref.name || ref.title || fallback;
}

function billingLabel(type?: string): string {
  if (type === 'hourly') return 'Hourly';
  if (type === 'milestone') return 'Milestone';
  return 'Fixed';
}

function qtyCell(line: CrmQuoteLine): string {
  if (line.billingType === 'hourly') return `${line.quantity} hrs`;
  return String(line.quantity);
}

function rateCell(line: CrmQuoteLine, currency: string): string {
  if (line.billingType === 'hourly') return `${money(line.unitPrice, currency)}/hr`;
  return money(line.unitPrice, currency);
}

export function buildQuotePdf(quote: CrmQuote, companyName?: string): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 16;
  let y = margin;
  const currency = quote.currency || 'USD';

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(companyName || 'Quotation', margin, y);
  y += 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(80);
  doc.text(quote.title, margin, y);
  y += 6;

  doc.setFontSize(9);
  doc.setTextColor(100);
  const meta = [
    `Status: ${quote.status}`,
    quote.version ? `Version: ${quote.version}` : null,
    `Account: ${refName(quote.accountId)}`,
    `Deal: ${refName(quote.dealId)}`,
    quote.validUntil
      ? `Valid until: ${new Date(quote.validUntil).toLocaleDateString()}`
      : null,
    quote.createdAt ? `Created: ${new Date(quote.createdAt).toLocaleDateString()}` : null,
  ].filter(Boolean) as string[];
  for (const line of meta) {
    doc.text(line, margin, y);
    y += 4.5;
  }
  y += 4;

  doc.setDrawColor(200);
  doc.line(margin, y, pageW - margin, y);
  y += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(40);
  const cols = [
    { label: 'Feature', x: margin, w: 62 },
    { label: 'Type', x: margin + 62, w: 22 },
    { label: 'Qty', x: margin + 84, w: 20 },
    { label: 'Rate', x: margin + 104, w: 28 },
    { label: 'Amount', x: margin + 132, w: 30 },
  ];
  for (const c of cols) doc.text(c.label, c.x, y);
  y += 3;
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(30);

  const lines = quote.lineItems ?? [];
  for (const line of lines) {
    if (y > 270) {
      doc.addPage();
      y = margin;
    }
    const feature = line.category
      ? `${line.category} — ${line.description}`
      : line.description;
    const featureLines = doc.splitTextToSize(feature, cols[0].w - 2);
    doc.text(featureLines, cols[0].x, y);
    doc.text(billingLabel(line.billingType), cols[1].x, y);
    doc.text(qtyCell(line), cols[2].x, y);
    doc.text(rateCell(line, currency), cols[3].x, y);
    doc.text(money(line.amount ?? 0, currency), cols[4].x, y);
    y += Math.max(5, featureLines.length * 4) + 1;
  }

  y += 4;
  doc.line(margin, y, pageW - margin, y);
  y += 8;

  doc.setFontSize(9);
  const totalsX = pageW - margin;
  const addTotal = (label: string, value: string, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.text(label, totalsX - 55, y);
    doc.text(value, totalsX, y, { align: 'right' });
    y += 5.5;
  };

  addTotal('Subtotal', money(quote.subtotal ?? 0, currency));
  if ((quote.discountAmount ?? 0) > 0) {
    addTotal(
      `Discount${quote.discountPercent ? ` (${quote.discountPercent}%)` : ''}`,
      `−${money(quote.discountAmount ?? 0, currency)}`
    );
  }
  if ((quote.taxTotal ?? 0) > 0) {
    addTotal(
      `Tax${quote.taxCode ? ` (${quote.taxCode})` : ''}`,
      money(quote.taxTotal ?? 0, currency)
    );
  }
  addTotal('Total', money(quote.total ?? quote.subtotal ?? 0, currency), true);

  if (quote.notes?.trim()) {
    y += 6;
    if (y > 260) {
      doc.addPage();
      y = margin;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Notes', margin, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(60);
    const noteLines = doc.splitTextToSize(quote.notes.trim(), pageW - 2 * margin);
    doc.text(noteLines, margin, y);
  }

  return doc;
}

export function downloadQuotePdf(quote: CrmQuote, companyName?: string): void {
  const doc = buildQuotePdf(quote, companyName);
  const safe = quote.title.replace(/[^\w\-]+/g, '-').replace(/-+/g, '-').slice(0, 60);
  doc.save(`quote-${safe || quote._id}.pdf`);
}

/** Base64 without data: URL prefix — for email attachment. */
export function quotePdfBase64(quote: CrmQuote, companyName?: string): string {
  const doc = buildQuotePdf(quote, companyName);
  return doc.output('datauristring').split(',')[1] ?? '';
}

export function quotePdfFilename(quote: CrmQuote): string {
  const safe = quote.title.replace(/[^\w\-]+/g, '-').replace(/-+/g, '-').slice(0, 60);
  return `quote-${safe || quote._id}.pdf`;
}
