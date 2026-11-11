// The site plan starts at the report (I5): drawn at the inspection, if the
// inspector wants one, from the Areas step, under the areas. It prints in
// the report's Areas Inspected, and a new treatment record starts from a
// copy of it, so the technician adds the treatment and the stations to the
// same drawing. Each document keeps the plan it went out with.
// The report's plan has no Treatment or Stations tab (they wait for the
// treatment record), and an area that couldn't be reached is under
// Findings. A finalised report's plan can't be changed. The sample job's
// report has a plan, and its certificate's is the same drawing with the
// treatment added.
// node e2e.js <outDir>   (serve the repo on :8765 first; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs'); const { execFileSync } = require('child_process');
const OUT = process.argv[2] || '/tmp/report-plan'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf', uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await ctx.route(/sentry|posthog|maps\.googleapis|open-meteo/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } }));
  await ctx.route(/supabase\.co/, r => r.request().url().includes('businesses?owner_id') ? r.fulfill({ json: [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] }) : r.fulfill({ json: [] }));
  await ctx.addInitScript(s => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1:' + s.user.id, '1'); }, sess);
  const p = await ctx.newPage(); const errs = [], dialogs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
  const tap = async (loc, what) => { try { await loc.scrollIntoViewIfNeeded({ timeout: 3000 }); await loc.tap({ timeout: 5000 }); return true; } catch (e) { check(false, 'tap ' + what + ': ' + e.message.split('\n')[0]); return false; } };
  const planBox = async () => { await p.locator('#spCanvas svg').scrollIntoViewIfNeeded(); return p.locator('#spCanvas svg').boundingBox(); };
  const at = (bb, x, y) => [bb.x + x / 1000 * bb.width, bb.y + y / 750 * bb.height];
  const tapPlan = async (x, y) => { const bb = await planBox(); await p.mouse.click(...at(bb, x, y)); await p.waitForTimeout(60); };
  const dragPlan = async (x0, y0, x1, y1) => { const bb = await planBox(); const a = at(bb, x0, y0), c = at(bb, x1, y1); await p.mouse.move(...a); await p.mouse.down(); for (let i = 1; i <= 8; i++) await p.mouse.move(a[0] + (c[0] - a[0]) * i / 8, a[1] + (c[1] - a[1]) * i / 8); await p.mouse.up(); await p.waitForTimeout(60); };
  const tool = async (group, label) => { await tap(p.locator('#spGroups .sp-group', { hasText: group }), group); await tap(p.locator('#spTools .sp-tool:not(.sp-round)', { hasText: label }), label); };
  const pdfText = async (fn, name) => {
    const b64 = await p.evaluate(async src => { const r = await eval(src)(); const blob = r.blob || r; const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768)); return btoa(s); }, fn);
    fs.writeFileSync(`${OUT}/${name}.pdf`, Buffer.from(b64, 'base64'));
    const pages = +((execFileSync('pdfinfo', [`${OUT}/${name}.pdf`]).toString().match(/Pages:\s+(\d+)/) || [])[1] || 0);
    return [...Array(pages)].map((_, i) => execFileSync('pdftotext', ['-layout', '-f', String(i + 1), '-l', String(i + 1), `${OUT}/${name}.pdf`, '-']).toString());
  };

  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(2500);
  await p.evaluate(async s => {
    window.__sc = s; storeCompanyDetails(s.company); openApp('inspect'); resetReportState();
    for (const [k, v] of Object.entries(s.job)) { const el = document.getElementById(k); if (el) el.value = v; }
    document.getElementById('jobClientEmail').value = 'sam@example.com'; saveJobInfo(); updateJob();
    await populateFields(s.fields); saveCurrentReport(true); tabGo('report');
  }, sc);
  await p.waitForTimeout(3000);

  // ── 1. On the Areas step, under the areas, and quiet ──
  await p.evaluate(() => goStep('areas')); await p.waitForTimeout(500);
  const card = await p.evaluate(() => {
    const el = document.getElementById('reportPlan'), btn = el.querySelector('.treat-plan-empty');
    const r = btn.getBoundingClientRect(), list = document.getElementById('areaChecklist').getBoundingClientRect(), next = document.getElementById('section-restrictions').getBoundingClientRect();
    const bg = getComputedStyle(btn).backgroundColor;
    return { text: btn.innerText.replace(/\s+/g, ' '), shown: r.height > 0, below: r.top >= list.bottom - 1, before: r.bottom <= next.top + 1, inSection4: !!el.closest('#section-obstructions'), bg };
  });
  check(card.shown && card.inSection4 && card.below && card.before, 'the plan is on the Areas step, under the areas and before Areas unable to be inspected: ' + JSON.stringify(card));
  check(/^Draw a site plan If you want one/.test(card.text) && /prints in the report, and the treatment record starts from it/.test(card.text), 'it says it\'s optional and what it\'s for: ' + card.text);
  await p.evaluate(() => document.getElementById('reportPlan').scrollIntoView({ block: 'center' })); await p.screenshot({ path: `${OUT}/1-areas-empty.png` });

  // ── 2. The report's editor ──
  await tap(p.locator('#reportPlan .treat-plan-empty'), 'Draw a site plan'); await p.waitForTimeout(500);
  const ed = await p.evaluate(() => ({ open: document.getElementById('sitePlanOverlay').classList.contains('open'), mode: sitePlanEditor.mode,
    tabs: [...document.querySelectorAll('#spGroups .sp-group')].map(b => b.textContent), group: sitePlanEditor.group,
    find: (setSitePlanGroup('find'), [...document.querySelectorAll('#spTools .sp-tool span')].map(s => s.textContent)) }));
  check(ed.open && ed.mode === 'report' && ed.group === 'build', 'it opens the plan editor for the report, on Buildings');
  check(JSON.stringify(ed.tabs) === JSON.stringify(['Buildings', 'Yard', 'Services', 'Findings']), 'with no Treatment or Stations tab: ' + ed.tabs.join(', '));
  check(ed.find.includes('Termite activity') && ed.find.includes('No access area'), 'an area that couldn\'t be reached is under Findings: ' + ed.find.join(', '));
  check(await p.evaluate(() => { const g = document.querySelectorAll('#spGroups .sp-group'); return g[3].getBoundingClientRect().top === g[0].getBoundingClientRect().top; }), 'its four tabs sit in one row');
  await tool('Findings', 'Termite activity'); await tapPlan(650, 400); await p.fill('#spSelLabel', 'Laundry');
  await tool('Findings', 'No access area'); await dragPlan(300, 525, 500, 625); await p.fill('#spSelLabel', 'Under rear deck');
  await p.evaluate(() => setSitePlanLayer('sub')); await p.waitForTimeout(200);
  const subKeys = await p.evaluate(() => sitePlanGroups('sub').flatMap(g => sitePlanTrayKeys('sub', g).map(k => SITE_PLAN_SYMBOLS[k].label)));
  check(!subKeys.includes('Treated soil') && subKeys.includes('Pier or stump'), 'the subfloor has its symbols, but not the treated soil: ' + subKeys.join(', '));
  await p.evaluate(() => { undoSitePlan(); setSitePlanLayer('site'); }); await p.waitForTimeout(200);
  await p.screenshot({ path: `${OUT}/2-editor.png` });
  await tap(p.locator('#sitePlanOverlay button', { hasText: 'Save site plan' }), 'Save site plan'); await p.waitForTimeout(500);
  const saved = await p.evaluate(() => ({ items: (reportData.sitePlan.items || []).map(i => i.k).sort(), sub: sitePlanHasSubfloor(reportData.sitePlan), card: document.getElementById('reportPlan').innerText.replace(/\s+/g, ' '), svg: !!document.querySelector('#reportPlan .treat-plan-view svg') }));
  check(JSON.stringify(saved.items) === JSON.stringify(['activity', 'house', 'noaccess']) && !saved.sub, 'Save keeps it on the report: ' + saved.items.join(', '));
  check(saved.svg && /The plan shows 1 area that could not be inspected and 1 place where termite activity or damage was found\./.test(saved.card) && /Edit the site plan/.test(saved.card), 'the Areas step shows the drawing and what it shows: ' + saved.card.slice(-180));
  check(await p.evaluate(() => { const d = JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => /^korva_draft/.test(k))) || '{}'); return !!(d.reportData && d.reportData.sitePlan); }), 'and it\'s saved with the report');
  await p.evaluate(() => document.getElementById('reportPlan').scrollIntoView({ block: 'start' })); await p.screenshot({ path: `${OUT}/3-areas-drawn.png` });
  // Filled as tests/one-button counts it: a strong colour, not a wash or white.
  const filled = await p.evaluate(() => [...document.querySelectorAll('#reportPlan button')].filter(b => {
    const m = (getComputedStyle(b).backgroundColor.match(/[\d.]+/g) || []).map(Number); if (m.length < 3 || (m[3] != null && m[3] < 0.6)) return false;
    const [r, g, bl] = m.slice(0, 3).map(v => v / 255), mx = Math.max(r, g, bl), mn = Math.min(r, g, bl), l = (mx + mn) / 2, sat = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
    return sat > 0.45 && l > 0.2 && l < 0.8; }).map(b => b.textContent.trim()));
  check(!filled.length, 'its buttons are quiet ones (the step\'s Next stays the filled one)' + (filled.length ? ': ' + filled.join(' | ') : ''));

  // ── 3. In the report PDF, under Areas Inspected ──
  const pages = await pdfText('buildReportPdf', 'report');
  const planPage = pages.findIndex(t => /SITE PLAN/.test(t));
  const areasPage = pages.findIndex(t => /4\s+AREAS INSPECTED/.test(t));
  const accessPage = pages.findIndex(t => /5\s+AREAS UNABLE TO BE INSPECTED/.test(t));
  check(planPage >= 0 && planPage >= areasPage && planPage <= accessPage && /AREAS INSPECTED/.test(pages[planPage].split('\n').slice(0, 3).join(' ')), `the report prints it in Areas Inspected, before Section 5 (pages ${areasPage + 1}, ${planPage + 1}, ${accessPage + 1})`);
  check(planPage >= 0 && /The plan shows 1 area that could not be inspected and 1 place where termite activity or damage was found\./.test(pages[planPage].replace(/\s+/g, ' ')) && /LEGEND/.test(pages[planPage]) && /Termite activity or damage found/.test(pages[planPage]), 'with what it shows and its legend, on the same page');
  check(pages.some(t => /Areas Inspected\s+\d*\s*\n?\s*Each area, how much of it was inspected, and what was found there, with the site plan\./.test(t)), 'the contents says the site plan is there');

  // ── 4. Changing it after the report went is a change ──
  await p.evaluate(() => { reportData.sent = { at: Date.now(), fingerprint: reportFingerprint(), version: 1 }; saveCurrentReport(true); });
  await p.evaluate(() => openReportSitePlan()); await p.waitForTimeout(300);
  await tool('Findings', 'Moisture or leak'); await tapPlan(700, 300);
  await tap(p.locator('#sitePlanOverlay button', { hasText: 'Save site plan' }), 'Save site plan (2)'); await p.waitForTimeout(400);
  check(await p.evaluate(() => !reportMatches(reportData.sent.fingerprint)), 'a plan changed after the report was sent makes the report read as changed');
  check(await p.evaluate(() => JSON.stringify(changedSections({ sitePlan: 'a' }, { sitePlan: 'b' }))) === '["Areas inspected"]', 'and an amended version lists it under Areas inspected');

  // ── 5. The treatment record starts from it ──
  await p.evaluate(() => {
    openQuoteFromReport();
    quoteState.items = [newQuoteItem('bait_install', { qty: '' }), newQuoteItem('bait_monitor')];
    quoteState.answer = { status: 'accepted', by: 'Sam Taylor', date: todayIsoDate(), method: 'phone', note: '', at: Date.now(), hash: quoteContentHash(quoteState) };
    persistQuote(); storeQuoteOnReport(quoteState, false); closeQuote(); tabGo('job');
  });
  await p.waitForTimeout(600);
  await p.evaluate(() => openTreatmentRecord()); await p.waitForTimeout(600);
  await p.evaluate(() => { document.getElementById('trFold3').open = true; document.getElementById('trPlan').scrollIntoView({ block: 'center' }); });
  const rec = await p.evaluate(() => ({ items: (treatmentPlanDraft && treatmentPlanDraft.items || []).map(i => i.k).sort(), card: document.getElementById('trPlan').innerText.replace(/\s+/g, ' ') }));
  check(JSON.stringify(rec.items) === JSON.stringify(['activity', 'house', 'moisture', 'noaccess']), 'a new treatment record starts from the report\'s plan: ' + rec.items.join(', '));
  check(/Started from the report's plan\. Add what you treated and any stations\./.test(rec.card), 'and says so: ' + rec.card.slice(-160));
  await p.screenshot({ path: `${OUT}/4-record.png` });
  await tap(p.locator('#trPlan .treat-plan-view').first(), 'the record\'s plan'); await p.waitForTimeout(400);
  const ted = await p.evaluate(() => ({ mode: sitePlanEditor.mode, group: sitePlanEditor.group, tabs: [...document.querySelectorAll('#spGroups .sp-group')].map(b => b.textContent) }));
  check(ted.mode === 'treatment' && ted.tabs.includes('Treatment') && ted.tabs.includes('Stations') && ted.group === 'stations', 'on the record it opens with the treatment\'s tabs, on Stations for a baiting job: ' + JSON.stringify(ted));
  await tool('Stations', 'In-ground'); for (const [x, y] of [[225, 175], [775, 175], [800, 525]]) await tapPlan(x, y);
  await tap(p.locator('#sitePlanOverlay button', { hasText: 'Save site plan' }), 'Save site plan (3)'); await p.waitForTimeout(400);
  const after = await p.evaluate(() => ({ rec: treatmentPlanDraft.items.map(i => i.k), report: reportData.sitePlan.items.map(i => i.k), note: /Started from the report/.test(document.getElementById('trPlan').innerText) }));
  check(after.rec.filter(k => k === 'inground').length === 3 && after.rec.includes('activity'), 'the stations go on the same drawing');
  check(!after.report.includes('inground'), 'and the report keeps the plan it has: ' + after.report.join(', '));
  check(!after.note, 'once something is added, the record\'s note goes');
  await p.evaluate(() => closeTreatmentRecord ? closeTreatmentRecord() : null).catch(() => {});
  await p.evaluate(() => { const o = document.getElementById('treatmentOverlay'); if (o.classList.contains('open')) cancelSheet('treatmentOverlay', true); });
  await p.waitForTimeout(300);

  // ── 6. A finalised report's plan stays as it is ──
  await p.evaluate(() => { tabGo('report'); goStep('areas'); lockJob(); }); await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('reportPlan').scrollIntoView({ block: 'center' }));
  await p.locator('#reportPlan .treat-plan-view').first().tap().catch(() => {});
  await p.waitForTimeout(400);
  check(await p.evaluate(() => !document.getElementById('sitePlanOverlay').classList.contains('open')), 'a finalised report\'s plan doesn\'t open to change');
  check(await p.evaluate(() => /finalised and locked/.test(document.getElementById('toast').textContent)), 'and it says why: ' + await p.evaluate(() => document.getElementById('toast').textContent));

  // ── 7. The sample job ──
  await p.evaluate(async () => { openSampleJob(); await new Promise(r => setTimeout(r, 1500)); if (document.getElementById('quoteScreen').classList.contains('open')) closeQuote(); });
  await p.waitForTimeout(800);
  const sample = await p.evaluate(() => { const q = getSavedQuotes()[currentReportId]; const rk = reportData.sitePlan.items.map(i => i.id), tk = q.treatment.plan.items.map(i => i.id);
    return { report: rk.length, sameDrawing: rk.every(id => tk.includes(id)), added: tk.filter(id => !rk.includes(id)).sort(), reportHasBarrier: rk.includes('ps_barrier') }; });
  check(sample.report > 5 && sample.sameDrawing && JSON.stringify(sample.added) === '["ps_barrier","ps_foam"]' && !sample.reportHasBarrier, 'the sample report has a plan, and its treatment\'s is the same drawing with the barrier and foam added: ' + JSON.stringify(sample));
  const spages = await pdfText('buildReportPdf', 'sample-report');
  check(spages.some(t => /SITE PLAN/.test(t) && /Weep holes bridged/.test(t)), 'the sample report prints it');

  check(!dialogs.length, 'the browser\'s grey box was never used: ' + dialogs.join(' | '));
  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
