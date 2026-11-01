// Bait station visits: after a baiting system goes in, the technician records
// each check of the stations, the client gets a visit report, and the job
// comes back to To do when the next visit is due.
// node e2e.js <outDir>  (serve the repo on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/bait-visits'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf', uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
const emails = [];
let shotN = 0;
const iso = d => d.toISOString().slice(0, 10);
const daysFrom = (from, n) => { const d = new Date(from + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, acceptDownloads: true });
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  // The AI call for "Say it instead" answers with a canned visit.
  const spoken = { stations: [{ n: 1, status: 'clear' }, { n: 2, status: 'clear' }, { n: 6, status: 'active', bait: '2 cartridges' }, { n: 7, status: 'damaged', note: 'Lid replaced' }], restClear: true, product: { name: 'Exterra', batch: '4471' }, nextVisitWeeks: 4, notes: 'Keep the mulch clear of station 6.' };
  await ctx.route(/workers\.dev/, async r => {
    const u = r.request().url(); let body = {}; try { body = r.request().postDataJSON() || {}; } catch (e) {}
    if (u.includes('/send-email')) { if (body.check) return r.fulfill({ json: { configured: true } }); emails.push(body); return r.fulfill({ json: { ok: true } }); }
    if (/workers\.dev\/?$/.test(u) && body.messages) return r.fulfill({ json: { content: [{ type: 'text', text: JSON.stringify(spoken) }], stop_reason: 'end_turn' } });
    return r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } });
  });
  await ctx.route(/supabase\.co/, r => {
    const u = r.request().url();
    if (u.includes('businesses?owner_id')) return r.fulfill({ json: [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] });
    if (u.includes('/storage/v1/')) return r.fulfill({ json: { Key: 'ok' } });
    return r.fulfill({ json: [] });
  });
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1:u-owner', '1'); localStorage.setItem('korva_onboarded_v1', '1'); }, sess);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  const shot = async (name) => { await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/${String(++shotN).padStart(2, '0')}-${name}.png` }); };
  const tap = async (loc, what) => { try { await loc.scrollIntoViewIfNeeded({ timeout: 3000 }); await loc.tap({ timeout: 5000 }); return true; } catch (e) { check(false, 'tap ' + what + ': ' + e.message.split('\n')[0]); return false; } };
  const sign = async (canvasSel) => {
    const c = p.locator(canvasSel); await c.scrollIntoViewIfNeeded(); const bb = await c.boundingBox();
    await p.mouse.move(bb.x + 20, bb.y + bb.height / 2); await p.mouse.down();
    for (let i = 1; i <= 12; i++) await p.mouse.move(bb.x + 20 + i * (bb.width - 40) / 12, bb.y + bb.height / 2 + (i % 2 ? -15 : 15));
    await p.mouse.up();
  };
  const toasts = () => p.evaluate(() => [...document.querySelectorAll('.toast, #toast')].map(t => t.textContent.trim()).filter(Boolean));

  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);

  // A job that reached the treatment: report saved, quote with a baiting
  // line, accepted, treatment recorded with 12 stations 30 days ago and
  // the certificate emailed. Set up directly, since the full-chain test
  // walks those taps.
  const installDate = daysFrom(iso(new Date()), -30);
  await p.evaluate(async ({ sc, installDate }) => {
    storeCompanyDetails(sc.company); openApp('inspect'); resetReportState();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    for (const [k, v] of Object.entries(sc.job)) set(k, v); updateJob();
    document.getElementById('jobClientEmail').value = 'sam@example.com'; updateJob();
    await populateFields(sc.fields);
    reportData.sent = { at: Date.now() - 31 * 86400000, to: 'sam@example.com' };
    saveCurrentReport(true);
    directEmail = true;
    openQuoteFromReport();
    quoteState.items = [newQuoteItem('bait_install', { qty: 12 }), newQuoteItem('bait_monitor')];
    quoteState.clientEmail = 'sam@example.com';
    persistQuote();
    quoteState.answer = { status: 'accepted', by: 'Sam Taylor', date: installDate, method: 'signed', note: '', at: Date.now(), hash: quoteContentHash(quoteState) };
    quoteState.treatment = { date: installDate, technician: 'Alex Example', licence: 'NSW 000000', methods: { bait: '12' }, products: [{ name: 'Exterra', active: 'chlorfluazuron', batch: 'B-0003' }], areas: 'Perimeter of the building', notice: 'new', noticeWhere: 'Meter box', nextInspection: '', signature: '', at: Date.now() };
    quoteState.certificateSentAt = Date.now();
    persistQuote(); storeQuoteOnReport(quoteState, false);
    renderQuoteAnswer(); renderDocStrips();
  }, { sc, installDate });
  await p.waitForTimeout(800);

  // 1. The job knows about the stations: the first check is due 4 weeks
  // after the install, so this job is back in To do.
  const j0 = await p.evaluate(() => { const j = dashboardJob(getSavedReports()[0], getSavedQuotes()); return { group: j.group, status: j.status, next: j.next && j.next.to, steps: j.steps.map(s => `${s.label}:${s.state}:${s.text}`), ring: dashboardRing(j.steps, j.group).includes('/5') }; });
  console.log('job before any visit:', JSON.stringify(j0));
  check(j0.group === 'todo' && /First bait station check due/.test(j0.status) && j0.next === 'bait', 'a baiting job with no visit yet is in To do, first check due');
  check(j0.steps.length === 5 && /Bait station visits:now:First check due .*overdue/.test(j0.steps[4]) && j0.ring, 'the job has a fifth stage, Bait station visits, and the ring counts 5');
  const strip = await p.evaluate(() => [...document.querySelectorAll('#quoteScreen .doc-strip .doc-chip')].map(c => c.textContent.trim()));
  check(strip.includes('Bait visits'), 'the document strip gains Bait visits: ' + strip.join(', '));
  await p.evaluate(() => document.getElementById('qpBait').scrollIntoView({ block: 'center' })); await shot('bait-card');
  const card = await p.evaluate(() => document.getElementById('qpBait').innerText);
  check(/First check of the stations due/.test(card) && /12 stations installed/.test(card), 'the quote shows the bait card with the first check due: ' + card.replace(/\n/g, ' | ').slice(0, 120));

  // 2. Record a visit by tapping.
  await tap(p.locator('#qpBait button', { hasText: 'Record a visit' }), 'Record a visit'); await p.waitForTimeout(600); await shot('visit-open');
  const open = await p.evaluate(() => ({ stations: document.querySelectorAll('#bvStations .bait-station').length, tech: document.getElementById('bvTech').value, product: document.getElementById('bvProduct').value, batch: document.getElementById('bvBatch').value, next: document.getElementById('bvNext').value, need: document.getElementById('bvNeed').textContent, save: document.getElementById('bvSaveBtn').disabled }));
  console.log('sheet opened:', JSON.stringify(open));
  check(open.stations === 12 && open.product === 'Exterra' && open.batch === 'B-0003' && open.tech === 'Alex Example', '12 stations listed, bait and technician from the treatment record');
  check(open.save && /Mark each station/.test(open.need), 'save waits until every station is marked: ' + open.need);
  await p.fill('#bvStations .bait-station[data-i="5"] .bait-station-where', 'Rear left corner');
  await tap(p.locator('#bvStations .bait-station[data-i="5"] .bait-chip.active'), 'station 6 active'); await p.waitForTimeout(200);
  const after6 = await p.evaluate(() => ({ extra: !!document.querySelector('#bvStations .bait-station[data-i="5"] .bait-station-extra input'), next: document.getElementById('bvNext').value, date: document.getElementById('bvDate').value }));
  check(after6.extra, 'an active station opens a Bait added box');
  check(after6.next === daysFrom(after6.date, 28), 'termites feeding: the next visit starts at 4 weeks (' + after6.next + ')');
  await p.fill('#bvStations .bait-station[data-i="5"] .bait-station-extra input', '2 cartridges');
  await tap(p.locator('#bvStations .bait-station[data-i="6"] .bait-chip.damaged'), 'station 7 damaged'); await p.waitForTimeout(200);
  await p.fill('#bvStations .bait-station[data-i="6"] .bait-station-extra input', 'Lid replaced');
  await tap(p.locator('.bait-rest-btn'), 'Rest are clear'); await p.waitForTimeout(200);
  const marked = await p.evaluate(() => ({ summary: document.getElementById('bvSummary').textContent, need: document.getElementById('bvNeed').textContent, clear: document.querySelectorAll('#bvStations .bait-station.clear').length }));
  console.log('marked:', JSON.stringify(marked));
  check(marked.clear === 10 && /10 clear, 1 active, 1 damaged/.test(marked.summary), 'Rest are clear marks the other 10, and the summary says so');
  check(/Sign the visit/.test(marked.need), 'then only the signature is missing: ' + marked.need);
  await shot('visit-marked');
  await sign('#bvSigCanvas'); await p.waitForTimeout(200);
  check(await p.evaluate(() => !document.getElementById('bvSaveBtn').disabled), 'signed: Save visit is live');
  await tap(p.locator('#bvSaveBtn'), 'Save visit'); await p.waitForTimeout(800); await shot('visit-saved');
  const saved = await p.evaluate(() => { const v = quoteState.baitVisits; return v && { n: v.length, stations: v[0].stations.length, s6: v[0].stations[5], s7: v[0].stations[6], next: v[0].nextVisit, product: v[0].product, sig: !!v[0].signature, sent: v[0].sentAt }; });
  console.log('saved visit:', JSON.stringify(saved));
  check(saved && saved.n === 1 && saved.stations === 12 && saved.s6.status === 'active' && saved.s6.bait === '2 cartridges' && saved.s6.where === 'Rear left corner' && saved.s7.note === 'Lid replaced' && saved.product.name === 'Exterra' && saved.sig && !saved.sent, 'the visit is kept with the quote, stations, bait and signature included');
  check((await toasts()).some(t => /Email the client their visit report/.test(t)), 'the toast points to emailing the report');

  // 3. The job now waits on the report going out, then on the next visit.
  const j1 = await p.evaluate(() => { const j = dashboardJob(getSavedReports()[0], getSavedQuotes()); return { group: j.group, status: j.status, step: j.steps[4] }; });
  check(j1.group === 'todo' && j1.status === 'Email the visit report' && j1.step.state === 'now', 'a visit not yet emailed keeps the job in To do: ' + JSON.stringify(j1));
  const card1 = await p.evaluate(() => document.getElementById('qpBait').innerText);
  check(/1 of 12 active, 1 damaged/.test(card1) && /Not sent yet/.test(card1) && /Next due/.test(card1), 'the card lists the visit, not sent, with the next due: ' + card1.replace(/\n/g, ' | ').slice(0, 160));
  await shot('card-one-visit');

  // 4. Email the visit report.
  await p.evaluate(() => ensureJsPDFLoaded()); await p.waitForTimeout(500);
  let em = emails.length;
  await tap(p.locator('#qpBait button', { hasText: /^Email report/ }), 'Email report'); await p.waitForTimeout(4000);
  const sentMail = emails.slice(em);
  console.log('emails:', sentMail.map(e => `${e.subject} -> ${e.to} [${(e.attachments || []).map(a => a.filename)}]`));
  check(sentMail.length === 1 && /Bait station visit report/.test(sentMail[0].subject) && sentMail[0].to === 'sam@example.com' && (sentMail[0].attachments || []).some(a => /Bait_Visit/.test(a.filename)), 'the visit report goes to the client by email');
  check(/bait station visit report/.test(sentMail[0] && sentMail[0].body || sentMail[0] && sentMail[0].text || ''), 'the email names the visit report');
  const j2 = await p.evaluate(() => { const j = dashboardJob(getSavedReports()[0], getSavedQuotes()); return { group: j.group, status: j.status, sent: !!quoteState.baitVisits[0].sentAt, step: j.steps[4] }; });
  console.log('after email:', JSON.stringify(j2));
  check(j2.sent && j2.group === 'waiting' && /Bait check due/.test(j2.status), 'once emailed, the job waits for the next visit: ' + j2.status);

  // 5. The PDF: a summary, the station table and what happens next.
  const pdf = await p.evaluate(async () => { const { blob, fname } = buildBaitVisitPDF(quoteState, quoteState.baitVisits[0]); const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768)); return { b64: btoa(s), fname, pages: (s.match(/\/Type\s*\/Page[^s]/g) || []).length }; });
  fs.writeFileSync(`${OUT}/visit-report.pdf`, Buffer.from(pdf.b64, 'base64'));
  check(/^SAYON_Bait_Visit_BV-.*\.pdf$/.test(pdf.fname) && pdf.pages === 1, `the visit report is one page: ${pdf.fname}, ${pdf.pages} page(s)`);
  let text = '';
  try { text = require('child_process').execFileSync('pdftotext', ['-layout', `${OUT}/visit-report.pdf`, '-']).toString(); } catch (e) {}
  if (text) {
    check(/Termites active in station 6/.test(text) && /Bait added\s+to station 6/.test(text) && /Station 7: damaged or disturbed/.test(text), 'the summary names the active and damaged stations');
    check(/Rear left corner/.test(text) && /2 cartridges/.test(text) && /Lid replaced/.test(text) && /Exterra/.test(text) && /B-0003/.test(text), 'the table carries where, bait added and note, and the bait used is named');
    check(/next bait station visit is due/.test(text) && /do not move, open, cover or remove the stations/.test(text), 'the client is told the next visit and not to disturb the stations');
    check(!/colony is gone|guarantee/.test(text), 'no promises about the colony');
  } else console.log('pdftotext not available, PDF wording not checked');

  // 6. A second visit, said instead of typed: the spots carry over, and the
  // spoken note fills the stations.
  await tap(p.locator('#qpBait button', { hasText: 'Record a visit' }), 'Record a visit (2)'); await p.waitForTimeout(500);
  const open2 = await p.evaluate(() => ({ where6: document.querySelector('#bvStations .bait-station[data-i="5"] .bait-station-where').value, status: document.querySelectorAll('#bvStations .bait-station.set').length, product: document.getElementById('bvProduct').value }));
  check(open2.where6 === 'Rear left corner' && open2.status === 0 && open2.product === 'Exterra', 'the next visit keeps where each station is and the bait, not what was found');
  await p.evaluate(() => sheetVoiceFill('bait', 'one to five clear, six active added two cartridges, seven lid was off replaced it, rest are clear, Exterra batch 4471, back in four weeks'));
  await p.waitForTimeout(1500);
  const voiced = await p.evaluate(() => ({ summary: document.getElementById('bvSummary').textContent, s6: baitDraft.stations[5], s7: baitDraft.stations[6], batch: document.getElementById('bvBatch').value, next: document.getElementById('bvNext').value, date: document.getElementById('bvDate').value, notes: document.getElementById('bvNotes').value, said: document.querySelector('#bvVoice .sheet-voice-text').textContent }));
  console.log('voiced:', JSON.stringify(voiced));
  check(voiced.s6.status === 'active' && voiced.s6.bait === '2 cartridges' && voiced.s7.status === 'damaged' && voiced.s7.note === 'Lid replaced' && /10 clear/.test(voiced.summary), 'the spoken note marks the stations, bait and note');
  check(voiced.batch === '4471' && voiced.next === daysFrom(voiced.date, 28) && /mulch/.test(voiced.notes), 'and the batch, next visit and client note');
  await shot('visit-voiced');
  await sign('#bvSigCanvas'); await tap(p.locator('#bvSaveBtn'), 'Save visit (2)'); await p.waitForTimeout(800);
  check(await p.evaluate(() => quoteState.baitVisits.length === 2), 'the second visit is kept too');

  // 7. Editing a sent visit: a change the client would see needs sending again.
  await p.evaluate(() => { quoteState.baitVisits[1].sentAt = Date.now(); storeSentQuote(quoteState); });
  await p.waitForTimeout(300);
  await tap(p.locator('#qpBait .bait-visit-row').first().locator('button', { hasText: 'Edit' }), 'Edit the newest visit'); await p.waitForTimeout(500);
  check(await p.evaluate(() => document.getElementById('baitTitle').textContent === 'Edit the bait station visit' && document.querySelectorAll('#bvStations .bait-station.set').length === 12), 'edit opens the visit as it was saved');
  await tap(p.locator('#bvSaveBtn'), 'Save with nothing changed'); await p.waitForTimeout(500);
  check(await p.evaluate(() => !!quoteState.baitVisits.find(v => v.stations[5].status === 'active' && v.notes).sentAt), 'saving it unchanged keeps it marked as sent');
  await tap(p.locator('#qpBait .bait-visit-row').first().locator('button', { hasText: 'Edit' }), 'Edit again'); await p.waitForTimeout(500);
  await tap(p.locator('#bvStations .bait-station[data-i="2"] .bait-chip.eaten'), 'station 3 bait eaten'); await p.waitForTimeout(200);
  await tap(p.locator('#bvSaveBtn'), 'Save the change'); await p.waitForTimeout(500);
  check(await p.evaluate(() => !quoteState.baitVisits.find(v => v.stations[2].status === 'eaten').sentAt), 'a change the client would see clears the sent mark');

  // 8. The job page shows the stage; the dashboard peek lists the visits.
  await p.evaluate(() => { jobGo('job'); });
  await p.waitForTimeout(600); await shot('job-page');
  const jp = await p.evaluate(() => [...document.querySelectorAll('#jobOverlay .job-steps li')].map(li => li.className + ':' + li.querySelector('.dash-timeline-label').textContent + ':' + li.querySelector('.dash-timeline-text').textContent));
  console.log('job page steps:', JSON.stringify(jp));
  check(jp.length === 6 && /Bait station visits:Visit report not emailed yet/.test(jp[5]), 'the job page lists Bait station visits after Treatment');
  await p.evaluate(() => { closeJobPage(); openDashboard(); openDashboardDetail(getSavedReports()[0].id); openDashboardPeek(getSavedReports()[0].id, 'bait'); });
  await p.waitForTimeout(600); await shot('dashboard-peek');
  const peek = await p.evaluate(() => document.getElementById('dashboardDetailSheet').innerText);
  check(/Bait station visits/.test(peek) && /Stations\s*12/.test(peek) && /1 of 12 active/.test(peek), 'the dashboard peek shows the stations and visits: ' + peek.replace(/\n/g, ' | ').slice(0, 200));
  await p.evaluate(() => closeDashboard());

  // 9. Finished: the job is done.
  await p.evaluate(() => { jobGo('bait'); });
  await p.waitForTimeout(600);
  await tap(p.locator('#qpBait button', { hasText: 'Record a visit' }), 'Record a visit (3)'); await p.waitForTimeout(500);
  await tap(p.locator('.bait-rest-btn'), 'Rest are clear (3)'); await p.waitForTimeout(200);
  const quiet = await p.evaluate(() => ({ next: document.getElementById('bvNext').value, date: document.getElementById('bvDate').value }));
  const threeMonths = (() => { const d = new Date(quiet.date + 'T00:00:00'); d.setMonth(d.getMonth() + 3); return iso(d); })();
  check(quiet.next === threeMonths, 'every station quiet: the next visit starts at 3 months (' + quiet.next + ')');
  await p.check('#bvFinished');
  check(await p.evaluate(() => document.getElementById('bvNextWrap').hidden), 'Baiting finished hides the next visit');
  await sign('#bvSigCanvas'); await tap(p.locator('#bvSaveBtn'), 'Save visit (3)'); await p.waitForTimeout(800);
  await p.evaluate(() => { quoteState.baitVisits.forEach(v => { v.sentAt = v.sentAt || Date.now(); }); storeSentQuote(quoteState); });
  const j3 = await p.evaluate(() => { const j = dashboardJob(getSavedReports()[0], getSavedQuotes()); return { group: j.group, status: j.status, step: j.steps[4], card: document.getElementById('qpBait').innerText.split('\n')[1] }; });
  console.log('finished:', JSON.stringify(j3));
  check(j3.group === 'done' && /baiting finished/.test(j3.status) && j3.step.state === 'done' && /Finished after 3 visits/.test(j3.step.text), 'baiting finished: the job is done, the stage is done');
  await p.evaluate(() => document.getElementById('qpBait').scrollIntoView({ block: 'center' })); await shot('finished');

  // 10. It all survives a reload.
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  const kept = await p.evaluate(() => { const q = currentJobQuote(); return q && q.baitVisits ? q.baitVisits.length : 0; });
  check(kept === 3, 'the visits survive a reload: ' + kept);

  check(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
