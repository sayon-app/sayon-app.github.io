// The month's numbers on Jobs, read from the jobs themselves:
//   1. nothing shows until there's a real job (the sample doesn't count);
//   2. on a phone it's one closed line under the lists, money first;
//   3. opened, it counts the month's reports, treatments, quotes sent and
//      accepted, what was invoiced and paid, and what's owed today;
//   4. "Owed to you now" opens Waiting and closes the numbers;
//   5. last month reads its own figures and doesn't say what's owed in
//      its closed line;
//   6. a business that doesn't invoice from SAYON has no money rows, and
//      an invoice sent from another app isn't counted;
//   7. on a wide screen it's open in the rail, and a rail taller than the
//      window still shows its foot beside a long list.
// node e2e.js <outDir>   (serve the repo on :8765 first; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/jobs-numbers'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf', uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'clean');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const money = v => '$' + Math.round(v).toLocaleString('en-AU');

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } }));
  await ctx.route(/supabase\.co/, r => {
    const req = r.request(), u = decodeURIComponent(req.url());
    if (u.includes('businesses?owner_id')) return r.fulfill({ json: [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] });
    if (u.includes('/rest/v1/reports') && req.method() === 'POST') return r.fulfill({ status: 201, json: [JSON.parse(req.postData())] });
    return r.fulfill({ json: [] });
  });
  await ctx.addInitScript(s => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1', '1'); localStorage.setItem('korva_onboarded_v1:' + s.user.id, '1'); }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  const numbers = () => p.evaluate(() => {
    const el = document.getElementById('dashboardNumbers'), head = el.querySelector('.dash-numbers-head'), body = el.querySelector('.dash-numbers-body');
    const text = n => (n ? n.innerText : '').replace(/\s+/g, ' ').trim();
    const rows = {}; el.querySelectorAll('.dash-numbers-row').forEach(r => { rows[text(r.querySelector('dt'))] = [...r.querySelectorAll('dd')].map(text).filter(Boolean).join(' '); });
    return { hidden: el.hidden, button: !!head && head.tagName === 'BUTTON', expanded: head ? head.getAttribute('aria-expanded') : null,
      month: text(el.querySelector('.dash-numbers-month')), lead: text(el.querySelector('.dash-numbers-lead')), open: !!body && !body.hidden,
      rows, owed: text(el.querySelector('.dash-numbers-owed')), owedIsButton: !!el.querySelector('button.dash-numbers-owed'), other: text(el.querySelector('.dash-numbers-other')) };
  });
  const shot = async name => { await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/${name}.png` }); };

  // 1. No jobs, then only the sample: nothing to count, so nothing shows.
  await p.evaluate(sc => { storeCompanyDetails(sc.company); openApp('inspect'); resetReportState(); startBlankReport(); openDashboard(); }, sc); await p.waitForTimeout(600);
  check((await numbers()).hidden, 'with no jobs the numbers don\'t show');
  await p.evaluate(() => { addSampleJob(); refreshJobsList(); }); await p.waitForTimeout(400);
  check((await numbers()).hidden, 'the sample job alone doesn\'t make numbers');

  // Six made-up jobs beside the sample. Everything "this month" is dated
  // the 1st and everything "last month" the 15th, so the test reads the
  // same on any day.
  //   a  report sent this month, no treatment recommended
  //   b  report and quote sent this month, no answer yet
  //   c  report and quote sent last month; accepted, treated and invoiced
  //      this month; the invoice is overdue
  //   d  the whole job last month, its invoice paid this month
  //   e  this month from report to treatment, invoiced in another app
  //   f  booked for next week
  const totals = await p.evaluate(({ PNG }) => {
    const now = new Date(), DAY = 864e5;
    const at = (months, day) => new Date(now.getFullYear(), now.getMonth() + months, day, 9).getTime();
    const THIS = at(0, 1), LAST = at(-1, 15);
    const signed = ts => ({ method: 'onsite', signerName: 'Client', signature: PNG, signedAt: ts, inspectionDate: isoDate(new Date(ts)), fee: '350', notes: '', standard: 'AS 4349.3-2010', text: 'The agreement.' });
    const mk = (id, street, client, ts, data) => ({ id, address: `${street}, Sampleville QLD 4000`, jobAddress: street, jobSuburb: 'Sampleville', jobState: 'QLD', jobPostcode: '4000', client, inspector: 'Alex Example',
      reportData: Object.assign({ jobInspectionDate: isoDate(new Date(ts)), jobClientEmail: 'client@example.com', riskLevel: 'low' }, data), fieldNotes: {}, savedAt: Date.now() - 5000, cloudSavedAt: Date.now() - 5000, completion: 40 });
    const sent = (ts, treat) => ({ agreement: signed(ts), sent: { at: ts }, treatmentRecommended: treat ? 'YES' : 'NO' });
    setSavedReports(getSavedReports().concat([
      mk('report_a', '1 Ash Street', 'Ari Cole', THIS, sent(THIS, false)),
      mk('report_b', '2 Box Road', 'Bo Lane', THIS, sent(THIS, true)),
      mk('report_c', '3 Cedar Court', 'Cam Ford', LAST, sent(LAST, true)),
      mk('report_d', '4 Dale Avenue', 'Dee Hunt', LAST, sent(LAST, true)),
      mk('report_e', '5 Elm Close', 'Eli Marsh', THIS, sent(THIS, true)),
      mk('report_f', '6 Fern Way', 'Flo Park', Date.now() + 7 * DAY, {}),
    ]));
    const quote = (id, key, qty, sentAt, wonAt, doneAt, invoice) => {
      loadReport(id, true); openQuoteFromReport();
      quoteState.items = [newQuoteItem(key, { qty: String(qty) })];
      quoteState.sentAt = sentAt; quoteState.sentHash = quoteContentHash(quoteState);
      if (wonAt) quoteState.answer = { status: 'accepted', by: 'Client', date: isoDate(new Date(wonAt)), method: 'verbal', note: '', hash: quoteContentHash(quoteState) };
      if (doneAt) { quoteState.treatment = { date: isoDate(new Date(doneAt)), technician: 'Alex Example', products: [] }; quoteState.certificateSentAt = doneAt; }
      if (invoice) Object.assign(ensureInvoice(quoteState), invoice);
      const total = quoteTotals(quoteState).total;
      persistQuote(); storeQuoteOnReport(quoteState, false); closeQuote();
      return total;
    };
    const yesterday = isoDate(new Date(Date.now() - DAY));
    const t = {
      b: quote('report_b', 'barrier_job', 1, THIS),
      c: quote('report_c', 'treatment', 1, LAST, THIS, THIS, { date: isoDate(new Date(THIS)), due: yesterday, sentAt: THIS }),
      d: quote('report_d', 'nest', 2, LAST, LAST, LAST, { date: isoDate(new Date(LAST)), due: isoDate(new Date(LAST + 7 * DAY)), sentAt: LAST, paidAt: THIS, paidDate: isoDate(new Date(THIS)) }),
      e: quote('report_e', 'barrier_lm', 40, THIS, THIS, THIS, { elsewhereAt: THIS }),
    };
    loadReport('report_f', true); openDashboard();
    const name = m => new Date(now.getFullYear(), now.getMonth() + m, 1).toLocaleDateString('en-AU', { month: 'long' });
    return Object.assign(t, { month: name(0), last: name(-1) });
  }, { PNG });
  await p.waitForTimeout(600);
  console.log('totals:', JSON.stringify(totals));

  // 2. On a phone: one closed line under the lists, the money first.
  let n = await numbers();
  console.log('closed:', JSON.stringify(n));
  check(!n.hidden && n.button && n.expanded === 'false' && !n.open, 'with real jobs the numbers are one closed line');
  check(n.month === totals.month && n.lead === `${money(totals.c)} invoiced · ${money(totals.c)} owed`, 'it says the month, what was invoiced and what\'s owed: ' + n.month + ' ' + n.lead);
  const above = await p.evaluate(() => { const r = id => document.getElementById(id).getBoundingClientRect(); return r('dashboardSearchWrap').bottom <= r('dashboardNumbers').top && r('dashboardNumbers').bottom <= r('dashboardJobs').top; });
  check(above, 'it sits under the lists and search, above the jobs');
  await shot('01-phone-closed');

  // 3. Opened: the month's work and money, the sample left out.
  await p.locator('button.dash-numbers-head').tap(); await p.waitForTimeout(300);
  n = await numbers();
  console.log('open:', JSON.stringify(n));
  check(n.open && n.expanded === 'true', 'a tap opens it');
  check(n.rows['Reports sent'] === '3' && n.rows['Treatments done'] === '2', 'reports sent and treatments done are this month\'s, without the sample\'s: ' + n.rows['Reports sent'] + ', ' + n.rows['Treatments done']);
  check(n.rows['Quotes sent'] === `2 ${money(totals.b + totals.e)}` && n.rows['Quotes accepted'] === `2 ${money(totals.c + totals.e)}`, 'quotes sent and accepted, each with its count and value: ' + n.rows['Quotes sent'] + ' | ' + n.rows['Quotes accepted']);
  check(n.rows['Invoiced'] === money(totals.c) && n.rows['Paid'] === money(totals.d), 'invoiced is what went this month, paid is what came in this month: ' + n.rows['Invoiced'] + ' | ' + n.rows['Paid']);
  check(n.owedIsButton && n.owed === `Owed to you now 1 invoice overdue ${money(totals.c)}`, 'what\'s owed today, and that it\'s overdue: ' + n.owed);
  check(n.other === `See ${totals.last}`, 'last month is one tap away: ' + n.other);
  await p.evaluate(() => document.getElementById('dashboardNumbers').scrollIntoView({ block: 'start' }));
  await shot('02-phone-open');

  // 5. Last month reads its own figures.
  await p.locator('.dash-numbers-other').tap(); await p.waitForTimeout(300);
  n = await numbers();
  console.log('last month:', JSON.stringify(n));
  check(n.month === totals.last && n.lead === `${money(totals.d)} invoiced`, 'last month\'s line doesn\'t say what\'s owed today: ' + n.lead);
  check(n.rows['Reports sent'] === '2' && n.rows['Treatments done'] === '1' && n.rows['Quotes sent'] === `2 ${money(totals.c + totals.d)}` && n.rows['Quotes accepted'] === `1 ${money(totals.d)}`
    && n.rows['Invoiced'] === money(totals.d) && n.rows['Paid'] === '$0', 'last month\'s rows are last month\'s: ' + JSON.stringify(n.rows));
  check(n.other === `Back to ${totals.month}`, 'and there\'s a way back: ' + n.other);
  await p.locator('.dash-numbers-other').tap(); await p.waitForTimeout(300);
  check((await numbers()).month === totals.month, 'Back to this month');
  check(await p.evaluate(() => monthNumbers([], -1, new Date(2027, 0, 10)).label) === 'December', 'January\'s last month is December');

  // 4. Owed to you now: the Waiting list, and the numbers close.
  await p.locator('button.dash-numbers-owed').tap(); await p.waitForTimeout(500);
  const waiting = await p.evaluate(() => ({ tab: dashboardTab, streets: [...document.querySelectorAll('#dashboardJobs .dash-card-street')].map(s => s.textContent) }));
  n = await numbers();
  check(waiting.tab === 'waiting' && waiting.streets.includes('3 Cedar Court') && !n.open, 'Owed to you now opens Waiting, where the unpaid job is, and closes the numbers: ' + JSON.stringify(waiting));

  // 6. No invoices from SAYON: no money rows, and the line says the work.
  await p.evaluate(() => { ['report_c', 'report_d'].forEach(id => { const q = getSavedQuotes()[id]; delete q.taxInvoice; storeSentQuote(q); storeQuoteOnReport(q, false); }); refreshJobsList(); });
  await p.waitForTimeout(400);
  await p.locator('button.dash-numbers-head').tap(); await p.waitForTimeout(300);
  n = await numbers();
  console.log('no invoices:', JSON.stringify(n));
  check(!('Invoiced' in n.rows) && !('Paid' in n.rows) && !n.owed, 'with no invoices from SAYON there are no money rows (an invoice sent from another app isn\'t counted)');
  check(n.lead === `3 reports sent · ${money(totals.b + totals.e)} quoted`, 'and the line says the work instead: ' + n.lead);
  await shot('03-phone-no-invoices');

  // 7. Wide: open in the rail, and its foot shows beside a long list.
  await p.evaluate(() => {
    const day = n => isoDate(new Date(Date.now() + n * 864e5));
    setSavedReports(getSavedReports().concat(Array.from({ length: 14 }, (x, i) => ({ id: 'report_more' + i, address: `${20 + i} Long Street, Sampleville QLD 4000`, jobAddress: `${20 + i} Long Street`, jobSuburb: 'Sampleville', jobState: 'QLD', jobPostcode: '4000',
      client: 'Client ' + i, inspector: 'Alex Example', reportData: { jobInspectionDate: day(3 + i) }, fieldNotes: {}, savedAt: Date.now() - 5000, cloudSavedAt: Date.now() - 5000, completion: 10 }))));
    refreshJobsList(); setDashboardTab('todo');
  });
  await p.setViewportSize({ width: 1280, height: 700 }); await p.waitForTimeout(600);
  n = await numbers();
  check(!n.button && n.open && n.month === totals.month && n.rows['Reports sent'] === '3', 'on a wide screen the numbers are open in the rail, with no line to tap');
  const rail = await p.evaluate(async () => {
    const body = document.getElementById('dashboardBody'), side = body.querySelector('.dash-side');
    body.scrollTop = 700; await new Promise(r => setTimeout(r, 300));
    const foot = document.querySelector('.dash-numbers-other').getBoundingClientRect(), box = body.getBoundingClientRect();
    return { taller: side.offsetHeight > body.clientHeight, more: body.scrollHeight - body.clientHeight - body.scrollTop, footIn: foot.bottom <= box.bottom && foot.top >= box.top, tabsIn: document.getElementById('dashboardTabs').getBoundingClientRect().bottom > box.top };
  });
  console.log('rail:', JSON.stringify(rail));
  check(rail.taller && rail.more > 200 && rail.footIn, 'a rail taller than the window still shows its foot part-way down a long list');
  await shot('04-wide-rail');
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(500);
  n = await numbers();
  check(n.button && await p.evaluate(() => !document.querySelector('.dash-side').style.top), 'back on a phone it\'s the one line again, and the rail isn\'t held');

  check(!errs.length, 'no page errors: ' + errs.join(' | '));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
  process.exit(fails.length ? 1 : 0);
})();
