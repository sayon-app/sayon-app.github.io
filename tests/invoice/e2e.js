// The invoice: made from the accepted quote once the work is done and the
// certificate has gone, emailed with the business's bank details, then
// marked paid. It's a step on This job, after the treatment; a job treated
// before invoices came back doesn't grow one; "Invoiced in another app"
// settles it without sending anything; the invoice never makes the quote
// read as changed.
// node e2e.js <outDir>   (serve the repo on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/invoice'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf', uid = 'u-new';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'owner@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
const emails = [];
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
    return r.fulfill({ json: { plan: 'trial', status: 'trialing', ai_calls_used_this_period: 0, limit: 50 } });
  });
  await ctx.route(/supabase\.co/, r => {
    const u = r.request().url(), m = r.request().method();
    if (u.includes('/rest/v1/businesses') && m === 'POST') return r.fulfill({ json: [{ id: 'b-new', name: 'Example Pest Co', owner_id: uid, settings: {} }] });
    return r.fulfill({ json: [] });
  });
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); }, sess);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  const shot = async (name) => { await p.waitForTimeout(350); await p.screenshot({ path: `${OUT}/${String(++shotN).padStart(2, '0')}-${name}.png` }); };
  const tap = async (loc, what) => { try { await loc.scrollIntoViewIfNeeded({ timeout: 3000 }); await loc.tap({ timeout: 5000 }); return true; } catch (e) { check(false, 'tap ' + what + ': ' + e.message.split('\n')[0]); return false; } };
  const job = () => p.evaluate(() => { const j = currentJobSummary(); const inv = j.steps.find(s => s.to === 'invoice'); return { group: j.group, status: j.status, next: j.next && j.next.to, finished: j.finished, invoice: inv && { state: inv.state, full: inv.full } }; });
  const nextText = () => p.evaluate(() => document.querySelector('#jobOverlay .job-next').innerText.replace(/\s+/g, ' '));

  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  await p.fill('#ob-licence', 'NSW 123456'); await p.fill('#ob-phone', '0400 000 000'); await p.fill('#ob-abn', '12 345 678 901');
  await tap(p.locator('#obBusinessSave'), 'Continue (business)');
  await p.evaluate(() => { obNext(1); obShowPanel(2); obFinish(true); }); await p.waitForTimeout(2000);

  // 1. The sample job comes invoiced and paid: every step done, Finalise next.
  let s = await job();
  console.log('sample:', JSON.stringify(s));
  check(s.group === 'done' && s.invoice && s.invoice.state === 'done' && /paid/.test(s.invoice.full), 'the sample job\'s invoice is paid, so the job is done');

  // 2. A job treated before invoices came back has no Invoice step.
  await p.evaluate(() => { const q = getSavedQuotes().sample_job; delete q.taxInvoice; q.treatment.date = '2026-11-01'; storeSentQuote(q); useJobQuote(q); renderJobPage(); }); await p.waitForTimeout(400);
  s = await job();
  check(!s.invoice && s.group === 'done', 'a job treated before invoices came back has no Invoice step and stays done');

  // 3. Treated today, certificate sent: the invoice is the next step.
  const hashBefore = await p.evaluate(() => { const q = getSavedQuotes().sample_job; q.treatment.date = todayIsoDate(); storeSentQuote(q); useJobQuote(q); renderJobPage(); return quoteContentHash(q); });
  await p.waitForTimeout(400);
  s = await job();
  console.log('owed:', JSON.stringify(s));
  check(s.group === 'todo' && s.status === 'Send the invoice' && s.next === 'invoice' && s.invoice.state === 'now' && !s.finished, 'treated today: Send the invoice is next, and Finalise waits');
  check(/Email the invoice to Jordan/.test(await nextText()), 'the Next step card emails the invoice to the client');
  await p.evaluate(() => { const f = document.querySelector('#jobOverlay .job-fold[data-step="invoice"]'); f.open = true; jobFoldToggled(f); f.scrollIntoView(); });
  await shot('invoice-owed');
  const panel = await p.evaluate(() => document.querySelector('#jobOverlay .job-fold[data-step="invoice"] .job-fold-body').innerText.replace(/\s+/g, ' '));
  check(/doesn't say how to pay you yet/.test(panel) && /Add your bank details/.test(panel), 'with no bank details the invoice says so, with a way to add them: ' + panel.slice(0, 120));

  // 4. Add your bank details: Your prices › Getting paid, then back to the job.
  await tap(p.getByRole('button', { name: 'Add your bank details' }), 'Add your bank details'); await p.waitForTimeout(900);
  check(await p.evaluate(() => document.getElementById('pricesPanel').classList.contains('menu-page-active') && !document.getElementById('pbBackToQuote').hidden && /job/.test(document.getElementById('pbBackToQuote').textContent)), 'Your prices opens with a way back to the job');
  await p.fill('#pbPayName', 'Example Pest Co Pty Ltd'); await p.fill('#pbPayBsb', '062000'); await p.fill('#pbPayAccount', '1234 5678'); await p.fill('#pbPayId', '0400 000 000');
  await p.selectOption('#pbInvoiceDays', '14'); await p.locator('#pbPayId').blur();
  await p.evaluate(() => onInvoicePayDetails());
  await shot('getting-paid');
  const pay = await p.evaluate(() => ({ p: invoicePayDetails(), days: invoiceDays(), bsb: document.getElementById('pbPayBsb').value }));
  check(pay.p.bsb === '062-000' && pay.bsb === '062-000' && pay.p.account === '1234 5678' && pay.days === 14, 'the bank details and 14 days are kept, the BSB tidied: ' + JSON.stringify(pay));
  await tap(p.locator('#pbBackToQuote'), 'Back to the job'); await p.waitForTimeout(900);
  check(await p.evaluate(() => document.getElementById('jobOverlay').classList.contains('open')), 'Back to the job goes back to This job');

  // 5. Email it: the PDF goes, the job waits on payment.
  await tap(p.locator('#jobOverlay .job-next .job-invoice-next'), 'Email the invoice'); await p.waitForTimeout(4000);
  const mail = emails[emails.length - 1] || {};
  console.log('email:', mail.subject, '->', mail.to, (mail.attachments || []).map(a => a.filename));
  check(emails.length === 1 && /Invoice INV-/.test(mail.subject || '') && /Invoice/.test(((mail.attachments || [])[0] || {}).filename || ''), 'the invoice is emailed as a PDF');
  check(/due by/.test(mail.text || '') && /How to pay is on the invoice/.test(mail.text || ''), 'the email says when it\'s due and where the bank details are');
  if (mail.attachments) {
    const pdf = Buffer.from(mail.attachments[0].content, 'base64'); fs.writeFileSync(`${OUT}/invoice.pdf`, pdf);
    const t = pdf.toString('latin1');
    const has = w => t.includes(`(${w})`) || t.includes(w);
    check(has('Tax Invoice') && has('062-000') && has('1234 5678') && has('Reference') && has('AMOUNT DUE'), 'the PDF is a tax invoice with the bank details and the reference');
  }
  s = await job();
  console.log('sent:', JSON.stringify(s));
  check(s.group === 'waiting' && /^Invoice due/.test(s.status) && s.next === 'invoice' && !s.finished, 'sent: the job waits on payment, and Finalise comes once it\'s paid');
  const inv = await p.evaluate(() => getSavedQuotes().sample_job.taxInvoice);
  check(inv && /^INV-/.test(inv.number) && inv.sentAt && inv.due > inv.date && inv.total > 0, 'the invoice is kept on the quote with its number, due date and total');
  check(await p.evaluate(() => quoteContentHash(getSavedQuotes().sample_job)) === hashBefore, 'the invoice doesn\'t make the quote read as changed');
  check(/Mark paid/.test(await nextText()), 'the Next step card now offers Mark paid');
  await shot('invoice-sent');
  // The Jobs list files it under Waiting, saying when it's due.
  await p.evaluate(() => { closeJobPage(); openDashboard(); setDashboardTab('waiting'); }); await p.waitForTimeout(700);
  check(/Invoice due/.test(await p.evaluate(() => document.getElementById('dashboardJobs').innerText)), 'the Jobs list shows the job waiting on its invoice');
  await shot('jobs-waiting');
  await p.evaluate(() => { closeDashboard(); openJobPage(); }); await p.waitForTimeout(700);

  // 6. Mark paid asks first, then the job is done.
  await tap(p.locator('#jobOverlay .job-next .job-invoice-next'), 'Mark paid'); await p.waitForTimeout(500);
  check(/Mark \$[\d,.]+ paid\?/.test(await p.evaluate(() => document.getElementById('askTitle').textContent)), 'Mark paid asks on SAYON\'s sheet');
  await p.click('#askYes'); await p.waitForTimeout(600);
  s = await job();
  check(s.group === 'done' && s.invoice.state === 'done' && /paid/.test(s.invoice.full) && s.finished, 'paid: the job is done');
  check(/Finalise the job/.test(await nextText()), 'paid: Finalise is the next step');
  await shot('invoice-paid');
  // Not paid after all puts it back.
  await p.evaluate(() => undoInvoiceSettled()); await p.waitForTimeout(300);
  check((await job()).group === 'waiting', 'Not paid after all puts the job back to waiting on payment');

  // 7. Invoiced in another app: settles it, sends nothing.
  await p.evaluate(() => { const q = getSavedQuotes().sample_job; delete q.taxInvoice; storeSentQuote(q); useJobQuote(q); renderJobPage(); }); await p.waitForTimeout(300);
  await tap(p.locator('#jobOverlay .job-next').getByRole('button', { name: 'Invoiced in another app' }), 'Invoiced in another app'); await p.waitForTimeout(500);
  s = await job();
  check(s.group === 'done' && s.invoice.state === 'done' && /another app/.test(s.invoice.full) && emails.length === 1, 'Invoiced in another app: done, nothing sent');

  check(!errs.length, 'no page errors: ' + errs.join(' | '));
  await b.close();
  if (fails.length) { console.log(`\n${fails.length} FAILED`); process.exit(1); }
  console.log('\nALL PASSED');
})();
