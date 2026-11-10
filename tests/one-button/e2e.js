// One filled button on a screen or sheet (N2): the one thing to do next is
// the only button with a fill; everything else beside it is quiet. And a
// button that sends says how and to whom ("Email to Sam").
// Counted on This job at each stage of a job, on every step of the report
// (being written, done but not sent, and sent), on the quote (a draft and
// once sent), on Jobs, and on the Add photo, check-before-sending and
// agreement sheets. A selected tab or chip shows a choice, not a button to
// press, and isn't counted.
// node e2e.js <outDir>   (serve the repo on :8765 first; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/one-button'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', uid = 'u-owner', SP = process.env.JSPDF_DIR || '/tmp/jspdf';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await ctx.route(/sentry|posthog|maps\.googleapis|open-meteo/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => { const u = r.request().url(); if (u.includes('/send-email')) return r.fulfill({ json: { configured: true } }); return r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } }); });
  await ctx.route(/supabase\.co/, r => r.request().url().includes('businesses?owner_id') ? r.fulfill({ json: [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] }) : r.fulfill({ json: [] }));
  await ctx.addInitScript(s => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1:' + s.user.id, '1'); }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(2500);
  await p.evaluate(s => {
    window.__sc = s;
    // A button with a strong colour fill (or a fill fading between two), shown
    // on screen. The open tab, a picked chip and the dock are left out.
    window.__filled = root => {
      const hsl = c => { const m = String(c).match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/); if (!m) return null;
        const [r, g, b] = [m[1], m[2], m[3]].map(v => v / 255), a = m[4] == null ? 1 : +m[4], mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
        return { s: mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1)), l, a }; };
      const filled = el => { const cs = getComputedStyle(el); const bg = cs.backgroundImage && cs.backgroundImage !== 'none' ? (cs.backgroundImage.match(/rgba?\([^)]*\)/) || [''])[0] : cs.backgroundColor;
        const v = hsl(bg); return !!v && v.a > 0.6 && v.s > 0.45 && v.l > 0.2 && v.l < 0.8; };
      // A closed fold's content still reports a size, so it's checked by hand.
      const folded = el => { for (let d = el.closest('details:not([open])'); d; d = d.parentElement && d.parentElement.closest('details:not([open])')) { const sum = d.querySelector(':scope > summary'); if (!sum || !sum.contains(el)) return true; } return false; };
      const shown = el => { const r = el.getBoundingClientRect(); if (!r.width || !r.height || folded(el)) return false;
        for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; } return true; };
      const choice = el => el.matches('.section-tab, [role="tab"], [aria-pressed="true"], [aria-selected="true"], .on, .active, [class*="chip"]');
      return [...root.querySelectorAll('button, a[class*="btn"], label[class*="btn"]')]
        .filter(el => shown(el) && !choice(el) && !el.closest('.bottom-dock, #bottomDock, .dock') && filled(el))
        .map(el => (el.id ? '#' + el.id + ' ' : '') + (el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40));
    };
  }, sc);
  const count = async (what, root) => {
    const list = await p.evaluate(r => __filled(typeof r === 'string' ? document.querySelector(r) : document.body), root);
    check(list.length <= 1, `${what}: ${list.length ? list.join(' | ') : 'none'}`);
    return list;
  };
  const jobPage = async what => { await p.evaluate(() => { tabGo('dashboard'); openJobPage(); }); await p.waitForTimeout(900); await count('This job, ' + what, '#jobOverlay'); };
  const reportSteps = async what => {
    await p.evaluate(() => { closeJobPage(); tabGo('report'); }); await p.waitForTimeout(500);
    for (const st of ['property', 'areas', 'findings', 'conducive', 'recommendations', 'finish']) {
      await p.evaluate(s => goStep(s), st); await p.waitForTimeout(350);
      await count(`the report ${what}, ${st}`, '#mainPanel');
    }
  };

  // ── A new job ──
  await p.evaluate(() => { storeCompanyDetails(__sc.company); openApp('inspect'); resetReportState(); updateJob(); }); await p.waitForTimeout(800);
  await jobPage('a new job');
  // ── Booked, with the agreement to sign ──
  await p.evaluate(() => {
    for (const [k, v] of Object.entries(__sc.job)) { const el = document.getElementById(k); if (el) el.value = v; }
    document.getElementById('jobClientPhone').value = '0411 111 111'; document.getElementById('jobClientEmail').value = 'sam@example.com';
    document.getElementById('jobInspectionDate').value = todayIsoDate(); document.getElementById('jobInspectionTime').value = '09:30'; saveJobInfo(); updateJob(); saveCurrentReport(true);
  });
  await p.waitForTimeout(800);
  await jobPage('the agreement to sign');
  await p.evaluate(() => openAgreementSheet()); await p.waitForTimeout(600);
  await count('the agreement sheet', '#agreementOverlay');
  await p.evaluate(() => cancelSheet('agreementOverlay', true)); await p.waitForTimeout(300);
  // ── The report being written ──
  await p.evaluate(async () => { reportData.agreement = { method: 'onsite', signerName: __sc.job.jobClient, date: todayIsoDate(), at: Date.now() }; renderAgreementBanner(); await populateFields(__sc.fields); saveCurrentReport(true); });
  await p.waitForTimeout(3500);
  await reportSteps('being written');
  await p.evaluate(() => choosePhotoSource('photoFileInput')); await p.waitForTimeout(400);
  await count('the Add photo sheet', '#photoSourceOverlay');
  await p.evaluate(() => document.getElementById('photoSourceOverlay').classList.remove('open'));
  // ── Done, not sent ──
  await p.evaluate(() => setReportDone(true)); await p.waitForTimeout(600);
  await reportSteps('done but not sent');
  await p.evaluate(() => { window.__agr = reportData.agreement; delete reportData.agreement; renderAgreementBanner(); goStep('property'); }); await p.waitForTimeout(350);
  await count('the report done with the agreement still to sign, property', '#mainPanel');
  check(await p.evaluate(() => getComputedStyle(document.getElementById('agreementBannerBtn')).backgroundImage !== 'none' || getComputedStyle(document.getElementById('agreementBannerBtn')).backgroundColor !== 'rgba(0, 0, 0, 0)'), 'there the agreement\'s button is the filled one');
  await p.evaluate(() => { reportData.agreement = window.__agr; renderAgreementBanner(); });
  const finish = await p.evaluate(() => ({ share: document.getElementById('shareTitle').textContent, banner: document.getElementById('reportDoneBannerBtn').textContent }));
  check(finish.share === 'Email to Sam' && finish.banner === 'Write the quote' || finish.banner === 'Email to Sam', 'Finish and the banner say how and to whom: ' + JSON.stringify(finish));
  await p.evaluate(() => openSendReview()); await p.waitForTimeout(1200);
  await count('the check before sending', '#sendReviewOverlay');
  check(await p.evaluate(() => document.getElementById('sendReviewBtn').textContent) === 'Email to sam@example.com', 'its button says how and to whom: ' + await p.evaluate(() => document.getElementById('sendReviewBtn').textContent));
  await p.evaluate(() => closeSendReview()); await p.waitForTimeout(300);
  await jobPage('the report done');
  // ── The quote ──
  await p.evaluate(() => { closeJobPage(); openQuoteFromReport(); quoteState.items = [newQuoteItem('bait_install', { qty: '12' }), newQuoteItem('bait_monitor')]; persistQuote(); renderQuoteItems(); renderQuoteProgress(); }); await p.waitForTimeout(1200);
  await count('the quote, a draft', '#quoteScreen');
  check(await p.evaluate(() => document.getElementById('quoteSendLabel').textContent) === 'Email to Sam', 'the quote\'s send button says how and to whom: ' + await p.evaluate(() => document.getElementById('quoteSendLabel').textContent));
  await p.screenshot({ path: `${OUT}/quote-draft.png` });
  await p.evaluate(() => { quoteState.sentAt = Date.now(); quoteState.sentHash = quoteContentHash(quoteState); persistQuote(); storeQuoteOnReport(quoteState, false); reportData.sent = { at: Date.now() }; saveCurrentReport(true); renderQuoteProgress(); }); await p.waitForTimeout(600);
  await count('the quote, sent', '#quoteScreen');
  await p.evaluate(() => closeQuote()); await p.waitForTimeout(400);
  await jobPage('the quote sent');
  // ── Accepted ──
  await p.evaluate(() => { const q = getSavedQuotes()[currentReportId]; q.answer = { status: 'accepted', by: __sc.job.jobClient, date: todayIsoDate(), method: 'phone', note: '', at: Date.now(), hash: quoteContentHash(q) }; storeQuoteOnReport(q, false); });
  await p.waitForTimeout(400);
  await jobPage('the quote accepted');
  // ── The finished sample job ──
  await p.evaluate(async () => { closeJobPage(); openSampleJob(); await new Promise(r => setTimeout(r, 1500)); if (document.getElementById('quoteScreen').classList.contains('open')) closeQuote(); });
  await p.waitForTimeout(800);
  await jobPage('the finished sample job');
  await p.screenshot({ path: `${OUT}/job-sample.png` });
  await reportSteps('sent');
  await p.evaluate(() => tabGo('dashboard')); await p.waitForTimeout(600);
  await count('Jobs', '#dashboardOverlay');

  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
