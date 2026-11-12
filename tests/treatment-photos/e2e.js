// Photos on the treatment record: photos of the work and of the durable
// notice are taken on the record's sheet, kept in the photo store like a
// report's photos (kept by the tidy-up, uploaded when the job syncs, their
// paths kept on the quote), and printed on a Photos page of the treatment
// certificate, led by the report's front photo. A record without photos
// makes the same certificate as before.
// node e2e.js <outDir>  (serve the repo on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs'); const { execFileSync } = require('child_process');
const OUT = process.argv[2] || '/tmp/treatment-photos'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf', uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
let shotN = 0;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } }));
  const uploads = [];
  await ctx.route(/supabase\.co/, r => {
    const u = r.request().url();
    if (u.includes('/storage/v1/object/') && r.request().method() === 'POST') { uploads.push(u); return r.fulfill({ json: { Key: 'ok' } }); }
    if (u.includes('businesses?owner_id')) return r.fulfill({ json: [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] });
    return r.fulfill({ json: [] });
  });
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1:u-owner', '1'); localStorage.setItem('korva_onboarded_v1', '1'); }, sess);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  const shot = async (name, opts = {}) => { await p.waitForTimeout(250); await p.screenshot({ path: `${OUT}/${String(++shotN).padStart(2, '0')}-${name}.png`, ...opts }); };
  const tap = async (loc, what) => { try { await loc.scrollIntoViewIfNeeded({ timeout: 3000 }); await loc.tap({ timeout: 5000 }); return true; } catch (e) { check(false, 'tap ' + what + ': ' + e.message.split('\n')[0]); return false; } };
  const sign = async (canvasSel) => {
    const c = p.locator(canvasSel); await c.scrollIntoViewIfNeeded(); const bb = await c.boundingBox();
    await p.mouse.move(bb.x + 20, bb.y + bb.height / 2); await p.mouse.down();
    for (let i = 1; i <= 12; i++) await p.mouse.move(bb.x + 20 + i * (bb.width - 40) / 12, bb.y + bb.height / 2 + (i % 2 ? -15 : 15));
    await p.mouse.up();
  };
  const pdfText = (b64, name) => {
    fs.writeFileSync(`${OUT}/${name}.pdf`, Buffer.from(b64, 'base64'));
    try { execFileSync('pdftoppm', ['-png', '-r', '70', `${OUT}/${name}.pdf`, `${OUT}/${name}`]); } catch (e) {}
    try { return execFileSync('pdftotext', ['-layout', `${OUT}/${name}.pdf`, '-']).toString(); } catch (e) { return ''; }
  };
  const certificate = () => p.evaluate(async () => {
    await ensureJsPDFLoaded(); await loadTreatmentPhotos(quoteState, true);
    const { blob } = buildTreatmentCertificatePDF(quoteState);
    const buf = new Uint8Array(await blob.arrayBuffer()); let s = '';
    for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768));
    return { b64: btoa(s), pages: (s.match(/\/Type\s*\/Page[^s]/g) || []).length };
  });

  // Three photos to take: made from coloured pages, as JPEGs.
  const pics = [];
  for (const [i, colour] of ['#c8e6c9', '#bbdefb', '#ffe0b2'].entries()) {
    await p.setContent(`<body style="margin:0;background:${colour}"><div style="font:bold 90px sans-serif;padding:120px 40px">Photo ${i + 1}</div></body>`);
    const f = `${OUT}/pic-${i + 1}.jpg`; await p.screenshot({ path: f, type: 'jpeg', quality: 80 }); pics.push(f);
  }

  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);

  // A job with a front photo and an accepted quote for a chemical barrier.
  await p.evaluate(async ({ sc }) => {
    storeCompanyDetails(sc.company); openApp('inspect'); resetReportState();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    for (const [k, v] of Object.entries(sc.job)) set(k, v); updateJob();
    document.getElementById('jobClientEmail').value = 'sam@example.com'; updateJob();
    await populateFields(Object.assign({}, sc.fields, { floorType: 'Concrete slab', existingSystem: 'No System Found' }));
    // The front of the property, as the report's cover photo.
    const c = document.createElement('canvas'); c.width = 640; c.height = 420;
    const g = c.getContext('2d'); g.fillStyle = '#90a4ae'; g.fillRect(0, 0, 640, 420); g.fillStyle = '#fff'; g.font = 'bold 60px sans-serif'; g.fillText('Front', 220, 230);
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.8));
    await putPhotoBlob('photo_front', blob);
    getSectionPhotos('general').push({ id: 'photo_front', width: 640, height: 420, caption: '' });
    saveCurrentReport(true);
    openQuoteFromReport();
    quoteState.items = [newQuoteItem('barrier_lm', { qty: '40' })];
    quoteState.clientEmail = 'sam@example.com';
    quoteState.answer = { status: 'accepted', by: 'Sam Taylor', date: todayIsoDate(), method: 'signed', note: '', at: Date.now(), hash: quoteContentHash(quoteState) };
    persistQuote(); storeQuoteOnReport(quoteState, false);
    closeQuote(); tabGo('job');
  }, { sc });
  await p.waitForTimeout(500);

  // 1. The record has a box for photos of the work, and one for the notice.
  await p.evaluate(() => openTreatmentRecord()); await p.waitForTimeout(400);
  await p.evaluate(() => { document.getElementById('trFold3').open = true; document.getElementById('trFold4').open = true; });
  const boxes = await p.evaluate(() => ({
    work: !!document.querySelector('#trWorkPhotos .spot-photo-add') && document.querySelector('#trWorkPhotos').closest('.job-field').querySelector('.job-field-label').textContent,
    notice: !!document.querySelector('#trNoticePhotos .spot-photo-add') && !document.getElementById('trNoticePhotoWrap').hidden,
  }));
  check(boxes.work === 'Photos of the work', 'Areas treated has Photos of the work, with Add photo');
  check(boxes.notice, 'Client handover has a Photo of the notice box while a notice is placed');

  // 2. Two photos of the work, through Add photo (the camera).
  for (const f of pics.slice(0, 2)) {
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), tap(p.locator('#trWorkPhotos .spot-photo-add'), 'Add photo (work)')]);
    await fc.setFiles(f); await p.waitForTimeout(600);
  }
  await p.fill('#trWorkPhotos .spot-photo:nth-child(1) .photo-caption-input', 'Trench along the east wall before the treatment');
  // One of the notice, through Choose one instead.
  await tap(p.locator('#trNoticePhotos .photo-choose'), 'Choose one instead (notice)');
  const [fc3] = await Promise.all([p.waitForEvent('filechooser'), tap(p.locator('#photoSourceLibrary'), 'Photo library')]);
  await fc3.setFiles(pics[2]); await p.waitForTimeout(600);
  const onSheet = await p.evaluate(() => ({ work: document.querySelectorAll('#trWorkPhotos .spot-photo').length, notice: document.querySelectorAll('#trNoticePhotos .spot-photo').length,
    shown: [...document.querySelectorAll('#trWorkPhotos img, #trNoticePhotos img')].every(i => i.src && i.src.startsWith('blob:')) }));
  check(onSheet.work === 2 && onSheet.notice === 1, `the photos show in their boxes (work ${onSheet.work}, notice ${onSheet.notice})`);
  check(onSheet.shown, 'each photo shows its picture');
  await p.locator('#trWorkPhotos').scrollIntoViewIfNeeded(); await shot('record-work-photos');
  await p.locator('#trNoticePhotos').scrollIntoViewIfNeeded(); await shot('record-notice-photo');

  // 3. Remove and Undo puts it back where it was.
  await tap(p.locator('#trWorkPhotos .spot-photo:nth-child(2) .photo-remove-btn'), 'Remove');
  check(await p.evaluate(() => document.querySelectorAll('#trWorkPhotos .spot-photo').length) === 1, 'Remove takes the photo off');
  await p.evaluate(() => document.querySelector('.toast-action, #toast button') && document.querySelector('.toast-action, #toast button').click());
  await p.waitForTimeout(200);
  check(await p.evaluate(() => document.querySelectorAll('#trWorkPhotos .spot-photo').length) === 2, 'Undo puts it back');

  // 4. The certificate before saving the photos is the old one.
  const before = await p.evaluate(async () => { await ensureJsPDFLoaded(); const q = quoteState; const saved = q.treatment; q.treatment = readTreatmentForm(); q.treatment.photos = []; const n = (await new Response(buildTreatmentCertificatePDF(q).blob).text()).match(/\/Type\s*\/Page[^s]/g).length; q.treatment = saved; return n; });

  // 5. Sign and save: the record carries the photos.
  await sign('#trSigCanvas'); await p.waitForTimeout(200);
  await tap(p.locator('#trSaveBtn'), 'Save treatment record'); await p.waitForTimeout(600);
  const rec = await p.evaluate(() => {
    const t = quoteState.treatment;
    const stored = getSavedQuotes()[quoteState.reportKey].treatment;
    const onReport = getSavedReports().find(r => r.id === quoteState.reportKey).quote.treatment;
    return { kinds: (t.photos || []).map(x => x.kind).join(','), caption: t.photos[0].caption, stored: stored.photos.length, onReport: onReport.photos.length, ids: t.photos.map(x => x.id) };
  });
  check(rec.kinds === 'work,work,notice', 'the record keeps the photos with what they are: ' + rec.kinds);
  check(rec.caption === 'Trench along the east wall before the treatment', 'and their details');
  check(rec.stored === 3 && rec.onReport === 3, 'on the quote and on the job it travels with');

  // 6. The tidy-up when the app opens keeps them.
  const kept = await p.evaluate(async (ids) => { await tidyPhotoStorage(); const out = []; for (const id of ids) out.push(!!(await getPhotoBlob(id))); return out; }, rec.ids);
  check(kept.every(Boolean), 'the tidy-up keeps the record\'s photos on the phone');

  // 7. The certificate gets a Photos page, led by the front of the property.
  const after = await certificate();
  const text = pdfText(after.b64, 'certificate-photos');
  check(after.pages === before + 1, `the certificate has one more page (${before} → ${after.pages})`);
  check(/PHOTOS/.test(text) && /FRONT OF THE PROPERTY/.test(text) && (text.match(/THE WORK/g) || []).length === 2 && /THE DURABLE NOTICE/.test(text), 'the Photos page has the front, the two of the work and the notice');
  check(/Trench along the east wall/.test(text), 'with their details under them');

  // 8. The job syncs: the photos go up and their paths stay on the quote.
  const sync = await p.evaluate(async () => {
    const entry = getSavedReports().find(r => r.id === quoteState.reportKey);
    await supabaseSaveNow(entry);
    const q = readJSON(quotesStorageKey(), {})[quoteState.reportKey];
    return { paths: q.treatment.photos.map(x => x.path || ''), state: quoteState.treatment.photos.map(x => x.path || '') };
  });
  check(rec.ids.every(id => uploads.some(u => u.includes(id))), `each photo is uploaded (${uploads.length} uploads)`);
  check(sync.paths.every(Boolean) && sync.state.every(Boolean), 'their paths are kept on the stored quote and the open one');

  // 9. No notice placed: its photo box goes, and its photo isn't kept or printed.
  await p.evaluate(() => openTreatmentRecord()); await p.waitForTimeout(400);
  await p.evaluate(() => { document.getElementById('trFold4').open = true; });
  await p.selectOption('#trNotice', 'none'); await p.waitForTimeout(100);
  check(await p.evaluate(() => document.getElementById('trNoticePhotoWrap').hidden && document.getElementById('trNoticeWhereWrap').hidden), 'No notice placed hides Where and the notice photo');
  await tap(p.locator('#trSaveBtn'), 'Save again'); await p.waitForTimeout(500);
  check(await p.evaluate(() => quoteState.treatment.photos.map(x => x.kind).join(',')) === 'work,work', 'the notice photo is dropped with the notice');
  const noNotice = pdfText((await certificate()).b64, 'certificate-no-notice');
  check(!/THE DURABLE NOTICE/.test(noNotice) && /THE WORK/.test(noNotice), 'and the certificate leaves it out');

  // 10. A photo on a record not yet saved survives the app closing.
  await p.evaluate(() => openTreatmentRecord()); await p.waitForTimeout(300);
  await p.evaluate(() => { document.getElementById('trFold3').open = true; });
  const [fc4] = await Promise.all([p.waitForEvent('filechooser'), tap(p.locator('#trWorkPhotos .spot-photo-add'), 'Add photo (unsaved)')]);
  await fc4.setFiles(pics[2]); await p.waitForTimeout(800);
  const unsaved = await p.evaluate(async () => {
    keepUnsavedSheet();
    const copy = unsavedSheetCopy('treatment|' + quoteState.reportKey);
    const id = copy && copy.data.photos[2] && copy.data.photos[2].id;
    await tidyPhotoStorage();
    return { n: copy ? copy.data.photos.length : 0, kept: !!(id && await getPhotoBlob(id)) };
  });
  check(unsaved.n === 3 && unsaved.kept, 'the unsaved record keeps its new photo, and the tidy-up leaves it');

  check(!errs.length, 'no page errors: ' + errs.join(' | '));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
  process.exit(fails.length ? 1 : 0);
})();
