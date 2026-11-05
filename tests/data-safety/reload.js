// Data safety when the app goes away mid-task: the phone closing it, or an
// update reloading it, straight after typing. A quote price, a Your prices
// box still being typed in, and a treatment record or bait station visit
// filled in but not saved all come back; saving or closing a sheet drops
// its copy; an update waits while a form sheet is open.
// node reload.js <outDir>  (server on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/data-safety-reload'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', uid = 'u-owner', SP = process.env.JSPDF_DIR || '/tmp/jspdf';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } }));
  await ctx.route(/supabase\.co/, r => r.request().url().includes('businesses?owner_id')
    ? r.fulfill({ json: [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] }) : r.fulfill({ json: [] }));
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1', '1'); }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const toasts = [];
  await p.exposeFunction('__toast', t => toasts.push(t));
  const watchToasts = () => p.evaluate(() => { const o = window.showToast; window.showToast = (m, ...a) => { window.__toast(String(m)); return o(m, ...a); }; });
  // The phone closes the app (pagehide, then a fresh start) and it's opened again.
  const reload = async () => {
    await p.reload(); await p.waitForTimeout(2500); await watchToasts();
    await p.evaluate(() => { if (document.getElementById('app').style.display !== 'flex') openApp('inspect'); });
    await p.waitForTimeout(600);
  };
  const typeInto = async (sel, text) => { await p.evaluate(sel => { const el = document.querySelector(sel); el.closest('details') && (el.closest('details').open = true); el.scrollIntoView({ block: 'center' }); el.focus(); el.value = ''; }, sel); await p.keyboard.type(text); };
  const copies = () => p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('korva_unsaved_sheets') || '{}')));
  const sign = async (canvas) => {
    await p.evaluate(sel => document.querySelector(sel).scrollIntoView({ block: 'center' }), canvas);
    const box = await p.locator(canvas).boundingBox();
    await p.mouse.move(box.x + 20, box.y + box.height / 2); await p.mouse.down();
    for (let i = 1; i <= 12; i++) await p.mouse.move(box.x + 20 + i * 14, box.y + box.height / 2 + (i % 2 ? -12 : 12));
    await p.mouse.up();
  };

  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(2500); await watchToasts();
  await p.evaluate(async sc => { storeCompanyDetails(sc.company); openApp('inspect'); resetReportState(); const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    for (const [k, v] of Object.entries(sc.job)) set(k, v); updateJob(); await populateFields(sc.fields); saveOpenReportNow(); }, sc);
  await p.waitForTimeout(800);

  // 1. A quote price typed and the app closed at once, inside the save delay.
  await p.evaluate(() => tabGo('quote')); await p.waitForTimeout(1500);
  const line = await p.evaluate(() => { const it = quoteState.items[0]; quoteOpenItems.add(it.id); renderQuoteItems(); return it.id; });
  await typeInto(`.qi[data-id="${line}"] input[oninput*="'price'"]`, '777');
  await reload();
  await p.evaluate(() => tabGo('quote')); await p.waitForTimeout(1500);
  check(await p.evaluate(id => Number((quoteState.items.find(i => i.id === id) || {}).price), line) === 777, 'a quote price typed just before the app closed is kept');

  // 2. Your prices: typed, and the app closed before leaving the box.
  await p.evaluate(() => { closeQuote(); toggleDrawer(); openMenuPage('pricesPanel'); }); await p.waitForTimeout(700);
  const box = await p.evaluate(() => document.querySelector('#pbList .pb-input').id);
  await typeInto('#' + box, '123');
  await reload();
  check(await p.evaluate(key => quotePriceMemory()[key], box.replace(/^pb-/, '')) === 123, 'a price typed in Your prices is kept though the box was never left');

  // 3. The treatment record: filled in, not saved, the app closed.
  await p.evaluate(() => { tabGo('quote'); }); await p.waitForTimeout(1500);
  await p.evaluate(() => { quoteState.answer = { status: 'accepted', method: 'onsite', by: 'Sam Taylor', date: todayIsoDate(), at: Date.now() }; persistQuote(); openTreatmentRecord(); });
  await p.waitForTimeout(400);
  await typeInto('#trAreas', 'Typed: the whole perimeter');
  await typeInto('#trNotes', 'Typed: client asked for a call');
  await p.evaluate(() => { const bait = document.querySelector('#trMethods input[data-key="bait"]'); if (!bait.checked) bait.click(); });
  await p.waitForTimeout(800);
  check((await copies()).some(k => k.startsWith('treatment|')), 'a copy of the open treatment record is kept as it is filled in');
  await reload();
  await p.evaluate(() => tabGo('quote')); await p.waitForTimeout(1500);
  toasts.length = 0;
  await p.evaluate(() => openTreatmentRecord()); await p.waitForTimeout(400);
  let tr = await p.evaluate(() => ({ areas: document.getElementById('trAreas').value, notes: document.getElementById('trNotes').value, bait: document.querySelector('#trMethods input[data-key="bait"]').checked }));
  check(tr.areas === 'Typed: the whole perimeter' && tr.notes === 'Typed: client asked for a call' && tr.bait, 'opening the record again brings back what was typed and ticked: ' + JSON.stringify(tr));
  check(toasts.some(t => /Picked up where you left off/.test(t)), 'and says so: ' + JSON.stringify(toasts));
  await p.screenshot({ path: `${OUT}/1-record-back.png` });

  // 4. Closing the sheet on purpose drops the copy; the record opens as it was.
  await p.evaluate(() => closeTreatmentRecord());
  check(!(await copies()).some(k => k.startsWith('treatment|')), 'closing the record drops the copy');
  await p.evaluate(() => openTreatmentRecord()); await p.waitForTimeout(300);
  check(await p.evaluate(() => document.getElementById('trNotes').value) === '', 'and opening it again starts from the saved record');

  // 5. Saved: the record keeps what was typed, and the copy goes.
  await typeInto('#trAreas', 'Saved: the whole perimeter');
  await p.evaluate(() => { const bait = document.querySelector('#trMethods input[data-key="bait"]'); if (!bait.checked) bait.click(); const qty = document.querySelector('#trMethods [data-qty="bait"]'); qty.value = '4'; qty.dispatchEvent(new Event('input', { bubbles: true })); });
  await sign('#trSigCanvas');
  await p.waitForTimeout(700);
  await p.evaluate(() => saveTreatmentRecord()); await p.waitForTimeout(500);
  check(await p.evaluate(() => quoteState.treatment && quoteState.treatment.areas) === 'Saved: the whole perimeter', 'saving keeps the record as typed');
  check(!(await copies()).length, 'and drops the copy');

  // 6. A bait station visit: stations marked and a note typed, the app closed.
  await p.evaluate(() => openBaitVisit()); await p.waitForTimeout(400);
  await p.evaluate(() => { setBaitStation(0, 'active'); setBaitStation(1, 'eaten'); });
  await typeInto('#bvNotes', 'Typed: dog kept inside');
  await reload();
  await p.evaluate(() => tabGo('quote')); await p.waitForTimeout(1500);
  toasts.length = 0;
  await p.evaluate(() => openBaitVisit()); await p.waitForTimeout(400);
  const bv = await p.evaluate(() => ({ status: baitDraft.stations.map(s => s.status).join(','), notes: document.getElementById('bvNotes').value }));
  check(bv.status.startsWith('active,eaten') && bv.notes === 'Typed: dog kept inside', 'opening the visit again brings back the stations marked and the note: ' + JSON.stringify(bv));
  check(toasts.some(t => /Picked up where you left off/.test(t)), 'and says so');
  await p.evaluate(() => closeBaitVisit());

  // 7. An update waits while a form sheet is open, and goes once it's closed and the app is put away.
  await p.evaluate(() => { openTreatmentRecord(); window.__stillHere = true; document.activeElement && document.activeElement.blur(); reloadForUpdate(); });
  await p.waitForTimeout(1200);
  check(await p.evaluate(() => window.__stillHere === true && updateReloadPending === true), 'an update does not reload the app while the treatment record is open');
  const hide = () => p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await hide(); await p.waitForTimeout(1200);
  check(await p.evaluate(() => window.__stillHere === true), 'nor when the app is put away with the record still open');
  await p.evaluate(() => { closeTreatmentRecord(); delete document.hidden; });
  await hide(); await p.waitForTimeout(2500);
  check(await p.evaluate(() => window.__stillHere !== true), 'once the record is closed, putting the app away lets the update reload it');

  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
  process.exit(fails.length ? 1 : 0);
})();
