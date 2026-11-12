// SAYON app: Drawer, menu, bottom dock, this job, last visit, address suggestions, weather, standard, job info.
// One of the js/app/ files, which share one global scope: they load as plain
// scripts in the order index.html lists them, so a top-level name declared in
// any of them can be used from the others once the page has loaded.

// ── DRAWER & VOICE POPOVER ────────────────────────────────────────────────
function toggleDrawer() {
  const sidebar = document.getElementById('sidebarPanel');
  const overlay = document.getElementById('drawerOverlay');
  const isOpen = sidebar.classList.toggle('open');
  if (isOpen) { showMenuPage(null); renderProfileMenu(); }
  else if (document.getElementById('businessPanel').classList.contains('menu-page-active')) businessPageLeft();
  overlay.classList.toggle('open', isOpen);
}

// ── MENU ─────────────────────────────────────────────────────────────────
// Full screen. It opens on who's signed in and two lists, Your business and
// App; tapping a row opens it as its own page, with Back to return to the
// list. Each row is a drawer panel: its header is the row, its body the page.
function openMenuPage(panelId) {
  if (!document.getElementById('sidebarPanel').classList.contains('open')) {
    // The Jobs list and This job sit above the menu, so they close first
    // (SAYON often opens on the Jobs list now: WHERE YOU WERE).
    if (document.getElementById('dashboardOverlay').classList.contains('open')) closeDashboard();
    closeJobPage();
    toggleDrawer();
  }
  showMenuPage(panelId);
}

function showMenuPage(panelId) {
  const sidebar = document.getElementById('sidebarPanel');
  const panel = panelId ? document.getElementById(panelId) : null;
  sidebar.querySelectorAll('.menu-page-active').forEach(el => {
    el.classList.remove('menu-page-active');
    if (el.id === 'businessPanel' && el !== panel) businessPageLeft();
  });
  if (panel) panel.classList.add('menu-page-active');
  sidebar.classList.toggle('on-page', !!panel);
  const title = panel && panel.querySelector('.panel-title');
  document.getElementById('drawerTitle').textContent = title ? title.textContent : 'Menu';
  document.getElementById('drawerBack').setAttribute('aria-label', panel ? 'Back to the menu' : 'Back to Jobs');
  sidebar.querySelector('.drawer-scroll').scrollTop = 0;
  // The plan can change in Stripe or with a different sign-in, so Billing
  // always shows it fresh.
  if (panelId === 'billingPanel') loadBillingStatus();
  if (panelId === 'teamPanel') loadTeam();
  if (panelId === 'pricesPanel') renderPriceBook();
  if (panelId === 'chemicalsPanel') renderChemicalRegister();
  if (panelId === 'settingsPanel') { restoreTestModeSetting(); showAudioCaptureRow(); renderLearnedList(); }
  if (panel) track('screen_viewed', { screen: 'menu_' + panelId });
}


// ── BOTTOM DOCK ──────────────────────────────────────────────────────────
// Jobs, the mic and This job. Jobs is every job (the account and settings
// open from its top corner); This job is the open job's page. The report
// and the quote each open a layer below it; the agreement, the client's
// answer, the treatment record and bait visits open over it. Each tab closes whatever is open, then opens its place. Which tab is
// lit is css, read off the screens that are open. 'report', 'quote' and
// 'menu' still work as places for the code that sends people there.
function tabGo(to) {
  const isOpen = id => document.getElementById(id).classList.contains('open');
  syncDockJobs();
  if (isOpen('voicePopover') && !isRecording) toggleVoicePopover();
  if (to === 'quote') {
    if (isOpen('quoteScreen')) return;
    if (isOpen('sidebarPanel')) toggleDrawer();
    if (isOpen('dashboardOverlay')) closeDashboard();
    closeJobPage();
    openQuoteFromReport();
    return;
  }
  if (isOpen('quoteScreen')) {
    closeQuote();
    if (document.getElementById('app').style.display !== 'flex') openApp('inspect');
  }
  if (to === 'menu') { openAccountMenu(); return; }
  if (isOpen('sidebarPanel')) toggleDrawer();
  if (to === 'dashboard') {
    closeJobPage();
    if (isOpen('dashboardOverlay')) closeDashboardDetail(); else openDashboard();
    return;
  }
  if (isOpen('dashboardOverlay')) closeDashboard();
  if (to === 'job') openJobPage(); else closeJobPage();
}

// The account and settings, from the Jobs page's top corner. Back from the
// menu's list returns to Jobs.
function openAccountMenu() {
  const isOpen = id => document.getElementById(id).classList.contains('open');
  if (isOpen('quoteScreen')) { closeQuote(); if (document.getElementById('app').style.display !== 'flex') openApp('inspect'); }
  if (isOpen('dashboardOverlay')) closeDashboard();
  closeJobPage();
  if (!isOpen('sidebarPanel')) toggleDrawer(); else showMenuPage(null);
}
function drawerBackTap() {
  if (document.getElementById('sidebarPanel').classList.contains('on-page')) {
    // Business details asks about unsaved changes, and can go back to the
    // check it was opened from.
    if (document.getElementById('businessPanel').classList.contains('menu-page-active')) leaveBusinessPage();
    else showMenuPage(null);
    return;
  }
  toggleDrawer();
  openDashboard();
}

// ── THIS JOB ─────────────────────────────────────────────────────────────
// The open job's page, and the one list of its steps: where it's up to
// and the next step, then every step in the order a job runs. Job details,
// the client's answer, the treatment (with its certificate) and bait
// visits open in place; the agreement, the report and the quote open their
// own screen. Built from the same reading of a job as the dashboard's list.
function currentJobSummary() {
  saveOpenReportNow();
  const quotes = getSavedQuotes();
  const saved = currentReportId && getSavedReports().find(r => r.id === currentReportId);
  // A job not saved yet (no address) still has a page, read off the open report.
  const r = saved || { id: currentReportId || 'draft', address: getFullAddress(), client: (document.getElementById('jobClient') || {}).value || '',
    completion: calculateCompletion(), reportData, quote: currentJobQuote() };
  return dashboardJob(r, quotes);
}

function openJobPage() {
  const overlay = document.getElementById('jobOverlay');
  if (!overlay) return;
  jobFoldsOpen.clear();
  renderJobPage(true);
  renderDateChips();
  overlay.classList.add('open');
  document.getElementById('jobPageBody').scrollTop = 0;
  track('screen_viewed', { screen: 'job' });
}

// Delete from the job's page (it asks first, with Undo after), then the Jobs list.
async function deleteThisJob() {
  const id = currentReportId;
  await deleteReport(id);
  if (!getSavedReports().some(r => r.id === id)) tabGo('dashboard');
}

function closeJobPage() {
  const overlay = document.getElementById('jobOverlay');
  if (!overlay || !overlay.classList.contains('open')) return;
  overlay.classList.remove('open');
  parkJobPanel();
  releaseJobQuote();
}

function jobAgreementStep(d = reportData) {
  const a = d.agreement;
  // The inspection is over and the report has gone: an agreement that was
  // never put on file isn't a step any more, just something to add.
  if (!a && (d.sent || d.issue)) return { label: 'Agreement', to: 'agreement', state: 'skip', text: 'No agreement on file' };
  const sent = !a && d.agreementRequest;
  if (sent) return { label: 'Agreement', to: 'agreement', state: 'now', text: `Link sent${sent.signerName ? ' to ' + sent.signerName : ''}, waiting for them to sign` };
  if (!a) return { label: 'Agreement', to: 'agreement', state: 'now', text: 'Not signed yet. Get it signed before you start' };
  const how = a.method === 'onsite' ? 'Signed on site' : a.method === 'email' ? 'Signed by email' : a.method === 'paper' ? 'Signed on paper' : 'Signed';
  return { label: 'Agreement', to: 'agreement', state: 'done', text: `${how}${a.signerName ? ' by ' + a.signerName : ''}` };
}

// A job's steps as its page and its Jobs card show them, in the order the
// job is done: Job details, the agreement, then the report, quote, the
// client's answer, treatment (and bait visits). Until the agreement is
// signed, nothing after it is next.
function jobPageSteps(j) {
  const d = j.r.reportData || {};
  // A new construction job has no agreement: Job details, then the treatment.
  if (isNewBuildJob(d)) return [jobDetailsStep(j), ...j.steps.map(st => ({ ...st }))];
  const steps = [jobDetailsStep(j), jobAgreementStep(d), ...j.steps.map(st => ({ ...st }))];
  if (!d.agreement && steps[1].state !== 'skip') steps.slice(2).forEach(st => { if (st.state === 'now') st.state = 'todo'; });
  return steps;
}

// The steps this job has. One it doesn't call for (no quote needed, no
// treatment after a declined quote) isn't a step: it isn't listed, drawn
// in a progress bar or counted, so a declined job reads "5 of 5".
const jobStepsCounted = steps => steps.filter(st => st.state !== 'skip');
const jobStepsDone = steps => steps.filter(st => st.state === 'done' || st.state === 'bad').length;

// What the job skipped, as quiet lines under its steps, each with the one
// thing that can still be done about it.
function jobSkippedHTML(j, steps) {
  const skipped = to => steps.some(st => st.to === to && st.state === 'skip');
  const who = (j.r.client || '').trim().split(/\s+/)[0] || 'The client';
  // On a finalised job these are the record; changing one starts with Amend.
  const can = (onclick, label) => isReportLocked() ? '' : ` <button type="button" onclick="${onclick}">${label}</button>`;
  const lines = [];
  if (skipped('agreement')) lines.push(`No agreement on file.${can('jobGo(\'agreement\')', 'Add one signed on paper')}`);
  if (skipped('quote')) lines.push(j.clientNotGoingAhead
    ? `No quote: the client isn't going ahead.${can('setClientNotGoingAhead(false)', 'Write a quote after all')}`
    : `No quote needed: the report didn't recommend treatment.${can('jobGo(\'quote\')', 'Write one anyway')}`);
  else if (skipped('treatment')) lines.push(`No treatment: ${escapeHtml(who)} declined the quote.`);
  return lines.length ? `<div class="job-skipped">${lines.map(l => `<p>${l}</p>`).join('')}</div>` : '';
}

