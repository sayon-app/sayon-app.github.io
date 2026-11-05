// The sample job: offered at the end of sign-up, on an empty Jobs list and in
// the menu; opens finished, at the business's own prices; every PDF says
// SAMPLE; it never goes to the account; its emails come to the business;
// it stays off the Due list and backups; it can be removed and brought back.
// node e2e.js <outDir>   (serve the repo on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/sample-job'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf', uid = 'u-new';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'owner@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
const emails = [], reportPosts = [], signRequests = [];
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
    if (u.includes('businesses?owner_id')) return r.fulfill({ json: [] });
    if (u.includes('/rest/v1/businesses') && m === 'POST') return r.fulfill({ json: [{ id: 'b-new', name: 'Example Pest Co', owner_id: uid, settings: {} }] });
    if (u.includes('/rest/v1/reports') && m !== 'GET') reportPosts.push(m + ' ' + u);
    if (u.includes('/rest/v1/reports') && m === 'GET' && u.includes('report_id=eq.sample')) reportPosts.push(m + ' ' + u);
    if (u.includes('sign_requests') && m === 'POST') signRequests.push(u);
    return r.fulfill({ json: [] });
  });
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); }, sess);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  const shot = async (name) => { await p.waitForTimeout(350); await p.screenshot({ path: `${OUT}/${String(++shotN).padStart(2, '0')}-${name}.png` }); };
  const tap = async (loc, what) => { try { await loc.scrollIntoViewIfNeeded({ timeout: 3000 }); await loc.tap({ timeout: 5000 }); return true; } catch (e) { check(false, 'tap ' + what + ': ' + e.message.split('\n')[0]); return false; } };
  const toB64 = `async blob => { const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768)); return btoa(s); }`;
  const pdf = async (body, name) => {
    const b64 = await p.evaluate(new Function(`return (async () => { const toB64 = ${toB64}; await ensureJsPDFLoaded(); ${body} })()`));
    const buf = Buffer.from(b64, 'base64'); fs.writeFileSync(`${OUT}/${name}.pdf`, buf); return buf.toString('latin1');
  };

  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);

  // 1. Sign-up ends with the offer.
  check(await p.evaluate(() => getComputedStyle(document.getElementById('onboardScreen')).display !== 'none'), 'a new account lands on business setup');
  await p.fill('#ob-companyName', 'Example Pest Co');
  await p.fill('#ob-licence', 'NSW 123456');
  await p.fill('#ob-phone', '0400 000 000');
  await tap(p.locator('#obBusinessSave'), 'Continue (business)');
  await p.fill('#obPriceList .pb-row[data-key="barrier_lm"] .pb-input', '32');
  await p.evaluate(() => obNext(1)); await p.waitForTimeout(300);
  await p.evaluate(() => obShowPanel(3)); await shot('ready-panel');
  await tap(p.getByRole('button', { name: /See a finished sample job first/i }), 'See a finished sample job first');
  await p.waitForTimeout(1800); await shot('sample-job-page');

  const page = await p.evaluate(() => ({ open: document.getElementById('jobOverlay').classList.contains('open'), text: document.getElementById('jobPageBody').innerText, id: currentReportId }));
  check(page.open && page.id === 'sample_job', 'the sample opens on its job page');
  check(/sample job/i.test(page.text) && /comes to you at owner@example\.com/.test(page.text), 'the job page says it is a sample and where its emails go');
  check(/Finalise the job/.test(page.text), 'every step is done, so the next step is Finalise the job');
  const st = await p.evaluate(() => { const j = currentJobSummary(); return { group: j.group, steps: j.steps.map(s => s.state), pct: calculateCompletion(), agreement: !!reportData.agreement, sent: !!reportData.sent, stale: (quoteAnswerState(currentJobQuote()) || {}).stale, issues: reportPrepItems() }; });
  console.log('state:', JSON.stringify(st));
  check(st.group === 'done' && st.steps.every(s => s === 'done') && st.pct === 100 && !st.issues.length && st.agreement && st.sent && st.stale === false, 'the sample is a finished job, report 100% filled in, answer not stale');
  const q = await p.evaluate(() => { const q = currentJobQuote(); return { barrier: q.items.find(i => i.key === 'barrier_lm'), total: quoteTotals(q).total, plan: sitePlanHasContent(q.treatment.plan), inspector: reportData.inspectorLicence, tech: q.treatment.technician }; });
  console.log('quote:', JSON.stringify(q));
  check(q.barrier && q.barrier.price === 32 && q.barrier.qty === 57, 'the quote uses the business\'s own prices');
  check(q.plan && q.inspector === 'NSW 123456' && q.tech === 'Alex Example', 'the treatment has a site plan, and the inspector is the account\'s own name and licence');

  // 2. Each document opens, and every PDF says SAMPLE.
  const report = await pdf(`const r = await buildReportPdf(); return toB64(r.blob);`, 'report');
  const agreement = await pdf(`const r = buildAgreementPdf(reportData.agreement); return toB64(r.blob);`, 'agreement');
  const quote = await pdf(`const { blob } = await buildQuotePDF(currentJobQuote()); return toB64(blob);`, 'quote');
  const cert = await pdf(`const { blob } = await buildTreatmentCertificatePDF(currentJobQuote()); return toB64(blob);`, 'certificate');
  [['report', report], ['agreement', agreement], ['quote', quote], ['certificate', cert]].forEach(([n, s]) => {
    const pages = (s.match(/\/Type \/Page\b/g) || []).length, stamps = (s.match(/\(SAMPLE\) Tj/g) || []).length;
    check(pages > 0 && stamps === pages, `${n} PDF: SAMPLE on all ${pages} pages (${stamps})`);
  });
  await tap(p.locator('#jobOverlay .dash-timeline-btn', { hasText: 'Quote' }), 'Quote step'); await p.waitForTimeout(1200); await shot('quote');
  await tap(p.locator('#quoteScreen .doc-chip', { hasText: 'Treatment' }), 'Treatment chip'); await p.waitForTimeout(1200); await shot('treatment');
  await p.evaluate(() => { if (document.getElementById('treatmentOverlay')?.classList.contains('open')) closeTreatmentRecord(); jobGo('job'); }); await p.waitForTimeout(800);

  // 3. Finalise: one PDF, and emailing it goes to the business.
  await tap(p.getByRole('button', { name: 'Email it to me' }), 'Email it to me'); await p.waitForTimeout(6000); await shot('after-email');
  console.log('emails:', emails.map(e => `${e.subject} -> ${e.to} [${(e.attachments || []).map(a => a.filename)}]`));
  check(emails.length === 1 && emails[0].to === 'owner@example.com' && /^Sample: /.test(emails[0].subject), 'the sample\'s email goes to the business, marked Sample');
  if (emails[0]) { const s = Buffer.from(emails[0].attachments[0].content, 'base64'); fs.writeFileSync(`${OUT}/job-file.pdf`, s); check((s.toString('latin1').match(/\(SAMPLE\) Tj/g) || []).length >= 1, 'the job file carries SAMPLE'); }
  // The send sheet names the business, not the client.
  await p.evaluate(() => { closeJobPage(); openSendReview(); }); await p.waitForTimeout(1500); await shot('send-review');
  const to = await p.evaluate(() => document.getElementById('sendReviewTo').innerText);
  check(/sample job/i.test(to) && /owner@example\.com/.test(to) && !/jordan@example\.com/.test(to), 'the send sheet sends the sample to the business: ' + to.replace(/\n/g, ' / '));
  await p.evaluate(() => closeSendReview && closeSendReview());

  // 4. Never in the account, the Due list, a backup or a new job's details.
  await p.waitForTimeout(1500);
  check(reportPosts.length === 0, 'nothing about the sample went to the account: ' + reportPosts.join(', '));
  check(signRequests.length === 0, 'no signing link was made');
  const elsewhere = await p.evaluate(() => ({ due: reinspectionsDue().some(d => (d.r || d.report || d).id === 'sample_job' || JSON.stringify(d).includes('sample_job')), last: lastInspectorDetails() }));
  check(!elsewhere.due, 'the sample is not on the Due list');
  await p.evaluate(() => { openDashboard(); }); await p.waitForTimeout(800); await shot('jobs-with-sample');
  check(/Sample/.test(await p.evaluate(() => document.getElementById('dashboardJobs').innerText)), 'the Jobs row is tagged Sample');

  // 5. Reload keeps it; remove it; the empty list and the menu bring it back.
  await p.reload(); await p.waitForTimeout(3000);
  check(await p.evaluate(() => getSavedReports().some(r => r.id === 'sample_job')), 'the sample survives a reload');
  await p.evaluate(() => { openSampleJob('test'); }); await p.waitForTimeout(800);
  await tap(p.getByRole('button', { name: 'Remove the sample' }), 'Remove the sample'); await p.waitForTimeout(1000); await shot('removed');
  const gone = await p.evaluate(() => ({ saved: getSavedReports().some(r => r.id === 'sample_job'), quote: !!getSavedQuotes().sample_job, text: document.getElementById('dashboardJobs').innerText }));
  check(!gone.saved && !gone.quote, 'Remove takes the sample and its quote off the phone');
  check(/See a sample job/.test(gone.text), 'an empty Jobs list offers the sample');
  await tap(p.getByRole('button', { name: 'See a sample job' }), 'See a sample job'); await p.waitForTimeout(1200);
  check(await p.evaluate(() => currentReportId === 'sample_job' && document.getElementById('jobOverlay').classList.contains('open')), 'the empty list brings the sample back');
  await p.evaluate(() => { openAccountMenu(); }); await p.waitForTimeout(600); await shot('menu');
  check(await p.locator('#sidebarPanel button', { hasText: 'Sample job' }).count() === 1, 'the menu has Sample job');

  // 6. A real job afterwards starts clean.
  await p.evaluate(() => { toggleDrawer(); newReport(); }); await p.waitForTimeout(600);
  const fresh = await p.evaluate(() => ({ id: currentReportId, addr: document.getElementById('jobAddress').value, insp: document.getElementById('jobInspector').value }));
  check(!fresh.id && !fresh.addr, 'a new job after the sample starts blank: ' + JSON.stringify(fresh));

  check(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
