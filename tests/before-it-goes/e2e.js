// Nothing leaves with a hole in it:
//   1. Finish and the check before sending show one list of what the report
//      is still missing, and the percentage reads off the same list;
//   2. "Show me" goes to the blank answer, and the bar's Next walks the rest;
//   3. the check sheet's Send button stays at its foot and says who it goes to;
//   4. a business with no email is told replies won't reach it, and the
//      message stops saying "reply to this email";
//   5. the quote's Send to client opens the same check, and nothing goes
//      until its button is tapped;
//   6. the certificate card says what the certificate would go without.
// node e2e.js <outDir>   (serve the repo on :8765 first; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/before-it-goes'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf', uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const scenarios = require('../visual/scenarios.js');
const clean = scenarios.find(s => s.name === 'clean'), standard = scenarios.find(s => s.name === 'standard');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
const emails = [];

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => {
    const u = r.request().url(), body = r.request().postDataJSON ? (r.request().postDataJSON() || {}) : {};
    if (u.includes('/send-email')) { if (body.check) return r.fulfill({ json: { configured: true } }); emails.push(body); return r.fulfill({ json: { ok: true } }); }
    return r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } });
  });
  await ctx.route(/supabase\.co/, r => {
    const u = r.request().url();
    if (u.includes('businesses?owner_id')) return r.fulfill({ json: [{ id: 'b1', name: clean.company.name, owner_id: uid, settings: {} }] });
    if (u.includes('/rest/v1/sign_requests') && r.request().method() === 'POST') return r.fulfill({ json: [{ id: '00000001-1111-4222-8333-444444444444' }] });
    return r.fulfill({ json: [] });
  });
  await ctx.addInitScript(s => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1', '1'); localStorage.setItem('korva_onboarded_v1:' + s.user.id, '1'); }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  const lines = sel => p.evaluate(s => [...document.querySelectorAll(s + ' li')].map(li => li.querySelector('.send-review-gap-text').textContent), sel);

  // ── 1. One list ──
  // Every area inspected with nothing found, the agreement signed, and
  // Property, Conducive and Advice left untouched.
  await p.evaluate(async sc => {
    storeCompanyDetails(sc.company); openApp('inspect'); resetReportState(); startBlankReport();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    for (const [k, v] of Object.entries(sc.job)) set(k, v);
    set('jobClientEmail', 'jo@example.com'); saveJobInfo(); updateJob();
    const v = agreementFormValues();
    reportData.agreement = { method: 'onsite', signerName: 'Jo Lee', signature: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', signedAt: Date.now() - 3600e3, inspectionDate: v.inspectionDate, fee: '350', notes: '', standard: v.standard, text: v.text };
    reportData.inspectorLicence = sc.company.licence;
    markRemainingAreasInspected('INSPECTED'); markRemainingAreasClear(); saveCurrentReport(true);
    directEmail = true;
    jobGo('report'); goStep('finish');
  }, clean);
  await p.waitForTimeout(900);
  const finish = await lines('#finishGaps');
  const state1 = await p.evaluate(() => ({ sub: document.getElementById('reportDoneSub').textContent, pct: document.getElementById('progressRingText').textContent, progress: (({ open, blank, checks, total, pct }) => ({ open, blank, checks, total, pct }))(reportProgress()),
    required: Object.values(REQUIRED_FIELDS).flat().filter(k => !isFieldFilled(k)) }));
  check(finish.some(l => /^Property: 8 answers are blank/.test(l)) && finish.some(l => /^Conducive: 5 answers are blank/.test(l)), 'Finish lists the steps left blank: ' + JSON.stringify(finish));
  check(finish.some(l => /^Advice: risk of termite attack, treatment recommended and re-inspection interval aren't answered$/.test(l)), 'risk, treatment and the next inspection are named when blank');
  check(finish.some(l => /hasn't signed/.test(l)), 'the missing signature is on the same list');
  check(state1.progress.blank === state1.required.length && /^17 still blank\. You can tick it off anyway\.$/.test(state1.sub), `the count on Report done is the list's own (${state1.sub}; required blank: ${state1.required.length})`);
  check(state1.pct === state1.progress.pct + '%' && state1.progress.pct === Math.round((state1.progress.total - state1.progress.open) / state1.progress.total * 100), 'the percentage reads off the same list: ' + state1.pct);
  await p.evaluate(() => document.getElementById('finishNext').scrollIntoView({ block: 'start' }));
  await p.screenshot({ path: `${OUT}/1-finish-list.png` });
  await p.evaluate(() => openSendReview()); await p.waitForTimeout(1200);
  const sheet = await lines('#sendReviewGaps');
  check(finish.every(l => sheet.includes(l)) && sheet.filter(l => !finish.includes(l)).every(l => /^Your /.test(l)), 'the check sheet shows the same list, plus only the business\'s own details: ' + JSON.stringify(sheet.filter(l => !finish.includes(l))));

  // ── 3. The Send button ──
  const foot = await p.evaluate(() => { const btn = document.getElementById('sendReviewBtn'); const body = document.querySelector('#sendReviewOverlay .page-sheet-body'); const r = btn.getBoundingClientRect();
    return { label: btn.textContent, inBody: body.contains(btn), onScreen: r.top > 0 && r.bottom <= innerHeight, scrolls: body.scrollHeight > body.clientHeight + 50, open: document.getElementById('sendReviewOpen').textContent, hidden: document.getElementById('sendReviewOpen').hidden }; });
  check(foot.label === 'Send to jo@example.com' && !foot.inBody && foot.onScreen && foot.scrolls, 'Send sits at the foot of the sheet, on screen without scrolling, and says who it goes to: ' + foot.label);
  check(!foot.hidden && /things at the top are still open/.test(foot.open), 'with gaps it says how many are still open, not "Send anyway": ' + foot.open);
  await p.screenshot({ path: `${OUT}/2-check-sheet.png` });

  // ── 4. No business email ──
  const before = await p.evaluate(() => ({ body: document.getElementById('sendReviewBody').value, gaps: document.getElementById('sendReviewGaps').innerText }));
  check(/just reply to this email or call us on/.test(before.body) && !/business email is missing/.test(before.gaps), 'with a business email the message offers a reply or a call');
  await p.evaluate(() => { const c = getCompanyDetails(); c.email = ''; storeCompanyDetails(c); openSendReview(); }); await p.waitForTimeout(800);
  const after = await p.evaluate(() => ({ body: document.getElementById('sendReviewBody').value, gaps: document.getElementById('sendReviewGaps').innerText }));
  check(/Your business email is missing/.test(after.gaps) && /reply to this email wouldn't reach you/.test(after.gaps), 'a business with no email is told a reply wouldn\'t reach it');
  check(!/reply to this email/.test(after.body) && /If you have any questions, call us on /.test(after.body), 'and the message gives the phone number only: ' + (after.body.match(/If you have[^\n]*/) || [''])[0]);
  await p.evaluate(sc => { storeCompanyDetails(sc.company); closeSendReview(); }, clean);

  // ── 2. Show me, and the walk ──
  await p.locator('#finishGaps .link-btn', { hasText: 'Show me' }).first().click(); await p.waitForTimeout(900);
  const shown = await p.evaluate(() => ({ step: currentStep, focus: document.activeElement && (document.activeElement.id || document.activeElement.className), bar: !document.getElementById('blankWalk').hidden, text: document.getElementById('blankWalkText').textContent, next: document.getElementById('blankWalkNext').textContent }));
  check(shown.step === 'property' && /structureType/.test(shown.focus) && shown.bar, 'Show me goes to the first blank answer on its step: ' + shown.focus);
  check(shown.text === '17 still blank' && shown.next === 'Next', 'a bar under the report says how many are left, with Next: ' + shown.text);
  await p.screenshot({ path: `${OUT}/3-show-me.png` });
  await p.click('#blankWalkNext'); await p.waitForTimeout(700);
  const second = await p.evaluate(() => document.activeElement && document.activeElement.id);
  check(/constructionEra/.test(second), 'Next goes on to the next blank answer: ' + second);
  // Answer one: the count drops everywhere.
  await p.evaluate(() => { reportData.structureType = 'Single dwelling'; renderField(document.getElementById('f-structureType'), 'structureType', reportData.structureType); updateProgress(); }); await p.waitForTimeout(300);
  check(await p.evaluate(() => document.getElementById('blankWalkText').textContent) === '16 still blank', 'answering one drops the count on the bar');
  // Its cross puts it away; opening Finish does too.
  await p.click('.blank-walk-close'); await p.waitForTimeout(200);
  check(await p.evaluate(() => document.getElementById('blankWalk').hidden), 'the cross puts the bar away');
  await p.evaluate(() => { goStep('finish'); }); await p.waitForTimeout(300);
  await p.locator('#finishGaps .link-btn', { hasText: 'Show me' }).last().click(); await p.waitForTimeout(700);
  check(await p.evaluate(() => currentStep === 'recommendations' && !document.getElementById('blankWalk').hidden), 'Show me on the Advice line goes to Advice');
  const walked = [];
  for (let i = 0; i < 6; i++) { if (await p.evaluate(() => document.getElementById('blankWalk').hidden)) break; await p.click('#blankWalkNext'); await p.waitForTimeout(500); walked.push(await p.evaluate(() => currentStep)); }
  check(walked.every(s => s === 'recommendations' || s === 'finish') && await p.evaluate(() => currentStep === 'finish' && document.getElementById('blankWalk').hidden), 'Next only goes on down the report, and past the last one it lands on Finish and the bar goes: ' + walked.join(', '));
  // Everything answered: 100%, no list, the plain line on Report done.
  await p.evaluate(async sc => {
    await populateFields(sc.fields);
    Object.values(REQUIRED_FIELDS).flat().filter(k => !isFieldFilled(k) && document.getElementById('f-' + k)).forEach(k => { reportData[k] = 'NO'; });
    reportData.inspectorSignature = reportData.agreement.signature; reportData.inspectorLicence = sc.company.licence;
    markRemainingAreasInspected('INSPECTED'); markRemainingAreasClear(); updateProgress();
  }, clean);
  await p.waitForTimeout(600);
  const full = await p.evaluate(() => ({ left: reportPrepGaps('finish').map(g => g.text), pct: reportProgress().pct, hidden: document.getElementById('finishGaps').hidden, sub: document.getElementById('reportDoneSub').textContent }));
  check(full.left.length === 0 && full.pct === 100 && full.hidden && /^Ticks it off/.test(full.sub), 'with nothing left the list goes and the report reads 100%: ' + JSON.stringify(full.left));
  // A second look still open holds it under 100%.
  await p.evaluate(() => { reportData.inspectionFrequency = '24 months'; updateProgress(); }); await p.waitForTimeout(200);
  const look = await p.evaluate(() => ({ pct: reportProgress().pct, sub: document.getElementById('reportDoneSub').textContent, list: document.getElementById('finishGaps').innerText }));
  check(look.pct < 100 && /^1 to check\./.test(look.sub) && /Make it 12 months/.test(look.list), 'something worth a second look holds it under 100% with its own fix: ' + look.sub);
  await p.evaluate(() => goStep('finish'));
  await p.locator('#finishGaps .link-btn', { hasText: 'Make it 12 months' }).click(); await p.waitForTimeout(400);
  check(await p.evaluate(() => reportProgress().pct === 100 && document.getElementById('finishGaps').hidden), 'the fix on Finish works there and then');

  // ── 5. The quote's own check ──
  await p.evaluate(async sc => {
    resetReportState(); startBlankReport();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    for (const [k, v] of Object.entries(sc.job)) set(k, v);
    set('jobClientEmail', 'sam@example.com'); saveJobInfo(); updateJob();
    await populateFields(sc.fields); saveCurrentReport(true);
    openQuoteFromReport();
  }, standard);
  await p.waitForTimeout(1500);
  const startingBefore = await p.evaluate(() => quoteState.items.filter(isStartingPrice).length);
  await p.click('#quoteEmailBtn'); await p.waitForTimeout(1500);
  const qsheet = await p.evaluate(() => ({ open: document.getElementById('sendReviewOverlay').classList.contains('open'), visible: document.getElementById('sendReviewBtn').getBoundingClientRect().height > 0, label: document.getElementById('sendReviewBtn').textContent,
    to: document.getElementById('sendReviewTo').innerText, files: document.getElementById('sendReviewFiles').innerText, summaryHidden: document.getElementById('sendReviewSummary').hidden, sentAt: quoteState.sentAt || null, starting: quoteState.items.filter(isStartingPrice).length }));
  const qgaps = await lines('#sendReviewGaps');
  check(qsheet.open && qsheet.visible && !qsheet.sentAt && emails.length === 0, 'Send to client on the quote opens the check, and nothing has gone yet');
  check(qsheet.label === 'Send to sam@example.com' && /sam@example\.com/.test(qsheet.to) && /Treatment quote/.test(qsheet.files) && qsheet.summaryHidden, 'it says who it goes to and what is attached: ' + qsheet.label);
  check(startingBefore > 0 && qsheet.starting === startingBefore && qgaps.some(l => /still SAYON's starting price/.test(l)), 'starting prices are called out before it goes: ' + JSON.stringify(qgaps));
  await p.screenshot({ path: `${OUT}/4-quote-check.png` });
  await p.locator('#sendReviewGaps .link-btn', { hasText: /Check (it|them)/ }).click(); await p.waitForTimeout(700);
  check(await p.evaluate(() => !document.getElementById('sendReviewOverlay').classList.contains('open') && document.getElementById('quoteWorkFold').open && document.getElementById('quoteScreen').classList.contains('open')), 'its fix button closes the sheet and opens that part of the quote');
  await p.click('#quoteEmailBtn'); await p.waitForTimeout(1500);
  await p.waitForFunction(() => sendReview && !sendReview.linkPending, null, { timeout: 60000 });
  const withLink = await p.evaluate(() => ({ body: document.getElementById('sendReviewBody').value, files: document.getElementById('sendReviewFiles').innerText }));
  check(/accept or decline it on your phone here:\n\S*sign\.html/.test(withLink.body) && /Link to accept the quote/.test(withLink.files), 'the link to accept is in the message before it goes');
  await p.click('#sendReviewBtn');
  await p.waitForFunction(() => quoteState && quoteState.sentAt, null, { timeout: 60000 }); await p.waitForTimeout(500);
  const sentQ = await p.evaluate(() => ({ open: document.getElementById('sendReviewOverlay').classList.contains('open'), starting: quoteState.items.filter(isStartingPrice).length }));
  check(emails.length === 1 && emails[0].to === 'sam@example.com' && /sign\.html/.test(emails[0].text) && !sentQ.open, 'the button sends it, with the link, and the sheet closes');
  check(sentQ.starting === 0, 'prices that went to a client are the business\'s own from then on');
  check(await p.evaluate(() => navPlace() === 'job' && !document.getElementById('quoteScreen').classList.contains('open')), 'once the quote has gone, the app is back on This job, where the next step is');

  // ── 6. The certificate card ──
  await p.evaluate(() => {
    quoteState.answer = { status: 'accepted', by: 'Sam Taylor', date: todayIsoDate(), method: 'verbal', note: '', at: Date.now(), hash: quoteContentHash(quoteState) };
    quoteState.treatment = { date: todayIsoDate(), technician: 'Alex Example', licence: 'NSW 000000', methods: { barrier: '' }, products: [], areas: 'Whole perimeter', notice: 'none', noticeWhere: '', nextInspection: '', signature: 'x', at: Date.now() };
    persistQuote(); renderQuoteProgress();
    document.querySelector('#jobOverlay .job-fold[data-step="treatment"]').open = true;
  });
  await p.waitForTimeout(500);
  const cert = await p.evaluate(() => { const el = document.querySelector('#jobOverlay .job-fold[data-step="treatment"] .qp-cert-gaps'); return el ? el.innerText.replace(/\s+/g, ' ') : ''; });
  check(/The certificates? (doesn't|don't) say the product used and the next inspection date yet\. Add them/.test(cert), 'the certificate card says what the certificate would go without: ' + cert);
  await p.evaluate(() => document.querySelector('#jobOverlay .job-fold[data-step="treatment"] .qp-cert').scrollIntoView({ block: 'center' })); await p.screenshot({ path: `${OUT}/5-certificate-gaps.png` });
  await p.evaluate(() => { quoteState.treatment.products = [{ name: 'Termidor HE' }]; quoteState.treatment.nextInspection = '2027-11-10'; persistQuote(); renderQuoteProgress(); }); await p.waitForTimeout(300);
  check(await p.evaluate(() => !document.querySelector('.qp-cert-gaps')), 'and nothing once the record is whole');

  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
  process.exit(fails.length ? 1 : 0);
})();
