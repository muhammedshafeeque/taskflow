import { jsPDF } from 'jspdf';
import type { CoreCompanySettings, CrmQuote, CrmQuoteLine } from './api';

/** Issuer (your company) details printed in the PDF header. All values come from Core company settings. */
export type QuotePdfIssuer = {
  name: string;
  legalName?: string;
  address?: string;
  city?: string;
  country?: string;
  taxId?: string;
  website?: string;
  /** data: URL (PNG/JPEG) — jsPDF cannot fetch remote images. */
  logoDataUrl?: string;
};

export function issuerFromCompany(
  company: Partial<CoreCompanySettings> | null | undefined,
  fallbackName: string,
  logoDataUrl?: string
): QuotePdfIssuer {
  return {
    name: company?.companyName?.trim() || fallbackName,
    legalName: company?.legalName?.trim() || undefined,
    address: company?.address?.trim() || undefined,
    city: company?.city?.trim() || undefined,
    country: company?.country?.trim() || undefined,
    taxId: company?.taxId?.trim() || undefined,
    website: company?.website?.trim() || undefined,
    logoDataUrl,
  };
}

/** Fetch an image URL and return a data: URL usable by jsPDF (undefined on CORS / network failure). */
export async function imageUrlToDataUrl(url?: string | null): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const blob = await res.blob();
    if (!/^image\/(png|jpe?g)$/i.test(blob.type)) return undefined;
    return await new Promise<string | undefined>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : undefined);
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

type RGB = [number, number, number];

const INK: RGB = [17, 24, 39];
const BODY: RGB = [55, 65, 81];
const MUTED: RGB = [107, 114, 128];
const FAINT: RGB = [156, 163, 175];
const RULE: RGB = [229, 231, 235];
const PANEL: RGB = [248, 250, 252];
const ACCENT: RGB = [67, 56, 202];
const ACCENT_SOFT: RGB = [238, 242, 255];

const STATUS_COLORS: Record<string, { fg: RGB; bg: RGB }> = {
  draft: { fg: [75, 85, 99], bg: [243, 244, 246] },
  sent: { fg: [29, 78, 216], bg: [219, 234, 254] },
  accepted: { fg: [21, 128, 61], bg: [220, 252, 231] },
  rejected: { fg: [185, 28, 28], bg: [254, 226, 226] },
  expired: { fg: [180, 83, 9], bg: [254, 243, 199] },
};

/** jsPDF Helvetica cannot render many currency glyphs (e.g. ₹) — use ASCII-safe labels. */
const CURRENCY_PREFIX: Record<string, string> = {
  INR: 'Rs. ',
  USD: '$',
  EUR: 'EUR ',
  GBP: 'GBP ',
  AED: 'AED ',
  CAD: 'CAD ',
  AUD: 'AUD ',
  SGD: 'SGD ',
};

function money(n: number, currency: string): string {
  const code = (currency || 'USD').toUpperCase();
  const amount = Number.isFinite(n) ? n : 0;
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  const prefix = CURRENCY_PREFIX[code];
  if (prefix) return `${prefix}${formatted}`;
  return `${code} ${formatted}`;
}

