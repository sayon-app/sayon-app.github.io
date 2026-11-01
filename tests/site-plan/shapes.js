// Site plan shapes: the technician reshapes and turns what's drawn. A
// selected building shows a white dot on each corner, a pink tab on each
// wall and a turn handle. Corners and walls drag; a rectangle stays a
// rectangle; walls push and pull with the walls either side keeping their
// angle; a picked wall takes its real length, or a new corner; a picked
// corner steps in for an L shape or goes; anything turns to any angle; two
// fingers pinch to zoom. Turned and reshaped buildings print on the PDF.
// node shapes.js <outDir>  (serve the repo on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs'); const { execFileSync } = require('child_process');
const OUT = process.argv[2] || '/tmp/site-plan-shapes'; fs.mkdirSync(OUT, { recursive: true });
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
  const sel = () => p.evaluate(() => JSON.parse(JSON.stringify(sitePlanSelected())));
  const handles = () => p.evaluate(() => { const h = sitePlanHandles(sitePlanSelected()); return h && { corners: h.corners, walls: h.walls.map(w => w.mid), turn: h.turn }; });
  // Every corner of a closed shape square (within a degree).
  const square = pts => pts.every((q, i) => { const a = pts[(i - 1 + pts.length) % pts.length], c = pts[(i + 1) % pts.length]; const u = [a[0] - q[0], a[1] - q[1]], v = [c[0] - q[0], c[1] - q[1]]; return Math.abs(u[0] * v[0] + u[1] * v[1]) < 0.02 * Math.hypot(...u) * Math.hypot(...v); });

  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  await p.evaluate(() => { openApp('inspect'); openSitePlan(null, plan => { window.savedPlan = plan; }); });
  await p.waitForTimeout(400);

  // 1. Tap the house: its corners, wall tabs, turn handle and angle show.
  await tapPlan(500, 360);
  let h = await handles();
  check(h && h.corners.length === 4 && h.walls.length === 4 && !(await p.locator('#spTurnRow').isHidden()), 'a tapped house shows 4 corners, 4 wall tabs, a turn handle and its angle');
  await shot('house-handles');

  // 2. A corner drags: the house stays a rectangle, its far corner put.
  await dragPlan(700, 500, 750, 550);
  let it = await sel();
  check(it.x === 300 && it.y === 225 && it.w === 450 && it.h === 325 && !it.pts, 'dragging a corner resizes the house, still a rectangle: ' + JSON.stringify([it.x, it.y, it.w, it.h]));
  // 3. A wall's tab pushes that wall out.
  h = await handles();
  await dragPlan(h.walls[1][0], h.walls[1][1], h.walls[1][0] + 50, h.walls[1][1]);
  it = await sel();
  check(it.x === 300 && it.w === 500 && it.h === 325, 'dragging the right wall\'s tab pushes it out 50: w ' + it.w);
  check(await p.evaluate(() => sitePlanEditor.part && sitePlanEditor.part.type === 'wall' && sitePlanEditor.part.i === 1 && !document.getElementById('spPart').hidden), 'the dragged wall stays picked, with its length and Add a corner');
  // A wall pulled past the far wall stops short of it, so the house can't turn inside out.
  await dragPlan(h.walls[1][0] + 50, h.walls[1][1], 100, h.walls[1][1]);
  it = await sel();
  check(it.x === 300 && it.w >= 25 && it.w < 40, 'a wall pulled through the opposite wall stops just short of it: w ' + it.w);
  await p.click('#spUndo'); it = await sel();
  check(it.w === 500, 'Undo puts it back');
  await p.evaluate(() => { sitePlanEditor.part = null; renderSitePlanEditor(); });

  // 4. The turn handle turns it, clicking to 15°.
  h = await handles();
  const c = await p.evaluate(() => planCentre(planItemPts(sitePlanSelected())));
  const ang = Math.atan2(h.turn[1] - c[1], h.turn[0] - c[0]) + 31 * Math.PI / 180, R = Math.hypot(h.turn[0] - c[0], h.turn[1] - c[1]);
  {
    await p.locator('#spCanvas').scrollIntoViewIfNeeded();
    const a = await at(...h.turn); await p.mouse.move(...a); await p.mouse.down();
    for (let i = 1; i <= 10; i++) { const t = Math.atan2(h.turn[1] - c[1], h.turn[0] - c[0]) + 31 * Math.PI / 180 * i / 10; await p.mouse.move(...await at(c[0] + R * Math.cos(t), c[1] + R * Math.sin(t))); }
    check(/Turned to 30°/.test(await p.locator('#spHint').textContent()), 'while turning, the hint shows the angle');
    await p.mouse.up(); await p.waitForTimeout(80);
  }
  it = await sel();
  check(it.rot === 30 && it.w === 500 && it.h === 325 && !it.pts, 'turning 31° clicks to 30°, the house still a rectangle: rot ' + it.rot);
  check(await p.inputValue('#spAngle') === '30', 'the angle box shows 30');
  await shot('house-turned');
  // The buttons turn by 15° steps, and the box takes any angle.
  await p.click('#spTurnRow .sp-turn-btn >> nth=1'); it = await sel();
  check(it.rot === 45, 'the clockwise button turns to the next 15°: ' + it.rot);
  await p.click('#spTurnRow .sp-turn-btn >> nth=0'); await p.click('#spTurnRow .sp-turn-btn >> nth=0'); await p.click('#spTurnRow .sp-turn-btn >> nth=0'); it = await sel();
  check(it.rot === 0 || it.rot === undefined, 'and anticlockwise back past square: ' + it.rot);
  await p.click('#spTurnRow .sp-turn-btn >> nth=0'); it = await sel();
  check(it.rot === 345, 'anticlockwise from square is 345°: ' + it.rot);
  await p.focus('#spAngle'); await p.fill('#spAngle', '20'); it = await sel();
  check(it.rot === 20, 'typing 20 turns it to 20°');
  // A corner of a turned house drags along the house's own lines.
  h = await handles();
  await dragPlan(h.corners[2][0], h.corners[2][1], h.corners[2][0] - 40, h.corners[2][1] - 60);
  it = await sel();
  check(it.rot === 20 && !it.pts && it.w < 500 && it.h < 325, 'dragging a corner of the turned house resizes it along its own walls: ' + [it.w, it.h]);

  // 5. Undo takes back the last step.
  const before = await sel(); await p.click('#spUndo'); it = await sel();
  check(it.w === 500 && it.rot === 20, 'Undo takes back the corner drag');

  // 6. Pick a wall: its real length sets the scale.
  h = await handles();
  await tapPlan(...h.walls[0]);
  check(await p.evaluate(() => sitePlanEditor.part.type === 'wall' && sitePlanEditor.part.i === 0) && /sets the scale/.test(await p.locator('#spPartLenLabel').textContent()), 'tapping a wall tab picks the wall, and its length sets the scale');
  await p.focus('#spPartMetres'); await p.fill('#spPartMetres', '20');
  check(await p.evaluate(() => Math.abs(sitePlanEditor.plan.mpu - 20 / 500) < 1e-9), 'the wall\'s 20 m gives the plan its scale');
  // With a scale, the length moves the next wall so this one is that long.
  await p.evaluate(() => { sitePlanEditor.part = { type: 'wall', i: 1 }; renderSitePlanEditor(); });
  await p.focus('#spPartMetres'); await p.fill('#spPartMetres', '15');
  it = await sel();
  check(Math.abs(it.h * 0.04 - 15) < 0.01 && it.w === 500 && !it.pts, 'typing 15 m for the side wall makes the house 15 m deep, still a rectangle: ' + it.h * 0.04);

  // 7. Add a corner in a wall, then step a corner in for an L.
  await p.evaluate(() => { sitePlanEditor.part = { type: 'wall', i: 0 }; renderSitePlanEditor(); });
  await p.click('#spPartAdd'); it = await sel();
  check(it.pts && it.pts.length === 5 && it.rot === 20 && await p.evaluate(() => sitePlanEditor.part.type === 'corner' && sitePlanEditor.part.i === 1), 'Add a corner splits the wall, and picks the new corner: ' + (it.pts || []).length);
  await p.click('#spPartRemove'); it = await sel();
  check(it.pts.length === 4 && square(it.pts), 'Remove this corner takes it out again');
  h = await handles();
  await tapPlan(...h.corners[1]);
  check(!(await p.locator('#spPartStep').isHidden()), 'a picked corner offers Step the corner in');
  await p.click('#spPartStep'); it = await sel();
  check(it.pts.length === 6 && square(it.pts), 'stepping the corner in makes an L, every corner square: ' + JSON.stringify(it.pts));
  await shot('house-L');
  // Pushing a wall of the L keeps every corner square.
  h = await handles();
  await dragPlan(h.walls[4][0], h.walls[4][1], h.walls[4][0] - 20, h.walls[4][1] + 40);
  it = await sel();
  check(square(it.pts) && it.pts.length === 6 && await p.evaluate(() => sitePlanEditor.part.type === 'wall' && sitePlanEditor.part.i === 4), 'pushing the long wall of the L out keeps every corner square');
  // The short wall of the step: its middle grabs the wall, not a corner.
  await dragPlan(h.walls[2][0], h.walls[2][1], h.walls[2][0] + 10, h.walls[2][1] + 25);
  it = await sel();
  check(square(it.pts) && await p.evaluate(() => sitePlanEditor.part.type === 'wall' && sitePlanEditor.part.i === 2), 'the step\'s short wall moves as a wall, every corner still square');
  check(/m<\/text>/.test(await p.evaluate(() => document.querySelector('#spCanvas svg').outerHTML)), 'the reshaped house shows each wall\'s length');

  // 8. A line: drag its corner, add a corner in a stretch, pick a stretch.
  await p.evaluate(() => { sitePlanEditor.plan.items.push({ id: 'bar1', k: 'barrier', pts: [[100, 650], [400, 650], [400, 720]] }); sitePlanEditor.sel = 'bar1'; sitePlanEditor.part = null; renderSitePlanEditor(); });
  h = await handles();
  check(h.corners.length === 3 && h.walls.length === 2, 'a selected barrier shows its 3 corners and 2 stretch tabs');
  await dragPlan(100, 650, 100, 600); it = await sel();
  check(it.pts[0][0] === 100 && it.pts[0][1] === 600, 'dragging the barrier\'s end moves it: ' + JSON.stringify(it.pts[0]));
  await p.evaluate(() => { sitePlanEditor.part = { type: 'wall', i: 1 }; renderSitePlanEditor(); });
  check(/stretch/.test(await p.locator('#spPartName').textContent()) && (await p.locator('#spPartStep').isHidden()), 'a line\'s stretch is a stretch, and lines don\'t step');
  await p.focus('#spPartMetres'); await p.fill('#spPartMetres', '4'); it = await sel();
  check(Math.abs(Math.hypot(it.pts[2][0] - it.pts[1][0], it.pts[2][1] - it.pts[1][1]) * 0.04 - 4) < 0.01, 'the last stretch of the barrier takes its real length, 4 m');

  // 9. Two fingers pinch to zoom, and the first finger's touch doesn't move anything.
  await p.evaluate(() => { sitePlanEditor.sel = null; sitePlanEditor.part = null; renderSitePlanEditor(); });
  const plan0 = await p.evaluate(() => JSON.stringify(sitePlanEditor.plan.items));
  const cdp = await ctx.newCDPSession(p);
  await p.locator('#spCanvas').scrollIntoViewIfNeeded();
  const bb = await p.locator('#spCanvas svg').boundingBox(), mx = bb.x + bb.width / 2, my = bb.y + bb.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: mx - 30, y: my, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: mx - 20, y: my + 10, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: mx - 20, y: my + 10, id: 1 }, { x: mx + 30, y: my, id: 2 }] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: mx - 20 - i * 8, y: my + 10, id: 1 }, { x: mx + 30 + i * 8, y: my, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(200);
  const z = await p.evaluate(() => ({ zoom: sitePlanEditor.zoom, pinch: sitePlanEditor.pinch, items: JSON.stringify(sitePlanEditor.plan.items) }));
  check(z.zoom > 2 && !z.pinch, 'pinching out zooms in: ' + z.zoom.toFixed(2));
  check(z.items === plan0, 'the pinch leaves the plan as it was');
  await shot('pinched');
  await p.evaluate(() => { sitePlanEditor.zoom = 1; renderSitePlanEditor(); });

  // 10. A turned deck and a turned, reshaped subfloor print: the PDF page.
  await p.evaluate(() => {
    sitePlanEditor.plan.items.push({ id: 'dk', k: 'deck', x: 650, y: 80, w: 250, h: 125, label: 'Deck', rot: 30 });
    setSitePlanLayer('sub');
  });
  const sub = await p.evaluate(() => planLayerItems(sitePlanEditor.plan, 'sub').map(i => ({ k: i.k, pts: (i.pts || []).length, rot: i.rot })));
  check(sub.some(s => s.k === 'subfloor' && s.pts === 6 && s.rot === 20), 'the subfloor starts as the L-shaped, turned house: ' + JSON.stringify(sub));
  await shot('subfloor-L');
  await p.evaluate(() => saveSitePlan());
  const saved = await p.evaluate(() => window.savedPlan);
  const svg = await p.evaluate(plan => sitePlanSVG(plan), saved);
  check(/<polygon/.test(svg) && (svg.match(/<polyline/g) || []).length > 20, 'the turned deck is hatched inside its turned outline');
  const pdf = await p.evaluate(async (plan) => {
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const h = drawSitePlanPdf(doc, plan, { x: 15, y: 20, w: 180 });
    drawSitePlanLegendPdf(doc, plan, { x: 15, y: 25 + h, w: 180 });
    doc.addPage(); drawSitePlanPdf(doc, plan, { x: 15, y: 20, w: 180, layer: 'sub' });
    const buf = new Uint8Array(await doc.output('blob').arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768)); return btoa(s);
  }, saved);
  fs.writeFileSync(`${OUT}/plan.pdf`, Buffer.from(pdf, 'base64'));
  try { execFileSync('pdftoppm', ['-png', '-r', '70', `${OUT}/plan.pdf`, `${OUT}/plan`]); } catch (e) {}
  const txt = (() => { try { return execFileSync('pdftotext', ['-layout', `${OUT}/plan.pdf`, '-']).toString(); } catch (e) { return ''; } })();
  check(/Deck/.test(txt) && /House/.test(txt) && /Approximate scale/.test(txt), 'the PDF prints the turned house and deck, to scale');
  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
