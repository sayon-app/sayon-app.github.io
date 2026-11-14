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
//     madeAt, sentAt, paidAt, paidDate, paidBy, elsewhereAt, payLink }
// paidBy is 'card' when the client paid on the Pay by card link (PAY BY
// CARD below); payLink is that link.
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
  const status = inv && inv.paidAt ? `Paid ${inv.paidBy === 'card' ? 'by card ' : ''}${formatAnswerDate(inv.paidDate || isoDate(new Date(inv.paidAt)))}`
    : inv && inv.elsewhereAt ? 'Invoiced in another app, so SAYON leaves it there'
    : inv && inv.sentAt ? `Emailed ${formatIssueDate(inv.sentAt)}${who ? ` to ${who}` : ''}${invoicePayLinkOpen(inv) ? ', with a Pay by card link' : ''}. ${invoiceOverdue(inv) ? 'Overdue since' : 'Due'} ${formatAnswerDate(inv.due)}`
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
      ${!settled && invoicePayLinkOpen(inv) ? `<div class="qp-links">
        <button type="button" class="quote-text-btn" onclick="checkInvoicePayLinks(true)">Check now</button>
        <button type="button" class="quote-text-btn" onclick="shareInvoicePayLink()">Share the link</button>
      </div>` : ''}
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
  ensureInvoice(q);
  // A business that takes cards has the Pay by card link made first. The
  // Worker's email can wait for it; the phone's own email opens only inside
  // a tap, so there it takes a second one. If the link can't be made, the
  // next tap sends the invoice with the bank details alone.
  if (invoicePayLinkWanted(q)) {
    showToast('Making the Pay by card link…', 'info');
    ensureInvoicePayLink(q).then(link => {
      if (!link) invoicePayLinkSkip[q.reportKey] = true;
      if (link && directEmail && quoteClientEmail(q)) { sendInvoiceEmail(q); return; }
      showToast(link ? 'Ready. Tap Email again to send it' : 'The Pay by card link couldn\'t be made. Tap Email again to send the invoice without it', link ? 'info' : 'error');
    });
    return;
  }
  sendInvoiceEmail(q);
}

