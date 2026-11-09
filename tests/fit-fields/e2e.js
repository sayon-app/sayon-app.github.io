// The Findings rule on Conducive and Property: a question that doesn't fit
// the house stays out of sight and is answered N/A (slab edge without a slab,
// weep holes without brick or masonry walls, subfloor drainage, ventilation
// and ant capping without a subfloor), and comes back when the house
// changes. "Where" boxes show only after the answer that calls for them, the
// system name only once there's a system, the 25 mm and 75 mm zone checks only
// after landscaping is a yes. The report prints the N/A answers.
// node e2e.js <outDir>  (serve the repo on :8765; jsPDF from tests/visual/setup.sh)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/fit-fields'; fs.mkdirSync(OUT, { recursive: true });
const uid = 'u-owner', SP = process.env.JSPDF_DIR || '/tmp/jspdf';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
let fails = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails++; };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } }));
  await ctx.route(/supabase\.co/, r => r.request().url().includes('businesses?owner_id') ? r.fulfill({ json: [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] }) : r.fulfill({ json: [] }));
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1', '1'); }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/'); await p.waitForTimeout(2500);
  await p.evaluate((sc) => {
    storeCompanyDetails(sc.company); openApp('inspect'); resetReportState();
    for (const [k, v] of Object.entries(sc.job)) { const el = document.getElementById(k); if (el) el.value = v; }
    updateJob(); goStep('conducive');
  }, sc);
  await p.waitForTimeout(400);
  const KEYS = ['slabEdge', 'weepHoles', 'subfloorDrainage', 'subfloorVentilation', 'antCapping', 'mouldWhere', 'timberSoilDetails', 'antCappingDetails', 'nonDurableTimberDetails', 'nonDurableTimberWhere', 'existingSystemOther', 'zone25mmVisible', 'zone75mmVisible'];
  const state = () => p.evaluate(keys => {
    const vis = k => { const el = document.getElementById('f-' + k); for (let n = el; n; n = n.parentElement) { if (n.hidden || n.style.display === 'none') return false; if (n.id === 'reportBody') break; } return true; };
    return {
      shown: keys.filter(vis),
      vals: Object.fromEntries(keys.map(k => [k, reportData[k] ?? null])),
      na: (reportData.naFromHouse || []).slice().sort(),
      entryCount: document.querySelector('#fg-entry .fgroup-count').textContent,
      moistCount: document.querySelector('#fg-moisture .fgroup-count').textContent,
      durable: document.getElementById('durablePhotoWidget').style.display !== 'none',
    };
  }, KEYS);
  const edit = (key, value) => p.evaluate(([k, v]) => commitEdit(document.getElementById('f-' + k), k, v), [key, value]);
  const sorted = a => a.slice().sort().join(',');

  // 1. Nothing known yet: every house question shows; follow-ups don't.
  let s = await state();
  check(['slabEdge', 'weepHoles', 'subfloorDrainage', 'subfloorVentilation', 'antCapping'].every(k => s.shown.includes(k)), 'floor and walls unknown: every house question shows');
  check(!['mouldWhere', 'timberSoilDetails', 'antCappingDetails', 'nonDurableTimberDetails', 'nonDurableTimberWhere'].some(k => s.shown.includes(k)), `"where" boxes wait for their answer (${s.shown.join(',')})`);
  check(!s.shown.includes('existingSystemOther'), 'system name waits for a system');
  check(s.na.length === 0, 'nothing answered for the inspector yet');
  await p.screenshot({ path: `${OUT}/1-unknown.png` });

  // 2. A slab house with weatherboard walls.
  await edit('floorType', 'Concrete slab on ground');
  await edit('wallConstruction', 'Weatherboard');
  await p.waitForTimeout(200);
  s = await state();
  check(s.shown.includes('slabEdge') && !s.shown.includes('weepHoles') && !s.shown.includes('subfloorDrainage') && !s.shown.includes('subfloorVentilation') && !s.shown.includes('antCapping'), `slab, weatherboard: only slab edge shows (${s.shown.join(',')})`);
  check(sorted(s.na) === 'antCapping,subfloorDrainage,subfloorVentilation,weepHoles' && ['weepHoles', 'subfloorDrainage', 'subfloorVentilation', 'antCapping'].every(k => s.vals[k] === 'N/A'), 'the four that don\'t fit are answered N/A');
  check(s.vals.slabEdge === null, 'slab edge left for the inspector');
  await p.evaluate(() => goStep('conducive')); await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/2-slab-weatherboard.png`, fullPage: false });
  s = await state();
  console.log('   counts:', s.moistCount, '|', s.entryCount);

  // 3. The floor changes to suspended timber: subfloor questions come back blank, slab edge goes.
  await edit('floorType', 'Timber suspended floor');
  await p.waitForTimeout(200);
  s = await state();
  check(!s.shown.includes('slabEdge') && s.vals.slabEdge === 'N/A', 'suspended timber: slab edge goes, answered N/A');
  check(['subfloorDrainage', 'subfloorVentilation', 'antCapping'].every(k => s.shown.includes(k) && s.vals[k] === null), 'subfloor questions come back, blank again');
  check(sorted(s.na) === 'slabEdge,weepHoles', `only slab edge and weep holes tracked now (${s.na.join(',')})`);

  // 4. An answer the inspector gives is never taken back or hidden.
  await edit('weepHoles', 'BRIDGED');
  await edit('wallConstruction', 'Fibro / cement sheet');
  await p.waitForTimeout(200);
  s = await state();
  check(s.vals.weepHoles === 'BRIDGED' && s.shown.includes('weepHoles') && !s.na.includes('weepHoles'), 'weep holes answered Bridged stays, shown, even on fibro walls');
  await edit('wallConstruction', 'Brick veneer');

  // 5. Floor type unknown again ("Other"): everything shows; N/A answers it filled are taken back.
  await edit('floorType', 'Other');
  await p.waitForTimeout(200);
  s = await state();
  check(s.shown.includes('slabEdge') && s.vals.slabEdge === null && !s.na.includes('slabEdge'), '"Other" floor: slab edge back and blank');

  // 6. No floor type, but the Subfloor area marked Not applicable: no subfloor.
  await p.evaluate(() => { delete reportData.floorType; const el = document.getElementById('f-floorType'); el.textContent = '—'; el.classList.remove('filled'); reportData.areaStatus = { subfloor: 'NA' }; syncObstructionData(); });
  await p.waitForTimeout(200);
  s = await state();
  check(!s.shown.includes('subfloorDrainage') && s.vals.subfloorDrainage === 'N/A' && s.vals.antCapping === 'N/A', 'Subfloor area not applicable: subfloor questions go, answered N/A');
  await p.evaluate(() => { reportData.areaStatus = { subfloor: 'INSPECTED' }; syncObstructionData(); });
  s = await state();
  check(s.shown.includes('subfloorDrainage') && s.vals.subfloorDrainage === null, 'Subfloor area inspected: they come back');

  // 7. Follow-ups.
  await edit('mouldSeen', 'YES'); await edit('timberSoil', 'YES'); await edit('antCapping', 'GAPS'); await edit('nonDurableTimber', 'YES');
  s = await state();
  check(['mouldWhere', 'timberSoilDetails', 'antCappingDetails', 'nonDurableTimberDetails', 'nonDurableTimberWhere'].every(k => s.shown.includes(k)), 'each "where" box shows after the answer that calls for it');
  await edit('mouldWhere', 'Laundry ceiling'); await edit('mouldSeen', 'NO'); await edit('timberSoil', 'NO');
  s = await state();
  check(s.shown.includes('mouldWhere') && !s.shown.includes('timberSoilDetails'), 'a "where" box holding words stays; an empty one goes after a no');
  await p.screenshot({ path: `${OUT}/3-follow-ups.png` });

  // 8. Property: system name, zone checks, durable notice photo.
  await p.evaluate(() => goStep('property')); await p.waitForTimeout(300);
  s = await state();
  check(!s.shown.includes('existingSystemOther') && s.durable, 'no system yet: no name box, the durable notice photo is there to fill it');
  await edit('existingSystem', 'No System Found');
  s = await state();
  check(!s.shown.includes('existingSystemOther') && !s.durable, 'no system found: no name box, no durable notice photo');
  await edit('existingSystem', 'Termite Baiting System');
  await p.waitForTimeout(200);
  s = await state();
  check(s.shown.includes('existingSystemOther') && s.durable, 'a system: its name box and the durable notice photo show');
  check(!s.shown.includes('zone25mmVisible') && !s.shown.includes('zone75mmVisible'), 'zone checks wait for landscaping');
  await edit('hardLandscaping', 'YES');
  s = await state();
  check(s.shown.includes('zone25mmVisible') && !s.shown.includes('zone75mmVisible'), 'hard landscaping yes: the 25 mm check shows');
  await p.evaluate(() => document.getElementById('systemVerify').scrollIntoView({ block: 'center' })); await p.waitForTimeout(200);
  await p.screenshot({ path: `${OUT}/4-system.png` });

  // 9. Reload: what was answered N/A stays hidden; the report prints it.
  const saved = await p.evaluate(() => JSON.stringify(reportData));
  await p.evaluate(rd => { reportData = JSON.parse(rd); renderReportWidgets(); }, saved);
  await p.evaluate(() => { reportData.floorType = 'Concrete slab on ground'; renderField(document.getElementById('f-floorType'), 'floorType', reportData.floorType); syncFitFields(); goStep('conducive'); });
  await p.waitForTimeout(300);
  s = await state();
  check(s.vals.antCapping === 'GAPS' && s.shown.includes('antCapping'), `an answered question stays on a slab house too (${s.vals.antCapping}, ${s.shown.join(',')})`);
  check(s.vals.subfloorDrainage === 'N/A' && !s.shown.includes('subfloorDrainage'), 'blank subfloor drainage on a slab house: N/A and hidden');
  const pdfText = await p.evaluate(async () => {
    await ensureJsPDFLoaded();
    const doc = await buildReportPdf({ returnDoc: true }).catch(() => null);
    return doc ? 'built' : 'none';
  }).catch(e => 'error ' + e.message);
  console.log('   pdf:', pdfText);

  check(errs.length === 0, `no page errors ${errs.join(' | ')}`);
  await b.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
