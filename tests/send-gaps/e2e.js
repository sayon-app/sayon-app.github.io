// Two ways out of a stuck spot: photos the account never received are
// flagged on the check sheet with "Back up now", and a slow fill can be
// kept for later from the busy bar. node e2e.js <outDir>  (server on :8765)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/send-gaps'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', uid = 'u-owner', SP = process.env.JSPDF_DIR || '/tmp/jspdf';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  // The AI takes a long time; photo uploads fail until told otherwise.
  let uploadsOk = false, uploads = 0;
  await ctx.route(/workers\.dev/, async r => {
    if (r.request().method() !== 'POST') return r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } });
    try { await new Promise(res => setTimeout(res, 15000)); await r.fulfill({ json: { content: [{ text: '{}' }], stop_reason: 'end_turn' } }); } catch (e) {}
  });
  await ctx.route(/supabase\.co/, r => {
    const u = r.request().url();
    if (u.includes('/storage/v1/object/') && r.request().method() === 'POST') { uploads++; return r.fulfill({ status: uploadsOk ? 200 : 500, json: {} }); }
    return r.fulfill({ json: u.includes('businesses?owner_id') ? [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] : [] });
  });
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1', '1'); }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  await p.evaluate(async (sc) => {
    storeCompanyDetails(sc.company); openApp('inspect'); resetReportState();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    for (const [k, v] of Object.entries(sc.job)) set(k, v); updateJob(); await populateFields(sc.fields);
    const c = document.createElement('canvas'); c.width = 64; c.height = 48; const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
    await handleSectionPhotoFiles([new File([blob], 'a.jpg', { type: 'image/jpeg' }), new File([blob], 'b.jpg', { type: 'image/jpeg' })], 'findings');
  }, sc);
  await p.waitForTimeout(1500);

  // Photos only on this phone.
  await p.evaluate(() => openSendReview()); await p.waitForTimeout(800);
  const gaps1 = await p.evaluate(() => document.getElementById('sendReviewGaps').innerText);
  check(/2 photos are only on this phone, not in your account yet/.test(gaps1), 'check sheet says two photos are only on this phone');
  await p.screenshot({ path: `${OUT}/1-photo-gap.png` });
  await p.getByRole('button', { name: 'Back up now' }).click(); await p.waitForTimeout(1200);
  const gaps2 = await p.evaluate(() => ({ text: document.getElementById('sendReviewGaps').innerText, toast: document.getElementById('toast').textContent }));
  check(/2 photos are only/.test(gaps2.text) && /couldn't be backed up/.test(gaps2.toast), 'a failed backup keeps the gap and says so: ' + gaps2.toast);
  uploadsOk = true;
  await p.getByRole('button', { name: 'Back up now' }).click(); await p.waitForTimeout(1500);
  const gaps3 = await p.evaluate(() => ({ text: document.getElementById('sendReviewGaps').innerText, paths: allReportPhotos(reportData).map(x => x.path), open: document.getElementById('sendReviewOverlay').classList.contains('open') }));
  check(!/only on this phone/.test(gaps3.text) && gaps3.paths.every(Boolean) && gaps3.open, 'after a good backup the gap is gone and the sheet is still open');
  await p.screenshot({ path: `${OUT}/2-after-backup.png` });
  await p.evaluate(() => closeSendReview());

  // Keep for later while a fill drags on.
  await p.evaluate(() => { currentTranscript = 'live termites in the laundry wall behind the tub'; processTranscript(); });
  await p.waitForTimeout(1200);
  const busy = await p.evaluate(() => { const k = document.getElementById('aiKeepBtn'); const r = k.getBoundingClientRect(); return { shown: !k.hidden && r.width > 0 && r.height >= 32, busy: document.body.classList.contains('ai-busy') }; });
  check(busy.shown && busy.busy, 'Keep for later shows on the busy bar while the note is being filled');
  await p.screenshot({ path: `${OUT}/3-keep-for-later.png` });
  await p.getByRole('button', { name: 'Keep for later' }).click(); await p.waitForTimeout(1000);
  const kept = await p.evaluate(() => ({ busy: document.body.classList.contains('ai-busy'), status: document.getElementById('aiStatus').textContent, notes: (reportData.pendingNotes || []).map(n => n.text), toast: document.getElementById('toast').textContent, keepHidden: document.getElementById('aiKeepBtn').hidden, draft: (JSON.parse(localStorage.getItem('korva_draft') || 'null') || {}).reportData }));
  check(!kept.busy && kept.keepHidden && kept.notes.length === 1 && /laundry wall/.test(kept.notes[0]), 'the note is under Waiting notes and the AI is free');
  check(/Note saved under Waiting notes/.test(kept.toast), 'toast says where the note went: ' + kept.toast);
  await p.waitForTimeout(600);
  check(await p.evaluate(() => { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); return !!(d && d.reportData && d.reportData.pendingNotes && d.reportData.pendingNotes.length === 1); }), 'the kept note is in the saved draft');
  await p.screenshot({ path: `${OUT}/4-kept.png` });
  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