function fmtDate(d?: string): string {
  if (!d) return '-';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return String(d).slice(0, 10);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function billingLabel(type?: string): string {
  if (type === 'hourly') return 'Hourly';
  if (type === 'milestone') return 'Milestone';
  return 'Fixed';
}

function lineNet(line: CrmQuoteLine): number {
  if (typeof line.amount === 'number' && !Number.isNaN(line.amount)) return line.amount;
  const qty = line.billingType === 'milestone' ? 1 : Math.max(0, line.quantity || 0);
  const gross = qty * Math.max(0, line.unitPrice || 0);
  const disc = Math.min(100, Math.max(0, line.discountPercent || 0));
  return Math.round(gross * (1 - disc / 100) * 100) / 100;
}

function qtyCell(line: CrmQuoteLine): string {
  if (line.billingType === 'milestone') return '1';
  if (line.billingType === 'hourly') return `${line.quantity ?? 0} h`;
  return String(line.quantity ?? 0);
}

function rateCell(line: CrmQuoteLine, currency: string): string {
  if (line.billingType === 'hourly') return `${money(line.unitPrice ?? 0, currency)}/h`;
  return money(line.unitPrice ?? 0, currency);
}

function quoteNumber(quote: CrmQuote): string {
  return `Q-${quote._id.slice(-8).toUpperCase()}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase() || 'Q';
}

/** Strip characters Helvetica (WinAnsi) cannot draw so they don't render as garbage. */
function safe(s: string): string {
  return s
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[•·]/g, '-')
    .split('')
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126) || (c >= 160 && c <= 255);
    })
    .join('');
}

function customerBlock(quote: CrmQuote): { name: string; lines: string[] } {
  const account = quote.accountId && typeof quote.accountId === 'object' ? quote.accountId : null;
  const org = quote.customerOrgId && typeof quote.customerOrgId === 'object' ? quote.customerOrgId : null;
  const lead = quote.leadId && typeof quote.leadId === 'object' ? quote.leadId : null;
  const contact = quote.contactId && typeof quote.contactId === 'object' ? quote.contactId : null;

  const name = org?.name || account?.name || lead?.companyName || lead?.title || 'Customer';

  const lines: string[] = [];
  const attn = contact?.name || lead?.contactName;
  if (attn) lines.push(`Attn: ${attn}`);
  const email = contact?.email || lead?.contactEmail || org?.contactEmail;
  if (email) lines.push(email);
  if (account?.website) lines.push(account.website);
  if (account?.industry) lines.push(account.industry);
  return { name, lines: [...new Set(lines)] };
}

export function buildQuotePdf(quote: CrmQuote, issuerOrName?: QuotePdfIssuer | string): jsPDF {
  const issuer: QuotePdfIssuer =
    typeof issuerOrName === 'object' && issuerOrName
      ? issuerOrName
      : { name: (issuerOrName as string | undefined) || 'Quotation' };

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 16;
  const contentW = pageW - 2 * M;
  const bottomLimit = pageH - 22;
  const currency = (quote.currency || 'USD').toUpperCase();
  const lines = quote.lineItems ?? [];
  const totalHours = lines
    .filter((l) => l.billingType === 'hourly')
    .reduce((s, l) => s + (l.quantity || 0), 0);
  const dealTitle = quote.dealId && typeof quote.dealId === 'object' ? quote.dealId.title : undefined;
  const leadTitle = quote.leadId && typeof quote.leadId === 'object' ? quote.leadId.title : undefined;

  const color = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
  const fill = (c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
  const stroke = (c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);
  const font = (style: 'normal' | 'bold', size: number, c: RGB = BODY) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    color(c);
  };
  const text = (s: string | string[], x: number, y: number, opts?: { align?: 'left' | 'right' | 'center' }) =>
    doc.text(Array.isArray(s) ? s.map(safe) : safe(s), x, y, opts);
  const wrap = (s: string, w: number): string[] => doc.splitTextToSize(safe(s), w) as string[];
  const eyebrow = (label: string, x: number, y: number, align?: 'left' | 'right') => {
    font('bold', 7, MUTED);
    doc.setCharSpace(0.6);
    text(label.toUpperCase(), x, y, { align });
    doc.setCharSpace(0);
  };

  let y = 0;

  // ── Accent strip ──────────────────────────────────────────────────────
  fill(ACCENT);
  doc.rect(0, 0, pageW, 3, 'F');

  // ── Issuer (left) ─────────────────────────────────────────────────────
  y = 16;
  let brandX = M;
  let logoDrawn = false;
  if (issuer.logoDataUrl) {
    try {
      const props = doc.getImageProperties(issuer.logoDataUrl);
      const maxH = 14;
      const maxW = 36;
      const ratio = props.width / props.height;
      const h = Math.min(maxH, maxW / ratio);
      const w = h * ratio;
      doc.addImage(issuer.logoDataUrl, M, y - 4, w, h);
      brandX = M + w + 4;
      logoDrawn = true;
    } catch {
      logoDrawn = false;
    }
  }
  if (!logoDrawn) {
    fill(ACCENT);
    doc.roundedRect(M, y - 4, 14, 14, 2.5, 2.5, 'F');
    font('bold', 11, [255, 255, 255]);
    text(initials(issuer.name), M + 7, y + 4.6, { align: 'center' });
    brandX = M + 18;
  }

  font('bold', 13, INK);
  const nameLines = wrap(issuer.name, pageW / 2 - brandX + 6);
  text(nameLines[0], brandX, y + 1);
  font('normal', 7.5, MUTED);
  let iy = y + 5.5;
  const issuerLines = [
    issuer.legalName && issuer.legalName !== issuer.name ? issuer.legalName : '',
    issuer.address ?? '',
    [issuer.city, issuer.country].filter(Boolean).join(', '),
    issuer.taxId ? `Tax ID: ${issuer.taxId}` : '',
    issuer.website ?? '',
  ].filter(Boolean);
  for (const l of issuerLines) {
    for (const w of wrap(l, pageW / 2 - brandX + 6)) {
      text(w, brandX, iy);
      iy += 3.6;
    }
  }

  // ── Document title (right) ────────────────────────────────────────────
  font('bold', 24, INK);
  doc.setCharSpace(1.2);
  text('QUOTATION', pageW - M, y + 3, { align: 'right' });
  doc.setCharSpace(0);
  font('normal', 9, MUTED);
  text(`No. ${quoteNumber(quote)}`, pageW - M, y + 9, { align: 'right' });

  const status = (quote.status || 'draft').toLowerCase();
  const sc = STATUS_COLORS[status] ?? STATUS_COLORS.draft;
  font('bold', 7, sc.fg);
  const pillLabel = status.toUpperCase();
  const pillW = doc.getTextWidth(pillLabel) + 6;
  fill(sc.bg);
  doc.roundedRect(pageW - M - pillW, y + 11.5, pillW, 5, 2.5, 2.5, 'F');
  color(sc.fg);
  text(pillLabel, pageW - M - pillW / 2, y + 15, { align: 'center' });

  y = Math.max(iy, y + 22) + 4;

  // ── Meta strip ────────────────────────────────────────────────────────
  const meta: Array<[string, string]> = [
    ['Issue date', fmtDate(quote.createdAt)],
    ['Valid until', fmtDate(quote.validUntil)],
    ['Currency', currency],
    ['Version', `v${quote.version ?? 1}`],
  ];
  if (totalHours > 0) meta.push(['Est. effort', `${totalHours} hrs`]);
  fill(PANEL);
  doc.roundedRect(M, y, contentW, 15, 2, 2, 'F');
  const cellW = contentW / meta.length;
  meta.forEach(([label, value], i) => {
    const cx = M + i * cellW + 5;
    eyebrow(label, cx, y + 5.5);
    font('bold', 9.5, INK);
    text(value, cx, y + 11);
    if (i > 0) {
      stroke(RULE);
      doc.setLineWidth(0.2);
      doc.line(M + i * cellW, y + 3, M + i * cellW, y + 12);
    }
  });
  y += 23;

  // ── Bill to / Subject ─────────────────────────────────────────────────
  const colW = contentW / 2 - 6;
  const rightCol = M + contentW / 2 + 6;
  const customer = customerBlock(quote);

  eyebrow('Prepared for', M, y);
  eyebrow('Subject', rightCol, y);
  let ly = y + 6;
  font('bold', 11, INK);
  for (const w of wrap(customer.name, colW)) {
    text(w, M, ly);
    ly += 5;
  }
  font('normal', 8.5, BODY);
  for (const l of customer.lines) {
    for (const w of wrap(l, colW)) {
      text(w, M, ly);
      ly += 4;
    }
  }

  let ry = y + 6;
  font('bold', 11, INK);
  for (const w of wrap(quote.title || 'Quotation', colW)) {
    text(w, rightCol, ry);
    ry += 5;
  }
  font('normal', 8.5, BODY);
  const subjectLines = [
    dealTitle ? `Deal: ${dealTitle}` : '',
    leadTitle && leadTitle !== quote.title ? `Opportunity: ${leadTitle}` : '',
  ].filter(Boolean);
  for (const l of subjectLines) {
    for (const w of wrap(l, colW)) {
      text(w, rightCol, ry);
      ry += 4;
    }
  }

  y = Math.max(ly, ry) + 8;

  // ── Line items table ──────────────────────────────────────────────────
  const anyDisc = lines.some((l) => (l.discountPercent ?? 0) > 0);
  type Col = { key: string; label: string; w: number; align: 'left' | 'right' };
  const colsBase: Col[] = [
    { key: 'idx', label: '#', w: 9, align: 'left' },
    { key: 'desc', label: 'Description', w: 0, align: 'left' },
    { key: 'qty', label: 'Qty', w: 18, align: 'right' },
    { key: 'rate', label: 'Rate', w: 30, align: 'right' },
    ...(anyDisc ? [{ key: 'disc', label: 'Disc.', w: 14, align: 'right' as const }] : []),
    { key: 'amt', label: 'Amount', w: 32, align: 'right' },
  ];
  const fixedW = colsBase.reduce((s, c) => s + c.w, 0);
  colsBase[1].w = contentW - fixedW;
  const cols = colsBase.map((c, i) => ({
    ...c,
    x: M + colsBase.slice(0, i).reduce((s, cc) => s + cc.w, 0),
  }));
  const cellX = (c: (typeof cols)[number]) => (c.align === 'right' ? c.x + c.w - 3 : c.x + 3);

  const drawHeader = () => {
    fill(INK);
    doc.roundedRect(M, y, contentW, 8, 1.5, 1.5, 'F');
    font('bold', 7.5, [255, 255, 255]);
    doc.setCharSpace(0.4);
    for (const c of cols) text(c.label.toUpperCase(), cellX(c), y + 5.3, { align: c.align });
    doc.setCharSpace(0);
    y += 8;
  };
  const newPage = () => {
    doc.addPage();
    fill(ACCENT);
    doc.rect(0, 0, pageW, 3, 'F');
    y = 14;
  };

  drawHeader();

  const descCol = cols[1];
  lines.forEach((line, idx) => {
    font('bold', 9, INK);
    const descLines = wrap(line.description || '-', descCol.w - 6);
    const sub = [line.category, billingLabel(line.billingType), (line.taxRate ?? 0) > 0 ? `Tax ${line.taxRate}%` : '']
      .filter(Boolean)
      .join('  |  ');
    const rowH = 4 + descLines.length * 4.2 + 3.8 + 2.5;

    if (y + rowH > bottomLimit) {
      newPage();
      drawHeader();
    }

    const top = y;
    const base = top + 5.6;
    font('normal', 8.5, FAINT);
    text(String(idx + 1).padStart(2, '0'), cellX(cols[0]), base);
    font('bold', 9, INK);
    descLines.forEach((d, i) => text(d, cellX(descCol), base + i * 4.2));
    font('normal', 7.5, MUTED);
    text(sub, cellX(descCol), base + descLines.length * 4.2);

    font('normal', 9, BODY);
    for (const c of cols.slice(2)) {
      let v = '';
      if (c.key === 'qty') v = qtyCell(line);
      if (c.key === 'rate') v = rateCell(line, currency);
      if (c.key === 'disc') v = (line.discountPercent ?? 0) > 0 ? `${line.discountPercent}%` : '-';
      if (c.key === 'amt') {
        font('bold', 9, INK);
        v = money(lineNet(line), currency);
      }
      text(v, cellX(c), base, { align: c.align });
    }

    y = top + rowH;
    stroke(RULE);
    doc.setLineWidth(0.2);
    doc.line(M, y, pageW - M, y);
  });

  if (lines.length === 0) {
    font('normal', 9, MUTED);
    text('No line items', M + 3, y + 7);
    y += 12;
  }

  // ── Totals ────────────────────────────────────────────────────────────
  const totalRows: Array<[string, string]> = [['Subtotal', money(quote.subtotal ?? 0, currency)]];
  if ((quote.discountAmount ?? 0) > 0) {
    totalRows.push([
      `Discount${quote.discountPercent ? ` (${quote.discountPercent}%)` : ''}`,
      `- ${money(quote.discountAmount ?? 0, currency)}`,
    ]);
  }
  if ((quote.taxTotal ?? 0) > 0) {
    totalRows.push([`Tax${quote.taxCode ? ` (${quote.taxCode})` : ''}`, money(quote.taxTotal ?? 0, currency)]);
  }
  const totalsH = totalRows.length * 6 + 18;
  if (y + 6 + totalsH > bottomLimit) newPage();
  y += 6;

  const tW = 82;
  const tX = pageW - M - tW;
  let ty = y + 4;
  for (const [label, value] of totalRows) {
    font('normal', 9, MUTED);
    text(label, tX + 4, ty);
    font('normal', 9, INK);
    text(value, pageW - M - 4, ty, { align: 'right' });
    ty += 6;
  }
  fill(ACCENT);
  doc.roundedRect(tX, ty - 1, tW, 12, 2, 2, 'F');
  font('bold', 8, [224, 231, 255]);
  doc.setCharSpace(0.5);
  text('TOTAL DUE', tX + 4, ty + 6.4);
  doc.setCharSpace(0);
  font('bold', 13, [255, 255, 255]);
  text(money(quote.total ?? quote.subtotal ?? 0, currency), pageW - M - 4, ty + 6.8, { align: 'right' });

  // Left of totals: at-a-glance summary
  const sW = contentW - tW - 8;
  fill(ACCENT_SOFT);
  doc.roundedRect(M, y, sW, totalsH - 3, 2, 2, 'F');
  eyebrow('At a glance', M + 5, y + 6);
  font('normal', 8.5, BODY);
  const glance = [
    `${lines.length} line item${lines.length === 1 ? '' : 's'}${totalHours > 0 ? `  |  ${totalHours} estimated hours` : ''}`,
    quote.validUntil
      ? `This quotation is valid until ${fmtDate(quote.validUntil)}.`
      : 'Prices are subject to change without notice.',
    `All amounts in ${currency}.`,
  ];
  let gy = y + 11.5;
  for (const g of glance) {
    for (const w of wrap(g, sW - 10)) {
      text(w, M + 5, gy);
      gy += 4.2;
    }
  }

  y = Math.max(ty + 11, y + totalsH - 3) + 10;

  // ── Notes / terms ─────────────────────────────────────────────────────
  if (quote.notes?.trim()) {
    if (y + 16 > bottomLimit) newPage();
    eyebrow('Notes & terms', M, y);
    y += 2.5;
    stroke(ACCENT);
    doc.setLineWidth(0.6);
    const noteLinesAll = quote.notes
      .trim()
      .split(/\r?\n/)
      .flatMap((p) => (p.trim() ? wrap(p, contentW - 6) : ['']));
    font('normal', 8.5, BODY);
    let blockStart = y;
    for (const nl of noteLinesAll) {
      if (y + 6 > bottomLimit) {
        doc.line(M, blockStart, M, y + 1);
        newPage();
        blockStart = y;
        font('normal', 8.5, BODY);
        stroke(ACCENT);
        doc.setLineWidth(0.6);
      }
      y += 4.3;
      if (nl) text(nl, M + 5, y);
    }
    doc.line(M, blockStart, M, y + 1.5);
    doc.setLineWidth(0.2);
    y += 10;
  }

  // ── Acceptance ────────────────────────────────────────────────────────
  if (y + 30 > bottomLimit) newPage();
  eyebrow('Acceptance', M, y);
  font('normal', 8, MUTED);
  text('By signing below, the customer accepts the scope and pricing in this quotation.', M, y + 5);
  const sigY = y + 22;
  const sigW = contentW / 2 - 8;
  stroke(FAINT);
  doc.setLineWidth(0.3);
  doc.line(M, sigY, M + sigW, sigY);
  doc.line(pageW - M - sigW, sigY, pageW - M, sigY);
  font('bold', 8, INK);
  text(`For ${issuer.name}`, M, sigY + 4.5);
  text(`For ${customer.name}`, pageW - M - sigW, sigY + 4.5);
  font('normal', 7.5, MUTED);
  text('Authorised signatory  |  Date', M, sigY + 8.5);
  text('Name, signature  |  Date', pageW - M - sigW, sigY + 8.5);
  doc.setLineWidth(0.2);

  // ── Footer on each page ───────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    stroke(RULE);
    doc.setLineWidth(0.2);
    doc.line(M, pageH - 13, pageW - M, pageH - 13);
    font('normal', 7, FAINT);
    text([issuer.name, issuer.website].filter(Boolean).join('  |  '), M, pageH - 8);
    text(quoteNumber(quote), pageW / 2, pageH - 8, { align: 'center' });
    text(`Page ${i} of ${pageCount}`, pageW - M, pageH - 8, { align: 'right' });
  }

  return doc;
}

export function quotePdfFilename(quote: CrmQuote): string {
  const slug = (quote.title || 'quote').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').slice(0, 60);
  return `quote-${slug || quote._id}.pdf`;
}

export function downloadQuotePdf(quote: CrmQuote, issuer?: QuotePdfIssuer | string): void {
  buildQuotePdf(quote, issuer).save(quotePdfFilename(quote));
}

/** Base64 without data: URL prefix — for email attachment. */
export function quotePdfBase64(quote: CrmQuote, issuer?: QuotePdfIssuer | string): string {
  return buildQuotePdf(quote, issuer).output('datauristring').split(',')[1] ?? '';
}