// Job details: the job's first step, before the agreement and the report.
// Done once the job has its address and the client's name (signing the
// agreement fills in a missing name). Its line is how to reach the client,
// since the address, the client and the day are in the page's heading.
function jobDetailsStep(j) {
  const r = j.r, d = r.reportData || {};
  const phone = (d.jobClientPhone || '').trim();
  const email = (d.jobClientEmail || (j.q || {}).clientEmail || '').trim(); // as jobClientEmailOf
  const named = !!(r.address || '').trim() && !!(r.client || '').trim();
  const reach = !phone && !email ? 'No phone or email yet' : [phone, email || 'no email yet'].filter(Boolean).join(' · ');
  return { label: 'Job details', to: 'details', state: named ? 'done' : 'todo', text: named ? reach : 'Still to add: the client\'s name' };
}

// A step's line: when, who and how much for one that's done, and what one
// still to come is waiting on. A step that's next says what's to do.
function jobStepLine(j, st) {
  const who = (j.r.client || '').trim().split(/\s+/)[0] || 'the client';
  const open = st.state === 'now' || st.state === 'todo';
  if (st.to === 'report' && open && !st.ready) return `${Math.round(j.r.completion || 0)}% filled in`;
  if (st.to === 'quote' && j.total && st.state !== 'skip') return `${formatAUD(j.total).replace(/\.00$/, '')}${j.q && j.q.sentAt ? ', sent ' + dashDate(j.q.sentAt) : ', not sent yet'}`;
  if (st.to === 'quote' && open) return 'Not written yet';
  if (st.to === 'answer' && open) return j.q && j.q.sentAt ? `Waiting on ${who} since ${dashDate(j.q.sentAt)}` : 'Once the quote is sent';
  if (st.to === 'treatment' && open && !(j.q && j.q.treatment)) return j.newBuild ? 'Not recorded yet' : quoteHasItems(j.q) && (quoteAnswerState(j.q) || {}).status === 'accepted' ? 'Accepted, not recorded yet' : `Once ${who} accepts`;
  if (st.state === 'now' || st.state === 'bad' || st.state === 'skip' || !st.full) return st.text;
  return st.full.replace(/ · /g, ', ');
}

// The steps kept on this page open in place. Which are open, so a redraw
// (an answer saved, a certificate sent) leaves them as they were.
const jobFoldsOpen = new Set();
function jobFoldToggled(el) {
  if (el.open) jobFoldsOpen.add(el.dataset.step); else jobFoldsOpen.delete(el.dataset.step);
}

// What a step opens to on this page: the client's answer, the treatment's
// record and certificate, the bait visits. They're stored on the quote (q,
// THE JOB'S QUOTE in js/quote.js). '' for a step that opens its own screen
// or sheet, or one with nothing to open yet.
function jobStepPanel(st, q) {
  if (st.to === 'answer') return quoteHasItems(q) ? quoteAnswerPanel(q) : '';
  if (st.to === 'treatment') return q && q.treatment ? treatmentRecordLine(q) + treatmentCertificateCard(q) : '';
  if (st.to === 'bait') return q ? renderBaitBlock(q) : '';
  return '';
}

// The steps as cards, each with its document's icon in the colour of where
// it's up to. tap(st) is the step's onclick. details: the Job details
// step's card, which opens in place instead of going anywhere. A step that
// can't be started yet (an answer or a treatment before there's a quote)
// is a line, not a button.
function jobStepsHTML(j, steps, tap, details, q) {
  const tick = '<svg class="icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  const stateWord = { done: 'done', now: 'next', todo: 'to come', skip: 'not needed', bad: 'declined' };
  const chev = '<svg class="icon job-step-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
  const pct = Math.round(j.r.completion || 0);
  return `<ol class="job-steps">
      ${jobStepsCounted(steps).map((st, i) => {
        const line = jobStepLine(j, st);
        if (st.to === 'details') return `<li class="${st.state}">${details}</li>`;
        const label = `aria-label="${i + 1}. ${escapeHtml(st.label)}, ${stateWord[st.state] || ''}: ${escapeHtml(line)}"`;
        const inner = `<span class="job-tile ${st.state}" aria-hidden="true">${jobIcon(st.to, 20)}${st.state === 'done' ? `<span class="job-tile-tick">${tick}</span>` : ''}</span>
            <span class="job-step-main">
              <span class="job-step-label">${st.label}${st.state === 'now' ? '<span class="job-step-flag">Next</span>' : ''}</span>
              <span class="job-step-text">${escapeHtml(line)}</span>
              ${st.to === 'report' && st.state === 'now' && !st.ready ? `<span class="job-step-bar"><i style="width:${Math.max(4, Math.min(100, pct))}%"></i></span>` : ''}
            </span>`;
        const panel = jobStepPanel(st, q);
        if (panel) return `
        <li class="${st.state}">
          <details class="job-details job-fold" data-step="${st.to}"${jobFoldsOpen.has(st.to) ? ' open' : ''} ontoggle="jobFoldToggled(this)">
            <summary class="job-details-head" ${label}>${inner}${chev}</summary>
            <div class="job-fold-body">${panel}</div>
          </details>
        </li>`;
        if ((st.to === 'answer' || st.to === 'treatment' && !j.newBuild) && !quoteHasItems(q)) return `
        <li class="${st.state}"><div class="job-step job-step-still" ${label.replace('aria-label', 'role="group" aria-label')}>${inner}</div></li>`;
        return `
        <li class="${st.state}">
          <button type="button" class="job-step" onclick="${tap(st)}" ${label}>${inner}${chev}</button>
        </li>`; }).join('')}
    </ol>`;
}

// The Next step card's way to do the step. One that's done on this page
// (the client's answer, the certificate, a bait visit's report) is done
// from the card itself; the rest open their screen or sheet.
function jobNextAction(next, q) {
  if (next.ways) return agreementWaysHTML(next);
  const to = next.next.to;
  if (to === 'answer' && quoteHasItems(q)) return quoteAnswerButtons(q, true);
  if (to === 'certificate' && q && q.treatment) return treatmentCertificateCard(q);
  if (to === 'signedQuote' && q) return signedQuoteNext(q);
  const b = to === 'bait' && q && typeof baitProgram === 'function' ? baitProgram(q) : null;
  if (b && b.last && !b.last.sentAt) {
    const first = (q.client || '').trim().split(/\s+/)[0];
    return `<button type="button" class="dash-detail-primary" onclick="emailBaitVisit('${escapeHtml(b.last.id)}')">Email the visit report${first ? ' to ' + escapeHtml(first) : ''}</button>`;
  }
  return `<button type="button" class="dash-detail-primary" onclick="jobGo('${to}')">${next.next.label}</button>`;
}

// The agreement's two ways to get signed (agreementNext in
// js/app/dashboard.js), on the Next step card: the one that leads as the
// filled button, the other under it. isNew: a job with no address yet,
// which is asked for first, and can be saved to come back to.
function agreementWaysHTML(next, isNew) {
  const call = w => w.way === 'link' ? 'jobAgreementLink()' : isNew ? 'jobNewAgreement()' : "jobGo('agreement')";
  const [lead, other] = next.ways;
  return `<button type="button" class="dash-detail-primary job-way-${lead.way}" onclick="${call(lead)}">${escapeHtml(lead.label)}</button>
      <div class="dash-detail-links"><button type="button" class="job-way-${other.way}" onclick="${call(other)}">${escapeHtml(other.label)}</button></div>
      ${isNew ? '<div class="dash-detail-links job-next-later"><button type="button" onclick="saveJobNow(true)">Save it for later</button></div>' : ''}`;
}

// A new job's Next step card: the agreement, either way. Which way leads
// follows the booking's day and the client's email, so the card is redrawn
// as Job details are typed (refreshJobNewNext).
function jobNewNextHTML() {
  // A new construction job starts at the treatment.
  if (isNewBuildJob()) return `
      <div class="job-next-head">
        <span class="job-tile now" aria-hidden="true">${jobIcon('treatment', 22)}</span>
        <div>
          <div class="dash-next-label">Next step</div>
          <div class="dash-next-title">Record the treatment</div>
        </div>
      </div>
      <p class="dash-next-hint">Once the system is in, record what went in and where. The treatment certificate is made from the record.</p>
      <button type="button" class="dash-detail-primary" onclick="jobGo('treatment')">Record treatment</button>
      <div class="dash-detail-links job-next-later"><button type="button" onclick="saveJobNow(true)">Save it for later</button></div>`;
  const next = agreementNext(Object.assign({}, reportData, { agreement: null, agreementRequest: null }), document.getElementById('jobClient').value);
  return `
      <div class="job-next-head">
        <span class="job-tile now" aria-hidden="true">${jobIcon('agreement', 22)}</span>
        <div>
          <div class="dash-next-label">Next step</div>
          <div class="dash-next-title">Get the agreement signed</div>
        </div>
      </div>
      <p class="dash-next-hint">${escapeHtml(next.ways[0].way === 'link' ? next.hint : 'The client signs it before you start. Then tap the mic and talk through the inspection.')}</p>
      ${agreementWaysHTML(next, true)}`;
}
function refreshJobNewNext() {
  const card = document.querySelector('#jobOverlay.open.new-job .job-next-new');
  if (!card) return;
  const html = jobNewNextHTML();
  // Only when it reads differently, so a button isn't swapped mid-tap.
  if (card.drawn !== html) { card.innerHTML = html; card.drawn = html; }
}

// The link way, from the Next step card: the agreement as Job details have
// it goes to the client to sign on their own phone. Anything it still
// needs (the inspection type, a name) is asked for on the agreement sheet.
function jobAgreementLink() {
  if (!document.getElementById('jobAddress').value.trim()) { askForJobAddress(); return; }
  sendAgreementLink();
}

