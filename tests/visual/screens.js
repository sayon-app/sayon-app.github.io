// Screenshots of every app screen at phone widths, plus an overflow probe.
// node screens.js <outDir> [widths=320,390,430] [scenario=heavy]
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2], WIDTHS = (process.argv[3] || '320,390,430').split(',').map(Number), SCN = process.argv[4] || 'heavy';
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf', uid = 'u-owner';
const sess = { access_token:'a.b.c', refresh_token:'r', expires_at: Math.floor(Date.now()/1000)+3600, user:{ id: uid, email:'office@example.com', user_metadata:{ name:'Alex Example', business_name:'Example Pest Co' } } };
const sc = require('./scenarios.js').find(s => s.name === SCN);
const probe = () => {
  const W = innerWidth, out = [];
  const scrollerX = el => { for (let n = el.parentElement; n; n = n.parentElement) { const s = getComputedStyle(n); if (/(auto|scroll|hidden)/.test(s.overflowX) && n.scrollWidth > n.clientWidth + 1 && n !== document.body && n !== document.documentElement) return true; } return false; };
  const desc = el => (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0,2).join('.') : '')) + ` "${(el.innerText || el.value || '').trim().slice(0, 40).replace(/\s+/g,' ')}"`;
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const s = getComputedStyle(el); if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity === 0) continue;
    if (s.position === 'fixed' && (r.right <= 0 || r.left >= W)) continue; // off-canvas drawers
    if ((r.right > W + 1 || r.left < -1) && !scrollerX(el)) out.push('OFFSCREEN ' + desc(el) + ` [${Math.round(r.left)}..${Math.round(r.right)}]`);
    if (el.children.length === 0 && el.scrollWidth > el.clientWidth + 2 && /hidden|clip/.test(s.overflowX) && s.textOverflow !== 'ellipsis') out.push('CLIPPED ' + desc(el) + ` [${el.scrollWidth}>${el.clientWidth}]`);
  }
  if (document.documentElement.scrollWidth > W + 1) out.unshift(`PAGE SCROLLS SIDEWAYS ${document.documentElement.scrollWidth}>${W}`);
  return [...new Set(out)].slice(0, 25);
};
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch(); const report = {};
  for (const W of WIDTHS) {
    const ctx = await b.newContext({ serviceWorkers:'block', viewport:{ width:W, height: W < 360 ? 640 : 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP+'/package/dist/jspdf.umd.min.js'), contentType:'application/javascript' }));
    await require('./fonts-route.js')(ctx);
    await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status:200, body:'' }));
    await ctx.route(/workers\.dev/, r => r.fulfill({ json:{ plan:'starter', status:'active', ai_calls_used_this_period:1, limit:150 } }));
    await ctx.route(/supabase\.co/, r => { const u = r.request().url(); if (u.includes('businesses?owner_id')) return r.fulfill({ json:[{ id:'b1', name: sc.company.name, owner_id: uid, settings:{} }] }); return r.fulfill({ json:[] }); });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    const snap = async (name, full = true) => { await p.waitForTimeout(450); const f = `${OUT}/${W}-${name}.png`; await p.screenshot({ path: f, fullPage: full }); report[`${W}-${name}`] = await p.evaluate(probe); };
    // Signed out
    await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(2500);
    await snap('00-signin', false);
    await p.evaluate(() => showAuth('authSignUp')); await snap('00b-signup', true);
    await p.goto(`http://localhost:${PORT}/site/`); await p.waitForTimeout(1500); await snap('90-website');
    await p.goto(`http://localhost:${PORT}/sign.html`); await p.waitForTimeout(1500); await snap('91-sign-page');
    await p.goto(`http://localhost:${PORT}/terms.html`); await p.waitForTimeout(800); await snap('92-terms', false);
    // Signed in
    await p.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1','1'); }, sess);
    await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
    await snap('01-home', false);
    await p.evaluate(async (sc) => { storeCompanyDetails(sc.company); openApp('inspect'); resetReportState(); }, sc);
    await snap('02-empty-report', false);
    await p.evaluate(async (sc) => { const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      for (const [k, v] of Object.entries(sc.job)) set(k, v); updateJob(); await populateFields(sc.fields); }, sc);
    await p.waitForTimeout(2500);
    for (const st of ['property','areas','findings','conducive','recommendations','finish']) {
      await p.evaluate(st => { goStep(st); window.scrollTo(0,0); document.querySelectorAll('details.fgroup').forEach(d => d.open = true); }, st);
      await snap('1-' + st);
    }
    const tries = [
      ['20-drawer', 'openAccountMenu()', 'toggleDrawer()'],
      ['20b-job', "tabGo('job')", "tabGo('report')"],
      ['21-job-panel', "toggleDrawer(); openMenuPage('jobPanel')", "showMenuPage(null); toggleDrawer()"],
      ['22-saved', "toggleDrawer(); openMenuPage('savedPanel')", "showMenuPage(null); toggleDrawer()"],
      ['23-settings', "toggleDrawer(); openMenuPage('settingsPanel')", "showMenuPage(null); toggleDrawer()"],
      ['24-billing', "toggleDrawer(); openMenuPage('billingPanel')", "showMenuPage(null); toggleDrawer()"],
      ['25-agreement', 'openAgreementSheet()', 'closeAgreementSheet()'],
      ['26-send-review', 'openSendReview()', 'closeSendReview()'],
      ['27-dashboard', "tabGo('dashboard')", "tabGo('report')"],
      ['28-quote', "tabGo('quote')", ''],
      ['29-quote-answer', "openQuoteAnswer()", 'closeQuoteAnswer()'],
      ['30-treatment', "quoteState.answer = { status:'accepted', method:'onsite', by:'Client', date:'2026-10-30', at: Date.now() }; openTreatmentRecord()", 'closeTreatmentRecord()'],
      ['31-voice', "tabGo('report'); toggleVoicePopover()", 'toggleVoicePopover()'],
    ];
    for (const [name, open, close] of tries) {
      try { await p.evaluate(open); await p.waitForTimeout(700); await snap(name, false);
        // also scroll inner sheets to the bottom
        const scrolled = await p.evaluate(() => { let n = 0; document.querySelectorAll('.page-sheet, .sheet-body, .page-sheet-body, .sidebar, .saved-panel, .dashboard-overlay *').forEach(el => { if (el.offsetParent && el.scrollHeight > el.clientHeight + 20) { el.scrollTop = el.scrollHeight; n++; } }); return n; });
        if (scrolled) await snap(name + '-end', false);
        if (close) await p.evaluate(close); }
      catch (e) { report[`${W}-${name}`] = ['ERROR ' + e.message.split('\n')[0]]; }
    }
    report[`${W}-pageerrors`] = errs;
    await ctx.close();
  }
  fs.writeFileSync(`${OUT}/probe.json`, JSON.stringify(report, null, 1));
  await b.close();
})();
