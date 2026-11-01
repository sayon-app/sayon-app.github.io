// Photo markup: open a report photo, circle the spot, add an arrow and a
// label, save; the photo, the backup and the PDF carry the marks, and they
// can be changed or removed later. node e2e.js <outDir>  (server on :8765)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/photo-markup'; fs.mkdirSync(OUT, { recursive: true });
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
  await ctx.route(/workers\.dev/, r => r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } }));
  const uploaded = [];
  await ctx.route(/supabase\.co/, r => {
    const u = r.request().url();
    if (u.includes('/storage/v1/object/') && r.request().method() === 'POST') { uploaded.push(u.split('/').pop()); return r.fulfill({ status: 200, json: {} }); }
    return r.fulfill({ json: u.includes('businesses?owner_id') ? [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] : [] });
  });
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1', '1'); }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  await p.evaluate(async (sc) => {
    storeCompanyDetails(sc.company); openApp('inspect'); resetReportState();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    for (const [k, v] of Object.entries(sc.job)) set(k, v); updateJob(); await populateFields(sc.fields);
    // A timber-coloured stand-in photo.
    const c = document.createElement('canvas'); c.width = 1200; c.height = 900; const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 1200, 900); grad.addColorStop(0, '#8a6a45'); grad.addColorStop(1, '#3b2a1a');
    g.fillStyle = grad; g.fillRect(0, 0, 1200, 900);
    for (let i = 0; i < 30; i++) { g.strokeStyle = 'rgba(0,0,0,0.15)'; g.beginPath(); g.moveTo(0, i * 30); g.bezierCurveTo(400, i * 30 + 20, 800, i * 30 - 20, 1200, i * 30); g.stroke(); }
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    await handleSectionPhotoFiles([new File([blob], 'bearer.jpg', { type: 'image/jpeg' })], 'findings');
  }, sc);
  await p.waitForTimeout(1500);
  const photoId = await p.evaluate(() => getSectionPhotos('findings')[0].id);
  const sizeOf = () => p.evaluate(async id => { const b = await getPhotoBlob(id); return b ? b.size : 0; }, photoId);
  const before = await sizeOf();
  uploaded.length = 0;

  // Open the photo and the markup screen from the viewer.
  await p.evaluate(id => openPhotoViewer(id), photoId); await p.waitForTimeout(500);
  const btn = p.locator('#photoViewerMarkup');
  check(await btn.isVisible(), 'the photo viewer offers Mark up');
  await p.screenshot({ path: `${OUT}/1-viewer.png` });
  await btn.click(); await p.waitForTimeout(500);
  check(await p.locator('#photoMarkup').isVisible() && await p.locator('#photoViewer').isHidden(), 'Mark up opens the markup screen');

  const box = await p.locator('#markupCanvas').boundingBox();
  const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
  const drag = async (from, to) => { await p.mouse.move(...at(...from)); await p.mouse.down(); for (let i = 1; i <= 8; i++) await p.mouse.move(at(from[0] + (to[0] - from[0]) * i / 8, 0)[0], at(0, from[1] + (to[1] - from[1]) * i / 8)[1]); await p.mouse.up(); };
  await drag([0.35, 0.35], [0.65, 0.6]);                       // circle (default tool)
  await p.locator('[data-markup-tool="arrow"]').click(); await drag([0.1, 0.9], [0.33, 0.55]);
  await p.locator('[data-markup-colour="yellow"]').click();
  await p.locator('[data-markup-tool="text"]').click();
  await p.mouse.click(...at(0.05, 0.15)); await p.waitForTimeout(200);
  check(await p.locator('#markupLabelBar').isVisible(), 'tapping with Label asks for the words');
  await p.fill('#markupLabelInput', 'Termite workings');
  await p.screenshot({ path: `${OUT}/2-label.png` });
  await p.keyboard.press('Enter');
  await p.locator('[data-markup-tool="pen"]').click(); await drag([0.7, 0.2], [0.9, 0.3]);
  check(await p.evaluate(() => markupState.shapes.map(s => s.type).join(',')) === 'circle,arrow,text,pen', 'four marks drawn: circle, arrow, label, line');
  await p.locator('#markupUndo').click();
  check(await p.evaluate(() => markupState.shapes.length) === 3, 'Undo takes the last mark off');
  await p.screenshot({ path: `${OUT}/3-marked.png` });
  await p.locator('#markupSave').click(); await p.waitForTimeout(1500);

  const saved = await p.evaluate(async id => {
    const ph = getSectionPhotos('findings')[0];
    const orig = await getPhotoBlob('orig_' + id);
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    const dp = draft && draft.reportData.photosBySection.findings[0];
    return { marks: (ph.markup || []).length, orig: orig ? orig.size : 0, path: ph.path, draftMarks: dp && (dp.markup || []).length, toast: document.getElementById('toast').textContent, closed: document.getElementById('photoMarkup').hidden };
  }, photoId);
  const after = await sizeOf();
  check(saved.closed && saved.marks === 3 && saved.draftMarks === 3, 'Save keeps three marks on the photo and in the saved draft');
  check(saved.orig === before && after !== before, 'the clean photo is kept on the phone and the stored photo is the marked one');
  check(uploaded.includes(photoId + '.jpg') && !!saved.path, 'the marked photo is backed up again over the old copy');
  check(/Marks saved/.test(saved.toast), 'toast confirms: ' + saved.toast);
  await p.evaluate(() => { document.querySelector('[data-section="findings"], #section-findings')?.scrollIntoView(); });
  await p.screenshot({ path: `${OUT}/4-after-save.png` });

  // Tidy-up must keep the clean copy while the photo is in a report.
  await p.evaluate(() => tidyPhotoStorage()); await p.waitForTimeout(300);
  check(await p.evaluate(async id => !!(await getPhotoBlob('orig_' + id)), photoId), 'the photo tidy-up keeps the clean copy');

  // The PDF builds with the marked photo.
  const pdf = await p.evaluate(async () => { try { const r = await buildReportPdf(); return r && r.blob ? r.blob.size : 0; } catch (e) { return 'error ' + e.message; } });
  check(typeof pdf === 'number' && pdf > 0, 'the report PDF builds with the marked photo: ' + pdf);

  // Reopen: the marks can be moved; Clear all and Save puts the clean photo back.
  await p.evaluate(id => openPhotoMarkup(id), photoId); await p.waitForTimeout(500);
  check(await p.evaluate(() => markupState.shapes.length) === 3, 'reopening shows the three marks to change');
  await p.locator('#markupClear').click(); await p.locator('#markupSave').click(); await p.waitForTimeout(1000);
  const cleared = await p.evaluate(() => getSectionPhotos('findings')[0].markup);
  check(!cleared && await sizeOf() === before, 'Clear all and Save puts the clean photo back');

  // Cancel changes nothing.
  await p.evaluate(id => openPhotoMarkup(id), photoId); await p.waitForTimeout(400);
  await drag([0.2, 0.2], [0.4, 0.4]);
  await p.getByRole('button', { name: 'Cancel' }).click(); await p.waitForTimeout(300);
  check(!(await p.evaluate(() => getSectionPhotos('findings')[0].markup)) && await sizeOf() === before, 'Cancel leaves the photo as it was');

  // A complete, locked job has no Mark up.
  await p.evaluate(() => { reportData.issue = { version: 1 }; reportData.amending = false; });
  await p.evaluate(id => openPhotoViewer(id), photoId); await p.waitForTimeout(300);
  check(await btn.isHidden(), 'a locked job hides Mark up');
  await p.evaluate(() => { closePhotoViewer(); delete reportData.issue; });

  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
