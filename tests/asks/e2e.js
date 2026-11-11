// Every question is asked on SAYON's own sheet, never the browser's grey
// box (N3). The sheet says what will happen, its button names it, and
// "Not now", back and Esc leave everything as it was.
//   1. no confirm() or prompt() is left in the app's code but Delete all
//      jobs, which is kept as it is on purpose;
//   2. deleting the account wants DELETE typed in the sheet's box before
//      its button works;
//   3. the site plan asks before it closes with changes not saved, from
//      the X, Cancel and back, and not when nothing changed;
//   4. the quote plan's "Type it" takes the words in the sheet's box, and
//      starting the plan again asks first;
//   5. where the phone can neither share nor copy, the link shows in a box
//      to press and hold;
//   6. a saved note, a signed agreement and the client's answer each ask
//      before they go, and back keeps them.
// node e2e.js <outDir>   (serve the repo on :8765 first; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const OUT = process.argv[2] || '/tmp/asks'; fs.mkdirSync(OUT, { recursive: true });
const ROOT = path.join(__dirname, '..', '..');
const PORT = '8765', uid = 'u-owner', SP = process.env.JSPDF_DIR || '/tmp/jspdf';
const user = { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } };
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user };
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };

(async () => {
  // ── 1. The code ──
  const files = [...fs.readdirSync(path.join(ROOT, 'js/app')).map(n => 'js/app/' + n), ...fs.readdirSync(path.join(ROOT, 'js')).filter(n => n.endsWith('.js')).map(n => 'js/' + n)];
  const grey = [];
  files.forEach(f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    if (/(^|[^.\w])(confirm|prompt)\(/.test(code)) grey.push({ at: `${f}:${i + 1}`, code: code.trim() });
  }));
  check(grey.length === 1 && /^js\/app\/sync\.js/.test(grey[0].at) && /Delete \$\{n\}\?/.test(grey[0].code), 'the one grey box left is Delete all jobs: ' + grey.map(g => g.at).join(', '));

  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await ctx.route(/sentry|posthog|maps\.googleapis|data\.gov\.au|open-meteo/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => r.fulfill({ json: { plan: 'starter', status: 'active', subscribed: true, ai_calls_used_this_period: 1, limit: 800 } }));
  const calls = [];
  await ctx.route(/supabase\.co/, r => {
    const u = r.request().url(); calls.push(r.request().method() + ' ' + u);
    if (u.includes('businesses?owner_id')) return r.fulfill({ json: [{ id: 'b1', name: 'Example Pest Co', owner_id: uid, settings: {} }] });
    if (r.request().method() === 'PATCH') return r.fulfill({ status: 204, body: '' });
    return r.fulfill({ json: [] });
  });
  await ctx.addInitScript(s => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1:' + s.user.id, '1'); }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const dialogs = []; p.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
  const ask = () => p.evaluate(() => {
    const box = document.getElementById('askInput'), yes = document.getElementById('askYes'), no = document.getElementById('askNo');
    return { open: document.getElementById('askOverlay').classList.contains('open'), title: document.getElementById('askTitle').textContent, text: document.getElementById('askText').textContent,
      yes: yes.textContent, yesOff: yes.disabled, red: yes.classList.contains('danger'), no: no.hidden ? null : no.textContent,
      box: box.hidden ? null : { value: box.value, readonly: box.readOnly, focused: document.activeElement === box } };
  });
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);

  // ── 2. Deleting the account ──
  await p.evaluate(() => { deleteMyAccount(); }); await p.waitForTimeout(300);
  let a = await ask();
  check(a.open && a.title === 'Delete your account?' && a.yes === 'Delete my account' && a.red && a.no === 'Not now' && /Type DELETE to confirm/.test(a.text) && /Download a copy first/.test(a.text), 'deleting the account asks on SAYON\'s sheet, with a red button that names it: ' + JSON.stringify(a));
  check(a.box && a.box.value === '' && a.yesOff, 'its button stays off until DELETE is typed');
  await p.screenshot({ path: `${OUT}/2-delete-account.png` });
  await p.fill('#askInput', 'DEL'); a = await ask();
  check(a.yesOff, 'half the word is not enough');
  await p.fill('#askInput', 'delete'); a = await ask();
  check(!a.yesOff, 'the word in any case turns it on');
  await p.click('#askNo'); await p.waitForTimeout(300);
  check(!(await ask()).open && !calls.some(c => /delete_my_account/.test(c)) && await p.evaluate(() => !!authSession), '"Not now" closes it and nothing is deleted');

  // A job to work on: the report, then its quote.
  await p.evaluate(() => {
    openApp('inspect'); resetReportState();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('jobAddress', '7 Banksia Drive'); set('jobSuburb', 'Epping'); set('jobState', 'NSW'); set('jobPostcode', '2121'); set('jobClient', 'Sam Taylor'); set('jobClientEmail', 'sam@example.com');
    updateJob();
    populateFields({ inspectionType: 'Annual — Existing Building', findings: [{ termiteActivity: 'ACTIVE', activityLocation: 'Laundry door frame', damageDescription: 'Live termites in the frame' }],
      treatmentRecommended: 'YES', treatmentType: 'Treat the active termites; install a chemical barrier', riskLevel: 'HIGH', inspectionFrequency: '12 months' });
  });
  await p.waitForTimeout(3500);
  await p.evaluate(() => { saveCurrentReport && saveCurrentReport(); openQuoteFromReport(); }); await p.waitForTimeout(1500);
  await p.evaluate(() => { if (!quoteState.plan) addQuotePlan(); }); await p.waitForTimeout(300);

  // ── 4. The quote plan ──
  await p.evaluate(() => { typeQuotePlanChoice('time'); }); await p.waitForTimeout(300);
  a = await ask();
  check(a.open && a.title === 'How long will the job take on site?' && a.yes === 'Save' && a.box && a.box.focused, '"Type it" asks in a box on SAYON\'s sheet, ready to type in: ' + JSON.stringify(a));
  await p.screenshot({ path: `${OUT}/4-type-it.png` });
  await p.fill('#askInput', '  3 hours '); await p.press('#askInput', 'Enter'); await p.waitForTimeout(400);
  check(!(await ask()).open && await p.evaluate(() => quoteState.plan.time) === '3 hours', 'Enter saves what was typed: ' + await p.evaluate(() => quoteState.plan.time));
  await p.evaluate(() => { typeQuotePlanChoice('time'); }); await p.waitForTimeout(300);
  check((await ask()).box.value === '3 hours', 'opened again, the box holds the words already saved');
  await p.keyboard.press('Escape'); await p.waitForTimeout(100); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  check(!(await ask()).open && await p.evaluate(() => quoteState.plan.time) === '3 hours', 'Esc leaves it as it was');
  await p.evaluate(() => { quoteState.plan.we = 'My own steps'; rebuildQuotePlan(); }); await p.waitForTimeout(300);
  a = await ask();
  check(a.open && a.title === 'Replace the plan\'s steps?' && a.yes === 'Replace the steps' && /Your edits to them are lost/.test(a.text), 'starting the plan again asks first: ' + JSON.stringify(a));
  await p.click('#askNo'); await p.waitForTimeout(300);
  check(await p.evaluate(() => quoteState.plan.we) === 'My own steps', '"Not now" keeps the edits');
  await p.evaluate(() => { rebuildQuotePlan(); }); await p.waitForTimeout(300); await p.click('#askYes'); await p.waitForTimeout(400);
  check(await p.evaluate(() => quoteState.plan.we !== 'My own steps' && !!quoteState.plan.we), 'and the named button writes them fresh');

  // ── 6. The client's answer ──
  await p.evaluate(() => { quoteState.answer = { status: 'accepted', method: 'phone', by: 'Sam Taylor', date: '2026-11-10', at: Date.now() }; clearQuoteAnswer(); }); await p.waitForTimeout(300);
  a = await ask();
  check(a.open && a.title === 'Clear the client\'s answer?' && a.yes === 'Clear the answer' && a.red, 'clearing the client\'s answer asks first: ' + JSON.stringify(a));
  await p.click('#askYes'); await p.waitForTimeout(400);
  check(await p.evaluate(() => !quoteState.answer), 'and clears it');
  await p.evaluate(() => closeQuote()); await p.waitForTimeout(300);

  // ── 5. A link to copy by hand ──
  await p.evaluate(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('not allowed')) }, configurable: true });
    reportData.agreementRequest = { id: 'r-123', signerName: 'Sam Taylor', sentAt: Date.now() };
    shareAgreementLink();
  });
  await p.waitForTimeout(400);
  a = await ask();
  check(a.open && a.title === 'Copy the link' && a.box && a.box.readonly && /r-123/.test(a.box.value) && a.yes === 'Done' && a.no === null, 'with no share sheet and no clipboard, the link shows in a box to press and hold: ' + JSON.stringify(a));
  await p.screenshot({ path: `${OUT}/5-copy-link.png` });
  await p.click('#askYes'); await p.waitForTimeout(200);
  await p.evaluate(() => { delete reportData.agreementRequest; });

  // ── 6. A saved note, and the agreement ──
  await p.evaluate(() => { reportData.pendingNotes = [{ id: 'n1', text: 'Roof void still to do', at: Date.now() }]; removePendingNote('n1'); }); await p.waitForTimeout(300);
  a = await ask();
  check(a.open && a.title === 'Delete this saved note?' && a.yes === 'Delete note' && a.red, 'deleting a saved note asks first: ' + JSON.stringify(a));
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  check(!(await ask()).open && await p.evaluate(() => (reportData.pendingNotes || []).length === 1), 'back keeps the note');
  await p.evaluate(() => { removePendingNote('n1'); }); await p.waitForTimeout(300); await p.click('#askYes'); await p.waitForTimeout(300);
  check(await p.evaluate(() => !(reportData.pendingNotes || []).length), 'and the named button deletes it');
  await p.evaluate(() => { reportData.agreement = { method: 'onsite', signerName: 'Sam Taylor', signature: 'data:image/png;base64,iVBORw0KGgo=', signedAt: Date.now() }; removeAgreement(); }); await p.waitForTimeout(300);
  a = await ask();
  check(a.open && a.title === 'Remove the signed agreement?' && a.yes === 'Remove the agreement' && a.red, 'removing a signed agreement asks first: ' + JSON.stringify(a));
  await p.click('#askNo'); await p.waitForTimeout(300);
  check(await p.evaluate(() => !!reportData.agreement), '"Not now" keeps it');

  // ── 3. The site plan ──
  const planOpen = () => p.evaluate(() => document.getElementById('sitePlanOverlay').classList.contains('open'));
  await p.evaluate(() => openSitePlan(null, () => {})); await p.waitForTimeout(400);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  check(!(await planOpen()) && !(await ask()).open, 'a plan with nothing changed closes without a question');
  await p.evaluate(() => { openSitePlan(null, () => {}); pushSitePlanUndo(); }); await p.waitForTimeout(400);
  await p.click('#sitePlanOverlay .voice-popover-close'); await p.waitForTimeout(300);
  a = await ask();
  check(a.open && a.title === 'Close the plan without saving?' && a.yes === 'Close without saving' && a.no === 'Keep drawing' && a.red && await planOpen(), 'the X on a changed plan asks first: ' + JSON.stringify(a));
  await p.screenshot({ path: `${OUT}/3-site-plan.png` });
  await p.click('#askNo'); await p.waitForTimeout(300);
  check(await planOpen(), '"Keep drawing" keeps it open');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  check((await ask()).open, 'back asks the same');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  check(!(await ask()).open && await planOpen(), 'and back again only closes the question');
  await p.click('#sitePlanOverlay .link-btn:text-is("Cancel")'); await p.waitForTimeout(300);
  check((await ask()).open, 'Cancel asks too');
  await p.click('#askYes'); await p.waitForTimeout(300);
  check(!(await planOpen()), 'and "Close without saving" closes it');

  check(!dialogs.length, 'the browser\'s grey box was never used: ' + dialogs.join(' | '));
  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
