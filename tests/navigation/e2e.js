// Getting around the app: back (the phone's back, Esc, and a swipe in from
// the left edge in the home-screen app) steps back one screen instead of
// leaving SAYON; a sheet closed unfinished goes back to where it was opened;
// a job on the Jobs list opens its own page; every screen has a way back;
// the app reopens where it was; the Last visit line no longer offers a job
// its own saved copy; the report's Job details card, date and time chips,
// and Report done with one clear next step.
// node e2e.js <outDir>   (serve the repo on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/navigation'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf', uid = 'u-nav';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'owner@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };

async function setup(b, opts) {
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, ...opts });
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => r.fulfill({ json: { plan: 'trial', status: 'trialing', ai_calls_used_this_period: 0, limit: 50, ok: true, configured: true } }));
  await ctx.route(/supabase\.co/, r => {
    const u = r.request().url();
    if (u.includes('/rest/v1/businesses')) return r.fulfill({ json: [{ id: 'b-nav', name: 'Example Pest Co', owner_id: uid, settings: {} }] });
    return r.fulfill({ json: [] });
  });
  await ctx.addInitScript(s => { if (!localStorage.getItem('korva_session')) localStorage.setItem('korva_session', JSON.stringify(s)); }, sess);
  return ctx;
}

(async () => {
  const b = await chromium.launch();
  const ctx = await setup(b);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  const shot = async (name) => { await p.waitForTimeout(350); await p.screenshot({ path: `${OUT}/${name}.png` }); };
  const where = () => p.evaluate(() => [navPlace(), topOpenSheet() ? topOpenSheet().id : ''].filter(Boolean).join('+'));
  const back = async () => { await p.goBack({ waitUntil: 'commit' }).catch(() => {}); await p.waitForTimeout(500); };
  // Taps a job's card on the Jobs list, on whichever tab it's under.
  const openCard = async (text) => {
    if (await where() !== 'jobs') { await p.evaluate(() => tabGo('dashboard')); await p.waitForTimeout(500); }
    await p.evaluate(t => { const j = dashboardJobs.find(x => (x.r.address || '').includes(t)); if (j) setDashboardTab(j.group); }, text);
    await p.waitForTimeout(300);
    await p.locator('.dash-card', { hasText: text }).locator('.dash-card-main').click(); await p.waitForTimeout(900);
  };

  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  await p.fill('#ob-companyName', 'Example Pest Co'); await p.fill('#ob-licence', 'NSW 123456'); await p.fill('#ob-phone', '0400 000 000');
  await p.click('#obBusinessSave'); await p.evaluate(() => obNext(1)); await p.waitForTimeout(300);
  await p.evaluate(() => obShowPanel(3)); await p.waitForTimeout(300);
  await p.getByRole('button', { name: /See a finished sample job first/i }).click(); await p.waitForTimeout(1800);

  // A real job of our own, booked with the chips.
  await p.evaluate(() => startNewJob()); await p.waitForTimeout(800);
  await p.fill('#jobAddress', '22 Test Road'); await p.fill('#jobSuburb', 'Epping'); await p.fill('#jobClient', 'Sam Client');
  await p.evaluate(() => { document.getElementById('jobState').value = 'NSW'; updateJob(); }); await p.waitForTimeout(300);
  const chips = await p.evaluate(() => ({ days: [...document.querySelectorAll('#jobDateChips .date-chip')].map(c => c.textContent), times: [...document.querySelectorAll('#jobTimeChips .date-chip')].map(c => c.textContent) }));
  console.log('chips:', JSON.stringify(chips));
  check(chips.days[0] === 'Today' && chips.days[1] === 'Tomorrow' && chips.days.length === 7, 'the day chips read Today, Tomorrow and the next five days');
  check(chips.times[0] === '7am' && chips.times.includes('12pm') && chips.times.includes('2pm'), 'the time chips read 7am to 4pm');
  await p.locator('#jobDateChips .date-chip').nth(1).click();
  await p.locator('#jobTimeChips .date-chip', { hasText: /^9am$/ }).click(); await p.waitForTimeout(300);
  const booked = await p.evaluate(() => ({ d: reportData.jobInspectionDate, t: reportData.jobInspectionTime, on: [...document.querySelectorAll('.date-chip.on')].map(c => c.textContent) }));
  const tomorrow = await p.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 1); return isoDate(d); });
  check(booked.d === tomorrow && booked.t === '09:00' && booked.on.join('|') === 'Tomorrow|9am', 'one tap each books tomorrow at 9am, and both chips light: ' + JSON.stringify(booked));
  await p.evaluate(() => document.getElementById('jobDateChips').scrollIntoView({ block: 'center' })); await shot('01-date-time-chips');
  await p.evaluate(() => saveJobNow()); await p.waitForTimeout(500);
  const ourId = await p.evaluate(() => currentReportId);

  // 1. Jobs: a card opens that job's own page; the page has a back button.
  await p.evaluate(() => tabGo('dashboard')); await p.waitForTimeout(600);
  await openCard('Example Street');
  check(await where() === 'job' && await p.evaluate(() => currentReportId) === 'sample_job', 'tapping a job on the Jobs list opens that job\'s page, and it becomes This job');
  check(!(await p.evaluate(() => document.getElementById('dashboardDetail').classList.contains('open'))), 'no in-between sheet');
  await shot('02-job-page');
  await p.click('#jobOverlay .page-topbar .drawer-back'); await p.waitForTimeout(600);
  check(await where() === 'jobs', 'the job page\'s back button goes to Jobs');

  // 2. The phone's back climbs: report -> This job -> Jobs, then stays put.
  await openCard('22 Test Road');
  check(await p.evaluate(() => currentReportId) === ourId, 'our job opens');
  check(await p.evaluate(() => document.getElementById('lastVisitBanner').hidden), 'opening a saved job doesn\'t offer the job\'s own copy as "Inspected here before"');
  await p.evaluate(() => jobGo('report')); await p.waitForTimeout(500);
  await back(); check(await where() === 'job', 'back from the report goes to This job');
  await back(); check(await where() === 'jobs', 'back from This job goes to Jobs');
  check(p.url().startsWith(`http://localhost:${PORT}/`), 'still in SAYON after backing up to Jobs: ' + p.url());

  // 3. A sheet closed unfinished goes back to where it was opened from.
  await openCard('22 Test Road');
  await p.evaluate(() => jobGo('agreement')); await p.waitForTimeout(600);
  check(await where() === 'report+agreementOverlay', 'the agreement opens from This job');
  await p.click('#agreementOverlay .voice-popover-close'); await p.waitForTimeout(600);
  check(await where() === 'job', 'its ✕ goes back to This job, not into the report');
  await p.evaluate(() => jobGo('agreement')); await p.waitForTimeout(600);
  await p.keyboard.press('Escape'); await p.waitForTimeout(600);
  check(await where() === 'job', 'Esc does the same');
  await p.evaluate(() => jobGo('agreement')); await p.waitForTimeout(600);
  await back(); check(await where() === 'job', 'and so does the phone\'s back');
  // From the Jobs list's next-step button: back to the list.
  await p.evaluate(() => tabGo('dashboard')); await p.waitForTimeout(500);
  await p.evaluate(id => openDashboardJob(id, 'agreement'), ourId); await p.waitForTimeout(600);
  await p.keyboard.press('Escape'); await p.waitForTimeout(600);
  check(await where() === 'jobs', 'the agreement opened from the Jobs list goes back to the list');

  // The sample: treatment record from This job, ✕ back to This job; typed, Esc keeps it.
  await openCard('Example Street');
  await p.evaluate(() => jobGo('treatment')); await p.waitForTimeout(900);
  check(await where() === 'quote+treatmentOverlay', 'the treatment record opens over the quote');
  await p.click('#treatmentOverlay .voice-popover-close'); await p.waitForTimeout(700);
  check(await where() === 'job', 'its ✕ goes back to This job (not left on the quote)');
  await p.evaluate(() => jobGo('treatment')); await p.waitForTimeout(900);
  await p.evaluate(() => { const el = document.getElementById('trWeather'); el.value = 'Overcast, 18°C'; el.dispatchEvent(new Event('input', { bubbles: true })); }); await p.waitForTimeout(800);
  await p.keyboard.press('Escape'); await p.waitForTimeout(700);
  check(await where() === 'job', 'Esc on the treatment record goes back to This job');
  await p.evaluate(() => jobGo('treatment')); await p.waitForTimeout(900);
  check(await p.inputValue('#trWeather') === 'Overcast, 18°C', 'what was typed before Esc is still there when it opens again');
  await p.click('#treatmentOverlay .voice-popover-close'); await p.waitForTimeout(500);

  // 4. The quote: folded, it has its own back button.
  await p.evaluate(() => jobGo('quote')); await p.waitForTimeout(900);
  await p.evaluate(() => { if (!document.getElementById('quoteScreen').classList.contains('top-folded')) toggleQuoteBar('top'); }); await p.waitForTimeout(300);
  check(await p.locator('.quote-topbar-back').isVisible(), 'the folded quote bar shows a back button');
  await shot('03-quote-folded');
  await p.click('.quote-topbar-back'); await p.waitForTimeout(600);
  check(await where() === 'job', 'it goes back to This job');
  await p.evaluate(() => { jobGo('quote'); toggleQuoteBar('top'); }); await p.waitForTimeout(700);
  const fade = await p.evaluate(() => { const s = document.querySelector('#quoteScreen .doc-strip'); return { cls: s.className, over: s.scrollWidth > s.clientWidth }; });
  check(!fade.over || /more-right/.test(fade.cls), 'the documents strip fades at the side when it runs off the screen: ' + JSON.stringify(fade));
  await shot('04-quote-strip');

  // 5. Esc closes the top layer only: the photo viewer, then the menu page, then the menu.
  await p.evaluate(() => tabGo('menu')); await p.waitForTimeout(500);
  await p.evaluate(() => showMenuPage('settingsPanel')); await p.waitForTimeout(400);
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  check(await p.evaluate(() => document.getElementById('sidebarPanel').classList.contains('open') && !document.getElementById('sidebarPanel').classList.contains('on-page')), 'Esc on a menu page goes back to the menu list');
  await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  check(await where() === 'jobs', 'Esc on the menu goes back to Jobs');
  // A menu page opened straight from the Jobs list (a toast's "See", the account menu) shows on top.
  await p.evaluate(() => openMenuPage('settingsPanel')); await p.waitForTimeout(500);
  check(await p.evaluate(() => !document.getElementById('dashboardOverlay').classList.contains('open') && document.getElementById('sidebarPanel').classList.contains('on-page')), 'a menu page opened from the Jobs list isn\'t hidden behind it');
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  check(await where() === 'jobs', 'and Esc twice is back on Jobs');

  // 6. Report: Job details card and the header address both open the details.
  await openCard('22 Test Road');
  await p.evaluate(() => { jobGo('report'); goStep('property'); }); await p.waitForTimeout(500);
  const card = await p.evaluate(() => document.getElementById('reportJobSub').textContent);
  check(/22 Test Road, Epping NSW · Sam Client/.test(card) && /9:00 am/.test(card), 'the Property step\'s Job details card shows the address, client, day and time: ' + JSON.stringify(card));
  await shot('05-report-job-card');
  await p.click('#reportJobCard'); await p.waitForTimeout(700);
  check(await p.evaluate(() => navPlace() === 'job' && document.getElementById('jobDetailsFold').open), 'the card opens This job with the details open');
  // The job's order: Job details come first, then the agreement, then the report.
  const order = await p.evaluate(() => { const top = document.getElementById('jobDetailsHead').getBoundingClientRect().top;
    const card = document.getElementById('reportJobCard'), banner = document.getElementById('agreementBanner');
    const j = dashboardJobs.find(x => x.r.id === currentReportId) || currentJobSummary();
    return { labels: [...document.querySelectorAll('#jobOverlay .job-steps > li')].map(li => li.querySelector('.job-step-label').firstChild.textContent.trim()),
      first: document.querySelector('#jobOverlay .job-steps > li').className, count: document.querySelector('#jobOverlay .job-hero-count').textContent,
      inView: top >= 0 && top < innerHeight / 2, bars: (dashCardHTML(currentJobSummary()).match(/<i class=/g) || []).length,
      cardFirst: !!(card.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING),
      noName: jobDetailsStep({ r: { address: '1 Test Road', client: '', reportData: {} } }) }; });
  console.log('job order:', JSON.stringify(order));
  check(order.labels.slice(0, 3).join('|') === 'Job details|Agreement|Report' && order.first === 'done', 'This job lists Job details first (ticked), then the agreement, then the report: ' + order.labels.join(', '));
  check(order.count === '1 of 6 done' && order.bars === 6, 'Job details count as a step on the page and on the Jobs card: ' + order.count + ', ' + order.bars + ' bars');
  check(order.inView, 'the details open in view, at the top of the steps');
  check(order.cardFirst, 'on the report\'s first step the Job details card sits above the agreement banner');
  check(order.noName.state === 'todo' && /client's name/.test(order.noName.text), 'a job with no client yet says so, and isn\'t ticked: ' + JSON.stringify(order.noName));
  await p.evaluate(() => jobGo('report')); await p.waitForTimeout(400);
  await p.click('#headerJob'); await p.waitForTimeout(700);
  check(await p.evaluate(() => navPlace() === 'job' && document.getElementById('jobDetailsFold').open), 'so does the address at the top');

  // 7. Report done, then one clear next step.
  await p.evaluate(() => { jobGo('report'); goStep('finish'); }); await p.waitForTimeout(500);
  const before = await p.evaluate(() => ({ done: !document.getElementById('reportDoneBtn').hidden, quote: !document.getElementById('finishQuoteBtn').hidden, send: !document.getElementById('shareBtn').hidden, sub: document.getElementById('reportDoneSub').textContent }));
  console.log('finish before:', JSON.stringify(before));
  check(before.done && !before.quote && !before.send, 'before it\'s done, Finish shows one big button: Report done');
  check(/^\d+ still blank\. You can tick it off anyway\.$/.test(before.sub), 'it says how many answers are still blank: ' + before.sub);
  await p.evaluate(() => document.getElementById('finishNext').scrollIntoView({ block: 'center' })); await shot('06-finish-not-done');
  await p.evaluate(() => { reportData.treatmentRecommended = 'YES'; updateProgress(); });
  await p.click('#reportDoneBtn'); await p.waitForTimeout(800);
  const after = await p.evaluate(() => ({ quoteP: document.getElementById('finishQuoteBtn').classList.contains('primary'), sendP: document.getElementById('shareBtn').classList.contains('primary'),
    order: [...document.querySelectorAll('#finishNext .finish-next-btn:not([hidden])')].map(b => b.id), banner: !document.getElementById('reportDoneBanner').hidden,
    bannerText: document.getElementById('reportDoneBannerText').textContent, dots: [...document.querySelectorAll('.tab-dot')].every(d => d.classList.contains('done')),
    step: dashboardJob(getSavedReports().find(r => r.id === currentReportId), getSavedQuotes()).status }));
  console.log('finish after:', JSON.stringify(after));
  check(after.quoteP && !after.sendP && after.order[0] === 'finishQuoteBtn', 'treatment recommended and no quote yet: Write the quote is the one big button, first');
  check(after.banner && /^Report done today\. Next, the quote\.$/.test(after.bannerText), 'a Report done line shows at the top of the report: ' + JSON.stringify(after.bannerText));
  check(after.dots, 'every step reads done');
  check(after.step === 'Write the quote', 'the job moves on to the quote: ' + after.step);
  await shot('07-finish-done');
  await p.evaluate(() => goStep('findings')); await p.waitForTimeout(400); await shot('08-findings-done-banner');
  await p.evaluate(() => { reportData.treatmentRecommended = 'NO'; updateProgress(); });
  check(await p.evaluate(() => document.getElementById('shareBtn').classList.contains('primary') && document.getElementById('finishQuoteBtn').hidden), 'no treatment: Send to client is the big button and there\'s no quote button');
  await p.evaluate(() => goStep('finish')); await p.waitForTimeout(300);
  await p.click('#finishDoneUndo'); await p.waitForTimeout(500);
  check(await p.evaluate(() => !reportData.doneAt && !document.getElementById('reportDoneBtn').hidden && document.getElementById('reportDoneBanner').hidden), '"Keep working on it" takes the mark off');

  // 8. It reopens where it was: the report on the step that was showing.
  await p.evaluate(() => { goStep('conducive'); rememberNavPlace(); }); await p.waitForTimeout(300);
  await p.reload(); await p.waitForTimeout(3500);
  const reopened = await p.evaluate(() => ({ place: navPlace(), step: document.getElementById('reportBody').dataset.step, id: currentReportId, banner: document.getElementById('lastVisitBanner').hidden }));
  check(reopened.place === 'report' && reopened.step === 'conducive' && reopened.id === ourId, 'reopening goes back to the report on Conducive: ' + JSON.stringify(reopened));
  check(reopened.banner, 'and doesn\'t say the job was "Inspected here before"');
  await p.evaluate(() => { tabGo('dashboard'); rememberNavPlace(); }); await p.reload(); await p.waitForTimeout(3500);
  check(await where() === 'jobs', 'left on Jobs, it reopens on Jobs');
  await p.evaluate(() => { tabGo('job'); });
  check(errs.length === 0, 'no page errors: ' + errs.join(' | '));
  await ctx.close();

  // 9. The home-screen app: a swipe in from the left edge goes back.
  const ctx2 = await setup(b, { isMobile: true });
  await ctx2.addInitScript(() => { Object.defineProperty(navigator, 'standalone', { get: () => true }); });
  // Same storage as before isn't carried over, so sign up again quickly.
  const q = await ctx2.newPage(); const errs2 = []; q.on('pageerror', e => errs2.push(e.message));
  await q.goto(`http://localhost:${PORT}/`); await q.waitForTimeout(3000);
  await q.fill('#ob-companyName', 'Example Pest Co'); await q.fill('#ob-licence', 'NSW 123456'); await q.fill('#ob-phone', '0400 000 000');
  await q.click('#obBusinessSave'); await q.evaluate(() => obNext(1)); await q.waitForTimeout(300);
  await q.evaluate(() => obShowPanel(3)); await q.waitForTimeout(300);
  await q.getByRole('button', { name: /See a finished sample job first/i }).click(); await q.waitForTimeout(1800);
  await q.evaluate(() => jobGo('report')); await q.waitForTimeout(500);
  const swipe = async (x0, x1) => {
    const cdp = await ctx2.newCDPSession(q);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: 400 }] });
    for (let x = x0; x <= x1; x += 15) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: 402 }] });
    await q.waitForTimeout(100);
    await q.screenshot({ path: `${OUT}/09-edge-swipe.png` });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await q.waitForTimeout(600);
  };
  await swipe(6, 140);
  check(await q.evaluate(() => navPlace()) === 'job', 'a swipe in from the left edge goes back from the report to This job');
  await swipe(200, 340);
  check(await q.evaluate(() => navPlace()) === 'job', 'a swipe that starts away from the edge does nothing');
  check(errs2.length === 0, 'no page errors (home-screen app): ' + errs2.join(' | '));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
  process.exit(fails.length ? 1 : 0);
})();
