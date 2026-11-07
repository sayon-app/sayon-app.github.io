// The report's Areas step (Areas inspected), for before and after shots and
// a quick check that it still works. Fills the standard job, leaves a few
// areas unmarked, opens one, then taps through: an area's status, a reason,
// what was found, Mark the rest as inspected. Shoots the card closed, with
// an area open, and all marked. Prints what it checks; a FAIL line means a
// check failed.
// node areas.js <outDir> [w]  (serve the repo on :8765; see README.md)
// MODES=light,dark adds dark shots.
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/areas'; fs.mkdirSync(OUT, { recursive: true });
const W = +(process.argv[3] || 390), uid = 'u-owner';
const MODES = (process.env.MODES || 'light').split(',');
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('./scenarios.js').find(s => s.name === 'standard');
let fails = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails++; };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: W, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: W < 600 });
  await require('./fonts-route.js')(ctx);
  await ctx.route(/sentry|posthog|maps\.googleapis|cdnjs/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } }));
  await ctx.route(/supabase\.co/, r => r.request().url().includes('businesses?owner_id') ? r.fulfill({ json: [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] }) : r.fulfill({ json: [] }));
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1:u-owner', '1'); localStorage.setItem('korva_onboarded_v1', '1'); }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/'); await p.waitForTimeout(2500);
  await p.evaluate(async (sc) => {
    storeCompanyDetails(sc.company); openApp('inspect'); resetReportState();
    for (const [k, v] of Object.entries(sc.job)) { const el = document.getElementById(k); if (el) el.value = v; }
    updateJob(); await populateFields(sc.fields);
    // A mix: limits, a not-inspected area, and three left to mark.
    reportData.areaStatus = { interior: 'PARTIAL', exterior: 'INSPECTED', subfloor: 'PARTIAL', roofvoid: 'PARTIAL', outbuildings: 'NOT', site: 'INSPECTED' };
    reportData.areaReasons = { interior: ['Stored items', 'Furniture or fittings'], subfloor: ['Low clearance'], roofvoid: ['Low clearance', 'Insulation or sarking'], outbuildings: ['Restricted access'] };
    reportData.areaResult = { exterior: 'CLEAR', subfloor: 'FOUND', interior: 'CLEAR', roofvoid: 'CLEAR', site: 'FOUND' };
    syncObstructionData(); goStep('areas');
  }, sc);
  await p.waitForTimeout(800);
  const card = p.locator('#section-obstructions');
  const shoot = async (name) => {
    for (const mode of MODES) {
      await p.evaluate(m => { document.body.classList.toggle('dark-screen', m === 'dark'); const t = document.getElementById('toast'); if (t) t.className = 'toast'; }, mode);
      // A tall window so the whole card is in view, not cut off by the
      // report's scroll box.
      const h = await card.evaluate(c => c.scrollHeight);
      await p.setViewportSize({ width: W, height: Math.min(5000, h + 700) });
      await p.waitForTimeout(300);
      await card.scrollIntoViewIfNeeded();
      await card.screenshot({ path: `${OUT}/${name}-${mode}.png` });
    }
    await p.evaluate(() => document.body.classList.remove('dark-screen'));
    await p.setViewportSize({ width: W, height: 844 });
  };
  const rows = () => p.evaluate(() => [...document.querySelectorAll('#areaChecklist [data-zone-node]')].map(n => n.dataset.zoneNode + ':' + (n.querySelector('.area-sum-state') || {}).textContent));
  console.log('rows:', JSON.stringify(await rows()));
  await shoot('1-list');

  // Open the subfloor: status, what was found, the reasons.
  await p.locator('[data-zone-node="subfloor"] summary').click(); await p.waitForTimeout(300);
  await shoot('2-open');
  // Tick a second reason, then mark it Not inspected and back.
  await p.locator('[data-zone-node="subfloor"] .obs-item-btn', { hasText: 'Stored items' }).click();
  let st = await p.evaluate(() => ({ s: reportData.areaStatus.subfloor, r: reportData.areaReasons.subfloor }));
  check(st.s === 'PARTIAL' && st.r.includes('Stored items'), 'ticking a reason keeps the subfloor inspected with limits: ' + JSON.stringify(st));
  check(await p.locator('[data-zone-node="subfloor"] details').evaluate(d => d.open), 'the area stays open after a tap');
  await p.locator('[data-zone-node="subfloor"] .area-status-btn', { hasText: 'Not inspected' }).click();
  st = await p.evaluate(() => reportData.areaStatus.subfloor);
  check(st === 'NOT', 'Not inspected marks the subfloor not inspected');
  await p.locator('[data-zone-node="subfloor"] .area-status-btn', { hasText: /^Inspected$/ }).click();
  // Inspected clears the reasons; one ticked and unticked again leaves it
  // plainly inspected.
  st = await p.evaluate(() => ({ s: reportData.areaStatus.subfloor, r: (reportData.areaReasons || {}).subfloor || [] }));
  check(st.s === 'INSPECTED' && !st.r.length, 'Inspected after Not inspected starts the reasons afresh: ' + JSON.stringify(st));
  const low = p.locator('[data-zone-node="subfloor"] .obs-item-btn', { hasText: 'Low clearance' });
  await low.click();
  check(await p.evaluate(() => reportData.areaStatus.subfloor) === 'PARTIAL', 'a reason makes it inspected with limits');
  await low.click();
  check(await p.evaluate(() => reportData.areaStatus.subfloor) === 'INSPECTED', 'unticking it makes it plainly inspected');
  await p.locator('[data-zone-node="subfloor"] .area-result-btn', { hasText: 'Nothing found' }).click();
  check(await p.evaluate(() => reportData.areaResult.subfloor) === 'CLEAR', 'Nothing found is recorded');
  await p.locator('[data-zone-node="subfloor"] summary').click(); await p.waitForTimeout(200);

  // An unmarked area opened, then the rest marked in one tap.
  await p.locator('[data-zone-node="fences"] summary').click(); await p.waitForTimeout(300);
  await shoot('3-unmarked-open');
  await p.locator('[data-zone-node="fences"] summary').click();
  await p.locator('#markAllAreasBtn').click(); await p.waitForTimeout(300);
  const done = await p.evaluate(() => ({ prog: document.getElementById('areasProgress').textContent, all: Object.keys(OBS_ZONES).every(z => areaStatusOf(z)), btnHidden: document.getElementById('markAllAreasBtn').hidden }));
  check(done.all && done.btnHidden && /(9 of 9|All 9)/.test(done.prog), 'Mark the rest marks every area: ' + JSON.stringify(done));
  console.log('rows:', JSON.stringify(await rows()));
  await shoot('4-all-marked');

  // Nothing scrolls sideways.
  const wide = await p.evaluate(() => { const c = document.getElementById('section-obstructions'); return [...c.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > c.getBoundingClientRect().right + 1).map(e => e.className).slice(0, 5); });
  check(!wide.length, 'nothing runs past the card: ' + JSON.stringify(wide));

  console.log(errs.length ? 'errors: ' + errs.join(' | ') : 'no page errors');
  if (errs.length) fails++;
  await b.close();
  process.exit(fails ? 1 : 0);
})();
