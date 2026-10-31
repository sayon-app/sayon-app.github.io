// The after-extract sheet ("From your note") with its Before you leave gaps
// and spoken read-back. node e2e.js <outDir>  (server on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/extract-sheet'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', uid = 'u-owner', SP = process.env.JSPDF_DIR || '/tmp/jspdf';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
(async () => {
  const b = await chromium.launch();
  for (const W of [390, 320]) {
    const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: W, height: W < 360 ? 640 : 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await require('../visual/fonts-route.js')(ctx);
    await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
    await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
    await ctx.route(/workers\.dev/, r => r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } }));
    await ctx.route(/supabase\.co/, r => r.fulfill({ json: r.request().url().includes('businesses?owner_id') ? [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] : [] }));
    await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1', '1'); }, sess);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
    // A report the way a note leaves it: moisture and the durable notice not
    // mentioned, three areas with no status, no agreement yet.
    const fields = Object.assign({}, sc.fields); delete fields.moistureReadings; delete fields.moistureMeterReadings; delete fields.durableNoticePresent;
    await p.evaluate(async ({ sc, fields }) => {
      storeCompanyDetails(sc.company); openApp('inspect'); resetReportState();
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      for (const [k, v] of Object.entries(sc.job)) set(k, v); updateJob();
      window.__before = extractSnapshot();
      await populateFields(fields);
    }, { sc, fields });
    await p.waitForTimeout(2000);
    await p.evaluate(() => showExtractSummary(window.__before));
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${OUT}/${W}-1-sheet.png`, fullPage: false });
    const sheet = await p.evaluate(() => ({ text: document.querySelector('#extractSummaryOverlay .page-sheet').innerText, gaps: driveawayGaps().map(g => g.key), read: readBackText(), readBtn: !document.getElementById('extractReadBackBtn').hidden }));
    if (W === 390) {
      check(/Filled \d+ fields from your note/.test(sheet.text), 'sheet counts what the note filled');
      check(sheet.gaps.includes('status') && sheet.gaps.includes('moisture') && sheet.gaps.includes('notice') && sheet.gaps.includes('agreement'), 'gaps: area status, moisture, durable notice, agreement');
      check(!sheet.gaps.includes('signature') && !sheet.gaps.includes('referral'), 'signature and referral are not driveway gaps');
      check(/Before you leave/i.test(sheet.text) && /Mark the rest as inspected/.test(sheet.text) && /Get it signed/.test(sheet.text), 'gaps have their one-tap fixes');
      if (!/Before you leave/i.test(sheet.text)) console.log('SHEET TEXT:', sheet.text.slice(0, 400));
      check(/Live termites: yes, Gum tree/.test(sheet.read) && /Before you leave:/.test(sheet.read) && /Risk: high/.test(sheet.read), 'read-back says the headline and the gaps');
      check(!/<|>|"/.test(sheet.read), 'read-back has no markup');
      check(sheet.readBtn, 'Read it back button shows where speech is available');
      console.log('read-back:', sheet.read);
      // One-tap fix: the rest marked inspected, and the sheet redrawn without that gap.
      await p.getByRole('button', { name: 'Mark the rest as inspected' }).click(); await p.waitForTimeout(400);
      const after = await p.evaluate(() => ({ open: document.getElementById('extractSummaryOverlay').classList.contains('open'), gaps: driveawayGaps().map(g => g.key), text: document.querySelector('#extractSummaryOverlay .page-sheet').innerText }));
      check(after.open && !after.gaps.includes('status') && /Filled \d+ fields/.test(after.text), 'fix marks the rest inspected and redraws the sheet');
      await p.screenshot({ path: `${OUT}/${W}-2-after-fix.png`, fullPage: false });
      // Record: closes the sheet and lands on the moisture field.
      await p.locator('.extract-gap', { hasText: 'Moisture readings' }).getByRole('button', { name: 'Record' }).click(); await p.waitForTimeout(700);
      const landed = await p.evaluate(() => { const el = document.getElementById('f-moistureReadings'); const r = el.getBoundingClientRect(); return { open: document.getElementById('extractSummaryOverlay').classList.contains('open'), visible: r.top >= 0 && r.bottom <= innerHeight, section: el.closest('.report-section').style.display !== 'none' }; });
      check(!landed.open && landed.visible, 'Record closes the sheet and shows the moisture field');
      await p.screenshot({ path: `${OUT}/${W}-3-moisture-field.png`, fullPage: false });
      // Get it signed opens the agreement sheet.
      await p.evaluate(() => showExtractSummary()); await p.waitForTimeout(300);
      await p.getByRole('button', { name: 'Get it signed' }).click(); await p.waitForTimeout(500);
      check(await p.evaluate(() => document.getElementById('agreementOverlay').classList.contains('open') && !document.getElementById('extractSummaryOverlay').classList.contains('open')), 'Get it signed opens the agreement sheet');
      await p.evaluate(() => closeAgreementSheet());
      // The send sheet's fixes still work.
      await p.evaluate(() => { openSendReview(); }); await p.waitForTimeout(800);
      await p.evaluate(() => fixSendGap('clear')); await p.waitForTimeout(500);
      check(await p.evaluate(() => document.getElementById('sendReviewOverlay').classList.contains('open') && areasMissingResult().length === 0), 'send sheet fix still marks the rest as nothing found');
      await p.evaluate(() => closeSendReview());
      // All clear: the sheet says so.
      await p.evaluate(() => { reportData.moistureReadings = 'NO'; reportData.durableNoticePresent = 'NO'; reportData.agreement = { method: 'paper', signerName: 'Sam Taylor', signedAt: Date.now() }; showExtractSummary(); });
      await p.waitForTimeout(300);
      check(/Safe to leave/.test(await p.evaluate(() => document.getElementById('extractSummaryGaps').innerText)), 'with nothing missing the sheet says safe to leave');
      await p.screenshot({ path: `${OUT}/${W}-4-all-clear.png`, fullPage: false });
    }
    check(errs.length === 0, `${W}: no page errors ${errs.join(' | ')}`);
    await ctx.close();
  }
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
