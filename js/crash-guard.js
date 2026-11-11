// ── CRASH GUARD ───────────────────────────────────────────────────────────
// Two jobs, so a crash never costs an inspector their work or goes unheard:
//
// 1. Save on crash. The report, the quote and any half-filled sheet already
//    save a moment after each change (saveDraft, scheduleQuoteSave, UNSAVED
//    SHEETS in js/quote.js). When something breaks, everything still
//    waiting on those timers is saved straight away, before the page can
//    die.
//
// 2. Report a problem (Menu › Report a problem). Each error is kept on the
//    phone (the last 20, with the app's last few steps). If the app closed
//    while it was on screen (the phone killed it or it crashed, rather than
//    being put away or reloaded), the next start says the work was kept and
//    offers to tell us. A report goes to Supabase `problem_reports`
//    (supabase/problem-reports.sql) with what the inspector wrote and, if
//    they leave it ticked, the technical details shown on the sheet. No
//    signal: it waits on the phone and goes later. Not signed in or no
//    table yet: it opens an email to SAYON instead.
//
// Loaded straight after js/telemetry.js (it reuses scrubTelemetryText) and
// before the js/app/ files, so errors while the app starts are caught too.
// The js/app/ names it calls are looked up when it runs, not when it loads.

const ERROR_LOG_KEY = 'korva_error_log';
const ERROR_LOG_MAX = 20;
const SESSION_STATE_KEY = 'korva_session_state';
const PROBLEM_QUEUE_KEY = 'korva_problem_queue';
// SUPPORT_EMAIL (the address reports fall back to) is in js/app/account.js.

function readStoredList(key) {
  try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function writeStoredList(key, list) {
  try {
    if (list.length) localStorage.setItem(key, JSON.stringify(list));
    else localStorage.removeItem(key);
  } catch {}
}

// Where the inspector was: the last screen opened, the report step, and any
// form sheet on top.
function crashWhere() {
  const where = {};
  try { if (typeof lastScreenViewed !== 'undefined' && lastScreenViewed) where.screen = lastScreenViewed; } catch {}
  try { if (typeof currentStep !== 'undefined') where.step = currentStep; } catch {}
  try {
    const open = document.querySelector('.page-sheet-overlay.open, .quote-overlay.open');
    if (open && open.id) where.sheet = open.id;
  } catch {}
  return where;
}

// ── SAVE ON CRASH ──
// Each save is tried on its own, so one that throws can't stop the rest.
function saveEverythingNow() {
  const steps = [
    () => { if (appInitialised) flushDraftSave(); }, // before setup the boxes are empty
    () => flushQuoteSave(),
    () => keepUnsavedSheet(),
  ];
  steps.forEach(fn => { try { fn(); } catch {} });
}

// Browser noise that isn't a fault in the app.
function ignorableError(message) {
  return /^Script error\.?$/i.test(message)
    || /ResizeObserver loop/i.test(message)
    || /^(AbortError|The operation was aborted)/i.test(message);
}

let crashSavingNow = false;
function recordAppError(err, kind) {
  const message = String((err && err.message) || err || 'Unknown error');
  if (ignorableError(message)) return;
  // Saving first: if the page is about to die, the work matters more.
  if (!crashSavingNow) {
    crashSavingNow = true;
    try { saveEverythingNow(); } finally { crashSavingNow = false; }
  }
  const stack = String((err && err.stack) || '')
    .split('\n').slice(0, 8)
    .map(line => scrubTelemetryText(line.replace(/https?:\/\/[^\s)]+/g, u => scrubTelemetryUrl(u))))
    .join('\n');
  const log = readStoredList(ERROR_LOG_KEY);
  log.push({
    at: Date.now(),
    kind,
    message: scrubTelemetryText(message),
    stack,
    ...crashWhere(),
    steps: typeof recentSteps !== 'undefined' ? recentSteps.slice(-8) : [],
  });
  writeStoredList(ERROR_LOG_KEY, log.slice(-ERROR_LOG_MAX));
}

window.addEventListener('error', (e) => {
  // A picture or script that failed to load fires here too, on its element.
  if (e.target && e.target !== window) return;
  recordAppError(e.error || e.message, 'error');
});
window.addEventListener('unhandledrejection', (e) => {
  recordAppError(e.reason, 'promise');
});

