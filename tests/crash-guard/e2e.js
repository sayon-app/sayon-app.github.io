// Crash guard (js/crash-guard.js): an error saves what's waiting at once;
// a page that dies while on screen brings the work back and offers to tell
// us; a problem report goes to Supabase problem_reports, waits with no
// signal, and falls back to an email when the table isn't there. The
// half-signed agreement sheet comes back after a crash too.
// node e2e.js <outDir>  (server on :8765)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/crash-guard'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } }));
  let tableMode = 'ok'; const posted = [];
  await ctx.route(/supabase\.co/, r => {
    const url = r.request().url();
    if (url.includes('/problem_reports')) {
      if (tableMode === 'missing') return r.fulfill({ status: 404, json: { code: 'PGRST205', message: 'not found' } });
      posted.push(JSON.parse(r.request().postData()));
      return r.fulfill({ status: 201, body: '' });
    }
    return url.includes('businesses?owner_id')
      ? r.fulfill({ json: [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] }) : r.fulfill({ json: [] });
  });
  await ctx.addInitScript((s) => { if (!localStorage.getItem('korva_session')) { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1', '1'); } }, sess);

  let p, toasts, errs;
  const open = async () => {
    p = await ctx.newPage(); errs = []; toasts = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.exposeFunction('__toast', t => toasts.push(t)).catch(() => {});
    await p.addInitScript(() => { window.addEventListener('DOMContentLoaded', () => { const o = window.showToast; window.showToast = (m, ...a) => { window.__toast(String(m)); return o(m, ...a); }; }); });
    await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(2500);
    await p.evaluate(() => { if (document.getElementById('app').style.display !== 'flex') openApp('inspect'); });
    await p.waitForTimeout(500);
  };
  // The tab dies with no warning: its goodbye events (pagehide,
  // visibilitychange) never reach the app. Headless Chromium can't crash one
  // tab alone (CDP Page.crash takes the browser down), and still fires them
  // on close, so the app's handlers are stopped from hearing them.
  const crash = async () => {
    await p.evaluate(() => { window.markSession = () => {}; window.saveBeforeLeaving = () => {}; });
    await p.close({ runBeforeUnload: false });
  };

  await open();
  await p.evaluate(async sc => { storeCompanyDetails(sc.company); resetReportState(); const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    for (const [k, v] of Object.entries(sc.job)) set(k, v); updateJob(); await populateFields(sc.fields); saveOpenReportNow(); }, sc);
  await p.waitForTimeout(800);

  // 1. A change still inside the 400 ms save delay, then the app throws: it's saved at once.
  const savedNow = await p.evaluate(() => {
    reportData.generalNotes = 'Typed just before it broke';
    saveDraft();
    setTimeout(() => { throw new Error('Test crash in ' + 'job "Sam Taylor" at "7 Banksia Drive", call 0412 345 678'); }, 0);
    return new Promise(res => setTimeout(() => res(JSON.parse(localStorage.getItem('korva_draft')).reportData.generalNotes), 50));
  });
  check(savedNow === 'Typed just before it broke', 'an uncaught error saves the change still waiting on the timer: ' + savedNow);
  const log = await p.evaluate(() => JSON.parse(localStorage.getItem('korva_error_log') || '[]'));
  check(log.length === 1 && /Test crash/.test(log[0].message), 'the error is kept on the phone');
  check(!/7 Banksia|0412/.test(JSON.stringify(log)), 'with quoted text and phone numbers scrubbed: ' + (log[0] || {}).message);

  // 2. The agreement sheet, half filled and signed, then the tab dies.
  await p.evaluate(() => openAgreementSheet()); await p.waitForTimeout(400);
  await p.fill('#agreementSignerName', 'Sam Taylor');
  await p.fill('#agreementNotes', 'Check the back deck closely');
  await p.check('#agreementAgree');
  await p.evaluate(() => document.getElementById('agreementSigCanvas').scrollIntoView({ block: 'center' }));
  const box = await p.locator('#agreementSigCanvas').boundingBox();
  await p.mouse.move(box.x + 20, box.y + box.height / 2); await p.mouse.down();
  for (let i = 1; i <= 12; i++) await p.mouse.move(box.x + 20 + i * 14, box.y + box.height / 2 + (i % 2 ? -12 : 12));
  await p.mouse.up();
  await p.waitForTimeout(900);
  await crash();

  // 3. Opened again: the work is back and it offers to tell us.
  await open();
  await p.waitForTimeout(2000);
  check(toasts.some(t => /closed unexpectedly/.test(t)), 'the next start says the app closed unexpectedly: ' + JSON.stringify(toasts));
  check(await p.evaluate(() => reportData.generalNotes) === 'Typed just before it broke', 'the report change made before the crash is there');
  toasts.length = 0;
  await p.evaluate(() => openAgreementSheet()); await p.waitForTimeout(500);
  const agr = await p.evaluate(() => ({ name: document.getElementById('agreementSignerName').value, notes: document.getElementById('agreementNotes').value,
    agreed: document.getElementById('agreementAgree').checked, signed: !agreementSignaturePad.empty, canSign: !document.getElementById('agreementSignBtn').disabled || !document.getElementById('agreementInspectionType').value }));
  check(agr.name === 'Sam Taylor' && agr.notes === 'Check the back deck closely' && agr.agreed && agr.signed, 'the half-signed agreement comes back: ' + JSON.stringify(agr));
  await p.screenshot({ path: `${OUT}/1-agreement-back.png` });
  await p.evaluate(() => closeAgreementSheet());
  check(!(await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('korva_unsaved_sheets') || '{}')).some(k => k.startsWith('agreement|')))), 'closing the agreement drops its copy');

  // 4. The crash notice's button opens the sheet; sending posts the report.
  await p.evaluate(() => openProblemReport('crash', { at: Date.now() - 60000, errors: [] })); await p.waitForTimeout(400);
  await p.evaluate(() => { document.querySelector('.problem-details-wrap').open = true; });
  const details = await p.textContent('#problemDetails');
  check(/Test crash/.test(details) && /Errors kept/.test(details) && /Closed while in use/.test(details), 'the sheet shows the details that will be sent');
  await p.fill('#problemMessage', 'Was signing the agreement when it shut');
  await p.screenshot({ path: `${OUT}/2-problem-sheet.png` });
  await p.click('#problemSendBtn'); await p.waitForTimeout(600);
  check(posted.length === 1 && posted[0].kind === 'crash' && posted[0].message === 'Was signing the agreement when it shut', 'the report goes to problem_reports');
  const sent = JSON.stringify((posted[0] || {}).details || {});
  check(/Test crash/.test(sent) && posted[0].business_id === 'b1', 'with the kept errors and the business');
  check(!/Banksia|Epping|Sam Taylor|0412/.test(sent), 'and no address, client name or phone number in the details');
  check(toasts.some(t => /Sent to the SAYON team/.test(t)), 'and says it was sent');
  check(await p.evaluate(() => JSON.parse(localStorage.getItem('korva_error_log') || '[]').length) === 0, 'errors that were sent are not sent again');

  // 5. From the menu, with no signal: it waits, then goes once back online.
  await p.evaluate(() => { toggleDrawer(); }); await p.waitForTimeout(300);
  await p.click('button[onclick="openProblemReport()"]'); await p.waitForTimeout(400);
  check(await p.evaluate(() => document.getElementById('problemOverlay').classList.contains('open') && !document.getElementById('sidebarPanel').classList.contains('open')), 'Menu › Report a problem opens the sheet and closes the menu');
  await p.fill('#problemMessage', 'Photos are slow to load');
  await ctx.setOffline(true);
  await p.click('#problemSendBtn'); await p.waitForTimeout(400);
  check(posted.length === 1 && toasts.some(t => /No signal/.test(t)), 'with no signal it waits on the phone');
  await ctx.setOffline(false); await p.waitForTimeout(1200);
  check(posted.length === 2 && posted[1].message === 'Photos are slow to load', 'and goes once the signal is back');

  // 6. No table yet: an email to SAYON opens instead.
  tableMode = 'missing';
  await p.evaluate(() => { window.__mailed = null; window.emailProblemReport = r => { window.__mailed = r; }; openProblemReport(); });
  await p.fill('#problemMessage', 'Quote PDF is blank'); await p.click('#problemSendBtn'); await p.waitForTimeout(500);
  check(await p.evaluate(() => window.__mailed && window.__mailed.message) === 'Quote PDF is blank', 'with no problem_reports table it falls back to an email');

  // 7. A normal reload is not a crash.
  await p.reload(); await p.waitForTimeout(3500);
  check(!toasts.some(t => /closed unexpectedly/.test(t)), 'reloading or closing the app normally is not taken for a crash');

  check(!errs.filter(e => !/Test crash/.test(e)).length, 'no page errors: ' + errs.join(' | '));
  await b.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
