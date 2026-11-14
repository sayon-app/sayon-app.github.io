// SAYON: the invoice. Made from the accepted quote once the work is done,
// emailed to the client as a PDF with the business's bank details, and
// marked paid when the money is in. It's a step of the job, after the
// treatment, so it's done on This job (js/app/job.js): from the Next step
// card while the job is waiting on it, and under its Invoice step.
//
// Kept on the quote as q.taxInvoice (not "invoice": quotes from before the
// 2026-10-05 cut may still carry that key, and quoteContentHash leaves both
// out, so the invoice never makes the quote read as changed):
//   { number, date, due, items, gst, subtotal, gstAmount, total,
//     madeAt, sentAt, paidAt, paidDate, elsewhereAt }
// The lines and amounts are a copy taken when the invoice is made, so the
// invoice stays as it went out. number follows the quote's
// (Q-20261114-4821 → INV-20261114-4821), so it's unique without a counter
// that two phones could both move.
//
// How the client pays and how long they have are the business's, set in
// Your prices › How you charge (js/price-book.js), kept with the prices and
// synced the same way (__payDetails, __invoiceDays).

// Jobs treated before invoices came back don't grow an Invoice step: they
// were finished, and were invoiced some other way.
const INVOICE_FROM = '2026-11-14';
const INVOICE_DAYS = [0, 7, 14, 30];
const INVOICE_DEFAULT_DAYS = 7;

// ── THE BUSINESS'S PAYMENT DETAILS ──────────────────────────────────────────
function invoicePayDetails() {
  const p = quotePriceMemory().__payDetails;
  const s = v => typeof v === 'string' ? v : '';
  return p && typeof p === 'object' ? { name: s(p.name), bsb: s(p.bsb), account: s(p.account), payid: s(p.payid) } : { name: '', bsb: '', account: '', payid: '' };
}
function invoicePayDetailsSet(p = invoicePayDetails()) {
  return !!((p.bsb.trim() && p.account.trim()) || p.payid.trim());
}
function rememberInvoicePayDetails(p) {
  const mem = quotePriceMemory();
  if (JSON.stringify(mem.__payDetails || {}) === JSON.stringify(p)) return;
  mem.__payDetails = p;
  storeQuotePriceMemory(mem);
}
function invoiceDays() {
  const d = quotePriceMemory().__invoiceDays;
  return INVOICE_DAYS.includes(d) ? d : INVOICE_DEFAULT_DAYS;
}
function rememberInvoiceDays(days) {
  const mem = quotePriceMemory();
  if (mem.__invoiceDays === days) return;
  mem.__invoiceDays = days;
  storeQuotePriceMemory(mem);
}
// "062-000" from "062000"; anything else as typed.
function tidyBsb(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d.length === 6 ? `${d.slice(0, 3)}-${d.slice(3)}` : String(v || '').trim();
}

// ── WHERE THE INVOICE IS UP TO ──────────────────────────────────────────────
// The job calls for an invoice: the client accepted the quote (as it
// stands), and the work wasn't recorded before invoices came back.
function invoiceWanted(q) {
  if (!q || !quoteHasItems(q)) return false;
  if (q.taxInvoice) return true;
  const a = quoteAnswerState(q);
  if (!a || a.stale || a.status !== 'accepted') return false;
  return !(q.treatment && q.treatment.date && q.treatment.date < INVOICE_FROM);
}
// Nothing more to do: paid, or invoiced in another app.
function invoiceSettled(q) {
  const inv = q && q.taxInvoice;
  return !!(inv && (inv.paidAt || inv.elsewhereAt));
}
function invoiceOverdue(inv) {
  return !!(inv && inv.sentAt && !inv.paidAt && !inv.elsewhereAt && inv.due && inv.due < todayIsoDate());
}

// The job's Invoice step, as dashboardJob lists it (js/app/dashboard.js).
function invoiceJobStep(q) {
  const inv = q.taxInvoice;
  const total = inv ? inv.total : quoteTotals(q).total;
  const amount = formatAUD(total).replace(/\.00$/, '');
  if (inv && inv.paidAt) return { label: 'Invoice', to: 'invoice', state: 'done', text: `${amount} paid ${dashDay(inv.paidDate || isoDate(new Date(inv.paidAt)))}` };
  if (inv && inv.elsewhereAt) return { label: 'Invoice', to: 'invoice', state: 'done', text: 'Invoiced in another app' };
  if (inv && inv.sentAt) return { label: 'Invoice', to: 'invoice', state: 'todo', text: `${amount} sent ${dashDate(inv.sentAt)}, ${invoiceOverdue(inv) ? 'overdue since' : 'due'} ${dashDay(inv.due)}` };
  if (inv && inv.madeAt) return { label: 'Invoice', to: 'invoice', state: 'todo', text: `${amount}, made ${dashDate(inv.madeAt)}, not sent yet` };
  return { label: 'Invoice', to: 'invoice', state: 'todo', text: q.treatment ? `${amount}, not sent yet` : 'Once the work is done' };
}