// ── DID IT CLOSE ON SCREEN? ──
// 'open' while the app is on screen, 'away' once it's put away, closed or
// reloaded (all of which fire visibilitychange or pagehide first). Finding
// 'open' at the next start means the page died while in use.
let closedOnScreen = null; // { at, errors } from the last run, or null
(() => {
  try {
    const last = JSON.parse(localStorage.getItem(SESSION_STATE_KEY) || 'null');
    if (last && last.state === 'open') {
      closedOnScreen = { at: last.at, errors: readStoredList(ERROR_LOG_KEY).filter(e => e.at >= (last.since || 0)) };
    }
  } catch {}
})();
const sessionStartedAt = Date.now();
function markSession(state) {
  try { localStorage.setItem(SESSION_STATE_KEY, JSON.stringify({ state, at: Date.now(), since: sessionStartedAt })); } catch {}
}
markSession(document.visibilityState === 'hidden' ? 'away' : 'open');
document.addEventListener('visibilitychange', () => markSession(document.hidden ? 'away' : 'open'));
window.addEventListener('pagehide', () => markSession('away'));
window.addEventListener('pageshow', () => { if (!document.hidden) markSession('open'); });

// Called once the app is up (ENTER APP and SESSION RESTORE in js/app/): if
// the last run ended on screen, say the work was kept and offer to tell us.
let crashNoticeShown = false;
function maybeOfferCrashReport() {
  if (crashNoticeShown || !closedOnScreen) return;
  crashNoticeShown = true;
  const crash = closedOnScreen;
  // Only once: a second start shouldn't ask again about the same crash.
  closedOnScreen = null;
  track('closed_on_screen', { errors: crash.errors.length });
  setTimeout(() => {
    showToast('SAYON closed unexpectedly last time. Your work was saved as you went', 'info', {
      label: 'Tell us',
      ms: 12000,
      run: () => openProblemReport('crash', crash),
    });
  }, 1500);
}

// ── REPORT A PROBLEM ──
let problemReportContext = null; // { kind: 'problem' | 'crash', crash }

async function appVersion() {
  try {
    const keys = await caches.keys();
    const v = keys.filter(k => /^korva-v\d+$/.test(k)).sort((a, b) => parseInt(b.slice(7), 10) - parseInt(a.slice(7), 10))[0];
    return v || '';
  } catch { return ''; }
}

// The technical details, exactly as they're sent and shown on the sheet.
// No client names, addresses, report text or photos: the error messages
// and stacks were already scrubbed when they were kept.
async function problemDetails() {
  const errors = readStoredList(ERROR_LOG_KEY).slice(-10);
  let sentryId = '';
  try { if (typeof sentryReady !== 'undefined' && sentryReady) sentryId = Sentry.lastEventId() || ''; } catch {}
  return {
    version: await appVersion(),
    device: {
      ...telemetryDeviceProps,
      installed: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
      screen: `${screen.width}x${screen.height}`,
      online: navigator.onLine,
      userAgent: navigator.userAgent,
    },
    where: (problemReportContext && problemReportContext.where) || crashWhere(),
    steps: typeof recentSteps !== 'undefined' ? recentSteps.filter(st => st !== 'screen:problem_report').slice(-10) : [],
    closedOnScreenAt: problemReportContext && problemReportContext.crash ? new Date(problemReportContext.crash.at).toISOString() : null,
    errors: errors.map(e => ({ ...e, at: new Date(e.at).toISOString() })),
    sentryEventId: sentryId,
  };
}

function problemDetailsText(d) {
  const lines = [
    `App: ${d.version || 'unknown'}`,
    `Phone: ${d.device.$os} · ${d.device.$browser} · ${d.device.screen}${d.device.installed ? ' · installed' : ''}`,
    `On screen: ${[d.where.screen, d.where.step, d.where.sheet].filter(Boolean).join(' › ') || 'unknown'}`,
  ];
  if (d.closedOnScreenAt) lines.push(`Closed while in use: ${new Date(d.closedOnScreenAt).toLocaleString('en-AU')}`);
  if (d.steps.length) lines.push(`Last steps: ${d.steps.join(' › ')}`);
  lines.push(d.errors.length ? `Errors kept on this phone (${d.errors.length}):` : 'No errors kept on this phone.');
  d.errors.slice().reverse().forEach(e => {
    lines.push(`• ${new Date(e.at).toLocaleString('en-AU')}: ${e.message}${e.screen || e.step ? ` (${[e.screen, e.step].filter(Boolean).join(' › ')})` : ''}`);
  });
  return lines.join('\n');
}

