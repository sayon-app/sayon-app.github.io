// Site plan: the technician draws the site on the treatment record with a
// fixed set of symbols (building, barrier, bait and monitoring stations,
// notice, findings). The plan and its legend print on the certificates,
// fill the first bait visit's stations, and colour each station by what a
// visit found, on the bait card and the visit report.
// node e2e.js <outDir>  (serve the repo on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs'); const { execFileSync } = require('child_process');
const OUT = process.argv[2] || '/tmp/site-plan'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf', uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
let shotN = 0;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, acceptDownloads: true });
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
  // Plan units (1000 × 750) to the screen.
  const planBox = async () => { await p.locator('#spCanvas svg').scrollIntoViewIfNeeded(); return p.locator('#spCanvas svg').boundingBox(); };
  const at = (bb, x, y) => [bb.x + x / 1000 * bb.width, bb.y + y / 750 * bb.height];
  const tapPlan = async (x, y) => { const bb = await planBox(); const [sx, sy] = at(bb, x, y); await p.mouse.click(sx, sy); await p.waitForTimeout(60); };
  const dragPlan = async (x0, y0, x1, y1) => { const bb = await planBox(); const a = at(bb, x0, y0), c = at(bb, x1, y1); await p.mouse.move(...a); await p.mouse.down(); for (let i = 1; i <= 8; i++) await p.mouse.move(a[0] + (c[0] - a[0]) * i / 8, a[1] + (c[1] - a[1]) * i / 8); await p.mouse.up(); await p.waitForTimeout(60); };
  const tool = async (group, label) => { await tap(p.locator('#spGroups .sp-group', { hasText: group }), group); await tap(p.locator('#spTools .sp-tool', { hasText: label }), label); };
  const pdfShots = async (b64, name) => {
    fs.writeFileSync(`${OUT}/${name}.pdf`, Buffer.from(b64, 'base64'));
    try { execFileSync('pdftoppm', ['-png', '-r', '80', `${OUT}/${name}.pdf`, `${OUT}/${name}`]); } catch (e) {}
    try { return execFileSync('pdftotext', ['-layout', `${OUT}/${name}.pdf`, '-']).toString(); } catch (e) { return ''; }
  };
  const makePdf = fn => p.evaluate(async (src) => { const { blob, fname } = eval(src)(); const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768)); return { b64: btoa(s), fname, pages: (s.match(/\/Type\s*\/Page[^s]/g) || []).length }; }, fn);

  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);

  // A job with an accepted quote for a baiting system, not yet treated.
  await p.evaluate(async ({ sc }) => {
    storeCompanyDetails(sc.company); openApp('inspect'); resetReportState();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    for (const [k, v] of Object.entries(sc.job)) set(k, v); updateJob();
    document.getElementById('jobClientEmail').value = 'sam@example.com'; updateJob();
    await populateFields(Object.assign({}, sc.fields, { structureType: 'Single storey house', wallConstruction: 'Brick veneer', floorType: 'Concrete slab', siteSurroundings: 'Garden beds against the walls', existingSystem: 'No System Found' }));
    saveCurrentReport(true);
    openQuoteFromReport();
    quoteState.items = [newQuoteItem('bait_install', { qty: '' }), newQuoteItem('bait_monitor')];
    quoteState.clientEmail = 'sam@example.com';
    quoteState.answer = { status: 'accepted', by: 'Sam Taylor', date: todayIsoDate(), method: 'signed', note: '', at: Date.now(), hash: quoteContentHash(quoteState) };
    persistQuote(); storeQuoteOnReport(quoteState, false);
    renderQuoteAnswer();
  }, { sc });
  await p.waitForTimeout(500);

  // 1. The record: the site is filled from the report, and the plan is one tap.
  await p.evaluate(() => openTreatmentRecord()); await p.waitForTimeout(500);
  const site = await p.evaluate(() => ['trSiteBuilding', 'trSiteFloor', 'trSiteSurrounds', 'trSiteExisting'].map(id => document.getElementById(id).value));
  console.log('site:', JSON.stringify(site));
  check(/Single storey house/.test(site[0]) && /Brick veneer/.test(site[0]) && site[1] === 'Concrete slab' && /Garden beds/.test(site[2]) && /None found/.test(site[3]), 'the site fields come from the report');
  await p.locator('#trPlan').scrollIntoViewIfNeeded(); await p.evaluate(() => document.getElementById('trSiteBuilding').scrollIntoView({ block: 'start' }));
  await shot('record-site-empty-plan');

  // 2. Draw the plan.
  await tap(p.locator('#trPlan .treat-plan-empty'), 'Draw the site plan'); await p.waitForTimeout(400);
  check(await p.evaluate(() => document.getElementById('sitePlanOverlay').classList.contains('open') && sitePlanEditor.plan.items.length === 1 && sitePlanEditor.plan.items[0].k === 'house'), 'the editor opens with a house to start from');
  await shot('editor-start');
  // A garage dragged out to the right.
  await tool('The site', 'Garage or shed'); await dragPlan(850, 275, 975, 425);
  await p.fill('#spSelLabel', 'Garage');
  await tool('The site', 'Tree or stump'); await tapPlan(150, 650);
  await p.fill('#spSelLabel', 'Gum tree');
  // The barrier along the front and two sides.
  await tool('Treatment', 'Chemical barrier');
  for (const [x, y] of [[275, 525], [275, 200], [725, 200], [725, 525]]) await tapPlan(x, y);
  await shot('editor-line');
  await tap(p.locator('#spFinishLine'), 'Finish line');
  await tool('Treatment', 'Durable notice'); await tapPlan(250, 400); await p.fill('#spSelLabel', 'Meter box');
  await tool('Treatment', 'Not treated');
  await tapPlan(300, 550); await tapPlan(700, 550); await tap(p.locator('#spFinishLine'), 'Finish line (2)');
  await p.fill('#spSelLabel', 'Rear paving');
  // Eight in-ground stations around the house, two above-ground, one monitoring.
  await tool('Stations', 'In-ground');
  const ring = [[225, 175], [500, 150], [775, 175], [800, 525], [500, 600], [225, 575], [225, 375], [800, 375]];
  for (const [x, y] of ring) await tapPlan(x, y);
  await tool('Stations', 'Above-ground'); await tapPlan(400, 300); await tapPlan(600, 450);
  await tool('Stations', 'Monitoring'); await tapPlan(900, 650);
  await tool('Findings', 'Termite activity'); await tapPlan(625, 450); await p.fill('#spSelLabel', 'Laundry door frame');
  await tool('Findings', 'Access point'); await tapPlan(400, 450); await p.fill('#spSelLabel', 'Subfloor hatch');
  // Name the first station: tap it with no tool picked.
  await tapPlan(225, 175); await p.fill('#spSelLabel', 'Front left corner');
  await tapPlan(500, 600); await p.fill('#spSelLabel', 'Rear, by the laundry');
  // Move the tree: drag it.
  await dragPlan(150, 650, 100, 675);
  const ed = await p.evaluate(() => ({ items: sitePlanEditor.plan.items.map(i => i.k + (i.n ? i.n : '') + (i.label ? ':' + i.label : '')), tree: sitePlanEditor.plan.items.find(i => i.k === 'tree'), legend: [...document.querySelectorAll('#spLegend li')].map(li => li.textContent), summary: document.getElementById('spSummary').textContent }));
  console.log('editor:', JSON.stringify(ed));
  check(ed.items.filter(i => /^inground/.test(i)).length === 8 && ed.items.includes('above9') && ed.items.includes('above10') && ed.items.includes('monitor11'), 'stations number themselves across the three kinds (1–8, 9–10, 11)');
  check(ed.items.includes('inground1:Front left corner') && ed.items.includes('garage'.replace('garage', 'shed:Garage')), 'a station and the garage are named');
  check(ed.tree && ed.tree.x === 100 && ed.tree.y === 675, 'dragging moves a symbol, snapped to the grid');
  check(ed.legend.length === 11 && ed.legend.some(l => /In-ground bait station \(8\)/.test(l)) && ed.legend.some(l => /Chemical barrier/.test(l)), 'the legend lists each symbol used, with station counts');
  check(/8 in-ground bait stations, 2 above-ground bait stations, 1 monitoring station, a chemical barrier/.test(ed.summary), 'the plan is summed up in words: ' + ed.summary);
  await p.evaluate(() => { sitePlanEditor.sel = null; renderSitePlanEditor(); document.querySelector('#sitePlanOverlay .page-sheet-body').scrollTop = 0; });
  await shot('editor-drawn');
  await p.evaluate(() => document.querySelector('#sitePlanOverlay .sp-key').scrollIntoView({ block: 'end' })); await shot('editor-legend');
  // Undo takes back the last change, and the plan still saves.
  await tool('Findings', 'Moisture or leak'); await tapPlan(650, 250);
  check(await p.evaluate(() => sitePlanEditor.plan.items.some(i => i.k === 'moisture')), 'a moisture marker goes down');
  await tap(p.locator('#spUndo'), 'Undo');
  check(await p.evaluate(() => !sitePlanEditor.plan.items.some(i => i.k === 'moisture')), 'Undo takes it back');
  await tap(p.locator('#sitePlanOverlay .extract-btn', { hasText: 'Save site plan' }), 'Save site plan'); await p.waitForTimeout(300);

  // 3. Back on the record: the plan, its legend, and the station count.
  const rec = await p.evaluate(() => ({ open: document.getElementById('sitePlanOverlay').classList.contains('open'), svg: !!document.querySelector('#trPlan svg'), legend: document.querySelectorAll('#trPlan .site-plan-legend li').length, bait: document.querySelector('#trMethods input[data-key="bait"]').checked, qty: document.querySelector('#trMethods [data-qty="bait"]').value }));
  console.log('record:', JSON.stringify(rec));
  check(!rec.open && rec.svg && rec.legend === 11, 'the record shows the plan and its legend');
  check(rec.bait && rec.qty === '10', 'the 10 bait stations drawn fill the station count');
  await p.evaluate(() => document.getElementById('trPlan').scrollIntoView({ block: 'start' })); await shot('record-plan');
  await sign('#trSigCanvas');
  await tap(p.locator('#trSaveBtn'), 'Save treatment record'); await p.waitForTimeout(600);
  const t = await p.evaluate(() => ({ plan: quoteState.treatment.plan && quoteState.treatment.plan.items.length, site: quoteState.treatment.site }));
  check(t.plan === 19 && /Concrete slab/.test(t.site.floor), 'the plan and the site are kept with the treatment record');

  // 4. The certificates carry the plan, the legend and where each station is.
  await p.evaluate(() => ensureJsPDFLoaded()); await p.waitForTimeout(400);
  for (const install of [false, true]) {
    const pdf = await makePdf(`() => buildTreatmentCertificatePDF(quoteState, { install: ${install} })`);
    const name = install ? 'installation-certificate' : 'treatment-certificate';
    const text = await pdfShots(pdf.b64, name);
    console.log(name, pdf.fname, pdf.pages, 'pages');
    check(pdf.pages === 2, `${name}: the certificate keeps page 1, and the plan gets page 2`);
    if (text) {
      check(/SITE PLAN/.test(text) && /LEGEND/.test(text) && /In-ground bait station \(8\)/.test(text) && /Above-ground bait station \(2\)/.test(text) && /Durable notice/.test(text), `${name}: the plan prints with its legend`);
      check(/WHERE EACH STATION IS/.test(text) && /Front left corner/.test(text) && /Not to scale/.test(text), `${name}: station locations under the plan`);
      check(/THE SITE/.test(text) && /Brick/.test(text) && /Concrete slab/.test(text) && /None found/.test(text), `${name}: the site details print`);
    }
  }

  // 5. The first visit takes its stations from the plan.
  await p.evaluate(() => { quoteState.certificateSentAt = Date.now(); persistQuote(); renderQuoteAnswer(); });
  await p.waitForTimeout(300);
  await p.evaluate(() => document.getElementById('qpBait').scrollIntoView({ block: 'center' })); await shot('bait-card-installed');
  check(await p.evaluate(() => /Stations as installed/.test(document.getElementById('qpBait').innerText)), 'the bait card shows the stations as installed');
  await tap(p.locator('#qpBait button', { hasText: 'Record a visit' }), 'Record a visit'); await p.waitForTimeout(500);
  const v0 = await p.evaluate(() => baitDraft.stations.map(s => s.n + ':' + s.where));
  console.log('visit stations:', JSON.stringify(v0));
  check(v0.length === 11 && v0[0] === '1:Front left corner' && v0[4] === '5:Rear, by the laundry' && v0[10].startsWith('11:'), 'the visit lists the 11 stations from the plan, with where they are');
  await tap(p.locator('#bvStations .bait-station[data-i="4"] .bait-chip.active'), 'station 5 active');
  await tap(p.locator('#bvStations .bait-station[data-i="9"] .bait-chip.eaten'), 'station 10 bait eaten');
  await tap(p.locator('#bvStations .bait-station[data-i="2"] .bait-chip.damaged'), 'station 3 damaged');
  await tap(p.locator('.bait-rest-btn'), 'Rest are clear');
  await sign('#bvSigCanvas'); await tap(p.locator('#bvSaveBtn'), 'Save visit'); await p.waitForTimeout(800);
  await p.evaluate(() => document.querySelector('#qpBait .bait-plan').scrollIntoView({ block: 'start' })); await shot('bait-card-visit');
  const card = await p.evaluate(() => ({ cap: document.querySelector('#qpBait .bait-plan-caption').textContent, legend: [...document.querySelectorAll('#qpBait .site-plan-legend li')].map(li => li.textContent) }));
  check(/Stations as found on/.test(card.cap) && card.legend.includes('Termites active') && card.legend.includes('Clear, no activity') && card.legend.includes('Damaged, missing or not checked'), 'the card colours each station by what the visit found');
  const vp = await makePdf(`() => buildBaitVisitPDF(quoteState, quoteState.baitVisits[0])`);
  const vtext = await pdfShots(vp.b64, 'visit-report');
  console.log('visit report', vp.fname, vp.pages, 'pages');
  check(vp.pages === 2, 'the visit report keeps page 1, and the station map gets page 2');
  if (vtext) check(/STATION MAP/.test(vtext) && /STATIONS ON THIS VISIT/.test(vtext) && /Damaged, missing or not checked/.test(vtext) && /Termites active/.test(vtext) && /Bait eaten, no termites seen/.test(vtext), 'the visit report has the station map and what each colour means');

  // 6. An old record with a hand drawing still prints it.
  const old = await p.evaluate(() => { const q = JSON.parse(JSON.stringify(quoteState)); q.treatment.plan = null; q.treatment.sketch = treatmentSketchImage() || 'data:image/jpeg;base64,'; const { blob } = buildTreatmentCertificatePDF(q); return blob.size > 0; });
  check(old, 'a record without a drawn plan still makes its certificate');

  // 7. Dark screen: the plan stays on white.
  await p.evaluate(() => { document.body.classList.add('dark-screen'); openTreatmentRecord(); document.getElementById('trPlan').scrollIntoView({ block: 'start' }); });
  await shot('record-plan-dark');
  await p.evaluate(() => openTreatmentSitePlan()); await p.waitForTimeout(300); await shot('editor-dark');
  await p.evaluate(() => { closeSitePlan(); closeTreatmentRecord(); document.body.classList.remove('dark-screen'); });

  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
