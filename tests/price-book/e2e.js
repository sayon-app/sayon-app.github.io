// Your prices: a new business sets its own prices once (onboarding, then
// Menu › Your prices), every new quote starts at them, a blank box goes back
// to SAYON's suggestion, and the prices go up to the account for the team.
//   (python3 -m http.server 8765 &) ; node tests/price-book/e2e.js /tmp/price-book
const fs = require('fs');
const { chromium } = require('playwright');
const OUT = process.argv[2] || '/tmp/price-book'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf', uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
const isStartingPriceSafe = it => !it.priceSet;
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => fs.existsSync(SP + '/package/dist/jspdf.umd.min.js') ? r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }) : r.fulfill({ body: '', contentType: 'application/javascript' }));
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } }));
  const patches = [];
  await ctx.route(/supabase\.co/, r => {
    const req = r.request();
    if (req.method() === 'PATCH' && req.url().includes('/businesses')) { patches.push(JSON.parse(req.postData())); return r.fulfill({ status: 204, body: '' }); }
    return req.url().includes('businesses?owner_id') ? r.fulfill({ json: [{ id: 'b1', name: 'Example Pest Co', owner_id: uid, settings: {} }] }) : r.fulfill({ json: [] });
  });
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);

  // 1. Onboarding: business, then the prices step with the common lines.
  check(await p.evaluate(() => document.getElementById('onboardScreen').style.display === 'flex'), 'a new business sees onboarding');
  await p.fill('#ob-companyName', 'Example Pest Co');
  await p.click('#obBusinessSave'); await p.waitForTimeout(400);
  const step = await p.evaluate(() => ({
    shown: document.getElementById('ob-panel-1').style.display,
    rows: [...document.querySelectorAll('#obPriceList .pb-row')].map(r => r.dataset.key),
    hint: document.querySelector('#obPriceList .pb-start')?.textContent,
  }));
  check(step.shown === 'flex', 'Continue on the business step opens Your prices');
  check(step.rows.join() === 'barrier_lm,bait_install,bait_monitor,direct,followup,invasive', 'it asks for the common lines: ' + step.rows.join());
  check(/SAYON suggests \$28/.test(step.hint || ''), 'each blank line shows SAYON\'s suggestion: ' + step.hint);
  await p.fill('#obp-barrier_lm', '$45.50'); await p.press('#obp-barrier_lm', 'Tab');
  await p.fill('#obp-bait_install', '150');
  await p.uncheck('#obGst');
  await p.screenshot({ path: `${OUT}/1-onboarding-prices.png` });
  await p.click('#ob-panel-1 .auth-btn'); await p.waitForTimeout(400);
  const after = await p.evaluate(() => ({ demo: document.getElementById('ob-panel-2').style.display, mem: quotePriceMemory() }));
  check(after.demo === 'flex', 'Continue goes on to the voice demo');
  check(after.mem.barrier_lm === 45.5 && after.mem.bait_install === 150 && after.mem.__gst === false, 'the typed prices and the GST choice are kept: ' + JSON.stringify(after.mem));
  check(!('bait_monitor' in after.mem), 'a line left blank stays at SAYON\'s suggestion');
  await p.evaluate(() => { obNext(2); obFinish(); }); await p.waitForTimeout(2500);

  // 2. Menu › Your prices: every line, grouped, with the onboarding prices in.
  await p.evaluate(() => { closeJobPage(); if (document.getElementById('sidebarPanel').classList.contains('open')) toggleDrawer(); openMenuPage('pricesPanel'); });
  await p.waitForTimeout(400);
  const page = await p.evaluate(() => ({
    title: document.getElementById('drawerTitle').textContent,
    rows: document.querySelectorAll('#pbList .pb-row').length,
    groups: [...document.querySelectorAll('#pbList .settings-group-title')].map(g => g.textContent),
    barrier: document.getElementById('pb-barrier_lm').value,
    status: document.getElementById('pbStatus').textContent,
    summary: document.querySelector('#pricesPanel .job-panel-summary').textContent,
    gstOn: document.getElementById('pbGst').classList.contains('on'),
    button: !!document.getElementById('profileYourPrices'),
  }));
  check(page.title === 'Your prices' && page.rows === 16, 'the page lists all 16 quote lines: ' + page.rows);
  check(page.groups.length === 5, 'in groups: ' + page.groups.join(' / '));
  check(page.barrier === '45.50', 'the barrier price from onboarding is there');
  check(/2 of 16/.test(page.status) && page.summary === '2 of 16 set', 'it says how many are set: ' + page.status);
  check(!page.gstOn, 'GST shows off, as chosen at sign-up');
  check(page.button, 'the account menu has a Your prices button');
  await p.fill('#pb-followup', '310'); await p.press('#pb-followup', 'Tab');
  await p.fill('#pb-barrier_lm', ''); await p.press('#pb-barrier_lm', 'Tab');
  await p.fill('#pb-nest', 'abc'); await p.press('#pb-nest', 'Tab');
  await p.waitForTimeout(200);
  const edited = await p.evaluate(() => ({ mem: quotePriceMemory(), nest: document.getElementById('pb-nest').value, unit: document.querySelector('#pbList .pb-row[data-key="barrier_lm"] .pb-row-unit').textContent }));
  check(edited.mem.followup === 310, 'a price changed here is saved');
  check(!('barrier_lm' in edited.mem) && /SAYON suggests/.test(edited.unit), 'emptying a box goes back to SAYON\'s suggestion');
  check(!('nest' in edited.mem) && edited.nest === '', 'a box that isn\'t a number is not saved');
  await p.fill('#pb-barrier_lm', '52'); await p.press('#pb-barrier_lm', 'Tab');
  await p.fill('#pbTerms', '50% deposit, balance on completion.'); await p.press('#pbTerms', 'Tab');
  await p.evaluate(() => document.querySelector('#sidebarPanel .drawer-scroll').scrollTop = 0);
  await p.screenshot({ path: `${OUT}/2-your-prices.png` });
  await p.evaluate(() => document.getElementById('pb-weep_holes').scrollIntoView());
  await p.screenshot({ path: `${OUT}/3-your-prices-lower.png` });

  // 3. A new quote starts at the business's prices, with no Starting price tag.
  await p.evaluate(async ({ sc }) => {
    toggleDrawer();
    storeCompanyDetails(sc.company);
    openApp('inspect'); resetReportState();
    for (const [k, v] of Object.entries(sc.job)) { const el = document.getElementById(k); if (el) el.value = v; }
    updateJob(); await populateFields(sc.fields, '');
  }, { sc });
  await p.waitForTimeout(2000);
  await p.evaluate(() => { saveDraft(); openQuoteFromReport(); });
  await p.waitForTimeout(1200);
  const q = await p.evaluate(() => ({
    items: quoteState.items.map(i => ({ key: i.key, price: i.price, starting: isStartingPrice(i) })),
    gst: quoteState.gst, terms: quoteState.paymentTerms,
    line: newQuoteItem('barrier_lm').price, follow: newQuoteItem('followup').price, bait: newQuoteItem('bait_monitor').price,
    hint: document.getElementById('quoteStartHint').innerHTML,
  }));
  check(q.line === 52 && q.follow === 310 && q.bait === 480, 'new lines start at the business\'s prices, SAYON\'s where none is set');
  check(q.items.filter(i => i.key in { barrier_lm: 1, followup: 1 }).every(i => !i.starting), 'the business\'s own prices carry no Starting price tag: ' + JSON.stringify(q.items));
  check(q.gst === false, 'the quote starts without GST');
  check(/set all your prices/.test(q.hint), 'while a line is at SAYON\'s price, the quote hint links to Your prices');
  await p.evaluate(() => document.querySelector('#quoteStartHint .quote-hint-link').click()); await p.waitForTimeout(500);
  const over = await p.evaluate(() => { const r = document.getElementById('pbList').getBoundingClientRect(); const el = document.elementFromPoint(195, Math.min(r.top + 30, 700)); return { title: document.getElementById('drawerTitle').textContent, onTop: !!(el && el.closest('#sidebarPanel')), back: !document.getElementById('pbBackToQuote').hidden }; });
  check(over.title === 'Your prices' && over.onTop && over.back, 'the link opens Your prices with a way back to the quote');
  await p.screenshot({ path: `${OUT}/4-from-quote.png` });
  await p.fill('#pb-direct', '420'); await p.press('#pb-direct', 'Tab');
  await p.click('#pbBackToQuote'); await p.waitForTimeout(1200);
  const back = await p.evaluate(() => ({ open: document.getElementById('quoteScreen').classList.contains('open'), direct: quoteState.items.find(i => i.key === 'direct'), total: document.getElementById('quoteWorkTotal').textContent, follow: quoteState.items.find(i => i.key === 'followup').price }));
  check(back.open && back.direct.price === 420 && !isStartingPriceSafe(back.direct), 'back on the quote, a line that was at SAYON\'s price moves to the new price: ' + JSON.stringify(back.direct));
  check(back.follow === 310, 'lines already at the business\'s price are left alone');
  check(/1,?[0-9]{3}|[0-9]{3}/.test(back.total), 'the total updates: ' + back.total);
  await p.screenshot({ path: `${OUT}/5-back-on-quote.png` });

  // 4. The prices go up to the account, so the team's phones get them.
  await p.waitForTimeout(2000);
  const last = patches[patches.length - 1];
  check(last && last.settings.prices.barrier_lm === 52 && last.settings.prices.followup === 310, 'the prices sync to the business account');

  check(!errs.length, 'no page errors: ' + errs.join(' | '));
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  await b.close(); process.exit(fails.length ? 1 : 0);
})();
