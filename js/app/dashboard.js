// SAYON app: Dashboard, toasts, completed jobs, gaps before you leave.
// One of the js/app/ files, which share one global scope: they load as plain
// scripts in the order index.html lists them, so a top-level name declared in
// any of them can be used from the others once the page has loaded.

// ── DASHBOARD ─────────────────────────────────────────────────────────────
// A page of every saved job, sorted into what needs the inspector, what
// waits on the client and what's done. Tapping a job opens its timeline
// (report, quote, the client's answer, treatment) and its next step.
function openDashboard() {
  // The dashboard reads saved jobs, so the open one is saved first.
  saveOpenReportNow();
  document.getElementById('dashboardOverlay').classList.add('open');
  dashboardTab = 'todo';
  const search = document.getElementById('dashboardSearch');
  if (search) search.value = '';
  renderDashboard();
  // Nothing to do: open on the list that has jobs in it.
  if (!dashboardJobs.some(j => j.group === 'todo')) {
    const fallback = ['waiting', 'done'].find(g => dashboardJobs.some(j => j.group === g));
    if (fallback) setDashboardTab(fallback);
  }
  checkLinksOut();
}

// Opens the open job's details, on its page.
function openJobDetails() {
  if (document.getElementById('dashboardOverlay').classList.contains('open')) closeDashboard();
  jobGo('details');
}

// A job changed somewhere else (a save, a sync, a delete, a client's
// answer): the list and the headline are read again. The tab and what's
// typed in the search box stay as they are.
function refreshDashboardIfOpen() {
  if (!document.getElementById('dashboardOverlay').classList.contains('open')) return;
  if (!document.getElementById('dashboardJobs')) { renderDashboard(); return; }
  readDashboardJobs();
  renderDashboardJobs();
}
// The same, with the dock's count of jobs that need the inspector.
function refreshJobsList() {
  refreshDashboardIfOpen();
  syncDockJobs();
}

function closeDashboard() {
  closeDashboardDetail();
  document.getElementById('dashboardOverlay').classList.remove('open');
}

// Which list the dashboard shows: 'todo' | 'waiting' | 'done'. Search
// looks through every job. The open job's details live on its own page
// (THIS JOB).
let dashboardTab = 'todo';
let dashboardJobs = [];
// 'due' lists properties due for their next inspection (js/reinspection.js).
const DASHBOARD_TABS = [['todo', 'To do'], ['waiting', 'Waiting'], ['done', 'Done'], ['due', 'Due']];

// Job details sit on the job's page. Before a page redraws, the panel goes
// back to its holder, so its fields survive the redraw.
function parkJobPanel() {
  const panel = document.getElementById('jobPanel');
  const home = document.getElementById('jobPanelHome');
  if (panel && home && panel.parentNode !== home) home.appendChild(panel);
}

// When a job is: its inspection date, at the time it's booked for, else
// when it was saved.
function dashboardJobTime(r) {
  const d = r.reportData || {};
  const iso = d.jobInspectionDate || (d.agreement && d.agreement.inspectionDate);
  const t = iso ? new Date(iso + 'T00:00:00').getTime() : NaN;
  if (isNaN(t)) return r.savedAt;
  const at = /^(\d{1,2}):(\d{2})/.exec(String(d.jobInspectionTime || ''));
  return t + (at ? (+at[1] * 60 + +at[2]) * 60000 : 0);
}
// How many days from today a time is: 0 today, 1 tomorrow, -1 yesterday.
function dashDaysAway(ts) {
  const day = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  return Math.round((day(ts) - day(Date.now())) / 864e5);
}
// The jobs that are the inspector's move, split the way the headline and
// the dock count them: today's (with anything still open from an earlier
// day) and those booked for a later day.
function jobsNeedingYou(jobs) {
  const todo = jobs.filter(j => j.group === 'todo');
  const later = todo.filter(j => dashDaysAway(j.time) > 0).length;
  return { today: todo.length - later, later };
}

const dashDate = (ts) => new Date(ts).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
const dashDay = (iso) => { const t = new Date(iso + 'T00:00:00'); return isNaN(t) ? (iso || '') : dashDate(t); };

