// The client link, end to end, against canned Supabase and Worker routes:
//   1. the quote screen's Send makes the link, uploads the PDFs and emails
//      the quote with the link in the message;
//   2. the report's Check-before-sending sheet reuses that link;
//   3. the client opens sign.html, reads the quote and accepts with a
//      signature (and, on a second link, declines with a note);
//   4. the app reads the answer back into the quote.
// node e2e.js <outDir>   (serve the repo on :8765 first; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/client-link'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf', uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };

// The canned backend: one sign_requests row per POST, answered by the rpcs.
const rows = {}; const uploads = []; const emails = []; let nextId = 0;
const newId = () => `0000${nextId++}`.padStart(8, '0') + '-1111-4222-8333-444444444444'.slice(0);
async function backend(ctx) {
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => {
    const u = r.request().url(), body = r.request().postDataJSON ? (r.request().postDataJSON() || {}) : {};
    if (u.includes('/send-email')) { if (body.check) return r.fulfill({ json: { configured: true } }); emails.push(body); return r.fulfill({ json: { ok: true } }); }
    return r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } });
  });
  await ctx.route(/supabase\.co/, r => {
    const req = r.request(), u = req.url(), m = req.method();
    if (u.includes('businesses?owner_id')) return r.fulfill({ json: [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] });
    if (u.includes('/storage/v1/object/client-docs/')) { uploads.push(u.split('/client-docs/')[1]); return r.fulfill({ json: { Key: 'ok' } }); }
    if (u.includes('/rest/v1/sign_requests')) {
      if (m === 'POST') { const id = newId(); rows[id] = Object.assign({ id, status: 'pending' }, req.postDataJSON()); return r.fulfill({ json: [{ id }] }); }
      if (m === 'PATCH') { const id = decodeURIComponent(u.match(/id=eq\.([^&]+)/)[1]); if (rows[id] && rows[id].status === 'pending') rows[id].status = 'cancelled'; return r.fulfill({ status: 204, body: '' }); }
      const id = decodeURIComponent(u.match(/id=eq\.([^&]+)/)[1]); const row = rows[id];
      return r.fulfill({ json: row ? [{ status: row.status, signer_name: row.signer_name, signature: row.signature, signed_at: row.signed_at, note: row.note }] : [] });
    }
    if (u.includes('/rest/v1/rpc/')) {
      const fn = u.split('/rpc/')[1], b = req.postDataJSON(), row = rows[b.p_id];
      if (fn === 'get_sign_request') return r.fulfill({ json: row ? { doc: row.doc, status: row.status, signer_name: row.signer_name, signed_at: row.signed_at, note: row.note } : null });
      if (!row) return r.fulfill({ json: 'not_found' });
      if (fn === 'submit_sign_request') {
        if (!b.p_signature || !b.p_signature.startsWith('data:image/png;base64,')) return r.fulfill({ json: 'bad_signature' });
        Object.assign(row, { status: 'signed', signer_name: b.p_name, signature: b.p_signature, signed_at: new Date().toISOString() }); return r.fulfill({ json: 'signed' });
      }
      if (fn === 'decline_sign_request') { Object.assign(row, { status: 'declined', signer_name: b.p_name, note: b.p_note, signed_at: new Date().toISOString() }); return r.fulfill({ json: 'declined' }); }
    }
    return r.fulfill({ json: [] });
  });
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await backend(ctx);
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1', '1'); }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  await p.evaluate(async (sc) => {
    storeCompanyDetails(sc.company); openApp('inspect'); resetReportState();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    for (const [k, v] of Object.entries(sc.job)) set(k, v);
    set('jobClientEmail', 'sam@example.com'); updateJob();
    await populateFields(sc.fields);
  }, sc);
  await p.waitForTimeout(2500);
  await p.evaluate(() => { reportData.inspectorLicence = 'NSW 000000'; saveDraft(); directEmail = true; openQuoteFromReport(); });
  await p.waitForTimeout(2000);

  // 1. Send from the quote screen.
  await p.evaluate(() => { quoteState.clientEmail = 'sam@example.com'; persistQuote(); emailQuoteToClient(); });
  await p.waitForFunction(() => quoteState && quoteState.sentAt, null, { timeout: 60000 });
  await p.waitForTimeout(600);
  const q1 = await p.evaluate(() => ({ link: quoteState.linkRequest, sentAt: quoteState.sentAt, hash: quoteContentHash(quoteState), client: quoteState.client }));
  const row1 = rows[q1.link && q1.link.id];
  check(!!row1, 'quote Send made a sign_requests row');
  check(row1 && row1.doc.kind === 'quote' && row1.doc.items.length > 0 && row1.doc.total > 0, 'row doc is the quote: kind, items, total');
  check(row1 && row1.doc.files.report && row1.doc.files.quote, 'report and quote PDFs uploaded and linked from the doc');
  check(uploads.length === 2 && uploads.every(u => u.startsWith(uid + '/')), 'uploads go under the inspector\'s folder');
  check(emails.length === 1 && emails[0].text.includes(`sign.html?id=${q1.link.id}`), 'email carries the link');
  check(emails[0] && emails[0].attachments.length === 1, 'email carries the quote PDF');
  check(q1.link.hash === q1.hash, 'link is for this version of the quote');
  await p.evaluate(() => { document.querySelector('#quoteScreen .quote-scroll').scrollTo(0, 1e6); });
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/1-quote-link-sent.png`, fullPage: false });

  // 2. The report's check sheet reuses the link.
  await p.evaluate(() => { closeQuote(); openSendReview(); });
  await p.waitForFunction(() => sendReview && sendReview.link, null, { timeout: 60000 });
  await p.waitForTimeout(400);
  const sheet = await p.evaluate(() => ({ link: sendReview.link, body: document.getElementById('sendReviewBody').value, files: document.getElementById('sendReviewFiles').innerText }));
  check(sheet.link.endsWith(q1.link.id), 'check sheet reuses the same link');
  check(sheet.body.includes(sheet.link), 'check sheet message carries the link');
  check(/Link to accept the quote/.test(sheet.files), 'check sheet lists the link');
  await p.screenshot({ path: `${OUT}/2-check-before-sending.png`, fullPage: false });
  await p.evaluate(() => confirmSendReview());
  await p.waitForFunction(() => !sendReview, null, { timeout: 60000 });
  check(emails.length === 2 && emails[1].attachments.length === 2 && emails[1].text.includes(q1.link.id), 'report send emails both PDFs with the link');

  // 3. The client accepts.
  const c = await ctx.newPage();
  await c.goto(`http://localhost:${PORT}/sign.html?id=${q1.link.id}`); await c.waitForTimeout(1200);
  await c.screenshot({ path: `${OUT}/3-client-quote.png`, fullPage: true });
  const text = await c.evaluate(() => document.body.innerText);
  check(/Treatment quote/.test(text) && /Scope of works/i.test(text) && /Total inc GST/.test(text), 'client page shows the quote');
  check(/Inspection report \(PDF\)/.test(text) && /Treatment quote \(PDF\)/.test(text), 'client page offers both PDFs');
  check((await c.evaluate(() => document.title)) === 'Your treatment quote', 'page title is the quote');
  check((await c.evaluate(() => document.getElementById('name').value)) === q1.client, 'client name is filled in');
  const btn = c.getByRole('button', { name: 'Accept quote' });
  check(await btn.isDisabled(), 'Accept is off until signed');
  await c.locator('.check input').check();
  const pad = await c.locator('.pad canvas').boundingBox();
  await c.mouse.move(pad.x + 20, pad.y + 80); await c.mouse.down();
  for (let i = 1; i <= 20; i++) await c.mouse.move(pad.x + 20 + i * 12, pad.y + 80 + Math.sin(i / 2) * 30);
  await c.mouse.up(); await c.waitForTimeout(200);
  check(!(await btn.isDisabled()), 'Accept is on once named, ticked and signed');
  await c.screenshot({ path: `${OUT}/4-client-signed.png`, fullPage: false });
  await btn.click(); await c.waitForTimeout(800);
  check(/Quote accepted, thank you/.test(await c.evaluate(() => document.body.innerText)), 'client sees the accepted state');
  check(row1.status === 'signed' && row1.signer_name === q1.client, 'row is signed by the client');
  await c.screenshot({ path: `${OUT}/5-client-accepted.png`, fullPage: false });
  await c.reload(); await c.waitForTimeout(1000);
  check(/Quote accepted/.test(await c.evaluate(() => document.body.innerText)), 'reopening the link shows it as accepted');

  // 3b. Another client declines, with a note.
  const id2 = newId(); rows[id2] = { id: id2, status: 'pending', doc: Object.assign({}, row1.doc, { client: 'Pat Example' }) };
  await c.goto(`http://localhost:${PORT}/sign.html?id=${id2}`); await c.waitForTimeout(1000);
  await c.getByRole('button', { name: 'I don’t want to go ahead' }).click();
  await c.fill('#declineNote', 'Going with another company');
  await c.screenshot({ path: `${OUT}/6-client-decline.png`, fullPage: true });
  await c.getByRole('button', { name: 'Decline quote' }).click(); await c.waitForTimeout(800);
  check(rows[id2].status === 'declined' && rows[id2].note === 'Going with another company' && rows[id2].signer_name === 'Pat Example', 'decline reaches the row with the note');
  check(/Thanks for letting us know/.test(await c.evaluate(() => document.body.innerText)), 'client sees the declined state');
  await c.reload(); await c.waitForTimeout(1000);
  check(/Quote declined/.test(await c.evaluate(() => document.body.innerText)) && /Going with another company/.test(await c.evaluate(() => document.body.innerText)), 'reopening a declined link shows the note');

  // 4. The app reads the answer back.
  await p.evaluate(() => { openQuoteFromReport(); });
  await p.waitForTimeout(1500);
  await p.evaluate(() => checkQuoteLink(quoteState, true));
  await p.waitForFunction(() => quoteState && quoteState.answer, null, { timeout: 10000 });
  const ans = await p.evaluate(() => ({ a: quoteState.answer, link: quoteState.linkRequest, stale: quoteAnswerState(quoteState).stale, step: document.getElementById('qgStep3').innerText }));
  check(ans.a.status === 'accepted' && ans.a.method === 'link' && ans.a.by === q1.client && /^data:image\/png/.test(ans.a.signature), 'quote holds the accepted answer with the signature');
  check(!ans.link && !ans.stale, 'link request is cleared and the answer is current');
  check(/Accepted/.test(ans.step) && /from the link/.test(ans.step), 'answer step shows it');
  await p.evaluate(() => { document.querySelector('#quoteScreen .quote-scroll').scrollTo(0, 1e6); });
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/7-quote-accepted-in-app.png`, fullPage: false });
  const pdf = await p.evaluate(async () => { const { blob } = buildQuotePDF(quoteState); const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768)); return btoa(s); });
  fs.writeFileSync(`${OUT}/quote-accepted.pdf`, Buffer.from(pdf, 'base64'));

  // A changed quote needs a new link: the old one is cancelled.
  await p.evaluate(() => { quoteState.items[0].price = String(parseFloat(quoteState.items[0].price) + 10); delete quoteState.answer; quoteState.linkRequest = { id: Object.keys({})[0] }; });
  const oldId = q1.link.id; rows[oldId].status = 'pending';
  await p.evaluate((id) => { quoteState.linkRequest = { id, sentAt: 1, hash: 'old' }; persistQuote(); emailQuoteToClient(); }, oldId);
  await p.waitForFunction((id) => quoteState.linkRequest && quoteState.linkRequest.id !== id, oldId, { timeout: 60000 });
  await p.waitForTimeout(500);
  check(rows[oldId].status === 'cancelled', 'a changed quote cancels the old link');
  check(Object.keys(rows).length === 3, 'and makes a new one');

  console.log('page errors:', errs.length ? errs : 'none');
  check(errs.length === 0, 'no page errors');
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
