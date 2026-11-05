// The weekly APVMA check of the chemical register, end to end, against a
// stand-in for the APVMA's list on data.gov.au (no real network calls):
//   1. the first check looks up every APVMA No. in the register, and each
//      card says what the APVMA's list calls it; the page says when it was
//      last checked;
//   2. within the week it doesn't ask again;
//   3. a week on, a product that has dropped off the list is flagged on its
//      card, in the page's status line and on the treatment record, with a
//      heads-up once;
//   4. a list caught half-loaded, or a failed request, changes nothing;
//   5. a number the owner types is looked up straight away;
//   6. the APVMA's list decides over SAYON's own list of lapsed products;
//   7. if the APVMA replaces the list's file, the new one is found by name.
// node tests/chemicals/apvma-check.js <outDir>   (serve the repo on :8765 and run
// sh tests/visual/setup.sh first)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/apvma-check'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/sentry|posthog|maps\.googleapis|cdnjs/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } }));
  await ctx.route(/supabase\.co/, r => {
    const u = r.request().url();
    if (r.request().method() === 'PATCH') return r.fulfill({ status: 204, body: '' });
    if (u.includes('businesses?owner_id')) return r.fulfill({ json: [{ id: 'b1', name: 'Example Pest Co', owner_id: uid, settings: {} }] });
    return r.fulfill({ json: [] });
  });
  const apvma = {};
  await require('./apvma-mock.js')(ctx, apvma);
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1', '1'); }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  await p.evaluate(() => { storeCompanyDetails({ name: 'Example Pest Co' }); openApp('inspect'); resetReportState(); });
  const stored = () => p.evaluate(() => JSON.parse(localStorage.getItem('korva_apvma_check') || 'null'));
  const card = name => p.locator('#chemList .chem-card', { has: p.locator('.chem-card-name', { hasText: new RegExp(`^${name}$`) }) });

  // 1. The first check, when the register opens.
  check(apvma.calls === 0, 'nothing is asked before the check is due');
  await p.evaluate(() => openMenuPage('chemicalsPanel')); await p.waitForTimeout(800);
  let c = await stored();
  const starters = await p.evaluate(() => [...new Set(getChemicalRegister().products.map(apvmaNo).filter(Boolean))]);
  check(apvma.calls === 2 && !!c && starters.every(n => n in c.numbers) && apvma.asked.length === starters.length, `the first check looks up every APVMA No. in the register (${starters.length})`);
  check(Object.values(c.numbers).every(v => v && v.name), 'every starting product is on the list');
  const t = card('Termidor');
  await t.locator('summary').first().click(); await p.waitForTimeout(200);
  check(/Registered with the APVMA as Termidor Residual Termiticide And Insecticide \(No\. 54624\), checked/.test(await t.locator('.chem-apvma').innerText()), "the card says what the APVMA's list calls it");
  check(/Last checked/.test(await p.locator('#chemApvmaNote').innerText()) && await p.locator('#chemApvmaNote').isVisible(), 'the page says when it was last checked');
  check(!(await p.locator('#chemList .chem-unreg').count()), 'nothing is flagged');
  await t.locator('.chem-apvma').scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${OUT}/1-registered.png` });
  await t.locator('summary').first().click();

  // 2. Not again within the week.
  await p.evaluate(() => { renderChemicalRegister(); return checkApvmaList(); }); await p.waitForTimeout(300);
  check(apvma.calls === 2, 'within the week it does not ask again');

  // 3. A week on, Trelona has dropped off the list.
  apvma.dropped = ['86731'];
  await p.evaluate(() => { const c = JSON.parse(localStorage.getItem('korva_apvma_check')); c.checkedAt -= 8 * 86400000; localStorage.setItem('korva_apvma_check', JSON.stringify(c)); });
  await p.evaluate(() => checkApvmaList()); await p.waitForTimeout(300);
  c = await stored();
  check(apvma.calls === 4 && c.numbers['86731'] === null && c.numbers['54624'], 'a week on it checks again, and finds Trelona gone');
  const tre = card('Trelona');
  check(/Not registered with the APVMA/.test(await tre.locator('.chem-card-sub').innerText()), "Trelona's card is flagged, without reopening the page");
  check(/Trelona isn't registered with the APVMA any more/.test(await p.locator('#chemStatus').innerText()), 'the status line names it');
  check(/Trelona isn't registered with the APVMA any more/.test(await p.locator('#toast').innerText()), 'with a heads-up');
  await tre.locator('summary').first().click(); await p.waitForTimeout(200);
  check(/APVMA No\. 86731 is not on the APVMA's list of registered products/.test(await tre.locator('.chem-apvma.gone').innerText()), 'the card says what to do');
  await tre.locator('.chem-apvma').scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${OUT}/2-dropped.png` });
  check(/Not registered with the APVMA/.test(await p.evaluate(() => chemicalLinksHtml(findChemical('Trelona')))), 'the treatment record flags it too');
  // The heads-up comes once: the next week's check is quiet about it.
  await p.evaluate(() => { dismissToast(); const c = JSON.parse(localStorage.getItem('korva_apvma_check')); c.checkedAt -= 8 * 86400000; localStorage.setItem('korva_apvma_check', JSON.stringify(c)); });
  await p.evaluate(() => checkApvmaList()); await p.waitForTimeout(300);
  check(apvma.calls === 6 && !(await p.locator('#toast.show').count()), 'the heads-up comes once');

  // 4. A half-loaded list, and a failed request, change nothing.
  apvma.dropped = starters; apvma.total = 3000;
  await p.evaluate(() => { const c = JSON.parse(localStorage.getItem('korva_apvma_check')); c.checkedAt -= 8 * 86400000; localStorage.setItem('korva_apvma_check', JSON.stringify(c)); });
  const aged = JSON.stringify(await stored());
  await p.evaluate(() => checkApvmaList()); await p.waitForTimeout(300);
  check(apvma.calls === 8 && JSON.stringify(await stored()) === aged && (await p.locator('#chemList .chem-unreg').count()) === 1, 'a list caught half-loaded is not used');
  apvma.total = 19030; apvma.status = 503;
  await p.evaluate(() => { apvmaTriedAt = 0; return checkApvmaList(); }); await p.waitForTimeout(300);
  check(JSON.stringify(await stored()) === aged && (await p.locator('#chemList .chem-unreg').count()) === 1, 'a failed request changes nothing');
  await p.evaluate(() => checkApvmaList()); await p.waitForTimeout(300);
  check(apvma.calls === 10, 'and it waits a minute before trying again');

  // 5. A number the owner types is looked up straight away.
  apvma.status = 200; apvma.dropped = ['60654'];
  await p.evaluate(() => { apvmaTriedAt = 0; const c = JSON.parse(localStorage.getItem('korva_apvma_check')); c.checkedAt = Date.now(); localStorage.setItem('korva_apvma_check', JSON.stringify(c)); });
  await p.click('#chemAdd'); await p.waitForTimeout(200);
  const mine = p.locator('#chemList .chem-card').first();
  await mine.locator('[data-f="name"]').fill('Old Dust'); await mine.locator('[data-f="name"]').dispatchEvent('change');
  const callsBefore = apvma.calls;
  await mine.locator('[data-f="apvma"]').fill('060654'); await mine.locator('[data-f="apvma"]').dispatchEvent('change');
  await p.waitForTimeout(400);
  check(apvma.calls === callsBefore + 2 && apvma.asked.includes('60654'), 'a typed APVMA No. is looked up straight away (leading zero dropped)');
  check(/Not registered with the APVMA/.test(await mine.locator('.chem-card-sub').innerText()) && await mine.locator('.chem-edit').evaluate(d => d.open), 'its card is flagged and the edit form stays open');
  await mine.locator('.chem-apvma').scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${OUT}/3-typed.png` });

  // 6. The APVMA's list decides over SAYON's own.
  const decide = await p.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('korva_apvma_check'));
    c.numbers['59345'] = { name: 'PREMISE FOAM', holder: '', expires: '' };
    localStorage.setItem('korva_apvma_check', JSON.stringify(c));
    return [chemicalNotRegistered({ name: 'Premise Foam', apvma: '59345' }), chemicalNotRegistered({ name: 'Premise Foam' }), chemicalNotRegistered({ name: 'X', apvma: '60654' })];
  });
  check(!decide[0] && decide[1] && decide[2], "the APVMA's list decides; with no number, SAYON's own list does");

  // 7. The APVMA replaces the list's file.
  apvma.listId = 'new-list-id'; apvma.dropped = [];
  const d0 = apvma.datasetCalls;
  await p.evaluate(() => { apvmaTriedAt = 0; const c = JSON.parse(localStorage.getItem('korva_apvma_check')); c.checkedAt -= 8 * 86400000; localStorage.setItem('korva_apvma_check', JSON.stringify(c)); });
  await p.evaluate(() => checkApvmaList()); await p.waitForTimeout(400);
  c = await stored();
  check(apvma.datasetCalls === d0 + 1 && c.listId === 'new-list-id' && Date.now() - c.checkedAt < 60000 && c.numbers['60654'], 'a replaced list file is found by name and used from then on');
  const n = apvma.datasetCalls;
  await p.evaluate(() => { const c = JSON.parse(localStorage.getItem('korva_apvma_check')); c.checkedAt -= 8 * 86400000; localStorage.setItem('korva_apvma_check', JSON.stringify(c)); });
  await p.evaluate(() => checkApvmaList()); await p.waitForTimeout(300);
  check(apvma.datasetCalls === n && Date.now() - (await stored()).checkedAt < 60000, 'without looking it up again');
  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
