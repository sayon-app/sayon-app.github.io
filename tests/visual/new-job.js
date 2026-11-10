// The new job page, for before and after shots and a quick check: an
// account with one job already saved taps New job on the Jobs list, then
// types the job in by hand (address, suburb, postcode, client, type) and
// goes back to Jobs. Shoots the empty page, the filled-in page, the Jobs
// list with the new job on it and the job's page once it's saved. Prints
// what it checks; a FAIL line means a check failed.
// node new-job.js <outDir> [w]  (serve the repo on :8765; see README.md)
// MODES=light,dark adds dark shots of the empty page.
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/new-job'; fs.mkdirSync(OUT, { recursive: true });
const W = +(process.argv[3] || 390), uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('./scenarios.js').find(s => s.name === 'standard');
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
  const shoot = async (name, modes = ['light']) => {
    for (const mode of modes) {
      await p.setViewportSize({ width: W, height: 844 });
      await p.evaluate(m => { document.body.classList.toggle('dark-screen', m === 'dark'); const t = document.getElementById('toast'); if (t) t.className = 'toast'; }, mode);
      await p.waitForTimeout(350); await p.screenshot({ path: `${OUT}/${name}-${mode}.png` });
      const h = await p.evaluate(() => { const b = document.querySelector('#jobOverlay.open #jobPageBody, #dashboardOverlay.open #dashboardBody'); return b ? b.scrollHeight + b.getBoundingClientRect().top + 120 : 844; });
      await p.setViewportSize({ width: W, height: Math.max(844, Math.min(4000, Math.ceil(h))) });
      await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/${name}-${mode}-full.png` });
    }
    await p.setViewportSize({ width: W, height: 844 });
    await p.evaluate(() => document.body.classList.remove('dark-screen'));
  };
  // One job already on the account, open on the Jobs list.
  await p.evaluate((sc) => {
    storeCompanyDetails(sc.company); openApp('inspect'); startBlankReport();
    for (const [k, v] of Object.entries(sc.job)) { const el = document.getElementById(k); if (el) el.value = v; }
    updateJob(); saveCurrentReport(true); openDashboard();
  }, sc);
  await p.waitForTimeout(400);

  // New job, from the Jobs list's top bar.
  await p.locator('#dashboardOverlay .topbar-new').click(); await p.waitForTimeout(600);
  const start = await p.evaluate(() => ({ open: document.getElementById('jobOverlay').classList.contains('open'), focus: document.activeElement && document.activeElement.id, addr: document.getElementById('jobAddress').value, date: document.getElementById('jobInspectionDate').value }));
  console.log('new job:', JSON.stringify(start));
  check(start.open && !start.addr, 'New job opens an empty job page');
  check(start.date === await p.evaluate(() => todayIsoDate()), 'the inspection date starts as today');
  await shoot('1-empty', (process.env.MODES || 'light').split(','));

  // Typed in by hand.
  await p.locator('#jobAddress').click(); await p.keyboard.type('14 Wattle Court'); await p.keyboard.press('Escape');
  await p.locator('#jobSuburb').fill('Ringwood');
  await p.locator('#jobPostcode').fill('3134');
  await p.locator('#jobClient').fill('Priya Nair');
  await p.locator('#jobClientPhone').fill('0411 111 111');
  await p.locator('#cards-jobInspectionType .choice-card', { has: p.locator('input[value="Pre-Purchase — Timber Pest"]') }).click();
  await p.waitForTimeout(400);
  const typed = await p.evaluate(() => ({ state: document.getElementById('jobState').value, hero: (document.querySelector('#jobOverlay.open .job-hero-addr') || {}).textContent || '' }));
  console.log('typed:', JSON.stringify(typed));
  check(/Wattle/.test(typed.hero), 'the page shows the address as it is typed');
  await p.evaluate(() => document.getElementById('jobPageBody').scrollTop = 0);
  await shoot('2-typed');

  // Back to Jobs: the new job is on the list. Then its page.
  await p.locator('.tab[data-tab="dashboard"]').click(); await p.waitForTimeout(700);
  const listed = await p.evaluate(() => [...document.querySelectorAll('#dashboardBody .dash-card')].map(c => c.textContent.replace(/\s+/g, ' ').trim().slice(0, 60)));
  console.log('jobs:', JSON.stringify(listed));
  check(listed.some(t => /Wattle/.test(t)), 'the new job is on the Jobs list');
  await shoot('3-jobs');
  await p.locator('.tab[data-tab="job"]').click(); await p.waitForTimeout(700);
  const saved = await p.evaluate(() => ({ isNew: document.getElementById('jobOverlay').classList.contains('new-job'), next: (document.querySelector('#jobPageBody .job-next .dash-next-title') || {}).textContent }));
  check(!saved.isNew && saved.next === 'Get the agreement signed', 'once saved, the job page leads with the agreement: ' + JSON.stringify(saved));
  await shoot('4-saved');
  // Its details: the first of the job's steps, opening in place.
  await p.locator('#jobDetailsHead').click(); await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('jobDetailsHead').scrollIntoView({ block: 'start' }));
  await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/5-details-light.png` });

  // A new job with no address: Open the agreement asks for one first.
  await p.evaluate(() => tabGo('dashboard')); await p.waitForTimeout(500);
  await p.locator('#dashboardOverlay .topbar-new').click(); await p.waitForTimeout(600);
  await p.locator('#jobPageBody .job-next-new .dash-detail-primary').click(); await p.waitForTimeout(500);
  const asked = await p.evaluate(() => ({ focus: document.activeElement && document.activeElement.id, toast: document.getElementById('toast').textContent.trim(), agreement: document.getElementById('agreementOverlay').classList.contains('open') }));
  check(asked.focus === 'jobAddress' && /address/.test(asked.toast) && !asked.agreement, 'Open the agreement with no address asks for it: ' + JSON.stringify(asked));

  // The postcode fills the state, but not over one picked by hand.
  await p.locator('#jobAddress').fill('3 Elm Court'); await p.keyboard.press('Escape');
  await p.locator('#jobPostcode').fill('2600');
  const act = await p.evaluate(() => document.getElementById('jobState').value);
  await p.locator('#cards-jobState .choice-card', { hasText: /^\s*NSW\s*$/ }).click();
  await p.locator('#jobPostcode').fill('3000');
  const kept = await p.evaluate(() => document.getElementById('jobState').value);
  check(act === 'ACT' && kept === 'NSW', `postcode 2600 fills ACT (${act}); a state picked by hand stays (${kept})`);

  // Save it for later: a job booked ahead goes onto the Jobs list.
  await p.locator('#jobPageBody .job-next-new .dash-detail-links button').click(); await p.waitForTimeout(700);
  const later = await p.evaluate(() => ({ jobs: document.getElementById('dashboardOverlay').classList.contains('open'), listed: [...document.querySelectorAll('#dashboardBody .dash-card')].some(c => /Elm Court/.test(c.textContent)) }));
  check(later.jobs && later.listed, 'Save it for later puts the job on the Jobs list: ' + JSON.stringify(later));

  console.log(errs.length ? 'errors: ' + errs.join(' | ') : 'no page errors');
  if (errs.length) fails++;
  await b.close();
  process.exit(fails ? 1 : 0);
})();
