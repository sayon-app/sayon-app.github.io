// The quote screen's top bar (with the job's documents) and its total bar
// each fold to a slim row to clear space, and the choice is remembered.
//   (python3 -m http.server 8765 &) ; node tests/quote-bars/e2e.js /tmp/quote-bars
const fs = require('fs');
const { chromium } = require('playwright');
const OUT = process.argv[2] || '/tmp/quote-bars'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf', uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => fs.existsSync(SP + '/package/dist/jspdf.umd.min.js') ? r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }) : r.fulfill({ body: '', contentType: 'application/javascript' }));
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } }));
  await ctx.route(/supabase\.co/, r => r.request().url().includes('businesses?owner_id') ? r.fulfill({ json: [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] }) : r.fulfill({ json: [] }));
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1', '1'); }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  await p.evaluate(async ({ sc }) => {
    // Business setup is covered by the full-chain test; step past it here.
    storeCompanyDetails(sc.company); document.getElementById('onboardScreen').style.display = 'none';
    openApp('inspect'); resetReportState();
    for (const [k, v] of Object.entries(sc.job)) { const el = document.getElementById(k); if (el) el.value = v; }
    updateJob(); await populateFields(sc.fields, '');
  }, { sc });
  await p.waitForTimeout(2000);
  await p.evaluate(() => { saveDraft(); openQuoteFromReport(); });
  await p.waitForTimeout(1200);

  const measure = () => p.evaluate(() => {
    const vis = el => !!el && el.offsetParent !== null && el.getBoundingClientRect().height > 0;
    const s = document.getElementById('quoteScreen');
    return {
      top: document.querySelector('#quoteScreen .quote-topbar').getBoundingClientRect().height,
      strip: vis(document.querySelector('#quoteScreen .doc-strip-bar')),
      bar: document.getElementById('quoteBar').getBoundingClientRect().height,
      send: vis(document.getElementById('quoteEmailBtn')), pdf: vis(document.getElementById('quotePdfBtn')),
      amount: vis(document.getElementById('quoteBarAmount')) && document.getElementById('quoteBarAmount').textContent,
      scroll: document.querySelector('#quoteScreen .quote-scroll').getBoundingClientRect().height,
      topOpen: document.getElementById('quoteTopFold').getAttribute('aria-expanded'),
      barOpen: document.getElementById('quoteBottomFold').getAttribute('aria-expanded'),
      folded: [s.classList.contains('top-folded'), s.classList.contains('bottom-folded')],
    };
  });
  const open = await measure();
  check(open.strip && open.send && open.pdf && open.topOpen === 'true' && open.barOpen === 'true' && !open.folded[0] && !open.folded[1], 'both bars start open, with the documents, PDF and Send');
  await p.screenshot({ path: `${OUT}/1-open.png` });

  await p.click('#quoteTopFold');
  await p.click('#quoteBottomFold');
  await p.waitForTimeout(300);
  const shut = await measure();
  check(!shut.strip && shut.top < open.top && shut.topOpen === 'false', `the top bar folds to one slim row without the documents (${Math.round(open.top)} → ${Math.round(shut.top)} px)`);
  check(!shut.send && !shut.pdf && shut.amount && /\$/.test(shut.amount) && shut.bar < open.bar && shut.barOpen === 'false', `the total bar folds to the total alone (${Math.round(open.bar)} → ${Math.round(shut.bar)} px)`);
  check(shut.scroll - open.scroll > 70, `the quote gets more room (${Math.round(open.scroll)} → ${Math.round(shut.scroll)} px)`);
  await p.screenshot({ path: `${OUT}/2-folded.png` });

  // Remembered on this device.
  await p.evaluate(() => { closeQuote(); });
  await p.reload(); await p.waitForTimeout(3000);
  await p.evaluate(() => { document.getElementById('onboardScreen').style.display = 'none'; });
  await p.evaluate(() => openQuote('menu', 'draft'));
  await p.waitForTimeout(1000);
  const again = await measure();
  check(again.folded[0] && again.folded[1] && !again.strip && !again.send, 'folded bars stay folded after a reload');

  await p.click('#quoteTopFold');
  await p.click('#quoteBottomFold');
  await p.waitForTimeout(300);
  const back = await measure();
  check(back.strip && back.send && back.pdf && back.topOpen === 'true' && back.barOpen === 'true', 'tapping again opens both');

  // Small phone: the open bar still fits on one row.
  await p.setViewportSize({ width: 320, height: 640 });
  await p.waitForTimeout(300);
  const small = await p.evaluate(() => { const bar = document.getElementById('quoteBar'); return bar.scrollWidth <= bar.clientWidth + 1; });
  check(small, 'the total bar fits a 320 px phone');
  await p.screenshot({ path: `${OUT}/3-small-open.png` });

  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