function sendInvoiceEmail(q) {
  const inv = q.taxInvoice;
  const due = inv.due > inv.date ? ` It's due by ${formatLongDate(inv.due)}.` : '';
  const card = invoicePayLinkOpen(inv) ? inv.payLink.url : '';
  const how = !card ? 'How to pay is on the invoice.'
    : invoicePayDetailsSet() ? 'You can pay by card at the link below, or by bank transfer with the details on the invoice.'
    : 'You can pay by card at the link below.';
  sendPdfsToClient({
    files: [buildInvoicePDF(q)],
    to: quoteClientEmail(q),
    subject: `Invoice ${inv.number} — ${q.address || 'your property'}`,
    body: clientMessage({ client: q.client, address: q.address, docs: 'invoice', note: `${due} ${how}`.trim(), signOff: inspectorDisplayName(), link: card, linkText: 'Pay by card:' }),
  }).then(sent => {
    delete invoicePayLinkSkip[q.reportKey];
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
  ensureJsPDFLoaded().then(async () => {
    ensureInvoice(q);
    if (invoicePayLinkWanted(q)) await ensureInvoicePayLink(q);
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
  closeInvoicePayLink(q);
  storeSentQuote(q); refreshJobsList(); track('invoice_paid');
  showToast('Marked paid', 'success');
  jobShowNext();
}

function markInvoicedElsewhere() {
  const q = quoteState;
  if (!q || !invoiceWanted(q)) return;
  const inv = ensureInvoice(q);
  inv.elsewhereAt = Date.now();
  closeInvoicePayLink(q);
  storeSentQuote(q); refreshJobsList();
  jobShowNext();
}

// Paid by mistake, or invoiced elsewhere by mistake: back to where it was.
function undoInvoiceSettled() {
  const q = quoteState;
  const inv = q && q.taxInvoice;
  if (!inv) return;
  // A Pay by card link that was paid on or switched off can't be used
  // again: the next email makes a new one. One still waiting to be
  // switched off (no signal at the time) is still live, so it's kept on.
  const link = inv.payLink;
  if (link && (inv.paidBy === 'card' || link.closedAt)) delete inv.payLink;
  else if (link) delete link.closeWanted;
  if (inv.paidAt) { delete inv.paidAt; delete inv.paidDate; delete inv.paidBy; }
  else if (inv.elsewhereAt) {
    // Nothing went from SAYON: start again from the quote. An invoice
    // with a live link keeps it, so the link is never left untracked.
    if (!inv.sentAt && !inv.payLink) delete q.taxInvoice; else delete inv.elsewhereAt;
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
  const cardUrl = !inv.paidAt && invoicePayLinkOpen(inv) ? inv.payLink.url : '';
  doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...C.inkMuted);
  pdfTracked(doc, inv.paidAt ? 'PAYMENT' : 'HOW TO PAY', M, y + 6.5, { cs: 0.5 });
  let py = y + 12;
  if (inv.paidAt) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...C.ink);
    doc.text(`Paid in full${inv.paidBy === 'card' ? ' by card' : ''} on ${formatLongDate(inv.paidDate || isoDate(new Date(inv.paidAt)))}. Thank you.`, M, py);
    py += 5;
  } else if (payRows.length || cardUrl) {
    payRows.concat(payRows.length ? [['Reference', inv.number]] : []).forEach(([k, v]) => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...C.inkLight);
      doc.text(k, M, py);
      doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.ink);
      doc.text(pdfFitText(doc, v, leftW - 28), M + 28, py);
      py += 5;
    });
    // The Pay by card link, to tap on a screen or type from the page.
    if (cardUrl) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...C.inkLight);
      doc.text('Pay by card', M, py);
      doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.accentDark);
      doc.textWithLink(pdfFitText(doc, cardUrl.replace(/^https:\/\//, ''), leftW - 28), M + 28, py, { url: cardUrl });
      py += 5;
    }
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
    // With only a card link to pay on, there's no reference to quote.
    const ref = payRows.length || !cardUrl ? ', using the invoice number as the reference' : '';
    const line = inv.due > inv.date ? `Please pay by ${formatLongDate(inv.due)}${ref}. Thank you for your business.`
      : `Payment is due on receipt${ref ? '. Please use the invoice number as the reference' : ''}. Thank you for your business.`;
    if (y + 8 > BOTTOM) y = newPage();
    doc.text(doc.splitTextToSize(line, CW), M, y);
  }

  drawPdfDocFooters(doc, `${title} ${inv.number}${company.name ? `  ·  ${company.name}` : ''}`, q.reportKey);
  return { blob: doc.output('blob'), fname: pdfFileName('Invoice', q.address, { ref: inv.number }) };
}

// ── PAY BY CARD ─────────────────────────────────────────────────────────────
// A business that has set up card payments (Your prices › Getting paid) has
// a Pay by card link on each invoice: Stripe's payment page for the
// invoice's amount, paid into the business's own Stripe account. SAYON
// never holds the money; the Worker's /stripe/connect/ routes make the
// link and say whether it's been paid (worker/README.md).
//   inv.payLink = { id, url, at, closeWanted, closedAt }
// The link is made when the invoice is first emailed or saved as a PDF,
// takes one payment, and is switched off if the invoice is marked paid by
// hand or invoiced in another app. Paid links are found when Jobs opens,
// the way agreement and quote links are (LINKS OUT in js/app/dashboard.js).
//
// Whether card payments are on is kept with the prices (__cardPay: true,
// or 'pending' while Stripe still needs details), written by the owner's
// phone and synced, so every phone on the business knows without asking.
let cardPayStatus = null;      // what the Worker last said: { connected, ready }
let cardPayBusy = false;       // on the way to Stripe's sign-up
let cardPayStatusAt = 0;       // when the Worker was last asked for it
let cardPayCheckedAt = 0;      // when the links that are out were last asked about
const invoicePayLinkBusy = {}; // report → the request making its link
const invoicePayLinkSkip = {}; // report → its link couldn't be made; the next tap sends without
const jsonPost = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function cardPayOn() {
  return cardPayStatus ? cardPayStatus.ready : quotePriceMemory().__cardPay === true;
}
// Only the owner's phone writes it: a technician's copy of the prices is
// the owner's, and a write here would make it look newer than theirs.
function rememberCardPay(state) {
  if (!isBusinessOwner()) return;
  const mem = quotePriceMemory();
  if ((mem.__cardPay || false) === (state || false)) return;
  if (state) mem.__cardPay = state; else delete mem.__cardPay;
  storeQuotePriceMemory(mem);
}