// After a step is saved on this page: back up to the Next step card, which
// now holds what follows it.
function jobShowNext() {
  const card = document.querySelector('#jobOverlay.open .job-next');
  if (card) setTimeout(() => card.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
}

// The job page's icons: one per document, plus the hero's actions.
const JOB_ICONS = {
  agreement: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  report: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  quote: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>',
  answer: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="m9 10 2 2 4-4"/>',
  treatment: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  certificate: '<circle cx="12" cy="8" r="6"/><path d="M15.48 12.89 17 22l-5-3-5 3 1.52-9.11"/>',
  bait: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  jobpdf: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 13h8"/><path d="M8 17h5"/>',
  details: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  tick: '<path d="M20 6 9 17l-5-5"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  directions: '<polygon points="3 11 22 2 13 21 11 13 3 11"/>',
};
// Emailing the signed quote is the envelope, not the clock of a step that's waiting.
JOB_ICONS.signedQuote = JOB_ICONS.mail;
function jobIcon(name, size) {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${JOB_ICONS[name] || JOB_ICONS.clock}</svg>`;
}

function renderJobPage(opening) {
  const body = document.getElementById('jobPageBody');
  if (!body) return;
  parkJobPanel();
  const j = currentJobSummary();
  // The job's quote, for the steps done on this page.
  const showing = (opening || document.getElementById('jobOverlay').classList.contains('open')) && !quoteScreenOpen();
  if (showing) useJobQuote(j.q);
  const q = showing ? quoteState : j.q;
  const addr = (j.r.address || '').trim();
  // No street address yet: a new job, still being filled in.
  const isNew = !(document.getElementById('jobAddress').value || '').trim();
  const steps = jobPageSteps(j);
  // Before the agreement is signed, that is the next step (once its link
  // has gone, the job is waiting on the client and the card says so). After
  // the last step, Finalise is: it locks the job and makes its PDF.
  const reportGone = !!(reportData.sent || reportData.issue);
  const finalise = jobCanFinalise(j) && (!isReportLocked() || !reportData.jobPdfAt) ? jobFinaliseNext(j) : null;
  const next = !j.newBuild && !reportData.agreement && addr && !reportGone ? agreementNext(reportData, j.r.client)
    : finalise || { status: j.status, hint: j.hint, next: j.next };
  // Treatment recommended but the client isn't having a quote: skip it, and
  // the treatment and bait steps with it.
  const skipLink = j.status === 'Write the quote' ? '<button type="button" onclick="setClientNotGoingAhead(true)">Client isn\'t going ahead</button>' : '';
  // Waiting on the client to sign: ask now instead of opening the agreement to find out.
  const waitLinks = next.sent ? '<button type="button" onclick="checkAgreementLink(true)">Check now</button><button type="button" onclick="sendAgreementLinkOn()">Send again</button>' : '';

  const counted = jobStepsCounted(steps), done = jobStepsDone(steps);
  // What the job is and when, over the address.
  const type = (reportData.jobInspectionType || '').split(' — ')[0];
  const when = reportData.jobInspectionDate ? new Date(reportData.jobInspectionDate + 'T00:00:00') : null;
  const time = (reportData.jobInspectionTime || '').match(/^(\d{1,2}):(\d{2})/);
  const eyebrow = [type,
    when && !isNaN(when) ? when.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : '',
    time ? `${(+time[1] % 12) || 12}:${time[2]} ${+time[1] < 12 ? 'am' : 'pm'}` : ''].filter(Boolean).join(' · ');
  // One tap to ring, email or drive to the job.
  const phone = ((document.getElementById('jobClientPhone') || {}).value || '').trim();
  const email = typeof jobClientEmailOf === 'function' ? jobClientEmailOf() : (reportData.jobClientEmail || '').trim();
  const actions = [
    phone && `<a class="job-act" href="tel:${escapeHtml(phone.replace(/[^\d+]/g, ''))}">${jobIcon('phone', 18)}Call</a>`,
    email && `<a class="job-act" href="mailto:${escapeHtml(email)}">${jobIcon('mail', 18)}Email</a>`,
    addr && `<a class="job-act" href="https://maps.apple.com/?q=${encodeURIComponent(addr)}" target="_blank" rel="noopener">${jobIcon('directions', 18)}Directions</a>`,
  ].filter(Boolean).join('');
  const nextIcon = finalise ? 'jobpdf' : next.next ? next.next.to : j.group === 'done' && addr ? 'tick' : !addr ? 'details' : 'clock';
  const chev = '<svg class="icon job-step-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
  const group = (DASHBOARD_TABS.find(([k]) => k === j.group) || [, ''])[1];
  // Job details come first, as they do on the job: before the agreement and
  // long before the report. A new job's details are the page itself
  // (Property, Client and Booking cards) with the steps after them; once
  // the address is in they're the first step, and open in place. A redraw
  // while the page is open keeps them open or shut as they were.
  const fold = document.getElementById('jobDetailsFold');
  const detailsOpen = isNew || !!(fold && fold.open && document.getElementById('jobOverlay').classList.contains('open'));
  document.getElementById('jobOverlay').classList.toggle('new-job', isNew);
  const ds = steps[0];
  const tick = '<span class="job-tile-tick"><svg class="icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>';
  const detailsHTML = `
    <details class="job-details${isNew ? ' new' : ''}" id="jobDetailsFold"${detailsOpen ? ' open' : ''}>
      <summary class="job-details-head" id="jobDetailsHead" aria-label="1. Job details, ${ds.state === 'done' ? 'done' : 'to finish'}: ${escapeHtml(ds.text)}">
        <span class="job-tile ${ds.state}" aria-hidden="true">${jobIcon('details', 20)}${ds.state === 'done' ? tick : ''}</span>
        <span class="job-step-main">
          <span class="job-step-label">Job details</span>
          <span class="job-step-text">${escapeHtml(ds.text)}</span>
        </span>
        ${chev}
      </summary>
      <div id="jobPageSlot"></div>
    </details>`;
  const stepsHTML = `
    <div class="job-section-head">Job steps</div>
    ${jobStepsHTML(j, isNew ? steps.slice(1) : steps, st => `jobGo('${st.to}')`, detailsHTML, q)}
    ${isNew ? '' : jobSkippedHTML(j, steps)}`;
  // The client of a new construction job is usually the builder.
  const clientBox = document.getElementById('jobClient');
  if (clientBox) clientBox.placeholder = j.newBuild ? 'The builder, or the owner' : 'Full name';
  // A new job: what to fill in, the form, then the agreement as the next
  // step (the treatment, on a new construction job).
  if (isNew) {
    body.innerHTML = `
    <div class="job-hero new">
      <div class="job-hero-eyebrow">${escapeHtml(eyebrow || new Date().toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }))}</div>
      <h3 class="job-hero-addr">${j.newBuild ? 'New construction job' : 'New job'}</h3>
      <p class="job-hero-sub">${j.newBuild ? 'Fill in the site and the client, usually the builder. The rest can wait.' : 'Fill in the property and the client. The rest can wait.'}</p>
      <p class="job-hero-kind">${j.newBuild ? 'Not a new build? <button type="button" onclick="setNewBuildJob(false)">Make it an inspection</button>'
        : 'Putting a termite system in a new build? <button type="button" onclick="setNewBuildJob(true)">Make it a new construction job</button>'}</p>
      <p class="job-hero-tip"><svg class="icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v4"/></svg><span>Or tap the mic and say the address and the client's name.</span></p>
    </div>
    ${detailsHTML}
    <section class="dash-next job-next job-next-new">${jobNewNextHTML()}
    </section>
    ${stepsHTML}`;
    document.getElementById('jobPageSlot').appendChild(document.getElementById('jobPanel'));
    return;
  }
  body.innerHTML = `
    ${isSampleJob(currentReportId) && typeof sampleJobNoteHTML === 'function' ? sampleJobNoteHTML() : ''}
    <div class="job-hero ${j.group}">
      ${addr ? `<div class="job-hero-top"><span class="dash-detail-chip ${j.group}">${group}</span><span class="job-hero-count">${done} of ${counted.length} done</span></div>` : ''}
      ${eyebrow ? `<div class="job-hero-eyebrow">${escapeHtml(eyebrow)}</div>` : ''}
      <h3 class="job-hero-addr">${escapeHtml(addr || 'New job')}</h3>
      ${j.r.client ? `<p class="job-hero-sub">${escapeHtml(j.r.client)}</p>` : ''}
      ${addr ? `<div class="job-progress" aria-hidden="true">${counted.map(st => `<i class="${st.state}"></i>`).join('')}</div>` : ''}
      ${actions ? `<div class="job-acts">${actions}</div>` : ''}
    </div>
    <section class="dash-next job-next ${next.sent ? 'waiting' : j.group}">
      <div class="job-next-head">
        <span class="job-tile ${j.group === 'done' && addr && !next.next && !finalise ? 'done' : 'now'}" aria-hidden="true">${jobIcon(nextIcon, 22)}</span>
        <div>
          <div class="dash-next-label">${finalise || next.next && !next.sent ? 'Next step' : addr ? 'Where it\'s at' : 'Next step'}</div>
          <div class="dash-next-title">${escapeHtml(next.status)}</div>
        </div>
      </div>
      ${next.hint ? `<p class="dash-next-hint">${escapeHtml(next.hint)}</p>` : ''}
      ${finalise ? finalise.html : ''}
      ${next.next ? jobNextAction(next, q) : ''}
      ${waitLinks || skipLink ? `<div class="dash-detail-links">${waitLinks || skipLink}</div>` : ''}
    </section>
    ${typeof safetyCheckHTML === 'function' ? safetyCheckHTML(j) : ''}
    ${stepsHTML}
    ${jobFinalisedHTML(j)}
    ${currentReportId && !isSampleJob(currentReportId) && getSavedReports().some(r => r.id === currentReportId) ? `<div class="dash-detail-foot job-delete">
      <button type="button" class="dash-detail-delete" onclick="deleteThisJob()"><svg class="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Delete this job</button>
    </div>` : ''}`;
  const panel = document.getElementById('jobPanel');
  if (panel) document.getElementById('jobPageSlot').appendChild(panel);
  // A quote out on a link is checked for the client's answer as the page is read.
  if (showing && q && !q.answer && quoteLinkCurrent(q)) checkQuoteLink(q, false);
  // The certificate's Email button builds its PDF inside the tap, so the PDF tools are fetched ahead.
  if (showing && q && q.treatment && !certificateGiven(q)) ensureJsPDFLoaded().catch(() => {});
}

// Goes to one of the open job's steps, from its page or the Jobs list.
// The report and the quote open their screen and the agreement its sheet;
// the client's answer, the treatment, the certificate and bait visits are
// on This job, so it opens (with the sheet over it for one that has one).
// from: where it was asked for ('jobs', 'job', 'report', 'quote'), read
// off the screen when not given. A sheet closed unfinished goes back there
// (SHEETS OPENED FROM A PAGE in js/app/shell.js).
function jobGo(to, from) {
  from = from || navPlace();
  const onJob = to === 'job' || to === 'details' || to === 'agreementLink' || to === 'answer' || to === 'signedQuote' || to === 'treatment' || to === 'certificate' || to === 'bait';
  if (!onJob) closeJobPage();
  if (document.getElementById('quoteScreen').classList.contains('open') && to !== 'quote') {
    closeQuote();
    if (document.getElementById('app').style.display !== 'flex') openApp('inspect');
  }
  if (to === 'agreement') { openAgreementSheet(); rememberSheetFrom('agreementOverlay', from); return; }
  if (to === 'report') { fillWeatherOnTheDay(); return; }
  if (to === 'quote') { if (!document.getElementById('quoteScreen').classList.contains('open')) openQuoteFromReport(); return; }
  if (to === 'job') { closeJobPage(); openJobPage(); return; }
  if (!document.getElementById('jobOverlay').classList.contains('open')) openJobPage();
  if (to === 'details') { const f = document.getElementById('jobDetailsFold'); if (f) f.open = true; document.getElementById('jobDetailsHead')?.scrollIntoView({ block: 'start' }); return; }
  // A new construction job's record is kept on a quote made for it (newBuildRecordQuote in js/treatment.js).
  const q = quoteState || (to === 'treatment' && isNewBuildJob() ? newBuildRecordQuote() : null);
  if (to === 'treatment' && q) { openTreatmentRecord(); rememberSheetFrom('treatmentOverlay', from); }
  if (to === 'bait' && q && typeof baitProgram === 'function') {
    // A visit's report still to email is on the Next step card. Otherwise
    // it's a visit to record: straight onto the sheet.
    const b = baitProgram(q);
    if (b && !b.finished && !(b.last && !b.last.sentAt)) { openBaitVisit(); rememberSheetFrom('baitOverlay', from); }
  }
  // The certificate's Email button, the signed quote's, or the agreement's
  // link button, lit so it's the obvious next tap.
  if (to === 'certificate' || to === 'agreementLink' || to === 'signedQuote') {
    const btn = document.querySelector(`#jobOverlay .job-next ${{ certificate: '.qp-cert-email', signedQuote: '.job-signed-email' }[to] || '.job-way-link'}`);
    if (btn) { btn.classList.add('flash'); setTimeout(() => btn.classList.remove('flash'), 2400); }
  }
}

