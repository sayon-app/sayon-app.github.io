// The agreement, either way: the Next step card offers "Email it to Sam to
// sign" and "Sign on this phone" (the link leads on a job booked for a
// later day with an email; the phone leads on the day), the link goes from
// the card filled from Job details, and the sheet's first step is one line
// read from Job details with a box only for what's missing. Also: the
// sheet's date is the job's date, a signed agreement's two buttons sit
// under the signature, the PDF cover names the job's client when someone
// else signs, and the client's sign page says a copy comes with the report.
// node e2e.js <outDir>  (serve the repo on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs'); const { execFileSync } = require('child_process');
const OUT = process.argv[2] || '/tmp/agreement-ways'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf', uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };

// The canned backend: one sign_requests row per POST, answered by the rpcs.
const rows = {}; const emails = []; let nextId = 0;
const newId = () => `0000${nextId++}`.padStart(8, '0') + '-1111-4222-8333-444444444444';
async function backend(ctx) {
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => {
    const u = r.request().url(); let body = {}; try { body = r.request().postDataJSON() || {}; } catch (e) {}
    if (u.includes('/send-email')) { if (body.check) return r.fulfill({ json: { configured: true } }); emails.push(body); return r.fulfill({ json: { ok: true } }); }
    return r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } });
  });
  await ctx.route(/supabase\.co/, r => {
    const req = r.request(), u = req.url(), m = req.method();
    if (u.includes('businesses?owner_id')) return r.fulfill({ json: [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] });
    if (u.includes('/rest/v1/sign_requests')) {
      if (m === 'POST') { const id = newId(); rows[id] = Object.assign({ id, status: 'pending' }, req.postDataJSON()); return r.fulfill({ json: [{ id }] }); }
      if (m === 'PATCH') { const id = decodeURIComponent(u.match(/id=eq\.([^&]+)/)[1]); if (rows[id] && rows[id].status === 'pending') rows[id].status = 'cancelled'; return r.fulfill({ status: 204, body: '' }); }
      const one = u.match(/id=eq\.([^&]+)/);
      const list = one ? [decodeURIComponent(one[1])] : decodeURIComponent((u.match(/id=in\.\(([^)]*)\)/) || [, ''])[1]).split(',').map(s => s.replace(/"/g, ''));
      return r.fulfill({ json: list.map(id => rows[id]).filter(Boolean).map(row => ({ id: row.id, status: row.status, signer_name: row.signer_name, signature: row.signature, signed_at: row.signed_at })) });
    }
    if (u.includes('/rest/v1/rpc/')) {
      const fn = u.split('/rpc/')[1], b = req.postDataJSON(), row = rows[b.p_id];
      if (fn === 'get_sign_request') return r.fulfill({ json: row ? { doc: row.doc, status: row.status, signer_name: row.signer_name, signed_at: row.signed_at } : null });
      if (!row) return r.fulfill({ json: 'not_found' });
      if (fn === 'submit_sign_request') { Object.assign(row, { status: 'signed', signer_name: b.p_name, signature: b.p_signature, signed_at: new Date().toISOString() }); return r.fulfill({ json: 'signed' }); }
    }
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
  const toast = () => p.evaluate(() => (document.getElementById('toast') || {}).innerText || '');
  // This job's Next step card, as it reads.
  const card = () => p.evaluate(() => { const c = document.querySelector('#jobOverlay .job-next'); if (!c) return null;
    const txt = s => { const e = c.querySelector(s); return e ? e.textContent.trim() : ''; };
    return { label: txt('.dash-next-label'), title: txt('.dash-next-title'), hint: txt('.dash-next-hint'), lead: txt('.dash-detail-primary'),
      leadWay: (c.querySelector('.dash-detail-primary') || {}).className || '', others: [...c.querySelectorAll('.dash-detail-links button')].map(x => x.textContent.trim()) }; });
  // The sheet's first step: the line, and which boxes show.
  const step1 = () => p.evaluate(() => { const vis = id => { const e = document.getElementById(id); return !!e && e.getBoundingClientRect().height > 0; };
    return { line: vis('agreementJobLine') ? document.getElementById('agreementJobText').textContent : null, change: vis('agreementJobChange'),
      type: vis('agreementInspectionType'), date: vis('agreementDate'), fee: vis('agreementFee'), notes: vis('agreementNotes') }; });
  const sign = async sel => {
    const c = p.locator(sel); await c.scrollIntoViewIfNeeded(); const bb = await c.boundingBox();
    await p.mouse.move(bb.x + 20, bb.y + bb.height / 2); await p.mouse.down();
    for (let i = 1; i <= 12; i++) await p.mouse.move(bb.x + 20 + i * (bb.width - 40) / 12, bb.y + bb.height / 2 + (i % 2 ? -15 : 15));
    await p.mouse.up();
  };
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const later = (() => { const d = new Date(); d.setDate(d.getDate() + 2); return iso(d); })();
  const day = /\w{3},? \d{1,2} \w{3}/.source;

  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  await p.evaluate(sc => { storeCompanyDetails(sc.company); openApp('inspect'); startNewJob(); }, sc);
  await p.waitForTimeout(800);

  // ── 1. A new job, on the day: the phone leads ──
  let c = await card();
  console.log('new job:', JSON.stringify(c));
  check(c.title === 'Get the agreement signed' && c.lead === 'Sign on this phone' && c.others.join(' | ') === 'Send the client a link to sign | Save it for later', 'a new job for today leads with Sign on this phone, with the link and Save it for later under it');
  await p.locator('#jobOverlay .job-next .job-way-link').click(); await p.waitForTimeout(400);
  check(/address/i.test(await toast()) && await p.evaluate(() => document.activeElement.id) === 'jobAddress' && !Object.keys(rows).length, 'the link with no address asks for the address first');

  // ── 2. Booked for a later day, with an email: the link leads ──
  await p.evaluate(later => {
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('jobAddress', '7 Banksia Drive'); set('jobSuburb', 'Epping'); set('jobPostcode', '2121'); set('jobClient', 'Sam Taylor'); set('jobClientEmail', 'sam@example.com');
    pickJobDate(later);
  }, later);
  await p.waitForTimeout(400);
  c = await card();
  console.log('booked ahead:', JSON.stringify(c));
  check(c.lead === 'Email it to Sam to sign' && /job-way-link/.test(c.leadWay) && c.others[0] === 'Sign on this phone', 'booked for a later day with an email, the card leads with Email it to Sam to sign');
  check(new RegExp(`^The inspection is on ${day}, so Sam can sign from an email before then\\. It goes to sam@example\\.com\\.$`).test(c.hint), 'and says why, and where it goes: ' + c.hint);
  await p.evaluate(() => document.querySelector('#jobOverlay .job-next').scrollIntoView({ block: 'center' })); await shot('new-job-link-leads');

  // ── 3. The link needs the inspection type: the sheet asks only for what's missing ──
  await p.locator('#jobOverlay .job-next .job-way-link').click(); await p.waitForTimeout(900);
  check(await p.evaluate(() => document.getElementById('agreementOverlay').classList.contains('open')) && /Choose the inspection type first/.test(await toast()) && !Object.keys(rows).length && !emails.length,
    'with no inspection type the agreement opens and says so, and nothing is sent');
  let s1 = await step1();
  console.log('step 1, type and fee missing:', JSON.stringify(s1));
  check(new RegExp(`^${day}$`).test(s1.line || '') && s1.change && s1.type && s1.fee && !s1.date && s1.notes, 'step 1 shows the day on one line and asks for the type and the fee, not the date: ' + s1.line);
  await p.evaluate(() => document.getElementById('agreementStepJob').scrollIntoView({ block: 'start' })); await shot('sheet-asks-whats-missing');
  await p.selectOption('#agreementInspectionType', 'Pre-Purchase — Timber Pest'); await p.fill('#agreementFee', '330'); await p.waitForTimeout(300);
  const wrote = await p.evaluate(() => ({ type: reportData.jobInspectionType, typeBox: document.getElementById('jobInspectionType').value, fee: reportData.jobFee, feeBox: document.getElementById('jobFee').value }));
  s1 = await step1();
  check(wrote.type === 'Pre-Purchase — Timber Pest' && wrote.typeBox === wrote.type && wrote.fee === '$330' && wrote.feeBox === '$330', 'the type and fee typed here are the job\'s own: ' + JSON.stringify(wrote));
  check(s1.type && s1.fee && new RegExp(`^${day}$`).test(s1.line || ''), 'the boxes stay while they\'re typed in, and the line doesn\'t repeat them');
  await p.evaluate(() => cancelSheet('agreementOverlay')); await p.waitForTimeout(700);

  // ── 4. The link goes from the card, filled from Job details ──
  c = await card();
  check(await p.evaluate(() => navPlace()) === 'job' && c.lead === 'Email it to Sam to sign' && c.others.join(' | ') === 'Sign on this phone', 'closing the sheet is back on This job, with both ways on the card: ' + c.lead + ' / ' + c.others.join(' | '));
  await p.evaluate(() => document.querySelector('#jobOverlay .job-next').scrollIntoView({ block: 'center' })); await shot('job-link-leads');
  await p.locator('#jobOverlay .job-next .job-way-link').click(); await p.waitForTimeout(2500);
  const ids = Object.keys(rows); const row = rows[ids[0]] || {};
  console.log('link row:', JSON.stringify({ n: ids.length, client: row.doc && row.doc.client, date: row.doc && row.doc.inspectionDate }));
  check(ids.length === 1 && row.doc.client === 'Sam Taylor' && row.doc.inspectionDate === later && /\$330 inc GST/.test(row.doc.text) && /pre-purchase timber pest/.test(row.doc.text) && /7 Banksia Drive, Epping/.test(row.doc.text),
    'one link is made, for the client, the day, the type and the fee in Job details');
  check(emails.length === 1 && emails[0].to === 'sam@example.com' && emails[0].text.includes(`sign.html?id=${ids[0]}`) && (emails[0].attachments || []).length === 1 && /^Agreement_/.test(emails[0].attachments[0].filename),
    'it is emailed to the client with the link and the agreement attached');
  c = await card();
  console.log('sent:', JSON.stringify(c));
  check(/^Agreement sent \d+ \w+, waiting on Sam$/.test(c.title) && c.others.join(' | ') === 'Check now | Send again', 'the card now says it went and who it waits on: ' + c.title);
  check(await p.evaluate(id => getSavedReports().some(r => r.reportData && r.reportData.agreementRequest && r.reportData.agreementRequest.id === id), ids[0]), 'the saved job carries the link straight away, so Jobs shows it waiting');
  await p.evaluate(() => document.querySelector('#jobOverlay .job-next').scrollIntoView({ block: 'center' })); await shot('job-link-sent');

  // ── 5. The client signs from the link, and is told a copy comes with the report ──
  const cl = await ctx.newPage();
  await cl.goto(`http://localhost:${PORT}/sign.html?id=${ids[0]}`); await cl.waitForTimeout(1200);
  await cl.locator('.check input').check();
  const pad = await cl.locator('.pad canvas').boundingBox();
  await cl.mouse.move(pad.x + 20, pad.y + 80); await cl.mouse.down();
  for (let i = 1; i <= 20; i++) await cl.mouse.move(pad.x + 20 + i * 12, pad.y + 80 + Math.sin(i / 2) * 30);
  await cl.mouse.up(); await cl.waitForTimeout(200);
  await cl.getByRole('button', { name: 'Sign agreement' }).click(); await cl.waitForTimeout(800);
  const done = await cl.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  check(/Signed, thank you/.test(done) && /A copy comes with your report\./.test(done), 'the client\'s page says thank you and that a copy comes with the report: ' + done.slice(0, 140));
  await cl.screenshot({ path: `${OUT}/client-signed.png` });
  await cl.reload(); await cl.waitForTimeout(1000);
  check(/Already signed/.test(await cl.evaluate(() => document.body.innerText)) && /A copy comes with your report\./.test(await cl.evaluate(() => document.body.innerText)), 'and says so again when the link is opened later');
  await cl.close();
  await p.locator('#jobOverlay .job-next button', { hasText: 'Check now' }).click(); await p.waitForTimeout(900);
  const signed = await p.evaluate(() => reportData.agreement && { method: reportData.agreement.method, by: reportData.agreement.signerName, date: reportData.agreement.inspectionDate, job: reportData.jobInspectionDate });
  check(signed && signed.method === 'remote' && signed.by === 'Sam Taylor' && signed.date === later && signed.job === later, 'Check now brings the signed agreement in, with the job\'s day: ' + JSON.stringify(signed));

  // ── 6. On the day, with everything in Job details: one line, and Change ──
  await p.evaluate(() => {
    startNewJob();
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('jobAddress', '12 Wattle Street'); set('jobSuburb', 'Epping'); set('jobPostcode', '2121'); set('jobClient', 'Kim Client'); set('jobFee', '$280');
    document.getElementById('jobInspectionType').value = 'Annual — Existing Building'; onInspectionTypeChange();
    saveCurrentReport(true); tabGo('dashboard');
  });
  await p.waitForTimeout(700);
  const act = () => p.evaluate(() => { const el = [...document.querySelectorAll('.dash-card')].find(x => /12 Wattle/.test(x.innerText)); return el ? el.querySelector('.dash-card-act').textContent.trim() : ''; });
  check(await act() === 'Get the agreement signed', 'the Jobs card says to get the agreement signed: ' + await act());
  await p.locator('.dash-card', { hasText: '12 Wattle' }).locator('.dash-card-act').click(); await p.waitForTimeout(800);
  check(await p.evaluate(() => document.getElementById('agreementOverlay').classList.contains('open')), 'on the day its button opens the agreement to sign on this phone');
  s1 = await step1();
  console.log('step 1, all known:', JSON.stringify(s1));
  check(new RegExp(`^Annual — Existing Building · ${day} · \\$280 inc GST$`).test(s1.line || '') && s1.change && !s1.type && !s1.date && !s1.fee && s1.notes, 'step 1 is one line read from Job details, with Change, and only Special requests to fill: ' + s1.line);
  await p.evaluate(() => document.getElementById('agreementStepJob').scrollIntoView({ block: 'start' })); await shot('sheet-one-line');
  await p.locator('#agreementJobChange').click(); await p.waitForTimeout(300);
  s1 = await step1();
  check(s1.type && s1.date && s1.fee && s1.line === null, 'Change swaps the line for the three boxes');
  await p.fill('#agreementDate', later); await p.locator('#agreementDate').dispatchEvent('change'); await p.waitForTimeout(300);
  const dated = await p.evaluate(() => ({ job: reportData.jobInspectionDate, box: document.getElementById('jobInspectionDate').value, text: document.getElementById('agreementText').innerText }));
  check(dated.job === later && dated.box === later && dated.text.includes(new Date(later + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })), 'a date changed on the sheet changes the job\'s date, and the wording follows');
  await shot('sheet-change');

  // ── 7. Someone signs for the client: the buttons sit under the signature, and the cover names the client ──
  await p.fill('#agreementSignerName', 'Jo Agent');
  await p.locator('#agreementAgree').check();
  await sign('#agreementSigCanvas');
  await p.locator('#agreementSignBtn').click(); await p.waitForTimeout(700);
  check(await p.evaluate(() => reportData.agreement && reportData.agreement.signerName) === 'Jo Agent', 'signed on the phone by someone else for the client');
  await p.evaluate(() => openAgreementSheet()); await p.waitForTimeout(500);
  const view = await p.evaluate(() => { const top = s => { const e = document.querySelector('#agreementView ' + s); return e && e.getBoundingClientRect().height ? Math.round(e.getBoundingClientRect().top) : null; };
    return { sig: top('.agreement-view-signature'), copy: top('.agr-signed-acts .extract-btn'), remove: top('#agreementRemoveBtn'), agreed: top('.agr-section-label'), vh: innerHeight }; });
  console.log('signed view:', JSON.stringify(view));
  check(view.sig < view.copy && view.copy < view.remove && view.remove < view.agreed && view.remove < view.vh, 'Send the client a copy and Remove and sign again sit under the signature, above What was agreed, on the first screen');
  await shot('signed-view');
  const b64 = await p.evaluate(async () => { await ensureJsPDFLoaded(); const { blob } = buildAgreementPdf(reportData.agreement);
    return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(blob); }); });
  fs.writeFileSync(`${OUT}/agreement.pdf`, Buffer.from(b64, 'base64'));
  let text = ''; try { text = execFileSync('pdftotext', ['-layout', `${OUT}/agreement.pdf`, '-']).toString(); } catch (e) {}
  if (text) {
    const cover = text.slice(0, text.search(/\n\s*1\s+The inspection/));
    console.log('cover:', cover.replace(/\s+/g, ' ').slice(0, 260));
    check(/CLIENT/.test(cover) && /Kim Client/.test(cover) && !/Jo Agent/.test(cover), 'the PDF\'s cover names the job\'s client, not whoever signed');
    check(/Jo Agent/.test(text.slice(cover.length)), 'the signer is named in the signature block');
  } else console.log('pdftotext not available: cover not checked');
  // A finalised job's agreement stays as it was signed.
  await p.evaluate(() => { reportData.issue = { version: 1, completedAt: Date.now() }; openAgreementSheet(); });
  check(await p.evaluate(() => document.getElementById('agreementRemoveBtn').getBoundingClientRect().height === 0), 'on a finalised job there is no Remove and sign again');
  await p.evaluate(() => { delete reportData.issue; closeAgreementSheet(); });

  // ── 8. The Jobs card of a job booked ahead goes to the card's link button ──
  await p.evaluate(later => {
    startNewJob();
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('jobAddress', '40 Later Lane'); set('jobSuburb', 'Epping'); set('jobPostcode', '2121'); set('jobClient', 'Lee Later'); set('jobClientEmail', 'lee@example.com');
    document.getElementById('jobInspectionType').value = 'Annual — Existing Building'; onInspectionTypeChange();
    pickJobDate(later); saveCurrentReport(true); tabGo('dashboard');
  }, later);
  await p.waitForTimeout(700);
  await p.locator('.dash-card', { hasText: '40 Later' }).locator('.dash-card-act').click(); await p.waitForTimeout(800);
  const landed = await p.evaluate(() => ({ place: navPlace(), sheet: document.getElementById('agreementOverlay').classList.contains('open'), lit: !!document.querySelector('#jobOverlay .job-next .job-way-link.flash') }));
  c = await card();
  check(landed.place === 'job' && !landed.sheet && landed.lit && c.lead === 'Email it to Lee to sign', 'for a job booked ahead the Jobs card opens This job with Email it to Lee to sign lit: ' + JSON.stringify(landed));
  check(Object.keys(rows).length === 1 && emails.length === 1, 'and nothing is sent until that button is tapped');

  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