// ── MAKING IT ───────────────────────────────────────────────────────────────
function invoiceNumberFor(q) {
  const n = String(q.number || '').trim();
  return /^Q-/i.test(n) ? n.replace(/^Q-/i, 'INV-') : n ? `INV-${n}` : `INV-${isoDate(new Date()).replace(/-/g, '')}`;
}
function addDaysIso(iso, days) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return isoDate(d);
}
// The invoice on the quote, made now if it isn't yet. A copy of the
// quote's lines and totals as they are.
function ensureInvoice(q) {
  if (q.taxInvoice) return q.taxInvoice;
  const t = quoteTotals(q);
  const date = todayIsoDate();
  q.taxInvoice = {
    number: invoiceNumberFor(q), date, due: addDaysIso(date, invoiceDays()),
    items: JSON.parse(JSON.stringify(q.items || [])), gst: q.gst !== false,
    subtotal: t.subtotal, gstAmount: t.gst, total: t.total, madeAt: Date.now(),
  };
  return q.taxInvoice;
}

// ── ON THIS JOB ─────────────────────────────────────────────────────────────
// Under the Invoice step: the invoice card, the same shape as the
// certificate's (what it is, where it's up to, the ways to give it).
function invoicePanel(q) {
  if (!invoiceWanted(q)) return '';
  const esc = escapeHtml;
  const inv = q.taxInvoice;
  const who = (q.client || '').trim(), first = who.split(/\s+/)[0];
  const total = inv ? inv.total : quoteTotals(q).total;
  const amount = `${formatAUD(total)}${(inv ? inv.gst : q.gst !== false) ? ' inc GST' : ''}`;
  const to = quoteClientEmail(q);
  const status = inv && inv.paidAt ? `Paid ${formatAnswerDate(inv.paidDate || isoDate(new Date(inv.paidAt)))}`
    : inv && inv.elsewhereAt ? 'Invoiced in another app, so SAYON leaves it there'
    : inv && inv.sentAt ? `Emailed ${formatIssueDate(inv.sentAt)}${who ? ` to ${who}` : ''}. ${invoiceOverdue(inv) ? 'Overdue since' : 'Due'} ${formatAnswerDate(inv.due)}`
    : `${to ? `Goes to ${to}` : 'Not sent yet'}, due ${invoiceDays() ? `within ${invoiceDays()} days` : 'on receipt'}`;
  const settled = invoiceSettled(q);
  const pay = invoicePayDetailsSet();
  return `<div class="qp-cert qp-invoice ${settled ? 'sent' : ''}">
      <div class="qp-cert-title"><span>${inv ? esc(inv.number) : 'From the accepted quote'}</span><span class="qp-invoice-amount">${esc(amount)}</span></div>
      <p class="qp-cert-text">${esc(status)}</p>
      ${!settled && !pay ? `<div class="qp-cert-gaps"><span>The invoice doesn't say how to pay you yet.</span><button type="button" class="quote-link-btn" onclick="openInvoicePayDetails()">Add your bank details</button></div>` : ''}
      ${inv && inv.elsewhereAt ? '' : `<div class="qp-cert-actions">
        ${inv && inv.sentAt && !settled ? `<button type="button" class="quote-btn primary qp-invoice-paid" onclick="markInvoicePaid()">Mark paid</button>` : ''}
        ${settled && inv.paidAt ? '' : `<button type="button" class="${inv && inv.sentAt || !q.treatment ? 'quote-link-btn' : 'quote-btn primary'} qp-invoice-email" onclick="emailInvoice()">${inv && inv.sentAt ? 'Email again' : `Email${first ? ' to ' + esc(first) : ''}`}</button>`}
        <button type="button" class="quote-link-btn" onclick="downloadInvoice()">PDF</button>
      </div>`}
      ${!inv || (!inv.sentAt && !inv.elsewhereAt) ? `<button type="button" class="qp-cert-handed" onclick="markInvoicedElsewhere()">Invoicing from Xero or another app? <span>Mark as invoiced</span></button>` : ''}
      ${inv && (inv.paidAt || inv.elsewhereAt) ? `<div class="qp-links"><button type="button" class="quote-text-btn" onclick="undoInvoiceSettled()">${inv.paidAt ? 'Not paid after all' : 'Invoice from SAYON after all'}</button></div>` : ''}
    </div>`;
}

// The Next step card's buttons: email it, then mark it paid.
function invoiceNext(q) {
  const inv = q.taxInvoice;
  const first = (q.client || '').trim().split(/\s+/)[0];
  if (inv && inv.sentAt) return `<button type="button" class="dash-detail-primary job-invoice-next" onclick="markInvoicePaid()">Mark paid</button>
      <div class="dash-detail-links"><button type="button" onclick="emailInvoice()">Email it again</button></div>`;
  return `<button type="button" class="dash-detail-primary job-invoice-next" onclick="emailInvoice()">Email the invoice${first ? ' to ' + escapeHtml(first) : ''}</button>
      <div class="dash-detail-links"><button type="button" onclick="downloadInvoice()">Save the PDF</button><button type="button" onclick="markInvoicedElsewhere()">Invoiced in another app</button></div>`;
}

// Built inside the tap, like the certificate's email, because the share
// sheet won't open after a wait.
function emailInvoice() {
  const q = quoteState;
  if (!q || !invoiceWanted(q)) return;
  if (!jsPDF) {
    ensureJsPDFLoaded()
      .then(() => showToast('Ready. Tap Email again to send it', 'info'))
      .catch(e => showToast((e && e.message) || 'Could not load the PDF tools', 'error'));
    return;
  }
  const inv = ensureInvoice(q);
  const due = inv.due > inv.date ? ` It's due by ${formatLongDate(inv.due)}.` : '';
  sendPdfsToClient({
    files: [buildInvoicePDF(q)],
    to: quoteClientEmail(q),
    subject: `Invoice ${inv.number} — ${q.address || 'your property'}`,
    body: clientMessage({ client: q.client, address: q.address, docs: 'invoice', note: `${due} How to pay is on the invoice.`.trim(), signOff: inspectorDisplayName() }),
  }).then(sent => {
    if (!sent) { storeSentQuote(q); return; }
    // The due date runs from the day it first went.
    if (!inv.sentAt && inv.date !== todayIsoDate()) { inv.date = todayIsoDate(); inv.due = addDaysIso(inv.date, invoiceDays()); }
    inv.sentAt = inv.sentAt || Date.now();
    storeSentQuote(q); refreshJobsList(); track('invoice_sent');
  });
}