// A new job's next step: the agreement, once there's an address to put on it.
function jobNewAgreement() {
  if (!document.getElementById('jobAddress').value.trim()) { askForJobAddress(); return; }
  jobGo('agreement');
}

function askForJobAddress() {
  showToast('Type the property address first', 'error');
  const el = document.getElementById('jobAddress');
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.focus({ preventScroll: true });
}

// Save from the job's details. later: a job booked ahead, so it goes to the
// Jobs list to come back to on the day.
function saveJobNow(later) {
  if (!document.getElementById('jobAddress').value.trim()) { askForJobAddress(); return; }
  if (!saveCurrentReport(true)) return;
  showToast(later ? 'Saved to your jobs' : 'Job saved', 'success');
  if (later) tabGo('dashboard'); else refreshDashboardIfOpen();
}

// What the dock's tabs show about the job. This job: how far the job is
// along its steps ("2/6", a tick once they're all done), the same count as
// its page. The report's own percentage stays in the report's corner.
function syncDockReport() { syncDockJobs(); }
function renderDockJobSteps(quotes) {
  const badge = document.getElementById('tabReportRing');
  if (!badge) return;
  const address = getFullAddress();
  const saved = currentReportId && getSavedReports().find(r => r.id === currentReportId);
  const j = dashboardJob({ id: currentReportId || 'draft', address, client: (document.getElementById('jobClient') || {}).value || '',
    completion: calculateCompletion(), reportData, quote: currentJobQuote(), reportStale: !!(saved && saved.reportStale), savedAt: Date.now() }, quotes);
  const steps = jobStepsCounted(jobPageSteps(j)), n = jobStepsDone(steps);
  const all = !!address && n === steps.length;
  badge.querySelector('.tab-progress-pct').textContent = `${n}/${steps.length}`;
  badge.classList.toggle('done', all);
  badge.classList.toggle('empty', !address);
  badge.closest('.tab').setAttribute('aria-label', !address ? 'This job' : all ? 'This job, every step done' : `This job, ${n} of ${steps.length} steps done`);
}

// Jobs: how many need the inspector today. Quote: a dot in the colour of
// where this job's quote is up to. Read from storage, so it waits for a
// quiet moment instead of running on every keystroke.
let dockJobsTimer = 0;
function syncDockJobs() {
  clearTimeout(dockJobsTimer);
  dockJobsTimer = setTimeout(() => {
    try {
      const quotes = getSavedQuotes();
      renderDockJobSteps(quotes);
      // The number in the Jobs headline: today's, not what's booked for later.
      const need = jobsNeedingYou(getSavedReports().map(r => dashboardJob(r, quotes))).today;
      const count = document.getElementById('tabJobsCount');
      if (count) {
        count.textContent = need > 9 ? '9+' : String(need);
        count.hidden = !need;
        count.closest('.tab').setAttribute('aria-label', need ? `Jobs, ${need} need${need === 1 ? 's' : ''} you today` : 'Jobs');
      }
      const dot = document.getElementById('tabQuoteDot');
      if (dot) {
        const q = currentJobQuote();
        const [label, tone] = quoteHasItems(q) ? quoteStatusPill(q) : [];
        dot.hidden = !label;
        dot.className = 'tab-dot-badge' + (tone === 'wait' || tone === 'good' || tone === 'bad' ? ' ' + tone : '');
        dot.closest('.tab').setAttribute('aria-label', label ? `Quote, ${label}` : 'Quote');
      }
    } catch (e) { /* the dock's hints are extras; never let them break a save */ }
  }, 400);
}

// The mic is for the report: from anywhere else it goes to the report.
// One tap opens the voice panel already listening, so a tech about to
// drive off has one thing to press. With the panel open and quiet, the
// same button closes it.
function tabMic() {
  // While it listens, Talk reads Stop: a tap stops the recording.
  if (isRecording) { toggleRecording(); return; }
  // From Jobs or the menu, the mic is for the job the dock names beside
  // it. A report that's already done isn't added to by a stray tap: the
  // job opens instead, and the report is one more tap for whoever means it.
  if (['dashboardOverlay', 'sidebarPanel'].some(id => document.getElementById(id).classList.contains('open')) && isReportDone()) {
    const street = document.getElementById('jobAddress').value.trim();
    tabGo('job');
    showToast(`The report for ${street || 'this job'} is done, so the mic didn't start`, 'info', { label: 'Open report', run: () => tabGo('report') });
    return;
  }
  // A new construction job has no report to talk into: the mic fills in
  // its treatment record, once the job has its address.
  if (isNewBuildJob() && getFullAddress()) {
    if (isReportLocked()) { tabGo('job'); return; }
    jobGo('treatment');
    if (document.getElementById('treatmentOverlay').classList.contains('open')) toggleSheetVoice('treatment');
    return;
  }
  const popover = document.getElementById('voicePopover');
  const onReport = document.getElementById('app').style.display === 'flex'
    && !['quoteScreen', 'sidebarPanel', 'dashboardOverlay', 'jobOverlay'].some(id => document.getElementById(id).classList.contains('open'));
  if (!onReport) tabGo('report');
  else if (popover.classList.contains('open')) { toggleVoicePopover(); return; }
  if (!popover.classList.contains('open')) toggleVoicePopover();
  // A finished report keeps the panel shut, and so nothing listens.
  if (popover.classList.contains('open')) startRecording();
}

function toggleVoicePopover() {
  if (isReportLocked()) return;
  const popover = document.getElementById('voicePopover');
  const fab = document.getElementById('micFab');
  const isOpen = popover.classList.toggle('open');
  fab.classList.toggle('open', isOpen);
  updateVoiceHud();
  showTestModeBadge();
  if (isOpen) updateTalkPhotoButton();

  // If closing while in notes-dictation mode, reset to default
  if (!isOpen && activeNotesTargetKey) {
    resetVoicePopoverToDefault();
  }

  // Stop any active recording when closing
  if (!isOpen && isRecording) {
    stopRecording();
  }
}

function initMobileView() {
  // No-op: layout is now responsive via drawer + popover for all screen sizes
}

function getFullAddress() {
  return formatAddress(
    document.getElementById('jobAddress').value.trim(),
    document.getElementById('jobSuburb').value.trim(),
    document.getElementById('jobState').value.trim(),
    document.getElementById('jobPostcode').value.trim());
}

// An Australian phone number spaced the way it's written here: mobiles
// 0412 345 678, landlines 02 1234 5678, 1300/1800 numbers 1300 123 456,
// 13 numbers 13 12 34. +61 becomes a leading 0. Anything else (an
// overseas number, an extension) is left as typed.
function formatPhoneAU(value) {
  const raw = String(value || '').trim();
  let d = raw.replace(/[^\d+]/g, '');
  if (/^\+?61\d{9}$/.test(d)) d = '0' + d.replace(/^\+?61/, '');
  if (/\D/.test(d)) return raw;
  if (/^04\d{8}$/.test(d) || /^1[38]00\d{6}$/.test(d)) return d.replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3');
  if (/^0[2378]\d{8}$/.test(d)) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, '$1 $2 $3');
  if (/^13\d{4}$/.test(d)) return d.replace(/^(\d{2})(\d{2})(\d{2})$/, '$1 $2 $3');
  return raw;
}
function tidyPhoneInput(el) {
  const v = formatPhoneAU(el.value);
  if (v !== el.value) { el.value = v; el.dispatchEvent(new Event('input')); }
}

