// The treatment record sheet, for before and after shots: its folds closed,
// then What was done open on the products, in light and dark.
// node treatment-sheet.js <outDir> [w]  (serve the repo on :8765; see README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/treatment-sheet'; fs.mkdirSync(OUT, { recursive: true });
const W = +(process.argv[3] || 390), uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('./scenarios.js').find(s => s.name === 'standard');
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
  await p.evaluate(async ({ sc }) => {
    storeCompanyDetails(sc.company); openApp('inspect'); resetReportState();
    for (const [k, v] of Object.entries(sc.job)) { const el = document.getElementById(k); if (el) el.value = v; } updateJob();
    await populateFields(sc.fields); saveCurrentReport(true); openQuoteFromReport();
    quoteState.items = [newQuoteItem('bait_install', { qty: '12' }), newQuoteItem('bait_monitor')];
    quoteState.answer = { status: 'accepted', by: 'Sam Taylor', date: todayIsoDate(), method: 'signed', note: '', at: Date.now(), hash: quoteContentHash(quoteState) };
    persistQuote(); storeQuoteOnReport(quoteState, false); renderQuoteAnswer();
  }, { sc });
  for (const mode of ['light', 'dark']) {
    await p.evaluate(m => { document.body.classList.toggle('dark-screen', m === 'dark'); closeTreatmentRecord(); openTreatmentRecord(); }, mode);
    await p.waitForTimeout(400);
    await p.evaluate(() => { document.getElementById('trTech').value = 'Alex Example'; document.getElementById('trLicence').value = '57586876'; renderTreatmentFolds(true); document.querySelectorAll('.sheet-fold').forEach(f => f.open = false); document.getElementById('trFold1').scrollIntoView({ block: 'center' }); });
    await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/${mode}-1-folds.png` });
    await p.evaluate(() => { const f = document.getElementById('trFold2'); f.open = true; document.getElementById('trPest').scrollIntoView({ block: 'start' }); });
    await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/${mode}-2-products.png` });
  }
  console.log(errs.length ? 'errors: ' + errs.join(' | ') : 'no page errors');
  await b.close();
})();