function downloadInvoice() {
  const q = quoteState;
  if (!q || !invoiceWanted(q)) return;
  ensureJsPDFLoaded().then(() => {
    ensureInvoice(q);
    const { blob, fname } = buildInvoicePDF(q);
    storeSentQuote(q); refreshJobsList();
    return deliverPdfBlob(blob, fname, { title: 'Invoice', text: 'Invoice', readyToast: 'Invoice ready' });
  }).catch(e => showToast((e && e.message) || 'Could not make the invoice', 'error'));
}

async function markInvoicePaid() {
  const q = quoteState;
  const inv = q && q.taxInvoice;
  if (!inv) return;
  const who = (q.client || '').trim();
  if (!(await askFirst({
    title: `Mark ${formatAUD(inv.total)} paid?`,
    facts: [['Invoice', inv.number], ['From', who || 'The client'], ['Paid', 'Today']],
    text: 'The job moves to Done. If it went in on another day, it still counts as paid.',
    yes: 'Mark paid',
  }))) return;
  inv.paidAt = Date.now();
  inv.paidDate = todayIsoDate();
  storeSentQuote(q); refreshJobsList(); track('invoice_paid');
  showToast('Marked paid', 'success');
  jobShowNext();
}

function markInvoicedElsewhere() {
  const q = quoteState;
  if (!q || !invoiceWanted(q)) return;
  const inv = ensureInvoice(q);
  inv.elsewhereAt = Date.now();
  storeSentQuote(q); refreshJobsList();
  jobShowNext();
}

// Paid by mistake, or invoiced elsewhere by mistake: back to where it was.
function undoInvoiceSettled() {
  const q = quoteState;
  const inv = q && q.taxInvoice;
  if (!inv) return;
  if (inv.paidAt) { delete inv.paidAt; delete inv.paidDate; }
  else if (inv.elsewhereAt) {
    // Nothing went from SAYON: start again from the quote.
    if (!inv.sentAt) delete q.taxInvoice; else delete inv.elsewhereAt;
  }
  storeSentQuote(q); refreshJobsList();
}

// The bank details are set in Your prices, beside the payment terms.
function openInvoicePayDetails() {
  openPriceBook(true);
  setTimeout(() => {
    const el = document.getElementById('pbPayName');
    if (el) { el.scrollIntoView({ block: 'center' }); el.focus({ preventScroll: true }); }
  }, 350);
}