// A file-name part from free text: letters, digits and underscores only,
// cut at a word end. "7 Banksia Drive, Epping NSW 2121" gives
// "7_Banksia_Drive_Epping_NSW_2121", not "7_Banksia_Drive,_Epping_N".
function fileNamePart(text, max = 40) {
  let s = String(text || '').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '');
  if (s.length > max) { s = s.slice(0, max + 1); const cut = s.lastIndexOf('_'); s = cut > max / 2 ? s.slice(0, cut) : s.slice(0, max); }
  return s.replace(/_+$/, '');
}

// One pattern for every PDF a client receives: what it is first, its
// number if it has one, the address, then a date if it carries one.
// "Quote_Q-1234_7_Banksia_Drive_Epping_NSW_2121.pdf".
function pdfFileName(what, address, { ref = '', date = '' } = {}) {
  return [fileNamePart(what), String(ref).replace(/[^\w-]+/g, ''), fileNamePart(address) || 'Property', fileNamePart(date)].filter(Boolean).join('_') + '.pdf';
}

let jobHadAddress = false;   // whether the job had an address when updateJob last ran
function updateJob() {
  const addr = getFullAddress();
  const headerJob = document.getElementById('headerJob');
  headerJob.textContent = addr || 'No job loaded';
  headerJob.classList.toggle('has-job', !!addr);
  // The dock names the open job by its street while Jobs or the menu is on show.
  const street = document.getElementById('tabJobStreet');
  if (street) street.textContent = document.getElementById('jobAddress').value.trim();
  if (typeof renderReportJobCard === 'function') renderReportJobCard();

  const summary = document.getElementById('jobPanelSummary');
  if (summary) {
    const client = document.getElementById('jobClient').value.trim();
    const parts = [addr, client].filter(Boolean);
    summary.textContent = parts.length ? parts.join(' · ') : 'No job set';
  }

  // The job's page shows the address as it's typed into its details.
  const heroAddr = document.querySelector('#jobOverlay.open .job-hero-addr');
  if (heroAddr) heroAddr.textContent = addr || (isNewBuildJob() ? 'New construction job' : 'New job');

  syncAllSelectCards();
  renderLastVisitBanner();
  refreshJobNewNext();
  // The address is one of the report's required answers, so the percentage
  // and Finish's list follow it the moment it's typed or cleared.
  const hasAddress = !!document.getElementById('jobAddress').value.trim();
  if (hasAddress !== jobHadAddress) { jobHadAddress = hasAddress; updateProgress(); }
  saveDraft();
}

// ── LAST VISIT ──────────────────────────────────────────────────────────
// An address this account has inspected before. The job's details say so
// under the address as soon as it's typed, and the report's first step
// offers to start from that report: the property details that don't change
// from year to year are copied in, the known termite history is written
// from what was found then, and a sheet shows what changed since. Nothing
// about this visit's findings is copied: those are inspected afresh.
//   reportData.lastVisit = { id, date, copied }   once started from
//   reportData.lastVisitDismissed = <id>          when the inspector said not now
const LAST_VISIT_KEYS = ['structureType', 'height', 'wallConstruction', 'roofType', 'floorType', 'facadeDirection', 'constructionEra',
  'siteSurroundings', 'siteSlope', 'existingSystem', 'existingSystemOther', 'standard', 'toolsUsed'];

// "7 Banksia Dr, Epping" and "7 Banksia Drive EPPING" are the same place.
function addressKey(street, suburb) {
  const norm = v => String(v || '').toLowerCase()
    .replace(/[^a-z0-9/ ]+/g, ' ')
    .replace(/\b(unit|apartment|apt|flat|lot|shop|suite)\s+/g, '')
    .replace(/\b(street|st|road|rd|avenue|ave|av|drive|dr|dve|place|pl|court|ct|crescent|cres|cr|parade|pde|lane|ln|highway|hwy|boulevard|bvd|blvd|terrace|tce|close|cl|way|circuit|cct|grove|gr|esplanade|esp|square|sq)\b/g, '')
    .replace(/\s+/g, ' ').trim();
  const a = norm(street), b = norm(suburb);
  return a && b ? `${a}|${b}` : '';
}

function previousVisitFor() {
  const key = addressKey(document.getElementById('jobAddress').value, document.getElementById('jobSuburb').value);
  if (!key) return null;
  const list = getSavedReports().filter(r => r && r.id !== currentReportId && !isSampleJob(r) && r.reportData && addressKey(r.jobAddress, r.jobSuburb) === key);
  if (!list.length) return null;
  // A completed report over a draft, then the most recent.
  list.sort((a, b) => ((b.reportData.issue ? 1 : 0) - (a.reportData.issue ? 1 : 0)) || ((b.savedAt || 0) - (a.savedAt || 0)));
  return list[0];
}

function visitDate(entry) {
  const rd = entry.reportData || {};
  return (rd.issue && rd.issue.completedAt) || (rd.agreement && rd.agreement.inspectionDate && new Date(rd.agreement.inspectionDate + 'T00:00:00').getTime()) || entry.savedAt || Date.now();
}

// The answers a client asks about, from any report, for last time against now.
function visitFacts(rd) {
  rd = rd || {};
  const fs = (rd.findings || []).filter(f => f && f.termiteActivity);
  const where = list => list.map(f => f.activityLocation).filter(Boolean).join('; ');
  const live = fs.filter(f => f.termiteActivity === 'ACTIVE'), old = fs.filter(f => f.termiteActivity === 'INACTIVE');
  const conducive = conduciveConditions(rd);
  const conduciveAnswered = ['waterLeaks', 'timberSoil', 'weepHoles', 'antCapping', 'slabEdge', 'subfloorVentilation', 'mouldSeen', 'siteDrainage', 'subfloorDrainage', 'nonDurableTimber'].some(k => !isBlankValue(rd[k]));
  const yn = v => ({ YES: 'Yes', NO: 'No' })[v] || '';
  return [
    ['Live termites', live.length ? `Yes: ${where(live) || 'see findings'}` : fs.length ? 'No' : ''],
    ['Workings or damage', old.length ? `Yes: ${where(old) || 'see findings'}` : fs.length ? 'No' : ''],
    ['Borers', { ACTIVE: 'Active', INACTIVE: 'Old damage', NONE: 'No' }[rd.borerActivity] || ''],
    ['Wood decay', yn(rd.decayFound)],
    ['Conducive conditions', conducive.length ? conducive.join('; ').replace(/^./, c => c.toUpperCase()) : conduciveAnswered ? 'None' : ''],
    ['Termite management system', rd.existingSystem || ''],
    ['Treatment recommended', yn(rd.treatmentRecommended)],
    ['Risk of termite attack', rd.riskLevel || ''],
    ['Next inspection', rd.inspectionFrequency || ''],
  ];
}

// What the last report found, in the words the Termite History field uses.
function termiteHistoryFrom(entry) {
  const rd = entry.reportData || {};
  const when = formatIssueDate(visitDate(entry));
  const fs = (rd.findings || []).filter(f => f && f.termiteActivity);
  const live = fs.filter(f => f.termiteActivity === 'ACTIVE'), old = fs.filter(f => f.termiteActivity === 'INACTIVE');
  const where = list => joinPlaces(list.map(f => bracketText(f.activityLocation)).filter(Boolean).slice(0, 2), true);
  const t = entry.quote && entry.quote.treatment;
  const treatedOn = t && t.date ? formatIssueDate(new Date(t.date + 'T00:00:00')) : '';
  if (treatedOn) return `Treated before (${treatedOn}, after our inspection on ${when}${live.length ? `: live termites, ${where(live)}` : ''})`;
  if (live.length) return `Termites reported before (our inspection on ${when}: live termites, ${where(live)})`;
  if (old.length) return `Termites reported before (our inspection on ${when}: workings or damage, ${where(old)})`;
  if (fs.length) return `None known (our inspection on ${when} found no termite activity)`;
  return '';
}

function renderLastVisitBanner() {
  const banner = document.getElementById('lastVisitBanner');
  if (!banner) return;
  const text = document.getElementById('lastVisitText');
  const btn = document.getElementById('lastVisitBtn');
  const skip = document.getElementById('lastVisitSkip');
  const started = reportData.lastVisit;
  // Starting from the last visit is for a report still being written.
  const prev = started || isReportDone() ? null : previousVisitFor();
  if (started) {
    banner.hidden = false;
    text.textContent = `Started from the ${formatIssueDate(started.date)} inspection here.`;
    btn.textContent = 'What changed';
    skip.hidden = true;
  } else if (prev && reportData.lastVisitDismissed !== prev.id) {
    banner.hidden = false;
    text.textContent = `Inspected here before, on ${formatIssueDate(visitDate(prev))}.`;
    btn.textContent = 'Start from it';
    skip.hidden = false;
  } else banner.hidden = true;
  // The job's details say the same under the address, from the moment it's
  // typed: a return visit is known before the agreement, not after it.
  const line = document.getElementById('jobLastVisit');
  if (line) {
    line.textContent = started ? `Started from the ${formatIssueDate(started.date)} inspection here.`
      : prev ? `Inspected here before, on ${formatIssueDate(visitDate(prev))}. The report can start from that one.` : '';
    line.hidden = !line.textContent;
  }
}

function lastVisitAction() {
  if (reportData.lastVisit) openLastVisitChanges();
  else startFromLastVisit();
}

function dismissLastVisit() {
  const prev = previousVisitFor();
  if (prev) reportData.lastVisitDismissed = prev.id;
  saveDraft();
  renderLastVisitBanner();
}

