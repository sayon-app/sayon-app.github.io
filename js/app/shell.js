// SAYON app: App updates, address move, splash, platform navigation, keyboard access.
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
const FORM_SHEETS = ['treatmentOverlay', 'baitOverlay', 'quoteAnswerOverlay', 'sitePlanOverlay', 'agreementOverlay', 'sendReviewOverlay'];
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

  const statusEl = document.getElementById('splashStatus');
  const messages = [
    'Initialising vocabulary…',
    'Loading the termite species reference…',
    'Preparing report template…',
  ];
  let msgIndex = 0;
  if (statusEl) {
    const cycle = setInterval(() => {
      msgIndex++;
      if (msgIndex < messages.length) {
        statusEl.style.opacity = '0';
        setTimeout(() => {
          statusEl.textContent = messages[msgIndex];
          statusEl.style.opacity = '1';
        }, 150);
      } else {
        clearInterval(cycle);
      }
    }, 700);
  }

  setTimeout(async () => {
    const splash = document.getElementById('splash');
    const hideSplash = () => new Promise(done => {
      splash.style.opacity = '0';
      setTimeout(() => { splash.style.display = 'none'; done(); }, 600);
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
    // screen is never blank on a weak signal (see START_NETWORK_WAIT_MS).
    const slow = setTimeout(() => { if (statusEl) statusEl.textContent = 'Signing in…'; }, 1000);
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
  }, 2200);
});

// ── PLATFORM NAVIGATION ─────────────────────────────────────────────────
function openApp(appName) {
  if (appName === 'quote') { openQuote('menu'); return; }
  if (appName !== 'inspect') return;

  const menu = document.getElementById('mainMenu');
  const app = document.getElementById('app');
  menu.style.display = 'none';
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
    renderSavedList();
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
      if (!reportData.jobInspectionDate) reportData.jobInspectionDate = todayIsoDate();
    }
    enableKeyboardActivation();
    restoreA11ySettings();
    restoreAudioCaptureSetting();
    restoreTalkBackSetting();
    loadJobInfo();
    if (restored) lastLocalSaveAt = Date.now();
    updateSyncStatus();
    // pull any cloud reports not on this device, then sort out photo storage
    supabaseSyncOnOpen().then(pushUnsyncedReports).finally(tidyPhotoStorage);
    processPendingNotes();
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
