// What the client sees: the PDFs, their file names, the job file, the signed
// quote and the public pages.
//   1. The report says "Not recorded" for a blank and nothing else: no
//      conducive conditions is a green "NONE FOUND" only once the questions
//      are answered, and the same two words aren't used for both;
//   2. no termites is one row, not a numbered card with a nest question;
//   3. a section with nothing in it stays out (Photographs, with no general
//      photos, and the numbers after it move up), and a heading never stands
//      over nothing (the conducive conditions' two headings);
//   4. the last photo of a section never goes over to a new page by itself,
//      and the next section starts under photos that did run over;
//   5. every PDF is named for what it is, then the address;
//   6. the job file carries the agreement once, and every page says which
//      page of the file it is;
//   7. a client who signs to accept gets the signed quote: it's the job's
//      next step, and the thank-you page says it's coming;
//   8. the public pages name things as the app does, the privacy policy's
//      version matches the one sign-up records, and the website's sample
//      report says what a report made today says.
// node e2e.js <outDir>   (serve the repo on :8765 first; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const OUT = process.argv[2] || '/tmp/client-sees'; fs.mkdirSync(OUT, { recursive: true });
const ROOT = path.join(__dirname, '..', '..');
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf', uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const scenarios = require('../visual/scenarios.js');
const clean = scenarios.find(s => s.name === 'clean'), standard = scenarios.find(s => s.name === 'standard');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
const emails = [];
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => {
    const u = r.request().url(); let body = {}; try { body = r.request().postDataJSON() || {}; } catch (e) {}
    if (u.includes('/send-email')) { if (body.check) return r.fulfill({ json: { configured: true } }); emails.push(body); return r.fulfill({ json: { ok: true } }); }
    return r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } });
  });
  await ctx.route(/supabase\.co/, r => r.request().url().includes('businesses?owner_id') ? r.fulfill({ json: [{ id: 'b1', name: standard.company.name, owner_id: uid, settings: {} }] }) : r.fulfill({ json: [] }));
  await ctx.addInitScript(s => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1:' + s.user.id, '1'); }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const dialogs = []; p.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  const shot = async name => { await p.waitForTimeout(350); await p.screenshot({ path: `${OUT}/${name}.png` }); };

  // A PDF made in the page, saved, and read back a page at a time.
  const TO_B64 = `async blob => { const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768)); return btoa(s); }`;
  const makePdf = async (body, name) => {
    const made = await p.evaluate(new Function(`return (async () => { const toB64 = ${TO_B64}; ${body} })()`));
    const file = `${OUT}/${name}.pdf`; fs.writeFileSync(file, Buffer.from(made.b64, 'base64'));
    const pages = execFileSync('pdftotext', ['-layout', file, '-']).toString().split('\f').map(t => t.replace(/\s+/g, ' ').trim());
    if (pages.length && !pages[pages.length - 1]) pages.pop();
    return { fname: made.fname, pages, text: pages.join(' '), agreementPage: made.agreementPage };
  };
  const report = name => makePdf(`await ensureJsPDFLoaded(); const r = await buildReportPdf(); return { b64: await toB64(r.blob), fname: r.fname, agreementPage: r.agreementPage };`, name);
  const pageOf = (pdf, re) => pdf.pages.findIndex(t => re.test(t)) + 1;

  const newJob = (sc, opts = {}) => p.evaluate(async ({ sc, opts, SIG }) => {
    if (document.getElementById('quoteScreen').classList.contains('open')) closeQuote();
    openApp('inspect'); resetReportState(); startBlankReport();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    for (const [k, v] of Object.entries(sc.job)) set(k, v);
    if (opts.address) set('jobAddress', opts.address);
    set('jobClientEmail', 'sam@example.com'); saveJobInfo(); updateJob();
    const v = agreementFormValues();
    reportData.agreement = { method: 'onsite', signerName: sc.job.jobClient, signature: SIG, signedAt: Date.now() - 3600e3, inspectionDate: v.inspectionDate, fee: '350', notes: '', standard: v.standard, text: v.text };
    renderAgreementBanner();
    await populateFields(Object.assign({}, sc.fields, opts.fields || {}));
    if (opts.fill) {
      Object.values(REQUIRED_FIELDS).flat().filter(k => !isFieldFilled(k) && document.getElementById('f-' + k)).forEach(k => { reportData[k] = 'NO'; });
      markRemainingAreasInspected('INSPECTED'); markRemainingAreasClear();
    }
    reportData.inspectorSignature = SIG; reportData.inspectorLicence = sc.company.licence;
    updateProgress(); saveCurrentReport(true);
  }, { sc, opts, SIG });
  // n made-up photos into a section's list (or the general photos).
  const addPhotos = (section, n, caption) => p.evaluate(async ({ section, n, caption }) => {
    const mk = (hue, label) => { const c = document.createElement('canvas'); c.width = 600; c.height = 450; const x = c.getContext('2d'); x.fillStyle = `hsl(${hue},35%,50%)`; x.fillRect(0, 0, 600, 450); x.fillStyle = '#fff'; x.font = '50px sans-serif'; x.fillText(label, 40, 240); return new Promise(r => c.toBlob(r, 'image/jpeg', 0.7)); };
    if (!reportData.photosBySection) reportData.photosBySection = {};
    const list = section === 'gallery' ? (reportData.photos || (reportData.photos = [])) : (reportData.photosBySection[section] || (reportData.photosBySection[section] = []));
    for (let i = 0; i < n; i++) { const id = genPhotoId(); await putPhotoBlob(id, await mk((i * 47) % 360, `${section} ${i + 1}`)); list.push({ id, width: 600, height: 450, caption: caption ? `${caption} ${i + 1}` : '' }); }
  }, { section, n, caption });

  await p.evaluate(sc => { storeCompanyDetails(sc.company); directEmail = true; }, standard);

  // ── 1 to 3. A report with no termites, the conducive questions half answered, no general photos ──
  await newJob(clean, { fields: { findings: [{ termiteActivity: 'NONE' }] } }); await p.waitForTimeout(700);
  let pdf = await report('1-half-answered');
  const summary = pdf.pages[pageOf(pdf, /SUMMARY/) - 1] || '';
  check(/Conditions conducive to timber pests\? NOT RECORDED/.test(summary), 'with the conducive questions half answered, the summary says NOT RECORDED: ' + (summary.match(/Conditions conducive[^?]*\? [A-Z ]+?(?= See)/) || [''])[0]);
  check(!/NONE RECORDED|None recorded/.test(pdf.text) && /EXISTING SYSTEM Not recorded/i.test(pdf.text), 'a blank is "Not recorded" everywhere, the termite system included, and "None recorded" is gone');
  check(/TERMITE ACTIVITY NONE/.test(pdf.text) && !/TERMITE FINDING 1|NO ACTIVITY FOUND|NEST FOUND\? NOT RECORDED/i.test(pdf.text), 'no termites is one row: no numbered card, no nest question');
  check(/Termite nest found\? NO\b/.test(summary) && /Live termites found\? NO\b/.test(summary), 'the summary still answers live termites and nest NO');
  const cond = pdf.text.slice(pdf.text.lastIndexOf('MOISTURE, DRAINAGE & VENTILATION'), pdf.text.lastIndexOf('RECOMMENDATIONS & RISK'));
  check(/MOISTURE DETECTED Not recorded/.test(cond) && /SLAB EDGE EXPOSURE Not recorded/.test(cond) && /WATER LEAKS NO/.test(cond) && !/SITE DRAINAGE/.test(cond), 'a required conducive question left blank prints as Not recorded; an optional one is left out');
  check(!/PHOTOGRAPHS|No general photographs/.test(pdf.text) && !/Photographs/.test(pdf.pages[1]), 'with no general photos there is no Photographs section, in the report or its contents');
  const contents = pdf.pages[1];
  check(/8 Recommendations & Risk .* 9 Scope, Limitations, Definitions & Terms .* 10 Inspector Details .* 11 Client Acknowledgement/.test(contents) && /\b9 SCOPE, LIMITATIONS/.test(pdf.text) && /\b10 INSPECTOR DETAILS/.test(pdf.text) && /\b11 CLIENT ACKNOWLEDGEMENT/.test(pdf.text),
    'and the sections after it move up one, so the numbers run on: ' + (contents.match(/8 Recommendations.*$/) || [''])[0].slice(0, 160));

  // Answered, with nothing found: now it is an answer.
  await p.evaluate(() => { reportData.moistureReadings = 'NO'; reportData.slabEdge = 'CLEAR'; saveDraft(); });
  await addPhotos('gallery', 1, 'Meter box');
  pdf = await report('1-answered');
  check(/Conditions conducive to timber pests\? NONE FOUND/.test(pdf.text), 'once the questions are answered, none is "NONE FOUND"');
  check(await p.evaluate(() => { const it = reportSummary().groups.flatMap(g => g.items).find(i => /conducive/.test(i[0])); return it[1] === 'NONE FOUND' && it[2] === 'good'; }), 'and it is green, like every other "no"');
  check(/\b9 PHOTOGRAPHS/.test(pdf.text) && /9 Photographs .* 10 Scope, Limitations/.test(pdf.pages[1]) && /\b12 CLIENT ACKNOWLEDGEMENT/.test(pdf.text), 'with a general photo, Photographs is section 9 and the rest keep their numbers');

  // ── 4. Photo rows ──
  // Three photos on a condition, pushed down the page a line at a time: the
  // third never goes over to the next page by itself.
  await newJob(standard, { fill: true, address: '9 Banksia Drive' }); await p.waitForTimeout(700);
  await p.evaluate(() => { reportData.timberSoil = 'YES'; });
  await addPhotos('cond-timberSoil', 3, 'Sleeper');
  // Where a section's photos fell: the page each is on, by its place in the section.
  const fell = (pdf, count) => {
    const first = pdf.text.match(/Photo (\d+) (?:(?!Photo \d).)*?Sleeper 1\b/); if (!first) return null;
    const n = +first[1];
    return { n, pages: Array.from({ length: count }, (_, i) => pageOf(pdf, new RegExp(`Photo ${n + i} (?:(?!Photo \\d).)*?Sleeper ${i + 1}\\b`))), section: pageOf(pdf, /\b7 CONDUCIVE CONDITIONS/), next: pageOf(pdf, /\b8 RECOMMENDATIONS & RISK/) };
  };
  const pushDown = k => p.evaluate(k => { reportData.timberSoilDetails = Array.from({ length: k * 3 }, (_, i) => `Line ${i + 1} of what was seen at the garden bed along the east fence.`).join(' '); }, k);
  let alone = 0, three = 0, tried = 0, over = 0, under = 0;
  for (let k = 0; k <= 16; k++) {
    await pushDown(k);
    pdf = await report('4-three-' + k);
    const f = fell(pdf, 3); if (!f) continue;
    tried++;
    if (f.pages[2] > f.pages[1]) alone++;
    // Three to a row: the three numbers sit on one line of the page.
    if (f.pages[0] === f.pages[2] && execFileSync('pdftotext', ['-layout', '-f', String(f.pages[0]), '-l', String(f.pages[0]), `${OUT}/4-three-${k}.pdf`, '-']).toString().split('\n')
      .some(l => new RegExp(`Photo ${f.n}\\b.*Photo ${f.n + 1}\\b.*Photo ${f.n + 2}\\b`).test(l))) three++;
    if (f.pages[2] > f.section) { over++; if (f.next === f.pages[2]) under++; }
  }
  check(tried >= 15 && alone === 0, `over ${tried} page positions, the third photo never went over by itself (${alone} times)`);
  check(three > 0, `and where it would have, the three sit in one row (${three} of ${tried})`);

  // Four photos: when they run over, Recommendations starts under them.
  await p.evaluate(() => { reportData.photosBySection['cond-timberSoil'] = []; });
  await addPhotos('cond-timberSoil', 4, 'Sleeper');
  for (let k = 0; k <= 16; k += 2) {
    await pushDown(k);
    pdf = await report('4-four-' + k);
    const f = fell(pdf, 4); if (!f) continue;
    if (f.pages[3] > f.section) { over++; if (f.next === f.pages[3]) under++; }
  }
  check(over > 0 && under === over, `when a section's photos go over to another page, the next section starts under them (${under} of ${over})`);

  // ── 5. File names ──
  await p.evaluate(() => { reportData.photosBySection['cond-timberSoil'] = []; reportData.timberSoilDetails = ''; recordReportSent(reportFingerprint(), 1); saveCurrentReport(true); });
  pdf = await report('5-report');
  check(/^Timber_Pest_Report_9_Banksia_Drive_Epping_NSW_2121_\d{1,2}_[A-Z][a-z]{2}_\d{4}\.pdf$/.test(pdf.fname) && !/SAYON/.test(pdf.fname), 'the report is named for what it is, the address, then the day: ' + pdf.fname);
  const agreementName = await p.evaluate(() => buildAgreementPdf(reportData.agreement).fname);
  await p.evaluate(() => openQuoteFromReport()); await p.waitForTimeout(1500);
  const quoteName = await p.evaluate(() => buildQuotePDF(quoteState).fname);
  check(agreementName === 'Agreement_9_Banksia_Drive_Epping_NSW_2121.pdf' && /^Quote_Q-[\w-]+_9_Banksia_Drive_Epping_NSW_2121\.pdf$/.test(quoteName), `the agreement and the quote the same way: ${agreementName}, ${quoteName}`);

  // ── 7. The signed quote ──
  // The quote went with a link, and the client accepted from it.
  await p.evaluate(SIG => {
    quoteState.sentAt = Date.now() - 864e5; quoteState.sentHash = quoteContentHash(quoteState);
    quoteState.linkRequest = { id: 'link-1', hash: quoteState.sentHash, at: Date.now() - 864e5 };
    persistQuote();
    applyQuoteLinkRow(quoteState, { status: 'signed', signer_name: 'Sam Taylor', signature: SIG, signed_at: new Date().toISOString(), note: '' });
    closeQuote(); tabGo('job');
  }, SIG);
  await p.waitForTimeout(900);
  const next = () => p.evaluate(() => { const c = document.querySelector('#jobPageBody .job-next'); const t = s => { const el = c && c.querySelector(s); return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; };
    return { title: t('.dash-next-title'), hint: t('.dash-next-hint'), main: t('.dash-detail-primary'), links: c ? [...c.querySelectorAll('.dash-detail-links button')].map(x => x.textContent.trim()) : [],
      card: dashboardJob(getSavedReports().find(r => r.id === currentReportId), getSavedQuotes()).status, copy: (document.querySelector('#jobPageBody .quote-answer-copy') || {}).textContent || '' }; });
  let n = await next(); console.log('accepted from the link:', JSON.stringify(n));
  check(n.title === 'Email the signed quote' && n.main === 'Email Sam the signed quote' && n.card === n.title, 'after an acceptance from the link, the next step is the signed copy, on This job and the Jobs card: ' + n.main);
  check(/Sam Taylor accepted the quote from the link\. Email Sam the signed copy to keep\./.test(n.hint) && n.links.includes('Sam already has a copy'), 'it says why, and there is a way to say they already have it: ' + n.links.join(', '));
  await shot('7-signed-quote-next');
  const before = emails.length;
  await p.click('#jobPageBody .job-next .job-signed-email'); await p.waitForTimeout(2500);
  const mail = emails[before];
  check(!!mail && mail.to === 'sam@example.com' && /^Your signed quote Q-/.test(mail.subject) && (mail.attachments || []).length === 1 && mail.attachments[0].filename === quoteName && /signed copy of the quote for 9 Banksia Drive/.test(mail.text),
    'the button emails the quote with their acceptance on it: ' + (mail ? `${mail.subject} [${mail.attachments[0].filename}]` : 'no email'));
  if (mail) { fs.writeFileSync(`${OUT}/7-signed-quote.pdf`, Buffer.from(mail.attachments[0].content, 'base64')); const t = execFileSync('pdftotext', ['-layout', `${OUT}/7-signed-quote.pdf`, '-']).toString().replace(/\s+/g, ' '); check(/Sam Taylor/.test(t) && /accept/i.test(t), 'and the PDF carries the acceptance'); }
  n = await next(); console.log('copy sent:', JSON.stringify(n));
  check(n.title === 'Record the treatment' && /^Signed copy emailed \d+ \w+/.test(n.copy) && /Email it again/.test(n.copy), 'then the treatment is next, and the answer says the copy went: ' + n.copy);
  // An answer taken by phone has nothing signed to send back.
  await p.evaluate(() => { quoteState.answer = { status: 'accepted', by: 'Sam Taylor', date: todayIsoDate(), method: 'phone', note: '', at: Date.now(), hash: quoteContentHash(quoteState) }; storeSentQuote(quoteState); refreshJobsList(); });
  n = await next();
  check(n.title === 'Record the treatment' && !n.copy, 'an answer taken by phone asks for no signed copy');
  // Signed on this phone: owed the same, and "already has a copy" settles it.
  await p.evaluate(SIG => { quoteState.answer = { status: 'accepted', by: 'Sam Taylor', date: todayIsoDate(), method: 'signed', signature: SIG, note: '', at: Date.now(), hash: quoteContentHash(quoteState) }; storeSentQuote(quoteState); refreshJobsList(); }, SIG);
  n = await next();
  check(n.title === 'Email the signed quote' && /^Sam Taylor accepted the quote\. /.test(n.hint), 'a quote signed on this phone is owed its copy too');
  await p.locator('#jobPageBody .job-next .dash-detail-links button', { hasText: 'already has a copy' }).click(); await p.waitForTimeout(700);
  n = await next();
  check(n.title === 'Record the treatment' && /^Sam has a signed copy/.test(n.copy), '"Sam already has a copy" moves on to the treatment: ' + n.copy);
  const sign = fs.readFileSync(path.join(ROOT, 'sign.html'), 'utf8');
  check((sign.match(/A signed copy comes to you by email\./g) || []).length === 2, 'the client\'s page says a signed copy is coming, after accepting and when the link is opened again');

  // ── 6. The job file ──
  const job = await makePdf(`const r = await buildJobPdf(); return { b64: await toB64(r.blob), fname: r.fname };`, '6-job-file');
  check(job.fname === 'Job_File_9_Banksia_Drive_Epping_NSW_2121.pdf', 'the job file is named the same way: ' + job.fname);
  const rep = await report('6-report');
  const signedBlocks = job.pages.filter(t => /AGREED AND SIGNED/.test(t)).length;
  const standalone = job.pages.filter(t => /Pre-Inspection Agreement\s+·\s+Example Pest Co/.test(t)).length;
  check(signedBlocks === 1 && standalone === 0 && job.pages.length === 1 + rep.pages.length + job.pages.filter(t => /Quote Q-[\w-]+\s+·\s+Example Pest Co/.test(t)).length,
    `the agreement is in the file once, at the back of the report (${job.pages.length} pages: contents, ${rep.pages.length} of report, then the quote)`);
  const row = job.pages[0].match(/Pre-inspection agreement\s+Page (\d+)\s+Signed by Sam Taylor[^.]*\. At the back of the report/);
  check(!!row && /APPENDIX: PRE-INSPECTION AGREEMENT/.test(job.pages[+row[1] - 1] || ''), 'its line on the contents points to that page: ' + (row ? 'Page ' + row[1] : job.pages[0].slice(0, 300)));
  const quoteRow = job.pages[0].match(/Quote Q-[\w-]+\s+Page (\d+)/);
  const stamped = job.pages.map((t, i) => i === 0 || new RegExp(`Job file page ${i + 1}\\b`).test(t));
  check(stamped.every(Boolean) && !/Job file page 1\b/.test(job.pages[0]), 'every page after the contents says which page of the job file it is: ' + stamped.filter(Boolean).length + ' of ' + job.pages.length);
  check(!!quoteRow && new RegExp(`Job file page ${quoteRow[1]}\\b`).test(job.pages[+quoteRow[1] - 1]) && /Quote/.test(job.pages[+quoteRow[1] - 1]) && /Page 1 of/.test(job.pages[+quoteRow[1] - 1]), 'so "Quote, Page N" on the contents is the page that says N, and it is the quote\'s first');

  // ── 8. The public pages ──
  const privacy = fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8'), terms = fs.readFileSync(path.join(ROOT, 'terms.html'), 'utf8'), site = fs.readFileSync(path.join(ROOT, 'site/index.html'), 'utf8');
  const legal = await p.evaluate(() => LEGAL_VERSIONS);
  const ver = html => +((html.match(/class="updated">[^<]*Version (\d+)/) || [])[1]);
  check(ver(privacy) === legal.privacy && ver(terms) === legal.terms, `sign-up records the versions the pages carry: privacy ${ver(privacy)} and ${legal.privacy}, terms ${ver(terms)} and ${legal.terms}`);
  check(!/Analyse/.test(privacy) && /taps Describe or Insect ID on a photo/.test(privacy), 'the privacy policy names the photo buttons as the app does');
  check(/bank account details and PayID the business prints on its invoices/.test(privacy) && !/knowingly collect health information, bank account details/.test(privacy) && /certificates and invoices to the client/.test(privacy), 'the privacy policy says an invoice keeps the business\'s bank details and goes by email');
  check(/goes into the business's own Stripe account, not through us/.test(privacy) && /the invoice number, the property address and the amount/.test(privacy), 'the privacy policy says where a card payment goes and what Stripe is sent');
  check(/A photo goes to it too/.test(site) && !/download every report and quote/.test(site) && !/tap your initials/.test(site), 'the website says photos go to the AI too, what Download gives, and where Billing is');

  // The samples are files, made by docs/handover/samples/make-site-samples.js.
  // They drift when a PDF changes and nobody remakes them.
  const sampleText = execFileSync('pdftotext', ['-layout', path.join(ROOT, 'samples/sample-report.pdf'), '-']).toString().replace(/\s+/g, ' ');
  const metres = (fs.readFileSync(path.join(ROOT, 'js/app/pdf.js'), 'utf8').match(/within (\d+) metres of the main building/) || [])[1];
  check(!!metres && sampleText.includes(`within ${metres} metres of the main building`) && /Prepared with reference to AS 4349\.3/.test(sampleText), `the website's sample report says what a report made today says (within ${metres} metres, the standard on the cover)`);
  check(!/not recorded|not answered|pending assessment/i.test(sampleText), 'and it is a finished report: no blanks');

  check(!dialogs.length, 'the browser\'s grey box was never used: ' + dialogs.join(' | '));
  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