// Copies what doesn't change about the property, and only into blank
// fields, so nothing the inspector has already said is overwritten.
function startFromLastVisit() {
  if (isReportLocked()) { sayLocked(); return; }
  const prev = previousVisitFor();
  if (!prev) { renderLastVisitBanner(); return; }
  const pr = prev.reportData || {};
  let copied = 0;
  const put = (k, v) => {
    reportData[k] = v;
    const el = document.getElementById('f-' + k);
    if (el) renderField(el, k, v);
    copied++;
  };
  LAST_VISIT_KEYS.forEach(k => { if (isBlankValue(reportData[k]) && !isBlankValue(pr[k])) put(k, pr[k]); });
  const history = termiteHistoryFrom(prev);
  if (history && isBlankValue(reportData.termiteHistory)) put('termiteHistory', history);
  reportData.lastVisit = { id: prev.id, date: visitDate(prev), copied };
  delete reportData.lastVisitDismissed;
  updateProgress();
  checkAsbestosFlag();
  checkSystemVerify();
  saveDraft();
  renderLastVisitBanner();
  showToast(copied ? `${copied} detail${copied === 1 ? '' : 's'} copied from the ${formatIssueDate(visitDate(prev))} inspection. Check them as you go` : 'Nothing to copy from the last report', copied ? 'success' : 'info');
  track('last_visit_started', { copied });
}

// Last time against now, the answers a client asks about first.
function openLastVisitChanges() {
  const lv = reportData.lastVisit;
  const prev = lv && getSavedReports().find(r => r.id === lv.id);
  if (!prev) { showToast('The earlier report is no longer on this phone', 'info'); return; }
  const esc = escapeHtml;
  const rows = visitFacts(prev.reportData).map(([label, before], i) => {
    const now = visitFacts(reportData)[i][1];
    // Marked only once this visit has an answer: a blank isn't a change yet.
    const changed = !!before && !!now && before !== now;
    return `<div class="last-visit-row${changed ? ' changed' : ''}"><div class="last-visit-label">${esc(label)}</div>` +
      `<div class="last-visit-cols"><div><small>Last time</small>${esc(before || 'Not recorded')}</div><div><small>Now</small>${esc(now || 'Not yet')}</div></div></div>`;
  });
  document.getElementById('lastVisitSheetSub').textContent =
    `Inspected ${formatIssueDate(visitDate(prev))}${prev.inspector ? ` by ${prev.inspector}` : ''}. ${lv.copied ? `${lv.copied} property detail${lv.copied === 1 ? '' : 's'} were copied from it.` : ''}`;
  document.getElementById('lastVisitRows').innerHTML = rows.join('');
  document.getElementById('lastVisitOverlay').classList.add('open');
  track('screen_viewed', { screen: 'last_visit_changes' });
}
function closeLastVisitChanges() { document.getElementById('lastVisitOverlay').classList.remove('open'); }

// ── ADDRESS SUGGESTIONS ──────────────────────────────────────────────────
// As the street address is typed, real addresses are listed under it; tapping
// one fills street, suburb, state and postcode. lookupAddresses() is the only
// part that talks to an address service. Offline or on any error the list
// just stays empty and the fields work as plain text boxes.
const AU_STATES = { 'new south wales': 'NSW', 'victoria': 'VIC', 'queensland': 'QLD', 'western australia': 'WA',
  'south australia': 'SA', 'tasmania': 'TAS', 'australian capital territory': 'ACT', 'northern territory': 'NT' };
function auStateCode(name) {
  const n = String(name || '').trim();
  return AU_STATES[n.toLowerCase()] || (Object.values(AU_STATES).includes(n.toUpperCase()) ? n.toUpperCase() : '');
}

// Google Places, through the Maps JavaScript API. The key comes from the
// Worker's GOOGLE_MAPS_KEY secret, which keeps it out of this public repo; it
// only works from the SAYON site addresses set on it in Google Cloud (HTTP
// referrer restriction), and only for Maps JavaScript and Places. Until the
// secret is set there are no suggestions and the boxes work as plain text.
let googleMapsKey = null; // a promise of the key, '' when there is none
function getGoogleMapsKey() {
  if (!googleMapsKey) {
    googleMapsKey = workerFetch('/maps-key', { method: 'GET' }).then(async res => {
      if (res.ok) return (await res.json()).key || '';
      if (![404, 405, 501].includes(res.status)) googleMapsKey = null; // ask again later
      return '';
    }).catch(() => { googleMapsKey = null; return ''; });
  }
  return googleMapsKey;
}
let googlePlacesLib = null;
let addressSessionToken = null;
function loadGooglePlaces(key) {
  if (googlePlacesLib) return googlePlacesLib;
  googlePlacesLib = new Promise((resolve, reject) => {
    window.__sayonMapsReady = () => resolve();
    const sc = document.createElement('script');
    sc.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key)
      + '&loading=async&callback=__sayonMapsReady';
    sc.async = true;
    sc.onerror = () => { googlePlacesLib = null; reject(new Error('Maps did not load')); };
    document.head.appendChild(sc);
  }).then(() => google.maps.importLibrary('places'));
  return googlePlacesLib;
}

// Resolves [{ label, area, prediction }] for the typed text.
async function lookupAddresses(query) {
  const key = await getGoogleMapsKey();
  if (!key) return [];
  const places = await loadGooglePlaces(key);
  if (!addressSessionToken) addressSessionToken = new places.AutocompleteSessionToken();
  const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
    input: query, includedRegionCodes: ['au'], sessionToken: addressSessionToken,
  });
  return (suggestions || []).map(s => s.placePrediction).filter(Boolean).map(p => ({
    label: p.mainText ? p.mainText.text : p.text.text,
    area: p.secondaryText ? p.secondaryText.text : '',
    prediction: p,
  }));
}

// The picked suggestion's street, suburb, state and postcode.
async function addressParts(prediction) {
  const place = prediction.toPlace();
  await place.fetchFields({ fields: ['addressComponents', 'location'] });
  addressSessionToken = null; // a pick ends the billing session
  const part = (type, short) => {
    const c = (place.addressComponents || []).find(x => (x.types || []).includes(type));
    return c ? (short ? c.shortText : c.longText) : '';
  };
  const unit = part('subpremise', true);
  const number = part('street_number', true);
  return {
    street: [unit && number ? unit + '/' + number : number, part('route')].filter(Boolean).join(' '),
    suburb: part('locality') || part('sublocality') || part('postal_town'),
    state: auStateCode(part('administrative_area_level_1', true)),
    postcode: part('postal_code', true),
    location: place.location ? { lat: place.location.lat(), lng: place.location.lng() } : null,
  };
}

let addressSuggestTimer = null;
let addressSuggestions = [];
function onAddressTyped(value) {
  clearTimeout(addressSuggestTimer);
  delete reportData.siteLocation; // a typed address has no map point
  const q = String(value || '').trim();
  if (q.length < 4 || !navigator.onLine) { hideAddressSuggestions(); return; }
  addressSuggestTimer = setTimeout(async () => {
    try {
      const list = await lookupAddresses(q);
      if (document.getElementById('jobAddress').value.trim() !== q) return; // typed on since
      showAddressSuggestions(list);
    } catch (e) {
      hideAddressSuggestions();
    }
  }, 300);
}

function showAddressSuggestions(list) {
  const box = document.getElementById('addrSuggest');
  if (!box) return;
  addressSuggestions = list;
  if (!list.length) { hideAddressSuggestions(); return; }
  box.innerHTML = list.map((a, i) => `<button type="button" class="addr-suggest-item" role="option"
      onmousedown="event.preventDefault()" onclick="pickAddressSuggestion(${i})">
      <span class="addr-suggest-street">${escapeHtml(a.label)}</span>
      <span class="addr-suggest-area">${escapeHtml(a.area)}</span>
    </button>`).join('') + '<div class="addr-suggest-credit">Powered by Google</div>';
  box.classList.add('open');
}

function hideAddressSuggestions() {
  const box = document.getElementById('addrSuggest');
  if (box) { box.classList.remove('open'); box.innerHTML = ''; }
}

async function pickAddressSuggestion(i) {
  const pick = addressSuggestions[i];
  hideAddressSuggestions();
  if (!pick) return;
  let a;
  try { a = await addressParts(pick.prediction); }
  catch (e) { showToast('Could not fetch that address, type it in instead', 'error'); return; }
  const set = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
  set('jobAddress', a.street);
  set('jobSuburb', a.suburb);
  set('jobState', a.state);
  set('jobPostcode', a.postcode);
  if (a.location) reportData.siteLocation = a.location;
  updateJob();
  if (a.location && inspectionIsToday()) fillWeather({ quiet: true });
}

// The state a postcode belongs to, by Australia Post's ranges, or ''.
function stateForPostcode(pc) {
  if (!/^\d{4}$/.test(pc || '')) return '';
  const n = +pc;
  if ((n >= 200 && n <= 299) || (n >= 2600 && n <= 2618) || (n >= 2900 && n <= 2920)) return 'ACT';
  if (n >= 800 && n <= 999) return 'NT';
  if (n >= 1000 && n <= 2999) return 'NSW';
  if ((n >= 3000 && n <= 3999) || (n >= 8000 && n <= 8999)) return 'VIC';
  if ((n >= 4000 && n <= 4999) || (n >= 9000 && n <= 9999)) return 'QLD';
  if (n >= 5000 && n <= 5999) return 'SA';
  if (n >= 6000 && n <= 6999) return 'WA';
  if (n >= 7000 && n <= 7999) return 'TAS';
  return '';
}

// A typed postcode fills in the state: when none is picked yet, or the
// picked one came from an earlier postcode. A state tapped by hand stays.
function onPostcodeTyped(el) {
  const digits = el.value.replace(/\D/g, '').slice(0, 4);
  if (digits !== el.value) el.value = digits;
  const st = stateForPostcode(digits);
  const sel = document.getElementById('jobState');
  if (st && sel && (!sel.value || sel.value === sel.dataset.auto)) { sel.value = st; sel.dataset.auto = st; }
  updateJob();
}

// ── WEATHER ON THE DAY ───────────────────────────────────────────────────
// Temperature, humidity and the last 24 hours of rain at the property, from
// the Worker's /weather route (Google's Weather API). Picking the address on
// the day of the inspection fills the empty ones quietly, and so does
// opening the job on that day when it was booked ahead; "Fill from today's
// weather" fills them all, from the picked address or else the phone's
// location. The inspector can still edit every value.
const WEATHER_KEYS = ['weatherConditions', 'temperature', 'humidity', 'rainLast24h'];
function inspectionIsToday() {
  const d = (document.getElementById('jobInspectionDate') || {}).value || reportData.jobInspectionDate;
  return !d || d === todayIsoDate();
}