async function openProblemReport(kind = 'problem', crash = null) {
  // Where they were, before this sheet becomes the screen they're on.
  problemReportContext = { kind, crash, where: crashWhere() };
  if (document.getElementById('sidebarPanel')?.classList.contains('open') && typeof toggleDrawer === 'function') toggleDrawer();
  track('screen_viewed', { screen: 'problem_report' });
  const crashed = kind === 'crash';
  document.getElementById('problemTitle').textContent = crashed ? 'SAYON closed unexpectedly' : 'Report a problem';
  document.getElementById('problemIntro').textContent = crashed
    ? 'SAYON closed while you were using it. Your work was saved as you went. Tell us what you were doing and we\'ll find the cause.'
    : 'Something not working, or something you\'d like it to do? Tell us and it comes straight to the SAYON team.';
  document.getElementById('problemMessage').value = '';
  document.getElementById('problemIncludeDetails').checked = true;
  document.getElementById('problemDetails').textContent = problemDetailsText(await problemDetails());
  document.getElementById('problemSendBtn').disabled = false;
  document.getElementById('problemOverlay').classList.add('open');
  setTimeout(() => document.getElementById('problemMessage').focus(), 50);
}

function closeProblemReport() {
  document.getElementById('problemOverlay').classList.remove('open');
}

async function buildProblemReport() {
  const message = document.getElementById('problemMessage').value.trim();
  const withDetails = document.getElementById('problemIncludeDetails').checked;
  const details = withDetails ? await problemDetails() : { version: await appVersion() };
  let businessId = null, jobId = null;
  try { businessId = (authBusiness && authBusiness.id) || null; } catch {}
  try { jobId = withDetails ? (currentReportId || null) : null; } catch {}
  return {
    id: telemetryRandomId(),
    kind: problemReportContext ? problemReportContext.kind : 'problem',
    message,
    details,
    business_id: businessId,
    report_id: jobId,
    app_version: details.version || null,
    created_at: new Date().toISOString(),
  };
}

// 'sent', 'queued' (no signal, goes later), or 'email' (no account or no
// table: the inspector's mail app opens with it instead).
async function deliverProblemReport(report) {
  const signedIn = typeof authSession !== 'undefined' && authSession && typeof SUPABASE_URL !== 'undefined';
  if (!signedIn) return 'email';
  if (!navigator.onLine) return 'queued';
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/problem_reports`, {
      method: 'POST',
      headers: getAuthHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify(report),
    });
    // 409: this report already went (sent once, the answer lost).
    if (res.ok || res.status === 409) return 'sent';
    if (res.status >= 500 || res.status === 401 || res.status === 429) return 'queued';
    return 'email';
  } catch {
    return 'queued';
  }
}

function emailProblemReport(report) {
  const body = [
    report.message || '(No message written)',
    '',
    '---',
    report.details && report.details.device ? problemDetailsText(report.details) : `App: ${report.app_version || 'unknown'}`,
  ].join('\n');
  const subject = report.kind === 'crash' ? 'SAYON closed unexpectedly' : 'SAYON problem report';
  // Mail apps cut very long links, so the details are kept short.
  location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.slice(0, 1800))}`;
}

async function sendProblemReport() {
  const btn = document.getElementById('problemSendBtn');
  if (!document.getElementById('problemMessage').value.trim() && !(problemReportContext && problemReportContext.kind === 'crash')) {
    showToast('Write a line about what went wrong first', 'error');
    return;
  }
  btn.disabled = true;
  const report = await buildProblemReport();
  const result = await deliverProblemReport(report);
  track('problem_reported', { kind: report.kind, result, details: !!report.details.device });
  if (result === 'sent') {
    clearReportedErrors(report);
    closeProblemReport();
    showToast('Sent to the SAYON team. Thanks, we\'ll look into it', 'success');
  } else if (result === 'queued') {
    writeStoredList(PROBLEM_QUEUE_KEY, readStoredList(PROBLEM_QUEUE_KEY).concat([report]).slice(-10));
    clearReportedErrors(report);
    closeProblemReport();
    showToast('No signal. It\'ll send to the SAYON team when you\'re back online', 'info');
  } else {
    closeProblemReport();
    emailProblemReport(report);
  }
}

// Errors that went with a report aren't sent again with the next one.
function clearReportedErrors(report) {
  const sent = new Set(((report.details && report.details.errors) || []).map(e => e.at));
  if (!sent.size) return;
  writeStoredList(ERROR_LOG_KEY, readStoredList(ERROR_LOG_KEY).filter(e => !sent.has(new Date(e.at).toISOString())));
}

// Reports written with no signal go once there is one.
let problemQueueSending = false;
async function sendQueuedProblemReports() {
  if (problemQueueSending || !navigator.onLine) return;
  const queue = readStoredList(PROBLEM_QUEUE_KEY);
  if (!queue.length) return;
  problemQueueSending = true;
  try {
    const left = [];
    for (const report of queue) {
      const result = await deliverProblemReport(report);
      // No account or no table: kept until there is one.
      if (result !== 'sent') left.push(report);
    }
    writeStoredList(PROBLEM_QUEUE_KEY, left);
  } finally {
    problemQueueSending = false;
  }
}
window.addEventListener('online', sendQueuedProblemReports);