// Where a job is up to. group: 'todo' (the inspector's move), 'waiting'
// (on the client) or 'done'. status: a few words for the list. next: the
// one button that moves the job along. steps: the job's timeline.
function dashboardJob(r, quotes) {
  const d = r.reportData || {};
  const q = quotes[r.id] || r.quote || null;
  const hasQuote = quoteHasItems(q);
  const a = hasQuote ? quoteAnswerState(q) : null;
  // Ready: every required field filled, or a PDF made. Done: completed or sent.
  const reportSent = !!(d.issue || d.sent);
  const reportDone = reportSent || !!d.doneAt || !!d.pdfAt || (r.completion || 0) >= 100;
  // The client's copy is behind: the report changed after it went
  // (r.reportStale, set as it's saved), in an amendment or without one.
  const reportStale = reportSent && !(d.issue && !d.amending) && !!r.reportStale;
  // The quote's link carries the report too, so a quote sent that way gave
  // the client the report.
  const reportWentWithQuote = !!(hasQuote && q.sentAt && q.linkRequest && q.linkRequest.files && q.linkRequest.files.report);
  // "Client isn't going ahead" (noQuoteNeeded) skips the quote and what follows it.
  const clientNotGoingAhead = d.treatmentRecommended === 'YES' && !!d.noQuoteNeeded;
  const needsQuote = d.treatmentRecommended === 'YES' && !d.noQuoteNeeded;
  const total = hasQuote ? quoteTotals(q).total : 0;
  const who = (r.client || '').trim() || 'the client';
  let group, status, hint = '', next = null;
  let onlyReportUnsent = false;
  if (!reportDone) {
    group = 'todo'; status = 'Finish the report';
    hint = 'Fill in the rest of the report, then tick Report done on its last step.';
    next = { label: 'Open report', to: 'report' };
  } else if (!hasQuote && needsQuote) {
    group = 'todo'; status = 'Write the quote';
    hint = 'The report recommends a treatment. Price the work for ' + who + '.';
    next = { label: 'Write the quote', to: 'quote' };
  } else if (!hasQuote) {
    group = reportSent ? 'done' : 'todo';
    status = reportSent ? (clientNotGoingAhead ? 'Client not going ahead' : 'No quote needed') : 'Send the report';
    onlyReportUnsent = !reportSent;
    hint = reportSent ? 'The report has gone to ' + who + (clientNotGoingAhead ? ' and they aren\'t going ahead with treatment.' : ' and no treatment was recommended.') : 'The report is ready. Send it to ' + who + '.';
    if (!reportSent) next = { label: 'Open report', to: 'report' };
  } else if (!a && q.sentAt && q.sentHash && q.sentHash !== quoteContentHash(q)) {
    group = 'todo'; status = 'Send the quote again';
    hint = 'The quote changed after it went to ' + who + '. Send the new version.';
    next = { label: 'Open quote', to: 'quote' };
  } else if (!a) {
    group = q.sentAt ? 'waiting' : 'todo';
    status = q.sentAt ? `Quote sent ${dashDate(q.sentAt)}` : 'Send the quote';
    hint = q.sentAt ? 'Waiting on ' + who + '. Record their answer when it comes.' : 'The quote is priced. Send it to ' + who + '.';
    next = { label: q.sentAt ? 'Record their answer' : 'Send the quote', to: q.sentAt ? 'answer' : 'quote' };
  } else if (a.stale) {
    group = 'todo'; status = 'Quote changed, get a new answer';
    hint = 'The quote changed after ' + who + ' answered. Send the new version and record their answer again.';
    next = { label: 'Open quote', to: 'quote' };
  } else if (a.status !== 'accepted') {
    group = 'done'; status = 'Quote declined';
    hint = who.charAt(0).toUpperCase() + who.slice(1) + ' declined the quote, so there\'s nothing more to do.';
  } else if (!q.treatment) {
    group = 'todo'; status = 'Record the treatment';
    hint = who.charAt(0).toUpperCase() + who.slice(1) + ' accepted the quote. Once the work is done, record what was used and where.';
    next = { label: 'Record treatment', to: 'treatment' };
  } else if (!certificateGiven(q)) {
    group = 'todo'; status = 'Email the certificate';
    hint = 'The treatment is recorded. Email ' + who + ' their treatment certificate, the PDF that records what was applied and where. You\'ll see who it goes to before it sends.';
    next = { label: 'Email the certificate', to: 'certificate' };
  } else {
    group = 'done'; status = 'Treated';
    hint = 'Finished. ' + who.charAt(0).toUpperCase() + who.slice(1) + ' has their treatment certificate.';
  }

  // Everything else is finished (a declined quote, say) but the report
  // itself never went, or changed after it did: that's still the
  // inspector's to do.
  if (group === 'done' && reportDone && (reportStale || !reportSent && !reportWentWithQuote)) {
    onlyReportUnsent = true;
    group = 'todo'; status = reportStale ? 'Send the report again' : 'Send the report';
    hint = reportStale && d.amending ? 'The amended report hasn\'t gone to ' + who + '. Send it, then finalise the new version.'
      : reportStale ? 'The report changed after it went to ' + who + '. Send it again so they have it as it is now.'
      : 'The report is ready but hasn\'t gone to ' + who + '. Send it from the report\'s last step.';
    next = { label: 'Open report', to: 'report' };
  }

  // A baiting system keeps the job going: back to To do when a station
  // check is due or a visit report hasn't gone, Waiting between visits.
  const bait = typeof baitProgram === 'function' ? baitProgram(q) : null;
  let baitWaiting = false;
  if (bait && !bait.finished && group === 'done') {
    const unsent = bait.last && !bait.last.sentAt;
    if (unsent) {
      group = 'todo'; status = 'Email the visit report';
      hint = 'The bait station visit is recorded. Email ' + who + ' the visit report.';
      next = { label: 'Email the visit report', to: 'bait' };
    } else if (bait.dueNow) {
      group = 'todo'; status = bait.visits.length ? 'Bait station visit due' : 'First bait station check due';
      hint = (bait.overdue ? 'Was due ' : 'Due ') + dashDay(bait.due) + '. Check the stations and record what you found.';
      next = { label: 'Record the visit', to: 'bait' };
    } else {
      group = 'waiting'; status = `Bait check due ${dashDay(bait.due)}`; baitWaiting = true;
      hint = 'The stations are in. Come back on ' + dashDay(bait.due) + ' to check them and record the visit.';
      next = { label: 'Record a visit', to: 'bait' };
    }
  } else if (bait && bait.finished && group === 'done') {
    status = 'Treated, baiting finished';
    hint = 'Finished. ' + who.charAt(0).toUpperCase() + who.slice(1) + ' has their treatment certificate and visit reports.';
  }

  const answered = a && !a.stale;
  const sentOn = d.issue ? d.issue.completedAt : d.sent ? d.sent.at : null;
  const steps = [
    { label: 'Report', to: 'report', state: reportDone ? 'done' : 'todo',
      text: d.sent ? `Sent ${dashDate(d.sent.at)}` : d.issue ? `Completed${sentOn ? ' ' + dashDate(sentOn) : ''}`
        : d.pdfAt ? `PDF made ${dashDate(d.pdfAt)}, not sent yet`
        : reportDone ? 'Ready to send' : 'In progress' },
    { label: 'Quote', to: 'quote', state: hasQuote && (q.sentAt || answered) ? 'done' : !hasQuote && reportDone && !needsQuote ? 'skip' : 'todo',
      text: hasQuote ? `${formatAUD(total).replace(/\.00$/, '')} · ${q.sentAt ? 'sent ' + dashDate(q.sentAt) : 'not sent yet'}`
        : reportDone && !needsQuote ? 'Not needed' : 'Not written yet' },
    { label: 'Client\'s answer', to: 'answer', state: answered ? (a.status === 'accepted' ? 'done' : 'bad') : !hasQuote && reportDone && !needsQuote ? 'skip' : 'todo',
      text: !a ? (hasQuote && q.sentAt ? 'Waiting on the client' : 'Not yet')
        : a.stale ? 'The quote changed after they answered'
        : a.status === 'accepted' ? `Accepted${a.by ? ' by ' + a.by : ''} ${dashDay(a.date)}`
        : `Declined ${dashDay(a.date)}${a.note ? ' · ' + a.note : ''}` },
    { label: 'Treatment', to: 'treatment', state: q && q.treatment ? 'done' : answered && a.status !== 'accepted' || !hasQuote && reportDone && !needsQuote ? 'skip' : 'todo',
      text: q && q.treatment ? `Done ${dashDay(q.treatment.date)} · certificate ${q.certificateSentAt ? 'sent' : q.certificateHandedAt ? 'given' : 'not sent'}` : 'Not recorded yet' },
  ];
  steps.forEach(s => { if (s.state === 'skip') s.text = clientNotGoingAhead ? 'Skipped, client not going ahead' : 'Not needed'; });
  // Each step just says whether it's done; the preview has the detail. A declined answer keeps its wording.
  // The job page keeps the fuller wording (when, who, how much).
  steps.forEach(s => { s.full = s.text; });
  steps.forEach(s => { if (s.state === 'done' || s.state === 'todo') s.text = s.state === 'done' ? 'Completed' : 'Not completed'; });
  // A PDF made but never sent isn't a finished report: the client still
  // hasn't got it (unless it went on the quote's link), so the step says so
  // instead of "Completed".
  if (!reportSent && reportDone && !reportWentWithQuote) Object.assign(steps[0], { state: 'now', ready: true, text: d.pdfAt ? 'PDF made, not sent yet' : 'Ready to send' });
  // Sent, then changed: the step says so, and it's the next one once
  // nothing else on the job is.
  else if (reportStale) { const line = d.amending ? 'Amended, not sent yet' : 'Changed since it was sent'; Object.assign(steps[0], { full: line }, onlyReportUnsent ? { state: 'now', ready: true, text: line } : {}); }
  // Recorded but the certificate hasn't gone: the treatment isn't finished.
  if (q && q.treatment && !certificateGiven(q) && steps[3].state === 'done') Object.assign(steps[3], { state: 'now', text: 'Certificate not emailed yet' });
  // Bait station visits, as a fifth stage once a baiting system is in.
  if (bait) {
    const st = baitJobStep(bait);
    if (bait.last && !bait.last.sentAt) Object.assign(st, { state: 'now', text: 'Visit report not emailed yet' });
    steps.push(st);
  }
  if (group !== 'done' && !steps.some(s => s.state === 'now')) { const s = steps.find(s => s.state === 'todo'); if (s) s.state = 'now'; }
  // Everything the job needs is done (bait checks may still be coming):
  // the job page offers to finalise it into one PDF.
  const finished = group === 'done' || baitWaiting || onlyReportUnsent;
  return { r, q, group, status, hint, next, steps, total, time: dashboardJobTime(r), finished, onlyReportUnsent, reportStale, clientNotGoingAhead };
}

function setDashboardTab(tab) {
  dashboardTab = tab;
  const search = document.getElementById('dashboardSearch');
  if (search) search.value = '';
  renderDashboardJobs(true);
}

// When a job is, as an inspector says it: Today, Yesterday, Tomorrow, the
// weekday within the week, else the date.
function dashWhen(ts) {
  const n = dashDaysAway(ts);
  if (n === 0) return 'Today';
  if (n === -1) return 'Yesterday';
  if (n === 1) return 'Tomorrow';
  if (Math.abs(n) < 7) return new Date(ts).toLocaleDateString('en-AU', { weekday: 'short' });
  return dashDate(ts);
}

// Before the report's under way, the agreement comes first. There are two
// ways to get it signed, and the card offers both (ways): a link the client
// signs from, which leads on a job booked for a later day with an email to
// send it to (the client isn't there, so it goes out when the job is
// booked), and signing on this phone, which leads on the day. Once a link
// has gone, the job is waiting on the client and says so, with the day it
// went (sent: true).
function agreementNext(d, client) {
  const sent = !d.agreement && d.agreementRequest;
  const who = String((sent && sent.signerName) || client || '').trim().split(/\s+/)[0] || 'the client';
  if (sent) return { status: `Agreement sent ${dashDate(sent.emailedAt || sent.sentAt)}, waiting on ${who}`, sent: true,
    hint: 'It shows as signed here once they sign. They can still sign on this phone instead.',
    next: { label: 'Open the agreement', to: 'agreement' } };
  const email = String(d.jobClientEmail || '').trim();
  const day = d.jobInspectionDate && d.jobInspectionDate > todayIsoDate() ? new Date(d.jobInspectionDate + 'T00:00:00') : null;
  const later = day && !isNaN(day);
  const link = { way: 'link', label: directEmail && email ? `Email it to ${who} to sign` : `Send ${who} a link to sign` };
  const phone = { way: 'phone', label: 'Sign on this phone' };
  const ways = later && email ? [link, phone] : [phone, link];
  return { status: 'Get the agreement signed', ways,
    hint: ways[0] === link
      ? `The inspection is on ${day.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}, so ${who} can sign from ${directEmail ? `an email before then. It goes to ${email}.` : 'a link before then.'}`
      : 'The client signs it before the inspection starts.',
    next: { label: ways[0].label, to: 'agreement', way: ways[0].way } };
}

// A job's next step on the Jobs list, as on the job page: the agreement
// first, until it's signed.
function dashNext(j) {
  const d = j.r.reportData || {};
  return j.group === 'todo' && !d.agreement && j.status === 'Finish the report'
    ? agreementNext(d, j.r.client)
    : { status: j.status, hint: j.hint, next: j.next };
}

// The day in the card's corner. A booking still to come carries its time
// ("Tomorrow 9am"), once the job has one.
function dashCardWhen(j) {
  const day = dashWhen(j.time);
  const at = /^(\d{1,2}):(\d{2})/.exec(String((j.r.reportData || {}).jobInspectionTime || ''));
  if (!at || j.group !== 'todo' || dashDaysAway(j.time) < 0) return day;
  return `${day} ${(+at[1] % 12) || 12}${at[2] === '00' ? '' : ':' + at[2]}${+at[1] < 12 ? 'am' : 'pm'}`;
}