// The quiet fill when a job is opened on its inspection day. A job booked
// ahead had its address picked days before, when there was no weather to
// take. Once a day for each job, and only while the report is being written.
const weatherTried = new Set();
function fillWeatherOnTheDay() {
  if (!reportData.siteLocation || reportData.jobInspectionDate !== todayIsoDate()) return;
  if (isReportDone() || isSampleJob(currentReportId)) return;
  if (WEATHER_KEYS.every(k => reportData[k])) return;
  const key = (currentReportId || 'draft') + ' ' + todayIsoDate();
  if (weatherTried.has(key)) return;
  weatherTried.add(key);
  fillWeather({ quiet: true });
}

// The inspection moved to another day. What the weather filled in was the
// old day's, so it goes (a reading the inspector gave stays), and today's
// comes in if the new day is today.
function weatherForNewDay() {
  const filled = reportData.weatherFilled;
  if (filled && !isReportDone()) {
    WEATHER_KEYS.forEach(k => {
      if (!reportData[k] || reportData[k] !== filled[k]) return;
      delete reportData[k];
      delete filled[k];
      const el = document.getElementById('f-' + k);
      if (el) { el.classList.remove('filled'); el.textContent = '—'; }
    });
    updateProgress();
  }
  weatherTried.delete((currentReportId || 'draft') + ' ' + todayIsoDate());
  fillWeatherOnTheDay();
}

// Google's condition type as one of the report's Weather Conditions choices.
function weatherConditionsFrom(type) {
  const t = String(type || '');
  if (!t) return null;
  if (/HEAVY|THUNDER|^RAIN$|WIND_AND_RAIN/.test(t)) return 'Heavy rain';
  if (/RAIN|SHOWER|DRIZZLE/.test(t)) return 'Light rain';
  if (/WIND/.test(t)) return 'Windy';
  if (/CLEAR|PARTLY_CLOUDY/.test(t)) return 'Fine and dry';
  if (/CLOUDY/.test(t)) return 'Overcast';
  return null;
}

function phoneLocation() {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise(resolve => navigator.geolocation.getCurrentPosition(
    p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
    () => resolve(null),
    { timeout: 10000, maximumAge: 600000 }));
}

// quiet: the automatic fill (an address picked, or the job opened, on the
// day). It fills only empty fields, never asks for the phone's location and
// shows no messages.
async function fillWeather({ quiet = false } = {}) {
  const btn = document.getElementById('weatherFillBtn');
  const say = (msg, kind) => { if (!quiet) showToast(msg, kind); };
  const job = reportData;
  if (btn) { btn.disabled = true; btn.textContent = 'Getting the weather…'; }
  try {
    const loc = reportData.siteLocation || (quiet ? null : await phoneLocation());
    if (!loc) { say('Pick the address from the list, or allow location, to get the weather', 'info'); return; }
    const res = await workerFetch(`/weather?lat=${loc.lat.toFixed(4)}&lng=${loc.lng.toFixed(4)}`, { method: 'GET' });
    if (res.status === 501) { say("Weather isn't set up yet, so enter it by hand", 'info'); return; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const w = await res.json();
    // Another job was opened while this one's weather was on its way.
    if (job !== reportData) return;
    // The button refreshes what the weather filled before, but never a
    // reading the inspector dictated or typed: 65% said on site beats 74%
    // from the nearest station.
    const filled = reportData.weatherFilled || (reportData.weatherFilled = {});
    let kept = 0, changed = 0;
    const set = (key, val, always) => {
      if (val === null || val === undefined) return;
      const cur = reportData[key];
      if (cur && !(always && cur === filled[key])) { if (always && cur !== val) kept++; return; }
      reportData[key] = val;
      filled[key] = val;
      changed++;
      const el = document.getElementById('f-' + key);
      if (el) renderField(el, key, val);
    };
    const num = n => typeof n === 'number' && Number.isFinite(n);
    set('weatherConditions', weatherConditionsFrom(w.type), false);
    set('temperature', num(w.tempC) ? Math.round(w.tempC) + '°C' : null, !quiet);
    set('humidity', num(w.humidity) ? Math.round(w.humidity) + '%' : null, !quiet);
    set('rainLast24h', num(w.rain24h) ? (w.rain24h > 0 ? Math.round(w.rain24h * 10) / 10 + ' mm' : 'None') : null, !quiet);
    updateProgress();
    saveDraft();
    if (changed) say(kept ? "Weather filled in. Readings you'd already entered were kept" : 'Weather filled in. Tap a value to change it', 'success');
    else say(kept ? "Kept the readings you'd already entered. Clear one to fill it from the weather" : 'Weather is already filled in', 'info');
  } catch (e) {
    say("Couldn't get the weather, so enter it by hand", 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Fill from today's weather"; }
  }
}

// ── APPLICABLE STANDARD ──────────────────────────────────────────────────
function setStandard(val) {
  reportData.standard = val;
  const el = document.getElementById('f-standard');
  if (el) renderField(el, 'standard', val);
  updateProgress();
}

// ══════════════════════════════════════════════════════════════════════════
// PERSISTENCE — SAVED REPORTS (localStorage)
// ══════════════════════════════════════════════════════════════════════════
// Each account keeps its reports under its own key, so switching accounts
// on one phone never wipes or shows another account's jobs, and a report
// saved a moment ago is there at once without waiting for the cloud.
const STORAGE_KEY = 'korva_saved_reports'; // legacy flat key, pre-multi-tenant - kept only for one-time migration below
const DRAFT_KEY = 'korva_draft';
let currentReportId = null;

// The made-up job a new inspector can tap through (js/sample-job.js). It
// stays on this phone: never synced, backed up, listed as due or offered as
// a last visit, and its emails go to the business, not a client.
const SAMPLE_JOB_ID = 'sample_job';
function isSampleJob(idOrEntry) {
  const id = idOrEntry && typeof idOrEntry === 'object' ? idOrEntry.id : idOrEntry;
  return id === SAMPLE_JOB_ID;
}

function reportsStorageKey() {
  return (authUser && authUser.id) ? `korva_saved_reports_${authUser.id}` : STORAGE_KEY;
}

// One-time migration: whoever happens to be the first to sign in after this
// fix inherits whatever was sitting in the old shared flat key (there's no
// reliable way to tell which account it "belonged" to, but it was a single
// shared key before multi-tenant scoping existed, so there was only ever
// meant to be one real account's data in it on a given device). Consumes
// the legacy key so it's only ever handed out once.
function migrateLegacySavedReports() {
  if (!authUser || !authUser.id) return;
  const perUserKey = reportsStorageKey();
  try {
    if (localStorage.getItem(perUserKey)) return; // this account already has its own
    const legacy = localStorage.getItem(STORAGE_KEY);
    if (!legacy) return;
    localStorage.setItem(perUserKey, legacy);
    localStorage.removeItem(STORAGE_KEY);
  } catch(e) {}
}

// ── JOB INFO ─────────────────────────────────────────────────────────────
// Per-report job tracking fields — saved into reportData and draft.
// Invoice no., referral source and payment status were dropped from the
// screen (nothing printed or used them); older reports keep their values.
const JOB_INFO_FIELDS = ['jobOrderId','jobInspectionType','jobInspectionDate','jobInspectionTime',
                          'jobFee','jobClientPhone','jobClientEmail','jobNotes','jobInitialRef'];

function saveJobInfo() {
  const day = reportData.jobInspectionDate || '';
  JOB_INFO_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) reportData[id] = el.value;
  });
  if ((reportData.jobInspectionDate || '') !== day) weatherForNewDay();
  syncAllSelectCards();
  renderDateChips();
  if (typeof renderReportJobCard === 'function') renderReportJobCard();
  refreshJobNewNext();
  saveDraft();
}

// ── DATE CHIPS ───────────────────────────────────────────────────────────
// The booking's day in one tap: Today, Tomorrow and the next five days. The
// chosen one is lit (a day further out shows as its own chip), and the date
// field stays for anything else, so nobody pages through a calendar month by
// month. The time is typed in its own box (the time buttons went 12 Nov 2026).
function renderDateChips() {
  const dateWrap = document.getElementById('jobDateChips');
  const date = document.getElementById('jobInspectionDate');
  if (!dateWrap || !date) return;
  const now = new Date();
  const days = Array.from({ length: 7 }, (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + i));
  const chip = (on, label, call) => `<button type="button" class="date-chip${on ? ' on' : ''}" aria-pressed="${on}" onclick="${call}">${label}</button>`;
  const dayLabel = (d, i) => i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric' });
  const picked = date.value;
  const inRange = days.some(d => isoDate(d) === picked);
  const other = picked && !inRange ? new Date(picked + 'T00:00:00') : null;
  dateWrap.innerHTML = (other && !isNaN(other) ? chip(true, other.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }), `pickJobDate('${picked}')`) : '')
    + days.map((d, i) => chip(isoDate(d) === picked, dayLabel(d, i), `pickJobDate('${isoDate(d)}')`)).join('');
  // The lit chip in view, without moving the page.
  const on = dateWrap.querySelector('.date-chip.on');
  if (on && dateWrap.clientWidth && (on.offsetLeft + on.offsetWidth > dateWrap.scrollLeft + dateWrap.clientWidth || on.offsetLeft < dateWrap.scrollLeft)) dateWrap.scrollLeft = on.offsetLeft - 8;
}

