// Photos while talking: a photo taken from the voice popover lands on the
// finding the inspector was describing once the note fills the report.
// node e2e.js <outDir>  (server on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/talk-photo'; fs.mkdirSync(OUT, { recursive: true });
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
  await ctx.route(/supabase\.co/, r => r.fulfill({ json: r.request().url().includes('businesses?owner_id') ? [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] : [] }));
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1', '1'); }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  await p.evaluate(async (sc) => {
    storeCompanyDetails(sc.company); openApp('inspect'); resetReportState();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    for (const [k, v] of Object.entries(sc.job)) set(k, v); updateJob();
    // A photo the camera would hand back.
    window.__photo = async (label) => { const c = document.createElement('canvas'); c.width = 640; c.height = 480; const g = c.getContext('2d'); g.fillStyle = '#8a6'; g.fillRect(0, 0, 640, 480); g.fillStyle = '#000'; g.font = '40px sans-serif'; g.fillText(label, 40, 240); const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8)); return new File([blob], label + '.jpg', { type: 'image/jpeg' }); };
  }, sc);
  // The popover has the button.
  await p.evaluate(() => toggleVoicePopover()); await p.waitForTimeout(400);
  const btn = await p.evaluate(() => { const b = document.getElementById('voicePhotoBtn'); const r = b.getBoundingClientRect(); return { text: b.innerText, h: r.height, visible: r.width > 0 && r.bottom <= innerHeight }; });
  check(/Photo of what you.re describing/.test(btn.text) && btn.visible && btn.h >= 44, 'voice popover offers "Photo of what you\'re describing", 44px tall');
  await p.screenshot({ path: `${OUT}/1-popover.png` });
  // Talking about the tree, photo, more talking; then a photo with nothing said around it.
  await p.evaluate(async () => {
    speechHeard('okay so out the back there is a gum tree about fifteen metres from the house');
    await handleTalkPhotoFiles({ files: [await window.__photo('tree')], value: '' });
    speechHeard('live termites in the gum tree, timbers around the base eaten out, looks like a nest in the tree');
  });
  await p.waitForTimeout(300);
  const waiting = await p.evaluate(() => ({ n: talkPhotosWaiting().length, heard: talkPhotosWaiting()[0].heard.text, label: document.getElementById('voicePhotoBtnText').textContent }));
  check(waiting.n === 1 && /gum tree/.test(waiting.heard) && /nest in the tree/.test(waiting.heard), 'photo keeps the words said before and after it');
  check(/1 photo waiting for the fill/.test(waiting.label), 'button says a photo is waiting: ' + waiting.label);
  await p.screenshot({ path: `${OUT}/2-waiting.png` });
  // A minute later, a second photo with words that name no finding.
  await p.evaluate(async () => { speechTimeline.forEach(e => { e.t -= 60000; }); talkPhotosWaiting().forEach(x => { x.heard.at -= 60000; }); speechHeard('and a general shot of the yard'); await handleTalkPhotoFiles({ files: [await window.__photo('yard')], value: '' }); });
  await p.waitForTimeout(200);
  check(await p.evaluate(() => talkPhotosWaiting().length) === 2, 'two photos waiting');
  // The note fills the report: the tree photo lands on finding 1 with a caption, the yard photo stays.
  await p.evaluate(async (sc) => { await populateFields(sc.fields); }, sc);
  await p.waitForTimeout(1500);
  const after = await p.evaluate(() => {
    const f = reportData.findings; const sec = findingPhotoSection(f[0].id);
    return { onF1: getSectionPhotos(sec).map(x => ({ caption: x.caption, placed: x.heard && x.heard.placed })), onF2: getSectionPhotos(findingPhotoSection(f[1].id)).length, left: getSectionPhotos('findings').map(x => x.caption), waiting: talkPhotosWaiting().length, label: document.getElementById('voicePhotoBtnText').textContent, gridF1: !!document.querySelector(`[data-section="${sec}"] img, #photoGrid-${sec} img`) };
  });
  console.log(JSON.stringify(after));
  check(after.onF1.length === 1 && after.onF1[0].placed === (await p.evaluate(() => reportData.findings[0].id)), 'tree photo moved onto the gum-tree finding');
  check(/^Live termites in the gum tree/.test(after.onF1[0].caption || ''), 'caption is the sentence that named the finding: ' + after.onF1[0].caption);
  check(after.onF2 === 0, 'nothing landed on the subfloor finding');
  check(after.left.length === 1 && after.waiting === 1 && /1 photo waiting/.test(after.label), 'yard photo stays in Findings photos, still waiting');
  await p.evaluate(() => { goStep('findings'); window.scrollTo(0, 0); });
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/3-finding-photo.png`, fullPage: true });
  // Reload: the placement survives in the draft, and the photo shows in the finding's grid.
  await p.reload(); await p.waitForTimeout(3000);
  const kept = await p.evaluate(() => { const f = reportData.findings || []; return f.length ? { n: getSectionPhotos(findingPhotoSection(f[0].id)).length, img: !!document.querySelector('img[src^="blob:"], img[src^="data:"]') } : null; });
  check(kept && kept.n === 1, 'placement survives a reload');
  // A new job forgets the timeline.
  await p.evaluate(() => { speechHeard('words for the old job'); resetReportState(); });
  check(await p.evaluate(() => speechTimeline.length) === 0, 'new job starts with an empty timeline');
  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
