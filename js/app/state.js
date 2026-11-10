// SAYON app: Shared state, set-up and the business's details.
// One of the js/app/ files, which share one global scope: they load as plain
// scripts in the order index.html lists them, so a top-level name declared in
// any of them can be used from the others once the page has loaded.

// ── STATE ─────────────────────────────────────────────────────────────────
let isRecording = false;
let recognition = null;
let currentTranscript = '';
// FIX: the Web Speech API reports a per-result confidence score (0-1) that
// was never looked at - a garbled transcript from wind/background noise
// looked no different on screen from a clean one. This flag drives a
// visible warning the moment a low-confidence result comes back, so the
// technician notices while still on site and can redo that bit immediately
// instead of only discovering it later during report review.
let lowConfidenceFlagged = false;

// ── EXPERIMENTAL: server-side audio transcription (beta, opt-in) ──────────
// Runs ALONGSIDE the Web Speech API transcript above, never instead of it —
// the on-device transcript stays authoritative and the UI never waits on or
// blocks for this. It's opt-in and defaults OFF (see the toggle in Settings)
// because it means running a SECOND, independent microphone consumer
// (MediaRecorder, via its own getUserMedia stream) at the same time as an
// already-active Web Speech API recognition session — a combination that
// has not been confirmed safe on real iOS Safari hardware. The existing
// dictation flow is the core, working, business-critical feature of this
// app; nothing about this experiment is allowed to risk it. If it ever
// looks like it's interfering (see the onerror handler in
// startAudioCapture()), it self-disables for the rest of the session rather
// than keep retrying something that might be causing problems.
let audioCaptureEnabled = false;
let mediaRecorder = null;
let audioRecordedChunks = [];
let audioCaptureStream = null;
let audioCaptureSupportCache = null; // null = not checked yet; else true/false, cached
let audioCaptureFailedThisSession = false;
let serverTranscriptSuggestion = null;
let serverTranscriptOriginalText = null;
// The audio behind a suggestion covers one tap of the mic, but the box
// holds every recording since the last Extract. This is the box's text from
// before that recording, so a suggestion replaces only the part it heard.
let recordingStartText = '';
let serverTranscriptBefore = '';

let reportData = {};
let activeEditEl = null;
let appInitialised = false; // tracks whether Sayon's one-time setup has run
// Tracks which signed-in account's data is currently live in reportData/the
// open form — see the reset block at the top of enterApp() for why this
// exists: without it, switching accounts in one browser tab (sign out, sign
// back in as someone else, no page reload) left the PREVIOUS account's
// in-progress report - and critically, its currentReportId - sitting in
// memory and on screen for the new account to unknowingly build on top of
// and save over.
let lastActiveAccountUserId = null;

// ══════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════
// ONBOARDING
// ══════════════════════════════════════════════════════════════════════════
const OB_KEY = 'korva_onboarded_v1';

// Per account, and decided from the data too: a new person on a phone that
// was used before still sets up their business, and an existing customer on
// a new phone (whose details come down with the account) doesn't repeat it.
function obKey(userId = authUser && authUser.id) { return userId ? `${OB_KEY}:${userId}` : OB_KEY; }
function shouldShowOnboarding() {
  return !localStorage.getItem(obKey()) && !getCompanyDetails().updatedAt;
}

function showOnboarding() {
  document.getElementById('authScreen').style.display   = 'none';
  document.getElementById('onboardScreen').style.display = 'flex';
  // A technician joins a business that has its details and prices, so sees
  // how a job runs and starts.
  const owner = canEditBusiness();
  document.getElementById('obSteps').style.display = owner ? '' : 'none';
  if (!owner) { obShowPanel(2); return; }
  placeBusinessFields(true);
  fillBusinessForm();
  // The name was typed on Create account, so it isn't asked for again. It
  // stays editable in Menu › Business details.
  const name = document.getElementById('ob-companyName').value.trim();
  document.getElementById('obNameField').hidden = !!name;
  document.getElementById('obBusinessTitle').textContent = name ? 'Your licence and contact details' : 'Set up your business';
  document.getElementById('obBusinessSub').innerHTML = name
    ? `These print on every report, quote and certificate <strong>${escapeHtml(name)}</strong> sends. Any of them can wait: add them later from Menu&nbsp;›&nbsp;Business details.`
    : 'This appears on every report, quote and certificate you send to clients. Only the name is needed now; add the rest later from Menu&nbsp;›&nbsp;Business details.';
  obShowPanel(0);
}

// ── YOUR BUSINESS ─────────────────────────────────────────────────────────
// The business details every report, quote and certificate prints. There is
// one set of boxes (#businessFields): they live on Menu › Business details,
// and sit on the set-up card while a new business is set up.
// A logo picked in the form, kept until Save: undefined while unchanged,
// null once removed, else { logo, logoWidth, logoHeight }.
let businessFormLogo;
// The licence the form opened with. Only a licence typed at sign-up is the
// inspector's own (see obNext).
let businessFormLicence = '';
// Something on the page has been changed and not saved.
let businessFormDirty = false;
// Where the page was opened from when it wasn't the menu (a check before
// sending that found a detail missing): { place, then }. Save and Back both
// go back there, and then() opens the check again.
let businessPageFrom = null;

function placeBusinessFields(inSetup) {
  const fields = document.getElementById('businessFields');
  const slot = document.getElementById(inSetup ? 'obBusinessSlot' : 'businessPageSlot');
  if (fields.parentElement !== slot) slot.appendChild(fields);
  if (!inSetup) document.getElementById('obNameField').hidden = false;
}

function businessFormTouched() { businessFormDirty = true; }

