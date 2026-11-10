// SAYON app: App updates, address move, splash, platform navigation, keyboard access, back, where you were.
// One of the js/app/ files, which share one global scope: they load as plain
// scripts in the order index.html lists them, so a top-level name declared in
// any of them can be used from the others once the page has loaded.

// ── APP UPDATES ───────────────────────────────────────────────────────────
// The service worker serves the cached app first, so a deploy used to need
// two reloads to show. When a new version takes over, the page reloads
// itself, but never mid-dictation or mid-typing: then it waits until the
// app is next put away.
let swRegistration = null;
let updateReloadPending = false;

function appIsBusy() {
  const el = document.activeElement;
  return isRecording || document.body.classList.contains('ai-busy') || formSheetOpen()
    || !!(el && el.matches('input, textarea, select, [contenteditable="true"]'));
}

// A sheet with a form of its own is open (the treatment record, a bait
// visit, the client's answer, the site plan, the agreement, an email being
// checked, a photo being marked up). What's on it isn't saved until its
// button is tapped, so an update waits until it's closed.
const FORM_SHEETS = ['treatmentOverlay', 'baitOverlay', 'quoteAnswerOverlay', 'sitePlanOverlay', 'agreementOverlay', 'sendReviewOverlay', 'problemOverlay'];
function formSheetOpen() {
  const markup = document.getElementById('photoMarkup');
  return FORM_SHEETS.some(id => { const el = document.getElementById(id); return !!el && el.classList.contains('open'); })
    || !!(markup && !markup.hidden);
}

function reloadForUpdate() {
  if (appIsBusy()) { updateReloadPending = true; return; }
  saveBeforeLeaving();
  location.reload();
}

// ── ADDRESS MOVE ──────────────────────────────────────────────────────────
// The site is moving to sayon-app.github.io, because the GitHub account it
// lives under is being renamed. Browsers keep a site's saved data per
// address, so once the new address is up, the copy still cached on a phone
// at the old one backs the inspector's work up to their account and sends
// them across. Signing in there brings the reports (with their quotes),
// photos, company details and prices back.
const OLD_APP_ORIGIN = 'https://byronguyatt2-droid.github.io';
const NEW_APP_URL = 'https://sayon-app.github.io/';
let moveNoticeShown = false;

async function checkAddressMove() {
  if (moveNoticeShown || location.origin !== OLD_APP_ORIGIN || !authSession) return;
  try {
    const res = await fetch(NEW_APP_URL + 'manifest.json', { cache: 'no-store' });
    if (!res.ok || (await res.json()).name !== 'SAYON') return;
  } catch (e) { return; }
  moveNoticeShown = true;
  document.getElementById('moveOverlay').classList.add('open');
  backUpForMove();
}

function closeMoveNotice() {
  document.getElementById('moveOverlay').classList.remove('open');
}

// A photo still only on this phone (no cloud path) isn't backed up.
async function photosBackedUp(entry) {
  for (const p of allReportPhotos(entry.reportData)) {
    if (!p.path && await getPhotoImage(p)) return false;
  }
  return true;
}

async function backUpForMove() {
  const status = document.getElementById('moveStatus');
  const openBtn = document.getElementById('moveOpenBtn');
  const retryBtn = document.getElementById('moveRetryBtn');
  status.textContent = 'Backing up your work to your account…';
  openBtn.hidden = true;
  retryBtn.hidden = true;
  if (document.getElementById('jobAddress').value.trim() && reportSig() !== lastReportSig) saveCurrentReport(true);
  flushDraftSave();
  let missing = 0;
  for (const entry of getSavedReports()) {
    if (!(await supabaseSave(entry, true)) || !(await photosBackedUp(entry))) missing++;
  }
  if (isBusinessOwner()) await pushBusinessSettings();
  const detailsLeft = isBusinessOwner() && localSettingsAhead(authBusiness.settings || {});
  if (missing || detailsLeft) {
    const what = missing ? `${missing} report${missing === 1 ? '' : 's'}` : 'Your company details';
    status.textContent = `${what} couldn't be backed up yet. Check you have internet, then try again.`;
    retryBtn.hidden = false;
    return;
  }
  status.textContent = 'Everything is backed up to your account.';
  openBtn.hidden = false;
}

