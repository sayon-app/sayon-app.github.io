// The Jobs list reads true, and nothing hides behind it:
//   1. the headline counts today's jobs, then what's booked for later and
//      the re-inspections that are overdue (which opens the Due tab), and
//      the dock's count is the same number;
//   2. To do runs the way the week does (still open from earlier, today,
//      coming up) and a booking still to come shows its time;
//   3. an agreement whose link is out says when it went and who it's
//      waiting on, on the card and on the job's Next step (Check now,
//      Send again);
//   4. opening Jobs asks about every link that's out in one request, and a
//      signed agreement or an answered quote moves its job and says so;
//   5. a card's status stays in one piece, a sync clash's copy and a job
//      the account doesn't hold are tagged;
//   6. on Jobs the dock names the open job by its street, and the mic
//      opens a job whose report is done instead of recording into it;
//   7. deleting says "Job deleted" and "Job restored".
// node e2e.js <outDir>   (serve the repo on :8765 first; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/jobs-list'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf', uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'clean');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
const LINK_A = '0000000a-1111-4222-8333-444444444444', LINK_Q = '0000000b-1111-4222-8333-444444444444';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } }));
  // The links that are out: each row's status, and every time they're asked about.
  const links = { [LINK_A]: { status: 'pending' }, [LINK_Q]: { status: 'pending' } }; const asked = [];
  await ctx.route(/supabase\.co/, r => {
    const req = r.request(), u = decodeURIComponent(req.url());
    if (u.includes('businesses?owner_id')) return r.fulfill({ json: [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] });
    if (u.includes('/rest/v1/sign_requests') && req.method() === 'GET') {
      asked.push(u);
      const ids = Object.keys(links).filter(id => u.includes(id));
      return r.fulfill({ json: ids.map(id => Object.assign({ id }, links[id])) });
    }
    // The account refuses one job, so it stays "not in your account yet".
    if (u.includes('/rest/v1/reports') && req.method() === 'POST') { const row = JSON.parse(req.postData()); return row.report_id === 'report_fig' ? r.fulfill({ status: 500, body: 'down' }) : r.fulfill({ status: 201, json: [row] }); }
    return r.fulfill({ json: [] });
  });
  await ctx.addInitScript(s => {
    localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1', '1'); localStorage.setItem('korva_onboarded_v1:' + s.user.id, '1');
    class FakeSR { constructor() { FakeSR.last = this; } start() { this.started = true; } stop() { this.onend && this.onend(); } abort() { this.onend && this.onend(); } }
    window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
  }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  const toast = () => p.evaluate(() => { const t = document.getElementById('toast'); return t.classList.contains('show') ? t.innerText.replace(/\s+/g, ' ').trim() : ''; });
  const cards = () => p.evaluate(() => [...document.querySelectorAll('#dashboardJobs .dash-card')].map(c => ({
    street: c.querySelector('.dash-card-street').textContent, when: (c.querySelector('.dash-card-when') || {}).textContent || '',
    act: (c.querySelector('.dash-card-act span') || {}).textContent || '', tags: [...c.querySelectorAll('.dash-card-tag')].map(t => t.textContent),
    status: (c.querySelector('.dash-card-status') || {}).textContent || '', statusLines: c.querySelector('.dash-card-status') ? c.querySelector('.dash-card-status').getClientRects().length : 0 })));

  // Seven made-up jobs: one still open from three days ago, one today with
  // its agreement link out, two booked ahead, one waiting on a quote's
  // link, two finished (one a sync clash's copy the account doesn't hold,
  // one inspected fourteen months ago).
  await p.evaluate(({ sc, LINK_A, LINK_Q, PNG }) => {
    storeCompanyDetails(sc.company); openApp('inspect'); resetReportState(); startBlankReport();
    const now = Date.now();
    const iso = n => { const t = new Date(); t.setDate(t.getDate() + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
    const signed = n => ({ method: 'onsite', signerName: 'Client', signature: PNG, signedAt: now, inspectionDate: iso(n), fee: '350', notes: '', standard: 'AS 4349.3-2010', text: 'The agreement.' });
    const mk = (id, street, client, n, data, top) => Object.assign({ id, address: `${street}, Sampleville QLD 4000`, jobAddress: street, jobSuburb: 'Sampleville', jobState: 'QLD', jobPostcode: '4000', client, inspector: 'Alex Example',
      reportData: Object.assign({ jobInspectionDate: iso(n), jobClientEmail: 'client@example.com', riskLevel: 'low' }, data), fieldNotes: {}, savedAt: now - 5000, cloudSavedAt: now - 5000, completion: 40 }, top);
    setSavedReports([
      mk('report_sam', '12 Wattle Street', 'Sam Taylor', 0, { jobInspectionTime: '09:00', agreementRequest: { id: LINK_A, signerName: 'Sam Taylor', sentAt: now - 864e5, values: { inspectionDate: iso(0), fee: '350', notes: '', standard: 'AS 4349.3-2010', text: 'The agreement.' } } }),
      mk('report_priya', '3 Banksia Court', 'Priya Nair', 1, { jobInspectionTime: '14:30' }),
      mk('report_lee', '7 Gum Road', 'Lee Wong', -3, { agreement: signed(-3) }),
      mk('report_kim', '40 Later Lane', 'Kim Ng', 9, {}),
      mk('report_jo', '88 Ironbark Road', 'Jo Lee', -5, { agreement: signed(-5), sent: { at: now - 4 * 864e5 }, treatmentRecommended: 'YES' }),
      mk('report_fig', '5 Fig Lane', 'Jordan Lee', -6, { agreement: signed(-6), sent: { at: now - 5 * 864e5 }, treatmentRecommended: 'NO' }, { conflictCopy: true, cloudSavedAt: 0 }),
      mk('report_old', '9 Old Mill Road', 'Pat Rivers', -430, { agreement: signed(-430), sent: { at: now - 429 * 864e5 }, treatmentRecommended: 'NO' }),
    ]);
    // Jo's quote went with a link to accept it.
    loadReport('report_jo', true); openQuoteFromReport();
    quoteState.items = [newQuoteItem('bait_install', { qty: '8' })];
    quoteState.sentAt = now - 3 * 864e5; quoteState.sentHash = quoteContentHash(quoteState);
    quoteState.linkRequest = { id: LINK_Q, sentAt: now - 3 * 864e5, hash: quoteContentHash(quoteState), files: {} };
    persistQuote(); storeQuoteOnReport(quoteState, false); closeQuote();
    loadReport('report_lee', true);
  }, { sc, LINK_A, LINK_Q, PNG });
  await p.waitForTimeout(600);

  // ── 1 and 2. The headline, the order and the time ──
  asked.length = 0;
  await p.evaluate(() => { linksCheckedAt = 0; tabGo('dashboard'); }); await p.waitForTimeout(900);
  const head = await p.evaluate(() => ({ lead: document.getElementById('dashboardLead').textContent, more: document.getElementById('dashboardMore').innerText.replace(/\s+/g, ' '), count: document.getElementById('tabJobsCount').textContent,
    parts: [...document.querySelectorAll('#dashboardJobs .dash-part')].map(h => h.textContent), tab: dashboardTab }));
  check(head.lead === '2 jobs need you today.', 'the headline counts today\'s jobs and the one still open from earlier, not next week\'s: ' + head.lead);
  check(/2 booked for later/.test(head.more) && /1 re-inspection overdue/.test(head.more), 'under it: what\'s booked for later and the overdue re-inspection: ' + head.more);
  check(head.count === '2', 'the dock\'s Jobs count is the same number: ' + head.count);
  let list = await cards();
  check(list.map(c => c.street).join(' | ') === '7 Gum Road | 12 Wattle Street | 3 Banksia Court | 40 Later Lane', 'To do runs earlier, today, tomorrow, later: ' + list.map(c => c.street).join(' | '));
  check(head.parts.join(' | ').toLowerCase() === 'still open from earlier | today | coming up', 'a heading where the day changes: ' + head.parts.join(' | '));
  check(list[1].when === 'Today 9am' && list[2].when === 'Tomorrow 2:30pm', 'a booking still to come shows its time: ' + list[1].when + ', ' + list[2].when);
  check(!/\d(am|pm)/.test(list[0].when), 'a day that\'s gone shows just the day: ' + list[0].when);
  await p.screenshot({ path: `${OUT}/1-todo.png` });

  // ── 3. The agreement's link is out ──
  check(/^Agreement sent \d+ \w+, waiting on Sam$/.test(list[1].act), 'the card says when the agreement went and who it waits on: ' + list[1].act);
  check(list[2].act === 'Get the agreement signed', 'a job with no link out still says to get it signed: ' + list[2].act);
  // ── 4. One request for every link that's out ──
  check(asked.length === 1 && asked[0].includes('id=in.(') && asked[0].includes(LINK_A) && asked[0].includes(LINK_Q), 'opening Jobs asks about both links in one request: ' + asked.length);
  await p.evaluate(() => openDashboardJob('report_sam', 'job')); await p.waitForTimeout(500);
  const nextCard = await p.evaluate(() => ({ label: document.querySelector('.job-next .dash-next-label').textContent, title: document.querySelector('.job-next .dash-next-title').textContent,
    links: [...document.querySelectorAll('.job-next .dash-detail-links button')].map(x => x.textContent), primary: document.querySelector('.job-next .dash-detail-primary').textContent }));
  check(/^Agreement sent \d+ \w+, waiting on Sam$/.test(nextCard.title) && nextCard.label !== 'Next step', 'the job\'s page says the same instead of "Get the agreement signed": ' + nextCard.label + ' / ' + nextCard.title);
  check(nextCard.links.join(' | ') === 'Check now | Send again' && nextCard.primary === 'Open the agreement', 'with Check now and Send again under it: ' + nextCard.links.join(' | '));
  await p.screenshot({ path: `${OUT}/2-agreement-sent.png` });
  await p.getByRole('button', { name: 'Check now' }).click(); await p.waitForTimeout(500);
  check(await toast() === 'Not signed yet', 'Check now asks, and says it isn\'t signed yet: ' + await toast());

  // ── 5. Status in one piece, and the tags ──
  await p.evaluate(() => { tabGo('dashboard'); setDashboardTab('waiting'); }); await p.waitForTimeout(400);
  list = await cards();
  check(list.length === 1 && /^Quote sent \d+ \w+$/.test(list[0].status) && list[0].statusLines === 1, 'a Waiting card keeps "Quote sent 7 Nov" on one line: ' + JSON.stringify(list[0] && [list[0].status, list[0].statusLines]));
  await p.screenshot({ path: `${OUT}/3-waiting.png` });
  await p.evaluate(() => setDashboardTab('done')); await p.waitForTimeout(400);
  list = await cards();
  const fig = list.find(c => c.street === '5 Fig Lane');
  check(fig && fig.tags.map(t => t.toLowerCase()).join(' | ') === 'copy from this phone | not in your account yet', 'a clash copy the account doesn\'t hold is tagged both ways: ' + (fig && fig.tags.join(' | ')));
  await p.screenshot({ path: `${OUT}/4-done-tags.png` });
  await p.locator('#dashboardMore button').click(); await p.waitForTimeout(400);
  const due = await p.evaluate(() => ({ tab: dashboardTab, status: (document.querySelector('.reinspect-card .dash-card-status') || {}).textContent, lines: document.querySelector('.reinspect-card .dash-card-status') ? document.querySelector('.reinspect-card .dash-card-status').getClientRects().length : 0 }));
  check(due.tab === 'due' && /^Overdue by/.test(due.status || '') && due.lines === 1, 'the overdue line in the headline opens Due, whose card keeps "Overdue by 2 months" in one piece: ' + JSON.stringify(due));
  await p.screenshot({ path: `${OUT}/5-due.png` });

  // ── 4 again. Both come back ──
  links[LINK_A] = { status: 'signed', signer_name: 'Sam Taylor', signature: PNG, signed_at: new Date().toISOString() };
  links[LINK_Q] = { status: 'signed', signer_name: 'Jo Lee', signature: PNG, signed_at: new Date().toISOString(), note: '' };
  asked.length = 0;
  await p.evaluate(() => { loadReport('report_lee', true); tabGo('report'); linksCheckedAt = 0; tabGo('dashboard'); }); await p.waitForTimeout(1200);
  const came = await p.evaluate(() => { const r = id => getSavedReports().find(x => x.id === id); const q = getSavedQuotes().report_jo;
    return { agreement: r('report_sam').reportData.agreement, request: !!r('report_sam').reportData.agreementRequest, answer: q.answer, link: !!q.linkRequest }; });
  check(asked.length === 1, 'the next open asks once more: ' + asked.length);
  check(came.agreement && came.agreement.method === 'remote' && came.agreement.signerName === 'Sam Taylor' && !came.request, 'the signed agreement lands on a job that isn\'t open');
  check(came.answer && came.answer.status === 'accepted' && came.answer.by === 'Jo Lee' && !came.link, 'the accepted quote lands too');
  const said = await toast();
  check(/2 came back/.test(said) && /Sam Taylor signed the agreement for 12 Wattle Street/.test(said) && /Jo Lee accepted the quote for 88 Ironbark Road/.test(said), 'and Jobs says so: ' + said);
  list = await cards();
  const sam = list.find(c => c.street === '12 Wattle Street'), jo = list.find(c => c.street === '88 Ironbark Road');
  // Jo signed to accept from the link, so the signed copy is owed first.
  check(sam && sam.act === 'Finish the report' && jo && jo.act === 'Email the signed quote', 'both jobs move on without being opened: ' + (sam && sam.act) + ', ' + (jo && jo.act));
  await p.screenshot({ path: `${OUT}/6-came-back.png` });

  // ── 6. The dock names the job, and the mic minds a finished report ──
  await p.evaluate(() => { loadReport('report_fig', true); tabGo('report'); }); await p.waitForTimeout(400);
  const shown = () => p.evaluate(() => [...document.querySelectorAll('.tab[data-tab="job"] .tabbar-label')].filter(el => getComputedStyle(el).display !== 'none').map(el => el.textContent).join('|'));
  check(await shown() === 'This job', 'on the report the dock says This job: ' + await shown());
  await p.evaluate(() => tabGo('dashboard')); await p.waitForTimeout(400);
  check(await shown() === '5 Fig Lane', 'on Jobs it carries the open job\'s street: ' + await shown());
  await p.screenshot({ path: `${OUT}/7-dock-street.png` });
  await p.locator('#micFab').click(); await p.waitForTimeout(500);
  const mic = await p.evaluate(() => ({ job: document.getElementById('jobOverlay').classList.contains('open'), rec: isRecording, voice: document.getElementById('voicePopover').classList.contains('open') }));
  check(mic.job && !mic.rec && !mic.voice && /The report for 5 Fig Lane is done/.test(await toast()), 'the mic on Jobs opens a job whose report is done instead of recording: ' + JSON.stringify(mic) + ' ' + await toast());
  check(await p.evaluate(() => getSavedReports().find(r => r.id === 'report_fig').conflictCopy === true), 'the copy keeps its tag after it\'s been opened');
  await p.evaluate(() => { loadReport('report_lee', true); tabGo('dashboard'); }); await p.waitForTimeout(400);
  await p.locator('#micFab').click(); await p.waitForTimeout(600);
  const mic2 = await p.evaluate(() => ({ place: navPlace(), rec: isRecording, voice: document.getElementById('voicePopover').classList.contains('open') }));
  check(mic2.place === 'report' && mic2.rec && mic2.voice, 'for a report still under way the mic goes to it and listens: ' + JSON.stringify(mic2));
  await p.evaluate(() => { stopRecording(); if (document.getElementById('voicePopover').classList.contains('open')) toggleVoicePopover(); });

  // ── 7. Deleting says job, both times ──
  await p.evaluate(() => tabGo('dashboard')); await p.waitForTimeout(300);
  await p.evaluate(() => { deleteReport('report_kim'); }); await p.waitForTimeout(300);
  const delAsk = await p.evaluate(() => document.getElementById('askTitle').textContent);
  check(/^Delete the job at 40 Later Lane/.test(delAsk), 'the question names the job: ' + delAsk.slice(0, 50));
  await p.click('#askYes'); await p.waitForTimeout(400);
  check(/^Job deleted/.test(await toast()), 'then "Job deleted": ' + await toast());
  check(!(await cards()).some(c => c.street === '40 Later Lane'), 'and the card goes from the list at once');
  await p.locator('#toast .toast-action').click(); await p.waitForTimeout(400);
  check(await toast() === 'Job restored' && (await cards()).some(c => c.street === '40 Later Lane'), 'Undo says "Job restored" and the card is back: ' + await toast());

  check(!errs.length, 'no page errors: ' + errs.join(' | '));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
  process.exit(fails.length ? 1 : 0);
})();
