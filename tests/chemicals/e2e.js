// The chemical register, end to end (no real network calls):
//   1. Menu › Chemical register lists SAYON's starting products with no
//      rates, and no label link until one is saved (never a search page);
//   2. the owner types a rate for a use, adds a product of their own with
//      a label link, and it syncs to businesses.settings.chemicals;
//   3. on a treatment record, picking the product asks what it's for and
//      fills the active constituent, rate and life; a one-use product
//      fills by itself; a use with no rate says so and "Keep this rate"
//      saves the typed rate to the register;
//   4. the record keeps the use, and the certificate PDF builds.
// node tests/chemicals/e2e.js <outDir>   (serve the repo on :8765 and run
// sh tests/visual/setup.sh first)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/chemicals'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf', uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
const patches = [];

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, acceptDownloads: true });
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } }));
  await ctx.route(/supabase\.co/, r => {
    const req = r.request(), u = req.url();
    if (req.method() === 'PATCH' && u.includes('businesses?id')) { patches.push(req.postDataJSON()); return r.fulfill({ status: 204, body: '' }); }
    if (u.includes('businesses?owner_id')) return r.fulfill({ json: [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] });
    return r.fulfill({ json: [] });
  });
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1', '1'); }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  await p.evaluate(() => { storeCompanyDetails({ name: 'Example Pest Co' }); openApp('inspect'); resetReportState(); });

  // 1. The register page.
  await p.evaluate(() => openMenuPage('chemicalsPanel')); await p.waitForTimeout(400);
  check(await p.locator('#chemicalsPanel .panel-title').innerText() === 'Chemical register', 'the register opens from the menu');
  const names = await p.locator('#chemList .chem-card-name').allInnerTexts();
  check(names.includes('Termidor') && names.includes('Exterra') && names.length >= 10, `starting products listed (${names.length})`);
  check(/uses have no rate yet/.test(await p.locator('#chemStatus').innerText()), 'the status says the rates are still to add');
  await p.screenshot({ path: `${OUT}/1-register.png` });
  const termidor = p.locator('#chemList .chem-card', { has: p.locator('.chem-card-name', { hasText: /^Termidor$/ }) });
  await termidor.locator('summary').click(); await p.waitForTimeout(200);
  check(await termidor.locator('.chem-links a').count() === 0 && /No label or SDS link yet/.test(await termidor.locator('.chem-links').innerText()), 'with no link saved, no Label button');
  check(!/google\.com\/search|pubcris/.test(await p.content()), 'no web search links');
  const perimeter = termidor.locator('.chem-use').first();
  await perimeter.locator('[data-u="rate"]').fill('Test mix rate A'); await perimeter.locator('[data-u="rate"]').dispatchEvent('change');
  await perimeter.locator('[data-u="volume"]').fill('Test amount A'); await perimeter.locator('[data-u="volume"]').dispatchEvent('change');
  await perimeter.locator('[data-u="life"]').fill('Test life A'); await perimeter.locator('[data-u="life"]').dispatchEvent('change');
  await termidor.locator('[data-f="labelUrl"]').fill('example.com/termidor-label.pdf'); await termidor.locator('[data-f="labelUrl"]').dispatchEvent('change');
  check((await termidor.locator('.chem-links a').first().getAttribute('href')) === 'https://example.com/termidor-label.pdf', 'a typed label link becomes the Label link');
  await termidor.locator('summary').scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${OUT}/2-termidor.png` });

  // 2. A product of the business's own.
  await p.click('#chemAdd'); await p.waitForTimeout(200);
  const mine = p.locator('#chemList .chem-card').first();
  await mine.locator('[data-f="name"]').fill('Test Foam X'); await mine.locator('[data-f="name"]').dispatchEvent('change');
  await mine.locator('[data-f="active"]').fill('test active'); await mine.locator('[data-f="active"]').dispatchEvent('change');
  await mine.locator('[data-f="form"]').selectOption('foam');
  const u = mine.locator('.chem-use').first();
  for (const [k, v] of [['method', 'Foam'], ['surface', 'Into wall cavities'], ['rate', 'Test mix B']]) { await u.locator(`[data-u="${k}"]`).fill(v); await u.locator(`[data-u="${k}"]`).dispatchEvent('change'); }
  check(/Test Foam X/.test(await mine.locator('.chem-card-name').innerText()), 'the new product shows its name');
  await p.screenshot({ path: `${OUT}/3-own-product.png` });
  await p.waitForTimeout(2200);
  const last = patches[patches.length - 1];
  check(!!last && last.settings.chemicals && last.settings.chemicals.products.some(x => x.name === 'Test Foam X'), 'the register syncs to the business settings');
  await p.evaluate(() => toggleDrawer());

  // 3. The treatment record.
  await p.evaluate(async ({ sc }) => {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    for (const [k, v] of Object.entries(sc.job)) set(k, v); updateJob();
    await populateFields(sc.fields);
    saveCurrentReport(true);
    openQuoteFromReport();
    quoteState.items = [newQuoteItem('barrier_lm', { qty: '40' })];
    quoteState.answer = { status: 'accepted', by: 'Sam Taylor', date: todayIsoDate(), method: 'signed', note: '', at: Date.now(), hash: quoteContentHash(quoteState) };
    persistQuote(); storeQuoteOnReport(quoteState, false); renderQuoteAnswer();
    openTreatmentRecord();
    document.getElementById('trFold2').open = true;
  }, { sc });
  await p.waitForTimeout(500);
  const row = p.locator('#trProducts .treat-product').first();
  await row.locator('[data-f="name"]').fill('Termidor'); await p.waitForTimeout(100);
  const sel = row.locator('[data-f="useId"]');
  check(await sel.count() === 1, 'a register product asks what it is used for');
  const opts = await sel.locator('option').allInnerTexts();
  console.log('uses:', JSON.stringify(opts));
  check(opts.some(o => /Perimeter/.test(o)) && opts.some(o => /no rate yet/.test(o)), 'the uses list the label uses, marking those with no rate');
  await sel.selectOption({ index: 1 });
  check(await row.locator('[data-f="rate"]').inputValue() === 'Test mix rate A; Test amount A', 'the rate fills from the register');
  check(await row.locator('[data-f="life"]').inputValue() === 'Test life A', 'the life fills from the register');
  check(await row.locator('[data-f="active"]').inputValue() === 'fipronil', 'the active constituent fills');
  await row.scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${OUT}/4-record-filled.png` });
  await sel.selectOption({ index: 2 });
  check(await row.locator('[data-f="rate"]').inputValue() === '', 'a use with no rate clears the filled rate');
  check(await row.locator('.treat-use-note').isVisible(), 'and says there is no rate for it yet');
  await row.locator('[data-f="rate"]').fill('Test mix C');
  check(await row.locator('.treat-keep-rate').isVisible(), '"Keep this rate" shows for a typed rate');
  await p.screenshot({ path: `${OUT}/5-record-no-rate.png` });
  await row.locator('.treat-keep-rate').click();
  const kept = await p.evaluate(() => findChemical('Termidor').uses[1].rate);
  check(kept === 'Test mix C', 'Keep this rate saves it to the register');

  await p.evaluate(() => addTreatmentProduct());
  const row2 = p.locator('#trProducts .treat-product').nth(1);
  await row2.locator('[data-f="name"]').fill('Test Foam X'); await p.waitForTimeout(100);
  check(await row2.locator('[data-f="rate"]').inputValue() === 'Test mix B' && await row2.locator('[data-f="active"]').inputValue() === 'test active', 'a product with one use fills by itself');
  await row2.locator('[data-f="name"]').fill('Unknown Brand Z'); await p.waitForTimeout(100);
  check(await row2.locator('[data-f="useId"]').count() === 0, 'a product not in the register asks nothing');

  const prods = await p.evaluate(() => readTreatmentProducts());
  check(prods[0].useId && /Subterranean termites · Soil treatment/.test(prods[0].use), 'the record keeps the use');
  // Rendering again keeps the chosen use.
  await p.evaluate(() => renderTreatmentProducts(readTreatmentProducts()));
  check(await p.locator('#trProducts .treat-product').first().locator('[data-f="useId"]').inputValue() === prods[0].useId, 'the chosen use stays picked');
  const pdf = await p.evaluate(() => {
    const q = JSON.parse(JSON.stringify(quoteState));
    q.treatment = { date: todayIsoDate(), technician: 'Alex Example', methods: { barrier: '40' }, products: readTreatmentProducts().filter(x => x.name) };
    return buildTreatmentCertificatePDF(q).blob.size;
  }).catch(e => 'error: ' + e.message);
  check(typeof pdf === 'number' && pdf > 1000, 'the certificate PDF builds with the register products (' + pdf + ')');
  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
