// Areas, quicker: the button over the areas marks every area not yet marked
// as inspected and every inspected area with nothing under Found here as
// "nothing found" (an area a finding names gets "evidence found"); with every
// area marked but some Found here blank, it says "Mark the rest nothing
// found". A limited area (inspected with limits or not inspected) has a
// Recheck later switch on its card, on to start: it feeds Recheck later
// (High risk areas) and the report, and off leaves that area out.
// node e2e.js <outDir>  (serve the repo on :8765; jsPDF from tests/visual/setup.sh)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/area-quick'; fs.mkdirSync(OUT, { recursive: true });
const uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
let fails = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails++; };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } }));
  await ctx.route(/supabase\.co/, r => r.request().url().includes('businesses?owner_id') ? r.fulfill({ json: [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] }) : r.fulfill({ json: [] }));
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1', '1'); }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/'); await p.waitForTimeout(2500);
  await p.evaluate((sc) => {
    storeCompanyDetails(sc.company); openApp('inspect'); resetReportState();
    for (const [k, v] of Object.entries(sc.job)) { const el = document.getElementById(k); if (el) el.value = v; }
    updateJob(); goStep('areas');
  }, sc);
  await p.waitForTimeout(400);
  const btn = () => p.evaluate(() => { const el = document.getElementById('markAllAreasBtn'); return { hidden: el.hidden, text: el.textContent.trim() }; });

  // 1. One area inspected by hand, the roof void with a restricted reason; the rest blank.
  await p.evaluate(() => {
    setAreaStatus('interior', 'INSPECTED');
    setAreaStatus('roofvoid', 'INSPECTED'); toggleObsItem('roofvoid', [...RESTRICTED_REASONS].find(r => OBS_ZONES.roofvoid.items.includes(r)));
  });
  let s = await btn();
  check(!s.hidden && s.text === 'Mark the rest inspected, nothing found', 'the button offers inspected and nothing found: ' + s.text);
  await p.click('#markAllAreasBtn'); await p.waitForTimeout(200);
  let st = await p.evaluate(() => ({ zones: Object.keys(OBS_ZONES).length, status: { ...reportData.areaStatus }, result: { ...reportData.areaResult }, missing: areasMissingResult() }));
  check(st.zones === Object.keys(st.status).length, 'every area has a status');
  check(st.status.roofvoid === 'PARTIAL', 'the roof void keeps its limit');
  check(st.missing.length === 0 && Object.values(st.result).every(v => v === 'CLEAR'), 'every inspected area is nothing found');
  s = await btn(); check(s.hidden, 'the button goes once nothing is left');

  // 2. Every area marked by hand but Found here blank: "Mark the rest nothing found".
  // (Nothing found everywhere also says no termites; that comes off too.)
  await p.evaluate(() => { reportData.areaResult = {}; reportData.findings = []; renderAreaChecklist(); });
  s = await btn(); check(!s.hidden && s.text === 'Mark the rest nothing found', 'with every area marked it offers nothing found: ' + s.text);

  // 3. Recheck later on the roof void's card, on to start.
  await p.evaluate(() => { const d = document.querySelector('details[data-zone="roofvoid"]'); d.open = true; onAreaToggle('roofvoid', true); renderAreaChecklist(); });
  await p.waitForTimeout(150);
  const sw = () => p.evaluate(() => { const el = document.querySelector('[data-zone="roofvoid"] .area-recheck .toggle-switch'); return el && { on: el.classList.contains('on'), aria: el.getAttribute('aria-checked') }; });
  let w = await sw();
  check(w && w.on && w.aria === 'true', 'the roof void card has Recheck later, on');
  check(await p.evaluate(() => !document.querySelector('[data-zone="interior"] .area-recheck')), 'a plainly inspected area has none');
  check(/roof void/i.test(await p.evaluate(() => accessLimits().highRisk)), 'Recheck later lists the roof void');
  await p.locator('[data-zone="roofvoid"] .area-recheck').scrollIntoViewIfNeeded();
  await p.screenshot({ path: OUT + '/recheck-on.png' });
  await p.click('[data-zone="roofvoid"] .area-recheck .toggle-switch'); await p.waitForTimeout(150);
  w = await sw();
  check(w && !w.on, 'turned off');
  check(!(await p.evaluate(() => accessLimits().highRisk)), 'off leaves it off the list');
  await p.screenshot({ path: OUT + '/recheck-off.png' });
  await p.click('[data-zone="roofvoid"] .area-recheck .toggle-switch'); await p.waitForTimeout(150);

  // 4. The inspector's own words come first; an area they already name isn't repeated.
  await p.evaluate(() => { setAreaStatus('subfloor', 'NOT'); reportData.highRiskAreas = 'Behind the hot water unit'; renderAccessSummary(); });
  const hr = await p.evaluate(() => accessLimits().highRisk);
  check(/^Behind the hot water unit; subfloor and roof void$/.test(hr), 'typed words then the areas: ' + hr);
  await p.evaluate(() => { reportData.highRiskAreas = 'Roof void over the garage'; });
  const hr2 = await p.evaluate(() => accessLimits().highRisk);
  check(hr2 === 'Roof void over the garage; subfloor', 'an area the words name is not repeated: ' + hr2);
  await p.evaluate(() => { goStep('restrictions'); renderAccessSummary(); });
  await p.waitForTimeout(200);
  const hint = await p.evaluate(() => document.getElementById('accessHighRiskHint').textContent);
  check(/Also listed, from the areas: Subfloor$/.test(hint), 'Recheck later says what the areas add: ' + hint);

  check(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
