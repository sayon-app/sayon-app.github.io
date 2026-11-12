// New construction jobs: a termite management system put in while the
// building goes up (AS 3660.1). The job is chosen from a new job's page (or
// as the type of job), has no agreement, report or quote, and runs Job
// details, then the treatment, then its treatment certificate. The record
// asks about the building and slab, how a physical system went in, the
// limits and the care lines, and the certificate prints them under
// AS 3660.1. Another job's record is unchanged.
// node e2e.js <outDir>  (serve the repo on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs'); const { execFileSync } = require('child_process');
const OUT = process.argv[2] || '/tmp/new-build'; fs.mkdirSync(OUT, { recursive: true });
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
    if (u.includes('/storage/v1/object/') && r.request().method() === 'POST') return r.fulfill({ json: { Key: 'ok' } });
    if (u.includes('businesses?owner_id')) return r.fulfill({ json: [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] });
    return r.fulfill({ json: [] });
  });
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1:u-owner', '1'); localStorage.setItem('korva_onboarded_v1', '1'); }, sess);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  const shot = async (name, opts = {}) => { await p.waitForTimeout(250); await p.screenshot({ path: `${OUT}/${String(++shotN).padStart(2, '0')}-${name}.png`, ...opts }); };
  const tap = async (loc, what) => { try { await loc.scrollIntoViewIfNeeded({ timeout: 3000 }); await loc.tap({ timeout: 5000 }); return true; } catch (e) { check(false, 'tap ' + what + ': ' + e.message.split('\n')[0]); return false; } };
  const chip = (box, label) => p.locator(`#${box} .qp-chip`, { hasText: new RegExp('^' + label + '$') });
  const sign = async (canvasSel) => {
    const c = p.locator(canvasSel); await c.scrollIntoViewIfNeeded(); const bb = await c.boundingBox();
    await p.mouse.move(bb.x + 20, bb.y + bb.height / 2); await p.mouse.down();
    for (let i = 1; i <= 12; i++) await p.mouse.move(bb.x + 20 + i * (bb.width - 40) / 12, bb.y + bb.height / 2 + (i % 2 ? -15 : 15));
    await p.mouse.up();
  };
  const pdfText = (b64, name) => {
    fs.writeFileSync(`${OUT}/${name}.pdf`, Buffer.from(b64, 'base64'));
    try { execFileSync('pdftoppm', ['-png', '-r', '70', `${OUT}/${name}.pdf`, `${OUT}/${name}`]); } catch (e) {}
    try { return execFileSync('pdftotext', ['-layout', `${OUT}/${name}.pdf`, '-']).toString(); } catch (e) { return ''; }
  };
  const certificate = () => p.evaluate(async () => {
    await ensureJsPDFLoaded(); await loadTreatmentPhotos(quoteState, true);
    const { blob } = buildTreatmentCertificatePDF(quoteState);
    const buf = new Uint8Array(await blob.arrayBuffer()); let s = '';
    for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768));
    return btoa(s);
  });
  const pageText = () => p.evaluate(() => document.getElementById('jobPageBody').innerText);

  // A photo of the slab's certification, to take.
  await p.setContent('<body style="margin:0;background:#fff3e0"><div style="font:bold 60px sans-serif;padding:120px 40px">Slab certificate</div></body>');
  const pic = `${OUT}/slab-cert.jpg`; await p.screenshot({ path: pic, type: 'jpeg', quality: 80 });

  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  await p.evaluate(({ sc }) => { storeCompanyDetails(sc.company); startNewJob(); }, { sc });
  await p.waitForTimeout(600);

  // 1. A new job offers to be a new construction job, at the top of its page.
  const offer = p.locator('#jobPageBody .job-hero-kind button');
  check(/Make it a new construction job/.test(await offer.textContent()), 'a new job offers: Make it a new construction job');
  check(/Get the agreement signed/.test(await pageText()), 'an inspection job still starts with the agreement');
  await shot('new-job-offer');
  await tap(offer, 'Make it a new construction job'); await p.waitForTimeout(400);
  const nb = await p.evaluate(() => ({ type: document.getElementById('jobInspectionType').value, isNb: isNewBuildJob(), text: document.getElementById('jobPageBody').innerText,
    placeholder: document.getElementById('jobClient').placeholder }));
  check(nb.type === 'New Construction — Termite Management System' && nb.isNb, 'the type of job is now New Construction — Termite Management System');
  check(/New construction job/.test(nb.text) && /Record the treatment/.test(nb.text) && !/Get the agreement signed/.test(nb.text), 'the page says New construction job, and its next step is Record the treatment');
  check(!/Agreement|Report|Quote|Client's answer/.test(nb.text.split('Job steps')[1] || ''), 'its steps have no agreement, report, quote or answer');
  check(nb.placeholder === 'The builder, or the owner', 'the client box asks for the builder');
  check(/Make it an inspection/.test(nb.text), 'and it can go back to an inspection');
  await shot('new-build-job');

  // 2. Recording it needs the address first.
  await tap(p.locator('#jobPageBody .job-next-new .dash-detail-primary'), 'Record treatment (no address)');
  await p.waitForTimeout(300);
  check(await p.evaluate(() => !document.getElementById('treatmentOverlay').classList.contains('open')), 'with no address the record doesn\'t open (the address is asked for)');

  await p.evaluate(() => {
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('jobAddress', 'Lot 12, 8 Example Street'); set('jobSuburb', 'Exampleton'); set('jobPostcode', '2000');
    document.getElementById('jobState').value = 'NSW'; set('jobClient', 'Example Homes'); set('jobClientEmail', 'site@example.com');
    updateJob(); saveJobInfo();
  });
  await p.waitForTimeout(300);

  // 3. The record: the systems lead, and the new construction parts show.
  await p.evaluate(() => jobGo('treatment')); await p.waitForTimeout(500);
  const sheet = await p.evaluate(() => ({
    open: document.getElementById('treatmentOverlay').classList.contains('open'),
    nb: document.getElementById('treatmentOverlay').classList.contains('new-build'),
    saved: !!currentReportId && getSavedReports().some(r => r.id === currentReportId),
    lead: [...document.querySelectorAll('#trMethods > .treat-method input[type=checkbox]')].map(i => i.dataset.key).join(','),
    more: [...document.querySelectorAll('#trMethodsMore input[type=checkbox]')].map(i => i.dataset.key).join(','),
    fold: !document.getElementById('trFold5').hidden, site: document.getElementById('trSiteMore').hidden,
    limits: !document.getElementById('trLimitsWrap').hidden, care: !document.getElementById('trCareWrap').hidden, chips: !document.getElementById('trAreaChips').hidden,
    physical: document.getElementById('trPhysicalWrap').hidden, slab: document.getElementById('trBuildSlabWrap').hidden,
  }));
  check(sheet.open && sheet.nb && sheet.saved, 'Record treatment opens the record (the job saved first)');
  check(sheet.lead === 'physical,barrier,retic,bait' && /direct/.test(sheet.more), `the systems lead, the rest wait under Something else (${sheet.lead})`);
  check(sheet.fold && sheet.site && sheet.limits && sheet.care && sheet.chips, 'the building and slab, limits, care lines and the places show; About the site doesn\'t');
  check(sheet.physical && sheet.slab, 'how a physical system went in, and the slab\'s details, wait for their answers');

  // A physical system: how it went in.
  await p.evaluate(() => { document.getElementById('trFold2').open = true; });
  await tap(p.locator('#trMethods input[data-key="physical"]'), 'tick physical barrier');
  await p.fill('#trMethods [data-qty="physical"]', '64');
  check(await p.evaluate(() => !document.getElementById('trPhysicalWrap').hidden), 'ticking the physical barrier asks how it went in');
  await tap(chip('trPhysicalHow', 'Perimeter'), 'Perimeter'); await tap(chip('trPhysicalHow', 'Slab penetrations'), 'Slab penetrations');
  await p.fill('#trProducts [data-f="name"]', 'Kordon');
  await p.locator('#trProducts [data-f="name"]').dispatchEvent('input');

  // The building and slab.
  await p.evaluate(() => { document.getElementById('trFold5').open = true; });
  check(/Add the building class/.test(await p.textContent('#trSub5')), 'the fold says what\'s missing: the building class');
  await p.selectOption('#trBuildClass', 'Class 1');
  await p.fill('#trBuildStructure', 'House, single dwelling');
  await tap(chip('trBuildSlab', 'Yes'), 'part of the slab: Yes');
  check(await p.evaluate(() => !document.getElementById('trBuildSlabWrap').hidden), 'a yes to the slab asks about it');
  await tap(chip('trBuildSlabTypes', 'Raft'), 'Raft'); await tap(chip('trBuildInclusions', 'Water pipes'), 'Water pipes');
  await p.fill('#trBuildCollars', '12'); await p.fill('#trBuildSoftCollars', '4'); await p.fill('#trBuildWraps', '2');
  check(/18 in all/.test(await p.textContent('#trBuildPenTotal')), 'the penetrations add up: 18 in all');
  await p.fill('#trBuildJointLm', '22.5'); await p.fill('#trBuildJointLitres', '3');
  await p.fill('#trBuildDiscontinuities', 'Cut-out at the shower waste sealed');
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), tap(p.locator('#trSlabPhotos .spot-photo-add'), 'Add photo (slab certification)')]);
  await fc.setFiles(pic); await p.waitForTimeout(700);
  check(await p.evaluate(() => document.querySelectorAll('#trSlabPhotos .spot-photo').length) === 1, 'the slab\'s certification photo is on the record');
  await tap(chip('trBuildSuspended', 'No'), 'suspended floor: No');
  check(await p.evaluate(() => !document.getElementById('trSub5').textContent.trim() || document.getElementById('trFold5').classList.contains('done') || !/Add|Say/.test(document.getElementById('trSub5').textContent)), 'with its answers the fold has nothing missing');
  await p.locator('#trFold5').scrollIntoViewIfNeeded(); await shot('record-building-slab');

  // Said instead: the building's details fill in too.
  const said = await p.evaluate(() => {
    const prompt = treatmentVoicePrompt();
    const n = applyTreatmentVoice({ build: { slabTypes: ['Waffle pod'], structure: 'House, single dwelling' } });
    return { prompt: /new construction job/.test(prompt) && /buildingClass/.test(prompt), n, on: newBuildChipValues('trBuildSlabTypes').join(',') };
  });
  check(said.prompt, 'Say it instead asks for the building and slab on a new construction job');
  check(said.n === 1 && said.on === 'Raft,Waffle pod', `and fills them in (${said.on})`);
  // (Filling folds the parts with nothing missing.)
  await p.evaluate(() => { document.getElementById('trFold5').open = true; });
  await tap(chip('trBuildSlabTypes', 'Waffle pod'), 'untick Waffle pod');

  // Where it went: the places as chips.
  await p.evaluate(() => { document.getElementById('trFold3').open = true; });
  await tap(chip('trAreaChips', 'Perimeter of the building'), 'place: perimeter');
  await tap(chip('trAreaChips', 'Slab penetrations'), 'place: penetrations');
  await tap(chip('trAreaChips', 'Construction joints'), 'place: joints');
  check(await p.inputValue('#trAreas') === 'Perimeter of the building; slab penetrations; construction joints', 'the places go into Treated: ' + await p.inputValue('#trAreas'));
  await tap(chip('trAreaChips', 'Construction joints'), 'place: joints off');
  check(await p.inputValue('#trAreas') === 'Perimeter of the building; slab penetrations', 'a second tap takes one out');
  await p.fill('#trLimits', 'Two collars under the bath for the plumber to finish');

  // Handover: how often, as the maker directs, moves the next inspection.
  await p.evaluate(() => { document.getElementById('trFold4').open = true; });
  const before = await p.inputValue('#trNext');
  await p.selectOption('#trInspectEvery', '6');
  const after = await p.inputValue('#trNext');
  const want = await p.evaluate(() => addMonthsIso(document.getElementById('trDate').value, 6));
  check(before !== after && after === want, `every 6 months moves the next inspection (${before} → ${after})`);
  await p.check('#trCareChemical');
  await p.locator('#trCareWrap').scrollIntoViewIfNeeded(); await shot('record-handover');

  // 4. Sign and save.
  await p.evaluate(() => { document.getElementById('trFold1').open = true; });
  await p.fill('#trTech', 'Alex Example'); await p.fill('#trLicence', 'LIC-0000');
  await sign('#trSigCanvas'); await p.waitForTimeout(200);
  await tap(p.locator('#trSaveBtn'), 'Save treatment record'); await p.waitForTimeout(600);
  const rec = await p.evaluate(() => {
    const q = getSavedQuotes()[currentReportId];
    const onJob = getSavedReports().find(r => r.id === currentReportId).quote;
    return { nb: q.newBuild, items: q.items.length, client: q.client, email: q.clientEmail, build: q.treatment.build, photos: q.treatment.photos.map(x => x.kind).join(','), onJob: !!(onJob && onJob.treatment && onJob.treatment.build) };
  });
  check(rec.nb && rec.items === 0 && rec.onJob, 'the record is kept on a quote made for the job (no lines), on the job too');
  check(rec.client === 'Example Homes' && rec.email === 'site@example.com', 'it goes to the client from Job details');
  const bd = rec.build || {};
  check(bd.buildingClass === 'Class 1' && bd.structure === 'House, single dwelling' && bd.slab === 'yes' && bd.slabTypes.join() === 'Raft' && bd.inclusions.join() === 'Water pipes', 'the building and slab are kept');
  check(bd.collars === '12' && bd.softCollars === '4' && bd.wraps === '2' && bd.jointLm === '22.5' && bd.jointLitres === '3' && bd.suspended === 'no', 'with the penetrations, joints and suspended floor');
  check(bd.physicalHow.join() === 'Perimeter,Slab penetrations' && bd.inspectEvery === '6' && bd.care.join() === 'chemical,disturbed' && /plumber/.test(bd.limits), 'how it went in, how often, the care lines and the limits');
  check(rec.photos === 'slab', 'and the slab\'s certification photo');

  // 5. The job's next step is the certificate.
  await p.waitForTimeout(300);
  const t1 = await pageText();
  check(/Email the certificate/.test(t1) && /Certificate not emailed yet/.test(t1), 'This job: Email the certificate is next');
  const listed = await p.evaluate(() => { const j = dashboardJob(getSavedReports().find(r => r.id === currentReportId), getSavedQuotes()); return { group: j.group, status: j.status, steps: jobPageSteps(j).map(s => s.label).join(',') }; });
  check(listed.group === 'todo' && listed.status === 'Email the certificate' && listed.steps === 'Job details,Treatment', `the Jobs list reads it the same: ${listed.steps}`);
  await shot('job-certificate-next');

  // 6. The certificate: AS 3660.1, the building and slab, the care lines.
  const text = pdfText(await certificate(), 'certificate-new-build').replace(/\s+/g, ' ');
  check(/NEW CONSTRUCTION/.test(text) && /DATE INSTALLED/.test(text) && /AS 3660\.1/.test(text) && !/AS 3660\.2/.test(text), 'the certificate is for new construction, to AS 3660.1 (and not AS 3660.2)');
  check(/THE BUILDING AND SLAB/.test(text) && /Class 1/.test(text) && /House, single dwelling/.test(text) && /Raft/.test(text) && /Water pipes/.test(text), 'it prints the building and slab');
  check(/18 in all: 12 collars,/.test(text) && /4 soft collars and 2 wraps/.test(text) && /22\.5 linear metres, 3 litres applied/.test(text), 'the penetrations and the construction joints');
  check(/Perimeter and slab penetrations/.test(text) && /Raft Water pipes|Raft\b/.test(text) && /Two collars under the bath/.test(text) && /Photo on the Photos page/.test(text), 'how the physical system went in, the limits and the slab\'s certification');
  check(/chemical put back regularly/.test(text) && /changed or disturbed/.test(text) && /at least every 6 months, as the system's maker directs/.test(text), 'the care lines and the maker\'s inspections');
  check(/THE SLAB'S CERTIFICATION/.test(text), 'the Photos page has the slab\'s certification');

  // 7. Given: the job is done, and Finalise locks the treatment record.
  await p.evaluate(() => { markCertificateHanded(); });
  await p.waitForTimeout(400);
  const done = await p.evaluate(() => { const j = currentJobSummary(); return { group: j.group, status: j.status, finish: jobCanFinalise(j) ? jobFinaliseNext(j).hint : '', text: document.getElementById('jobPageBody').innerText }; });
  check(done.group === 'done' && done.status === 'System installed', 'once given, the job is done: System installed');
  check(/locks the treatment record/.test(done.finish) && /Finalise/.test(done.text), 'Finalise is next, and locks the treatment record');
  check(await p.evaluate(() => { const r = getSavedReports().find(x => x.id === currentReportId); return reinspectionFor(Object.assign({}, r, { reportData: Object.assign({}, r.reportData, { issue: { version: 1 } }) }), getSavedQuotes()) === null; }), 'it isn\'t on the Due list (the durable notice says when)');
  await shot('job-done');

  // 8. The mic on a new construction job fills in its record.
  await p.evaluate(() => { closeTreatmentRecord(); window.toggleSheetVoice = kind => { window.__voiceFor = kind; }; tabGo('dashboard'); });
  await p.waitForTimeout(300);
  await p.evaluate(() => tabMic()); await p.waitForTimeout(400);
  check(await p.evaluate(() => document.getElementById('treatmentOverlay').classList.contains('open') && window.__voiceFor === 'treatment'), 'the dock\'s mic opens the record and listens');
  await p.evaluate(() => cancelSheet('treatmentOverlay')); await p.waitForTimeout(300);

  // 9. Another job's record has none of it.
  await p.evaluate(({ sc }) => {
    startNewJob();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    for (const [k, v] of Object.entries(sc.job)) set(k, v); updateJob();
    saveCurrentReport(true);
    openQuoteFromReport();
    quoteState.items = [newQuoteItem('barrier_lm', { qty: '40' })];
    quoteState.answer = { status: 'accepted', by: 'Sam Taylor', date: todayIsoDate(), method: 'signed', note: '', at: Date.now(), hash: quoteContentHash(quoteState) };
    persistQuote(); storeQuoteOnReport(quoteState, false);
    closeQuote(); tabGo('job');
  }, { sc });
  await p.waitForTimeout(500);
  const other = await p.evaluate(() => {
    const steps = jobPageSteps(currentJobSummary()).map(s => s.label).join(',');
    openTreatmentRecord();
    const out = { steps, nb: document.getElementById('treatmentOverlay').classList.contains('new-build'), fold: document.getElementById('trFold5').hidden, site: !document.getElementById('trSiteMore').hidden,
      care: document.getElementById('trCareWrap').hidden, build: 'build' in readTreatmentForm() };
    return out;
  });
  check(/Agreement/.test(other.steps) && /Report/.test(other.steps), 'an inspection job keeps its agreement and report steps');
  check(!other.nb && other.fold && other.site && other.care && !other.build, 'its record has no new construction parts, and keeps About the site');
  const plain = pdfText(await p.evaluate(async () => {
    await ensureJsPDFLoaded(); quoteState.treatment = readTreatmentForm();
    const buf = new Uint8Array(await buildTreatmentCertificatePDF(quoteState).blob.arrayBuffer()); let s = '';
    for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768));
    return btoa(s);
  }), 'certificate-inspection-job');
  check(!/NEW CONSTRUCTION|THE BUILDING AND SLAB|AS 3660\.1/.test(plain) && /TREATMENT DATE/.test(plain) && /AS 3660\.2/.test(plain), 'and its certificate is as it was (AS 3660.2)');

  // 10. The type of job back to an inspection brings the agreement back.
  await p.evaluate(() => { cancelSheet('treatmentOverlay'); startNewJob(); setNewBuildJob(true); setNewBuildJob(false); });
  await p.waitForTimeout(300);
  check(/Get the agreement signed/.test(await pageText()) && !isNaN(1), 'Make it an inspection brings back the agreement');

  check(!errs.length, 'no page errors: ' + errs.join(' | '));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
  process.exit(fails.length ? 1 : 0);
})();