// ── SPLASH ────────────────────────────────────────────────────────────────
window.addEventListener('load', () => {
  // Register service worker for offline support (PWA only — skip inside the
  // native app wrapper, where Capacitor's own WebView handles asset loading
  // and a service worker can cause stale-cache issues).
  if ('serviceWorker' in navigator && !(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())) {
    const updating = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('service-worker.js', { scope: './' }).then((reg) => {
      swRegistration = reg;
    }).catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
    // A new version took over: this page is still the old one, so load the
    // new one now instead of on the next visit. Skipped on a first install.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (updating) reloadForUpdate();
    });
  }

  // The logo shows for as long as the sign-in check takes, then the app
  // opens. No fixed wait: there is nothing else to load.
  const statusEl = document.getElementById('splashStatus');
  (async () => {
    const splash = document.getElementById('splash');
    const hideSplash = () => new Promise(done => {
      splash.style.opacity = '0';
      setTimeout(() => { splash.style.display = 'none'; done(); }, 250);
    });

    // If we arrived here via a "reset your password" email link, Supabase
    // redirects back with the recovery tokens in the URL hash. Handle that
    // before anything else — it takes priority over any existing session.
    const recovery = parseRecoveryHash();
    if (recovery) {
      await hideSplash();
      pendingRecoverySession = recovery;
      // Strip the tokens out of the visible URL/history now that we've read them.
      history.replaceState(null, '', window.location.pathname + window.location.search);
      document.getElementById('authScreen').style.display = 'flex';
      showAuth('authResetPassword');
      return;
    }

    // The splash stays up while the sign-in and the business load, so the
    // screen is never blank on a weak signal (see START_NETWORK_WAIT_MS),
    // and says what it's waiting on once that takes a second.
    const slow = setTimeout(() => { if (statusEl) statusEl.textContent = 'Signing in…'; splash.classList.add('waiting'); }, 1000);
    const hasSession = await restoreAuthSession();
    clearTimeout(slow);
    await hideSplash();
    if (hasSession) { enterApp(); noticeInviteWhileSignedIn(); }
    else {
      document.getElementById('authScreen').style.display = 'flex';
      // The website's "Start your free trial" lands on the sign-up card.
      showAuth(new URLSearchParams(window.location.search).get('signup') ? 'authSignUp' : 'authSignIn');
      applyInviteToSignUp();
    }
  })();
});

// ── PLATFORM NAVIGATION ─────────────────────────────────────────────────
function openApp(appName) {
  if (appName !== 'inspect') return;

  const app = document.getElementById('app');
  app.style.display = 'flex';
  track('screen_viewed', { screen: 'report' });

  if (!appInitialised) {
    appInitialised = true;
    initMobileView();
    initSignaturePads();
    installReportLockGuard();
    buildChoiceCards();
    buildSelectCards();
    enhanceFieldsWithNotes();
    refreshJobsList();
    const restored = loadDraft();
    restoreSignaturePads(); restoreLicenceField();
    renderFindingsUI();
    restoreResState();
    renderReportWidgets();
    // Restore conditional field visibility
    if (reportData.moistureReadings === 'YES') {
      const wrap = document.getElementById('waterLeakWrap');
      if (wrap) wrap.style.display = '';
      if (reportData.waterLeaks === 'YES') {
        const llWrap = document.getElementById('leakLocationWrap');
        if (llWrap) llWrap.style.display = '';
      }
    }
    // The draft is the job as it was left, saved or not, so this doesn't say "unsaved".
    if (restored) showToast('Picked up where you left off', 'info');
    if (!reportData.standard) setStandard('AS 3660.2-2017');
    // A first job (nothing to pick up) starts with the inspector filled in too.
    if (!restored && !currentReportId) {
      const me = lastInspectorDetails();
      const insp = document.getElementById('jobInspector');
      if (insp && !insp.value) insp.value = me.name;
      if (me.licence && !reportData.inspectorLicence) { reportData.inspectorLicence = me.licence; restoreLicenceField(); }
      if (me.signature && !reportData.inspectorSignature) { reportData.inspectorSignature = me.signature; restoreSignaturePads(); }
      if (!reportData.jobInspectionDate) reportData.jobInspectionDate = todayIsoDate();
    }
    enableKeyboardActivation();
    restoreA11ySettings();
    restoreAudioCaptureSetting();
    loadJobInfo();
    if (restored) lastLocalSaveAt = Date.now();
    updateSyncStatus();
    // pull any cloud reports not on this device, then sort out photo storage
    supabaseSyncOnOpen().then(pushUnsyncedReports).finally(tidyPhotoStorage);
    processPendingNotes();
    fillWeatherOnTheDay();
    // Back and swipe back step through the app, and it reopens where it was (BACK, WHERE YOU WERE).
    installBackNavigation();
    restoreNavPlace();
  }
}