// One job on the Jobs list: the street big and the suburb under it, the
// client, how far along it is, and the next step as its own button, so a
// job in To do is one tap from its next document. The card opens the
// job's page (This job).
function dashCardHTML(j) {
  const id = j.r.id;
  const steps = jobPageSteps(j);
  const addr = (j.r.address || 'No address').trim();
  const cut = addr.indexOf(', ');
  const street = cut > 0 ? addr.slice(0, cut) : addr;
  const suburb = cut > 0 ? addr.slice(cut + 2) : '';
  const next = dashNext(j);
  const declined = j.group === 'done' && /declined|not going ahead/i.test(j.status);
  const tile = j.group === 'todo' ? [next.sent ? 'wait' : 'now', next.next ? next.next.to : 'report']
    : j.group === 'waiting' ? ['wait', 'clock'] : declined ? ['', 'answer'] : ['done', 'tick'];
  // The client, then where the job is up to, which stays in one piece when
  // the line is too long for the card.
  const sub = [j.r.client ? `<span>${escapeHtml(j.r.client)}</span>` : '', j.group !== 'todo' ? `<span class="dash-card-status">${escapeHtml(j.status)}</span>` : ''].join('');
  const act = next.next && j.group === 'todo' ? next.status : next.next ? next.next.label : '';
  // Two cards for one address after a sync clash: the one from this phone
  // says so. A job the account doesn't hold yet says that too.
  const tags = (id === currentReportId ? '<span class="dash-card-tag">This job</span>' : '')
    + (isSampleJob(j.r) ? '<span class="dash-card-tag sample">Sample</span>' : '')
    + (j.r.conflictCopy ? '<span class="dash-card-tag warn">Copy from this phone</span>' : '')
    + (leftOffAccount(j.r) ? '<span class="dash-card-tag warn">Not in your account yet</span>' : '');
  const arrow = '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';
  return `
    <div class="dash-card ${j.group}${declined ? ' declined' : ''}">
      <button type="button" class="dash-card-main" onclick="openDashboardJob('${id}', 'job')">
        <span class="job-tile ${tile[0]}" aria-hidden="true">${jobIcon(tile[1], 20)}</span>
        <span class="dash-card-text">
          <span class="dash-card-street">${escapeHtml(street)}</span>
          ${suburb ? `<span class="dash-card-suburb">${escapeHtml(suburb)}</span>` : ''}
          ${sub || tags ? `<span class="dash-card-sub">${tags}${sub}</span>` : ''}
        </span>
        <span class="dash-card-end">
          <span class="dash-card-when">${dashCardWhen(j)}</span>
          ${j.total ? `<span class="dash-card-total">${formatAUD(j.total).replace(/\.00$/, '')}</span>` : ''}
        </span>
        <span class="dash-card-progress" aria-hidden="true">${jobStepsCounted(steps).map(st => `<i class="${st.state}"></i>`).join('')}</span>
      </button>
      ${act ? `<button type="button" class="dash-card-act${next.sent ? ' wait' : ''}" onclick="openDashboardJob('${id}', '${next.next.way === 'link' ? 'agreementLink' : next.next.to}')"><span>${escapeHtml(act)}</span>${arrow}</button>` : ''}
    </div>`;
}

// New job, from the Jobs list, the job page or the menu: the open job is
// saved, the screen emptied, and the job page opens with the address ready
// to type.
function startNewJob() {
  if (document.getElementById('app').style.display !== 'flex') openApp('inspect');
  newReport(true);
  tabGo('job');
  const addr = document.getElementById('jobAddress');
  if (addr) addr.focus({ preventScroll: true });
}

// Every saved job, read as the list shows it, and the headline over them:
// how many need the inspector today, then what's booked for later and any
// re-inspections that are overdue, which opens the Due tab.
function readDashboardJobs() {
  const quotes = getSavedQuotes();
  dashboardJobs = getSavedReports().map(r => dashboardJob(r, quotes)).sort((a, b) => b.time - a.time);
  const body = document.getElementById('dashboardBody');
  // Nothing saved at all: no tabs or search, just the way in.
  if (body) body.classList.toggle('no-jobs', !dashboardJobs.length);
  const title = document.getElementById('dashboardLead');
  if (!title) return;
  const need = jobsNeedingYou(dashboardJobs);
  // The sample alone isn't work done: a new business still has no jobs.
  title.innerHTML = !dashboardJobs.some(j => !isSampleJob(j.r)) ? 'No jobs yet.'
    : need.today ? `<b>${need.today} job${need.today === 1 ? '' : 's'}</b> need${need.today === 1 ? 's' : ''} you today.`
    : need.later ? 'Nothing needs you today.'
    : 'You\'re all caught up.';
  const overdue = typeof reinspectionsDue === 'function' ? reinspectionsDue().filter(it => it.overdue).length : 0;
  const more = document.getElementById('dashboardMore');
  more.innerHTML = [
    need.later ? `<span>${need.later} booked for later</span>` : '',
    overdue ? `<button type="button" onclick="setDashboardTab('due')">${overdue} re-inspection${overdue === 1 ? '' : 's'} overdue</button>` : '',
  ].filter(Boolean).join('<i aria-hidden="true">·</i>');
  more.hidden = !more.innerHTML;
}

function renderDashboard() {
  const body = document.getElementById('dashboardBody');
  if (!body) return;
  parkJobPanel();
  const today = new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
  body.innerHTML = `
    <div class="dash-hero">
      <span class="dash-hero-date">${today}</span>
      <p class="dash-hero-title" id="dashboardLead"></p>
      <p class="dash-hero-more" id="dashboardMore" hidden></p>
    </div>
    <div class="dash-tabs" id="dashboardTabs" role="tablist">
      ${DASHBOARD_TABS.map(([key, label]) => `<button type="button" role="tab" class="dash-tab" data-tab="${key}" onclick="setDashboardTab('${key}')">${label} <span></span></button>`).join('')}
      <span class="dash-tab-line" aria-hidden="true"></span>
    </div>
    <label class="dash-search" id="dashboardSearchWrap">
      <svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z"/><path d="m21 21-4.3-4.3"/></svg>
      <input id="dashboardSearch" type="search" placeholder="Search address or client" autocomplete="off" oninput="renderDashboardJobs()" aria-label="Search jobs">
    </label>
    <div id="dashboardJobs"></div>
  `;
  readDashboardJobs();
  renderDashboardJobs();
}

// The tab counts and underline, and the job list. Redrawn on their own so
// typing in the search box keeps the keyboard up and the underline slides.
// fade: the list fades in (on a tab change).
function renderDashboardJobs(fade) {
  const wrap = document.getElementById('dashboardJobs');
  if (!wrap) return;
  parkJobPanel();
  const counts = { current: '', todo: 0, waiting: 0, done: 0, all: dashboardJobs.length };
  dashboardJobs.forEach(j => counts[j.group]++);
  counts.due = typeof reinspectionsDue === 'function' ? reinspectionsDue().length : 0;
  const searchEl = document.getElementById('dashboardSearch');
  const query = searchEl ? searchEl.value.trim().toLowerCase() : '';
  const shown = dashboardJobs.filter(j => query
    ? [j.r.address, j.r.client, j.r.jobSuburb, j.r.jobPostcode].filter(Boolean).join(' ').toLowerCase().includes(query)
    : dashboardTab === 'all' || j.group === dashboardTab);
  // To do runs the way the week does: anything still open from an earlier
  // day, then today, then what's booked for later, each in the order it
  // comes. The other lists (and a search) are newest first.
  const byDay = dashboardTab === 'todo' && !query;
  if (byDay) shown.sort((a, b) => a.time - b.time);
  const part = j => { const n = dashDaysAway(j.time); return n < 0 ? 'Still open from earlier' : n ? 'Coming up' : 'Today'; };
  const parted = byDay && new Set(shown.map(part)).size > 1;
  const cards = shown.map((j, i) => (parted && (!i || part(shown[i - 1]) !== part(j)) ? `<h3 class="dash-part">${part(j)}</h3>` : '') + dashCardHTML(j)).join('');
  // Finished jobs taken off a full phone are still in the account: the
  // line sits where they'd be looked for, under Done and under a search.
  const parked = getArchivedReportIds().length;
  const parkedNote = parked && (query || dashboardTab === 'done' || !dashboardJobs.length)
    ? `<p class="dash-parked">${parked} older job${parked === 1 ? ' is' : 's are'} kept in your account only. <button type="button" class="link-btn" onclick="restoreArchivedReports()">Bring ${parked === 1 ? 'it' : 'them'} back</button></p>`
    : '';

  const tabs = document.getElementById('dashboardTabs');
  if (tabs) {
    tabs.classList.toggle('searching', !!query);
    tabs.querySelectorAll('.dash-tab').forEach(btn => {
      const on = btn.dataset.tab === dashboardTab;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on);
      btn.querySelector('span').textContent = counts[btn.dataset.tab];
    });
    // The tabs are as wide as their names, so the underline is sized to the lit one.
    const lit = tabs.querySelector('.dash-tab.active');
    const line = tabs.querySelector('.dash-tab-line');
    if (lit) {
      line.style.width = lit.offsetWidth + 'px';
      line.style.transform = `translateX(${lit.offsetLeft}px)`;
      if (lit.scrollIntoView && tabs.scrollWidth > tabs.clientWidth) tabs.scrollTo({ left: lit.offsetLeft - 16, behavior: fade ? 'smooth' : 'auto' });
    }
  }
  const empty = query ? `No jobs match "${escapeHtml(searchEl.value.trim())}".`
    : !dashboardJobs.length ? 'Your jobs will show up here once you save a report.'
    : { todo: 'Nothing to do right now.', waiting: 'Nothing is waiting on a client.', done: 'No finished jobs yet.' }[dashboardTab];
  if (dashboardTab === 'due' && !query && typeof renderReinspectionList === 'function') { wrap.innerHTML = renderReinspectionList(fade); return; }
  wrap.innerHTML = (shown.length ? `
    <div class="dash-cards${fade ? ' fade-in' : ''}">
      ${cards}
    </div>` : !query && !dashboardJobs.length ? `
    <div class="dash-start${fade ? ' fade-in' : ''}">
      <span class="job-tile now" aria-hidden="true">${jobIcon('details', 22)}</span>
      <p class="dash-start-title">Start your first job</p>
      <p class="dash-start-text">Type the address, get the agreement signed, then tap the mic and talk through the inspection. The job shows up here.</p>
      <button type="button" class="dash-detail-primary" onclick="startNewJob()">New job</button>
    </div>
    ${typeof openSampleJob === 'function' ? `<div class="dash-sample${fade ? ' fade-in' : ''}">
      <p class="dash-sample-title">Or see a finished job first</p>
      <p class="dash-sample-text">A made-up job from start to finish, with your business on every page: the agreement, report, quote, the client's signed answer and the treatment certificate.</p>
      <button type="button" class="dash-sample-btn" onclick="openSampleJob('jobs')">See a sample job</button>
    </div>` : ''}` : `<p class="dash-none${fade ? ' fade-in' : ''}">${empty}</p>`) + parkedNote;
}

