// Describe on a report photo: the AI looks at the photo and suggests a
// caption, shown under the caption box until Use or Not this. Never put in
// the caption by itself. The AI is mocked here (no paid calls).
// node e2e.js <outDir>  (server on :8765, fonts and jsPDF from tests/visual/setup.sh)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/photo-describe'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', uid = 'u-owner', SP = process.env.JSPDF_DIR || '/tmp/jspdf';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
const ai = (obj) => ({ json: { content: [{ type: 'text', text: JSON.stringify(obj) }], stop_reason: 'end_turn' } });
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  // What the mocked AI answers next, and every call it was sent.
  const calls = []; let next = null; let hold = null;
  await ctx.route(/workers\.dev/, async r => {
    const req = r.request();
    if (req.method() === 'POST' && /workers\.dev\/?$/.test(req.url())) {
      const body = JSON.parse(req.postData() || '{}');
      calls.push(body);
      if (hold) await hold;
      const answer = typeof next === 'function' ? next(body) : next;
      return r.fulfill(answer || ai({ caption: null, unclear: 'no answer set' }));
    }
    return r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 800 } });
  });
  await ctx.route(/supabase\.co/, r => {
    const u = r.request().url();
    if (u.includes('/storage/v1/object/') && r.request().method() === 'POST') return r.fulfill({ status: 200, json: {} });
    return r.fulfill({ json: u.includes('businesses?owner_id') ? [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] : [] });
  });
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1', '1'); }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);

  // A report with a termite finding, a restricted roof void, and photos in
  // the finding, the roof void spot, Conducive and Other photos.
  const ids = await p.evaluate(async (sc) => {
    storeCompanyDetails(sc.company); openApp('inspect'); resetReportState();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    for (const [k, v] of Object.entries(sc.job)) set(k, v); updateJob(); await populateFields(sc.fields);
    const photo = async (name, colour) => {
      const c = document.createElement('canvas'); c.width = 1200; c.height = 900; const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 1200, 900); grad.addColorStop(0, colour); grad.addColorStop(1, '#3b2a1a');
      g.fillStyle = grad; g.fillRect(0, 0, 1200, 900);
      for (let i = 0; i < 30; i++) { g.strokeStyle = 'rgba(0,0,0,0.15)'; g.beginPath(); g.moveTo(0, i * 30); g.bezierCurveTo(400, i * 30 + 20, 800, i * 30 - 20, 1200, i * 30); g.stroke(); }
      return new File([await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85))], name, { type: 'image/jpeg' });
    };
    const f = reportData.findings[1];
    await handleSectionPhotoFiles([await photo('bearer.jpg', '#8a6a45')], findingPhotoSection(f.id));
    await handleSectionPhotoFiles([await photo('roof.jpg', '#6b6b6b')], spotPhotoSection('hindered', 'roofvoid'));
    await handleSectionPhotoFiles([await photo('garden.jpg', '#4f6b3a')], 'conducive');
    await handlePhotoFiles([await photo('other.jpg', '#7a5a3a')]);
    renderFindingsUI(); renderAccessSummary(); renderReportWidgets();
    return {
      finding: getSectionPhotos(findingPhotoSection(f.id))[0].id, findingId: f.id,
      roof: getSectionPhotos(spotPhotoSection('hindered', 'roofvoid'))[0].id,
      conducive: getSectionPhotos('conducive')[0].id, other: reportData.photos[0].id,
    };
  }, sc);
  await p.waitForTimeout(800);
  const caption = id => p.evaluate(id => findReportPhoto(id).photo.caption, id);
  const suggested = id => p.evaluate(id => findReportPhoto(id).photo.suggested || null, id);
  const btn = id => p.locator(`[data-describe-for="${id}"]`).filter({ visible: true }).first();
  const box = id => p.locator(`[data-suggest-for="${id}"]`).filter({ visible: true }).first();
  // Into the middle of the screen, clear of the dock and any toast.
  const centre = async loc => { await loc.evaluate(e => e.scrollIntoView({ block: 'center' })); await p.evaluate(() => dismissToast()); await p.waitForTimeout(450); };

  // ── The finding photo ──
  await p.evaluate(() => showSection('findings')); await p.waitForTimeout(400);
  await centre(btn(ids.finding));
  check(await btn(ids.finding).isVisible(), 'a finding photo has Describe');
  await p.screenshot({ path: `${OUT}/1-finding-describe.png` });
  let release; hold = new Promise(r => { release = r; });
  next = ai({ caption: 'Mud leads on the rear bearer near the joist, appear consistent with termite workings.', unclear: null });
  await btn(ids.finding).click(); await p.waitForTimeout(300);
  check(await btn(ids.finding).isDisabled() && /Looking/.test(await btn(ids.finding).textContent()), 'while the AI looks, the button reads Looking… and can\'t be tapped twice');
  await p.screenshot({ path: `${OUT}/2-finding-looking.png` });
  release(); hold = null; await p.waitForTimeout(600);
  const req = calls[calls.length - 1];
  const blocks = req.messages[0].content;
  check(blocks[0].type === 'image' && blocks[0].source.media_type === 'image/jpeg' && blocks[0].source.data.length > 1000, 'the photo goes to the AI as an image');
  check(/Termite finding, at Subfloor, rear bearer/.test(blocks[1].text), 'the AI is told where the photo was added: ' + blocks[1].text.slice(0, 90));
  check(req.system === await p.evaluate(() => PHOTO_CAPTION_PROMPT) && req.output_config.effort === 'low' && req.max_tokens === 2000, 'Describe sends its own prompt at low effort');
  check(await caption(ids.finding) === '', 'the caption stays empty until Use');
  check(await suggested(ids.finding) === 'Mud leads on the rear bearer near the joist, appear consistent with termite workings', 'the suggestion waits on the photo, full stop taken off');
  check(await box(ids.finding).isVisible() && /SAYON suggests/.test(await box(ids.finding).textContent()), 'the suggestion shows under the caption');
  check(await btn(ids.finding).isHidden(), 'Describe hides while a suggestion waits');
  check(await p.evaluate(id => { const d = JSON.parse(localStorage.getItem(DRAFT_KEY)); return JSON.stringify(d.reportData).includes('appear consistent with termite workings'); }, ids.finding), 'the suggestion is kept in the saved draft');
  await centre(box(ids.finding));
  await p.screenshot({ path: `${OUT}/3-finding-suggestion.png` });
  // Redrawing the findings keeps the suggestion.
  await p.evaluate(() => renderFindingsUI()); await p.waitForTimeout(200);
  check(await box(ids.finding).isVisible(), 'the suggestion survives the findings being redrawn');
  await box(ids.finding).getByRole('button', { name: 'Use' }).click(); await p.waitForTimeout(200);
  check(await caption(ids.finding) === 'Mud leads on the rear bearer near the joist, appear consistent with termite workings', 'Use puts it in the caption');
  check(await p.locator(`[data-caption-for="${ids.finding}"]`).first().inputValue() === await caption(ids.finding), 'the caption box shows it, ready to change');
  check(await box(ids.finding).isHidden() && await btn(ids.finding).isVisible() && !(await suggested(ids.finding)), 'the box goes and Describe comes back');
  await centre(btn(ids.finding));
  await p.screenshot({ path: `${OUT}/4-finding-used.png` });

  // ── The roof void spot: a caption is already typed, so Add to caption ──
  await p.evaluate(() => showSection('restrictions')); await p.waitForTimeout(400);
  const roofInput = p.locator(`[data-caption-for="${ids.roof}"]`).filter({ visible: true }).first();
  await centre(roofInput);
  await roofInput.fill('Hatch in the laundry ceiling.');
  await p.evaluate(() => document.activeElement.blur());
  next = ai({ caption: 'Ceiling hatch screwed shut with no handle, extensive paint over the edges', unclear: null });
  await btn(ids.roof).click(); await p.waitForTimeout(600);
  const roofReq = calls[calls.length - 1].messages[0].content[1].text;
  check(/Obstructions: Roof void/.test(roofReq), 'an access spot photo tells the AI the area: ' + roofReq.slice(0, 80));
  check(await suggested(ids.roof) === 'Ceiling hatch screwed shut with no handle, paint over the edges', 'a severity word before what it describes comes out');
  check(/Add to caption/.test(await box(ids.roof).textContent()), 'with a caption typed, the button reads Add to caption');
  await centre(box(ids.roof));
  await p.screenshot({ path: `${OUT}/5-spot-add-to-caption.png` });
  await box(ids.roof).getByRole('button', { name: 'Add to caption' }).click(); await p.waitForTimeout(200);
  check(await caption(ids.roof) === 'Hatch in the laundry ceiling. Ceiling hatch screwed shut with no handle, paint over the edges', 'Add to caption keeps the typed words first: ' + await caption(ids.roof));

  // ── Conducive: a verdict or risk wording is never shown ──
  await p.evaluate(() => showSection('conducive')); await p.waitForTimeout(400);
  await centre(btn(ids.conducive));
  next = ai({ caption: 'Garden bed over the weep holes, a high risk for termite entry', unclear: null });
  await btn(ids.conducive).click(); await p.waitForTimeout(600);
  check(!(await suggested(ids.conducive)) && await caption(ids.conducive) === '', 'a caption that rates risk is not offered');
  check(/couldn't suggest a caption/.test(await p.locator('#toast').textContent()), 'and the inspector is told to add it themselves');
  next = ai({ caption: null, unclear: 'too dark to make out' });
  await btn(ids.conducive).click(); await p.waitForTimeout(600);
  check(/too dark to make out/.test(await p.locator('#toast').textContent()) && !(await suggested(ids.conducive)), 'an unclear photo says why: ' + await p.locator('#toast').textContent());
  next = ai({ caption: 'Garden bed built up over the slab edge and weep holes', unclear: null });
  await btn(ids.conducive).click(); await p.waitForTimeout(600);
  await centre(box(ids.conducive));
  check(await box(ids.conducive).isVisible(), 'a section photo box shows the suggestion too');
  await p.screenshot({ path: `${OUT}/6-conducive-suggestion.png` });
  await box(ids.conducive).getByRole('button', { name: 'Not this' }).click(); await p.waitForTimeout(200);
  check(!(await suggested(ids.conducive)) && await caption(ids.conducive) === '' && await btn(ids.conducive).isVisible(), 'Not this drops the suggestion and leaves the caption alone');

  // ── Refusals and no signal ──
  next = { status: 429, body: 'Monthly AI limit reached', contentType: 'text/plain' };
  await btn(ids.conducive).click(); await p.waitForTimeout(600);
  check(/AI allowance is used up/.test(await p.locator('#toast').textContent()), 'the month\'s allowance used up says so');
  check(await btn(ids.conducive).isEnabled() && /Describe/.test(await btn(ids.conducive).textContent()), 'the button comes back after a refusal');
  const before = calls.length;
  await ctx.setOffline(true);
  await btn(ids.conducive).click(); await p.waitForTimeout(300);
  check(calls.length === before && /No signal/.test(await p.locator('#toast').textContent()), 'with no signal nothing is sent and it says so');
  await ctx.setOffline(false);

  // ── Other photos: Describe, Insect ID and Remove ──
  await p.evaluate(() => showSection('photos')); await p.waitForTimeout(400);
  await centre(btn(ids.other));
  check(await btn(ids.other).isVisible() && await p.locator(`#analyzeBtn-${ids.other}`).textContent() === 'Insect ID', 'Other photos have Describe beside Insect ID');
  next = ai({ caption: 'Timber floorboards with dark staining near the wall', unclear: null });
  await btn(ids.other).click(); await p.waitForTimeout(600);
  await centre(box(ids.other));
  await p.screenshot({ path: `${OUT}/7-other-photos.png` });
  check(/Other photos/.test(calls[calls.length - 1].messages[0].content[1].text) && await box(ids.other).isVisible(), 'Other photos get a suggestion');
  // Insect ID still works through the shared photo call.
  next = ai({ identified: 'NO', species: null, confidence: null, notes: 'appears to be an ant, not a termite' });
  await p.locator(`#analyzeBtn-${ids.other}`).click(); await p.waitForTimeout(600);
  check(calls[calls.length - 1].system === await p.evaluate(() => INSECT_ID_SYSTEM_PROMPT) && /ant, not a termite/.test(await p.locator('#toast').textContent()), 'Insect ID still works');

  // The plate scan still works through the shared photo call.
  const jpeg = Buffer.from((await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 400; c.height = 300; const g = c.getContext('2d'); g.fillStyle = '#ddd'; g.fillRect(0, 0, 400, 300); return c.toDataURL('image/jpeg', 0.8); })).split(',')[1], 'base64');
  next = ai({ systemFound: 'YES', existingSystem: 'Chemical Barrier', existingSystemOther: 'Termidor', extraDetails: null });
  const chooser = p.waitForEvent('filechooser');
  p.evaluate(() => scanCompliancePlate(true));
  await (await chooser).setFiles({ name: 'plate.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await p.waitForTimeout(1200);
  check(calls[calls.length - 1].system === await p.evaluate(() => PLATE_SYSTEM_PROMPT) && /Plate read: Termidor/.test(await p.locator('#toast').textContent())
    && await p.evaluate(() => reportData.existingSystemOther === 'Termidor' && getSectionPhotos('durable').length === 1), 'the plate scan still reads the plate and keeps the photo');

  // ── The PDF prints the caption, never a waiting suggestion ──
  const pdfText = await p.evaluate(async () => {
    const r = await buildReportPdf();
    const bytes = new Uint8Array(await r.blob.arrayBuffer());
    let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  });
  check(pdfText.includes('Mud leads on the rear bearer') && !pdfText.includes('dark staining near the wall'), 'the PDF prints the used caption and not the waiting suggestion');

  // ── A locked job ──
  await p.evaluate(() => { reportData.issue = { version: 1 }; reportData.amending = false; });
  const lockedBefore = calls.length;
  await p.evaluate(id => describePhoto(id), ids.conducive); await p.waitForTimeout(200);
  check(calls.length === lockedBefore && /locked/.test(await p.locator('#toast').textContent()), 'a finalised, locked job can\'t be described');
  await p.evaluate(() => { delete reportData.issue; dismissToast(); });
  check(await p.evaluate(() => getComputedStyle(document.getElementById('toast')).pointerEvents) === 'none', 'a note with a button stops catching taps once it has gone');

  // ── Larger text ──
  await p.evaluate(() => { document.documentElement.style.setProperty('--ts', '1.3'); showSection('findings'); });
  await p.waitForTimeout(300);
  next = ai({ caption: 'Mud leads on the brick pier up to the bearer, appear consistent with termite workings', unclear: null });
  await centre(btn(ids.finding));
  await btn(ids.finding).click(); await p.waitForTimeout(600);
  const sizes = await p.evaluate(id => {
    const fs = sel => parseFloat(getComputedStyle(document.querySelector(sel)).fontSize);
    return { text: fs(`[data-suggest-for="${id}"] .photo-suggest-text`), use: fs(`[data-suggest-for="${id}"] .photo-suggest-use`) };
  }, ids.finding);
  check(sizes.text > 17 && sizes.use > 16, `the suggestion grows with Text size (${sizes.text}px, ${sizes.use}px)`);
  await centre(box(ids.finding));
  await p.screenshot({ path: `${OUT}/8-large-text.png` });
  await p.evaluate(() => document.documentElement.style.removeProperty('--ts'));

  // ── A 320 px phone at Extra large: nothing runs off the side ──
  await p.setViewportSize({ width: 320, height: 640 });
  await p.evaluate(() => document.body.classList.add('text-size-xl')); await p.waitForTimeout(300);
  for (const [step, id] of [['findings', ids.finding], ['restrictions', ids.roof], ['conducive', ids.conducive], ['photos', ids.other]]) {
    await p.evaluate(s => showSection(s), step); await p.waitForTimeout(300);
    if (!(await suggested(id))) { next = ai({ caption: 'Garden bed built up over the slab edge and weep holes beside the laundry door', unclear: null }); await btn(id).evaluate(e => e.scrollIntoView({ block: 'center' })); await btn(id).click(); await p.waitForTimeout(600); }
    await centre(box(id));
    const over = await p.evaluate(id => [...document.querySelectorAll(`[data-suggest-for="${id}"], [data-describe-for="${id}"], [data-caption-for="${id}"]`)]
      .filter(e => e.offsetParent).some(e => { const r = e.getBoundingClientRect(); return r.right > innerWidth + 0.5 || r.left < -0.5; }), id);
    check(!over, `${step}: at 320 px, Extra large, the photo's caption, Describe and suggestion fit the screen`);
    await p.screenshot({ path: `${OUT}/10-320-${step}.png` });
  }
  await p.evaluate(() => document.body.classList.remove('text-size-xl'));
  await p.setViewportSize({ width: 390, height: 844 });

  // ── Dark screen ──
  await p.evaluate(() => { document.body.classList.add('dark-screen'); showSection('findings'); }); await p.waitForTimeout(300);
  await centre(box(ids.finding));
  await p.screenshot({ path: `${OUT}/9-dark.png` });

  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