// ── ACCESSIBILITY: keyboard activation for clickable divs ──────────────────
function enableKeyboardActivation() {
  document.querySelectorAll('.field-val[onclick]').forEach(el => {
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'button');
    el.addEventListener('keydown', (e) => {
      // Only act when the keydown originates on the div itself (keyboard-focused,
      // not yet being edited). Once startEdit() inserts a child <input>/<select>,
      // its keydown events bubble up to this same listener — without this guard,
      // every Enter/Space keystroke typed inside an open field would also
      // re-trigger startEdit() via el.click(), which silently ate every space
      // character typed into any text field and visually reset the field after
      // pressing Enter even though the value had already saved correctly.
      if (e.target !== el) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        el.click();
      }
    });
  });
}

// ── BACK ──────────────────────────────────────────────────────────────────
// One step back, however it's asked for: the phone's back button or swipe
// (browser history), Esc on a keyboard, or a swipe in from the left edge in
// the home-screen app (iOS gives a home-screen app no back swipe of its
// own). Back closes what's on top (a photo, a sheet, the voice panel, a menu
// page), then climbs the job: a document (the report or the quote) goes back
// to This job, and This job to Jobs. Jobs is the top, so a back from there
// is the browser's own and leaves SAYON.

// Where the inspector is, under any sheet.
function navPlace() {
  const open = id => { const el = document.getElementById(id); return !!(el && el.classList.contains('open')); };
  if (open('sidebarPanel')) return 'menu';
  if (open('dashboardOverlay')) return 'jobs';
  if (open('jobOverlay')) return 'job';
  if (open('quoteScreen')) return 'quote';
  if (document.getElementById('app').style.display === 'flex') return 'report';
  return '';
}

function navGo(place) {
  const tab = { jobs: 'dashboard', job: 'job', quote: 'quote', report: 'report' }[place];
  if (tab) tabGo(tab);
}

// Back has somewhere to go only once the app is up (not on the splash,
// sign-in or onboarding).
function navReady() {
  return document.getElementById('app').style.display === 'flex' || document.getElementById('quoteScreen').classList.contains('open');
}

// The sheet on top: the highest, then the latest in the page.
function topOpenSheet() {
  const open = [...document.querySelectorAll('.page-sheet-overlay.open')];
  const z = el => parseInt(getComputedStyle(el).zIndex, 10) || 0;
  return open.reduce((a, b) => !a || z(b) > z(a) || (z(b) === z(a) && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)) ? b : a, null);
}

// How back closes each sheet. The treatment record, a bait visit and the
// agreement keep what's been filled in, so opening them again carries on.
const NAV_SHEET_BACK = {
  agreementOverlay: () => cancelSheet('agreementOverlay', true),
  treatmentOverlay: () => cancelSheet('treatmentOverlay', true),
  baitOverlay: () => cancelSheet('baitOverlay', true),
  sitePlanOverlay: () => { if (!sitePlanEditor.undo.length || confirm('Close the plan without saving your changes?')) closeSitePlan(); },
  sendReviewOverlay: () => { if (!(sendReview && sendReview.busy)) closeSendReview(); },
  didItSendOverlay: () => answerDidItSend(false),
  askOverlay: () => answerAsk(null),
  quoteAnswerOverlay: () => closeQuoteAnswer(),
  compassOverlay: () => closeCompass(),
  problemOverlay: () => closeProblemReport(),
  extractSummaryOverlay: () => closeExtractSummary(),
  lastVisitOverlay: () => closeLastVisitChanges(),
  photoSourceOverlay: () => closePhotoSource(),
  moveOverlay: () => closeMoveNotice(),
};