// ── THE PDF ─────────────────────────────────────────────────────────────────
// One page for most jobs: the letterhead (which carries the ABN), who it's
// to and the numbers, the work from the quote, the totals, and how to pay.
// "Tax Invoice" when the business charges GST and has an ABN, as the ATO
// asks; "Invoice" otherwise.
function buildInvoicePDF(q) {
  const C = PDF_COLORS;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const M = 15, CW = 180, BOTTOM = 276;
  const inv = q.taxInvoice || ensureInvoice(q);
  const company = getCompanyDetails();
  const taxInvoice = inv.gst && !!(company.abn || '').trim();
  const title = taxInvoice ? 'Tax Invoice' : 'Invoice';
  const date = formatLongDate(inv.date);
  let y = drawPdfDocCover(doc, company, { kicker: 'Timber pest', title, date, compact: true, left: [
    ['BILL TO', q.client || 'Not specified'],
    ['PROPERTY ADDRESS', q.address || 'Not specified'],
    ['CONTACT', [q.clientPhone, q.clientEmail].map(v => (v || '').trim()).filter(Boolean).join('  ·  ')],
  ], right: [
    ['INVOICE NO.', inv.number],
    ['DATE', date],
    ['DUE', inv.due > inv.date ? formatLongDate(inv.due) : 'On receipt'],
    ['QUOTE NO.', q.number],
    ['WORK DONE', q.treatment && q.treatment.date ? formatLongDate(q.treatment.date) : ''],
  ] });
  const newPage = () => { doc.addPage(); return drawPdfRunningHeader(doc, company, title, q.address, inv.number); };

  y = drawPdfNumberedTitle(doc, y, 'WORK CARRIED OUT', 1);
  y = drawPdfLineItems(doc, y, inv.items || [], { bottom: BOTTOM, newPage });

  const rows = [[inv.gst ? 'Subtotal (ex GST)' : 'Subtotal', inv.subtotal]];
  if (inv.gst) rows.push(['GST (10%)', inv.gstAmount]);
  const boxH = pdfTotalsBoxHeight(rows);
  if (y + boxH + 10 > BOTTOM) y = newPage();
  y += 5;
  drawPdfTotalsBox(doc, y, rows, [inv.paidAt ? 'PAID' : inv.gst ? 'AMOUNT DUE (inc GST)' : 'AMOUNT DUE', inv.total]);

  // How to pay, beside the totals: the bank details, with the invoice
  // number as the reference. With none set, the quote's payment terms.
  const p = invoicePayDetails();
  const payRows = [['Account name', p.name || (invoicePayDetailsSet(p) && p.bsb ? company.name : '')], ['BSB', p.bsb ? tidyBsb(p.bsb) : ''], ['Account no.', p.account], ['PayID', p.payid]]
    .map(([k, v]) => [k, (v || '').trim()]).filter(([, v]) => v);
  const leftW = CW - PDF_TOTALS_BOX_W - 10;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...C.inkMuted);
  pdfTracked(doc, inv.paidAt ? 'PAYMENT' : 'HOW TO PAY', M, y + 6.5, { cs: 0.5 });
  let py = y + 12;
  if (inv.paidAt) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...C.ink);
    doc.text(`Paid in full on ${formatLongDate(inv.paidDate || isoDate(new Date(inv.paidAt)))}. Thank you.`, M, py);
    py += 5;
  } else if (payRows.length) {
    payRows.concat([['Reference', inv.number]]).forEach(([k, v]) => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...C.inkLight);
      doc.text(k, M, py);
      doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.ink);
      doc.text(pdfFitText(doc, v, leftW - 28), M + 28, py);
      py += 5;
    });
  } else {
    const terms = (q.paymentTerms || '').trim() || 'Please contact us to arrange payment.';
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...C.ink);
    const lines = doc.splitTextToSize(terms, leftW);
    doc.text(lines, M, py);
    py += lines.length * 3.8 + 2;
  }
  y = Math.max(y + boxH, py) + 8;

  // A thank you, and the business's terms if they say more than bank details.
  if (!inv.paidAt) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(...C.inkMuted);
    const line = inv.due > inv.date ? `Please pay by ${formatLongDate(inv.due)}, using the invoice number as the reference. Thank you for your business.`
      : 'Payment is due on receipt. Please use the invoice number as the reference. Thank you for your business.';
    if (y + 8 > BOTTOM) y = newPage();
    doc.text(doc.splitTextToSize(line, CW), M, y);
  }

  drawPdfDocFooters(doc, `${title} ${inv.number}${company.name ? `  ·  ${company.name}` : ''}`, q.reportKey);
  return { blob: doc.output('blob'), fname: pdfFileName('Invoice', q.address, { ref: inv.number }) };
}