function fillBusinessForm() {
  const d = getCompanyDetails();
  const meta = authUser?.user_metadata || {};
  const set = (id, v) => { document.getElementById(id).value = v || ''; };
  set('ob-companyName', d.name || meta.business_name || authBusiness?.name);
  set('ob-licence', d.licence);
  set('ob-phone', d.phone);
  // A new business starts with the login email. Once details are saved the
  // form shows what was saved, even a deliberate blank.
  set('ob-email', d.updatedAt ? d.email : (d.email || authUser?.email));
  set('ob-abn', d.abn);
  businessFormLogo = undefined;
  businessFormLicence = d.licence || '';
  businessFormDirty = false;
  renderCompanyLogoPreview(d.logo);
}

// Only the owner changes the business details. A technician on the business
// gets the owner's through the account copy (js/business-sync.js).
function canEditBusiness() {
  return !authBusiness || isBusinessOwner();
}

// Opens Menu › Business details. From a check that found a detail missing,
// then() opens the check again once the page is left, saved or not;
// before() closes the check's sheet so the page can show.
function openBusinessForm(then, before) {
  // Without the business loaded (no signal at launch) an edit would land
  // in the wrong place on this phone and never reach the account.
  if (!authBusiness) { showToast('Your business details load when you have signal. Try again then', 'info'); return; }
  if (!canEditBusiness()) { showToast('Your business owner sets these details', 'info'); return; }
  if (before) before();
  const place = navPlace();
  // The menu lives on the report screen, so a quote closes first (as it
  // does for Your prices) and opens again on the way back.
  if (place === 'quote') closeQuote();
  placeBusinessFields(false);
  fillBusinessForm();
  openMenuPage('businessPanel');
  businessPageFrom = then && place && place !== 'menu' ? { place, then } : null;
}

function saveBusinessPage() {
  if (!saveBusinessForm(true)) return;
  businessFormDirty = false;
  renderProfileMenu();
  showToast('Business details saved', 'success');
  leaveBusinessPage();
}

// Back from the page: to the menu's list, or to where it was opened from.
// Changes that haven't been saved are asked about first.
async function leaveBusinessPage() {
  if (businessFormDirty) {
    const save = await askFirst({ title: 'Save your changes?', text: 'You\'ve changed your business details and not saved them.', yes: 'Save', no: 'Don\'t save' });
    if (save === null) return;
    if (save) { saveBusinessPage(); return; }
    businessFormDirty = false;
  }
  const from = businessPageFrom;
  businessPageFrom = null;
  if (!from) { showMenuPage(null); return; }
  navGo(from.place);
  from.then();
}

// The page was left some other way (a dock tab, another menu page).
function businessPageLeft() {
  businessPageFrom = null;
  if (!businessFormDirty) return;
  businessFormDirty = false;
  showToast('Your changes to Business details weren\'t saved', 'info');
}

// Saves the form. Returns false (and says why) when the business name is
// missing. editing: the menu page writes the form as it stands, so a box
// can be cleared. Sign-up only fills in what was typed, so blanks never
// wipe details that already exist for this business (from another phone).
function saveBusinessForm(editing) {
  const val = id => document.getElementById(id).value.trim();
  const form = { name: val('ob-companyName'), licence: val('ob-licence'), phone: val('ob-phone'), email: val('ob-email'), abn: val('ob-abn') };
  if (!form.name) {
    showToast('Add your business name', 'error');
    document.getElementById('obNameField').hidden = false;
    document.getElementById('ob-companyName').focus();
    return false;
  }
  if (!canEditBusiness()) return true;
  const d = getCompanyDetails();
  Object.entries(form).forEach(([k, v]) => { if (editing || v) d[k] = v; });
  if (businessFormLogo === null) { delete d.logo; delete d.logoWidth; delete d.logoHeight; }
  else if (businessFormLogo) Object.assign(d, businessFormLogo);
  if (!storeCompanyDetails(d)) {
    // A big logo is the likely reason the phone is out of room
    showToast(businessFormLogo ? 'Could not save. Try a smaller logo' : 'Could not save. This phone is out of room', 'error');
    return false;
  }
  return true;
}

// 0 business, 1 prices, 2 ready
function obShowPanel(idx) {
  if (idx === 1) renderOnboardPrices();
  [0,1,2].forEach(i => {
    document.getElementById(`ob-panel-${i}`).style.display = i === idx ? 'flex' : 'none';
    const step = document.getElementById(`ob-step-${i}`);
    step.classList.remove('active','done');
    if (i < idx)  step.classList.add('done');
    if (i === idx) step.classList.add('active');
  });
}

function obNext(currentStep) {
  if (currentStep === 0) {
    if (!saveBusinessForm(false)) return;
    businessFormDirty = false;
    // A licence typed at sign-up is usually the inspector's own, so the first
    // report starts with it. One that came from the account copy may not be.
    const licence = document.getElementById('ob-licence').value.trim();
    if (licence && licence !== businessFormLicence) {
      const licEl = document.getElementById('inspectorLicence');
      if (licEl) { licEl.value = licence; reportData.inspectorLicence = licence; }
    }
  }
  if (currentStep === 1 && !saveOnboardPrices()) return;
  obShowPanel(currentStep + 1);
}

// sample: open the finished sample job (js/sample-job.js) instead of a new one.
function obFinish(sample) {
  try { localStorage.setItem(obKey(), '1'); } catch (e) {}
  document.getElementById('onboardScreen').style.display = 'none';
  placeBusinessFields(false);
  // Straight to the job: its details, so a new job can start now.
  openApp('inspect');
  if (sample && typeof openSampleJob === 'function') openSampleJob('signup');
  else openJobDetails();
}
