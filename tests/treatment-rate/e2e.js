// The treatment record's application rate comes from the chemical register
// when it isn't said: the label use that fits the methods ticked and where
// the product went is picked; several uses with the same mix give the mix;
// a rate typed or said is never replaced, and a product not in the
// register is left alone.
// node e2e.js <outDir>   (serve the repo on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/treatment-rate'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf', uid = 'u-new';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'owner@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
const emails = [];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, async r => {
    const u = r.request().url(); let body = {}; try { body = r.request().postDataJSON() || {}; } catch (e) {}
    if (u.includes('/send-email')) { if (body.check) return r.fulfill({ json: { configured: true } }); emails.push(body); return r.fulfill({ json: { ok: true } }); }
    return r.fulfill({ json: { plan: 'trial', status: 'trialing', ai_calls_used_this_period: 0, limit: 50 } });
  });
  await ctx.route(/supabase\.co/, r => {
    const u = r.request().url(), m = r.request().method();
    if (u.includes('/rest/v1/businesses') && m === 'POST') return r.fulfill({ json: [{ id: 'b-new', name: 'Example Pest Co', owner_id: uid, settings: {} }] });
    return r.fulfill({ json: [] });
  });
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); }, sess);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  const shot = async (name) => { await p.waitForTimeout(350); await p.screenshot({ path: `${OUT}/${name}.png` }); };
  const tap = async (loc, what) => { try { await loc.scrollIntoViewIfNeeded({ timeout: 3000 }); await loc.tap({ timeout: 5000 }); return true; } catch (e) { check(false, 'tap ' + what + ': ' + e.message.split('\n')[0]); return false; } };

  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  await p.fill('#ob-companyName', 'Example Pest Co');
  await p.fill('#ob-licence', 'NSW 123456');
  await p.fill('#ob-phone', '0400 000 000');
  await tap(p.locator('#obBusinessSave'), 'Continue (business)');
  await p.evaluate(() => obNext(1)); await p.waitForTimeout(300);
  await p.evaluate(() => obShowPanel(3)); await p.waitForTimeout(300);
  await tap(p.getByRole('button', { name: /See a finished sample job first/i }), 'See a finished sample job first');
  await p.waitForTimeout(1800);

  await p.evaluate(() => { closeJobPage(); jobGo('quote'); }); await p.waitForTimeout(1200);
  const rows = () => p.evaluate(() => readTreatmentProducts().map(r => ({ name: r.name, useId: r.useId || '', use: r.use || '', rate: r.rate, life: r.life })));
  const termidor = await p.evaluate(() => findChemical('Termidor').uses.map(u => ({ id: u.id, surface: u.surface, rate: u.rate, full: chemicalUseRate(u), life: u.life })));
  const perimeter = termidor.find(u => /Perimeter/.test(u.surface));

  // A new record, then the product said with where it went.
  await p.evaluate(() => { delete quoteState.treatment; openTreatmentRecord(); }); await p.waitForTimeout(800);
  await p.evaluate(() => applyTreatmentVoice({ products: [{ name: 'Termidor', where: 'Trenched and rodded around the perimeter, 48 metres' }], methods: { barrier: { qty: 48 } } }));
  let r = (await rows())[0];
  console.log('said perimeter:', JSON.stringify(r));
  check(r.useId === perimeter.id && r.rate === perimeter.full && r.life === perimeter.life, 'Termidor around the perimeter takes the perimeter use\'s rate and life from the register');
  await p.screenshot({ path: `${OUT}/1-perimeter.png` });

  // Two places, one mix.
  await p.evaluate(() => { renderTreatmentProducts([{ name: 'Termidor', where: 'Perimeter trench and drilled the slab at the back door' }]); fillTreatmentRatesFromRegister(); });
  r = (await rows())[0];
  check(!r.useId && r.rate === perimeter.rate, 'perimeter and under the slab share a mix: the mix goes in and the use is left to pick: ' + r.rate);
  // Then where narrows to one: the mix becomes the whole use.
  await p.evaluate(() => { const w = document.querySelector('#trProducts [data-f="where"]'); w.value = 'Subfloor, around the piers'; w.dispatchEvent(new Event('change')); });
  r = (await rows())[0];
  check(/Subfloor/.test(r.use) && r.rate === termidor.find(u => /Subfloor/.test(u.surface)).full, 'once where it went names one use, the mix becomes that use\'s whole rate');

  // A rate typed stays, and so does a product the register doesn't have.
  await p.evaluate(() => { renderTreatmentProducts([{ name: 'Termidor', rate: '60 mL per 10 L', where: 'perimeter' }, { name: 'Mystery juice', where: 'perimeter' }]); fillTreatmentRatesFromRegister(); });
  const two = await rows();
  check(two[0].rate === '60 mL per 10 L' && !two[0].useId, 'a rate already there is never replaced');
  check(!two[1].rate, 'a product not in the register is left for the technician');

  // Two methods with different mixes and no place said: nothing guessed.
  await p.evaluate(() => { document.getElementById('trAreas').value = ''; document.querySelectorAll('#trMethods input[type=checkbox]').forEach(b => { b.checked = b.dataset.key === 'barrier' || b.dataset.key === 'direct'; }); renderTreatmentProducts([{ name: 'Termidor' }]); fillTreatmentRatesFromRegister(); });
  r = (await rows())[0];
  check(!r.rate, 'soil treatment and foam both ticked, nothing said about where: no rate is guessed');

  // Foam into the workings.
  await p.evaluate(() => { document.querySelectorAll('#trMethods input[type=checkbox]').forEach(b => { b.checked = b.dataset.key === 'direct'; }); renderTreatmentProducts([{ name: 'Termidor Foam', where: 'into the workings in the laundry wall' }]); fillTreatmentRatesFromRegister(); });
  r = (await rows())[0];
  check(/Foam/.test(r.use) && !!r.rate, 'Termidor Foam into the workings takes its foam rate: ' + r.rate);

  // A saved record opens as it was saved.
  await p.evaluate(() => { closeTreatmentRecord(); quoteState.treatment = { ...draftTreatment(quoteState), methods: { barrier: 48 }, products: [{ name: 'Termidor', where: 'perimeter', rate: '' }], signature: 'x' }; openTreatmentRecord(); });
  await p.waitForTimeout(500);
  r = (await rows())[0];
  check(!r.rate, 'a saved record with no rate isn\'t changed just by opening it');

  check(!errs.length, 'no page errors: ' + errs.join(' | '));
  await b.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
