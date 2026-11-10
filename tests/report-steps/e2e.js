// The report's steps, in the order the inspector meets them. The Property
// step starts with the Visit, and the weather fills itself when a job
// booked ahead is opened on its day. A signed agreement has no banner and
// no Sign-off block. Areas is under way from the first area marked, and an
// area with a limit takes its exact spot and photos on its own card, read
// back in Areas unable to be inspected. Add photo opens the camera, with
// Choose one instead beside it. A conducive condition answered as a problem
// takes its own photos; the old section boxes only show for a report that
// already has photos in them. The viewer shows the caption only. The
// inspector's signature carries to the next report until Sign again.
// node e2e.js <outDir>  (serve the repo on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/report-steps'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf', uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };

// The canned backend. The weather route counts its calls.
const weatherCalls = [];
async function backend(ctx) {
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => {
    const u = r.request().url();
    if (u.includes('/weather')) { weatherCalls.push(u); return r.fulfill({ json: { type: 'RAIN_SHOWERS', tempC: 21.4, humidity: 68, rain24h: 3.26 } }); }
    if (u.includes('/send-email')) return r.fulfill({ json: { configured: true, ok: true } });
    return r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } });
  });
  await ctx.route(/supabase\.co/, r => {
    const u = r.request().url();
    if (u.includes('businesses?owner_id')) return r.fulfill({ json: [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] });
    return r.fulfill({ json: [] });
  });
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await backend(ctx);
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1', '1'); localStorage.setItem('korva_onboarded_v1:u-owner', '1'); }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  let shotN = 0;
  const shot = async name => { await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/${String(++shotN).padStart(2, '0')}-${name}.png` }); };
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = iso(new Date());
  const later = (() => { const d = new Date(); d.setDate(d.getDate() + 2); return iso(d); })();
  const weather = () => p.evaluate(() => ({ c: reportData.weatherConditions || '', t: reportData.temperature || '', h: reportData.humidity || '', r: reportData.rainLast24h || '',
    shown: ['weatherConditions', 'temperature', 'humidity', 'rainLast24h'].map(k => document.getElementById('f-' + k).textContent.trim()).join(' | ') }));

  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  await p.evaluate(sc => { storeCompanyDetails(sc.company); openApp('inspect'); startNewJob(); }, sc);
  await p.waitForTimeout(800);
  await p.evaluate(() => {
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('jobAddress', '7 Banksia Drive'); set('jobSuburb', 'Epping'); set('jobPostcode', '2121'); set('jobClient', 'Sam Taylor');
  });

  // ── 1. The Property step runs Visit, Building, Site, Termite system ──
  await p.evaluate(() => { saveCurrentReport(true); jobGo('report'); goStep('property'); }); await p.waitForTimeout(500);
  const groups = await p.evaluate(() => [...document.querySelectorAll('#section-property > details.fgroup .fgroup-title')].map(e => e.textContent.trim()));
  check(groups.join(', ') === 'Visit, Building, Site, Termite system', 'the Property step runs ' + groups.join(', '));
  const first = await p.evaluate(() => { const f = document.querySelector('#section-property .field-val'); return f && f.id; });
  check(first === 'f-occupancyStatus', 'and its first answer is who is living there (' + first + ')');
  await shot('property-visit-first');

  // ── 2. The weather on the day ──
  // Booked two days out, the address picked from the list today: nothing
  // is fetched, today or when the job is opened again before its day.
  await p.evaluate(later => { tabGo('job'); pickJobDate(later); reportData.siteLocation = { lat: -33.7727, lng: 151.0818 }; saveCurrentReport(true); }, later);
  await p.waitForTimeout(300);
  const id = await p.evaluate(() => currentReportId);
  await p.evaluate(id => { tabGo('dashboard'); openDashboardJob(id, 'job'); }, id); await p.waitForTimeout(700);
  check(weatherCalls.length === 0 && !(await weather()).t, 'a job booked for a later day takes no weather when it is opened early');

  // The day comes (the booking is moved to today, as the clock would): the
  // weather is fetched once and fills the four blanks.
  await p.evaluate(today => pickJobDate(today), today); await p.waitForTimeout(900);
  let w = await weather();
  console.log('on the day:', JSON.stringify(w), weatherCalls.length);
  check(weatherCalls.length === 1 && w.c === 'Light rain' && w.t === '21°C' && w.h === '68%' && w.r === '3.3 mm', 'on the inspection day the weather fills itself: ' + w.shown);
  check(/lat=-33\.7727&lng=151\.0818/.test(weatherCalls[0] || ''), 'from the address that was picked');
  await p.evaluate(() => { saveCurrentReport(true); jobGo('report'); goStep('property'); }); await p.waitForTimeout(400);
  check(weatherCalls.length === 1, 'and it is not fetched again once it is in');
  await p.evaluate(() => document.getElementById('weatherFillBtn').scrollIntoView({ block: 'center' })); await shot('weather-filled');

  // The inspector's own reading stays when the day moves; what the weather
  // filled goes, since it was the old day's.
  await p.evaluate(later => { reportData.humidity = '74%'; renderField(document.getElementById('f-humidity'), 'humidity', '74%'); tabGo('job'); pickJobDate(later); }, later);
  await p.waitForTimeout(500);
  w = await weather();
  console.log('moved on:', JSON.stringify(w));
  check(!w.c && !w.t && !w.r && w.h === '74%' && w.shown === '— | — | 74% | —', 'moving the inspection to another day clears the old day\'s weather and keeps a reading the inspector gave: ' + w.shown);

  // Opened from Jobs on the day, with the report already under way.
  await p.evaluate(today => { reportData.jobInspectionDate = today; document.getElementById('jobInspectionDate').value = today; saveCurrentReport(true); tabGo('dashboard'); }, today);
  await p.waitForTimeout(300);
  const before = weatherCalls.length;
  await p.evaluate(id => openDashboardJob(id, 'job'), id); await p.waitForTimeout(900);
  w = await weather();
  console.log('opened on the day:', JSON.stringify(w), weatherCalls.length - before);
  check(weatherCalls.length === before + 1 && w.c === 'Light rain' && w.t === '21°C' && w.h === '74%' && w.r === '3.3 mm', 'opening the job on its day fills the blanks and leaves the reading already there: ' + w.shown);

  // A report marked done is left alone.
  await p.evaluate(() => { delete reportData.temperature; reportData.doneAt = Date.now(); saveCurrentReport(true); tabGo('dashboard'); weatherTried.clear(); });
  await p.evaluate(id => openDashboardJob(id, 'job'), id); await p.waitForTimeout(700);
  check(weatherCalls.length === before + 1 && !(await weather()).t, 'a report already marked done takes no weather');
  await p.evaluate(() => { delete reportData.doneAt; saveCurrentReport(true); });

  // ── 3. The agreement is asked for on the first step until it is signed ──
  await p.evaluate(() => { jobGo('report'); goStep('property'); }); await p.waitForTimeout(400);
  const banner = () => p.evaluate(() => { const b = document.getElementById('agreementBanner'); return { shown: !b.hidden && b.offsetParent !== null, text: b.textContent.replace(/\s+/g, ' ').trim() }; });
  let bn = await banner();
  check(bn.shown && /not signed yet/.test(bn.text) && /Get it signed/.test(bn.text), 'with no agreement the Property step asks for it: ' + bn.text);
  await p.evaluate(() => { reportData.agreement = { signerName: 'Sam Taylor', signedAt: new Date().toISOString(), method: 'device', text: 'Agreement', signature: null }; restoreSignaturePads(); updateProgress(); });
  bn = await banner();
  check(!bn.shown, 'a signed agreement has no banner on the report');
  await p.evaluate(() => goStep('finish')); await p.waitForTimeout(300);
  const so = await p.evaluate(() => { const s = document.getElementById('section-signoff'); return { block: /client agreement/i.test(s.textContent), opens: s.querySelectorAll('[onclick*="openAgreementSheet"]').length }; });
  check(!so.block && !so.opens, 'and Sign-off has no agreement block: ' + JSON.stringify(so));

  // ── 4. Areas: under way from the first area, the spot and its photo on the area's card ──
  await p.evaluate(() => goStep('areas')); await p.waitForTimeout(400);
  const areasState = () => p.evaluate(() => ({ badge: document.getElementById('sts-obstructions').textContent, dot: document.getElementById('dot-areas').className }));
  let as = await areasState();
  check(as.badge === 'Not started' && as.dot === 'tab-dot', 'Areas reads Not started with no area marked: ' + JSON.stringify(as));
  const sub = p.locator('[data-zone-node="subfloor"]');
  await sub.locator('summary').click(); await p.waitForTimeout(300);
  await sub.locator('.area-status-btn', { hasText: /^Inspected$/ }).click(); await p.waitForTimeout(300);
  as = await areasState();
  check(as.badge === 'In progress' && /partial/.test(as.dot), 'and In progress, with its tab dot, from the first area marked: ' + JSON.stringify(as));
  check(await sub.locator('.area-spot').count() === 0, 'an area inspected in full asks for no spot');
  await sub.locator('.obs-item-btn', { hasText: 'Low clearance' }).click(); await p.waitForTimeout(300);
  const card = await p.evaluate(() => { const n = document.querySelector('[data-zone-node="subfloor"] .obs-reasons-hindered .area-spot'); return n ? { spot: n.querySelector('.access-spot').textContent.trim(), add: n.querySelector('.spot-photo-add').textContent.trim(), choose: n.querySelector('.photo-choose').textContent.trim() } : null; });
  check(card && card.spot === 'Add exact spot' && card.add === 'Add photo' && card.choose === 'Choose one instead', 'a reason ticked puts the exact spot and Add photo under it, on the area\'s card: ' + JSON.stringify(card));
  await sub.locator('.obs-reasons-hindered .access-spot').click();
  await p.keyboard.type('North-east corner, under the bathroom'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  check(/North-east corner/.test(await sub.locator('.obs-reasons-hindered .access-spot').textContent()) && await sub.locator('details').evaluate(d => d.open), 'the spot typed there stays on the card, which stays open');

  // Add photo is the camera; Choose one instead asks library or files.
  const jpeg = Buffer.from((await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 800; c.height = 600; const g = c.getContext('2d'); g.fillStyle = '#7a5a3a'; g.fillRect(0, 0, 800, 600); g.fillStyle = '#3b2a1a'; g.fillRect(100, 100, 300, 200); return c.toDataURL('image/jpeg', 0.85); })).split(',')[1], 'base64');
  const photoFile = name => ({ name, mimeType: 'image/jpeg', buffer: jpeg });
  const inputState = id => p.evaluate(id => { const i = document.getElementById(id); return { capture: i.getAttribute('capture'), accept: i.accept }; }, id);
  const sheet = () => p.evaluate(() => ({ open: document.getElementById('photoSourceOverlay').classList.contains('open'), title: document.getElementById('photoSourceTitle').textContent,
    camera: !document.getElementById('photoSourceCamera').hidden, libraryQuiet: document.getElementById('photoSourceLibrary').classList.contains('quiet') }));
  let chooser = p.waitForEvent('filechooser');
  await sub.locator('.obs-reasons-hindered .spot-photo-add').click();
  let fc = await chooser;
  let inp = await inputState('spotPhotoInput');
  check(inp.capture === 'environment' && inp.accept === 'image/*' && !(await sheet()).open, 'Add photo opens the camera straight away, with no sheet first: ' + JSON.stringify(inp));
  await fc.setFiles(photoFile('subfloor.jpg')); await p.waitForTimeout(900);
  check(await p.evaluate(() => getSectionPhotos(spotPhotoSection('hindered', 'subfloor')).length) === 1 && await sub.locator('.obs-reasons-hindered .spot-photo img').count() === 1, 'the photo lands on that area\'s spot');
  await sub.locator('.obs-reasons-hindered .photo-choose').click(); await p.waitForTimeout(300);
  let sh = await sheet();
  check(sh.open && sh.title === 'Choose a photo' && !sh.camera && !sh.libraryQuiet, 'Choose one instead asks photo library or files, without the camera again: ' + JSON.stringify(sh));
  await shot('choose-a-photo');
  chooser = p.waitForEvent('filechooser');
  await p.locator('#photoSourceLibrary').click();
  fc = await chooser;
  inp = await inputState('spotPhotoInput');
  check(inp.capture === null && inp.accept === 'image/*', 'the photo library opens without the camera: ' + JSON.stringify(inp));
  await fc.setFiles(photoFile('subfloor-2.jpg')); await p.waitForTimeout(900);
  check(await p.evaluate(() => getSectionPhotos(spotPhotoSection('hindered', 'subfloor')).length) === 2, 'and its photo lands on the same spot');
  await sub.evaluate(e => e.scrollIntoView({ block: 'start' })); await shot('spot-on-the-area-card');

  // Areas unable to be inspected reads it back; nothing is entered there.
  const acc = await p.evaluate(() => ({ names: [...document.querySelectorAll('#section-restrictions .access-item-name')].map(e => e.textContent),
    where: (document.querySelector('#section-restrictions .access-item-where') || {}).textContent, entry: document.querySelectorAll('#section-restrictions .access-spot, #section-restrictions .spot-photo-add').length }));
  check(acc.names.join() === 'Subfloor' && /North-east corner, under the bathroom · 2 photos/.test(acc.where || '') && acc.entry === 0, 'Areas unable to be inspected reads the spot and its photos back, with nothing to fill in there: ' + JSON.stringify(acc));
  // A photo box says how many it holds, and its limit only once that's close.
  const counts = await p.evaluate(() => [photoCountText(0, 30), photoCountText(1, 30), photoCountText(3, 30), photoCountText(26, 30), photoCountText(30, 30)]);
  check(counts.join(' | ') === ' | 1 photo | 3 photos | 26 photos, room for 4 more | 30 photos, which is all it holds', 'a photo box counts what it holds, and names its limit only when close: ' + counts.join(' | '));

  // ── 5. A conducive condition answered as a problem takes its own photos ──
  await p.evaluate(() => goStep('conducive')); await p.waitForTimeout(400);
  const strip = key => p.evaluate(key => { const b = document.getElementById('condPhotos-' + key); return { shown: !b.hidden && b.offsetParent !== null, photos: b.querySelectorAll('.spot-photo').length, add: !!b.querySelector('.spot-photo-add') }; }, key);
  check(!(await strip('timberSoil')).shown, 'a condition not answered has no photo strip');
  const answer = async (key, code) => { const c = p.locator(`#choices-${key} .choice-card`, { has: p.locator(`input[value="${code}"]`) }); await c.evaluate(e => e.scrollIntoView({ block: 'center' })); await c.click(); await p.waitForTimeout(400); };
  await answer('timberSoil', 'NO');
  check(!(await strip('timberSoil')).shown, 'nor has one answered as fine');
  await answer('timberSoil', 'YES');
  let st = await strip('timberSoil');
  check(st.shown && st.add && st.photos === 0, 'answered as a problem, it takes photos under its answer: ' + JSON.stringify(st));
  chooser = p.waitForEvent('filechooser');
  await p.locator('#condPhotos-timberSoil .spot-photo-add').click();
  await (await chooser).setFiles(photoFile('garden-bed.jpg')); await p.waitForTimeout(900);
  await p.locator('#condPhotos-timberSoil .spot-photo-caption').fill('Garden bed against the weatherboards');
  await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(200);
  st = await strip('timberSoil');
  const cond = await p.evaluate(() => ({ stored: getSectionPhotos(conditionPhotoSection('timberSoil')).length, old: (reportData.photosBySection.conducive || []).length, prints: conditionPhotos().map(x => x.caption) }));
  check(st.photos === 1 && cond.stored === 1 && cond.old === 0 && cond.prints.join() === 'Timber-to-soil contact: Garden bed against the weatherboards', 'the photo is kept with its condition and prints captioned with it: ' + JSON.stringify(cond));
  await p.evaluate(() => document.getElementById('condPhotos-timberSoil').scrollIntoView({ block: 'center' })); await shot('condition-photo');
  await answer('timberSoil', 'NO');
  check((await strip('timberSoil')).shown, 'a strip holding a photo stays in sight when the answer changes');
  await answer('timberSoil', 'YES');
  // The old section boxes: gone from a report with nothing in them, shown
  // (without an Add button) for one that already has photos there.
  const legacy = () => p.evaluate(() => [...document.querySelectorAll('[data-legacy-photos]')].map(b => ({ sec: b.closest('.report-section').id.replace('section-', ''), hidden: b.hidden, add: b.querySelectorAll('button[onclick*="takePhoto"], button[onclick*="choosePhotoSource"], input[type=file]').length })));
  let lg = await legacy();
  check(lg.length === 5 && lg.every(b => b.hidden), 'the old section photo boxes are out of a report with no photos in them: ' + lg.map(b => b.sec).join(', '));
  await p.evaluate(() => { const src = getSectionPhotos(conditionPhotoSection('timberSoil'))[0]; getSectionPhotos('conducive').push({ ...src, caption: 'From an older report' }); renderAllSectionPhotoGrids(); });
  lg = await legacy();
  const old = lg.find(b => b.sec === 'conducive');
  check(old && !old.hidden && old.add === 0 && lg.filter(b => !b.hidden).length === 1, 'a report that already has photos in one still shows them, with nothing to add: ' + JSON.stringify(old));
  const pdfText = await p.evaluate(async () => {
    const r = await buildReportPdf();
    const bytes = new Uint8Array(await r.blob.arrayBuffer());
    let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  });
  fs.writeFileSync(`${OUT}/report.pdf`, Buffer.from(pdfText, 'latin1'));
  // (The caption wraps under its photo, so its first line is what's looked for.)
  check(pdfText.includes('Timber-to-soil contact: Garden bed against') && pdfText.includes('From an older report'), 'the PDF prints both under the conducive conditions');
  await p.evaluate(() => { reportData.photosBySection.conducive = []; renderAllSectionPhotoGrids(); });

  // ── 6. Other photos, and the viewer ──
  await p.evaluate(() => goStep('finish')); await p.waitForTimeout(400);
  check(await p.evaluate(() => document.getElementById('photoCount').textContent) === '', 'Other photos shows no count while it is empty');
  chooser = p.waitForEvent('filechooser');
  await p.locator('#addPhotoBtn').evaluate(e => e.scrollIntoView({ block: 'center' }));
  await p.locator('#addPhotoBtn').click();
  fc = await chooser;
  inp = await inputState('photoFileInput');
  check(inp.capture === 'environment', 'Other photos\' Add photo opens the camera too');
  await fc.setFiles(photoFile('other.jpg')); await p.waitForTimeout(900);
  check(await p.evaluate(() => document.getElementById('photoCount').textContent) === '1 photo', 'and counts the photo once it is in: ' + await p.evaluate(() => document.getElementById('photoCount').textContent));
  await p.locator('#choosePhotoBtn').click(); await p.waitForTimeout(300);
  sh = await sheet();
  check(sh.open && sh.title === 'Choose a photo' && !sh.camera, 'with Choose one instead beside it');
  await p.evaluate(() => closePhotoSource());
  const otherId = await p.evaluate(() => reportData.photos[0].id);
  await p.evaluate(id => openPhotoViewer(id), otherId); await p.waitForTimeout(400);
  check(await p.evaluate(() => !document.getElementById('photoViewer').hidden && document.getElementById('photoViewerInfo').textContent) === '', 'the photo viewer shows no size in its corner');
  await p.evaluate(id => { closePhotoViewer(); reportData.photos[0].caption = 'Meter box on the east wall'; return openPhotoViewer(id); }, otherId); await p.waitForTimeout(400);
  check(await p.evaluate(() => document.getElementById('photoViewerInfo').textContent) === 'Meter box on the east wall', 'only the photo\'s caption');
  await p.evaluate(() => closePhotoViewer());

  // ── 7. The note and the button that fills the report say what they do ──
  const words = await p.evaluate(() => ({ title: document.getElementById('voicePopoverTitleText').textContent.trim(), status: document.getElementById('aiStatus').textContent,
    fill: [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Fill in the report'),
    old: ['Voice capture', 'Extract data with AI', 'AI ready', 'Data extracted'].filter(w => [...document.querySelectorAll('body *:not(script):not(style)')].some(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.includes(w)))) }));
  check(words.title === 'Your note' && words.status === 'Ready' && words.fill && !words.old.length, 'the note reads "Your note", its button "Fill in the report": ' + JSON.stringify(words));

  // ── 8. The inspector's signature carries to the next report ──
  const sig = () => p.evaluate(() => ({ signed: !!reportData.inspectorSignature, status: document.getElementById('sigStatusInspector').textContent, again: !document.getElementById('sigAgainInspector').hidden,
    kept: document.getElementById('sigCanvasInspector').parentElement.classList.contains('kept'), badge: document.getElementById('sts-signoff').textContent }));
  const draw = async (dip = 70) => {
    const box = await p.locator('#sigCanvasInspector').boundingBox();
    await p.mouse.move(box.x + 40, box.y + 40); await p.mouse.down();
    await p.mouse.move(box.x + 120, box.y + dip, { steps: 6 }); await p.mouse.move(box.x + 200, box.y + 30, { steps: 6 }); await p.mouse.up();
    await p.waitForTimeout(300);
  };
  await p.evaluate(() => { const l = document.getElementById('inspectorLicence'); l.value = 'PL12345'; l.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('sigCanvasInspector').scrollIntoView({ block: 'center' }); });
  await p.waitForTimeout(300);
  let sg = await sig();
  check(!sg.signed && sg.status === 'Not signed' && !sg.again, 'a first report is not signed, with no Sign again: ' + JSON.stringify(sg));
  await draw();
  sg = await sig();
  check(sg.signed && sg.status === 'Signed as Alex Example' && sg.again, 'signing it reads "Signed as" the inspector, with Sign again beside it: ' + JSON.stringify(sg));
  const firstSig = await p.evaluate(() => { saveCurrentReport(true); return reportData.inspectorSignature; });
  await p.evaluate(() => { tabGo('dashboard'); startNewJob(); }); await p.waitForTimeout(800);
  await p.evaluate(() => {
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('jobAddress', '12 Wattle Street'); set('jobSuburb', 'Ryde'); set('jobClient', 'Jo Nguyen');
    saveCurrentReport(true); jobGo('report'); goStep('finish');
    document.getElementById('sigCanvasInspector').scrollIntoView({ block: 'center' });
  });
  await p.waitForTimeout(500);
  sg = await sig();
  const carried = await p.evaluate(first => ({ same: reportData.inspectorSignature === first, lic: document.getElementById('inspectorLicence').value, name: document.getElementById('jobInspector').value,
    taps: getComputedStyle(document.getElementById('sigCanvasInspector')).pointerEvents }), firstSig);
  check(sg.signed && carried.same && sg.status === 'Signed as Alex Example' && sg.again && carried.lic === 'PL12345', 'the next report starts with the name, licence and signature: ' + JSON.stringify({ ...sg, ...carried }));
  check(sg.kept && carried.taps === 'none', 'and a kept signature can\'t be drawn over by a thumb scrolling past');
  check(sg.badge === 'Complete', 'so its Sign-off reads Complete, the agreement being This job\'s step and not Sign-off\'s: ' + sg.badge);
  const fin = await p.evaluate(() => document.getElementById('finishGaps').textContent);
  check(!/no property address/.test(fin) && /No pre-inspection agreement is recorded/.test(fin), 'Finish\'s list follows the address as it is typed, and still names the agreement');
  await shot('signature-kept');
  await draw();
  check(await p.evaluate(first => reportData.inspectorSignature === first, firstSig), 'a stroke across it leaves it as it was');
  // Sign again empties the pad for a new one.
  await p.locator('#sigAgainInspector').click(); await p.waitForTimeout(300);
  sg = await sig();
  check(!sg.signed && sg.status === 'Not signed' && !sg.again && !sg.kept, 'Sign again empties it to be signed afresh: ' + JSON.stringify(sg));
  await draw(55);
  sg = await sig();
  check(sg.signed && await p.evaluate(first => reportData.inspectorSignature !== first, firstSig), 'and the new signature is this report\'s own');
  // Another inspector's name over a carried signature: it doesn't stay.
  await p.evaluate(() => { tabGo('dashboard'); startNewJob(); }); await p.waitForTimeout(800);
  check((await sig()).signed, 'a third report carries the latest signature');
  await p.evaluate(() => { const n = document.getElementById('jobInspector'); n.value = 'Chris Other'; n.dispatchEvent(new Event('input', { bubbles: true })); }); await p.waitForTimeout(300);
  sg = await sig();
  check(!sg.signed && sg.status === 'Not signed', 'a signature carried over doesn\'t stay under another inspector\'s name: ' + JSON.stringify(sg));

  console.log('page errors:', errs);
  check(!errs.length, 'no page errors');
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
