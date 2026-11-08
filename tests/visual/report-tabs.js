// Each report step's sections, shot whole (not cut by the scroll box), for
// before and after shots of a step's look. Fills the standard job (or the
// one named), opens each step with its groups open, and shoots each of its
// sections as one image. Prints any section that runs past its card.
// CHECKS=1 then taps through the parts the 2026-11-07 refresh restyled
// (finding cards, Add another finding, a finding's bin, the area prompt on
// Findings, moisture readings, Clear on the signature) and checks each tap
// lands in the report; a FAIL line means a check failed.
// node report-tabs.js <outDir> [w] [scenario] [steps]  (serve the repo on :8765)
// MODES=light,dark adds dark shots; TS=xl shoots at Extra large text.
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/report-tabs'; fs.mkdirSync(OUT, { recursive: true });
const W = +(process.argv[3] || 390), SCN = process.argv[4] || 'standard', uid = 'u-owner';
const STEPS = (process.argv[5] || 'property,areas,findings,conducive,recommendations,finish').split(',');
const MODES = (process.env.MODES || 'light').split(',');
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('./scenarios.js').find(s => s.name === SCN);
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
  }, sc);
  // TS=large or TS=xl shoots at that text size.
  if (process.env.TS) await p.evaluate(ts => setTextSize(ts), process.env.TS);
  await p.waitForTimeout(2500);
  for (const st of STEPS) {
    const secs = await p.evaluate(st => { goStep(st); document.querySelectorAll('details.fgroup').forEach(d => d.open = true); return REPORT_STEPS.find(s => s.id === st).sections; }, st);
    await p.waitForTimeout(500);
    for (const sec of secs) {
      const card = p.locator('#section-' + sec);
      for (const mode of MODES) {
        await p.evaluate(m => { document.body.classList.toggle('dark-screen', m === 'dark'); const t = document.getElementById('toast'); if (t) t.className = 'toast'; }, mode);
        const h = await card.evaluate(c => c.scrollHeight);
        await p.setViewportSize({ width: W, height: Math.min(9000, h + 700) });
        await p.waitForTimeout(350);
        await card.scrollIntoViewIfNeeded();
        await card.screenshot({ path: `${OUT}/${st}-${sec}-${mode}.png` });
      }
      const wide = await card.evaluate(c => [...c.querySelectorAll('*')].filter(e => e.offsetWidth && e.getBoundingClientRect().right > c.getBoundingClientRect().right + 1).map(e => e.className).slice(0, 4));
      if (wide.length) { console.log(`FAIL ${sec}: runs past the card: ${JSON.stringify(wide)}`); fails++; }
      await p.evaluate(() => document.body.classList.remove('dark-screen'));
      await p.setViewportSize({ width: W, height: 844 });
    }
    console.log('shot', st, secs.join(','));
  }
  if (process.env.CHECKS) {
    await p.evaluate(() => goStep('findings'));
    await p.waitForTimeout(400);
    const heads = () => p.evaluate(() => [...document.querySelectorAll('#findingsList .finding-card-header')].map(h => h.className.replace('finding-card-header ', '') + ':' + h.querySelector('.finding-act').textContent));
    const n0 = (await heads()).length;
    console.log('finding heads:', JSON.stringify(await heads()));
    check((await heads()).every(h => /finding-head-(active|inactive|none|unset):/.test(h)), 'each finding head carries its activity');
    // Add another finding: a new card, not answered yet.
    await p.locator('#addFindingBtn').click(); await p.waitForTimeout(300);
    let hs = await heads();
    check(hs.length === n0 + 1 && /unset:Not answered yet/.test(hs[hs.length - 1]), 'Add another finding adds a card not answered yet: ' + hs[hs.length - 1]);
    // Answer it: the head turns red and says Active.
    const last = p.locator('#findingsList .finding-card').last();
    await last.locator('.findings-gate .choice-card', { hasText: 'ACTIVE' }).first().click(); await p.waitForTimeout(300);
    hs = await heads();
    check(/finding-head-active:Active/.test(hs[hs.length - 1]), 'picking Active turns the new head red: ' + hs[hs.length - 1]);
    // Its bin removes it.
    await p.locator('#findingsList .finding-card').last().locator('.finding-remove-btn').click(); await p.waitForTimeout(300);
    check((await heads()).length === n0, 'the bin removes the finding');
    // An area marked evidence found that no finding describes yet.
    const zone = await p.evaluate(() => {
      const z = Object.keys(OBS_ZONES).find(k => !areaEvidence(k).length);
      reportData.areaStatus = reportData.areaStatus || {}; reportData.areaStatus[z] = 'INSPECTED';
      (reportData.areaResult = reportData.areaResult || {})[z] = 'FOUND'; syncObstructionData(); goStep('findings');
      return { id: z, name: zoneName(z), label: OBS_ZONES[z].label.replace(/^The /, '') };
    });
    await p.waitForTimeout(400);
    const prompt = p.locator('#findingsFromAreas .area-finding-prompt').filter({ hasText: zone.name.toLowerCase() });
    check(await prompt.count() === 1, `Findings asks for the evidence in ${zone.name}`);
    await prompt.scrollIntoViewIfNeeded(); await prompt.screenshot({ path: `${OUT}/findings-prompt-light.png` });
    await prompt.locator('.area-finding-add', { hasText: 'Termites' }).click(); await p.waitForTimeout(400);
    hs = await heads();
    const loc = await p.evaluate(() => getFindings().map(f => f.activityLocation || ''));
    check(loc.some(l => l.startsWith(zone.label)), `Termites starts a finding at ${zone.name}: ` + JSON.stringify(loc));
    // Moisture readings: add one, then its bin removes it.
    await p.evaluate(() => { goStep('conducive'); document.querySelectorAll('details.fgroup').forEach(d => d.open = true); }); await p.waitForTimeout(400);
    const rows = () => p.evaluate(() => getMoistureTable().length);
    const r0 = await rows();
    await p.locator('#section-conducive .system-verify .findings-add-btn').click(); await p.waitForTimeout(200);
    check(await rows() === r0 + 1, 'Add a reading adds a row');
    await p.locator('#moistureTableRows .moisture-row').last().locator('.photo-remove-btn').click(); await p.waitForTimeout(200);
    check(await rows() === r0, 'a reading\'s bin removes it');
    // Sign-off: draw, then Clear.
    await p.evaluate(() => goStep('finish')); await p.waitForTimeout(400);
    const pad = p.locator('#sigCanvasInspector'); await pad.scrollIntoViewIfNeeded();
    const bx = await pad.boundingBox();
    await p.mouse.move(bx.x + 30, bx.y + 40); await p.mouse.down(); await p.mouse.move(bx.x + 150, bx.y + 80, { steps: 8 }); await p.mouse.move(bx.x + 240, bx.y + 50, { steps: 8 }); await p.mouse.up();
    await p.waitForTimeout(300);
    const signed = await p.evaluate(() => document.getElementById('sigStatusInspector').textContent);
    await p.locator('#section-signoff .signature-clear-btn', { hasText: 'Clear' }).click(); await p.waitForTimeout(300);
    const cleared = await p.evaluate(() => document.getElementById('sigStatusInspector').textContent);
    check(!/not/i.test(signed) && /not/i.test(cleared), `Clear clears the signature (${signed} → ${cleared})`);
  }
  console.log(errs.length ? 'errors: ' + errs.join(' | ') : 'no page errors');
  if (errs.length) fails++;
  await b.close();
  process.exit(fails ? 1 : 0);
})();
