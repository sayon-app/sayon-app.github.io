// One ending for a job: Finalise, on This job.
//   1. This job counts only the steps the job has, each step says what it's
//      waiting on, and the dock shows the same count;
//   2. Finalise isn't offered until the job's steps are done and the client
//      has the report as it stands;
//   3. after the report has gone, the Finish step is one button back to the
//      job, with sending again as a quiet link;
//   4. Finalise locks the job and makes its PDF. If the PDF doesn't go, the
//      job isn't locked;
//   5. a locked job says so in one line on the report, and Amend is on This
//      job; an amendment has to be sent before it can be finalised again;
//   6. a report that changed after it was sent reads so, and saving a PDF
//      for the records doesn't count as a change;
//   7. a declined job counts "5 of 5", and a missing agreement on a report
//      that has gone is a quiet line, not the next step.
// node e2e.js <outDir>   (serve the repo on :8765 first; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/one-ending'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf', uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const scenarios = require('../visual/scenarios.js');
const clean = scenarios.find(s => s.name === 'clean'), standard = scenarios.find(s => s.name === 'standard');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
const emails = []; let failEmail = false;
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => {
    const u = r.request().url(); let body = {}; try { body = r.request().postDataJSON() || {}; } catch (e) {}
    if (u.includes('/send-email')) {
      if (body.check) return r.fulfill({ json: { configured: true } });
      if (failEmail) return r.fulfill({ status: 500, json: { error: 'down' } });
      emails.push(body); return r.fulfill({ json: { ok: true } });
    }
    return r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } });
  });
  await ctx.route(/supabase\.co/, r => {
    const u = r.request().url();
    if (u.includes('businesses?owner_id')) return r.fulfill({ json: [{ id: 'b1', name: clean.company.name, owner_id: uid, settings: {} }] });
    return r.fulfill({ json: [] });
  });
  await ctx.addInitScript(s => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1', '1'); localStorage.setItem('korva_onboarded_v1:' + s.user.id, '1'); }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  const shot = async name => { await p.waitForTimeout(350); await p.screenshot({ path: `${OUT}/${name}.png` }); };
  const toast = () => p.evaluate(() => { const t = document.getElementById('toast'); return t.classList.contains('show') ? t.innerText.replace(/\s+/g, ' ').trim() : ''; });
  // This job as it reads on screen.
  const job = async () => { await p.waitForTimeout(700); return p.evaluate(() => {
    const body = document.getElementById('jobPageBody'), q = s => body.querySelector(s), text = s => { const el = q(s); return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; };
    const pdf = q('.job-pdf'), ring = document.getElementById('tabReportRing');
    return { open: document.getElementById('jobOverlay').classList.contains('open'), count: text('.job-hero-count'), chip: text('.job-hero .dash-detail-chip'), label: text('.job-next .dash-next-label'), title: text('.job-next .dash-next-title'), hint: text('.job-next .dash-next-hint'),
      nextButtons: [...body.querySelectorAll('.job-next button')].map(x => x.textContent.replace(/\s+/g, ' ').trim()), finaliseMain: text('.job-next .dash-detail-primary'),
      inIt: body.querySelectorAll('.job-next .job-pdf-list li').length, inItOpen: !!q('.job-next details.job-pdf-more[open]'),
      steps: [...body.querySelectorAll('.job-steps > li')].map(li => `${(li.querySelector('.job-step-label') || {}).firstChild ? li.querySelector('.job-step-label').firstChild.textContent.trim() : ''}: ${(li.querySelector('.job-step-text') || {}).textContent || ''}`),
      flags: [...body.querySelectorAll('.job-step-flag')].map(f => f.closest('.job-step-label').firstChild.textContent.trim()),
      bars: body.querySelectorAll('.job-progress i').length, skipped: [...body.querySelectorAll('.job-skipped p')].map(x => x.textContent.replace(/\s+/g, ' ').trim()),
      card: pdf && { label: pdf.querySelector('.job-step-label').textContent, line: pdf.querySelector('.job-step-text').textContent, made: pdf.classList.contains('made'), amending: pdf.classList.contains('amending'),
        buttons: [...pdf.querySelectorAll('.dash-detail-links button')].map(x => x.textContent.trim()), form: !!pdf.querySelector('#issueAmendForm') && !pdf.querySelector('#issueAmendForm').hidden, inIt: pdf.querySelectorAll('.job-pdf-list li').length },
      dock: ring.classList.contains('empty') ? '' : ring.classList.contains('done') ? 'tick' : ring.querySelector('.tab-progress-pct').textContent, dockLabel: ring.closest('.tab').getAttribute('aria-label'),
      saveButton: !!document.querySelector('#jobPanel .job-actions, #jobPanel .job-action-btn'), syncLine: !!document.querySelector('#jobPanel #jobSyncStatus, #jobPanel .sync-status'), newInBar: !!document.querySelector('#jobOverlay .topbar-new') };
  }); };
  const newJob = (sc, opts = {}) => p.evaluate(async ({ sc, opts, SIG }) => {
    if (document.getElementById('quoteScreen').classList.contains('open')) closeQuote();
    openApp('inspect'); resetReportState(); startBlankReport();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    for (const [k, v] of Object.entries(sc.job)) set(k, v);
    if (opts.address) set('jobAddress', opts.address);
    set('jobClientEmail', opts.email === undefined ? 'jo@example.com' : opts.email); saveJobInfo(); updateJob();
    if (opts.agreement !== false) {
      const v = agreementFormValues();
      reportData.agreement = { method: 'onsite', signerName: sc.job.jobClient, signature: SIG, signedAt: Date.now() - 3600e3, inspectionDate: v.inspectionDate, fee: '350', notes: '', standard: v.standard, text: v.text };
      renderAgreementBanner();
    }
    if (opts.fill) {
      await populateFields(sc.fields);
      Object.values(REQUIRED_FIELDS).flat().filter(k => !isFieldFilled(k) && document.getElementById('f-' + k)).forEach(k => { reportData[k] = 'NO'; });
      reportData.inspectorSignature = SIG; reportData.inspectorLicence = sc.company.licence;
      markRemainingAreasInspected('INSPECTED'); markRemainingAreasClear();
    }
    updateProgress(); saveCurrentReport(true);
  }, { sc, opts, SIG });

  await p.evaluate(sc => { storeCompanyDetails(sc.company); directEmail = true; }, clean);

  // ── 1. The steps the job has, and what each is waiting on ──
  await newJob(clean); await p.waitForTimeout(600);
  await p.evaluate(() => tabGo('job'));
  let j = await job();
  console.log('report under way:', JSON.stringify(j));
  check(j.title === 'Finish the report' && j.hint === 'Fill in the rest of the report, then tick Report done on its last step.', 'an unfinished report\'s next step says how the report ends now: ' + j.hint);
  check(j.steps.some(s => s === 'Quote: Not written yet') && j.steps.some(s => s === 'Client\'s answer: Once the quote is sent') && j.steps.some(s => s === 'Treatment: Once Jo accepts'), 'steps still to come say what they\'re waiting on: ' + j.steps.slice(3).join(' | '));
  check(!j.steps.some(s => /Not completed/.test(s)), 'no step reads "Not completed"');
  check(j.count === '2 of 6 done' && j.bars === 6 && j.dock === '2/6' && j.dockLabel === 'This job, 2 of 6 steps done', `the dock shows the job's steps, the same count as its page: ${j.count}, dock ${j.dock}`);
  check(!j.saveButton, 'Job details has no Save job button on a saved job');
  check(!j.newInBar, 'This job\'s top bar has no New job');
  check(!j.card && !j.nextButtons.some(t => /Finalise/.test(t)), 'no Finalise while the report is still being written');
  await shot('1-report-under-way');

  // ── 2. Report ready, not sent: sending it is the next step ──
  await newJob(clean, { fill: true }); await p.waitForTimeout(900);
  await p.evaluate(() => tabGo('job'));
  j = await job();
  console.log('report ready:', JSON.stringify(j));
  check(j.title === 'Send the report' && !j.card && !j.nextButtons.some(t => /Finalise/.test(t)), 'a report that hasn\'t gone is the next step, not Finalise: ' + j.title);
  check(j.count === '2 of 3 done' && j.bars === 3 && j.dock === '2/3', `a job with no quote counts three steps: ${j.count}, dock ${j.dock}`);
  check(j.skipped.length === 1 && /^No quote needed: the report didn't recommend treatment\. Write one anyway$/.test(j.skipped[0]), 'the quote it doesn\'t need is one quiet line: ' + j.skipped[0]);
  check(j.steps.length === 3 && !j.steps.some(s => /^(Quote|Treatment|Client)/.test(s)), 'and its steps aren\'t listed: ' + j.steps.map(s => s.split(':')[0]).join(', '));
  check(await p.evaluate(() => dashboardJob(getSavedReports().find(r => r.id === currentReportId), getSavedQuotes()).status) === j.title, 'the Jobs card reads the same next step');
  await shot('2-report-ready');

  // ── 3. The Finish step once the report has gone ──
  await p.evaluate(() => { jobGo('report'); goStep('finish'); setReportDone(true); }); await p.waitForTimeout(500);
  await p.click('#shareBtn'); await p.waitForTimeout(1500);
  await p.click('#sendReviewBtn');
  await p.waitForFunction(() => reportData.sent, null, { timeout: 60000 }); await p.waitForTimeout(800);
  const fin = () => p.evaluate(() => {
    const shown = id => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0; };
    return { when: document.getElementById('finishDoneWhen').textContent, undo: shown('finishDoneUndo'), label: shown('finishNextLabel'), share: shown('shareBtn'), shareTitle: document.getElementById('shareTitle').textContent, sharePrimary: document.getElementById('shareBtn').classList.contains('primary'),
      quote: shown('finishQuoteBtn'), back: shown('finishJobBtn'), backPrimary: document.getElementById('finishJobBtn').classList.contains('primary'), resend: shown('finishResend'), resendText: document.getElementById('finishResend').textContent };
  });
  let f = await fin();
  console.log('finish, sent:', JSON.stringify(f));
  check(emails.length === 1 && /^Sent today$/.test(f.when), 'the report went, and Finish says so: ' + f.when);
  check(!f.undo, '"Keep working on it" is gone once the report has gone');
  check(f.back && f.backPrimary && !f.label && !f.share && !f.quote, 'the one button is Back to the job, with no "Next" label over it');
  check(f.resend && f.resendText === 'Send it again', 'sending again is a quiet link');
  await p.evaluate(() => document.getElementById('finishNext').scrollIntoView({ block: 'center' })); await shot('3-finish-sent');

  // ── 4. Finalise ──
  await p.click('#finishJobBtn');
  j = await job();
  console.log('ready to finalise:', JSON.stringify(j));
  check(j.open && j.label === 'Next step' && j.title === 'Finalise the job', 'Back to the job lands on its next step: ' + j.title);
  check(/^Everything's done\. Finalising locks the report and quote, so they match what Jo received, and puts every document from the job into one PDF\.$/.test(j.hint), 'it says what finalising does: ' + j.hint);
  check(j.finaliseMain === 'Finalise and email to Jo' && j.nextButtons.includes('Finalise and save the PDF') && j.nextButtons.length === 2, 'Email and Save are on the next step, once: ' + j.nextButtons.join(' | '));
  check(j.inIt === 2 && !j.inItOpen && !j.card, 'what goes in is folded away, and there is no second card');
  check(j.count === '3 of 3 done' && j.dock === 'tick' && j.dockLabel === 'This job, every step done', 'every step done: ' + j.count);
  await shot('4-finalise-next');
  // The email fails: the job isn't locked.
  failEmail = true;
  await p.locator('.job-next .dash-detail-primary').click(); await p.waitForTimeout(500);
  await p.waitForFunction(() => !jobPdfBusy, null, { timeout: 60000 }); await p.waitForTimeout(600);
  let st = await p.evaluate(() => ({ issue: !!reportData.issue, history: (reportData.issueHistory || []).length, at: reportData.jobPdfAt || null, locked: document.body.classList.contains('report-locked'),
    saved: !!(getSavedReports().find(r => r.id === currentReportId).reportData || {}).issue }));
  j = await job();
  check(!st.issue && !st.history && !st.at && !st.locked && !st.saved && j.title === 'Finalise the job' && !j.card, 'when the job PDF doesn\'t go, the job isn\'t locked and Finalise is still the next step');
  check(/Tap again to send it from your email app/.test(await toast()), 'and the note left up is why it didn\'t go: ' + await toast());
  failEmail = false; await p.evaluate(() => { directEmail = true; });
  await p.locator('.job-next .dash-detail-primary').click();
  await p.waitForFunction(() => reportData.jobPdfSentAt && !jobPdfBusy, null, { timeout: 60000 }); await p.waitForTimeout(400);
  const said = await toast();
  st = await p.evaluate(() => ({ v: reportData.issue && reportData.issue.version, history: (reportData.issueHistory || []).length, at: !!reportData.jobPdfAt, locked: document.body.classList.contains('report-locked'),
    group: dashboardJob(getSavedReports().find(r => r.id === currentReportId), getSavedQuotes()).group }));
  j = await job();
  console.log('finalised:', JSON.stringify(j), said);
  check(st.v === 1 && st.history === 1 && st.at && st.locked && emails.length === 2 && /^Job_File_/.test(emails[1].attachments[0].filename), 'Finalise locked the job as version 1 and emailed the job PDF');
  check(/Job finalised\. The report and quote are locked/.test(said), 'and says so: ' + said);
  check(j.card && j.card.label === 'Job finalised' && j.card.made && /^Version 1, \d+ \w+ \d{4}\. Job PDF emailed to Jo Lee \d+ \w+ \d{4}\.$/.test(j.card.line), 'the last card is the record: ' + (j.card && j.card.line));
  check(j.card && j.card.buttons.join('|') === 'Email again|Save PDF|Amend' && !j.card.form, 'with the PDF again, and Amend: ' + (j.card && j.card.buttons.join(' | ')));
  check(j.label === 'Where it\'s at' && !j.nextButtons.length && st.group === 'done', 'nothing is next, and the job is under Done');
  check(j.skipped.join() === 'No quote needed: the report didn\'t recommend treatment.', 'the quiet line is the record now, with nothing to tap: ' + j.skipped.join());
  await p.evaluate(() => document.querySelector('#jobOverlay .job-pdf').scrollIntoView({ block: 'center' })); await shot('5-finalised');

  // ── 5. The locked report, and Amend ──
  await p.evaluate(() => { jobGo('report'); goStep('property'); }); await p.waitForTimeout(600);
  const top = await p.evaluate(() => { const el = document.getElementById('issueBanner'); return { shown: !el.hidden && el.getBoundingClientRect().height > 0, h: el.getBoundingClientRect().height, text: el.innerText.replace(/\s+/g, ' ').trim(), buttons: [...el.querySelectorAll('button')].map(x => x.textContent.trim()) }; });
  console.log('report top:', JSON.stringify(top));
  check(top.shown && /^Job finalised \d+ \w+ \d{4} · version 1\. Locked, so it matches what the client received\. Amend$/.test(top.text) && top.buttons.join('|') === 'Amend', 'the top of a locked report is one line with Amend: ' + top.text);
  check(top.h < 90 && !/Before the job can be completed|No quote yet|Complete job/.test(top.text), `and nothing else of the job's progress (${Math.round(top.h)}px)`);
  check(await p.evaluate(() => document.getElementById('progressRingLabel').textContent === 'Finalised' && document.getElementById('lastVisitBanner').hidden), 'its corner reads Finalised, and it isn\'t offered a start from the last visit');
  await shot('6-locked-report');
  await p.locator('#section-property .field-value, #section-property .choice-card, #section-property select').first().click({ force: true }).catch(() => {}); await p.waitForTimeout(400);
  const lockSaid = await toast();
  check(/^This job is finalised and locked\. Amend it from This job/.test(lockSaid), 'tapping a locked answer says where Amend is: ' + lockSaid);
  await p.evaluate(() => goStep('finish')); await p.waitForTimeout(300);
  f = await fin();
  check(f.when === 'Job finalised and locked' && f.back && !f.undo && !f.label, 'Finish on a locked job: ' + f.when);
  await p.locator('#issueBanner button', { hasText: 'Amend' }).click();
  j = await job();
  check(j.open && j.card && j.card.form && await p.evaluate(() => document.activeElement && document.activeElement.id) === 'issueAmendReason', 'Amend on the report opens the reason on This job');
  await shot('7-amend-form');
  await p.locator('#issueAmendForm button', { hasText: /^Unlock for version 2$/ }).click(); await p.waitForTimeout(300);
  check(/Say why/.test(await toast()) && await p.evaluate(() => !reportData.amending), 'it won\'t unlock without a reason');
  await p.fill('#issueAmendReason', 'Client asked for the garage to be added');
  await p.locator('#issueAmendForm button', { hasText: /^Unlock for version 2$/ }).click();
  j = await job();
  console.log('amending:', JSON.stringify(j));
  check(j.card && j.card.amending && j.card.label === 'Amending to version 2' && /^Client asked for the garage to be added\. Version 1 was finalised /.test(j.card.line) && j.card.buttons.join('|') === 'Cancel amendment', 'the card says it\'s being amended and why: ' + (j.card && j.card.line));
  check(j.title === 'Finalise version 2' && await p.evaluate(() => !document.body.classList.contains('report-locked')), 'the job is unlocked, and with nothing changed the next step is to finalise it again');
  // Nothing changed yet: it can be called off.
  await p.locator('.job-pdf button', { hasText: 'Cancel amendment' }).click();
  j = await job();
  check(await p.evaluate(() => !reportData.amending && isReportLocked()) && j.card && j.card.label === 'Job finalised', 'Cancel amendment locks it again while nothing has changed');
  await p.evaluate(() => { openAmendForm(); document.getElementById('issueAmendReason').value = 'Client asked for the garage to be added'; startAmendment(); }); await p.waitForTimeout(300);
  // A change: the amended report has to go before version 2.
  await p.evaluate(() => { jobGo('report'); reportData.weatherConditions = 'Light rain'; renderField(document.getElementById('f-weatherConditions'), 'weatherConditions', reportData.weatherConditions); updateProgress(); saveCurrentReport(true); goStep('finish'); }); await p.waitForTimeout(500);
  const amendTop = await p.evaluate(() => document.getElementById('issueBanner').innerText.replace(/\s+/g, ' ').trim());
  check(/^Amending to version 2 · Client asked for the garage to be added/.test(amendTop), 'the top of the report says it\'s being amended: ' + amendTop);
  f = await fin();
  console.log('finish, amended:', JSON.stringify(f));
  check(/^Changed since it was sent/.test(f.when) && f.share && f.sharePrimary && f.shareTitle === 'Send it again' && !f.back, 'Finish says it changed, and Send it again is the button: ' + f.when);
  await p.evaluate(() => tabGo('job'));
  j = await job();
  check(j.title === 'Send the report again' && /^The amended report hasn't gone to Jo Lee\. Send it, then finalise the new version\.$/.test(j.hint) && !j.nextButtons.some(t => /Finalise/.test(t)), 'This job: send the amended report first: ' + j.hint);
  check(j.steps.some(s => s === 'Report: Amended, not sent yet') && j.flags.join() === 'Report', 'its Report step says so: ' + j.steps.find(s => /^Report/.test(s)));
  await p.locator('.job-pdf button', { hasText: 'Cancel amendment' }).click(); await p.waitForTimeout(300);
  check(/Changes have been made/.test(await toast()) && await p.evaluate(() => !!reportData.amending), 'an amendment with changes can\'t be called off');
  await shot('8-amended-not-sent');
  await p.evaluate(() => { jobGo('report'); goStep('finish'); }); await p.waitForTimeout(300);
  await p.click('#shareBtn'); await p.waitForTimeout(1500);
  await p.click('#sendReviewBtn');
  await p.waitForFunction(n => reportData.sent && reportData.sent.version === 2 && !document.getElementById('sendReviewOverlay').classList.contains('open'), null, { timeout: 60000 }); await p.waitForTimeout(800);
  await p.evaluate(() => tabGo('job'));
  j = await job();
  check(j.title === 'Finalise version 2' && j.finaliseMain === 'Finalise and email to Jo' && /locks the report and quote as version 2/.test(j.hint), 'once it has gone, the next step is Finalise version 2: ' + j.hint);
  await p.locator('.job-next button', { hasText: 'Finalise and save the PDF' }).click();
  await p.waitForFunction(() => reportData.issue && reportData.issue.version === 2 && !jobPdfBusy, null, { timeout: 60000 }); await p.waitForTimeout(500);
  const hist = await p.evaluate(() => reportData.issueHistory.map(h => ({ v: h.version, reason: h.reason || '', changed: h.changed || [] })));
  j = await job();
  console.log('version 2:', JSON.stringify(hist), JSON.stringify(j.card));
  check(hist.length === 2 && hist[1].v === 2 && hist[1].reason === 'Client asked for the garage to be added' && hist[1].changed.join() === 'Property', 'version 2 keeps the reason and what changed: ' + JSON.stringify(hist[1]));
  check(j.card && j.card.label === 'Job finalised' && /^Version 2, /.test(j.card.line), 'and the card reads version 2: ' + (j.card && j.card.line));

  // ── 6. Changed after it was sent ──
  await newJob(standard, { fill: true, address: '9 Banksia Drive' }); await p.waitForTimeout(900);
  await p.evaluate(() => { recordReportSent(reportFingerprint(), 1); setClientNotGoingAhead(true); }); await p.waitForTimeout(500);
  await p.evaluate(() => tabGo('job'));
  j = await job();
  console.log('sent, not going ahead:', JSON.stringify(j));
  check(j.title === 'Finalise the job' && j.skipped.some(l => /^No quote: the client isn't going ahead\. Write a quote after all$/.test(l)) && j.count === '3 of 3 done', 'a client who isn\'t going ahead: the quote is a quiet line and the job can be finalised');
  // A PDF saved for the records isn't a change.
  await p.evaluate(() => { reportData.pdfAt = Date.now(); reportData.quoteSpoken = { items: [], exclusions: [] }; saveCurrentReport(true); renderJobPage(); });
  j = await job();
  check(j.title === 'Finalise the job', 'saving a PDF for the records doesn\'t read as a change');
  await p.evaluate(() => { reportData.riskLevel = 'MODERATE'; saveCurrentReport(true); renderJobPage(); });
  j = await job();
  const card = await p.evaluate(() => { const x = dashboardJob(getSavedReports().find(r => r.id === currentReportId), getSavedQuotes()); return { status: x.status, group: x.group }; });
  console.log('changed after sending:', JSON.stringify(j), JSON.stringify(card));
  check(j.title === 'Send the report again' && /^The report changed after it went to Sam Taylor\. Send it again so they have it as it is now\.$/.test(j.hint) && !j.nextButtons.some(t => /Finalise/.test(t)), 'a report changed after it went has to go again before Finalise: ' + j.hint);
  check(j.steps.some(s => s === 'Report: Changed since it was sent') && card.status === 'Send the report again' && card.group === 'todo', 'the step and the Jobs card say the same');
  await shot('9-changed-since-sent');
  await p.evaluate(() => { reportData.riskLevel = 'HIGH'; saveCurrentReport(true); renderJobPage(); });
  j = await job();
  check(j.title === 'Finalise the job', 'put back as it was sent, it\'s ready to finalise again');

  // ── 7. A declined job, and a missing agreement ──
  await newJob(standard, { fill: true, address: '11 Banksia Drive', agreement: false }); await p.waitForTimeout(900);
  await p.evaluate(() => tabGo('job'));
  j = await job();
  check(j.title === 'Get the agreement signed', 'before the report has gone, a missing agreement is the next step: ' + j.title);
  await p.evaluate(() => { recordReportSent(reportFingerprint(), 1); openQuoteFromReport(); }); await p.waitForTimeout(1500);
  await p.evaluate(() => {
    quoteState.sentAt = Date.now() - 3 * 864e5; quoteState.sentHash = quoteContentHash(quoteState);
    persistQuote(); closeQuote(); tabGo('job');
  });
  j = await job();
  console.log('quote out, no agreement:', JSON.stringify(j));
  check(j.steps.some(s => /^Client's answer: Waiting on Sam since \d+ \w+$/.test(s)) && j.flags.join() === 'Client\'s answer', 'a quote that\'s out says who it\'s waiting on and since when: ' + j.steps.find(s => /^Client/.test(s)));
  check(j.title !== 'Get the agreement signed' && j.skipped.some(l => /^No agreement on file\. Add one signed on paper$/.test(l)) && !j.steps.some(s => /^Agreement/.test(s)), 'once the report has gone, a missing agreement is a quiet line: ' + j.skipped.join(' | '));
  check(j.count === '3 of 5 done' && j.bars === 5, 'and it isn\'t counted: ' + j.count);
  await p.evaluate(() => openQuoteFromReport()); await p.waitForTimeout(1200);
  await p.evaluate(() => {
    quoteState.answer = { status: 'declined', by: 'Sam Taylor', date: todayIsoDate(), method: 'verbal', note: '', at: Date.now(), hash: quoteContentHash(quoteState) };
    persistQuote(); closeQuote(); tabGo('job');
  });
  j = await job();
  console.log('declined:', JSON.stringify(j));
  check(j.count === '4 of 4 done' && j.bars === 4 && j.skipped.some(l => l === 'No treatment: Sam declined the quote.') && !j.steps.some(s => /^Treatment/.test(s)), 'a declined job counts only its own steps: ' + j.count + ' · ' + j.skipped.join(' | '));
  check(j.title === 'Finalise the job' && j.chip === 'Done', 'and it can be finalised: ' + j.title);
  await shot('10-declined');
  await p.locator('.job-skipped button', { hasText: 'Add one signed on paper' }).click(); await p.waitForTimeout(700);
  check(await p.evaluate(() => document.getElementById('agreementOverlay').classList.contains('open')), 'the quiet line opens the agreement');

  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
  process.exit(fails.length ? 1 : 0);
})();