// The sheet over the list: the Due tab's properties (js/reinspection.js).
// A job's card opens the job's own page instead (openDashboardJob).
function closeDashboardDetail() {
  const el = document.getElementById('dashboardDetail');
  if (el) el.classList.remove('open');
}

// Opens a job from the Jobs list: its page ('job'), or straight to one of
// its documents (the card's next-step button). The job becomes This job. A
// sheet opened this way and closed unfinished comes back to the list.
function openDashboardJob(id, to) {
  closeDashboard();
  loadReport(id, true);
  jobGo(to, 'jobs');
}

// ── LINKS OUT ─────────────────────────────────────────────────────────────
// Every link a client hasn't answered yet (an agreement to sign, a quote
// to accept or decline) is read back in one request when Jobs opens, so
// nobody has to open each job to find out. One that came back moves its
// job on the list and says so.
const LINKS_CHECK_MS = 60000;
let linksCheckedAt = 0;
function linksOut() {
  const quotes = getSavedQuotes();
  const out = [];
  getSavedReports().forEach(r => {
    const d = r.reportData || {};
    const street = String(r.address || '').split(', ')[0];
    if (d.agreementRequest && d.agreementRequest.id && !d.agreement) out.push({ id: d.agreementRequest.id, kind: 'agreement', reportId: r.id, street });
    const q = quotes[r.id];
    if (q && q.linkRequest && q.linkRequest.id && !q.answer) out.push({ id: q.linkRequest.id, kind: 'quote', reportId: r.id, street });
  });
  return out;
}
async function checkLinksOut() {
  if (!authSession || !navigator.onLine || Date.now() - linksCheckedAt < LINKS_CHECK_MS) return;
  const out = linksOut();
  if (!out.length) return;
  linksCheckedAt = Date.now();
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/sign_requests?id=in.(${out.map(l => encodeURIComponent(l.id)).join(',')})&select=id,status,signer_name,signature,signed_at,note`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();
    const back = [];
    out.forEach(l => {
      const row = rows.find(x => x.id === l.id);
      if (!row) return;
      const said = l.kind === 'quote' ? takeQuoteLinkAnswer(l.reportId, row) : takeSignedAgreement(l.reportId, row);
      if (said) back.push({ id: l.reportId, said: `${said} for ${l.street || 'a job'}` });
    });
    if (!back.length) return;
    refreshJobsList();
    if (back.length === 1) showToast(back[0].said, 'success', { label: 'Open', run: () => openDashboardJob(back[0].id, 'job') });
    else showToast(`${back.length} came back: ${back.map(b => b.said).join('. ')}`, 'success');
  } catch (e) { /* no signal, or the account is down: the next open asks again */ }
}

// Safe inside text and inside quoted attributes (value="…", src="…").
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── STATUS / TOAST ────────────────────────────────────────────────────────
function setAI(state, text) {
  document.getElementById('aiStatus').textContent = text;
  document.getElementById('aiDot').className = 'ai-dot' + (state === 'thinking' ? ' thinking' : '');
  // The bar under the header shows the AI is working even with the voice
  // popover closed, so nobody taps Extract twice or thinks it failed.
  const busy = state === 'thinking';
  document.body.classList.toggle('ai-busy', busy);
  updateVoiceHud();
  const busyText = document.getElementById('aiBusyText');
  if (busyText && busy) busyText.textContent = text;
  // A fill can take a while on a slow connection. The inspector doesn't
  // have to stand there: the note can wait with the others.
  const keep = document.getElementById('aiKeepBtn');
  if (keep) keep.hidden = !(busy && /Filling in/.test(text));
}

// action: optional { label, run } adds a button to the toast (e.g. Undo).
function showToast(msg, type = 'default', action) {
  const t = document.getElementById('toast');
  clearTimeout(t._timeout);

  const svgIcon = (path) => `<svg class="icon toast-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

  const icons = {
    success: svgIcon('<path d="M20 6 9 17l-5-5"/>'),
    error: svgIcon('<path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
    info: svgIcon('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
    default: svgIcon('<circle cx="12" cy="12" r="9"/><circle class="logo-dot" cx="12" cy="4" r="2" fill="currentColor"/>'),
  };

  t.innerHTML = `${icons[type] || icons.default}<span>${escapeHtml(String(msg))}</span>`;
  // Where inspectors get stuck. Toasts are the app's own wording; details
  // in brackets (an error's own text) and any email or long number are
  // blanked before it's sent.
  if (type === 'error') track('error_shown', { message: scrubTelemetryText(String(msg).replace(/\([^)]*\)/g, '(…)')) });
  t.className = 'toast show toast-' + type + (action ? ' toast-has-action' : '');
  if (action) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.onclick = () => { dismissToast(); action.run(); };
    t.appendChild(btn);
  }

  t._shownAt = Date.now();
  // Errors, and toasts with a button to press, stay up longer.
  t._timeout = setTimeout(() => t.classList.remove('show'), (action && action.ms) || ((type === 'error' || action) ? 6000 : 2800));
}

function dismissToast() {
  const t = document.getElementById('toast');
  if (!t) return;
  clearTimeout(t._timeout);
  t.classList.remove('show');
}

// A toast belongs to the screen it was shown on: when the screen changes
// (the menu, a menu page, the quote screen, the dashboard or a sheet opens
// or closes), an older toast goes, so it never sits over the next screen's
// buttons. A toast shown by the same tap that changed the screen stays.
function installToastScreenWatch() {
  // The toast sits inside the report app's markup, so it was hidden with
  // the app (on the quote screen, for one). It belongs to the page.
  const toast = document.getElementById('toast');
  if (toast && toast.parentElement !== document.body) document.body.appendChild(toast);
  const ids = ['app', 'quoteScreen', 'sidebarPanel', 'dashboardOverlay'];
  const targets = ids.map(id => document.getElementById(id))
    .concat([...document.querySelectorAll('.page-sheet-overlay, .menu-page, .saved-panel')])
    .filter(Boolean);
  const obs = new MutationObserver(() => {
    const t = document.getElementById('toast');
    if (t && t.classList.contains('show') && Date.now() - (t._shownAt || 0) > 400) dismissToast();
  });
  targets.forEach(el => obs.observe(el, { attributes: true, attributeFilter: ['class', 'style'] }));
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installToastScreenWatch);
else installToastScreenWatch();

// ── FINALISED JOBS ────────────────────────────────────────────────────────
// A job has one ending: Finalise, on This job, once its steps are done
// (jobCanFinalise). It locks the report and its quote together, so what's
// saved always matches what the client received, and makes the job PDF
// (makeJobPdf in js/job-pack.js). Changing anything afterwards means Amend,
// from This job, with a reason; sending again and finalising again makes
// it version 2, and the report PDF lists every version with its reason.
//   reportData.reportNumber  stable reference printed on every PDF
//   reportData.sent          { at, fingerprint, version } - last send
//   reportData.issue         { version, completedAt, completedBy, fingerprint, fieldHashes }
//   reportData.issueHistory  [{ version, completedAt, completedBy, reason, changed[], fingerprint }]
//   reportData.amending      { reason, startedAt } - unlocked for an amendment
//   reportData.noQuoteNeeded true when the client isn't going ahead with a quote
// The quote's own sent state lives on the quote (see SENT AND LOCKED in js/quote.js).
// Kept on the job but not part of the report as the client reads it, so a
// change to one isn't a change to the report.
const ISSUE_META_KEYS_FIRST = ['reportNumber', 'sent', 'issue', 'issueHistory', 'amending', 'pendingNotes', 'noQuoteNeeded', 'noteText', 'heardNotes', 'weatherFilled', 'naFromHouse', 'jobPdfAt', 'jobPdfSentAt', 'copyTo', 'copySent', 'doneAt'];
// Added on 10 Nov 2026, when a report started saying it had changed since
// it was sent. A fingerprint from before then was taken with these in.
const ISSUE_META_KEYS_LATER = ['pdfAt', 'agreementRequest', 'quoteSpoken', 'lastVisit', 'lastVisitDismissed', 'jobFee', 'aiFilled', 'treatmentAutoSet', 'noneFromAreas'];
const ISSUE_META_KEYS = [...ISSUE_META_KEYS_FIRST, ...ISSUE_META_KEYS_LATER];
const ISSUE_SECTION_NAMES = { job:'Job details', quote:'Quote', property:'Property', obstructions:'Areas inspected', restrictions:'Areas unable to be inspected',
  findings:'Findings', conducive:'Conducive', recommendations:'Recommendations', photos:'Photos', signoff:'Sign-off' };