// Asks the Worker where card payments are up to. A Worker that doesn't
// have them yet answers with an error, and the row stays hidden.
async function loadCardPayStatus() {
  if (!authSession || !navigator.onLine) { renderCardPay(); return; }
  cardPayStatusAt = Date.now();
  try {
    const res = await workerFetch('/stripe/connect/status');
    if (res.ok) {
      const s = await res.json();
      cardPayStatus = { connected: !!s.connected, ready: !!s.ready };
      rememberCardPay(cardPayStatus.ready ? true : cardPayStatus.connected ? 'pending' : false);
    } else {
      cardPayStatus = null;
    }
  } catch (e) { /* no signal: what's kept with the prices stands */ }
  renderCardPay();
}

// The Card payments row in Getting paid.
function renderCardPay() {
  const box = document.getElementById('pbCardPay');
  if (!box) return;
  const kept = quotePriceMemory().__cardPay;
  const s = cardPayStatus || (kept ? { connected: true, ready: kept === true } : null);
  box.hidden = !s;
  if (!s) return;
  const owner = isBusinessOwner();
  document.getElementById('pbCardPayText').textContent = s.ready
    ? 'On. Each invoice has a Pay by card link, and SAYON marks it paid when the client pays. The money goes into your own Stripe account.'
    : s.connected ? 'Stripe still needs a few details before your clients can pay by card.'
    : `Let clients pay an invoice by card. The money goes into your own Stripe account, and Stripe's fee comes out of each payment.${owner ? '' : ' The business owner sets this up.'}`;
  const btn = document.getElementById('pbCardPayBtn');
  btn.hidden = s.ready || !owner;
  btn.textContent = s.connected ? 'Finish setting up' : 'Set up card payments';
  btn.disabled = cardPayBusy;
}

// Off to Stripe's own sign-up page; Stripe sends the owner back here.
async function setUpCardPayments() {
  if (cardPayBusy) return;
  if (!navigator.onLine) { showToast('You\'re offline. Set up card payments when you have signal', 'error'); return; }
  cardPayBusy = true; renderCardPay();
  try {
    const res = await workerFetch('/stripe/connect/onboard', jsonPost({ returnUrl: billingReturnUrl('cards') }));
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) throw new Error(data.message || 'HTTP ' + res.status);
    window.location.href = data.url;
  } catch (e) {
    cardPayBusy = false; renderCardPay();
    showToast('Couldn\'t open Stripe just now. Try again in a moment', 'error');
  }
}

// Back from Stripe's sign-up (handleBillingReturn in js/app/account.js).
async function cardPayReturned() {
  openPriceBook();
  await loadCardPayStatus();
  const box = document.getElementById('pbCardPay');
  if (box && !box.hidden) box.scrollIntoView({ block: 'center' });
  if (!cardPayStatus) return;
  showToast(cardPayStatus.ready ? 'Card payments are on. Your invoices now have a Pay by card link'
    : 'Stripe still needs a few details. Finish setting up when you\'re ready', cardPayStatus.ready ? 'success' : 'info');
}

