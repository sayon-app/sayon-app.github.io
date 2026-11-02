// Site plan lines: a barrier drawn down the left side carries on along the
// north side as one line; a line's end dragged onto another's end joins
// them; a line splits at a corner, and the halves stay apart when another
// corner moves; a barrier tapped back to its first corner goes all the way
// round, and a stretch left out opens it again (a driveway, a gate); Grab
// moves the map without moving what's drawn; reticulation, filling points
// and physical barriers draw, sum up, and print.
// node lines.js <outDir>  (serve the repo on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs'); const { execFileSync } = require('child_process');
const OUT = process.argv[2] || '/tmp/site-plan-lines'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf', uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
let shotN = 0;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/sentry|posthog|maps\.googleapis|supabase\.co|workers\.dev/, r => r.fulfill({ status: 200, json: [] }));
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1:u-owner', '1'); localStorage.setItem('korva_onboarded_v1', '1'); }, sess);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  const shot = async (name) => { await p.waitForTimeout(150); await p.locator('#spCanvas').scrollIntoViewIfNeeded(); await p.screenshot({ path: `${OUT}/${String(++shotN).padStart(2, '0')}-${name}.png` }); };
  // Plan units to the screen, through the current zoom.
  const at = async (x, y) => { const vb = await p.evaluate(() => sitePlanViewBox()); const bb = await p.locator('#spCanvas svg').boundingBox(); return [bb.x + (x - vb[0]) / vb[2] * bb.width, bb.y + (y - vb[1]) / vb[3] * bb.height]; };
  const tapPlan = async (x, y) => { await p.locator('#spCanvas').scrollIntoViewIfNeeded(); const [sx, sy] = await at(x, y); await p.mouse.click(sx, sy); await p.waitForTimeout(60); };
  const dragPlan = async (x0, y0, x1, y1) => { await p.locator('#spCanvas').scrollIntoViewIfNeeded(); const a = await at(x0, y0), c = await at(x1, y1); await p.mouse.move(...a); await p.mouse.down(); for (let i = 1; i <= 10; i++) await p.mouse.move(a[0] + (c[0] - a[0]) * i / 10, a[1] + (c[1] - a[1]) * i / 10); await p.mouse.up(); await p.waitForTimeout(80); };
  const lines = (k = 'barrier') => p.evaluate(k => sitePlanEditor.plan.items.filter(i => i.k === k).map(i => ({ id: i.id, pts: i.pts, loop: !!i.loop })), k);
  const reset = () => p.evaluate(() => { const E = sitePlanEditor; E.plan.items = E.plan.items.filter(i => i.k === 'house'); E.sel = null; E.part = null; E.tool = null; renderSitePlanTray(); renderSitePlanEditor(); });
  const J = v => JSON.stringify(v);

  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  await p.evaluate(() => {
    document.getElementById('splash').style.display = 'none';
    openSitePlan({ v: 1, north: 0, mpu: 0.04, items: [{ id: 'h', k: 'house', x: 300, y: 225, w: 400, h: 275, label: 'House' }] }, plan => { window.savedPlan = plan; });
    setSitePlanGroup('treat');
  });
  await p.waitForTimeout(400);

  // 1. Down the left side, finish; then the north side from its top end: one line.
  await p.evaluate(() => setSitePlanTool('barrier'));
  await tapPlan(275, 525); await tapPlan(275, 200); await p.click('#spFinishLine');
  await p.evaluate(() => setSitePlanTool('barrier'));
  check(await p.evaluate(() => sitePlanJoinEnds('barrier').length) === 2, 'with a barrier down, a new one shows its two ends to carry on from');
  await shot('rings');
  await tapPlan(275, 200); await tapPlan(725, 200); await p.click('#spFinishLine');
  let L = await lines();
  check(L.length === 1 && J(L[0].pts) === J([[275, 525], [275, 200], [725, 200]]), 'the north side carries on from the left side\'s end, as one barrier: ' + J(L));
  await shot('left-and-north');

  // 2. A separate east side, its end dragged onto the north side's end: they join.
  await p.evaluate(() => { sitePlanEditor.plan.items.push({ id: 'E', k: 'barrier', pts: [[725, 525], [725, 250]] }); sitePlanEditor.sel = 'E'; sitePlanEditor.part = null; renderSitePlanEditor(); });
  await dragPlan(725, 250, 728, 206);
  L = await lines();
  check(L.length === 1 && L[0].pts.length === 4 && J([L[0].pts[0], L[0].pts[3]].map(J).sort()) === J(['[275,525]', '[725,525]']), 'dragging a barrier\'s end onto another\'s end joins them: ' + J(L));

  // 3. Split at a middle corner; the halves don't rejoin when a far end moves.
  await p.evaluate(() => { const E = sitePlanEditor; E.sel = E.plan.items.find(i => i.k === 'barrier').id; E.part = { type: 'corner', i: 2 }; renderSitePlanEditor(); });
  check(await p.evaluate(() => !document.getElementById('spPartSplit').hidden && document.getElementById('spPartSplit').textContent === 'Split the line here'), 'a middle corner offers Split the line here');
  await p.evaluate(() => { sitePlanEditor.part = { type: 'corner', i: 0 }; renderSitePlanEditor(); });
  check(await p.evaluate(() => document.getElementById('spPartSplit').hidden), 'an end corner doesn\'t');
  await p.evaluate(() => { sitePlanEditor.part = { type: 'corner', i: 2 }; renderSitePlanEditor(); splitSitePlanLine(); });
  L = await lines();
  check(L.length === 2 && J(L.map(l => l.pts.length).sort()) === '[2,3]', 'the barrier splits in two at the corner: ' + J(L.map(l => l.pts)));
  await p.evaluate(() => { const E = sitePlanEditor; E.sel = E.plan.items.find(i => i.k === 'barrier' && i.pts.length === 3).id; E.part = null; renderSitePlanEditor(); });
  await dragPlan(275, 525, 250, 550);
  L = await lines();
  check(L.length === 2, 'moving the far end of one half leaves the halves apart: ' + J(L.map(l => l.pts)));
  await p.click('#spUndo'); await p.click('#spUndo');
  L = await lines();
  check(L.length === 1 && L[0].pts.length === 4, 'Undo twice puts the one barrier back');

  // 4. All the way round: carry on to the start; the loop measures 62 m.
  await reset();
  await p.evaluate(() => setSitePlanTool('barrier'));
  await tapPlan(275, 200);
  check(/first corner to go all the way round/.test(await p.locator('#spHint').textContent()), 'while drawing, the hint says tapping the first corner goes all the way round');
  await tapPlan(725, 200); await tapPlan(725, 525); await tapPlan(275, 525); await tapPlan(275, 200);
  L = await lines();
  check(L.length === 1 && L[0].loop && L[0].pts.length === 4 && !(await p.evaluate(() => sitePlanEditor.drawing)), 'tapping the first corner again closes the barrier all the way round: ' + J(L));
  check(Math.round(await p.evaluate(() => sitePlanLength(sitePlanEditor.plan, 'barrier'))) === 62, 'and it measures 62 m all the way round');
  check(/62 m/.test(await p.evaluate(() => sitePlanSVG(sitePlanEditor.plan))), 'the plan labels it 62 m');
  check(await p.evaluate(() => { const h = sitePlanHandles(sitePlanSelected()); return h.closed && h.corners.length === 4 && h.walls.length === 4; }), 'its corners and stretches go all the way round');
  check(await p.evaluate(() => sitePlanJoinEnds('barrier').length) === 0, 'a loop has no free ends for another barrier to join');
  await shot('loop');
  // A stretch left out opens it there.
  await p.evaluate(() => { sitePlanEditor.part = { type: 'wall', i: 2 }; renderSitePlanEditor(); });
  check(await p.evaluate(() => !document.getElementById('spPartSplit').hidden && document.getElementById('spPartSplit').textContent === 'Leave this stretch out' && document.getElementById('spPartName').textContent === 'This stretch'), 'a stretch of the loop offers Leave this stretch out');
  await shot('loop-stretch');
  await p.click('#spPartSplit');
  L = await lines();
  check(L.length === 1 && !L[0].loop && J(L[0].pts) === J([[275, 525], [275, 200], [725, 200], [725, 525]]), 'leaving the front stretch out opens the barrier there: ' + J(L));
  check(Math.round(await p.evaluate(() => sitePlanLength(sitePlanEditor.plan, 'barrier'))) === 44, 'and it measures 44 m');
  await p.click('#spUndo');
  L = await lines();
  check(L[0].loop, 'Undo closes it again');
  // A loop corner steps in or goes, and drags without opening.
  await p.evaluate(() => { const E = sitePlanEditor; E.sel = E.plan.items.find(i => i.k === 'barrier').id; E.part = { type: 'corner', i: 1 }; renderSitePlanEditor(); });
  check(await p.evaluate(() => document.getElementById('spPartSplit').hidden && !document.getElementById('spPartStep').hidden && !document.getElementById('spPartRemove').hidden), 'a loop corner offers Step in and Remove');
  await dragPlan(725, 200, 775, 175);
  L = await lines();
  check(L.length === 1 && L[0].loop && J(L[0].pts[1]) === '[775,175]', 'dragging a loop corner reshapes it, still all the way round: ' + J(L));
  // Two barriers whose ends both meet make one loop.
  await reset();
  await p.evaluate(() => { const E = sitePlanEditor; E.plan.items.push({ id: 'A', k: 'barrier', pts: [[275, 525], [275, 200], [725, 200]] }, { id: 'B', k: 'barrier', pts: [[725, 200], [725, 525], [275, 525]] }); mergeSitePlanLine(E.plan.items.find(i => i.id === 'B')); renderSitePlanEditor(); });
  L = await lines();
  check(L.length === 1 && L[0].loop && L[0].pts.length === 4, 'two barriers joined at both ends make one loop: ' + J(L));

  // 5. Grab moves the map, not what's drawn.
  await p.evaluate(() => { sitePlanEditor.sel = null; sitePlanEditor.zoom = 2; renderSitePlanEditor(); });
  await p.click('#spGrab');
  const before = await p.evaluate(() => sitePlanViewBox());
  const itemsBefore = await p.evaluate(() => JSON.stringify(sitePlanEditor.plan.items));
  await dragPlan(500, 375, 400, 300);
  const after = await p.evaluate(() => sitePlanViewBox());
  check(await p.evaluate(() => sitePlanEditor.grab) && (after[0] !== before[0] || after[1] !== before[1]), 'Grab on, dragging moves the map: ' + J([before.slice(0, 2), after.slice(0, 2)]));
  check(await p.evaluate(() => JSON.stringify(sitePlanEditor.plan.items)) === itemsBefore, 'and nothing on the plan moves');
  await p.click('#spGrab');
  await p.evaluate(() => { sitePlanEditor.zoom = 1; sitePlanEditor.cx = PLAN_W / 2; sitePlanEditor.cy = PLAN_H / 2; renderSitePlanEditor(); });

  // 6. Reticulation, a filling point and a physical barrier.
  await reset();
  await p.evaluate(() => setSitePlanTool('retic'));
  await tapPlan(250, 550); await tapPlan(250, 175); await tapPlan(750, 175); await p.click('#spFinishLine');
  await p.evaluate(() => setSitePlanTool('physical'));
  await tapPlan(750, 175); await tapPlan(750, 550);
  check((await lines('physical')).length === 1 && (await lines('retic')).length === 1, 'a physical barrier doesn\'t join onto the reticulation: they stay two lines');
  await p.click('#spFinishLine');
  await p.evaluate(() => setSitePlanTool('fillpoint'));
  await tapPlan(225, 575);
  const s = await p.evaluate(() => ({ sum: document.getElementById('spSummary').textContent, legend: [...document.querySelectorAll('#spLegend li')].map(li => li.textContent.trim()) }));
  check(/reticulation/i.test(s.sum) && /filling point/i.test(s.sum) && /physical barrier/i.test(s.sum), 'the summary names the reticulation, filling point and physical barrier: ' + s.sum);
  check(['Reticulation system', 'Reticulation filling point', 'Physical termite barrier'].every(w => s.legend.some(l => l.endsWith(w))), 'and so does the legend: ' + J(s.legend));
  await shot('retic-physical');

  // 7. The plan prints: a loop barrier, reticulation, physical barrier.
  await p.evaluate(() => { sitePlanEditor.plan.items.push({ id: 'L', k: 'barrier', pts: [[275, 200], [725, 200], [725, 525], [275, 525]], loop: true }); saveSitePlan(); });
  const saved = await p.evaluate(() => window.savedPlan);
  check(saved.items.some(i => i.k === 'barrier' && i.loop), 'the loop is kept when the plan is saved');
  const pdf = await p.evaluate(async (plan) => {
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const h = drawSitePlanPdf(doc, plan, { x: 15, y: 20, w: 180 });
    drawSitePlanLegendPdf(doc, plan, { x: 15, y: 25 + h, w: 180 });
    const buf = new Uint8Array(await doc.output('blob').arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768)); return btoa(s);
  }, saved);
  fs.writeFileSync(`${OUT}/lines.pdf`, Buffer.from(pdf, 'base64'));
  try { execFileSync('pdftoppm', ['-png', '-r', '70', `${OUT}/lines.pdf`, `${OUT}/lines`]); } catch (e) {}
  const txt = (() => { try { return execFileSync('pdftotext', ['-layout', `${OUT}/lines.pdf`, '-']).toString(); } catch (e) { return ''; } })();
  check(/62 m/.test(txt) && /Reticulation system/.test(txt) && /Physical termite barrier/.test(txt) && /Reticulation filling point/.test(txt), 'the PDF prints the loop at 62 m and the new symbols in the legend');
  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
