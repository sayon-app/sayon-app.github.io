// The "evidence found" prompt on Findings, when an area is marked evidence
// found in Areas but no finding describes it yet. With Termites out of
// sight (a fresh report), the prompt asks "What was it?" at the top. Once
// Termites is shown with an open finding (no place or description yet), the
// prompt sits inside that card and asks "Write it up here?"; only further
// areas get their own "What was it?" at the top. Starts a fresh report with
// its one empty finding, marks areas evidence found and taps through. Shoots
// the card with the prompt in it.
// Prints what it checks; a FAIL line means a check failed.
// node area-prompt.js <outDir> [w]  (serve the repo on :8765; see README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/area-prompt'; fs.mkdirSync(OUT, { recursive: true });
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
  // A fresh report: the job filled in, nothing in Findings yet, and the
  // interior marked inspected with evidence found.
  const mark = zones => p.evaluate(zones => {
    reportData.areaStatus = reportData.areaStatus || {}; reportData.areaResult = reportData.areaResult || {};
    zones.forEach(z => { reportData.areaStatus[z] = 'INSPECTED'; reportData.areaResult[z] = 'FOUND'; });
    syncObstructionData(); goStep('findings');
  }, zones);
  await p.evaluate((sc) => {
    storeCompanyDetails(sc.company); openApp('inspect'); resetReportState();
    for (const [k, v] of Object.entries(sc.job)) { const el = document.getElementById(k); if (el) el.value = v; }
    updateJob(); renderFindingsUI();
  }, sc);
  await mark(['interior']); await p.waitForTimeout(500);
  const state = () => p.evaluate(() => ({
    top: document.getElementById('findingsFromAreas').hidden ? [] : [...document.querySelectorAll('#findingsFromAreas .area-finding-prompt')].map(e => e.textContent.replace(/\s+/g, ' ').trim()),
    inCard: [...document.querySelectorAll('#findingsList .finding-card')].map(c => { const s = c.querySelector('.finding-area-slot'); return s && !s.hidden ? s.textContent.replace(/\s+/g, ' ').trim() : ''; }),
    findings: getFindings().map(f => ({ act: f.termiteActivity || '', loc: f.activityLocation || '' })),
    heads: [...document.querySelectorAll('#findingsList .finding-card-title')].map(e => e.textContent.trim()),
  }));
  const shoot = async name => {
    const card = p.locator('#findingsList .finding-card').first();
    await p.evaluate(() => { const t = document.getElementById('toast'); if (t) t.className = 'toast'; });
    await p.waitForTimeout(200); await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: `${OUT}/${name}.png` });
  };

  // Termites out of sight: the prompt asks what it was, at the top.
  let s = await state();
  check(s.findings.length === 1 && s.top.length === 1 && /interior\. What was it\?/.test(s.top[0]) && !s.inCard.some(Boolean), 'with Termites out of sight, the prompt asks what it was: ' + JSON.stringify(s));
  // Termites brought in: the prompt is in its one empty finding, not a second one.
  await p.locator('#findingsMore .findings-more-btn', { hasText: 'Termites' }).click(); await p.waitForTimeout(400);
  s = await state();
  check(s.findings.length === 1 && !s.top.length && /interior/.test(s.inCard[0]) && /Write it up here/.test(s.inCard[0]), 'with the one empty finding, the prompt sits inside it: ' + JSON.stringify(s));
  // The quick fill can't answer "no termites" over the interior.
  const nf = await p.evaluate(() => ({ title: document.querySelector('#nothingFound-findings strong').textContent, fillsTermites: nothingFoundBlanks('findings').includes('termites') }));
  check(nf.title === 'Nothing else found' && !nf.fillsTermites, 'the quick fill reads "Nothing else found" and leaves the termite finding: ' + JSON.stringify(nf));
  await shoot('1-in-card');

  // Picking Active first keeps the prompt in the same card.
  await p.locator('#findingsList .finding-card').first().locator('.findings-gate .choice-card', { hasText: 'ACTIVE' }).first().click(); await p.waitForTimeout(400);
  s = await state();
  check(s.findings.length === 1 && s.findings[0].act === 'ACTIVE' && /interior/.test(s.inCard[0]) && !s.top.length, 'after Active the prompt stays in that card: ' + JSON.stringify(s));
  await shoot('2-in-card-active');

  // A second area: it gets its own prompt at the top, which adds a finding.
  await mark(['interior', 'subfloor']); await p.waitForTimeout(400);
  s = await state();
  check(/interior/.test(s.inCard[0]) && s.top.length === 1 && /subfloor too\. What was it\?/.test(s.top[0]), 'a second area is asked about at the top: ' + JSON.stringify(s));
  await p.locator('#findingsFromAreas .area-finding-add', { hasText: 'Termites' }).click(); await p.waitForTimeout(500);
  s = await state();
  check(s.findings.length === 2 && s.findings[0].loc === '' && /^Subfloor/.test(s.findings[1].loc) && /interior/.test(s.inCard[0]), 'its Termites adds a second finding and leaves the first for the interior: ' + JSON.stringify(s));

  // Folded Termites: the prompt moves to the top; unfolded, it's back.
  await p.evaluate(() => { document.getElementById('fg-termites').open = false; }); await p.waitForTimeout(300);
  s = await state();
  check(s.top.length === 1 && /interior/.test(s.top[0]), 'with Termites folded, the prompt shows at the top: ' + JSON.stringify(s.top));
  await p.evaluate(() => { document.getElementById('fg-termites').open = true; }); await p.waitForTimeout(300);
  s = await state();
  check(!s.top.length && /interior/.test(s.inCard[0]), 'unfolded, it goes back into the open finding');

  // Yes: the open finding is for the interior, and nothing else is added.
  await p.locator('#findingsList .finding-area-slot .area-finding-add').click(); await p.waitForTimeout(500);
  s = await state();
  check(s.findings.length === 2 && /^Interior/.test(s.findings[0].loc) && s.heads[0] === 'Interior' && !s.top.length && !s.inCard.some(Boolean), 'Yes puts the interior on that finding, with no prompt left: ' + JSON.stringify(s));

  // Nothing scrolls sideways.
  const wide = await p.evaluate(() => { const c = document.getElementById('section-findings'); return [...c.querySelectorAll('*')].filter(e => e.offsetParent && e.getBoundingClientRect().right > c.getBoundingClientRect().right + 1).map(e => e.className).slice(0, 5); });
  check(!wide.length, 'nothing runs past the card: ' + JSON.stringify(wide));

  console.log(errs.length ? 'errors: ' + errs.join(' | ') : 'no page errors');
  if (errs.length) fails++;
  await b.close();
  process.exit(fails ? 1 : 0);
})();