// The invoice's link, while a client could still pay on it.
function invoicePayLinkOpen(inv) {
  const link = inv && inv.payLink;
  return !!(link && link.url && !link.closeWanted && !link.closedAt);
}
// The invoice is about to go and should carry a link it doesn't have yet.
function invoicePayLinkWanted(q) {
  const inv = q && q.taxInvoice;
  return !!inv && cardPayOn() && !inv.paidAt && !inv.elsewhereAt && !invoicePayLinkOpen(inv) && !invoicePayLinkSkip[q.reportKey]
    && !isSampleJob(q.reportKey) && navigator.onLine && !!authSession;
}
// Makes the link and keeps it on the invoice. Null if it couldn't be made.
function ensureInvoicePayLink(q) {
  const inv = q && q.taxInvoice;
  if (!inv) return Promise.resolve(null);
  if (invoicePayLinkOpen(inv)) return Promise.resolve(inv.payLink);
  if (invoicePayLinkBusy[q.reportKey]) return invoicePayLinkBusy[q.reportKey];
  const run = (async () => {
    try {
      const res = await workerFetch('/stripe/connect/payment-link', jsonPost({ number: inv.number, address: q.address || '', amount_cents: Math.round(inv.total * 100), report_id: q.reportKey }));
      // Card payments were taken off, or aren't finished: invoices go without.
      if (res.status === 409) { cardPayStatus = { connected: true, ready: false }; rememberCardPay('pending'); return null; }
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.id || !data.url) return null;
      inv.payLink = { id: data.id, url: data.url, at: Date.now() };
      storeSentQuote(q);
      return inv.payLink;
    } catch (e) {
      return null;
    } finally {
      delete invoicePayLinkBusy[q.reportKey];
    }
  })();
  invoicePayLinkBusy[q.reportKey] = run;
  return run;
}

// Paid another way: the link is switched off so it can't be paid twice.
// The caller saves the quote. If Stripe can't be reached now, the next
// check tries again.
function closeInvoicePayLink(q) {
  const link = q && q.taxInvoice && q.taxInvoice.payLink;
  if (!link || link.closedAt) return;
  link.closeWanted = true;
  if (!navigator.onLine || !authSession) return;
  workerFetch('/stripe/connect/close-link', jsonPost({ id: link.id })).then(res => {
    // Any answer that isn't an error ends it: the link is off, or the
    // business's Stripe account is out of SAYON's reach and it can't be.
    if (!res.ok) return;
    const now = getSavedQuotes()[q.reportKey], kept = now && now.taxInvoice && now.taxInvoice.payLink;
    if (!kept || kept.id !== link.id) return;
    kept.closedAt = Date.now();
    // Storing it also gives This job, if it's open, the invoice as it now is.
    storeSentQuote(now);
  }).catch(() => {});
}

