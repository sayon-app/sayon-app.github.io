// The safety check before starting work on site: a quiet card on This job
// asks for it before the work (the inspection, the treatment, a new build's
// installation, a bait visit), its sheet has the eight questions, the
// hazards the SWMS doesn't cover with their control and a risk score from
// the 5 × 5 matrix, the permits, whether the job can be done safely, and
// the technician's signature. Once saved the card says when it was done,
// with its own PDF. It's kept with the job, not in the report (a check
// after the report went doesn't change it) and not in the client's job PDF.
// node e2e.js <outDir>  (serve the repo on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs'); const { execFileSync } = require('child_process');
const OUT = process.argv[2] || '/tmp/safety-check'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf', uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
let shotN = 0;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } }));
  await ctx.route(/supabase\.co/, r => {
    const u = r.request().url();
    if (u.includes('businesses?owner_id')) return r.fulfill({ json: [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] });
    return r.fulfill({ json: [] });
  });
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1:u-owner', '1'); localStorage.setItem('korva_onboarded_v1', '1'); }, sess);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  const shot = async (name, opts = {}) => { await p.waitForTimeout(250); await p.screenshot({ path: `${OUT}/${String(++shotN).padStart(2, '0')}-${name}.png`, ...opts }); };
  const tap = async (loc, what) => { try { await loc.scrollIntoViewIfNeeded({ timeout: 3000 }); await loc.tap({ timeout: 5000 }); return true; } catch (e) { check(false, 'tap ' + what + ': ' + e.message.split('\n')[0]); return false; } };
  const sign = async (canvasSel) => {
    const c = p.locator(canvasSel); await c.scrollIntoViewIfNeeded(); const bb = await c.boundingBox();
    await p.mouse.move(bb.x + 20, bb.y + bb.height / 2); await p.mouse.down();
    for (let i = 1; i <= 12; i++) await p.mouse.move(bb.x + 20 + i * (bb.width - 40) / 12, bb.y + bb.height / 2 + (i % 2 ? -15 : 15));
    await p.mouse.up();
  };
  const toast = () => p.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
  const card = () => p.evaluate(() => { const c = document.querySelector('#jobPageBody .job-safety'); return c ? c.innerText : ''; });

  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  // An inspection job, booked for today, its report not started.
  await p.evaluate(({ sc }) => {
    storeCompanyDetails(sc.company); openApp('inspect'); resetReportState();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    for (const [k, v] of Object.entries(sc.job)) set(k, v);
    set('jobInspectionDate', todayIsoDate()); updateJob(); saveJobInfo();
    saveCurrentReport(true); tabGo('job');
  }, { sc });
  await p.waitForTimeout(500);

  // 1. Before the inspection, This job asks for the safety check, quietly.
  const c1 = await card();
  check(/Safety check/.test(c1) && /Before you start the inspection/.test(c1), 'This job asks for the safety check before the inspection');
  check(await p.evaluate(() => { const b = document.querySelector('.job-safety-start'); const cs = getComputedStyle(b); return !!b && !/gradient/.test(cs.backgroundImage); }), 'its button is a quiet one (the Next step keeps the filled button)');
  await p.locator('#jobPageBody .job-safety').scrollIntoViewIfNeeded(); await shot('job-card-before');

  // 2. The sheet: eight questions, the site's hazards, permits, sign-off.
  await tap(p.locator('.job-safety-start'), 'Do the safety check'); await p.waitForTimeout(400);
  const sheet = await p.evaluate(() => ({ open: document.getElementById('safetyOverlay').classList.contains('open'), qs: document.querySelectorAll('#scQuestions .sc-question').length,
    forLine: document.getElementById('scFor').textContent, name: document.getElementById('scName').value, hazards: document.getElementById('scHazardWrap').hidden }));
  check(sheet.open && sheet.qs === 8, `the sheet opens with the eight questions (${sheet.qs})`);
  check(/inspection/.test(sheet.forLine) && sheet.name === 'Alex Example', 'it says what it\'s for, with the technician\'s name');
  check(sheet.hazards, 'the hazards wait for a yes');
  await shot('sheet-top');

  // Saving with questions unanswered says what's missing.
  await sign('#scSigCanvas'); await p.waitForTimeout(150);
  await tap(p.locator('#scSaveBtn'), 'Save (unanswered)'); await p.waitForTimeout(200);
  check(/Answer each question first/.test(await toast()), 'saving with questions unanswered asks for them');

  // A no to "the right PPE" warns.
  const answer = async (i, v) => tap(p.locator(`#scQuestions .sc-question:nth-child(${i + 1}) .qp-chip`, { hasText: v }), `question ${i + 1}: ${v}`);
  for (let i = 0; i < 5; i++) await answer(i, i === 4 ? 'No' : 'Yes');
  check(/Sort this out before you start/.test(await p.textContent('#scQuestions')), 'a no to the right PPE says to sort it out first');
  await answer(4, 'Yes');
  check(!/Sort this out/.test(await p.textContent('#scQuestions')), 'and goes once it\'s a yes');
  await answer(5, 'No'); await answer(6, 'Yes');
  // A hazard found opens the site's hazards, with one to fill in.
  check(await p.evaluate(() => !document.getElementById('scHazardWrap').hidden && document.querySelectorAll('#scHazards .sc-hazard').length === 1 && document.querySelector('#scExtra .qp-chip.on').textContent === 'Yes'),
    'a hazard found opens the hazards the SWMS doesn\'t cover, with one to fill in');
  await answer(7, 'No');

  await p.fill('#scHazards .sc-hazard:nth-child(1) input', 'Roof void');
  await tap(p.locator('#scPermits .qp-chip', { hasText: 'None needed' }), 'None needed');
  await tap(p.locator('#scSafe .qp-chip', { hasText: 'Yes' }), 'safe: Yes');
  await tap(p.locator('#scSaveBtn'), 'Save (no control)'); await p.waitForTimeout(200);
  check(/how each hazard is controlled/.test(await toast()), 'a hazard with no control asks for it');
  await p.fill('#scHazards .sc-hazard:nth-child(1) textarea', 'Crawl boards, head torch, a second person told before going up');
  await p.selectOption('#scHazards .sc-hazard:nth-child(1) select:nth-of-type(1)', 'C');
  await p.selectOption('#scHazards .sc-hazard:nth-child(1) select:nth-of-type(2)', '3');
  check(/Risk score 13 of 25/.test(await p.textContent('#scScore0')), 'possible by moderate scores 13 of 25');
  await tap(p.locator('#scHazardWrap > .quote-link-btn'), 'Add another hazard');
  await p.fill('#scHazards .sc-hazard:nth-child(2) input', 'Dogs or other animals');
  await p.fill('#scHazards .sc-hazard:nth-child(2) textarea', 'Owner to keep the dog inside');
  await p.selectOption('#scHazards .sc-hazard:nth-child(2) select:nth-of-type(1)', 'D');
  await p.selectOption('#scHazards .sc-hazard:nth-child(2) select:nth-of-type(2)', '2');
  check(/Risk score 6 of 25/.test(await p.textContent('#scScore1')), 'unlikely by minor scores 6 of 25');
  await p.locator('#scHazards').scrollIntoViewIfNeeded(); await shot('sheet-hazards');

  // 3. Saved: kept with the job, and the card says when.
  const before = await p.evaluate(() => reportFingerprint());
  await tap(p.locator('#scSaveBtn'), 'Save the safety check'); await p.waitForTimeout(500);
  const saved = await p.evaluate(() => { const r = getSavedReports().find(x => x.id === currentReportId); const c = (r.reportData.safetyChecks || [])[0] || {};
    return { n: (r.reportData.safetyChecks || []).length, for: c.for, hazards: (c.hazards || []).map(h => `${h.hazard}:${safetyRiskScore(h)}`).join(','), permits: c.permits, safe: c.safe, sig: /^data:image/.test(c.signature || ''), answers: Object.keys(c.answers || {}).length, closed: !document.getElementById('safetyOverlay').classList.contains('open') }; });
  check(saved.n === 1 && saved.closed, 'Save keeps the check with the job and closes the sheet');
  check(saved.for === 'inspection' && saved.answers === 8 && saved.permits === 'none' && saved.safe === 'yes' && saved.sig, 'with what it was for, the answers, permits, safe and the signature');
  check(saved.hazards === 'Roof void:13,Dogs or other animals:6', 'and the hazards with their scores: ' + saved.hazards);
  check(await p.evaluate(b => reportFingerprint() === b, before), 'the report itself hasn\'t changed (the check isn\'t part of it)');
  const c2 = await card();
  check(/Inspection, done today at/.test(c2) && /Alex Example/.test(c2) && /PDF/.test(c2), 'the card says it was done today, by whom, with its PDF');
  await p.locator('#jobPageBody .job-safety').scrollIntoViewIfNeeded(); await shot('job-card-done');

  // 4. Its PDF.
  const pdf = await p.evaluate(async () => {
    await ensureJsPDFLoaded(); const c = reportData.safetyChecks[0]; const { blob, fname } = buildSafetyCheckPDF(c);
    const buf = new Uint8Array(await blob.arrayBuffer()); let s = '';
    for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768));
    return { b64: btoa(s), fname };
  });
  fs.writeFileSync(`${OUT}/safety-check.pdf`, Buffer.from(pdf.b64, 'base64'));
  try { execFileSync('pdftoppm', ['-png', '-r', '70', `${OUT}/safety-check.pdf`, `${OUT}/safety-check`]); } catch (e) {}
  const text = execFileSync('pdftotext', ['-layout', `${OUT}/safety-check.pdf`, '-']).toString();
  check(/Safety Check/.test(text) && /WORK HEALTH AND SAFETY/.test(text) && /Inspection/.test(text), 'the PDF is the safety check, for the inspection');
  check(/Do you understand the task\?\s+Yes/.test(text) && /Is there any danger to people, pets or marine life\?\s+No/.test(text), 'with each question and its answer');
  check(/Roof void/.test(text) && /Crawl boards/.test(text) && /13 \(C3\)/.test(text) && /6 \(D2\)/.test(text), 'the hazards, their controls and scores');
  check(/Not needed/.test(text) && /Can the job be done safely\?\s+Yes/.test(text) && /trained in, and understand/.test(text), 'the permits, safe to start and the acknowledgement');
  check(/^Safety_Check_/.test(pdf.fname), 'named as a safety check: ' + pdf.fname);

  // 5. Not in the job PDF that goes to the client.
  check(await p.evaluate(() => !jobPdfParts().some(x => /safety/i.test(x.title + x.kind))), 'it isn\'t in the client\'s job PDF');

  // 6. Back closes the sheet; a not-safe answer is kept and says so.
  await p.evaluate(() => openSafetyCheck('inspection')); await p.waitForTimeout(300);
  await p.evaluate(() => navBack()); await p.waitForTimeout(200);
  check(await p.evaluate(() => !document.getElementById('safetyOverlay').classList.contains('open')), 'back closes the sheet');
  await p.evaluate(() => {
    openSafetyCheck('inspection');
    SAFETY_QUESTIONS.forEach(([k]) => setSafetyAnswer('q:' + k, SAFETY_WANT_YES.includes(k) ? 'yes' : 'no'));
    setSafetyAnswer('extraHazards', 'no'); setSafetyAnswer('permits', 'done'); setSafetyAnswer('safe', 'no');
  });
  check(await p.evaluate(() => !document.getElementById('scNotSafe').hidden), 'a no to doing it safely says don\'t start');
  await sign('#scSigCanvas'); await p.waitForTimeout(150);
  await tap(p.locator('#scSaveBtn'), 'Save (not safe)'); await p.waitForTimeout(400);
  check(/Not safe to start/.test(await card()) && await p.evaluate(() => reportData.safetyChecks.length === 2 && reportData.safetyChecks[1].hazards.length === 0), 'it\'s kept, and the card says not safe to start');

  // 7. A finished job has no card to do; a job waiting on the client neither.
  await p.evaluate(() => { reportData.safetyChecks = []; saveCurrentReport(true); reportData.sent = { at: Date.now() }; reportData.doneAt = Date.now(); saveCurrentReport(true); renderJobPage(); });
  await p.waitForTimeout(300);
  check(await card() === '', 'a job with no work on site to come and no checks has no card');

  // 8. A new construction job asks before the installation.
  await p.evaluate(() => {
    startNewJob(); setNewBuildJob(true);
    const set = (id, v) => { document.getElementById(id).value = v; };
    set('jobAddress', 'Lot 12, 8 Example Street'); set('jobSuburb', 'Exampleton'); set('jobClient', 'Example Homes'); updateJob(); saveJobInfo();
    saveCurrentReport(true); renderJobPage();
  });
  await p.waitForTimeout(300);
  check(/Before you start the installation/.test(await card()), 'a new construction job asks before the installation');

  check(!errs.length, 'no page errors: ' + errs.join(' | '));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
  process.exit(fails.length ? 1 : 0);
})();
