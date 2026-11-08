// A copy of the report for the agent or solicitor: added on the check
// sheet, sent on its own (report only) after the client's email
// (js/app/send.js A COPY FOR THE AGENT OR SOLICITOR).
// node e2e.js <outDir>  (server on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/send-copy'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', uid = 'u-owner', SP = process.env.JSPDF_DIR || '/tmp/jspdf';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
const sends = []; let copyFails = false;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => {
    const url = r.request().url();
    if (/send-email/.test(url)) {
      const body = JSON.parse(r.request().postData() || '{}');
      if (body.check) return r.fulfill({ json: { configured: true, textOnly: true } });
      sends.push({ to: body.to, subject: body.subject, text: body.text, files: (body.attachments || []).map(a => a.filename), copyTo: body.copyTo });
      if (copyFails && /^Copy:/.test(body.subject)) return r.fulfill({ status: 502, json: { message: 'The email service didn\'t accept it' } });
      return r.fulfill({ json: { id: 'em_' + sends.length } });
    }
    return r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } });
  });
  await ctx.route(/supabase\.co/, r => r.fulfill({ json: r.request().url().includes('businesses?owner_id') ? [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] : [] }));
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1', '1'); }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  const load = () => p.evaluate(async (sc) => {
    storeCompanyDetails(sc.company); openApp('inspect'); resetReportState();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    for (const [k, v] of Object.entries(sc.job)) set(k, v); updateJob();
    await populateFields(sc.fields);
    document.getElementById('jobClientEmail').value = 'sam@example.com'; saveJobInfo();
    reportData.noQuoteNeeded = true;
    await checkDirectEmail();
  }, sc);
  await load();
  await p.waitForTimeout(1500);

  await p.evaluate(() => openSendReview()); await p.waitForTimeout(800);
  const open = p.getByRole('button', { name: 'Also send the report to an agent or solicitor' });
  check(await open.isVisible(), 'the check sheet offers a copy for an agent or solicitor');
  await open.click();
  await p.screenshot({ path: `${OUT}/1-add-copy.png` });
  await p.fill('#sendCopyEmail', 'not-an-email'); await p.getByRole('button', { name: 'Add', exact: true }).last().click(); await p.waitForTimeout(200);
  check(/doesn't look right/.test(await p.evaluate(() => document.getElementById('toast').innerText)), 'a bad address is refused');
  await p.fill('#sendCopyEmail', 'sam@example.com'); await p.getByRole('button', { name: 'Add', exact: true }).last().click(); await p.waitForTimeout(200);
  check(/client's own email/.test(await p.evaluate(() => document.getElementById('toast').innerText)), 'the client\'s own address is refused');
  await p.fill('#sendCopyEmail', 'conveyancing@example.com'); await p.getByRole('button', { name: 'Add', exact: true }).last().click(); await p.waitForTimeout(300);
  const card = await p.evaluate(() => ({ text: document.getElementById('sendReviewCopy').innerText, stored: reportData.copyTo && reportData.copyTo.email }));
  check(card.stored === 'conveyancing@example.com' && /conveyancing@example\.com/.test(card.text) && /report only, not the quote/.test(card.text), 'the copy address is saved and shown: ' + card.text.replace(/\n/g, ' / '));
  await p.screenshot({ path: `${OUT}/2-copy-added.png` });

  await p.evaluate(() => confirmSendReview());
  await p.waitForFunction(() => !document.getElementById('sendReviewOverlay').classList.contains('open'), null, { timeout: 30000 });
  await p.waitForTimeout(500);
  console.log('sends:', sends.map(s => `${s.to} [${s.files.join(', ')}] "${s.subject}"`).join(' | '));
  const client = sends.find(s => s.to === 'sam@example.com'), copy = sends.find(s => s.to === 'conveyancing@example.com');
  check(client && copy && sends.indexOf(client) < sends.indexOf(copy), 'the client\'s email goes first, then the copy');
  check(copy && client && copy.files.length === 1 && copy.files[0] === client.files[0] && /^Copy: timber pest inspection report/.test(copy.subject), 'the copy carries the report only, with its own subject');
  check(copy && /sent to Sam Taylor today at their request/.test(copy.text) && !/accept|quote/i.test(copy.text), 'the copy\'s note says whose report it is and nothing about the quote');
  const after = await p.evaluate(() => ({ copySent: reportData.copySent, sent: !!reportData.sent, changed: reportData.sent && reportData.sent.fingerprint !== reportFingerprint(), toast: document.getElementById('toast').innerText }));
  check(after.sent && after.copySent && after.copySent.to === 'conveyancing@example.com', 'the report is marked sent and the copy recorded');
  check(!after.changed, 'recording the copy doesn\'t make the report look changed since sent');
  check(/a copy of the report to conveyancing@example\.com/.test(after.toast), 'says both went: ' + after.toast);

  // The copy failing never undoes the client's send.
  sends.length = 0; copyFails = true;
  await load(); await p.waitForTimeout(1000);
  await p.evaluate(() => { reportData.copyTo = { email: 'agent@example.com', at: Date.now() }; openSendReview(); });
  await p.waitForTimeout(800);
  await p.evaluate(() => confirmSendReview());
  await p.waitForFunction(() => !document.getElementById('sendReviewOverlay').classList.contains('open'), null, { timeout: 30000 });
  await p.waitForTimeout(500);
  const failed = await p.evaluate(() => ({ sent: !!reportData.sent, copySent: reportData.copySent || null, toast: document.getElementById('toast').innerText }));
  check(failed.sent && !failed.copySent && /client's email went, but the copy to agent@example\.com didn't/.test(failed.toast), 'a failed copy says so and the report is still sent: ' + failed.toast);

  check(errs.length === 0, `no page errors ${errs.join(' | ')}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