// Text or email the link on its own, for a client who'd rather tap than
// open the PDF.
async function shareInvoicePayLink() {
  const q = quoteState, inv = q && q.taxInvoice;
  if (!invoicePayLinkOpen(inv)) return;
  const url = inv.payLink.url;
  const text = `Invoice ${inv.number} for ${q.address || 'your property'}: ${formatAUD(inv.total)}. Pay by card here:`;
  if (navigator.share) {
    try { await navigator.share({ title: `Invoice ${inv.number}`, text, url }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    showToast('Link copied. Paste it into a text or email to the client', 'success');
  } catch (e) {
    showLinkToCopy(url);
  }
}

// Every saved invoice with a link a client could still pay on, and the
// links still to switch off.
function invoicePayLinks() {
  const quotes = getSavedQuotes(), out = [], closing = [];
  getSavedReports().forEach(r => {
    const q = quotes[r.id] || r.quote, inv = q && q.taxInvoice, link = inv && inv.payLink;
    if (!link || link.closedAt || isSampleJob(r)) return;
    if (link.closeWanted) closing.push(q);
    else if (!inv.paidAt && !inv.elsewhereAt) out.push({ id: r.id, link: link.id, street: r.jobAddress || (r.address || '').split(',')[0] });
  });
  return { out, closing };
}

// Asks whether the links that are out have been paid, and marks the
// invoices that have. Runs when Jobs opens and when SAYON comes back to
// the front, at most once a minute; now: from Check now, which says what
// it found.
async function checkInvoicePayLinks(now) {
  if (!authSession || !navigator.onLine) { if (now) showToast('You\'re offline. Check again when you have signal', 'error'); return; }
  if (!now && Date.now() - cardPayCheckedAt < LINKS_CHECK_MS) return;
  // An owner still waiting on Stripe finds out here when it's ready.
  if (!now && quotePriceMemory().__cardPay === 'pending' && isBusinessOwner() && Date.now() - cardPayStatusAt > LINKS_CHECK_MS) loadCardPayStatus();
  const { out, closing } = invoicePayLinks();
  closing.forEach(q => closeInvoicePayLink(q));
  if (!out.length) return;
  cardPayCheckedAt = Date.now();
  try {
    const back = [];
    for (let i = 0; i < out.length; i += 20) {
      const some = out.slice(i, i + 20);
      const res = await workerFetch('/stripe/connect/payment-status', jsonPost({ ids: some.map(o => o.link) }));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const paid = (await res.json()).paid || {};
      some.forEach(o => { if (paid[o.link] && takeCardPayment(o.id, o.link, paid[o.link])) back.push(o); });
    }
    if (!back.length) { if (now) showToast('Not paid by card yet', 'info'); return; }
    refreshJobsList();
    if (document.getElementById('jobOverlay').classList.contains('open')) renderJobPage();
    if (back.length === 1) showToast(`Paid by card: ${back[0].street || 'an invoice'}`, 'success', now ? undefined : { label: 'Open', run: () => openDashboardJob(back[0].id, 'job') });
    else showToast(`${back.length} invoices paid by card: ${back.map(b => b.street).filter(Boolean).join(', ')}`, 'success');
  } catch (e) {
    if (now) showToast('Couldn\'t check just now. Try again in a moment', 'error');
  }
}

// Stripe says the link was paid: the invoice is, on the day it was.
function takeCardPayment(reportId, linkId, paid) {
  const q = getSavedQuotes()[reportId], inv = q && q.taxInvoice;
  if (!inv || inv.paidAt || inv.elsewhereAt || !inv.payLink || inv.payLink.id !== linkId) return false;
  inv.paidAt = paid.at ? paid.at * 1000 : Date.now();
  inv.paidDate = isoDate(new Date(inv.paidAt));
  inv.paidBy = 'card';
  storeSentQuote(q);
  track('invoice_paid_by_card');
  return true;
}

// ── FOR XERO ────────────────────────────────────────────────────────────────
// Every invoice SAYON made in a period, as the CSV Xero's sales invoice
// import reads (Business › Invoices › Import), one row per line. Prices go
// in ex GST, so the import is run as "Tax exclusive"; lines go to account
// 200 (Sales), the account Xero's Australian chart starts with. Invoices
// marked "Invoiced in another app" are already in the books, and the sample
// job's isn't real, so neither goes. MYOB reads a different file; later.
const XERO_COLUMNS = ['*ContactName', 'EmailAddress', 'POAddressLine1', 'POAddressLine2', 'POAddressLine3', 'POAddressLine4', 'POCity', 'PORegion',
  'POPostalCode', 'POCountry', '*InvoiceNumber', 'Reference', '*InvoiceDate', '*DueDate', 'Total', 'InventoryItemCode', '*Description', '*Quantity',
  '*UnitAmount', 'Discount', '*AccountCode', '*TaxType', 'TaxAmount', 'TrackingName1', 'TrackingOption1', 'TrackingName2', 'TrackingOption2', 'Currency', 'BrandingTheme'];
const XERO_SALES_ACCOUNT = '200';

// The periods offered: this month, last month, or every invoice.
function invoiceExportPeriods(now = new Date()) {
  const month = (y, m) => ({ from: isoDate(new Date(y, m, 1)), to: isoDate(new Date(y, m + 1, 0)),
    label: new Date(y, m, 1).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }) });
  const y = now.getFullYear(), m = now.getMonth();
  return [Object.assign(month(y, m), { key: 'this' }), Object.assign(month(y, m - 1), { key: 'last' }), { key: 'all', from: '', to: '', label: 'Every invoice' }];
}

