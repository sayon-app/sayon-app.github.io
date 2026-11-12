// Special purpose inspections (AS 3660.2): an inspection with a scope of
// its own, often after an earlier one. It's a type of job; Job details then
// asks what it's for and the first inspection's report or job no. The
// agreement (on Job details or its own sheet) and the report's Client &
// Inspection Details say what it's for, and the report is titled for it.
// Another type of job has none of it.
// node e2e.js <outDir>  (serve the repo on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs'); const { execFileSync } = require('child_process');
const OUT = process.argv[2] || '/tmp/special-purpose'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf', uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
const TYPE = 'Special Purpose — Termite Inspection';
let shotN = 0;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } }));
  await ctx.route(/supabase\.co/, r => r.fulfill({ json: r.request().url().includes('businesses?owner_id') ? [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] : [] }));
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1:u-owner', '1'); localStorage.setItem('korva_onboarded_v1', '1'); }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const dialogs = []; p.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
  const shot = async (name, opts = {}) => { await p.waitForTimeout(250); await p.screenshot({ path: `${OUT}/${String(++shotN).padStart(2, '0')}-${name}.png`, ...opts }); };
  const tap = async (loc, what) => { try { await loc.scrollIntoViewIfNeeded({ timeout: 3000 }); await loc.tap({ timeout: 5000 }); return true; } catch (e) { check(false, 'tap ' + what + ': ' + e.message.split('\n')[0]); return false; } };
  const reportPages = async (name) => {
    const b64 = await p.evaluate(async () => { const r = await buildReportPdf(); const blob = r.blob || r; const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768)); return btoa(s); });
    fs.writeFileSync(`${OUT}/${name}.pdf`, Buffer.from(b64, 'base64'));
    const pages = +((execFileSync('pdfinfo', [`${OUT}/${name}.pdf`]).toString().match(/Pages:\s+(\d+)/) || [])[1] || 0);
    try { execFileSync('pdftoppm', ['-png', '-r', '60', '-f', '1', '-l', '3', `${OUT}/${name}.pdf`, `${OUT}/${name}`]); } catch (e) {}
    return [...Array(pages)].map((_, i) => execFileSync('pdftotext', ['-layout', '-f', String(i + 1), '-l', String(i + 1), `${OUT}/${name}.pdf`, '-']).toString());
  };
  const flat = t => t.replace(/\s+/g, ' ');
  // The type of job is a card (SELECT CARDS): main words, then the rest.
  const typeCard = (main, sub) => p.locator('#cards-jobInspectionType label.choice-card', { hasText: main }).filter({ hasText: sub });

  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  await p.evaluate(async s => {
    storeCompanyDetails(s.company); openApp('inspect'); resetReportState();
    for (const [k, v] of Object.entries(s.job)) { const el = document.getElementById(k); if (el) el.value = v; }
    document.getElementById('jobClientEmail').value = 'sam@example.com'; saveJobInfo(); updateJob();
    await populateFields(s.fields); saveCurrentReport(true);
  }, sc);
  await p.waitForTimeout(800);

  // 1. It's a type of job, in Job details and on the agreement's sheet.
  const opts = await p.evaluate(() => ['jobInspectionType', 'agreementInspectionType'].map(id => [...document.getElementById(id).options].map(o => o.value)));
  check(opts[0].includes(TYPE) && opts[1].includes(TYPE), 'Special Purpose — Termite Inspection is a type of job, in Job details and on the agreement');
  await p.evaluate(() => jobGo('details')); await p.waitForTimeout(500);
  check(await p.evaluate(() => document.getElementById('jobPurposeWrap').hidden), 'another type of job doesn\'t ask what it\'s for');

  // 2. Choosing it asks what it's for, and sets AS 3660.2.
  await tap(typeCard('Special Purpose', 'Termite Inspection'), 'the Special Purpose card'); await p.waitForTimeout(400);
  const chosen = await p.evaluate(() => ({ shown: !document.getElementById('jobPurposeWrap').hidden, n: document.querySelectorAll('#jobPurposes input[type=checkbox]').length,
    standard: reportData.standard, title: reportKindTitle() }));
  check(chosen.shown && chosen.n === 9, 'choosing it shows What it\'s for, with its nine purposes: ' + chosen.n);
  check(chosen.standard === 'AS 3660.2-2017', 'and the report follows AS 3660.2-2017: ' + chosen.standard);
  check(chosen.title === 'Special Purpose Termite Inspection Report', 'the report is a Special Purpose Termite Inspection Report');
  await tap(p.locator('#jobPurposes label', { hasText: 'Follow up an earlier inspection' }), 'Follow up an earlier inspection');
  await tap(p.locator('#jobPurposes label', { hasText: 'Inspect areas not inspected before' }), 'Inspect areas not inspected before');
  await p.fill('#jobInitialRef', 'R-1001');
  await p.waitForTimeout(400);
  const kept = await p.evaluate(() => ({ purposes: reportData.jobPurposes, ref: reportData.jobInitialRef, text: specialPurposeText() }));
  check(JSON.stringify(kept.purposes) === '["Follow up an earlier inspection","Inspect areas not inspected before"]', 'the two ticked are kept on the job: ' + JSON.stringify(kept.purposes));
  check(kept.ref === 'R-1001', 'and the first inspection\'s no.: ' + kept.ref);
  check(kept.text === 'To follow up an earlier inspection and inspect areas not inspected before.', 'said as one sentence: ' + kept.text);
  await p.locator('#jobPurposeWrap').scrollIntoViewIfNeeded(); await shot('job-details');

  // 3. They come back with the job.
  const jobId = await p.evaluate(() => { saveCurrentReport(true); flushDraftSave(); return currentReportId; });
  await p.reload(); await p.waitForTimeout(3000);
  await p.evaluate(id => { loadReport(id, true); jobGo('details'); }, jobId);
  await p.waitForTimeout(800);
  const back = await p.evaluate(() => ({ type: document.getElementById('jobInspectionType').value, ticked: [...document.querySelectorAll('#jobPurposes input:checked')].map(i => i.value),
    ref: document.getElementById('jobInitialRef').value, shown: !document.getElementById('jobPurposeWrap').hidden }));
  check(back.type === TYPE && back.shown && back.ticked.length === 2 && back.ref === 'R-1001', 'opened again, the job is still special purpose with its two ticks and no.: ' + JSON.stringify(back));

  // 4. The agreement says what it's for, and the client signs to it.
  await p.evaluate(() => openAgreementSheet()); await p.waitForTimeout(500);
  const agr = await p.evaluate(() => ({ shown: !document.getElementById('agreementPurposeWrap').hidden,
    ticked: [...document.querySelectorAll('#agreementPurposes input:checked')].map(i => i.value), text: agreementFormValues().text }));
  check(agr.shown && agr.ticked.length === 2, 'the agreement\'s sheet shows what it\'s for, with the same two ticked');
  check(/will carry out a special purpose termite inspection of 7 Banksia Drive/.test(agr.text), 'clause 1 says a special purpose termite inspection');
  check(/9\. Special requests\nThe purpose of this inspection is to follow up an earlier inspection and inspect areas not inspected before\. It follows the inspection with report or job no\. R-1001\./.test(agr.text), 'and the special requests say what it\'s for and what it follows');
  // A third ticked on the sheet is the job's too.
  await tap(p.locator('#agreementPurposes label', { hasText: 'Assess how well a termite treatment worked' }), 'Assess how well a termite treatment worked');
  await p.fill('#agreementNotes', 'Check the back deck closely');
  await p.waitForTimeout(300);
  const agr2 = await p.evaluate(() => ({ purposes: reportData.jobPurposes, onJob: [...document.querySelectorAll('#jobPurposes input:checked')].map(i => i.value), text: agreementFormValues().text,
    preview: document.getElementById('agreementStepRead').innerText }));
  check(agr2.purposes.length === 3 && agr2.onJob.length === 3, 'a third ticked on the agreement is ticked on Job details too');
  check(/inspect areas not inspected before and assess how well a termite treatment worked\. It follows/.test(agr2.text) && /R-1001\.\nCheck the back deck closely/.test(agr2.text), 'the agreement reads all three, then the typed request');
  check(/assess how well a termite treatment worked/.test(agr2.preview), 'and the agreement on the sheet shows it');
  await p.locator('#agreementPurposeWrap').scrollIntoViewIfNeeded(); await shot('agreement-sheet');
  await p.evaluate(() => closeAgreementSheet()); await p.waitForTimeout(300);

  // 5. The report: titled for it, and its Client & Inspection Details say what it's for.
  const pages = await reportPages('report');
  check(/SPECIAL PURPOSE TERMITE/.test(pages[0]), 'the report\'s cover says SPECIAL PURPOSE TERMITE');
  const s1 = pages.find(t => /CLIENT & INSPECTION DETAILS/.test(t) && /PROPERTY INSPECTED/.test(t)) || '';
  // The label wraps beside the sentence, so each is looked for on its own.
  check(/PURPOSE OF THE/.test(s1) && /To follow up an earlier inspection, inspect areas not inspected before and assess how well a termite/.test(flat(s1)) && /treatment worked\./.test(s1), 'section 1 has Purpose of the Inspection, as one sentence');
  check(/FIRST INSPECTION/.test(s1) && /R-1001/.test(s1), 'and the First Inspection Reference');
  check(/AS 3660\.2/.test(s1), 'and AS 3660.2');

  // 6. Another type of job has none of it.
  await p.evaluate(() => jobGo('details')); await p.waitForTimeout(400);
  await tap(typeCard('Annual', 'Existing Building'), 'the Annual card'); await p.waitForTimeout(400);
  const other = await p.evaluate(() => ({ hidden: document.getElementById('jobPurposeWrap').hidden, text: specialPurposeText(), title: reportKindTitle(), clause: agreementInspectionType(), line: specialPurposeLine() }));
  check(other.hidden && !other.text && !other.line && other.clause !== 'special purpose termite' && other.title !== 'Special Purpose Termite Inspection Report', 'an annual inspection doesn\'t ask, and its agreement and report don\'t say it: ' + JSON.stringify(other));
  const opages = await reportPages('report-annual');
  check(!opages.some(t => /SPECIAL PURPOSE|PURPOSE OF THE|FIRST INSPECTION/.test(t)), 'its report has no purpose and no first inspection');

  check(!dialogs.length, 'the browser\'s grey box was never used: ' + dialogs.join(' | '));
  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
  process.exit(fails.length ? 1 : 0);
})();