function isReportLocked() { return !!(reportData.issue && !reportData.amending); }

// SHA-256 (synchronous, so Send can check the PDF is current without losing
// the tap the share sheet needs).
function sha256Hex(str) {
  const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const bytes = new TextEncoder().encode(str);
  const len = bytes.length, padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(bytes); padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, len * 8 >>> 0); dv.setUint32(padded.length - 8, Math.floor(len / 0x20000000));
  const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const w = new Uint32Array(64), rot = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rot(w[i-15], 7) ^ rot(w[i-15], 18) ^ (w[i-15] >>> 3);
      const s1 = rot(w[i-2], 17) ^ rot(w[i-2], 19) ^ (w[i-2] >>> 10);
      w[i] = (w[i-16] + s0 + w[i-7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => { h[i] = (h[i] + v) >>> 0; });
  }
  return h.map(v => v.toString(16).padStart(8, '0')).join('');
}

// JSON with sorted keys, so the same content always gives the same hash.
function stableJson(v) {
  if (Array.isArray(v)) return '[' + v.map(stableJson).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined)
    .map(k => JSON.stringify(k) + ':' + stableJson(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}

// The report's content, keyed by field, plus the job details from the menu.
// asBefore: as fingerprints were taken before ISSUE_META_KEYS_LATER.
function reportContentParts(asBefore) {
  const parts = {};
  const meta = asBefore ? ISSUE_META_KEYS_FIRST : ISSUE_META_KEYS;
  Object.keys(reportData).forEach(k => { if (!meta.includes(k)) parts[k] = reportData[k]; });
  parts.job = ['jobAddress','jobSuburb','jobState','jobPostcode','jobClient','jobInspector']
    .map(id => (document.getElementById(id) || {}).value || '');
  return parts;
}
// The last one worked out is kept: it's asked for on every save and every
// redraw of the Finish step once a report has gone, and the hashing is the
// slow part.
let fingerprintKept = { json: '', hash: '' };
function reportFingerprint() {
  const json = stableJson(reportContentParts());
  if (json !== fingerprintKept.json) fingerprintKept = { json, hash: sha256Hex(json) };
  return fingerprintKept.hash;
}
// Whether the report still reads as it did when a fingerprint was taken
// (when it was sent, or finalised).
function reportMatches(fingerprint) {
  return !fingerprint || fingerprint === reportFingerprint() || fingerprint === sha256Hex(stableJson(reportContentParts(true)));
}
function formatFingerprint(fp) { return (fp || '').slice(0, 16).toUpperCase().match(/.{4}/g).join('-'); }
function reportFieldHashes() {
  const parts = reportContentParts(), out = {};
  Object.keys(parts).forEach(k => { out[k] = sha256Hex(stableJson(parts[k])).slice(0, 12); });
  return out;
}

// Section names whose content differs between two sets of field hashes.
function changedSections(before, after) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const names = new Set();
  keys.forEach(k => {
    if (ISSUE_META_KEYS.includes(k) || (before || {})[k] === (after || {})[k]) return;
    let sec = (k === 'job' || k === 'quote') ? k : Object.keys(SECTIONS).find(s => SECTIONS[s].fields.includes(k));
    if (!sec) {
      const el = document.getElementById('f-' + k);
      const section = el && el.closest('.report-section');
      sec = section ? section.id.replace('section-', '') : null;
    }
    names.add(ISSUE_SECTION_NAMES[sec] || 'Other details');
  });
  return [...names];
}

function ensureReportNumber() {
  if (!reportData.reportNumber) {
    reportData.reportNumber = 'SY-' + todayIsoDate().replace(/-/g,'') + '-' + Math.floor(Math.random()*9000+1000);
  }
  return reportData.reportNumber;
}
// The version the next PDF carries: the locked version, or the one being made.
function reportVersion() {
  const issue = reportData.issue;
  return issue ? issue.version + (reportData.amending ? 1 : 0) : 1;
}

function currentJobQuote() { return quoteForReport(currentReportId || 'draft', getFullAddress()); }

// The report's numbered sections, in print order. The app's section headers
// carry the same numbers (index.html), and the summary points to them.
const REPORT_PARTS = { client: 1, summary: 2, property: 3, areas: 4, access: 5, findings: 6, conducive: 7, recommendations: 8, photos: 9, terms: 10, inspector: 11, acknowledgement: 12 };
const OBS_ZONES_BY_LABEL = Object.fromEntries(Object.entries(OBS_ZONES).map(([z, zone]) => [zone.label, z]));

// The headline results, shared by the PDF's summary page and the review
// screen before sending. Tiles are [label, value, tone (bad | warn | good |
// none), detail].
// The conducive conditions a report records, as short phrases.
function conduciveConditions(rd) {
  const conducive = [];
  if (rd.waterLeaks === 'YES') conducive.push(`water leak${inBrackets(rd.leakLocation)}`);
  else if (rd.moistureReadings === 'YES') conducive.push('elevated moisture');
  if (rd.timberSoil === 'YES') conducive.push(`timber in contact with soil${inBrackets(rd.timberSoilDetails)}`);
  if (rd.weepHoles === 'BRIDGED') conducive.push('weep holes bridged');
  if (rd.antCapping === 'GAPS') conducive.push('gaps in the ant capping');
  else if (rd.antCapping === 'NONE') conducive.push('no ant capping on piers');
  if (rd.slabEdge === 'OBSTRUCTED') conducive.push('slab edge concealed');
  if (rd.subfloorVentilation === 'POOR') conducive.push('poor subfloor ventilation');
  if (rd.mouldSeen === 'YES') conducive.push(`mould growth${inBrackets(rd.mouldWhere)}`);
  if (rd.siteDrainage === 'POOR') conducive.push('poor site drainage');
  if (rd.subfloorDrainage === 'POOR') conducive.push('poor subfloor drainage');
  if (rd.nonDurableTimber === 'YES') conducive.push(`untreated or non-durable timber in a damp area${inBrackets([bracketText(rd.nonDurableTimberDetails), lowerFirst(bracketText(rd.nonDurableTimberWhere))].filter(Boolean).join(', '))}`);
  return conducive;
}

// What a "what to do next" line is about, to spot one that repeats another.
const NEXT_STEP_TOPICS = [/builder|engineer|structural/i, /leak|plumb|overflow|drip/i, /firewood|sleeper|timber\b.{0,25}\b(soil|ground)|stored timber/i,
  /weep/i, /slab edge/i, /\bvent/i, /gutter|downpipe/i, /\bmould/i, /drainage/i];

