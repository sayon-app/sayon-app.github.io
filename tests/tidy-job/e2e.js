// The tidied job screens: the certificates card (one line, Email / PDF /
// Edit, "Mark as given" as a quiet link, both certificates in one PDF),
// the job PDF card ("Ready to finalise", then "Job finalised", with what
// went in folded away), the voice panel docked on the dock and short
// enough to read the report above it, and the quiet Say the quote row.
// node e2e.js <outDir>   (serve the repo on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/tidy-job'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf', uid = 'u-new';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'owner@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
const emails = [];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, async r => {
    const u = r.request().url(); let body = {}; try { body = r.request().postDataJSON() || {}; } catch (e) {}
    if (u.includes('/send-email')) { if (body.check) return r.fulfill({ json: { configured: true } }); emails.push(body); return r.fulfill({ json: { ok: true } }); }
    return r.fulfill({ json: { plan: 'trial', status: 'trialing', ai_calls_used_this_period: 0, limit: 50 } });
  });
  await ctx.route(/supabase\.co/, r => {
    const u = r.request().url(), m = r.request().method();
    if (u.includes('/rest/v1/businesses') && m === 'POST') return r.fulfill({ json: [{ id: 'b-new', name: 'Example Pest Co', owner_id: uid, settings: {} }] });
    return r.fulfill({ json: [] });
  });
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); }, sess);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  const shot = async (name) => { await p.waitForTimeout(350); await p.screenshot({ path: `${OUT}/${name}.png` }); };
  const tap = async (loc, what) => { try { await loc.scrollIntoViewIfNeeded({ timeout: 3000 }); await loc.tap({ timeout: 5000 }); return true; } catch (e) { check(false, 'tap ' + what + ': ' + e.message.split('\n')[0]); return false; } };

  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  await p.fill('#ob-companyName', 'Example Pest Co');
  await p.fill('#ob-licence', 'NSW 123456');
  await p.fill('#ob-phone', '0400 000 000');
  await tap(p.locator('#obBusinessSave'), 'Continue (business)');
  await p.evaluate(() => obNext(1)); await p.waitForTimeout(300);
  await p.evaluate(() => obShowPanel(3)); await p.waitForTimeout(300);
  await tap(p.getByRole('button', { name: /See a finished sample job first/i }), 'See a finished sample job first');
  await p.waitForTimeout(1800);

  // 1. The job PDF card, before it's made.
  const card = () => p.evaluate(() => {
    const s = document.querySelector('#jobOverlay .job-pdf');
    return s && { label: s.querySelector('.job-step-label').textContent, line: s.querySelector('.job-step-text').textContent, made: s.classList.contains('made'),
      buttons: [...s.querySelectorAll('.dash-detail-links button')].map(x => x.textContent.trim()), primary: !!s.querySelector('.job-pdf-btn.primary'),
      fold: !!s.querySelector('details.job-pdf-more'), open: !!s.querySelector('details.job-pdf-more[open]'), items: s.querySelectorAll('.job-pdf-list li').length, h: s.getBoundingClientRect().height };
  });
  let c = await card();
  console.log('job pdf card:', JSON.stringify(c));
  check(c && c.label === 'Ready to finalise' && !c.made, 'a finished job\'s card reads "Ready to finalise"');
  check(c && c.line === 'Agreement, report, quote and 2 certificates, in one PDF.', 'one line says what goes in: ' + (c && c.line));
  check(c && c.buttons.join('|') === 'Email it to me|Save PDF' && c.primary, 'Email comes first and is the main button, then Save PDF');
  check(c && c.fold && !c.open && c.items === 5, 'the five parts are listed, folded away');
  check(c && c.h < 220, `the card is short (${c && Math.round(c.h)}px)`);
  await p.locator('#jobOverlay .job-pdf').scrollIntoViewIfNeeded(); await shot('1-jobpdf-ready');
  await tap(p.getByRole('button', { name: 'Email it to me' }), 'Email it to me'); await p.waitForTimeout(6000);
  c = await card();
  console.log('after email:', JSON.stringify(c));
  check(emails.length === 1, 'the job PDF was emailed');
  check(c && c.label === 'Job finalised' && c.made && /^Emailed to Jordan Sample \d/.test(c.line) && /Agreement, report, quote and 2 certificates\.$/.test(c.line), 'once emailed it reads "Job finalised", who it went to and when: ' + (c && c.line));
  check(c && !c.primary, 'once it\'s done, neither button shouts');
  await p.locator('#jobOverlay .job-pdf').scrollIntoViewIfNeeded(); await shot('2-jobpdf-made');

  // 2. The certificates card on the quote.
  await p.evaluate(() => { closeJobPage(); jobGo('quote'); }); await p.waitForTimeout(1200);
  await p.evaluate(() => { delete quoteState.certificateSentAt; delete quoteState.certificateHandedAt; renderQuoteAnswer(); }); await p.waitForTimeout(400);
  const cert = () => p.evaluate(() => {
    const el = document.querySelector('#quoteAnswer .qp-cert:not(.bait-card)');
    return { title: el.querySelector('.qp-cert-title').textContent, text: el.querySelector('.qp-cert-text').textContent,
      buttons: [...el.querySelectorAll('.qp-cert-actions button')].map(x => x.textContent.trim()), handed: (el.querySelector('.qp-cert-handed') || {}).textContent || '',
      rows: new Set([...el.querySelectorAll('.qp-cert-actions button')].map(x => Math.round(x.getBoundingClientRect().top))).size, h: el.getBoundingClientRect().height };
  });
  let k = await cert();
  console.log('certificate card:', JSON.stringify(k));
  check(k.title === 'Treatment and installation certificates' && k.text === 'Goes to jordan@example.com', 'one line under the title: where they go');
  check(k.buttons.join('|') === 'Email to Jordan|PDF|Edit' && k.rows === 1, 'three buttons on one row: Email to Jordan, PDF, Edit');
  check(/^Handed them over in person\? Mark as given$/.test(k.handed), '"Mark as given" is a quiet link under them');
  check(k.h < 190, `the card is short (${Math.round(k.h)}px)`);
  await p.locator('#quoteAnswer .qp-cert').first().scrollIntoViewIfNeeded(); await shot('3-cert');
  // PDF: both certificates in one file.
  const pdf = await p.evaluate(async () => {
    let got = null; const real = window.deliverPdfBlob;
    window.deliverPdfBlob = async (blob, fname) => { got = { blob, fname }; };
    downloadTreatmentCertificate();
    for (let i = 0; i < 60 && !got; i++) await new Promise(r => setTimeout(r, 250));
    window.deliverPdfBlob = real;
    if (!got) return null;
    const lib = await ensurePdfLibLoaded();
    const pages = async blob => (await lib.PDFDocument.load(await blob.arrayBuffer())).getPageCount();
    const q = quoteState;
    return { fname: got.fname, pages: await pages(got.blob), treat: await pages((await buildTreatmentCertificatePDF(q)).blob), install: await pages((await buildTreatmentCertificatePDF(q, { install: true })).blob) };
  });
  console.log('certificate pdf:', JSON.stringify(pdf));
  check(pdf && pdf.pages === pdf.treat + pdf.install && /^SAYON_Certificates_/.test(pdf.fname), 'PDF gives both certificates as one file: ' + JSON.stringify(pdf));
  await tap(p.locator('#quoteAnswer .qp-cert-handed'), 'Mark as given'); await p.waitForTimeout(600);
  k = await cert();
  check(/^Given to Jordan Sample in person \d/.test(k.text) && k.buttons.join('|') === 'Email a copy|PDF|Edit' && !k.handed, 'marked as given: the line says so and the link goes: ' + k.text);

  // 3. The Say the quote row.
  const say = await p.evaluate(() => { const v = document.getElementById('quoteVoice'); const r = v.getBoundingClientRect(); return { h: r.height, label: v.querySelector('.sheet-voice-label').textContent, hint: v.querySelector('.sheet-voice-hint').textContent }; });
  console.log('say box:', JSON.stringify(say));
  check(say.label === 'Say the quote' && say.h < 100, `Say the quote is one quiet row (${Math.round(say.h)}px)`);
  await p.locator('#quoteVoice').scrollIntoViewIfNeeded(); await shot('4-say-quote');

  // 4. The voice panel, on a new job's report.
  await p.evaluate(() => { closeQuote(); startNewJob(); closeJobPage(); }); await p.waitForTimeout(1200);
  await p.evaluate(() => toggleVoicePopover()); await p.waitForTimeout(600);
  const panel = () => p.evaluate(() => {
    const r = document.getElementById('voicePopover').getBoundingClientRect(), dock = document.querySelector('.tabbar').getBoundingClientRect();
    const shield = document.getElementById('pocketShield');
    return { open: document.getElementById('voicePopover').classList.contains('open'), top: r.top, h: r.height, w: r.width, gap: dock.top - r.bottom, vh: innerHeight,
      extract: getComputedStyle(document.getElementById('extractBtn')).display, photo: document.getElementById('voicePhotoBtn').getBoundingClientRect().height,
      shieldBg: shield.hidden ? null : getComputedStyle(shield).backgroundColor };
  });
  let v = await panel();
  console.log('voice idle:', JSON.stringify(v));
  check(v.open && v.h < v.vh * 0.36 && v.gap >= 0 && v.gap < 60, `the voice panel sits on the dock and is short (${Math.round(v.h)}px of ${v.vh})`);
  check(v.extract === 'none', 'with nothing said there is no greyed-out fill button');
  check(v.photo >= 44, 'the photo button is still a full-size tap');
  await shot('5-voice-idle');
  await p.evaluate(() => {
    setPocketLock(true); isRecording = true; updateVoiceHud();
    document.getElementById('voiceBtn').classList.add('recording'); document.getElementById('voiceBtnText').textContent = 'Recording… tap to stop';
    document.getElementById('waveform').classList.add('show');
    const box = document.getElementById('transcriptBox');
    box.textContent = 'Weather is fine and sunny. Single storey brick veneer on a concrete slab, built around 1985. Subfloor not applicable. Roof void accessed through the manhole in the hallway, insulation batts restricted the eaves.';
    box.classList.add('active');
  });
  await p.waitForTimeout(400);
  v = await panel();
  const scrolled = await p.evaluate(() => { const b = document.getElementById('transcriptBox'); return b.scrollHeight - b.clientHeight - b.scrollTop; });
  console.log('voice listening:', JSON.stringify(v), 'scroll left', scrolled);
  check(v.h < 230, `while listening it's the speak button and the last lines (${Math.round(v.h)}px)`);
  check(scrolled <= 2, 'the newest words are in sight');
  check(v.shieldBg === 'rgba(0, 0, 0, 0)', 'the report behind isn\'t dimmed while listening');
  await shot('6-voice-listening');
  await p.evaluate(() => stopRecording());

  check(!errs.length, 'no page errors: ' + errs.join(' | '));
  await b.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
