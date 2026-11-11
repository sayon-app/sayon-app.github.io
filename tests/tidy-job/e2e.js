// The tidied job screens: the certificate card on This job (one line,
// Email / PDF, "Mark as given" as a quiet link, one certificate even when a
// system went in),
// Finalise as a finished job's next step, then the "Job finalised" card
// (with what went in folded away), the voice panel docked on the dock and short
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
  await p.fill('#ob-licence', 'NSW 123456');
  await p.fill('#ob-phone', '0400 000 000');
  await tap(p.locator('#obBusinessSave'), 'Continue (business)');
  await p.evaluate(() => obNext(1)); await p.waitForTimeout(300);
  await p.evaluate(() => obShowPanel(2)); await p.waitForTimeout(300);
  await tap(p.getByRole('button', { name: /See a finished sample job first/i }), 'See a finished sample job first');
  await p.waitForTimeout(1800);

  // 1. Finalise is the finished job's next step; the card is its record after.
  const next = () => p.evaluate(() => {
    const s = document.querySelector('#jobOverlay .job-next');
    return { title: s.querySelector('.dash-next-title').textContent, main: (s.querySelector('.dash-detail-primary') || {}).textContent, buttons: [...s.querySelectorAll('button')].map(x => x.textContent.trim()),
      fold: !!s.querySelector('details.job-pdf-more'), open: !!s.querySelector('details.job-pdf-more[open]'), items: s.querySelectorAll('.job-pdf-list li').length, h: s.getBoundingClientRect().height };
  });
  const card = () => p.evaluate(() => {
    const s = document.querySelector('#jobOverlay .job-pdf');
    return s && { label: s.querySelector('.job-step-label').textContent, line: s.querySelector('.job-step-text').textContent, made: s.classList.contains('made'),
      buttons: [...s.querySelectorAll('.dash-detail-links button')].map(x => x.textContent.trim()), primary: !!s.querySelector('.job-pdf-btn.primary'),
      fold: !!s.querySelector('details.job-pdf-more'), open: !!s.querySelector('details.job-pdf-more[open]'), items: s.querySelectorAll('.job-pdf-list li').length, h: s.getBoundingClientRect().height };
  });
  const n = await next();
  let c = await card();
  console.log('finalise, the next step:', JSON.stringify(n));
  check(n.title === 'Finalise the job' && !c, 'a finished job\'s next step is "Finalise the job", and it\'s on the page once');
  check(n.buttons.join('|') === 'Finalise and email it to me|Finalise and save the PDF' && n.main === 'Finalise and email it to me', 'Email comes first and is the main button, then Save: ' + n.buttons.join(' | '));
  check(n.fold && !n.open && n.items === 4, 'the four parts are listed, folded away (one certificate, though the job left a system in place)');
  check(n.h < 340, `the card is short (${Math.round(n.h)}px)`);
  await p.locator('#jobOverlay .job-next').scrollIntoViewIfNeeded(); await shot('1-finalise-next');
  await tap(p.getByRole('button', { name: 'Finalise and email it to me' }), 'Finalise and email it to me'); await p.waitForTimeout(6000);
  c = await card();
  console.log('after email:', JSON.stringify(c));
  check(emails.length === 1, 'the job PDF was emailed');
  check(c && c.label === 'Job finalised' && c.made && /^Version 1, \d+ \w+ \d{4}\. Job PDF emailed to you \d+ \w+ \d{4}\.$/.test(c.line), 'once emailed the card reads "Job finalised", the version and where the PDF went: ' + (c && c.line));
  check(c && c.buttons.join('|') === 'Email it to me|Save PDF|Amend' && !c.primary && c.fold && !c.open && c.items === 4 && c.h < 240, `the PDF again and Amend, none of them shouting (${c && Math.round(c.h)}px)`);
  await p.locator('#jobOverlay .job-pdf').scrollIntoViewIfNeeded(); await shot('2-jobpdf-made');

  // 2. The certificate card, on This job: its Next step card while the
  // certificate is still to give, then under the Treatment step.
  await p.evaluate(() => { delete quoteState.certificateSentAt; delete quoteState.certificateHandedAt; persistQuote(); storeQuoteOnReport(quoteState, false); renderQuoteProgress(); document.getElementById('jobPageBody').scrollTop = 0; }); await p.waitForTimeout(400);
  const cert = () => p.evaluate(() => {
    const next = document.querySelector('#jobOverlay .job-next .qp-cert');
    const fold = document.querySelector('#jobOverlay .job-fold[data-step="treatment"]');
    if (!next && fold) fold.open = true;
    const el = next || fold.querySelector('.qp-cert');
    return { where: next ? 'next' : 'step', title: el.querySelector('.qp-cert-title').textContent, text: el.querySelector('.qp-cert-text').textContent,
      buttons: [...el.querySelectorAll('.qp-cert-actions button')].map(x => x.textContent.trim()), handed: (el.querySelector('.qp-cert-handed') || {}).textContent || '',
      rows: new Set([...el.querySelectorAll('.qp-cert-actions button')].map(x => Math.round(x.getBoundingClientRect().top))).size, h: el.getBoundingClientRect().height,
      nextTitle: document.querySelector('#jobOverlay .job-next .dash-next-title').textContent, quote: document.getElementById('quoteScreen').classList.contains('open') };
  });
  let k = await cert();
  console.log('certificate card:', JSON.stringify(k));
  check(k.where === 'next' && k.nextTitle === 'Email the certificate' && !k.quote, 'a certificate still to give is This job\'s Next step, done from its card (not inside the quote)');
  check(k.title === 'Treatment certificate' && k.text === 'Goes to jordan@example.com', 'one line under the title: where it goes');
  check(k.buttons.join('|') === 'Email to Jordan|PDF' && k.rows === 1, 'two buttons on one row: Email to Jordan, PDF');
  check(/^Handed it over in person\? Mark as given$/.test(k.handed), '"Mark as given" is a quiet link under them');
  check(k.h < 190, `the card is short (${Math.round(k.h)}px)`);
  await p.locator('#jobOverlay .job-next .qp-cert').scrollIntoViewIfNeeded(); await shot('3-cert');
  // PDF: the one certificate, its system included.
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
    return { fname: got.fname, pages: await pages(got.blob), treat: await pages((await buildTreatmentCertificatePDF(q)).blob), system: installedSystems(q.treatment).length };
  });
  console.log('certificate pdf:', JSON.stringify(pdf));
  check(pdf && pdf.system > 0 && pdf.pages === pdf.treat && /^Treatment_Certificate_TC-/.test(pdf.fname), 'a job that left a system in place still gets one certificate: ' + JSON.stringify(pdf));
  await tap(p.locator('#jobOverlay .job-next .qp-cert-handed'), 'Mark as given'); await p.waitForTimeout(600);
  k = await cert();
  check(k.where === 'step' && /^Given to Jordan Sample in person \d/.test(k.text) && k.buttons.join('|') === 'Email a copy|PDF' && !k.handed, 'marked as given: the card moves under the Treatment step, its line says so and the link goes: ' + k.text);
  const rec = await p.evaluate(() => document.querySelector('#jobOverlay .job-fold[data-step="treatment"] .job-fold-body').innerText.replace(/\s+/g, ' '));
  check(/Treatment recorded: done on/.test(rec) && !/Edit the record/.test(rec), 'the step opens to the record; on a finalised job there is no Edit (that starts with Amend): ' + rec.slice(0, 90));

  // 3. The quote of a job that's finished: only the quote. Say the quote and
  // the second opinion have stepped aside, the work is folded to its total
  // and Send again is a quiet button.
  await p.evaluate(() => jobGo('quote')); await p.waitForTimeout(1200);
  const gone = await p.evaluate(() => { const vis = id => { const el = document.getElementById(id); return !!el && el.getBoundingClientRect().height > 0; };
    return { say: vis('quoteVoice'), opinion: vis('quoteAiPlan'), workOpen: document.getElementById('quoteWorkFold').open, total: document.getElementById('quoteWorkTotal').textContent,
      send: document.getElementById('quoteSendLabel').textContent, filled: document.getElementById('quoteEmailBtn').classList.contains('primary'),
      steps: document.querySelectorAll('#quoteScreen .qp-step, #quoteScreen .qp-cert, #quoteScreen .bait-card').length, parts: [...document.querySelectorAll('#quoteParts .quote-fold .quote-card-title')].map(x => x.textContent).join('|') }; });
  console.log('finished quote:', JSON.stringify(gone));
  check(!gone.say && !gone.opinion, 'on a quote that has gone, Say the quote and the second opinion step aside');
  check(!gone.workOpen && /^\$/.test(gone.total) && gone.parts === 'Scope of works|Treatment plan|Terms|Client details', 'its parts are folded, the work first with its total and the client last: ' + gone.parts);
  check(gone.send === 'Email again' && !gone.filled, 'Email again is the quiet button beside PDF');
  check(!gone.steps, 'the quote screen has no steps of its own: the answer, the treatment and bait visits are on This job');
  await shot('4-quote-gone');
  // The job is finalised: the quote's parts open to read, but nothing in
  // them takes an edit.
  await p.evaluate(() => { const f = document.getElementById('quoteTermsFold'); f.open = true; f.scrollIntoView({ block: 'start' }); }); await p.waitForTimeout(300);
  const termsBefore = await p.inputValue('#qPaymentTerms');
  await p.locator('#qPaymentTerms').click({ force: true }).catch(() => {}); await p.waitForTimeout(300);
  const lockedQuote = await p.evaluate(() => ({ locked: isQuoteLocked(), note: document.getElementById('quoteLockNote').getBoundingClientRect().height > 0, focus: document.activeElement && document.activeElement.id, toast: (document.getElementById('toast') || {}).innerText || '' }));
  check(lockedQuote.locked && lockedQuote.note && lockedQuote.focus !== 'qPaymentTerms' && /finalised and locked/.test(lockedQuote.toast) && await p.inputValue('#qPaymentTerms') === termsBefore, 'a finalised job\'s quote opens to read but its fields don\'t take an edit: ' + lockedQuote.toast.replace(/\s+/g, ' ').slice(0, 70));

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