// One step back. False when there's nowhere further back (Jobs).
function navBack() {
  const isOpen = id => { const el = document.getElementById(id); return !!(el && el.classList.contains('open')); };
  const shown = id => { const el = document.getElementById(id); return !!(el && !el.hidden); };
  if (isRecording) { showToast('Tap Stop to finish recording first', 'info'); return true; }
  if (activeEditEl) { commitActive(); return true; }
  if (shown('photoMarkup')) { if (markupState.pendingLabel) closeMarkupLabel(); else closePhotoMarkup(); return true; }
  if (shown('photoViewer')) { closePhotoViewer(); return true; }
  const sheet = topOpenSheet();
  if (sheet) {
    const close = NAV_SHEET_BACK[sheet.id];
    if (close) close(); else sheet.classList.remove('open');
    return true;
  }
  if (isOpen('voicePopover')) { toggleVoicePopover(); return true; }
  if (isOpen('dashboardDetail')) { closeDashboardDetail(); return true; }
  if (isOpen('sidebarPanel')) { drawerBackTap(); return true; }
  const place = navPlace();
  if (place === 'report' || place === 'quote') { tabGo('job'); return true; }
  if (place === 'job') { tabGo('dashboard'); return true; }
  return false;
}

// Browser history: one entry of SAYON's own sits on top of the page's, so
// the phone's back lands here instead of leaving. Each back steps back and
// puts the entry back; on Jobs it isn't put back, so the next back leaves.
// Any tap puts it back too.
function navArm() {
  if (!navReady() || (history.state && history.state.sayonBack)) return;
  try { history.pushState({ sayonBack: 1 }, ''); } catch (e) { /* history unavailable */ }
}

let backNavInstalled = false;
function installBackNavigation() {
  if (backNavInstalled) return;
  backNavInstalled = true;
  try { if (!history.state) history.replaceState({ sayonBase: 1 }, ''); } catch (e) {}
  navArm();
  window.addEventListener('popstate', e => {
    if (e.state && e.state.sayonBack) return; // forward onto SAYON's own entry
    if (!navReady()) return;
    if (navBack()) navArm();
  });
  document.addEventListener('click', navArm, true);
  // Esc: after a field's own Esc (which backs out of the edit) has had its
  // turn. In a box being typed in, the first Esc only leaves the box (and
  // closes its suggestions); the next one goes back.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || !navReady()) return;
    const t = e.target;
    if (t && t.matches && t.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, select, [contenteditable="true"]')) {
      t.blur(); e.preventDefault(); return;
    }
    if (navBack()) e.preventDefault();
  });
  installEdgeSwipeBack();
  // Where the inspector was, for when the phone closes the app.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') rememberNavPlace(); });
  window.addEventListener('pagehide', rememberNavPlace);
}

// The home-screen app: a swipe in from the left edge goes back, with an
// arrow that follows the finger. Not in a browser tab, which has its own.
// Never from a drawing surface (signatures, the site plan, photo markup).
function installEdgeSwipeBack() {
  const standalone = navigator.standalone === true || !!(window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  if (!standalone) return;
  const EDGE = 20, GO = 80;
  const hint = document.createElement('div');
  hint.className = 'edge-back';
  hint.hidden = true;
  hint.setAttribute('aria-hidden', 'true');
  hint.innerHTML = '<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
  document.body.appendChild(hint);
  let s = null;
  const reset = () => { s = null; hint.hidden = true; hint.classList.remove('ready'); };
  document.addEventListener('touchstart', e => {
    const t = e.touches[0];
    s = e.touches.length === 1 && t.clientX <= EDGE && !isRecording && navReady()
      && !e.target.closest('canvas, input[type="range"], .photo-viewer, .photo-markup')
      ? { x: t.clientX, y: t.clientY, top: t.clientY, go: false } : null;
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!s) return;
    const t = e.touches[0], dx = t.clientX - s.x, dy = Math.abs(t.clientY - s.y);
    if (dy > 40 && dy > dx) { reset(); return; }
    if (dx < 12) return;
    s.go = dx >= GO;
    hint.hidden = false;
    hint.style.top = Math.round(s.top) + 'px';
    hint.style.setProperty('--pull', Math.min(1, dx / GO).toFixed(2));
    hint.classList.toggle('ready', s.go);
  }, { passive: true });
  document.addEventListener('touchend', () => { const go = s && s.go; reset(); if (go) navBack(); }, { passive: true });
  document.addEventListener('touchcancel', reset, { passive: true });
}

