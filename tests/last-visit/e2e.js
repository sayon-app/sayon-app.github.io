// Last visit: an address inspected before offers to start from that report.
// node e2e.js <outDir>  (server on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/last-visit'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/sentry|posthog|maps\.googleapis|cdnjs/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } }));
  await ctx.route(/supabase\.co/, r => r.fulfill({ json: r.request().url().includes('businesses?owner_id') ? [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] : [] }));
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1', '1'); }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  // Last year's report, saved.
  await p.evaluate(async (sc) => {
    storeCompanyDetails(sc.company); openApp('inspect'); resetReportState();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    for (const [k, v] of Object.entries(sc.job)) set(k, v); updateJob();
    await populateFields(sc.fields);
  }, sc);
  await p.waitForTimeout(2000);
  await p.evaluate(() => { reportData.existingSystem = 'Chemical soil barrier'; reportData.height = 'Single storey'; saveCurrentReport(true); });
  await p.waitForTimeout(300);
  check(await p.evaluate(() => getSavedReports().length === 1 && document.getElementById('lastVisitBanner').hidden), 'the saved report itself shows no banner');
  // A new job at the same address, typed a little differently.
  await p.evaluate(() => newReport());
  await p.waitForTimeout(300);
  check(await p.evaluate(() => document.getElementById('lastVisitBanner').hidden), 'no address, no banner');
  await p.evaluate(() => { document.getElementById('jobAddress').value = '7 Banksia Dr'; document.getElementById('jobSuburb').value = 'EPPING'; updateJob(); });
  await p.waitForTimeout(300);
  const banner = await p.evaluate(() => ({ hidden: document.getElementById('lastVisitBanner').hidden, text: document.getElementById('lastVisitText').textContent, btn: document.getElementById('lastVisitBtn').textContent }));
  check(!banner.hidden && /Inspected here before, on/.test(banner.text) && banner.btn === 'Start from it', 'same address, differently typed, offers the last report');
  await p.screenshot({ path: `${OUT}/1-banner.png`, fullPage: false });
  // Not now hides it for this job; another address shows nothing.
  await p.evaluate(() => dismissLastVisit());
  check(await p.evaluate(() => document.getElementById('lastVisitBanner').hidden && !!reportData.lastVisitDismissed), 'Not now hides the offer');
  await p.evaluate(() => { delete reportData.lastVisitDismissed; document.getElementById('jobAddress').value = '9 Banksia Dr'; updateJob(); });
  check(await p.evaluate(() => document.getElementById('lastVisitBanner').hidden), 'a different number is a different place');
  await p.evaluate(() => { document.getElementById('jobAddress').value = '7 Banksia Drive'; updateJob(); });
  // The inspector already said something: it is kept.
  await p.evaluate(() => { reportData.roofType = 'Metal roof'; const el = document.getElementById('f-roofType'); renderField(el, 'roofType', 'Metal roof'); });
  await p.evaluate(() => startFromLastVisit());
  await p.waitForTimeout(400);
  const after = await p.evaluate(() => ({ rd: reportData, structure: document.getElementById('f-structureType').textContent, history: document.getElementById('f-termiteHistory').textContent, banner: document.getElementById('lastVisitText').textContent, btn: document.getElementById('lastVisitBtn').textContent }));
  check(after.rd.structureType === 'Single storey house' && after.structure === 'Single storey house' && after.rd.existingSystem === 'Chemical soil barrier', 'property details copied and shown');
  check(after.rd.roofType === 'Metal roof', 'a field already filled is kept');
  check(!after.rd.findings || !after.rd.findings.some(f => f && f.termiteActivity), 'no findings copied');
  check(!after.rd.riskLevel && !after.rd.treatmentRecommended && !after.rd.weatherConditions, 'no risk, recommendation or weather copied');
  check(/^Termites reported before \(our inspection on .*live termites, Gum tree/.test(after.rd.termiteHistory), `termite history written from the last report: ${after.rd.termiteHistory}`);
  check(after.rd.lastVisit && after.rd.lastVisit.copied > 5 && /Started from the/.test(after.banner) && after.btn === 'What changed', 'banner now says started from it');
  await p.screenshot({ path: `${OUT}/2-started.png`, fullPage: false });
  // What changed: this visit found less.
  await p.evaluate(() => { reportData.riskLevel = 'MEDIUM'; reportData.findings = [{ id: 'f1', termiteActivity: 'NONE' }]; reportData.timberSoil = 'NO'; reportData.treatmentRecommended = 'NO'; openLastVisitChanges(); });
  await p.waitForTimeout(400);
  const sheet = await p.evaluate(() => ({ text: document.getElementById('lastVisitRows').innerText, changed: [...document.querySelectorAll('.last-visit-row.changed .last-visit-label')].map(e => e.textContent) }));
  check(sheet.changed.includes('Risk of termite attack') && sheet.changed.includes('Live termites') && sheet.changed.includes('Treatment recommended'), `changed rows are marked: ${sheet.changed.join(', ')}`);
  check(!sheet.changed.includes('Termite management system') && !sheet.changed.includes('Borers'), 'an unchanged row, and a row not yet answered, are not marked');
  check(/HIGH/.test(sheet.text) && /MEDIUM/.test(sheet.text), 'last time and now both shown');
  await p.screenshot({ path: `${OUT}/3-since-last-visit.png`, fullPage: false });
  check(errs.length === 0, `no page errors ${errs.join(' | ')}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
