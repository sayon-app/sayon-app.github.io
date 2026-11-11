// Re-inspections due: the Jobs screen's Due tab lists each property whose
// next inspection is coming up (within 30 days) or overdue, offers an email
// to the client to book it, and books it in (a new job at the address). A
// pre-purchase job says to check the client bought the house, and what was
// done about a reminder goes to the account with the business's settings.
// node e2e.js <outDir>  (serve the repo on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/reinspection'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
const emails = [], patches = [];
let shotN = 0;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.route(/cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)|sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  let textOnly = true;
  await ctx.route(/workers\.dev/, async r => {
    const u = r.request().url(); let body = {}; try { body = r.request().postDataJSON() || {}; } catch (e) {}
    if (u.includes('/send-email')) { if (body.check) return r.fulfill({ json: { configured: true, textOnly } }); emails.push(body); return r.fulfill({ json: { ok: true } }); }
    return r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } });
  });
  await ctx.route(/supabase\.co/, r => {
    const u = r.request().url();
    if (u.includes('businesses?owner_id')) return r.fulfill({ json: [{ id: 'b1', name: 'Example Pest Co', owner_id: uid, settings: {} }] });
    if (r.request().method() === 'PATCH' && u.includes('/rest/v1/businesses')) { patches.push(r.request().postDataJSON()); return r.fulfill({ status: 204, body: '' }); }
    return r.fulfill({ json: [] });
  });
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1:u-owner', '1'); localStorage.setItem('korva_onboarded_v1', '1'); }, sess);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  const shot = async (name) => { await p.waitForTimeout(350); await p.screenshot({ path: `${OUT}/${String(++shotN).padStart(2, '0')}-${name}.png` }); };
  const tap = async (loc, what) => { try { await loc.scrollIntoViewIfNeeded({ timeout: 3000 }); await loc.tap({ timeout: 5000 }); return true; } catch (e) { check(false, 'tap ' + what + ': ' + e.message.split('\n')[0]); return false; } };

  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);

  await p.evaluate(() => {
    storeCompanyDetails({ name: 'Example Pest Co', phone: '0400 000 000', email: 'office@example.com' });
    const today = todayIsoDate();
    const shift = (months, days) => { const d = new Date(addMonthsIso(today, months) + 'T00:00:00'); d.setDate(d.getDate() + (days || 0)); return isoDate(d); };
    let n = 0;
    const rep = (street, suburb, client, email, date, freq, extra) => ({
      id: 'report_' + (1000 + n++), address: `${street}, ${suburb} NSW 2000`, jobAddress: street, jobSuburb: suburb, jobState: 'NSW', jobPostcode: '2000',
      client, inspector: 'Alex Example', savedAt: Date.now() - n * 1000, completion: 100,
      reportData: { jobInspectionDate: date, jobClientEmail: email, jobClientPhone: '0400 111 222', inspectionFrequency: freq, sent: { at: Date.now() - 1000, to: email }, ...(extra || {}) },
      fieldNotes: {},
    });
    const reports = [
      rep('1 Overdue Street', 'Testville', 'Sam Taylor', 'sam@example.com', shift(-13), '12 months'),
      rep('2 Soon Road', 'Testville', 'Jo Lee', '', shift(-3, 10), '3 months, then every 12 months'),
      rep('3 Fine Avenue', 'Testville', 'Chris Ng', 'chris@example.com', shift(-2), '12 months'),
      rep('4 Draft Lane', 'Testville', 'Pat Kim', 'pat@example.com', shift(-24), '12 months', { sent: null }),
      rep('5 Again Street', 'Testville', 'Robin Day', 'robin@example.com', shift(-14), '12 months'),
      rep('5 Again St', 'Testville', 'Robin Day', 'robin@example.com', shift(0, -7), '', { sent: null }),
      rep('6 Treated Close', 'Testville', 'Lee Wu', 'lee@example.com', shift(-1), '12 months', { jobInspectionType: 'Pre-Purchase — Timber Pest' }),
      rep('7 Buyer Court', 'Testville', 'Mia Chen', 'mia@example.com', shift(-12, 20), '12 months', { jobInspectionType: 'Pre-Purchase — Timber Pest' }),
    ];
    reports[6].quote = { items: [{ desc: 'Treatment', qty: 1, price: 1000 }], treatment: { date: shift(-1), nextInspection: shift(0, 5) } };
    setSavedReports(reports);
  });

  // 1. Which properties are on the list.
  const due = await p.evaluate(() => reinspectionsDue().map(it => ({ addr: it.r.jobAddress, due: it.due, days: it.days, overdue: it.overdue, t: it.fromTreatment, pre: it.prePurchase })));
  console.log('due:', JSON.stringify(due));
  const addrs = due.map(d => d.addr);
  check(addrs[0] === '1 Overdue Street' && due[0].overdue, 'a report from 13 months ago at 12 months is overdue, and comes first');
  check(addrs.includes('2 Soon Road') && due.find(d => d.addr === '2 Soon Road').days === 10, '"3 months, then every 12 months" uses the 3 months: due in 10 days');
  check(addrs.includes('6 Treated Close') && due.find(d => d.addr === '6 Treated Close').t, 'a treatment record\'s next inspection date wins over the report interval');
  check(!addrs.includes('3 Fine Avenue'), 'a property not due for months is not listed');
  check(!addrs.includes('4 Draft Lane'), 'an unfinished report is not listed');
  check(!addrs.some(a => /Again/.test(a)), 'a property with a newer report (re-inspection started) is not listed');
  check(due.length === 4, 'four properties listed');
  check(due.find(d => d.addr === '7 Buyer Court').pre && !due.find(d => d.addr === '1 Overdue Street').pre, 'a pre-purchase job is marked as one');
  check(!due.find(d => d.addr === '6 Treated Close').pre, 'a pre-purchase client who then had it treated bought it, so isn\'t asked about');

  // 2. The Jobs screen's Due tab.
  await p.evaluate(() => openDashboard()); await p.waitForTimeout(500);
  const tabCount = await p.evaluate(() => document.querySelector('.dash-tab[data-tab="due"] span').textContent);
  check(tabCount === '4', 'the Due tab shows 4');
  await tap(p.locator('.dash-tab[data-tab="due"]'), 'Due tab'); await p.waitForTimeout(400); await shot('due-tab');
  const rows = await p.evaluate(() => [...document.querySelectorAll('#dashboardJobs .reinspect-row')].map(r => r.innerText.replace(/\n+/g, ' | ')));
  console.log('rows:', rows);
  check(rows.length === 4 && /Overdue by/.test(rows[0]) && /Due in 5 days/.test(rows[1]) && /Due in 10 days/.test(rows[2]) && /Due in 3 weeks/.test(rows[3]), 'rows say how overdue or how soon');

  // 3. One property's sheet, then the email sent straight from SAYON.
  await tap(p.locator('#dashboardJobs .reinspect-row').first(), 'overdue row'); await p.waitForTimeout(500); await shot('detail');
  const detail = await p.evaluate(() => document.getElementById('dashboardDetailSheet').innerText);
  check(/Book the re-inspection/.test(detail) && /recommended the next inspection within 12 months/.test(detail) && /Email Sam to book it/.test(detail), 'the sheet explains when it was due and offers the email');
  check(/Book it in/.test(detail) && !/Start the report/.test(detail) && !/pre-purchase/i.test(detail), 'the link that starts the new job is "Book it in", and an annual job has no pre-purchase note');
  await tap(p.locator('#dashboardDetailSheet .dash-detail-primary'), 'Email Sam'); await p.waitForTimeout(400); await shot('email'); await p.evaluate(() => { const s = document.getElementById('dashboardDetailSheet'); s.scrollTop = s.scrollHeight; }); await shot('email-bottom');
  const form = await p.evaluate(() => ({ to: document.getElementById('reinspectTo').value, subject: document.getElementById('reinspectSubject').value, body: document.getElementById('reinspectBody').value, btn: document.getElementById('reinspectSendBtn').textContent }));
  console.log('email form:', JSON.stringify(form));
  check(form.to === 'sam@example.com' && /next timber pest inspection/.test(form.subject) && /^Hi Sam,/.test(form.body) && /was due on/.test(form.body) && /0400 000 000/.test(form.body) && form.btn === 'Send', 'the email is filled in for Sam, ready to send from SAYON');
  await tap(p.locator('#reinspectSendBtn'), 'Send'); await p.waitForTimeout(800);
  check(emails.length === 1 && emails[0].to === 'sam@example.com' && Array.isArray(emails[0].attachments) && emails[0].attachments.length === 0 && /Hi Sam/.test(emails[0].text), 'the Worker got a plain email with no PDFs');
  await shot('after-send');
  const row0 = await p.evaluate(() => document.querySelector('#dashboardJobs .reinspect-row').innerText);
  check(/Reminder sent/.test(row0), 'the row now says the reminder was sent');
  // The mark goes to the account with the business's settings, so another
  // device shows it too.
  await p.waitForTimeout(2200);
  const up = patches[patches.length - 1];
  check(!!(up && up.settings && up.settings.reinspect && up.settings.reinspect.marks.report_1000 && up.settings.reinspect.marks.report_1000.sentAt), 'the reminder\'s mark is saved to the account: ' + JSON.stringify(up && up.settings && up.settings.reinspect));
  const merged = await p.evaluate(() => {
    const mine = getReinspectMarks();
    authBusiness.settings = Object.assign({}, authBusiness.settings, { reinspect: { marks: { report_1000: { sentAt: 5, to: 'old@example.com' }, report_1002: { dismissedAt: 77 } } } });
    applyCloudBusinessSettings();
    const now = getReinspectMarks();
    const out = { keptLater: now.report_1000.sentAt === mine.report_1000.sentAt && now.report_1000.to === 'sam@example.com', tookOther: now.report_1002 && now.report_1002.dismissedAt === 77 };
    // Put back, so the list below is as this phone left it.
    delete now.report_1002; storeReinspectMarks(now);
    return out;
  });
  check(merged.keptLater && merged.tookOther, 'the account\'s marks and this phone\'s are put together, the later one kept: ' + JSON.stringify(merged));

  // 3b. A pre-purchase job: the sheet says to check they bought it, and the
  // email doesn't take the purchase as read.
  await tap(p.locator('#dashboardJobs .reinspect-row', { hasText: '7 Buyer Court' }), 'pre-purchase row'); await p.waitForTimeout(400); await shot('pre-purchase');
  const pre = await p.evaluate(() => document.getElementById('dashboardDetailSheet').innerText);
  check(/This was a pre-purchase inspection\./.test(pre) && /Check Mia bought it/.test(pre), 'a pre-purchase job\'s sheet says so: ' + (pre.match(/This was[^\n]*/) || [''])[0]);
  await tap(p.locator('#dashboardDetailSheet .dash-detail-primary'), 'Email Mia'); await p.waitForTimeout(400); await shot('pre-purchase-email');
  const preBody = await p.evaluate(() => document.getElementById('reinspectBody').value);
  check(/^Hi Mia,\n\nIf you went ahead with the purchase of 7 Buyer Court, Testville NSW 2000, its next timber pest inspection is due on /.test(preBody) && /Our pre-purchase inspection there was on /.test(preBody), 'its email opens with "If you went ahead with the purchase of…": ' + preBody.split('\n')[2]);
  await p.evaluate(() => closeDashboardDetail()); await p.waitForTimeout(300);

  // 4. No email on file and an older Worker: the phone's email app, then "Did that send?".
  await p.evaluate(() => { directEmailText = false; });
  await tap(p.locator('#dashboardJobs .reinspect-row', { hasText: '2 Soon Road' }), 'Soon row'); await p.waitForTimeout(400);
  const d2 = await p.evaluate(() => document.getElementById('dashboardDetailSheet').innerText);
  check(/no email for Jo Lee/.test(d2) && /0400 111 222/.test(d2), 'with no email on file the sheet says so and gives the phone number');
  await tap(p.locator('#dashboardDetailSheet .dash-detail-primary'), 'Email Jo');
  await p.waitForTimeout(300);
  const btn2 = await p.evaluate(() => document.getElementById('reinspectSendBtn').textContent);
  check(btn2 === 'Open in my email app', 'without text-only sending it opens the email app');
  await p.fill('#reinspectTo', 'jo@example.com');
  await tap(p.locator('#reinspectSendBtn'), 'Open in my email app'); await p.waitForTimeout(500); await shot('did-it-send');
  const asked = await p.evaluate(() => ({ open: document.getElementById('didItSendOverlay').classList.contains('open'), text: document.getElementById('didItSendText').textContent }));
  check(asked.open && /reminder email/.test(asked.text), '"Did that send?" asks about the reminder: ' + asked.text);
  await tap(p.locator('#didItSendOverlay .extract-btn'), 'Yes it\'s sent'); await p.waitForTimeout(400);
  const marks = await p.evaluate(() => getReinspectMarks());
  check(Object.values(marks).filter(m => m.sentAt).length === 2, 'both reminders recorded');

  // 5. Take one off the list.
  await tap(p.locator('#dashboardJobs .reinspect-row', { hasText: '6 Treated Close' }), 'Treated row'); await p.waitForTimeout(400);
  await tap(p.locator('#dashboardDetailSheet .dash-detail-delete'), 'Take it off'); await p.waitForTimeout(400);
  check(await p.evaluate(() => document.querySelectorAll('#dashboardJobs .reinspect-row').length) === 3, 'taken off the list');
  await p.waitForTimeout(2200);
  check(!!(patches[patches.length - 1].settings.reinspect.marks.report_1006 || {}).dismissedAt, 'and that goes to the account too');

  // 6. Book it in: a new job at the same address, open on its Job details.
  await tap(p.locator('#dashboardJobs .reinspect-row', { hasText: '1 Overdue Street' }), 'overdue row'); await p.waitForTimeout(400);
  await tap(p.locator('#dashboardDetailSheet button', { hasText: 'Book it in' }), 'Book it in'); await p.waitForTimeout(800); await shot('started');
  const started = await p.evaluate(() => ({ addr: document.getElementById('jobAddress').value, client: document.getElementById('jobClient').value, email: document.getElementById('jobClientEmail').value, type: document.getElementById('jobInspectionType').value, date: document.getElementById('jobInspectionDate').value, current: currentReportId, banner: !document.getElementById('lastVisitBanner').hidden }));
  console.log('started:', JSON.stringify(started));
  check(started.addr === '1 Overdue Street' && started.client === 'Sam Taylor' && started.email === 'sam@example.com' && started.type === 'Annual — Existing Building' && started.date === (await p.evaluate(() => todayIsoDate())), 'the new report has the address, client and today\'s date');
  check(started.banner, 'the report offers to start from the last visit');
  await p.evaluate(() => saveCurrentReport(true));
  check(!(await p.evaluate(() => reinspectionsDue().some(it => it.r.jobAddress === '1 Overdue Street'))), 'once the new report is saved, the property leaves the Due list');

  check(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
