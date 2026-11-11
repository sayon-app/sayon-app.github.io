// The job page (This job), for before and after shots: a new job, one waiting
// on the agreement, one mid-way (quote sent), one accepted, and the finished sample job.
// Each is shot at the top and in full (a tall viewport).
// node job-page.js <outDir> [w]  (serve the repo on :8765; see README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/job-page'; fs.mkdirSync(OUT, { recursive: true });
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
  await p.evaluate(s => { window.__sc = s; }, sc);
  const stages = {
    '1-new': async () => { storeCompanyDetails(sc.company); openApp('inspect'); resetReportState(); updateJob(); },
    '2-agreement': async () => {
      for (const [k, v] of Object.entries(sc.job)) { const el = document.getElementById(k); if (el) el.value = v; }
      document.getElementById('jobClientPhone').value = '0411 111 111'; document.getElementById('jobClientEmail').value = 'sam@example.com';
      document.getElementById('jobInspectionDate').value = todayIsoDate(); document.getElementById('jobInspectionTime').value = '09:30'; saveJobInfo(); updateJob(); saveCurrentReport(true);
    },
    '3-quote': async () => {
      reportData.agreement = { method: 'onsite', signerName: sc.job.jobClient, date: todayIsoDate(), at: Date.now() };
      await populateFields(sc.fields); saveCurrentReport(true); openQuoteFromReport();
      quoteState.items = [newQuoteItem('bait_install', { qty: '12' }), newQuoteItem('bait_monitor')];
      quoteState.sentAt = Date.now(); persistQuote(); storeQuoteOnReport(quoteState, false); closeQuote();
    },
    '4-accepted': async () => {
      openQuoteFromReport();
      quoteState.answer = { status: 'accepted', by: sc.job.jobClient, date: todayIsoDate(), method: 'signed', note: '', at: Date.now(), hash: quoteContentHash(quoteState) };
      persistQuote(); storeQuoteOnReport(quoteState, false); closeQuote();
    },
    '5-finished': async () => { openSampleJob(); await new Promise(r => setTimeout(r, 1500)); closeQuote && document.getElementById('quoteScreen').classList.contains('open') && closeQuote(); },
  };
  for (const [name, fn] of Object.entries(stages)) {
    await p.evaluate(`(${fn.toString()})()`.replace(/\bsc\b/g, 'window.__sc'), null).catch(e => errs.push(name + ': ' + e.message));
    await p.setViewportSize({ width: W, height: 844 });
    await p.evaluate(() => { closeJobPage(); openJobPage(); });
    await p.waitForTimeout(400); await p.screenshot({ path: `${OUT}/${name}.png` });
    const h = await p.evaluate(() => { const b = document.getElementById('jobPageBody'); return b.scrollHeight + (b.getBoundingClientRect().top) + 120; });
    await p.setViewportSize({ width: W, height: Math.min(4000, Math.ceil(h)) });
    await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/${name}-full.png` });
  }
  console.log(errs.length ? 'errors: ' + errs.join(' | ') : 'no page errors');
  await b.close();
})();
