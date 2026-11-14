// Card payments on the invoice: a business that has set them up (Stripe
// Connect, its own Stripe account) has a Pay by card link on each invoice.
//   1. with a Worker that doesn't have card payments, nothing shows;
//   2. the owner sets them up from Your prices › Getting paid and comes
//      back from Stripe to "On";
//   3. emailing an invoice makes the link first, and it goes in the email
//      and on the PDF beside the bank details;
//   4. Check now, and opening Jobs, mark the invoice paid by card on the
//      day it was paid, and the job moves on;
//   5. Not paid after all drops the used link;
//   6. Mark paid by hand switches the link off;
//   7. if the link can't be made, a second tap sends the invoice without;
//   8. where the phone's own email is used, the link is made on the first
//      tap and the email opens on the second;
//   9. an inspector on a team can't set them up, and the sample job never
//      gets a link.
// Stripe and the Worker are stood in for.
// node e2e.js <outDir>   (serve the repo on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/card-pay'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf', uid = 'u-new';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'owner@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
const emails = [];
// The Worker's card payment routes, as the test wants them to answer.
const cards = { worker: false, connected: false, ready: false, failLink: false, n: 0, paid: {}, calls: [] };
let shotN = 0;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, acceptDownloads: true });
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, async r => {
    const u = r.request().url(); let body = {}; try { body = r.request().postDataJSON() || {}; } catch (e) {}
    if (u.includes('/send-email')) { if (body.check) return r.fulfill({ json: { configured: true } }); emails.push(body); return r.fulfill({ json: { ok: true } }); }
    if (u.includes('/stripe/connect/')) {
      const route = u.split('/stripe/connect/')[1];
      // The Worker as it is today has no such routes.
      if (!cards.worker) return r.fulfill({ status: 405, body: 'Method not allowed' });
      cards.calls.push({ route, body });
      if (route === 'status') return r.fulfill({ json: { connected: cards.connected, ready: cards.ready } });
      // Stripe's sign-up, finished at once, sends the owner back to SAYON.
      if (route === 'onboard') { cards.connected = cards.ready = true; return r.fulfill({ json: { url: `http://localhost:${PORT}/?billing=cards` } }); }
      if (route === 'payment-link') {
        if (!cards.ready) return r.fulfill({ status: 409, json: { code: 'NOT_READY' } });
        if (cards.failLink) return r.fulfill({ status: 502, json: { message: 'Billing request failed' } });
        const id = 'plink_test' + (++cards.n);
        return r.fulfill({ json: { id, url: 'https://buy.stripe.com/test_' + id } });
      }
      if (route === 'payment-status') return r.fulfill({ json: { paid: Object.fromEntries((body.ids || []).map(id => [id, cards.paid[id] || false])) } });
      if (route === 'close-link') return r.fulfill({ json: { closed: true } });
      return r.fulfill({ status: 404, json: {} });
    }
    return r.fulfill({ json: { plan: 'trial', status: 'trialing', ai_calls_used_this_period: 0, limit: 50 } });
  });
  await ctx.route(/supabase\.co/, r => {
    const u = r.request().url();
    if (u.includes('/rest/v1/businesses')) return r.fulfill({ json: [{ id: 'b-new', name: 'Example Pest Co', owner_id: uid, settings: {} }] });
    return r.fulfill({ json: [] });
  });
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); }, sess);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  const shot = async (name) => { await p.waitForTimeout(350); await p.screenshot({ path: `${OUT}/${String(++shotN).padStart(2, '0')}-${name}.png` }); };
  const tap = async (loc, what) => { try { await loc.scrollIntoViewIfNeeded({ timeout: 3000 }); await loc.tap({ timeout: 5000 }); return true; } catch (e) { check(false, 'tap ' + what + ': ' + e.message.split('\n')[0]); return false; } };
  const toast = () => p.evaluate(() => { const t = document.getElementById('toast'); return t.classList.contains('show') ? t.innerText.replace(/\s+/g, ' ').trim() : ''; });
  const job = () => p.evaluate(() => { const j = currentJobSummary(); const inv = j.steps.find(s => s.to === 'invoice'); return { group: j.group, status: j.status, next: j.next && j.next.to, invoice: inv && { state: inv.state, full: inv.full } }; });
  const inv = () => p.evaluate(() => getSavedQuotes().report_card.taxInvoice || null);
  const row = () => p.evaluate(() => { const box = document.getElementById('pbCardPay'), btn = document.getElementById('pbCardPayBtn'); return { shown: !box.hidden, text: document.getElementById('pbCardPayText').textContent, button: btn.hidden ? '' : btn.textContent }; });
  const panel = () => p.evaluate(() => { const f = document.querySelector('#jobOverlay .job-fold[data-step="invoice"]'); f.open = true; jobFoldToggled(f); return f.querySelector('.job-fold-body').innerText.replace(/\s+/g, ' '); });
  const openJob = () => p.evaluate(() => openDashboardJob('report_card', 'job'));
  const calls = route => cards.calls.filter(c => c.route === route);

  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  await p.fill('#ob-licence', 'NSW 123456'); await p.fill('#ob-phone', '0400 000 000'); await p.fill('#ob-abn', '12 345 678 901');
  await tap(p.locator('#obBusinessSave'), 'Continue (business)');
  await p.evaluate(() => { obNext(1); obShowPanel(2); obFinish(true); }); await p.waitForTimeout(2000);
  // A real job, made from the sample's: treated today, certificate sent,
  // no invoice yet. The business has bank details.
  await p.evaluate(() => {
    const reports = getSavedReports();
    const r = JSON.parse(JSON.stringify(reports.find(x => x.id === 'sample_job')));
    const q = JSON.parse(JSON.stringify(getSavedQuotes().sample_job));
    r.id = 'report_card'; delete r.sample;
    q.reportKey = 'report_card'; delete q.taxInvoice; q.treatment.date = todayIsoDate();
    r.quote = q;
    setSavedReports(reports.concat([r]));
    const all = JSON.parse(localStorage.getItem(quotesStorageKey()) || '{}'); all.report_card = q; localStorage.setItem(quotesStorageKey(), JSON.stringify(all));
    rememberInvoicePayDetails({ name: 'Example Pest Co Pty Ltd', bsb: '062-000', account: '1234 5678', payid: '' });
  });
  await openJob(); await p.waitForTimeout(800);
  let s = await job();
  console.log('start:', JSON.stringify(s));
  check(s.status === 'Send the invoice' && s.next === 'invoice', 'the made-up job is waiting on its invoice');

  // 1. Today's Worker has no card payments: no row, and an invoice asks for no link.
  await p.evaluate(() => { closeJobPage(); openPriceBook(); }); await p.waitForTimeout(900);
  check(!(await row()).shown, 'with a Worker that has no card payments, Getting paid shows no Card payments row');
  check(await p.evaluate(() => { const q = getSavedQuotes().report_card; ensureInvoice(q); const want = invoicePayLinkWanted(q); delete q.taxInvoice; return want; }) === false, 'and an invoice wants no link');

  // 2. The Worker has them: the owner sets them up, and comes back from Stripe.
  cards.worker = true;
  await p.evaluate(() => { cardPayStatusAt = 0; renderPriceBook(); }); await p.waitForTimeout(700);
  let cp = await row();
  console.log('row:', JSON.stringify(cp));
  check(cp.shown && /Let clients pay an invoice by card/.test(cp.text) && /your own Stripe account/.test(cp.text) && cp.button === 'Set up card payments', 'the row offers to set up card payments, and says where the money goes');
  await p.evaluate(() => document.getElementById('pbCardPay').scrollIntoView({ block: 'center' })); await shot('card-payments-off');
  await Promise.all([p.waitForNavigation({ timeout: 10000 }).catch(() => null), tap(p.locator('#pbCardPayBtn'), 'Set up card payments')]);
  await p.waitForTimeout(4500);
  cp = await row();
  const back = await p.evaluate(() => ({ url: location.search, page: document.getElementById('pricesPanel').classList.contains('menu-page-active'), kept: quotePriceMemory().__cardPay, on: cardPayOn() }));
  console.log('back:', JSON.stringify(back), JSON.stringify(cp), await toast());
  check(calls('onboard').length === 1 && /billing=cards/.test(calls('onboard')[0].body.returnUrl || ''), 'Set up card payments asks the Worker for Stripe\'s sign-up, to come back to SAYON');
  check(back.page && cp.shown && /^On\./.test(cp.text) && !cp.button, 'back from Stripe, Getting paid says card payments are on');
  check(back.kept === true && back.on && !/billing/.test(back.url), 'it\'s kept with the prices, and the address bar is tidied');
  await p.evaluate(() => document.getElementById('pbCardPay').scrollIntoView({ block: 'center' })); await shot('card-payments-on');

  // 3. Emailing the invoice makes the link first; it goes in the email and on the PDF.
  await openJob(); await p.waitForTimeout(900);
  await p.evaluate(() => ensureJsPDFLoaded()); await p.waitForTimeout(600);
  await tap(p.locator('#jobOverlay .job-next .job-invoice-next'), 'Email the invoice'); await p.waitForTimeout(4000);
  let i = await inv(); const mail = emails[emails.length - 1] || {};
  const asked = calls('payment-link')[0] || { body: {} };
  console.log('link:', JSON.stringify(asked.body), JSON.stringify(i && i.payLink));
  check(calls('payment-link').length === 1 && asked.body.number === i.number && asked.body.amount_cents === Math.round(i.total * 100) && asked.body.report_id === 'report_card' && !('account' in asked.body), 'the link is asked for by invoice number and amount in cents, with no account');
  check(i.payLink && i.payLink.id === 'plink_test1' && i.sentAt, 'the link is kept on the invoice, and the invoice went');
  check(emails.length === 1 && /Pay by card:\s+https:\/\/buy\.stripe\.com\/test_plink_test1/.test(mail.text || '') && /pay by card at the link below, or by bank transfer with the details on the invoice/.test(mail.text || ''), 'the email has the Pay by card link and says the bank details are on the invoice');
  if (mail.attachments) {
    const pdf = Buffer.from(mail.attachments[0].content, 'base64'); fs.writeFileSync(`${OUT}/invoice-with-card-link.pdf`, pdf);
    const t = pdf.toString('latin1');
    check(t.includes('(Pay by card)') && t.includes('buy.stripe.com/test_plink_test1') && t.includes('062-000') && t.includes('/URI'), 'the PDF has the link under the bank details, as a link');
  } else check(false, 'the email carries the invoice PDF');
  s = await job();
  check(s.group === 'waiting' && /^Invoice due/.test(s.status), 'the job waits on payment');
  let text = await panel();
  check(/with a Pay by card link/.test(text) && /Check now/.test(text) && /Share the link/.test(text), 'the invoice card says it went with a Pay by card link, with Check now and Share the link: ' + text.slice(0, 160));
  check(/A card payment marks it paid for you/.test(await p.evaluate(() => document.querySelector('#jobOverlay .job-next').innerText)), 'the Next step card says a card payment marks itself');
  await shot('next-step-with-link');
  await p.evaluate(() => document.querySelector('#jobOverlay .job-fold[data-step="invoice"]').scrollIntoView({ block: 'center' }));
  await shot('invoice-with-link');

  // 4. Check now: not yet. Then the client pays, and opening Jobs finds it.
  await tap(p.locator('#jobOverlay .job-fold[data-step="invoice"]').getByRole('button', { name: 'Check now' }), 'Check now'); await p.waitForTimeout(700);
  check(/Not paid by card yet/.test(await toast()) && !(await inv()).paidAt, 'Check now says it isn\'t paid yet');
  const paidAt = Math.floor(Date.now() / 1000) - 86400;
  cards.paid.plink_test1 = { at: paidAt };
  await p.evaluate(() => { cardPayCheckedAt = 0; closeJobPage(); openDashboard(); }); await p.waitForTimeout(1200);
  i = await inv();
  const yesterday = await p.evaluate(at => isoDate(new Date(at * 1000)), paidAt);
  console.log('paid:', JSON.stringify({ paidBy: i.paidBy, paidDate: i.paidDate }), await toast());
  check(i.paidBy === 'card' && i.paidDate === yesterday && /^Paid by card: /.test(await toast()), 'opening Jobs marks it paid by card, on the day it was paid, and says so');
  await p.evaluate(() => setDashboardTab('done')); await p.waitForTimeout(500);
  await shot('jobs-paid-by-card');
  await openJob(); await p.waitForTimeout(800);
  s = await job(); text = await panel();
  check(s.group === 'done' && /Paid by card/.test(text) && !/Check now/.test(text), 'the job is done and the invoice card says Paid by card');
  const paidPdf = await p.evaluate(async () => { const { blob } = buildInvoicePDF(getSavedQuotes().report_card); return new TextDecoder('latin1').decode(await blob.arrayBuffer()); });
  check(/Paid in full by card on/.test(paidPdf) && !paidPdf.includes('buy.stripe.com'), 'the paid invoice\'s PDF says paid by card and drops the link');

  // 5. Not paid after all (a refund, say): the used link goes, a new one is wanted.
  await p.evaluate(() => undoInvoiceSettled()); await p.waitForTimeout(400);
  i = await inv();
  check(!i.paidAt && !i.paidBy && !i.payLink && await p.evaluate(() => invoicePayLinkWanted(getSavedQuotes().report_card)), 'Not paid after all drops the used link, so the next email makes a new one');

  // 7. The link can't be made: the first tap says so, the second sends without it.
  cards.failLink = true;
  await tap(p.locator('#jobOverlay .job-next').getByRole('button', { name: 'Email it again' }), 'Email it again'); await p.waitForTimeout(1500);
  check(/couldn't be made\. Tap Email again to send the invoice without it/.test(await toast()) && emails.length === 1, 'a link that can\'t be made is said, and nothing goes yet: ' + await toast());
  await tap(p.locator('#jobOverlay .job-next').getByRole('button', { name: 'Email it again' }), 'Email it again'); await p.waitForTimeout(3500);
  check(emails.length === 2 && !/Pay by card/.test(emails[1].text || '') && /How to pay is on the invoice/.test(emails[1].text || ''), 'the second tap sends the invoice with the bank details alone');
  cards.failLink = false;

  // 6. Email again makes the new link; Mark paid by hand switches it off.
  await tap(p.locator('#jobOverlay .job-next').getByRole('button', { name: 'Email it again' }), 'Email it again'); await p.waitForTimeout(4000);
  i = await inv();
  check(emails.length === 3 && i.payLink && i.payLink.id === 'plink_test2' && /test_plink_test2/.test(emails[2].text || ''), 'Email again makes a new link and sends it');
  await tap(p.locator('#jobOverlay .job-next .job-invoice-next'), 'Mark paid'); await p.waitForTimeout(500);
  await tap(p.locator('#askYes'), 'Mark paid (on the sheet)'); await p.waitForTimeout(900);
  i = await inv();
  check(i.paidAt && !i.paidBy && calls('close-link').length === 1 && calls('close-link')[0].body.id === 'plink_test2' && i.payLink.closedAt, 'Mark paid by hand switches the link off, so it can\'t be paid twice');
  check(!/Check now/.test(await panel()), 'and the card stops offering Check now');

  // Not paid after all, once the link is off: it's gone, and the next email makes another.
  await p.evaluate(() => undoInvoiceSettled()); await p.waitForTimeout(300);
  i = await inv();
  check(!i.paidAt && !i.payLink, 'Not paid after all drops a link that was switched off');
  // Marked paid with no signal: the link is still live at Stripe, so undoing keeps it on the invoice.
  await p.evaluate(async () => { const q = quoteState; await ensureInvoicePayLink(q); q.taxInvoice.paidAt = Date.now(); q.taxInvoice.payLink.closeWanted = true; storeSentQuote(q); undoInvoiceSettled(); }); await p.waitForTimeout(300);
  i = await inv();
  check(!i.paidAt && i.payLink && i.payLink.id === 'plink_test3' && !i.payLink.closeWanted && await p.evaluate(() => invoicePayLinkOpen(quoteState.taxInvoice)), 'a link still waiting to be switched off is kept when the payment is undone');
  // Check now on the open job finds the payment and the card says so.
  cards.paid.plink_test3 = { at: Math.floor(Date.now() / 1000) };
  await p.evaluate(() => renderJobPage()); await p.waitForTimeout(300);
  await panel();
  await tap(p.locator('#jobOverlay .job-fold[data-step="invoice"]').getByRole('button', { name: 'Check now' }), 'Check now (paid)'); await p.waitForTimeout(900);
  i = await inv();
  check(i.paidBy === 'card' && /Paid by card/.test(await panel()) && /^Paid by card: /.test(await toast()), 'Check now on the open job finds the payment and the card says Paid by card');

  // 8. The phone's own email: the link on the first tap, the email on the second.
  await p.evaluate(() => { undoInvoiceSettled(); directEmail = false; }); await p.waitForTimeout(300);
  const before = calls('payment-link').length;
  await tap(p.locator('#jobOverlay .job-next').getByRole('button', { name: 'Email it again' }), 'Email it again'); await p.waitForTimeout(1500);
  i = await inv();
  check(calls('payment-link').length === before + 1 && i.payLink && i.payLink.id === 'plink_test4' && /Ready\. Tap Email again to send it/.test(await toast()) && emails.length === 3, 'with the phone\'s own email, the first tap makes the link and asks for a second');
  await p.evaluate(() => { directEmail = true; });

  // 9. An inspector on the team can't set them up; the sample never gets a link.
  cards.connected = cards.ready = false;
  await p.evaluate(() => { closeJobPage(); authBusiness.owner_id = 'someone-else'; cardPayStatusAt = 0; openPriceBook(); }); await p.waitForTimeout(900);
  cp = await row();
  check(cp.shown && /The business owner sets this up/.test(cp.text) && !cp.button && await p.evaluate(() => quotePriceMemory().__cardPay) === true, 'an inspector sees what card payments are, with no button, and doesn\'t change what\'s kept: ' + cp.text.slice(-40));
  cards.connected = cards.ready = true;
  await p.evaluate(uid => { authBusiness.owner_id = uid; cardPayStatus = null; }, uid);
  check(await p.evaluate(() => { const q = getSavedQuotes().sample_job; return cardPayOn() && !!q.taxInvoice && !invoicePayLinkWanted(Object.assign({}, q, { taxInvoice: Object.assign({}, q.taxInvoice, { paidAt: 0 }) })); }), 'the sample job\'s invoice never gets a link');

  check(!errs.length, 'no page errors: ' + errs.join(' | '));
  await b.close();
  if (fails.length) { console.log(`\n${fails.length} FAILED`); process.exit(1); }
  console.log('\nALL PASSED');
})();