function reportSummary() {
  const fs = (reportData.findings || []).filter(f => f && f.termiteActivity);
  const live = fs.filter(f => f.termiteActivity === 'ACTIVE');
  const evidence = fs.filter(f => f.termiteActivity === 'INACTIVE');
  // Damage counts wherever it was found, including alongside live termites.
  const damaged = fs.filter(f => f.termiteActivity === 'INACTIVE' || (f.termiteActivity === 'ACTIVE' && !isBlankValue(f.damageDescription)));
  const termiteReferral = fs.some(f => f.structuralConcern === 'YES');
  const borerReferral = shownBorerFindings().some(b => b.structuralConcern === 'YES');
  const structural = termiteReferral || borerReferral;
  const unanswered = findingsMissingReferral();
  const conducive = conduciveConditions(reportData);
  const places = list => joinPlaces(list.map(f => f.activityLocation));
  const NR = 'NOT RECORDED';
  // A borer-only recommendation ("Borer treatment of the floorboards") is
  // not a termite treatment: the summary and next steps say so.
  const borerOnlyTreatment = !live.length && /borer|beetle|anobium|lyctus/i.test(reportData.treatmentType || '') && !/termite|barrier|bait|reticulation/i.test(reportData.treatmentType || '');
  const termiteTreatment = borerOnlyTreatment && reportData.treatmentRecommended === 'YES' ? 'NO' : reportData.treatmentRecommended;
  const limitedZones = areasNotFullyInspected();
  // What the risk rating rests on: the property, never the termite species.
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const basis = [];
  if (live.length) basis.push('live termites');
  else if (evidence.length) basis.push('old termite activity');
  else if (fs.length) basis.push('no termites seen');
  if (fs.some(f => f.nestLocated === 'YES')) basis.push('nest found');
  if (structural) basis.push('builder referral');
  if (conducive.length) basis.push(plural(conducive.length, 'conducive condition'));
  if (limitedZones.length) basis.push(`${plural(limitedZones.length, 'area')} not fully inspected`);
  // The summary asks the reader's questions in a fixed order, in three
  // groups, and each answer says which section has the detail. Items are
  // [question, answer, tone (bad | warn | good | none), section, detail].
  const acc = accessLimits();
  const yn = (yes, no) => yes ? 'YES' : no ? 'NO' : NR;
  const ynTone = (yes, no, bad = 'bad') => yes ? bad : no ? 'good' : 'none';
  const hinderedYes = acc.hindered.length > 0, restrictedYes = acc.restricted.length > 0;
  const hinderedNo = !hinderedYes && (hinderedAnswer() === 'NO' || (acc.allMarked && !limitedZones.length));
  const withNest = fs.filter(f => f.nestLocated === 'YES');
  const nestNo = fs.length && !withNest.length;
  const groups = [
    { title: 'Access', items: [
      ['Were there temporary obstructions?', yn(hinderedYes, hinderedNo), ynTone(hinderedYes, hinderedNo, 'warn'), REPORT_PARTS.access,
        zoneList(acc.hindered.filter(([l]) => OBS_ZONES_BY_LABEL[l]).map(([l]) => l))],
      ['Was access restricted (permanent or locked)?', yn(restrictedYes, acc.allMarked), ynTone(restrictedYes, acc.allMarked, 'warn'), REPORT_PARTS.access,
        zoneList(acc.restricted.filter(([l]) => OBS_ZONES_BY_LABEL[l]).map(([l]) => l))],
      ['High risk areas to which access should be gained?', yn(!!acc.highRisk, acc.allMarked), ynTone(!!acc.highRisk, acc.allMarked, 'warn'), REPORT_PARTS.access, acc.highRisk],
      ['Invasive inspection recommended?', { YES: 'YES', NO: 'NO' }[reportData.invasiveInspection] || NR,
        { YES: 'warn', NO: 'good' }[reportData.invasiveInspection] || 'none', REPORT_PARTS.access, reportData.invasiveInspectionDetails || ''],
    ] },
    { title: 'Activity', items: [
      ['Live termites found?', live.length ? 'YES' : fs.length ? 'NO' : NR, live.length ? 'bad' : fs.length ? 'good' : 'none', REPORT_PARTS.findings, places(live)],
      ['Termite nest found?', withNest.length ? 'YES' : nestNo ? 'NO' : NR, withNest.length ? 'bad' : nestNo ? 'good' : 'none', REPORT_PARTS.findings, places(withNest)],
      ['Termite workings or damage found?', damaged.length ? 'YES' : fs.length ? 'NO' : NR, damaged.length ? 'warn' : fs.length ? 'good' : 'none', REPORT_PARTS.findings, places(damaged)],
      ['Borers found?', { ACTIVE: 'ACTIVE', INACTIVE: 'OLD DAMAGE', NONE: 'NO' }[reportData.borerActivity] || NR,
        { ACTIVE: 'bad', INACTIVE: 'warn', NONE: 'good' }[reportData.borerActivity] || 'none', REPORT_PARTS.findings, joinPlaces(shownBorerFindings().map(b => b.location || borerLine(b)))],
      ['Wood decay (rot) found?', { YES: 'YES', NO: 'NO' }[reportData.decayFound] || NR,
        { YES: 'warn', NO: 'good' }[reportData.decayFound] || 'none', REPORT_PARTS.findings, whatWhere(reportData.decayDetails, reportData.decayWhere)],
      ['Chemical delignification found?', { YES: 'YES', NO: 'NO' }[reportData.delignification] || NR,
        { YES: 'warn', NO: 'good' }[reportData.delignification] || 'none', REPORT_PARTS.findings, whatWhere(reportData.delignificationDetails, reportData.delignificationWhere)],
      ['Evidence of a previous termite treatment?', { YES: 'YES', NO: 'NO' }[reportData.previousTreatment] || NR,
        { YES: 'warn', NO: 'good' }[reportData.previousTreatment] || 'none', REPORT_PARTS.findings, whatWhere(reportData.previousTreatmentDetails, reportData.previousTreatmentWhere)],
    ] },
    { title: 'Safety & risk', items: [
      ['Builder or engineer referral?', structural ? 'YES' : unanswered.length ? 'NOT ANSWERED' : fs.length ? 'NO' : NR,
        structural ? 'bad' : unanswered.length ? 'warn' : fs.length ? 'good' : 'none', REPORT_PARTS.findings,
        !structural && unanswered.length ? `Finding${unanswered.length === 1 ? '' : 's'} ${unanswered.join(', ')}: not answered` : ''],
      ['Conditions conducive to timber pests?', conducive.length ? `${conducive.length} FOUND` : 'NONE RECORDED', conducive.length ? 'warn' : 'none', REPORT_PARTS.conducive,
        conducive.join('; ').replace(/^./, ch => ch.toUpperCase())],
      ['Termite treatment recommended?', { YES: 'YES', NO: 'NO' }[termiteTreatment] || NR,
        { YES: 'bad', NO: 'good' }[termiteTreatment] || 'none', REPORT_PARTS.recommendations, reportData.treatmentType || ''],
      ['Risk of termite attack', reportData.riskLevel || NR, { HIGH: 'bad', MEDIUM: 'warn', LOW: 'good' }[reportData.riskLevel] || 'none', REPORT_PARTS.recommendations,
        reportData.riskLevel && basis.length ? `Based on ${basis.join(', ')}` : ''],
      ['Next inspection', nextInspectionChip(reportData.inspectionFrequency), 'none', REPORT_PARTS.recommendations,
        reportData.inspectionFrequency && nextInspectionChip(reportData.inspectionFrequency) !== String(reportData.inspectionFrequency).trim().toUpperCase()
          ? String(reportData.inspectionFrequency).trim().replace(/^next (timber pest )?inspection:?\s+/i, '').replace(/^./, ch => ch.toUpperCase()) : ''],
    ] },
  ];
  // Areas the inspector couldn't fully see, and why.
  const limited = limitedZones.map(z => {
    const why = ((reportData.areaReasons || {})[z] || []).join(', ');
    return `${zoneName(z)}: ${areaStatusOf(z) === 'NOT' ? 'not inspected' : 'inspected with limits'}${why ? ` (${why.toLowerCase()})` : ''}`;
  });
  const next = [];
  if (live.length || (reportData.treatmentRecommended === 'YES' && !borerOnlyTreatment)) {
    next.push(`Termite treatment${reportData.treatmentType ? `: ${reportData.treatmentType}` : ` (see Section ${REPORT_PARTS.recommendations})`}.`);
  }
  if (structural) {
    const what = termiteReferral && borerReferral ? 'termite and borer damage' : termiteReferral ? 'termite damage' : 'borer damage';
    next.push(`Have a licensed builder or structural engineer assess the ${what} before any repairs.`);
  }
  if (reportData.borerActivity === 'ACTIVE' || borerOnlyTreatment) next.push(borerOnlyTreatment ? `${reportData.treatmentType.trim().replace(/\.$/, '')}, and replace badly affected timbers.` : 'Treat the active borers and replace badly affected timbers.');
  if (reportData.decayFound === 'YES') next.push('Have a builder repair the decayed timbers, and fix the moisture that caused the decay.');
  if (reportData.delignification === 'YES') next.push('Have a builder check and replace the delignified timbers where needed.');
  if (conducive.length) next.push(`Fix the conditions that attract termites: ${conducive.join('; ')}.`);
  if (reportData.invasiveInspection === 'YES') {
    next.push(`Invasive timber pest inspection${reportData.invasiveInspectionDetails ? `: ${reportData.invasiveInspectionDetails}` : ''}. This needs a separate agreement.`);
  }
  if (!isBlankValue(reportData.otherRecommendations)) {
    // The other recommendations often say again what's above (the builder,
    // the leak, the firewood). Each part that only repeats it is left out
    // here; Section ${REPORT_PARTS.recommendations} still has them in full.
    const said = next.join(' ');
    const other = String(reportData.otherRecommendations).trim().replace(/\.$/, '')
      .split(/;\s*|\.\s+/).map(c => c.trim()).filter(Boolean)
      .filter(c => { const topics = NEXT_STEP_TOPICS.filter(t => t.test(c)); return !topics.length || !topics.every(t => t.test(said)); })
      .join('; ');
    if (other) next.push(`Also recommended: ${other.charAt(0).toLowerCase()}${other.slice(1)}.`);
  }
  getRecLines().forEach(l => next.push(l.text));
  if (limitedZones.length) next.push(`Provide access to the ${joinWithAnd(limitedZones.map(z => OBS_ZONES[z].label.replace(/^The /, '').toLowerCase()))} for a follow-up inspection.`);
  next.push(nextInspectionStep(reportData.inspectionFrequency));
  return { groups, limited, next, basis };
}

// ── WHAT THE REPORT IS STILL MISSING ──
// One list. Finish, the check before sending, the percentage in the corner
// and the job's Finalise step all read it, so they can't disagree. It runs
// in the order a job is done: the job's details, the agreement, then the
// report's steps. A line is either required answers left blank
// (REQUIRED_FIELDS, one line a step, so a skipped step isn't eight lines)
// or something worth a second look (two answers that disagree, a note
// still waiting). Each has the buttons that fix it there and then, or
// "Show me", which goes to it in the report.
function reportPrepItems() { return reportPrepGaps().map(g => g.text); }