function pickJobDate(iso) { setJobBookingField('jobInspectionDate', iso); }
function setJobBookingField(id, value) {
  const input = document.getElementById(id);
  if (!input || isReportLocked()) return;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

// The inspection type decides which Australian Standard the report follows.
// AS 4349.3 is the standard for any timber pest inspection, pre-purchase or
// the owner's annual one (AS 3660.2 points to it for inspections), and the
// report's termite management advice refers to AS 3660.2 (T&C 10).
const INSPECTION_TYPE_STANDARD = {
  // A special purpose inspection is a termite inspection with its own scope (AS 3660.2).
  'Special Purpose — Termite Inspection': 'AS 3660.2-2017',
  'Pre-Purchase — Timber Pest': 'AS 4349.3-2010',
  'Pre-Purchase — Combined Building & Pest': 'AS 4349.3-2010',
  'Annual — Existing Building': 'AS 4349.3-2010',
};
// Whether this job is a pre-purchase inspection. The inspection type decides;
// only a report with no type falls back to the standard it cites. The cover
// label, the agreement wording and the "not for buying or selling" notice all
// use this, so an insurance or legal job citing AS 4349.3 is never labelled
// pre-purchase.
// The report's title follows its standard: AS 4349.3 is a timber pest
// inspection (termites, borers, decay, delignification), AS 3660.2 and the
// rest a termite inspection.
function reportKindTitle() {
  if (isSpecialPurposeJob()) return 'Special Purpose Termite Inspection Report';
  const timberPest = isPrePurchaseJob() || /^AS 4349\.3/.test(reportData.standard || '');
  return timberPest ? 'Timber Pest Inspection Report' : 'Termite Inspection Report';
}

// A new construction job: a termite management system put in while the
// building goes up (AS 3660.1). There's no agreement, inspection report or
// quote: the treatment record is the job, and its treatment certificate
// goes to the client, usually the builder. Chosen as the type of job, or
// from a new job's page (setNewBuildJob).
const NEW_BUILD_JOB_TYPE = 'New Construction — Termite Management System';
function isNewBuildJob(d = reportData) {
  return !!d && d.jobInspectionType === NEW_BUILD_JOB_TYPE;
}
// From a new job's page: make it a new construction job, or back to an inspection.
function setNewBuildJob(on) {
  const sel = document.getElementById('jobInspectionType');
  if (!sel) return;
  sel.value = on ? NEW_BUILD_JOB_TYPE : '';
  onInspectionTypeChange();
}

// ── SPECIAL PURPOSE ── A special purpose termite inspection: one with a
// scope of its own, often after an earlier inspection (a follow-up, an
// invasive look, areas that couldn't be reached before, how a treatment or
// a system is doing). Chosen as the type of job; Job details then asks what
// it's for (reportData.jobPurposes) and the first inspection's report or
// job no. (jobInitialRef). The report is titled for it, and the agreement
// and the report's Client & Inspection Details say what it's for.
const SPECIAL_PURPOSE_JOB_TYPE = 'Special Purpose — Termite Inspection';
const SPECIAL_PURPOSES = [
  'Follow up an earlier inspection',
  'Carry out a physically invasive inspection',
  'Carry out a specialised non-invasive inspection',
  'Inspect areas that were hindered or restricted and can now be reached',
  'Inspect areas not inspected before',
  'Assess the termite management action taken',
  'Assess the termite management systems in place',
  'Assess how well a termite treatment worked',
  'Assess the risk management measures taken',
];
function isSpecialPurposeJob(d = reportData) {
  return !!d && d.jobInspectionType === SPECIAL_PURPOSE_JOB_TYPE;
}
// "To follow up an earlier inspection and inspect areas not inspected before."
function specialPurposeText(d = reportData) {
  const list = isSpecialPurposeJob(d) && Array.isArray(d.jobPurposes) ? d.jobPurposes.filter(Boolean) : [];
  return list.length ? `To ${joinWithAnd(list.map(lowerFirst))}.` : '';
}
// Job details and the agreement's sheet tick the same list (box: its wrap).
const SPECIAL_PURPOSE_BOXES = { jobPurposes: 'jobPurposeWrap', agreementPurposes: 'agreementPurposeWrap' };
function renderJobPurposes() {
  const on = isSpecialPurposeJob();
  const picked = Array.isArray(reportData.jobPurposes) ? reportData.jobPurposes : [];
  const html = [...new Set([...SPECIAL_PURPOSES, ...picked])].map(p => `<label class="treat-method">
      <input type="checkbox" value="${escapeHtml(p)}" ${picked.includes(p) ? 'checked' : ''} onchange="onJobPurposeToggle(this)"><span>${escapeHtml(p)}</span></label>`).join('');
  Object.entries(SPECIAL_PURPOSE_BOXES).forEach(([box, wrap]) => {
    const w = document.getElementById(wrap), b = document.getElementById(box);
    if (!w || !b) return;
    w.hidden = !on;
    b.innerHTML = html;
  });
}
function onJobPurposeToggle(input) {
  const box = input.closest('.treat-methods');
  reportData.jobPurposes = [...box.querySelectorAll('input:checked')].map(i => i.value);
  // The other list follows, without redrawing the one being ticked.
  Object.keys(SPECIAL_PURPOSE_BOXES).filter(id => id !== box.id).forEach(id =>
    document.querySelectorAll(`#${id} input`).forEach(i => { i.checked = reportData.jobPurposes.includes(i.value); }));
  if (agreementEditOpen()) refreshAgreementPreview();
  saveDraft();
}

function isPrePurchaseJob(d = reportData) {
  const type = d.jobInspectionType || '';
  if (type) return /pre-purchase/i.test(type);
  return (d.standard || '') === 'AS 4349.3-2010';
}

function onInspectionTypeChange() {
  saveJobInfo();
  const std = INSPECTION_TYPE_STANDARD[document.getElementById('jobInspectionType').value];
  if (std && std !== reportData.standard) {
    setStandard(std);
    showToast(`Report will follow ${std}`, 'info');
  }
  renderJobPurposes();
  // A new construction job has other steps, so This job is drawn again.
  if (document.getElementById('jobOverlay')?.classList.contains('open')) renderJobPage();
}

function loadJobInfo() {
  // Older reports kept the fee only on the signed agreement.
  if (!reportData.jobFee && reportData.agreement && reportData.agreement.fee) reportData.jobFee = reportData.agreement.fee;
  // The agreement carries the inspection date too.
  if (!reportData.jobInspectionDate && reportData.agreement && reportData.agreement.inspectionDate) reportData.jobInspectionDate = reportData.agreement.inspectionDate;
  JOB_INFO_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el && reportData[id] !== undefined) el.value = reportData[id];
  });
  syncAllSelectCards();
  renderDateChips();
  renderJobPurposes();
}

function clearJobInfo() {
  JOB_INFO_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
    delete reportData[id];
  });
  delete reportData.jobPurposes;
  syncAllSelectCards();
  renderDateChips();
  renderJobPurposes();
}

// Details saved under the old shared key (COMPANY_KEY, in common.js) move to the business whose name
// matches them; if none matches they're left where they are, unused, rather
// than guessed onto the wrong business.
function migrateLegacyCompanyDetails() {
  if (!authBusiness || !authBusiness.id) return;
  const perBizKey = companyStorageKey();
  try {
    if (localStorage.getItem(perBizKey)) return; // this business already has its own record
    const legacy = localStorage.getItem(COMPANY_KEY);
    if (!legacy) return;
    const d = JSON.parse(legacy);
    if (d && d.name && authBusiness.name &&
        d.name.trim().toLowerCase() === authBusiness.name.trim().toLowerCase()) {
      localStorage.setItem(perBizKey, legacy);
    }
  } catch(e) {}
}

// Every change to the company details goes through here, so the account
// copy knows which is newer (see js/business-sync.js). False if the phone
// couldn't store it.
function storeCompanyDetails(details) {
  details.updatedAt = Date.now();
  try { localStorage.setItem(companyStorageKey(), JSON.stringify(details)); }
  catch (e) { return false; }
  scheduleBusinessSync();
  return true;
}

// Business details a client-facing PDF should carry, by what's missing.
function companyDetailGaps() {
  const c = getCompanyDetails();
  return [['name', 'business name'], ['licence', 'licence number'], ['abn', 'ABN'], ['phone', 'phone number']]
    .filter(([k]) => !(c[k] || '').trim()).map(([, label]) => label);
}
function joinWithAnd(list) {
  return list.length < 2 ? (list[0] || '') : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
}

const LOGO_MAX_DIMENSION = 240;

function handleCompanyLogoUpload(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('Choose an image file', 'error');
    input.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => showToast('Could not read that file', 'error');
  reader.onload = () => {
    const img = new Image();
    img.onerror = () => showToast('Could not read that image', 'error');
    img.onload = () => {
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > LOGO_MAX_DIMENSION || h > LOGO_MAX_DIMENSION) {
        if (w >= h) { h = Math.round(h * (LOGO_MAX_DIMENSION / w)); w = LOGO_MAX_DIMENSION; }
        else { w = Math.round(w * (LOGO_MAX_DIMENSION / h)); h = LOGO_MAX_DIMENSION; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/png');
      // Saved with the rest of the form (saveBusinessForm)
      businessFormLogo = { logo: dataUrl, logoWidth: w, logoHeight: h };
      renderCompanyLogoPreview(dataUrl);
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
  input.value = '';
}

function removeCompanyLogo() {
  businessFormLogo = null;
  renderCompanyLogoPreview(null);
}

function renderCompanyLogoPreview(dataUrl) {
  const preview = document.getElementById('companyLogoPreview');
  const removeBtn = document.getElementById('companyLogoRemoveBtn');
  if (!preview) return;
  if (dataUrl) {
    preview.innerHTML = '';
    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = 'Company logo';
    preview.appendChild(img);
    if (removeBtn) removeBtn.style.display = '';
  } else {
    preview.innerHTML = '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.5-3.5a2 2 0 0 0-2.8 0L5 21"/></svg>';
    if (removeBtn) removeBtn.style.display = 'none';
  }
  renderBusinessPreview();
}
// Reports save to localStorage first (instant) then sync to Supabase in the
// background. The app works fully offline — Supabase is backup/cloud copy.
const SUPABASE_URL  = 'https://bmjgvogxutwyeklxxeao.supabase.co';
const SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJtamd2b2d4dXR3eWVrbHh4ZWFvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0NTczMTEsImV4cCI6MjEwNTAzMzMxMX0.Ov8xGhDMuAbUcWy7zbCiS01D6QCrlhDYxza3Fzls83U';
