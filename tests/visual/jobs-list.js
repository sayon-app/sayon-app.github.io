// The Jobs list, for before and after shots: a business with a realistic
// mix of jobs (a report under way, one ready to quote, a quote waiting on
// the client, one accepted, one treated, a declined one) on each tab, the
// job sheet, and a brand-new business's empty list, in light and dark.
// node jobs-list.js <outDir> [w]  (serve the repo on :8765; see README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/jobs-list'; fs.mkdirSync(OUT, { recursive: true });
const W = +(process.argv[3] || 390), uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('./scenarios.js').find(s => s.name === 'standard');
// Made-up jobs: address, suburb, state, postcode, client, days ago, stage.
const JOBS = [
  ['14 Wattle Street', 'Kew', 'VIC', '3101', 'Priya Nair', 9, 'treated'],
  ['3 Elm Court', 'Epping', 'NSW', '2121', 'Chris Doyle', 6, 'declined'],
  ['88 Ironbark Road', 'Springfield', 'QLD', '4300', 'Mia Wong', 5, 'accepted'],
  ['22 Banksia Drive', 'Epping', 'NSW', '2121', 'Sam Taylor', 3, 'sent'],
  ['5 Fig Lane', 'Castle Hill', 'NSW', '2154', 'Jordan Lee', 1, 'reportDone'],
  ['7 Currawong Crescent', 'Hornsby', 'NSW', '2077', 'Alex Morgan', 0, 'inProgress'],
];
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
  const shoot = async (name) => {
    for (const mode of (process.env.MODES || 'light').split(',')) {
      await p.setViewportSize({ width: W, height: 844 });
      await p.evaluate(m => document.body.classList.toggle('dark-screen', m === 'dark'), mode);
      await p.waitForTimeout(350); await p.screenshot({ path: `${OUT}/${name}-${mode}.png` });
    }
  };
  // A brand-new business: nothing saved yet.
  await p.evaluate((sc) => { storeCompanyDetails(sc.company); openApp('inspect'); resetReportState(); openDashboard(); }, sc);
  await shoot('0-empty');
  await p.evaluate(() => closeDashboard());
  // The jobs.
  await p.evaluate(async ({ sc, JOBS }) => {
    const iso = d => { const t = new Date(); t.setDate(t.getDate() - d); return t.toISOString().slice(0, 10); };
    for (const [street, suburb, state, pc, client, ago, stage] of JOBS) {
      startBlankReport();
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      set('jobAddress', street); set('jobSuburb', suburb); set('jobState', state); set('jobPostcode', pc); set('jobClient', client);
      set('jobInspectionDate', iso(ago)); set('jobInspectionType', 'Pre-Purchase — Timber Pest'); saveJobInfo(); updateJob();
      reportData.agreement = { method: 'onsite', signerName: client, date: iso(ago), at: Date.now() };
      await populateFields(sc.fields);
      if (stage !== 'inProgress') reportData.sent = { at: Date.now() - ago * 864e5 };
      saveCurrentReport(true);
      if (stage === 'inProgress' || stage === 'reportDone') continue;
      openQuoteFromReport();
      quoteState.items = [newQuoteItem('bait_install', { qty: String(8 + ago) }), newQuoteItem('bait_monitor')];
      quoteState.sentAt = Date.now() - (ago - 0.5) * 864e5;
      if (stage === 'accepted' || stage === 'treated' || stage === 'declined') {
        quoteState.answer = { status: stage === 'declined' ? 'declined' : 'accepted', by: client, date: iso(Math.max(0, ago - 1)), method: 'signed', note: '', at: Date.now(), hash: quoteContentHash(quoteState) };
      }
      if (stage === 'treated') { quoteState.treatment = { date: iso(ago - 3) }; quoteState.certificateSentAt = Date.now(); quoteState.items = [newQuoteItem('soil_treatment')]; quoteState.answer.hash = quoteContentHash(quoteState); }
      persistQuote(); storeQuoteOnReport(quoteState, false); closeQuote();
    }
    openDashboard();
  }, { sc, JOBS });
  await shoot('1-todo');
  for (const [tab, n] of [['waiting', '2-waiting'], ['done', '3-done']]) { await p.evaluate(t => setDashboardTab(t), tab); await shoot(n); }
  await p.evaluate(() => { setDashboardTab('todo'); openDashboardDetail(dashboardJobs.find(j => j.group === 'todo').r.id); });
  await shoot('4-sheet');
  console.log(errs.length ? 'errors: ' + errs.join(' | ') : 'no page errors');
  await b.close();
})();
