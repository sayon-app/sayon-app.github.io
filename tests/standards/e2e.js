// The Australian standards fixes: the standard picker offers only the
// standards a timber pest report is done to, the check sheet flags a
// re-inspection interval over 12 months (AS 3660.2) and fixes it in a tap,
// the drywood termite alert names the state law, and the agreement lists
// every timber pest the report covers.
// node e2e.js <outDir>  (server on :8765)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/standards'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', uid = 'u-owner', SP = process.env.JSPDF_DIR || '/tmp/jspdf';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } }));
  await ctx.route(/supabase\.co/, r => r.fulfill({ json: r.request().url().includes('businesses?owner_id') ? [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] : [] }));
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1', '1'); }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  await p.evaluate(async (sc) => {
    storeCompanyDetails(sc.company); openApp('inspect'); resetReportState();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    for (const [k, v] of Object.entries(sc.job)) set(k, v); updateJob(); await populateFields(sc.fields);
  }, sc);
  await p.waitForTimeout(800);

  // Interval checks, by wording.
  const months = await p.evaluate(() => ['12 months', 'every 2 years', '3 months, then every 12 months', '18 months', 'every other year', 'Annually']
    .map(t => longestInspectionIntervalMonths(t)));
  check(JSON.stringify(months) === JSON.stringify([12, 24, 12, 18, 24, 0]), 'interval wording reads as months: ' + months.join(', '));

  // A two-year interval is flagged on the check sheet, and fixed in a tap.
  await p.evaluate(() => { reportData.inspectionFrequency = 'every 2 years'; renderField(document.getElementById('f-inspectionFrequency'), 'inspectionFrequency', 'every 2 years'); openSendReview(); });
  await p.waitForTimeout(800);
  const g1 = await p.evaluate(() => document.getElementById('sendReviewGaps').innerText);
  check(/next inspection is set 2 years away\. AS 3660\.2 recommends one at least every 12 months/.test(g1), 'check sheet flags the 2 year interval');
  await p.screenshot({ path: `${OUT}/1-interval-gap.png` });
  await p.getByRole('button', { name: 'Make it 12 months' }).click(); await p.waitForTimeout(800);
  const g2 = await p.evaluate(() => ({ text: document.getElementById('sendReviewGaps').innerText, freq: reportData.inspectionFrequency, field: document.getElementById('f-inspectionFrequency').textContent, open: document.getElementById('sendReviewOverlay').classList.contains('open') }));
  check(!/years away/.test(g2.text) && g2.freq === '12 months' && /12 months/.test(g2.field) && g2.open, 'Make it 12 months sets the interval, the gap goes, the sheet stays open');
  await p.screenshot({ path: `${OUT}/2-interval-fixed.png` });
  await p.evaluate(() => closeSendReview());

  // The standard picker.
  const picker = await p.evaluate(() => {
    reportData.standard = 'AS 4349.3-2010';
    const el = document.createElement('div'); document.body.appendChild(el);
    startEdit(el, 'standard', 'standard');
    const opts = [...el.querySelectorAll('option')].map(o => o.value || o.textContent).filter(Boolean);
    cancelEdit(el, 'standard'); el.remove();
    // An older report keeps its own standard on the list.
    reportData.standard = 'AS 4349.1-2007';
    const el2 = document.createElement('div'); document.body.appendChild(el2);
    startEdit(el2, 'standard', 'standard');
    const opts2 = [...el2.querySelectorAll('option')].map(o => o.value || o.textContent).filter(Boolean);
    cancelEdit(el2, 'standard'); el2.remove();
    return { opts, opts2 };
  });
  check(JSON.stringify(picker.opts.filter(o => /^AS/.test(o))) === JSON.stringify(['AS 4349.3-2010', 'AS 3660.2-2017']), 'picker offers AS 4349.3 and AS 3660.2 only: ' + picker.opts.join(' | '));
  check(picker.opts2.includes('AS 4349.1-2007'), 'an older report keeps its saved standard on the list');

  // Drywood alert and agreement wording.
  const words = await p.evaluate(() => ({
    alert: ((lookupSpecies('Cryptotermes brevis') || {}).data || {}).specialFlags?.map(f => f.text).join(' ') || '',
    agreement: DEFAULT_AGREEMENT_TEXT,
  }));
  check(/Biosecurity Act 2014 \(Qld\)/.test(words.alert) && /24 hours on 13 25 23/.test(words.alert) && !/Australian Biosecurity Act/.test(words.alert), 'drywood alert names the Queensland law and the 24 hour rule');
  check(/subterranean and drywood termites/.test(words.agreement) && /chemical delignification/.test(words.agreement), 'agreement lists drywood termites and chemical delignification');
  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
