// The whole job on a phone, by tapping the real buttons: sign-up setup,
// job details, pre-inspection agreement, a typed note filled by a canned AI,
// sign-off, sending the report, the quote and its send, the client's answer
// with a signature, the treatment record and the certificate.
// node e2e.js <outDir> [width=390]   (serve the repo on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/full-chain'; fs.mkdirSync(OUT, { recursive: true });
const W = +(process.argv[3] || 390);
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf', uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
const emails = [], downloads = [];
let shotN = 0;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: W, height: W < 360 ? 640 : 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, acceptDownloads: true });
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, async r => {
    const u = r.request().url(); let body = {}; try { body = r.request().postDataJSON() || {}; } catch (e) {}
    if (u.includes('/send-email')) { if (body.check) return r.fulfill({ json: { configured: true } }); emails.push(body); return r.fulfill({ json: { ok: true } }); }
    if (/workers\.dev\/?$/.test(u) && body.messages) {
      const text = JSON.stringify(sc.fields);
      return r.fulfill({ json: { content: [{ type: 'text', text }], stop_reason: 'end_turn' } });
    }
    return r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } });
  });
  await ctx.route(/supabase\.co/, r => {
    const u = r.request().url(), m = r.request().method();
    if (u.includes('businesses?owner_id')) return r.fulfill({ json: [] });
    if (u.includes('/rest/v1/businesses') && m === 'POST') return r.fulfill({ json: [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] });
    if (u.includes('/storage/v1/')) return r.fulfill({ json: { Key: 'ok' } });
    if (u.includes('/rest/v1/sign_requests') && m === 'POST') return r.fulfill({ json: [{ id: '00000001-1111-4222-8333-444444444444' }] });
    return r.fulfill({ json: [] });
  });
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); }, sess);
  const p = await ctx.newPage(); const errs = [], cons = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') cons.push(m.text()); });
  p.on('download', d => downloads.push(d.suggestedFilename()));
  const shot = async (name) => { await p.waitForTimeout(400); await p.screenshot({ path: `${OUT}/${String(++shotN).padStart(2, '0')}-${name}.png` }); };
  const tap = async (loc, what) => { try { await loc.scrollIntoViewIfNeeded({ timeout: 3000 }); await loc.tap({ timeout: 5000 }); return true; } catch (e) { check(false, 'tap ' + what + ': ' + e.message.split('\n')[0]); return false; } };
  const toasts = () => p.evaluate(() => [...document.querySelectorAll('.toast, #toast')].map(t => t.textContent.trim()).filter(Boolean));
  const sign = async (canvasSel) => {
    const c = p.locator(canvasSel); await c.scrollIntoViewIfNeeded(); const bb = await c.boundingBox();
    await p.mouse.move(bb.x + 20, bb.y + bb.height / 2); await p.mouse.down();
    for (let i = 1; i <= 12; i++) await p.mouse.move(bb.x + 20 + i * (bb.width - 40) / 12, bb.y + bb.height / 2 + (i % 2 ? -15 : 15));
    await p.mouse.up();
  };

  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  await shot('start');

  // 1. Business setup.
  const ob = await p.evaluate(() => getComputedStyle(document.getElementById('onboardScreen')).display !== 'none');
  check(ob, 'a new account lands on business setup');
  if (ob) {
    await p.fill('#ob-companyName', sc.company.name);
    await p.fill('#ob-phone', '0400000000');
    await tap(p.locator('#obBusinessSave'), 'Continue (business)'); await shot('ob-1');
    await tap(p.locator('#obDemoNext'), 'Continue (demo)'); await shot('ob-2');
    await tap(p.getByRole('button', { name: /Start inspecting/i }), 'Start Inspecting'); await p.waitForTimeout(1200); await shot('after-onboarding');
  }

  // 2. Job details, typed on the job page.
  await p.locator('#jobAddress').fill(sc.job.jobAddress); await p.keyboard.press('Escape');
  await p.locator('#jobSuburb').fill(sc.job.jobSuburb);
  await p.locator('#jobPostcode').fill(sc.job.jobPostcode);
  await tap(p.locator('#cards-jobState .choice-card', { hasText: /^\s*NSW\s*$/ }), 'state NSW');
  await p.locator('#jobClient').fill(sc.job.jobClient);
  await p.locator('#jobClientPhone').fill('0411 111 111');
  await p.locator('#jobClientEmail').fill('sam@example.com');
  await shot('job-filled');
  const job = await p.evaluate(() => ({ state: document.getElementById('jobState').value, hero: (document.querySelector('#jobOverlay.open .job-hero-addr') || {}).textContent || '' }));
  console.log('job:', JSON.stringify(job));
  check(job.state === 'NSW', 'state button sets NSW');
  check(/Banksia/.test(job.hero), 'the job page shows the address as it is typed');

  // 3. The report, opened from the job page's steps, and the agreement.
  await tap(p.locator('#jobOverlay .dash-timeline-btn', { hasText: 'Report' }), 'Report step on the job page'); await p.waitForTimeout(800); await shot('report');
  await tap(p.locator('#agreementBannerBtn'), 'Get it signed'); await p.waitForTimeout(800); await shot('agreement-open');
  const agFields = await p.evaluate(() => [...document.querySelectorAll('#agreementOverlay input, #agreementOverlay textarea, #agreementOverlay select')].filter(e => e.offsetParent).map(e => `${e.id}=${e.value}`));
  console.log('agreement fields:', agFields.join(' | '));
  await p.selectOption('#agreementInspectionType', { index: 2 });
  await p.fill('#agreementFee', '330');
  await tap(p.locator('#agreementAgree'), 'agree tick');
  await sign('#agreementOverlay canvas');
  await shot('agreement-signed-pad');
  await tap(p.locator('#agreementSignBtn'), 'Sign agreement'); await p.waitForTimeout(1200); await shot('agreement-done');
  const ag = await p.evaluate(() => reportData.agreement ? { method: reportData.agreement.method, name: reportData.agreement.signerName } : null);
  check(ag && ag.method === 'onsite' && ag.name === 'Sam Taylor', 'agreement signed on site: ' + JSON.stringify(ag));
  const dlBefore = downloads.length;
  await tap(p.locator('#agreementBannerBtn'), 'View agreement'); await p.waitForTimeout(600);
  await tap(p.getByRole('button', { name: /Send the client a copy/i }), 'agreement copy'); await p.waitForTimeout(2500); await shot('agreement-copy');
  console.log('after agreement copy: downloads', downloads.slice(dlBefore), 'emails', emails.length, 'toasts', await toasts());
  if (await p.evaluate(() => document.getElementById('agreementOverlay').classList.contains('open'))) await tap(p.locator('#agreementOverlay .voice-popover-close'), 'close agreement');

  // 4. A typed note, filled by the canned AI.
  await tap(p.locator('#micFab'), 'mic'); await p.waitForTimeout(1000); await shot('voice-open');
  console.log('after mic: popover open', await p.evaluate(() => document.getElementById('voicePopover').className), 'toasts', await toasts());
  await tap(p.locator('#transcriptBox'), 'transcript box');
  await p.keyboard.type('Pre-purchase single storey double brick house. Live termites in the gum tree out the back, about 15 metres from the house. Old workings on the rear bearer in the subfloor. Moisture 28 percent in the back room. Risk high.', { delay: 2 });
  await shot('note-typed');
  await tap(p.locator('#extractBtn'), 'Fill the report'); await p.waitForTimeout(4000); await shot('after-fill');
  const filled = await p.evaluate(() => ({ type: reportData.inspectionType, findings: (reportData.findings || []).length, risk: reportData.riskLevel, sheet: document.getElementById('extractSummaryOverlay').classList.contains('open') }));
  check(filled.findings === 2 && filled.risk === 'HIGH', 'the note filled the report: ' + JSON.stringify(filled));
  await tap(p.getByRole('button', { name: 'Mark the rest not applicable' }), 'mark rest n/a'); await p.waitForTimeout(400);
  await tap(p.getByRole('button', { name: 'Mark the rest as nothing found' }), 'mark rest nothing found'); await p.waitForTimeout(400);
  const ar = await p.evaluate(() => ({ subfloor: areaResultOf('subfloor'), site: areaResultOf('site'), interior: areaResultOf('interior') }));
  check(ar.subfloor === 'FOUND' && ar.site === 'FOUND' && ar.interior === 'CLEAR', 'areas a finding names are not marked "nothing found": ' + JSON.stringify(ar));
  await shot('summary-fixed');
  await tap(p.locator('#extractSummaryOverlay .extract-btn', { hasText: 'Done' }), 'Done'); await p.waitForTimeout(500);

  // 5. Sign-off.
  await tap(p.locator('#tab-finish'), 'Finish tab'); await p.waitForTimeout(600);
  await p.locator('#jobInspector').fill(sc.job.jobInspector);
  await p.locator('#inspectorLicence').fill('NSW 000000');
  await p.evaluate(() => document.getElementById('sigCanvasInspector').scrollIntoView({ block: 'center' }));
  await sign('#sigCanvasInspector'); await p.waitForTimeout(500);
  await shot('signoff');
  const so = await p.evaluate(() => ({ sig: !!reportData.inspectorSignature, share: !document.getElementById('shareBtn').disabled, gaps: reportPrepItems() }));
  console.log('sign-off:', JSON.stringify(so));
  check(so.sig, 'inspector signature is kept');
  await p.evaluate(() => { reportData.areaResult.subfloor = 'CLEAR'; });
  check((await p.evaluate(() => reportPrepGaps().map(g => g.key))).includes('contradiction'), 'the check flags "nothing found" over an area a finding names');
  await p.evaluate(() => { reportData.areaResult.subfloor = 'FOUND'; });

  // 6. Report PDF and send.
  let dl = downloads.length;
  await tap(p.locator('#generateBtn'), 'Generate report'); await p.waitForTimeout(5000); await shot('generated');
  console.log('after generate: downloads', downloads.slice(dl), 'toasts', await toasts());
  await tap(p.locator('#shareBtn'), 'Send to client (Finish step)'); await p.waitForTimeout(1500); await shot('send-review');
  console.log('send review:', (await p.evaluate(() => document.querySelector('#sendReviewOverlay .page-sheet').innerText)).slice(0, 600));
  let em = emails.length;
  await tap(p.locator('#sendReviewBtn'), 'Send review confirm'); await p.waitForTimeout(6000); await shot('report-sent');
  console.log('after send: emails', emails.slice(em).map(e => e.subject + ' -> ' + e.to + ' [' + (e.attachments || []).map(a => a.filename) + ']'), 'downloads', downloads.slice(dl), 'toasts', await toasts());

  // 7. The quote.
  await tap(p.locator('#mainPanel .doc-chip', { hasText: 'Quote' }), 'Quote in the document strip'); await p.waitForTimeout(1200); await shot('quote');
  const q = await p.evaluate(() => ({ items: (quoteState.items || []).map(i => i.desc || i.description || JSON.stringify(i)).slice(0, 6), total: document.getElementById('qTotal').textContent, client: document.getElementById('qClient').value, email: document.getElementById('qClientEmail').value, addr: document.getElementById('qAddress').value }));
  console.log('quote:', JSON.stringify(q));
  check(q.client === 'Sam Taylor' && q.email === 'sam@example.com' && /Banksia/.test(q.addr), 'quote carries the client and address');
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await shot('quote-bottom');
  em = emails.length;
  await tap(p.locator('#quoteEmailBtn'), 'Quote send'); await p.waitForTimeout(2000); await shot('quote-send-1');
  const qs = await p.evaluate(() => [...document.querySelectorAll('.page-sheet-overlay.open, .overlay.open')].map(o => o.id + ': ' + o.innerText.slice(0, 300)));
  console.log('after quote send tap:', qs, 'toasts', await toasts());
  if (await p.locator('#sendReviewOverlay.open').count()) { await tap(p.locator('#sendReviewBtn'), 'quote send confirm'); await p.waitForTimeout(6000); }
  await shot('quote-sent');
  console.log('after quote send: emails', emails.slice(em).map(e => e.subject + ' -> ' + e.to + ' [' + (e.attachments || []).map(a => a.filename) + ']'), 'toasts', await toasts());

  // 8. The client's answer, signed on the phone.
  await tap(p.locator('#quoteAnswer button', { hasText: /^Accepted$/i }).first(), 'Accepted'); await p.waitForTimeout(800); await shot('answer-open');
  const qa = await p.evaluate(() => ({ by: document.getElementById('qaBy').value, method: document.getElementById('qaMethod').value, signShown: !document.getElementById('qaSignWrap').hidden && !!document.getElementById('qaSignWrap').offsetParent, btn: document.getElementById('qaSaveBtn').disabled }));
  console.log('answer sheet:', JSON.stringify(qa));
  if (!qa.by) await p.fill('#qaBy', 'Sam Taylor');
  if (qa.signShown) { await p.evaluate(() => document.getElementById('qaSigCanvas').scrollIntoView({ block: 'center' })); await sign('#qaSigCanvas'); }
  await shot('answer-signed');
  await tap(p.locator('#qaSaveBtn'), 'Save answer'); await p.waitForTimeout(1500); await shot('answer-saved');
  const qans = await p.evaluate(() => quoteState.answer && { status: quoteState.answer.status, by: quoteState.answer.by, sig: !!quoteState.answer.signature });
  check(qans && qans.status === 'accepted' && qans.sig, 'client accepted with a signature: ' + JSON.stringify(qans));
  console.log('toasts', await toasts());

  // 9. Treatment record.
  await tap(p.getByRole('button', { name: /Treatment done\? Record it/i }), 'Record treatment'); await p.waitForTimeout(1000); await shot('treatment-open');
  const tr0 = await p.evaluate(() => [...document.querySelectorAll('#treatmentOverlay input, #treatmentOverlay textarea, #treatmentOverlay select')].filter(e => e.offsetParent && e.type !== 'radio' && e.type !== 'checkbox').map(e => `${e.id}=${e.value}`).join(' | '));
  console.log('treatment prefill:', tr0);
  const need = await p.evaluate(() => ({ btn: document.getElementById('trSaveBtn').disabled, need: (document.querySelector('#treatmentOverlay .sign-need, #trSaveNeed') || {}).textContent }));
  console.log('treatment save state:', JSON.stringify(need));
  if (!(await p.inputValue('#trTech'))) await p.fill('#trTech', sc.job.jobInspector);
  if (!(await p.inputValue('#trLicence'))) await p.fill('#trLicence', 'NSW 000000');
  await p.evaluate(() => document.getElementById('trSigCanvas').scrollIntoView({ block: 'center' })); await sign('#trSigCanvas');
  await shot('treatment-signed');
  const need2 = await p.evaluate(() => ({ btn: document.getElementById('trSaveBtn').disabled, text: document.getElementById('trSaveBtn').parentElement.innerText.slice(-300) }));
  console.log('treatment before save:', JSON.stringify(need2));
  await tap(p.locator('#trSaveBtn'), 'Save treatment'); await p.waitForTimeout(1500); await shot('treatment-saved');
  console.log('toasts', await toasts());
  const tr = await p.evaluate(() => quoteState.treatment ? Object.keys(quoteState.treatment).join(',') : null);
  check(!!tr, 'treatment record saved');

  // 10. Certificate.
  await p.evaluate(() => window.scrollTo(0, 0)); await shot('quote-after-treatment');
  em = emails.length;
  await tap(p.getByRole('button', { name: /Email certificate to/i }), 'Email certificate'); await p.waitForTimeout(2000); await shot('cert-1');
  if (await p.locator('#sendReviewOverlay.open').count()) { await tap(p.locator('#sendReviewBtn'), 'certificate send confirm'); }
  await p.waitForTimeout(5000); await shot('cert-sent');
  const certMail = emails.slice(em);
  console.log('certificate: emails', certMail.map(e => e.subject + ' -> ' + e.to + ' [' + (e.attachments || []).map(a => a.filename) + ']'), 'toasts', await toasts());
  check(certMail.length === 1 && (certMail[0].attachments || []).length === 1, 'certificate emailed with its PDF');
  dl = downloads.length;
  await tap(p.getByRole('button', { name: /^Certificate PDF$/i }), 'Certificate PDF'); await p.waitForTimeout(3000);
  console.log('certificate pdf:', downloads.slice(dl));
  // Save every PDF that went out, to look at.
  for (const e of emails) for (const a of (e.attachments || [])) if (a.content) fs.writeFileSync(`${OUT}/${a.filename}`, Buffer.from(a.content, 'base64'));

  const names = [...new Set(downloads.concat(emails.flatMap(e => (e.attachments || []).map(a => a.filename))))];
  console.log('file names:', names);
  check(names.length >= 4 && names.every(n => /^[\w-]+\.pdf$/.test(n) && /Epping_NSW_2121/.test(n)), 'PDF file names keep the whole address with no commas: ' + names.join(', '));

  // 11. Back on the dashboard, the job shows as done.
  await tap(p.locator('.tab[data-tab="dashboard"]'), 'Dashboard tab'); await p.waitForTimeout(1200); await shot('dashboard-end');
  check(/Treated/.test(await p.evaluate(() => document.getElementById('dashboardOverlay').innerText)), 'the dashboard shows the job as treated');

  // 12. Everything survives a reload.
  await p.reload(); await p.waitForTimeout(3000);
  const kept = await p.evaluate(() => { const q = typeof currentJobQuote === 'function' ? currentJobQuote() : null; return { addr: getFullAddress(), agreement: !!reportData.agreement, sig: !!reportData.inspectorSignature, sent: !!reportData.sent, answer: q && q.answer && q.answer.status, treatment: !!(q && q.treatment) }; });
  check(kept.addr && kept.agreement && kept.sig && kept.sent && kept.answer === 'accepted' && kept.treatment, 'the job survives a reload: ' + JSON.stringify(kept));
  await shot('after-reload');

  check(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log('page errors:', errs); console.log('console errors:', cons.slice(0, 10));
  fs.writeFileSync(`${OUT}/state.json`, JSON.stringify({ emails: emails.map(e => ({ to: e.to, subject: e.subject, att: (e.attachments || []).map(a => a.filename) })), downloads }, null, 1));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