// What the list calls a required answer where the screen's own label
// needs its heading to make sense.
const REQUIRED_NAMES = { weatherConditions: 'weather conditions', findings: 'termite activity' };
// How many required answers a report has: the address, the agreement, the
// inspector's signature and every REQUIRED_FIELDS answer bar the hindered
// access one, which is answered by the same taps as the area statuses.
const reportRequiredCount = () => 1 + Object.values(REQUIRED_FIELDS).flat().filter(k => k !== 'hinderedAreas').length;

// from: the screen the buttons come back to ('send', 'extract' or 'finish').
// Each line: key (what kind of gap, so a sheet can leave some out), text,
// fix (the buttons' HTML), targets (the places in the report "Show me" and
// its Next walk through, in order), n (how many things it stands for),
// required (they are required answers) and blank (an answer not given, as
// against one worth a second look).
function reportPrepGaps(from = 'send') {
  const gaps = [];
  const push = (key, text, fix, more) => gaps.push(Object.assign({ key, text, fix: fix || '', n: 1 }, more));
  const fixBtn = (kind, label) => `<button class="link-btn" onclick="fixReportGap('${kind}', '${from}')">${label}</button>`;
  const show = (target, label) => fixBtn('go:' + target, label || 'Show me');
  // A step's required answers that are blank, as one line naming them in
  // the order they sit on the screen.
  const blanks = (step, title, keys) => {
    const open = keys.filter(k => !isFieldFilled(k)).map(k => {
      const el = document.getElementById(k === 'findings' ? 'section-findings' : 'f-' + k);
      const label = el && el.closest('.field') && el.closest('.field').querySelector('.field-label');
      return { k, el, name: REQUIRED_NAMES[k] || (label ? lowerFirst(label.childNodes[0].textContent.trim()) : k) };
    }).filter(b => b.el).sort((a, b) => a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    if (!open.length) return;
    const names = open.map(b => b.name);
    const text = names.length > 3 ? `${title}: ${names.length} answers are blank, starting with ${names[0]}`
      : `${title}: ${joinWithAnd(names)} ${names.length === 1 ? 'isn\'t' : 'aren\'t'} answered`;
    push('blank:' + step, text, show(open[0].el.id), { targets: open.map(b => b.el.id), n: open.length, required: true, blank: true });
  };

  if (!document.getElementById('jobAddress').value.trim()) push('address', 'The job has no property address', fixBtn('address', 'Add it'), { required: true, blank: true });
  // The agreement comes before the report is touched, so it leads the list.
  if (!reportData.agreement && reportData.agreementRequest) push('agreement', `The agreement link is waiting on ${reportData.agreementRequest.signerName || 'the client'} to sign`, fixBtn('agreement', 'Check it'), { required: true, blank: true });
  else if (!reportData.agreement) push('agreement', 'No pre-inspection agreement is recorded', fixBtn('agreement', 'Get it signed'), { required: true, blank: true });

  blanks('property', 'Property', REQUIRED_FIELDS.property);

  const unmarked = Object.keys(OBS_ZONES).filter(z => !areaStatusOf(z));
  // A few areas each get their own answer: "no outbuildings" and "the
  // sleeper wall was looked at" need different taps, and one button for
  // both got one of them wrong. Many at once keep the quick buttons.
  if (unmarked.length && unmarked.length <= 3) {
    unmarked.forEach((z, i) => push('status', `${zoneName(z)}: no inspection status${areaEvidence(z).length ? ' (a finding mentions it)' : ''}`,
      fixBtn('inspected:' + z, 'Inspected') + fixBtn('na:' + z, 'Not applicable'), { required: i === 0, blank: true }));
  } else if (unmarked.length) push('status', `${unmarked.length} areas have no inspection status (${joinWithAnd(unmarked.map(z => zoneName(z).toLowerCase()))})`,
    fixBtn('inspected', 'Mark the rest as inspected') + fixBtn('na', 'Mark the rest not applicable'), { required: true, blank: true });
  const noResult = areasMissingResult();
  if (noResult.length) push('result', `${noResult.length} area${noResult.length === 1 ? ' has' : 's have'} no result for what was found there (${joinWithAnd(noResult.map(z => zoneName(z).toLowerCase()))})`,
    fixBtn('clear', 'Mark the rest as nothing found'), { blank: true });
  // "Nothing found" over an area a finding names: the report would contradict itself.
  Object.keys(OBS_ZONES).filter(z => areaResultOf(z) === 'CLEAR' && areaEvidence(z).length).forEach(z =>
    push('contradiction', `${zoneName(z)}: marked "nothing found", but ${areaEvidence(z)[0].replace(/ \(.*$/, '')} is there`, fixBtn('found:' + z, 'Mark evidence found')));
  areasEvidenceUnlinked().forEach(z => push('evidence', `${zoneName(z)}: marked "evidence found", but no finding mentions it`, fixBtn('finding:' + z, 'Say what it was')));

  blanks('findings', 'Findings', REQUIRED_FIELDS.findings);
  findingsMissingReferral().forEach(n => {
    const f = reportData.findings[n - 1];
    push('referral', `Finding ${n}: "refer to a builder or engineer?" isn't answered`, f && f.id ? show(`finding-card-${f.id}:referral`) : '', { blank: true, targets: f && f.id ? [`finding-card-${f.id}:referral`] : [] });
  });

  blanks('conducive', 'Conducive', REQUIRED_FIELDS.conducive);
  // The three answers a client reads first: each is named when blank.
  blanks('recommendations', 'Advice', REQUIRED_FIELDS.recommendations);
  // AS 3660.2 recommends a timber pest inspection at least every 12 months,
  // so a longer interval is worth a second look before it goes out.
  const intervalMonths = longestInspectionIntervalMonths(reportData.inspectionFrequency);
  if (intervalMonths > 12) push('interval', `The next inspection is set ${intervalMonths % 12 ? intervalMonths + ' months' : (intervalMonths / 12) + ' years'} away. AS 3660.2 recommends one at least every 12 months`,
    fixBtn('interval12', 'Make it 12 months'));

  if (!isFieldFilled('inspectorLicence')) push('licence', 'Your pest licence number isn\'t on the report', show('inspectorLicence', 'Add it'), { required: true, blank: true, targets: ['inspectorLicence'] });
  if (!reportData.inspectorSignature) push('signature', 'The inspector hasn\'t signed', show('sigCanvasInspector', 'Sign it'), { required: true, blank: true, targets: ['sigCanvasInspector'] });

  const pending = (reportData.pendingNotes || []).length;
  if (pending) push('pending', `${pending} voice note${pending === 1 ? ' is' : 's are'} still waiting to be filled in`);
  // Photos the account never received are only on this phone: the PDF
  // has them today, but a lost phone or another device's copy won't. They
  // go up on their own with signal, so they don't hold the percentage back.
  const onlyHere = photosOnlyOnThisPhone().length;
  if (onlyHere && authSession) push('photos', `${onlyHere} photo${onlyHere === 1 ? ' is' : 's are'} only on this phone, not in your account yet`,
    fixBtn('photos', navigator.onLine ? 'Back up now' : 'Back up when online'), { n: 0 });
  // A completed job is locked, so nothing here offers to change it.
  if (isReportLocked()) gaps.forEach(g => { if (g.key !== 'photos') g.fix = ''; });
  return gaps;
}

// How far along the report is, off that list: 100% is nothing left on it.
// Required answers make up the whole; a second look still open adds to it.
function reportProgress() {
  const gaps = reportPrepGaps('finish');
  const open = gaps.reduce((sum, g) => sum + g.n, 0);
  const blank = gaps.reduce((sum, g) => sum + (g.blank ? g.n : 0), 0);
  const total = reportRequiredCount() + gaps.reduce((sum, g) => sum + (g.required ? 0 : g.n), 0);
  return { gaps, open, blank, checks: open - blank, total, pct: Math.max(0, Math.round((total - open) / total * 100)) };
}

// The list as the amber box Finish and the check sheet both show.
function reportGapsHtml(gaps) {
  return `<div class="send-review-label">Worth checking first</div><ul class="send-review-list">${gaps.map(g =>
    `<li><span class="send-review-gap-text">${escapeHtml(g.text)}</span>${g.fix ? `<span class="send-review-fixes">${g.fix}</span>` : ''}</li>`).join('')}</ul>`;
}

// The longest interval the re-inspection wording names, in months:
// "every 2 years" is 24, "3 months, then every 12 months" is 12, and
// wording with no interval in it is 0.
function longestInspectionIntervalMonths(freq) {
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, twelve: 12, eighteen: 18, 'twenty-four': 24 };
  let most = 0;
  for (const m of String(freq || '').matchAll(/(\d+(?:\.\d+)?|one|two|three|four|five|six|twelve|eighteen|twenty-four)\s*(month|year)s?\b/gi)) {
    const n = words[m[1].toLowerCase()] || parseFloat(m[1]);
    most = Math.max(most, Math.round(/^year/i.test(m[2]) ? n * 12 : n));
  }
  if (/\bevery other year\b|\bbiennial/i.test(freq || '')) most = Math.max(most, 24);
  return most;
}

