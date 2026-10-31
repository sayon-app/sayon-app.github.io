// Data safety: dictated words saved as they land, reports saved offline
// pushed to the account later, every delete asked about, a full phone
// offering to park old jobs in the account, a Supabase outage not signing
// out. node e2e.js <outDir>  (server on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/data-safety'; fs.mkdirSync(OUT, { recursive: true });
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
  // The account: report saves can be made to fail, and the list of rows
  // the account holds is what sync-on-open returns.
  const state = { saveFails: false, rows: [], authStatus: 200, saves: 0 };
  await ctx.route(/supabase\.co/, r => {
    const req = r.request(), u = req.url(), m = req.method();
    if (u.includes('/auth/v1/token')) return state.authStatus === 200 ? r.fulfill({ json: Object.assign({}, sess) }) : r.fulfill({ status: state.authStatus, json: { msg: 'down' } });
    if (u.includes('businesses?owner_id')) return r.fulfill({ json: [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] });
    if (u.includes('/rest/v1/reports')) {
      if (m === 'POST') { state.saves++; if (state.saveFails) return r.fulfill({ status: 500, body: 'down' }); const row = JSON.parse(req.postData()); state.rows = state.rows.filter(x => x.report_id !== row.report_id).concat([row]); return r.fulfill({ status: 201, json: [row] }); }
      if (m === 'DELETE') return r.fulfill({ status: 204, body: '' });
      if (u.includes('select=saved_at')) { const id = decodeURIComponent((u.match(/report_id=eq\.([^&]+)/) || [])[1] || ''); const row = state.rows.find(x => x.report_id === id); return r.fulfill({ json: row ? [{ saved_at: row.saved_at }] : [] }); }
      return r.fulfill({ json: state.rows.map(x => ({ data: x.data, report_id: x.report_id, saved_at: x.saved_at })) });
    }
    return r.fulfill({ json: [] });
  });
  await ctx.addInitScript((s) => {
    localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1', '1');
    // A speech recogniser the test drives by hand.
    class FakeSR { constructor() { FakeSR.last = this; } start() { this.started = true; } stop() { this.onend && this.onend(); } abort() { this.onend && this.onend(); } }
    window.SpeechRecognition = FakeSR; window.__FakeSR = FakeSR;
  }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(2500);
  await p.evaluate(sc => { storeCompanyDetails(sc.company); openApp('inspect'); resetReportState(); const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; }; for (const [k, v] of Object.entries(sc.job)) set(k, v); updateJob(); }, sc);
  await p.waitForTimeout(500);

  // 1. Dictated words reach the draft as each phrase lands.
  await p.evaluate(() => { localStorage.removeItem('korva_draft'); startRecording(); });
  await p.waitForTimeout(300);
  await p.evaluate(() => { const sr = window.__FakeSR.last; const res = [{ isFinal: true, 0: { transcript: 'Live termites in the garage door frame', confidence: 0.9 }, length: 1 }]; sr.onresult({ resultIndex: 0, results: res }); });
  await p.waitForTimeout(700);
  const draft = await p.evaluate(() => JSON.parse(localStorage.getItem('korva_draft') || '{}'));
  check(/Live termites in the garage/.test(draft.transcript || ''), 'a final phrase is in the draft within a second, while still recording');
  await p.evaluate(() => { stopRecording(); currentTranscript = ''; const box = document.getElementById('transcriptBox'); box.textContent = ''; });

  // 2. A report saved while the account is down carries a badge, and goes up on its own when the signal is back.
  state.saveFails = true;
  await p.evaluate(async () => { await populateFields({ structureType: 'Single storey house', riskLevel: 'low' }); saveCurrentReport(true); });
  await p.waitForTimeout(1500);
  let list = await p.evaluate(() => { renderSavedList(); return { html: document.getElementById('savedList').innerText, waiting: getSavedReports().filter(notInAccount).length }; });
  check(list.waiting === 1 && /Not in your account yet/.test(list.html), 'a report the account refused is marked "Not in your account yet"');
  await p.evaluate(() => { toggleDrawer(); openMenuPage('savedPanel'); }); await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/1-not-in-account.png` });
  await p.evaluate(() => { showMenuPage(null); toggleDrawer(); });
  state.saveFails = false; const savesBefore = state.saves;
  await p.evaluate(() => window.dispatchEvent(new Event('online'))); await p.waitForTimeout(1500);
  list = await p.evaluate(() => ({ html: document.getElementById('savedList').innerText, waiting: getSavedReports().filter(notInAccount).length }));
  check(state.saves > savesBefore && list.waiting === 0 && !/Not in your account yet/.test(list.html), 'back online, the report goes up by itself and the badge clears');

  // 3. The quote saved onto the report counts as a new save, so it syncs.
  const before = await p.evaluate(() => getSavedReports()[0].savedAt);
  await p.waitForTimeout(20);
  const savesBeforeQuote = state.saves;
  await p.evaluate(() => { const q = { reportKey: currentReportId, items: [], updatedAt: Date.now() }; storeQuoteOnReport(q, true); });
  await p.waitForTimeout(800);
  const after = await p.evaluate(() => getSavedReports()[0].savedAt);
  check(after > before && state.saves > savesBeforeQuote, 'storing the quote bumps savedAt and saves to the account');

  // 4. Every delete asks first; No keeps the job.
  p.once('dialog', d => d.dismiss());
  const idToDelete = await p.evaluate(() => getSavedReports()[0].id);
  await p.evaluate(id => deleteReport(id), idToDelete); await p.waitForTimeout(200);
  check(await p.evaluate(id => getSavedReports().some(r => r.id === id), idToDelete), 'deleting a draft job asks first, and No keeps it');
  p.once('dialog', d => { check(/Delete the job at/.test(d.message()), 'the question names the job: ' + d.message().slice(0, 60)); d.accept(); });
  await p.evaluate(id => deleteReport(id), idToDelete); await p.waitForTimeout(200);
  check(await p.evaluate(id => !getSavedReports().some(r => r.id === id), idToDelete), 'Yes deletes it');

  // 5. A full phone: old finished jobs already in the account are parked there.
  await p.evaluate(() => {
    const now = Date.now();
    const mk = (i, done) => ({ id: 'report_old' + i, address: `${i} Old Street, Sampleville QLD 4000`, jobAddress: `${i} Old Street`, jobSuburb: 'Sampleville', reportData: Object.assign({ riskLevel: 'low' }, done ? { issue: { completedAt: now - i * 86400000 } } : {}), fieldNotes: {}, savedAt: now - i * 86400000, cloudSavedAt: now - i * 86400000, completion: 50 });
    setSavedReports([mk(1, false), mk(2, true), mk(3, true), mk(4, true)]);
    // The next write of the reports key fails for lack of room, once.
    const orig = Storage.prototype.setItem; let thrown = false;
    Storage.prototype.setItem = function (k, v) { if (!thrown && k.startsWith('korva_saved_reports')) { thrown = true; const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } return orig.call(this, k, v); };
  });
  p.once('dialog', d => { check(/storage is full/.test(d.message()) && /2 oldest finished jobs/.test(d.message()), 'asks to park the 2 oldest finished jobs: ' + d.message().slice(0, 80)); d.accept(); });
  const saved = await p.evaluate(() => { const reports = getSavedReports(); reports.unshift({ id: 'report_new', address: 'New', jobAddress: 'New', reportData: {}, fieldNotes: {}, savedAt: Date.now(), cloudSavedAt: 0 }); return setSavedReports(reports); });
  const parked = await p.evaluate(() => ({ ids: getSavedReports().map(r => r.id), archived: getArchivedReportIds(), text: (renderSavedList(), document.getElementById('savedList').innerText) }));
  check(saved && parked.ids.join() === 'report_new,report_old1,report_old2' && parked.archived.sort().join() === 'report_old3,report_old4', 'the save goes through with the two oldest finished jobs parked: ' + parked.ids.join());
  check(/2 older jobs are kept in your account only/.test(parked.text) && /Bring them back/.test(parked.text), 'Saved Reports says where they went');
  await p.evaluate(() => { toggleDrawer(); openMenuPage('savedPanel'); }); await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/2-parked.png` });
  // Bring them back: sync-on-open restores them from the account.
  state.rows = ['report_old3', 'report_old4'].map(id => ({ report_id: id, saved_at: new Date(Date.now() - 86400000).toISOString(), data: { id, address: id + ' Old Street', jobAddress: id, reportData: { issue: { completedAt: 1 } }, fieldNotes: {}, savedAt: Date.now() - 86400000 } }));
  await p.evaluate(() => restoreArchivedReports()); await p.waitForTimeout(800);
  const back = await p.evaluate(() => ({ ids: getSavedReports().map(r => r.id).sort(), archived: getArchivedReportIds() }));
  check(back.ids.includes('report_old3') && back.ids.includes('report_old4') && back.archived.length === 0, 'Bring them back restores them from the account');
  await p.evaluate(() => { showMenuPage(null); toggleDrawer(); });

  // 6. The fix links on the sheets neither overlap nor stand tall.
  await p.evaluate(async sc => { resetReportState(); const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; }; for (const [k, v] of Object.entries(sc.job)) set(k, v); updateJob(); window.__before = extractSnapshot(); await populateFields(sc.fields); }, sc);
  await p.waitForTimeout(1500);
  await p.evaluate(() => showExtractSummary(window.__before)); await p.waitForTimeout(400);
  const rects = sel => p.evaluate(sel => [...document.querySelectorAll(sel)].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.top), Math.round(r.height)]; }), sel);
  const ex = await rects('#extractSummaryGaps .send-review-fixes .link-btn');
  const overlap = ex.some((a, i) => ex.slice(i + 1).some(b => a[2] === b[2] && a[1] > b[0] && b[1] > a[0]));
  check(ex.length >= 2 && !overlap, 'extract sheet: fix links on one row do not overlap');
  await p.screenshot({ path: `${OUT}/3-extract-fixes.png` });
  await p.evaluate(() => { closeExtractSummary(); openSendReview(); }); await p.waitForTimeout(2000);
  const sd = await rects('#sendReviewOverlay .send-review-fixes .link-btn');
  check(sd.length >= 2 && sd.every(r => r[3] <= 34), 'send sheet: fix links are 32px rows, not 44px');
  await p.screenshot({ path: `${OUT}/4-send-fixes.png` });
  await p.evaluate(() => closeSendReview());

  // 7. Supabase down at launch keeps the inspector signed in.
  state.authStatus = 503;
  await p.evaluate(s => { s.expires_at = Math.floor(Date.now() / 1000) - 60; localStorage.setItem('korva_session', JSON.stringify(s)); }, sess);
  await p.reload(); await p.waitForTimeout(3000);
  const signedIn = await p.evaluate(() => ({ auth: document.getElementById('authScreen').style.display, session: !!localStorage.getItem('korva_session') }));
  check(signedIn.auth === 'none' && signedIn.session, 'a 503 from Supabase at launch keeps the saved sign-in');
  state.authStatus = 200;

  check(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
