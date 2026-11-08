// SAYON app: Shared state, onboarding and Your business.
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
  // A technician gets the owner's business details and prices, so starts at the voice demo
  if (canEditBusiness()) { fillBusinessForm(); obShowPanel(0); }
  else obShowPanel(2);
}

// ── YOUR BUSINESS ─────────────────────────────────────────────────────────
// The business details every report, quote and certificate prints. They're
// entered at sign-up (onboarding step 0) and changed later from the account
// menu, through that same form; there's no separate menu page.
let businessFormEditing = null; // null while onboarding, else { onSaved }
// A logo picked in the form, kept until Save: undefined while unchanged,
// null once removed, else { logo, logoWidth, logoHeight }.
let businessFormLogo;
// The licence the form opened with. Only a licence typed at sign-up is the
// inspector's own (see obNext).
let businessFormLicence = '';

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
  renderCompanyLogoPreview(d.logo);
}

// Only the owner changes the business details. A technician on the business
// gets the owner's through the account copy (js/business-sync.js).
function canEditBusiness() {
  return !authBusiness || isBusinessOwner();
}

function openBusinessForm(onSaved) {
  // Without the business loaded (no signal at launch) an edit would land
  // in the wrong place on this phone and never reach the account.
  if (!authBusiness) { showToast('Your business details load when you have signal. Try again then', 'info'); return; }
  if (!canEditBusiness()) { showToast('Your business owner sets these details', 'info'); return; }
  businessFormEditing = { onSaved };
  fillBusinessForm();
  document.getElementById('obBusinessTitle').textContent = 'Your business';
  document.getElementById('obBusinessSave').textContent = 'Save';
  document.getElementById('obBusinessCancel').hidden = false;
  const screen = document.getElementById('onboardScreen');
  screen.classList.add('ob-edit');
  screen.style.display = 'flex';
  obShowPanel(0);
}

function closeBusinessForm() {
  const screen = document.getElementById('onboardScreen');
  screen.style.display = 'none';
  screen.classList.remove('ob-edit');
  document.getElementById('obBusinessTitle').textContent = 'Set up your business';
  document.getElementById('obBusinessSave').textContent = 'Continue →';
  document.getElementById('obBusinessCancel').hidden = true;
  businessFormEditing = null;
}

function openBusinessFromProfile() {
  openBusinessForm();
}

// Saves the form. Returns false (and says why) when the business name is missing.
function saveBusinessForm() {
  const val = id => document.getElementById(id).value.trim();
  const form = { name: val('ob-companyName'), licence: val('ob-licence'), phone: val('ob-phone'), email: val('ob-email'), abn: val('ob-abn') };
  if (!form.name) {
    showToast('Add your business name', 'error');
    document.getElementById('ob-companyName').focus();
    return false;
  }
  if (!canEditBusiness()) return true;
  const d = getCompanyDetails();
  // Editing writes the form as it stands, so a field can be cleared. Sign-up
  // only fills in what was typed, so blanks never wipe details that already
  // exist for this business (from another phone).
  Object.entries(form).forEach(([k, v]) => { if (businessFormEditing || v) d[k] = v; });
  if (businessFormLogo === null) { delete d.logo; delete d.logoWidth; delete d.logoHeight; }
  else if (businessFormLogo) Object.assign(d, businessFormLogo);
  if (!storeCompanyDetails(d)) {
    // A big logo is the likely reason the phone is out of room
    showToast(businessFormLogo ? 'Could not save. Try a smaller logo' : 'Could not save. This phone is out of room', 'error');
    return false;
  }
  return true;
}

// 0 business, 1 prices, 2 voice demo, 3 ready
function obShowPanel(idx) {
  if (idx === 1) renderOnboardPrices();
  [0,1,2,3].forEach(i => {
    document.getElementById(`ob-panel-${i}`).style.display = i === idx ? 'flex' : 'none';
    const step = document.getElementById(`ob-step-${i}`);
    step.classList.remove('active','done');
    if (i < idx)  step.classList.add('done');
    if (i === idx) step.classList.add('active');
  });
}

function obNext(currentStep) {
  if (currentStep === 0) {
    if (!saveBusinessForm()) return;
    if (businessFormEditing) {
      const { onSaved } = businessFormEditing;
      closeBusinessForm();
      renderProfileMenu();
      showToast('Business details saved', 'success');
      if (onSaved) onSaved();
      return;
    }
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

function obRunDemo() {
  const btn      = document.getElementById('obDemoBtn');
  const demoText = document.getElementById('obDemoText');
  const nextBtn  = document.getElementById('obDemoNext');

  btn.disabled = true;
  btn.textContent = 'Running…';
  demoText.classList.add('active');

  const phrase = 'Detached house, single storey, brick veneer walls, Colorbond roof, concrete slab on ground, north facing, fine and dry, owner occupied.';
  let i = 0;
  demoText.textContent = '';

  // Typewriter effect
  const typeInterval = setInterval(() => {
    demoText.textContent = phrase.slice(0, i);
    i++;
    if (i > phrase.length) {
      clearInterval(typeInterval);
      // Flash each field as if populating
      setTimeout(() => {
        demoText.textContent = '✓ Filled in: structure type, height, wall construction, roof type, floor type, orientation, weather and occupancy';
        demoText.style.color = 'var(--green)';
        btn.style.display   = 'none';
        nextBtn.textContent  = 'Continue →';
        nextBtn.style.background  = 'var(--accent)';
        nextBtn.style.color       = 'white';
        nextBtn.style.border      = 'none';
      }, 600);
    }
  }, 22);
}

// sample: open the finished sample job (js/sample-job.js) instead of a new one.
function obFinish(sample) {
  try { localStorage.setItem(obKey(), '1'); } catch (e) {}
  document.getElementById('onboardScreen').style.display = 'none';
  document.getElementById('mainMenu').style.display      = 'flex';
  // Open the job details so they can start a new job immediately
  setTimeout(() => {
    openApp('inspect');
    if (sample && typeof openSampleJob === 'function') openSampleJob('signup');
    else openJobDetails();
  }, 400);
}
