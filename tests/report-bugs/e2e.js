// Two report bugs from the handover: a "no restrictions" answer printing as
// a restricted place, and two notes about the same spot making two finding
// cards. node e2e.js  (server on :8765; no AI calls: populateFields is fed
// what extraction would return)
const { chromium } = require('playwright');
const PORT = '8765', uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  await ctx.route(/sentry|posthog|maps\.googleapis|fonts\.g/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } }));
  await ctx.route(/supabase\.co/, r => r.fulfill({ json: r.request().url().includes('businesses?owner_id') ? [{ id: 'b1', name: 'Example Pest Co', owner_id: uid, settings: {} }] : [] }));
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1', '1'); }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  await p.evaluate(() => { openApp('inspect'); resetReportState(); });

  // 1. Every area inspected, and a "no restrictions" answer left in the text
  // (an older report's No, or a voice note): restricted access is No.
  const r1 = await p.evaluate(() => {
    Object.keys(OBS_ZONES).forEach(z => { reportData.areaStatus = reportData.areaStatus || {}; reportData.areaStatus[z] = 'INSPECTED'; });
    reportData.noAccessAreas = 'NIL — No restricted access areas at time of inspection.';
    reportData.hinderedAreas = 'No hindered access areas.';
    reportData.hinderedAreasDetail = 'No obstructions.';
    renderAccessSummary();
    const a = accessLimits();
    return { restricted: a.restricted, hindered: a.hindered, highRisk: a.highRisk, answer: hinderedAnswer(), box: document.getElementById('accessRestrictedBox').innerText };
  });
  check(!r1.restricted.length && !r1.hindered.length, 'no-restriction words print no restricted or obstructed place');
  check(!r1.highRisk, 'and no high risk area');
  check(r1.answer === 'NO', 'obstructions answer is No');
  check(!/NIL/.test(r1.box), 'access summary does not show the NIL text');
  // A real restricted place still prints.
  const r1b = await p.evaluate(() => { reportData.noAccessAreas = 'Front bedroom: locked.'; return accessLimits().restricted; });
  check(r1b.length === 1 && /locked/.test(r1b[0][1]), 'a real restricted place still prints');
  // From a voice note, the words are dropped before they're stored.
  const r1c = await p.evaluate(async () => { reportData.noAccessAreas = ''; await populateFields({ noAccessAreas: 'No restricted access areas at the time of inspection', findings: [] }); return reportData.noAccessAreas || ''; });
  check(!r1c, 'a note saying "no restricted access" stores nothing');

  // 2. Findings from two notes about the same spot make one card.
  const cards = async (notes) => p.evaluate(async (notes) => {
    reportData.findings = [];
    for (const n of notes) await populateFields({ findings: n });
    return getFindings().filter(findingHasData).map(f => ({ loc: f.activityLocation, act: f.termiteActivity, sp: f.species }));
  }, notes);
  const F = (loc, act = 'INACTIVE', species = null) => ({ activityLocation: loc, termiteActivity: act, species });
  let c = await cards([[F('skirting board, bedroom three')], [F('skirting boards in bedroom three', 'ACTIVE')]]);
  check(c.length === 1 && c[0].act === 'ACTIVE', 'plural and singular: one card, live activity kept');
  c = await cards([[F('rear bearer, sub-floor')], [F('rear bearers in the subfloor')]]);
  check(c.length === 1, 'sub-floor and subfloor: one card');
  c = await cards([[F('north-east corner of the garage')], [F('northeast corner, garage')]]);
  check(c.length === 1, 'north-east and northeast: one card');
  c = await cards([[F('skirting, bedroom one')], [F('skirting, bedroom two')]]);
  check(c.length === 2, 'bedroom one and bedroom two stay two cards');
  c = await cards([[F('kitchen skirting')], [F('laundry skirting')]]);
  check(c.length === 2, 'kitchen and laundry stay two cards');
  c = await cards([[F('door frame, laundry')], [F(null, 'INACTIVE', 'Coptotermes spp.')]]);
  check(c.length === 1 && c[0].sp === 'Coptotermes spp.' && c[0].loc === 'door frame, laundry', 'a later note with no place fills in the one finding');
  c = await cards([[F('door frame, laundry'), F('kitchen skirting')], [F(null, 'INACTIVE', 'Coptotermes spp.')]]);
  check(c.length === 3, 'with two findings, a note with no place stays its own card');

  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
