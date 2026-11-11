// Say the quote: one spoken note adds, changes and takes off quote lines
// and sets the terms (js/quote.js SAY THE QUOTE). The AI's answer is canned;
// the test checks what the app sends it and what it does with the answer.
// node e2e.js <outDir>  (server on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/say-quote'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', uid = 'u-owner', SP = process.env.JSPDF_DIR || '/tmp/jspdf';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
let aiAnswer = {}; let lastSystem = '';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => {
    const body = r.request().postData() || '';
    if (/You update a timber pest treatment quote/.test(body)) {
      lastSystem = JSON.parse(body).system;
      return r.fulfill({ json: { content: [{ type: 'text', text: JSON.stringify(aiAnswer) }] } });
    }
    return r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } });
  });
  await ctx.route(/supabase\.co/, r => r.fulfill({ json: r.request().url().includes('businesses?owner_id') ? [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] : [] }));
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1', '1'); localStorage.setItem('korva_onboarded_v1:u-owner', '1'); }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  await p.evaluate(async ({ sc }) => {
    storeCompanyDetails(sc.company); openApp('inspect'); resetReportState();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    for (const [k, v] of Object.entries(sc.job)) set(k, v); updateJob();
    await populateFields(sc.fields);
  }, { sc });
  await p.waitForTimeout(2000);
  await p.evaluate(() => openQuoteFromReport()); await p.waitForTimeout(1000);
  await p.screenshot({ path: `${OUT}/1-quote-top.png` });
  const start = await p.evaluate(() => ({ items: quoteState.items.map(i => ({ desc: i.desc, qty: i.qty, unit: i.unit, price: i.price, key: i.key })), box: !!document.getElementById('quoteVoice'), label: document.querySelector('#quoteVoice .sheet-voice-label').textContent }));
  console.log('lines from the report:', start.items.map(i => `${i.desc} ${i.qty} ${i.unit} $${i.price}`).join(' | '));
  check(start.box && start.label === 'Say the quote', 'the quote screen has a Say the quote button');
  // A draft opens on its work: Say the quote, then the lines (open), with
  // the second opinion under them and the client's details last.
  const draft = await p.evaluate(() => {
    const shown = [...document.querySelector('#quoteParts .qp-folds').children].filter(e => e.offsetParent).map(e => e.id);
    const work = document.getElementById('quoteWorkFold'), hero = document.querySelector('.quote-hero-problem-text');
    return { shown, workOpen: work.open, workTop: Math.round(work.getBoundingClientRect().top), vh: innerHeight,
      purposeLines: hero ? Math.round(hero.getBoundingClientRect().height / parseFloat(getComputedStyle(hero).lineHeight)) : 0,
      send: document.getElementById('quoteSendLabel').textContent, filled: document.getElementById('quoteEmailBtn').classList.contains('primary') };
  });
  console.log('draft quote:', JSON.stringify(draft));
  check(draft.shown[0] === 'quoteVoice' && draft.shown[1] === 'quoteWorkFold' && draft.shown.indexOf('quoteAiPlan') === 2 && draft.shown[draft.shown.length - 1] === 'quoteDetailsFold', 'a draft lists Say the quote, the work, the second opinion, then the plan, terms and client: ' + draft.shown.join(', '));
  check(draft.workOpen && draft.workTop < draft.vh * 0.6, `the work is open and starts on the first screen (${draft.workTop}px of ${draft.vh})`);
  check(draft.purposeLines > 0 && draft.purposeLines <= 2, `the purpose of treatment is two lines at most (${draft.purposeLines})`);
  check(/^Email to \S/.test(draft.send) && draft.filled, 'the filled button on a draft says how and to whom: ' + draft.send);

  // Change the first line's quantity and price, take off the last line, add
  // monitoring at a price and a follow-up with no price, and set the terms.
  const n = start.items.length;
  aiAnswer = {
    items: [
      { line: 1, description: start.items[0].desc, qty: 14, unit: null, price: 170 },
      { line: null, description: 'Bait station monitoring for 12 months', qty: 1, unit: 'year', price: 520 },
      { line: null, description: 'Follow-up inspection', qty: null, unit: null, price: null },
    ],
    remove: n > 1 ? [n] : [],
    exclusions: ['Repairs to the tree'], paymentTerms: '50% deposit to book, balance on completion', timeframe: 'Half a day', servicePeriod: '12 months', notes: null,
  };
  await p.evaluate(() => sheetVoiceFill('quote', 'Make it 14 stations at 170. Add monitoring for a year at 520 and a follow up inspection. Take the last one off. 50% deposit, half a day, 12 months service. Repairs to the tree not included.'));
  await p.waitForTimeout(1200);
  const after = await p.evaluate(() => ({
    items: quoteState.items.map(i => ({ desc: i.desc, qty: i.qty, unit: i.unit, price: i.price, key: i.key, priceSet: i.priceSet, source: i.source })),
    terms: quoteState.paymentTerms, excl: quoteState.exclusions, plan: quoteState.plan,
    toast: document.getElementById('toast') ? document.getElementById('toast').innerText : '', fold: document.getElementById('quoteWorkFold').open,
    stored: JSON.parse(localStorage.getItem(quotesStorageKey()))[quoteState.reportKey].items.length,
  }));
  console.log('after:', after.items.map(i => `${i.desc} ${i.qty} ${i.unit} $${i.price}${i.priceSet ? '' : ' (start)'}`).join(' | '));
  check(/1\. .+: \d+ \w+ at \$\d+ each/.test(lastSystem) && lastSystem.includes(start.items[0].desc), 'the AI is shown the current lines, numbered');
  check(after.items[0].qty === 14 && after.items[0].price === 170 && after.items[0].priceSet, 'a spoken change lands on the line it names');
  const mon = after.items.find(i => /monitoring/i.test(i.desc)), fu = after.items.find(i => /follow-up/i.test(i.desc));
  check(mon && mon.key === 'bait_monitor' && mon.price === 520 && mon.unit === 'year', 'a new priced line is added at the price said');
  check(fu && fu.key === 'followup' && fu.price > 0 && fu.source === 'Said on the quote', 'a line said with no price starts at the usual price');
  check(n < 2 || !after.items.some(i => i.desc === start.items[n - 1].desc), 'the line said to come off is gone');
  check(after.items.length === n + 2 - (n > 1 ? 1 : 0) && after.stored === after.items.length, 'the quote is saved with the changes');
  check(after.terms === '50% deposit to book, balance on completion' && /Repairs to the tree\./.test(after.excl), 'payment terms and exclusions set');
  check(after.plan && after.plan.time === 'Half a day' && after.plan.service === '12 months', 'time and service period set on the plan');
  check(/Quote updated \(\d+ changes\)/.test(after.toast), `says how many changes (${after.toast})`);
  check(after.fold, 'the work section opens to show the lines');
  await p.screenshot({ path: `${OUT}/2-after-saying.png` });
  await p.evaluate(() => { document.getElementById('quoteWorkFold').scrollIntoView(); });
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/3-lines.png` });

  // Nothing to change.
  aiAnswer = { items: [], remove: [], exclusions: [], paymentTerms: null, timeframe: null, servicePeriod: null, notes: null };
  await p.evaluate(() => sheetVoiceFill('quote', 'um okay'));
  await p.waitForTimeout(800);
  check(/Nothing in that note changes the quote/.test(await p.evaluate(() => document.getElementById('toast').innerText)), 'a note with nothing for the quote says so');

  // Locked: the button refuses.
  await p.evaluate(() => { reportData.issue = { version: 1, at: Date.now() }; sayQuote(); });
  await p.waitForTimeout(300);
  check(/finalised and locked/.test(await p.evaluate(() => document.getElementById('toast').innerText)) && await p.evaluate(() => !sheetVoice), 'a locked quote can\'t be changed by voice');
  await p.evaluate(() => { delete reportData.issue; });

  check(errs.length === 0, `no page errors ${errs.join(' | ')}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
