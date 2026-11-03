// The house measured on the quote: each side typed as the tech walks round
// (metres or paces), or the site plan drawn, fills the bait station count and
// barrier metres, draws the house for the treatment record, and goes to SAYON
// so it stops asking.
//   (python3 -m http.server 8765 &) ; node tests/house-perimeter/e2e.js /tmp/house-perimeter
const fs = require('fs');
const { chromium } = require('playwright');
const OUT = process.argv[2] || '/tmp/house-perimeter'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf', uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => fs.existsSync(SP + '/package/dist/jspdf.umd.min.js') ? r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }) : r.fulfill({ body: '', contentType: 'application/javascript' }));
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } }));
  await ctx.route(/supabase\.co/, r => r.request().url().includes('businesses?owner_id') ? r.fulfill({ json: [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] }) : r.fulfill({ json: [] }));
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1', '1'); }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  await p.evaluate(async ({ sc }) => {
    storeCompanyDetails(sc.company); document.getElementById('onboardScreen').style.display = 'none';
    openApp('inspect'); resetReportState();
    for (const [k, v] of Object.entries(sc.job)) { const el = document.getElementById(k); if (el) el.value = v; }
    updateJob(); await populateFields(sc.fields, '');
  }, { sc });
  await p.waitForTimeout(2000);
  await p.evaluate(() => { saveDraft(); openQuoteFromReport(); });
  await p.waitForTimeout(1200);
  // The report offers a barrier or baiting: quote baiting, 12 stations to start.
  await p.evaluate(() => { pickQuoteSystem('bait'); document.getElementById('quoteWorkFold').open = true; });
  await p.waitForTimeout(300);

  const state = () => p.evaluate(() => {
    const q = quoteState, bait = q.items.find(i => i.key === 'bait_install');
    return {
      bait: bait && bait.qty, guess: bait && !!bait.qtyGuess,
      boxes: document.querySelectorAll('#qmSides .qm-side').length,
      result: (document.getElementById('qmResult') || {}).textContent || '',
      note: (document.getElementById('qmNote') || {}).textContent || '',
      lines: [...document.querySelectorAll('#quoteMeasureLines li')].map(li => li.textContent.replace(/\s+/g, ' ').trim()),
      hint: (document.querySelector('#quoteMeasureLines .qm-hint') || {}).textContent || '',
      shape: !!document.querySelector('#qmDraw.qm-draw-shape svg'),
      drawn: !!document.querySelector('#quoteMeasure .qm-thumb svg'),
      per: (document.querySelector('#quoteMeasure .qm-per') || {}).textContent || '',
      sub: document.getElementById('quoteItemCount').textContent,
    };
  });
  const typeSides = async (vals) => {
    await p.evaluate(() => { delete quoteState.houseSides; renderQuoteMeasure(); });
    for (let i = 0; i < vals.length; i++) await p.locator('#qmSides .qm-side').nth(i).fill(String(vals[i]));
    await p.waitForTimeout(150);
  };

  let s = await state();
  check(s.boxes === 2 && s.bait === 12 && s.guess && /1 every 3 m/.test(s.hint) && /Rough is fine/.test(s.note), 'before measuring: two side boxes, 12 stations as a starting amount, and what measuring fills');
  const hash0 = await p.evaluate(() => quoteContentHash(quoteState));

  // Two sides are a length and a width: 15 × 8 m is 46 m round, 16 stations.
  await typeSides([15, 8]);
  s = await state();
  check(/46 m perimeter/.test(s.result) && /length × width/.test(s.note), `two sides count as length × width (${s.result}; ${s.note})`);
  check(s.bait === 16 && !s.guess, `the bait station count fills from it (${s.bait})`);
  check(s.boxes === 3, 'a spare box is ready for the next side');
  check(s.shape, 'the house is drawn from the sides');
  check(s.lines.some(l => /Bait stations 16\sstations · 1\severy\s3\sm\s*✓/.test(l)), `the block says what it filled (${s.lines.join(' | ')})`);
  check(/46 m perimeter/.test(s.sub), `the folded work row shows the perimeter (${s.sub})`);
  check(await p.evaluate(() => document.activeElement && document.activeElement.classList.contains('qm-side')), 'the keyboard stays on the box while typing');
  await p.keyboard.press('Enter');
  check(await p.evaluate(() => [...document.querySelectorAll('#qmSides .qm-side')].indexOf(document.activeElement) === 2), 'Enter moves on to the next side');
  await p.locator('#quoteMeasure').screenshot({ path: `${OUT}/1-two-sides.png` });

  // An L-shaped house walked side by side: 40 m, 14 stations, drawn L.
  await typeSides([12, 8, 4, 3, 8, 5]);
  s = await state();
  check(/40 m perimeter/.test(s.result) && s.bait === 14 && s.shape && /6 sides\./.test(s.note), `six sides walked: ${s.result}, ${s.bait} stations, drawn (${s.note})`);
  const lshape = await p.evaluate(() => { const pl = quoteHousePlan(quoteState); return pl && pl.items[0].k === 'outline' && pl.items[0].pts.length === 6 && Math.round(sitePlanPerimeter(pl)); });
  check(lshape === 40, `the L shape is to scale (${lshape} m round)`);
  await p.evaluate(() => { document.activeElement.blur(); document.querySelector('#quoteWorkFold').scrollIntoView({ block: 'start' }); });
  await p.waitForTimeout(200);
  await p.screenshot({ path: `${OUT}/0-quote-screen.png` });
  await p.locator('#quoteMeasure').screenshot({ path: `${OUT}/2-walked.png` });

  // Odd sides, and sides that don't meet, still give the total.
  await typeSides([12, 8, 12]);
  s = await state();
  check(/32 m/.test(s.result) && /check none was missed/.test(s.note) && !s.shape, `an odd number of sides warns (${s.note})`);
  await typeSides([12, 8, 9, 8]);
  s = await state();
  check(/37 m/.test(s.result) && /don't meet up square/.test(s.note) && !s.shape, `sides that don't meet still total (${s.note})`);

  // A count the inspector typed stays, with a tap to use the measured one.
  await typeSides([15, 8]);
  await p.evaluate(() => updateQuoteItem(quoteState.items.find(i => i.key === 'bait_install').id, 'qty', 14));
  await p.locator('#qmSides .qm-side').nth(1).fill('9');
  await p.waitForTimeout(200);
  s = await state();
  check(/48 m/.test(s.result) && s.bait === 14, `a typed count stays when a side changes (48 m, still ${s.bait})`);
  check(s.lines.some(l => /Bait stations 14\sstations on the quote.*Use 16/.test(l)), `with a tap to use the measured count (${s.lines.join(' | ')})`);
  await p.locator('#quoteMeasure').screenshot({ path: `${OUT}/3-offer.png` });
  await p.click('#quoteMeasureLines .qm-offer .quote-link-btn');
  await p.waitForTimeout(200);
  s = await state();
  check(s.bait === 16, 'Use sets it');

  // Paces: 20 × 10 paces at 0.8 m is 16 × 8 m, 48 m round.
  await p.selectOption('#qmUnit', 'pace');
  await typeSides([20, 10]);
  s = await state();
  check(/48 m/.test(s.result) && s.bait === 16, `paces count at 0.8 m (${s.result})`);
  check(await p.evaluate(() => localStorage.getItem('korva_measure_unit') === 'pace'), 'paces are remembered on the device');

  // The measurement isn't on the client's quote; the quantities it fills are.
  const same = await p.evaluate(() => {
    const q = quoteState, a = quoteContentHash(q);
    const keep = [q.houseSides, q.houseUnit, q.sitePlan]; q.houseSides = ['30', '20']; q.houseUnit = 'm'; q.sitePlan = sitePlanFromSides([30, 20]);
    const b = quoteContentHash(q); [q.houseSides, q.houseUnit, q.sitePlan] = keep;
    return a === b;
  });
  check(same, 'the sides and plan themselves are not quote content');
  check(hash0 !== (await p.evaluate(() => quoteContentHash(quoteState))), 'the filled quantity is');

  // A barrier quoted as a whole job can be priced by the metre in one tap.
  await p.evaluate(() => { quoteState.items.push(newQuoteItem('barrier_job', { source: 'Recommendation: barrier' })); renderQuoteItems(); });
  s = await state();
  check(s.lines.some(l => /priced as a whole job.*Price 48\slm/.test(l)), `a whole-job barrier offers the metres (${s.lines.join(' | ')})`);
  await p.click('#quoteMeasureLines .qm-offer .quote-link-btn');
  await p.waitForTimeout(200);
  const lm = await p.evaluate(() => { const it = quoteState.items.find(i => i.key === 'barrier_lm'); return it && { qty: it.qty, unit: it.unit, job: quoteState.items.some(i => i.key === 'barrier_job') }; });
  check(lm && lm.qty === 48 && lm.unit === 'lm' && !lm.job, 'it becomes 48 lm at the per-metre rate');
  await p.evaluate(() => { quoteState.items = quoteState.items.filter(i => i.key !== 'barrier_lm'); renderQuoteItems(); });

  // SAYON gets the measurement, and is told to use it.
  const ai = await p.evaluate(() => {
    const site = treatmentPlanSite(quoteState);
    const msg = treatmentPlanMessage(treatmentPlanInput(quotePlanReport(), quoteState.address), '', treatmentPlanTechQuote(quoteState), site);
    return { site, msg, prompt: /SITE MEASUREMENTS is the house/.test(TREATMENT_PLAN_PROMPT) };
  });
  check(/House perimeter: about 48 m \(house about 16 × 8 m, paced out\)/.test(ai.site), `SAYON reads the perimeter and how it was got (${ai.site.split('\n')[0]})`);
  check(/SITE MEASUREMENTS \(from the site plan/.test(ai.msg) && ai.prompt, 'it goes in SAYON\'s message, and the prompt says to use it and not ask');

  // A SAYON line with no amount takes the measurement when added.
  const sayon = await p.evaluate(() => {
    const before = quoteState.items.slice();
    quoteState.items.push(newQuoteItem('retic_lm', { qty: tpStartQty('retic_lm'), qtyGuess: true, source: 'SAYON plan (quantity to check)' }));
    renderQuoteItems();
    const it = quoteState.items.find(i => i.key === 'retic_lm');
    const out = { qty: it.qty, source: it.source };
    quoteState.items = before; renderQuoteItems();
    return out;
  });
  check(sayon.qty === 48 && sayon.source === 'SAYON plan', `a starting amount from SAYON takes the measurement (${sayon.qty} lm, "${sayon.source}")`);

  // The treatment record starts from the house drawn from the sides.
  const rec0 = await p.evaluate(() => { const t = draftTreatment(quoteState); return t.plan && { k: t.plan.items[0].k, per: Math.round(sitePlanPerimeter(t.plan)), bait: t.methods.bait }; });
  check(rec0 && rec0.k === 'house' && rec0.per === 48 && rec0.bait === '16', `the treatment record starts with the house drawn from the sides (${JSON.stringify(rec0)})`);

  // Tap the drawing: the editor opens on it, to scale; add paving and save.
  await p.click('#qmDraw');
  await p.waitForTimeout(400);
  const ed = await p.evaluate(() => ({ open: document.getElementById('sitePlanOverlay').classList.contains('open'), note: document.getElementById('spScaleNote').textContent }));
  check(ed.open && /House perimeter about 48 m/.test(ed.note), `the editor opens on the house to scale (${ed.note.slice(0, 40)}…)`);
  await p.evaluate(() => {
    const E = sitePlanEditor;
    E.plan.items.push({ id: planId(), k: 'paving', x: 250, y: 600, w: 500, h: 90, label: 'Rear paving' });
    E.plan.items.push({ id: planId(), k: 'tree', x: 120, y: 120, label: 'Gum stump' });
    saveSitePlan();
  });
  await p.waitForTimeout(300);
  s = await state();
  check(s.drawn && !s.boxes && /48 m/.test(s.per) && s.bait === 16, `once drawn, the block shows the plan and its perimeter (${s.per})`);
  await p.locator('#quoteMeasure').screenshot({ path: `${OUT}/4-drawn.png` });
  const site2 = await p.evaluate(() => treatmentPlanSite(quoteState));
  check(/from the site plan/.test(site2) && /Also drawn: paving or concrete \(Rear paving\), tree or stump \(Gum stump\)/.test(site2), `SAYON hears what else is drawn (${site2.split('\n').pop()})`);

  // Stations drawn count instead of the spacing.
  await p.evaluate(() => {
    openQuoteSitePlan();
    for (let i = 0; i < 10; i++) sitePlanEditor.plan.items.push({ id: planId(), k: 'inground', x: 200 + i * 60, y: 160, n: i + 1 });
    saveSitePlan();
  });
  await p.waitForTimeout(300);
  s = await state();
  check(s.bait === 10 && s.lines.some(l => /Bait stations 10\sstations\s*✓/.test(l)), `stations drawn set the count (${s.bait})`);
  const rec = await p.evaluate(() => { const t = draftTreatment(quoteState); return { items: t.plan && t.plan.items.length, bait: t.methods.bait }; });
  check(rec.items >= 13 && rec.bait === '10', `the treatment record starts with the drawn plan (${rec.items} items, ${rec.bait} stations)`);

  // Saving the editor untouched with nothing measured keeps no plan.
  await p.evaluate(() => { quoteState.sitePlan = null; delete quoteState.houseSides; renderQuoteMeasure(); openQuoteSitePlan(); saveSitePlan(); });
  await p.waitForTimeout(200);
  s = await state();
  check(s.boxes === 2 && !(await p.evaluate(() => quoteState.sitePlan)), 'saving the editor untouched keeps no plan, and the side boxes come back');

  // Once the client has answered, measuring fills nothing by itself.
  const answered = await p.evaluate(() => {
    const q = quoteState, it = q.items.find(i => i.key === 'bait_install');
    it.qty = 12; it.qtyGuess = true; q.answer = { status: 'accepted', hash: quoteContentHash(q) };
    q.houseUnit = 'm'; q.houseSides = ['15', '8']; renderQuoteItems();
    const out = { qty: it.qty, offer: [...document.querySelectorAll('#quoteMeasureLines .qm-offer')].length };
    delete q.answer; return out;
  });
  check(answered.qty === 12 && answered.offer === 1, 'after the client answers, the count stays and a tap is offered instead');

  // Small phone: the boxes fit.
  await p.evaluate(() => { quoteState.houseSides = ['12', '8', '4', '3', '8', '5']; renderQuoteMeasure(); });
  await p.setViewportSize({ width: 320, height: 640 });
  await p.waitForTimeout(300);
  const fit = await p.evaluate(() => { const el = document.querySelector('#quoteMeasure'); return el.scrollWidth <= el.clientWidth + 1 && document.documentElement.scrollWidth <= 321; });
  check(fit, 'the side boxes fit a 320 px phone');
  await p.locator('#quoteMeasure').screenshot({ path: `${OUT}/5-small.png` });

  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
