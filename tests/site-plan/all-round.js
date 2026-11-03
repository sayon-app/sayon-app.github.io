// All round the house: one tap puts a chemical barrier or reticulation just
// outside the walls, or bait stations evenly round it (as many as the
// treatment record counts, else one every 3 m), instead of a tap for every
// corner or station. Works on a turned house and an L shape too.
// node all-round.js <outDir>  (serve the repo on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/site-plan-all-round'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf', uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => fs.existsSync(SP + '/package/dist/jspdf.umd.min.js') ? r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }) : r.fulfill({ body: '', contentType: 'application/javascript' }));
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/sentry|posthog|maps\.googleapis|supabase\.co|workers\.dev/, r => r.fulfill({ status: 200, json: [] }));
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1:u-owner', '1'); localStorage.setItem('korva_onboarded_v1', '1'); }, sess);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);

  // Opened from a record counting 16 stations; the house is 15 m wide.
  await p.evaluate(() => {
    document.getElementById('onboardScreen').style.display = 'none';
    openApp('inspect');
    openSitePlan(null, plan => { window.savedPlan = plan; }, { stations: 16 });
    sitePlanEditor.plan.mpu = 15 / sitePlanEditor.plan.items[0].w;
    renderSitePlanEditor();
    setSitePlanGroup('treat');
  });
  await p.waitForTimeout(300);
  const tray = () => p.evaluate(() => [...document.querySelectorAll('#spTools .sp-round span')].map(s => s.textContent));
  let t = await tray();
  check(t.join('|') === 'Chemical barrier all round|Reticulation all round', `the Treatment tab offers them first (${t.join(', ')})`);
  await p.evaluate(() => setSitePlanGroup('stations'));
  t = await tray();
  check(t[0] === 'Stations all round (16)', `the Stations tab offers the record's count (${t[0]})`);
  const per = await p.evaluate(() => sitePlanPerimeter(sitePlanEditor.plan));
  const note = await p.evaluate(() => document.getElementById('spScaleNote').textContent);
  check(/House walls about \d+ m all round/.test(note), `the scale note gives the walls all round (${note.slice(0, 34)}…)`);

  // Stations: one tap, 16, numbered 1 to 16, outside the walls, inside the plan.
  await p.click('#spTools .sp-round');
  await p.waitForTimeout(200);
  const st = await p.evaluate(() => {
    const E = sitePlanEditor, h = E.plan.items.find(i => i.k === 'house'), pts = planItemPts(h);
    const s = sitePlanStations(E.plan);
    return { n: s.map(x => x.n), outside: s.every(x => !planInside(pts, [x.x, x.y])), inPlan: s.every(x => x.x > 0 && x.x < PLAN_W && x.y > 0 && x.y < PLAN_H),
      first: s[0] && [s[0].x, s[0].y], hint: document.getElementById('spHint').textContent };
  });
  check(st.n.length === 16 && st.n.join(',') === Array.from({ length: 16 }, (_, i) => i + 1).join(','), `16 stations, numbered 1 to 16 (${st.n.length})`);
  check(st.outside && st.inPlan, 'all outside the walls and on the plan');
  check(/16 stations all round, about [\d.]+ m of wall apart/.test(st.hint), `the hint says what was placed (${st.hint.slice(0, 50)}…)`);
  await p.locator('#spCanvas').screenshot({ path: `${OUT}/1-stations.png` });

  // Barrier: one tap, a loop just outside the walls, close to the house's length.
  await p.evaluate(() => { undoSitePlan(); setSitePlanGroup('treat'); });
  check(await p.evaluate(() => sitePlanStations(sitePlanEditor.plan).length === 0 && !/stations all round/.test(document.getElementById('spHint').textContent)), 'Undo takes the stations and their note off in one go');
  await p.click('#spTools .sp-round');
  await p.waitForTimeout(200);
  const bar = await p.evaluate(() => {
    const E = sitePlanEditor, line = E.plan.items.find(i => i.k === 'barrier');
    return line && { loop: !!line.loop, pts: line.pts.length, m: sitePlanLength(E.plan, 'barrier'), shown: !E.sel, hint: document.getElementById('spHint').textContent };
  });
  check(bar && bar.loop && bar.pts === 4 && bar.shown, 'a chemical barrier goes all the way round, shown clear of handles');
  check(bar && bar.m > per && bar.m - per < 2, `its length is the walls' plus a little at the corners (${per.toFixed(1)} → ${bar && bar.m.toFixed(1)} m)`);
  check(bar && /Leave this stretch out/.test(bar.hint), 'the hint says how to leave a stretch out');
  await p.locator('#spCanvas').screenshot({ path: `${OUT}/2-barrier.png` });
  const gap = await p.evaluate(() => {
    const E = sitePlanEditor, line = E.plan.items.find(i => i.k === 'barrier');
    E.sel = line.id; E.part = { type: 'wall', i: 0 }; renderSitePlanEditor();
    const btn = document.getElementById('spPartSplit'), shown = !btn.hidden && btn.textContent;
    splitSitePlanLine();
    const after = E.plan.items.find(i => i.k === 'barrier');
    return { shown, open: after && !after.loop, m: sitePlanLength(E.plan, 'barrier') };
  });
  check(gap.shown === 'Leave this stretch out' && gap.open && gap.m < bar.m, `a stretch not treated comes out of it (${bar.m.toFixed(1)} → ${gap.m.toFixed(1)} m)`);

  // An L-shaped, turned house: the barrier keeps square to it, stations go outside.
  const L = await p.evaluate(() => {
    const E = sitePlanEditor;
    E.plan = { v: 1, north: 0, mpu: 0.03, items: [{ id: 'h1', k: 'outline', label: 'House', pts: [[300, 200], [700, 200], [700, 500], [520, 500], [520, 380], [300, 380]] }] };
    E.sel = null; renderSitePlanTray(); renderSitePlanEditor();
    addSitePlanRound('barrier'); addSitePlanRound('inground');
    const line = E.plan.items.find(i => i.k === 'barrier'), house = E.plan.items[0].pts;
    const s = sitePlanStations(E.plan);
    return { corners: line.pts.length, outside: line.pts.every(q => !planInside(house, q)), st: s.length, stOut: s.every(x => !planInside(house, [x.x, x.y])) };
  });
  check(L.corners === 6 && L.outside, 'round an L shape the barrier has its 6 corners, all outside');
  check(L.st > 5 && L.stOut, `and the stations all sit outside (${L.st})`);
  await p.locator('#spCanvas').screenshot({ path: `${OUT}/3-l-shape.png` });

  // No count on the record and a scale: one every 3 m.
  const auto = await p.evaluate(() => {
    const E = sitePlanEditor;
    openSitePlan(null, () => {});
    E.plan.mpu = 15 / E.plan.items[0].w;
    addSitePlanRound('inground');
    return { n: sitePlanStations(E.plan).length, per: sitePlanPerimeter(E.plan) };
  });
  check(auto.n === Math.ceil(auto.per / 3 - 0.05), `with no count, one every 3 m (${auto.n} for ${auto.per.toFixed(1)} m)`);

  // From the treatment record, the bait count goes to the editor: checked in e2e.js.
  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