function photosOnlyOnThisPhone() {
  return allReportPhotos(reportData).filter(p => !p.path);
}

// "Back up now" on the check sheet: the photos go up, and the sheet is
// drawn again with the gap gone or a reason it isn't.
async function backUpPhotosFromGap(from) {
  const reopen = () => from === 'send' ? openSendReview() : from === 'extract' ? showExtractSummary(extractSummaryBefore) : updateProgress();
  if (!navigator.onLine) { showToast('You\'re offline. The photos back up on their own once you\'re online', 'warn'); return; }
  const before = photosOnlyOnThisPhone().length;
  showToast(`Backing up ${before} photo${before === 1 ? '' : 's'}…`, 'info');
  let changed = false;
  try { changed = await uploadPendingPhotos(reportData); } catch (e) { reportError(e, 'photo_backup_gap'); }
  if (changed) { saveDraft(); if (currentReportId) saveCurrentReport(true); }
  const left = photosOnlyOnThisPhone().length;
  if (!left) showToast('Photos are in your account', 'success');
  else showToast(`${left} photo${left === 1 ? '' : 's'} couldn\'t be backed up. Check your signal and try again`, 'error');
  reopen();
}

// ── GAPS BEFORE YOU LEAVE ───────────────────────────────────────────────
// The same gaps, shown on the after-extract sheet while the inspector is
// still on site: what the standard asks for that the notes didn't cover,
// and a minute fixes it in the driveway. Signing and waiting notes are
// left out: they aren't on-site work, and nor is the licence number. The
// referral is on the Left blank list already, and the steps not reached
// yet aren't gaps mid-inspection.
function driveawayGaps() {
  const gaps = reportPrepGaps('extract').filter(g => !['pending', 'signature', 'licence', 'referral'].includes(g.key) && !g.key.startsWith('blank:'));
  const go = (target, label) => `<button class="link-btn" onclick="closeExtractSummary(); goToReportField('${target}')">${label}</button>`;
  if (isBlankValue(reportData.moistureReadings)) gaps.push({ key: 'moisture', text: 'Moisture readings: not recorded', fix: go('f-moistureReadings', 'Record') });
  if (isBlankValue(reportData.durableNoticePresent)) gaps.push({ key: 'notice', text: 'Durable notice in the meter box: not recorded', fix: go('f-durableNoticePresent', 'Record') });
  return gaps;
}

function setNoQuoteNeeded(on) {
  if (on) reportData.noQuoteNeeded = true; else delete reportData.noQuoteNeeded;
  saveDraft();
  renderIssueState();
}

// From the job's page: the client isn't going ahead, so no quote (and no
// treatment or bait visits) is owed. The same flag as "No quote needed".
function setClientNotGoingAhead(on) {
  setNoQuoteNeeded(on);
  saveOpenReportNow();
  renderJobPage();
  showToast(on ? 'Quote skipped. Send the report and finalise the job when you\'re ready' : 'Quote back on the list', 'info');
}

function inspectorDisplayName() {
  return (document.getElementById('jobInspector').value || '').trim() || (authUser && authUser.email) || 'Inspector';
}

// Called once the report was sent (see sendPdfsToClient).
function recordReportSent(fingerprint, version) {
  reportData.sent = { at: Date.now(), fingerprint, version };
  if (document.getElementById('jobAddress').value.trim()) saveCurrentReport(true); else saveDraft();
  renderIssueState();
}

// The one note for anything a locked job stops, with the way to Amend.
function sayLocked() {
  showToast('This job is finalised and locked. Amend it from This job', 'info', { label: 'This job', run: () => tabGo('job') });
}

// A job can be finalised once its steps are done (j: currentJobSummary()),
// which takes the client having the report as it stands: one that hasn't
// gone, or changed after it went, is still the next step.
function jobCanFinalise(j) {
  return !!j && j.finished && !j.onlyReportUnsent;
}

// Locks the report and quote as the next version. Returns a function that
// takes the lock back off, for a job PDF that then couldn't be made or sent.
function lockJob() {
  const before = { issue: reportData.issue, issueHistory: reportData.issueHistory, amending: reportData.amending };
  const fingerprint = reportFingerprint(), fieldHashes = reportFieldHashes();
  const quote = currentJobQuote();
  if (quoteHasItems(quote)) fieldHashes.quote = quoteContentHash(quote).slice(0, 12);
  const prev = reportData.issue, amending = reportData.amending;
  const version = reportVersion();
  const entry = { version, completedAt: Date.now(), completedBy: inspectorDisplayName(), fingerprint };
  if (amending) {
    entry.reason = amending.reason;
    entry.changed = changedSections(prev && prev.fieldHashes, fieldHashes);
  }
  reportData.issueHistory = [...(reportData.issueHistory || []), entry];
  reportData.issue = { version, completedAt: entry.completedAt, completedBy: entry.completedBy, fingerprint, fieldHashes };
  delete reportData.amending;
  renderIssueState();
  return () => {
    ['issue', 'issueHistory', 'amending'].forEach(k => { if (before[k] === undefined) delete reportData[k]; else reportData[k] = before[k]; });
    saveCurrentReport(true);
    renderIssueState();
  };
}

// Amend, from the finalised job's card on This job: why, then unlock.
function openAmendForm() {
  if (navPlace() !== 'job') tabGo('job');
  const form = document.getElementById('issueAmendForm');
  if (!form) return;
  form.hidden = false;
  form.scrollIntoView({ block: 'center' });
  document.getElementById('issueAmendReason').focus({ preventScroll: true });
}
function closeAmendForm() {
  const form = document.getElementById('issueAmendForm');
  if (form) form.hidden = true;
}
function startAmendment() {
  const reason = document.getElementById('issueAmendReason').value.trim();
  if (!reason) { showToast('Say why the job is being changed', 'error'); return; }
  reportData.amending = { reason, startedAt: Date.now() };
  track('report_unlocked');
  saveCurrentReport(true);
  renderIssueState();
  renderJobPage();
  showToast(`Unlocked. Changes become version ${reportVersion()}`, 'info');
}
// Back out of an amendment, only while nothing has been changed.
function cancelAmendment() {
  if (!reportData.amending || !reportData.issue) return;
  const quote = currentJobQuote();
  const quoteChanged = quoteHasItems(quote) && (reportData.issue.fieldHashes || {}).quote !== quoteContentHash(quote).slice(0, 12);
  if (!reportMatches(reportData.issue.fingerprint) || quoteChanged) {
    showToast('Changes have been made. Send them and finalise the job to finish the amendment', 'error');
    return;
  }
  delete reportData.amending;
  saveCurrentReport(true);
  renderIssueState();
  renderJobPage();
}

function formatIssueDate(ts) {
  return new Date(ts).toLocaleDateString('en-AU', { day:'numeric', month:'short', year:'numeric' });
}

// A time from a time field ("13:30") as it reads on a document: "1:30 pm".
// Anything that isn't hours and minutes stays as typed.
function formatClockTime(t) {
  const m24 = /^(\d{1,2}):(\d{2})/.exec(String(t || '').trim());
  if (!m24) return t || '';
  const h = Number(m24[1]), m = Number(m24[2]);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`;
}

// The lock on the screen: the report and its job details go quiet, and one
// line at the top of the report says why. Finalising and Amend are on This
// job; nothing else of the job's progress is told here.
function renderIssueState() {
  const banner = document.getElementById('issueBanner');
  if (!banner) return;
  const locked = isReportLocked();
  document.body.classList.toggle('report-locked', locked);
  if (locked) commitActive();
  renderLastVisitBanner();
  const issue = reportData.issue, amending = reportData.amending;
  const html = locked
    ? `<div class="issue-banner-row"><span class="issue-banner-text"><strong>Job finalised ${formatIssueDate(issue.completedAt)}</strong> · version ${issue.version}. Locked, so it matches what the client received.</span>
      <button class="agreement-banner-btn" onclick="openAmendForm()">Amend</button></div>`
    : amending && issue
    ? `<div class="issue-banner-row"><span class="issue-banner-text"><strong>Amending to version ${reportVersion()}</strong> · ${escapeHtml(amending.reason)}</span></div>`
    : '';
  banner.innerHTML = html;
  banner.style.display = html ? '' : 'none';
  banner.classList.toggle('locked', locked);
  updateProgress();
}

// While locked, taps and typing in the report, the job details and the mic
// are stopped with a note pointing at Amend. Scrolling and the section tabs
// still work.
let lockToastAt = 0;
function installReportLockGuard() {
  const stop = e => {
    if (!isReportLocked()) return;
    if (e.target.closest('.issue-banner')) return;
    // Touches only matter on the signature pad; elsewhere they're scrolling.
    if (e.type === 'touchstart' && e.target.tagName !== 'CANVAS') return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'focusin' && e.target.blur) e.target.blur();
    if (e.type === 'click' && Date.now() - lockToastAt > 2500) {
      lockToastAt = Date.now();
      sayLocked();
    }
  };
  ['reportBody', 'jobPanelBody', 'micDock'].forEach(id => {
    const el = document.getElementById(id);
    if (el) ['mousedown', 'touchstart', 'click', 'focusin', 'keydown'].forEach(t => el.addEventListener(t, stop, { capture: true, passive: false }));
  });
}