// ── WHERE YOU WERE ───────────────────────────────────────────────────────
// The phone closes an app it isn't showing, and reopening started on the
// report's first step. Now it opens where it was: the Jobs list, the job's
// page, the quote, or the report on the step that was showing.
const NAV_PLACE_KEY = 'korva_last_place';
function rememberNavPlace() {
  if (!navReady()) return;
  const place = navPlace();
  const step = document.getElementById('reportBody').dataset.step || '';
  try {
    localStorage.setItem(NAV_PLACE_KEY, JSON.stringify({ place: place === 'menu' ? 'jobs' : place, step, id: currentReportId || null, at: Date.now() }));
  } catch (e) { /* storage full: it opens on the report as before */ }
}

function restoreNavPlace() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(NAV_PLACE_KEY) || 'null'); } catch (e) {}
  if (!s) return;
  try {
    if (s.place === 'jobs') { tabGo('dashboard'); return; }
    // The rest belong to a job: only the one that's open again.
    if ((s.id || null) !== (currentReportId || null)) return;
    if (s.place === 'job') tabGo('job');
    else if (s.place === 'quote' && currentReportId) jobGo('quote');
    else if (s.place === 'report' && s.step && document.getElementById('tab-' + s.step)) goStep(s.step);
  } catch (e) { /* a place that can't open: the report, as before */ }
}

// ── ASK FIRST ────────────────────────────────────────────────────────────
// SAYON's own sheet for a question, in place of the browser's grey box:
// what will happen, a button that names it, and a quiet way out.
//   askFirst({ title, text, facts, yes, no, danger })
// facts: [[label, value], …] set out above the text (a plan and its price).
// yes: the button's words, which say what it does. no: the quiet one,
// "Not now" unless given. danger: the button is red (it deletes something).
// Resolves true for the named button, false for the quiet one, and null
// when the sheet is closed by back, Esc or a tap outside it.
let askResolve = null;
function askFirst({ title, text = '', facts = null, yes, no = 'Not now', danger = false }) {
  if (askResolve) answerAsk(null);
  document.getElementById('askTitle').textContent = title;
  const textEl = document.getElementById('askText');
  textEl.textContent = text;
  textEl.hidden = !text;
  const factsEl = document.getElementById('askFacts');
  factsEl.hidden = !(facts && facts.length);
  factsEl.innerHTML = (facts || []).map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('');
  const yesBtn = document.getElementById('askYes');
  yesBtn.textContent = yes;
  yesBtn.classList.toggle('danger', !!danger);
  document.getElementById('askNo').textContent = no;
  document.getElementById('askOverlay').classList.add('open');
  return new Promise(resolve => { askResolve = resolve; });
}
function answerAsk(answer) {
  document.getElementById('askOverlay').classList.remove('open');
  const resolve = askResolve;
  askResolve = null;
  if (resolve) resolve(answer);
}

// ── SHEETS OPENED FROM A PAGE ─────────────────────────────────────────────
// The agreement, the treatment record and a bait visit open from This job
// or the Jobs list over the report or the quote. Closing one without
// finishing it (its ✕, back or Esc) goes back to where it was opened from.
// Signing or saving carries on from the document, as before.
let navSheetFrom = null; // { sheet, place }
function rememberSheetFrom(sheet, place) { navSheetFrom = place ? { sheet, place } : null; }
function forgetSheetFrom(sheet) { if (navSheetFrom && navSheetFrom.sheet === sheet) navSheetFrom = null; }

function cancelSheet(sheet, keep) {
  const from = navSheetFrom && navSheetFrom.sheet === sheet ? navSheetFrom.place : null;
  // Back or Esc can be a slip, so what's filled in is kept (UNSAVED SHEETS in js/quote.js).
  if (keep && typeof unsavedSheet !== 'undefined' && unsavedSheet && unsavedSheet.changed) {
    keepUnsavedSheet();
    unsavedSheet = null;
    showToast('Not saved yet. Open it again to carry on', 'info');
  }
  ({ agreementOverlay: closeAgreementSheet, treatmentOverlay: closeTreatmentRecord, baitOverlay: closeBaitVisit })[sheet]();
  if (from && from !== navPlace()) navGo(from);
}
