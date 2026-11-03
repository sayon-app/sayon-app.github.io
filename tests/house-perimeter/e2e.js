// The house measured on the quote: its length and width typed in, or the
// site plan drawn, fills the bait station count and barrier metres, carries
// on to the treatment record, and goes to SAYON so it stops asking.
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
      result: (document.getElementById('qmResult') || {}).textContent || '',
      lines: [...document.querySelectorAll('#quoteMeasureLines li')].map(li => li.textContent.replace(/\s+/g, ' ').trim()),
      hint: (document.querySelector('#quoteMeasureLines .qm-hint') || {}).textContent || '',
      inputs: !!document.getElementById('qmLength'), drawn: !!document.querySelector('#quoteMeasure .qm-thumb svg'),
      per: (document.querySelector('#quoteMeasure .qm-per') || {}).textContent || '',
      sub: document.getElementById('quoteItemCount').textContent,
    };
  });

  let s = await state();
  check(s.inputs && s.bait === 12 && s.guess && /1 every 3 m/.test(s.hint), 'before measuring: length and width boxes, 12 stations as a starting amount, and what measuring fills');
  const hash0 = await p.evaluate(() => quoteContentHash(quoteState));

  // Type the house: 15 × 8 m is 46 m round, 16 stations at 1 every 3 m.
  await p.fill('#qmLength', '15');
  await p.fill('#qmWidth', '8');
  await p.waitForTimeout(200);
  s = await state();
  check(/46 m/.test(s.result), `the perimeter shows as you type (${s.result})`);
  check(s.bait === 16 && !s.guess, `the bait station count fills from it (${s.bait})`);
  check(s.lines.some(l => /Bait stations 16\sstations · 1\severy\s3\sm\s*✓/.test(l)), `the block says what it filled (${s.lines.join(' | ')})`);
  check(/46 m perimeter/.test(s.sub), `the folded work row shows the house (${s.sub})`);
  check(await p.evaluate(() => document.activeElement && document.activeElement.id === 'qmWidth'), 'the keyboard stays on the box while typing');
  await p.locator('#quoteMeasure').screenshot({ path: `${OUT}/1-typed.png` });
  await p.evaluate(() => { document.activeElement.blur(); document.querySelector('#quoteWorkFold').scrollIntoView({ block: 'start' }); });
  await p.waitForTimeout(200);
  await p.screenshot({ path: `${OUT}/0-quote-screen.png` });

  // A count the inspector typed stays, with a tap to use the measured one.
  await p.evaluate(() => updateQuoteItem(quoteState.items.find(i => i.key === 'bait_install').id, 'qty', 14));
  await p.fill('#qmWidth', '9');
  await p.waitForTimeout(200);
  s = await state();
  check(/48 m/.test(s.result) && s.bait === 14, `a typed count stays when the size changes (48 m, still ${s.bait})`);
  check(s.lines.some(l => /Bait stations is 14\sstations.*Use 16/.test(l)), `with a tap to use the measured count (${s.lines.join(' | ')})`);
  await p.locator('#quoteMeasure').screenshot({ path: `${OUT}/2-offer.png` });
  await p.click('#quoteMeasureLines .qm-offer .quote-link-btn');
  await p.waitForTimeout(200);
  s = await state();
  check(s.bait === 16, 'Use sets it');

  // The site plan isn't on the client's quote, so measuring alone doesn't
  // count as a change to what was sent; the quantities it fills do.
  const hash = await p.evaluate(() => {
    const q = quoteState, a = quoteContentHash(q);
    const keep = q.sitePlan; q.sitePlan = sitePlanFromSize(20, 10); const b = quoteContentHash(q); q.sitePlan = keep;
    return { same: a === b };
  });
  check(hash.same, 'the plan itself is not quote content');
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
  check(/House perimeter: about 48 m \(house about 15 × 9 m\)/.test(ai.site), `SAYON reads the perimeter and size (${ai.site.split('\n')[0]})`);
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

  // Draw it: the editor opens on the house to scale; add paving and save.
  await p.click('#quoteMeasure .qm-draw');
  await p.waitForTimeout(400);
  const ed = await p.evaluate(() => ({ open: document.getElementById('sitePlanOverlay').classList.contains('open'), note: document.getElementById('spScaleNote').textContent }));
  check(ed.open && /House perimeter about 48 m/.test(ed.note), `the editor opens on the house to scale (${ed.note.slice(0, 40)}…)`);
  await p.evaluate(() => {
    const E = sitePlanEditor;
    E.plan.items.push({ id: planId(), k: 'paving', x: 250, y: 560, w: 500, h: 90, label: 'Rear paving' });
    E.plan.items.push({ id: planId(), k: 'tree', x: 120, y: 120, label: 'Gum stump' });
    saveSitePlan();
  });
  await p.waitForTimeout(300);
  s = await state();
  check(s.drawn && !s.inputs && /48 m/.test(s.per) && s.bait === 16, `once drawn, the block shows the plan and its perimeter (${s.per})`);
  await p.locator('#quoteMeasure').screenshot({ path: `${OUT}/3-drawn.png` });
  const site2 = await p.evaluate(() => treatmentPlanSite(quoteState));
  check(/Also drawn: paving or concrete \(Rear paving\), tree or stump \(Gum stump\)/.test(site2), `SAYON hears what else is drawn (${site2.split('\n').pop()})`);

  // Stations drawn count instead of the spacing.
  await p.evaluate(() => {
    openQuoteSitePlan();
    for (let i = 0; i < 10; i++) sitePlanEditor.plan.items.push({ id: planId(), k: 'inground', x: 200 + i * 60, y: 180, n: i + 1 });
    saveSitePlan();
  });
  await p.waitForTimeout(300);
  s = await state();
  check(s.bait === 10 && s.lines.some(l => /Bait stations 10\sstations\s*✓/.test(l)), `stations drawn set the count (${s.bait})`);

  // The treatment record starts from the plan, so it isn't drawn twice.
  const rec = await p.evaluate(() => { const t = draftTreatment(quoteState); return { items: t.plan && t.plan.items.length, mpu: !!(t.plan && t.plan.mpu), bait: t.methods.bait }; });
  check(rec.items >= 13 && rec.mpu && rec.bait === '10', `the treatment record starts with the quote's plan and count (${rec.items} items, ${rec.bait} stations)`);

  // Saving a lone house with no size keeps nothing.
  await p.evaluate(() => { quoteState.sitePlan = null; renderQuoteMeasure(); openQuoteSitePlan(); saveSitePlan(); });
  await p.waitForTimeout(200);
  s = await state();
  check(s.inputs && !(await p.evaluate(() => quoteState.sitePlan)), 'saving the editor untouched keeps no plan, and the boxes come back');

  // Once the client has answered, measuring fills nothing by itself.
  const answered = await p.evaluate(() => {
    const q = quoteState, it = q.items.find(i => i.key === 'bait_install');
    it.qty = 12; it.qtyGuess = true; q.answer = { status: 'accepted', hash: quoteContentHash(q) };
    q.sitePlan = sitePlanFromSize(15, 8); renderQuoteItems();
    const out = { qty: it.qty, offer: [...document.querySelectorAll('#quoteMeasureLines .qm-offer')].length };
    delete q.answer; return out;
  });
  check(answered.qty === 12 && answered.offer === 1, 'after the client answers, the count stays and a tap is offered instead');

  // Small phone: the size row fits.
  await p.evaluate(() => { quoteState.sitePlan = null; renderQuoteMeasure(); });
  await p.setViewportSize({ width: 320, height: 640 });
  await p.waitForTimeout(300);
  const fit = await p.evaluate(() => { const el = document.querySelector('#quoteMeasure .qm-size'); return el.scrollWidth <= el.clientWidth + 1 && document.documentElement.scrollWidth <= 321; });
  check(fit, 'the size boxes fit a 320 px phone');
  await p.locator('#quoteMeasure').screenshot({ path: `${OUT}/4-small.png` });

  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