// The invoices to export, oldest first: [{ q, inv }].
function invoicesForExport(from, to) {
  return Object.entries(getSavedQuotes())
    .filter(([id, q]) => !isSampleJob(id) && q && q.taxInvoice && !q.taxInvoice.elsewhereAt)
    .map(([, q]) => ({ q, inv: q.taxInvoice }))
    .filter(({ inv }) => (!from || inv.date >= from) && (!to || inv.date <= to))
    .sort((a, b) => a.inv.date < b.inv.date ? -1 : a.inv.date > b.inv.date ? 1 : 0);
}

function xeroInvoicesCsv(list) {
  // A typed name that starts like a formula is kept as text if the file is opened in a spreadsheet.
  const cell = v => { let s = String(v == null ? '' : v); if (/^[=+@]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const day = iso => { const [y, m, d] = String(iso || '').split('-'); return d ? `${d}/${m}/${y}` : ''; };
  const rows = [XERO_COLUMNS];
  list.forEach(({ q, inv }) => {
    const items = (inv.items || []).filter(it => (it.desc || '').trim() || lineTotal(it));
    items.forEach(it => {
      const qty = parseFloat(it.qty), price = parseFloat(it.price);
      const desc = [(it.desc || '').trim() || 'Item', (it.detail || '').trim()].filter(Boolean).join(': ');
      const row = Object.fromEntries(XERO_COLUMNS.map(c => [c, '']));
      Object.assign(row, {
        '*ContactName': (q.client || '').trim() || q.address || 'Client',
        EmailAddress: (q.clientEmail || '').trim(),
        '*InvoiceNumber': inv.number, Reference: q.address || '',
        '*InvoiceDate': day(inv.date), '*DueDate': day(inv.due || inv.date),
        '*Description': desc, '*Quantity': isFinite(qty) ? +qty.toFixed(4) : 0, '*UnitAmount': isFinite(price) ? price.toFixed(2) : '0.00',
        '*AccountCode': XERO_SALES_ACCOUNT, '*TaxType': inv.gst ? 'GST on Income' : 'GST Free Income', Currency: 'AUD',
      });
      rows.push(XERO_COLUMNS.map(c => row[c]));
    });
  });
  return rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

// Your prices › Getting paid › Download for Xero. On a phone that can share
// a file it opens the share sheet (save to Files, email it to the office);
// otherwise it downloads.
async function downloadInvoicesForXero() {
  const sel = document.getElementById('pbXeroPeriod');
  const period = invoiceExportPeriods().find(p => p.key === (sel ? sel.value : 'this')) || invoiceExportPeriods()[0];
  const list = invoicesForExport(period.from, period.to);
  if (!list.length) { showToast(period.key === 'all' ? 'No invoices yet' : `No invoices in ${period.label}`, 'info'); return; }
  const fname = `SAYON invoices for Xero, ${period.key === 'all' ? 'every invoice' : period.label}.csv`.replace(/[\\/:*?"<>|]/g, '');
  const blob = new Blob([xeroInvoicesCsv(list)], { type: 'text/csv' });
  const file = new File([blob], fname, { type: 'text/csv' });
  const n = `${list.length} invoice${list.length === 1 ? '' : 's'}`;
  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ title: fname, files: [file] }); track('invoices_exported', { count: list.length }); }
    catch (e) { if (e.name !== 'AbortError') showToast('Could not open sharing on this device', 'error'); }
    return;
  }
  downloadBlob(blob, fname);
  track('invoices_exported', { count: list.length });
  showToast(`${n} downloaded. In Xero, import it as Tax exclusive`, 'success');
}

function renderXeroExport() {
  const sel = document.getElementById('pbXeroPeriod');
  if (!sel) return;
  const keep = sel.value || 'this';
  sel.innerHTML = invoiceExportPeriods().map(p => `<option value="${p.key}"${p.key === keep ? ' selected' : ''}>${escapeHtml(p.label)}</option>`).join('');
}
