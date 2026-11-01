// jsPDF loads from a CDN (see the <script src> tag above, in <head>). If that
// request fails — poor connectivity, a corporate/site firewall, an ad blocker,
// or the CDN being briefly down — `window.jspdf` never gets defined. The old
// code here did `const { jsPDF } = window.jspdf;`, which THROWS the instant
// window.jspdf is undefined. Because this is a single top-level <script>
// block, that throw aborted the rest of this script right here — every
// function and constant declared below (including SECTIONS) never ran, so
// the ENTIRE app silently broke: no section would open, nothing would
// respond, with no error shown to the technician. Given this app is meant to
// be used in the field (subfloors, rural properties, patchy signal), a
// flaky connection at page-load should never be able to take down report
// entry — only PDF export actually needs jsPDF, so we defer the failure to
// there instead of crashing everything up front.
let jsPDF = (window.jspdf && window.jspdf.jsPDF) || null;

// If jsPDF didn't load the first time, retry loading it on demand (e.g. when
// the technician's connection comes back and they try to generate a PDF)
// instead of forcing a full page reload.
function ensureJsPDFLoaded() {
  if (jsPDF) return Promise.resolve(jsPDF);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-jspdf-retry]');
    if (existing) existing.remove();
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.setAttribute('data-jspdf-retry', '1');
    s.onload = () => {
      jsPDF = (window.jspdf && window.jspdf.jsPDF) || null;
      if (jsPDF) resolve(jsPDF); else reject(new Error('jsPDF script loaded but did not define window.jspdf.jsPDF'));
    };
    s.onerror = () => reject(new Error('Could not load the PDF library — check your internet connection and try again.'));
    document.head.appendChild(s);
  });
}

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
function obKey() { return authUser && authUser.id ? `${OB_KEY}:${authUser.id}` : OB_KEY; }
function shouldShowOnboarding() {
  return !localStorage.getItem(obKey()) && !getCompanyDetails().updatedAt;
}

function showOnboarding() {
  document.getElementById('authScreen').style.display   = 'none';
  document.getElementById('onboardScreen').style.display = 'flex';
  // A technician gets the owner's business details, so starts at the voice demo
  if (canEditBusiness()) { fillBusinessForm(); obShowPanel(0); }
  else obShowPanel(1);
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

function obShowPanel(idx) {
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
  obShowPanel(currentStep + 1);
}

function obRunDemo() {
  const btn      = document.getElementById('obDemoBtn');
  const demoText = document.getElementById('obDemoText');
  const nextBtn  = document.getElementById('obDemoNext');

  btn.disabled = true;
  btn.textContent = 'Running…';
  demoText.classList.add('active');

  const phrase = 'Detached house, single storey, brick veneer walls, colorbond roof, concrete slab on ground, north facing, fine and dry, owner occupied.';
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
        demoText.textContent = '✓ Fields extracted — Structure Type, Height, Wall Construction, Roof Type, Floor Type, Orientation, Weather, Occupancy';
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

function obFinish() {
  try { localStorage.setItem(obKey(), '1'); } catch (e) {}
  document.getElementById('onboardScreen').style.display = 'none';
  document.getElementById('mainMenu').style.display      = 'flex';
  // Open the job details so they can start a new job immediately
  setTimeout(() => {
    openApp('inspect');
    openJobDetails();
  }, 400);
}

// ── ACCESS SECTION — NO LIMITATIONS TOGGLE ────────────────────────────────
// (toggleNoAccessIssues / syncAccessClearBtn removed — dead code, no
// #accessClearBtn/#accessClearLabel elements exist and nothing called them)

// ══════════════════════════════════════════════════════════════════════════
// OBSTRUCTION ZONE SELECTOR
// ══════════════════════════════════════════════════════════════════════════

// Reasons are kinds of obstruction, not descriptions of one: "Stored items",
// not "Storage to garage walls". Where exactly, and what it was, goes on
// the area's row in Section 5 (ACCESS SPOTS).
const OBS_ZONES = {
  interior: {
    label: 'The Interior',
    items: ['Stored items', 'Furniture or fittings', 'Floor or wall coverings', 'Restricted access'],
  },
  exterior: {
    label: 'The Exterior',
    items: ['Stored items', 'Vegetation', 'Services or equipment', 'Restricted access'],
  },
  subfloor: {
    label: 'Subfloor',
    items: ['Stored items', 'Low clearance', 'Services or equipment', 'Insulation', 'Restricted access'],
  },
  roofvoid: {
    label: 'Roof Void',
    items: ['Stored items', 'Low clearance', 'Insulation or sarking', 'Services or equipment', 'Restricted access', 'No roof void'],
  },
  outbuildings: {
    label: 'Outbuildings',
    items: ['Stored items', 'Restricted access'],
  },
  site: {
    label: 'The Site',
    items: ['Stored items', 'Vegetation', 'Restricted access'],
  },
  fences: {
    label: 'Fences',
    items: ['Stored items', 'Vegetation', 'Restricted access'],
  },
  retainingwalls: {
    label: 'Retaining Walls',
    items: ['Stored items', 'Vegetation', 'Soil or abutting structures', 'Restricted access'],
  },
  landscapingtimbers: {
    label: 'Landscaping Timbers',
    items: ['Stored items', 'Vegetation', 'Soil or abutting structures', 'Restricted access'],
  },
};

// The specific labels reports were saved with before, and what each became.
// Where an area can't take the first choice, the next one is tried.
const LEGACY_REASONS = {
  'Furniture': ['Furniture or fittings'], 'Fixtures': ['Furniture or fittings'],
  'Flooring': ['Floor or wall coverings'],
  'Limited access to skirting boards': ['Furniture or fittings'],
  'Items/belongings stored against wall': ['Stored items'], 'Items/belongings stored to cupboards': ['Stored items'],
  'Limited access to skirting boards due to stored items in garage': ['Stored items'],
  'Stored Articles': ['Stored items'], 'Stored articles': ['Stored items'], 'Storage to garage walls': ['Stored items'],
  'Item blocking access to manhole': ['Stored items'],
  'Locked room': ['Restricted access'], 'Locked room and storage to garage': ['Restricted access'], 'Locked, no access': ['Restricted access'],
  'Locked or no key': ['Restricted access'], 'No access point': ['Restricted access'], 'Unsafe height': ['Restricted access'],
  'Air Conditioner Ducting': ['Services or equipment'], 'Air conditioning ducting': ['Services or equipment'], 'Ducting': ['Services or equipment'],
  'Plumbing': ['Services or equipment'], 'Water Tanks': ['Services or equipment'], 'Hot water system': ['Services or equipment'],
  'Air conditioning unit': ['Services or equipment'],
  'Dog or animal in the yard': ['Restricted access'], 'Dog or animal': ['Restricted access'],
  'Low Clearance': ['Low clearance'], 'Low clearance in roof void': ['Low clearance'], 'Low clearance to the outside edges of roof void': ['Low clearance'],
  'Insulation': ['Insulation', 'Insulation or sarking'], 'Sarking': ['Insulation or sarking'],
  'No access to subfloor': ['Restricted access'], 'Manhole sealed or screwed shut': ['Restricted access'],
  'Height Restrictions': ['Restricted access'], 'Skillion Roof Design (no void)': ['No roof void'],
  'Back Fill': ['Soil or abutting structures'], 'Abutting Timbers': ['Soil or abutting structures'],
};

function modernReasons(zoneId, list) {
  const items = (OBS_ZONES[zoneId] || {}).items || [];
  const out = [];
  list.forEach(r => {
    const next = items.includes(r) ? r : (LEGACY_REASONS[r] || []).find(c => items.includes(c));
    if (next && !out.includes(next)) out.push(next);
  });
  return out;
}

// Each area gets a status, which AS 4349.3 reports must state:
// INSPECTED (fully), PARTIAL (partly, reasons below), NOT (not inspected,
// reasons below) or NA (not present at this property, e.g. no subfloor on a
// slab). All of it lives in reportData so it saves, loads and resets with
// the report:
//   reportData.areaStatus  { zoneId: 'INSPECTED'|'PARTIAL'|'NOT'|'NA' }
//   reportData.areaReasons { zoneId: [obstruction items] }
// reportData.obstructions / restrictedAccess are kept as the derived
// plain-text summary (areas not fully inspected, and why) for the AI and
// older code paths.
// The report sorts each reason into one of two kinds of access limit, the
// terms AS 3660.2 / AS 4349.3 reports use:
//   hindered access: temporary obstructions at the time of the inspection
//     (furniture, stored goods, insulation, vegetation, low clearance);
//   restricted access: a permanent restriction or locked entry (a locked
//     room, no subfloor hatch, no roof void, beyond safe height, a safety
//     risk such as a dog in the yard).
// Labels in RESTRICTED_REASONS are restricted; every other label hinders.
const RESTRICTED_REASONS = new Set(['Restricted access', 'No roof void']);
// Every status an area can hold. PARTIAL is still stored (older reports
// and the AI use it), but the inspector never picks it: an area is
// Inspected, Not inspected or Not applicable, and an inspected area with a
// hindered or restricted reason ticked is held as PARTIAL, "inspected with
// limits".
const AREA_STATUSES = [
  ['INSPECTED', 'Inspected'],
  ['PARTIAL',   'Inspected with limits'],
  ['NOT',       'Not inspected'],
  ['NA',        'Not applicable'],
];
const AREA_STATUS_BUTTONS = [['INSPECTED', 'Inspected'], ['NOT', 'Not inspected'], ['NA', 'Not applicable']];

// Other ways inspectors name an area, for matching dictated text.
const AREA_ALIASES = {
  roofvoid: ['roof space', 'manhole', 'ceiling space', 'ceiling cavity'],
  subfloor: ['sub floor', 'underfloor', 'under the house'],
  outbuildings: ['shed', 'carport'],
  site: ['yard', 'grounds', 'garden'],
  fences: ['fence'],
  retainingwalls: ['retaining wall'],
  landscapingtimbers: ['sleepers', 'landscaping timber'],
};

function areaStatusOf(zoneId) { return (reportData.areaStatus || {})[zoneId] || null; }

// What was found in each area entered, as AS 4349.3 reports state it per
// area: reportData.areaResult { zoneId: 'CLEAR' | 'FOUND' }. FOUND means
// timber pest evidence (termites, borers, decay or delignification) was
// recorded there; the detail is in Timber Pest Findings.
const AREA_RESULTS = [['CLEAR', 'Nothing found'], ['FOUND', 'Evidence found']];
const AREA_RESULT_TEXT = { CLEAR: 'No visible evidence of timber pests found', FOUND: 'Timber pest evidence found, see Timber Pest Findings' };
function areaWasEntered(zoneId) { return ['INSPECTED', 'PARTIAL'].includes(areaStatusOf(zoneId)); }
// No timber pest evidence anywhere: the inspector said the property was
// clear of termites, and no borers, decay or delignification were recorded.
function wholePropertyClear() {
  const fs = (reportData.findings || []).filter(f => f && (f.termiteActivity || f.activityLocation || f.damageDescription));
  return fs.length > 0 && fs.every(f => f.termiteActivity === 'NONE')
    && !['ACTIVE', 'INACTIVE'].includes(reportData.borerActivity)
    && reportData.decayFound !== 'YES' && reportData.delignification !== 'YES';
}
// The recorded result, or CLEAR for every area entered when the whole
// property was clear. Null when it wasn't recorded.
function areaResultOf(zoneId) {
  if (!areaWasEntered(zoneId)) return null;
  return (reportData.areaResult || {})[zoneId] || (wholePropertyClear() ? 'CLEAR' : null);
}
// Which recorded evidence is in an area, read from the words of each
// finding's location and description and the borer, decay and
// delignification details. Areas named outright (fence, subfloor, roof
// void...) are matched first; interior and exterior words only count when
// no other area is named, so "bearers under the kitchen" is the subfloor.
const AREA_EVIDENCE_WORDS = {
  fences: ['fence'],
  retainingwalls: ['retaining wall'],
  landscapingtimbers: ['sleeper', 'landscaping timber', 'garden edging', 'edging timber'],
  outbuildings: ['shed', 'carport', 'garage', 'outbuilding', 'pergola', 'gazebo'],
  roofvoid: ['roof void', 'roof space', 'roof timber', 'ceiling space', 'ceiling cavity', 'manhole', 'rafter', 'batten', 'ceiling joist', 'purlin'],
  subfloor: ['subfloor', 'sub floor', 'sub-floor', 'underfloor', 'under the house', 'under the floor', 'bearer', 'joist', 'pier', 'stump'],
  site: ['site', 'yard', 'backyard', 'garden', 'tree', 'grounds', 'log', 'woodpile', 'wood pile'],
  exterior: ['exterior', 'outside', 'external', 'perimeter', 'fascia', 'eave', 'weatherboard', 'cladding', 'window frame', 'veranda', 'verandah', 'deck', 'porch', 'barge'],
  interior: ['interior', 'inside', 'room', 'bedroom', 'living', 'dining', 'study', 'kitchen', 'bathroom', 'laundry', 'lounge', 'hallway', 'hall', 'skirting', 'architrave', 'door frame', 'doorframe', 'cupboard', 'wardrobe', 'toilet', 'ensuite', 'stair', 'floorboard', 'floor board'],
};
const AREA_EVIDENCE_GENERAL = new Set(['exterior', 'interior']);
function textAreas(text) {
  const t = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
  const has = w => new RegExp(' ' + w.replace(/[^a-z0-9]+/g, ' ').trim() + '(s|es)? ').test(t);
  // A stump out in the yard is a tree stump, not one under the house.
  const yardStump = (AREA_EVIDENCE_WORDS.site).some(has);
  const hit = z => (AREA_EVIDENCE_WORDS[z] || []).some(w => has(w) && !(z === 'subfloor' && w === 'stump' && yardStump));
  const specific = Object.keys(AREA_EVIDENCE_WORDS).filter(z => !AREA_EVIDENCE_GENERAL.has(z) && hit(z));
  if (specific.length) return specific;
  return [...AREA_EVIDENCE_GENERAL].filter(hit);
}
// The evidence recorded in an area, as short references for the report:
// "Finding 2 (rear left fence post)", "Borers (front bedroom floorboards)".
function areaEvidence(zoneId) {
  const out = [];
  const short = t => { const s = String(t || '').trim().replace(/[.;]+$/, ''); return s.length > 60 ? s.slice(0, 57).replace(/\s+\S*$/, '') + '...' : s; };
  (reportData.findings || []).forEach((f, i) => {
    if (!f || f.termiteActivity === 'NONE') return;
    if (textAreas([f.activityLocation, f.damageDescription].join(' ')).includes(zoneId)) out.push(`Finding ${i + 1}${f.activityLocation ? ` (${short(f.activityLocation)})` : ''}`);
  });
  shownBorerFindings().forEach((b, i) => {
    if (textAreas([b.location, b.timberAffected, b.description].join(' ')).includes(zoneId)) out.push(`Borer finding ${i + 1}${b.location ? ` (${short(b.location)})` : ''}`);
  });
  const other = [
    ['Wood decay', reportData.decayFound === 'YES', whatWhere(reportData.decayDetails, reportData.decayWhere)],
    ['Chemical delignification', reportData.delignification === 'YES', whatWhere(reportData.delignificationDetails, reportData.delignificationWhere)],
  ];
  other.forEach(([label, found, details]) => {
    if (found && textAreas(details).includes(zoneId)) out.push(`${label} (${short(details)})`);
  });
  return out;
}
// Areas marked "evidence found" with nothing recorded that names them.
function areasEvidenceUnlinked() { return Object.keys(OBS_ZONES).filter(z => areaResultOf(z) === 'FOUND' && !areaEvidence(z).length); }
// Adds a termite finding for an area, reusing the empty first card.
function addFindingForArea(zoneId) {
  const where = OBS_ZONES[zoneId].label.replace(/^The /, '');
  const findings = getFindings();
  let f = findings.find(x => !x.termiteActivity && isBlankValue(x.activityLocation) && isBlankValue(x.damageDescription));
  if (!f) {
    const before = getFindings().length;
    addFinding();
    if (getFindings().length === before) { showToast(`Only ${MAX_FINDINGS} findings fit in a report. Name ${where} in an existing finding's location`, 'info'); return; }
    f = getFindings()[before];
  }
  f.activityLocation = where + ': ';
  renderFindingsUI(); saveDraft();
  showSection('findings');
  showToast(`Finding ${getFindings().indexOf(f) + 1} started for ${where}. Fill in where and what you saw`, 'info');
}

function areasMissingResult() { return Object.keys(OBS_ZONES).filter(z => areaWasEntered(z) && !areaResultOf(z)); }
function setAreaResult(zoneId, result) {
  if (!reportData.areaResult) reportData.areaResult = {};
  if (reportData.areaResult[zoneId] === result) delete reportData.areaResult[zoneId];
  else reportData.areaResult[zoneId] = result;
  syncObstructionData();
}

// Areas marked "evidence found" that nothing in Findings describes yet,
// shown at the top of Findings as the next thing to write up.
function renderAreaFindingPrompts() {
  const el = document.getElementById('findingsFromAreas');
  if (!el) return;
  const zones = areasEvidenceUnlinked();
  el.innerHTML = zones.map(z => {
    const where = OBS_ZONES[z].label.replace(/^The /, '');
    return `<div class="area-finding-prompt"><span>Evidence found in <strong>${where}</strong>. Describe it here.</span>
      <button class="link-btn" onclick="addFindingForArea('${z}')">Add finding</button></div>`;
  }).join('');
  el.hidden = !zones.length;
}
// An area a finding (or the borer, decay or delignification details) names
// is marked "evidence found", not "nothing found": the report would
// otherwise say "no visible evidence" over a finding in that area.
function markRemainingAreasClear() {
  if (!reportData.areaResult) reportData.areaResult = {};
  const found = [];
  areasMissingResult().forEach(z => {
    const ev = areaEvidence(z).length > 0;
    reportData.areaResult[z] = ev ? 'FOUND' : 'CLEAR';
    if (ev) found.push(OBS_ZONES[z].label.replace(/^The /, ''));
  });
  syncObstructionData();
  if (found.length) showToast(`${found.join(', ')} marked "evidence found", from your findings`, 'info');
}

// Areas that weren't fully inspected, i.e. the ones with obstructions.
function areasNotFullyInspected() {
  return Object.keys(OBS_ZONES).filter(z => ['PARTIAL', 'NOT'].includes(areaStatusOf(z)));
}

function setAreaStatus(zoneId, status) {
  // Inspected is already lit for an area inspected with limits; tapping it
  // again keeps the limits.
  if (status === 'INSPECTED' && areaStatusOf(zoneId) === 'PARTIAL') return;
  if (!reportData.areaStatus) reportData.areaStatus = {};
  reportData.areaStatus[zoneId] = status;
  if (!['PARTIAL', 'NOT'].includes(status) && reportData.areaReasons) delete reportData.areaReasons[zoneId];
  syncObstructionData();
}

function markRemainingAreasInspected(status = 'INSPECTED') {
  if (!reportData.areaStatus) reportData.areaStatus = {};
  Object.keys(OBS_ZONES).forEach(z => { if (!reportData.areaStatus[z]) reportData.areaStatus[z] = status; });
  syncObstructionData();
}

function toggleObsItem(zoneId, item) {
  if (!reportData.areaReasons) reportData.areaReasons = {};
  const list = reportData.areaReasons[zoneId] || (reportData.areaReasons[zoneId] = []);
  const idx = list.indexOf(item);
  if (idx >= 0) list.splice(idx, 1); else list.push(item);
  // On an inspected area, a ticked reason means inspected with limits, and
  // unticking the last one makes it plainly inspected again.
  if (!reportData.areaStatus) reportData.areaStatus = {};
  if (areaStatusOf(zoneId) === 'INSPECTED' && list.length) reportData.areaStatus[zoneId] = 'PARTIAL';
  else if (areaStatusOf(zoneId) === 'PARTIAL' && !list.length) reportData.areaStatus[zoneId] = 'INSPECTED';
  syncObstructionData();
}

function renderAreaChecklist() {
  const wrap = document.getElementById('areaChecklist');
  if (!wrap) return;
  migrateLegacyObstructions();
  const markAll = document.getElementById('markAllAreasBtn');
  if (markAll) markAll.hidden = Object.keys(OBS_ZONES).every(z => areaStatusOf(z));
  const marked = Object.keys(OBS_ZONES).filter(z => areaStatusOf(z)).length;
  const prog = document.getElementById('areasProgress');
  if (prog) prog.textContent = `${marked} of ${Object.keys(OBS_ZONES).length} areas marked`;
  wrap.innerHTML = Object.entries(OBS_ZONES).map(([zoneId, zone], i) => {
    const status = areaStatusOf(zoneId);
    const lit = status === 'PARTIAL' ? 'INSPECTED' : status;
    const statusBtns = AREA_STATUS_BUTTONS.map(([val, label]) =>
      `<button class="obs-zone-btn area-status-btn${lit === val ? ' active status-' + status.toLowerCase() : ''}"
        onclick="setAreaStatus('${zoneId}','${val}')">${label}</button>`).join('');
    // The hindered and restricted reasons show as soon as the area is
    // marked, so a limit is one tap away.
    let reasons = '';
    if (['INSPECTED', 'PARTIAL', 'NOT'].includes(status)) {
      const selected = (reportData.areaReasons || {})[zoneId] || [];
      const btn = item => {
        const safe = item.replace(/'/g, '&#39;');
        return `<button class="obs-item-btn${selected.includes(item) ? ' selected' : ''}"
          onclick="toggleObsItem('${zoneId}','${safe}')">${item}</button>`;
      };
      const group = (kind, title, items) => items.length
        ? `<div class="obs-reasons obs-reasons-${kind}"><div class="obs-items-label">${ACCESS_GROUP_ICONS[kind]}<span>${title}</span></div><div class="obs-items">${items.map(btn).join('')}</div></div>` : '';
      reasons = group('hindered', 'Obstructions: in the way today', zone.items.filter(i => !RESTRICTED_REASONS.has(i)))
        + group('restricted', 'Restricted: permanent or locked', zone.items.filter(i => RESTRICTED_REASONS.has(i)));
      if (selected.length) reasons += `<div class="area-where">Add where exactly, and photos, under <button type="button" class="link-btn" onclick="showSection('restrictions')">Areas unable to be inspected</button> below</div>`;
    }
    let result = '';
    if (areaWasEntered(zoneId)) {
      const picked = areaResultOf(zoneId);
      result = '<div class="area-result-label">Found here</div><div class="area-result">' + AREA_RESULTS.map(([val, label]) =>
        `<button class="obs-item-btn area-result-btn${picked === val ? ' selected result-' + val.toLowerCase() : ''}"
          onclick="setAreaResult('${zoneId}','${val}')">${label}</button>`).join('') + '</div>';
      if (picked === 'FOUND') {
        const ev = areaEvidence(zoneId);
        // Evidence not yet written up is picked up in Findings, not flagged
        // here, so the area doesn't read as a mistake.
        if (ev.length) result += `<div class="area-evidence">See ${escapeHtml(ev.join('; '))}</div>`;
      }
    }
    // Each area sits on a side line with a dot showing its status, so with
    // several open it's clear where one ends and the next begins.
    const dot = { INSPECTED: AREA_DOT_TICK, PARTIAL: AREA_DOT_TICK, NOT: AREA_DOT_CROSS, NA: AREA_DOT_DASH }[status] || String(i + 1);
    return `<div class="area-node${status ? ' area-node-' + status.toLowerCase() : ''}${areaOpen.has(zoneId) ? ' open' : ''}" data-zone-node="${zoneId}">
      <span class="area-node-dot" aria-hidden="true">${dot}</span>
      <details class="obs-zone-panel" data-zone="${zoneId}"${areaOpen.has(zoneId) ? ' open' : ''} ontoggle="onAreaToggle('${zoneId}', this.open)">
      <summary class="obs-zone-panel-header area-summary">${areaSummary(zoneId, zone.label.replace(/^The /, ''))}</summary>
      <div class="area-status">${statusBtns}</div>${result}${reasons}</details></div>`;
  }).join('');
}
const AREA_DOT_TICK = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const AREA_DOT_DASH = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"><path d="M5 12h14"/></svg>';
const AREA_DOT_CROSS = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

// Each area is a row that opens when tapped, showing what's recorded so the
// list reads at a glance. Which rows are open survives the re-render that
// every tap does.
const areaOpen = new Set();
function onAreaToggle(zoneId, open) {
  if (open) areaOpen.add(zoneId); else areaOpen.delete(zoneId);
  const node = document.querySelector(`[data-zone-node="${zoneId}"]`);
  if (node) node.classList.toggle('open', open);
}

function areaSummary(zoneId, name) {
  const status = areaStatusOf(zoneId);
  if (!status) return `<span class="area-sum-text"><span class="area-sum-name">${name}</span></span><span class="area-sum-state">Tap to mark</span>`;
  const label = (AREA_STATUSES.find(([v]) => v === status) || [])[1] || status;
  const why = (reportData.areaReasons || {})[zoneId] || [];
  const found = areaWasEntered(zoneId) && areaResultOf(zoneId) === 'FOUND';
  const extra = why.length ? why[0] + (why.length > 1 ? ` +${why.length - 1}` : '') : (found ? 'Evidence found' : '');
  return `<span class="area-sum-text"><span class="area-sum-name">${name}</span>`
    + (extra ? `<span class="area-sum-why">${escapeHtml(extra)}</span>` : '')
    + `</span><span class="area-sum-state area-sum-${status.toLowerCase()}">${label}</span>`;
}

function syncObstructionData() {
  const notFull = areasNotFullyInspected();
  const reasons = reportData.areaReasons || {};
  reportData.obstructions = notFull.map(z => OBS_ZONES[z].label + (areaStatusOf(z) === 'PARTIAL' ? ' (inspected with limits)' : '')).join(', ');
  reportData.restrictedAccess = notFull.map(z => {
    const items = reasons[z] || [];
    return items.length ? `${OBS_ZONES[z].label}: ${items.join(', ')}` : OBS_ZONES[z].label;
  }).join('. ');
  renderAreaChecklist();
  renderAreaFindingPrompts();
  renderAccessSummary();
  updateProgress(); flushDraftSave();
}

// Reports saved before area statuses existed only have the zone labels in
// reportData.obstructions ("NIL — ..." meant nothing was obstructed).
// Those zones become "Not inspected" with the same reasons; the rest are
// left for the inspector to mark.
function migrateLegacyObstructions() {
  // Older reports hold the old, specific reason labels.
  Object.entries(reportData.areaReasons || {}).forEach(([z, list]) => {
    if (Array.isArray(list) && list.some(r => !(OBS_ZONES[z] || { items: [] }).items.includes(r))) reportData.areaReasons[z] = modernReasons(z, list);
  });
  if (reportData.areaStatus || !reportData.obstructions) return;
  reportData.areaStatus = {};
  reportData.areaReasons = {};
  if (reportData.obstructions.startsWith('NIL')) {
    Object.keys(OBS_ZONES).forEach(z => { reportData.areaStatus[z] = 'INSPECTED'; });
    return;
  }
  const storedZones  = reportData.obstructions.split(', ');
  const storedNature = (reportData.restrictedAccess || '').split('. ');
  Object.entries(OBS_ZONES).forEach(([zoneId, zone]) => {
    if (!storedZones.includes(zone.label)) return;
    reportData.areaStatus[zoneId] = 'NOT';
    const detail = storedNature.find(n => n.startsWith(zone.label + ':'));
    if (detail) reportData.areaReasons[zoneId] = detail.replace(zone.label + ': ', '').split(', ');
    if (reportData.areaReasons[zoneId]) reportData.areaReasons[zoneId] = modernReasons(zoneId, reportData.areaReasons[zoneId]);
  });
}

// Other words inspectors use for a reason label, so dictation ticks the
// right button without the exact label. Matched as whole words inside a
// phrase about that area.
const OBS_REASON_SYNONYMS = {
  'Stored items': ['stored items', 'stored goods', 'stored belongings', 'stored articles', 'storage', 'boxes', 'personal items', 'belongings', 'items stored', 'stored in cupboards', 'stored in the cupboards', 'cupboards full', 'manhole blocked', 'blocking the manhole', 'blocking access to manhole', 'blocked manhole'],
  'Furniture or fittings': ['furniture', 'furnishings', 'wardrobe', 'bed', 'couch', 'lounge suite', 'fixtures', 'fittings', 'cabinetry', 'built-ins'],
  'Floor or wall coverings': ['flooring', 'floor coverings', 'carpet', 'carpets', 'floating floor', 'tiles', 'wall linings', 'wall coverings'],
  'Insulation': ['insulation', 'batts'],
  'Insulation or sarking': ['insulation', 'batts', 'sarking', 'foil'],
  'Vegetation': ['vegetation', 'shrubs', 'shrubbery', 'overgrown', 'plants', 'garden growth'],
  'Low clearance': ['low clearance', 'clearance too low', 'not enough clearance', 'tight clearance', 'low pitch'],
  'Services or equipment': ['ducting', 'ducts', 'air con', 'aircon', 'air conditioner', 'air conditioning', 'condenser', 'split system', 'hot water', 'hws', 'water tank', 'rainwater tank', 'tank', 'plumbing', 'pipes', 'pipework'],
  'Restricted access': ['locked', 'no key', 'locked room', 'locked bedroom', 'locked door', 'couldn\'t get in', 'could not get in', 'screwed shut', 'nailed shut', 'painted shut', 'sealed shut', 'manhole sealed', 'manhole screwed', 'sealed manhole', 'no manhole', 'no access to subfloor', 'no access to the subfloor', 'no subfloor access', 'could not access the subfloor', 'couldn\'t get into the subfloor', 'subfloor not accessible', 'subfloor not entered', 'hatch too small', 'no subfloor hatch', 'no hatch', 'height restriction', 'too high', 'unsafe height', 'beyond safe height', 'safety hazard', 'hazard', 'hazardous', 'unsafe', 'not safe', 'dog', 'dogs', 'animal', 'animals', 'bees', 'wasps', 'snake', 'snakes', 'live wires', 'exposed wiring', 'unstable'],
  'No roof void': ['skillion', 'no roof void', 'no void', 'no roof space'],
  'Soil or abutting structures': ['backfill', 'back fill', 'soil built up', 'soil against', 'fill against', 'abutting timber', 'timbers against', 'timber against', 'abutting'],
};
// The old specific labels still tick their new reason when dictated or
// returned by the AI.
Object.entries(LEGACY_REASONS).forEach(([old, next]) => next.forEach(n => {
  if (OBS_REASON_SYNONYMS[n] && !OBS_REASON_SYNONYMS[n].includes(old.toLowerCase())) OBS_REASON_SYNONYMS[n].push(old.toLowerCase());
}));

// Called from populateFields() after a voice/AI extraction. The AI returns
// areaStatus for any area the technician mentioned, plus obstructions /
// restrictedAccess as free text. Statuses the AI gives are applied as-is;
// an area that comes back fully inspected (or N/A) also loses the reasons
// an earlier note ticked, because they no longer apply. The free text is
// then used two ways: (1) only when the AI gave no statuses at all, an
// area named in it is marked partly inspected; (2) for areas marked partly
// / not inspected, an obstruction reason is ticked when a phrase about that
// area contains the reason's label, one of its synonyms, or (as a last
// resort) every significant word of the label. A label that starts with
// "no" ("No access to subfloor") needs that "no" in the phrase too, so a
// subfloor the inspector was in is never reported as not accessed. Every
// button stays a normal toggle the technician can correct.
//
// An area an earlier note marked partly or not inspected keeps that, with
// its reasons, when a later note calls it inspected, unless the later note
// says the inspector got in after all ("got into the back of the subfloor
// now"). A note about a finding or a leak in the kitchen is not a note
// about access, and must not drop the interior's access limits from the
// report.
const ACCESS_GAINED_RE = /\b(got|get|went|go|gone|crawled)\s+(in|into|under|up|through|back)\b|\baccessed\b|\bnow\s+(accessible|inspected|clear|open)\b|\b(fully|completely)\s+inspected\b|\binspected\s+(it|the rest|all|fully)\b|\bthe rest of\b|\ball of (the|it)\b|\bfull access\b|\b(moved|cleared|unlocked)\b|\bopened (it|up the|the)\b/i;
function noteSaysAccessGained(transcript, zoneId) {
  if (!transcript) return false;
  const names = [OBS_ZONES[zoneId].label.replace(/^the /i, ''), ...(AREA_ALIASES[zoneId] || [])].map(n => n.toLowerCase());
  return String(transcript).toLowerCase().split(/[.!?\n]+/).some(sentence => names.some(n => sentence.includes(n)) && ACCESS_GAINED_RE.test(sentence));
}

function applyObstructionExtraction(data, transcript) {
  const VALID = new Set(AREA_STATUSES.map(([v]) => v));
  let changed = false;
  const aiStatus = (data.areaStatus && typeof data.areaStatus === 'object') ? data.areaStatus : {};
  Object.entries(aiStatus).forEach(([z, st]) => {
    if (!OBS_ZONES[z] || !VALID.has(st)) return;
    if (st === 'INSPECTED' && ['PARTIAL', 'NOT'].includes(areaStatusOf(z)) && !noteSaysAccessGained(transcript, z)) return;
    if (!reportData.areaStatus) reportData.areaStatus = {};
    reportData.areaStatus[z] = st;
    if (!['PARTIAL', 'NOT'].includes(st) && reportData.areaReasons) delete reportData.areaReasons[z];
    changed = true;
  });

  // What was found per area. FOUND sticks: a later note saying the rest of
  // an area is clear doesn't undo evidence recorded there.
  const aiResult = (data.areaResult && typeof data.areaResult === 'object') ? data.areaResult : {};
  Object.entries(aiResult).forEach(([z, r]) => {
    if (!OBS_ZONES[z] || !['CLEAR', 'FOUND'].includes(r)) return;
    if (!reportData.areaResult) reportData.areaResult = {};
    if (r === 'CLEAR' && reportData.areaResult[z] === 'FOUND') return;
    reportData.areaResult[z] = r;
    changed = true;
  });

  // Brackets are dropped so "outer edges (low clearance)" reads as one phrase.
  const combinedText = [data.obstructions, data.restrictedAccess].map(t => (t || '').replace(/[()]/g, ' ').trim()).filter(Boolean).join('. ');
  if (combinedText && !/^\s*(nil|none|no obstructions|no restrictions|n\/a|nothing)\b/i.test(combinedText)) {
    const words = t => t.toLowerCase().split(/[^a-z/]+/).filter(Boolean);
    // The words that identify a reason label: anything 4+ letters, plus a
    // leading "no"/"not" when the label has one.
    const sigWords = t => words(t).filter(w => (w.length >= 4 && w !== 'the') || w === 'no' || w === 'not');
    const hasWord = (phrase, w) => new RegExp('(^|[^a-z])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)').test(phrase);
    const hasPhrase = (phrase, p) => hasWord(phrase, p.toLowerCase().replace(/\s+/g, ' '));
    const names = zoneId => [sigWords(OBS_ZONES[zoneId].label), ...(AREA_ALIASES[zoneId] || []).map(a => a.split(' '))];
    const namesZone = (phrase, zoneId) => names(zoneId).some(ws => ws.every(w => hasWord(phrase, w)));
    // Split into short phrases and give each one to the area it names, or
    // to the last area named earlier in the same sentence.
    const phrasesByZone = {}; const unassigned = [];
    combinedText.toLowerCase().replace(/\s+/g, ' ').split(/[.;]/).forEach(sentence => {
      let current = [];
      sentence.split(/,|:/).map(x => x.trim()).filter(Boolean).forEach(phrase => {
        const named = Object.keys(OBS_ZONES).filter(z => namesZone(phrase, z));
        if (named.length) current = named;
        if (!current.length) { unassigned.push(phrase); return; }
        current.forEach(z => (phrasesByZone[z] = phrasesByZone[z] || []).push(phrase));
      });
    });
    let matchedAny = false;

    // The reasons one phrase ticks: its exact labels and synonyms when it
    // has any, otherwise whichever labels have every significant word in
    // it (so "Low clearance in roof void" isn't also ticked by a phrase
    // that names the outside-edges label).
    const itemsFor = (items, phrase) => {
      const exact = items.filter(item => hasPhrase(phrase, item) || (OBS_REASON_SYNONYMS[item] || []).some(s => hasPhrase(phrase, s)));
      if (exact.length) return exact;
      return items.filter(item => { const w = sigWords(item); return w.length > 0 && w.every(v => hasWord(phrase, v)); });
    };

    Object.entries(OBS_ZONES).forEach(([zoneId, zone]) => {
      const own = phrasesByZone[zoneId] || [];
      if (Object.keys(aiStatus).length === 0 && !areaStatusOf(zoneId) && own.length) {
        if (!reportData.areaStatus) reportData.areaStatus = {};
        reportData.areaStatus[zoneId] = own.some(x => /no access|not access|not inspect|couldn.?t|could not|locked/.test(x)) ? 'NOT' : 'PARTIAL';
        matchedAny = true;
      }
      if (!['PARTIAL', 'NOT'].includes(areaStatusOf(zoneId))) return;
      // Text that names no area can only be about this one when it's the
      // only area not fully inspected.
      const scope = own.length ? own : (areasNotFullyInspected().length === 1 ? unassigned : []);
      const ticked = new Set(); scope.forEach(x => itemsFor(zone.items, x).forEach(item => ticked.add(item)));
      zone.items.filter(item => ticked.has(item)).forEach(item => {
        if (!reportData.areaReasons) reportData.areaReasons = {};
        const list = reportData.areaReasons[zoneId] || (reportData.areaReasons[zoneId] = []);
        if (!list.includes(item)) { list.push(item); matchedAny = true; }
      });
    });
    if (matchedAny || changed) {
      changed = true;
      showToast('Areas updated from voice — check they match what you described', 'info');
    } else {
      // Nothing in our fixed area list matched — surface it rather than
      // silently losing it, so the technician marks the area manually.
      showToast(`Obstruction mentioned but not auto-matched: "${combinedText.slice(0, 120)}" — mark the area manually`, 'info');
    }
  }
  if (changed) syncObstructionData();
}

// Section 5 doesn't ask again what Section 4 already holds: hindered and
// restricted access are the reasons ticked against each area, shown here
// as a summary with a way back to the area. Each area row also takes the
// exact spot in the inspector's words (see ACCESS SPOTS below); those
// print with the area's row.
//
// hinderedAreas may also hold 'NIL — …' (or 'N/A') from older reports,
// where a No button answered the question. That still counts as No.
function hinderedTextIsNil() {
  const v = (reportData.hinderedAreas || '').trim();
  return v.startsWith('NIL') || v.includes('N/A');
}
function hasHinderedAreas() {
  return !!(reportData.hinderedAreas || '').trim() && !hinderedTextIsNil();
}

// 'YES', 'NO', or null while it can't be told yet. YES when an area has a
// hindered reason (or one not inspected without a reason) or exact spots
// were written; NO once every area is marked and none was limited, or an
// older report answered No. An unanswered question is never printed as NO.
function hinderedAnswer() {
  if (accessLimits().hindered.length) return 'YES';
  const allMarked = Object.keys(OBS_ZONES).every(z => areaStatusOf(z));
  if (allMarked || hinderedTextIsNil()) return 'NO';
  return null;
}

// Kept for the voice path: a note that says nothing was in the way.
function setHinderedAccess(hindered) {
  if (!hindered && !hasHinderedAreas()) reportData.hinderedAreas = 'NIL — No hindered access areas at time of inspection.';
  renderAccessSummary();
  updateProgress(); flushDraftSave();
}

// Opens one area in Section 4, from the summary in Section 5.
function openAreaRow(zoneId) {
  areaOpen.add(zoneId);
  showSection('obstructions');
  renderAreaChecklist();
  const row = document.querySelector(`#areaChecklist details[data-zone="${zoneId}"]`);
  if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// ── ACCESS SPOTS ─────────────────────────────────────────────────────────
// Where exactly, per area, typed on the area's row in Section 5:
// reportData.accessSpots = { hindered: { zoneId: text }, restricted: {…} }.
// Voice notes still fill the free text (hinderedAreas, noAccessAreas), so a
// sentence there that opens with an area ("Roof void: outer edges") is
// shown on that area's row; anything else shows as "Other spots" (key
// '_other'). A typed spot, even a blank one, wins over the voice text.
const ACCESS_SPOT_TEXT = { hindered: 'hinderedAreas', restricted: 'noAccessAreas' };
const ZONE_SPOT_ALIASES = {
  interior: ['the interior', 'interior', 'inside'],
  exterior: ['the exterior', 'exterior', 'outside'],
  subfloor: ['subfloor', 'sub-floor', 'sub floor', 'underfloor', 'under the house'],
  roofvoid: ['roof void', 'roof space', 'ceiling space', 'roof cavity'],
  outbuildings: ['outbuildings', 'outbuilding', 'garage', 'shed', 'carport'],
  site: ['the site', 'site', 'yard', 'grounds'],
  fences: ['fences', 'fence', 'fencing'],
  retainingwalls: ['retaining walls', 'retaining wall'],
  landscapingtimbers: ['landscaping timbers', 'landscaping timber', 'sleepers'],
};

// The voice text split into sentences, each tied to the area it opens
// with, if that area is one of zones.
function voiceAccessSpots(kind, zones) {
  const text = (reportData[ACCESS_SPOT_TEXT[kind]] || '').trim();
  const out = { _other: [] };
  if (!text || (kind === 'hindered' && hinderedTextIsNil())) return out;
  text.split(/(?<=[.;])\s+|\n+/).map(t => t.trim()).filter(Boolean).forEach(seg => {
    const low = seg.toLowerCase();
    const z = zones.find(z => (ZONE_SPOT_ALIASES[z] || []).some(a => low.startsWith(a) && !/[a-z]/.test(low.charAt(a.length))));
    if (!z) { out._other.push(seg); return; }
    const alias = ZONE_SPOT_ALIASES[z].find(a => low.startsWith(a));
    const rest = seg.slice(alias.length).replace(/^[\s:,–—-]+/, '').replace(/[.;]$/, '').trim();
    (out[z] = out[z] || []).push(rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : seg);
  });
  return out;
}

// The exact spot shown and printed for one area (or '_other').
function accessSpot(kind, key, zones) {
  const typed = ((reportData.accessSpots || {})[kind] || {})[key];
  if (typed !== undefined) return typed;
  const voice = voiceAccessSpots(kind, zones)[key] || [];
  return voice.join(key === '_other' ? ' ' : '; ');
}

// The zones listed in each card, the same split renderAccessSummary shows.
function accessZones(kind) {
  const reasons = reportData.areaReasons || {};
  return areasNotFullyInspected().filter(z => {
    const items = reasons[z] || [];
    return kind === 'restricted' ? items.some(i => RESTRICTED_REASONS.has(i))
      : !items.length || items.some(i => !RESTRICTED_REASONS.has(i));
  });
}

function setAccessSpot(kind, key, value) {
  if (!reportData.accessSpots) reportData.accessSpots = {};
  if (!reportData.accessSpots[kind]) reportData.accessSpots[kind] = {};
  reportData.accessSpots[kind][key] = value.trim();
  closeAccessSpotEditor();
  updateProgress(); flushDraftSave();
}

function closeAccessSpotEditor() {
  const el = document.activeElement;
  if (el && el.classList.contains('access-spot-input')) el.blur();
  renderAccessSummary();
}

// Swaps a row's spot line for a text box that saves the same way as the
// other report fields.
function editAccessSpot(kind, key) {
  const btn = document.querySelector(`.access-spot[data-kind="${kind}"][data-key="${key}"]`);
  if (!btn) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'field-edit-input access-spot-input';
  input.value = accessSpot(kind, key, accessZones(kind));
  input.placeholder = key === '_other' ? 'Anything not tied to one area' : (kind === 'restricted' ? 'e.g. Front left bedroom, locked, no key' : 'e.g. Outer edges and corners, low clearance');
  wireInlineTextEdit(input, v => setAccessSpot(kind, key, v), closeAccessSpotEditor);
  const wrap = document.createElement('div');
  wrap.className = 'access-spot-editor';
  wrap.append(input);
  btn.replaceWith(wrap);
  input.focus();
}

const ACCESS_GROUP_ICONS = {
  hindered: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/></svg>',
  restricted: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
};

function renderAccessSummary() {
  const hBox = document.getElementById('accessHinderedBox');
  const rBox = document.getElementById('accessRestrictedBox');
  if (!hBox || !rBox) return;
  // Don't redraw under the inspector's thumb while a spot is being typed.
  const typing = document.activeElement && document.activeElement.classList;
  if (typing && (typing.contains('access-spot-input') || typing.contains('spot-photo-caption'))) return;
  const reasons = reportData.areaReasons || {};
  const limited = areasNotFullyInspected();
  const allMarked = Object.keys(OBS_ZONES).every(z => areaStatusOf(z));
  const rows = restricted => limited.map(z => {
    const items = (reasons[z] || []).filter(i => RESTRICTED_REASONS.has(i) === restricted);
    // An area limited with no reason ticked shows under hindered, so it
    // isn't missed: that's how the report prints it too.
    const noReason = !restricted && !(reasons[z] || []).length;
    if (!items.length && !noReason) return '';
    const why = noReason ? '<span class="access-item-why missing">No reason ticked yet</span>'
      : `<span class="access-item-why">${escapeHtml(items.join(', '))}</span>`;
    const status = areaStatusOf(z) === 'NOT' ? 'Not inspected' : 'Inspected with limits';
    const kind = restricted ? 'restricted' : 'hindered';
    return `<div class="access-item">
      <span class="access-item-name">${OBS_ZONES[z].label.replace(/^The /, '')}</span>
      <button type="button" class="access-item-state" onclick="openAreaRow('${z}')" aria-label="${status}. Change in Areas">${status}</button>${why}
      ${spotLine(kind, z)}${spotPhotos(kind, z)}</div>`;
  }).filter(Boolean);
  const spotLine = (kind, key) => {
    const spot = accessSpot(kind, key, accessZones(kind));
    return `<button type="button" class="access-spot${spot ? '' : ' empty'}" data-kind="${kind}" data-key="${key}" onclick="editAccessSpot('${kind}','${key}')">${spot ? escapeHtml(spot) : '+ Add exact spot'}</button>`;
  };
  // Photos of the spot, each with its own details box.
  const spotPhotos = (kind, key) => spotPhotosHTML(spotPhotoSection(kind, key));
  // Voice text that names no listed area, under its own row.
  const other = kind => accessSpot(kind, '_other', accessZones(kind)) ? `<div class="access-item access-item-other">
      <span class="access-item-name">Other spots</span>${spotLine(kind, '_other')}${spotPhotos(kind, '_other')}</div>` : '';
  // One card per kind of limit: a header with the count, then the areas.
  const group = (kind, title, sub, list, none) => {
    const extra = other(kind);
    const count = list.length ? `<span class="access-count ${kind}">${list.length} area${list.length === 1 ? '' : 's'}</span>`
      : extra ? `<span class="access-count ${kind}">Noted</span>`
      : none ? '<span class="access-count none">None</span>'
      : '<span class="access-count">Not yet</span>';
    const body = list.length || extra ? `<div class="access-items">${list.join('')}${extra}</div>` : '';
    return `<div class="access-group access-${kind}">
      <div class="access-group-head"><span class="access-group-icon">${ACCESS_GROUP_ICONS[kind]}</span>
        <span class="access-group-title">${title}<small>${sub}</small></span>${count}</div>${body}</div>`;
  };
  hBox.innerHTML = group('hindered', 'Obstructions', 'In the way on the day: stored goods, furniture, insulation',
    rows(false), allMarked || hinderedTextIsNil());
  rBox.innerHTML = group('restricted', 'Restricted access', 'Locked or permanent: no key, no hatch, no roof void',
    rows(true), allMarked);
  [hBox, rBox].forEach(hydrateSpotPhotos);
  const intro = document.getElementById('accessIntro');
  if (intro) intro.innerHTML = allMarked || limited.length ? 'Filled in from your ticks in Areas. Tap a status to change it there, or add where exactly.'
    : `Mark every area above and these fill themselves in. <button type="button" class="link-btn" onclick="document.getElementById('section-obstructions').scrollIntoView({ behavior: 'smooth', block: 'start' })">Back to the areas</button>`;
  const hint = document.getElementById('accessHighRiskHint');
  if (hint) {
    const fallback = accessLimits().highRisk;
    hint.textContent = isBlankValue(reportData.highRiskAreas) && fallback ? `Left blank, the report lists: ${fallback}` : '';
    hint.hidden = !hint.textContent;
  }
}

// Every access limit the report prints, as [label, text] rows: hindered
// (temporary) and restricted (permanent or locked), from each area's
// reasons and the inspector's own where-and-why, plus the high risk areas
// to which access should be gained. allMarked: every area has a status, so
// an empty list can be printed as "None".
function accessLimits() {
  const hindered = [], restricted = [];
  const detail = isBlankValue(reportData.hinderedAreasDetail) || reportData.hinderedAreas === 'NO' ? '' : reportData.hinderedAreasDetail;
  const hZones = accessZones('hindered'), rZones = accessZones('restricted');
  const where = (kind, z, zones) => { const s = accessSpot(kind, z, zones); return s ? `. Where: ${s.charAt(0).toUpperCase()}${s.slice(1)}` : ''; };
  Object.entries(OBS_ZONES).forEach(([z, zone]) => {
    const st = areaStatusOf(z);
    if (!['PARTIAL', 'NOT'].includes(st)) return;
    const items = (reportData.areaReasons || {})[z] || [];
    const status = st === 'NOT' ? 'Not inspected' : 'Partly inspected';
    const h = items.filter(i => !RESTRICTED_REASONS.has(i)), r = items.filter(i => RESTRICTED_REASONS.has(i));
    if (h.length) hindered.push([zone.label, `${status}, obstructed by ${h.join(', ').toLowerCase()}${where('hindered', z, hZones)}`]);
    if (r.length) restricted.push([zone.label, `${st === 'NOT' ? 'Not inspected:' : 'Inspected, restricted by'} ${r.join(', ').toLowerCase()}${where('restricted', z, rZones)}`]);
    if (!items.length) hindered.push([zone.label, `${status}${detail ? '' : ', reason not recorded'}${where('hindered', z, hZones)}`]);
  });
  // Spots tied to no listed area follow the area rows. With no area rows
  // at all (older reports), the inspector's words print as they were, with
  // 'What hindered it'.
  const areaRows = hindered.length;
  const hOther = accessSpot('hindered', '_other', hZones), rOther = accessSpot('restricted', '_other', rZones);
  if (hOther) hindered.push([areaRows ? 'Other spots' : 'Where', hOther]);
  // The inspector's own words about what was in the way always print, so a
  // dictated reason isn't lost behind the per-area rows.
  if (detail && !hinderedTextIsNil()) hindered.push(['What obstructed it', detail]);
  if (rOther) restricted.push([restricted.length ? 'Other spots' : 'Where and why', rOther]);
  const limited = areasNotFullyInspected();
  const highRisk = !isBlankValue(reportData.highRiskAreas) ? reportData.highRiskAreas
    : [!isBlankValue(reportData.noAccessAreas) ? reportData.noAccessAreas : '', ...limited.map(z => OBS_ZONES[z].label)].filter(Boolean).join('; ');
  const allMarked = Object.keys(OBS_ZONES).every(z => areaStatusOf(z));
  return { hindered, restricted, highRisk, allMarked };
}

// ── ACCESS SPOT PHOTOS ───────────────────────────────────────────────────
// Each area row in Section 5 takes its own photos, stored with the other
// section photos under photosBySection['spot-<kind>-<zone>'] so backup and
// sync pick them up. They print with the access rows.
function spotPhotoSection(kind, key) { return `spot-${kind}-${key}`; }
// Each termite finding takes its own photos the same way, under
// photosBySection['finding-<finding id>']; they print inside its card.
function findingPhotoSection(id) { return `finding-${id}`; }

// A strip of photos, each with its own details box, and an add button.
function spotPhotosHTML(section) {
  const photos = (reportData.photosBySection || {})[section] || [];
  const cards = photos.map(p => `<div class="spot-photo">
      <img data-photo-id="${p.id}" alt="Photo">
      <input class="photo-caption-input spot-photo-caption" type="text" placeholder="Add details…" value="${escapeHtml(p.caption || '')}"
        oninput="updateSectionPhotoCaption('${p.id}','${section}',this.value)">
      <button type="button" class="photo-remove-btn" onclick="removeSpotPhoto('${p.id}','${section}')">Remove</button>
    </div>`).join('');
  return `<div class="spot-photos" data-section="${section}">${cards}
    <button type="button" class="link-btn spot-photo-add" onclick="addSpotPhoto('${section}')">+ Add photo</button></div>`;
}
function hydrateSpotPhotos(container) {
  container.querySelectorAll('.spot-photos').forEach(el =>
    hydratePhotoImages(el, (reportData.photosBySection || {})[el.dataset.section] || []));
}
// Redraws whichever part of the report the strip belongs to.
function refreshSpotPhotos(section) {
  if (section.startsWith('finding-')) renderFindingsUI(); else renderAccessSummary();
}

function addSpotPhoto(section) {
  const input = document.getElementById('spotPhotoInput');
  input.dataset.section = section;
  choosePhotoSource(input);
}

async function handleSpotPhotoFiles(input) {
  const files = Array.from(input.files || []);
  input.value = '';
  await handleSectionPhotoFiles(files, input.dataset.section);
  refreshSpotPhotos(input.dataset.section);
}

function removeSpotPhoto(id, section) {
  removeSectionPhoto(id, section, () => refreshSpotPhotos(section));
  refreshSpotPhotos(section);
}

// The photos of every spot the report prints, in the order of the rows,
// each captioned with its area and kind ahead of the inspector's details.
function accessSpotPhotos() {
  const out = [];
  ['hindered', 'restricted'].forEach(kind => {
    const zones = accessZones(kind);
    [...zones, '_other'].forEach(key => {
      const photos = (reportData.photosBySection || {})[spotPhotoSection(kind, key)] || [];
      if (!photos.length || (key === '_other' && !accessSpot(kind, '_other', zones))) return;
      const where = (key === '_other' ? 'Other spot' : OBS_ZONES[key].label.replace(/^The /, '')) + (kind === 'restricted' ? ', restricted' : ', obstruction');
      photos.forEach(p => out.push({ ...p, caption: [where, (p.caption || '').trim()].filter(Boolean).join(': ') }));
    });
  });
  return out;
}

function restoreResState() { renderAccessSummary(); }

// ── PHOTOS WHILE TALKING ─────────────────────────────────────────────────
// The inspector describes a spot and photographs it in the same breath.
// A photo taken from the voice popover is kept with the words heard around
// the moment it was taken (reportData.photosBySection.findings[i].heard),
// and once the note has filled the report it moves onto the finding whose
// place those words name, with the sentence as its caption. One that
// matches no finding stays in the Findings photos, caption blank.
const TALK_WINDOW_BEFORE_MS = 30000, TALK_WINDOW_AFTER_MS = 20000;
let speechTimeline = []; // [{ t, text }] for the open report, this session

function speechHeard(text) {
  const t = Date.now();
  const clean = String(text || '').trim();
  if (!clean) return;
  speechTimeline.push({ t, text: clean });
  if (speechTimeline.length > 400) speechTimeline = speechTimeline.slice(-300);
  // Words said just after the photo belong to it too.
  let touched = false;
  for (const p of getSectionPhotos('findings')) {
    if (p.heard && !p.heard.placed && t - p.heard.at <= TALK_WINDOW_AFTER_MS) { p.heard.text = heardAround(p.heard.at); touched = true; }
  }
  if (touched) saveDraft();
}

function heardAround(at) {
  // Each stretch of speech on its own line, so a caption can be one of them.
  return speechTimeline.filter(e => e.t >= at - TALK_WINDOW_BEFORE_MS && e.t <= at + TALK_WINDOW_AFTER_MS).map(e => e.text).join('\n').trim();
}

function takePhotoWhileTalking() {
  const input = document.getElementById('talkPhotoInput');
  if (!input) return;
  input.value = '';
  input.click();
}

async function handleTalkPhotoFiles(input) {
  const files = Array.from(input.files || []);
  input.value = '';
  if (!files.length) return;
  const at = Date.now();
  const before = new Set(getSectionPhotos('findings').map(p => p.id));
  await handleSectionPhotoFiles(files, 'findings');
  const added = getSectionPhotos('findings').filter(p => !before.has(p.id));
  added.forEach(p => { p.heard = { at, text: heardAround(at) }; });
  if (added.length) {
    showToast(added.length === 1 ? 'Photo kept. It lands on the finding you\'re describing once the note is filled in' : `${added.length} photos kept for the findings you're describing`, 'success');
    renderSectionPhotoGrid('findings');
    saveDraft();
  }
  updateTalkPhotoButton();
}

function talkPhotosWaiting() {
  return getSectionPhotos('findings').filter(p => p.heard && !p.heard.placed);
}

function updateTalkPhotoButton() {
  const btn = document.getElementById('voicePhotoBtn'), label = document.getElementById('voicePhotoBtnText');
  if (!btn || !label) return;
  const n = talkPhotosWaiting().length;
  btn.classList.toggle('has-photos', n > 0);
  label.textContent = n ? `${n} photo${n === 1 ? '' : 's'} waiting for the fill · take another` : 'Photo of what you\'re describing';
}

// Words that say where a finding is, for matching speech to a finding.
const talkPlaceWords = t => keyWords(t).filter(w => !PLACE_FILLER.has(w) && !TALK_SKIP.has(w));
const TALK_SKIP = new Set(['termite', 'termites', 'live', 'active', 'activity', 'there', 'here', 'yeah', 'okay', 'right', 'just', 'like', 'some', 'then', 'also', 'have', 'been', 'were', 'what', 'about', 'looks', 'look', 'found', 'photo', 'picture', 'taking', 'take']);

// The finding the heard words name best: the most place words in common,
// at least two, or one when only one finding has a place at all.
function findingForHeard(text, findings) {
  const said = new Set(talkPlaceWords(text));
  if (!said.size) return null;
  const placed = findings.filter(f => f && f.id && f.termiteActivity !== 'NONE' && (f.activityLocation || f.damageDescription || f.timberAffected));
  let best = null, bestScore = 0, second = 0;
  for (const f of placed) {
    const words = new Set(talkPlaceWords([f.activityLocation, f.timberAffected, f.damageDescription].join(' ')));
    let score = 0; words.forEach(w => { if (said.has(w)) score++; });
    if (score > bestScore) { second = bestScore; bestScore = score; best = f; }
    else if (score > second) second = score;
  }
  if (!best || bestScore === second) return null;
  if (bestScore >= 2 || (bestScore === 1 && placed.length === 1)) return best;
  return null;
}

// The sentence of the heard words that names the finding, tidied for a
// caption: fillers out, first letter up, cut at a reasonable length.
function talkCaption(text, finding) {
  const want = new Set(talkPlaceWords([finding.activityLocation, finding.timberAffected, finding.damageDescription].join(' ')));
  const parts = String(text).split(/\n+|(?<=[.!?])\s+|\s+(?=(?:and then|then|so|okay|right|um|next)\b)/i).map(s => s.trim()).filter(Boolean);
  // The stretch that names the finding best.
  let pick = '', pickScore = 0;
  for (const part of parts) { const n = talkPlaceWords(part).filter(w => want.has(w)).length; if (n > pickScore) { pickScore = n; pick = part; } }
  if (!pick) pick = parts[0] || '';
  pick = pick.replace(/\b(um+|uh+|erm)\b[,.]?\s*/gi, ' ').replace(/^(?:\s*(?:okay|ok|right|so|yeah|like|and|then|well)\b[,.]?\s*)+/i, '').replace(/\s+/g, ' ').replace(/^[\s,.;:-]+|[\s,;:-]+$/g, '').trim();
  if (pick.length > 110) pick = pick.slice(0, 107).replace(/\s+\S*$/, '') + '…';
  return pick ? pick.charAt(0).toUpperCase() + pick.slice(1) : '';
}

function placeTalkPhotos() {
  const waiting = talkPhotosWaiting();
  if (!waiting.length) return 0;
  const findings = reportData.findings || [];
  let moved = 0;
  for (const p of waiting) {
    const text = p.heard.text || heardAround(p.heard.at);
    const f = findingForHeard(text, findings);
    if (!f) continue;
    const section = findingPhotoSection(f.id);
    if (getSectionPhotos(section).length >= sectionPhotoLimit(section)) continue;
    reportData.photosBySection.findings = getSectionPhotos('findings').filter(x => x.id !== p.id);
    if (!p.caption) p.caption = talkCaption(text, f);
    p.heard.placed = f.id;
    getSectionPhotos(section).push(p);
    moved++;
  }
  if (moved) {
    renderSectionPhotoGrid('findings');
    renderFindingsUI();
    showToast(moved === 1 ? 'Your photo is on the finding you described' : `${moved} photos are on the findings you described`, 'success');
  }
  updateTalkPhotoButton();
  return moved;
}

// Findings with termite activity or evidence where "Refer to a builder or
// engineer?" has no answer. A blank is never read as "no referral".
function findingsMissingReferral() {
  return (reportData.findings || [])
    .map((f, i) => ({ f, n: i + 1 }))
    .filter(({ f }) => f && (f.termiteActivity === 'ACTIVE' || f.termiteActivity === 'INACTIVE') && f.structuralConcern !== 'YES' && f.structuralConcern !== 'NO')
    .map(({ n }) => n);
}

// ══════════════════════════════════════════════════════════════════════════
// SPECIES INTELLIGENCE DATABASE
// Research-backed data for Australian termite species
// ══════════════════════════════════════════════════════════════════════════
const SPECIES_DB = {
  'Coptotermes acinaciformis': {
    commonName: 'Subterranean Termite',
    family: 'Rhinotermitidae',
    distribution: 'Most widely distributed termite in Australia — found continent-wide except Tasmania and parts of coastal Victoria.',
    fieldID: [
      '🔑 MILKY FLUID TEST: Press a soldier with multigrips or a probe — a white milky fluid secretes from the fontanelle (a pore on the top of the head). This is the definitive on-site field test for Coptotermes. No other common Australian species does this.',
      '👀 DAMAGE PATTERN: Smooth, clean galleries running with the grain of the timber. Timber hollowed out leaving a thin outer shell — sounds hollow when sounded with a screwdriver handle. No grit or soil packed into the galleries.',
      '🪵 SURFACE SIGNS: Mud tubes on stumps, piers, and walls — often brown-grey, firm, and pencil-thin. Paint or plaster may blister or bubble where termites have hollowed the substrate behind it.',
      '⚠️ SECONDARY COLONY NOTE: Can establish above-ground satellite nests with zero soil contact where there is an alternative moisture source — roof leaks, wall-cavity plumbing leaks. If active Coptotermes are found in a roof void or high wall cavity with no obvious ground path, check for a nearby moisture source.',
    ],
    identification: [
      'Workers: cream-white, eyeless, 4–5mm',
      'Soldiers: pale body, teardrop-shaped head with large mandibles, 5–7mm',
      'KEY ID: When soldiers are pressed, a white milky fluid secretes from a pore (fontanelle) on the head — unique to Coptotermes',
      'Reproductives (alates): dark brown, 12mm with four large wings'
    ],
    nestTypes: [
      'Underground subterranean nests',
      'Root crown/base of living trees (eucalypts, peppercorns, English oaks)',
      'Subsidiary nests in wall cavities — especially near moisture sources',
      'Under concrete slabs and floor structures',
      'Can nest under patios and below ground-level masonry'
    ],
    behaviour: [
      'Forages day and night through extensive underground tunnel networks',
      'Workers travel up to 100m from the colony',
      'Prefers both softwoods (radiata pine) and hardwoods (ash, Tasmanian oak)',
      'Mud tubes visible on stumps, walls, piers — often the first sign of attack',
      'Hollows out timber leaving a thin exterior shell — sounds hollow when sounded',
      'Individual termites returned to colony after separation are accepted; termites from other colonies rejected'
    ],
    conduciveConditions: [
      'Leaking pipes, poor drainage, damp wood',
      'Decayed tree stumps in yard',
      'Timber-soil contact',
      'High moisture environments'
    ],
    treatmentOptions: [
      { product: 'Termidor (Fipronil)', type: 'Chemical Barrier', notes: 'Industry standard. Non-repellent, transfer effect, excellent soil binding. 8+ year protection. Preferred where moisture movement in soil.', toxicity: 'Moderate' },
      { product: 'Altriset (Chlorantraniliprole)', type: 'Chemical Barrier', notes: 'Lowest toxicity — exempt from poison scheduling in Australia. Paralyses muscles, stops feeding within hours. Up to 8 years. Higher cost.', toxicity: 'Very Low' },
      { product: 'Premise (Imidacloprid)', type: 'Chemical Barrier', notes: 'Non-repellent, water-soluble. Better soil penetration. Less durable in wet soils. Risk to bees/plants.', toxicity: 'Low–Moderate' },
      { product: 'Sentricon Baiting System', type: 'Bait Station', notes: 'Insect growth regulator. Slow-acting colony elimination. Useful where chemical barrier is not practical.', toxicity: 'Very Low' }
    ],
    specialFlags: [],
    fieldNotePrompts: [
      'Perform milky fluid test on soldiers — document result (positive = Coptotermes confirmed)',
      'Sound all accessible timbers in affected area — note extent of hollowing',
      'Check for subsidiary nests in wall cavities — common near moisture sources',
      'If found in roof void or high wall cavity, look for moisture source (leak, plumbing) nearby',
      'Inspect root crowns of trees within 50m of structure',
      'Document mud tube locations with photos if possible',
      'Recommend licensed builder assessment for structural integrity of damaged timbers'
    ]
  },

  'Coptotermes frenchi': {
    commonName: 'Subterranean Termite',
    family: 'Rhinotermitidae',
    distribution: 'Southern Australian states — common in Victoria, parts of NSW and SA. Less common than C. acinaciformis.',
    fieldID: [
      '🔑 MILKY FLUID TEST: Same as C. acinaciformis — press a soldier and check for white milky fluid from the fontanelle. Confirms genus (Coptotermes). Species differentiation between frenchi and acinaciformis requires specialist examination.',
      '👀 DAMAGE PATTERN: Similar to C. acinaciformis — smooth clean galleries with the grain, hollow-sounding timber. Geography and host tree preference assist in species confirmation.',
      '🌳 HOST PREFERENCE: More commonly associated with specific host trees — Eucalyptus melliodora (yellow box), E. polyanthemos (red box). If these are present on or near the property, note them.',
    ],
    identification: [
      'Very similar to C. acinaciformis — specialist identification required',
      'Soldiers: pale body, teardrop-shaped head, 5–7mm',
      'KEY ID: Milky fluid from fontanelle when pressed — same as C. acinaciformis',
      'Geography and host tree preference assist species confirmation'
    ],
    nestTypes: [
      'Root crowns and bases of living trees',
      'Underground subterranean nests',
      'Timber stumps'
    ],
    behaviour: [
      'Mainly a forest pest but can invade buildings',
      'Attacks both hardwood and softwood',
      'Not as aggressive as C. acinaciformis'
    ],
    conduciveConditions: ['Decayed timber', 'Moisture', 'Tree stumps near structure'],
    treatmentOptions: [
      { product: 'Termidor (Fipronil)', type: 'Chemical Barrier', notes: 'Non-repellent, transfer effect. Industry standard for Coptotermes species.', toxicity: 'Moderate' },
      { product: 'Altriset (Chlorantraniliprole)', type: 'Chemical Barrier', notes: 'Low toxicity alternative. Stops feeding within hours.', toxicity: 'Very Low' }
    ],
    specialFlags: [],
    fieldNotePrompts: [
      'Perform milky fluid test on soldiers — confirms Coptotermes genus',
      'Note nearby tree species — yellow box, red box are typical hosts for C. frenchi',
      'Confirm species where possible — C. frenchi and C. acinaciformis require specialist differentiation',
      'Check root crowns of nearby trees',
      'Sound all accessible timber in affected area'
    ]
  },

  'Schedorhinotermes': {
    commonName: 'Subterranean Termite',
    family: 'Rhinotermitidae',
    distribution: 'Widespread across eastern Australia. Most common damaging species in some regions including coastal NSW and QLD.',
    fieldID: [
      '🔑 TWO SOLDIER CASTES — KEY FIELD TEST: Look carefully at the soldiers. Schedorhinotermes is the ONLY common Australian genus with two distinct soldier sizes in the same colony. Major soldiers (5–7.5mm, large bulbous head) and minor soldiers (3–5.5mm, narrower head). If you see both sizes, this confirms the genus.',
      '👀 DAMAGE PATTERN: Patchy, irregular damage with large gouges — particularly around nails, screws and fixings where the timber is softer. Unlike Coptotermes (smooth galleries with the grain), Schedorhinotermes damage often looks more chaotic and chewed.',
      '🏗️ WORKINGS: Characteristic fragile plaster-like earthen deposits covering galleries — brownish-grey, finer texture than Coptotermes mud tubes. Easily crumbled between fingers. Often called "plastering".',
      '⚠️ DO NOT DISTURB: Schedorhinotermes is highly skittish. If you disturb active workings during the inspection, the colony may relocate before treatment can be applied. Minimise exposure of active galleries.',
    ],
    identification: [
      'TWO soldier castes — key distinguishing feature:',
      'Major soldiers: 5–7.5mm, bulbous head, large mandibles',
      'Minor soldiers: 3–5.5mm, narrower head, slender mandibles — appear first in developing colony',
      'Characteristic "plastering" earthen workings — fragile plaster-like deposits covering their galleries',
      'White cigar-shaped body, pale to dark brown head on both castes'
    ],
    nestTypes: [
      'Tree stumps and root crowns of living trees',
      'Under patios, fireplaces and buried timber',
      'Under houses — multiple small nest sites rather than one central nest',
      'Queen lays eggs one at a time (unlike other species) — slower colony development'
    ],
    behaviour: [
      'VERY SKITTISH — will relocate entire colony if disturbed during treatment',
      'Creates multiple satellite nests — difficult to fully locate',
      'Attack is concealed under characteristic fragile plastering',
      'Queens and kings can live over 20 years',
      'Workers and soldiers live 1–2 years'
    ],
    conduciveConditions: ['Tree stumps', 'Buried timber', 'Subfloor moisture', 'Timber-soil contact'],
    treatmentOptions: [
      { product: 'Termidor (Fipronil)', type: 'Chemical Barrier', notes: 'Non-repellent essential — repellent chemicals will cause colony relocation. Full perimeter treatment required.', toxicity: 'Moderate' },
      { product: 'Altriset (Chlorantraniliprole)', type: 'Chemical Barrier', notes: 'Non-repellent, low toxicity. Stops feeding within hours. Preferred where minimal disturbance required.', toxicity: 'Very Low' }
    ],
    specialFlags: [
      { type: 'warning', icon: '⚠', text: 'DO NOT DISTURB — Schedorhinotermes is highly skittish. Any disturbance to active workings during inspection or treatment may cause the colony to relocate to an untreated area of the property. Avoid drilling, hammering, or directly exposing active galleries where possible until treatment strategy is confirmed.' }
    ],
    fieldNotePrompts: [
      'Note whether BOTH major AND minor soldiers are present — two castes confirm genus, major soldiers indicate mature colony',
      'Describe plastering deposit locations and texture — photograph all visible deposits',
      'Note damage pattern — look for gouging around nails/fixings, which is characteristic of this genus',
      'Check for multiple nest sites — stumps, under patio, subfloor, fireplaces',
      'Advise client: DO NOT disturb active workings until treatment is underway',
      'Only use non-repellent treatments — repellent chemicals will cause colony relocation'
    ]
  },

  'Schedorhinotermes intermedius': {
    commonName: 'Subterranean Termite',
    family: 'Rhinotermitidae',
    distribution: 'Eastern coastline of Australia. Common throughout NSW, QLD, VIC.',
    fieldID: [
      '🔑 TWO SOLDIER CASTES: Major soldiers (larger, bulbous head) and minor soldiers (smaller, narrower head) present together — confirms Schedorhinotermes genus. Minor soldiers appear first in young colonies; presence of majors = well-established colony.',
      '👀 DAMAGE PATTERN: Patchy gouging damage particularly around nails and fixings. Fragile plaster-like earthen workings (plastering) covering galleries — crumbles easily when disturbed.',
      '⚠️ SKITTISH — DO NOT DISTURB active workings. Colony will relocate if galleries are exposed.',
    ],
    identification: [
      'Major soldiers: bulbous head, 5–7.5mm',
      'Minor soldiers: narrower head, ~4mm — appear first in young colonies',
      'Characteristic fragile plaster-like earthen workings',
      'Very similar to other Schedorhinotermes species'
    ],
    nestTypes: ['Tree stumps', 'Root crowns', 'Under properties and patios', 'Under fireplaces'],
    behaviour: [
      'VERY SKITTISH — colony will relocate if disturbed',
      'Multiple nest sites make full elimination difficult',
      'Major soldiers indicate an established colony'
    ],
    conduciveConditions: ['Tree stumps', 'Subfloor moisture', 'Timber-soil contact'],
    treatmentOptions: [
      { product: 'Termidor (Fipronil)', type: 'Chemical Barrier', notes: 'Non-repellent — critical for skittish species. Full perimeter.', toxicity: 'Moderate' },
      { product: 'Altriset (Chlorantraniliprole)', type: 'Chemical Barrier', notes: 'Non-repellent, lowest toxicity. Ideal for sensitive situations.', toxicity: 'Very Low' }
    ],
    specialFlags: [
      { type: 'warning', icon: '⚠', text: 'DO NOT DISTURB — Schedorhinotermes intermedius will relocate if colony is disturbed. Use non-repellent treatments only. Avoid directly exposing galleries before treatment.' }
    ],
    fieldNotePrompts: [
      'Note presence of major vs minor soldiers — major soldiers = mature colony',
      'Document all plastering deposit locations — photograph each one',
      'Note damage pattern — gouging around nails/fixings is characteristic',
      'Advise client not to disturb affected areas prior to treatment',
      'Confirm non-repellent treatment only — repellent chemicals cause relocation'
    ]
  },

  'Nasutitermes walkeri': {
    commonName: 'Tree Termite',
    family: 'Termitidae',
    distribution: 'Eastern NSW and southeastern QLD. Found in mountains and coastal scrubland/wooded areas.',
    fieldID: [
      '🔑 POINTED SNOUT (NASUS): Nasutitermes soldiers have a distinctive pointed tube-like snout (nasus) on the front of the head instead of mandibles. They spray a sticky, amber-coloured defensive chemical from this snout when threatened — look for this if disturbed.',
      '👀 DARK MUD COVERING: Nasutitermes cover their workings and attacked timber with spacious, dark brown to black earthen material — distinctive dark mud galleries, often more open and roomy than Coptotermes workings. This dark colouring is a visual field ID marker.',
      '🌳 ARBOREAL NEST: Look for a brown papery-looking nest attached to a tree branch or trunk within 100m of the structure. Nasutitermes walkeri builds visible above-ground arboreal nests, typically in ironbark, stringybark, or tallowwood.',
    ],
    identification: [
      'Soldiers: rounded heads, long straight mandibles, yellowish-brown bodies, 5–7mm',
      'KEY ID: Pointed snout (nasus) on soldiers — sprays sticky defensive chemical instead of biting',
      'Arboreal nest visible on ironbark, stringybark, tallowwood trees',
      'Galleries extend down the trunk to maintain soil contact'
    ],
    nestTypes: [
      'Arboreal (tree) nests — attached to branches, commonly ironbark, stringybark, tallowwood',
      'Nest maintains soil contact via galleries running down tree trunk',
      'Kingfishers and lizards sometimes inhabit old nests'
    ],
    behaviour: [
      'Feeds on dead, decayed and weathered timber',
      'Can attack sound timber in buildings if given enough time undisturbed',
      'Nests are visible — easier to locate than subterranean species',
      'Covers attacked timber with characteristic dark brown to black earthen mud'
    ],
    conduciveConditions: ['Decayed timber', 'Weathered hardwood', 'Tree contact with structure'],
    treatmentOptions: [
      { product: 'Direct Nest Injection', type: 'Nest Treatment', notes: 'Locate arboreal nest in nearby trees. Inject nest and soil galleries with registered termiticide.', toxicity: 'Moderate' },
      { product: 'Termidor (Fipronil)', type: 'Chemical Barrier', notes: 'If nest cannot be located or eliminated, chemical barrier treatment around structure.', toxicity: 'Moderate' }
    ],
    specialFlags: [],
    fieldNotePrompts: [
      'Look for arboreal nest in nearby trees — check ironbark, stringybark, tallowwood within 100m',
      'Note whether nest has soil contact via trunk galleries',
      'Document the dark mud covering on attacked timber — photograph it',
      'Note whether the attack is on decayed or sound timber',
      'Check whether galleries run from tree trunk down to ground and into structure'
    ]
  },

  'Nasutitermes exitiosus': {
    commonName: 'Snouted Termite',
    family: 'Termitidae',
    distribution: 'Southern QLD to NSW and Victoria, ACT region. Common in Canberra. Builds low mounds in open ground near eucalypts.',
    fieldID: [
      '🔑 POINTED SNOUT (NASUS): Like all Nasutitermes — soldiers have a pointed tube-like snout that sprays defensive chemical. No mandibles. Amber sticky fluid sprayed when threatened.',
      '👀 DARK MUD COVERING: Attacked timber is covered in spacious, very dark (brown to black) earthen galleries — distinctive visual field marker for this genus.',
      '⛰️ MOUND NEST: N. exitiosus builds distinctive low dome-shaped mounds above ground — 30–75cm high, 30–120cm wide base. Check open ground near eucalypts within 60m of the structure. The mound is often the easiest way to confirm this species.',
    ],
    identification: [
      'Soldiers: dark, almost black head, pointed nasute snout, 4–6mm',
      'Workers: cream-coloured, soft-bodied, eyeless',
      'Alates: 8–10mm, darker brown, compound eyes, four pale wings — emerge after rain',
      'Mound nests: dome-shaped, 30–75cm high, 30–120cm wide basal diameter',
      'Queen size 25–30mm — visible when mound is opened at ground level'
    ],
    nestTypes: [
      'Dome-shaped mounds above ground (30–75cm high)',
      'In drier areas: underground or in tree stumps/stumps leaving bare earth',
      'Wall cavities and under floors in some cases',
      'Nests under properties often undetected until floor collapses'
    ],
    behaviour: [
      'Feeds primarily on hardwoods — prefers sapwood',
      'Workers travel up to 50–60m from the nest',
      'Pine timbers are resistant to attack by this species',
      'Mound nests in urban areas less common — easier to spot and treat',
      'Covers attacked timber with characteristic dark to black earthen material'
    ],
    conduciveConditions: ['Hardwood timber in ground contact', 'Decayed wood', 'Proximity to eucalypts'],
    treatmentOptions: [
      { product: 'Direct Mound Injection', type: 'Nest Treatment', notes: 'Locate and inject the mound directly with registered termiticide. Inject surrounding soil. Usually straightforward since nest is visible.', toxicity: 'Moderate' },
      { product: 'Termidor (Fipronil)', type: 'Chemical Barrier', notes: 'Full perimeter treatment if mound cannot be directly treated.', toxicity: 'Moderate' }
    ],
    specialFlags: [],
    fieldNotePrompts: [
      'Look for dome-shaped mound nest in open ground near eucalypts within 60m',
      'Note mound dimensions, condition, and whether it appears active',
      'Document dark mud covering on attacked timber — photograph it',
      'Check under floors if no mound found above ground — can nest below floor level',
      'Note timber type attacked — hardwood sapwood is preferred; pine timbers are resistant'
    ]
  },

  'Mastotermes darwiniensis': {
    commonName: 'Giant Northern Termite / Darwin Termite',
    family: 'Mastotermitidae',
    distribution: 'Northern Australia only — confined north of Tropic of Capricorn (tropical NT, far north QLD, northern WA). NOT found in southern states.',
    identification: [
      'Largest Australian termite species: 11–13mm body length',
      'Rounded yellow to reddish-brown head, short black mandibles',
      'Soldiers: long rectangular heads',
      'Most primitive living termite — shows similarities to cockroaches',
      'Lays eggs in bunches (like cockroaches) rather than singly',
      'Wings similar in design to cockroach wings'
    ],
    nestTypes: [
      'Subterranean nests — inconspicuous, NOT mound-building',
      'May also nest in trees or on top of posts',
      'Small ground mounds in some situations'
    ],
    behaviour: [
      'Eats almost anything organic: timber, leather, plastic, bagged salt, flour, damaged ivory, vegetation',
      'Can ringbark living trees by boring up into the trunk',
      'Agricultural pest of major significance — vegetable farming abandoned in parts of northern Australia',
      'Given irrigation and favourable conditions, colonies can reach millions rapidly',
      'Attacks building timbers and contents as well as living trees'
    ],
    conduciveConditions: ['Irrigation', 'Stored timber', 'Any organic material', 'Warm tropical conditions'],
    treatmentOptions: [
      { product: 'Specialist Treatment Required', type: 'Specialist', notes: 'Consult a specialist experienced with M. darwiniensis. Check each product label: not every bait or termiticide is registered for this species.', toxicity: 'Varies' }
    ],
    specialFlags: [
      { type: 'danger', icon: '🚨', text: 'SPECIALIST TREATMENT — Treatment for Mastotermes darwiniensis should be planned by a specialist experienced with this species. Check each product label, as not every bait or termiticide is registered for it. Refer any timber damage to a builder or engineer.' },
      { type: 'info', icon: 'ℹ', text: 'LOCATION CHECK — M. darwiniensis is confined to northern Australia (north of Tropic of Capricorn). If found in southern states, confirm identification — possible misidentification or transported specimen.' }
    ],
    fieldNotePrompts: [
      'Confirm property location is north of Tropic of Capricorn — species distribution limited',
      'Document all materials affected — M. darwiniensis attacks a wide range of organic materials, not just timber',
      'Assess colony size — colonies under favourable conditions can be enormous',
      'Refer treatment to a specialist experienced with M. darwiniensis'
    ]
  },

  'Cryptotermes brevis': {
    commonName: 'West Indian Drywood Termite',
    family: 'Kalotermitidae',
    distribution: "Invasive species — found in QLD (particularly around Maryborough/Brisbane). Listed under Australia's Biosecurity Act 2015. Regularly intercepted at Australian border.",
    identification: [
      'Soldiers: 4–6mm, cigar-shaped white body, head is sloping and rough (phragmotic)',
      'Mandibles: very short and broad — distinctive',
      'No fontanelle present on head',
      'KEY ID: Does NOT require soil contact — lives entirely within dry timber',
      'Frass (faecal pellets) found near infested timber — key sign of drywood termite'
    ],
    nestTypes: [
      'Lives entirely within dry timber — no soil contact required',
      'Can infest construction timber, furniture, picture frames, wooden vessels',
      'Multiple colonies can exist independently in same building',
      'Can survive and be transported in furniture and goods'
    ],
    behaviour: [
      'Does not need free water or soil contact — unique among major pest species',
      'Forms colonies, feeds and reproduces within a single piece of wood',
      'Cannot be detected by standard moisture meter methods',
      'Frass (pellets) ejected from small holes in timber surface',
      'Infested items can transport the species — a biosecurity risk'
    ],
    conduciveConditions: ['Imported timber', 'Second-hand furniture', 'Any dry timber'],
    treatmentOptions: [
      { product: 'Whole-Building Fumigation', type: 'Fumigation', notes: 'Wrapping entire building in plastic and fumigating with sulfuryl fluoride. Required when multiple colonies present throughout the structure. Expensive and disruptive but thorough.', toxicity: 'High (during application)' },
      { product: 'Localised Treatment', type: 'Spot Treatment', notes: 'Injection of insecticide into gallery entry holes in affected timber. Suitable for single or limited infestations. Requires thorough survey to confirm scope.', toxicity: 'Moderate' },
      { product: 'Heat Treatment', type: 'Physical', notes: 'Heating structure or items to specific temperature to kill termites. Energy-intensive, requires specialised equipment.', toxicity: 'None' }
    ],
    specialFlags: [
      { type: 'danger', icon: '🚨', text: 'NOTIFIABLE PEST — Cryptotermes brevis is a regulated pest under the Australian Biosecurity Act 2015 and is a National Priority Plant Pest (NPPP). This finding must be reported to the relevant state biosecurity authority. Do not remove any infested timber or furniture from the property until directed by the authority.' },
      { type: 'warning', icon: '⚠', text: 'BIOSECURITY RISK — Infested furniture, timber or materials must not be moved from the property. Transportation of infested goods is how this species spreads. Advise client immediately.' }
    ],
    fieldNotePrompts: [
      'Document all infested items — timber members, furniture, frames, picture frames',
      'Look for frass (small pellets) ejected from holes in timber surface — key diagnostic sign',
      'Survey entire building — multiple independent colonies likely',
      'NOTIFY appropriate state biosecurity authority — required by law',
      'Advise client: do not remove any items from property until authorities confirm'
    ]
  },

  'Porotermes adamsoni': {
    commonName: 'Common Dampwood Termite',
    family: 'Termopsidae',
    distribution: 'Southern coastal Australia — southern QLD to SA including ACT and Tasmania.',
    identification: [
      'Large species: workers and soldiers 10–15mm — noticeably larger than subterranean termites',
      'Pale-brown to reddish head, soft body typical of dampwood species',
      'Requires moist, decaying timber — key habitat indicator'
    ],
    nestTypes: [
      'Moist, decaying timber — trees, logs, garden structures',
      'Occasionally structural timber with persistent moisture issues'
    ],
    behaviour: [
      'Requires high moisture — not a threat to dry, well-maintained timber',
      'Associated with decayed and damp timber in houses',
      'Less mobile than subterranean species'
    ],
    conduciveConditions: ['Persistent leaks', 'Decayed timber', 'Poor ventilation', 'High subfloor moisture'],
    treatmentOptions: [
      { product: 'Structural Remediation', type: 'Physical', notes: 'PRIMARY TREATMENT — remove or replace affected decayed timber, eliminate moisture source. Termiticides are NOT registered for P. adamsoni control.', toxicity: 'None' },
      { product: 'Moisture Source Elimination', type: 'Environmental', notes: 'Address all moisture sources — plumbing leaks, drainage, ventilation. Without moisture, the species cannot sustain a colony in the structure.', toxicity: 'None' }
    ],
    specialFlags: [
      { type: 'warning', icon: '⚠', text: 'TREATMENT LIMITATION — Modern termiticides are NOT registered for the control of Porotermes adamsoni. Treatment is primarily structural: remove affected timber, eliminate all moisture sources, and improve ventilation. Termiticide application is not the appropriate response for this species.' }
    ],
    fieldNotePrompts: [
      'Identify and document all moisture sources — plumbing leaks, drainage issues, ventilation problems',
      'Note extent of timber decay — document which structural members are affected',
      'Advise plumber/builder assessment to eliminate moisture source as primary remediation',
      'Standard chemical barrier treatment is NOT appropriate — advise client accordingly'
    ]
  },

  'Heterotermes': {
    commonName: 'Subterranean Termite',
    family: 'Rhinotermitidae',
    distribution: 'Found across mainland Australia. More significant pest in northern Australia.',
    identification: [
      'Soldiers: similar appearance to Coptotermes but HEAD IS LONGER AND MORE RECTANGULAR',
      'Coptotermes soldiers have a teardrop-shaped head — key differentiation',
      'Often confused with Coptotermes in the field'
    ],
    nestTypes: ['Subterranean', 'Tree stumps', 'Decayed wood in soil'],
    behaviour: [
      'Forages underground like Coptotermes',
      'Less aggressive than Coptotermes in most regions',
      'Significant concern in northern Australia'
    ],
    conduciveConditions: ['Timber-soil contact', 'Moisture', 'Decayed wood'],
    treatmentOptions: [
      { product: 'Termidor (Fipronil)', type: 'Chemical Barrier', notes: 'Standard non-repellent chemical barrier treatment.', toxicity: 'Moderate' },
      { product: 'Altriset (Chlorantraniliprole)', type: 'Chemical Barrier', notes: 'Low toxicity alternative.', toxicity: 'Very Low' }
    ],
    specialFlags: [
      { type: 'info', icon: 'ℹ', text: 'IDENTIFICATION NOTE — Heterotermes soldiers are often confused with Coptotermes. Key difference: Heterotermes soldiers have a longer, more rectangular head vs the teardrop shape of Coptotermes. Confirm identification before finalising treatment recommendation.' }
    ],
    fieldNotePrompts: [
      'Confirm species identification — distinguish from Coptotermes by soldier head shape',
      'Document location and extent of activity'
    ]
  },

  'Microcerotermes': {
    commonName: 'Termite',
    family: 'Termitidae',
    distribution: 'Most of mainland Australia. Species distribution varies: M. turneri (east coast QLD to Port Macquarie NSW), M. distinctus (inland NSW/VIC), M. serratus (QLD, WA, NT, SA).',
    fieldID: [
      '👀 NEST TYPE: Look for a visible mound or arboreal nest. Microcerotermes may build low on-ground mounds, underground nests, or small arboreal mounds with distinctive stalactite-like projections — sometimes found on fence posts or halfway up tree trunks.',
      '🔑 SOLDIER HEAD: Rectangular head profile on soldiers — broader and more box-shaped than the rounded or teardrop heads of Coptotermes/Schedorhinotermes. No milky fluid (unlike Coptotermes) and no pointed snout (unlike Nasutitermes).',
      '🪵 TIMBER ATTACKED: Predominantly hardwood — check hardwood fences, posts, and structural timbers. Less likely to attack softwood (pine).',
    ],
    identification: [
      'Soldiers: rectangular head',
      'Various nesting habits — on-ground mounds, underground, or arboreal mounds with stalactite-like formations',
      'Arboreal mounds sometimes found on fence posts or halfway up tree trunks'
    ],
    nestTypes: [
      'Some species build on-ground mounds',
      'Others nest underground',
      'Others build distinctive arboreal mounds with stalactites'
    ],
    behaviour: ['Damages hardwood timber', 'Less aggressive than major pest species'],
    conduciveConditions: ['Timber-soil contact', 'Decayed wood', 'Hardwood structures'],
    treatmentOptions: [
      { product: 'Termidor (Fipronil)', type: 'Chemical Barrier', notes: 'Standard chemical barrier treatment.', toxicity: 'Moderate' },
      { product: 'Direct Nest Treatment', type: 'Nest Treatment', notes: 'If mound/nest is visible and accessible, direct injection is effective.', toxicity: 'Moderate' }
    ],
    specialFlags: [],
    fieldNotePrompts: [
      'Note nesting type — on-ground mound, underground, or arboreal with stalactites',
      'Check fence posts and hardwood timber structures in yard',
      'Document affected timber type and extent'
    ]
  }
};

// Fuzzy matching keys — maps common shorthand and variations to full species entries
const SPECIES_ALIASES = {
  'coptotermes': 'Coptotermes acinaciformis',
  'coptotermes acinaciformis': 'Coptotermes acinaciformis',
  'c. acinaciformis': 'Coptotermes acinaciformis',
  'acinaciformis': 'Coptotermes acinaciformis',
  'coptotermes frenchi': 'Coptotermes frenchi',
  'c. frenchi': 'Coptotermes frenchi',
  'frenchi': 'Coptotermes frenchi',
  'schedorhinotermes': 'Schedorhinotermes',
  'schedorhinotermes intermedius': 'Schedorhinotermes intermedius',
  'schedorhinotermes spp': 'Schedorhinotermes',
  'schedorhinotermes spp.': 'Schedorhinotermes',
  's. intermedius': 'Schedorhinotermes intermedius',
  'nasutitermes walkeri': 'Nasutitermes walkeri',
  'n. walkeri': 'Nasutitermes walkeri',
  'walkeri': 'Nasutitermes walkeri',
  'nasutitermes exitiosus': 'Nasutitermes exitiosus',
  'n. exitiosus': 'Nasutitermes exitiosus',
  'exitiosus': 'Nasutitermes exitiosus',
  'nasutitermes': 'Nasutitermes exitiosus',
  'nasutitermes spp': 'Nasutitermes exitiosus',
  'nasutitermes spp.': 'Nasutitermes exitiosus',
  'mastotermes': 'Mastotermes darwiniensis',
  'mastotermes darwiniensis': 'Mastotermes darwiniensis',
  'giant northern termite': 'Mastotermes darwiniensis',
  'darwin termite': 'Mastotermes darwiniensis',
  'cryptotermes': 'Cryptotermes brevis',
  'cryptotermes brevis': 'Cryptotermes brevis',
  'west indian drywood': 'Cryptotermes brevis',
  'drywood termite': 'Cryptotermes brevis',
  'porotermes': 'Porotermes adamsoni',
  'porotermes adamsoni': 'Porotermes adamsoni',
  'dampwood termite': 'Porotermes adamsoni',
  'heterotermes': 'Heterotermes',
  'heterotermes spp': 'Heterotermes',
  'microcerotermes': 'Microcerotermes',
  'microcerotermes spp': 'Microcerotermes',
  'microcerotermes spp.': 'Microcerotermes',
};

function lookupSpecies(raw) {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/\.$/, '');
  const words = key.split(/\s+/);
  const canonical = SPECIES_ALIASES[key] || SPECIES_ALIASES[words.slice(0,2).join(' ')];
  if (canonical && SPECIES_DB[canonical]) return { name: canonical, data: SPECIES_DB[canonical] };
  // A species the guide doesn't cover gets its genus card when the guide has
  // one, and otherwise nothing. Never another species' card: Cryptotermes
  // primus is native, and must not get C. brevis's notifiable-pest warning.
  const genus = Object.keys(SPECIES_DB).find(n => !n.includes(' ') && n.toLowerCase() === words[0]);
  return genus ? { name: genus, data: SPECIES_DB[genus] } : null;
}

const SECTIONS = {
  property:        { fields:['structureType','height','occupancyStatus','furnishing','peoplePresent','weatherConditions','temperature','humidity','rainLast24h','recentWeather','wallConstruction','roofType','floorType','facadeDirection','constructionEra','siteSurroundings','siteSlope','termiteHistory','existingSystem','standard','toolsUsed'], total:20 },
  obstructions:    { fields:['areaStatus'], total:1 },
  restrictions:    { fields:['hinderedAreas','hinderedAreasDetail','noAccessAreas','highRiskAreas','invasiveInspection','invasiveInspectionDetails'], total:2 },
  findings:        { fields:['findings','borerActivity','decayFound','delignification','previousTreatment','previousTreatmentDetails'], total:4 },
  conducive:       { fields:['waterLeaks','moistureReadings','leakLocation','siteDrainage','subfloorDrainage','subfloorVentilation','mouldSeen','mouldWhere','timberSoil','slabEdge','weepHoles','antCapping','antCappingDetails','nonDurableTimber','nonDurableTimberDetails'], total:6 },
  recommendations: { fields:['riskLevel','treatmentRecommended','treatmentType','inspectionFrequency','otherRecommendations'], total:4 },
  photos:          { fields:['photos'], total:1 },
  signoff:         { fields:['inspectorLicence','inspectorSignature','agreement'], total:3 }
};
// The fields a finished report needs. Progress (the ring, the section badges
// and the saved list's Ready status) counts only these, so a complete job can
// reach 100%: height, facade, high-risk areas, follow-on details (leak
// location, treatment type, restriction detail) and photos are optional.
// 'standard' is set from the inspection type, so it isn't counted either.
const REQUIRED_FIELDS = {
  property:        ['structureType','occupancyStatus','weatherConditions','wallConstruction','roofType','floorType','constructionEra','existingSystem'],
  obstructions:    ['areaStatus'],
  restrictions:    ['hinderedAreas'],
  findings:        ['findings','borerActivity','decayFound','delignification'],
  conducive:       ['waterLeaks','moistureReadings','timberSoil','slabEdge','weepHoles'],
  recommendations: ['riskLevel','treatmentRecommended','inspectionFrequency'],
  photos:          [],
  signoff:         ['inspectorLicence','inspectorSignature','agreement'],
};
const REQUIRED_KEYS = new Set(Object.values(REQUIRED_FIELDS).flat());

const SYSTEM_PROMPT = `You extract report fields for SAYON, an app that Australian timber pest inspectors dictate into. The user message is ONE dictated note from a timber pest inspection (AS 4349.3 / AS 3660.2). An inspector usually records several notes on one job, one per area, and the app merges them: so extract ONLY what THIS note states, and leave every other field null. A field left null stays as it was; a wrong value replaces a right one. Return ONLY a valid JSON object, no markdown and no commentary.

THE ONE RULE: a field holds only what the inspector said or plainly meant. Never guess, infer from typical houses, or complete a pattern. When a value is not in the note, it is null. When the note is ambiguous, prefer null over a guess for YES/NO and dropdown fields, and keep the inspector's own words for text fields.

FIELDS (every one null unless the note gives it):
{"propertyStreetAddress":string,"propertySuburb":string,"propertyState":"NSW"|"VIC"|"QLD"|"WA"|"SA"|"TAS"|"ACT"|"NT","propertyPostcode":string,"clientName":string,"clientPhone":string,"clientEmail":string,"inspectionFee":string,"accessNotes":string,"inspectionType":"Annual — Existing Building"|"Pre-Purchase — Timber Pest"|"Pre-Purchase — Combined Building & Pest"|"New Construction — Completion"|"Treatment Follow-Up"|"Re-inspection"|"Insurance / Legal",
"structureType":string,"height":string,"wallConstruction":string,"roofType":string,"floorType":string,"facadeDirection":string,"constructionEra":"Pre-1920s"|"1920s-1940s"|"1945-1965"|"1965-1985"|"1985-2003"|"Post-2003","occupancyStatus":string,"furnishing":string,"peoplePresent":string,"weatherConditions":string,"temperature":string,"humidity":string,"rainLast24h":string,"recentWeather":string,"toolsUsed":string,"siteSurroundings":string,"siteSlope":string,"termiteHistory":string,
"existingSystem":string,"existingSystemOther":string,"durableNoticePresent":"YES"|"NO","hardLandscaping":"YES"|"NO","zone25mmVisible":"YES"|"NO","softLandscaping":"YES"|"NO","zone75mmVisible":"YES"|"NO","antCapSoldered":"YES"|"NO"|"N/A",
"areaStatus":{"interior"|"exterior"|"subfloor"|"roofvoid"|"outbuildings"|"site"|"fences"|"retainingwalls"|"landscapingtimbers":"INSPECTED"|"PARTIAL"|"NOT"|"NA"},"areaResult":{same area keys:"CLEAR"|"FOUND"},"obstructions":string,"restrictedAccess":string,"noAccessAreas":string,"highRiskAreas":string,"hinderedAreas":string,"hinderedAreasDetail":string,
"findings":[{"termiteActivity":"ACTIVE"|"INACTIVE"|"NONE","species":string,"damageDescription":string,"activityLocation":string,"timberAffected":string,"nestLocated":"YES"|"NO","structuralConcern":"YES"|"NO"}],
"borerActivity":"ACTIVE"|"INACTIVE"|"NONE","borerFindings":[{"borerActivity":"ACTIVE"|"INACTIVE","borerType":string,"location":string,"timberAffected":string,"description":string,"structuralConcern":"YES"|"NO"}],"decayFound":"YES"|"NO","decayDetails":string,"decayWhere":string,"delignification":"YES"|"NO","delignificationDetails":string,"delignificationWhere":string,"previousTreatment":"YES"|"NO","previousTreatmentDetails":string,"previousTreatmentWhere":string,
"moistureReadings":"YES"|"NO","waterLeaks":"YES"|"NO","mouldSeen":"YES"|"NO","mouldWhere":string,"leakLocation":string,"moistureMeterReadings":[{"location":string,"reading":string}],"timberSoil":"YES"|"NO","slabEdge":"CLEAR"|"OBSTRUCTED","weepHoles":"CLEAR"|"BRIDGED"|"NONE","siteDrainage":"ADEQUATE"|"POOR","subfloorDrainage":"ADEQUATE"|"POOR","antCapping":"INTACT"|"GAPS"|"NONE","antCappingDetails":string,"subfloorVentilation":"ADEQUATE"|"POOR","nonDurableTimber":"YES"|"NO","nonDurableTimberDetails":string,"nonDurableTimberWhere":string,
"riskLevel":"LOW"|"MEDIUM"|"HIGH","treatmentRecommended":"YES"|"NO","treatmentType":string,"inspectionFrequency":string,"invasiveInspection":"YES"|"NO","invasiveInspectionDetails":string,"otherRecommendations":string,
"quote":{"items":[{"description":string,"qty":number,"unit":string,"price":number}],"exclusions":[string],"paymentTerms":string,"timeframe":string,"servicePeriod":string,"notes":string}}

DROPDOWN FIELDS: the app shows these as pick-lists. Return the list value EXACTLY as written below when the inspector's words fit one; when they describe something the list cannot express, return their words instead (never a list value that adds a fact they did not state).
- structureType: "Detached house" | "Semi-detached" | "Terrace / townhouse" | "Duplex" | "Unit / apartment" | "Granny flat" | "Commercial building". "House" or "home" with nothing more is "Detached house".
- height: "Single storey" | "Double storey" | "Split level" | "Multiple storey" (three or more storeys).
- wallConstruction: "Brick veneer" | "Double brick" | "Weatherboard" | "Fibro / cement sheet" | "Rendered masonry" | "Lightweight cladding" | "Mixed construction". Brick veneer and double brick are different builds: the phrase "double brick veneer" is a slip, so use whichever the inspector restates or settles on later, and never combine the two.
- floorType: "Concrete slab on ground" | "Timber suspended floor" | "Elevated timber (stumps)" | "Combination slab / timber". "Not a slab" plus joists, bearers or a subfloor means "Timber suspended floor"; stumps means "Elevated timber (stumps)".
- roofType: "Colorbond metal" | "Tiled — concrete" | "Tiled — terracotta" | "Corrugated iron" | "Flat membrane" | "Mixed". A tiled roof whose tile material is not named is written as the inspector said it, e.g. "Tiled roof, timber framed": never pick concrete or terracotta for them. Roof framing (timber or steel) has no field of its own, so it may be appended here.
- facadeDirection: "North" | "North-east" | "East" | "South-east" | "South" | "South-west" | "West" | "North-west" (the direction the front of the building faces).
- occupancyStatus: "Occupied — residential" | "Owner occupied" | "Tenanted" | "Vacant" | "Under renovation" | "Commercial / industrial". "Occupied" alone is "Occupied — residential". Furniture is furnishing, not occupancy: "furnished" alone sets furnishing and leaves occupancyStatus null.
- furnishing: "Fully furnished" | "Partly furnished" | "Unfurnished". "Empty", "no furniture" or "nothing in it" is "Unfurnished"; "a few things left", "half moved out" is "Partly furnished".
- peoplePresent: who was at the property during the inspection, only when the inspector says so: "Client" | "Client and agent" | "Real estate agent" | "Vendor" | "Purchaser" | "Tenant" | "No one". Any other mix is written as a short list in their words, e.g. "Vendor and purchaser".
- weatherConditions: "Fine and dry" | "Overcast" | "Light rain" | "Heavy rain" | "Humid" | "Windy".
- recentWeather: the weather over the past weeks, only when the inspector describes it: "Normal for the season" | "Prolonged dry period" | "Prolonged wet period". "Hasn't rained in weeks" is "Prolonged dry period"; "rained all week" or "a wet month" is "Prolonged wet period".
- toolsUsed: the tools the inspector says they used, as a short list in this order: moisture meter, sounding tool, thermal camera, movement detector, e.g. "Moisture meter and sounding tool" or "Moisture meter, sounding tool and thermal camera". A Termatrac is a movement detector; "tapped the timbers" or "sounded" means a sounding tool. Add anything else they name in their words ("torch, ladder"). Never list a tool they did not name.
- siteSurroundings: what is around the property, only when the inspector describes it: "Suburban, few trees" | "Trees close to the building" | "Next to bushland or a reserve" | "Rural". A big gum, trees overhanging the house, or any tree they place within about 10 metres of the house ("a gum tree in the back yard about 8 metres from the house") is "Trees close to the building"; a creek, park or bush behind is "Next to bushland or a reserve". Anything else in their words.
- siteSlope: "Flat" | "Slopes away from the building" | "Slopes towards the building" | "Steep". Only when the inspector says how the ground falls. "Away" and "towards" need the inspector to say it relative to the house; when they only say which way the block falls ("the block slopes gently down to the back"), keep their words ("Gentle slope down to the back") and never decide towards or away from that.
- termiteHistory: what the inspector was told or found about termites here before, only when it comes up: "None known" | "Termites reported before" | "Treated before" | "Unknown". "The owner said they had termites a few years ago" is "Termites reported before"; "had it treated in 2019" is "Treated before". Add the detail in their words when they give one, e.g. "Treated before (2019, Termidor)". Signs of a past treatment seen at the inspection are previousTreatment, not this.
- temperature, humidity, rainLast24h: only a reading the inspector states, written as "22°C", "70%" and "5 mm" (rainLast24h "None" when they say there was no rain). Never estimate one from the weather description.
- constructionEra: only from a stated age, decade or year ("built in the 70s" is "1965-1985", "around 1998" is "1985-2003", "2005" is "Post-2003") or from an era-specific material the inspector names (fibro sheeting, asbestos). Never date a house from its wall, floor or roof type: the era prints an asbestos warning in the report, so a guessed era is a false fact.
- existingSystem (the TYPE of termite management system found): "Physical Barrier" | "Chemical Reticulation System" | "Termite Baiting System" | "Chemical Barrier" | "Combination System — Physical + Chemical" | "System Present — Type Unidentified". A chemical soil treatment or chemical barrier with no reticulation pipes mentioned (e.g. Termidor sprayed around the perimeter) is "Chemical Barrier". When the inspector says there is no system, no barrier or nothing installed, return "No System Found" (never "No", "None", "Nil"); when they don't say either way, null.
- existingSystemOther: the brand, product or chemical the system is recorded as (HomeGuard Blue, Kordon, Termimesh, Exterra, Sentricon, Termidor, Altriset ...), plus the install year if read from the notice. Only when the inspector names it.
- inspectionType: "Annual — Existing Building" for an annual, routine, regular or yearly inspection of the client's own home; "Pre-Purchase — Timber Pest" for pre-purchase, pre-sale or a client buying the property ("pre-purchased" is the same); "Pre-Purchase — Combined Building & Pest" only when they say building and pest; "Treatment Follow-Up", "Re-inspection", "New Construction — Completion" and "Insurance / Legal" only when said in those words. Otherwise null.
- inspectionFrequency: write the NEXT interval first as a number of months, then any later pattern, e.g. "3 months, then every 12 months" or "12 months". Never put a later interval before the first one. It is only the routine re-inspection interval: a one-off invasive or follow-up inspection ("invasive inspection in two weeks") never goes here.
- invasiveInspection: "YES" when the inspector recommends an invasive timber pest inspection, one where walls, linings or timbers may be cut, drilled or removed to see inside; "NO" only when they say one isn't needed. invasiveInspectionDetails: where, why and when, in their words, e.g. "Bathroom skirting boards and door frame, to trace live activity and the moisture source, within 2 weeks".
- otherRecommendations: every other piece of advice the inspector gives that is not the treatment, the invasive inspection or the re-inspection interval, in their words, joined with "; ". E.g. "Have a plumber fix the bathroom vanity leak; remove the garden beds from against the east wall; improve subfloor ventilation". Null when there is none.

AREAS INSPECTED (areaStatus): one key per area the note actually covers; leave out areas the note does not mention, including when a later note may cover them.
- Keys: interior (inside the house), exterior (outside walls and perimeter), subfloor (under the floor), roofvoid (roof void, roof space, ceiling cavity, manhole), outbuildings (sheds and garages, whether attached or not), site (yard, grounds, gardens), fences, retainingwalls, landscapingtimbers (sleepers, garden edging timbers).
- "INSPECTED": inspected with no limit stated. An area the inspector walked and described with no limitation (the perimeter, the yard, a fence line) counts as INSPECTED even without the word "inspected". "PARTIAL": inspected, but something kept part of it from view or reach (stored items, furniture, insulation, low clearance, a section not entered). One locked or unentered room makes the whole interior PARTIAL, however much of the rest was inspected. A limit said straight after "inspected" still counts: "roof void inspected, insulation over the ceiling joists" is roof void PARTIAL, with the insulation in obstructions, hinderedAreas and restrictedAccess ("Roof void: Insulation or sarking"). "NOT": not inspected at all (no access, locked, unsafe, hatch too small). "NA": the area does not exist at this property ("slab on ground" means subfloor is NA; "no roof void" or a skillion roof means roofvoid is NA; "no sheds" means outbuildings is NA).
- An area named only in a recommendation, a conducive condition or a finding ("pull the soil back from the garage", "soil against the fence") gets no status unless the inspector says they looked at it.
- "Everything was accessible" or "full access everywhere" sets every area mentioned in the note to INSPECTED; it never adds areas the note does not mention.
- A later note re-covering an area ("got into the back of the subfloor now, all clear") simply states that area's new status.
- areaResult: what was found in each area the note covers, same keys. "FOUND" when the note records termites or termite evidence (live termites, workings, mud, galleries or damage: what makes a findings entry), borers, wood decay or chemical delignification in that area: workings in a fence post is fences FOUND, a skirting board in a bedroom is interior FOUND, a bearer under the house is subfloor FOUND, a tree in the yard is site FOUND, a sleeper is landscapingtimbers FOUND. "CLEAR" only when the inspector says that area had nothing ("fences all good, no activity", "roof void clear", "no termites or borers in the subfloor"), or says the whole property was clear, which makes every area the note covers CLEAR. A clear remark about one room or part ("no activity in the bathroom") is not the whole area: leave that area out unless they say the rest was clear too. Walking an area without saying what was found gives no areaResult. Moisture, leaks and other conducive conditions are not timber pest evidence. A suspicion with nothing seen (see "Suspected only" below) is not FOUND either.

HINDERED AND RESTRICTED ACCESS: five fields, each with one meaning. The report sorts every access limit into two kinds. HINDERED access is a temporary obstruction at the time of the inspection: furniture, stored goods, floor coverings, insulation, vegetation, a manhole blocked by stored items, or low clearance in the subfloor or roof void. RESTRICTED access is a permanent restriction or locked entry: a locked room, a subfloor with no access hatch, a manhole sealed or screwed shut, a roof with no void, a part beyond safe height, or a yard the inspector could not safely enter because of a dog or other animal.
- obstructions: which areas were not fully inspected and roughly where, e.g. "Subfloor: back section behind stored items. Roof void: outer edges and corners". Only PARTIAL or NOT areas appear here. Null when nothing was in the way.
- restrictedAccess: WHY, as "Area: reason" pairs separated by ". ", using the app's reason labels where one fits, because the app ticks them from these exact words:
  Interior: Stored items | Furniture or fittings | Floor or wall coverings | Restricted access
  Exterior: Stored items | Vegetation | Services or equipment | Restricted access
  Subfloor: Stored items | Low clearance | Services or equipment | Insulation | Restricted access
  Roof void: Stored items | Low clearance | Insulation or sarking | Services or equipment | Restricted access | No roof void
  Outbuildings: Stored items | Restricted access.  Site / Fences: Stored items | Vegetation | Restricted access.  Retaining walls / Landscaping timbers: Stored items | Vegetation | Soil or abutting structures | Restricted access
  These are kinds of obstruction; the specifics (which room, what exactly) go in noAccessAreas and hinderedAreas. Boxes, goods, belongings or a manhole blocked by stored items are "Stored items". Ducting, plumbing, air conditioning units, hot water systems and water tanks are "Services or equipment". Every permanent restriction or locked entry is "Restricted access": a locked room or shed, a manhole sealed or screwed shut, a subfloor with no hatch, a part beyond safe height, or a yard the inspector could not safely enter (a dog, bees, a hazard). Use "Restricted access" for the subfloor ONLY when it was not entered at all; a subfloor the inspector was in but could not fully reach gets "Stored items" or "Low clearance", never "Restricted access". When no label fits, write the reason in a few plain words after the area name. Whenever obstructions, hinderedAreas or noAccessAreas names an area, restrictedAccess gives that area's reason too, even when the reason is already in those fields: the app ticks the boxes from restrictedAccess. So when any area in areaStatus is PARTIAL or NOT, restrictedAccess is never null: it has one "Area: reason" pair for each of those areas. Null only when nothing was in the way.
- noAccessAreas: RESTRICTED access: every room, area or space the inspector could not inspect because of a permanent restriction or locked entry, where and why, in their words, e.g. "Front left bedroom, north-east side: locked. Subfloor: no access hatch". Null when the note names no such place. A place that was blocked only by something movable (a manhole blocked by stored boxes) is hinderedAreas, not this.
- hinderedAreas: HINDERED access: the areas or parts the inspector could not fully inspect because of temporary obstructions or low clearance, whether they got in or not. Name only the limited areas and parts ("Roof void: outer edges and corners, low clearance. Subfloor: back section behind stored items. Bedrooms: walls behind furniture"). It is NOT a list of what was inspected, and it never names an area that was fully inspected. Null when the note states nothing was in the way, and also null when the note simply does not raise the subject.
- hinderedAreasDetail: what hindered access in hinderedAreas ("low clearance; stored items; furniture against walls"). Null when hinderedAreas is null.
- highRiskAreas: places the inspector could NOT inspect and would want checked once access exists ("back section of the subfloor behind the stored items", "roof void outer edges"). Every place in noAccessAreas belongs here too. An unreached area stays here even when evidence was seen at its edge. It is never a place where activity WAS found and inspected (that is a finding), never a clear area, and never an area the note does not mention.
- A garden bed, soil, paving or mulch that covers or bridges the slab edge or weep holes while the inspector still walked and saw that stretch of the exterior is NOT an obstruction: that area stays fully inspected, and the cover goes in slabEdge, weepHoles, softLandscaping/hardLandscaping and zone75mmVisible/zone25mmVisible instead. Use obstructions/hinderedAreas/highRiskAreas there only when it actually stopped the inspector from reaching or seeing that part.

TERMITE FINDINGS (findings is always an array; it holds termites only):
- One entry per distinct place where live termites or termite evidence was found. A new entry when the location, the status or the species changes ("and over near the...", "separately", "also"). Never merge two places into one entry, and never put a finding's details in another finding.
- termiteActivity: "ACTIVE" only when live termites were seen ("live termites", "active termites", "workers moving", "live ones in the tree"). "INACTIVE" when workings, mud leads, mudding, damage, galleries or exit holes were found but no live termites ("old workings", "nothing alive", "past activity", "doesn't seem active now"). When species, damage or a location is described without a clear live sighting, it is INACTIVE, never ACTIVE. "NONE": use ONLY when the note states that the whole property was clear of termites and evidence and reports nothing anywhere; then species, damageDescription, activityLocation, nestLocated and structuralConcern are all null. A clear remark about one area ("no termite activity in the roof void", "nothing in the subfloor") never creates a NONE entry: when the note has real findings elsewhere, record only those, and when it has no findings and is about one area, return an empty array.
- Suspected only: a finding is ACTIVE or INACTIVE, never "suspected". When the inspector only suspects termites somewhere and saw no live termites, workings, mud, galleries or damage there (timber hollow when tapped or damp with nothing else, "could be activity in the wall but I'm not sure"), it is not a findings entry: record it where it belongs instead, invasiveInspection "YES" with invasiveInspectionDetails saying where and why when they want it opened up or checked further, highRiskAreas when they name a spot that needs access, and moisture or leaks in their own fields. When they did see workings, mud, galleries or damage there, it is INACTIVE (or ACTIVE with live termites), with their hedge kept in damageDescription.
- activityLocation: where, in the inspector's terms: the element and the room or side ("skirting board, bedroom three, downstairs"; "rear bearer and joist above it, under the back room"; "gum tree in the backyard, about 15 m from the house"). Distances from the house and "not touching any building" belong here.
- timberAffected: the timber members the evidence is in or on, named plainly and joined with ", " ("Bearer, Joist", "Skirting", "Door frame", "Roof timbers"). Use these names where they fit: Bearer, Joist, Floorboards, Stud, Top plate, Bottom plate, Skirting, Architrave, Door frame, Window frame, Roof timbers, Deck, Fence, Tree or stump. Null when the note names no timber (mud leads up a brick pier only, or a slab edge).
- damageDescription: only what was seen (mud packing, hollow when tapped, galleries, timbers eaten out, frass, exit holes, bubbling paint), the element and the place, and the inspector's own hedges ("possible nest in the tree", "possibly past activity"). "No damage visible" is a fact: keep it. NEVER a severity or extent word (minor, moderate, severe, extensive, significant, extreme, major, heavy, bad): drop the word and keep the observation, even when the inspector says it. Never an activity grade ("high activity"). Never the inspector's opinion on whether the structure is or is not compromised, sound, safe or affected: drop it in every wording. Never a risk statement.
- species: ONLY a genus or species the inspector names, formatted as "Coptotermes acinaciformis", "Nasutitermes exitiosus", or at genus level "Coptotermes spp." when they name a genus without the species or are unsure of the species ("looks like Coptotermes"). When they say they could not identify it (dictation turns "couldn't be identified" into "can be identified"; read the sense), use exactly "Species not identified — further investigation required", on the finding it was said about. When species is never raised, null. A garbled Latin-sounding word ("copter terms", "copper termites") in a species slot is the nearest genus from: Coptotermes, Schedorhinotermes, Nasutitermes, Heterotermes, Microcerotermes, Cryptotermes, Mastotermes, Porotermes. Never name a species from damage, location or habit.
- nestLocated: "YES" only when the inspector states a nest was found or located. "Possible nest", "could be a nest", "might be nesting in there" is NOT a located nest: leave nestLocated null and keep the hedge in damageDescription. "NO" only when they say no nest was found. Otherwise null (the report prints any value as a checked answer).
- structuralConcern means "refer to a builder or engineer", not "the structure is compromised". "YES" when the inspector recommends a builder, carpenter or engineer look at the damage or the framing, or says the damage may be into structural timbers, even if they add that they don't think it's structural. "NO" when they say no referral is needed, when they state there is no damage, or when the finding is not in or on any building (a tree, stump, fence post or log in the yard). Otherwise null.

BORERS AND WOOD DECAY (never in findings):
- borerActivity: "ACTIVE" only for fresh frass, fresh or bright exit holes, or live beetles. "INACTIVE" for old or dark exit holes, old borer damage, or borer evidence with nothing fresh. "NONE" when the inspector says no borers were found. Null when borers are not raised.
- borerFindings: one entry per distinct place borers were found, like termite findings: a new entry when the place changes. Empty or null when no borers were found. Each entry:
  - borerActivity: "ACTIVE" or "INACTIVE" for that place, by the same rule as borerActivity.
  - borerType: the borer named, as "Anobium (furniture beetle)", "Lyctus (powderpost beetle)", "Queensland pine beetle" or "European house borer", or "Not identified" when the inspector says so. Null when not named.
  - location: where, in the inspector's terms (the room, side or area).
  - timberAffected: the timber members affected, named as for termite findings ("Floorboards", "Roof timbers").
  - description: what was seen (exit holes, frass, tunnelling, dark or bright holes), with no severity words.
  - structuralConcern: "YES" when the inspector recommends a builder, carpenter or engineer look at the borer damage; "NO" when they say no referral is needed. Otherwise null.
- decayFound: "YES" for rot, fungal decay, soft, spongy or crumbling timber. "NO" when they say no rot or decay. Null when not raised.
- decayDetails: what was seen, without the place ("soft, spongy timber", "fungal growth"), with no severity words. decayWhere: where it is, in their words ("rear deck bearers", "bathroom window sill"). Null when they give no place.
- previousTreatment: "YES" when the inspector sees signs the property was treated for termites before: drill holes in the slab, paving or brickwork (often plugged), dusting residue, or bait or monitoring stations in the ground. "NO" when they say there is no sign of a previous treatment. Null when not raised. It is about past treatment evidence, not an installed system the inspector names (that is existingSystem), although both can be filled. previousTreatmentDetails: what was seen, without the place ("plugged drill holes"), naming it with these terms where they fit: drill and inject soil treatment, plugged drill holes, bait stations, monitoring stations, dusting residue, reticulation system, physical barrier, treatment notice in meter box. previousTreatmentWhere: where it was seen, in their words ("along the rear patio", "slab perimeter, front and left side"). Null when they give no place.
- delignification: chemical delignification, where chemicals or salt air break down the timber surface so it looks furry, hairy or fibrous (often on roof timbers near the coast or near chimneys). "YES" when the inspector reports it, "NO" when they say there is none. Null when not raised. delignificationDetails: what was seen, without the place ("furry, fibrous timber surface"). delignificationWhere: where it is ("roof timbers near the chimney"). Null when they give no place.

MOISTURE AND CONDUCIVE CONDITIONS:
- moistureMeterReadings: one row per reading taken, location and the value as said ("28%"). A reading taken with no value stated keeps the row with reading null; never invent a number or a placeholder. Readings called normal or dry are still rows.
- moistureReadings: "YES" when any reading or timber is called high, elevated, damp or wet, or a leak is found. "NO" when the inspector checks and reports no moisture, dry, or readings normal. Null when moisture is not raised. A reading on its own, not called high, does not make it YES.
- waterLeaks: "YES" when a leak or water source is found (tap, pipe, gutter, downpipe, roof, shower, hot water system). "NO" when the inspector checked for leaks and found none, even when a reading was elevated. Elevated moisture with its source not found is moistureReadings YES and waterLeaks NO. Null when leaks are not raised.
- leakLocation: where the leak or water is getting in, anywhere in the building (roof, gutter, wall, wet area, hot water system, subfloor), keeping the fixture or part they name ("under the bathroom vanity", "kitchen sink", "laundry tap"), not just the room. Null unless waterLeaks is YES. It is the leak itself, not where a moisture reading was taken: "a leak in the bathroom, high readings on the hallway wall outside" is leakLocation "Bathroom", with the hallway wall going in moistureMeterReadings.
- timberSoil: "YES" for timber in contact with soil (timber lying on the subfloor soil, sleepers or landscaping timbers against the house, fence timber with soil built up, stumps buried by built-up soil). Stumps, piers or posts set in the ground as built are not timberSoil when the inspector calls them normal or only mentions them; "stumps in the ground, which is normal, no timber lying on the soil" is "NO". "NO" when they say none or that it has been removed. Null when not raised.
- slabEdge: "CLEAR" when the slab edge is visible around the building; "OBSTRUCTED" when soil, a garden bed, paving, render or cladding covers or bridges it anywhere. Null when there is no slab or it was not raised.
- weepHoles: "CLEAR" or "BRIDGED" (blocked, covered, below soil or paving, anywhere). "NONE" only when the inspector says no weep holes were found or located. Null when not raised, or for a building that has none by design (weatherboard) when the inspector says nothing about them.
- siteDrainage: "ADEQUATE" when the inspector says the site drains well; "POOR" for poor, inadequate or no drainage around the building: water pooling, ponding, ground falling towards the house, soggy soil against the walls, downpipes discharging at the walls. Null when not raised.
- subfloorDrainage: the same for the subfloor: "POOR" for water lying or pooling in the subfloor, wet or boggy subfloor soil, or drainage the inspector calls poor; "ADEQUATE" when they say it is dry and drains well. Null when not raised or there is no subfloor.
- subfloorVentilation: "ADEQUATE" when the inspector says the subfloor is well ventilated or vents are fine; "POOR" for poor, inadequate, little or blocked ventilation, too few vents, or a stuffy, damp, humid subfloor they put down to airflow. Null when not raised or there is no subfloor.
- mouldSeen: "YES" when the inspector mentions mould, mildew or fungal growth on surfaces (not wood decay in timber, which is decayFound); "NO" when they say they saw none. mouldWhere: where, in their words, only when mouldSeen is YES.
- nonDurableTimber: "YES" when untreated, non-durable or softwood timber is used where it gets wet or touches the ground (pine sleepers, untreated garden edging, untreated posts, untreated decking near soil). "NO" when they say the timber there is treated or durable. nonDurableTimberDetails: what the timber is, without the place ("untreated pine sleepers"). nonDurableTimberWhere: where it is, in their words ("rear garden bed against the house"). Null when not raised. This is separate from timberSoil, and both can be YES.

EXISTING SYSTEM AND VERIFICATION:
- durableNoticePresent: "YES" when a durable notice, sticker or plate was seen or read out (in the meter box or elsewhere). "NO" when they looked and found none. Null when not raised. This field stands on its own: fill it even when no system was found.
- hardLandscaping / softLandscaping: whether paving, paths or driveways (hard) or garden beds, soil and lawn (soft) sit against the perimeter. Descriptive, YES or NO as said, independent of any system.
- zone25mmVisible (against hard landscaping) and zone75mmVisible (against soft landscaping): whether the inspection zone or the slab edge is visible there. Soil or a garden bed built up over the slab edge is zone75mmVisible NO. Fill only when the inspector describes the edge against that surface. A garden bed or soil away from the walls (at the front gate, by the fence, around a tree) says nothing about the slab edge and leaves both null.
- antCapping: the condition of the ant caps or strip shields on piers and stumps. "INTACT" when they say the capping is in place, complete, intact or on all piers; "GAPS" when it is incomplete: caps missing, damaged, with gaps, or on only some piers; "NONE" when there are piers or stumps with no ant caps at all. Null for a slab house or when not raised. antCappingDetails: where and what, in their words ("gaps on three piers near the kitchen"). Null when antCapping is INTACT with nothing more said.
- antCapSoldered: "YES" or "NO" only when the inspector speaks about the joins or soldering of ant caps or strip shields. "Ant caps on all the piers" says nothing about soldering: null. "N/A" when they say there are no ant caps or shields.

RECOMMENDATIONS AND RISK:
- treatmentRecommended: "YES" when any termite treatment, colony treatment or system install is recommended, including "will need some type of treatment". "NO" when they say no treatment is needed. Builder, plumber or maintenance work (fix a tap, replace a fascia, pull back a garden bed) is not a termite treatment and does not make it YES.
- treatmentType: WHAT was recommended, in the inspector's terms: the target first, then the method only if they named one, e.g. "Treat the active termites in the backyard tree; install a termite management system (chemical barrier or baiting system)", "Direct treatment of the active termites in the skirting, plus a Termidor chemical barrier", "Treat the colony in the stump; method to be confirmed with the owner". Never add a method word the inspector did not say (chemical, barrier, soil treatment, bait, baiting, physical, reticulation, top-up, system, or any product name): each of those becomes a priced line in the client's quote. Never put a negative here ("no treatment needed for the subfloor"): leave that out. Null when treatmentRecommended is NO or when no treatment is discussed.
- riskLevel: the overall risk of termite attack to the property. Use the inspector's own statement when given ("overall risk is high"). Otherwise infer it ONLY from a note that sums up the property (a whole-house note or a wrap-up); a note about one area or one finding leaves it null. A note that walks through several areas (say exterior, subfloor and interior) is a whole-house note even with no wrap-up, so it gets a rating. Judge property factors, never the species. HIGH needs termites: live termites on the property with no termite management system, activity in the building, a nest found or likely, a builder referral, or activity together with conducive conditions (timber-soil contact, a leak, high moisture, bridged slab edge or weep holes). MEDIUM for inactive evidence only, or for conducive conditions (a leak, damp timber, rot, timber on soil, a bridged slab edge) with no termites found. LOW for no termites, no evidence and little that is conducive. With no termites and no evidence anywhere, the answer is never HIGH, whatever else was found.

THE QUOTE: an inspector may also dictate the quote for the job: the work they will do, prices, what is not included, payment and timing ("for the quote", "I'll charge", "price it at", "that's $2,400", "deposit"). Fill "quote" only from those words, and leave it null when the note says nothing about the quote or prices. A recommendation with no price or quote words is not a quote: it stays in the recommendation fields only.
- quote.items: one per piece of work they price or say they'll quote, in the order said. description: the work in plain client words ("Chemical soil barrier around the full perimeter", "Colony treatment at the front porch post", "Follow-up inspection"). qty and unit: the amount said ("48 linear metres" is qty 48, unit "lm"; "12 stations" is qty 12, unit "station"); otherwise qty 1 and unit "job". price: the dollar amount for ONE unit as a plain number ("$28 a metre" is 28; "48 metres, $2,400 all up" is qty 48, unit "lm", price 50; "$450" for one job is 450). Null price when no amount was said for that line. Never invent a price.
- quote.exclusions: each thing they say is not included, one per entry ("Repairs to the porch post", "Any work by a builder").
- quote.paymentTerms: how the client pays, in their words ("50% deposit to book, balance on completion").
- quote.timeframe: how long the work takes ("half a day", "1 day"). quote.servicePeriod: any warranty or free service period ("12 months"). quote.notes: anything else they want on the quote (a free follow-up visit included, access the client must give).
- Spoken numbers become digits: "two thousand four hundred" is 2400, "four fifty" for a price is 450.

HOW TO READ DICTATION:
- Restatements: when a fact is said twice, the later statement wins ("brick veneer ... no hang on, double brick" is double brick; "22, no 32 percent" is 32%). Never record both.
- Negations carry the fact: "no", "not", "none", "nil", "clear of", "couldn't", "didn't", "isn't". Keep them ("no damage visible", "not touching the house") and never drop one; a dropped "not" is the worst error you can make.
- Hedges are facts about certainty: keep them in text fields ("possible nest", "potential past activity"), and for YES/NO fields do not turn a hedge into a YES.
- Filler and false starts ("okay so", "um", "right", "well", "like I said", a repeated word) are dropped. "Wall" or "Well" at the start of a phrase is usually filler, not a wall.
- A sentence that names an element after a finding ("the location of that activity I'd say subfloor joists and bearers") is that finding's location.
- Never copy raw dictation into a field. Never put the whole note into one field. Write fields as a report reads: brief, factual, in the inspector's terms.
- Mishearings: iPhone dictation turns trade words into everyday ones. When a literal reading makes no sense for a timber pest inspection, use the sensible reading silently. Patterns seen: "Joyce and bears" / "joys and bearers" = joists and bearers; "barer" / "Easter barra" = bearer; "sub for" / "some flow" / "some floor" / "sub saw" = subfloor; "weep poles" / "wee poles" = weep holes; "skirting balls" = skirting boards; "borrowers" / "bores" / "balls" (in a pest list) = borers; "called roof" / "old roof" (as the roof type) = tiled roof; "water strains" = water stains; "batting system" = baiting system; "Tims" = timbers; "live termite scene" = live termites seen; "repairs" / "pairs" with caps = piers with ant caps; "strawberry" along a boundary = shrubbery; "insulation" before "termite management system" = installation; "access moisture" = excess moisture; "construction error" = construction era; "customers once" = customer's wants; "out of corners" = outer corners; "shed fence" = shared fence; "bats" in a roof = batts. Seen in the 12 Oct 2026 car test: "exterior wheels" / "wheels are clear" = weep holes (weeps); "peers" / "peas" = piers, and "in cut" / "and cut" / "a cat" / "in capped" right after piers = ant capped; "blood tubing" / "mud shooting" / "mud shavings" = mud tubing; "dribble notice" = durable notice; "roof oil" / "roof for" = roof void; "chemical Barry" = chemical barrier; "walls are taps" / "wars attacks sound" = walls tapped, sound; "trading a bridging" = creating a bridge. Seen across later tests: "barrel" / "bear is" near the subfloor = bearer; "bearer holes" = borer holes; "Greet" with "inspection zone" = breach; "Coto" = Coptotermes; "French bus" = fresh frass; "no time no active to my management system" = no termite management system; "roof fluid" = roof void; "Port Coast" = porch post; "we pull a clear" = weep holes clear; "Investment inspection" = invasive inspection; "garden belts" = garden beds; "stalled items" = stored items; "re-deck" / "the re" = rear deck; "Oil barrier" = soil barrier; "top floor" in a single storey house = subfloor; a clearance in "ml" or "mil" = mm; "triple O" in a phone number = 000; "Cough" = a cough, ignore it.
- Brand names in the wrong slot are ordinary words: "active Termimesh in the tree" is active termites; "Exterra perimeter" is the exterior perimeter; "Sentricon" or "Termidor" in a sentence about the outside wall is probably "centre", "exterior" or "termite". A brand is real ONLY when the inspector says it is installed, is on the durable notice, or is what they recommend. Then it goes in existingSystemOther or treatmentType, nowhere else.
- A Latin-sounding mangle in a species slot is a genus (see species). "Termite door" or "terminator" in a treatment slot is Termidor; "cold on" / "quote on" before "physical barrier" is Kordon.

ADDRESS AND CLIENT: clientPhone and clientEmail only as said (spoken email words become symbols: "jo at example dot com" is jo@example.com). inspectionFee: the fee for this inspection as "$350", only when said. accessNotes: how to get in or around the property (gate code, key, dog, agent to call), in brief. Fill propertyStreetAddress, propertySuburb, propertyState, propertyPostcode and clientName only from words actually spoken ("inspection at 14 Wattle Court, client Priya Nair"). A street name that is also a suburb is still the street. Never infer a suburb, state or postcode, and never take a name from anywhere else in the note. Spoken state names become their abbreviation.`;

// System prompt for the "scan compliance plate" photo feature — a separate,
// narrow prompt (not the giant voice SYSTEM_PROMPT above) for reading a
// single photo of a termite management system durable notice/plate, usually
// found in the meter box. Kept intentionally small: one job, one small JSON
// shape, so it stays reliable in a way a broad multi-field extraction can't.
// NOTE: the "existingSystem" and "existingSystemOther" values below must
// stay in sync with the OPTIONS.existingsystem / SPECIFIC_SYSTEMS_BY_TYPE
// lists inside startEdit() — those are what the on-screen dropdowns offer.
const PLATE_SYSTEM_PROMPT = `You are reading a single photo of an Australian termite management system durable notice (a compliance plate or sticker, usually found in a home's meter box, subfloor access, or near the front entry). Your only job is to read what is printed on it and return a small JSON object — nothing else.

Respond with ONLY raw JSON (no markdown fences, no commentary), matching exactly this shape:
{"systemFound":"YES" or "NO","existingSystem":string or null,"existingSystemOther":string or null,"extraDetails":string or null}

Rules:
- If no durable notice/compliance plate is visible in the photo, or the text is too unclear to read with real confidence, return {"systemFound":"NO","existingSystem":null,"existingSystemOther":null,"extraDetails":null}. Do not guess.
- "existingSystem" must be EXACTLY one of these six strings (whichever matches the system type printed on the plate) — never invent a different value:
  "Physical Barrier"
  "Chemical Reticulation System"
  "Chemical Barrier"
  "Termite Baiting System"
  "Combination System — Physical + Chemical"
  "System Present — Type Unidentified"
  "Chemical Barrier" is a chemical soil treatment or barrier (e.g. Termidor, Altriset, Premise, Biflex) with no reticulation pipes named; use "Chemical Reticulation System" only when the plate names a reticulation or injection system.
  Only use "System Present — Type Unidentified" if the plate confirms a system exists but its type genuinely can't be determined from the text.
- "existingSystemOther" is the specific product/brand name printed on the plate — for example "Kordon", "HomeGuard Blue", "HomeGuard DPC", "HomeGuard TMB", "HomeGuard GT", "Termseal", "Smartfilm", "Termimesh", "Granitgard", "Greenzone", "Termguard", "Altis", "TermX", "TermStop", "Camilleri", "Cavtech", "Reterm", "Exterra", "Sentricon", "Trelona", "Nemesis", "Termidor", "Altriset", "Premise", "Biflex". Use the exact brand name as printed, even if it isn't in this list. If no brand name is legible, return null for this field even when "existingSystem" is set.
- "extraDetails" is a short (under 140 characters) plain-text note of anything else useful and legible on the plate that doesn't fit the fields above — e.g. install date, installer/company name, licence number. Return null if nothing else is legible.
- Never fabricate a value for any field. If you're not confident, use null rather than guessing.`;

// System prompt for the "identify from photo" button on a finding's
// Species/Genus field. Deliberately biased toward the genus-level "... spp."
// and "not identified" fallbacks rather than a confident-sounding wrong
// species — this feeds a real inspection report, and species-level ID from
// a single phone photo is hard even for a person. Keep this list in sync
// with SPECIES_LIST (defined near startEdit(), used by the manual dropdown).
const INSECT_ID_SYSTEM_PROMPT = `You are looking at a single photo of an insect or insect-damage specimen collected during an Australian timber pest inspection. Identify it as best you can and return ONLY raw JSON (no markdown fences, no commentary), matching exactly this shape:
{"identified":"YES" or "NO","species":string or null,"confidence":"HIGH" or "MEDIUM" or "LOW" or null,"notes":string or null}

Rules:
- "species" must be EXACTLY one of the following values, copied verbatim — never invent a new one, and never write a species name that isn't in this list:
  Coptotermes acinaciformis
  Coptotermes frenchi
  Coptotermes lacteus
  Schedorhinotermes intermedius
  Schedorhinotermes actuosus
  Nasutitermes exitiosus
  Nasutitermes walkeri
  Nasutitermes magnus
  Heterotermes ferox
  Microcerotermes distinctus
  Microcerotermes implicatus
  Termes intermedius
  Cryptotermes brevis
  Cryptotermes primus
  Anobium punctatum — Furniture beetle
  Lyctus brunneus — Powder post beetle
  Hylotrupes bajulus — House longhorn beetle
  Coptotermes spp.
  Schedorhinotermes spp.
  Nasutitermes spp.
  Microcerotermes spp.
  Species not identified — further investigation required
- Exact species-level identification from a single photo is genuinely hard, even for an experienced entomologist — prefer the genus-level "... spp." option over guessing a specific species you aren't confident about. Only choose an exact species when the photo clearly shows that species' distinguishing features (soldier head shape and colour, mandible shape, body size for termites; body shape and size for the beetle species).
- If the insect in the photo isn't a termite or one of the listed timber pest beetles at all (an ant, a spider, an unrelated insect), or the photo doesn't show enough detail to say anything useful, set "identified":"NO", "species":null, "confidence":null, and briefly say why in "notes" (e.g. "appears to be an ant, not a termite" or "image too blurry to identify").
- "confidence" reflects how sure you are of the "species" value you chose — "HIGH" only when the diagnostic features are clearly visible, "MEDIUM" when reasonably confident but some uncertainty remains, "LOW" when it's a genuine best guess. Always include a confidence level whenever "species" is set.
- "notes" is a short (under 140 characters) plain-text explanation of the visible features behind this identification (e.g. "pale soldier head, elongated mandibles, consistent with Coptotermes"), or null when identified is "NO".
- This is a starting point for the inspector to confirm, never a final determination — never phrase "notes" as a certainty.`;

// ── APP UPDATES ───────────────────────────────────────────────────────────
// The service worker serves the cached app first, so a deploy used to need
// two reloads to show. When a new version takes over, the page reloads
// itself, but never mid-dictation or mid-typing: then it waits until the
// app is next put away.
let swRegistration = null;
let updateReloadPending = false;

function appIsBusy() {
  const el = document.activeElement;
  return isRecording || document.body.classList.contains('ai-busy')
    || !!(el && el.matches('input, textarea, select, [contenteditable="true"]'));
}

function reloadForUpdate() {
  if (appIsBusy()) { updateReloadPending = true; return; }
  flushDraftSave();
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
    'Loading NSW species reference…',
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
    splash.style.opacity = '0';
    setTimeout(async () => {
      splash.style.display = 'none';

      // If we arrived here via a "reset your password" email link, Supabase
      // redirects back with the recovery tokens in the URL hash. Handle that
      // before anything else — it takes priority over any existing session.
      const recovery = parseRecoveryHash();
      if (recovery) {
        pendingRecoverySession = recovery;
        // Strip the tokens out of the visible URL/history now that we've read them.
        history.replaceState(null, '', window.location.pathname + window.location.search);
        document.getElementById('authScreen').style.display = 'flex';
        showAuth('authResetPassword');
        return;
      }

      const hasSession = await restoreAuthSession();
      if (hasSession) { enterApp(); noticeInviteWhileSignedIn(); }
      else {
        document.getElementById('authScreen').style.display = 'flex';
        // The website's "Start your free trial" lands on the sign-up card.
        showAuth(new URLSearchParams(window.location.search).get('signup') ? 'authSignUp' : 'authSignIn');
        applyInviteToSignUp();
      }
    }, 600);
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
    enableKeyboardActivation();
    restoreA11ySettings();
    restoreAudioCaptureSetting();
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

// ══════════════════════════════════════════════════════════════════════════
// FIELD NOTES — expandable description sub-sections per field
// ══════════════════════════════════════════════════════════════════════════
let fieldNotes = {};
let activeNotesTargetKey = null; // which field's notes the voice popover is dictating into

function enhanceFieldsWithNotes() {
  document.querySelectorAll('.field-val[id^="f-"]').forEach(valEl => {
    const key = valEl.id.replace('f-', '');
    const fieldEl = valEl.closest('.field') || valEl.closest('.findings-gate-question');
    if (!fieldEl) return;
    const labelEl = fieldEl.querySelector('.field-label');
    if (!labelEl || labelEl.dataset.enhanced) return;
    labelEl.dataset.enhanced = '1';

    // Build notes panel — attached after the field-val directly, no pencil button
    const panel = document.createElement('div');
    panel.className = 'field-notes';
    panel.id = 'notes-' + key;
    panel.innerHTML = `
      <textarea class="field-notes-textarea" id="notes-text-${key}" placeholder="Add detail — location, description, observations…" oninput="onNotesInput('${key}')"></textarea>
      <div class="field-notes-bar">
        <button class="field-notes-mic" type="button" onclick="openNotesVoice('${key}')">
          <svg class="icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
          Dictate
        </button>
        <span class="field-notes-charcount" id="notes-count-${key}"></span>
      </div>
    `;
    valEl.insertAdjacentElement('afterend', panel);
  });
}

function toggleFieldNotes(key) {
  // Don't open notes while the field value itself is being edited
  const fieldEl = document.getElementById('f-' + key);
  if (fieldEl && fieldEl.classList.contains('editing')) return;

  const panel = document.getElementById('notes-' + key);
  const toggle = document.getElementById('notes-toggle-' + key);
  if (!panel) return;
  const isOpen = panel.classList.toggle('open');
  if (toggle) toggle.classList.toggle('open', isOpen);
  if (isOpen) {
    const ta = document.getElementById('notes-text-' + key);
    if (ta) setTimeout(() => ta.focus(), 50);
  }
}

function getSectionForKey(key) {
  for (const [sec, cfg] of Object.entries(SECTIONS)) {
    if (cfg.fields.includes(key)) return sec;
  }
  return 'property';
}

function getFieldLabel(valEl) {
  const fieldEl = valEl.closest('.field') || valEl.closest('.findings-gate-question');
  return fieldEl ? fieldEl.querySelector('.field-label') : valEl.previousElementSibling;
}

function onNotesInput(key) {
  const ta = document.getElementById('notes-text-' + key);
  if (!ta) return;
  fieldNotes[key] = ta.value;
  updateNotesIndicator(key);
  saveDraft();
}

function updateNotesIndicator(key) {
  const toggle = document.querySelector(`[onclick="toggleFieldNotes('${key}')"]`);
  const countEl = document.getElementById('notes-count-' + key);
  const hasContent = !!(fieldNotes[key] && fieldNotes[key].trim());
  if (toggle) toggle.classList.toggle('has-content', hasContent);
  if (countEl) countEl.textContent = hasContent ? `${fieldNotes[key].trim().length} chars` : '';
}

function restoreFieldNotes() {
  Object.entries(fieldNotes).forEach(([key, val]) => {
    const ta = document.getElementById('notes-text-' + key);
    if (ta && val) {
      ta.value = val;
      updateNotesIndicator(key);
    }
  });
}

// ── Targeted voice dictation into field notes ──────────────────────────────
function openNotesVoice(key) {
  activeNotesTargetKey = key;
  const popover = document.getElementById('voicePopover');
  const title = document.getElementById('voicePopoverTitleText');
  const fab = document.getElementById('micFab');

  // Get field label for context
  const panel = document.getElementById(`notes-${key}`);
  const fieldEl = panel ? (panel.closest('.field') || panel.closest('.findings-gate-question')) : null;
  const labelEl = fieldEl ? fieldEl.querySelector('.field-label') : null;
  const labelText = labelEl ? labelEl.textContent.replace('edit', '').trim() : 'this field';

  if (title) title.textContent = `Dictating: ${labelText}`;
  document.getElementById('extractBtn').style.display = 'none';
  document.getElementById('useTranscriptBtn').style.display = 'block';

  if (!popover.classList.contains('open')) {
    popover.classList.add('open');
    showTestModeBadge();
    fab.classList.add('open');
  }

  // Pre-fill transcript box with existing notes if any
  const box = document.getElementById('transcriptBox');
  const existing = fieldNotes[key] || '';
  if (existing) {
    box.textContent = existing;
    box.classList.add('active');
    currentTranscript = existing;
  } else {
    box.textContent = 'Tap the mic and start speaking…';
    box.classList.remove('active');
    currentTranscript = '';
  }
  lowConfidenceFlagged = false;
  const warnElNotes = document.getElementById('lowConfidenceWarning');
  if (warnElNotes) warnElNotes.classList.remove('show');
  dismissCleanupSuggestion();
  dismissServerTranscript();
}

function useTranscriptForNotes() {
  if (!activeNotesTargetKey) return;
  const key = activeNotesTargetKey;
  const text = currentTranscript.trim();
  if (!text) {
    showToast('Nothing to add yet — speak first', 'error');
    return;
  }

  fieldNotes[key] = text;
  const ta = document.getElementById('notes-text-' + key);
  if (ta) ta.value = text;
  updateNotesIndicator(key);

  // Ensure the notes panel is open
  const panel = document.getElementById('notes-' + key);
  const toggle = document.querySelector(`[onclick="toggleFieldNotes('${key}')"]`);
  if (panel && !panel.classList.contains('open')) {
    panel.classList.add('open');
    if (toggle) toggle.classList.add('open');
  }

  saveDraft();
  showToast('Notes added', 'success');
  resetVoicePopoverToDefault();
  toggleVoicePopover(); // close popover
}

function resetVoicePopoverToDefault() {
  activeNotesTargetKey = null;
  const title = document.getElementById('voicePopoverTitleText');
  if (title) title.textContent = 'Voice Capture';
  document.getElementById('extractBtn').style.display = 'flex';
  document.getElementById('useTranscriptBtn').style.display = 'none';
  const box = document.getElementById('transcriptBox');
  box.textContent = 'Tap the mic and start speaking, or tap here to type instead.';
  box.classList.remove('active');
  currentTranscript = '';
  lowConfidenceFlagged = false;
  const warnElReset = document.getElementById('lowConfidenceWarning');
  if (warnElReset) warnElReset.classList.remove('show');
  dismissCleanupSuggestion();
  dismissServerTranscript();
}

// ── NATIVE SPEECH RECOGNITION ADAPTER ───────────────────────────────────────
// The browser's Web Speech API (window.SpeechRecognition) does not exist inside a
// Capacitor WKWebView on iOS — it only works in Safari itself. This class wraps the
// native @capacitor-community/speech-recognition plugin behind the same event-driven
// shape the rest of this file already uses (continuous/interimResults/lang props,
// start()/stop()/abort() methods, onresult/onerror/onend callbacks), so the existing
// startRecording() code below works unchanged on both platforms.
class NativeSpeechRecognition {
  constructor() {
    this.continuous = true;
    this.interimResults = true;
    this.lang = 'en-AU';
    this.maxAlternatives = 1;
    this.onresult = null;
    this.onerror = null;
    this.onend = null;
    this._listener = null;
    this._running = false;
  }

  async start() {
    const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SpeechRecognition;
    if (!plugin) { this._fail('not-available'); return; }

    try {
      const perm = await plugin.requestPermissions();
      const granted = !perm || !perm.speechRecognition || perm.speechRecognition === 'granted';
      if (!granted) { this._fail('not-allowed'); return; }
    } catch (e) { this._fail('not-allowed'); return; }

    try {
      this._listener = await plugin.addListener('partialResults', (data) => {
        const matches = (data && data.matches) || [];
        if (!matches.length || !this.onresult) return;
        // Native partial results deliver the whole phrase-so-far, not per-segment chunks
        // like the Web Speech API — treat every update as still-interim until the session
        // actually ends below, at which point we commit one final result.
        this.onresult({ resultIndex: 0, results: [ { isFinal: false, 0: { transcript: matches[0] } } ] });
      });
    } catch (e) { /* non-fatal — proceed without live partials */ }

    this._running = true;
    let finalMatches = null;

    // The device/Simulator doesn't always have every locale's speech model
    // available (the iOS Simulator in particular usually only ships en-US) —
    // when that happens the plugin throws "Failed to initialize recognizer".
    // A single session still only understands one English variant at a time
    // (there's no "understand every accent at once" mode), but different
    // variants are still broadly accent-tolerant — so try the locale best
    // suited to this app's actual users first (Australian English, for
    // local terms and slang), then cascade through other major English
    // variants until we find one this specific device actually supports,
    // so the app works regardless of which language packs happen to be
    // installed rather than failing outright. Once we find a locale that
    // actually initializes on this device, remember it for next time so
    // recording (which opens a new session after each pause) isn't
    // repeatedly retrying locales already known to fail here.
    const ENGLISH_LOCALE_FALLBACKS = ['en-AU', 'en-GB', 'en-US', 'en-NZ', 'en-CA', 'en-IE', 'en-ZA', 'en-IN'];
    const langsToTry = NativeSpeechRecognition._workingLang
      ? [NativeSpeechRecognition._workingLang]
      : [...new Set([this.lang || 'en-AU', ...ENGLISH_LOCALE_FALLBACKS])];
    let lastErr = null, started = false;
    for (const lang of langsToTry) {
      try {
        const res = await plugin.start({ language: lang, partialResults: true, popup: false });
        finalMatches = res && res.matches;
        NativeSpeechRecognition._workingLang = lang;
        started = true;
        break;
      } catch (e) {
        lastErr = e;
        const msg = ((e && (e.errorMessage || e.message)) || '') + '';
        if (!/initialize/i.test(msg)) break; // a different kind of error — don't mask it by retrying
      }
    }
    if (!started) {
      this._running = false;
      this._removeListener();
      this._fail((lastErr && (lastErr.errorMessage || lastErr.message)) || 'unknown');
      return;
    }

    this._running = false;
    this._removeListener();
    if (finalMatches && finalMatches.length && this.onresult) {
      this.onresult({ resultIndex: 0, results: [ { isFinal: true, 0: { transcript: finalMatches[0] } } ] });
    }
    if (this.onend) this.onend();
  }

  async stop() {
    if (!this._running) return;
    try {
      const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SpeechRecognition;
      if (plugin) await plugin.stop();
    } catch (e) {}
  }

  abort() { this.stop(); }

  _removeListener() {
    if (this._listener) { try { this._listener.remove(); } catch (e) {} this._listener = null; }
  }

  _fail(reason) {
    this._removeListener();
    if (this.onerror) this.onerror({ error: reason });
  }
}

function getSpeechRecognitionCtor() {
  const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
  const hasNativePlugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SpeechRecognition;
  if (isNative && hasNativePlugin) return NativeSpeechRecognition;
  if (isNative) return null; // native app, plugin not installed yet — no browser fallback exists here
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

// ── VOICE ─────────────────────────────────────────────────────────────────
function toggleRecording() {
  isRecording ? stopRecording() : startRecording();
}

// Evidence-based correction for specific, repeated mishearings documented
// during real-device dictation testing (iOS Safari, 2 Oct 2026) — NOT a
// general-purpose fuzzy matcher. Each entry here is a pattern that was
// observed to fail the SAME way more than once, with the correction scoped
// tightly enough (surrounding context required) that it shouldn't touch
// unrelated speech. Add to this list only once a mishearing has been seen
// to repeat — a one-off garble isn't worth the false-positive risk.
function correctKnownMishearings(text) {
  if (!text) return text;
  // "Kordon" (termite barrier brand) has never once been recognised
  // correctly in testing - it comes back as a phonetically similar common
  // phrase instead. Scoped to only fire directly before "physical termite
  // barrier" so it can't misfire on an unrelated use of e.g. "quote on".
  // "caught on" added after a second test run produced yet another variant -
  // this word clearly has no stable "wrong" spelling, so expect to keep
  // adding to this alternation as new variants turn up.
  text = text.replace(/\b(cold on|quote on|code on|called on|coded on|caught on)\b(?=\s+physical termite barrier)/gi, 'Kordon');
  // "bearer" (a structural timber term) has now been seen mangled three
  // different ways: "Easter Barra", "eastern barrel" (direction word
  // correct, only "bearer" wrong this time), and "barer" ("subfloor
  // barer", "rear barer"). "barrel" is a real, common word, so it's only
  // fixed after a direction; "barer" never comes up in an inspection, so
  // it's fixed wherever it appears.
  text = text.replace(/\beaster\s+(?:barra|barrow|bearer)\b/gi, 'eastern bearer');
  text = text.replace(/\b(eastern|western|northern|southern)\s+barrel\b/gi, '$1 bearer');
  text = text.replace(/\bbarer\b/gi, 'bearer');
  // The three below mirror patterns already vetted in SYSTEM_PROMPT's
  // homophone-handling section (so they're evidence-based, not new guesses)
  // - ported here so they're also fixed in the transcript box itself.
  text = text.replace(/\binsulation\b(?=\s+(?:termite management system|barrier))/gi, 'installation');
  text = text.replace(/\baccess moisture\b/gi, 'excess moisture');
  text = text.replace(/\bweep? poles\b/gi, 'weep holes');
  // Heard once, in the second house test. They're here despite the rule
  // above because none has a sensible literal reading in an inspection,
  // so a wrong fix can't cost anything.
  text = text.replace(/\bsub for\b(?=\s+vents?\b)/gi, 'subfloor');
  text = text.replace(/\bskirting balls\b/gi, 'skirting boards');
  text = text.replace(/\bborrowers\b/gi, 'borers');
  text = text.replace(/\bbatting system\b/gi, 'baiting system');
  text = text.replace(/\bwater strains\b/gi, 'water stains');
  text = text.replace(/\bcalled roof\b/gi, 'tiled roof');
  // Heard in the 12 Oct 2026 car test. None has a sensible literal reading
  // in an inspection; "wheels" and "roof for" are fixed only in the phrase
  // they were heard in.
  text = text.replace(/\b(?:blood tubing|mud shooting)\b/gi, 'mud tubing');
  text = text.replace(/\bdribble notice\b/gi, 'durable notice');
  text = text.replace(/\broof oil\b/gi, 'roof void');
  text = text.replace(/\broof for\b(?=\s+now\b)/gi, 'roof void');
  text = text.replace(/\bchemical barry\b/gi, 'chemical barrier');
  text = text.replace(/\bwheels\b(?=\s+(?:are|were)\s+(?:all\s+)?clear\b)/gi, 'weep holes');
  // Second car test, same day: "ant capped" came back as "in capped", and
  // "subfloor" as "sub for" before "now".
  text = text.replace(/\b(?:in|and|an)\s+capped\b/gi, 'ant capped');
  text = text.replace(/\bsub for\b(?=\s+now\b)/gi, 'subfloor');
  text = text.replace(/\b(subfloor)\s+peers\b/gi, '$1 piers');
  text = text.replace(/\bpeers\b(?=\s+in the subfloor\b)/gi, 'piers');
  // "strawberry" directly before "along the boundary" (or similar) only -
  // left narrower than the AI prompt's version since "strawberry" alone is
  // a real word that could legitimately come up (e.g. a garden bed).
  text = text.replace(/\bstrawberry\b(?=\s+(?:along|growing along|against)\s+the\s+boundary)/gi, 'shrubbery');
  // Scan of all 59 test notes, 30 Oct 2026. Each has no sensible literal
  // reading in an inspection, or is fixed only in the phrase it was heard in.
  // A fix at the start of a sentence keeps its capital letter.
  const fix = (re, to) => {
    text = text.replace(re, (m, at, all) => /^\s*$|[.!?]\s+$/.test(all.slice(0, at)) ? to[0].toUpperCase() + to.slice(1) : to);
  };
  // "piers ant capped" came back four ways from Safari.
  fix(/\b(?:peers|peas)\s+(?:are\s+)?(?:in|and|an|ant|a|currently a)\s+(?:cunt|cut|cat|capped)\b/gi, 'piers ant capped');
  fix(/\band capping\b/gi, 'ant capping');
  fix(/\bport coast\b/gi, 'porch post');
  fix(/\binvestment inspection\b/gi, 'invasive inspection');
  fix(/\bgarden belts\b/gi, 'garden beds');
  fix(/\bstalled items\b/gi, 'stored items');
  fix(/\bbearer holes\b/gi, 'borer holes');
  fix(/\bre-deck\b/gi, 'rear deck');
  fix(/\bat the re and\b/gi, 'at the rear and');
  fix(/\bwe pull a clear\b/gi, 'weep holes clear');
  fix(/\bfrench bus\b/gi, 'fresh frass');
  fix(/\broof fluid\b/gi, 'roof void');
  // "soil barrier" lost its first letter at a phrase break ("Oil barrier").
  text = text.replace(/(^|[.!?]\s+|\bchemical\s+)oil barrier\b/gi, (m, pre) => pre + (/^\s*$|[.!?]\s*$/.test(pre) ? 'Soil' : 'soil') + ' barrier');
  // Subfloor clearance is always millimetres; "400ml", "400 mil".
  text = text.replace(/\b(clearance\D{0,20}?\d+)\s*(?:ml|mils?)\b/gi, '$1 mm');
  // Whisper writes a cough as words.
  text = text.replace(/(?:^|\s)(?:\(?cough\)?[.,]?\s*)+(?=\s|$)/gi, ' ').replace(/\s{2,}/g, ' ').trim();
  // And the fixes this business has made twice (see LEARNED CORRECTIONS).
  return applyLearnedWordFixes(text);
}

// Brand/product names and species genera, sent to the transcription
// backend as a vocabulary hint (see buildTranscriptionVocabHint below).
// There used to be a client-side fuzzy matcher over this list too. It was
// removed after a real test (5 Oct 2026) showed it rewriting ordinary words
// into brand names: "termites" became "Termimesh" and "external" became
// "Exterra". Brand names in the wrong slot are left to SYSTEM_PROMPT's
// contextual reasoning, which can see the whole sentence.
const TRANSCRIPTION_VOCAB = [
  'Kordon', 'Termidor', 'Altriset', 'Premise', 'Bifenthrin', 'Biflex',
  'Exterra', 'Sentricon', 'Trelona', 'Termimesh',
  'Coptotermes', 'Schedorhinotermes', 'Nasutitermes', 'Cryptotermes',
];

// ── AI TRANSCRIPT CLEANUP (suggest-and-confirm, never automatic) ──────────
// Unlike correctKnownMishearings() above, which only fixes specific phrases
// already seen to go wrong in testing, this asks the AI to reason about
// genuinely garbled stretches of the transcript - the
// "Shut up Scott Stratford Number Double" kind of result that doesn't
// resemble anything on a word-list. That's real signal loss, not a simple
// mishearing, and an AI asked to "fix" it can't recover what was actually
// said - it can only invent something plausible. For a transcript that
// becomes evidence in a professional report, a confident-looking
// fabrication slipping through unnoticed is worse than an obviously
// garbled one, so this NEVER touches the transcript on its own. It always
// shows the inspector exactly what it would change and waits for Apply.
const TRANSCRIPT_CLEANUP_PROMPT = `You are proofreading a voice-dictated transcript from an Australian termite/pest inspection technician (SAYON app). The transcript came from on-device speech recognition and may contain mishearings - a garbled word or phrase standing in for the real one, based on how it sounds.

Your job: produce a corrected version of the transcript, fixing ONLY mishearings you can confidently resolve from context - the same judgement an experienced inspector would use proofreading a colleague's dictation. Known categories to watch for: brand/product names (Kordon, Termidor, Altriset, Phantom, Bifenthrin, Biflex, Maxxthor, Talstar, Exterra, Sentricon, Trelona, Termimesh, HomeGuard Blue), species names (e.g. Coptotermes acinaciformis), and pest-inspection technical terms (e.g. "bearer", "joists", "piers", "ant caps", "skirting boards", "borers", "weep holes", "shrubbery", "installation", "subfloor", "exterior", "baiting system"). A brand name can also be wrong: if one sits where an ordinary word belongs (e.g. "active Termimesh found in the tree"), restore the ordinary word ("termites").

CRITICAL: if a stretch of the transcript is too garbled to confidently reconstruct - not a mispronounced word, but content that doesn't resemble anything sensible in a pest-inspection context at all - do NOT invent or guess what it might have meant. Leave that exact stretch exactly as transcribed, and set hasUncertainSections to true. It is always better to leave garbage as garbage than to fabricate plausible-sounding content for a professional report. Only rewrite what you're genuinely confident about.

Return ONLY valid JSON, no other text: {"cleaned": string, "hasUncertainSections": boolean}`;

let cleanupSuggestion = null;
let cleanupOriginalText = null;

async function suggestTranscriptCleanup() {
  if (!currentTranscript.trim()) return;
  const btn = document.getElementById('cleanupSuggestBtn');
  const originalLabel = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Thinking…'; }
  cleanupOriginalText = currentTranscript;

  try {
    const res = await workerFetch('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        // Thinking counts toward max_tokens (see requestExtraction()), and
        // the answer repeats the whole transcript, so leave room for both.
        max_tokens: 8000,
        output_config: { effort: 'low' },
        system: TRANSCRIPT_CLEANUP_PROMPT,
        messages: [{ role: 'user', content: currentTranscript }]
      })
    });
    const rawBody = await res.text();
    let data;
    try { data = JSON.parse(rawBody); }
    catch { throw new Error(`HTTP ${res.status}: ${rawBody.slice(0, 200) || '(empty response)'}`); }
    if (!res.ok || data.error) {
      const errMsg = data.error?.message || data.error?.type || `HTTP ${res.status}`;
      throw new Error('API error: ' + errMsg);
    }
    if (data.stop_reason === 'max_tokens') {
      throw new Error('AI response was cut off (transcript too long for the response limit)');
    }
    const text = data.content.map(i => i.text || '').join('');
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    if (!parsed || typeof parsed.cleaned !== 'string') throw new Error('Unexpected response shape');
    cleanupSuggestion = parsed;
    showCleanupSuggestion(parsed);
  } catch (err) {
    const reason = ((err && err.message) ? String(err.message) : 'unknown error').slice(0, 140);
    showToast('AI cleanup unavailable: ' + reason, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
  }
}

function showCleanupSuggestion(suggestion) {
  const panel = document.getElementById('cleanupPanel');
  const textEl = document.getElementById('cleanupPanelText');
  const noteEl = document.getElementById('cleanupPanelNote');
  if (!panel || !textEl) return;
  textEl.textContent = suggestion.cleaned;
  if (noteEl) noteEl.style.display = suggestion.hasUncertainSections ? 'block' : 'none';
  panel.style.display = 'block';
}

function applyCleanupSuggestion() {
  if (!cleanupSuggestion) return;
  // If the transcript changed since this suggestion was generated (the
  // inspector kept editing, or started a new recording), the suggestion no
  // longer matches what's in the box - dismiss rather than silently
  // overwrite edits the inspector made in the meantime.
  if (currentTranscript !== cleanupOriginalText) {
    showToast('Transcript changed since this suggestion was made — dismissed rather than risk overwriting your edits', 'error');
    dismissCleanupSuggestion();
    return;
  }
  currentTranscript = cleanupSuggestion.cleaned;
  const box = document.getElementById('transcriptBox');
  if (box) {
    box.textContent = currentTranscript;
    box.classList.add('active');
  }
  showToast('Cleanup applied — review before extracting', 'success');
  dismissCleanupSuggestion();
}

function dismissCleanupSuggestion() {
  cleanupSuggestion = null;
  cleanupOriginalText = null;
  const panel = document.getElementById('cleanupPanel');
  if (panel) panel.style.display = 'none';
}

// ── EXPERIMENTAL AUDIO CAPTURE / SERVER-SIDE TRANSCRIPTION ─────────────────
// See the long comment at the state declarations above for why this is
// opt-in and defaults off. Everything below is written so that if any part
// of it fails — unsupported browser, mic busy, network error, the Worker
// endpoint not existing yet — the technician sees nothing different at all:
// the existing Web Speech transcript is already complete and usable by the
// time any of this would matter.

function toggleAudioCaptureSetting() {
  audioCaptureEnabled = !audioCaptureEnabled;
  const btn = document.getElementById('toggleAudioCapture');
  if (btn) btn.classList.toggle('on', audioCaptureEnabled);
  try { localStorage.setItem('korva_audio_capture_enabled', audioCaptureEnabled ? '1' : '0'); } catch (e) {}
  // Re-arm the self-disable guard whenever the technician deliberately
  // turns this back on, so a failure from a much earlier session (or a
  // since-fixed bug) doesn't permanently lock the toggle into a no-op.
  if (audioCaptureEnabled) audioCaptureFailedThisSession = false;
}

function restoreAudioCaptureSetting() {
  try {
    audioCaptureEnabled = localStorage.getItem('korva_audio_capture_enabled') === '1';
    const btn = document.getElementById('toggleAudioCapture');
    if (btn) btn.classList.toggle('on', audioCaptureEnabled);
  } catch (e) {}
}

function isAudioCaptureSupported() {
  if (audioCaptureSupportCache !== null) return audioCaptureSupportCache;
  audioCaptureSupportCache = !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function' && typeof window.MediaRecorder === 'function');
  return audioCaptureSupportCache;
}

function pickAudioMimeType() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  // audio/mp4 first: that's what iOS Safari (the primary target device for
  // this app) actually supports and records in — webm/ogg are Chrome/Firefox
  // formats Safari's MediaRecorder doesn't produce.
  const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return ''; // let the browser pick its own default rather than fail outright
}

function stopAudioCaptureTracks() {
  if (audioCaptureStream) {
    try { audioCaptureStream.getTracks().forEach(t => t.stop()); } catch (e) {}
  }
  audioCaptureStream = null;
}

// Starts a SECOND, independent mic capture purely for the experimental
// higher-accuracy path — called from startRecording() only when the opt-in
// setting is on. Every failure path here is silent (console.warn only): the
// primary Web Speech transcript already has its own separate mic access via
// recognition.start() and is unaffected either way.
async function startAudioCapture() {
  audioRecordedChunks = [];
  if (!audioCaptureEnabled || audioCaptureFailedThisSession || !isAudioCaptureSupported()) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCaptureStream = stream;
    const mimeType = pickAudioMimeType();
    mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) audioRecordedChunks.push(e.data);
    };
    mediaRecorder.onerror = (e) => {
      // If the recorder itself throws mid-session, don't keep trying on
      // every future recording this session — something about this
      // device/combination isn't working, and the dictation feature it
      // runs alongside must never be put at risk chasing it.
      console.warn('Audio capture error — disabling experimental audio transcription for the rest of this session:', e && e.error);
      audioCaptureFailedThisSession = true;
      stopAudioCaptureTracks();
    };
    mediaRecorder.start();
  } catch (err) {
    console.warn('Audio capture unavailable this recording (speech-recognition transcript is unaffected):', err && err.message);
    mediaRecorder = null;
    audioCaptureStream = null;
  }
}

// Stops the parallel recording (if any) and resolves with a Blob once the
// recorder has actually flushed its last chunk, or null if nothing was
// captured / capture wasn't running. Never rejects.
function stopAudioCapture() {
  return new Promise((resolve) => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      stopAudioCaptureTracks();
      resolve(null);
      return;
    }
    const recorder = mediaRecorder;
    const mimeType = recorder.mimeType || 'audio/webm';
    recorder.onstop = () => {
      stopAudioCaptureTracks();
      const chunks = audioRecordedChunks;
      audioRecordedChunks = [];
      resolve(chunks.length ? new Blob(chunks, { type: mimeType }) : null);
    };
    try { recorder.stop(); } catch (e) { stopAudioCaptureTracks(); resolve(null); }
    mediaRecorder = null;
  });
}

// Vocabulary hint sent to the transcription backend (Whisper's
// initial_prompt biases recognition toward words it's given, without
// forcing them). Written like an inspection note, since Whisper follows the
// style of its prompt as well as the words. Every trade word here is one
// Whisper or Safari has misheard in a real test (scan of 59 test notes,
// 30 Oct 2026). The everyday words sit alongside the brand names so the hint
// doesn't pull "termites" or "exterior" towards a similar-sounding brand.
// Keep it under about 650 characters: Whisper only reads the last ~220
// tokens of a prompt, and the words just spoken are added after this.
function buildTranscriptionVocabHint() {
  // Plus the words this business has corrected to (LEARNED CORRECTIONS).
  const learned = learnedHintWords(100);
  return 'Timber pest inspection notes, Australia. Termites, subfloor, bearers and joists, brick piers ant capped, ' +
    'ant capping, roof void, insulation, weep holes clear, slab edge, garden beds, skirting boards, porch post, ' +
    'rear deck, stored items, exterior, shrubbery. Mud leads, borer holes, fresh frass, moisture reading 28%, ' +
    'clearance 400 mm, durable notice, termite management system, soil barrier, invasive inspection. ' +
    TRANSCRIPTION_VOCAB.join(', ') + '.' + (learned ? ' ' + learned + '.' : '');
}

// Uploads the captured audio to the Worker's transcription endpoint and, on
// a clean result, offers it as a suggestion — the same suggest-and-confirm
// pattern as AI cleanup above, for the same reason: this has never run in
// real field conditions, and silently swapping out a transcript the
// technician can already see and trust is a bigger risk than a wording fix.
// On ANY failure (network error, non-2xx, Worker AI error, bad
// response shape) this fails completely silently — console.warn only — so
// the Web Speech transcript already in the box remains exactly as if this
// feature didn't exist.
//
// Served by the Worker's /transcribe route (worker/worker.js, v7+), which
// expects multipart `audio` + optional `initial_prompt` and returns
// { transcript }.
async function tryServerSideTranscription(blob, before) {
  if (!blob) return;
  try {
    const formData = new FormData();
    const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    formData.append('audio', blob, `recording.${ext}`);
    formData.append('initial_prompt', buildTranscriptionVocabHint());
    const res = await workerFetch('/transcribe', {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data || typeof data.transcript !== 'string' || !data.transcript.trim()) throw new Error('Unexpected response shape');
    showServerTranscriptionSuggestion(data.transcript.trim(), before);
  } catch (err) {
    console.warn('Server-side transcription unavailable this recording — keeping the on-device transcript:', err && err.message);
  }
}

function showServerTranscriptionSuggestion(transcript, before) {
  // Guard against a slow response landing after the technician already
  // moved on (extracted, started a new recording, navigated away) — only
  // show it if we're still looking at the same transcript this capture
  // started with.
  if (isRecording || currentTranscript !== serverTranscriptOriginalText || !currentTranscript.startsWith(before)) return;
  serverTranscriptSuggestion = transcript;
  serverTranscriptBefore = before;
  const panel = document.getElementById('serverTranscriptPanel');
  const textEl = document.getElementById('serverTranscriptPanelText');
  if (!panel || !textEl) return;
  textEl.textContent = transcript;
  panel.style.display = 'block';
}

function applyServerTranscript() {
  if (!serverTranscriptSuggestion) return;
  if (currentTranscript !== serverTranscriptOriginalText) {
    showToast('Transcript changed since this alternate version was generated — dismissed rather than risk overwriting your edits', 'error');
    dismissServerTranscript();
    return;
  }
  const before = serverTranscriptBefore;
  const gap = before && !/\s$/.test(before) ? ' ' : '';
  currentTranscript = before + gap + serverTranscriptSuggestion + ' ';
  const box = document.getElementById('transcriptBox');
  if (box) { box.textContent = currentTranscript; box.classList.add('active'); }
  showToast('Swapped in the other version of your last recording. Check it before you extract', 'success');
  dismissServerTranscript();
}

function dismissServerTranscript() {
  serverTranscriptSuggestion = null;
  serverTranscriptOriginalText = null;
  serverTranscriptBefore = '';
  const panel = document.getElementById('serverTranscriptPanel');
  if (panel) panel.style.display = 'none';
}

// ── WHISPER LISTENING ─────────────────────────────────────────────────────
// The phone's own speech service (Web Speech in Safari) badly mishears trade
// words: "live termites in the front porch post" came back as "last night in
// Port Coast" in the 28 Oct field test. When the phone is online and signed
// in, the mic is recorded instead and each phrase is sent to Whisper through
// the Worker's /transcribe, with the trade vocabulary as a hint. Text lands a
// moment after each pause, in order. Only one thing uses the mic at a time:
// Web Speech is the fallback when Whisper can't be used, never alongside it.
const WHISPER_PAUSE_MS = 1200;       // a pause this long ends a phrase
const WHISPER_MAX_SEGMENT_MS = 15000; // a phrase is cut here even mid-flow
const WHISPER_LONG_SEGMENT_MS = 8000;  // after this, a short breath ends the phrase
const WHISPER_SHORT_PAUSE_MS = 500;
const WHISPER_MIN_SPEECH_MS = 300;    // less than this is a cough or a bump
const WHISPER_POLL_MS = 100;
// What Whisper is known to "hear" in near-silence.
const WHISPER_NOISE_RE = /^(?:thank you|thanks for watching|thank you for watching|you|bye|okay|\.)[.!\s]*$/i;

let whisper = null;          // the live session, or null
let whisperOff = false;      // Whisper failed this visit: use the phone's speech
let whisperQueue = [];       // phrases sent or waiting, in the order spoken
let whisperSettleWaiters = [];
let voiceJobEpoch = 0;       // goes up when the job changes, see clearFilledNotes

function canUseWhisperListening() {
  const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
  return !isNative && !whisperOff && navigator.onLine && !!authSession?.access_token
    && isAudioCaptureSupported() && !!(window.AudioContext || window.webkitAudioContext);
}

// Resolves once every phrase spoken so far has come back (or after a
// timeout), so a fill never runs before the last words are in.
function whisperSettled(timeoutMs = 15000) {
  if (!whisperQueue.length) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(done, timeoutMs);
    function done() { clearTimeout(timer); whisperSettleWaiters = whisperSettleWaiters.filter(f => f !== done); resolve(); }
    whisperSettleWaiters.push(done);
  });
}

function whisperShowPending() {
  const box = document.getElementById('transcriptBox');
  if (!box) return;
  const waiting = whisperQueue.length || (whisper && whisper.speechMs >= WHISPER_MIN_SPEECH_MS);
  box.textContent = currentTranscript + (waiting ? '…' : '');
  box.classList.toggle('active', !!(currentTranscript || waiting));
}

// Returns true when Whisper listening started; false means use Web Speech.
async function startWhisperListening() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  // Made inside the tap, before any await, so iPhone lets it run.
  const ctx = new Ctx();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (err) {
    try { ctx.close(); } catch (e) {}
    console.warn('Whisper listening: no mic stream, using the phone\'s speech instead:', err && err.message);
    return false;
  }
  if (!isRecording) { stream.getTracks().forEach(t => t.stop()); try { ctx.close(); } catch (e) {} return true; }
  try { await ctx.resume(); } catch (e) {}
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const s = whisper = {
    ctx, stream, analyser, buf: new Float32Array(analyser.fftSize),
    recorder: null, chunks: [], startedAt: 0, speechMs: 0, quietMs: 0,
    floor: 0.01, epoch: voiceJobEpoch, timer: null,
  };
  whisperNewSegment(s);
  s.timer = setInterval(() => whisperTick(s), WHISPER_POLL_MS);
  return true;
}

function whisperNewSegment(s) {
  const mimeType = pickAudioMimeType();
  const rec = mimeType ? new MediaRecorder(s.stream, { mimeType }) : new MediaRecorder(s.stream);
  const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };
  rec.start();
  s.recorder = rec; s.chunks = chunks; s.startedAt = Date.now(); s.speechMs = 0; s.quietMs = 0;
}

function whisperTick(s) {
  if (whisper !== s) return;
  s.analyser.getFloatTimeDomainData(s.buf);
  let sum = 0;
  for (let i = 0; i < s.buf.length; i++) sum += s.buf[i] * s.buf[i];
  const rms = Math.sqrt(sum / s.buf.length);
  const threshold = Math.max(0.012, s.floor * 3);
  if (rms > threshold) {
    s.speechMs += WHISPER_POLL_MS; s.quietMs = 0;
    waveLevel = Math.min(1, Math.max(waveLevel, rms * 8));
  } else {
    s.quietMs += WHISPER_POLL_MS;
    s.floor = s.floor * 0.95 + rms * 0.05; // follows the background noise
  }
  if (s.speechMs >= WHISPER_MIN_SPEECH_MS && s.speechMs < WHISPER_MIN_SPEECH_MS + WHISPER_POLL_MS) whisperShowPending();
  const age = Date.now() - s.startedAt;
  // Someone reading straight through barely pauses, so a long phrase ends
  // at the next breath rather than being cut mid-word at the limit.
  const pause = age >= WHISPER_LONG_SEGMENT_MS ? WHISPER_SHORT_PAUSE_MS : WHISPER_PAUSE_MS;
  if ((s.speechMs >= WHISPER_MIN_SPEECH_MS && s.quietMs >= pause) || age >= WHISPER_MAX_SEGMENT_MS) whisperCutSegment(s);
}

// Ends the current phrase and starts the next one straight away, so no
// words fall between the two.
function whisperCutSegment(s, last) {
  const rec = s.recorder, chunks = s.chunks, hadSpeech = s.speechMs >= WHISPER_MIN_SPEECH_MS;
  if (!rec) return Promise.resolve();
  if (!last) whisperNewSegment(s);
  const entry = hadSpeech ? { text: null, done: false, epoch: s.epoch } : null;
  if (entry) whisperQueue.push(entry);
  const finished = new Promise(resolve => {
    rec.onstop = () => resolve(chunks.length ? new Blob(chunks, { type: rec.mimeType || 'audio/mp4' }) : null);
    try { rec.stop(); } catch (e) { resolve(null); }
  });
  if (!entry) return finished;
  whisperShowPending();
  return finished.then(blob => whisperSend(entry, blob, 0));
}

async function whisperSend(entry, blob, tries) {
  if (!blob) { entry.done = true; whisperApply(); return; }
  try {
    const form = new FormData();
    const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    form.append('audio', blob, `phrase.${ext}`);
    // The words just before help Whisper with the next phrase.
    const context = currentTranscript.trim().slice(-300);
    form.append('initial_prompt', (buildTranscriptionVocabHint() + ' Say "Stop Sayon" to finish.' + (context ? ' ' + context : '')).slice(-1000));
    const res = await workerFetch('/transcribe', { method: 'POST', body: form });
    if (res.status === 502 && /no text/i.test(await res.text().catch(() => ''))) { entry.text = ''; entry.done = true; whisperApply(); return; } // nothing heard
    if (!res.ok) { const err = new Error('HTTP ' + res.status); err.status = res.status; throw err; }
    const data = await res.json();
    entry.text = typeof data?.transcript === 'string' ? data.transcript.trim() : '';
    entry.done = true;
    whisperApply();
  } catch (err) {
    const status = err && err.status;
    if (!status && tries < 20) {
      // No signal: try again once it's back, the words aren't lost.
      const wait = navigator.onLine ? Math.min(2000 * (tries + 1), 10000) : 0;
      if (!navigator.onLine) window.addEventListener('online', () => whisperSend(entry, blob, tries + 1), { once: true });
      else setTimeout(() => whisperSend(entry, blob, tries + 1), wait);
      return;
    }
    // Whisper on the server sometimes fails one phrase and answers the
    // next: try a failed phrase twice more before giving up on it.
    if (status >= 500 && status !== 501 && (entry.serverTries || 0) < 2) {
      entry.serverTries = (entry.serverTries || 0) + 1;
      setTimeout(() => whisperSend(entry, blob, tries), 1500 * entry.serverTries);
      return;
    }
    console.warn('Whisper listening failed, using the phone\'s speech instead:', err && err.message);
    entry.text = ''; entry.done = true;
    whisperApply();
    // The phrase that failed is lost, so say so: the inspector can repeat it.
    whisperFallBack(status === 429 ? 'This month\'s AI fills are used up. The last few words were missed, so say them again' : 'The last few words were missed. Say them again, the phone\'s own speech is listening now');
  }
}

// Adds finished phrases to the transcript in the order they were spoken.
function whisperApply() {
  while (whisperQueue.length && whisperQueue[0].done) {
    const entry = whisperQueue.shift();
    let text = (entry.text || '').trim();
    if (!text || WHISPER_NOISE_RE.test(text)) continue;
    if (entry.epoch !== voiceJobEpoch) { showToast('You changed job before the last words came back, so they were left out', 'info'); continue; }
    text = correctKnownMishearings(text);
    const stopAt = text.search(VOICE_STOP_LIVE_RE);
    if (stopAt >= 0) text = text.slice(0, stopAt).trim();
    if (text) { currentTranscript += text + ' '; speechHeard(text); }
    pulseWave();
    if (stopAt >= 0 && isRecording) {
      stopRecording();
      playTone(440, 200, 0.2);
      setTimeout(() => { if (!isRecording && currentTranscript.trim()) processTranscript(); }, 600);
    }
    if (!isRecording && currentTranscript.trim()) document.getElementById('extractBtn').disabled = false;
    saveDraft();
  }
  whisperShowPending();
  if (!whisperQueue.length) whisperSettleWaiters.slice().forEach(f => f());
}

// Ends the session; the last phrase is still sent. Resolves when the mic
// is released.
function stopWhisperListening() {
  const s = whisper;
  if (!s) return Promise.resolve();
  whisper = null;
  clearInterval(s.timer);
  const last = whisperCutSegment(s, true);
  return Promise.resolve(last).catch(() => {}).finally(() => {
    try { s.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
    try { s.ctx.close(); } catch (e) {}
  });
}

// Whisper can't be used (not set up, allowance used, signed out): finish
// this recording with the phone's speech, and keep to it for this visit.
function whisperFallBack(message) {
  if (whisperOff) return;
  whisperOff = true;
  if (!whisper) return;
  showToast(message, 'info');
  stopWhisperListening().then(() => { if (isRecording && whisperFallbackListen) whisperFallbackListen(); });
}
let whisperFallbackListen = null;

// The wave under the mic moves with what the phone hears: each batch of
// words it recognises kicks the bars up, and they settle back while it's
// quiet. It reads the speech results, not the microphone, so it never opens
// a second mic (two at once isn't proven safe on iPhone) and it only moves
// when words are actually coming through.
let waveLevel = 0, waveFrame = 0;
function pulseWave() { waveLevel = Math.min(1, waveLevel + 0.55); }
function driveWave(on) {
  cancelAnimationFrame(waveFrame);
  const bars = [...document.querySelectorAll('#waveform .wave-bar, #micFab .wave-bar')];
  if (!on) { waveLevel = 0; bars.forEach(b => { b.style.height = ''; }); return; }
  const tick = t => {
    waveLevel *= 0.95;
    bars.forEach((b, i) => {
      const swing = 0.55 + 0.45 * Math.sin(t / 90 + i * 1.3);
      b.style.height = (3 + 1.5 * (0.5 + 0.5 * Math.sin(t / 400 + i)) + 14 * waveLevel * swing).toFixed(1) + 'px';
    });
    waveFrame = requestAnimationFrame(tick);
  };
  waveFrame = requestAnimationFrame(tick);
}

function startRecording() {
  const SR = getSpeechRecognitionCtor();
  const useWhisper = canUseWhisperListening();
  if (!SR && !useWhisper) { showToast('Speech recognition not supported — tap the transcript box to type instead', 'error'); return; }
  track('dictation_started');

  lowConfidenceFlagged = false;
  const warnEl0 = document.getElementById('lowConfidenceWarning');
  if (warnEl0) warnEl0.classList.remove('show');
  dismissCleanupSuggestion();
  dismissServerTranscript();
  recordingStartText = currentTranscript;

  // Browsers end a speech session on their own after a quiet stretch or a
  // minute or so of talk. While the inspector still has recording on, open a
  // new session straight away so the phone keeps listening room to room,
  // even when nobody is speaking into it. stopRecording() replaces onend, so
  // a deliberate stop never restarts. A session that keeps dying at once
  // (mic taken by another app) stops after a few tries instead of looping.
  let quickEnds = 0;
  const listen = () => {
    const startedAt = Date.now();
    recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-AU';

    // Safari re-delivers results it has already finalised (the same index
    // comes back as final again, or the same phrase arrives as a fresh final
    // result a moment later), which doubled phrases like "Wall construction
    // Wall construction". Commit each result index once, and drop a final
    // chunk that exactly repeats the one just committed.
    let committedUpTo = -1;
    let lastFinalText = '';
    let lastFinalAt = 0;
    // Words heard but not yet final. When the phone ends a session on its
    // own mid-sentence they never come back as final, which lost a whole
    // room in a field test, so onend keeps them before listening again.
    let pendingInterim = '';

    recognition.onresult = (e) => {
      let interim = '', final = '', stopByVoice = false;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          if (i <= committedUpTo) continue;
          committedUpTo = i;
          const rawChunk = e.results[i][0].transcript.trim();
          const now = Date.now();
          if (rawChunk.toLowerCase() === lastFinalText && now - lastFinalAt < 3000) continue;
          lastFinalText = rawChunk.toLowerCase();
          lastFinalAt = now;
          let finalChunk = e.results[i][0].transcript;
          // Some platforms never populate confidence (comes back as exactly
          // 0 or undefined) - treat that as "unknown", not "low", so this
          // doesn't false-flag every result on devices that don't support it.
          const conf = e.results[i][0].confidence;
          if (typeof conf === 'number' && conf > 0 && conf < 0.6) {
            lowConfidenceFlagged = true;
          }
          finalChunk = correctKnownMishearings(finalChunk);
          // Cut from the stop words on, again if the phone repeated them.
          for (let stopAt; (stopAt = finalChunk.search(VOICE_STOP_RE)) >= 0;) { finalChunk = finalChunk.slice(0, stopAt); stopByVoice = true; }
          if (finalChunk.trim()) final += finalChunk.trim() + ' ';
        }
        else interim += e.results[i][0].transcript;
      }
      currentTranscript += final;
      pendingInterim = interim;
      // Each phrase goes to the draft as it lands, so a tab the phone kills
      // mid-dictation loses the current sentence at most.
      if (final) { speechHeard(final); saveDraft(); }
      pulseWave();
      const box = document.getElementById('transcriptBox');
      box.textContent = currentTranscript + interim;
      box.classList.add('active');
      const warnEl = document.getElementById('lowConfidenceWarning');
      if (warnEl) warnEl.classList.toggle('show', lowConfidenceFlagged);
      if (!stopByVoice && VOICE_STOP_LIVE_RE.test(interim)) stopByVoice = true;
      if (stopByVoice && isRecording) {
        // "Stop Sayon": stop, then fill in the rest once the last phrase is
        // in. Heard first in the live text, the final copy that follows the
        // stop has the words cut off above and doesn't stop twice.
        stopRecording();
        playTone(440, 200, 0.2);
        setTimeout(() => { if (!isRecording && currentTranscript.trim()) processTranscript(); }, 2100);
      }
    };

    recognition.onerror = (e) => {
      // FIX: this used to silently discard the error entirely, so when
      // recognition failed or produced garbage there was no way to tell
      // whether it was a network drop, a mic/permission problem, no speech
      // detected, or something else — every failure looked identical from
      // the outside. Surface the actual reason (console + toast) so a bad
      // field test can actually be diagnosed instead of guessed at.
      const reason = (e && e.error) ? e.error : 'unknown';
      console.warn('Speech recognition error:', reason);
      // A quiet stretch (moving between rooms, phone in a pocket) is not a
      // reason to stop: onend opens a fresh session and keeps listening.
      if (reason === 'no-speech' || reason === 'aborted') return;
      const messages = {
        'network': 'No signal for voice recording. Tap the box and use your keyboard\'s mic to dictate instead — the note will be saved and filled in when you\'re back online.',
        'audio-capture': 'Microphone not available — check mic permission and that no other app is using it.',
        'not-allowed': 'Microphone permission denied — enable it in your browser/device settings.',
        'service-not-allowed': 'Speech service not allowed — check your browser/device permissions.',
        'language-not-supported': 'This device doesn\'t support en-AU speech recognition.',
      };
      showToast(messages[reason] || `Speech recognition stopped (${reason})`, 'error');
      stopRecording();
    };
    recognition.onend = () => {
      if (!isRecording) return;
      let kept = correctKnownMishearings(pendingInterim).trim();
      pendingInterim = '';
      if (kept) {
        const stopAt = kept.search(VOICE_STOP_RE);
        if (stopAt >= 0) kept = kept.slice(0, stopAt).trim();
        if (kept) currentTranscript += kept + ' ';
        document.getElementById('transcriptBox').textContent = currentTranscript;
        if (stopAt >= 0) {
          stopRecording();
          playTone(440, 200, 0.2);
          setTimeout(() => { if (!isRecording && currentTranscript.trim()) processTranscript(); }, 2100);
          return;
        }
      }
      quickEnds = Date.now() - startedAt < 1500 ? quickEnds + 1 : 0;
      if (quickEnds >= 5) { showToast('Recording stopped: the microphone kept dropping out', 'error'); stopRecording(); return; }
      try { listen(); } catch (e) { stopRecording(); }
    };
    recognition.start();
  };
  whisperFallbackListen = SR ? () => { try { listen(); } catch (e) { stopRecording(); } } : null;
  if (useWhisper) {
    recognition = null;
    startWhisperListening().catch(err => { console.warn('Whisper listening could not start:', err && err.message); stopWhisperListening(); return false; }).then(ok => {
      if (ok || !isRecording) return;
      if (whisperFallbackListen) whisperFallbackListen(); else stopRecording();
    });
  } else listen();
  holdScreenAwake();
  setPocketLock(true);
  isRecording = true;
  updateVoiceHud();
  document.getElementById('voiceBtn').classList.add('recording');
  document.getElementById('voiceBtnText').textContent = 'Recording… Tap to Stop';
  document.getElementById('waveform').classList.add('show');
  driveWave(true);
  document.getElementById('extractBtn').disabled = true;

  // EXPERIMENTAL, opt-in (see the state-declaration comment above) — started
  // AFTER recognition.start() so the primary, working dictation path is
  // already underway before this second, unproven mic consumer gets
  // involved at all. Fire-and-forget: startAudioCapture() handles its own
  // errors internally and never throws. Not needed while Whisper is
  // already listening.
  if (!useWhisper) startAudioCapture();
}

// Resolves once recognition has delivered its last result. Web Speech
// sends the final phrase in onresult AFTER stop(), so anything that reads
// currentTranscript right after stopping misses it. Falls back after 2s in
// case onend never fires (e.g. stop() after an error already ended it).
function waitForRecognitionEnd(rec) {
  if (!rec) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(resolve, 2000);
    rec.onend = () => { clearTimeout(timer); resolve(); };
  });
}

// Pocket lock: while recording, a shield under the voice popover takes
// every touch, so the page behind can't be scrolled or tapped from a pocket,
// the transcript box can't be typed into and the popover's close button is
// hidden. A tap on Stop (or "Stop Sayon") ends the recording.
function setPocketLock(on) {
  const shield = document.getElementById('pocketShield');
  if (shield) shield.hidden = !on;
  document.body.classList.toggle('pocket-lock', on);
  const box = document.getElementById('transcriptBox');
  if (box) box.setAttribute('contenteditable', on ? 'false' : 'true');
  if (on && document.activeElement && document.activeElement.blur) document.activeElement.blur();
}
document.getElementById('pocketShield')?.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

// The screen stays on while recording: a phone that locks itself in a
// pocket stops hearing, because the browser drops the mic.
let screenWakeLock = null;
async function holdScreenAwake() {
  try { if (navigator.wakeLock && !screenWakeLock) { screenWakeLock = await navigator.wakeLock.request('screen'); screenWakeLock.addEventListener('release', () => { screenWakeLock = null; }); } } catch (e) {}
}
function releaseScreenAwake() {
  try { if (screenWakeLock) screenWakeLock.release(); } catch (e) {}
  screenWakeLock = null;
}
// The lock is let go whenever the app is hidden, so take it again on return.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && isRecording) holdScreenAwake(); });

function stopRecording() {
  stopWhisperListening();
  releaseScreenAwake();
  setPocketLock(false);
  const recognitionEnded = waitForRecognitionEnd(recognition);
  if (recognition) recognition.stop();
  isRecording = false;
  updateVoiceHud();
  document.getElementById('voiceBtn').classList.remove('recording');
  document.getElementById('voiceBtnText').textContent = 'Tap to Speak';
  document.getElementById('waveform').classList.remove('show');
  driveWave(false);
  if (currentTranscript.trim()) document.getElementById('extractBtn').disabled = false;
  recognitionEnded.then(() => {
    if (!isRecording && currentTranscript.trim()) document.getElementById('extractBtn').disabled = false;
  });

  // EXPERIMENTAL, opt-in — everything above this point has already
  // completed exactly as it always has, regardless of what happens below.
  // This resolves in the background and, on a clean result, offers it as a
  // suggestion (see tryServerSideTranscription). Any failure is silent.
  // The snapshot that showServerTranscriptionSuggestion() compares against
  // is taken only after the last phrase has landed - taken earlier, that
  // late phrase made the transcript "changed" and the suggestion was
  // silently dropped.
  if (audioCaptureEnabled && !audioCaptureFailedThisSession) {
    const before = recordingStartText;
    Promise.all([stopAudioCapture(), recognitionEnded]).then(([blob]) => {
      if (isRecording) return;
      serverTranscriptOriginalText = currentTranscript;
      tryServerSideTranscription(blob, before);
    });
  } else {
    stopAudioCaptureTracks();
  }
}

// ── MANUAL TRANSCRIPT EDITING ────────────────────────────────────────────
// The transcript box is editable directly (not just filled by voice), so
// extraction can be tested or used without a working microphone, and so a
// technician can quickly fix a mis-heard word or type in a noisy/quiet
// environment instead of speaking.
function clearTranscriptPlaceholderIfNeeded(el) {
  if (!el.classList.contains('active')) el.textContent = '';
}

// Paste as plain text: a copy from a web page or document would otherwise
// bring its font and highlight into the box.
function onTranscriptPaste(e) {
  const text = (e.clipboardData || window.clipboardData).getData('text/plain');
  if (!text) return;
  e.preventDefault();
  document.execCommand('insertText', false, text);
}

function onTranscriptEdited(el) {
  currentTranscript = el.textContent;
  const hasText = currentTranscript.trim().length > 0;
  el.classList.toggle('active', hasText);
  const extractBtn = document.getElementById('extractBtn');
  if (extractBtn) extractBtn.disabled = !hasText;
  saveDraft();
}

// ── QUICK PHRASES ────────────────────────────────────────────────────────
// A short, curated set of sentences to tap in when speaking isn't practical.
// They are worded the way an inspector would say them, so Extract reads them
// like dictation and nothing else in the chain changes. Keep them free of
// severity words, species risk and structural verdicts.
const QUICK_PHRASES = [
  { group: 'Roof void', phrases: [
    'Roof void inspected, no termite activity or damage seen in the roof void.',
    'Roof void inspection limited by insulation.',
    'Roof void inspection limited by low clearance at the eaves.',
    'Sarking prevented a full inspection of the roof timbers.',
    'No roof void access hatch found.',
  ]},
  { group: 'Subfloor', phrases: [
    'Subfloor inspected, no live termites, workings or damage seen.',
    'Subfloor inspection limited by low clearance in parts.',
    'Ant caps missing or damaged on some piers.',
    'Subfloor ventilation is poor.',
  ]},
  { group: 'Outside', phrases: [
    'Garden beds built up against the walls above the slab edge.',
    'Slab edge covered and unable to be inspected.',
    'Weep holes covered by soil or paving.',
    'Timber in contact with the ground.',
  ]},
  { group: 'Inside', phrases: [
    'Interior inspected, no termite activity or damage seen.',
    'Furniture and floor coverings limited the interior inspection.',
    'Moisture meter readings normal throughout.',
  ]},
];

function renderQuickPhrases() {
  const list = document.getElementById('quickPhrasesList');
  if (!list || list.childElementCount) return;
  list.innerHTML = QUICK_PHRASES.map(g => `
    <div class="quick-phrases-group">${g.group}</div>
    <div class="quick-phrases-row">${g.phrases.map(p =>
      `<button type="button" class="quick-phrase" onclick="addQuickPhrase(this)">${p}</button>`).join('')}</div>`).join('');
}

function addQuickPhrase(btn) {
  const box = document.getElementById('transcriptBox');
  if (!box) return;
  const text = btn.textContent.trim();
  const before = box.classList.contains('active') ? (currentTranscript || '').trim() : '';
  box.textContent = before ? before + ' ' + text : text;
  onTranscriptEdited(box);
  btn.classList.add('added');
  setTimeout(() => btn.classList.remove('added'), 900);
}

document.addEventListener('DOMContentLoaded', renderQuickPhrases);

function usePrompt(el) {
  // Make sure the popover is in default (extraction) mode, not notes-dictation mode
  if (activeNotesTargetKey) resetVoicePopoverToDefault();

  const popover = document.getElementById('voicePopover');
  const fab = document.getElementById('micFab');
  if (!popover.classList.contains('open')) {
    popover.classList.add('open');
    showTestModeBadge();
    fab.classList.add('open');
  }

  currentTranscript = el.dataset.prompt;
  const box = document.getElementById('transcriptBox');
  box.textContent = currentTranscript;
  box.classList.add('active');
  document.getElementById('extractBtn').disabled = false;
}

// ══════════════════════════════════════════════════════════════════════════
// VOICE STOP WORDS
// ══════════════════════════════════════════════════════════════════════════
// One voice button. Recording carries on until a tap on Stop or "stop
// Sayon". The report is filled once, from the whole note: "stop Sayon"
// fills it straight away, and after a tap the note waits in the box for
// Extract, so it can be checked first. Filling at every pause was taken out
// on 28 Oct: on an iPhone it mangled the words that followed each fill.
// Phones punctuate and mishear the name ("Stop. Simon.", "stop saying"),
// so the words can be split by punctuation and "Sayon" has its common
// mishearings. It's checked on the live (interim) text as well as the
// final text, because some phones only finalise a phrase after a pause.
const VOICE_STOP_LIVE_RE = /\b(?:stop|done|pause|finish)[\s,.!?-]+(?:sayon|say on|sayan|saying|sayin|zion|sion|xion|scion|simon|sean|shaun|cyan|saigon|siam)\b|\bstop listening\b/i;
// "Stops on" and "stop son" (how a phone heard it in the 25 Oct pocket
// test) are ordinary words too ("the lead stops on the bearer"), so they
// only count as the last words of a finished phrase, never in live text.
const VOICE_STOP_RE = new RegExp(VOICE_STOP_LIVE_RE.source + '|\\bstops?[\\s,.!?-]+(?:on|son)[\\s,.!?]*$', 'i');
// ── Soft audio tone: a beep the inspector hears with the phone in a pocket ──
function playTone(freq = 880, duration = 120, vol = 0.3) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration/1000);
    osc.start(); osc.stop(ctx.currentTime + duration/1000);
    setTimeout(() => ctx.close(), duration + 100);
  } catch(e) {}
}

// ── VOICE HUD ─────────────────────────────────────────────────────────────
// A border round the whole screen, so the inspector can tell from the
// corner of their eye what the app is doing without reading anything:
//   listening the mic is taking a note: thick, slow pulse
//   thinking  the AI is filling the report: thick, fast pulse
// Read from the existing state (isRecording, the AI busy flag); nothing
// here changes how voice or extraction work.
function updateVoiceHud() {
  let state = '';
  if (isRecording) state = 'listening';
  else if (document.body.classList.contains('ai-busy')) state = 'thinking';
  if (state) document.body.dataset.voice = state;
  else delete document.body.dataset.voice;
  syncDockTalk(state);
}

// Talk in the bottom dock follows the voice state: the time while it
// listens (and Stop to tap). Which word shows (Talk, Close, Filling,
// Stop) is css, read off the same state.
let dockTalkTimer = 0, dockTalkStart = 0;
function syncDockTalk(state) {
  const fab = document.getElementById('micFab');
  const time = document.getElementById('micFabTime');
  if (!fab) return;
  const listening = state === 'listening';
  fab.classList.toggle('recording', listening);
  clearInterval(dockTalkTimer);
  if (listening) {
    if (!dockTalkStart) dockTalkStart = Date.now();
    const tick = () => {
      const sec = Math.floor((Date.now() - dockTalkStart) / 1000);
      if (time) time.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    };
    tick();
    dockTalkTimer = setInterval(tick, 1000);
  } else dockTalkStart = 0;
  fab.setAttribute('aria-label', listening ? 'Stop recording' : fab.classList.contains('open') ? 'Close the voice panel' : 'Talk');
}

let pendingSpeciesMatch = null; // holds the confirmed species match to apply

function triggerSpeciesIntelligence(rawSpeciesValue) {
  const match = lookupSpecies(rawSpeciesValue);
  if (!match) return;

  pendingSpeciesMatch = match;

  // Show confirmation prompt
  const confirm = document.getElementById('speciesConfirm');
  const confirmName = document.getElementById('speciesConfirmName');
  if (confirm && confirmName) {
    confirmName.textContent = match.name;
    confirm.style.display = 'block';
    confirm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function confirmSpecies() {
  if (!pendingSpeciesMatch) return;

  const { name, data } = pendingSpeciesMatch;

  // Hide confirm, show intelligence panel
  document.getElementById('speciesConfirm').style.display = 'none';
  showSpeciesIntel(name, data);

  pendingSpeciesMatch = null;
}

function dismissSpeciesConfirm() {
  document.getElementById('speciesConfirm').style.display = 'none';
  pendingSpeciesMatch = null;
}

function closeSpeciesIntel() {
  document.getElementById('speciesIntel').style.display = 'none';
}

function showSpeciesIntel(name, data) {
  const panel = document.getElementById('speciesIntel');
  const title = document.getElementById('speciesIntelName');
  const body = document.getElementById('speciesIntelBody');
  if (!panel || !body) return;

  title.textContent = name + (data.commonName ? ' — ' + data.commonName : '');
  body.innerHTML = buildSpeciesIntelHTML(data);
  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function buildSpeciesIntelHTML(data) {
  let html = '';

  // On-site field identification — rendered first, most useful in the moment
  if (data.fieldID && data.fieldID.length > 0) {
    html += `<div class="intel-section intel-section-field-id">
      <div class="intel-section-title">🔍 On Site — What to Look For</div>
      <div class="intel-list">`;
    data.fieldID.forEach(item => {
      html += `<div class="intel-item intel-field-id-item">${item}</div>`;
    });
    html += `</div></div>`;
  }

  // Special flags (warnings, danger notices)
  if (data.specialFlags && data.specialFlags.length > 0) {
    data.specialFlags.forEach(flag => {
      html += `
        <div class="species-flag ${flag.type}">
          <span class="species-flag-icon">${flag.icon}</span>
          <span class="species-flag-text">${flag.text}</span>
        </div>`;
    });
  }

  // Identification markers
  if (data.identification && data.identification.length > 0) {
    html += `<div class="intel-section">
      <div class="intel-section-title">Identification</div>
      <div class="intel-list">`;
    data.identification.forEach(item => {
      html += `<div class="intel-item">${item}</div>`;
    });
    html += `</div></div>`;
  }

  // Nest locations
  if (data.nestTypes && data.nestTypes.length > 0) {
    html += `<div class="intel-section">
      <div class="intel-section-title">Nest Locations</div>
      <div class="intel-list">`;
    data.nestTypes.forEach(item => {
      html += `<div class="intel-item">${item}</div>`;
    });
    html += `</div></div>`;
  }

  // Behaviour
  if (data.behaviour && data.behaviour.length > 0) {
    html += `<div class="intel-section">
      <div class="intel-section-title">Behaviour</div>
      <div class="intel-list">`;
    data.behaviour.forEach(item => {
      html += `<div class="intel-item">${item}</div>`;
    });
    html += `</div></div>`;
  }

  // Treatment options
  if (data.treatmentOptions && data.treatmentOptions.length > 0) {
    html += `<div class="intel-section">
      <div class="intel-section-title">Treatment Options</div>
      <div class="intel-treatments">`;
    data.treatmentOptions.forEach(opt => {
      html += `<div class="intel-treatment">
        <div class="intel-treatment-header">
          <span class="intel-treatment-product">${opt.product}</span>
          <span class="intel-treatment-type">${opt.type}</span>
        </div>
        <div class="intel-treatment-notes">${opt.notes}</div>
        <div class="intel-treatment-toxicity">Toxicity: ${opt.toxicity}</div>
      </div>`;
    });
    html += `</div></div>`;
  }

  // Field note prompts
  if (data.fieldNotePrompts && data.fieldNotePrompts.length > 0) {
    html += `<div class="intel-section">
      <div class="intel-section-title">Field Note Prompts</div>
      <div class="intel-prompts">`;
    data.fieldNotePrompts.forEach(prompt => {
      html += `<div class="intel-prompt-item">${prompt}</div>`;
    });
    html += `</div></div>`;
  }

  return html;
}

// ── AI EXTRACTION ─────────────────────────────────────────────────────────
// Sends one dictated note to the AI and returns the extracted fields.
// Throws an error with .noSignal set when the phone can't reach the
// internet (offline, a dropped connection or no answer in time), and with
// .status set when the Worker refuses the call (expired sign-in, plan
// ended, usage limit). Either way the note waits rather than being lost.
const EXTRACTION_TIMEOUT_MS = 120000;

// Times each note and records how it went (never the note itself). A
// refusal the inspector can fix (sign-in, plan, usage) or no signal isn't
// a bug, so only the rest go to Sentry, as the kind of failure only: the
// Worker's answer could quote the note.
async function requestExtraction(text) {
  const started = Date.now();
  const seconds = () => Math.round((Date.now() - started) / 100) / 10;
  try {
    const parsed = await callExtraction(text);
    track('note_filled', { seconds: seconds(), words: text.split(/\s+/).filter(Boolean).length });
    saveTestNote(text, parsed, null, seconds());
    return parsed;
  } catch (err) {
    const reason = err.kept ? 'kept_for_later' : err.noSignal ? 'no_signal' : err.tooLong ? 'too_long' : err.badAnswer ? 'bad_answer'
      : err.status ? 'http_' + err.status : 'other';
    track('note_failed', { reason, seconds: seconds() });
    saveTestNote(text, null, reason, seconds());
    if (!err.noSignal && ![401, 402, 429].includes(err.status)) reportError(new Error('Extraction failed: ' + reason), 'extraction');
    throw err;
  }
}

// The fill in flight, so "Keep for later" on the busy bar can stop it.
let activeExtraction = null;
function keepNoteForLater() {
  if (!activeExtraction) return;
  activeExtraction.kept = true;
  activeExtraction.controller.abort();
}

async function callExtraction(text) {
  const noSignal = (msg) => Object.assign(new Error(msg), { noSignal: true });
  if (!navigator.onLine) throw noSignal('no signal');

  const learned = learnedPromptBlock();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTRACTION_TIMEOUT_MS);
  const mine = activeExtraction = { controller, kept: false };
  let res, rawBody;
  try {
    res = await workerFetch('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        // The model thinks before it answers, and that thinking counts
        // toward max_tokens. At 4096 and its default (high) effort, a
        // whole-house note thought for so long the JSON was cut off.
        // Medium effort keeps the thinking proportionate; the Worker caps
        // max_tokens at its own ceiling.
        max_tokens: 16000,
        output_config: { effort: 'medium' },
        // The instructions are the same for every note, so they're cached
        // for an hour: after the first note, reading them costs a tenth.
        // The other prompts are too short for the model to cache.
        // The business's own corrections follow, cached too: they change
        // only when the inspector fixes something.
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral', ttl: '1h' } }]
          .concat(learned ? [{ type: 'text', text: learned, cache_control: { type: 'ephemeral', ttl: '1h' } }] : []),
        messages: [{ role: 'user', content: text }]
      }),
      signal: controller.signal,
    });
    rawBody = await res.text();
  } catch (err) {
    // fetch() only rejects when the request never got an answer.
    if (mine.kept) throw Object.assign(noSignal('kept for later'), { kept: true });
    throw noSignal(err && err.name === 'AbortError' ? 'no answer in time' : 'no connection');
  } finally {
    clearTimeout(timer);
    if (activeExtraction === mine) activeExtraction = null;
  }

  // The worker refuses a request (expired sign-in, plan ended, usage
  // limit, failed origin check) with a plain-text body like "Forbidden"
  // rather than JSON, so parse defensively and keep the status.
  const refused = (msg) => Object.assign(new Error(msg), { status: res.status });
  let data;
  try {
    data = JSON.parse(rawBody);
  } catch {
    throw refused(`HTTP ${res.status}: ${rawBody.slice(0, 200) || '(empty response)'}`);
  }

  if (!res.ok || data.error) {
    throw refused('API error: ' + (data.error?.message || data.error?.type || `HTTP ${res.status}`));
  }

  // FIX: if the response was cut off at the token limit, say so plainly
  // instead of letting JSON.parse() below throw an opaque "Unexpected
  // EOF" that's indistinguishable from any other malformed-response bug.
  if (data.stop_reason === 'max_tokens') {
    throw Object.assign(new Error('response cut off'), { tooLong: true });
  }

  const out = data.content.map(i => i.text || '').join('');
  let parsed;
  try {
    parsed = JSON.parse(out.replace(/```json|```/g, '').trim());
  } catch (e) {
    // The model answered with something that isn't JSON. Retrying the same
    // note would most likely do the same, so this is marked as the note's
    // own problem rather than a connection one.
    throw Object.assign(new Error('the answer was not valid JSON'), { badAnswer: true });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw Object.assign(new Error('the answer was not a JSON object'), { badAnswer: true });
  }
  return parsed;
}

// ── LEARNED CORRECTIONS ───────────────────────────────────────────────────
// SAYON learns from what the inspector fixes, per business:
//   - a field the AI filled and the inspector then changed is kept with the
//     words that were said, and later notes see it as an example;
//   - a few words changed in the transcript box before filling ("peers are
//     in Cunt" to "piers ant capped") are kept as a word fix. The AI and
//     Whisper see it at once, and once the same fix has been made twice it
//     is made in the transcript box automatically.
// Stored as { fields: [{ id, key, label, said, ai, fixed, at }],
// words: [{ id, heard, meant, count, at }], removed: [ids], updatedAt },
// per business, and synced in businesses.settings.learned (business-sync.js).
// The inspector sees and can remove them in Settings > Voice.
const LEARNED_MAX_FIELDS = 30;
const LEARNED_MAX_WORDS = 40;
const LEARNED_AUTO_FIX_COUNT = 2;
const LEARNED_PROMPT_MAX_CHARS = 8000;

function learnedStorageKey() {
  return (authBusiness && authBusiness.id) ? `korva_learned_${authBusiness.id}` : 'korva_learned';
}

function getLearned() {
  let l = null;
  try { l = JSON.parse(localStorage.getItem(learnedStorageKey()) || 'null'); } catch (e) { /* unreadable: start again */ }
  if (!l || typeof l !== 'object') l = {};
  return {
    fields: Array.isArray(l.fields) ? l.fields : [],
    words: Array.isArray(l.words) ? l.words : [],
    removed: Array.isArray(l.removed) ? l.removed : [],
    updatedAt: l.updatedAt || 0,
  };
}

function storeLearned(l, { sync = true } = {}) {
  l.fields = l.fields.slice(-LEARNED_MAX_FIELDS);
  // The words fixed most often are kept, then the newest.
  l.words = l.words.sort((a, b) => (b.count - a.count) || (b.at - a.at)).slice(0, LEARNED_MAX_WORDS);
  l.removed = l.removed.slice(-200);
  if (sync) l.updatedAt = Date.now();
  try { localStorage.setItem(learnedStorageKey(), JSON.stringify(l)); } catch (e) { return; }
  if (sync && typeof scheduleBusinessSync === 'function') scheduleBusinessSync();
  renderLearnedList();
}

const learnedId = () => 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const learnedNorm = v => String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');
const learnedClip = (v, n) => { const t = String(v || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

// The sentence of a note that a field's value came from: the one sharing
// the most words with the value and the field's name. Notes from the phone's
// own speech have no full stops, so a long run is cut into 20-word pieces.
function saidAbout(transcript, words) {
  const stem = w => w.replace(/s$/, '');
  const want = new Set(keyWords(words).map(stem));
  if (!want.size || !transcript) return '';
  const parts = [];
  String(transcript).split(/(?<=[.!?])\s+/).forEach(s => {
    const w = s.split(/\s+/).filter(Boolean);
    for (let i = 0; i < w.length; i += 20) parts.push(w.slice(i, i + 24).join(' '));
  });
  let best = '', score = 0;
  parts.forEach(p => {
    const n = keyWords(p).filter(w => want.has(stem(w))).length;
    if (n > score) { score = n; best = p; }
  });
  return learnedClip(best, 200);
}

// A field's name as the inspector sees it; "What" under a side line reads
// as "Wood Decay Fungi (Rot): What".
function fieldLabelText(key) {
  const el = document.getElementById('f-' + key);
  const label = el && getFieldLabel(el);
  if (!label) return key;
  const field = el.closest('.field');
  const pairHead = field && field.closest('.field-pair')?.querySelector(':scope > .field:first-child');
  const lead = pairHead && pairHead !== field ? pairHead.querySelector('.field-label')?.textContent.trim() + ': ' : '';
  return learnedClip(lead + label.textContent, 80);
}

// Called by populateFields() for each field a note filled, with what this
// note gave it (a list-like field may also hold earlier notes' words).
function rememberAiFill(key, val, transcript) {
  if (!transcript) return;
  if (!reportData.aiFilled || typeof reportData.aiFilled !== 'object') reportData.aiFilled = {};
  const label = fieldLabelText(key);
  reportData.aiFilled[key] = { v: String(val), said: saidAbout(transcript, label + ' ' + val) };
}

// Called by commitEdit() when the inspector sets or clears a field. Adding
// to what the AI wrote isn't a correction; changing or removing it is. A
// second edit of the same fill updates its correction, and putting the AI's
// answer back removes it.
function learnFieldCorrection(key, value) {
  const fill = reportData.aiFilled && reportData.aiFilled[key];
  if (!fill) return;
  const ai = learnedNorm(fill.v), fixed = learnedNorm(value);
  const l = getLearned();
  const i = fill.cid ? l.fields.findIndex(f => f.id === fill.cid) : -1;
  if (fixed === ai || (ai.length >= 12 && fixed.includes(ai))) {
    if (i >= 0) { l.fields.splice(i, 1); delete fill.cid; storeLearned(l); }
    return;
  }
  const entry = { id: fill.cid || learnedId(), key, label: fieldLabelText(key), said: fill.said || '', ai: learnedClip(fill.v, 160), fixed: fixed ? learnedClip(value, 160) : '', at: Date.now() };
  if (i >= 0) l.fields[i] = entry;
  else {
    // The same fix made before is replaced by this one, not kept twice.
    l.fields = l.fields.filter(f => !(f.key === key && learnedNorm(f.ai) === learnedNorm(entry.ai) && learnedNorm(f.fixed) === learnedNorm(entry.fixed)));
    l.fields.push(entry);
  }
  fill.cid = entry.id;
  storeLearned(l);
}

// Where two transcripts differ, word by word: [{ from: [words], to: [words],
// before, after, toStart }] (toStart: the new words begin a sentence), from a longest-common-run match on the lowercased words.
const diffWord = w => w.toLowerCase().replace(/[^a-z0-9%'-]+/g, '');
function wordDiffHunks(a, b) {
  const A = String(a).split(/\s+/).filter(w => diffWord(w)), B = String(b).split(/\s+/).filter(w => diffWord(w));
  const x = A.map(diffWord), y = B.map(diffWord);
  if (x.length * y.length > 1500000) return [];
  const L = Array.from({ length: x.length + 1 }, () => new Uint16Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) {
    L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  }
  const hunks = [];
  let i = 0, j = 0, cur = null;
  const close = () => { if (cur) { cur.after = x[i] || ''; cur.afterTo = y[j] || ''; hunks.push(cur); cur = null; } };
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { close(); i++; j++; continue; }
    if (!cur) cur = { from: [], to: [], before: x[i - 1] || '', toStart: j === 0 || /[.!?]$/.test(B[j - 1]) };
    if (j < y.length && (i >= x.length || L[i][j + 1] >= L[i + 1][j])) cur.to.push(B[j++]);
    else cur.from.push(A[i++]);
  }
  close();
  return hunks;
}

// A word fix is a few misheard words swapped for a few others. A one-word
// fix keeps the next word with it ("bearer holes" to "borer holes"), since
// the word on its own is usually right. Numbers changed are facts
// corrected, not words misheard, so they're skipped.
function wordFixesFromEdit(heardText, typedText) {
  const fixes = [];
  wordDiffHunks(heardText, typedText).forEach(h => {
    if (!h.from.length || !h.to.length || h.from.length > 5 || h.to.length > 6) return;
    const from = h.from.map(diffWord), to = h.to.map(w => w.replace(/[.,;:!?]+$/, ''));
    if (from.join(' ') === to.map(diffWord).join(' ')) return;
    if (from.every(w => /^\d/.test(w)) || to.every(w => /^\d/.test(w))) return;
    // A capital that only starts a sentence isn't part of the fix; a
    // brand or genus keeps its own.
    if (h.toStart && !TRANSCRIPTION_VOCAB.some(v => v.toLowerCase() === diffWord(to[0]))) to[0] = to[0][0].toLowerCase() + to[0].slice(1);
    if (from.length === 1) {
      if (h.after && h.after === h.afterTo) { from.push(h.after); to.push(h.after); }
      else if (h.before) { from.unshift(h.before); to.unshift(h.before); }
      else return;
    }
    fixes.push({ heard: from.join(' '), meant: to.join(' ') });
  });
  return fixes;
}

function learnWordFixes(fixes) {
  if (!fixes.length) return;
  const l = getLearned();
  fixes.forEach(f => {
    const have = l.words.find(w => w.heard === f.heard);
    if (have && learnedNorm(have.meant) === learnedNorm(f.meant)) { have.count++; have.at = Date.now(); }
    else if (have) Object.assign(have, { meant: f.meant, count: 1, at: Date.now() });
    else l.words.push({ id: learnedId(), heard: f.heard, meant: f.meant, count: 1, at: Date.now() });
  });
  storeLearned(l);
}

// The transcript box as it was when the inspector tapped into it. What they
// changed is learned when they leave it, or when the note is filled.
let transcriptAtFocus = null;
function rememberTranscriptAtFocus(el) {
  transcriptAtFocus = el.classList.contains('active') ? el.textContent : null;
}
function learnFromTranscriptEdit() {
  if (transcriptAtFocus === null) return;
  const heard = transcriptAtFocus;
  transcriptAtFocus = null;
  if (heard.trim() && currentTranscript.trim() && heard !== currentTranscript) learnWordFixes(wordFixesFromEdit(heard, currentTranscript));
}

// Word fixes made twice are made in every transcript, the way
// correctKnownMishearings() makes its own.
function applyLearnedWordFixes(text) {
  if (!text) return text;
  let words;
  try { words = getLearned().words.filter(w => w.count >= LEARNED_AUTO_FIX_COUNT); } catch (e) { return text; }
  words.forEach(w => {
    const parts = String(w.heard).split(' ').filter(Boolean).map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!parts.length) return;
    const re = new RegExp('(^|[^a-z0-9])(' + parts.join('[\\s,.]+') + ')(?![a-z0-9])', 'gi');
    text = text.replace(re, (m, pre, hit, at, all) => {
      const start = /^\s*$|[.!?]\s+$/.test(all.slice(0, at + pre.length));
      return pre + (start ? w.meant[0].toUpperCase() + w.meant.slice(1) : w.meant);
    });
  });
  return text;
}

// The business's corrections, as a second block of instructions for the
// extraction. Newest last, and cut to a size that keeps every call cheap.
function learnedPromptBlock() {
  const l = getLearned();
  if (!l.fields.length && !l.words.length) return '';
  const lines = [];
  if (l.words.length) {
    lines.push('Words the phone misheard for this business (heard → meant):');
    l.words.forEach(w => lines.push(`- "${w.heard}" → "${w.meant}"`));
  }
  if (l.fields.length) {
    lines.push('Fields the inspector corrected after you filled them (the words said, what you filled, what it should have been):');
    l.fields.slice().reverse().forEach(f => {
      lines.push(`- ${f.label}.${f.said ? ` Said: "${f.said}".` : ''} You filled: "${f.ai}". Corrected to: ${f.fixed ? `"${f.fixed}"` : 'left blank'}.`);
    });
  }
  let body = '';
  for (const line of lines) {
    if (body.length + line.length + 1 > LEARNED_PROMPT_MAX_CHARS) break;
    body += line + '\n';
  }
  return 'THIS BUSINESS\'S OWN CORRECTIONS\nThe inspectors at this business fixed these after earlier notes. Learn from them: they show the words the phone mishears for their voices and how they want things recorded. When this note has the same words in the same kind of sentence, follow the correction. They come from earlier jobs: take nothing from them as a fact about this note.\n' + body.trim();
}

// The words the inspector corrected to, for Whisper's word hint.
function learnedHintWords(maxChars) {
  let out = '';
  getLearned().words.forEach(w => {
    const add = (out ? ', ' : '') + w.meant;
    if (out.length + add.length <= maxChars) out += add;
  });
  return out;
}

// Settings > Voice: what SAYON has learned, each with a Remove.
function renderLearnedList() {
  const list = document.getElementById('learnedList');
  if (!list) return;
  const l = getLearned();
  const forget = document.getElementById('learnedForgetAll');
  if (forget) forget.hidden = !(l.fields.length || l.words.length);
  if (!l.fields.length && !l.words.length) {
    list.innerHTML = '<div class="learned-empty">Nothing yet. Fix a word in the transcript box, or a box the AI filled, and it shows here.</div>';
    return;
  }
  const row = (id, text, note) => `<div class="learned-row"><div class="learned-text">${text}${note ? `<span class="learned-note">${note}</span>` : ''}</div><button type="button" class="link-btn learned-remove" onclick="forgetLearned('${id}')" aria-label="Remove">Remove</button></div>`;
  list.innerHTML =
    l.words.map(w => row(w.id, `"${escapeHtml(w.heard)}" is "${escapeHtml(w.meant)}"`,
      w.count >= LEARNED_AUTO_FIX_COUNT ? 'Fixed automatically' : 'Fix it once more and it’s fixed automatically')).join('') +
    l.fields.slice().reverse().map(f => row(f.id, `${escapeHtml(f.label)}: "${escapeHtml(f.ai)}" is ${f.fixed ? `"${escapeHtml(f.fixed)}"` : 'left blank'}`,
      f.said ? `When you said "${escapeHtml(learnedClip(f.said, 90))}"` : '')).join('');
}

function forgetLearned(id) {
  const l = getLearned();
  l.fields = l.fields.filter(f => f.id !== id);
  l.words = l.words.filter(w => w.id !== id);
  l.removed.push(id);
  storeLearned(l);
}

function forgetAllLearned() {
  if (!confirm('Forget everything SAYON has learned from your corrections?')) return;
  const l = getLearned();
  l.removed.push(...l.fields.map(f => f.id), ...l.words.map(w => w.id));
  l.fields = []; l.words = [];
  storeLearned(l);
  showToast('Forgotten', 'info');
}

// Two copies of what was learned (the account's and this phone's) put
// together: every correction either has, less any removed on either.
function mergeLearned(a, b) {
  const removed = [...new Set([...(a.removed || []), ...(b.removed || [])])];
  const gone = new Set(removed);
  const byId = (lists, pick) => {
    const m = new Map();
    lists.flat().forEach(e => { if (e && e.id && !gone.has(e.id)) { const h = m.get(e.id); m.set(e.id, h ? pick(h, e) : e); } });
    return [...m.values()];
  };
  return {
    fields: byId([a.fields || [], b.fields || []], (x, y) => (y.at > x.at ? y : x)).sort((x, y) => x.at - y.at),
    words: byId([a.words || [], b.words || []], (x, y) => ((y.count > x.count || (y.count === x.count && y.at > x.at)) ? y : x)),
    removed,
    updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0),
  };
}

// ── TEST MODE ─────────────────────────────────────────────────────────────
// Owner-only switch in Settings. While it's on, every note sent to the
// AI is saved to the owner's own Supabase table (supabase/test-notes.sql)
// with what came back, so a batch of real recordings can be scored on
// tests/extraction later. It never goes near Sentry or PostHog, and a failed
// save is dropped silently: testing must never get in the way of the report.
const TEST_MODE_KEY = 'korva_test_mode';

// The switch is for checking the AI on a business set up for it
// (businesses.settings.testMode), not for every customer.
function testModeAllowed() {
  return isBusinessOwner() && !!(authBusiness && authBusiness.settings && authBusiness.settings.testMode);
}
function testModeOn() {
  try { return localStorage.getItem(TEST_MODE_KEY) === '1' && testModeAllowed(); } catch (e) { return false; }
}

function saveTestNote(transcript, extraction, problem, seconds) {
  if (!testModeOn() || !navigator.onLine) return;
  fetch(`${SUPABASE_URL}/rest/v1/test_notes`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Prefer': 'return=minimal' }),
    body: JSON.stringify({ transcript: String(transcript).slice(0, 100000), extraction, problem, seconds }),
  }).catch(() => {});
}

function toggleTestMode() {
  try { localStorage.setItem(TEST_MODE_KEY, testModeOn() ? '0' : '1'); } catch (e) {}
  restoreTestModeSetting();
}

// A label on the mic popup, so the owner can see before recording that
// this browser will save the note (the switch is kept per browser).
function showTestModeBadge() {
  const badge = document.getElementById('testModeBadge');
  if (badge) badge.hidden = !testModeOn();
}

// The row only shows where test mode is allowed (see testModeAllowed).
function restoreTestModeSetting() {
  const row = document.getElementById('testModeRow');
  if (row) row.hidden = !testModeAllowed();
  const btn = document.getElementById('toggleTestMode');
  if (btn) {
    const on = testModeOn();
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
  }
}

// A problem that belongs to one note (too long, an unreadable answer) and
// would repeat on every retry, as opposed to the signal, the sign-in or the
// plan, which affect every note and clear up on their own.
function isNoteSpecificProblem(err) {
  return !!(err && (err.tooLong || err.badAnswer || err.status === 413));
}

// What the inspector reads when the AI can't fill in a note. The note is
// kept either way, so this says why and what to do about it.
function extractionProblem(err) {
  switch (err && err.status) {
    case 401: return 'Your sign-in has expired. Close SAYON, open it again and sign in';
    case 403: return 'Your account is still being set up. Close SAYON and open it again';
    case 402: return 'Your SAYON plan has ended. Subscribe in Menu › Billing';
    case 429: return 'This month\'s AI fills are used up. Your note is kept. Upgrade in Menu › Billing, or they come back on the 1st';
    case 413: return 'A note is too long for the AI in one go. Delete it and say it again in shorter parts';
  }
  if (err && err.tooLong) return 'A note is too long for the AI in one go. Delete it and say it again in shorter parts';
  if (err && err.badAnswer) return 'The AI\'s answer couldn\'t be read. Delete the note and say it again, or type it';
  const reason = ((err && err.message) ? String(err.message) : 'unknown error').slice(0, 140);
  return `The AI couldn't read it (${reason})`;
}

// whileRecording: a fill while the mic is still on. It reads the
// note as it stood when it started; words spoken during the AI call stay in
// the box for the next fill, and the voice popover and the after-Extract
// sheet stay out of the way. Returns true when the report was filled.
// A note sent from one job whose answer came back after another job was
// opened. It goes back to its own job as a waiting note, which fills in
// when that job is next opened. A job never saved stays in the box.
function noteForEarlierJob(target, note) {
  const id = savedIdFor.get(target);
  const reports = getSavedReports();
  const entry = id && reports.find(r => r.id === id);
  setAI('ready', 'AI ready');
  if (!isRecording) document.getElementById('extractBtn').disabled = false;
  if (!entry) {
    showToast('You changed job while that note was filling in, so it is still in the box', 'info');
    return;
  }
  const notes = Array.isArray(entry.reportData.pendingNotes) ? entry.reportData.pendingNotes : [];
  entry.reportData.pendingNotes = [...notes, { id: 'note_' + Date.now().toString(36), text: note.trim(), at: Date.now() }];
  entry.savedAt = Date.now();
  if (!setSavedReports(reports)) return;
  supabaseSave(entry, true);
  keepFilledNote(note);
  currentTranscript = currentTranscript.startsWith(note) ? currentTranscript.slice(note.length).trimStart() : '';
  saveDraft();
  const box = document.getElementById('transcriptBox');
  box.textContent = currentTranscript || 'Tap the mic and start speaking, or tap here to type instead.';
  box.classList.toggle('active', !!currentTranscript);
  showToast(`That note will fill in ${entry.address || 'the last job'} next time you open it`, 'info');
}

// A note that has gone into the report leaves the box, so it isn't sent
// twice, but stays readable above it until the job changes.
function keepFilledNote(note) {
  const text = String(note || '').trim();
  const wrap = document.getElementById('transcriptDone');
  if (!text || !wrap) return;
  const body = wrap.querySelector('.transcript-done-text');
  body.textContent = (body.textContent ? body.textContent + ' ' : '') + text;
  wrap.hidden = false;
}

function clearFilledNotes() {
  voiceJobEpoch++; // words still with Whisper belong to the old job
  const wrap = document.getElementById('transcriptDone');
  if (!wrap) return;
  wrap.querySelector('.transcript-done-text').textContent = '';
  wrap.hidden = true;
}

let fillRunning = false, fillAgain = false;
async function processTranscript(opts) {
  // One fill at a time, so the same words are never sent twice. A fill
  // asked for meanwhile runs after, on whatever words are left.
  if (fillRunning) { fillAgain = true; return false; }
  fillRunning = true;
  try { return await runFill(opts); }
  finally {
    fillRunning = false;
    if (fillAgain) {
      fillAgain = false;
      if (!isRecording && currentTranscript.trim()) setTimeout(() => processTranscript(), 0);
    }
  }
}

async function runFill({ whileRecording = false } = {}) {
  // The last phrase may still be with Whisper.
  if (!whileRecording) await whisperSettled();
  learnFromTranscriptEdit();
  const note = currentTranscript;
  if (!note.trim()) return false;
  setAI('thinking', 'Filling in the report from your note...');
  document.getElementById('extractBtn').disabled = true;
  const before = extractSnapshot();
  const fillTarget = reportData;
  let extracted = false;

  try {
    // Notes fill the report in the order they were dictated. If earlier
    // notes are still waiting (no signal in the subfloor, say), this one
    // joins the queue behind them and the queue is run, so an older note
    // can never land on top of a newer one and overwrite it.
    if (getPendingNotes().length && navigator.onLine) {
      if (!queuePendingNote(note)) {
        setAI('ready', 'AI ready');
        if (!isRecording) document.getElementById('extractBtn').disabled = false;
        return false;
      }
      extractSummaryOwned = true;
      try { await processPendingNotes(true); } finally { extractSummaryOwned = false; }
      extracted = !getPendingNotes().length;
    } else {
      const data = await requestExtraction(note);
      if (reportData !== fillTarget) { noteForEarlierJob(fillTarget, note); return false; }
      await populateFields(data, note);
      extracted = true;
      pendingNotesProblem = null;
      setAI('ready', 'Data extracted');
      // The after-Extract sheet says what was filled, so no toast here.
    }
  } catch (err) {
    // A note too long to answer in one go would fail the same way every
    // time, so it stays in the box to be split up.
    if (err.tooLong || err.status === 413) {
      setAI('ready', 'AI ready');
      if (!isRecording) document.getElementById('extractBtn').disabled = false;
      showToast('That note is too long for the AI in one go. Split it into shorter notes and extract each one', 'error');
      return false;
    }
    // Nothing is guessed from the note: it waits with any others until the
    // AI can read it. A problem of the note's own (an unreadable answer) is
    // written on the note, so the queue skips it instead of stopping.
    pendingNotesProblem = (err.noSignal || isNoteSpecificProblem(err)) ? null : extractionProblem(err);
    if (reportData !== fillTarget) { noteForEarlierJob(fillTarget, note); return false; }
    if (!queuePendingNote(note)) {
      setAI('ready', 'AI ready');
      if (!isRecording) document.getElementById('extractBtn').disabled = false;
      return false;
    }
    if (err.kept) {
      setAI('ready', 'Note saved');
      showToast('Note saved under Waiting notes. Tap Fill in now when you\'re ready', 'info');
    } else if (isNoteSpecificProblem(err)) {
      const waiting = getPendingNotes()[getPendingNotes().length - 1];
      if (waiting) { waiting.problem = extractionProblem(err); saveDraft(); renderPendingNotes(); }
      setAI('ready', 'Note saved');
      showToast(`${extractionProblem(err)}. Your note is saved under Waiting notes.`, 'error');
    } else if (err.noSignal) {
      setAI('ready', 'Saved until there\'s signal');
      showToast('No signal — note saved. It will fill in the report when you\'re back online.', 'info');
    } else {
      setAI('ready', 'Note saved');
      showToast(`${pendingNotesProblem}. Your note is saved and will fill in once that's sorted.`, 'error');
    }
  }

  // On a phone the popover closes to show the filled report, unless the
  // inspector is already dictating again or has closed it themselves.
  if (window.innerWidth <= 768 && !whileRecording && !isRecording && document.getElementById('voicePopover').classList.contains('open')) toggleVoicePopover();
  keepFilledNote(note);
  currentTranscript = currentTranscript.startsWith(note) ? currentTranscript.slice(note.length).trimStart() : '';
  saveDraft();
  const box = document.getElementById('transcriptBox');
  box.textContent = currentTranscript || 'Tap the mic and start speaking, or tap here to type instead.';
  box.classList.toggle('active', !!currentTranscript);
  lowConfidenceFlagged = false;
  const warnElDone = document.getElementById('lowConfidenceWarning');
  if (warnElDone) warnElDone.classList.remove('show');
  dismissCleanupSuggestion();
  dismissServerTranscript();
  if (extracted && whileRecording) {
    const n = countExtractFilled(before);
    if (n) showToast(`Filled ${n} field${n !== 1 ? 's' : ''}. Still listening`, 'info');
  } else if (extracted) showExtractSummary(before);
  return extracted;
}

// ── WAITING NOTES ───────────────────────────────────────────────────────
// A dictated note the AI can't read yet waits on the report in
// reportData.pendingNotes, so it's saved with the draft and the saved
// report. That's usually no signal (subfloors, roof voids, regional jobs),
// but can also be a refused call (plan ended, expired sign-in). It's sent
// again when the phone is back online, the app is reopened or the
// inspector taps Fill in now. Nothing is filled in from it until the AI
// reads it: a guessed answer in a report is worse than a blank one.
const MAX_PENDING_NOTES = 50;
let pendingNotesRunning = false;
let pendingNotesProblem = null; // why the AI last refused; null means no signal

function getPendingNotes() {
  return Array.isArray(reportData.pendingNotes) ? reportData.pendingNotes : [];
}

function queuePendingNote(text) {
  const notes = getPendingNotes();
  if (notes.length >= MAX_PENDING_NOTES) {
    showToast(`${MAX_PENDING_NOTES} notes are already waiting — fill those in before adding more`, 'error');
    return false;
  }
  const id = 'note_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  reportData.pendingNotes = [...notes, { id, text: text.trim(), at: Date.now() }];
  saveDraft();
  renderPendingNotes();
  return true;
}

function removePendingNote(id) {
  if (!confirm('Delete this saved note? It hasn\'t been added to the report yet.')) return;
  reportData.pendingNotes = getPendingNotes().filter(n => n.id !== id);
  if (!reportData.pendingNotes.length) delete reportData.pendingNotes;
  saveDraft();
  renderPendingNotes();
}

function renderPendingNotes() {
  const notes = getPendingNotes();
  const n = notes.length;
  const badge = document.getElementById('pendingNotesBadge');
  if (badge) { badge.textContent = n; badge.style.display = n ? '' : 'none'; }
  const bar = document.getElementById('pendingNotesBar');
  if (!bar) return;
  bar.style.display = n ? '' : 'none';
  document.getElementById('pendingNotesText').textContent = pendingNotesProblem
    ? `${n} note${n !== 1 ? 's' : ''} waiting. ${pendingNotesProblem}`
    : `${n} note${n !== 1 ? 's' : ''} waiting for signal`;
  const btn = document.getElementById('pendingNotesBtn');
  btn.disabled = pendingNotesRunning;
  btn.textContent = pendingNotesRunning ? 'Filling in…' : 'Fill in now';
  document.getElementById('pendingNotesList').innerHTML = notes.map(note => {
    const time = new Date(note.at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
    // A note with its own problem (too long, unreadable answer) is skipped
    // by the queue and shows why, so the inspector can delete and redo it
    // while the notes behind it still fill in.
    const problem = note.problem ? `<span class="pending-note-text" style="color:var(--risk)">${escapeHtml(note.problem)}</span>` : '';
    return `<div class="pending-note">
      <span class="pending-note-time">${time}</span>
      <span class="pending-note-text">${escapeHtml(note.text)}</span>${problem}
      <button class="pending-note-remove" onclick="removePendingNote('${note.id}')" title="Delete note" aria-label="Delete note">✕</button>
    </div>`;
  }).join('');
}

// Sends the open report's waiting notes to the AI, oldest first. Stops if
// the signal drops again or a different report is opened part-way through,
// so a note can only ever fill in the report it was dictated on.
async function processPendingNotes(manual) {
  if (pendingNotesRunning || !getPendingNotes().length || isReportLocked()) return;
  if (!navigator.onLine) {
    if (manual) showToast('Still no signal — the notes will fill in when you\'re back online', 'info');
    return;
  }
  const target = reportData;
  const before = extractSnapshot();
  pendingNotesRunning = true;
  renderPendingNotes();
  setAI('thinking', 'Filling in saved notes...');
  let filled = 0, stillNoSignal = false, stuck = 0, kept = false;
  try {
    // Oldest first. A note with a problem of its own (too long, an answer
    // that isn't JSON) is marked and skipped so it can't block the notes
    // behind it; a problem that would hit every note (no signal, sign-in,
    // plan) stops the run.
    const skip = new Set();
    for (let note = getPendingNotes().find(n => !skip.has(n.id)); note && reportData === target; note = getPendingNotes().find(n => !skip.has(n.id))) {
      let extracted;
      try {
        extracted = await requestExtraction(note.text);
      } catch (err) {
        if (err.kept) { kept = true; break; }
        if (err.noSignal) { stillNoSignal = true; break; }
        if (isNoteSpecificProblem(err)) {
          note.problem = extractionProblem(err);
          skip.add(note.id);
          stuck++;
          saveDraft();
          continue;
        }
        pendingNotesProblem = extractionProblem(err);
        if (manual) showToast(`${pendingNotesProblem}. Your notes are still saved.`, 'error');
        break;
      }
      pendingNotesProblem = null;
      if (reportData !== target) break;
      // Wait for the staggered field writes, so the saves below hold them.
      await populateFields(extracted, note.text);
      if (reportData !== target) break;
      reportData.pendingNotes = getPendingNotes().filter(n => n.id !== note.id);
      filled++;
      saveDraft();
    }
  } finally {
    pendingNotesRunning = false;
    if (reportData === target && !getPendingNotes().length) delete reportData.pendingNotes;
    renderPendingNotes();
    setAI('ready', 'AI ready');
  }
  // A report that's already in Saved Reports is re-saved, so its copy
  // there doesn't keep the notes and fill them in a second time.
  if (filled && reportData === target && currentReportId && getSavedReports().some(r => r.id === currentReportId)) {
    saveCurrentReport(true);
  }
  if (filled) showToast(`${filled} saved note${filled !== 1 ? 's' : ''} filled in — check the report`, 'success');
  // Fill in now shows what the notes filled; processTranscript() shows its
  // own sheet when it ran the queue.
  if (filled && manual && !extractSummaryOwned && reportData === target) showExtractSummary(before);
  else if (kept) showToast('Your notes are kept under Waiting notes. Tap Fill in now when you\'re ready', 'info');
  else if (stillNoSignal && manual) showToast('Still no signal — the notes will fill in when you\'re back online', 'info');
  if (stuck && (manual || !filled)) showToast(`${stuck} note${stuck !== 1 ? 's' : ''} couldn't be read — see the reason under the note`, 'error');
}

// ── EXTRACT SUMMARY ─────────────────────────────────────────────────────
// After Extract, one sheet says how many fields the note filled and which
// of the fields that matter most are still blank, each a tap to that
// field. "Not used from your note" isn't listed: the extraction answer is
// field values, not which sentences they came from, so it can't be told
// reliably which sentences were left out.
let extractSummaryOwned = false; // processTranscript() is running the queue

const JOB_SUMMARY_FIELDS = ['jobAddress', 'jobSuburb', 'jobState', 'jobPostcode', 'jobClient', 'jobInspectionType'];

function extractSnapshot() {
  const data = {};
  Object.keys(reportData).forEach(k => { if (k !== 'findings' && k !== 'pendingNotes') data[k] = JSON.stringify(reportData[k]); });
  const findings = {};
  (reportData.findings || []).forEach(f => { if (f && f.id) findings[f.id] = { ...f }; });
  const job = {};
  JOB_SUMMARY_FIELDS.forEach(id => { const el = document.getElementById(id); job[id] = el ? el.value : ''; });
  return { data, findings, job };
}

const isBlankValue = v => v === undefined || v === null || v === '' || (typeof v === 'string' && !v.trim());

function countExtractFilled(before) {
  let n = 0;
  Object.keys(reportData).forEach(k => {
    if (k === 'findings' || k === 'pendingNotes' || k === 'noteText' || k === 'weatherFilled' || isBlankValue(reportData[k])) return;
    if (JSON.stringify(reportData[k]) !== before.data[k]) n++;
  });
  (reportData.findings || []).forEach(f => {
    if (!f) return;
    const old = before.findings[f.id] || {};
    ['termiteActivity', 'species', 'damageDescription', 'activityLocation', 'timberAffected', 'nestLocated', 'structuralConcern']
      .forEach(k => { if (!isBlankValue(f[k]) && f[k] !== old[k]) n++; });
  });
  JOB_SUMMARY_FIELDS.forEach(id => { const el = document.getElementById(id); if (el && el.value.trim() && el.value !== before.job[id]) n++; });
  return n;
}

// The fields an inspector most often has to come back for, when blank.
function extractBlanks() {
  const blanks = [];
  const blank = k => isBlankValue(reportData[k]);
  if (blank('structureType')) blanks.push({ label: 'structure type', target: 'f-structureType' });
  if (blank('height')) blanks.push({ label: 'height', target: 'f-height' });
  if (blank('existingSystem')) blanks.push({ label: 'termite management system', target: 'f-existingSystem' });
  const missing = findingsMissingReferral();
  if (missing.length) {
    const f = reportData.findings[missing[0] - 1];
    blanks.push({ label: `builder referral (finding${missing.length > 1 ? 's' : ''} ${missing.join(', ')})`, target: 'finding-card-' + f.id, referral: true });
  }
  if (blank('slabEdge')) blanks.push({ label: 'slab edge', target: 'f-slabEdge' });
  if (blank('riskLevel')) blanks.push({ label: 'risk level', target: 'f-riskLevel' });
  return blanks;
}

let extractSummaryBlanks = [];
let extractSummaryBefore = null;   // the snapshot the sheet counts from, kept so a fix can redraw it
let extractSummaryFilledCount = 0;

function showExtractSummary(before) {
  const overlay = document.getElementById('extractSummaryOverlay');
  if (!overlay) return;
  extractSummaryBefore = before || extractSummaryBefore || extractSnapshot();
  const n = extractSummaryFilledCount = countExtractFilled(extractSummaryBefore);
  extractSummaryBlanks = extractBlanks();
  document.getElementById('extractSummaryFilled').textContent = n
    ? `Filled ${n} field${n !== 1 ? 's' : ''} from your note.`
    : 'Nothing new was filled from your note.';
  document.getElementById('extractSummaryBlankLabel').style.display = extractSummaryBlanks.length ? '' : 'none';
  document.getElementById('extractSummaryBlanks').innerHTML = extractSummaryBlanks.length
    ? extractSummaryBlanks.map((b, i) => `<button class="extract-blank-btn" onclick="goToExtractBlank(${i})">${escapeHtml(b.label)}<span aria-hidden="true">›</span></button>`).join('')
    : '<div class="extract-summary-done">None of the key fields are blank.</div>';
  // Before you leave: what the standard needs that the notes didn't cover.
  const gaps = driveawayGaps();
  document.getElementById('extractSummaryGaps').innerHTML = gaps.length
    ? gaps.map(g => `<div class="extract-gap"><span>${escapeHtml(g.text)}</span>${g.fix ? `<span class="send-review-fixes">${g.fix}</span>` : ''}</div>`).join('')
    : '<div class="extract-summary-done">Nothing the standard asks for is missing. Safe to leave.</div>';
  const readBtn = document.getElementById('extractReadBackBtn');
  if (readBtn) { readBtn.hidden = !('speechSynthesis' in window); readBtn.textContent = 'Read it back'; }
  overlay.classList.add('open');
}

function closeExtractSummary() {
  const overlay = document.getElementById('extractSummaryOverlay');
  if (overlay) overlay.classList.remove('open');
  stopReadBack();
}

// ── SPOKEN READ-BACK ────────────────────────────────────────────────────
// The sheet's headline, said aloud, so the inspector can check what the
// note filled with their hands still full. Only the questions a client
// asks first, then what's left to do. Same facts as the sheet, never more.
function readBackText() {
  const lines = [];
  const n = extractSummaryFilledCount;
  lines.push(n ? `Filled ${n} field${n !== 1 ? 's' : ''} from your note.` : 'Nothing new was filled from your note.');
  const { groups, limited } = reportSummary();
  const items = {};
  groups.forEach(g => g.items.forEach(([q, a, , , detail]) => { items[q] = { a, detail }; }));
  const say = (q, label) => {
    const it = items[q];
    if (!it) return;
    const a = it.a === 'NOT RECORDED' ? 'not recorded' : it.a.toLowerCase();
    lines.push(`${label}: ${a}${it.detail && it.a !== 'NOT RECORDED' ? `, ${it.detail}` : ''}.`);
  };
  say('Live termites found?', 'Live termites');
  say('Termite workings or damage found?', 'Workings or damage');
  say('Builder or engineer referral?', 'Builder referral');
  say('Conditions conducive to timber pests?', 'Conducive conditions');
  say('Termite treatment recommended?', 'Treatment recommended');
  say('Risk of termite attack', 'Risk');
  if (limited.length) lines.push(`${limited.length} area${limited.length === 1 ? '' : 's'} not fully inspected: ${limited.join('; ')}.`);
  const blanks = extractSummaryBlanks.map(b => b.label);
  if (blanks.length) lines.push(`Left blank: ${blanks.join(', ')}.`);
  const gaps = driveawayGaps().map(g => g.text.replace(/"/g, ''));
  lines.push(gaps.length ? `Before you leave: ${gaps.join('. ')}.` : 'Nothing the standard asks for is missing.');
  return lines.join(' ');
}

let readBackUtterance = null;
function toggleReadBack() {
  if (!('speechSynthesis' in window)) return;
  if (speechSynthesis.speaking || speechSynthesis.pending) { stopReadBack(); return; }
  const u = new SpeechSynthesisUtterance(readBackText());
  u.lang = 'en-AU';
  u.rate = 1;
  const voice = speechSynthesis.getVoices().find(v => /en[-_]AU/i.test(v.lang));
  if (voice) u.voice = voice;
  const btn = document.getElementById('extractReadBackBtn');
  u.onend = u.onerror = () => { readBackUtterance = null; if (btn) btn.textContent = 'Read it back'; };
  readBackUtterance = u;
  if (btn) btn.textContent = 'Stop reading';
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
  track('read_back');
}
function stopReadBack() {
  if (!('speechSynthesis' in window) || !readBackUtterance) return;
  readBackUtterance = null;
  speechSynthesis.cancel();
  const btn = document.getElementById('extractReadBackBtn');
  if (btn) btn.textContent = 'Read it back';
}

function goToExtractBlank(i) {
  const b = extractSummaryBlanks[i];
  closeExtractSummary();
  if (!b) return;
  goToReportField(b.target, b.referral);
}

// Takes the inspector to a field in the report: its section, its group
// opened, scrolled into view and flashed.
function goToReportField(target, referral) {
  const popover = document.getElementById('voicePopover');
  if (popover && popover.classList.contains('open')) toggleVoicePopover();
  let el = document.getElementById(target);
  if (!el) return;
  if (el.classList.contains('choice-source')) el = document.getElementById(target.replace(/^f-/, 'choices-')) || el;
  const section = el.closest('.report-section');
  if (section && section.id.startsWith('section-')) showSection(section.id.slice(8));
  openFieldGroups(el);
  if (referral) {
    // The "Refer to a Builder or Engineer?" field inside the finding card.
    const label = [...el.querySelectorAll('.field-label')].find(l => /builder or engineer/i.test(l.textContent));
    if (label && label.nextElementSibling) el = label.nextElementSibling;
  }
  setTimeout(() => {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (!el.hasAttribute('tabindex') && !/^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
    el.classList.add('extract-blank-flash');
    setTimeout(() => el.classList.remove('extract-blank-flash'), 1800);
  }, 60);
}

// ── COMPLIANCE PLATE SCAN ───────────────────────────────────────────────
// Photographs a termite management system durable notice/plate and asks
// the AI to read it, then fills existingSystem/existingSystemOther/
// durableNoticePresent the same way populateFields() already does for
// voice extraction — same "AI drafts, technician can always edit" model,
// just a photo instead of a transcript as the input. fromFile skips the
// camera and opens the photo library or files instead.
async function scanCompliancePlate(fromFile) {
  const btn = document.getElementById('scanPlateBtn');
  const fileBtn = document.getElementById('scanPlateFileBtn');
  const btnText = document.getElementById('scanPlateBtnText');
  if ((btn && btn.disabled) || (fileBtn && fileBtn.disabled)) return; // already running

  let base64 = null;
  let mediaType = 'image/jpeg';

  const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
  const cameraPlugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Camera;

  try {
    if (isNative && cameraPlugin) {
      const photo = await cameraPlugin.getPhoto({
        quality: 70,
        allowEditing: false,
        resultType: 'base64',
        source: fromFile ? 'PHOTOS' : 'PROMPT', // PROMPT lets the technician choose Camera or an existing photo
        direction: 'REAR',
      });
      if (!photo || !photo.base64String) return; // cancelled
      base64 = photo.base64String;
      mediaType = photo.format === 'png' ? 'image/png' : 'image/jpeg';
    } else {
      const picked = await pickImageFileAsBase64(!fromFile);
      if (!picked) return; // cancelled
      if (picked.unreadable) {
        showToast("Couldn't open that photo here. Try a JPEG or PNG, or take it with the phone", 'error');
        return;
      }
      ({ base64, mediaType } = picked);
    }
  } catch (e) {
    const msg = ((e && e.message) || '') + '';
    if (!/cancel/i.test(msg)) {
      showToast('Could not open the camera — check camera permission in Settings', 'error');
    }
    return;
  }

  // Keep the photo for the report, whether or not the plate can be read.
  try {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    await handleSectionPhotoFiles([new File([bytes], 'durable-notice', { type: mediaType })], 'durable');
  } catch (e) { console.warn('Could not keep the durable notice photo:', e); }

  if (btn) btn.disabled = true;
  if (fileBtn) fileBtn.disabled = true;
  if (btnText) btnText.textContent = 'Reading plate…';
  setAI('thinking', 'Reading compliance plate...');

  try {
    const res = await workerFetch('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        // Room for the model's thinking as well as the small JSON answer
        // (see requestExtraction()).
        max_tokens: 2000,
        output_config: { effort: 'low' },
        system: PLATE_SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: 'Read this termite management system durable notice and return the JSON described in your instructions.' },
          ],
        }],
      }),
    });

    const rawBody = await res.text();
    let data;
    try {
      data = JSON.parse(rawBody);
    } catch {
      throw new Error(`HTTP ${res.status}: ${rawBody.slice(0, 200) || '(empty response)'}`);
    }

    if (!res.ok || data.error) {
      const errMsg = data.error?.message || data.error?.type || `HTTP ${res.status}`;
      throw new Error('API error: ' + errMsg);
    }

    const text = data.content.map(i => i.text || '').join('');
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());

    if (parsed.systemFound === 'YES') {
      const update = {};
      if (parsed.existingSystem) update.existingSystem = parsed.existingSystem;
      if (parsed.existingSystemOther) update.existingSystemOther = parsed.existingSystemOther;
      update.durableNoticePresent = 'YES';
      populateFields(update);
      const label = [parsed.existingSystemOther, parsed.existingSystem].filter(Boolean).join(' — ') || 'system identified';
      showToast(`Plate read: ${label}`, 'success');
      if (parsed.extraDetails) {
        setTimeout(() => showToast(parsed.extraDetails, 'info'), 1600);
      }
    } else {
      showToast("Couldn't read a compliance plate clearly in that photo — try again with better light, or enter it manually", 'info');
    }
    setAI('ready', 'Ready');

  } catch (err) {
    console.warn('Plate scan failed:', err);
    showToast('Could not read the plate — check your connection and try again', 'error');
    setAI('ready', 'Ready');
  } finally {
    if (btn) btn.disabled = false;
    if (fileBtn) fileBtn.disabled = false;
    if (btnText) btnText.textContent = 'Take a photo of the durable notice';
  }
}

// Web/PWA fallback for scanCompliancePlate() — no native Camera plugin there.
// useCamera opens the camera straight away; without it the phone offers the
// photo library and files. Resolves { base64, mediaType }, null when
// cancelled, or { unreadable: true } when the browser can't open the file.
// The photo is always re-drawn as a JPEG of at most 1600px first: a laptop
// photo can be a HEIC, or a full-size file too big for the AI to accept.
function pickImageFileAsBase64(useCamera) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (useCamera) input.capture = 'environment';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) { resolve(null); return; }
      try {
        const { blob } = await compressPhotoFile(file, { maxDim: 1600, quality: 0.85, maxBytes: 3500000 });
        const base64 = String(await blobToDataUrl(blob)).split(',')[1];
        resolve(base64 ? { base64, mediaType: 'image/jpeg' } : { unreadable: true });
      } catch (e) {
        console.warn('Could not open the durable notice photo:', e);
        resolve({ unreadable: true });
      }
    };
    input.click();
  });
}

// ── INSECT / SPECIES PHOTO ID ───────────────────────────────────────────
// Analyses a photo the technician already attached via the normal Add
// Photos flow (reportData.photos) — deliberately opt-in per photo, not
// automatic on upload, since not every photo taken during an inspection is
// of a specimen worth identifying. Writes the result into that photo's own
// caption (only if it's still empty) as a plain-language suggestion — never
// into a Finding directly. The technician decides whether and where to use
// it, same "AI drafts, technician confirms" model as everywhere else here.
async function analyzeGalleryPhoto(photoId) {
  const photo = (reportData.photos || []).find(p => p.id === photoId);
  if (!photo) return;

  const btn = document.getElementById('analyzeBtn-' + photoId);
  if (btn && btn.disabled) return; // already running

  const image = await getPhotoImage(photo);
  const match = /^data:([^;]+);base64,(.+)$/.exec(image ? await blobToDataUrl(image) : '');
  if (!match) { showToast('Could not read that photo', 'error'); return; }
  const mediaType = match[1];
  const base64 = match[2];

  if (btn) { btn.disabled = true; btn.textContent = 'Analyzing…'; }
  setAI('thinking', 'Analyzing photo...');

  try {
    const res = await workerFetch('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        // Room for the model's thinking as well as the small JSON answer
        // (see requestExtraction()).
        max_tokens: 4000,
        output_config: { effort: 'medium' },
        system: INSECT_ID_SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: 'Identify the insect or insect damage shown in this photo and return the JSON described in your instructions.' },
          ],
        }],
      }),
    });

    const rawBody = await res.text();
    let data;
    try {
      data = JSON.parse(rawBody);
    } catch {
      throw new Error(`HTTP ${res.status}: ${rawBody.slice(0, 200) || '(empty response)'}`);
    }

    if (!res.ok || data.error) {
      const errMsg = data.error?.message || data.error?.type || `HTTP ${res.status}`;
      throw new Error('API error: ' + errMsg);
    }

    const text = data.content.map(i => i.text || '').join('');
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());

    if (parsed.identified === 'YES' && parsed.species) {
      const confLabel = parsed.confidence ? parsed.confidence.toLowerCase() + ' confidence' : 'unconfirmed';
      const note = `Possible ID: ${parsed.species} (${confLabel})`;
      if (!photo.caption || !photo.caption.trim()) {
        photo.caption = note;
        renderPhotoGrid();
        saveDraft();
      }
      showToast(`${note} — please confirm before adding to a finding`, 'success');
      if (parsed.notes) {
        setTimeout(() => showToast(parsed.notes, 'info'), 1600);
      }
    } else {
      showToast(parsed.notes || "Couldn't identify anything with confidence in that photo", 'info');
    }
    setAI('ready', 'Ready');

  } catch (err) {
    console.warn('Photo analysis failed:', err);
    showToast('Could not analyze the photo — check your connection and try again', 'error');
    setAI('ready', 'Ready');
  } finally {
    renderPhotoGrid(); // restores the button (re-render clears the disabled/label override above)
  }
}

// ── FIELD RENDERING ───────────────────────────────────────────────────────
function renderField(el, key, val) {
  el.classList.remove('editing');
  // Short-choice fields (YES/NO, risk, weep holes...) are drawn as cards
  // from reportData (see CHOICE CARDS); their .field-val is hidden and just
  // holds the text so the cards can watch it change.
  el.textContent = val;

  el.classList.add('filled', 'flash');
  setTimeout(() => el.classList.remove('flash'), 500);

  // Trigger species intelligence layer when species field is populated
  if (key === 'species' && val && val !== '—') {
    setTimeout(() => triggerSpeciesIntelligence(val), 400);
  }
}

// Text fields that hold a list of places or observations. A later note
// adds to them instead of replacing them, so "borer holes in the subfloor"
// survives a second note about rot in a fascia.
const APPEND_TEXT_KEYS = new Set(['hinderedAreas', 'hinderedAreasDetail', 'noAccessAreas', 'highRiskAreas', 'borerDetails', 'decayDetails', 'decayWhere', 'delignificationDetails', 'delignificationWhere', 'nonDurableTimberDetails', 'nonDurableTimberWhere', 'previousTreatmentDetails', 'previousTreatmentWhere', 'leakLocation', 'otherRecommendations', 'invasiveInspectionDetails']);
// Free-text fields where "None", "Nil" or "N/A" means nothing to record.
const NIL_TEXT_KEYS = new Set(['hinderedAreas', 'hinderedAreasDetail', 'noAccessAreas', 'highRiskAreas', 'borerDetails', 'decayDetails', 'decayWhere', 'delignificationDetails', 'delignificationWhere', 'nonDurableTimberDetails', 'nonDurableTimberWhere', 'previousTreatmentDetails', 'previousTreatmentWhere', 'leakLocation', 'treatmentType', 'existingSystemOther']);
const isNilText = v => /^\s*(nil|none|no|n\/a|na|not applicable|nothing|not stated|not mentioned|unknown)\s*[.!]?\s*$/i.test(String(v));
const hasRealFinding = list => list.some(f => f.termiteActivity === 'ACTIVE' || f.termiteActivity === 'INACTIVE');
const findingHasData = f => !!(f.termiteActivity || f.species || f.damageDescription || f.activityLocation || f.timberAffected || f.nestLocated || f.structuralConcern);
// The words that identify a place or an observation, for telling whether a
// later note is only repeating an earlier one ("kitchen skirting board"
// after "skirting board, kitchen, east wall").
const KEY_WORD_SKIP = new Set(['the', 'from', 'with', 'leak', 'leaks', 'there', 'that', 'this', 'into', 'along']);
const keyWords = t => String(t || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !KEY_WORD_SKIP.has(w));
const repeatsText = (have, val) => { const h = new Set(keyWords(have)), v = keyWords(val); return v.length > 0 && v.every(w => h.has(w)); };
// For a finding's location, words that only say "somewhere in there" don't
// make it a new place: "garage wall" in a recommendation repeats a finding
// at "bottom of a timber stud, garage".
const PLACE_FILLER = new Set(['wall', 'walls', 'area', 'areas', 'side', 'section', 'room', 'part']);
const repeatsPlace = (have, val) => { const h = new Set(keyWords(have)), v = keyWords(val).filter(w => !PLACE_FILLER.has(w)); return v.length > 0 && v.every(w => h.has(w)); };
// Two findings are one when one place repeats the other, in either
// direction ("laundry door frame" and "the door frame in the laundry, left
// jamb"), and their activity doesn't contradict: a blank activity, or live
// and old evidence at the same spot, is the same finding seen again. A
// "nothing found" card never merges with a real one.
function sameFindingPlace(a, b) {
  if (!a.activityLocation || !b.activityLocation) return false;
  const x = a.termiteActivity || null, y = b.termiteActivity || null;
  if (x && y && x !== y && (x === 'NONE' || y === 'NONE')) return false;
  return repeatsPlace(a.activityLocation, b.activityLocation) || repeatsPlace(b.activityLocation, a.activityLocation);
}
// Folds a repeated finding into the recorded one: live activity wins over
// old evidence, the more detailed place is kept, and other blanks are
// filled. Returns whether anything changed.
function mergeFindingInto(have, f) {
  let changed = false;
  if (f.termiteActivity && (!have.termiteActivity || (f.termiteActivity === 'ACTIVE' && have.termiteActivity === 'INACTIVE'))) { have.termiteActivity = f.termiteActivity; changed = true; }
  if (keyWords(f.activityLocation).length > keyWords(have.activityLocation).length && repeatsPlace(f.activityLocation, have.activityLocation)) { have.activityLocation = f.activityLocation; changed = true; }
  ['species', 'timberAffected', 'damageDescription', 'nestLocated', 'structuralConcern'].forEach(k => { if (!have[k] && f[k]) { have[k] = f[k]; changed = true; } });
  return changed;
}

// Identifies a note by its words, so extracting the same note again can be
// told apart from a new one: reportData.noteText { key: { field: text } }
// holds what each note added to the list-like text fields.
function noteTextKey(transcript) {
  const t = String(transcript).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
  return 'n' + h.toString(36);
}

// The quote, as dictated: reportData.quoteSpoken = { items: [{ description,
// qty, unit, price }], exclusions: [], paymentTerms, timeframe,
// servicePeriod, notes, at }. Notes add to it: a line said again (the same
// work in other words) replaces the earlier one, so a corrected price wins.
// The quote builder takes it from here (see spokenQuoteItems in quote.js).
function mergeSpokenQuote(q) {
  const clean = v => (typeof v === 'string' ? v.trim() : '');
  const num = v => { const n = typeof v === 'number' ? v : parseFloat(String(v || '').replace(/[$,\s]/g, '')); return Number.isFinite(n) && n >= 0 ? n : null; };
  const have = reportData.quoteSpoken && typeof reportData.quoteSpoken === 'object' ? reportData.quoteSpoken : { items: [], exclusions: [] };
  const items = Array.isArray(have.items) ? have.items.slice() : [];
  (Array.isArray(q.items) ? q.items : []).forEach(it => {
    if (!it || !clean(it.description)) return;
    const line = { description: clean(it.description), qty: num(it.qty) || 1, unit: clean(it.unit) || 'job', price: num(it.price) };
    const i = items.findIndex(o => repeatsText(o.description, line.description) || repeatsText(line.description, o.description));
    if (i < 0) items.push(line);
    else items[i] = { ...line, price: line.price ?? items[i].price };
  });
  const exclusions = Array.isArray(have.exclusions) ? have.exclusions.slice() : [];
  (Array.isArray(q.exclusions) ? q.exclusions : []).map(clean).filter(Boolean).forEach(e => {
    if (!exclusions.some(o => repeatsText(o, e))) exclusions.push(e);
  });
  const next = { ...have, items, exclusions };
  ['paymentTerms', 'timeframe', 'servicePeriod', 'notes'].forEach(k => { if (clean(q[k])) next[k] = clean(q[k]); });
  const changed = JSON.stringify({ ...next, at: 0 }) !== JSON.stringify({ ...have, at: 0 });
  if (!changed) return;
  next.at = Date.now();
  reportData.quoteSpoken = next;
  showToast('Quote details saved. Open the quote to check them', 'success');
}

// Writes one extracted note into the report. Every value the note gives
// replaces what was there (the inspector's later word wins), with these
// exceptions so that one note can't wipe what another recorded:
//   - findings are appended; a NONE card never sits beside a real finding
//   - list-like text (restricted areas, high-risk areas, borer and decay
//     details, leak locations, other recommendations, invasive inspection
//     details) is added to, not replaced
//   - a note that says "no moisture" without mentioning leaks leaves a
//     recorded leak alone, and a leak always counts as moisture
//   - the system type doesn't clear a brand a plate scan read unless the
//     type itself changed
// Resolves once the staggered field writes are done, so a caller can save.
function populateFields(data, transcript) {
  if (!data || typeof data !== 'object') return Promise.resolve();
  // Each field lands a moment after the last. If another job is opened in
  // the meantime, the rest stop rather than land in that job.
  const target = reportData;
  const noteKey = transcript ? noteTextKey(transcript) : null;
  // Handle findings array from AI extraction
  if (data.findings && Array.isArray(data.findings) && data.findings.length > 0) {
    let incoming = data.findings.filter(f => f && typeof f === 'object').map(f => ({
      id: genFindingId(),
      termiteActivity: f.termiteActivity || null,
      species: f.species || null,
      damageDescription: f.damageDescription || null,
      activityLocation: f.activityLocation || null,
      timberAffected: f.timberAffected || null,
      nestLocated: f.nestLocated || null,
      structuralConcern: f.structuralConcern || null,
    })).filter(findingHasData);

    // A technician typically records in short bursts as they move through a
    // property (one recording per room/area), not one long monologue — each
    // recording is sent to extraction on its own with no memory of earlier
    // ones. So findings are appended, unless the only "existing" finding is
    // still the untouched blank placeholder. A NONE card means "no termites
    // anywhere": it is dropped when a real finding exists on either side,
    // and a real finding replaces an earlier NONE card.
    const existing = getFindings();
    const existingReal = existing.filter(f => f.termiteActivity === 'ACTIVE' || f.termiteActivity === 'INACTIVE');
    if (hasRealFinding(incoming) || existingReal.length) incoming = incoming.filter(f => f.termiteActivity !== 'NONE');
    const kept = hasRealFinding(incoming) ? existing.filter(f => f.termiteActivity !== 'NONE' && findingHasData(f)) : existing.filter(findingHasData);
    // A note that only mentions a finding again (a recommendation to treat
    // "the live termites in the kitchen skirting", or the same spot said
    // twice in one note) isn't a new finding: it fills in the one already
    // recorded instead of adding a card. See sameFindingPlace for the test.
    let merged = false;
    const accepted = [];
    incoming.forEach(f => {
      const same = [...kept, ...accepted].find(k => sameFindingPlace(k, f));
      if (!same) { accepted.push(f); return; }
      if (mergeFindingInto(same, f)) merged = true;
    });
    incoming = accepted;

    if (incoming.length) {
      const combined = [...kept, ...incoming];
      reportData.findings = combined.slice(0, MAX_FINDINGS);
      if (combined.length > MAX_FINDINGS) {
        showToast(`Only ${MAX_FINDINGS} findings can be tracked per report — some new ones weren't added. Review and merge manually if needed.`, 'info');
      }
    } else if (kept.length !== existing.length || merged) {
      reportData.findings = kept;
    }
    renderFindingsUI();
  } else if (data.termiteActivity !== undefined) {
    // Backward compatibility: AI returned flat fields — wrap into findings[0]
    const existing = getFindings();
    existing[0] = {
      ...existing[0],
      termiteActivity: data.termiteActivity || null,
      species: data.species || null,
      damageDescription: data.damageDescription || null,
      activityLocation: data.activityLocation || null,
      nestLocated: data.nestLocated || null,
      structuralConcern: data.structuralConcern || null,
    };
    renderFindingsUI();
  }

  // areaStatus / obstructions / restrictedAccess have no plain field-val
  // element of their own — the Areas section shows them through the
  // per-area status buttons (reportData.areaStatus / areaReasons). The
  // generic field loop below only writes into 'f-'+key elements, so they
  // are applied here instead.
  applyObstructionExtraction(data, transcript);

  // Moisture meter readings spoken by the technician are added as rows.
  if (Array.isArray(data.moistureMeterReadings)) {
    const rows = getMoistureTable();
    data.moistureMeterReadings.forEach(r => {
      if (!r || !(r.location || r.reading)) return;
      const location = String(r.location || ''), reading = String(r.reading || '');
      // The same reading said twice (a note dictated again) isn't a new row.
      if (rows.some(x => x.location.trim().toLowerCase() === location.trim().toLowerCase() && x.reading.trim() === reading.trim())) return;
      addMoistureReading(location, reading);
    });
  }

  // Job/client details spoken by the technician (e.g. the address at the
  // start of a recording) — separate from reportData, mapped onto the Job
  // Details inputs directly. Only fills a field that's still empty, so it
  // never overwrites something the technician already typed themselves.
  const jobFieldMap = {
    propertyStreetAddress: 'jobAddress',
    propertySuburb: 'jobSuburb',
    propertyState: 'jobState',
    propertyPostcode: 'jobPostcode',
    clientName: 'jobClient',
    clientPhone: 'jobClientPhone',
    clientEmail: 'jobClientEmail',
    inspectionFee: 'jobFee',
    accessNotes: 'jobNotes',
  };
  let jobFieldsChanged = false;
  Object.entries(jobFieldMap).forEach(([key, elId]) => {
    const val = data[key];
    if (!val) return;
    const el = document.getElementById(elId);
    if (el && !el.value.trim()) {
      el.value = val;
      jobFieldsChanged = true;
    }
  });
  if (jobFieldsChanged) { saveJobInfo(); updateJob(); }

  if (data.inspectionType) {
    const sel = document.getElementById('jobInspectionType');
    if (sel && !sel.value && [...sel.options].some(o => o.value === data.inspectionType)) {
      sel.value = data.inspectionType;
      onInspectionTypeChange();
    }
  }

  if (data.quote && typeof data.quote === 'object') mergeSpokenQuote(data.quote);

  // Keep the recorded facts when the note is silent about them:
  // - a leak is a moisture source, so a leak found means moisture YES;
  // - "no moisture" from a note that doesn't mention leaks must not wipe a
  //   leak an earlier note recorded (the moisture cascade clears leaks);
  // - the system type only replaces a brand when the type itself changed.
  const values = upgradeRenamedChoices({ ...data });
  if (values.waterLeaks === 'YES' && values.moistureReadings !== 'YES') values.moistureReadings = 'YES';
  if (values.moistureReadings === 'NO' && !values.waterLeaks && reportData.waterLeaks === 'YES') delete values.moistureReadings;
  // "No System Found" is kept, unless an earlier note named a system: a no
  // from one note doesn't wipe a system another note read off the notice.
  if (values.existingSystem !== undefined && values.existingSystem !== null && !hasIdentifiedSystem(String(values.existingSystem))) {
    if (String(values.existingSystem).trim().toLowerCase() === NO_SYSTEM_FOUND.toLowerCase() && !hasIdentifiedSystem(reportData.existingSystem || '')) values.existingSystem = NO_SYSTEM_FOUND;
    else delete values.existingSystem;
  }
  NIL_TEXT_KEYS.forEach(k => { if (values[k] !== undefined && values[k] !== null && isNilText(values[k])) values[k] = k === 'hinderedAreas' ? '' : null; });
  mergeBorerExtraction(values);

  // All non-findings fields, in an order where a field that reveals or
  // clears another is written first (moisture before leaks before the leak
  // location; system type before its brand).
  const FIRST = ['moistureReadings', 'waterLeaks', 'leakLocation', 'existingSystem', 'existingSystemOther'];
  const rank = k => { const i = FIRST.indexOf(k); return i < 0 ? FIRST.length : i; };
  const skip = new Set(['inspectionType','findings','termiteActivity','species','damageDescription','activityLocation','nestLocated','structuralConcern','propertyStreetAddress','propertySuburb','propertyState','propertyPostcode','clientName','obstructions','restrictedAccess','areaStatus','areaResult','moistureMeterReadings']);
  const entries = Object.entries(values)
    .filter(([key, val]) => !skip.has(key) && val !== null && val !== undefined && document.getElementById('f-' + key))
    .sort((a, b) => rank(a[0]) - rank(b[0]));

  // What hindered access has no field on screen of its own; it's kept for
  // the PDF, which prints it with the obstructed areas (accessLimits).
  if (typeof values.hinderedAreasDetail === 'string' && values.hinderedAreasDetail.trim()) {
    const prev = isBlankValue(reportData.hinderedAreasDetail) ? '' : String(reportData.hinderedAreasDetail);
    const add = values.hinderedAreasDetail.trim();
    reportData.hinderedAreasDetail = !prev || prev.toLowerCase().includes(add.toLowerCase()) ? (prev || add) : prev.replace(/[.;,\s]+$/, '') + '; ' + add;
  }

  entries.forEach(([key, rawVal], i) => {
    const el = document.getElementById('f-' + key);
    setTimeout(() => {
      if (reportData !== target) return;
      let val = typeof rawVal === 'string' ? rawVal.trim() : String(rawVal);
      const own = val; // this note's words, before any are added to earlier ones
      if (key === 'hinderedAreas' && !val) {
        // "Nothing was in the way": No, unless an area says otherwise.
        setHinderedAccess(false); return;
      }
      let prev = reportData[key];
      // The same note extracted again replaces what it added last time
      // rather than adding it a second time in other words.
      const added = APPEND_TEXT_KEYS.has(key) && noteKey ? (reportData.noteText || {})[noteKey] : null;
      if (added && added[key] && typeof prev === 'string') {
        const seg = added[key];
        prev = prev === seg ? '' : prev.replace('; ' + seg, '').replace(seg + '; ', '');
      }
      if (APPEND_TEXT_KEYS.has(key) && noteKey && val) {
        if (!reportData.noteText) reportData.noteText = {};
        (reportData.noteText[noteKey] = reportData.noteText[noteKey] || {})[key] = val;
      }
      if (APPEND_TEXT_KEYS.has(key) && typeof prev === 'string' && prev.trim() && !prev.startsWith('NIL')) {
        const have = prev.toLowerCase();
        if (have.includes(val.toLowerCase()) || repeatsText(prev, val)) val = prev;
        else if (!val.toLowerCase().includes(have)) val = prev.replace(/[.;,\s]+$/, '') + '; ' + val;
      }
      reportData[key] = val;
      rememberAiFill(key, own, transcript);
      // FIX: apply the same cross-field cascade manual edits get (reveal/
      // hide dependent fields, clear fields that are no longer valid) - see
      // applyFieldCascade's comment for why this matters here specifically.
      applyFieldCascade(key, val, el, prev);
      renderField(el, key, reportData[key]);
      updateProgress();
      checkAsbestosFlag();
      checkSystemVerify();
      checkSecondaryColonyFlag();
    }, i * 70);
  });

  return new Promise(resolve => {
    setTimeout(() => {
      if (reportData !== target) { resolve(); return; }
      autoReveal(data);
      ensureTreatmentForLiveTermites();
      placeTalkPhotos();
      saveDraft();
      resolve();
    }, entries.length * 70 + 50);
  });
}

// ── MULTI-FINDING ENGINE ─────────────────────────────────────────────────
// reportData.findings is an array of finding objects. Each has:
// { id, termiteActivity, species, damageDescription, activityLocation, nestLocated, structuralConcern }
// The array always has at least one entry. "Add Finding" appends another.
const MAX_FINDINGS = 6;

function genFindingId() {
  return 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

function getFindings() {
  if (!reportData.findings || !Array.isArray(reportData.findings) || reportData.findings.length === 0) {
    reportData.findings = [{ id: genFindingId(), termiteActivity: null }];
  }
  return reportData.findings;
}

function addFinding() {
  const findings = getFindings();
  if (findings.length >= MAX_FINDINGS) return;
  findings.push({ id: genFindingId(), termiteActivity: null });
  renderFindingsUI();
  updateProgress();
  saveDraft();
}

function removeFinding(id) {
  const findings = getFindings();
  if (findings.length <= 1) return; // always keep at least one
  const index = findings.findIndex(f => f.id === id);
  if (index < 0) return;
  const removed = findings[index];
  reportData.findings = findings.filter(f => f.id !== id);
  renderFindingsUI();
  updateProgress();
  saveDraft();
  showToast(`Finding ${index + 1} removed`, 'info', { label: 'Undo', run: () => {
    const list = getFindings();
    if (list.some(f => f.id === removed.id)) return;
    list.splice(Math.min(index, list.length), 0, removed);
    reportData.findings = list;
    renderFindingsUI();
    updateProgress();
    saveDraft();
  } });
}

function setFindingField(id, key, val) {
  const finding = getFindings().find(f => f.id === id);
  if (!finding) return;
  finding[key] = val;
  renderFindingsUI();
  updateProgress();
  saveDraft();
  ensureTreatmentForLiveTermites();
}

// ── CHOICE CARDS ──────────────────────────────────────────────────────────
// Short-choice questions (termite and borer activity, YES/NO, risk, slab
// edge, weep holes, height) are rows of big cards, built for gloves and
// glare. Each card wraps a visually hidden native radio: the radio is the
// control (tap, keyboard, screen reader), and its change event saves through
// the function the old control used: commitEdit for report fields,
// commitFindingEdit for finding cards. Report fields keep their original
// .field-val (hidden) as the place extraction, drafts and resets write to; a
// MutationObserver redraws the cards from reportData whenever it changes.
// Tone colours the picked card: bad = red, warn = amber, good = green.
const CHOICE_SETS = {
  activity:  [['ACTIVE', 'bad', 'Live termites seen'], ['INACTIVE', 'warn', 'Evidence, none live'], ['NONE', 'good', 'Nothing found']],
  borer:     [['ACTIVE', 'bad', 'Fresh frass or holes'], ['INACTIVE', 'warn', 'Old holes only'], ['NONE', 'good', 'None seen']],
  borerCard: [['ACTIVE', 'bad', 'Fresh frass or holes'], ['INACTIVE', 'warn', 'Old holes only']],
  yesno:     [['YES', 'bad'], ['NO', 'good'], ['N/A', 'neutral']],
  wantyes:   [['YES', 'good'], ['NO', 'bad'], ['N/A', 'neutral']],   // NO is the concern
  neutral:   [['YES', 'neutral'], ['NO', 'neutral'], ['N/A', 'neutral']],
  finding:   [['YES', 'bad'], ['NO', 'good']],
  risk:      [['LOW', 'good'], ['MEDIUM', 'warn'], ['HIGH', 'bad']],
  slabedge:  [['CLEAR', 'good'], ['OBSTRUCTED', 'bad']],
  weepholes: [['CLEAR', 'good'], ['BRIDGED', 'bad'], ['NONE', 'neutral', 'None located']],
  antcapping: [['INTACT', 'good'], ['GAPS', 'bad'], ['NONE', 'bad']],
  ventilation: [['ADEQUATE', 'good'], ['POOR', 'bad'], ['N/A', 'neutral']],
  drainage:  [['ADEQUATE', 'good'], ['POOR', 'bad'], ['N/A', 'neutral']],
  height:    [['Single storey', 'neutral'], ['Double storey', 'neutral'], ['Split level', 'neutral'], ['Multiple storey', 'neutral']],
};
// Report fields: the set comes from the field's key, else its edit type.
const CHOICE_SET_BY_KEY = { borerActivity: 'borer', mouldSeen: 'finding', durableNoticePresent: 'wantyes', antCapSoldered: 'wantyes', zone25mmVisible: 'wantyes', zone75mmVisible: 'wantyes', hardLandscaping: 'neutral', softLandscaping: 'neutral' };
// Choice labels that were renamed. Reports saved with the old label show
// the new one when they are opened.
const RENAMED_CHOICES = {
  height: { 'Three storey+': 'Multiple storey' },
  existingSystem: { 'Chemical soil barrier': 'Chemical Barrier' },
};
function upgradeRenamedChoices(rd) {
  Object.entries(RENAMED_CHOICES).forEach(([key, map]) => {
    if (rd && map[rd[key]]) rd[key] = map[rd[key]];
  });
  return rd;
}
const CHOICE_SET_BY_TYPE = { yesno: 'yesno', yesnona: 'yesno', risk: 'risk', slabedge: 'slabedge', weepholes: 'weepholes', antcapping: 'antcapping', ventilation: 'ventilation', drainage: 'drainage', height: 'height', activity: 'activity' };

function choiceCardsHTML(set, name, current, dataAttrs) {
  const opts = CHOICE_SETS[set];
  return `<div class="choice-grid" style="--cols:${opts.length === 4 ? 2 : opts.length}">${opts.map(([value, tone, desc]) => `
    <label class="choice-card tone-${tone}">
      <input type="radio" class="sr-only" name="${name}" value="${escapeHtml(value)}" ${dataAttrs}${current === value ? ' checked' : ''}>
      <span class="choice-card-code">${escapeHtml(value)}</span>
      ${desc ? `<span class="choice-card-desc">${desc}</span>` : ''}
    </label>`).join('')}</div>`;
}

// Turns each short-choice report field into cards. Runs once, on app open.
function buildChoiceCards() {
  document.querySelectorAll('#reportBody .field-val[id^="f-"][onclick^="startEdit"]').forEach(el => {
    const [, key, type] = el.getAttribute('onclick').match(/startEdit\(this,'(\w+)','(\w+)'\)/) || [];
    const set = CHOICE_SET_BY_KEY[key] || CHOICE_SET_BY_TYPE[type];
    if (!set) return;
    el.removeAttribute('onclick');
    el.classList.add('choice-source');
    const panel = document.createElement('div');
    panel.className = 'choice-panel';
    panel.id = 'choices-' + key;
    panel.dataset.set = set;
    panel.setAttribute('role', 'radiogroup');
    const label = getFieldLabel(el);
    const field = el.closest('.field');
    // "What" under a side line reads as "Wood Decay Fungi (Rot): What".
    const pairHead = field?.closest('.field-pair')?.querySelector(':scope > .field:first-child');
    const lead = pairHead && pairHead !== field ? pairHead.querySelector('.field-label')?.textContent.trim() + ': ' : '';
    if (label) panel.setAttribute('aria-label', lead + label.textContent.trim());
    el.insertAdjacentElement('afterend', panel);
    if (field) field.classList.add('choice-field');
    syncChoiceCards(key);
    new MutationObserver(() => syncChoiceCards(key)).observe(el, { childList: true, characterData: true, subtree: true });
    if (DETAIL_FIELD_FOR[key]) [DETAIL_FIELD_FOR[key][0], ...(MORE_DETAIL_FIELDS[key] || [])].forEach(k => {
      const detail = document.getElementById('f-' + k);
      if (detail) new MutationObserver(() => syncDetailField(key)).observe(detail, { childList: true, characterData: true, subtree: true });
    });
  });
}

// A detail box only shows while its question could need one: a "no" answer
// hides it, unless something was already written there.
const DETAIL_FIELD_FOR = {
  decayFound: ['decayDetails', ['NO', 'N/A']],
  delignification: ['delignificationDetails', ['NO', 'N/A']],
  previousTreatment: ['previousTreatmentDetails', ['NO', 'N/A']],
  nonDurableTimber: ['nonDurableTimberDetails', ['NO', 'N/A']],
  mouldSeen: ['mouldWhere', ['NO']],
  antCapping: ['antCappingDetails', ['INTACT']],
};

// More detail boxes that show and hide with the first one.
const MORE_DETAIL_FIELDS = { previousTreatment: ['previousTreatmentWhere'], decayFound: ['decayWhere'], delignification: ['delignificationWhere'], nonDurableTimber: ['nonDurableTimberWhere'] };
// "what (where)" for the summary and other one-line uses.
const whatWhere = (what, where) => [what, where && `(${where})`].filter(Boolean).join(' ');

function syncDetailField(key) {
  const [detailKey, noAnswers] = DETAIL_FIELD_FOR[key] || [];
  if (!detailKey) return;
  [detailKey, ...(MORE_DETAIL_FIELDS[key] || [])].forEach(k => {
    const field = document.getElementById('f-' + k)?.closest('.field');
    if (!field) return;
    const hide = noAnswers.includes(reportData[key]) && !String(reportData[k] || '').trim();
    field.style.display = hide ? 'none' : '';
  });
  // A What and Where row under a question hides with its last box.
  const row = document.getElementById('f-' + detailKey)?.closest('.field-pair-row');
  if (row) row.style.display = [...row.querySelectorAll(':scope > .field')].every(f => f.style.display === 'none') ? 'none' : '';
}

function syncChoiceCards(key) {
  syncDetailField(key);
  if (key === 'borerActivity') renderBorerFindings();
  const panel = document.getElementById('choices-' + key);
  if (!panel) return;
  const val = reportData[key] || '';
  if (panel.firstChild && panel.dataset.value === val) return;
  panel.dataset.value = val;
  const hadFocus = panel.contains(document.activeElement);
  panel.innerHTML = choiceCardsHTML(panel.dataset.set, 'choice-' + key, val, `data-key="${key}"`);
  panel.classList.toggle('unset', !val);
  if (hadFocus) { const c = panel.querySelector('input:checked'); if (c) c.focus({ preventScroll: true }); }
}

document.addEventListener('change', e => {
  const input = e.target.closest && e.target.closest('.choice-card input');
  if (!input) return;
  const { finding, fkey, key } = input.dataset;
  if (finding) {
    commitFindingEdit(finding, fkey, input.value);
    // The finding card was redrawn; keep focus on the chosen card.
    const chosen = document.querySelector(`.choice-card input[data-finding="${finding}"][data-fkey="${fkey}"]:checked`);
    if (chosen) chosen.focus({ preventScroll: true });
  } else if (key) {
    const el = document.getElementById('f-' + key);
    if (el) commitEdit(el, key, input.value);
  }
});

// ── SELECT CARDS ──────────────────────────────────────────────────────────
// The short job-detail dropdowns shown as card grids. The native <select>
// stays in the page, hidden, and keeps the value: a card tap sets it and
// fires its 'change', so onInspectionTypeChange(), updateJob() and
// saveJobInfo() run as before. Code that sets a select directly ends in
// updateJob(), saveJobInfo(), loadJobInfo() or clearJobInfo(), and those
// call syncAllSelectCards() to redraw. Long lists stay dropdowns.
const SELECT_CARDS = {
  jobState:          { cols: 4 },
  jobInspectionType: { cols: 2 },
};

function buildSelectCards() {
  Object.keys(SELECT_CARDS).forEach(id => {
    const sel = document.getElementById(id);
    if (!sel || document.getElementById('cards-' + id)) return;
    sel.classList.add('select-cards-source');
    const panel = document.createElement('div');
    panel.className = 'choice-panel select-cards';
    panel.id = 'cards-' + id;
    panel.setAttribute('role', 'radiogroup');
    const label = sel.closest('.job-field')?.querySelector('.job-field-label');
    if (label) panel.setAttribute('aria-label', label.textContent);
    sel.insertAdjacentElement('afterend', panel);
    panel.addEventListener('change', e => {
      const input = e.target.closest('input');
      if (!input || sel.value === input.value) return;
      sel.value = input.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      input.focus({ preventScroll: true });
    });
    syncSelectCards(id);
  });
}

function syncSelectCards(id) {
  const sel = document.getElementById(id);
  const panel = document.getElementById('cards-' + id);
  if (!sel || !panel) return;
  if (panel.firstChild && panel.dataset.value === sel.value) return;
  panel.dataset.value = sel.value;
  const hadFocus = panel.contains(document.activeElement);
  const opts = [...sel.options].filter(o => o.value);
  panel.innerHTML = `<div class="choice-grid" style="--cols:${SELECT_CARDS[id].cols}">${opts.map(o => `
    <label class="choice-card tone-neutral">
      <input type="radio" class="sr-only" name="cards-${id}" value="${escapeHtml(o.value)}"${sel.value === o.value ? ' checked' : ''}>
      <span class="choice-card-code">${escapeHtml(o.textContent)}</span>
    </label>`).join('')}</div>`;
  if (hadFocus) { const c = panel.querySelector('input:checked'); if (c) c.focus({ preventScroll: true }); }
}

function syncAllSelectCards() { Object.keys(SELECT_CARDS).forEach(syncSelectCards); }

// Generates the HTML for one finding card
function findingCardHTML(finding, index, total) {
  const id = finding.id;
  const act = finding.termiteActivity;
  const chipClass = act ? act : 'unset';
  const showDetails = act === 'ACTIVE' || act === 'INACTIVE';
  const showNone = act === 'NONE';
  const label = total === 1 ? 'Primary Finding' : `Finding ${index + 1}`;

  const fv = (key, type) => {
    const val = finding[key];
    if (type === 'yesno') {
      return `<div class="choice-panel${val ? '' : ' unset'}" role="radiogroup">${choiceCardsHTML('finding', `${key}-${id}`, val, `data-finding="${id}" data-fkey="${key}"`)}</div>`;
    }
    return `<div class="field-val${val ? ' filled' : ''}" onclick="startFindingEdit('${id}','${key}','${type}')">${val ? escapeHtml(val) : '—'}</div>`;
  };

  return `
    <div class="finding-card" id="finding-card-${id}">
      <div class="finding-card-header">
        <span class="finding-card-label">${finding.activityLocation ? `<span class="finding-card-title">${escapeHtml(finding.activityLocation)}</span><small>${label}</small>` : label}</span>
        <span class="finding-activity-chip ${chipClass}">${act ? act : '—'}</span>
        ${total > 1 ? `<button class="finding-remove-btn" onclick="removeFinding('${id}')" title="Remove this finding">✕</button>` : ''}
      </div>
      <div class="finding-card-body">
        <!-- Activity gate: the question every finding must answer -->
        <div class="findings-gate choice-panel${act ? '' : ' unset'}" role="radiogroup" aria-label="Termite Activity Status">
          <div class="field-label">Termite Activity Status</div>
          ${choiceCardsHTML('activity', 'activity-' + id, act, `data-finding="${id}" data-fkey="termiteActivity"`)}
          ${!act ? `<p class="findings-gate-hint">Pick one to continue.</p>` : ''}
        </div>
        ${showDetails ? `
        <div class="findings-details" style="display:block">
          <div class="section-fields">
            <div class="field field-wide"><div class="field-label">Location of Activity</div>${pickFieldHTML(id, 'activityLocation', PLACES, finding.activityLocation)}</div>
            <div class="field field-wide"><div class="field-label">Timber Affected</div>${pickFieldHTML(id, 'timberAffected', TIMBER_PARTS, finding.timberAffected)}</div>
            <div class="field field-wide"><div class="field-label">Damage Description <span class="field-hint">Location, extent and what's visible. No severity opinion.</span></div>${pickFieldHTML(id, 'damageDescription', TERMITE_SIGNS, finding.damageDescription)}</div>
            <div class="field field-wide"><div class="field-label">Species / Genus</div>${fv('species','specieslist')}</div>
            <div class="field choice-field"><div class="field-label">Termite Nest Found?</div>${fv('nestLocated','yesno')}</div>
            <div class="field choice-field"><div class="field-label">Refer to a Builder or Engineer?</div>${fv('structuralConcern','yesno')}</div>
            <div class="field field-wide finding-photos"><div class="field-label">Photos of this finding</div>${spotPhotosHTML(findingPhotoSection(id))}</div>
          </div>
          ${act === 'INACTIVE' ? `<div class="inactive-reminder" style="display:flex"><svg class="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg><span>Inactive workings can mean termites have temporarily abandoned the area, not that the risk is gone. Continued, regular inspections remain essential.</span></div>` : ''}
          ${finding.structuralConcern === 'YES' ? `<div class="warn-note note-info" style="margin:0 0 10px"><svg class="icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Referral recorded. The PDF recommends a licensed builder or engineer assess this damage.</div>` : ''}
        </div>` : ''}
        ${showNone ? `<div class="findings-none" style="display:flex;margin:8px 0 6px"><span class="findings-none-icon"><svg class="icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg></span><span>No activity or evidence found at this location.</span></div>` : ''}
      </div>
    </div>`;
}

function renderFindingsUI() {
  const list = document.getElementById('findingsList');
  const addBtn = document.getElementById('addFindingBtn');
  const noneEl = document.getElementById('findingsNone');
  if (!list) return;

  const findings = getFindings();
  list.innerHTML = findings.map((f, i) => findingCardHTML(f, i, findings.length)).join('');
  hydrateSpotPhotos(list);
  renderAreaFindingPrompts();
  renderBorerFindings();

  if (addBtn) {
    const atCap = findings.length >= MAX_FINDINGS;
    addBtn.disabled = atCap;
    addBtn.classList.toggle('at-cap', atCap);
    addBtn.style.display = findings.every(f => f.termiteActivity === 'NONE') ? 'none' : '';
  }

  // Show the all-none banner only if every finding is NONE
  const allNone = findings.length > 0 && findings.every(f => f.termiteActivity === 'NONE');
  if (noneEl) noneEl.style.display = allNone ? 'flex' : 'none';
}

// Called when a field inside a finding card is tapped
let activeFindingEdit = null;

function startFindingEdit(findingId, key, type) {
  activeFindingEdit = { findingId, key };

  const finding = findAnyFinding(findingId);
  if (!finding) return;

  // For species, show a dropdown select
  if (type === 'specieslist') {
    const cardEl = document.getElementById('finding-card-' + findingId);
    if (!cardEl) return;
    const fieldEl = cardEl.querySelector(`[onclick*="startFindingEdit('${findingId}','${key}'"], [data-edit="${findingId}:${key}"]`);
    if (!fieldEl) return;
    const cur = finding[key] || '';
    const options = SPECIES_LIST;
    const sel = document.createElement('select');
    sel.className = 'field-edit-input';
    sel.style.width = '100%';
    sel.innerHTML = `<option value="">— Select species —</option>` +
      options.map(o => `<option value="${o}" ${cur===o?'selected':''}>${o}</option>`).join('');
    sel.addEventListener('change', () => {
      commitFindingEdit(findingId, key, sel.value);
      fieldEl.innerHTML = sel.value || '—';
      if (sel.value) fieldEl.classList.add('filled');
      sel.replaceWith(fieldEl);
    });
    fieldEl.replaceWith(sel);
    sel.focus();
    return;
  }
  const cardEl = document.getElementById('finding-card-' + findingId);
  if (!cardEl) return;
  const fieldEl = cardEl.querySelector(`[onclick*="startFindingEdit('${findingId}','${key}'"], [data-edit="${findingId}:${key}"]`);
  if (!fieldEl) return;
  const cur = finding[key] || '';
  const ta = document.createElement('input');
  ta.className = 'field-edit-input';
  ta.type = 'text';
  ta.style.width = '100%';
  ta.value = cur;
  ta.placeholder = 'Type value...';

  const isThis = () => activeFindingEdit && activeFindingEdit.findingId === findingId && activeFindingEdit.key === key;
  wireInlineTextEdit(ta,
    v => { if (isThis()) commitFindingEdit(findingId, key, v.trim()); },
    () => { if (isThis()) { activeFindingEdit = null; renderFindingsUI(); } },
    // Tapping away saves without redrawing the cards straight away, so the
    // tap that moved focus still lands on the field it was aimed at.
    v => {
      if (!isThis()) return;
      if (ta.isConnected) {
        (fieldEl.querySelector('.pick-field-text') || fieldEl).textContent = v.trim() || '—';
        fieldEl.classList.toggle('filled', !!v.trim());
        ta.replaceWith(fieldEl);
      }
      commitFindingEdit(findingId, key, v.trim(), true);
    });

  fieldEl.replaceWith(ta);
  ta.focus();
  ta.select();
}

function commitFindingEdit(findingId, key, value, deferRender) {
  activeFindingEdit = null;
  const finding = findAnyFinding(findingId);
  if (!finding) return;
  finding[key] = value || null;
  if (isBorerFinding(finding)) syncBorerFromCards(key === 'borerActivity');
  if (key === 'species' && value) {
    setTimeout(() => triggerSpeciesIntelligence(value), 400);
  }
  // Check if we should prompt about high risk areas
  if (key === 'termiteActivity') {
    setTimeout(() => checkHighRiskPrompt(), 400);
  }
  if (deferRender) setTimeout(() => { if (!activeFindingEdit) renderFindingsUI(); }, 400);
  else renderFindingsUI();
  updateProgress();
  saveDraft();
  ensureTreatmentForLiveTermites();
}

// ── TIMBER AND BORER PICKS ───────────────────────────────────────────────
// A drop-down under a text field: picking an answer adds it to the field,
// picking a ticked one takes it out again. The field stays free text, so
// the inspector can still type.
const PLACES = ['Subfloor', 'Roof void', 'Kitchen', 'Bathroom', 'Laundry', 'Bedroom', 'Living room', 'Hallway', 'Garage', 'Front', 'Rear', 'Left side', 'Right side', 'Deck', 'Yard', 'Fence line'];
const TIMBER_PARTS = ['Bearer', 'Joist', 'Floorboards', 'Stud', 'Top plate', 'Bottom plate', 'Skirting', 'Architrave', 'Door frame', 'Window frame', 'Roof timbers', 'Deck', 'Fence', 'Tree or stump'];
const BORER_TYPES = ['Anobium (furniture beetle)', 'Lyctus (powderpost beetle)', 'Queensland pine beetle', 'European house borer', 'Not identified'];
const TERMITE_SIGNS = ['Mud leads', 'Mud packing', 'Workings', 'Galleries', 'Hollow when tapped', 'Live termites', 'Timber damage', 'Bubbling paint'];
const BORER_SIGNS = ['Exit holes', 'Frass', 'Tunnelling', 'Old dark holes', 'Fresh bright holes'];
const PICK_SINGLE = new Set(['borerType']);
// Description and location fields read as one phrase: a pick added after
// the first starts lower case ("Mud leads, workings, hollow when tapped").
const PICK_PHRASE = new Set(['damageDescription', 'description', 'activityLocation', 'location']);

const splitPicks = v => String(v || '').split(/\s*,\s*/).filter(Boolean);

// The field itself is the drop-down: a native list laid over the box, so
// a tap opens the phone's own picker. "Other (type it)" opens the box for
// typing instead.
function pickFieldHTML(id, key, options, value) {
  const have = splitPicks(value).map(x => x.toLowerCase());
  return `<div class="field-val pick-field${value ? ' filled' : ''}" data-edit="${id}:${key}">
    <span class="pick-field-text">${value ? escapeHtml(value) : '—'}</span>
    <select class="pick-field-list" aria-label="Choose from list" onchange="onPickField('${id}','${key}',this)">
      <option value="">${PICK_SINGLE.has(key) ? 'Choose one' : 'Tap to add or remove'}</option>
      ${options.map(o => `<option value="${escapeHtml(o)}">${have.includes(o.toLowerCase()) ? '✓ ' : ''}${escapeHtml(o)}</option>`).join('')}
      <option value="${OTHER_TYPE_IT}">${OTHER_TYPE_IT}</option>
    </select>
  </div>`;
}

function onPickField(id, key, sel) {
  const v = sel.value;
  sel.value = '';
  if (!v) return;
  if (v === OTHER_TYPE_IT) startFindingEdit(id, key, 'text');
  else togglePick(id, key, v);
}

function togglePick(id, key, word) {
  const finding = findAnyFinding(id);
  if (!finding) return;
  let picks = splitPicks(finding[key]);
  const at = picks.findIndex(x => x.toLowerCase() === word.toLowerCase());
  if (at >= 0) picks.splice(at, 1);
  else if (PICK_SINGLE.has(key)) picks = [word];
  else picks = [...picks, PICK_PHRASE.has(key) && picks.length ? word.charAt(0).toLowerCase() + word.slice(1) : word];
  commitFindingEdit(id, key, picks.join(', '));
}

// ── NOTHING FOUND SHORTCUTS ──────────────────────────────────────────────
// For a job typed or tapped instead of spoken: one tap fills every blank
// question in a section with its clean answer, and the inspector changes
// only what was different. Answered questions are never touched, questions
// that depend on the build (slab edge, subfloor, weep holes) are only filled
// once the floor and walls are known, and Undo puts the blanks back.
const CONDUCIVE_CLEAN = { moistureReadings: 'NO', siteDrainage: 'ADEQUATE', timberSoil: 'NO', nonDurableTimber: 'NO', weepHoles: 'CLEAR', slabEdge: 'CLEAR', subfloorDrainage: 'ADEQUATE', subfloorVentilation: 'ADEQUATE', antCapping: 'INTACT' };

function nothingFoundAnswers(section) {
  if (section === 'findings') return { borerActivity: 'NONE', decayFound: 'NO', delignification: 'NO' };
  const floor = String(reportData.floorType || '').toLowerCase();
  const walls = String(reportData.wallConstruction || '').toLowerCase();
  const fits = {
    weepHoles: /brick|masonry|render/.test(walls),
    slabEdge: /slab/.test(floor),
    subfloorDrainage: /timber|stump|suspended|pier/.test(floor),
  };
  fits.subfloorVentilation = fits.antCapping = fits.subfloorDrainage;
  return Object.fromEntries(Object.entries(CONDUCIVE_CLEAN).filter(([k]) => fits[k] !== false));
}

const termitesUnanswered = () => !(reportData.findings || []).some(f => f && findingHasData(f));

function nothingFoundBlanks(section) {
  const blanks = Object.keys(nothingFoundAnswers(section)).filter(k => isBlankValue(reportData[k]) && document.getElementById('f-' + k));
  if (section === 'findings' && termitesUnanswered()) blanks.unshift('termites');
  return blanks;
}

function markNothingFound(section) {
  const answers = nothingFoundAnswers(section);
  const blanks = nothingFoundBlanks(section);
  if (!blanks.length) return;
  // What Undo restores: the filled keys and anything their answers clear.
  const keys = [...Object.keys(answers), 'waterLeaks', 'leakLocation'];
  const before = Object.fromEntries(keys.map(k => [k, reportData[k]]));
  const beforeFindings = JSON.stringify(reportData.findings || null);
  blanks.forEach(key => {
    if (key === 'termites') commitFindingEdit(getFindings()[0].id, 'termiteActivity', 'NONE');
    else commitEdit(document.getElementById('f-' + key), key, answers[key]);
  });
  const left = [];
  if (section === 'conducive') {
    if (!reportData.floorType) left.push('slab edge and subfloor (set the floor type first)');
    if (!reportData.wallConstruction) left.push('weep holes (set the walls first)');
  }
  showToast(`Filled ${blanks.length} clean answer${blanks.length === 1 ? '' : 's'}${left.length ? `. Left blank: ${left.join('; ')}` : ''}`, 'success', { label: 'Undo', run: () => {
    keys.forEach(key => {
      const el = document.getElementById('f-' + key);
      if (isBlankValue(before[key])) {
        delete reportData[key];
        if (el) { el.classList.remove('filled'); el.textContent = '—'; getFieldLabel(el)?.querySelector('.edited-dot')?.remove(); }
      } else {
        reportData[key] = before[key];
        if (el) renderField(el, key, before[key]);
      }
    });
    const waterWrap = document.getElementById('waterLeakWrap');
    if (waterWrap) waterWrap.style.display = reportData.moistureReadings === 'YES' ? '' : 'none';
    reportData.findings = JSON.parse(beforeFindings) || undefined;
    renderFindingsUI();
    updateProgress();
    checkFindingsGate();
    saveDraft();
  } });
}

// Each button shows only while its section has a blank it can fill, and
// says "else" or "other" once something has been recorded there.
function syncNothingFoundButtons() {
  ['findings', 'conducive'].forEach(section => {
    const btn = document.getElementById('nothingFound-' + section);
    if (!btn) return;
    btn.hidden = !nothingFoundBlanks(section).length;
    const somethingFound = section === 'findings'
      ? (reportData.findings || []).some(f => f && ['ACTIVE', 'INACTIVE'].includes(f.termiteActivity)) || borersFound() || reportData.decayFound === 'YES' || reportData.delignification === 'YES'
      : reportData.waterLeaks === 'YES' || Object.entries(CONDUCIVE_CLEAN).some(([k, clean]) => !isBlankValue(reportData[k]) && ![clean, 'N/A'].includes(reportData[k]) && !(k === 'weepHoles' && reportData[k] === 'NONE'));
    const title = btn.querySelector('strong');
    if (title) title.textContent = section === 'findings'
      ? (somethingFound ? 'Nothing else found' : 'No timber pests found')
      : (somethingFound ? 'No other conducive conditions' : 'No conducive conditions');
  });
}

// ── BORER FINDINGS ───────────────────────────────────────────────────────
// reportData.borerFindings: one card per place borers were found, each
// { id, borerActivity, borerType, location, timberAffected, description,
// structuralConcern }, with its own photos like a termite finding. The
// overall answer (reportData.borerActivity) stays the question the report
// asks, and the cards are the detail behind ACTIVE or INACTIVE.
// reportData.borerDetails is kept as one line written from the cards, for
// the summary page, the quote and older reports.
const MAX_BORER_FINDINGS = 6;

function isBorerFinding(f) { return !!f && (reportData.borerFindings || []).includes(f); }
function findAnyFinding(id) { return getFindings().find(f => f.id === id) || getBorerFindings().find(f => f.id === id); }
const borersFound = () => ['ACTIVE', 'INACTIVE'].includes(reportData.borerActivity);

function getBorerFindings() {
  if (!Array.isArray(reportData.borerFindings)) {
    reportData.borerFindings = [];
    // A report from before borer cards: its one line of borer detail
    // becomes the first card.
    if (borersFound() && String(reportData.borerDetails || '').trim()) {
      reportData.borerFindings.push({ id: genFindingId(), borerActivity: reportData.borerActivity, description: String(reportData.borerDetails).trim() });
    }
  }
  return reportData.borerFindings;
}

// The cards shown, and printed: only while the answer says borers were found.
function shownBorerFindings() { return borersFound() ? getBorerFindings().filter(borerHasData) : []; }
const borerHasData = b => !!(b && (b.borerActivity || b.borerType || b.location || b.timberAffected || b.description || b.structuralConcern));

function borerLine(b) {
  const where = [b.location, b.timberAffected && !String(b.location || '').toLowerCase().includes(b.timberAffected.toLowerCase()) ? b.timberAffected : ''].filter(Boolean).join(', ');
  return [b.borerType, where, b.description].filter(Boolean).join(': ');
}

// After a card changes: rewrite the one-line detail, and lift the overall
// answer to the strongest card (live borers in one card make it ACTIVE).
function syncBorerFromCards(activityChanged) {
  const cards = getBorerFindings();
  reportData.borerDetails = cards.filter(borerHasData).map(borerLine).filter(Boolean).join('. ') || null;
  if (!activityChanged) return;
  const acts = cards.map(b => b.borerActivity);
  const overall = acts.includes('ACTIVE') ? 'ACTIVE' : acts.includes('INACTIVE') ? 'INACTIVE' : null;
  const el = document.getElementById('f-borerActivity');
  if (overall && overall !== reportData.borerActivity && el) commitEdit(el, 'borerActivity', overall);
}

function addBorerFinding(activity) {
  const cards = getBorerFindings();
  if (cards.length >= MAX_BORER_FINDINGS) return;
  cards.push({ id: genFindingId(), borerActivity: activity || (reportData.borerActivity === 'ACTIVE' ? null : reportData.borerActivity) || null });
  renderBorerFindings();
  saveDraft();
}

function removeBorerFinding(id) {
  const cards = getBorerFindings();
  const index = cards.findIndex(b => b.id === id);
  if (index < 0) return;
  const removed = cards[index];
  reportData.borerFindings = cards.filter(b => b.id !== id);
  syncBorerFromCards();
  renderBorerFindings();
  saveDraft();
  showToast(`Borer finding ${index + 1} removed`, 'info', { label: 'Undo', run: () => {
    const list = getBorerFindings();
    if (list.some(b => b.id === removed.id)) return;
    list.splice(Math.min(index, list.length), 0, removed);
    syncBorerFromCards();
    renderBorerFindings();
    saveDraft();
  } });
}

function borerCardHTML(b, index) {
  const id = b.id;
  const act = b.borerActivity;
  const fv = (key, hint) => `<div class="field-val${b[key] ? ' filled' : ''}" onclick="startFindingEdit('${id}','${key}','text')">${b[key] ? escapeHtml(b[key]) : '—'}</div>`;
  return `
    <div class="finding-card borer-card" id="finding-card-${id}">
      <div class="finding-card-header">
        <span class="finding-card-label">${b.location ? `<span class="finding-card-title">${escapeHtml(b.location)}</span><small>Borer finding ${index + 1}</small>` : `Borer finding ${index + 1}`}</span>
        <span class="finding-activity-chip ${act || 'unset'}">${act || '—'}</span>
        <button class="finding-remove-btn" onclick="removeBorerFinding('${id}')" title="Remove this borer finding">✕</button>
      </div>
      <div class="finding-card-body">
        <div class="findings-gate choice-panel${act ? '' : ' unset'}" role="radiogroup" aria-label="Borer activity here">
          <div class="field-label">Borer Activity Here</div>
          ${choiceCardsHTML('borerCard', 'borer-' + id, act, `data-finding="${id}" data-fkey="borerActivity"`)}
        </div>
        <div class="findings-details" style="display:block">
        <div class="section-fields">
          <div class="field field-wide"><div class="field-label">Location</div>${pickFieldHTML(id, 'location', PLACES, b.location)}</div>
          <div class="field field-wide"><div class="field-label">Timber Affected</div>${pickFieldHTML(id, 'timberAffected', TIMBER_PARTS, b.timberAffected)}</div>
          <div class="field field-wide"><div class="field-label">Borer Type</div>${pickFieldHTML(id, 'borerType', BORER_TYPES, b.borerType)}</div>
          <div class="field field-wide"><div class="field-label">What Was Seen <span class="field-hint">Exit holes, frass, tunnelling. No severity opinion.</span></div>${pickFieldHTML(id, 'description', BORER_SIGNS, b.description)}</div>
          <div class="field choice-field"><div class="field-label">Refer to a Builder or Engineer?</div><div class="choice-panel${b.structuralConcern ? '' : ' unset'}" role="radiogroup">${choiceCardsHTML('finding', `structuralConcern-${id}`, b.structuralConcern, `data-finding="${id}" data-fkey="structuralConcern"`)}</div></div>
          <div class="field field-wide finding-photos"><div class="field-label">Photos of this finding</div>${spotPhotosHTML(findingPhotoSection(id))}</div>
        </div>
        ${b.structuralConcern === 'YES' ? `<div class="warn-note note-info" style="margin:0 0 10px"><svg class="icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Referral recorded. The PDF recommends a licensed builder or engineer assess this damage.</div>` : ''}
        </div>
      </div>
    </div>`;
}

function renderBorerFindings() {
  const wrap = document.getElementById('borerFindingsWrap');
  const list = document.getElementById('borerFindingsList');
  if (!wrap || !list) return;
  wrap.style.display = borersFound() ? '' : 'none';
  if (!borersFound()) return;
  const cards = getBorerFindings();
  // Don't redraw under a field being typed in.
  if (activeFindingEdit && cards.some(b => b.id === activeFindingEdit.findingId) && list.contains(document.activeElement)) return;
  list.innerHTML = cards.map(borerCardHTML).join('');
  hydrateSpotPhotos(list);
  const add = document.getElementById('addBorerBtn');
  if (add) {
    add.disabled = cards.length >= MAX_BORER_FINDINGS;
    add.querySelector('span').textContent = cards.length ? 'Add Another Borer Finding' : 'Add Where Borers Were Found';
  }
}

// Borer findings from one extracted note: a card at a place already
// recorded fills that card in; anything else is a new card.
function mergeBorerExtraction(values) {
  const incoming = [];
  if (Array.isArray(values.borerFindings)) {
    values.borerFindings.filter(b => b && typeof b === 'object').forEach(b => incoming.push({
      borerActivity: ['ACTIVE', 'INACTIVE'].includes(b.borerActivity) ? b.borerActivity : null,
      borerType: b.borerType || null, location: b.location || null, timberAffected: b.timberAffected || null,
      description: b.description || null, structuralConcern: b.structuralConcern || null,
    }));
  }
  // An older-style answer: one line of borer detail.
  if (typeof values.borerDetails === 'string' && values.borerDetails.trim() && !incoming.length) {
    incoming.push({ borerActivity: null, description: values.borerDetails.trim() });
  }
  delete values.borerFindings;
  delete values.borerDetails;
  const real = incoming.filter(borerHasData);
  if (!real.length) return;
  const overall = ['ACTIVE', 'INACTIVE'].includes(values.borerActivity) ? values.borerActivity : null;
  const cards = getBorerFindings();
  real.forEach(b => {
    if (!b.borerActivity) b.borerActivity = overall || (borersFound() ? reportData.borerActivity : 'INACTIVE');
    const same = cards.find(k => k.location && b.location && (repeatsPlace(k.location, b.location) || repeatsPlace(b.location, k.location)))
      || cards.find(k => !k.location && k.description && ((b.location && repeatsPlace(k.description, b.location)) || (b.description && k.description.toLowerCase() === b.description.toLowerCase())));
    if (same) {
      if (b.borerActivity === 'ACTIVE') same.borerActivity = 'ACTIVE';
      ['borerType', 'location', 'timberAffected', 'description', 'structuralConcern'].forEach(k => { if (!same[k] && b[k]) same[k] = b[k]; });
    } else if (cards.length < MAX_BORER_FINDINGS) {
      cards.push({ id: genFindingId(), ...b });
    }
  });
  const acts = cards.map(b => b.borerActivity);
  if (values.borerActivity !== 'NONE') values.borerActivity = acts.includes('ACTIVE') ? 'ACTIVE' : (values.borerActivity || reportData.borerActivity || 'INACTIVE');
  syncBorerFromCards();
  renderBorerFindings();
}

// ── HIGH RISK AREA PROMPT ────────────────────────────────────────────────
// If any finding has active or inactive termites, and there are uninspected
// areas logged, but high risk areas hasn't been filled — prompt the tech
function checkHighRiskPrompt() {
  const findings = getFindings();
  const hasActivity = findings.some(f =>
    f.termiteActivity === 'ACTIVE' || f.termiteActivity === 'INACTIVE'
  );
  const hasObstructions = areasNotFullyInspected().length > 0;
  const hasHighRisk = !!(reportData.highRiskAreas && reportData.highRiskAreas.trim() &&
    !reportData.highRiskAreas.includes('N/A'));

  const prompt = document.getElementById('highRiskPrompt');
  if (!prompt) return;

  if (hasActivity && hasObstructions && !hasHighRisk) {
    prompt.style.display = 'flex';
  } else {
    prompt.style.display = 'none';
  }
}

function dismissHighRiskPrompt() {
  const prompt = document.getElementById('highRiskPrompt');
  if (prompt) prompt.style.display = 'none';
}

function goToHighRiskAreas() {
  dismissHighRiskPrompt();
  showSection('obstructions');
  setTimeout(() => {
    const el = document.getElementById('f-highRiskAreas');
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); startEdit(el, 'highRiskAreas', 'text'); }
  }, 300);
}

// checkFindingsGate now just re-renders — the gate logic is inside each card
function checkFindingsGate() {
  renderFindingsUI();
}

// ── EXISTING SYSTEM VERIFICATION ────────────────────────────────────────
// "existingSystem" is free text, so a technician typing "No", "None", "Nil",
// "N/A" etc. must NOT count as an identified system — only an actual system
// name/description should reveal the verification checklist.
// The pick-list's answer for a house with no system, so the question is
// answered rather than left blank.
const NO_SYSTEM_FOUND = 'No System Found';
const NO_SYSTEM_VALUES = new Set([
  '', '—', 'no', 'none', 'nil', 'na', 'n a', 'n/a', 'not applicable',
  'no system', 'nothing', 'no existing system', 'not identified',
  'no system identified', 'no system present', 'no system found', 'no system installed',
  'none found', 'not found', 'none seen', 'none observed', 'none visible',
]);
function hasIdentifiedSystem(value) {
  if (!value) return false;
  const norm = value.trim().toLowerCase().replace(/[.!\-–—]/g, '').replace(/\s+/g, ' ').trim();
  return !NO_SYSTEM_VALUES.has(norm);
}

function checkSystemVerify() {
  const block = document.getElementById('systemVerify');
  if (!block) return;

  const hasSystem = hasIdentifiedSystem(reportData.existingSystem);
  block.style.display = hasSystem ? 'block' : 'none';
  // No system found: no name to give, unless one was typed already.
  const nameField = document.getElementById('f-existingSystemOther')?.closest('.field');
  if (nameField) nameField.style.display = !hasSystem && !isBlankValue(reportData.existingSystem) && isBlankValue(reportData.existingSystemOther) ? 'none' : '';
  if (!hasSystem) return;

  const flag = document.getElementById('systemVerifyFlag');
  const flagText = document.getElementById('systemVerifyFlagText');
  if (!flag) return;

  const concerns = [];
  if (reportData.durableNoticePresent === 'NO') concerns.push('durable notice sticker not found in meter box');
  if (reportData.hardLandscaping === 'YES' && reportData.zone25mmVisible === 'NO') concerns.push('25mm inspection zone not visible against hard landscaping');
  if (reportData.softLandscaping === 'YES' && reportData.zone75mmVisible === 'NO') concerns.push('75mm inspection zone not visible against soft landscaping');
  if (reportData.antCapSoldered === 'NO') concerns.push('ant cap / strip shield joins not soldered — shielding inadequate');

  if (concerns.length > 0) {
    flagText.textContent = 'Verification concern' + (concerns.length > 1 ? 's' : '') + ': ' + concerns.join('; ') + '. Recommend rectification and re-verification of the existing system.';
    flag.style.display = 'flex';
  } else {
    flag.style.display = 'none';
  }
}

// ── SECONDARY / SATELLITE COLONY REMINDER ───────────────────────────────
// Subterranean termites can establish an above-ground colony with zero soil
// contact if there's an alternative moisture source (roof leak, wall-cavity
// plumbing leak). leakLocation is free text, so this is necessarily a
// best-effort keyword check, not a hard gate — false negatives just mean no
// reminder shown, which is no worse than the field not existing at all.
const ABOVE_GROUND_LEAK_KEYWORDS = [
  'roof', 'ceiling', 'wall cavity', 'gutter', 'ridge', 'attic', 'sarking',
  'upstairs', 'second storey', 'second story', 'second floor', 'ensuite',
  'bathroom', 'shower', 'hot water', 'skylight', 'flashing', 'downpipe'
];
function isAboveGroundLeak(text) {
  if (!text) return false;
  const norm = text.toLowerCase();
  return ABOVE_GROUND_LEAK_KEYWORDS.some(k => norm.includes(k));
}

// Inspectors always recommend treatment when live termites are found, so a
// live finding fills Treatment Required with YES when it's still blank. It
// never overrides an answer the inspector gave. The banner stays up while
// that auto answer stands and no treatment type has been added.
function ensureTreatmentForLiveTermites() {
  const live = getFindings().some(f => f && f.termiteActivity === 'ACTIVE');
  if (live && !reportData.treatmentRecommended) {
    const el = document.getElementById('f-treatmentRecommended');
    reportData.treatmentRecommended = 'YES';
    reportData.treatmentAutoSet = true;
    applyFieldCascade('treatmentRecommended', 'YES', el);
    if (el) renderField(el, 'treatmentRecommended', 'YES');
    updateProgress();
    saveDraft();
    showToast('Live termites found, so Treatment Required is set to Yes', 'info');
  }
  const banner = document.getElementById('treatmentAutoBanner');
  if (banner) {
    const show = live && reportData.treatmentAutoSet && reportData.treatmentRecommended === 'YES' && !reportData.treatmentType;
    banner.style.display = show ? 'flex' : 'none';
  }
}

function checkSecondaryColonyFlag() {
  const banner = document.getElementById('secondaryColonyReminder');
  if (!banner) return;
  banner.style.display = isAboveGroundLeak(reportData.leakLocation) ? 'flex' : 'none';
}

// ── COMPASS ─────────────────────────────────────────────────────────────
// A working compass for the Orientation field, so the inspector doesn't
// leave the app for one. Tapping Orientation opens it. It reads the phone's
// own compass (iPhone asks once, on the first tap) and turns magnetic north
// into true north for the job's state. The dial turns live and the green
// button under it names the direction; tapping it locks the reading and
// brings up Confirm, which fills Orientation. With no compass the button
// opens the usual list instead.
const COMPASS_POINTS_8 = ['North', 'North-east', 'East', 'South-east', 'South', 'South-west', 'West', 'North-west'];
// Rough magnetic declination by state (degrees east), enough to get the
// 8-point answer right. Capital-city values; the far north of QLD and WA
// differ by a few degrees.
const STATE_DECLINATION = { NSW: 12.5, ACT: 12.5, VIC: 11.5, TAS: 14.5, QLD: 10, SA: 8, WA: 0, NT: 4 };
let compassTarget = null;    // latest true heading from the phone, degrees clockwise from north
let compassHeading = null;   // smoothed heading the screen shows, eased toward compassTarget
let compassDial = 0;         // the dial's angle, never wrapped, so it can't spin the long way past north
let compassPoint = null;     // index into COMPASS_POINTS_8 the button shows
let compassFrame = null;
let compassLocked = null;    // the heading locked in, or null while live
let compassFailed = false;   // no compass: the button opens the list instead
let compassListening = null; // the event name being listened to
let compassNoSignalTimer = null;

function compassDeclination() {
  const state = (document.getElementById('jobState') || {}).value || reportData.propertyState || '';
  return STATE_DECLINATION[state] != null ? { deg: STATE_DECLINATION[state], state } : null;
}

// The button keeps its direction until the heading is a few degrees into the
// next one, so it doesn't flick back and forth on a boundary.
function compassPointFor(h) {
  const idx = Math.round(h / 45) % 8;
  if (compassPoint == null) return idx;
  const off = Math.abs(((h - compassPoint * 45 + 540) % 360) - 180);
  return off > 22.5 + 4 ? idx : compassPoint;
}

async function openCompass() {
  if (isReportLocked()) { showToast('This job is complete and locked. Tap Amend to change it', 'info'); return; }
  commitActive();
  compassTarget = null;
  compassHeading = null;
  compassPoint = null;
  compassLocked = null;
  compassFailed = false;
  setCompassNote('');
  document.getElementById('compassOverlay').classList.add('open');
  renderCompass();
  // iPhone: the permission prompt has to come from this tap.
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      if (await DeviceOrientationEvent.requestPermission() !== 'granted') {
        compassUnavailable('Compass blocked. Allow Motion & Orientation Access in Settings › Safari.');
        return;
      }
    } catch (e) {
      compassUnavailable('Compass didn\'t start.');
      return;
    }
  }
  startCompass();
  track('compass_opened');
}

function startCompass() {
  stopCompass();
  compassListening = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
  window.addEventListener(compassListening, onCompassReading);
  compassNoSignalTimer = setTimeout(() => {
    if (compassHeading == null) compassUnavailable('No compass on this device.');
  }, 2500);
}

function compassUnavailable(note) {
  stopCompass();
  compassFailed = true;
  setCompassNote(note);
  renderCompass();
}

function stopCompass() {
  if (compassListening) window.removeEventListener(compassListening, onCompassReading);
  compassListening = null;
  clearTimeout(compassNoSignalTimer);
  cancelAnimationFrame(compassFrame);
  compassFrame = null;
}

function closeCompass() {
  stopCompass();
  document.getElementById('compassOverlay').classList.remove('open');
}

function onCompassReading(e) {
  let magnetic = null;
  if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) {
    magnetic = e.webkitCompassHeading; // iPhone: already clockwise from north
  } else if (e.absolute && typeof e.alpha === 'number') {
    // Android: alpha turns anticlockwise; correct for a sideways screen.
    const turn = (screen.orientation && screen.orientation.angle) || 0;
    magnetic = (360 - e.alpha + turn) % 360;
  }
  if (magnetic == null) return;
  const dec = compassDeclination();
  compassTarget = (magnetic + (dec ? dec.deg : 0) + 360) % 360;
  if (compassHeading == null) {
    compassHeading = compassTarget;
    compassDial = compassTarget;
    renderCompass();
  }
  if (compassLocked == null) {
    const poor = typeof e.webkitCompassAccuracy === 'number' && (e.webkitCompassAccuracy < 0 || e.webkitCompassAccuracy > 25);
    setCompassNote(poor ? 'Rough reading. Move the phone in a figure 8.' : '');
  }
  if (!compassFrame) compassFrame = requestAnimationFrame(stepCompass);
}

// Readings arrive unevenly and wobble; the dial eases toward the latest one
// each frame, the short way round past north, and ignores sub-degree wobble.
function stepCompass() {
  compassFrame = null;
  if (compassTarget == null || compassLocked != null) return;
  const diff = ((compassTarget - compassHeading + 540) % 360) - 180;
  if (Math.abs(diff) < 0.3) return;
  const step = diff * 0.12;
  compassHeading = (compassHeading + step + 360) % 360;
  compassDial += step;
  renderCompass();
  compassFrame = requestAnimationFrame(stepCompass);
}

function setCompassNote(text) {
  const note = document.getElementById('compassNote');
  if (note) { note.textContent = text; note.hidden = !text; }
}

function renderCompass() {
  const h = compassLocked != null ? compassLocked : compassHeading;
  const has = h != null;
  if (has && compassLocked == null) compassPoint = compassPointFor(h);
  const label = has ? COMPASS_POINTS_8[compassPoint] : '';
  const btn = document.getElementById('compassMain');
  btn.classList.toggle('locked', compassLocked != null);
  btn.disabled = !has && !compassFailed;
  const text = has ? label : compassFailed ? 'Choose from list' : 'Finding north…';
  if (btn.textContent !== text) btn.textContent = text;
  document.getElementById('compassRose').style.transform = `rotate(${has ? -compassDial : 0}deg)`;
  document.getElementById('compassConfirmBtn').hidden = compassLocked == null;
}

function tapCompassMain() {
  if (compassFailed && compassHeading == null) {
    const el = document.getElementById('f-facadeDirection');
    closeCompass();
    if (el) startEdit(el, 'facadeDirection', 'facadedirection');
    return;
  }
  if (compassHeading == null) return;
  compassLocked = compassLocked == null ? compassHeading : null;
  renderCompass();
  if (compassLocked == null && !compassFrame) compassFrame = requestAnimationFrame(stepCompass);
}

function confirmCompass() {
  if (compassLocked == null) return;
  const el = document.getElementById('f-facadeDirection');
  const value = COMPASS_POINTS_8[compassPoint];
  closeCompass();
  if (el) commitEdit(el, 'facadeDirection', value);
  showToast(`Orientation set to ${value}`, 'success');
}

// ── MOISTURE METER READINGS ─────────────────────────────────────────────
// reportData.moistureTable is a list of { id, location, reading } rows,
// e.g. { location: 'Base of shower wall, bathroom', reading: '28%' }.
// Typed in the Conducive section or filled from voice.
const MAX_MOISTURE_READINGS = 30;

function getMoistureTable() {
  if (!Array.isArray(reportData.moistureTable)) reportData.moistureTable = [];
  return reportData.moistureTable;
}

function addMoistureReading(location = '', reading = '') {
  const rows = getMoistureTable();
  if (rows.length >= MAX_MOISTURE_READINGS) return;
  rows.push({ id: 'mr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), location, reading });
  renderMoistureTable();
  saveDraft();
}

function updateMoistureReading(id, key, value) {
  const row = getMoistureTable().find(r => r.id === id);
  if (row) { row[key] = value; saveDraft(); }
}

function removeMoistureReading(id) {
  reportData.moistureTable = getMoistureTable().filter(r => r.id !== id);
  renderMoistureTable();
  saveDraft();
}

function renderMoistureTable() {
  const list = document.getElementById('moistureTableRows');
  if (!list) return;
  const rows = getMoistureTable();
  list.innerHTML = rows.length === 0
    ? '<div class="section-photo-empty">No readings recorded</div>'
    : rows.map(r => `
      <div class="moisture-row">
        <input class="photo-caption-input" type="text" placeholder="Location" value="${escapeHtml(r.location || '')}"
               oninput="updateMoistureReading('${r.id}','location',this.value)">
        <input class="photo-caption-input moisture-reading" type="text" inputmode="decimal" placeholder="Reading" value="${escapeHtml(r.reading || '')}"
               oninput="updateMoistureReading('${r.id}','reading',this.value)">
        <button class="photo-remove-btn" onclick="removeMoistureReading('${r.id}')" aria-label="Remove reading">✕</button>
      </div>`).join('');
}


const HIGH_ASBESTOS_ERAS = ['1945-1965', '1965-1985'];
const MODERATE_ASBESTOS_ERAS = ['1920s-1940s', '1985-2003'];

function checkAsbestosFlag() {
  const era = reportData.constructionEra;
  const banner = document.getElementById('asbestosBanner');
  if (!banner) return;

  if (HIGH_ASBESTOS_ERAS.includes(era)) {
    banner.style.display = 'flex';
    banner.querySelector('.asb-text').textContent =
      `High chance of asbestos materials for this era (${era.replace(/(\d)-(\d)/g, '$1–$2')}), such as fibro and cement sheeting. Note them as an observation only and don't disturb them. If you suspect asbestos, recommend a licensed asbestos assessor.`;
  } else if (MODERATE_ASBESTOS_ERAS.includes(era)) {
    banner.style.display = 'flex';
    banner.querySelector('.asb-text').textContent =
      `Some chance of asbestos materials for this era (${era.replace(/(\d)-(\d)/g, '$1–$2')}). Note them as an observation only and don't disturb anything you suspect.`;
  } else {
    banner.style.display = 'none';
  }
}

function autoReveal(data) {
  // FIX: an explicitly empty array (e.g. the AI returning findings: [] to
  // mean "nothing found") was still treated as "this section has new
  // data", jumping the user straight to a section that has nothing in it.
  // Only a non-empty value counts as real data to navigate to.
  const hasRealData = (v) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0);
  for (const [sec, cfg] of Object.entries(SECTIONS)) {
    if (cfg.fields.some(f => hasRealData(data[f]))) {
      showSection(sec);
      return;
    }
  }
}

// ── EDITING ───────────────────────────────────────────────────────────────
// There's no Edit Mode: any field opens for editing when tapped, unless the
// job is complete and locked.

// Global species list — used by both startEdit and startFindingEdit
const SPECIES_LIST = [
  'Coptotermes acinaciformis', 'Coptotermes frenchi', 'Coptotermes lacteus',
  'Schedorhinotermes intermedius', 'Schedorhinotermes actuosus',
  'Nasutitermes exitiosus', 'Nasutitermes walkeri', 'Nasutitermes magnus',
  'Heterotermes ferox', 'Microcerotermes distinctus', 'Microcerotermes implicatus',
  'Termes intermedius', 'Cryptotermes brevis', 'Cryptotermes primus',
  'Anobium punctatum — Furniture beetle', 'Lyctus brunneus — Powder post beetle',
  'Hylotrupes bajulus — House longhorn beetle',
  'Coptotermes spp.', 'Schedorhinotermes spp.', 'Nasutitermes spp.',
  'Microcerotermes spp.', 'Species not identified — further investigation required',
];

// One-line text editors save on Enter (Done on a phone keyboard) or when
// the inspector taps away, and Escape backs out. There's no Confirm bar:
// it could be left behind on screen when focus moved on without it.
// `onBlur` saves a tap-away differently when given; it defaults to `onSave`.
function wireInlineTextEdit(input, onSave, onCancel, onBlur) {
  let done = false;
  const finish = (fn, ...args) => { if (done) return; done = true; fn(...args); };
  input.enterKeyHint = 'done';
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(onSave, input.value); }
    if (e.key === 'Escape') { e.preventDefault(); finish(onCancel); }
  });
  input.addEventListener('blur', () => finish(onBlur || onSave, input.value));
}

// The last choice in a list that opens a typing box instead of saving.
const OTHER_TYPE_IT = 'Other (type it)';
function startEdit(el, key, type) {
  if (isReportLocked()) { showToast('This job is complete and locked. Tap Amend to change it', 'info'); return; }
  if (el.classList.contains('editing')) return;
  commitActive();
  activeEditEl = el;
  el.classList.add('editing');

  const cur = reportData[key] || '';
  const OPTIONS = {
    era:         ['Pre-1920s','1920s-1940s','1945-1965','1965-1985','1985-2003','Post-2003'],
    standard:    ['AS 3660.1-2014','AS 3660.2-2017','AS 3660.3-2014','AS 4349.0-2007','AS 4349.1-2007','AS 4349.3-2010'],
    structuretype: [
      'Detached house',
      'Semi-detached',
      'Terrace / townhouse',
      'Duplex',
      'Unit / apartment',
      'Granny flat',
      'Commercial building',
      'Other',
    ],
    wallconstruction: [
      'Brick veneer',
      'Double brick',
      'Weatherboard',
      'Fibro / cement sheet',
      'Rendered masonry',
      'Lightweight cladding',
      'Mixed construction',
      'Other',
    ],
    floortype: [
      'Concrete slab on ground',
      'Timber suspended floor',
      'Elevated timber (stumps)',
      'Combination slab / timber',
      'Other',
    ],
    rooftype: [
      'Colorbond metal',
      'Tiled — concrete',
      'Tiled — terracotta',
      'Corrugated iron',
      'Flat membrane',
      'Mixed',
      'Other',
    ],
    facadedirection: [
      'North',
      'North-east',
      'East',
      'South-east',
      'South',
      'South-west',
      'West',
      'North-west',
    ],
    furnishing: ['Fully furnished', 'Partly furnished', 'Unfurnished'],
    peoplepresent: ['Client', 'Client and agent', 'Real estate agent', 'Vendor', 'Purchaser', 'Tenant', 'No one', OTHER_TYPE_IT],
    recentweather: ['Normal for the season', 'Prolonged dry period', 'Prolonged wet period', OTHER_TYPE_IT],
    toolsused: ['Moisture meter', 'Moisture meter and sounding tool', 'Moisture meter, sounding tool and thermal camera', 'Moisture meter, sounding tool and movement detector', 'Moisture meter, sounding tool, thermal camera and movement detector', OTHER_TYPE_IT],
    surroundings: ['Suburban, few trees', 'Trees close to the building', 'Next to bushland or a reserve', 'Rural', OTHER_TYPE_IT],
    siteslope: ['Flat', 'Slopes away from the building', 'Slopes towards the building', 'Steep', OTHER_TYPE_IT],
    termitehistory: ['None known', 'Termites reported before', 'Treated before', 'Unknown', OTHER_TYPE_IT],
    occupancystatus: [
      'Occupied — residential',
      'Owner occupied',
      'Tenanted',
      'Vacant',
      'Under renovation',
      'Commercial / industrial',
      'Other',
    ],
    treatmenttype: [
      'Chemical barrier — Termidor (Fipronil)',
      'Chemical barrier — Altriset (Chlorantraniliprole)',
      'Chemical barrier — Biflex (Bifenthrin)',
      'Baiting system — Exterra',
      'Baiting system — Sentricon',
      'Baiting system — Trelona',
      'Physical barrier — HomeGuard',
      'Physical barrier — Kordon',
      'Combination treatment',
      'Localised treatment only',
      'To be quoted separately',
    ],
    reinspection: [
      '3 months',
      '6 months',
      '12 months (annual)',
      '12 months — per management system spec',
      '6 months — elevated risk',
      '3 months — active infestation follow-up',
    ],
    specieslist: SPECIES_LIST,

    inspectionareas: [
      // Subfloor
      'Subfloor — general',
      'Subfloor — eastern elevation',
      'Subfloor — western elevation',
      'Subfloor — northern elevation',
      'Subfloor — southern elevation',
      'Subfloor — central',
      'Subfloor — perimeter',
      // Roof void
      'Roof void — general',
      'Roof void — eastern elevation',
      'Roof void — western elevation',
      'Roof void — northern elevation',
      'Roof void — southern elevation',
      // Internal
      'Internal — wall cavities',
      'Internal — bathroom',
      'Internal — kitchen',
      'Internal — laundry',
      'Internal — garage',
      'Internal — living areas',
      'Internal — bedrooms',
      // External
      'External — perimeter',
      'External — eastern elevation',
      'External — western elevation',
      'External — northern elevation',
      'External — southern elevation',
      // Other
      'Garden structures',
      'Fence lines',
      'Outbuildings',
      'All areas — no exclusions',
    ],

    obstructiontype: [
      'Stored goods / personal items',
      'Floor coverings',
      'Wall linings / plasterboard',
      'Fixed ceilings',
      'Thermal insulation',
      'Air conditioning ducting',
      'Furniture',
      'Safety concern — unsafe access',
      'Subfloor — insufficient clearance',
      'Subfloor — access hatch too small',
      'Subfloor — water / flooding present',
      'Roof void — insulation blanket',
      'Roof void — unsafe structure',
      'No access provided — locked',
      'Vegetation / overgrowth',
      'Earth / soil build-up',
      'Building materials / debris',
    ],

    restrictiontype: [
      'Furnished — items could not be moved',
      'Partial floor covering — some areas obscured',
      'Limited subfloor clearance — crawl inspection only',
      'Roof void — restricted by ducting',
      'Wet conditions at time of inspection',
      'Occupied property — full inspection limited',
      'Inspection distance limited — over 3.6m above ground',
      'Below ground timbers — not included in scope',
    ],

    leaklocation: [
      'Hot water system / service',
      'Roof void — general',
      'Roof — flashing failure',
      'Roof — valley / junction',
      'Wall cavity — bathroom',
      'Wall cavity — kitchen',
      'Wall cavity — laundry',
      'Wall cavity — general',
      'Subfloor — plumbing',
      'Subfloor — stormwater',
      'Subfloor — surface water ingress',
      'Air conditioning unit / condensate',
      'Downpipe / gutter overflow',
      'Shower recess — waterproofing failure',
      'External — garden irrigation',
      'External — surface drainage issue',
    ],

    existingsystem: [
      'Physical Barrier',
      'Chemical Reticulation System',
      'Chemical Barrier',
      'Termite Baiting System',
      'Combination System — Physical + Chemical',
      'System Present — Type Unidentified',
      NO_SYSTEM_FOUND,
    ],
    // "What and where" boxes: pick the usual answer, or type your own.
    highrisk: [
      'Subfloor',
      'Roof void',
      'Wall cavities',
      'Behind stored goods',
      'Under floor coverings',
      'Behind fixed cabinetry',
      'Concealed slab edge',
      'Wet areas (bathroom, laundry, kitchen)',
      'Garage',
      'Outbuildings',
      OTHER_TYPE_IT,
    ],
    prevtreatmentwhere: [
      'Slab perimeter',
      'Around the whole house',
      'Front of the house',
      'Rear of the house',
      'Patio or paving',
      'Paths and driveway',
      'Garage',
      'Subfloor',
      'Garden beds',
      'Meter box',
      OTHER_TYPE_IT,
    ],
    prevtreatment: [
      'Drill and inject soil treatment',
      'Plugged drill holes',
      'Bait stations',
      'Monitoring stations',
      'Dusting residue',
      'Reticulation system',
      'Physical barrier',
      'Treatment notice in meter box',
      OTHER_TYPE_IT,
    ],
    nondurable: [
      'Untreated pine sleepers',
      'Untreated garden edging',
      'Untreated posts',
      'Untreated decking',
      'Timber retaining wall',
      'Untreated pine framing',
      'Firewood stack',
      OTHER_TYPE_IT,
    ],
    nondurablewhere: [
      'Against the house',
      'Front garden',
      'Rear garden',
      'Side of the house',
      'Along the fence',
      'Deck or patio',
      'Subfloor',
      OTHER_TYPE_IT,
    ],
    decaywhat: [
      'Soft or spongy timber',
      'Crumbling timber',
      'Fungal growth',
      'Brown rot, cubed cracking',
      'White rot, stringy and bleached',
      'Timber rotted through',
      'Paint bubbling over damp timber',
      OTHER_TYPE_IT,
    ],
    decaywhere: [
      'Subfloor bearers or joists',
      'Floorboards',
      'Window frames or sills',
      'Door frames',
      'Fascia or barge boards',
      'Deck or pergola',
      'Wet areas (bathroom, laundry)',
      'Roof timbers',
      'Fence or retaining wall',
      OTHER_TYPE_IT,
    ],
    delignwhat: [
      'Furry or hairy timber surface',
      'Fibrous, fluffy timber',
      'Timber surface breaking down',
      OTHER_TYPE_IT,
    ],
    delignwhere: [
      'Roof timbers',
      'Near the chimney',
      'Coastal side of the house',
      'Subfloor timbers',
      'Near stored chemicals or pool',
      OTHER_TYPE_IT,
    ],
    weatherconditions: [
      'Fine and dry',
      'Overcast',
      'Light rain',
      'Heavy rain',
      'Humid',
      'Windy',
      'Other',
    ],
  };

  // Context-aware specific system names — options depend on what type was selected
  const SPECIFIC_SYSTEMS_BY_TYPE = {
    'Physical Barrier': [
      'HomeGuard Blue', 'HomeGuard DPC', 'HomeGuard TMB', 'HomeGuard GT',
      'Kordon', 'Termseal', 'Smartfilm', 'Termimesh', 'Granitgard', 'Greenzone',
    ],
    'Chemical Reticulation System': [
      'Termguard', 'Altis', 'TermX', 'TermStop', 'Camilleri', 'Cavtech', 'Reterm',
    ],
    'Chemical Barrier': [
      'Termidor', 'Altriset', 'Premise', 'Biflex',
    ],
    'Termite Baiting System': [
      'Exterra', 'Sentricon', 'Trelona', 'Nemesis',
    ],
    'Combination System — Physical + Chemical': [
      'HomeGuard Blue', 'HomeGuard DPC', 'HomeGuard TMB', 'Kordon', 'Termseal',
      'Termguard', 'Altis', 'TermX', 'Exterra', 'Sentricon', 'Trelona',
    ],
    'System Present — Type Unidentified': [
      'HomeGuard Blue', 'HomeGuard DPC', 'HomeGuard TMB', 'HomeGuard GT',
      'Kordon', 'Termseal', 'Smartfilm', 'Termimesh', 'Granitgard', 'Greenzone',
      'Termguard', 'Altis', 'TermX', 'TermStop', 'Camilleri', 'Cavtech',
      'Termidor', 'Altriset', 'Premise', 'Biflex',
      'Exterra', 'Sentricon', 'Trelona', 'Nemesis',
    ],
  };

  // Dynamic lookup for specific system options based on current type selection
  if (type === 'existingsystemspecific') {
    const currentType = reportData.existingSystem || '';
    const specificOptions = SPECIFIC_SYSTEMS_BY_TYPE[currentType] || Object.values(SPECIFIC_SYSTEMS_BY_TYPE).flat().filter((v,i,a)=>a.indexOf(v)===i).sort();
    OPTIONS['existingsystemspecific'] = specificOptions;
  }
  if (OPTIONS[type]) {
    input = document.createElement('select');
    // An empty field opens on "Choose…", not the first option: tapping in and
    // away again used to save that first option (a blank era became
    // "Pre-1920s", a blank system "Physical Barrier"). A value that isn't in
    // the list (an older report's wording) stays as it is.
    const opts = cur && !OPTIONS[type].includes(cur) ? [cur, ...OPTIONS[type]] : OPTIONS[type];
    input.innerHTML = (cur ? '' : '<option value="" selected>Choose…</option>') +
      opts.map(o => `<option value="${escapeHtml(o)}" ${cur===o?'selected':''}>${escapeHtml(o)}</option>`).join('');
    let switched = false;
    input.addEventListener('change', () => {
      if (input.value === OTHER_TYPE_IT) { switched = true; el.classList.remove('editing'); startEdit(el, key, 'text'); return; }
      commitEdit(el, key, input.value);
    });
    input.addEventListener('blur', () => { if (!switched && el.classList.contains('editing')) commitEdit(el, key, input.value); });
  } else {
    input = document.createElement('input');
    input.type = 'text';
    input.value = cur;
    input.placeholder = 'Type value...';
    wireInlineTextEdit(input,
      v => { if (el.classList.contains('editing')) commitEdit(el, key, v); },
      () => { if (el.classList.contains('editing')) cancelEdit(el, key); });
    el.innerHTML = '';
    el.appendChild(input);
    input.focus();
    input.select();
    return; // skip the generic el.innerHTML / appendChild below
  }

  el.innerHTML = '';
  el.appendChild(input);
  input.focus();
  if (input.tagName === 'INPUT') input.select();
}

// FIX: this cross-field logic (hide/reveal dependent fields, auto-fill or
// clear a field when a related one changes) used to live only inside
// commitEdit - which only runs when a TECHNICIAN manually edits a field by
// hand. But voice/AI extraction (populateFields, the app's core input
// method) writes values into reportData directly and never called any of
// this, so dictating "no moisture detected" after an earlier pass had
// recorded a water leak left reportData.waterLeaks='YES' and a leak
// location sitting there uncleared - a genuinely self-contradictory report
// (moisture: NO, but water leak: YES at a specific spot) with no visible
// sign anything was wrong. Same gap for treatmentRecommended's auto-fill.
// Pulled out into one shared function both paths call, so there's only one
// place this logic can drift out of sync again.
// `prev` is the field's value before this write, when the caller knows it;
// populateFields passes it so a note that repeats the same system type
// doesn't throw away the brand a plate scan or an earlier note recorded.
function applyFieldCascade(key, value, el, prev) {
  if (key === 'standard') setStandard(value.trim(), true);
  if (key === 'invasiveInspection' || key === 'invasiveInspectionDetails') syncInvasiveDetails();

  if (key === 'existingSystem') {
    // Clear specific name when type changes — it may no longer be valid
    if (prev === undefined || String(prev || '').trim() !== value.trim()) {
      reportData.existingSystemOther = '';
      const specificEl = document.getElementById('f-existingSystemOther');
      if (specificEl) { specificEl.classList.remove('filled'); specificEl.textContent = '—'; }
    }
    checkSystemVerify();
  }

  // Show water leak fields only when moisture detected = YES
  if (key === 'moistureReadings') {
    const wrap = document.getElementById('waterLeakWrap');
    if (wrap) {
      if (value === 'YES') {
        wrap.style.display = '';
      } else {
        wrap.style.display = 'none';
        // Clear water leak and location if moisture is NO
        reportData.waterLeaks = 'NO';
        reportData.leakLocation = '';
        const wlEl = document.getElementById('f-waterLeaks');
        const llEl = document.getElementById('f-leakLocation');
        const llWrap = document.getElementById('leakLocationWrap');
        if (wlEl) { wlEl.textContent = 'NO'; wlEl.classList.add('filled'); }
        if (llEl) { llEl.textContent = '—'; llEl.classList.remove('filled'); }
        if (llWrap) llWrap.style.display = 'none';
      }
    }
  }

  // Show leak location only when water leaks = YES
  if (key === 'waterLeaks') {
    const llWrap = document.getElementById('leakLocationWrap');
    if (llWrap) llWrap.style.display = value === 'YES' ? '' : 'none';
    if (value === 'NO') {
      reportData.leakLocation = '';
      const llEl = document.getElementById('f-leakLocation');
      if (llEl) { llEl.textContent = '—'; llEl.classList.remove('filled'); }
    }
  }

  // Auto-fill treatment type based on treatment required answer
  if (key === 'treatmentRecommended') {
    const typeEl = document.getElementById('f-treatmentType');
    if (value === 'NO') {
      reportData.treatmentType = 'No treatment required at this time';
      if (typeEl) { typeEl.textContent = 'No treatment required at this time'; typeEl.classList.add('filled'); }
    } else if (value === 'YES') {
      if (reportData.treatmentType === 'No treatment required at this time') {
        reportData.treatmentType = '';
        if (typeEl) { typeEl.textContent = '—'; typeEl.classList.remove('filled'); }
      }
    }
  }
}

function commitEdit(el, key, value) {
  if (key === 'borerActivity' && ['ACTIVE', 'INACTIVE'].includes(value) && !getBorerFindings().length) {
    reportData.borerFindings.push({ id: genFindingId(), borerActivity: value });
  }
  el.classList.remove('editing');
  el.innerHTML = ''; // clear input + actions bar before re-rendering

  if (!value || !value.trim()) {
    // An emptied field is cleared, with Undo in case it was a slip.
    const prev = reportData[key];
    el.classList.remove('filled'); el.textContent = '—';
    activeEditEl = null;
    if (isBlankValue(prev)) return;
    reportData[key] = null;
    learnFieldCorrection(key, '');
    updateProgress();
    checkAsbestosFlag();
    checkSystemVerify();
    saveDraft();
    showToast('Cleared', 'info', { label: 'Undo', run: () => {
      if (!isBlankValue(reportData[key])) return;
      reportData[key] = prev;
      learnFieldCorrection(key, prev);
      renderField(el, key, prev);
      updateProgress();
      checkAsbestosFlag();
      checkSystemVerify();
      saveDraft();
    } });
    return;
  }

  reportData[key] = value.trim();
  learnFieldCorrection(key, value.trim());
  if (key === 'treatmentRecommended') reportData.treatmentAutoSet = false;
  applyFieldCascade(key, value.trim(), el);

  renderField(el, key, value.trim());

  const label = getFieldLabel(el);
  if (label && !label.querySelector('.edited-dot')) {
    const dot = document.createElement('span');
    dot.className = 'edited-dot';
    label.appendChild(dot);
  }

  activeEditEl = null;
  updateProgress();
  checkFindingsGate();
  checkSystemVerify();
  checkSecondaryColonyFlag();
  ensureTreatmentForLiveTermites();
  if (key === 'standard') {
    const sel = document.getElementById('standardSelect');
    if (sel) sel.value = value.trim();
  }
  saveDraft();
}

function cancelEdit(el, key) {
  const prev = reportData[key];
  if (prev) renderField(el, key, prev);
  else { el.classList.remove('editing','filled'); el.textContent = '—'; }
  el.classList.remove('editing');
  activeEditEl = null;
}

function commitActive() {
  if (activeEditEl && activeEditEl.classList.contains('editing')) {
    const input = activeEditEl.querySelector('input, select');
    if (input && input.value.trim() && input.value !== OTHER_TYPE_IT) {
      const key = activeEditEl.id.replace('f-', '');
      commitEdit(activeEditEl, key, input.value);
    } else if (input) {
      cancelEdit(activeEditEl, activeEditEl.id.replace('f-', ''));
    }
  }
}

// ── NAV ───────────────────────────────────────────────────────────────────
// ── REPORT STEPS ──────────────────────────────────────────────────────────
// The report's tabs. A step shows one or more sections: Areas holds the
// areas and what couldn't be inspected, Finish holds the other photos and
// the sign-off. Sections stay the unit for progress, voice and the PDF.
const REPORT_STEPS = [
  { id: 'property', sections: ['property'] },
  { id: 'areas', sections: ['obstructions', 'restrictions'] },
  { id: 'findings', sections: ['findings'] },
  { id: 'conducive', sections: ['conducive'] },
  { id: 'recommendations', sections: ['recommendations'] },
  { id: 'finish', sections: ['photos', 'signoff'] },
];
const stepOf = name => REPORT_STEPS.find(st => st.id === name || st.sections.includes(name)) || REPORT_STEPS[0];
let currentStep = 'property';

// name is a section or a step. A section further down its step is scrolled
// to, so "Go to Access" lands on it.
function showSection(name) {
  const step = stepOf(name);
  const changed = step.id !== currentStep;
  currentStep = step.id;
  Object.keys(SECTIONS).forEach(s => {
    const el = document.getElementById('section-' + s);
    if (!el) return;
    if (step.sections.includes(s)) {
      el.style.display = 'block';
      if (changed) {
        el.style.animation = 'none';
        void el.offsetWidth; // restarts the animation
        el.style.animation = '';
      }
    } else {
      el.style.display = 'none';
    }
  });
  REPORT_STEPS.forEach(st => {
    const tab = document.getElementById('tab-' + st.id);
    if (tab) {
      tab.classList.toggle('active', st.id === step.id);
      tab.setAttribute('aria-current', st.id === step.id ? 'step' : 'false');
    }
  });
  document.getElementById('reportBody')?.setAttribute('data-step', step.id);
  if (name !== step.id && name !== step.sections[0]) {
    const target = document.getElementById('section-' + name);
    if (target) setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  } else if (changed) {
    const scroller = document.getElementById('reportBody');
    if (scroller) scroller.scrollTop = 0;
  }
  track('screen_viewed', { screen: 'report_' + name });
}

// A tap on a step tab or a Next button. Groups with every question
// answered fold to their one-line summary, so what's left is in view.
function goStep(id) {
  showSection(id);
  foldAnsweredGroups(id);
}

// ── QUESTION GROUPS ──
// Long steps split their questions into groups that fold (details.fgroup).
// The header counts the questions answered; folded, it shows the answers.
const FGROUP_CONCERNS = {
  moistureReadings: [['YES'], 'moisture detected'], waterLeaks: [['YES'], 'a leak'], siteDrainage: [['POOR'], 'poor site drainage'],
  subfloorDrainage: [['POOR'], 'poor subfloor drainage'], subfloorVentilation: [['POOR'], 'poor ventilation'], mouldSeen: [['YES'], 'mould'],
  timberSoil: [['YES'], 'timber touching soil'], slabEdge: [['OBSTRUCTED'], 'slab edge concealed'], weepHoles: [['BRIDGED'], 'weep holes bridged'],
  antCapping: [['GAPS', 'NONE'], 'ant capping'], nonDurableTimber: [['YES'], 'non-durable timber'],
  borerActivity: [['ACTIVE', 'INACTIVE'], v => v === 'ACTIVE' ? 'active borers' : 'old borer holes'], decayFound: [['YES'], 'wood decay'],
  delignification: [['YES'], 'chemical delignification'], previousTreatment: [['YES'], 'signs of a past treatment'],
};

// The questions a group asks right now: hidden follow-ups (a "where" box
// after a no, system checks with no system) don't count.
function fgroupKeys(group) {
  return [...group.querySelectorAll('.field-val[id^="f-"]')].filter(el => {
    for (let n = el.closest('.field') || el; n && n !== group; n = n.parentElement) {
      if (n.hidden || n.style.display === 'none') return false;
    }
    return true;
  }).map(el => el.id.slice(2));
}

// Follow-up questions show and hide from several places, so the counts
// are redrawn whenever anything inside a group shows or hides.
let fgroupObserver = null, fgroupFrame = 0;
function watchFieldGroups() {
  if (fgroupObserver || typeof MutationObserver === 'undefined') return;
  fgroupObserver = new MutationObserver(() => {
    if (fgroupFrame) return;
    fgroupFrame = requestAnimationFrame(() => { fgroupFrame = 0; renderFieldGroups(); });
  });
  document.querySelectorAll('#reportBody details.fgroup').forEach(group =>
    fgroupObserver.observe(group, { subtree: true, attributes: true, attributeFilter: ['style', 'hidden'] }));
}

// Folded, a group reads as a short sentence: the answers in a comma list,
// in sentence case, with a word of context where an answer alone would be
// unclear ("Detached house, single storey, brick veneer walls, front faces
// north"). Brand names and codes such as AS 3660 keep their capitals.
const FGROUP_KEEP_CASE = new Set(['Colorbond', 'Zincalume', 'Hebel', 'Queenslander', 'Termidor', 'Sentricon', 'Exterra', 'Kordon', 'Termimesh', 'Altriset', 'Trelona', 'Biflex', 'Premise', 'Granitgard']);
const FGROUP_LOWER = new Set(['structureType', 'height', 'wallConstruction', 'roofType', 'floorType', 'facadeDirection', 'constructionEra',
  'siteSurroundings', 'siteSlope', 'termiteHistory', 'existingSystem', 'occupancyStatus', 'furnishing', 'peoplePresent',
  'weatherConditions', 'recentWeather', 'toolsUsed', 'treatmentType', 'inspectionFrequency']);
const FGROUP_PHRASES = {
  wallConstruction: v => /wall/i.test(v) ? v : v + ' walls',
  roofType: v => /roof/i.test(v) ? v : v + ' roof',
  facadeDirection: v => 'front faces ' + v,
  constructionEra: v => 'built ' + v.replace(/(\d)-(\d)/g, '$1\u2060–\u2060$2'),
  siteSurroundings: v => v.replace(/^suburban, few trees$/, 'suburban with few trees'),
  siteSlope: v => /^slopes/.test(v) ? 'site ' + v : /site|block|land/.test(v) ? v : v + ' site',
  termiteHistory: v => ({ 'none known': 'no known termite history', unknown: 'termite history unknown', 'treated before': 'treated for termites before' })[v] || v,
  peoplePresent: v => /present/.test(v) ? v : v + ' present',
  humidity: v => /humid/i.test(v) ? v : v + ' humidity',
  rainLast24h: v => /^(none|nil|no rain)$/i.test(v) ? 'no rain in the last 24 hours' : /rain/i.test(v) ? v : v + ' of rain in the last 24 hours',
  recentWeather: v => /^normal/.test(v) ? 'weather ' + v : v,
  riskLevel: v => v.toLowerCase() + ' risk',
  inspectionFrequency: v => /^every/.test(v) ? 're-inspect ' + v : v,
};
function fgroupSentence(keys) {
  const items = [];
  keys.forEach(k => {
    let v = String(reportData[k] ?? '').trim();
    if (k === 'treatmentRecommended') v = { YES: 'treatment required', NO: 'no treatment required' }[v] || '';
    if (k === 'invasiveInspection') v = { YES: 'recommended', NO: 'not recommended' }[v] || '';
    if (!v || /^(YES|NO|N\/A)$/.test(v)) return;
    v = v.replace(/\s+—\s+(.+)$/, ' ($1)');
    if (FGROUP_LOWER.has(k)) v = v.replace(/\b[A-Z][a-z]+\b/g, w => FGROUP_KEEP_CASE.has(w) ? w : w.toLowerCase());
    if (FGROUP_PHRASES[k]) v = FGROUP_PHRASES[k](v);
    const last = items[items.length - 1];
    if (k === 'existingSystemOther' && last && last.key === 'existingSystem') { last.text += ` (${v})`; return; }
    items.push({ key: k, text: v });
  });
  const text = items.map(i => i.text).join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Groups whose answers live in cards rather than single questions. Each
// returns what the header shows; these groups stay open on a step tap.
const FGROUP_CUSTOM = {
  termites: () => {
    const list = Array.isArray(reportData.findings) ? reportData.findings : [];
    const acts = list.map(f => f.termiteActivity).filter(Boolean);
    const live = acts.filter(a => a === 'ACTIVE').length, old = acts.filter(a => a === 'INACTIVE').length;
    const found = [live && `${live} active`, old && `${old} inactive`].filter(Boolean);
    return {
      done: list.length > 0 && acts.length === list.length, started: acts.length > 0,
      count: list.length ? `${list.length} finding${list.length === 1 ? '' : 's'}` : '',
      text: found.length ? 'Found: ' + found.join(', ') : acts.length ? 'No termites found' : '', concern: found.length > 0,
    };
  },
  advice: () => {
    const lines = getRecLines().length, other = !isBlankValue(reportData.otherRecommendations);
    return {
      done: lines > 0 || other, started: false, count: lines ? `${lines} added` : '',
      text: [lines && `${lines} common recommendation${lines === 1 ? '' : 's'}`, other && String(reportData.otherRecommendations).trim()].filter(Boolean).join(', '),
    };
  },
};

function renderFieldGroups() {
  watchFieldGroups();
  document.querySelectorAll('#reportBody details.fgroup').forEach(group => {
    const custom = FGROUP_CUSTOM[group.dataset.summary];
    if (custom) {
      const r = custom();
      group.classList.toggle('fgroup-done', !!r.done);
      group.classList.toggle('fgroup-started', !!r.started && !r.done);
      const count = group.querySelector('.fgroup-count'), sub = group.querySelector('.fgroup-sub');
      if (count) { count.textContent = r.count; count.hidden = !r.count; }
      if (sub) { sub.textContent = r.text || 'Not answered yet'; sub.classList.toggle('concern', !!r.concern); }
      return;
    }
    // A group counts only the questions a finished report needs, so a house
    // that doesn't call for the extras still reaches done. A group of extras
    // only reads Optional until something goes in it.
    const keys = fgroupKeys(group);
    const answered = keys.filter(k => !isBlankValue(reportData[k]));
    const needed = keys.filter(k => REQUIRED_KEYS.has(k));
    const neededDone = needed.filter(k => !isBlankValue(reportData[k])).length;
    const done = needed.length ? neededDone === needed.length : answered.length > 0;
    const optional = !needed.length && !answered.length;
    group.classList.toggle('fgroup-done', done);
    group.classList.toggle('fgroup-started', answered.length > 0 && !done);
    group.classList.toggle('fgroup-optional', optional);
    const count = group.querySelector('.fgroup-count');
    if (count) count.textContent = done ? 'Done' : optional ? 'Optional' : `${neededDone} of ${needed.length}`;
    const sub = group.querySelector('.fgroup-sub');
    if (!sub) return;
    let text, concern = false;
    if (group.dataset.summary === 'concerns') {
      const concerns = keys.filter(k => FGROUP_CONCERNS[k] && FGROUP_CONCERNS[k][0].includes(reportData[k]))
        .map(k => typeof FGROUP_CONCERNS[k][1] === 'function' ? FGROUP_CONCERNS[k][1](reportData[k]) : FGROUP_CONCERNS[k][1]);
      concern = concerns.length > 0;
      text = concern ? 'Found: ' + concerns.join(', ') : (answered.length ? 'Nothing of concern so far' : '');
    } else {
      text = fgroupSentence(answered);
    }
    sub.textContent = text || (optional ? 'Nothing added' : keys.length ? 'Not answered yet' : '');
    sub.classList.toggle('concern', concern);
  });
}

function foldAnsweredGroups(stepId) {
  renderFieldGroups();
  const step = stepOf(stepId);
  step.sections.forEach(s => {
    document.querySelectorAll(`#section-${s} details.fgroup`).forEach(group => {
      if (FGROUP_CUSTOM[group.dataset.summary]) return;
      group.open = !group.classList.contains('fgroup-done');
    });
  });
}

// Opens any folded group around el, so a jump to a question can show it.
function openFieldGroups(el) {
  for (let n = el && el.parentElement; n; n = n.parentElement) {
    if (n.matches && n.matches('details.fgroup') && !n.open) n.open = true;
  }
}

// ── PROGRESS ──────────────────────────────────────────────────────────────
// The where/why/when box only shows once an invasive inspection is
// recommended, or when it already holds something so nothing is hidden.
function syncInvasiveDetails() {
  const wrap = document.getElementById('invasiveDetailsWrap');
  if (wrap) wrap.hidden = reportData.invasiveInspection !== 'YES' && isBlankValue(reportData.invasiveInspectionDetails);
}

function updateProgress() {
  syncInvasiveDetails();
  // FIX: this duplicated calculateCompletion()'s old plain-presence check
  // independently, so the same bug (a routine render lazily creating a
  // placeholder finding via getFindings(), silently marking the Findings
  // tab "Complete" with a green dot and enabling its Next button even with
  // zero real finding data) showed up here too - now sharing one
  // definition (isFieldFilled) so this can't drift out of sync again.
  let filled = 0, total = 0;
  const secState = {};
  Object.entries(SECTIONS).forEach(([sec, cfg]) => {
    const req = REQUIRED_FIELDS[sec] || [];
    const reqFilled = req.filter(k => isFieldFilled(k)).length;
    const any = cfg.fields.some(k => isFieldFilled(k));
    filled += reqFilled; total += req.length;

    const sts = document.getElementById('sts-' + sec);
    const nextBtn = document.getElementById('next-btn-' + sec);
    secState[sec] = !any ? 'empty' : reqFilled < req.length ? 'partial' : 'done';

    if (!any) {
      if (sts) { sts.className = 'sec-badge empty'; sts.textContent = 'Not started'; }
    } else if (reqFilled < req.length) {
      if (sts) { sts.className = 'sec-badge partial'; sts.textContent = 'In progress'; }
    } else {
      if (sts) { sts.className = 'sec-badge done'; sts.textContent = 'Complete'; }
    }
    // Next always shows, so the steps can be walked in order; it stands
    // out once the section is complete.
    if (nextBtn) { nextBtn.classList.add('visible'); nextBtn.classList.toggle('pending', secState[sec] !== 'done'); }
  });
  // A step's dot: done when every section in it is, started when any is.
  REPORT_STEPS.forEach(st => {
    const dot = document.getElementById('dot-' + st.id);
    if (!dot) return;
    const states = st.sections.map(s => secState[s]).filter(Boolean);
    const counted = st.id === 'finish' ? states.slice(1) : states; // other photos are optional
    dot.className = counted.every(v => v === 'done') ? 'tab-dot done' : states.some(v => v !== 'empty') ? 'tab-dot partial' : 'tab-dot';
  });
  renderFieldGroups();

  // A completed (locked) job reads Complete whatever the count says.
  const locked = isReportLocked();
  const pct = locked ? 100 : Math.round((filled / total) * 100);
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('generateBtn').disabled = filled === 0 && !locked;
  document.getElementById('shareBtn').disabled = filled === 0 && !locked;

  const ringFill = document.getElementById('progressRingFill');
  const ringText = document.getElementById('progressRingText');
  if (ringFill && ringText) {
    const circumference = 65.97;
    const offset = circumference - (pct / 100) * circumference;
    ringFill.style.strokeDashoffset = offset;
    ringFill.classList.toggle('complete', pct === 100);
    ringText.textContent = locked ? '✓' : pct + '%';
    const wrap = ringFill.closest('.progress-ring-wrap');
    if (wrap) {
      wrap.classList.toggle('locked', locked);
      wrap.title = locked ? 'Job complete' : `Report ${pct}% complete (required fields)`;
      wrap.setAttribute('aria-label', wrap.title);
    }
    const label = document.getElementById('progressRingLabel');
    if (label) label.style.display = locked ? '' : 'none';
  }
  syncDockReport(pct, locked);
  syncDockJobs();
  renderDocStrips();
  syncNothingFoundButtons();
}

// ── SIGNATURE PADS ──────────────────────────────────────────────────────
// Canvases use a fixed intrinsic bitmap size (640×220) regardless of their
// CSS display size, so drawing works correctly even if the pad was never
// visible at "natural" size — coordinates are scaled to the bitmap on every
// pointer event rather than relying on a resize-on-show step.
// Ink is dark on a white pad: the PNG goes onto white PDF paper as is (the
// old near-white ink was all but invisible there).
const SIGNATURE_INK = '#0c121c';

// Wires up drawing on one canvas. onSigned() runs after each stroke.
function createSignaturePad(canvas, placeholder, onSigned) {
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = SIGNATURE_INK;

  // A pad counts as signed only once a real stroke is drawn, so a stray
  // tap never saves a blank signature.
  const MIN_INK = 24; // canvas px of line across all strokes
  let drawing = false, lastX = 0, lastY = 0, ink = 0, strokeInk = 0;
  const pad = { canvas, ctx, empty: true };

  function posFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const pt = e.touches && e.touches.length ? e.touches[0] : e;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (pt.clientX - rect.left) * scaleX, y: (pt.clientY - rect.top) * scaleY };
  }
  function start(e) {
    e.preventDefault();
    drawing = true; strokeInk = 0;
    const p = posFromEvent(e); lastX = p.x; lastY = p.y;
  }
  function move(e) {
    if (!drawing) return;
    e.preventDefault();
    const p = posFromEvent(e);
    ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(p.x, p.y); ctx.stroke();
    const d = Math.hypot(p.x - lastX, p.y - lastY);
    ink += d; strokeInk += d;
    if (placeholder && d) placeholder.style.display = 'none';
    lastX = p.x; lastY = p.y;
  }
  function end() {
    if (!drawing) return;
    drawing = false;
    if (ink < MIN_INK || !strokeInk) return;
    pad.empty = false;
    if (onSigned) onSigned();
  }
  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  canvas.addEventListener('mouseup', end);
  canvas.addEventListener('mouseleave', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);
  canvas.addEventListener('touchcancel', end);

  pad.clear = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pad.empty = true; ink = 0;
    if (placeholder) placeholder.style.display = 'flex';
  };
  pad.show = (dataUrl) => {
    pad.clear();
    if (!dataUrl) return;
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.src = dataUrl;
    pad.empty = false; ink = MIN_INK;
    if (placeholder) placeholder.style.display = 'none';
  };
  return pad;
}

let inspectorSignaturePad = null;

function initSignaturePads() {
  const canvas = document.getElementById('sigCanvasInspector');
  if (canvas) {
    inspectorSignaturePad = createSignaturePad(canvas, document.getElementById('sigPlaceholderInspector'), () => {
      reportData.inspectorSignature = canvas.toDataURL('image/png');
      setInspectorSignatureStatus(true);
      updateProgress();
      saveDraft();
    });
  }
  const agreementCanvas = document.getElementById('agreementSigCanvas');
  if (agreementCanvas) {
    agreementSignaturePad = createSignaturePad(agreementCanvas, document.getElementById('agreementSigPlaceholder'), updateAgreementSignButton);
  }
}

function clearInspectorSignature() {
  if (inspectorSignaturePad) inspectorSignaturePad.clear();
  delete reportData.inspectorSignature;
  setInspectorSignatureStatus(false);
  updateProgress();
  saveDraft();
}

function setInspectorSignatureStatus(signed) {
  const status = document.getElementById('sigStatusInspector');
  if (status) {
    status.textContent = signed ? 'Signed' : 'Not signed';
    status.classList.toggle('signed', signed);
  }
}

function restoreLicenceField() {
  const el = document.getElementById('inspectorLicence');
  if (el) el.value = reportData.inspectorLicence || '';
}

// Redraws the saved inspector signature after a draft or saved report is
// loaded, and brings the agreement banner up to date.
function restoreSignaturePads() {
  if (inspectorSignaturePad) inspectorSignaturePad.show(reportData.inspectorSignature);
  setInspectorSignatureStatus(!!reportData.inspectorSignature);
  renderAgreementBanner();
}

// ── SAY IT INSTEAD ──────────────────────────────────────────────────────
// The agreement and the treatment record can be spoken as well as typed:
// a "Say it instead" button at the top of each sheet records one note,
// Whisper hears it (or the phone's own speech when Whisper can't be
// reached), and a short AI call fills the sheet's boxes from it. Every box
// stays editable, and a box the note doesn't mention is left as it was.
// SHEET_VOICE[kind] = { box, prompt(), apply(fields) }; the prompts live
// with their sheets (agreement below, treatment in js/treatment.js, bait
// station visits in js/bait.js).
const SHEET_VOICE_MAX_MS = 180000;
let sheetVoice = null;   // { kind, recorder, stream, chunks, recognition, text, timer }

function sheetVoiceKinds() {
  return {
    agreement: { box: 'agreementVoice', prompt: agreementVoicePrompt, apply: applyAgreementVoice },
    treatment: { box: 'trVoice', prompt: typeof treatmentVoicePrompt === 'function' ? treatmentVoicePrompt : null, apply: typeof applyTreatmentVoice === 'function' ? applyTreatmentVoice : null },
    bait: { box: 'bvVoice', prompt: typeof baitVoicePrompt === 'function' ? baitVoicePrompt : null, apply: typeof applyBaitVoice === 'function' ? applyBaitVoice : null },
  };
}

function setSheetVoiceState(kind, state, text) {
  const box = document.getElementById(sheetVoiceKinds()[kind].box);
  if (!box) return;
  box.dataset.state = state;
  const label = box.querySelector('.sheet-voice-label');
  if (label) label.textContent = { idle: 'Say it instead', listening: 'Listening… tap to stop', hearing: 'Hearing it…', filling: 'Filling it in…' }[state] || 'Say it instead';
  const btn = box.querySelector('.sheet-voice-btn');
  if (btn) btn.disabled = state === 'hearing' || state === 'filling';
  const said = box.querySelector('.sheet-voice-text');
  if (said && text !== undefined) { said.textContent = text; said.hidden = !text; }
}

function toggleSheetVoice(kind) {
  if (sheetVoice) { if (sheetVoice.kind === kind) stopSheetVoice(); return; }
  if (isRecording) { showToast('Stop the report recording first', 'error'); return; }
  if (!navigator.onLine) { showToast('Needs a signal to fill it in. Type it for now', 'error'); return; }
  if (!authSession?.access_token) { showToast('Sign in first', 'error'); return; }
  const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
  if (!isNative && !whisperOff && isAudioCaptureSupported()) startSheetRecorder(kind);
  else startSheetRecognition(kind);
}

async function startSheetRecorder(kind) {
  sheetVoice = { kind, chunks: [] };
  setSheetVoiceState(kind, 'listening', '');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (!sheetVoice || sheetVoice.kind !== kind) { stream.getTracks().forEach(t => t.stop()); return; }
    const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    recorder.ondataavailable = e => { if (e.data && e.data.size) sheetVoice && sheetVoice.chunks.push(e.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const v = sheetVoice;
      if (!v) return;
      const blob = new Blob(v.chunks, { type: recorder.mimeType || 'audio/webm' });
      sheetVoiceHear(kind, blob);
    };
    Object.assign(sheetVoice, { stream, recorder, timer: setTimeout(stopSheetVoice, SHEET_VOICE_MAX_MS) });
    recorder.start(1000);
  } catch (e) {
    sheetVoice = null;
    setSheetVoiceState(kind, 'idle');
    showToast('Microphone not allowed. Check the microphone permission', 'error');
  }
}

function startSheetRecognition(kind) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition || (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() ? NativeSpeechRecognition : null);
  if (!SR) { showToast('Voice isn\'t available on this phone. Type it instead', 'error'); return; }
  const recognition = new SR();
  recognition.continuous = true; recognition.interimResults = true; recognition.lang = 'en-AU';
  sheetVoice = { kind, recognition, text: '', finals: '' };
  recognition.onresult = e => {
    if (!sheetVoice) return;
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) sheetVoice.finals += e.results[i][0].transcript + ' ';
      else interim += e.results[i][0].transcript;
    }
    sheetVoice.text = (sheetVoice.finals + interim).trim();
    setSheetVoiceState(kind, 'listening', sheetVoice.text);
  };
  recognition.onerror = () => {};
  recognition.onend = () => {
    // Safari ends a long listen on its own; carry on until Stop is tapped.
    if (sheetVoice && sheetVoice.recognition === recognition && !sheetVoice.stopping) { try { recognition.start(); } catch (e) { stopSheetVoice(); } return; }
    if (sheetVoice && sheetVoice.recognition === recognition) { const text = sheetVoice.text; sheetVoice = null; sheetVoiceFill(kind, text); }
  };
  sheetVoice.timer = setTimeout(stopSheetVoice, SHEET_VOICE_MAX_MS);
  setSheetVoiceState(kind, 'listening', '');
  try { recognition.start(); } catch (e) { sheetVoice = null; setSheetVoiceState(kind, 'idle'); showToast('Couldn\'t start listening', 'error'); }
}

function stopSheetVoice() {
  const v = sheetVoice;
  if (!v) return;
  clearTimeout(v.timer);
  if (v.recorder) { if (v.recorder.state !== 'inactive') v.recorder.stop(); return; }
  if (v.recognition) { v.stopping = true; try { v.recognition.stop(); } catch (e) { sheetVoice = null; sheetVoiceFill(v.kind, v.text); } }
}

// Closing a sheet stops its listening and throws the words away.
function cancelSheetVoice(kind) {
  const v = sheetVoice;
  if (!v || v.kind !== kind) { setSheetVoiceState(kind, 'idle', ''); return; }
  sheetVoice = null;
  clearTimeout(v.timer);
  try { if (v.recorder && v.recorder.state !== 'inactive') { v.recorder.onstop = null; v.recorder.stop(); } } catch (e) {}
  if (v.stream) v.stream.getTracks().forEach(t => t.stop());
  try { if (v.recognition) { v.recognition.onend = null; v.recognition.abort(); } } catch (e) {}
  setSheetVoiceState(kind, 'idle', '');
}

async function sheetVoiceHear(kind, blob) {
  sheetVoice = null;
  setSheetVoiceState(kind, 'hearing');
  try {
    const form = new FormData();
    const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    form.append('audio', blob, `note.${ext}`);
    form.append('initial_prompt', buildTranscriptionVocabHint().slice(-1000));
    const res = await workerFetch('/transcribe', { method: 'POST', body: form });
    if (res.status === 502 && /no text/i.test(await res.clone().text().catch(() => ''))) { setSheetVoiceState(kind, 'idle', ''); showToast('Didn\'t catch anything. Try again closer to the phone', 'info'); return; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const text = correctKnownMishearings(typeof data?.transcript === 'string' ? data.transcript.trim() : '');
    sheetVoiceFill(kind, text);
  } catch (e) {
    setSheetVoiceState(kind, 'idle', '');
    showToast('Couldn\'t hear that one. Try again, or type it', 'error');
  }
}

async function sheetVoiceFill(kind, text) {
  const k = sheetVoiceKinds()[kind];
  text = (text || '').trim();
  if (!text) { setSheetVoiceState(kind, 'idle', ''); showToast('Didn\'t catch anything. Try again', 'info'); return; }
  setSheetVoiceState(kind, 'filling', text);
  try {
    const res = await workerFetch('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 4000,
        output_config: { effort: 'low' },
        system: k.prompt(),
        messages: [{ role: 'user', content: `Today is ${todayIsoDate()}.\n\n${text}` }],
      }),
    });
    const raw = await res.text();
    if (!res.ok) { const err = new Error('HTTP ' + res.status); err.status = res.status; throw err; }
    const data = JSON.parse(raw);
    const answer = (data.content || []).map(c => c.text || '').join('');
    const fields = JSON.parse(answer.replace(/```json|```/g, '').trim());
    const n = k.apply(fields || {});
    setSheetVoiceState(kind, 'idle', text);
    showToast(n ? `Filled in ${n} box${n === 1 ? '' : 'es'}. Check them before you save` : 'Nothing in that note fits these boxes', n ? 'success' : 'info');
    track('sheet_voice_filled', { kind, boxes: n });
  } catch (e) {
    setSheetVoiceState(kind, 'idle', text);
    showToast(e && e.status ? extractionProblem(e) : 'Couldn\'t fill it in. Check the signal and try again, or type it', 'error');
  }
}

// Sets a box from a spoken value, only when there is one. Returns 1 when it
// changed, so the caller can count what was filled.
function setSpokenBox(id, value) {
  const el = document.getElementById(id);
  const v = value == null ? '' : String(value).trim();
  if (!el || !v || el.value === v) return 0;
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return 1;
}

function agreementVoicePrompt() {
  const types = [...document.getElementById('agreementInspectionType').options].map(o => o.value).filter(Boolean);
  return `You fill in a pre-inspection agreement for SAYON, an app for Australian timber pest inspectors. The user message is what the inspector said about the job, and the date today. Return ONLY a JSON object, no markdown, with these keys, each null unless the inspector said it:
{"inspectionType":${types.map(t => JSON.stringify(t)).join('|')},"date":"YYYY-MM-DD","fee":string,"specialRequests":string,"signerName":string,"clientName":string,"clientPhone":string,"clientEmail":string,"streetAddress":string,"suburb":string,"state":"NSW"|"VIC"|"QLD"|"WA"|"SA"|"TAS"|"ACT"|"NT","postcode":string}
- inspectionType: the closest of the listed types to what they said ("pre-purchase pest" is "Pre-Purchase — Timber Pest"; "annual" is "Annual — Existing Building"). Null when not said.
- date: the inspection date. "Today" and "tomorrow" count from today's date; a weekday means the next one.
- fee: the inspection fee in dollars as digits with a $ ("$350"). Never invent one.
- specialRequests: anything the client asked to be looked at or done, in brief ("Check the back deck closely").
- signerName: who will sign, when they say it's someone other than the client. clientName: the client. Phone and email as said; spoken email words become symbols ("jo at example dot com" is jo@example.com).
- Only words actually said. Never guess.`;
}

function applyAgreementVoice(f) {
  let n = 0;
  if (f.inspectionType && [...document.getElementById('agreementInspectionType').options].some(o => o.value === f.inspectionType)) {
    n += setSpokenBox('agreementInspectionType', f.inspectionType);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.date || '')) n += setSpokenBox('agreementDate', f.date);
  if (f.fee) {
    const fee = String(f.fee).replace(/[^\d.]/g, '');
    if (fee) n += setSpokenBox('agreementFee', '$' + fee);
  }
  n += setSpokenBox('agreementNotes', f.specialRequests);
  // The client and the address are the job's own details, so they fill the
  // job too, but never over something already typed there.
  const job = { jobClient: f.clientName, jobClientPhone: f.clientPhone, jobClientEmail: f.clientEmail, jobAddress: f.streetAddress, jobSuburb: f.suburb, jobState: f.state, jobPostcode: f.postcode };
  let jobChanged = false;
  Object.entries(job).forEach(([id, v]) => {
    const el = document.getElementById(id);
    if (el && v && !el.value.trim()) { el.value = String(v).trim(); jobChanged = true; n++; }
  });
  if (jobChanged) { saveJobInfo(); updateJob(); document.getElementById('agreementAddr').textContent = getFullAddress() || 'No address yet'; document.getElementById('agreementAddr').classList.toggle('empty', !getFullAddress()); }
  const signer = (f.signerName || f.clientName || '').trim();
  if (signer && !document.getElementById('agreementSignerName').value.trim()) n += setSpokenBox('agreementSignerName', signer);
  refreshAgreementPreview();
  return n;
}

// ── PRE-INSPECTION AGREEMENT ────────────────────────────────────────────
// AS 4349.3 expects a written agreement before a timber pest inspection
// starts, so the client signs (or the inspector records a paper / emailed
// agreement) before the job, not at the end. A signed agreement is kept on
// the report as reportData.agreement:
//   { method: 'onsite' | 'other', signerName, signature?, otherNote?,
//     signedAt, inspectionDate, fee, notes, standard, text }
// text is the exact wording agreed to, so editing the business's template
// later never changes what an earlier client signed.
let agreementSignaturePad = null;

const AGREEMENT_PLACEHOLDERS = ['company', 'client', 'address', 'date', 'standard', 'inspectionType', 'fee', 'notes'];

const DEFAULT_AGREEMENT_TEXT = `1. The inspection
{company} will carry out a {inspectionType} inspection of {address} for {client} on {date}, in line with {standard}.

2. What is inspected
A visual inspection of the readily accessible areas of the building and site for termites, borers of seasoned timber and wood decay fungi, and for conditions that make timber pest attack more likely. This normally covers the interior, roof space, subfloor, exterior, outbuildings, and the site within 50 m of the building and inside the property boundary, where they can be safely reached.

3. How we inspect, and the limits
The inspection is visual and non-invasive. We may tap timbers and use a moisture meter or other tools that do not damage the building. We do not move furniture, stored goods, floor coverings, insulation or vegetation, and we do not cut, drill or remove any part of the building. Areas we cannot reach or see will be recorded in the report, and timber pests or damage may be hidden in them. The inspection cannot guarantee that the property is, or will stay, free of timber pests. It is not a building, structural, asbestos, mould or electrical inspection. If we find timber damage, we may recommend that a builder or engineer assesses it.

4. Invasive inspection
An invasive inspection is not included. If one is recommended, it needs a separate written agreement and fee.

5. Access
Please arrange safe access to all areas on the day, including the roof space, the subfloor and any locked areas. Any area we can't get into will be noted in the report. If you would like us to come back to inspect it, we will tell you the cost before we do.

6. The report
You will receive a written report by email after the inspection. It is for your use only and must not be relied on by anyone else without our written consent.

7. Voice notes and your details
The inspector may speak notes into a phone app during the inspection, and the phone may pick up conversation nearby. A speech-to-text service turns what it hears into written notes, and an AI service drafts the report from those notes and from photos; the inspector checks everything before it is issued. These services include providers outside Australia, mainly in the United States. The recording is not kept. If you would rather not be recorded, tell the inspector and they will type their notes instead. Your details and the report are only used and shared as needed to provide this service, as set out in SAYON's privacy policy at sayon-app.github.io/privacy.html.

8. Fee
{fee}

9. Special requests
{notes}

10. Your rights
Nothing in this agreement limits your rights under the Australian Consumer Law.

By signing, you confirm you have read and agree to this agreement before the inspection starts. You also agree to sign it electronically and to receive the report by email.`;

function getAgreementTemplate() {
  const custom = getCompanyDetails().agreementText;
  return (custom && custom.trim()) ? custom : DEFAULT_AGREEMENT_TEXT;
}

function agreementInspectionType() {
  return isPrePurchaseJob() ? 'pre-purchase timber pest' : 'timber pest';
}

// Fills the template's {placeholders} for this job. Anything still
// unknown prints as a blank line to write on rather than an empty gap.
function fillAgreementText(template, values) {
  return template.replace(/\{(\w+)\}/g, (m, key) => {
    if (!AGREEMENT_PLACEHOLDERS.includes(key)) return m;
    const v = values[key];
    return (v && String(v).trim()) ? String(v).trim() : '____________';
  });
}

function formatAgreementDate(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T00:00:00');
  return isNaN(d) ? isoDate : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatAgreementSignedAt(ms) {
  return new Date(ms).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// A date as YYYY-MM-DD on the phone's own calendar. toISOString() gives the
// UTC date, which in Australia is the day before until 10 or 11 in the morning.
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function todayIsoDate() { return isoDate(new Date()); }

// The job details the agreement is filled from, read from the open sheet.
function agreementFormValues() {
  const standard = reportData.standard || 'AS 3660.2-2017';
  const inspectionDate = document.getElementById('agreementDate').value || todayIsoDate();
  const fee = agreementFeeText(document.getElementById('agreementFee').value);
  const notes = document.getElementById('agreementNotes').value.trim();
  return {
    standard, inspectionDate, fee, notes,
    text: fillAgreementText(getAgreementTemplate(), {
      company: getCompanyDetails().name || 'The inspecting company',
      client: document.getElementById('agreementSignerName').value.trim() || document.getElementById('jobClient').value.trim(),
      address: getFullAddress(),
      date: formatAgreementDate(inspectionDate),
      standard,
      inspectionType: agreementInspectionType(),
      fee: fee || 'As quoted.',
      notes: notes || 'None.',
    }),
  };
}

function renderAgreementBanner() {
  const banner = document.getElementById('agreementBanner');
  if (!banner) return;
  const a = reportData.agreement;
  banner.classList.toggle('signed', !!a);
  const sent = !a && reportData.agreementRequest;
  document.getElementById('agreementBannerText').textContent = a
    ? `Agreement signed by ${a.signerName} · ${formatAgreementSignedAt(a.signedAt)}`
    : sent ? `Link sent to ${sent.signerName}, waiting for them to sign` : 'Pre-inspection agreement not signed yet';
  if (sent) checkAgreementLink(false);
  document.getElementById('agreementBannerBtn').textContent = a ? 'View' : 'Get it signed';
  const so = document.getElementById('signoffAgreementStatus');
  if (so) {
    so.textContent = a
      ? `Signed by ${a.signerName} on ${formatAgreementSignedAt(a.signedAt)}${a.method === 'other' ? ` (${a.otherNote})` : ''}`
      : 'Not signed yet. The client signs the agreement before the inspection starts.';
    so.classList.toggle('signed', !!a);
  }
}

function openAgreementSheet() {
  const a = reportData.agreement;
  track('screen_viewed', { screen: 'agreement' });
  document.getElementById('agreementEdit').style.display = a ? 'none' : '';
  document.getElementById('agreementView').style.display = a ? '' : 'none';
  if (a) {
    document.getElementById('agreementViewName').textContent = a.signerName;
    document.getElementById('agreementViewSummary').textContent =
      formatAgreementSignedAt(a.signedAt) + (a.method === 'other' ? ` · ${a.otherNote}` : a.method === 'remote' ? ' · signed on their phone from a link' : ' · signed on this device');
    renderAgreementDoc(document.getElementById('agreementViewText'), a.text);
    const img = document.getElementById('agreementViewSignature');
    img.style.display = a.signature ? '' : 'none';
    if (a.signature) img.src = a.signature;
  } else {
    document.getElementById('agreementAddr').textContent = getFullAddress() || 'No address yet';
    document.getElementById('agreementAddr').classList.toggle('empty', !getFullAddress());
    document.getElementById('agreementSignerName').value = document.getElementById('jobClient').value.trim();
    document.getElementById('agreementInspectionType').value = reportData.jobInspectionType || '';
    // Job Details may already have the inspection date and fee.
    document.getElementById('agreementDate').value = reportData.jobInspectionDate || todayIsoDate();
    document.getElementById('agreementFee').value = jobFeeOf(reportData);
    document.getElementById('agreementNotes').value = '';
    document.getElementById('agreementAgree').checked = false;
    document.getElementById('agreementOtherNote').value = '';
    document.getElementById('agreementOtherWrap').style.display = 'none';
    if (agreementSignaturePad) agreementSignaturePad.clear();
    refreshAgreementPreview();
  }
  renderAgreementRemote();
  checkAgreementLink(false);
  cancelSheetVoice('agreement');
  document.getElementById('agreementOverlay').classList.add('open');
  document.querySelectorAll('#agreementOverlay .page-sheet-body').forEach(b => { b.scrollTop = 0; });
}

// The agreement as a document: each "N. Heading" block becomes a numbered
// clause, any other paragraph plain text, and a blank still to fill in is
// marked. Works on a business's own wording as well as the default.
function renderAgreementDoc(el, text) {
  el.textContent = '';
  const withBlanks = (node, str) => {
    str.split(/(_{4,})/).forEach(part => {
      if (!part) return;
      if (/^_{4,}$/.test(part)) {
        const b = document.createElement('span');
        b.className = 'agr-blank'; b.textContent = 'not filled in';
        node.appendChild(b);
      } else node.appendChild(document.createTextNode(part));
    });
  };
  const para = (parent, str, cls) => {
    const p = document.createElement('p');
    if (cls) p.className = cls;
    withBlanks(p, str);
    parent.appendChild(p);
  };
  let sawClause = false;
  String(text || '').split(/\n\s*\n/).forEach(block => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return;
    const m = lines[0].match(/^(\d+)\.\s+(.+)$/);
    if (m) {
      sawClause = true;
      const sec = document.createElement('section');
      sec.className = 'agr-clause';
      const num = document.createElement('span');
      num.className = 'agr-clause-num'; num.textContent = m[1];
      const h = document.createElement('h4');
      h.className = 'agr-clause-title'; h.textContent = m[2];
      sec.append(num, h);
      lines.slice(1).forEach(l => para(sec, l));
      el.appendChild(sec);
    } else {
      lines.forEach(l => para(el, l, sawClause ? 'agr-doc-close' : 'agr-doc-intro'));
    }
  });
}

// The fee as the agreement prints it: "$440 inc GST" from "440".
function agreementFeeText(raw) {
  const fee = String(raw || '').trim();
  if (!fee) return '';
  return `${/^\$|^[^0-9]/.test(fee) ? '' : '$'}${fee}${/gst/i.test(fee) ? '' : ' inc GST'}`;
}

// Fee boxes put the $ in front as soon as a figure is typed, keeping the
// cursor where it was.
function addDollarSign(el) {
  const v = el.value;
  if (v.trim() === '$') { el.value = ''; return; }
  if (!/\d/.test(v) || /^\s*\$/.test(v)) return;
  const pos = el.selectionStart;
  el.value = '$' + v.replace(/^\s+/, '');
  if (pos != null) { const p = pos + el.value.length - v.length; el.setSelectionRange(p, p); }
}

// The agreement's fee box is the Job details fee: typing in either updates
// the one stored value.
function onAgreementFeeInput() {
  const v = document.getElementById('agreementFee').value;
  reportData.jobFee = v;
  const jobEl = document.getElementById('jobFee');
  if (jobEl) jobEl.value = v;
  saveDraft();
  refreshAgreementPreview();
}

function closeAgreementSheet() {
  cancelSheetVoice('agreement');
  document.getElementById('agreementOverlay').classList.remove('open');
}

function refreshAgreementPreview() {
  if (!reportData.agreement) renderAgreementDoc(document.getElementById('agreementText'), agreementFormValues().text);
  const hint = document.getElementById('agreementFeeHint');
  if (hint) hint.hidden = !!document.getElementById('agreementFee').value.trim();
  updateAgreementSignButton();
}

// The agreement sheet's inspection type is the job's inspection type: it is
// the same field, shown here because the client signs before anything else
// is known, and clause 1 names the type and the standard it sets.
function onAgreementTypeChange() {
  const type = document.getElementById('agreementInspectionType').value;
  const jobSel = document.getElementById('jobInspectionType');
  if (jobSel && jobSel.value !== type) { jobSel.value = type; onInspectionTypeChange(); }
  refreshAgreementPreview();
}

function agreementTypeChosen() {
  return !!document.getElementById('agreementInspectionType').value;
}

function updateAgreementSignButton() {
  const btn = document.getElementById('agreementSignBtn');
  if (!btn) return;
  const typed = agreementTypeChosen();
  const named = !!document.getElementById('agreementSignerName').value.trim();
  const agreed = document.getElementById('agreementAgree').checked;
  const drawn = !!(agreementSignaturePad && !agreementSignaturePad.empty);
  btn.disabled = !(typed && named && agreed && drawn);
  // The side line: each step ticks off once it's done.
  const steps = [['agreementStepJob', typed], ['agreementStepRead', agreed], ['agreementStepSign', named && drawn]];
  let nowSet = false;
  steps.forEach(([id, done]) => {
    const li = document.getElementById(id);
    if (!li) return;
    li.classList.toggle('done', done);
    li.classList.toggle('now', !done && !nowSet);
    if (!done) nowSet = true;
  });
  // The bar under the header: one segment per step, filled once it's done.
  const bar = document.getElementById('agreementProgress');
  if (bar) [...bar.children].forEach((seg, i) => seg.classList.toggle('done', steps[i][1]));
  const by = document.getElementById('agreementSigBy');
  if (by) by.textContent = named ? document.getElementById('agreementSignerName').value.trim() : 'Client';
  const need = [!typed && 'choose the inspection type', !agreed && 'tick that the client has read it',
    !named && "enter the client's name", !drawn && 'get their signature'].filter(Boolean);
  const needEl = document.getElementById('agreementSignNeed');
  if (needEl) {
    needEl.hidden = !need.length;
    needEl.textContent = need.length ? `To sign: ${need.join(', ')}.` : '';
  }
}

function toggleAgreementOther() {
  const wrap = document.getElementById('agreementOtherWrap');
  wrap.style.display = wrap.style.display === 'none' ? '' : 'none';
}

// method 'onsite': the client signed on this device. 'other': the inspector
// records an agreement signed on paper or by email, with a short note.
function signAgreement(method) {
  const signerName = document.getElementById('agreementSignerName').value.trim();
  if (!agreementTypeChosen()) { showToast('Choose the inspection type first: it sets the standard the agreement names', 'error'); return; }
  if (!signerName) { showToast('Enter the name of the person signing', 'error'); return; }
  const values = agreementFormValues();
  const agreement = { method, signerName, signedAt: Date.now(),
    inspectionDate: values.inspectionDate, fee: values.fee, notes: values.notes,
    standard: values.standard, text: values.text };
  if (method === 'onsite') {
    if (!document.getElementById('agreementAgree').checked || !agreementSignaturePad || agreementSignaturePad.empty) return;
    agreement.signature = agreementSignaturePad.canvas.toDataURL('image/png');
  } else {
    agreement.otherNote = document.getElementById('agreementOtherNote').value.trim();
    if (!agreement.otherNote) { showToast('Say how it was signed, e.g. "Signed on paper"', 'error'); return; }
  }
  reportData.agreement = agreement;
  if (reportData.agreementRequest) {
    const id = reportData.agreementRequest.id;
    if (authSession) fetch(`${SUPABASE_URL}/rest/v1/sign_requests?id=eq.${encodeURIComponent(id)}&status=eq.pending`, {
      method: 'PATCH', headers: getAuthHeaders(), body: JSON.stringify({ status: 'cancelled' }),
    }).catch(() => {});
    delete reportData.agreementRequest;
  }
  if (!document.getElementById('jobClient').value.trim()) {
    document.getElementById('jobClient').value = signerName;
    updateJob();
  }
  saveDraft();
  updateProgress();
  renderAgreementBanner();
  closeAgreementSheet();
  showToast('Agreement signed', 'success');
  track('agreement_signed', { method });
}

// ── REMOTE SIGNING ───────────────────────────────────────────────────────
// When the client isn't on site, the inspector sends a link instead. The
// exact wording goes to Supabase sign_requests (supabase/remote-signing.sql)
// and the client signs it on sign.html with no account. The report keeps
//   reportData.agreementRequest = { id, signerName, sentAt, values }
// until the signed row is read back, which then becomes reportData.agreement
// with method 'remote', just as if they had signed on this phone.
const AGREEMENT_LINK_CHECK_MS = 60000;
let agreementLinkCheckedAt = 0;

function agreementLinkUrl(id) {
  return new URL(`sign.html?id=${encodeURIComponent(id)}`, location.href).href;
}

async function sendAgreementLink() {
  if (isReportLocked()) { showToast('This job is complete and locked. Tap Amend to change it', 'info'); return; }
  const signerName = document.getElementById('agreementSignerName').value.trim();
  if (!agreementTypeChosen()) { showToast('Choose the inspection type first: it sets the standard the agreement names', 'error'); return; }
  if (!signerName) { showToast('Enter the name of the person signing', 'error'); return; }
  if (!authSession) { showToast('Sign in to send a link', 'error'); return; }
  if (!navigator.onLine) { showToast('Sending a link needs signal. Try again when you have it', 'error'); return; }
  const values = agreementFormValues();
  const company = getCompanyDetails();
  const doc = { company: company.name || '', phone: company.phone || '', email: company.email || '',
    inspector: (document.getElementById('jobInspector') || {}).value?.trim() || '', client: signerName, address: getFullAddress(),
    inspectionDate: values.inspectionDate, standard: values.standard, text: values.text };
  const btn = document.getElementById('agreementLinkBtn');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/sign_requests?select=id`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify({ user_id: authUser.id, report_id: currentReportId || 'draft', doc }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const [row] = await res.json();
    reportData.agreementRequest = { id: row.id, signerName, sentAt: Date.now(), values };
    if (!document.getElementById('jobClient').value.trim()) {
      document.getElementById('jobClient').value = signerName;
      updateJob();
    }
    saveDraft();
    renderAgreementBanner();
    renderAgreementRemote();
    track('agreement_link_sent');
    sendAgreementLinkOn();
  } catch (e) {
    reportError(e, 'agreement_link');
    showToast('Could not make the link. Check your signal and try again', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Emailed from SAYON to the client's email in Job Details, with the
// agreement attached, when email is set up. Otherwise the share sheet.
async function sendAgreementLinkOn() {
  const r = reportData.agreementRequest;
  if (!r) return;
  const to = (document.getElementById('jobClientEmail') || {}).value?.trim() || '';
  if (directEmail && to) {
    try {
      await ensureJsPDFLoaded();
      const file = buildAgreementPdf({ ...r.values, signerName: r.signerName, unsigned: true });
      const company = getCompanyDetails().name || 'your inspector';
      const sent = await sendPdfsDirect({ files: [file], to,
        subject: `Please sign: pre-inspection agreement for ${getFullAddress() || 'your inspection'}`,
        body: `${agreementLinkMessage(r)}\n\n${agreementLinkUrl(r.id)}\n\nA copy of the agreement is attached.\n\nKind regards,\n${[(document.getElementById('jobInspector') || {}).value?.trim(), company].filter(Boolean).join('\n')}` });
      if (sent) {
        r.emailedTo = to; r.emailedAt = Date.now();
        saveDraft(); renderAgreementRemote();
        return;
      }
    } catch (e) {
      reportError(e, 'agreement_link_email');
    }
  }
  shareAgreementLink();
}

function agreementLinkMessage(r) {
  const company = getCompanyDetails().name || 'your inspector';
  return `Hi ${r.signerName.split(' ')[0]}, here is the pre-inspection agreement from ${company} for ${getFullAddress() || 'your inspection'}. Please read it and sign on your phone before the inspection:`;
}

// The share sheet (text, email, WhatsApp), or the clipboard where there's none.
async function shareAgreementLink() {
  const r = reportData.agreementRequest;
  if (!r) return;
  const url = agreementLinkUrl(r.id);
  const text = agreementLinkMessage(r);
  if (navigator.share) {
    try { await navigator.share({ title: 'Pre-inspection agreement', text, url }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    showToast('Link copied. Paste it into a text or email to the client', 'success');
  } catch (e) {
    prompt('Copy this link and send it to the client:', url);
  }
}

async function checkAgreementLink(byTap) {
  const r = reportData.agreementRequest;
  if (!r || reportData.agreement || !authSession) return;
  if (!byTap && Date.now() - agreementLinkCheckedAt < AGREEMENT_LINK_CHECK_MS) return;
  agreementLinkCheckedAt = Date.now();
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/sign_requests?id=eq.${encodeURIComponent(r.id)}&select=status,signer_name,signature,signed_at`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const [row] = await res.json();
    // The report may have moved on while the request was out.
    if (reportData.agreementRequest !== r) return;
    if (row && row.status === 'signed') {
      const v = r.values;
      reportData.agreement = { method: 'remote', signerName: row.signer_name, signature: row.signature,
        signedAt: new Date(row.signed_at).getTime(), inspectionDate: v.inspectionDate, fee: v.fee,
        notes: v.notes, standard: v.standard, text: v.text };
      delete reportData.agreementRequest;
      saveDraft();
      updateProgress();
      renderAgreementBanner();
      if (document.getElementById('agreementOverlay').classList.contains('open')) openAgreementSheet();
      showToast(`${row.signer_name} signed the agreement`, 'success');
      track('agreement_signed', { method: 'remote' });
    } else if (byTap) {
      showToast(row && row.status === 'cancelled' ? 'That link was cancelled' : 'Not signed yet', 'info');
    }
  } catch (e) {
    if (byTap) showToast('Could not check. Try again when you have signal', 'error');
  }
}

async function cancelAgreementLink() {
  const r = reportData.agreementRequest;
  if (!r || !confirm('Cancel this link? The client won\'t be able to sign with it.')) return;
  if (authSession) {
    fetch(`${SUPABASE_URL}/rest/v1/sign_requests?id=eq.${encodeURIComponent(r.id)}&status=eq.pending`, {
      method: 'PATCH', headers: getAuthHeaders(), body: JSON.stringify({ status: 'cancelled' }),
    }).catch(() => {});
  }
  delete reportData.agreementRequest;
  saveDraft();
  renderAgreementBanner();
  renderAgreementRemote();
}

function renderAgreementRemote() {
  const box = document.getElementById('agreementRemote');
  if (!box) return;
  const r = !reportData.agreement && reportData.agreementRequest;
  box.hidden = !r;
  if (r) {
    document.getElementById('agreementRemoteText').textContent =
      `Link ${r.emailedTo ? `emailed to ${r.emailedTo}` : `sent to ${r.signerName}`} on ${formatAgreementSignedAt(r.emailedAt || r.sentAt)}. It shows as signed here once they sign. You can still have them sign on this phone instead.`;
  }
}

function removeAgreement() {
  if (isReportLocked()) { showToast('This job is complete and locked. Tap Amend to change it', 'info'); return; }
  if (!confirm('Remove the signed agreement from this report? The client will need to sign again.')) return;
  delete reportData.agreement;
  saveDraft();
  updateProgress();
  renderAgreementBanner();
  closeAgreementSheet();
}

// A PDF of the signed agreement for the client to keep.
function shareAgreementPdf() {
  const a = reportData.agreement;
  if (!a || !window.jspdf) { showToast('PDF tools are still loading — try again in a moment', 'error'); return; }
  const { blob, fname } = buildAgreementPdf(a);
  deliverPdfBlob(blob, fname, {
    title: 'Pre-Inspection Agreement',
    text: `Pre-inspection agreement — ${getFullAddress() || 'Property'}`,
    readyToast: 'Agreement ready — choose where to save or send it',
  });
}

// The agreement as a PDF. a.unsigned: the copy that goes with a link to sign.
function buildAgreementPdf(a) {
  const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
  const M = 15, CW = 180;
  const company = getCompanyDetails();
  const header = () => drawPdfRunningHeader(doc, company, 'Pre-Inspection Agreement', getFullAddress(), '');
  let y = drawPdfDocCover(doc, company, { compact: true, kicker: 'Timber pest inspection', title: 'Pre-Inspection Agreement',
    date: formatAgreementDate(todayIsoDate()), left: [
      ['CLIENT', a.signerName],
      ['PROPERTY ADDRESS', getFullAddress() || 'Not specified'],
    ], right: [
      ['INSPECTION DATE', a.inspectionDate ? formatAgreementDate(a.inspectionDate) : ''],
      ['INSPECTION FEE', agreementFeeText(a.fee)],
      ['AGREED', a.unsigned ? 'Not signed yet' : formatAgreementSignedAt(a.signedAt)],
      ['STANDARD', a.standard],
    ] });
  y += 2;
  y = drawAgreementBody(doc, a, y, { M, CW, onNewPage: header });
  drawPdfDocFooters(doc, `Pre-inspection agreement${company.name ? `  ·  ${company.name}` : ''}`);
  const fname = `Agreement_${fileNamePart(getFullAddress()) || 'Property'}.pdf`;
  return { blob: doc.output('blob'), fname };
}

// Prints the agreed wording and who signed it, from y down. Used for the
// client's copy and the last page of the report. Returns the new y.
function drawAgreementBody(doc, a, y, { M, CW, onNewPage }) {
  const C = PDF_COLORS;
  const bottom = 281;
  const room = (h) => { if (y + h > bottom) { doc.addPage(); y = onNewPage(); return true; } return false; };
  const GUT = 9, LH = 4;
  // Same blocks as the sheet: "N. Heading" clauses with a numbered gutter
  // and a hairline between, other paragraphs plain, the closing shaded.
  const blocks = String(a.text || '').split(/\n\s*\n/).map(b => b.split('\n').map(l => l.trim()).filter(Boolean)).filter(b => b.length);
  let sawClause = false, first = true;
  blocks.forEach((lines, bi) => {
    const m = lines[0].match(/^(\d+)\.\s+(.+)$/);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    if (m) {
      sawClause = true;
      const body = lines.slice(1).map(l => doc.splitTextToSize(l, CW - GUT - 3));
      let firstH = 5 + (body[0] ? Math.min(body[0].length, 2) * LH : 0);
      // The last clause goes over with the closing words and the signatures,
      // so they never sit on a page of their own.
      const next = blocks[bi + 1];
      if (next && bi + 1 === blocks.length - 1 && !/^\d+\.\s/.test(next[0]) && !a.unsigned) {
        const closingH = next.flatMap(l => doc.splitTextToSize(l, CW - 13)).length * LH + 9;
        firstH = 7.4 + body.reduce((h, w, i) => h + w.length * LH + (i ? 1.5 : 0), 0) + 2.6 + closingH + 34;
      }
      if (!room(firstH + 4) && !first) {
        doc.setDrawColor(...C.ruleLight); doc.setLineWidth(0.2); doc.line(M + GUT, y - 1.6, M + CW, y - 1.6);
      }
      y += 2.2;
      doc.setFillColor(...C.accentLight); doc.roundedRect(M, y - 3.4, 5.6, 4.6, 1, 1, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...C.accentDark);
      doc.text(m[1], M + 2.8, y, { align: 'center' });
      doc.setFontSize(9.5); doc.setTextColor(...C.ink);
      doc.text(doc.splitTextToSize(m[2], CW - GUT - 3)[0], M + GUT, y);
      y += 4.8;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...C.inkLight);
      body.forEach((wrapped, i) => {
        if (i) y += 1.5;
        wrapped.forEach(w => { room(LH); doc.text(w, M + GUT, y); y += LH; });
      });
      y += 2.6;
    } else if (sawClause) {
      const wrapped = lines.flatMap(l => doc.splitTextToSize(l, CW - 13));
      const h = wrapped.length * LH + 6;
      // The last paragraph keeps the signatures company on its page.
      room(h + 2 + (bi === blocks.length - 1 ? 34 : 0));
      y += 1;
      doc.setFillColor(...C.rowAlt); doc.roundedRect(M, y, CW, h, 1.5, 1.5, 'F');
      doc.setFillColor(...C.accent); doc.rect(M, y, 0.8, h, 'F');
      doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.ink);
      wrapped.forEach((w, i) => doc.text(w, M + 5, y + 4.6 + i * LH));
      y += h + 2;
    } else {
      doc.setTextColor(...C.inkLight);
      lines.forEach(l => doc.splitTextToSize(l, CW).forEach(w => { room(LH); doc.text(w, M, y); y += LH; }));
      y += 2.5;
    }
    first = false;
  });
  // A copy sent to be signed online has no signature block yet.
  if (a.unsigned) {
    y += 4; room(14);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...C.ink);
    doc.text('To sign, open the link in the email this came with.', M, y);
    return y + 8;
  }
  // Who agreed, how and when, as a signature block.
  y += 4;
  room(30);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...C.accentDark);
  pdfTracked(doc, 'AGREED AND SIGNED', M, y, { cs: 0.6 });
  y += 20;
  const colW = (CW - 16) / 3;
  const onLine = (text, x) => drawPdfOnLine(doc, text, x, y, colW);
  onLine(a.signerName, M);
  drawPdfSignature(doc, { x: M, y, w: colW, caption: 'Agreed by' });
  drawPdfSignature(doc, { x: M + colW + 8, y, w: colW, caption: a.signature ? 'Client signature' : 'How it was signed',
    image: a.signature, note: a.signature ? '' : (a.otherNote || 'Recorded by the inspector') });
  onLine(formatAgreementSignedAt(a.signedAt), M + (colW + 8) * 2);
  drawPdfSignature(doc, { x: M + (colW + 8) * 2, y, w: colW, caption: 'Signed' });
  return y + 8;
}

// ── PHOTO ATTACHMENTS ────────────────────────────────────────────────────
// Every photo is resized and re-encoded as a compressed JPEG on the phone.
// The image itself lives outside reportData: as a Blob in IndexedDB on the
// device (works offline, far more room than localStorage) and, once the
// technician is signed in, as a file in the Supabase Storage bucket
// 'report-photos' at <user id>/<photo id>.jpg. reportData only carries each
// photo's metadata: { id, width, height, caption, path? } where path is set
// once the upload has succeeded, so another device (or the business owner)
// can download it. Older reports kept the image inline as p.dataUrl;
// externalizePhotos() moves those into IndexedDB the first time they're seen.
const MAX_PHOTOS_PER_REPORT = 100;
const PHOTO_MAX_DIMENSION = 1280;
const PHOTO_BUCKET = 'report-photos';

function genPhotoId() {
  return 'photo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

// Resizes/re-encodes a single File to a compressed JPEG Blob, returning
// {blob, width, height} so the PDF can preserve the correct aspect ratio
// later without needing to re-decode the image. opts lets a caller that
// sends the photo to the AI keep more detail (bigger, less squeezed).
function compressPhotoFile(file, opts = {}) {
  const maxDim = opts.maxDim || PHOTO_MAX_DIMENSION;
  const quality = opts.quality || 0.7;
  const maxBytes = opts.maxBytes || 225000;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not decode image'));
      img.onload = () => {
        let w = img.naturalWidth, h = img.naturalHeight;
        if (w > maxDim || h > maxDim) {
          if (w >= h) { h = Math.round(h * (maxDim / w)); w = maxDim; }
          else { w = Math.round(w * (maxDim / h)); h = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => {
          if (!blob) { reject(new Error('Could not encode image')); return; }
          // Re-compress harder if a particularly busy/detailed photo still came out large
          if (blob.size <= maxBytes) { resolve({ blob, width: w, height: h }); return; }
          canvas.toBlob(smaller => resolve({ blob: smaller || blob, width: w, height: h }), 'image/jpeg', 0.5);
        }, 'image/jpeg', quality);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ── Photo store (IndexedDB on the device, Supabase Storage in the cloud) ──
let photoDbPromise = null;
function photoDb() {
  if (!photoDbPromise) {
    photoDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('korvus-photos', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('photos');
      req.onsuccess = () => {
        const db = req.result;
        // iPhone can close the store while the app sleeps; the next use reopens it.
        db.onclose = () => { photoDbPromise = null; };
        db.onversionchange = () => { db.close(); photoDbPromise = null; };
        resolve(db);
      };
      req.onerror = () => { photoDbPromise = null; reject(req.error); };
    });
  }
  return photoDbPromise;
}

function photoStoreRequest(mode, fn, retried) {
  return photoDb().then(db => new Promise((resolve, reject) => {
    let tx;
    try { tx = db.transaction('photos', mode); }
    catch (e) {
      // A connection the phone closed throws here: reopen and try once more.
      photoDbPromise = null;
      if (!retried) { photoStoreRequest(mode, fn, true).then(resolve, reject); return; }
      reject(e); return;
    }
    const req = fn(tx.objectStore('photos'));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    // A full phone aborts the write instead of failing it.
    tx.onabort = () => reject(tx.error || new Error('Photo storage write was stopped'));
  }));
}
const putPhotoBlob    = (id, blob) => photoStoreRequest('readwrite', st => st.put(blob, id));
const getPhotoBlob    = (id) => photoStoreRequest('readonly', st => st.get(id));
const deletePhotoBlob = (id) => photoStoreRequest('readwrite', st => st.delete(id));
const listPhotoBlobIds = () => photoStoreRequest('readonly', st => st.getAllKeys());

function allReportPhotos(rd) {
  if (!rd) return [];
  return [...(rd.photos || []), ...Object.values(rd.photosBySection || {}).flat()];
}

function dataUrlToBlob(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function photoObjectUrl(path) {
  return `${SUPABASE_URL}/storage/v1/object/${PHOTO_BUCKET}/${path}`;
}

// The photo's image as a Blob: from the device, else (for an older report)
// its inline dataUrl, else downloaded from the cloud and kept on the device.
async function getPhotoImage(p) {
  try {
    const local = await getPhotoBlob(p.id);
    if (local) return local;
  } catch (e) {}
  if (p.dataUrl) return dataUrlToBlob(p.dataUrl);
  if (p.path && authSession) {
    try {
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/${PHOTO_BUCKET}/${p.path}`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${getAuthToken()}` },
      });
      if (res.ok) {
        const blob = await res.blob();
        putPhotoBlob(p.id, blob).catch(() => {});
        return blob;
      }
    } catch (e) {}
  }
  return null;
}

// Moves any inline (legacy) photo images in rd into IndexedDB and drops
// the dataUrl from the metadata. Returns true if rd changed.
async function externalizePhotos(rd) {
  let changed = false;
  for (const p of allReportPhotos(rd)) {
    if (!p.dataUrl) continue;
    const blob = dataUrlToBlob(p.dataUrl);
    if (!blob) continue;
    try {
      await putPhotoBlob(p.id, blob);
      delete p.dataUrl;
      changed = true;
    } catch (e) { return changed; } // IndexedDB unavailable: keep the inline copy
  }
  return changed;
}

// Uploads every photo in rd that isn't in the cloud yet. Returns true if
// any photo gained a path. A missing bucket or no signal just leaves the
// photo pending, to try again on the next save.
async function uploadPendingPhotos(rd) {
  if (!authSession || !authUser?.id) return false;
  let changed = false;
  for (const p of allReportPhotos(rd)) {
    if (p.path) continue;
    const blob = await getPhotoImage(p);
    if (!blob) continue;
    const path = `${authUser.id}/${p.id}.jpg`;
    try {
      const res = await fetch(photoObjectUrl(path), {
        method: 'POST',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${getAuthToken()}`, 'Content-Type': blob.type || 'image/jpeg', 'x-upsert': 'true' },
        body: blob,
      });
      if (!res.ok) break;
      p.path = path;
      delete p.dataUrl;
      changed = true;
    } catch (e) { break; }
  }
  return changed;
}

function deleteCloudPhotos(paths) {
  if (!authSession || paths.length === 0) return;
  fetch(`${SUPABASE_URL}/storage/v1/object/${PHOTO_BUCKET}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
    body: JSON.stringify({ prefixes: paths }),
  }).catch(() => {});
}

// Photo ids still used by the open report, the draft, or any saved report
// on this device, for every account that has signed in here (each keeps
// its saved reports under its own korva_saved_reports_<id> key).
function referencedPhotoIds() {
  const ids = new Set(allReportPhotos(reportData).map(p => p.id));
  const add = (raw, pick) => {
    try { pick(JSON.parse(raw || 'null')).forEach(rd => allReportPhotos(rd).forEach(p => ids.add(p.id))); } catch (e) {}
  };
  add(localStorage.getItem(DRAFT_KEY), d => [d && d.reportData]);
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(STORAGE_KEY)) add(localStorage.getItem(key), list => (list || []).map(r => r && r.reportData));
  }
  return ids;
}

// Run once when the app opens: moves older saved reports' inline photos
// into IndexedDB, then removes device copies no report uses any more
// (photos removed from a report, or reports deleted).
async function tidyPhotoStorage() {
  try {
    const reports = getSavedReports();
    let changed = false;
    for (const r of reports) {
      if (await externalizePhotos(r.reportData)) changed = true;
    }
    if (changed) setSavedReports(reports);

    const keep = referencedPhotoIds();
    const stored = await listPhotoBlobIds();
    for (const id of stored) {
      // A marked-up photo's clean copy (see PHOTO MARKUP) lives as long as the photo.
      const photoId = String(id).startsWith('orig_') ? String(id).slice(5) : id;
      if (!keep.has(photoId)) await deletePhotoBlob(id);
    }
  } catch (e) { console.warn('Photo tidy-up skipped:', e && e.message); }
}

// Grids render each <img data-photo-id> empty, then this fills them in.
async function hydratePhotoImages(container, photos) {
  for (const p of photos) {
    const img = container.querySelector(`img[data-photo-id="${p.id}"]`);
    if (!img) continue;
    const blob = await getPhotoImage(p);
    if (blob) {
      const url = URL.createObjectURL(blob);
      img.onload = () => URL.revokeObjectURL(url);
      img.src = url;
    } else {
      img.alt = 'Photo not on this device yet';
    }
  }
}

// ── PHOTO VIEWER ──────────────────────────────────────────────────────────
// Tap any photo to see it full screen and zoom in (pinch, double-tap, or the
// mouse wheel), to check it is sharp enough before it goes in the report.
const photoView = { scale: 1, x: 0, y: 0, pointers: new Map(), pinch: null, lastTap: 0 };

async function openPhotoViewer(id) {
  const p = allReportPhotos(reportData).find(ph => ph.id === id);
  if (!p) return;
  const blob = await getPhotoImage(p);
  if (!blob) { showToast('This photo is not on this device yet', 'info'); return; }
  const img = document.getElementById('photoViewerImg');
  if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
  img.dataset.url = URL.createObjectURL(blob);
  img.src = img.dataset.url;
  document.getElementById('photoViewerInfo').textContent =
    [(p.caption || '').trim(), p.width && p.height ? `${p.width} × ${p.height}` : ''].filter(Boolean).join('  ·  ');
  setPhotoZoom(1, 0, 0);
  if (typeof updateMarkupButton === 'function') updateMarkupButton(id);
  document.getElementById('photoViewer').hidden = false;
}

function closePhotoViewer() {
  const viewer = document.getElementById('photoViewer');
  if (!viewer || viewer.hidden) return;
  viewer.hidden = true;
  const img = document.getElementById('photoViewerImg');
  if (img.dataset.url) { URL.revokeObjectURL(img.dataset.url); delete img.dataset.url; }
  img.removeAttribute('src');
  photoView.pointers.clear(); photoView.pinch = null;
}

// Zooms to scale with the photo offset by (x, y) from the centre, kept so
// the photo never slides off the screen.
function setPhotoZoom(scale, x, y) {
  const img = document.getElementById('photoViewerImg');
  const stage = document.getElementById('photoViewerStage');
  scale = Math.min(5, Math.max(1, scale));
  const maxX = Math.max(0, (img.clientWidth * scale - stage.clientWidth) / 2);
  const maxY = Math.max(0, (img.clientHeight * scale - stage.clientHeight) / 2);
  photoView.scale = scale;
  photoView.x = Math.min(maxX, Math.max(-maxX, x));
  photoView.y = Math.min(maxY, Math.max(-maxY, y));
  img.style.transform = `translate(${photoView.x}px, ${photoView.y}px) scale(${scale})`;
  document.getElementById('photoViewer').classList.toggle('zoomed', scale > 1);
}

// Zooms about a point on screen, so what is under the finger stays there.
function zoomPhotoAt(scale, clientX, clientY) {
  const r = document.getElementById('photoViewerStage').getBoundingClientRect();
  const px = clientX - (r.left + r.width / 2), py = clientY - (r.top + r.height / 2);
  const k = Math.min(5, Math.max(1, scale)) / photoView.scale;
  setPhotoZoom(scale, px - (px - photoView.x) * k, py - (py - photoView.y) * k);
}

function initPhotoViewer() {
  const stage = document.getElementById('photoViewerStage');
  if (!stage) return;
  const pts = photoView.pointers;
  stage.addEventListener('pointerdown', e => {
    stage.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      photoView.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: photoView.scale };
    }
  });
  stage.addEventListener('pointermove', e => {
    const pt = pts.get(e.pointerId);
    if (!pt) return;
    const dx = e.clientX - pt.x, dy = e.clientY - pt.y;
    pt.x = e.clientX; pt.y = e.clientY;
    if (pts.size === 2 && photoView.pinch) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomPhotoAt(photoView.pinch.scale * d / photoView.pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (pts.size === 1 && photoView.scale > 1) {
      setPhotoZoom(photoView.scale, photoView.x + dx, photoView.y + dy);
    }
  });
  const up = e => {
    const pt = pts.get(e.pointerId);
    pts.delete(e.pointerId);
    if (pts.size < 2) photoView.pinch = null;
    if (!pt || e.type === 'pointercancel' || pts.size) return;
    // A quick second tap in the same place zooms in, or back out.
    if (Math.hypot(e.clientX - pt.sx, e.clientY - pt.sy) > 10) return;
    const now = Date.now();
    if (now - photoView.lastTap < 300) {
      photoView.lastTap = 0;
      if (photoView.scale > 1) setPhotoZoom(1, 0, 0); else zoomPhotoAt(2.5, e.clientX, e.clientY);
    } else photoView.lastTap = now;
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    zoomPhotoAt(photoView.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
  }, { passive: false });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePhotoViewer(); });
  // Any photo in the app opens here.
  document.addEventListener('click', e => {
    const img = e.target.closest && e.target.closest('img[data-photo-id]');
    if (img && img.getAttribute('src')) openPhotoViewer(img.dataset.photoId);
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPhotoViewer); else initPhotoViewer();

// After new photos are added: try to back them up now, and record their
// cloud paths in the draft if that worked.
function backUpNewPhotos() {
  uploadPendingPhotos(reportData).then(changed => { if (changed) saveDraft(); });
}

// ── SECTION-AWARE PHOTO SYSTEM ─────────────────────────────────────────────
// Photos are stored per-section in reportData.photosBySection
// The old reportData.photos array is kept for backward compatibility (general photos tab)

const MAX_SECTION_PHOTOS = 30;
// The property box takes one photo, the front of the house, which goes on
// the report cover. Adding another replaces it.
const SECTION_PHOTO_LIMITS = { general: 1 };
const sectionPhotoLimit = section => SECTION_PHOTO_LIMITS[section] || MAX_SECTION_PHOTOS;
const SECTION_PHOTO_KEYS = ['general','durable','obstructions','restrictions','findings','conducive','recommendations'];

function getSectionPhotos(section) {
  if (!reportData.photosBySection) reportData.photosBySection = {};
  if (!reportData.photosBySection[section]) reportData.photosBySection[section] = [];
  return reportData.photosBySection[section];
}

async function handleSectionPhotoFiles(fileList, section) {
  const files = Array.from(fileList || []);
  // Reset the input so the same file can be selected again
  const input = document.getElementById(`sectionPhotoInput-${section}`);
  if (input) input.value = '';
  if (!files.length) return;

  const limit = sectionPhotoLimit(section);
  // A one-photo box (the cover) swaps its photo only once the new one is
  // stored, so a file that fails leaves the old photo in place.
  const replacing = limit === 1 && getSectionPhotos(section).length > 0;
  const existing = replacing ? [] : getSectionPhotos(section);
  const remaining = limit - existing.length;
  if (remaining <= 0) { showToast(`Photo limit reached for this section (${limit})`, 'error'); return; }
  const toProcess = files.slice(0, remaining);
  if (files.length > toProcess.length) showToast(`Only added ${toProcess.length} of ${files.length} photos`, 'warn');

  for (const file of toProcess) {
    try {
      const { blob, width, height } = await compressPhotoFile(file);
      const id = genPhotoId();
      await putPhotoBlob(id, blob);
      existing.push({ id, width, height, caption: '' });
    } catch(e) { showToast(photoStoreProblem(e), 'error'); }
  }
  if (replacing && existing.length) reportData.photosBySection[section] = existing;
  renderSectionPhotoGrid(section);
  updateProgress();
  saveDraft();
  backUpNewPhotos();
}

// "Add Photo" asks where the photo comes from, because a plain photo input
// lets the phone decide and some phones only offer the camera. The chosen
// file input keeps its own onchange handler.
let photoSourceInput = null;
function choosePhotoSource(input) {
  photoSourceInput = typeof input === 'string' ? document.getElementById(input) : input;
  if (!photoSourceInput) return;
  document.getElementById('photoSourceOverlay').classList.add('open');
}
function closePhotoSource() {
  document.getElementById('photoSourceOverlay').classList.remove('open');
}
function pickPhotoSource(kind) {
  closePhotoSource();
  const input = photoSourceInput;
  photoSourceInput = null;
  if (!input) return;
  // Listing file types without image/* makes Android open its file browser
  // instead of the photo picker; iPhone offers Choose File either way.
  input.accept = kind === 'files' ? '.jpg,.jpeg,.png,.webp,.heic,.heif' : 'image/*';
  if (kind === 'camera') input.setAttribute('capture', 'environment');
  else input.removeAttribute('capture');
  input.click();
}

// Removing a photo offers Undo, which puts it back where it was.
function removeSectionPhoto(id, section, refresh) {
  const list = reportData.photosBySection?.[section];
  if (!list) return;
  const index = list.findIndex(p => p.id === id);
  if (index < 0) return;
  const photo = list[index];
  const target = reportData;
  reportData.photosBySection[section] = list.filter(p => p.id !== id);
  renderSectionPhotoGrid(section);
  updateProgress();
  saveDraft();
  showToast('Photo removed', 'info', { label: 'Undo', run: () => {
    if (reportData !== target) return;
    const now = (reportData.photosBySection = reportData.photosBySection || {})[section] || [];
    if (now.some(p => p.id === id)) return;
    now.splice(Math.min(index, now.length), 0, photo);
    reportData.photosBySection[section] = now;
    renderSectionPhotoGrid(section);
    if (refresh) refresh();
    updateProgress();
    saveDraft();
  } });
}

function updateSectionPhotoCaption(id, section, value) {
  const photos = getSectionPhotos(section);
  const photo = photos.find(p => p.id === id);
  if (photo) { photo.caption = value; saveDraft(); }
}

function renderSectionPhotoGrid(section) {
  const grid  = document.getElementById(`sectionPhotoGrid-${section}`);
  const count = document.getElementById(`sectionPhotoCount-${section}`);
  const btn   = document.getElementById(`sectionPhotoBtn-${section}`);
  if (!grid) return;
  const photos = getSectionPhotos(section);
  const limit = sectionPhotoLimit(section);
  if (count) count.textContent = limit === 1 ? '' : `${photos.length}/${limit} photos`;
  // Areas and Access take photos per spot now; their old boxes only show
  // for reports that already have photos in them.
  const box = grid.closest('[data-legacy-photos]');
  if (box) box.hidden = !photos.length;
  if (btn && limit === 1) btn.lastChild.textContent = photos.length ? ' Replace photo' : ' Add photo';
  else if (btn) btn.disabled = photos.length >= limit;
  if (photos.length === 0) {
    grid.innerHTML = '<div class="section-photo-empty">No photos added</div>';
    return;
  }
  grid.innerHTML = photos.map(p => `
    <div class="section-photo-card">
      <img data-photo-id="${p.id}" alt="Photo">
      <div class="section-photo-body">
        <input class="photo-caption-input" type="text" placeholder="Caption…"
               value="${escapeHtml(p.caption||'')}"
               oninput="updateSectionPhotoCaption('${p.id}','${section}',this.value)">
        <button class="photo-remove-btn" onclick="removeSectionPhoto('${p.id}','${section}')">Remove</button>
      </div>
    </div>
  `).join('');
  hydratePhotoImages(grid, photos);
}

function renderAllSectionPhotoGrids() {
  SECTION_PHOTO_KEYS.forEach(s => renderSectionPhotoGrid(s));
}

// Re-draws the parts of the report that aren't plain fields, after a
// report is loaded, restored or reset.
function renderReportWidgets() {
  renderRecLines();
  renderPhotoGrid();
  renderAllSectionPhotoGrids();
  renderAreaChecklist();
  renderMoistureTable();
  renderPendingNotes();
  renderIssueState();
}

// ── READY-MADE RECOMMENDATIONS ─────────────────────────────────────────────
// Lines the inspector would otherwise say on most jobs, added with a tap.
// The report stores the text as it was when added (reportData.recLines =
// [{ id, text }]), so a later change of wording never changes a report
// already sent. Never a structural verdict, never a risk by species.
const REC_LINES = [
  ['maintain', 'Maintain the system', 'Keep the termite management system on this property maintained as its installer specifies, and follow the recommendations in this report.'],
  ['warranty', 'Keep the warranty', 'Have the termite management system inspected and serviced as its warranty requires, so any warranty or service period stays in place.'],
  ['expired', 'System may be expired', 'The termite management system on this property may be past its service life. Have it assessed and, if needed, re-treated or replaced.'],
  ['install', 'Install a system', 'Have a termite management system installed to AS 3660.2, such as a chemical soil treated zone or a monitoring and baiting system. A quote can be provided.'],
  ['zone', 'Keep inspection zones clear', 'Keep the slab edge and the inspection zones around the building clear of soil, garden beds, paving and stored items, so termite entry can be seen.'],
  ['debris', 'Clear timber and debris', 'Remove stored timber, garden debris and other materials from against the building and from the subfloor.'],
  ['drainage', 'Keep water away', 'Keep gutters, downpipes, taps and drainage in good repair, and keep the ground around the building dry and draining away from it.'],
  ['plumber', 'Plumber for moisture', 'Have a licensed plumber find and fix the source of the moisture noted in this report.'],
  ['ventilation', 'Improve ventilation', 'Improve subfloor ventilation and keep the vents clear: damp subfloors attract termites and decay.'],
  ['stumps', 'Check trees and stumps', 'Have trees and stumps on the property checked for termite nests, and remove dead stumps and old landscaping timbers.'],
  ['declined', 'Client declined for now', 'Termite management options were discussed with the client, who chose not to go ahead at this time. A quote can be provided on request.'],
  ['sample', 'Sample sent for ID', 'A sample was taken for identification. Further advice will follow once it has been identified.'],
];

function getRecLines() { return Array.isArray(reportData.recLines) ? reportData.recLines : []; }

function renderRecLines() {
  const el = document.getElementById('recLines');
  if (!el) return;
  const have = new Set(getRecLines().map(l => l.id));
  el.innerHTML = REC_LINES.map(([id, label]) =>
    `<button type="button" class="rec-line${have.has(id) ? ' on' : ''}" aria-pressed="${have.has(id)}" onclick="toggleRecLine('${id}')">${escapeHtml(label)}</button>`).join('');
  const added = document.getElementById('recLinesAdded');
  if (added) {
    added.innerHTML = getRecLines().map(l => `<li>${escapeHtml(l.text)}</li>`).join('');
    added.hidden = !have.size;
  }
  const n = have.size;
  const count = document.getElementById('recLinesCount');
  if (count) count.textContent = n ? `${n} added to the report` : 'Tap to add to the report';
}

function toggleRecLine(id) {
  if (isReportLocked()) { showToast('This job is complete and locked. Tap Amend to change it', 'info'); return; }
  const line = REC_LINES.find(l => l[0] === id);
  if (!line) return;
  const list = getRecLines();
  reportData.recLines = list.some(l => l.id === id) ? list.filter(l => l.id !== id) : [...list, { id, text: line[2] }];
  renderRecLines();
  renderFieldGroups();
  saveDraft();
}

// ── LEGACY GENERAL PHOTOS (Photos tab) ─────────────────────────────────────
async function handlePhotoFiles(fileList) {
  const files = Array.from(fileList || []);
  document.getElementById('photoFileInput').value = '';
  if (!files.length) return;

  if (!reportData.photos) reportData.photos = [];
  const remaining = MAX_PHOTOS_PER_REPORT - reportData.photos.length;
  if (remaining <= 0) { showToast(`Photo limit reached (${MAX_PHOTOS_PER_REPORT} per report)`, 'error'); return; }
  const toProcess = files.slice(0, remaining);
  if (files.length > toProcess.length) showToast(`Only added ${toProcess.length} of ${files.length} — limit reached`, 'error');

  for (const file of toProcess) {
    try {
      const { blob, width, height } = await compressPhotoFile(file);
      const id = genPhotoId();
      await putPhotoBlob(id, blob);
      reportData.photos.push({ id, width, height, caption: '' });
    } catch(e) { showToast('Could not process one of the selected photos', 'error'); }
  }
  renderPhotoGrid();
  updateProgress();
  saveDraft();
  backUpNewPhotos();
}

function removePhoto(id) {
  if (!reportData.photos) return;
  const index = reportData.photos.findIndex(p => p.id === id);
  if (index < 0) return;
  const photo = reportData.photos[index];
  const target = reportData;
  reportData.photos = reportData.photos.filter(p => p.id !== id);
  if (reportData.photos.length === 0) delete reportData.photos;
  renderPhotoGrid();
  updateProgress();
  saveDraft();
  showToast('Photo removed', 'info', { label: 'Undo', run: () => {
    if (reportData !== target) return;
    const now = reportData.photos || [];
    if (now.some(p => p.id === id)) return;
    now.splice(Math.min(index, now.length), 0, photo);
    reportData.photos = now;
    renderPhotoGrid();
    updateProgress();
    saveDraft();
  } });
}

function updatePhotoCaption(id, value) {
  if (!reportData.photos) return;
  const photo = reportData.photos.find(p => p.id === id);
  if (photo) { photo.caption = value; saveDraft(); }
}

function renderPhotoGrid() {
  const grid = document.getElementById('photoGrid');
  const empty = document.getElementById('photoEmptyState');
  const countEl = document.getElementById('photoCount');
  const addBtn = document.getElementById('addPhotoBtn');
  if (!grid) return;

  const photos = reportData.photos || [];
  countEl.textContent = `${photos.length} of ${MAX_PHOTOS_PER_REPORT} photos attached`;
  countEl.classList.toggle('at-cap', photos.length >= MAX_PHOTOS_PER_REPORT);
  addBtn.disabled = photos.length >= MAX_PHOTOS_PER_REPORT;

  if (photos.length === 0) {
    grid.style.display = 'none';
    empty.style.display = 'block';
    grid.innerHTML = '';
    return;
  }
  empty.style.display = 'none';
  grid.style.display = 'grid';
  grid.innerHTML = photos.map(p => `
    <div class="photo-card">
      <img data-photo-id="${p.id}" alt="Inspection photo">
      <div class="photo-card-body">
        <input class="photo-caption-input" type="text" placeholder="What does this show?"
               value="${escapeHtml(p.caption || '')}"
               oninput="updatePhotoCaption('${p.id}', this.value)">
        <div class="photo-card-footer">
          <button class="photo-analyze-btn" id="analyzeBtn-${p.id}" onclick="analyzeGalleryPhoto('${p.id}')">Analyze</button>
          <button class="photo-remove-btn" onclick="removePhoto('${p.id}')">Remove</button>
        </div>
      </div>
    </div>
  `).join('');
  hydratePhotoImages(grid, photos);
}

// ── DRAWER & VOICE POPOVER ────────────────────────────────────────────────
function toggleDrawer() {
  const sidebar = document.getElementById('sidebarPanel');
  const overlay = document.getElementById('drawerOverlay');
  const isOpen = sidebar.classList.toggle('open');
  if (isOpen) { showMenuPage(null); renderProfileMenu(); }
  overlay.classList.toggle('open', isOpen);
}

// ── MENU ─────────────────────────────────────────────────────────────────
// Full screen. It opens on a list of groups (This job, Jobs, Account, App);
// tapping an item opens it as its own page, with Back to return to the list.
// Each item is a drawer panel: its header is the list row, its body the page.
function openMenuPage(panelId) {
  if (!document.getElementById('sidebarPanel').classList.contains('open')) toggleDrawer();
  showMenuPage(panelId);
}

function showMenuPage(panelId) {
  const sidebar = document.getElementById('sidebarPanel');
  const panel = panelId ? document.getElementById(panelId) : null;
  sidebar.querySelectorAll('.menu-page-active').forEach(el => el.classList.remove('menu-page-active'));
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
  if (panelId === 'settingsPanel') { restoreTestModeSetting(); renderLearnedList(); }
  if (panel) track('screen_viewed', { screen: 'menu_' + panelId });
}


// ── BOTTOM DOCK ──────────────────────────────────────────────────────────
// Jobs, the mic and This job. Jobs is every job (the account and settings
// open from its top corner); This job is the open job's page, and each of
// its documents (agreement, report, quote, treatment) opens a layer below
// it. Each tab closes whatever is open, then opens its place. Which tab is
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
    // A quote opened from the start menu goes back there; the tabs go to the app.
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
  if (document.getElementById('sidebarPanel').classList.contains('on-page')) { showMenuPage(null); return; }
  toggleDrawer();
  openDashboard();
}

// ── THIS JOB ─────────────────────────────────────────────────────────────
// The open job's page: where it's up to and the next step, then every
// stage in the order a job runs, each opening its document, then the job's
// details. Built from the same reading of a job as the dashboard's list.
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
  renderJobPage();
  overlay.classList.add('open');
  document.getElementById('jobPageBody').scrollTop = 0;
  track('screen_viewed', { screen: 'job' });
}

function closeJobPage() {
  const overlay = document.getElementById('jobOverlay');
  if (!overlay || !overlay.classList.contains('open')) return;
  overlay.classList.remove('open');
  parkJobPanel();
}

function jobAgreementStep() {
  const a = reportData.agreement;
  if (!a) return { label: 'Agreement', to: 'agreement', state: 'now', text: 'Not signed yet. Get it signed before you start' };
  const how = a.method === 'onsite' ? 'Signed on site' : a.method === 'email' ? 'Signed by email' : a.method === 'paper' ? 'Signed on paper' : 'Signed';
  return { label: 'Agreement', to: 'agreement', state: 'done', text: `${how}${a.signerName ? ' by ' + a.signerName : ''}` };
}

function renderJobPage() {
  const body = document.getElementById('jobPageBody');
  if (!body) return;
  parkJobPanel();
  const j = currentJobSummary();
  const addr = (j.r.address || '').trim();
  const steps = [jobAgreementStep(), ...j.steps];
  // Before the agreement is signed, that is the next step.
  const next = !reportData.agreement && addr ? { status: 'Get the agreement signed', hint: 'The client signs it before the inspection starts.', next: { label: 'Open the agreement', to: 'agreement' } }
    : !addr ? { status: 'Start the job', hint: 'Type the address and the client\'s name below, get the agreement signed, then tap the mic and talk through the inspection.', next: null }
    : { status: j.status, hint: j.hint, next: j.next };
  if (reportData.agreement && j.steps.some(st => st.state === 'now')) steps[0].state = 'done';
  else if (!reportData.agreement) steps.slice(1).forEach(st => { if (st.state === 'now') st.state = 'todo'; });
  const icon = d => `<svg class="icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const dot = (st, i) => st.state === 'done' ? icon('<path d="M20 6 9 17l-5-5"/>')
    : st.state === 'bad' ? icon('<path d="M18 6 6 18"/><path d="M6 6l12 12"/>') : st.state === 'skip' ? '–' : i + 1;
  const pct = calculateCompletion();
  const detail = (st) => st.to === 'report' && st.state !== 'done' && st.state !== 'skip' ? `${pct}% filled in`
    : st.to === 'quote' && j.total ? `${formatAUD(j.total).replace(/\.00$/, '')}${j.q && j.q.sentAt ? ', sent' : ', not sent yet'}` : st.text;
  const chev = '<svg class="icon dash-timeline-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
  const group = (DASHBOARD_TABS.find(([k]) => k === j.group) || [, ''])[1];
  body.innerHTML = `
    <div class="job-hero">
      ${addr ? `<span class="dash-detail-chip ${j.group}">${group}</span>` : ''}
      <h3 class="job-hero-addr">${escapeHtml(addr || 'New job')}</h3>
      ${j.r.client ? `<p class="job-hero-sub">${escapeHtml(j.r.client)}</p>` : ''}
    </div>
    <section class="dash-next job-next ${j.group}">
      <div class="dash-next-label">${next.next ? 'Next step' : addr ? 'Where it\'s at' : 'Next step'}</div>
      <div class="dash-next-title">${escapeHtml(next.status)}</div>
      ${next.hint ? `<p class="dash-next-hint">${escapeHtml(next.hint)}</p>` : ''}
      ${next.next ? `<button type="button" class="dash-detail-primary" onclick="jobGo('${next.next.to}')">${next.next.label}</button>` : ''}
    </section>
    <div class="job-section-head">The job, step by step</div>
    <ol class="dash-timeline job-steps">
      ${steps.map((st, i) => `
        <li class="${st.state}">
          <span class="dash-timeline-dot" aria-hidden="true">${dot(st, i)}</span>
          <button type="button" class="dash-timeline-btn" onclick="jobGo('${st.to}')">
            <span class="dash-timeline-label">${st.label}</span>
            <span class="dash-timeline-text">${escapeHtml(detail(st))}</span>
            ${chev}
          </button>
        </li>`).join('')}
    </ol>
    <div class="job-section-head" id="jobDetailsHead">Job details</div>
    <div id="jobPageSlot"></div>`;
  const panel = document.getElementById('jobPanel');
  if (panel) document.getElementById('jobPageSlot').appendChild(panel);
}

// Opens one of the open job's documents from its page (or from the strip
// at the top of a document).
function jobGo(to) {
  closeJobPage();
  if (document.getElementById('quoteScreen').classList.contains('open') && to !== 'quote' && to !== 'answer' && to !== 'treatment' && to !== 'certificate' && to !== 'bait') {
    closeQuote();
    if (document.getElementById('app').style.display !== 'flex') openApp('inspect');
  }
  if (to === 'job') { openJobPage(); return; }
  if (to === 'details') { openJobPage(); document.getElementById('jobDetailsHead')?.scrollIntoView({ block: 'start' }); return; }
  if (to === 'agreement') { openAgreementSheet(); return; }
  if (to === 'report') return;
  if (!document.getElementById('quoteScreen').classList.contains('open')) openQuoteFromReport();
  if (to === 'treatment') openTreatmentRecord();
  if (to === 'bait') {
    const card = document.getElementById('qpBait');
    if (card) card.scrollIntoView({ block: 'center' });
    // Nothing recorded, or a check due: straight onto the sheet.
    const b = typeof baitProgram === 'function' ? baitProgram(quoteState) : null;
    if (b && !b.finished && !(b.last && !b.last.sentAt) && b.dueNow) openBaitVisit();
  }
  if (to === 'answer' || to === 'certificate') {
    const step = document.getElementById('qgStep3');
    if (step) step.scrollIntoView({ block: 'center' });
  }
  // The certificate's Email button, lit so it's the obvious next tap.
  if (to === 'certificate') {
    ensureJsPDFLoaded().catch(() => {});
    const btn = document.querySelector('#quoteAnswer .qp-cert-email');
    if (btn) { btn.scrollIntoView({ block: 'center' }); btn.classList.add('flash'); setTimeout(() => btn.classList.remove('flash'), 2400); }
  }
}

// The strip at the top of the report and the quote: back to the job's page,
// then its documents, the one on show lit. Treatment joins once the client
// has accepted.
function renderDocStrips() {
  if (typeof quoteHasItems !== 'function') return; // js/quote.js not loaded yet
  const q = currentJobQuote();
  const accepted = quoteHasItems(q) && (quoteAnswerState(q) || {}).status === 'accepted';
  const docs = [['agreement', 'Agreement', !!reportData.agreement], ['report', 'Report'], ['quote', 'Quote', quoteHasItems(q)]];
  if (accepted) docs.push(['treatment', 'Treatment', !!q.treatment]);
  if (accepted && typeof baitInstalled === 'function' && baitInstalled(q)) docs.push(['bait', 'Bait visits', !!(baitProgram(q) || {}).finished]);
  document.querySelectorAll('.doc-strip').forEach(strip => {
    const here = strip.dataset.doc;
    strip.innerHTML = `<button type="button" class="doc-chip doc-chip-job" onclick="jobGo('job')"><svg class="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>Job</button>`
      + docs.map(([to, label, done]) => `<button type="button" class="doc-chip${to === here ? ' here' : ''}${done ? ' done' : ''}" ${to === here ? 'aria-current="page"' : `onclick="jobGo('${to}')"`}>${label}</button>`).join('');
  });
}

// What the dock's tabs show about the job. This job: how much of the
// report's required answers are in, as a number, a tick once it's done.
function syncDockReport(pct, locked) {
  const badge = document.getElementById('tabReportRing');
  if (!badge) return;
  const done = locked || pct >= 100;
  const n = Math.max(0, Math.min(99, Math.round(pct || 0)));
  badge.querySelector('.tab-progress-pct').textContent = n + '%';
  badge.classList.toggle('done', done);
  badge.classList.toggle('empty', !done && !n);
  badge.closest('.tab').setAttribute('aria-label', done ? 'This job, report done' : `This job, report ${n}% filled in`);
}

// Dashboard: how many jobs need the inspector. Quote: a dot in the colour of
// where this job's quote is up to. Read from storage, so it waits for a
// quiet moment instead of running on every keystroke.
let dockJobsTimer = 0;
function syncDockJobs() {
  clearTimeout(dockJobsTimer);
  dockJobsTimer = setTimeout(() => {
    try {
      const quotes = getSavedQuotes();
      const need = getSavedReports().map(r => dashboardJob(r, quotes)).filter(j => j.group === 'todo').length;
      const count = document.getElementById('tabJobsCount');
      if (count) {
        count.textContent = need > 9 ? '9+' : String(need);
        count.hidden = !need;
        count.closest('.tab').setAttribute('aria-label', need ? `Dashboard, ${need} job${need === 1 ? '' : 's'} need you` : 'Dashboard');
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

// The mic is for the report: from anywhere else it goes to the report and
// opens the voice panel there.
function tabMic() {
  // While it listens, Talk reads Stop: a tap stops the recording.
  if (isRecording) { toggleRecording(); return; }
  const onReport = document.getElementById('app').style.display === 'flex'
    && !['quoteScreen', 'sidebarPanel', 'dashboardOverlay', 'jobOverlay'].some(id => document.getElementById(id).classList.contains('open'));
  if (!onReport) {
    tabGo('report');
    if (!document.getElementById('voicePopover').classList.contains('open')) toggleVoicePopover();
    return;
  }
  toggleVoicePopover();
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

function formatAddress(street, suburb, state, postcode) {
  const line2 = [suburb, [state, postcode].filter(Boolean).join(' ')].filter(Boolean).join(' ');
  return [street, line2].filter(Boolean).join(', ');
}

function updateJob() {
  const addr = getFullAddress();
  const headerJob = document.getElementById('headerJob');
  headerJob.textContent = addr || 'No job loaded';
  headerJob.classList.toggle('has-job', !!addr);
  document.getElementById('reportSubtitle').textContent = addr
    ? `${addr} · Speak to populate fields`
    : 'Enter job details and speak to populate fields';

  const summary = document.getElementById('jobPanelSummary');
  if (summary) {
    const client = document.getElementById('jobClient').value.trim();
    const parts = [addr, client].filter(Boolean);
    summary.textContent = parts.length ? parts.join(' · ') : 'No job set';
  }

  // The job's page shows the address as it's typed into its details.
  const heroAddr = document.querySelector('#jobOverlay.open .job-hero-addr');
  if (heroAddr) heroAddr.textContent = addr || 'New job';

  syncAllSelectCards();
  renderLastVisitBanner();
  saveDraft();
}

// ── LAST VISIT ──────────────────────────────────────────────────────────
// An address this account has inspected before. The inspector can start
// from that report: the property details that don't change from year to
// year are copied in, the known termite history is written from what was
// found then, and a sheet shows what changed since. Nothing about this
// visit's findings is copied: those are inspected afresh.
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
  const list = getSavedReports().filter(r => r && r.id !== currentReportId && r.reportData && addressKey(r.jobAddress, r.jobSuburb) === key);
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

// What the last report found, in the words the Known Termite History field uses.
function termiteHistoryFrom(entry) {
  const rd = entry.reportData || {};
  const when = formatIssueDate(visitDate(entry));
  const fs = (rd.findings || []).filter(f => f && f.termiteActivity);
  const live = fs.filter(f => f.termiteActivity === 'ACTIVE'), old = fs.filter(f => f.termiteActivity === 'INACTIVE');
  const where = list => list.map(f => f.activityLocation).filter(Boolean).slice(0, 2).join('; ');
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
  const prev = started ? null : previousVisitFor();
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
  if (isReportLocked()) { showToast('This job is complete and locked. Tap Amend to change it', 'info'); return; }
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

// ── WEATHER ON THE DAY ───────────────────────────────────────────────────
// Temperature, humidity and the last 24 hours of rain at the property, from
// the Worker's /weather route (Google's Weather API). Picking the address on
// the day of the inspection fills the empty ones quietly; "Fill from today's
// weather" fills them all, from the picked address or else the phone's
// location. The inspector can still edit every value.
function inspectionIsToday() {
  const d = (document.getElementById('jobInspectionDate') || {}).value || reportData.jobInspectionDate;
  return !d || d === todayIsoDate();
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

// quiet: the automatic fill after an address pick. It fills only empty
// fields, never asks for the phone's location and shows no messages.
async function fillWeather({ quiet = false } = {}) {
  const btn = document.getElementById('weatherFillBtn');
  const say = (msg, kind) => { if (!quiet) showToast(msg, kind); };
  if (btn) { btn.disabled = true; btn.textContent = 'Getting the weather…'; }
  try {
    const loc = reportData.siteLocation || (quiet ? null : await phoneLocation());
    if (!loc) { say('Pick the address from the list, or allow location, to get the weather', 'info'); return; }
    const res = await workerFetch(`/weather?lat=${loc.lat.toFixed(4)}&lng=${loc.lng.toFixed(4)}`, { method: 'GET' });
    if (res.status === 501) { say("Weather isn't set up yet, so enter it by hand", 'info'); return; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const w = await res.json();
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
// (updateStandard() removed — dead code, no #standardSelect element exists
// and nothing called it; setStandard() below is the real active path)

function setStandard(val, fromHeader = false) {
  reportData.standard = val;

  const el = document.getElementById('f-standard');
  if (el) renderField(el, 'standard', val);

  if (!fromHeader) {
    const sel = document.getElementById('standardSelect');
    if (sel) sel.value = val;
  }

  updateProgress();
}

// ══════════════════════════════════════════════════════════════════════════
// PERSISTENCE — SAVED REPORTS (localStorage)
// ══════════════════════════════════════════════════════════════════════════
// FIX: this used to be a single flat key shared by every signed-in account on
// a device, the same bug class as the old COMPANY_KEY. The original design
// dealt with that by WIPING this key on every sign-in/sign-out of a
// different user and relying on supabaseSyncOnOpen() to pull that account's
// reports back down from the cloud. That works eventually, but
// saveCurrentReport() pushes to the cloud in the background (non-blocking) -
// so switching accounts again within a few seconds of saving, before that
// background push has actually landed in Supabase, meant switching BACK
// showed the just-saved report as gone (confirmed live: saved "12 New
// street" on one account, switched away and back, and the dashboard dropped
// back from 5 jobs to 4 - the report never left the cloud, the LOCAL cache
// had just been wiped and the resync raced the still-in-flight save).
// Scoping this per-account like COMPANY_KEY removes the race entirely: each
// account reads its own key, which is never touched by another account
// switching in, so a just-saved report is there instantly with no network
// round trip needed to reappear.
const STORAGE_KEY = 'korva_saved_reports'; // legacy flat key, pre-multi-tenant - kept only for one-time migration below
const DRAFT_KEY = 'korva_draft';
let currentReportId = null;

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
                          'jobFee','jobClientPhone','jobClientEmail','jobNotes'];

function saveJobInfo() {
  JOB_INFO_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) reportData[id] = el.value;
  });
  syncAllSelectCards();
  saveDraft();
}

// The inspection type decides which Australian Standard the report follows:
// a pre-purchase inspection is reported under AS 4349.3, an inspection of
// the owner's existing home under AS 3660.2.
const INSPECTION_TYPE_STANDARD = {
  'Pre-Purchase — Timber Pest': 'AS 4349.3-2010',
  'Pre-Purchase — Combined Building & Pest': 'AS 4349.3-2010',
  'Annual — Existing Building': 'AS 3660.2-2017',
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
  const timberPest = isPrePurchaseJob() || /^AS 4349\.3/.test(reportData.standard || '');
  return timberPest ? 'Timber Pest Inspection Report' : 'Termite Inspection Report';
}

function isPrePurchaseJob() {
  const type = reportData.jobInspectionType || '';
  if (type) return /pre-purchase/i.test(type);
  return (reportData.standard || '') === 'AS 4349.3-2010';
}

function onInspectionTypeChange() {
  saveJobInfo();
  const std = INSPECTION_TYPE_STANDARD[document.getElementById('jobInspectionType').value];
  if (std && std !== reportData.standard) {
    setStandard(std);
    showToast(`Report will follow ${std}`, 'info');
  }
}

function loadJobInfo() {
  // Older reports kept the fee only on the signed agreement.
  if (!reportData.jobFee && reportData.agreement && reportData.agreement.fee) reportData.jobFee = reportData.agreement.fee;
  JOB_INFO_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el && reportData[id] !== undefined) el.value = reportData[id];
  });
  syncAllSelectCards();
}

function clearJobInfo() {
  JOB_INFO_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
    delete reportData[id];
  });
  syncAllSelectCards();
}
// Stored separately from report data, per-business, used on every report.
//
// FIX: this used to be a single flat key shared by every signed-in business on
// a device ('korva_company' with no business id in it at all). On a shared
// device - or simply the same browser the developer used while building the
// app - whichever business saved its letterhead details first (here, the
// original "Baz Pest Co" account) kept showing for every OTHER business that
// signed in afterwards on that same browser, including inside their generated
// PDF reports (getCompanyDetails() feeds the report cover/letterhead directly).
// Scoping the key by authBusiness.id gives each signed-in business its own
// independent record, so switching accounts can never leak one business's
// name/licence/phone/ABN/logo into another business's reports.
const COMPANY_KEY = 'korva_company'; // legacy flat key, pre-multi-tenant - kept only for one-time migration below

function companyStorageKey() {
  return (authBusiness && authBusiness.id) ? `korva_company_${authBusiness.id}` : COMPANY_KEY;
}

// One-time migration for accounts that already had data under the old flat
// key before this fix shipped. We only claim it for the business whose name
// matches what was actually stored there - otherwise we'd be guessing which
// business the legacy blob belongs to, and a wrong guess would just recreate
// the same cross-account leak this fix is meant to close. If nothing matches,
// the legacy blob is simply left in place, unused, which is harmless.
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

function getCompanyDetails() {
  try {
    const stored = localStorage.getItem(companyStorageKey());
    return stored ? JSON.parse(stored) : {};
  } catch(e) { return {}; }
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
}
// Reports save to localStorage first (instant) then sync to Supabase in the
// background. The app works fully offline — Supabase is backup/cloud copy.
const SUPABASE_URL  = 'https://bmjgvogxutwyeklxxeao.supabase.co';
const SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJtamd2b2d4dXR3eWVrbHh4ZWFvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0NTczMTEsImV4cCI6MjEwNTAzMzMxMX0.Ov8xGhDMuAbUcWy7zbCiS01D6QCrlhDYxza3Fzls83U';

// ── AUTH STATE ───────────────────────────────────────────────────────────
let authSession  = null;   // current Supabase session
let authUser     = null;   // current user object
let authBusiness = null;   // current business object
let pendingRecoverySession = null; // { access_token, refresh_token } from a password-reset email link, until submitted

function getAuthToken() {
  return authSession?.access_token || SUPABASE_KEY;
}

// Every call to the Worker goes through here. A phone that was locked or
// had the app in the background sleeps through the 5-minute token refresh
// below, so the sign-in is checked first, and a call refused for an
// expired sign-in is refreshed and sent once more.
// Calls without their own signal give up after this long, so a weak signal
// can't leave a button stuck on "Reading plate…" or "Sending…" for ever.
const WORKER_DEFAULT_TIMEOUT_MS = 90000;

async function workerFetch(path, init = {}) {
  await maybeRefreshAuthSession();
  let timer = null;
  let signal = init.signal;
  if (!signal) {
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), WORKER_DEFAULT_TIMEOUT_MS);
    signal = controller.signal;
  }
  const send = () => fetch(KORVA_WORKER_URL + path, {
    ...init,
    signal,
    headers: { ...init.headers, 'Authorization': 'Bearer ' + getAuthToken() },
  });
  try {
    let res = await send();
    if (res.status === 401 && authSession?.refresh_token && await refreshSession(authSession.refresh_token)) {
      res = await send();
    }
    return res;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function getAuthHeaders(extra = {}) {
  const token = getAuthToken();
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${token}`,
    ...extra,
  };
}

// ── SESSION PERSISTENCE ──────────────────────────────────────────────────
function saveSession(session) {
  try {
    localStorage.setItem('korva_session', JSON.stringify(session));
  } catch(e) {}
}

function loadSession() {
  try {
    const s = localStorage.getItem('korva_session');
    return s ? JSON.parse(s) : null;
  } catch(e) { return null; }
}

function clearSession() {
  try { localStorage.removeItem('korva_session'); } catch(e) {}
  authSession = null; authUser = null; authBusiness = null;
  resetBillingDisplay();
}

// ── BILLING / STRIPE ─────────────────────────────────────────────────────
// Talks to the new /stripe/* routes on the same Worker that already proxies
// AI calls (see korva-worker-with-stripe.js). NOT live until that Worker
// version is deployed and real Stripe keys/price IDs are configured — until
// then these calls will fail gracefully and the UI explains why instead of
// breaking silently.
const KORVA_WORKER_URL = 'https://korva.byronguyatt2.workers.dev';
let billingStatusCache = null;
// Where "contact us" points, everywhere in the app.
const SUPPORT_EMAIL = 'sayon.application@gmail.com';

function resetBillingDisplay() {
  const el = document.getElementById('billingStatusText');
  if (el) el.textContent = 'Sign in to see your plan.';
  const manageBtn = document.getElementById('manageBillingBtn');
  if (manageBtn) manageBtn.style.display = 'none';
  billingStatusCache = null;
}

// A real job takes 8 to 20 fills (the pricing doc's measurement); plans are
// sized at 20 so a busy job never comes up short.
const FILLS_PER_INSPECTION = 20;

// "12 of 800 AI fills used this month, about 39 inspections left. They come
// back on 1 Dec." The Worker starts a new count each calendar month (UTC).
// A trial ends before its count matters, so it doesn't say when they come back.
function billingUsageText(sub, trial) {
  const used = sub.ai_calls_used_this_period ?? 0;
  const limit = sub.limit;
  const period = trial ? '' : ' this month';
  if (!limit) return `${used} AI fills used${period}.`;
  const left = Math.max(0, limit - used);
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const when = next.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  const inspections = Math.floor(left / FILLS_PER_INSPECTION);
  const leftText = left === 0 ? 'none left' : `about ${inspections} inspection${inspections === 1 ? '' : 's'} left`;
  return `${used} of ${limit} AI fills used${period}, ${leftText}.` + (trial ? '' : ` They come back on ${when}.`);
}

async function loadBillingStatus() {
  const el = document.getElementById('billingStatusText');
  const manageBtn = document.getElementById('manageBillingBtn');
  if (!authUser) return;
  const forUser = authUser.id;
  if (el) el.textContent = 'Loading…';
  if (manageBtn) manageBtn.style.display = 'none';
  try {
    const res = await workerFetch('/stripe/subscription-status', { method: 'GET' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const sub = await res.json();
    // Signed out, or into another account, while this was loading.
    if (!authUser || authUser.id !== forUser) return;
    billingStatusCache = sub;
    const planLabel = planDisplayLabel(sub.plan);
    if (el) el.textContent = billingStatusLine(sub, planLabel);
    const owner = !authBusiness || isBusinessOwner();
    if (manageBtn) manageBtn.style.display = sub.stripe_customer_id && owner ? '' : 'none';
    showPlanOptions(sub, owner);
    markCurrentPlan(sub);
    renderProfileMenu();
    return sub;
  } catch (e) {
    if (!authUser || authUser.id !== forUser) return;
    // Say which it is: no signal, an account still being set up, or a
    // failure to try again, never "billing isn't set up".
    const status = parseInt((String(e.message).match(/HTTP (\d+)/) || [])[1], 10);
    if (el) el.textContent = !navigator.onLine ? 'No signal, so your plan can\'t be checked right now. It still works offline.'
      : status === 403 ? 'Your account is still being set up. Close SAYON and open it again'
      : 'Couldn\'t load your plan. Close this panel and open Billing again';
    console.warn('loadBillingStatus failed:', e.message);
  }
}

// Display name for a stored plan key. The stored key (trial/starter/pro/business)
// never changes; only what we show for it does.
function planDisplayLabel(plan) {
  if (plan === 'starter') return 'Solo';
  if (plan === 'pro') return 'Team';
  if (!plan) return 'Trial';
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

// The one line under Current Plan, for each state the plan can be in.
function billingStatusLine(sub, planLabel) {
  const when = iso => iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '';
  if (sub.status === 'trialing') {
    const daysLeft = sub.trial_ends_at ? Math.max(0, Math.ceil((new Date(sub.trial_ends_at) - Date.now()) / 86400000)) : null;
    if (daysLeft === 0) return 'Your free trial has ended. Choose a plan below to keep using AI fills; your reports and notes are all still here.';
    return `Free trial${daysLeft !== null ? `, ${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : ''}. ${billingUsageText(sub, true)}`;
  }
  if (sub.status === 'past_due') return `${planLabel} plan, but the last payment failed. Update your card in Manage${sub.current_period_end ? ` before ${when(sub.current_period_end)}` : ''} or AI fills stop.`;
  if (sub.status === 'canceled' || sub.status === 'cancelled') return `Your ${planLabel} plan has ended. Choose a plan below to keep using AI fills; your reports stay in your account either way.`;
  if (sub.cancel_at_period_end && sub.current_period_end) return `${planLabel} plan, ending on ${when(sub.current_period_end)}. ${billingUsageText(sub)}`;
  return `${planLabel} plan${sub.per_seat ? ` for ${sub.seats} inspector${sub.seats === 1 ? '' : 's'}` : ''}. ${billingUsageText(sub)}`;
}

// Team and Business are charged per inspector. They're offered only once
// the Worker says it can charge that way (seat_plans), and only the owner
// sees the plans to choose from.
const SEAT_PLANS = {
  pro: { input: 'seatsPro', total: 'seatTotalPro', min: 2, max: 9, perMonth: 79, yearly: false },
  business: { input: 'seatsBusiness', total: 'seatTotalBusiness', min: 10, max: 200, perMonth: 69, yearly: true },
};

function showPlanOptions(sub, owner) {
  const seatPlans = !!(sub && sub.seat_plans);
  document.querySelectorAll('#billingPanel [data-plan]').forEach(row => {
    row.hidden = !owner || (row.hasAttribute('data-seat-plan') && !seatPlans);
  });
  document.getElementById('billingOwnerOnly').hidden = owner;
  // Prices, cancelling and paying are the owner's business, not a technician's.
  document.getElementById('billingTermsRow').hidden = !owner;
  document.getElementById('seatPlansSoon').hidden = seatPlans || !owner;
  document.getElementById('billingSeatTerms').hidden = !seatPlans || !owner;
  Object.keys(SEAT_PLANS).forEach(plan => {
    const input = document.getElementById(SEAT_PLANS[plan].input);
    // The current plan's row starts at the places already paid for.
    if (input && sub && sub.plan === plan && sub.per_seat) input.value = sub.seats;
    onSeatInput(plan);
  });
}

// The number typed, kept inside the plan's range.
function seatInputValue(plan) {
  const cfg = SEAT_PLANS[plan];
  const n = parseInt(document.getElementById(cfg.input).value, 10);
  return Number.isFinite(n) ? Math.min(cfg.max, Math.max(cfg.min, n)) : cfg.min;
}

function onSeatInput(plan) {
  const cfg = SEAT_PLANS[plan];
  const n = seatInputValue(plan);
  const total = document.getElementById(cfg.total);
  if (total) total.textContent = planPriceText(plan, n);
  const sub = billingStatusCache;
  // On the current plan the button saves a new number of places.
  if (sub && sub.plan === plan && sub.per_seat && ['active', 'past_due'].includes(sub.status)) {
    const row = document.querySelector(`#billingPanel [data-plan="${plan}"]`);
    const btn = row && row.querySelector('button');
    if (btn) {
      const changed = n !== sub.seats;
      btn.textContent = changed ? `Change to ${n}` : 'Current plan';
      btn.disabled = !changed;
    }
  }
}

function choosePlan(plan) {
  const sub = billingStatusCache;
  if (SEAT_PLANS[plan] && sub && sub.plan === plan && sub.per_seat && ['active', 'past_due'].includes(sub.status)) {
    updateSeats(seatInputValue(plan));
    return;
  }
  const seats = SEAT_PLANS[plan] ? seatInputValue(plan) : undefined;
  const paying = sub && sub.plan && sub.plan !== 'trial' && sub.subscribed && ['active', 'past_due'].includes(sub.status);
  if (paying && !confirm(`Switch to ${planDisplayLabel(plan)}${seats ? ` for ${seats} inspectors` : ''} at ${planPriceText(plan, seats)}? It's charged now, less the unused part of your current plan, and only happens if the payment goes through.`)) return;
  openCheckout(plan, seats);
}

// "$316 a month" / "$9,936 a year" for a plan and number of inspectors.
function planPriceText(plan, seats) {
  const money = v => '$' + v.toLocaleString('en-AU');
  const cfg = SEAT_PLANS[plan];
  if (!cfg) return '$89 a month';
  return cfg.yearly ? `${money(seats * cfg.perMonth * 12)} a year` : `${money(seats * cfg.perMonth)} a month`;
}

let seatChangeInFlight = false;
async function updateSeats(seats) {
  const sub = billingStatusCache;
  if (!sub || seatChangeInFlight) return;
  const more = seats > sub.seats;
  const ask = more
    ? `Pay for ${seats} inspectors instead of ${sub.seats} (${planPriceText(sub.plan, seats)})? The extra places are charged now for the rest of what you've paid for.`
    : `Pay for ${seats} inspectors instead of ${sub.seats} (${planPriceText(sub.plan, seats)})? The unused part comes off your next bill.`;
  if (!confirm(ask)) return;
  seatChangeInFlight = true;
  try {
    const res = await workerFetch('/stripe/update-seats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seats }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(data.message || 'Couldn\'t change your places. Try again', 'error'); return; }
    showToast(`You now pay for ${seats} inspectors`, 'success');
    track('seats_changed', { plan: sub.plan, seats });
    await loadBillingStatus();
  } catch (e) {
    showToast('Couldn\'t change your places. Check your signal and try again', 'error');
  } finally {
    seatChangeInFlight = false;
  }
}

// The plan list says which row is the current plan, and the other buttons
// read Switch rather than Upgrade for someone already paying.
function markCurrentPlan(sub) {
  const paying = sub && sub.plan && sub.plan !== 'trial' && ['active', 'past_due'].includes(sub.status);
  document.querySelectorAll('#billingPanel [data-plan]').forEach(row => {
    const btn = row.querySelector('button');
    const current = paying && row.dataset.plan === sub.plan;
    row.classList.toggle('current-plan', current);
    if (btn) btn.textContent = current ? 'Current plan' : paying ? 'Switch' : 'Upgrade';
    if (btn) btn.disabled = !!current;
    // A per-inspector plan's own row can still change its number of places.
    if (current && SEAT_PLANS[sub.plan] && sub.per_seat) onSeatInput(sub.plan);
  });
}

// Back from Stripe Checkout: the webhook that records the payment can land
// a few seconds after the redirect. Until it does, the panel would still
// offer Upgrade, and a second tap could start a second subscription.
async function confirmBillingAfterCheckout() {
  const el = document.getElementById('billingStatusText');
  if (el) el.textContent = 'Confirming your payment…';
  for (let i = 0; i < 10; i++) {
    const sub = await loadBillingStatus();
    if (sub && (sub.status !== 'trialing' || sub.subscribed)) { showToast('Subscription updated — thanks!', 'success'); return; }
    if (el && i < 9) el.textContent = 'Confirming your payment…';
    await new Promise(r => setTimeout(r, 2000));
  }
  showToast('Payment received. Your plan shows here once Stripe confirms it, usually within a minute', 'info');
}

// Strips any existing query string / hash and attaches a `billing=` marker
// so handleBillingReturn() can tell, on the way back from Stripe, whether
// checkout succeeded or was cancelled and react accordingly.
function billingReturnUrl(marker) {
  return window.location.origin + window.location.pathname + '?billing=' + marker;
}

// One checkout at a time: two quick taps used to start two Stripe
// customers for the same business.
let checkoutInFlight = false;

async function openCheckout(plan, seats) {
  if (!authUser) { showToast('Sign in first', 'error'); return; }
  if (checkoutInFlight) return;
  checkoutInFlight = true;
  track('checkout_opened', { plan, seats });
  let status = 0;
  try {
    const res = await workerFetch('/stripe/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan,
        seats,
        successUrl: billingReturnUrl('success'),
        cancelUrl: billingReturnUrl('cancelled'),
      }),
    });
    status = res.status;
    const rawBody = await res.text();
    let data;
    try { data = JSON.parse(rawBody); } catch { throw new Error(rawBody.slice(0, 200) || `HTTP ${res.status}`); }
    // Already paying: the Worker switched the plan without leaving the app.
    if (res.ok && data.switched) {
      showToast(`You're now on ${planDisplayLabel(data.plan || plan)}`, 'success');
      await loadBillingStatus();
      return;
    }
    if (!res.ok || !data.url) throw new Error(data && data.message || rawBody || `HTTP ${res.status}`);
    window.location.href = data.url;
  } catch (e) {
    // 400, 402 and 409 carry a reason worth reading: the number of
    // inspectors, a declined card, or a team too big for the plan.
    showToast(status === 403
      ? 'Only the business owner can change the plan.'
      : (status === 400 || status === 402 || status === 409) && e.message ? e.message
      : 'Couldn\'t open checkout. Check your signal and try again.', 'error');
    console.warn('openCheckout failed:', e.message);
  } finally {
    // Leaving for Stripe keeps the lock on, so a tap during the redirect
    // does nothing.
    setTimeout(() => { checkoutInFlight = false; }, 3000);
  }
}

// Called once on app entry — notices if we've just been bounced back from
// a Stripe Checkout or Billing Portal redirect (see billingReturnUrl above)
// and reacts: toast + refresh the plan display, then scrubs the marker out
// of the URL so refreshing the page doesn't re-show the toast.
function handleBillingReturn() {
  try {
    const params = new URLSearchParams(window.location.search);
    const billing = params.get('billing');
    if (!billing) return;

    if (billing === 'success') {
      confirmBillingAfterCheckout();
    } else if (billing === 'cancelled') {
      showToast('Checkout cancelled — no changes made', 'info');
    } else if (billing === 'updated') {
      loadBillingStatus();
    }

    params.delete('billing');
    const newSearch = params.toString();
    history.replaceState(null, '', window.location.pathname + (newSearch ? '?' + newSearch : '') + window.location.hash);
  } catch (e) {
    console.warn('handleBillingReturn error:', e.message);
  }
}

async function openBillingPortal() {
  if (!authUser) { showToast('Sign in first', 'error'); return; }
  try {
    const res = await workerFetch('/stripe/create-portal-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnUrl: billingReturnUrl('updated') }),
    });
    const rawBody = await res.text();
    let data;
    try { data = JSON.parse(rawBody); } catch { throw new Error(rawBody.slice(0, 200) || `HTTP ${res.status}`); }
    if (!res.ok || !data.url) throw new Error(data && data.message || rawBody || `HTTP ${res.status}`);
    window.location.href = data.url;
  } catch (e) {
    showToast('Could not open billing portal — try again shortly.', 'error');
    console.warn('openBillingPortal failed:', e.message);
  }
}

// ── AUTH API CALLS ───────────────────────────────────────────────────────
async function supabaseAuth(endpoint, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
    body: JSON.stringify(body),
  });
  // Supabase itself being down is not a refusal: callers treat a thrown
  // error like no signal and keep the saved sign-in.
  if (res.status >= 500) throw new Error(`Supabase auth HTTP ${res.status}`);
  const data = await res.json().catch(() => ({}));
  // FIX: callers (signIn/signUp) were written against the older OAuth2-style
  // error shape ({error: {message: '...'}}) and checked `if (data.error)`.
  // Supabase Auth's current API returns failures as {code, error_code, msg}
  // instead - there is no `.error` property at all - so a wrong password or
  // nonexistent account was falling through the `if (data.error)` check as
  // if it were a successful login, then crashing on `data.user.id` (data.user
  // is undefined on an error response), which got caught by the generic
  // try/catch and mislabeled as "Network error — please try again." Every
  // failed sign-in hit this, 100% reproducibly, regardless of connectivity.
  // Normalizing here means every existing `data.error` / `data.error.message`
  // check downstream keeps working, whichever shape Supabase actually sent.
  // The older OAuth2 shape sends `error` as a plain string code.
  if (!res.ok && (!data.error || typeof data.error === 'string')) {
    data.error = {
      code: data.error_code || (typeof data.error === 'string' ? data.error : null),
      message: data.msg || data.error_description || 'Request failed',
    };
  }
  return data;
}

// ── PASSWORD RESET (via emailed recovery link) ───────────────────────────
// Supabase's "forgot password" email links back to this app with
// #access_token=...&refresh_token=...&type=recovery in the URL hash. Read it
// once at boot, then let the user set a new password with it.
function parseRecoveryHash() {
  const hash = window.location.hash || '';
  if (!hash || hash.indexOf('type=recovery') === -1) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const access_token = params.get('access_token');
  if (!access_token) return null;
  return { access_token, refresh_token: params.get('refresh_token') || null };
}

async function submitPasswordReset() {
  const pw     = document.getElementById('rpPassword').value;
  const pw2    = document.getElementById('rpPasswordConfirm').value;
  const errEl  = document.getElementById('rpError');
  const btn    = document.getElementById('rpBtn');

  errEl.textContent = '';
  if (!pw || pw.length < 8) { errEl.textContent = 'Password must be at least 8 characters.'; return; }
  if (pw !== pw2) { errEl.textContent = 'Passwords do not match.'; return; }
  if (!pendingRecoverySession?.access_token) {
    errEl.textContent = 'This reset link has expired — please request a new one.';
    return;
  }

  btn.disabled = true; btn.textContent = 'Updating…';
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${pendingRecoverySession.access_token}`,
      },
      body: JSON.stringify({ password: pw }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      errEl.textContent = data.msg || data.error_description || data.error?.message || 'Could not update password — the link may have expired.';
      return;
    }
    pendingRecoverySession = null;
    document.getElementById('rpPassword').value = '';
    document.getElementById('rpPasswordConfirm').value = '';
    showAuth('authSignIn');
    showToast('Password updated — sign in with your new password', 'success');
  } catch(e) {
    errEl.textContent = 'Couldn\'t reach SAYON. Check your signal and try again.';
  } finally {
    btn.disabled = false; btn.textContent = 'Update password';
  }
}

// True when the last refresh never reached Supabase (no signal), as opposed
// to Supabase refusing the refresh token.
let lastRefreshWasOffline = false;

async function refreshSession(refreshToken) {
  lastRefreshWasOffline = false;
  try {
    const data = await supabaseAuth('token?grant_type=refresh_token', { refresh_token: refreshToken });
    if (data.access_token) {
      authSession = data;
      saveSession(data);
      return true;
    }
  } catch(e) { lastRefreshWasOffline = true; }
  return false;
}

// ── BACKGROUND AUTH REFRESH ──────────────────────────────────────────────
// Supabase access tokens are short-lived (~1hr). Inspectors often keep the
// app open for an entire job (or a full day in the field) without ever
// reloading it, which previously meant the token would silently expire
// mid-session and every Supabase call would start failing with no retry.
// This keeps the session alive proactively so that never happens.
let authAutoRefreshTimer = null;
const AUTH_AUTO_REFRESH_CHECK_MS = 5 * 60 * 1000;   // re-check every 5 minutes
const AUTH_REFRESH_LEAD_SECONDS  = 10 * 60;         // refresh once within 10 min of expiry

let authRefreshInFlight = null; // shared, so callers at the same moment refresh once

async function maybeRefreshAuthSession() {
  if (!authSession?.refresh_token) return;
  const exp = authSession.expires_at || 0;
  const now = Math.floor(Date.now() / 1000);
  if (now > exp - AUTH_REFRESH_LEAD_SECONDS) {
    authRefreshInFlight ||= refreshSession(authSession.refresh_token).finally(() => { authRefreshInFlight = null; });
    await authRefreshInFlight;
  }
}

function startAuthAutoRefresh() {
  stopAuthAutoRefresh();
  authAutoRefreshTimer = setInterval(maybeRefreshAuthSession, AUTH_AUTO_REFRESH_CHECK_MS);
}

function stopAuthAutoRefresh() {
  if (authAutoRefreshTimer) { clearInterval(authAutoRefreshTimer); authAutoRefreshTimer = null; }
}

// ── SIGN UP ──────────────────────────────────────────────────────────────
// The Terms and Privacy versions a new account agrees to at sign-up. Raise
// these with the "Version N" lines at the top of terms.html and privacy.html.
const LEGAL_VERSIONS = { terms: 3, privacy: 6 };

async function signUp() {
  const name     = document.getElementById('suName').value.trim();
  const business = document.getElementById('suBusiness').value.trim();
  const email    = document.getElementById('suEmail').value.trim();
  const password = document.getElementById('suPassword').value;
  const errEl    = document.getElementById('suError');
  const btn      = document.getElementById('suBtn');

  errEl.textContent = '';
  // Joining from an invite link: the business is theirs to join, not to name.
  const joining = document.getElementById('suBusinessField').hidden;
  const missing = [!name && 'your name', !business && !joining && 'your business name', !email && 'your email', !password && 'a password'].filter(Boolean);
  if (missing.length) { errEl.textContent = `Add ${joinWithAnd(missing)}.`; return; }
  if (!document.getElementById('suConsent').checked) { errEl.textContent = 'Tick the box to agree to the Terms of Service and Privacy Policy.'; return; }
  // Receipts and password resets go to this address, so a typo locks the
  // account out of both.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { errEl.textContent = 'That email address doesn\'t look right. Check it: your receipts and password resets go there.'; return; }
  if (password.length < 8) { errEl.textContent = 'Password must be at least 8 characters.'; return; }

  btn.disabled = true; btn.textContent = 'Creating account…';
  try {
    // Store business name locally — survives the email confirmation redirect
    if (!joining) localStorage.setItem('korva_pending_business', business);

    const data = await supabaseAuth('signup', {
      email, password,
      // Which Terms and Privacy versions they ticked, and when, kept with the login.
      data: Object.assign(joining ? { name } : { name, business_name: business },
        { terms_version: LEGAL_VERSIONS.terms, privacy_version: LEGAL_VERSIONS.privacy, terms_accepted_at: new Date().toISOString() }),
    });
    if (data.error) {
      if (data.error.code === 'user_already_exists' || /already (registered|exists)/i.test(data.error.message || '')) {
        errEl.innerHTML = 'There\'s already a SAYON account for this email. <button type="button" class="auth-inline-link" onclick="signInAs(document.getElementById(\'suEmail\').value)">Sign in</button> or <button type="button" class="auth-inline-link" onclick="showAuth(\'authForgot\')">reset the password</button>.';
        return;
      }
      errEl.textContent = data.error.code === 'weak_password' ? 'That password is too easy to guess. Try a longer one.' : (data.error.message || 'Couldn\'t create the account. Try again.');
      return;
    }

    if (data.access_token) {
      // Email confirmation is disabled on this project, so Supabase already handed back
      // a working session — log the new user straight in instead of telling them to check
      // an email that will never need to arrive.
      authSession = data;
      authUser    = data.user;
      saveSession(data);
      localStorage.setItem('korva_last_user_id', data.user.id);
      telemetryIdentify(data.user.id);
      track('signed_up');

      await loadBusiness();
      startAuthAutoRefresh();
      enterApp();
      return;
    }

    // Fallback for if email confirmation is ever turned back on for this project —
    // Supabase then returns a user with no session until the confirmation link is clicked.
    document.getElementById('authConfirmEmail').textContent = email;
    showAuth('authConfirm');
  } catch(e) {
    errEl.textContent = 'Couldn\'t reach SAYON. Check your signal and try again.';
  } finally {
    btn.disabled = false; btn.textContent = 'Create account';
  }
}

// Back to the sign-in card with the email already typed.
function signInAs(email) {
  const el = document.getElementById('siEmail');
  if (el && email) el.value = email.trim();
  showAuth('authSignIn');
}

// ── SIGN IN ──────────────────────────────────────────────────────────────
async function signIn() {
  const email    = document.getElementById('siEmail').value.trim();
  const password = document.getElementById('siPassword').value;
  const errEl    = document.getElementById('siError');
  const btn      = document.getElementById('siBtn');

  errEl.textContent = '';
  if (!email || !password) { errEl.textContent = !email && !password ? 'Enter your email and password.' : !email ? 'Enter your email.' : 'Enter your password.'; return; }

  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const data = await supabaseAuth('token?grant_type=password', { email, password });
    if (data.error) {
      // Branch on the stable error code, not the message text, which Supabase
      // can reword between API versions (see supabaseAuth()'s normalization).
      errEl.textContent = data.error.code === 'invalid_credentials' || data.error.message === 'Invalid login credentials'
        ? 'That email and password don\'t match. Check them, or tap Forgot password.' : (data.error.message || 'Couldn\'t sign in. Try again.');
      return;
    }
    authSession = data;
    authUser    = data.user;
    saveSession(data);
    telemetryIdentify(data.user.id);
    track('signed_in');

    // Saved reports are now scoped per-account (reportsStorageKey()), so a
    // different user signing in on this device simply reads their OWN key -
    // nothing to wipe here any more. An in-progress unsaved draft is still
    // cleared, since that one genuinely shouldn't follow a different account.
    const prevUserId = localStorage.getItem('korva_last_user_id');
    if (prevUserId && prevUserId !== data.user.id) {
      localStorage.removeItem(DRAFT_KEY);
    }
    localStorage.setItem('korva_last_user_id', data.user.id);

    await loadBusiness();
    startAuthAutoRefresh();
    enterApp();
  } catch(e) {
    errEl.textContent = 'Couldn\'t reach SAYON. Check your signal and try again.';
  } finally {
    btn.disabled = false; btn.textContent = 'Sign in';
  }
}

// ── FORGOT PASSWORD ──────────────────────────────────────────────────────
async function forgotPassword() {
  const email = document.getElementById('fpEmail').value.trim();
  const errEl = document.getElementById('fpError');
  const btn   = document.getElementById('fpBtn');

  errEl.textContent = '';
  errEl.style.color = '';
  if (!email) { errEl.textContent = 'Enter the email you signed up with.'; return; }

  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    // Send the reset link back to wherever this app is currently being served
    // from, so clicking it in the user's email returns them straight to the
    // in-app "set a new password" screen instead of a dead end.
    const redirectTo = encodeURIComponent(window.location.origin + window.location.pathname);
    const res = await fetch(`${SUPABASE_URL}/auth/v1/recover?redirect_to=${redirectTo}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      errEl.textContent = res.status === 429
        ? 'Too many reset requests. Wait a few minutes and try again.'
        : 'Could not send the reset link. Please try again.';
      return;
    }
    errEl.style.color = 'var(--green)';
    errEl.textContent = 'Reset link sent. Check your email, including junk.';
  } catch(e) {
    errEl.textContent = 'Couldn\'t reach SAYON. Check your signal and try again.';
  } finally {
    btn.disabled = false; btn.textContent = 'Send reset link';
  }
}

// ── SIGN OUT ─────────────────────────────────────────────────────────────
// Client details, signatures and photos leave the phone with the account, so
// a shared or lost phone doesn't hold them. Everything is backed up to the
// account first; signing back in restores the reports from there (see
// supabaseSyncOnOpen) and photos download again as they're viewed. If the
// backup can't finish (no signal), the inspector chooses whether to wait.
async function signOut() {
  if (authSession) {
    saveOpenReportNow();
    const reports = getSavedReports();
    let failed = 0;
    if (reports.length) showToast('Backing up your reports before signing out…', 'info');
    for (const entry of reports) {
      const ok = await supabaseSave(entry, true);
      if (!ok || allReportPhotos(entry.reportData).some(p => !p.path)) failed++;
    }
    const unsaved = !currentReportId && hasReportContent(reportData);
    if (failed || unsaved) {
      const lost = [
        failed ? `${failed} saved report${failed === 1 ? '' : 's'} couldn't be backed up (no signal?)` : '',
        unsaved ? 'The open report hasn\'t been saved' : '',
      ].filter(Boolean).join('. ');
      if (!confirm(`${lost}.\n\nSigning out removes reports from this phone. Sign out anyway and lose them?`)) {
        showToast('Still signed in. Your reports are safe on this phone', 'info');
        return;
      }
    }
  }
  try {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${getAuthToken()}` },
    });
  } catch(e) {}
  await endSessionOnDevice();
}

// Clears the session and every report, quote, draft and photo from this
// phone, then shows the sign-in screen.
async function endSessionOnDevice() {
  const reportsKey = reportsStorageKey(), quotesKey = quotesStorageKey();
  telemetrySignedOut();
  stopAuthAutoRefresh();
  clearSession();
  localStorage.removeItem('korva_last_user_id');
  localStorage.removeItem(BUSINESS_CACHE_KEY);
  [reportsKey, quotesKey, DRAFT_KEY].forEach(k => localStorage.removeItem(k));
  try { await photoStoreRequest('readwrite', st => st.clear()); } catch (e) {}
  currentReportId = null;
  if (appInitialised) {
    resetReportState();
    ['jobAddress','jobSuburb','jobState','jobPostcode','jobClient','jobInspector'].forEach(id => { document.getElementById(id).value = ''; });
    updateJob();
    renderSavedList();
  }
  document.getElementById('mainMenu').style.display  = 'none';
  document.getElementById('app').style.display       = 'none';
  document.getElementById('authScreen').style.display = 'flex';
  showAuth('authSignIn');
}

// ── DELETE MY ACCOUNT ────────────────────────────────────────────────────
// Permanently deletes the signed-in user's account and everything stored
// against it (see supabase/delete-account.sql). The database checks run
// first, so nothing is removed if the account can't be deleted yet. Photos
// go next, through the storage API, then the account itself, then this
// phone's copy.
const DELETE_ACCOUNT_BLOCKERS = {
  ACTIVE_SUBSCRIPTION: 'Your plan is still active. Cancel it in Menu › Billing › Manage first, then delete your account.',
  HAS_TEAM: 'Other people are still on your team. Remove them in Menu › Your team first, then delete your account.',
};

async function deleteAccountRpc(dryRun) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/delete_my_account`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ dry_run: dryRun }),
  });
  if (res.ok) return null;
  const err = await res.json().catch(() => ({}));
  const code = Object.keys(DELETE_ACCOUNT_BLOCKERS).find(k => (err.message || '').includes(k));
  return code ? DELETE_ACCOUNT_BLOCKERS[code] : 'Could not delete your account. Check your connection and try again.';
}

async function deleteMyPhotos() {
  await deleteMyFiles(PHOTO_BUCKET);
  // The PDFs behind client links: <user id>/<link folder>/<file>.pdf.
  await deleteMyFiles(CLIENT_DOCS_BUCKET, true);
}

// Deletes everything under <user id>/ in a bucket, through the storage
// policies. With nested, each folder under it is emptied too.
async function deleteMyFiles(bucket, nested) {
  const listFolder = async prefix => {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
    });
    // The client-docs bucket may never have been set up: nothing of ours in it.
    if (nested && (res.status === 400 || res.status === 404)) return [];
    if (!res.ok) throw new Error(`list ${bucket} ` + res.status);
    return res.json();
  };
  const top = authUser.id + '/';
  const folders = nested ? (await listFolder(top)).filter(f => !f.id).map(f => top + f.name + '/') : [top];
  for (const prefix of folders) await deleteFolder(bucket, prefix, listFolder);
}

async function deleteFolder(bucket, prefix, listFolder) {
  // Bounded: if a delete ever reports success but removes nothing, the
  // same files would be listed again and this would never finish.
  for (let round = 0; round < 50; round++) {
    const files = (await listFolder(prefix)).filter(f => f.id).map(f => prefix + f.name);
    if (!files.length) return;
    const del = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      body: JSON.stringify({ prefixes: files }),
    });
    if (!del.ok) throw new Error(`delete ${bucket} ` + del.status);
    const removed = await del.json().catch(() => null);
    if (Array.isArray(removed) && removed.length === 0) throw new Error(`delete ${bucket} removed nothing`);
  }
  throw new Error(`delete ${bucket} did not finish`);
}

async function deleteMyAccount() {
  if (!authSession || !authUser) { showToast('Sign in to delete your account', 'error'); return; }
  if (!navigator.onLine) { showToast('You need signal to delete your account', 'error'); return; }
  const typed = prompt(
    'This permanently deletes your SAYON account, every saved report and photo, ' +
    (authBusiness && authBusiness.owner_id === authUser.id ? 'your business details, ' : '') +
    'and everything on this phone. It cannot be undone.\n\nExport your data first if you want a copy.\n\nType DELETE to confirm.');
  if (typed === null) return;
  if (typed.trim().toUpperCase() !== 'DELETE') { showToast('Not deleted. Type DELETE to confirm', 'info'); return; }
  showToast('Deleting your account…', 'info');
  try {
    const blocked = await deleteAccountRpc(true);
    if (blocked) { showToast(blocked, 'error'); return; }
    await deleteMyPhotos();
    const failed = await deleteAccountRpc(false);
    if (failed) { showToast(failed, 'error'); return; }
  } catch (e) {
    console.warn('deleteMyAccount:', e);
    showToast('Could not delete your account. Check your connection and try again.', 'error');
    return;
  }
  await endSessionOnDevice();
  showToast('Your account and data have been deleted', 'info');
}

// Makes sure the current user has a team_members row for authBusiness.
// Needed because older accounts could end up with a business but no
// team_members row (e.g. the insert silently failed before the RLS fix).
// Safe to call repeatedly — it's a no-op once the row exists.
async function ensureOwnerTeamMember() {
  try {
    const chk = await fetch(
      `${SUPABASE_URL}/rest/v1/team_members?business_id=eq.${authBusiness.id}&user_id=eq.${authUser.id}&limit=1`,
      { headers: getAuthHeaders() }
    );
    if (!chk.ok) return;
    const rows = await chk.json();
    if (rows.length > 0) return; // already there
    const meta = authUser.user_metadata || {};
    await fetch(`${SUPABASE_URL}/rest/v1/team_members`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        business_id: authBusiness.id,
        user_id: authUser.id,
        role: 'owner',
        name: meta.name || authUser.email,
        email: authUser.email,
      }),
    });
  } catch(e) { console.warn('ensureOwnerTeamMember error:', e); }
}

// The secret from an invite link, kept until sign-in uses it (it has to
// survive the sign-up and any reload in between).
const PENDING_INVITE_KEY = 'korva_pending_invite';

function pendingInviteToken() {
  try { return localStorage.getItem(PENDING_INVITE_KEY) || ''; } catch (e) { return ''; }
}
function clearPendingInvite() {
  try { localStorage.removeItem(PENDING_INVITE_KEY); } catch (e) {}
}

// With an invite link's secret on this phone: the business id once they've
// joined it, null when there's nothing to join (carry on and make their own
// business), or false when it can't be settled now (no signal, or no free
// place yet), so no business of their own is made and the next sign-in
// tries again.
async function acceptTeamInvite() {
  const token = pendingInviteToken();
  if (!token) return null;
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/accept_invite`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ p_token: token }) });
  } catch (e) {
    console.warn('acceptTeamInvite failed:', e);
    return false;
  }
  if (res.ok) {
    const id = await res.json().catch(() => null);
    clearPendingInvite();
    if (typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)) return id;
    showToast('That invite link didn\'t work for this account (it may have expired or been replaced), so you have an account of your own. Email SAYON if you should be on their team', 'info');
    return null;
  }
  const err = await res.json().catch(() => ({}));
  if (/NO_SEATS/.test(err.message || '')) {
    showToast('The business that invited you has no free inspector place right now. Ask them to add one, then open SAYON again', 'info');
    return false;
  }
  if (res.status >= 500) return false;
  // Anything else (the database not set up for teams yet): carry on as before.
  clearPendingInvite();
  return null;
}

// ── YOUR TEAM ────────────────────────────────────────────────────────────
// The owner invites inspectors by email and sends them a sign-up link. On
// Team and Business each person takes one paid inspector place, the owner
// included; a pending invite holds one too. The database does the counting
// (invite_member and accept_invite in supabase/team-seats.sql); this page
// shows it and the Worker refuses fewer places than people.

// Must match business_seat_cap() in supabase/team-seats.sql.
function teamPlaceCap(sub) {
  if (!sub) return null;
  if (sub.status === 'canceled' || sub.status === 'cancelled') return 0;
  if (sub.plan === 'trial') return 3;
  if (sub.plan === 'starter') return 1;
  return Math.max(1, sub.seats || 1);
}

let teamCache = { members: [], invites: [] };

async function loadTeam() {
  const list = document.getElementById('teamList');
  const placesEl = document.getElementById('teamPlacesText');
  if (!authBusiness || !isBusinessOwner()) {
    placesEl.textContent = 'Your business owner looks after the team.';
    list.innerHTML = '';
    return;
  }
  placesEl.textContent = 'Loading…';
  try {
    const [mRes, iRes, sub] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/team_members?business_id=eq.${authBusiness.id}&select=user_id,role,name,email&order=joined_at.asc`, { headers: getAuthHeaders() }),
      fetch(`${SUPABASE_URL}/rest/v1/invites?business_id=eq.${authBusiness.id}&status=eq.pending&select=id,email&order=created_at.asc`, { headers: getAuthHeaders() }),
      billingStatusCache ? Promise.resolve(billingStatusCache) : loadBillingStatus(),
    ]);
    if (!mRes.ok || !iRes.ok) throw new Error('HTTP ' + (mRes.ok ? iRes.status : mRes.status));
    teamCache = { members: await mRes.json(), invites: await iRes.json() };
    renderTeam(sub);
  } catch (e) {
    console.warn('loadTeam failed:', e.message);
    placesEl.textContent = navigator.onLine ? 'Couldn\'t load your team. Close this page and open it again' : 'Your team loads when you have signal.';
  }
}

function renderTeam(sub) {
  const { members, invites } = teamCache;
  const cap = teamPlaceCap(sub);
  const taken = members.length + invites.length;
  const placesEl = document.getElementById('teamPlacesText');
  const plan = sub ? planDisplayLabel(sub.plan) : '';
  if (cap === null) placesEl.textContent = `${taken} on your team.`;
  else if (sub.plan === 'starter') placesEl.textContent = 'Solo is for one inspector. To add inspectors, move to Team in Billing.';
  else if (sub.plan === 'trial') placesEl.textContent = `${taken} of ${cap} places used. The free trial lets you try SAYON with up to ${cap} people; Team takes up to 9.`;
  else placesEl.textContent = `${taken} of ${cap} inspector places used on your ${plan} plan.`;
  const full = cap !== null && taken >= cap;
  document.getElementById('teamInviteBtn').disabled = full;
  document.getElementById('teamInviteEmail').disabled = full;
  document.getElementById('teamMorePlaces').hidden = !full;

  const rows = members.map(m => {
    const you = m.user_id === authUser.id;
    const who = escapeHtml(m.name && m.name !== m.email ? m.name : m.email || 'Inspector');
    return `<div class="team-row">
      <div class="team-row-text"><div class="team-row-name">${who}${you ? ' (you)' : ''}</div>
      <div class="team-row-sub">${escapeHtml(m.email || '')}${m.role === 'owner' ? ' · Owner' : ''}</div></div>
      ${you || m.role === 'owner' ? '' : `<button class="link-btn team-row-btn" data-id="${escapeHtml(m.user_id)}" onclick="removeTeamMember(this.dataset.id)">Remove</button>`}
    </div>`;
  });
  invites.forEach(i => {
    rows.push(`<div class="team-row team-row-pending">
      <div class="team-row-text"><div class="team-row-name">${escapeHtml(i.email)}</div>
      <div class="team-row-sub">Invited, not signed up yet</div></div>
      <button class="link-btn team-row-btn" data-id="${escapeHtml(i.id)}" onclick="shareTeamInvite(this.dataset.id)">Send link</button>
      <button class="link-btn team-row-btn" data-id="${escapeHtml(i.id)}" onclick="cancelTeamInvite(this.dataset.id)">Cancel</button>
    </div>`);
  });
  document.getElementById('teamList').innerHTML = rows.join('');
}

async function inviteTeamMember() {
  const input = document.getElementById('teamInviteEmail');
  const email = input.value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { showToast('That email address doesn\'t look right', 'error'); input.focus(); return; }
  const btn = document.getElementById('teamInviteBtn');
  btn.disabled = true;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/invite_member`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ p_email: email }) });
    const answer = res.ok ? await res.json() : null;
    const result = answer && answer.status;
    const say = {
      invited: null,
      already_invited: 'They\'re already invited. Tap Send link to send it again',
      already_member: 'They\'re already on your team',
      no_seats: 'Every inspector place is taken. Add more in Billing first',
      bad_email: 'That email address doesn\'t look right',
      not_owner: 'Only the business owner can invite people',
    };
    if (!result || !(result in say)) { showToast('Couldn\'t send the invite. Check your signal and try again', 'error'); return; }
    if (result !== 'invited') { showToast(say[result], result === 'already_invited' ? 'info' : 'error'); return; }
    input.value = '';
    track('team_invite_sent');
    await loadTeam();
    await sendInviteLink(email, answer.token);
  } catch (e) {
    showToast('Couldn\'t send the invite. Check your signal and try again', 'error');
  } finally {
    btn.disabled = false;
    if (billingStatusCache) renderTeam(billingStatusCache);
  }
}

// The sign-up link for an invited inspector. Its secret is what lets them
// join, so it's only ever in the link the owner sends; the sign-up card
// looks up the business and email from it.
function teamInviteLink(token) {
  const u = new URL(window.location.origin + window.location.pathname);
  u.searchParams.set('signup', '1');
  u.searchParams.set('invite', token);
  return u.toString();
}

// "Send link" on a waiting invite: a fresh link (the old one stops working).
async function shareTeamInvite(inviteId) {
  const inv = teamCache.invites.find(x => x.id === inviteId);
  if (!inv) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/invite_link`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ p_invite_id: inviteId }) });
    const token = res.ok ? await res.json() : null;
    if (!token) throw new Error('HTTP ' + res.status);
    await sendInviteLink(inv.email, token);
  } catch (e) {
    showToast('Couldn\'t make a new link. Check your signal and try again', 'error');
  }
}

async function sendInviteLink(email, token) {
  const biz = getCompanyDetails().name || authBusiness?.name || 'our business';
  const link = teamInviteLink(token);
  const text = `You're invited to use SAYON with ${biz}. Sign up with ${email} here and you'll join our account. The link works for 14 days:`;
  try {
    if (navigator.share) { await navigator.share({ title: 'Join ' + biz + ' on SAYON', text, url: link }); return; }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(`${text} ${link}`);
    showToast('The sign-up link is copied: paste it into a text or email to them', 'success');
  } catch (e) {
    showToast(`Send them this sign-up link: ${link}`, 'info');
  }
}

async function removeTeamMember(userId) {
  const m = teamCache.members.find(x => x.user_id === userId);
  if (!m || userId === authUser.id) return;
  if (!confirm(`Take ${m.name || m.email} off your team? They can't use SAYON with your business after this. Their reports stay in their account.`)) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/team_members?business_id=eq.${authBusiness.id}&user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE', headers: getAuthHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    showToast('Taken off your team. That frees an inspector place; change how many you pay for in Billing', 'success');
    loadTeam();
  } catch (e) {
    showToast('Couldn\'t take them off. Check your signal and try again', 'error');
  }
}

async function cancelTeamInvite(id) {
  const i = teamCache.invites.find(x => x.id === id);
  if (!i || !confirm(`Cancel the invite for ${i.email}?`)) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/invites?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: getAuthHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    showToast('Invite cancelled', 'success');
    loadTeam();
  } catch (e) {
    showToast('Couldn\'t cancel the invite. Check your signal and try again', 'error');
  }
}

// The sign-up card, opened from an invite link (?signup=1&invite=<secret>):
// the database says which business and email the secret is for, and the
// card fills those in, so there's nothing to set up. The secret is kept for
// sign-in and taken out of the address bar.
async function applyInviteToSignUp() {
  const params = new URLSearchParams(window.location.search);
  const token = (params.get('invite') || '').trim();
  if (!/^[0-9a-f]{64}$/.test(token)) return;
  params.delete('invite');
  history.replaceState(null, '', window.location.pathname + (params.toString() ? '?' + params : '') + window.location.hash);
  try { localStorage.setItem(PENDING_INVITE_KEY, token); } catch (e) {}
  let invite = null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({ p_token: token }),
    });
    if (res.ok) invite = await res.json();
  } catch (e) { /* no signal: a plain sign-up card, and sign-in still tries the secret */ }
  const sub = document.getElementById('suSubtitle');
  if (!invite || !invite.business || !invite.email) {
    if (invite === null) clearPendingInvite();
    if (invite === null) sub.textContent = 'That invite link has expired or been replaced. Ask for a new one, or sign up as your own business.';
    return;
  }
  inviteSignUp = { business: String(invite.business).slice(0, 120), email: String(invite.email) };
  document.getElementById('suEmail').value = inviteSignUp.email;
  showInviteSignUp(true);
}

// An invite link opened on a phone that's already signed in: the link is
// for signing up, so say whose it is instead of quietly ignoring it. The
// secret isn't kept, so it can't be used by whoever is signed in.
async function noticeInviteWhileSignedIn() {
  const params = new URLSearchParams(window.location.search);
  const token = (params.get('invite') || '').trim();
  if (!token) return;
  params.delete('invite');
  params.delete('signup');
  history.replaceState(null, '', window.location.pathname + (params.toString() ? '?' + params : '') + window.location.hash);
  if (!/^[0-9a-f]{64}$/.test(token)) return;
  let invite = null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({ p_token: token }),
    });
    if (res.ok) invite = await res.json();
  } catch (e) { return; }
  const me = (authUser && authUser.email || '').toLowerCase();
  if (!invite || !invite.email) {
    showToast('That invite link has expired or been replaced. Ask for a new one.', 'info');
  } else if (String(invite.email).toLowerCase() === me) {
    showToast(`You're already signed in as ${invite.email}.`, 'info');
  } else {
    showToast(`That invite is for ${invite.email}, but you're signed in as ${authUser.email}. To use it, sign out and open the link again.`, 'error');
  }
}

// The invite's business and email while the sign-up card is joining one.
let inviteSignUp = null;

// Joining shows the business by name and hides the Business Name box. A
// different email can't use the invite, so changing it brings the box back.
function showInviteSignUp(joining) {
  const field = document.getElementById('suBusinessField');
  field.hidden = joining;
  if (joining) document.getElementById('suBusiness').value = '';
  document.getElementById('suTitle').textContent = joining ? `Join ${inviteSignUp.business} on SAYON` : 'Create your account';
  document.getElementById('suSubtitle').textContent = joining
    ? `${inviteSignUp.business} has added you. Sign up with this email and you'll join their account, with their company details on your reports.`
    : `This email wasn't invited, so this sets up a business of your own. To join ${inviteSignUp.business}, use ${inviteSignUp.email}.`;
}

function onSignUpEmailInput() {
  if (!inviteSignUp) return;
  const joining = document.getElementById('suEmail').value.trim().toLowerCase() === inviteSignUp.email.toLowerCase();
  if (joining === document.getElementById('suBusinessField').hidden) return;
  showInviteSignUp(joining);
}

// ── BUSINESS LOAD ────────────────────────────────────────────────────────
// FIX: loadBusiness() used to be a plain check-then-create with no lock -
// "is authBusiness already set? no -> look for an existing business row ->
// none found -> create one." Two overlapping calls (confirmed live: sign-in
// retried minutes apart after the team_members 500 below made it LOOK like
// something had failed, each a fresh call since authBusiness resets on
// reload) could both pass the "none found" check before either one's POST
// landed, and both would create a business row for the same owner - exactly
// what happened to two of the real test accounts (two "Korva Pest Control"
// rows, two "JC Pest Control" rows, same owner_id each time, confirmed via
// the businesses table and edge_logs). There's also no unique constraint on
// businesses.owner_id at the database level, so nothing stopped it there
// either. This in-flight lock makes every call for the same page session
// share one real attempt instead of racing - a second caller just awaits
// the first one's result instead of starting its own.
let _loadBusinessInFlight = null;
async function loadBusiness() {
  if (!authUser) return;
  if (authBusiness) return; // already loaded — don't overwrite it
  if (_loadBusinessInFlight) return _loadBusinessInFlight;
  _loadBusinessInFlight = _loadBusinessImpl().finally(() => { _loadBusinessInFlight = null; });
  return _loadBusinessInFlight;
}
// The business row is cached per account, so company details, logo and
// licence still reach the PDFs when the app is opened with no signal.
const BUSINESS_CACHE_KEY = 'korva_business_cache';

function rememberBusiness() {
  try {
    if (authBusiness && authUser) localStorage.setItem(BUSINESS_CACHE_KEY, JSON.stringify({ user_id: authUser.id, business: authBusiness }));
  } catch (e) {}
}

function restoreCachedBusiness() {
  try {
    const cached = JSON.parse(localStorage.getItem(BUSINESS_CACHE_KEY) || 'null');
    if (cached && authUser && cached.user_id === authUser.id && cached.business) authBusiness = cached.business;
  } catch (e) {}
}

async function _loadBusinessImpl() {
  try {
    await _lookUpBusiness();
  } catch (e) { console.warn('loadBusiness error:', e); }
  if (authBusiness) rememberBusiness();
  else restoreCachedBusiness();
}

async function _lookUpBusiness() {
    // First try to find existing business for this user (as owner)
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/businesses?owner_id=eq.${authUser.id}&limit=1`,
      { headers: getAuthHeaders() }
    );
    if (res.ok) {
      const rows = await res.json();
      if (rows.length > 0) {
        authBusiness = rows[0];
        await ensureOwnerTeamMember();
        loadBillingStatus();
        return;
      }
    } else {
      // A failed lookup is not "no business": creating one here made
      // duplicate businesses for the same owner.
      return;
    }

    // Not an owner — check if they're a technician already on someone
    // else's business (accounts that joined before Team was removed)
    const tmRes = await fetch(
      `${SUPABASE_URL}/rest/v1/team_members?user_id=eq.${authUser.id}&limit=1`,
      { headers: getAuthHeaders() }
    );
    if (tmRes.ok) {
      const tmRows = await tmRes.json();
      if (tmRows.length > 0) {
        const bizRes = await fetch(
          `${SUPABASE_URL}/rest/v1/businesses?id=eq.${tmRows[0].business_id}&limit=1`,
          { headers: getAuthHeaders() }
        );
        if (bizRes.ok) {
          const bizRows = await bizRes.json();
          if (bizRows.length > 0) {
            authBusiness = bizRows[0];
            loadBillingStatus();
            return;
          }
        } else {
          return;
        }
      }
    } else {
      return;
    }

    // Invited by a business owner (Your team): join that business instead
    // of making one. A failed check is not "no invite", so nothing is made.
    const joined = await acceptTeamInvite();
    if (joined === false) return;
    if (joined) {
      const bizRes = await fetch(`${SUPABASE_URL}/rest/v1/businesses?id=eq.${joined}&limit=1`, { headers: getAuthHeaders() });
      const bizRows = bizRes.ok ? await bizRes.json() : [];
      if (bizRows.length) {
        authBusiness = bizRows[0];
        localStorage.removeItem('korva_pending_business');
        showToast(`You've joined ${authBusiness.name} on SAYON`, 'success');
        track('team_invite_accepted');
        loadBillingStatus();
      }
      return;
    }

    // No business found — try to create one
    // Get business name from: signup metadata → localStorage → email prefix
    const meta = authUser.user_metadata || {};
    const storedName = localStorage.getItem('korva_pending_business');
    const bizName = meta.business_name || storedName ||
                    authUser.email.split('@')[0].replace(/[^a-zA-Z0-9 ]/g,' ').trim();

    const cr = await fetch(`${SUPABASE_URL}/rest/v1/businesses`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Prefer': 'return=representation' },
      body: JSON.stringify({ name: bizName, owner_id: authUser.id }),
    });

    if (cr.ok) {
      const created = await cr.json();
      authBusiness = Array.isArray(created) ? created[0] : created;
      localStorage.removeItem('korva_pending_business');

      // Add owner as team member. The Worker refuses every AI call until
      // this row exists, so a failed insert is tried once more here rather
      // than left for the next launch.
      let tm = null;
      try {
        tm = await fetch(`${SUPABASE_URL}/rest/v1/team_members`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            business_id: authBusiness.id,
            user_id: authUser.id,
            role: 'owner',
            name: meta.name || authUser.email,
            email: authUser.email,
          }),
        });
      } catch (e) { console.warn('team_members insert failed:', e); }
      if (!tm || !tm.ok) await ensureOwnerTeamMember();
      loadBillingStatus();
    }
}

// ── ENTER APP ─────────────────────────────────────────────────────────────
function enterApp() {
  if (authUser) telemetryIdentify(authUser.id);
  document.getElementById('authScreen').style.display   = 'none';
  document.getElementById('onboardScreen').style.display = 'none';
  handleBillingReturn(); // notice + clean up a return from Stripe Checkout/Portal, if that's why we're here
  checkDirectEmail();

  // FIX: a DIFFERENT account just became active than whichever one was last
  // active in this browser tab (sign out, then sign back in as someone else,
  // with no page reload in between). signIn()'s "previous user" check only
  // clears localStorage (STORAGE_KEY/DRAFT_KEY) - it never touches the LIVE
  // in-memory reportData object, the already-rendered form fields, or
  // currentReportId, because those only exist once the Inspect module has
  // been opened (appInitialised). Left alone, the new account would see the
  // previous account's open report (job/client details, property fields,
  // findings, everything) still sitting on screen, and worse: saving under
  // the new account would reuse the PREVIOUS account's currentReportId,
  // which Supabase's RLS then silently rejects on sync (it updates a report
  // row owned by a different user) - the local save still looks successful,
  // but the cloud copy never lands, which is exactly the "report didn't save
  // onto this account" behaviour found during live testing. Forcing a full
  // reset here - the same reset newReport() does - closes all of that off.
  if (appInitialised && authUser && lastActiveAccountUserId && lastActiveAccountUserId !== authUser.id) {
    currentReportId = null;
    resetReportState();
    document.getElementById('jobAddress').value = '';
    document.getElementById('jobSuburb').value = '';
    document.getElementById('jobState').value = '';
    document.getElementById('jobPostcode').value = '';
    document.getElementById('jobClient').value = '';
    document.getElementById('jobInspector').value = '';
    updateJob();
    clearDraft();
    // Saved reports are scoped per-account (reportsStorageKey()), same as
    // company details - no wipe needed here any more. An earlier version of
    // this fix DID wipe the list here and relied on supabaseSyncOnOpen() to
    // pull it back from the cloud, but that raced saveCurrentReport()'s
    // non-blocking background push: switching away and back again within a
    // few seconds of saving could show the just-saved report as missing,
    // because the local copy had just been deleted and the cloud copy
    // hadn't landed yet. Per-account keys mean nothing ever gets deleted on
    // a switch - the previous account's reports stay exactly where they
    // were, under their own key, completely untouched.
    renderSavedList();
  }
  lastActiveAccountUserId = authUser ? authUser.id : lastActiveAccountUserId;

  // One-time claim of whatever was sitting in the old shared flat key,
  // same idea as migrateLegacyCompanyDetails() below. Harmless no-op once
  // this account already has its own per-user key (which it will, after
  // the first time this runs).
  migrateLegacySavedReports();

  if (authBusiness) {
    // Claim any pre-fix legacy data for this business, then take the
    // account's copy if it's newer than this phone's.
    migrateLegacyCompanyDetails();
    applyCloudBusinessSettings();
    // The sign-up name fills an empty record, but isn't stamped as an edit:
    // it mustn't count as newer than real details on another phone.
    const details = getCompanyDetails();
    if (!details.name && isBusinessOwner() && authBusiness.name) {
      details.name = authBusiness.name;
      try { localStorage.setItem(companyStorageKey(), JSON.stringify(details)); } catch (e) {}
    }
  }
  renderProfileMenu();
  migrateLocalReportsToCloud();

  // FIX: this was the actual cause of "reports aren't saving after logging
  // out" (it isn't a server problem — the reports were always safely in
  // Supabase the whole time, confirmed directly against the database).
  // supabaseSyncOnOpen() is what pulls an account's cloud-saved reports
  // DOWN into this device's local list so the Dashboard can show them — but
  // it only ever lived inside openApp('inspect')'s one-time setup block,
  // which runs once per browser tab no matter how many times someone signs
  // out and back in without a full page reload. So: the FIRST account
  // opened in a tab got its cloud reports pulled down once, same as always
  // - but every account after that (a different account switching in, OR
  // the same account signing out and back in, since signOut() wipes the
  // local report list on purpose) got NOTHING re-downloaded, and the
  // Dashboard correctly-but-misleadingly reported "No saved reports yet on
  // this device." Calling it here too means every real sign-in restores
  // that account's cloud reports to this device, not just the first one.
  supabaseSyncOnOpen();
  checkAddressMove();

  // New users see onboarding; returning users go straight into the app.
  if (shouldShowOnboarding()) showOnboarding();
  else openApp('inspect');
}

function renderProfileMenu() {
  if (!authUser) return;
  const meta = authUser.user_metadata || {};
  const name = meta.name || authUser.email.split('@')[0];
  const initials = name.trim().split(/\s+/).slice(0,2).map(w => w[0]).join('').toUpperCase() || '?';
  const initialsEl = document.getElementById('profileInitials');
  if (initialsEl) initialsEl.textContent = initials;
  const topInitials = document.getElementById('topbarInitials');
  if (topInitials) topInitials.textContent = initials;
  const nameEl = document.getElementById('profileName');
  if (nameEl) nameEl.textContent = name;
  const emailEl = document.getElementById('profileEmail');
  if (emailEl) emailEl.textContent = authUser.email;
  const bizRow = document.getElementById('profileBusinessRow');
  if (bizRow) {
    // The name the PDFs print, which "Your business" edits
    const bizName = getCompanyDetails().name || authBusiness?.name || '';
    document.getElementById('profileBusinessName').textContent = bizName;
    bizRow.style.display = authBusiness && bizName ? 'flex' : 'none';
  }
  const bizBtn = document.getElementById('profileYourBusiness');
  if (bizBtn) bizBtn.hidden = !canEditBusiness();
  // Your team needs a business of your own and a Worker that knows about
  // inspector places (supabase/team-seats.sql is applied before it).
  const teamBtn = document.getElementById('profileYourTeam');
  if (teamBtn) teamBtn.hidden = !(authBusiness && isBusinessOwner() && billingStatusCache && billingStatusCache.seat_plans);
}
function openBillingFromProfile() {
  openMenuPage('billingPanel');
}
function signOutFromProfile() {
  if (confirm('Sign out of SAYON?')) signOut();
}

// ── AUTH UI HELPERS ──────────────────────────────────────────────────────
function showAuth(panel) {
  ['authSignIn','authSignUp','authForgot','authConfirm','authResetPassword'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = id === panel ? 'flex' : 'none';
  });
  // Fix: ensure displayed card uses flex column
  const active = document.getElementById(panel);
  if (active) active.style.flexDirection = 'column';
  track('screen_viewed', { screen: 'auth_' + panel });
}

// Show / Hide on a password field: easier to type right on a phone.
function toggleAuthReveal(btn) {
  const input = btn.parentElement.querySelector('input');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.textContent = show ? 'Hide' : 'Show';
  btn.setAttribute('aria-pressed', String(show));
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
}

// ── SESSION RESTORE ON LOAD ──────────────────────────────────────────────
async function restoreAuthSession() {
  const stored = loadSession();
  if (!stored?.access_token) return false;

  // Check if token is still valid (exp is in seconds)
  const exp = stored.expires_at || 0;
  const now = Math.floor(Date.now() / 1000);

  if (now < exp - 60) {
    authSession = stored;
    authUser    = stored.user;
    // Saved reports are scoped per-account (reportsStorageKey()) - nothing
    // to clear here for a switched user any more, just the unsaved draft.
    const prevUserId = localStorage.getItem('korva_last_user_id');
    if (prevUserId && prevUserId !== stored.user?.id) {
      localStorage.removeItem(DRAFT_KEY);
    }
    if (stored.user?.id) localStorage.setItem('korva_last_user_id', stored.user.id);
    await loadBusiness();
    startAuthAutoRefresh();
    return true;
  }

  // Try to refresh
  if (stored.refresh_token) {
    const ok = await refreshSession(stored.refresh_token);
    if (ok) {
      authUser = authSession.user;
      await loadBusiness();
      startAuthAutoRefresh();
      return true;
    }
    // No signal (in a subfloor, out of range): keep the saved sign-in and
    // open the app so the inspector can keep working. The token is refreshed
    // once the signal is back; only a refusal from Supabase signs them out.
    if (lastRefreshWasOffline || !navigator.onLine) {
      authSession = stored;
      authUser    = stored.user;
      await loadBusiness();
      startAuthAutoRefresh();
      return true;
    }
    // Refused: say so, or "did I lose my report?" is the first thought.
    setTimeout(() => showToast('Your sign-in expired. Sign in again; your work is still on this phone', 'info'), 900);
  }

  clearSession();
  return false;
}

// ── STABLE DEVICE ID (still used as fallback) ────────────────────────────
function getDeviceId() {
  let id = localStorage.getItem('korva_device_id');
  if (!id) {
    id = 'dev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    localStorage.setItem('korva_device_id', id);
  }
  return id;
}

// ── SUPABASE REPORT SYNC (now auth-aware) ────────────────────────────────
// Returns true once the report is in the account. quiet: no error toast.
// Saves of one report go to the account one at a time, in order. Otherwise
// an autosave could check the account copy while this phone's previous save
// was still on its way, and take this phone's own save for another device's.
const reportSaveChains = new Map();
function supabaseSave(entry, quiet) {
  const prev = reportSaveChains.get(entry.id) || Promise.resolve();
  const run = prev.catch(() => {}).then(() => supabaseSaveNow(entry, quiet));
  reportSaveChains.set(entry.id, run);
  run.finally(() => { if (reportSaveChains.get(entry.id) === run) reportSaveChains.delete(entry.id); });
  return run;
}

async function supabaseSaveNow(entry, quiet) {
  if (!authSession) return false; // only sync when authenticated
  // Only the version stored on this phone goes up. When it has changed since
  // (a newer save, which goes up next, or the other device's copy taken in),
  // or the report was deleted, this older one is skipped.
  const stored = getSavedReports().find(r => r.id === entry.id);
  if (!stored || stored.savedAt !== entry.savedAt) return true;
  // Photos go to Storage, not into the row. Record their cloud paths on
  // the saved copy (and the open draft, which shares the photo objects).
  if (await uploadPendingPhotos(entry.reportData)) {
    const reports = getSavedReports();
    const i = reports.findIndex(r => r.id === entry.id);
    if (i >= 0 && reports[i].savedAt === entry.savedAt) { reports[i] = entry; setSavedReports(reports); }
    if (currentReportId === entry.id) saveDraft();
  }
  // Saved again on this phone while the photos went up: that save goes next.
  if ((getSavedReports().find(r => r.id === entry.id) || {}).savedAt !== entry.savedAt) return true;
  try {
    // Another device may have saved this report since this phone last
    // synced it. Then the account copy wins and this phone's version is
    // kept beside it, so neither is lost.
    const cloudAt = await cloudSavedAtOf(entry.id);
    const base = Math.max(cloudBaseOf(entry), cloudBaseOf(stored));
    if (cloudAt && cloudAt > base && cloudAt !== entry.savedAt) {
      return keepBothCopies(entry);
    }
    const row = {
      device_id:   getDeviceId(),
      user_id:     authUser?.id || null,
      business_id: authBusiness?.id || null,
      report_id:   entry.id,
      address:     entry.address || null,
      client:      entry.client || null,
      inspector:   entry.inspector || null,
      saved_at:    new Date(entry.savedAt).toISOString(),
      data:        entry,
    };
    // FIX: this POST previously had no on_conflict target, so
    // Prefer: resolution=merge-duplicates had nothing to tell it which
    // unique constraint to upsert against (report_id is unique, but the
    // request never said so, and id - the real primary key - isn't in the
    // payload at all). The first save of a report (brand new report_id)
    // always worked, a plain 201 insert. But re-saving the SAME report
    // (e.g. "add more stuff" after already saving once) tried another
    // plain insert, hit reports_report_id_key, and Postgres/PostgREST
    // rejected it with 409 - confirmed live in production logs
    // (POST | 409 | .../rest/v1/reports). That 409 does trigger the
    // "could not sync to your account" toast below, but to the user it
    // just looked like "reports aren't saving" since the whole point of
    // re-saving is to update the existing one. on_conflict=report_id makes
    // this a real upsert: same report_id updates the existing row instead
    // of colliding with it.
    const res = await fetch(`${SUPABASE_URL}/rest/v1/reports?on_conflict=report_id`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const detail = await res.text();
      console.warn('Supabase save failed:', detail);
      if (quiet) return false;
      // FIX: this used to fail completely silently - "Report saved" already
      // showed from the local save, so a rejected cloud sync (e.g. RLS
      // blocking a write to a report row that doesn't belong to the current
      // account/business) was invisible until someone noticed the report
      // missing elsewhere. Surface it so "saved" never quietly means
      // "saved on this device only, and the server said no."
      showToast('Saved on this device, but could not sync to your account', 'error');
      updateSyncStatus('cloud_error');
      return false;
    }
    markCloudSaved(entry.id, entry.savedAt);
    return true;
  } catch(e) {
    console.warn('Supabase sync error:', e.message);
    if (quiet) return false;
    showToast('Saved on this device, but could not sync to your account', 'error');
    updateSyncStatus('cloud_error');
    return false;
  }
}

// ── ONE-TIME MIGRATION: reports saved locally before auth was enabled ──────
// (e.g. anything created while login was bypassed) never made it to
// Supabase, since supabaseSave() no-ops without a session. Push them up
// the first time each device gets a real logged-in session, so nothing
// from that period is silently orphaned on one device.
async function migrateLocalReportsToCloud() {
  if (!authSession) return;
  const MIGRATION_KEY = 'korva_local_migrated_v1';
  if (localStorage.getItem(MIGRATION_KEY)) return;

  try {
    const local = getSavedReports();
    if (local.length > 0) {
      for (const entry of local) {
        await supabaseSave(entry);
      }
      showToast(`Backed up ${local.length} local report${local.length > 1 ? 's' : ''} to your account`, 'info');
    }
  } catch (e) {
    console.warn('Local report migration failed:', e.message);
    return; // don't set the flag — try again next session
  }
  localStorage.setItem(MIGRATION_KEY, '1');
}

async function supabaseDelete(reportId) {
  if (!authSession) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/reports?report_id=eq.${encodeURIComponent(reportId)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    return res.ok;
  } catch(e) { console.warn('Supabase delete error:', e.message); return false; }
}

async function supabaseLoadAll() {
  if (!authSession) return null;
  try {
    const filter = authUser?.id
      ? `user_id=eq.${authUser.id}&order=saved_at.desc`
      : `device_id=eq.${encodeURIComponent(getDeviceId())}&order=saved_at.desc`;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/reports?${filter}`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows.map(r => r.data);
  } catch(e) { console.warn('Supabase load error:', e.message); return null; }
}

// ── SYNC BETWEEN DEVICES ──────────────────────────────────────────────────
// Each saved report remembers the account copy it was built on
// (cloudSavedAt). Reports saved before this existed fall back to their own
// savedAt, the last time this phone saved them.
function cloudBaseOf(entry) {
  return entry.cloudSavedAt != null ? entry.cloudSavedAt : (entry.savedAt || 0);
}
function hasUnsyncedChanges(entry) {
  return entry.cloudSavedAt != null && (entry.savedAt || 0) > entry.cloudSavedAt;
}
// The account now holds this phone's save from savedAt. A later save on
// this phone was built on it, so it becomes that one's base too.
function markCloudSaved(id, savedAt) {
  const reports = getSavedReports();
  const r = reports.find(x => x.id === id);
  if (!r || (r.cloudSavedAt != null && r.cloudSavedAt >= savedAt) || (r.savedAt || 0) < savedAt) return;
  r.cloudSavedAt = savedAt;
  setSavedReports(reports);
}
async function cloudSavedAtOf(id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/reports?report_id=eq.${encodeURIComponent(id)}&select=saved_at`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error('saved_at check ' + res.status);
  const rows = await res.json();
  return rows.length ? Date.parse(rows[0].saved_at) : 0;
}
async function cloudReportOf(id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/reports?report_id=eq.${encodeURIComponent(id)}&select=data`, { headers: getAuthHeaders() });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows.length ? rows[0].data : null;
}
function sameReportContent(a, b) {
  return JSON.stringify([a.reportData, a.quote || null, a.client, a.address]) === JSON.stringify([b.reportData, b.quote || null, b.client, b.address]);
}

// The account's newer copy takes the report's place. This phone's version,
// if it differs, is saved as a separate report marked "copy from this phone".
async function keepBothCopies(local) {
  const cloud = await cloudReportOf(local.id);
  if (!cloud) return false;
  const reports = getSavedReports();
  const i = reports.findIndex(r => r.id === local.id);
  const fresh = Object.assign({}, cloud, { cloudSavedAt: cloud.savedAt });
  if (i >= 0) reports[i] = fresh; else reports.unshift(fresh);
  let copy = null;
  if (!sameReportContent(local, cloud)) {
    copy = Object.assign({}, local, { id: 'report_' + Date.now(), cloudSavedAt: 0, conflictCopy: true, savedAt: Date.now() });
    if (copy.quote) copy.quote = Object.assign({}, copy.quote, { reportKey: copy.id });
    reports.unshift(copy);
  }
  if (!setSavedReports(reports)) return false;
  // The quote list keeps its own copy of each quote, newest wins. This
  // phone's quote goes with this phone's copy; the report takes the other
  // device's quote.
  if (typeof quotesStorageKey === 'function') {
    try {
      const quotes = JSON.parse(localStorage.getItem(quotesStorageKey()) || '{}');
      if (copy && copy.quote) quotes[copy.id] = copy.quote;
      if (cloud.quote) quotes[local.id] = cloud.quote; else delete quotes[local.id];
      localStorage.setItem(quotesStorageKey(), JSON.stringify(quotes));
    } catch (e) {}
  }
  if (currentReportId === local.id) loadReport(local.id, true);
  renderSavedList();
  showToast(copy
    ? "This report was changed on another device. That version is open now; this phone's version is saved beside it as a copy."
    : 'Updated this report with the newer copy from your other device', 'info');
  return copy ? supabaseSave(copy, true) : true;
}

async function supabaseSyncOnOpen() {
  if (!authSession) return;
  await flushPendingDeletes();
  const deleting = new Set(getPendingDeletes().map(d => d.id));
  const archived = new Set(getArchivedReportIds());
  const cloudReports = (await supabaseLoadAll() || []).filter(c => c && !deleting.has(c.id) && !archived.has(c.id));
  if (cloudReports.length === 0) return;
  const local = getSavedReports();
  const byId = new Map(local.map(r => [r.id, r]));
  const newFromCloud = [], newer = [], clashes = [];
  cloudReports.forEach(c => {
    if (!c || !c.id) return;
    const mine = byId.get(c.id);
    if (!mine) newFromCloud.push(Object.assign({}, c, { cloudSavedAt: c.savedAt }));
    else if ((c.savedAt || 0) > cloudBaseOf(mine) && (c.savedAt || 0) !== mine.savedAt) {
      (hasUnsyncedChanges(mine) ? clashes : newer).push(c);
    }
  });
  newer.forEach(c => byId.set(c.id, Object.assign({}, c, { cloudSavedAt: c.savedAt })));
  if (newFromCloud.length || newer.length) {
    const merged = [...newFromCloud, ...byId.values()].sort((a,b) => (b.savedAt||0) - (a.savedAt||0));
    if (setSavedReports(merged)) {
      const open = newer.find(c => c.id === currentReportId);
      if (open && reportSig() === lastReportSig) loadReport(open.id, true);
      renderSavedList();
      const parts = [];
      if (newFromCloud.length) parts.push(`restored ${newFromCloud.length} report${newFromCloud.length > 1 ? 's' : ''}`);
      if (newer.length) parts.push(`updated ${newer.length} with newer changes`);
      showToast(`From your account: ${parts.join(', ')}`, 'info');
    }
  }
  for (const c of clashes) await keepBothCopies(byId.get(c.id));
}

// A report saved on this phone that the account doesn't have yet: saved
// with no signal, or while the account refused it. cloudSavedAt is 0 until
// the first save lands and null on reports from before it was recorded.
function notInAccount(entry) {
  return !!entry && entry.cloudSavedAt != null && (entry.savedAt || 0) > entry.cloudSavedAt;
}
function inAccount(entry) {
  return !!entry && entry.cloudSavedAt != null && entry.cloudSavedAt >= (entry.savedAt || 0);
}
// Those reports go up the next time the app is online and in front, so a
// job finished in a subfloor is never left only on the phone.
let pushUnsyncedRunning = false;
async function pushUnsyncedReports() {
  if (!authSession || !navigator.onLine || pushUnsyncedRunning) return;
  pushUnsyncedRunning = true;
  try {
    const waiting = getSavedReports().filter(r => r && r.reportData && notInAccount(r));
    let landed = 0;
    for (const r of waiting) { if (await supabaseSave(r, true)) landed++; }
    if (landed) { renderSavedList(); updateSyncStatus(); }
  } catch (e) { console.warn('pushUnsyncedReports:', e); }
  finally { pushUnsyncedRunning = false; }
}

// saveDraft() is called on nearly every keystroke and on every signature
// stroke, so it's debounced into a single write a short delay after the
// last call rather than writing to localStorage on every individual event.
// flushDraftSave() does the real work and is also called directly when the
// page is about to be hidden/closed, so a debounce in progress is never
// lost if the technician backgrounds or closes the app mid-edit.
let saveDraftTimer = null;
let saveDraftFailureNotified = false;
const SAVE_DRAFT_DEBOUNCE_MS = 400;

function saveDraft() {
  if (saveDraftTimer) clearTimeout(saveDraftTimer);
  saveDraftTimer = setTimeout(flushDraftSave, SAVE_DRAFT_DEBOUNCE_MS);
}

function flushDraftSave() {
  if (saveDraftTimer) { clearTimeout(saveDraftTimer); saveDraftTimer = null; }
  try {
    const draft = {
      jobAddress: document.getElementById('jobAddress').value,
      jobSuburb: document.getElementById('jobSuburb').value,
      jobState: document.getElementById('jobState').value,
      jobPostcode: document.getElementById('jobPostcode').value,
      jobClient: document.getElementById('jobClient').value,
      jobInspector: document.getElementById('jobInspector').value,
      reportData: { ...reportData },
      fieldNotes: { ...fieldNotes },
      currentReportId,
      // Words dictated but not filled in yet, so a reload (an app update,
      // or the phone closing the app) doesn't lose them.
      transcript: currentTranscript || '',
      savedAt: Date.now(),
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    saveDraftFailureNotified = false; // a later successful save clears the throttle
    lastLocalSaveAt = Date.now();
    updateSyncStatus('saved');
    scheduleReportAutosave();
  } catch (e) {
    // Previously a silent fail. Now surfaced once per failure episode so the
    // technician knows in-progress work (including a just-captured signature)
    // may not be persisting, without spamming a toast on every keystroke.
    if (!saveDraftFailureNotified) {
      saveDraftFailureNotified = true;
      showToast('Could not save your progress — device storage may be full', 'error');
    }
    updateSyncStatus('error');
  }
}

// ── SYNC / SAVE STATUS INDICATOR ────────────────────────────────────────
// A technician working in a subfloor, basement, or a regional job with no
// signal needs to see their work is safe on-device even when it hasn't (or
// can't yet) reach the cloud — this makes that state visible instead of
// leaving them guessing whether "Save Report" actually did anything.
let lastLocalSaveAt = null;

function updateSyncStatus(state) {
  const el = document.getElementById('syncStatus');
  const textEl = document.getElementById('syncStatusText');
  if (!el || !textEl) return;
  el.classList.remove('saved', 'offline', 'error');

  if (!navigator.onLine) {
    el.classList.add('offline');
    textEl.textContent = lastLocalSaveAt
      ? 'Saved on this device — will sync when back online'
      : 'Offline — saving to this device only';
    return;
  }
  if (state === 'error') {
    el.classList.add('error');
    textEl.textContent = 'Could not save — check device storage';
    return;
  }
  if (state === 'cloud_error') {
    el.classList.add('error');
    textEl.textContent = 'Saved on this device — could not sync to your account';
    return;
  }
  if (state === 'saved' || lastLocalSaveAt) {
    el.classList.add('saved');
    textEl.textContent = (typeof authSession !== 'undefined' && authSession)
      ? 'Saved & syncing to your account'
      : 'Saved on this device';
    return;
  }
  textEl.textContent = 'Not saved yet';
}

window.addEventListener('online', () => { updateSyncStatus(); processPendingNotes(); pushUnsyncedReports(); });
window.addEventListener('offline', () => updateSyncStatus());

// Make sure a pending debounced save is never lost if the app is backgrounded
// or closed before the debounce timer would otherwise have fired.
// Coming back to the app: the sign-in may have expired while the phone
// slept, so refresh it before anything talks to the server.
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) {
    flushDraftSave();
    if (updateReloadPending && !isRecording && !document.body.classList.contains('ai-busy')) location.reload();
    return;
  }
  // An app left open for days never navigates, so ask for a new version here.
  if (swRegistration) swRegistration.update().catch(() => {});
  await maybeRefreshAuthSession();
  processPendingNotes();
  pushUnsyncedReports();
  checkAddressMove();
});
window.addEventListener('pagehide', flushDraftSave);
window.addEventListener('beforeunload', flushDraftSave);

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return false;
    const draft = JSON.parse(raw);

    if (draft.transcript && !currentTranscript) {
      currentTranscript = draft.transcript;
      const box = document.getElementById('transcriptBox');
      if (box) { box.textContent = currentTranscript; box.classList.add('active'); }
      const btn = document.getElementById('extractBtn');
      if (btn) btn.disabled = false;
    }

    // Don't restore empty drafts
    if (!draft.reportData || Object.keys(draft.reportData).length === 0) {
      if (!draft.jobAddress && !draft.jobClient) return false;
    }

    document.getElementById('jobAddress').value = draft.jobAddress || '';
    document.getElementById('jobSuburb').value = draft.jobSuburb || '';
    document.getElementById('jobState').value = draft.jobState || '';
    document.getElementById('jobPostcode').value = draft.jobPostcode || '';
    document.getElementById('jobClient').value = draft.jobClient || '';
    document.getElementById('jobInspector').value = draft.jobInspector || '';
    updateJob();

    reportData = { ...draft.reportData };
    upgradeRenamedChoices(reportData);
    fieldNotes = { ...(draft.fieldNotes || {}) };
    currentReportId = draft.currentReportId || null;
    externalizePhotos(reportData).then(changed => { if (changed) saveDraft(); });

    Object.keys(reportData).forEach(key => {
      const el = document.getElementById('f-' + key);
      if (el) renderField(el, key, reportData[key]);
    });

    restoreFieldNotes();

    const sel = document.getElementById('standardSelect');
    if (sel && reportData.standard) sel.value = reportData.standard;

    updateProgress();
    checkAsbestosFlag();
    checkFindingsGate();
    checkSystemVerify();
    checkSecondaryColonyFlag();
    ensureTreatmentForLiveTermites();
    restoreSignaturePads(); restoreLicenceField();
    renderReportWidgets();
    renderFindingsUI();

    // FIX: this was a third independent copy of the same plain-presence
    // check already found to overcount the Findings section elsewhere
    // (see isFieldFilled) - sharing it here too so reopening a draft can't
    // land on the wrong tab for the same reason.
    let bestSection = 'property', bestCount = -1;
    Object.entries(SECTIONS).forEach(([sec, cfg]) => {
      const count = cfg.fields.filter(k => isFieldFilled(k)).length;
      if (count > bestCount) { bestCount = count; bestSection = sec; }
    });
    goStep(stepOf(bestSection).id);

    return true;
  } catch (e) {
    console.error('Failed to load draft', e);
    reportError(e, 'load_draft');
    return false;
  }
}

function clearDraft() {
  if (saveDraftTimer) { clearTimeout(saveDraftTimer); saveDraftTimer = null; }
  try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
}

function getSavedReports() {
  try {
    const raw = localStorage.getItem(reportsStorageKey());
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Failed to read saved reports', e);
    reportError(e, 'read_saved_reports');
    return [];
  }
}

function setSavedReports(reports, retrying) {
  try {
    localStorage.setItem(reportsStorageKey(), JSON.stringify(reports));
    return true;
  } catch (e) {
    console.error('Failed to save reports', e);
    reportError(e, 'save_reports');
    // Full phone: older jobs already in the account can leave the phone to
    // make room, then this save is tried once more.
    if (isQuotaError(e) && !retrying && freeStorageFor(reports)) return setSavedReports(reports, true);
    showToast(isQuotaError(e)
      ? 'Could not save: this phone\'s storage is full. Back up from Menu › Data, then delete old jobs'
      : 'Could not save — storage full or unavailable', 'error');
    return false;
  }
}

function isQuotaError(e) {
  return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014 || /quota/i.test(String(e.message || '')));
}
function photoStoreProblem(e) {
  return isQuotaError(e) ? 'This phone\'s storage is full. Free some space or remove old jobs, then add the photo again' : 'Could not process photo';
}

// ── OLDER JOBS KEPT IN THE ACCOUNT ONLY ───────────────────────────────────
// When the phone is full, finished jobs that the account already holds are
// taken off the phone (their ids kept here, so the next sync doesn't bring
// them straight back). Bring them back clears the list and syncs again.
function archivedReportsKey() {
  return (authUser && authUser.id) ? `korva_archived_reports_${authUser.id}` : 'korva_archived_reports';
}
function getArchivedReportIds() {
  try { const v = JSON.parse(localStorage.getItem(archivedReportsKey()) || '[]'); return Array.isArray(v) ? v : []; }
  catch (e) { return []; }
}
function setArchivedReportIds(ids) {
  try { if (ids.length) localStorage.setItem(archivedReportsKey(), JSON.stringify(ids)); else localStorage.removeItem(archivedReportsKey()); } catch (e) {}
}
// Takes the oldest finished, backed-up jobs out of `reports` (in place)
// after the inspector agrees. Returns true when something was removed.
function freeStorageFor(reports) {
  if (!authSession) return false;
  const candidates = reports
    .filter(r => r && r.id !== currentReportId && r.reportData && r.reportData.issue && inAccount(r))
    .sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
  if (!candidates.length) return false;
  const n = Math.max(1, Math.ceil(candidates.length / 2));
  const going = candidates.slice(0, n);
  const ok = confirm(`This phone's storage is full. Take the ${n === 1 ? 'oldest finished job' : `${n} oldest finished jobs`} off this phone? ${n === 1 ? 'It stays' : 'They stay'} in your account and can be brought back from Saved Reports.`);
  if (!ok) return false;
  const ids = new Set(going.map(r => r.id));
  for (let i = reports.length - 1; i >= 0; i--) if (ids.has(reports[i].id)) reports.splice(i, 1);
  setArchivedReportIds([...new Set([...getArchivedReportIds(), ...ids])]);
  showToast(`${n} older job${n === 1 ? '' : 's'} now kept in your account only`, 'info');
  return true;
}
async function restoreArchivedReports() {
  if (!navigator.onLine) { showToast('No signal. Try again when you have one', 'error'); return; }
  setArchivedReportIds([]);
  await supabaseSyncOnOpen();
  renderSavedList();
  refreshDashboardIfOpen();
}

function calculateCompletion() {
  let filled = 0, total = 0;
  Object.values(REQUIRED_FIELDS).forEach(req => {
    filled += req.filter(k => isFieldFilled(k)).length;
    total += req.length;
  });
  return Math.round((filled / total) * 100);
}

// One word for where a saved job is up to: Draft, Ready (every required
// field filled), Sent, Complete vN or Amending vN.
function savedReportStatus(r) {
  const d = r.reportData || {};
  if (d.issue) {
    const v = d.issue.version ? ` v${d.issue.version}` : '';
    return d.amending ? { label: `Amending${v}`, tone: 'amending' } : { label: `Complete${v}`, tone: 'complete' };
  }
  if (d.sent) return { label: 'Sent', tone: 'sent' };
  if ((r.completion || 0) >= 100) return { label: 'Ready', tone: 'ready' };
  return { label: 'Draft', tone: 'draft' };
}

// The job's fee. Job details and the agreement share one field
// (reportData.jobFee); reports saved before that may hold it only on the
// signed agreement.
function jobFeeOf(data) {
  if (!data) return '';
  return String(data.jobFee || (data.agreement && data.agreement.fee) || '').trim();
}

// FIX: a plain "is this key present" check silently overcounted the
// Findings section. getFindings() (called during routine UI renders, not
// just user action) lazily creates a placeholder finding object with
// termiteActivity:null the first time anything reads the findings list -
// so reportData.findings was non-null/non-undefined on almost every report
// from the moment the page rendered once, even with zero real data
// recorded, and the progress bar silently counted that section as "done".
// Centralising the "filled" check here (rather than a one-off inline
// special case) also makes it the obvious place to extend if another
// field ever needs more than a bare presence check.
function isFieldFilled(key) {
  // Answered from the areas in Section 4 (see hinderedAnswer).
  if (key === 'hinderedAreas') return !!hinderedAnswer();
  if (reportData[key] === undefined || reportData[key] === null) return false;
  if (key === 'findings') {
    return Array.isArray(reportData.findings) &&
      reportData.findings.some(f => f && (f.termiteActivity || f.species || f.damageDescription || f.activityLocation));
  }
  if (key === 'areaStatus') {
    // Every area needs a status (Inspected / Not inspected / Not applicable).
    return Object.keys(OBS_ZONES).every(z => areaStatusOf(z));
  }
  if (key === 'standard') {
    // resetReportState()/loadReport() force reportData.standard to
    // 'AS 3660.2-2017' before the technician has touched anything, so its
    // bare presence isn't evidence of real progress - every brand-new report
    // would otherwise show a few % complete and "In progress" on Property
    // before a single field is entered. Only count it once they've actually
    // picked a different standard, since that's the only signal we have
    // that this field was deliberately engaged with.
    return reportData.standard !== 'AS 3660.2-2017';
  }
  return true;
}

// quiet: no toast, for saves the app makes on its own (see processPendingNotes)
// A report with an address saves itself to Saved Reports (and the
// account) a few seconds after each change, so nobody has to dig through
// the menu for Save Report. reportSig() spots when nothing has changed, so
// opening a report or the save's own draft write doesn't save it again.
const REPORT_AUTOSAVE_MS = 4000;
let reportAutosaveTimer = null, lastReportSig = null;
// Which saved report each open report object was saved as.
const savedIdFor = new WeakMap();

// The open report is otherwise saved a few seconds after the last change.
// Opening another job, starting a new one or signing out saves it first,
// so those last few seconds of work (and their photos) aren't dropped.
function saveOpenReportNow() {
  flushDraftSave();
  if (reportAutosaveTimer) { clearTimeout(reportAutosaveTimer); reportAutosaveTimer = null; }
  if (document.getElementById('jobAddress').value.trim() && reportSig() !== lastReportSig) saveCurrentReport(true);
}
function reportSig() {
  return JSON.stringify([JOB_SUMMARY_FIELDS.map(id => (document.getElementById(id) || {}).value || ''), reportData, fieldNotes]);
}
function scheduleReportAutosave() {
  if (reportAutosaveTimer) clearTimeout(reportAutosaveTimer);
  reportAutosaveTimer = setTimeout(() => {
    reportAutosaveTimer = null;
    if (!document.getElementById('jobAddress').value.trim() || reportSig() === lastReportSig) return;
    saveCurrentReport(true);
  }, REPORT_AUTOSAVE_MS);
}

function saveCurrentReport(quiet) {
  const street = document.getElementById('jobAddress').value.trim();
  if (!street) {
    showToast('Enter a property address before saving', 'error');
    document.getElementById('jobAddress').focus();
    return;
  }

  const reports = getSavedReports();
  const id = currentReportId || ('report_' + Date.now());
  const prev = reports.find(r => r.id === id);
  // A quote started before the report was first saved moves to its new id.
  if (!currentReportId) adoptDraftQuote(id, getFullAddress());

  const entry = {
    id,
    address: getFullAddress(),
    jobAddress: street,
    jobSuburb: document.getElementById('jobSuburb').value.trim(),
    jobState: document.getElementById('jobState').value.trim(),
    jobPostcode: document.getElementById('jobPostcode').value.trim(),
    client: document.getElementById('jobClient').value.trim(),
    inspector: document.getElementById('jobInspector').value.trim(),
    reportData: { ...reportData },
    fieldNotes: { ...fieldNotes },
    savedAt: Date.now(),
    // The account copy this one was built on (see supabaseSave).
    cloudSavedAt: prev ? cloudBaseOf(prev) : 0,
    completion: calculateCompletion(),
  };
  // The quote rides along in the saved report, so it syncs to the account
  // with it (see the quote builder in js/quote.js).
  const quote = quoteForReport(id, entry.address);
  if (quote) entry.quote = quote;

  const existingIndex = reports.findIndex(r => r.id === id);
  if (existingIndex >= 0) {
    reports[existingIndex] = entry;
  } else {
    reports.unshift(entry);
  }

  if (setSavedReports(reports)) {
    currentReportId = id;
    savedIdFor.set(reportData, id);
    lastReportSig = reportSig();
    if (!quiet) showToast('Report saved', 'success');
    renderSavedList();
    saveDraft();
    lastLocalSaveAt = Date.now();
    updateSyncStatus('saved');
    supabaseSave(entry); // background cloud sync — non-blocking
  }
}

function loadReport(id, quiet) {
  // Saved first even when reopening the same job: what was done in the last
  // few seconds (a signed agreement) would otherwise be lost on the reload.
  saveOpenReportNow();
  if (id !== currentReportId) {
    // A report with no address yet is never saved, so it's dropped here,
    // and so is the quote made for it.
    if (!currentReportId && typeof forgetDraftQuote === 'function') forgetDraftQuote();
    clearFilledNotes();
  }
  const reports = getSavedReports();
  const entry = reports.find(r => r.id === id);
  if (!entry) return;

  // Reset current state
  resetReportState();

  // Restore job fields
  document.getElementById('jobAddress').value = entry.jobAddress || entry.address || '';
  document.getElementById('jobSuburb').value = entry.jobSuburb || '';
  document.getElementById('jobState').value = entry.jobState || '';
  document.getElementById('jobPostcode').value = entry.jobPostcode || '';
  document.getElementById('jobClient').value = entry.client || '';
  document.getElementById('jobInspector').value = entry.inspector || '';
  updateJob();

  // Restore report data
  reportData = { ...entry.reportData };
  upgradeRenamedChoices(reportData);
  fieldNotes = { ...(entry.fieldNotes || {}) };
  currentReportId = entry.id;
  savedIdFor.set(reportData, entry.id);
  externalizePhotos(reportData).then(changed => { if (changed) saveDraft(); });

  // Re-render all fields
  Object.keys(reportData).forEach(key => {
    const el = document.getElementById('f-' + key);
    if (el) renderField(el, key, reportData[key]);
  });

  restoreFieldNotes();

  const sel = document.getElementById('standardSelect');
  if (sel) sel.value = reportData.standard || 'AS 3660.2-2017';
  if (!reportData.standard) setStandard('AS 3660.2-2017');

  updateProgress();
  checkAsbestosFlag();
  checkFindingsGate();
  checkSystemVerify();
  checkSecondaryColonyFlag();
  ensureTreatmentForLiveTermites();
  restoreSignaturePads(); restoreLicenceField();
  loadJobInfo();
  renderReportWidgets();

  // Reveal the section with the most data, default to property
  let bestSection = 'property', bestCount = -1;
  Object.entries(SECTIONS).forEach(([sec, cfg]) => {
    const count = cfg.fields.filter(k => isFieldFilled(k)).length;
    if (count > bestCount) { bestCount = count; bestSection = sec; }
  });
  goStep(stepOf(bestSection).id);
  lastReportSig = reportSig();
  saveDraft();

  if (!quiet) showToast(`Loaded: ${entry.address}`, 'info');
  processPendingNotes();
  if (document.getElementById('sidebarPanel').classList.contains('open')) {
    toggleDrawer();
  }
}

// Deleting a job takes it off the phone at once and offers Undo. The
// account copy and its photos go a few seconds later, once Undo has passed.
// Deletes waiting for the account (no signal, or the app closed first) are
// listed, so they're finished on the next open instead of coming back.
const DELETE_UNDO_MS = 6500;
const deleteTimers = {};
function pendingDeletesKey() {
  return (authUser && authUser.id) ? `korva_pending_deletes_${authUser.id}` : 'korva_pending_deletes';
}
function getPendingDeletes() {
  try { const v = JSON.parse(localStorage.getItem(pendingDeletesKey()) || '[]'); return Array.isArray(v) ? v : []; }
  catch (e) { return []; }
}
function setPendingDeletes(list) {
  try { localStorage.setItem(pendingDeletesKey(), JSON.stringify(list)); } catch (e) {}
}
async function finishDelete(item) {
  delete deleteTimers[item.id];
  const keep = referencedPhotoIds();
  const paths = (item.paths || []).filter((path, i) => !keep.has((item.photoIds || [])[i]));
  if (paths.length) deleteCloudPhotos(paths);
  if (!authSession || await supabaseDelete(item.id)) setPendingDeletes(getPendingDeletes().filter(d => d.id !== item.id));
}
async function flushPendingDeletes() {
  for (const item of getPendingDeletes()) {
    if (!deleteTimers[item.id]) await finishDelete(item);
  }
}

function deleteReport(id, event) {
  if (event) event.stopPropagation();
  const all = getSavedReports();
  const index = all.findIndex(r => r.id === id);
  const deleted = all[index];
  if (!deleted) return;
  // Always asked: the delete button sits beside the row's tap target, and
  // the account copy goes with it.
  const where = deleted.address || 'this property';
  const finished = deleted.reportData && deleted.reportData.issue;
  const extra = notInAccount(deleted) ? ' It isn\'t in your account yet, so it can\'t be brought back.' : '';
  if (!confirm(finished
    ? `Delete the finished report for ${where}? Its quote and photos go too.${extra}`
    : `Delete the job at ${where}? Its report, quote and photos go too.${extra}`)) return;
  if (!setSavedReports(all.filter(r => r.id !== id))) return;
  const wasOpen = currentReportId === id;
  if (wasOpen) startBlankReport();
  renderSavedList();
  refreshDashboardIfOpen();

  const photos = allReportPhotos(deleted.reportData).filter(p => p.path);
  const item = { id, paths: photos.map(p => p.path), photoIds: photos.map(p => p.id) };
  setPendingDeletes([...getPendingDeletes().filter(d => d.id !== id), item]);
  deleteTimers[id] = setTimeout(() => finishDelete(item), DELETE_UNDO_MS);

  showToast('Report deleted', 'info', { label: 'Undo', run: () => {
    clearTimeout(deleteTimers[id]);
    delete deleteTimers[id];
    setPendingDeletes(getPendingDeletes().filter(d => d.id !== id));
    const reports = getSavedReports();
    if (!reports.some(r => r.id === id)) reports.splice(Math.min(index, reports.length), 0, deleted);
    setSavedReports(reports);
    if (wasOpen) loadReport(id, true);
    renderSavedList();
    refreshDashboardIfOpen();
    showToast('Report restored', 'success');
  } });
}

// Every saved job goes the way one does in deleteReport: off the list now,
// out of the account and photo store once the undo window closes.
function deleteAllReports() {
  const all = getSavedReports();
  if (!all.length) { showToast('There are no saved jobs to delete', 'info'); return; }
  const n = all.length === 1 ? '1 saved job' : `all ${all.length} saved jobs`;
  if (!confirm(`Delete ${n}? Their reports, quotes and photos go from this phone and your account. Your account, business details and prices stay.`)) return;
  if (!setSavedReports([])) return;
  const wasOpen = all.some(r => r.id === currentReportId) ? currentReportId : null;
  startBlankReport();
  renderSavedList();
  refreshDashboardIfOpen();

  const items = all.map(r => {
    const photos = allReportPhotos(r.reportData).filter(p => p.path);
    return { id: r.id, paths: photos.map(p => p.path), photoIds: photos.map(p => p.id) };
  });
  const ids = new Set(items.map(i => i.id));
  setPendingDeletes([...getPendingDeletes().filter(d => !ids.has(d.id)), ...items]);
  items.forEach(item => { deleteTimers[item.id] = setTimeout(() => finishDelete(item), DELETE_UNDO_MS); });

  showToast(all.length === 1 ? 'Job deleted' : `${all.length} jobs deleted`, 'info', { label: 'Undo', run: () => {
    items.forEach(item => { clearTimeout(deleteTimers[item.id]); delete deleteTimers[item.id]; });
    setPendingDeletes(getPendingDeletes().filter(d => !ids.has(d.id)));
    const kept = getSavedReports();
    setSavedReports([...all, ...kept.filter(r => !ids.has(r.id))]);
    if (wasOpen) loadReport(wasOpen, true);
    renderSavedList();
    refreshDashboardIfOpen();
    showToast('Jobs restored', 'success');
  } });
}

// ══════════════════════════════════════════════════════════════════════════
// DATA EXPORT / IMPORT
// ══════════════════════════════════════════════════════════════════════════
// Settings a backup carries. The sign-in, company details and the photo
// store's bookkeeping stay out: the company comes back from the account,
// and a backup must never hold a sign-in someone else could use.
const BACKUP_PREF_KEYS = ['korva_a11y_textsize', 'korva_a11y_contrast', 'korva_a11y_touch',
  'korva_a11y_motion', 'korva_a11y_colorvision', 'korva_audio_capture_enabled', 'korva_telemetry_off'];

async function exportAllData() {
  try {
    const reports = getSavedReports();
    const prefs = {};
    BACKUP_PREF_KEYS.forEach(key => {
      const v = localStorage.getItem(key);
      if (v !== null) prefs[key] = v;
    });

    // Photos aren't in localStorage, so add each saved report's images.
    const photos = {};
    for (const r of reports) {
      for (const p of allReportPhotos(r.reportData)) {
        if (photos[p.id]) continue;
        const blob = await getPhotoImage(p);
        if (blob) photos[p.id] = await blobToDataUrl(blob);
      }
    }

    const backup = { app: 'SAYON', exportedAt: new Date().toISOString(), version: 2, reports, prefs, photos };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `sayon_backup_${todayIsoDate()}.json`);

    showToast(`Downloaded a copy of ${reports.length} saved report${reports.length === 1 ? '' : 's'} and your settings`, 'success');
  } catch (e) {
    console.error('Export failed', e);
    reportError(e, 'export');
    showToast("Couldn't download a copy. Try again", 'error');
  }
}

// The reports in a backup. Version 2 lists them; version 1 copied every
// korva_ key, so its reports sit under whichever account's key it was made on.
function backupReports(backup) {
  if (Array.isArray(backup.reports)) return backup.reports;
  const data = backup.data || {};
  const found = [];
  Object.keys(data).forEach(key => {
    if (!/^(korva_saved_reports(_.+)?|termiteai_saved_reports)$/.test(key)) return;
    try { const list = JSON.parse(data[key] || '[]'); if (Array.isArray(list)) found.push(...list); } catch (e) {}
  });
  return found;
}

// Adds a backup's reports to the phone's. Where both have the same report,
// the newer copy is kept, so a restore never undoes later work.
function mergeBackupReports(existing, incoming) {
  const byId = new Map(existing.map(r => [r.id, r]));
  let added = 0, updated = 0;
  incoming.forEach(r => {
    if (!r || !r.id || !r.reportData) return;
    const mine = byId.get(r.id);
    if (!mine) { byId.set(r.id, r); added++; }
    else if ((r.savedAt || 0) > (mine.savedAt || 0)) { byId.set(r.id, r); updated++; }
  });
  return { reports: [...byId.values()], added, updated };
}

function importAllData(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    let backup;
    try {
      backup = JSON.parse(e.target.result);
    } catch (err) {
      showToast('That file isn\'t valid — could not read it', 'error');
      return;
    }

    if (!backup || typeof backup !== 'object' || !(backup.data || backup.reports) || !['SAYON','KORVUS'].includes(backup.app)) {
      showToast('That doesn\'t look like a SAYON backup file', 'error');
      return;
    }

    const incoming = backupReports(backup);
    const existing = getSavedReports();
    if (existing.length && !confirm(
      `This copy has ${incoming.length} report${incoming.length === 1 ? '' : 's'}. ` +
      `You have ${existing.length} on this phone.\n\n` +
      `Add the copy's reports to yours? Nothing on this phone is removed, and where both have the same report the newer one is kept.`
    )) return;

    try {
      const { reports, added, updated } = mergeBackupReports(existing, incoming);
      if (!setSavedReports(reports)) return;
      Object.entries(backup.photos || {}).forEach(([id, dataUrl]) => {
        const blob = dataUrlToBlob(dataUrl);
        if (blob) putPhotoBlob(id, blob).catch(() => {});
      });
      // Restored reports go to the account too, so they're on every device.
      reports.filter(r => incoming.some(i => i && i.id === r.id && i.savedAt === r.savedAt)).forEach(r => supabaseSave(r));

      // Settings only, from the allow-list. Never the sign-in or the draft.
      const prefs = backup.prefs || backup.data || {};
      BACKUP_PREF_KEYS.forEach(key => {
        if (typeof prefs[key] === 'string') { try { localStorage.setItem(key, prefs[key]); } catch (err) {} }
      });

      renderSavedList();
      restoreA11ySettings();
      restoreAudioCaptureSetting();
      restoreTelemetrySetting();
      const parts = [];
      if (added) parts.push(`${added} added`);
      if (updated) parts.push(`${updated} updated`);
      showToast(parts.length ? `Restored from the copy: ${parts.join(', ')}` : 'Your reports were already up to date', 'success');
    } catch (err) {
      console.error('Import failed', err);
      reportError(err, 'import');
      showToast("Couldn't restore that copy. Check it's a SAYON download", 'error');
    }
  };

  reader.onerror = () => showToast('Could not read that file', 'error');
  reader.readAsText(file);

  // Reset the file input so the same file can be re-selected later if needed
  document.getElementById('importFileInput').value = '';
}

// ══════════════════════════════════════════════════════════════════════════
// ACCESSIBILITY SETTINGS
// ══════════════════════════════════════════════════════════════════════════
function setTextSize(size) {
  document.body.classList.remove('text-size-large', 'text-size-xl');
  if (size === 'large') document.body.classList.add('text-size-large');
  if (size === 'xl') document.body.classList.add('text-size-xl');

  document.querySelectorAll('#textSizeControl .text-size-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.size === size);
  });

  try { localStorage.setItem('korva_a11y_textsize', size); } catch (e) {}
}

function toggleA11y(className, btnId, storageKey) {
  const on = document.body.classList.toggle(className);
  const btn = document.getElementById(btnId);
  if (btn) btn.classList.toggle('on', on);
  try { localStorage.setItem(storageKey, on ? '1' : '0'); } catch (e) {}
}

const COLOUR_VISION_ACCENTS = {
  protanopia:    { accent: '#4d8aff', accent2: '#7aa8ff', accent3: '#2f5fd6', rgb: '77,138,255' }, // blue — stays distinct from lime/amber for red-green deficiency
  deuteranopia:  { accent: '#4d8aff', accent2: '#7aa8ff', accent3: '#2f5fd6', rgb: '77,138,255' }, // blue — same reasoning, most common type
  tritanopia:    { accent: '#ff4dc4', accent2: '#ff7dd6', accent3: '#d62fa0', rgb: '255,77,196' }, // magenta — stays distinct from red/green for blue-yellow deficiency
};

function setColourVisionMode(mode) {
  const colours = COLOUR_VISION_ACCENTS[mode];
  const root = document.documentElement.style;
  // The default blue lives in the stylesheet (light and dark differ), so
  // "none" clears the override rather than setting a colour of its own.
  if (!colours) ['--accent', '--accent2', '--accent3', '--accent-rgb'].forEach(k => root.removeProperty(k));
  else {
    root.setProperty('--accent', colours.accent);
    root.setProperty('--accent2', colours.accent2);
    root.setProperty('--accent3', colours.accent3);
    root.setProperty('--accent-rgb', colours.rgb);
  }
  try { localStorage.setItem('korva_a11y_colorvision', mode); } catch (e) {}
}

function restoreA11ySettings() {
  try {
    const textSize = localStorage.getItem('korva_a11y_textsize');
    if (textSize && textSize !== 'normal') setTextSize(textSize);

    if (localStorage.getItem('korva_a11y_contrast') === '1') {
      document.body.classList.add('high-contrast');
      document.getElementById('toggleHighContrast').classList.add('on');
    }
    if (localStorage.getItem('korva_a11y_touch') === '1') {
      document.body.classList.add('large-touch');
      document.getElementById('toggleLargeTouch').classList.add('on');
    }
    if (localStorage.getItem('korva_a11y_motion') === '1') {
      document.body.classList.add('reduce-motion');
      document.getElementById('toggleReduceMotion').classList.add('on');
    }
    const cvd = localStorage.getItem('korva_a11y_colorvision');
    if (cvd && cvd !== 'none') {
      setColourVisionMode(cvd);
      const sel = document.getElementById('colourVisionSelect');
      if (sel) sel.value = cvd;
    }
  } catch (e) {}
}

// A new job starts with the inspector's name and licence from the most
// recent saved report on this account, so the sign-off isn't retyped on
// every job.
function lastInspectorDetails() {
  const latest = getSavedReports()
    .filter(r => r.inspector || (r.reportData && r.reportData.inspectorLicence))
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))[0];
  return {
    name: latest ? latest.inspector || '' : '',
    licence: latest && latest.reportData ? latest.reportData.inspectorLicence || '' : '',
  };
}

function newReport() {
  saveOpenReportNow();
  track('report_started');
  startBlankReport();
  refreshDashboardIfOpen();
  showToast('New report started', 'info');
}

// Empties the screen for a new job. Doesn't save the one that was open.
function startBlankReport() {
  // Before the reset, so the banners it redraws don't show the last job's
  // quote and certificate.
  if (!currentReportId && typeof forgetDraftQuote === 'function') forgetDraftQuote();
  clearFilledNotes();
  currentReportId = null;
  resetReportState();
  document.getElementById('jobAddress').value = '';
  document.getElementById('jobSuburb').value = '';
  document.getElementById('jobState').value = '';
  document.getElementById('jobPostcode').value = '';
  document.getElementById('jobClient').value = '';
  const lastInspector = lastInspectorDetails();
  document.getElementById('jobInspector').value = lastInspector.name;
  if (lastInspector.licence) reportData.inspectorLicence = lastInspector.licence;
  restoreLicenceField();
  updateJob();
  clearDraft();
  lastReportSig = reportSig();
  showSection('property');
}

function resetReportState() {
  reportData = {};
  speechTimeline = [];
  setAI('ready', 'AI ready');
  fieldNotes = {};
  pendingSpeciesMatch = null;
  clearJobInfo();
  const confirm = document.getElementById('speciesConfirm');
  const intel = document.getElementById('speciesIntel');
  if (confirm) confirm.style.display = 'none';
  if (intel) intel.style.display = 'none';
  // Clear all field displays. Every field-val, not just the ones counted in
  // SECTIONS, so detail fields (leak location, borer details, etc.) don't
  // carry the previous report's text into the next one.
  document.querySelectorAll('.field-val[id^="f-"]').forEach(el => {
    const key = el.id.replace('f-', '');
    el.classList.remove('filled', 'flash');
    el.innerHTML = '—';
    // Remove edited-dot indicators
    const label = getFieldLabel(el);
    if (label) {
      const dot = label.querySelector('.edited-dot');
      if (dot) dot.remove();
    }
    // Clear notes
    const ta = document.getElementById('notes-text-' + key);
    if (ta) ta.value = '';
    const panel = document.getElementById('notes-' + key);
    if (panel) panel.classList.remove('open');
    updateNotesIndicator(key);
  });
  updateProgress();
  const banner = document.getElementById('asbestosBanner');
  if (banner) banner.style.display = 'none';
  checkFindingsGate();
  checkSystemVerify();
  checkSecondaryColonyFlag();
  ensureTreatmentForLiveTermites();
  if (inspectorSignaturePad) inspectorSignaturePad.clear();
  setInspectorSignatureStatus(false);
  renderAgreementBanner();
  renderReportWidgets();
  renderFindingsUI();
  setStandard('AS 3660.2-2017');
}

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
}

// Opens the open job's details, on its page.
function openJobDetails() {
  if (document.getElementById('dashboardOverlay').classList.contains('open')) closeDashboard();
  jobGo('details');
}

function refreshDashboardIfOpen() {
  if (document.getElementById('dashboardOverlay').classList.contains('open')) renderDashboard();
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
const DASHBOARD_TABS = [['todo', 'To do'], ['waiting', 'Waiting'], ['done', 'Done']];

// Job details sit on the job's page. Before a page redraws, the panel goes
// back to its holder, so its fields survive the redraw.
function parkJobPanel() {
  const panel = document.getElementById('jobPanel');
  const home = document.getElementById('jobPanelHome');
  if (panel && home && panel.parentNode !== home) home.appendChild(panel);
}

// The day a job belongs to: its inspection date, else when it was saved.
function dashboardJobTime(r) {
  const d = r.reportData || {};
  const iso = d.jobInspectionDate || (d.agreement && d.agreement.inspectionDate);
  const t = iso ? new Date(iso + 'T00:00:00').getTime() : NaN;
  return isNaN(t) ? r.savedAt : t;
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
  const reportDone = reportSent || !!d.pdfAt || (r.completion || 0) >= 100;
  const needsQuote = d.treatmentRecommended === 'YES';
  const total = hasQuote ? quoteTotals(q).total : 0;
  const who = (r.client || '').trim() || 'the client';
  let group, status, hint = '', next = null;
  if (!reportDone) {
    group = 'todo'; status = 'Finish the report';
    hint = 'Fill in the rest of the report, then make the PDF from the Sign-Off page.';
    next = { label: 'Open report', to: 'report' };
  } else if (!hasQuote && needsQuote) {
    group = 'todo'; status = 'Write the quote';
    hint = 'The report recommends a treatment. Price the work for ' + who + '.';
    next = { label: 'Write the quote', to: 'quote' };
  } else if (!hasQuote) {
    group = reportSent ? 'done' : 'todo';
    status = reportSent ? 'No quote needed' : 'Send the report';
    hint = reportSent ? 'The report has gone to ' + who + ' and no treatment was recommended.' : 'The report is ready. Send it to ' + who + '.';
    if (!reportSent) next = { label: 'Open report', to: 'report' };
  } else if (!a) {
    group = q.sentAt ? 'waiting' : 'todo';
    status = q.sentAt ? `Quote sent ${dashDate(q.sentAt)}` : 'Send the quote';
    hint = q.sentAt ? 'Waiting on ' + who + '. When they answer, record it on the quote.' : 'The quote is priced. Send it to ' + who + '.';
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

  // A baiting system keeps the job going: back to To do when a station
  // check is due or a visit report hasn't gone, Waiting between visits.
  const bait = typeof baitProgram === 'function' ? baitProgram(q) : null;
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
      group = 'waiting'; status = `Bait check due ${dashDay(bait.due)}`;
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
      text: d.issue ? `Completed${sentOn ? ' ' + dashDate(sentOn) : ''}` : d.sent ? `Sent ${dashDate(d.sent.at)}`
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
  steps.forEach(s => { if (s.state === 'skip') s.text = 'Not needed'; });
  // Each step just says whether it's done; the preview has the detail. A declined answer keeps its wording.
  steps.forEach(s => { if (s.state === 'done' || s.state === 'todo') s.text = s.state === 'done' ? 'Completed' : 'Not completed'; });
  // Recorded but the certificate hasn't gone: the treatment isn't finished.
  if (q && q.treatment && !certificateGiven(q) && steps[3].state === 'done') Object.assign(steps[3], { state: 'now', text: 'Certificate not emailed yet' });
  // Bait station visits, as a fifth stage once a baiting system is in.
  if (bait) {
    const st = baitJobStep(bait);
    if (bait.last && !bait.last.sentAt) Object.assign(st, { state: 'now', text: 'Visit report not emailed yet' });
    steps.push(st);
  }
  if (group !== 'done' && !steps.some(s => s.state === 'now')) { const s = steps.find(s => s.state === 'todo'); if (s) s.state = 'now'; }
  return { r, q, group, status, hint, next, steps, total, time: dashboardJobTime(r) };
}

// A ring of four arcs, one per step, filled as the job moves along.
function dashboardRing(steps, group) {
  const C = 2 * Math.PI * 15, seg = C / steps.length, gap = 3.2;
  const arcs = steps.map((s, i) => `<circle cx="18" cy="18" r="15" class="${s.state}" stroke-dasharray="${(seg - gap).toFixed(2)} ${(C - seg + gap).toFixed(2)}" stroke-dashoffset="${(-(i * seg) - gap / 2).toFixed(2)}"/>`).join('');
  // A step the job didn't need counts as done, so a job with no quote still fills.
  const done = steps.filter(s => s.state === 'done' || s.state === 'skip').length;
  const mid = group === 'done'
    ? '<path d="m12.5 18.5 3.5 3.5 7-8" class="tick"/>'
    : `<text x="18" y="18" dy="0.35em" text-anchor="middle">${done}/${steps.length}</text>`;
  return `<svg class="dash-ring" width="36" height="36" viewBox="0 0 36 36" aria-hidden="true"><g transform="rotate(-90 18 18)">${arcs}</g>${mid}</svg>`;
}

function setDashboardTab(tab) {
  dashboardTab = tab;
  const search = document.getElementById('dashboardSearch');
  if (search) search.value = '';
  renderDashboardJobs(true);
}

function renderDashboard() {
  const body = document.getElementById('dashboardBody');
  if (!body) return;
  parkJobPanel();
  const quotes = getSavedQuotes();
  dashboardJobs = getSavedReports().map(r => dashboardJob(r, quotes)).sort((a, b) => b.time - a.time);
  const need = dashboardJobs.filter(j => j.group === 'todo').length;
  const today = new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
  const lead = !dashboardJobs.length ? 'Your jobs will show up here once you save a report.'
    : need ? `<b>${need} job${need === 1 ? '' : 's'}</b> need${need === 1 ? 's' : ''} you today.`
    : 'You\'re all caught up.';

  body.innerHTML = `
    <div class="dash-hero">
      <span class="dash-hero-date">${today}</span>
      <p class="dash-hero-title">${lead}</p>
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
  const searchEl = document.getElementById('dashboardSearch');
  const query = searchEl ? searchEl.value.trim().toLowerCase() : '';
  const shown = dashboardJobs.filter(j => query
    ? [j.r.address, j.r.client, j.r.jobSuburb, j.r.jobPostcode].filter(Boolean).join(' ').toLowerCase().includes(query)
    : dashboardTab === 'all' || j.group === dashboardTab);

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
  wrap.innerHTML = shown.length ? `
    <div class="dash-list${fade ? ' fade-in' : ''}">
      ${shown.map(j => `
        <button type="button" class="dash-row ${j.group}" onclick="openDashboardDetail('${j.r.id}')">
          ${dashboardRing(j.steps, j.group)}
          <span class="dash-row-text">
            <span class="dash-row-addr">${escapeHtml(j.r.address || 'No address')}</span>
            <span class="dash-row-sub"><span class="dash-row-status">${escapeHtml(j.status)}</span>${j.r.client ? ' · ' + escapeHtml(j.r.client) : ''}</span>
          </span>
          <span class="dash-row-end">
            <span class="dash-row-total">${j.total ? formatAUD(j.total).replace(/\.00$/, '') : ''}</span>
            <span class="dash-row-date">${dashDate(j.time)}</span>
          </span>
          <svg class="icon dash-row-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
        </button>`).join('')}
    </div>` : `<p class="dash-none${fade ? ' fade-in' : ''}">${empty}</p>`;
}

// One job's timeline and its next step, in a sheet over the list.
function openDashboardDetail(id) {
  const j = dashboardJobs.find(x => x.r.id === id);
  const sheet = document.getElementById('dashboardDetailSheet');
  if (!j || !sheet) return;
  const group = (DASHBOARD_TABS.find(([k]) => k === j.group) || [, ''])[1];
  const done = j.steps.filter(s => s.state === 'done' || s.state === 'skip').length;
  const icon = (d) => `<svg class="icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const dot = (s, i) => s.state === 'done' ? icon('<path d="M20 6 9 17l-5-5"/>')
    : s.state === 'bad' ? icon('<path d="M18 6 6 18"/><path d="M6 6l12 12"/>') : s.state === 'skip' ? '–' : i + 1;
  const facts = [
    ['Client', j.r.client || 'Not entered'],
    ['Quote', j.total ? formatAUD(j.total).replace(/\.00$/, '') : 'None yet'],
    ['Date', dashDate(j.time)],
  ];
  sheet.innerHTML = `
    <div class="dash-detail-grab" aria-hidden="true"></div>
    <div class="dash-detail-head">
      <div class="dash-detail-head-text">
        <span class="dash-detail-chip ${j.group}">${group}</span>
        <h3 class="dash-detail-addr">${escapeHtml(j.r.address || 'No address')}</h3>
      </div>
      <button type="button" class="dash-detail-close" onclick="closeDashboardDetail()" aria-label="Close">
        <svg class="icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>
      </button>
    </div>
    <dl class="dash-detail-facts">
      ${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}
    </dl>
    <section class="dash-next ${j.group}">
      <div class="dash-next-label">${j.next ? 'Next step' : 'Where it\'s at'}</div>
      <div class="dash-next-title">${escapeHtml(j.status)}</div>
      ${j.hint ? `<p class="dash-next-hint">${escapeHtml(j.hint)}</p>` : ''}
      ${j.next ? `<button type="button" class="dash-detail-primary" onclick="openDashboardJob('${j.r.id}', '${j.next.to}')">${j.next.label}</button>` : ''}
    </section>
    <div class="dash-detail-section">
      <span>Progress</span><span>${done} of ${j.steps.length} done</span>
    </div>
    <ol class="dash-timeline">
      ${j.steps.map((s, i) => `
        <li class="${s.state}">
          <span class="dash-timeline-dot" aria-hidden="true">${dot(s, i)}</span>
          <button type="button" class="dash-timeline-btn" onclick="openDashboardPeek('${j.r.id}', '${s.to}')">
            <span class="dash-timeline-label">${s.label}</span>
            <span class="dash-timeline-text">${escapeHtml(s.text)}</span>
            <svg class="icon dash-timeline-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          </button>
        </li>`).join('')}
    </ol>
    <div class="dash-detail-foot">
      <button type="button" class="dash-detail-delete" onclick="closeDashboardDetail(); deleteReport('${j.r.id}')">
        <svg class="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Delete this job
      </button>
    </div>
  `;
  sheet.scrollTop = 0;
  document.getElementById('dashboardDetail').classList.add('open');
}

// A step opens as a small preview over the dashboard: what that section
// holds, read-only, with a button to open it full screen. On a wide screen
// the sheet sits at the side, so the job list stays in view.
const DASH_PEEK_TITLES = { report: 'Report', quote: 'Quote', answer: 'Client\'s answer', treatment: 'Treatment', bait: 'Bait station visits' };
const DASH_PEEK_OPEN = { report: 'Open the report', quote: 'Open the quote', answer: 'Open the quote', treatment: 'Open the treatment record', bait: 'Open the visits' };

function openDashboardPeek(id, to) {
  const j = dashboardJobs.find(x => x.r.id === id);
  const sheet = document.getElementById('dashboardDetailSheet');
  if (!j || !sheet) return;
  const step = j.steps.find(s => s.to === to);
  const expand = '<svg class="icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/></svg>';
  sheet.innerHTML = `
    <div class="dash-detail-grab" aria-hidden="true"></div>
    <div class="dash-peek-bar">
      <button type="button" class="dash-peek-back" onclick="openDashboardDetail('${id}')">
        <svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>Job
      </button>
      <button type="button" class="dash-peek-full" onclick="openDashboardJob('${id}', '${to}')" aria-label="Full screen">${expand}Full screen</button>
    </div>
    <div class="dash-peek-kicker">${escapeHtml(j.r.address || 'No address')}</div>
    <h3 class="dash-peek-title">${DASH_PEEK_TITLES[to]}</h3>
    ${step ? `<div class="dash-peek-status ${step.state}">${escapeHtml(step.text)}</div>` : ''}
    <div class="dash-peek-body">${dashboardPeekBody(j, to)}</div>
    <div class="dash-detail-actions">
      <button type="button" class="dash-detail-primary" onclick="openDashboardJob('${id}', '${to}')">${DASH_PEEK_OPEN[to]}</button>
    </div>`;
  sheet.scrollTop = 0;
  document.getElementById('dashboardDetail').classList.add('open');
}

function dashPeekRows(rows) {
  const shown = rows.filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '');
  return shown.length ? `<dl class="dash-peek-rows">${shown.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`).join('')}</dl>` : '';
}

function dashboardPeekBody(j, to) {
  const d = j.r.reportData || {};
  const q = j.q;
  const none = (t) => `<p class="dash-peek-none">${escapeHtml(t)}</p>`;
  if (to === 'report') {
    const findings = (Array.isArray(d.findings) ? d.findings : []).filter(f => f && f.termiteActivity);
    const borers = (Array.isArray(d.borerFindings) ? d.borerFindings : []).filter(f => f && f.borerActivity);
    const ag = d.agreement;
    const list = [
      ...findings.map((f, i) => [`Termites ${i + 1}`, [f.termiteActivity, f.activityLocation].filter(Boolean).join(' · ')]),
      ...borers.map((f, i) => [`Borers ${i + 1}`, [f.borerActivity, f.location].filter(Boolean).join(' · ')]),
    ];
    if (d.decayFound === 'YES') list.push(['Wood decay', d.decayWhere || 'Found']);
    return dashPeekRows([
      ['Inspection', d.inspectionType],
      ['Filled in', `${j.r.completion || 0}%`],
      ['Agreement', ag ? `Signed by ${ag.signerName || 'the client'}` : 'Not signed yet'],
      ['Treatment', d.treatmentRecommended === 'YES' ? (d.treatmentType || 'Recommended') : d.treatmentRecommended === 'NO' ? 'Not recommended' : ''],
    ]) + (list.length ? `<div class="dash-peek-sub">Findings</div>${dashPeekRows(list)}`
      : `<div class="dash-peek-sub">Findings</div>${none('No termite or borer findings recorded.')}`);
  }
  if (!quoteHasItems(q)) return none(to === 'quote' ? 'No quote written yet.' : 'There\'s no quote for this job yet.');
  if (to === 'quote') {
    const t = quoteTotals(q);
    return `${q.number ? `<div class="dash-peek-num">Quote ${escapeHtml(q.number)}</div>` : ''}
      <ul class="dash-peek-lines">${q.items.map(it => `<li><span>${escapeHtml(it.desc || 'Line')}</span><strong>${formatAUD(lineTotal(it))}</strong></li>`).join('')}</ul>
      <ul class="dash-peek-lines dash-peek-totals">${q.gst !== false ? `<li><span>GST</span><strong>${formatAUD(t.gst)}</strong></li>` : ''}<li class="grand"><span>Total</span><strong>${formatAUD(t.total)}</strong></li></ul>`;
  }
  if (to === 'answer') {
    const a = quoteAnswerState(q);
    if (!a) return none(q.sentAt ? 'Waiting on the client.' : 'The quote hasn\'t been sent yet.');
    return dashPeekRows([
      ['Answer', a.status === 'accepted' ? 'Accepted' : 'Declined'],
      ['By', a.by], ['Date', formatAnswerDate(a.date)],
      ['How', a.status === 'accepted' ? (QUOTE_ANSWER_METHODS[a.method] || '') : ''],
      ['Note', a.note],
    ]) + (isSignatureImage(a.signature) ? `<img class="dash-peek-sig" src="${a.signature}" alt="Client signature">` : '')
      + (a.stale ? '<p class="dash-peek-warn">The quote changed after they answered.</p>' : '');
  }
  if (to === 'bait') {
    const b = typeof baitProgram === 'function' ? baitProgram(q) : null;
    if (!b) return none('No baiting system on this job.');
    const rows = b.visits.slice().reverse().slice(0, 6).map((v, i) => [`${formatAnswerDate(v.date)}`, `${baitVisitShort(v)}${v.sentAt ? '' : ' · report not sent'}`]);
    return dashPeekRows([
      ['Stations', String(parseInt(q.treatment.methods.bait, 10) || (b.last ? (b.last.stations || []).length : '') || '')],
      ['Next visit', b.finished ? 'None, baiting finished' : b.due ? `${formatAnswerDate(b.due)}${b.overdue ? ' (overdue)' : ''}` : ''],
      ...rows,
    ]) || none('No visits recorded yet.');
  }
  const t = q.treatment;
  if (!t) return none('No treatment recorded yet.');
  return dashPeekRows([
    ['Date', formatAnswerDate(t.date)],
    ['Technician', t.technician],
    ['Pest', t.pest],
    ['Work', Object.keys(t.methods || {}).map(k => (TREATMENT_METHODS[k] || {}).label || k).join(', ')],
    ['Products', (t.products || []).map(p => p.name).filter(Boolean).join(', ')],
    ['Areas', t.areas],
    ['Certificate', q.certificateSentAt ? `Sent ${dashDate(q.certificateSentAt)}` : q.certificateHandedAt ? `Given in person ${dashDate(q.certificateHandedAt)}` : 'Not sent yet'],
  ]);
}

function closeDashboardDetail() {
  const el = document.getElementById('dashboardDetail');
  if (el) el.classList.remove('open');
}

// Opens a job from the dashboard: its report, its quote, or straight into
// recording the treatment.
// Every step opens in any order: report, quote, the client's answer (the
// quote, scrolled to it) or the treatment record.
function openDashboardJob(id, to) {
  closeDashboard();
  loadReport(id);
  jobGo(to);
}

const SAVED_EMPTY_HTML = `<div class="empty-state">
    <p>No saved reports yet. A report saves itself here once it has an address.</p>
    <button class="job-action-btn" onclick="toggleDrawer()">Back to the report</button>
  </div>`;

function renderSavedList() {
  const list = document.getElementById('savedList');
  const allReports = getSavedReports();
  const summary = document.getElementById('savedPanelSummary');

  const archived = getArchivedReportIds().length;
  const archivedNote = archived
    ? `<div class="saved-archived">${archived} older job${archived === 1 ? ' is' : 's are'} kept in your account only. <button class="link-btn" onclick="restoreArchivedReports()">Bring ${archived === 1 ? 'it' : 'them'} back</button></div>`
    : '';
  if (allReports.length === 0) {
    list.innerHTML = SAVED_EMPTY_HTML + archivedNote;
    if (summary) summary.textContent = 'None saved';
    return;
  }

  if (summary) summary.textContent = `${allReports.length} saved`;

  const searchEl = document.getElementById('savedSearchInput');
  const query = searchEl ? searchEl.value.trim().toLowerCase() : '';

  let reports = allReports;
  if (query) {
    reports = allReports.filter(r => {
      const haystack = [r.address, r.client, r.jobSuburb, r.jobPostcode, r.inspector]
        .filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }

  // Sort newest first
  reports.sort((a, b) => b.savedAt - a.savedAt);

  if (reports.length === 0) {
    list.innerHTML = `<div class="saved-empty">No matches for "${escapeHtml(searchEl.value.trim())}"</div>`;
    return;
  }

  list.innerHTML = reports.map(r => {
    const date = new Date(r.savedAt);
    const dateStr = date.toLocaleDateString('en-AU', { day:'numeric', month:'short' });
    const risk = r.reportData.riskLevel || 'none';
    const addr = (r.address || 'Untitled property') + (r.conflictCopy ? ' (copy from this phone)' : '');
    const pending = (r.reportData.pendingNotes || []).length;
    const status = savedReportStatus(r);
    const statusTag = `<span class="saved-item-status ${status.tone}">${status.label}</span>`;
    const answer = quoteAnswerSummary(getSavedQuotes()[r.id] || r.quote);
    const answerTag = answer ? `<span class="saved-item-quote ${answer.tone}">${answer.short}</span>` : '';
    return `
      <div class="saved-item" onclick="loadReport('${r.id}')">
        <div class="saved-item-info">
          <div class="saved-item-address">${escapeHtml(addr)}</div>
          <div class="saved-item-meta">
            <span>${dateStr}</span>
            <span class="saved-item-risk ${risk}">${risk === 'none' ? 'N/A' : risk}</span>
            ${statusTag}
            ${answerTag}
            ${pending ? `<span class="saved-item-pending">${pending} note${pending !== 1 ? 's' : ''} to fill in</span>` : ''}
            ${notInAccount(r) ? '<span class="saved-item-unsynced">Not in your account yet</span>' : ''}
          </div>
        </div>
        <button class="saved-item-delete" onclick="deleteReport('${r.id}', event)" title="Delete">✕</button>
      </div>
    `;
  }).join('') + archivedNote;
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
  t._timeout = setTimeout(() => t.classList.remove('show'), (type === 'error' || action) ? 6000 : 2800);
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
  const ids = ['app', 'mainMenu', 'quoteScreen', 'sidebarPanel', 'dashboardOverlay'];
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

// ── COMPLETED JOBS ────────────────────────────────────────────────────────
// Nothing locks until the whole job is done: the report is signed and sent,
// the quote is sent (or marked not needed), and the inspector taps "Complete
// job". Then the report and its quote lock together, so what's saved always
// matches what the client received. Changing anything afterwards means
// "Amend" with a reason; sending again and completing again makes it
// version 2, and the PDF lists every version with its reason.
//   reportData.reportNumber  stable reference printed on every PDF
//   reportData.sent          { at, fingerprint, version } - last send
//   reportData.issue         { version, completedAt, completedBy, fingerprint, fieldHashes }
//   reportData.issueHistory  [{ version, completedAt, completedBy, reason, changed[], fingerprint }]
//   reportData.amending      { reason, startedAt } - unlocked for an amendment
//   reportData.noQuoteNeeded true when the job needs no quote
// The quote's own sent state lives on the quote (see SENT AND LOCKED in js/quote.js).
const ISSUE_META_KEYS = ['reportNumber', 'sent', 'issue', 'issueHistory', 'amending', 'pendingNotes', 'noQuoteNeeded', 'noteText', 'weatherFilled'];
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
function reportContentParts() {
  const parts = {};
  Object.keys(reportData).forEach(k => { if (!ISSUE_META_KEYS.includes(k)) parts[k] = reportData[k]; });
  parts.job = ['jobAddress','jobSuburb','jobState','jobPostcode','jobClient','jobInspector']
    .map(id => (document.getElementById(id) || {}).value || '');
  return parts;
}
function reportFingerprint() { return sha256Hex(stableJson(reportContentParts())); }
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
    if ((before || {})[k] === (after || {})[k]) return;
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
  if (rd.waterLeaks === 'YES') conducive.push(`water leak${rd.leakLocation ? ` (${rd.leakLocation})` : ''}`);
  else if (rd.moistureReadings === 'YES') conducive.push('elevated moisture');
  if (rd.timberSoil === 'YES') conducive.push('timber in contact with soil');
  if (rd.weepHoles === 'BRIDGED') conducive.push('weep holes bridged');
  if (rd.antCapping === 'GAPS') conducive.push('gaps in the ant capping');
  else if (rd.antCapping === 'NONE') conducive.push('no ant capping on piers');
  if (rd.slabEdge === 'OBSTRUCTED') conducive.push('slab edge concealed');
  if (rd.subfloorVentilation === 'POOR') conducive.push('poor subfloor ventilation');
  if (rd.mouldSeen === 'YES') conducive.push(`mould growth${rd.mouldWhere ? ` (${rd.mouldWhere})` : ''}`);
  if (rd.siteDrainage === 'POOR') conducive.push('poor site drainage');
  if (rd.subfloorDrainage === 'POOR') conducive.push('poor subfloor drainage');
  if (rd.nonDurableTimber === 'YES') conducive.push(`untreated or non-durable timber in a damp area${whatWhere(rd.nonDurableTimberDetails, rd.nonDurableTimberWhere) ? ` (${whatWhere(rd.nonDurableTimberDetails, rd.nonDurableTimberWhere)})` : ''}`);
  return conducive;
}

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
  const places = list => list.map(f => f.activityLocation).filter(Boolean).join('; ');
  const NR = 'NOT RECORDED';
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
        acc.hindered.filter(([l]) => OBS_ZONES_BY_LABEL[l]).map(([l]) => l).join(', ')],
      ['Was access restricted (permanent or locked)?', yn(restrictedYes, acc.allMarked), ynTone(restrictedYes, acc.allMarked, 'warn'), REPORT_PARTS.access,
        acc.restricted.filter(([l]) => OBS_ZONES_BY_LABEL[l]).map(([l]) => l).join(', ')],
      ['High risk areas to which access should be gained?', yn(!!acc.highRisk, acc.allMarked), ynTone(!!acc.highRisk, acc.allMarked, 'warn'), REPORT_PARTS.access, acc.highRisk],
      ['Invasive inspection recommended?', { YES: 'YES', NO: 'NO' }[reportData.invasiveInspection] || NR,
        { YES: 'warn', NO: 'good' }[reportData.invasiveInspection] || 'none', REPORT_PARTS.access, reportData.invasiveInspectionDetails || ''],
    ] },
    { title: 'Activity', items: [
      ['Live termites found?', live.length ? 'YES' : fs.length ? 'NO' : NR, live.length ? 'bad' : fs.length ? 'good' : 'none', REPORT_PARTS.findings, places(live)],
      ['Termite nest found?', withNest.length ? 'YES' : nestNo ? 'NO' : NR, withNest.length ? 'bad' : nestNo ? 'good' : 'none', REPORT_PARTS.findings, places(withNest)],
      ['Termite workings or damage found?', damaged.length ? 'YES' : fs.length ? 'NO' : NR, damaged.length ? 'warn' : fs.length ? 'good' : 'none', REPORT_PARTS.findings, places(damaged)],
      ['Borers found?', { ACTIVE: 'ACTIVE', INACTIVE: 'OLD DAMAGE', NONE: 'NO' }[reportData.borerActivity] || NR,
        { ACTIVE: 'bad', INACTIVE: 'warn', NONE: 'good' }[reportData.borerActivity] || 'none', REPORT_PARTS.findings, shownBorerFindings().map(b => b.location || borerLine(b)).filter(Boolean).join('; ')],
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
      ['Termite treatment recommended?', { YES: 'YES', NO: 'NO' }[reportData.treatmentRecommended] || NR,
        { YES: 'bad', NO: 'good' }[reportData.treatmentRecommended] || 'none', REPORT_PARTS.recommendations, reportData.treatmentType || ''],
      ['Risk of termite attack', reportData.riskLevel || NR, { HIGH: 'bad', MEDIUM: 'warn', LOW: 'good' }[reportData.riskLevel] || 'none', REPORT_PARTS.recommendations,
        reportData.riskLevel && basis.length ? `Based on ${basis.join(', ')}` : ''],
      ['Next inspection', nextInspectionChip(reportData.inspectionFrequency), 'none', REPORT_PARTS.recommendations,
        reportData.inspectionFrequency && nextInspectionChip(reportData.inspectionFrequency) !== String(reportData.inspectionFrequency).trim().toUpperCase() ? reportData.inspectionFrequency : ''],
    ] },
  ];
  // Areas the inspector couldn't fully see, and why.
  const limited = limitedZones.map(z => {
    const why = ((reportData.areaReasons || {})[z] || []).join(', ');
    return `${OBS_ZONES[z].label}: ${areaStatusOf(z) === 'NOT' ? 'not inspected' : 'inspected with limits'}${why ? ` (${why})` : ''}`;
  });
  const next = [];
  if (live.length || reportData.treatmentRecommended === 'YES') {
    next.push(`Termite treatment${reportData.treatmentType ? `: ${reportData.treatmentType}` : ` (see Section ${REPORT_PARTS.recommendations})`}.`);
  }
  if (structural) {
    const what = termiteReferral && borerReferral ? 'termite and borer damage' : termiteReferral ? 'termite damage' : 'borer damage';
    next.push(`Have a licensed builder or structural engineer assess the ${what} before any repairs.`);
  }
  if (reportData.borerActivity === 'ACTIVE') next.push('Treat the active borers and replace badly affected timbers.');
  if (reportData.decayFound === 'YES') next.push('Have a builder repair the decayed timbers, and fix the moisture that caused the decay.');
  if (reportData.delignification === 'YES') next.push('Have a builder check and replace the delignified timbers where needed.');
  if (conducive.length) next.push(`Fix the conditions that attract termites: ${conducive.join('; ')}.`);
  if (reportData.invasiveInspection === 'YES') {
    next.push(`Invasive timber pest inspection${reportData.invasiveInspectionDetails ? `: ${reportData.invasiveInspectionDetails}` : ''}. This needs a separate agreement.`);
  }
  if (!isBlankValue(reportData.otherRecommendations)) {
    const other = String(reportData.otherRecommendations).trim().replace(/\.$/, '');
    next.push(`Also recommended: ${other.charAt(0).toLowerCase()}${other.slice(1)}.`);
  }
  getRecLines().forEach(l => next.push(l.text));
  if (limitedZones.length) next.push(`Provide access to ${limitedZones.map(z => OBS_ZONES[z].label.replace(/^The /, '').toLowerCase()).join(', ')} for a follow-up inspection.`);
  next.push(`Next timber pest inspection: ${reportData.inspectionFrequency || 'within 12 months'}.`);
  return { groups, limited, next, basis };
}

// Gaps in the report itself, shown before sending and before completing.
function reportPrepItems() { return reportPrepGaps().map(g => g.text); }

// The same list, each with the buttons that fix it from the check sheet
// (fix: HTML, or '' when it has to be fixed in the report).
// from: which sheet the fix buttons come back to ('send' or 'extract').
// key: what kind of gap, so a sheet can leave some out.
function reportPrepGaps(from = 'send') {
  const gaps = [];
  const push = (key, text, fix) => gaps.push({ key, text, fix: fix || '' });
  const fixBtn = (kind, label) => `<button class="link-btn" onclick="fixReportGap('${kind}', '${from}')">${label}</button>`;
  if (!document.getElementById('jobAddress').value.trim()) push('address', 'The job has no property address');
  const unmarked = Object.keys(OBS_ZONES).filter(z => !areaStatusOf(z));
  if (unmarked.length) push('status', `${unmarked.length} area${unmarked.length === 1 ? ' has' : 's have'} no inspection status (${unmarked.map(z => OBS_ZONES[z].label).join(', ')})`,
    fixBtn('inspected', 'Mark the rest as inspected') + fixBtn('na', 'Mark the rest not applicable'));
  const noResult = areasMissingResult();
  if (noResult.length) push('result', `${noResult.length} area${noResult.length === 1 ? ' has' : 's have'} no result for what was found there (${noResult.map(z => OBS_ZONES[z].label.replace(/^The /, '')).join(', ')})`,
    fixBtn('clear', 'Mark the rest as nothing found'));
  // "Nothing found" over an area a finding names: the report would contradict itself.
  Object.keys(OBS_ZONES).filter(z => areaResultOf(z) === 'CLEAR' && areaEvidence(z).length).forEach(z =>
    push('contradiction', `${OBS_ZONES[z].label}: marked "nothing found", but ${areaEvidence(z)[0].replace(/ \(.*$/, '')} is there`, fixBtn('found:' + z, 'Mark evidence found')));
  areasEvidenceUnlinked().forEach(z => push('evidence', `${OBS_ZONES[z].label}: marked "evidence found", but no finding mentions it`, fixBtn('finding:' + z, 'Add finding')));
  findingsMissingReferral().forEach(n => push('referral', `Finding ${n}: "refer to a builder or engineer?" isn't answered`));
  const pending = (reportData.pendingNotes || []).length;
  if (pending) push('pending', `${pending} voice note${pending === 1 ? ' is' : 's are'} still waiting to be filled in`);
  if (!reportData.inspectorSignature) push('signature', 'The inspector hasn\'t signed');
  if (!reportData.agreement) push('agreement', 'No pre-inspection agreement is recorded', from === 'extract' ? fixBtn('agreement', 'Get it signed') : '');
  // Photos the account never received are only on this phone: the PDF
  // has them today, but a lost phone or another device's copy won't.
  const onlyHere = photosOnlyOnThisPhone().length;
  if (onlyHere && authSession) push('photos', `${onlyHere} photo${onlyHere === 1 ? ' is' : 's are'} only on this phone, not in your account yet`,
    fixBtn('photos', navigator.onLine ? 'Back up now' : 'Back up when online'));
  return gaps;
}

function photosOnlyOnThisPhone() {
  return allReportPhotos(reportData).filter(p => !p.path);
}

// "Back up now" on the check sheet: the photos go up, and the sheet is
// drawn again with the gap gone or a reason it isn't.
async function backUpPhotosFromGap(from) {
  const reopen = () => from === 'send' ? openSendReview() : showExtractSummary(extractSummaryBefore);
  if (!navigator.onLine) { showToast('You\'re offline. The photos back up on their own once you\'re online', 'warn'); return; }
  const before = photosOnlyOnThisPhone().length;
  showToast(`Backing up ${before} photo${before === 1 ? '' : 's'}…`, 'info');
  let changed = false;
  try { changed = await uploadPendingPhotos(reportData); } catch (e) { reportError(e, 'photo_backup_gap'); }
  if (changed) { saveDraft(); if (currentReportId) saveCurrentReport(true); }
  const left = photosOnlyOnThisPhone().length;
  if (!left) showToast('Photos are in your account', 'success');
  else showToast(`${left} photo${left === 1 ? '' : 's'} couldn\'t be backed up. Check your connection and try again`, 'error');
  reopen();
}

// ── GAPS BEFORE YOU LEAVE ───────────────────────────────────────────────
// The same gaps, shown on the after-extract sheet while the inspector is
// still on site: what the standard asks for that the notes didn't cover,
// and a minute fixes it in the driveway. Signing and waiting notes are
// left out: they aren't on-site work. The referral is on the Left blank
// list already.
function driveawayGaps() {
  const gaps = reportPrepGaps('extract').filter(g => !['pending', 'signature', 'referral'].includes(g.key));
  const go = (target, label) => `<button class="link-btn" onclick="closeExtractSummary(); goToReportField('${target}')">${label}</button>`;
  if (isBlankValue(reportData.moistureReadings)) gaps.push({ key: 'moisture', text: 'Moisture readings: not recorded', fix: go('f-moistureReadings', 'Record') });
  if (isBlankValue(reportData.durableNoticePresent)) gaps.push({ key: 'notice', text: 'Durable notice in the meter box: not recorded', fix: go('f-durableNoticePresent', 'Record') });
  return gaps;
}

// Anything that should be sorted out before the job is completed and locked.
function reportAttentionItems() {
  const items = reportPrepItems();
  const amending = reportData.amending;
  if (!reportData.sent) items.push('The report hasn\'t been sent to the client');
  else if (amending && reportData.sent.at < amending.startedAt) items.push('The amended report hasn\'t been sent to the client');
  else if (reportData.sent.fingerprint !== reportFingerprint()) items.push('The report changed after it was sent. Send it again');
  const quote = currentJobQuote();
  if (quoteHasItems(quote)) {
    if (!quote.sentAt) items.push('The quote hasn\'t been sent to the client');
    else if (quote.sentHash !== quoteContentHash(quote)) items.push('The quote changed after it was sent. Send it again');
  } else if (!reportData.noQuoteNeeded) {
    items.push('No quote yet. Make one, or tap "No quote needed"');
  }
  return items;
}

function setNoQuoteNeeded(on) {
  if (on) reportData.noQuoteNeeded = true; else delete reportData.noQuoteNeeded;
  saveDraft();
  renderIssueState();
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

function markReportComplete() {
  if (isReportLocked()) return;
  const items = reportAttentionItems();
  if (items.length) { renderIssueState(); showToast(items[0], 'error'); return; }
  const fingerprint = reportFingerprint(), fieldHashes = reportFieldHashes();
  const quote = currentJobQuote();
  if (quoteHasItems(quote)) fieldHashes.quote = quote.sentHash.slice(0, 12);
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
  saveCurrentReport(true);
  renderIssueState();
  showToast(version > 1 ? `Version ${version} complete. Report and quote locked` : 'Job complete. Report and quote locked', 'success');
  track('report_completed', { version });
}

function openAmendForm() {
  const form = document.getElementById('issueAmendForm');
  if (!form) return;
  form.style.display = '';
  document.getElementById('issueAmendReason').focus();
}
function closeAmendForm() {
  const form = document.getElementById('issueAmendForm');
  if (form) form.style.display = 'none';
}
function startAmendment() {
  const reason = document.getElementById('issueAmendReason').value.trim();
  if (!reason) { showToast('Say why the report is being changed', 'error'); return; }
  reportData.amending = { reason, startedAt: Date.now() };
  track('report_unlocked');
  saveCurrentReport(true);
  renderIssueState();
  showToast(`Unlocked. Changes become version ${reportVersion()}`, 'info');
}
// Back out of an amendment, only while nothing has been changed.
function cancelAmendment() {
  if (!reportData.amending || !reportData.issue) return;
  const quote = currentJobQuote();
  const quoteChanged = quoteHasItems(quote) && (reportData.issue.fieldHashes || {}).quote !== quoteContentHash(quote).slice(0, 12);
  if (reportFingerprint() !== reportData.issue.fingerprint || quoteChanged) {
    showToast('Changes have been made. Send them and complete the job to finish the amendment', 'error');
    return;
  }
  delete reportData.amending;
  saveCurrentReport(true);
  renderIssueState();
}

function formatIssueDate(ts) {
  return new Date(ts).toLocaleDateString('en-AU', { day:'numeric', month:'short', year:'numeric' });
}

function renderIssueState() {
  const banner = document.getElementById('issueBanner');
  if (!banner) return;
  const locked = isReportLocked();
  document.body.classList.toggle('report-locked', locked);
  if (locked) commitActive();
  const issue = reportData.issue, amending = reportData.amending, sent = reportData.sent;
  let html = '';
  if (locked) {
    html = `<div class="issue-banner-row"><span class="issue-banner-text"><strong>Job complete · version ${issue.version}</strong>
      · ${formatIssueDate(issue.completedAt)}. The report and quote are locked so they match what the client received.</span>
      <button class="agreement-banner-btn" onclick="openAmendForm()">Amend</button></div>
      <div class="issue-amend-form" id="issueAmendForm" style="display:none">
        <textarea id="issueAmendReason" rows="2" placeholder="Why is it changing? e.g. Client asked for the garage to be added"></textarea>
        <div class="issue-amend-actions">
          <button class="link-btn" onclick="closeAmendForm()">Cancel</button>
          <button class="agreement-banner-btn issue-primary" onclick="startAmendment()">Unlock for version ${issue.version + 1}</button>
        </div>
      </div>`;
    html += renderSentLines(reportData, currentJobQuote());
    const answer = quoteAnswerSummary(currentJobQuote());
    if (answer) html += `<div class="issue-quote-answer ${answer.tone}"><span>${escapeHtml(answer.text)}</span>
      <button class="link-btn" onclick="openQuoteFromReport()">${answer.tone === 'good' ? 'View quote' : 'Record answer'}</button></div>`;
  } else if (sent || amending) {
    const items = reportAttentionItems();
    const head = amending
      ? `<strong>Amending to version ${reportVersion()}</strong> · ${escapeHtml(amending.reason)}.`
      : '';
    const next = items.length ? 'Before the job can be completed:' : 'Everything\'s done. Complete the job to lock it.';
    const noQuote = !quoteHasItems(currentJobQuote());
    html = `${renderSentLines(reportData, currentJobQuote())}<div class="issue-banner-row"><span class="issue-banner-text">${head} ${next}</span>
      ${items.length ? '' : '<button class="agreement-banner-btn issue-primary" onclick="markReportComplete()">Complete job</button>'}</div>
      ${items.length ? `<ul class="issue-attention">${items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : ''}
      <div class="issue-links">
        ${noQuote ? `<button class="link-btn" onclick="setNoQuoteNeeded(${!reportData.noQuoteNeeded})">${reportData.noQuoteNeeded ? 'A quote is needed' : 'No quote needed'}</button>` : ''}
        ${amending ? '<button class="link-btn" onclick="cancelAmendment()">Cancel amendment</button>' : ''}
      </div>`;
  } else if (sentDocs(reportData, currentJobQuote()).some(d => d.at)) {
    html = renderSentLines(reportData, currentJobQuote());
  }
  banner.innerHTML = html;
  banner.style.display = html ? '' : 'none';
  banner.classList.toggle('locked', locked);
  updateProgress();
}

// While locked, taps and typing in the report, the job details and the mic
// are stopped with a note pointing at Amend. Scrolling and the section tabs
// still work, and a signed agreement can still be viewed.
let lockToastAt = 0;
function installReportLockGuard() {
  const stop = e => {
    if (!isReportLocked()) return;
    if (e.target.closest('.issue-banner')) return;
    if (reportData.agreement && e.target.closest('.agreement-banner-btn')) return;
    // Touches only matter on the signature pad; elsewhere they're scrolling.
    if (e.type === 'touchstart' && e.target.tagName !== 'CANVAS') return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'focusin' && e.target.blur) e.target.blur();
    if (e.type === 'click' && Date.now() - lockToastAt > 2500) {
      lockToastAt = Date.now();
      showToast('This job is complete and locked. Tap Amend to change it', 'info');
    }
  };
  ['reportBody', 'jobPanelBody', 'micDock'].forEach(id => {
    const el = document.getElementById(id);
    if (el) ['mousedown', 'touchstart', 'click', 'focusin', 'keydown'].forEach(t => el.addEventListener(t, stop, { capture: true, passive: false }));
  });
}

// ── PDF GENERATION ────────────────────────────────────────────────────────
// ── SEND TO CLIENT ──────────────────────────────────────────────────────
// Once the Worker has email set up (/send-email, through Resend), the PDFs
// go straight to the client from the business, with a copy to the
// business's own email. Until then, or with no client email, or if that
// fails, it opens the phone's share sheet with the PDFs attached and a
// short message ready to go, so the inspector picks Mail (or Messages) and
// taps send. The client's email address is copied first, to paste into To.
// Browsers that can't share files (desktop) download the PDFs and open a
// new email to the client instead. The share sheet only opens straight
// from a tap, so the PDFs must already be built when this is called.
function clientMessage({ client, address, docs, signOff, link }) {
  const company = getCompanyDetails();
  const firstName = (client || '').trim().split(/\s+/)[0];
  return [
    firstName ? `Hi ${firstName},` : 'Hi,',
    '',
    `Please find attached your ${docs} for ${address || 'the property'}.`,
    '',
    // The client link: read the quote and accept or decline it on a phone.
    ...(link ? ['You can read the quote and accept or decline it on your phone here:', link, ''] : []),
    `If you have any questions, just reply to this email${company.phone ? ` or call us on ${company.phone}` : ''}.`,
    '',
    'Kind regards,',
    ...[signOff, company.name].filter(Boolean),
  ].join('\n');
}

// Whether the Worker can send email: null until checked, then true or
// false. Checked when the app opens, so the first tap already knows.
let directEmail = null;
let directEmailSending = false;

async function checkDirectEmail() {
  directEmail = null;
  if (!authUser) return;
  const forUser = authUser.id;
  try {
    const res = await workerFetch('/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ check: true }),
    });
    const data = res.ok ? await res.json() : {};
    if (authUser && authUser.id === forUser) directEmail = !!data.configured;
  } catch (e) {
    directEmail = false;
  }
}

// Returns true only once the files were sent: the Worker sent them, or the
// share sheet reports it finished. When the app can't tell (the share sheet
// was closed, or the PDFs were downloaded for an email), it asks the
// inspector "Did that send?" and returns their answer.
async function sendPdfsToClient({ files, to, subject, body }) {
  if (directEmail && to) return sendPdfsDirect({ files, to, subject, body });
  const fileObjs = files.map(f => new File([f.blob], f.fname, { type: 'application/pdf' }));
  const many = files.length > 1;
  if (navigator.share && navigator.canShare && navigator.canShare({ files: fileObjs })) {
    if (to && navigator.clipboard) {
      navigator.clipboard.writeText(to).catch(() => {});
      showToast(`${to} copied — paste it into To`, 'info');
    }
    try {
      await navigator.share({ title: subject, text: body, files: fileObjs });
      return true;
    } catch (e) {
      // Safari refuses if too long passed since the tap; a second tap works.
      if (e.name === 'NotAllowedError') { showToast('Tap Send again to open your email', 'info'); return false; }
      if (e.name !== 'AbortError') { showToast('Could not open sharing on this device', 'error'); return false; }
      return askDidItSend(many);
    }
  }
  files.forEach(f => downloadBlob(f.blob, f.fname));
  window.location.href = `mailto:${encodeURIComponent(to || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  showToast(`PDF${many ? 's' : ''} downloaded — attach ${many ? 'them' : 'it'} to the email that just opened`, 'info');
  return askDidItSend(many);
}

// "Did that send?" Yes / Not yet. Resolves true on Yes.
let didItSendResolve = null;
function askDidItSend(many) {
  if (didItSendResolve) didItSendResolve(false);
  document.getElementById('didItSendText').textContent = many
    ? 'Tap Yes once the email with the PDFs has gone to the client. If it hasn\'t, tap Not yet and send again.'
    : 'Tap Yes once the email with the PDF has gone to the client. If it hasn\'t, tap Not yet and send again.';
  document.getElementById('didItSendOverlay').classList.add('open');
  return new Promise(resolve => { didItSendResolve = resolve; });
}
function answerDidItSend(yes) {
  document.getElementById('didItSendOverlay').classList.remove('open');
  const r = didItSendResolve;
  didItSendResolve = null;
  if (r) r(!!yes);
  if (!yes) showToast('Not marked as sent', 'info');
}

// One "Sent" line per document the job has (report, quote, certificate),
// for the report banner and the quote screen. Each: { label, at, stale, verb }.
function sentDocs(rd, q) {
  const sent = rd && rd.sent;
  const docs = [{ label: 'Report', at: sent ? sent.at : null }];
  if (quoteHasItems(q)) {
    docs.push({ label: 'Quote', at: q.sentAt || null, stale: !!q.sentAt && q.sentHash !== quoteContentHash(q) });
    if (q.treatment) docs.push({ label: 'Certificate', at: q.certificateSentAt || q.certificateHandedAt || null, verb: !q.certificateSentAt && q.certificateHandedAt ? 'Given' : '' });
  }
  return docs;
}
function renderSentLines(rd, q) {
  return `<div class="doc-sent-lines">${sentDocs(rd, q).map(d =>
    `<div class="doc-sent ${d.at ? (d.stale ? 'stale' : 'sent') : 'unsent'}"><span>${d.label}</span>` +
    `<strong>${d.at ? `${d.verb || 'Sent'} ${formatIssueDate(d.at)}${d.stale ? ' · changed since' : ''}` : 'Not sent yet'}</strong></div>`).join('')}</div>`;
}

async function sendPdfsDirect({ files, to, subject, body }) {
  if (directEmailSending) return false;
  directEmailSending = true;
  const company = getCompanyDetails();
  const copyTo = (company.email || '').trim();
  showToast(`Sending to ${to}…`, 'info');
  try {
    const attachments = await Promise.all(files.map(async f => ({
      filename: f.fname,
      content: (await blobToDataUrl(f.blob)).split(',')[1],
    })));
    const res = await workerFetch('/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, text: body, attachments, fromName: company.name || '', replyTo: copyTo, copyTo }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Could not send from SAYON');
    }
    showToast(`Sent to ${to}${copyTo && copyTo !== to ? `. A copy went to ${copyTo}` : ''}`, 'success');
    return true;
  } catch (e) {
    // The phone's mail app from here on, this session. It needs a fresh
    // tap to open, so the inspector taps again.
    directEmail = false;
    if (!(e instanceof TypeError)) reportError(e, 'send_email');
    const why = e instanceof TypeError ? 'Could not reach SAYON to send it' : e.message;
    showToast(`${why}. Tap again to send it from your mail app`, 'error');
    return false;
  } finally {
    directEmailSending = false;
  }
}

// ── CHECK BEFORE SENDING ────────────────────────────────────────────────
// Send opens a review of exactly what the client will get: who it goes to,
// the PDFs attached, the headline results and the message, plus any gaps
// in the report, each with its own fix. The PDFs are built only once the
// inspector confirms, so what goes is the report as it is then. If the
// build takes too long for the share sheet, the built files are kept and
// the next tap sends them at once.
let sendReview = null;

function openSendReview() {
  if (!jsPDF) {
    ensureJsPDFLoaded().then(openSendReview)
      .catch(e => showToast((e && e.message) || 'Could not load the PDF tools', 'error'));
    return;
  }
  const sidebar = document.getElementById('sidebarPanel');
  if (sidebar && sidebar.classList.contains('open')) toggleDrawer();
  track('screen_viewed', { screen: 'check_before_send' });
  const quote = currentJobQuote();
  const address = getFullAddress();
  const client = document.getElementById('jobClient').value.trim();
  const email = (reportData.jobClientEmail || '').trim();
  const withQuote = quoteHasItems(quote);
  sendReview = { files: null, quote: withQuote ? quote : null };

  const esc = escapeHtml;
  document.getElementById('sendReviewTo').innerHTML =
    `<div class="send-review-name">${esc(client || 'No client name')}</div>` +
    (email ? `<div class="send-review-email">${esc(email)}</div>`
      : isReportLocked() ? `<div class="send-review-warn">No client email. Type it into your email app.</div>`
      : `<div class="send-review-warn">No client email. Add it so SAYON can send it for you.</div>
         <div class="send-review-add-email"><input class="job-input" id="sendReviewEmail" type="email" placeholder="client@email.com" autocomplete="off">
         <button class="agreement-banner-btn" onclick="addSendReviewEmail()">Add</button></div>`);

  const attach = [`<div class="send-review-file"><div><div class="send-review-file-name">Inspection report</div>` +
    `<div class="send-review-file-meta">${esc(ensureReportNumber())} · version ${reportVersion()}</div></div>` +
    `<button class="link-btn" onclick="previewSendFile(0)">Preview</button></div>`];
  if (withQuote) {
    attach.push(`<div class="send-review-file"><div><div class="send-review-file-name">Treatment quote</div>` +
      `<div class="send-review-file-meta">${esc(quote.number || '')} · ${formatAUD(quoteTotals(quote).total)}${quote.gst !== false ? ' inc GST' : ''}</div></div>` +
      `<button class="link-btn" onclick="previewSendFile(1)">Preview</button></div>`);
  } else if (!reportData.noQuoteNeeded) {
    attach.push('<div class="send-review-gap"><span class="send-review-warn">No quote is attached.</span>' +
      '<span class="send-review-fixes"><button class="link-btn" onclick="fixSendGap(\'quote\')">Build quote now</button></span></div>');
  }
  document.getElementById('sendReviewFiles').innerHTML = attach.join('');

  // The same questions, in the same groups, as the report's summary page.
  const { groups, limited } = reportSummary();
  document.getElementById('sendReviewSummary').innerHTML = groups.map(g =>
    `<div class="send-review-sub">${esc(g.title)}</div><div class="send-review-tiles">` + g.items.map(([label, value, tone]) =>
      `<div class="send-review-tile tone-${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('') + '</div>').join('') +
    (limited.length ? `<div class="send-review-sub">Not fully inspected</div><ul class="send-review-list">${limited.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : '');

  const gaps = reportPrepGaps();
  const companyGaps = companyDetailGaps();
  if (companyGaps.length) gaps.push({ text: `Your ${joinWithAnd(companyGaps)} ${companyGaps.length === 1 ? 'is' : 'are'} missing from ${canEditBusiness() ? 'Menu › Your business' : 'the details your business owner set'}, so the PDFs won't show ${companyGaps.length === 1 ? 'it' : 'them'}`, fix: '' });
  const gapsWrap = document.getElementById('sendReviewGaps');
  gapsWrap.style.display = gaps.length ? '' : 'none';
  gapsWrap.innerHTML = `<div class="send-review-label">Worth checking first</div><ul class="send-review-list">${gaps.map(g =>
    `<li>${esc(g.text)}${g.fix ? `<span class="send-review-fixes">${g.fix}</span>` : ''}</li>`).join('')}</ul>`;

  document.getElementById('sendReviewSubject').value =
    `${withQuote ? 'Timber pest inspection report and quote' : 'Timber pest inspection report'} — ${address || 'your property'}`;
  sendReview.message = {
    client, address,
    docs: withQuote ? 'timber pest inspection report and treatment quote' : 'timber pest inspection report',
    signOff: document.getElementById('jobInspector').value.trim(),
  };
  sendReview.defaultBody = clientMessage(sendReview.message);
  document.getElementById('sendReviewBody').value = sendReview.defaultBody;
  if (withQuote) prepareSendReviewLink(sendReview);
  sendReview.label = gaps.length ? 'Send anyway'
    : directEmail && email ? `Send to ${email}` : 'Open email to send';
  const btn = document.getElementById('sendReviewBtn');
  btn.textContent = sendReview.label;
  btn.disabled = false;
  document.getElementById('sendReviewOverlay').classList.add('open');
  const body = document.querySelector('#sendReviewOverlay .page-sheet-body');
  if (body) body.scrollTop = 0;
}

// The client link for the quote (see CLIENT LINK in js/quote.js): made
// while the inspector reads the sheet, then added to the message and the
// Attached list. The PDFs are built now so the page can offer them; they
// are the same files the send then uses.
async function prepareSendReviewLink(r) {
  if (!authSession || !navigator.onLine) return;
  let link = null;
  try {
    const files = await sendReviewFiles(r);
    link = await ensureQuoteLink(r.quote, { report: files[0], quote: files[1] });
  } catch (e) {
    reportError(e, 'send_review_link');
  }
  if (!link || sendReview !== r) return;
  r.link = quoteLinkUrl(link.id);
  const body = document.getElementById('sendReviewBody');
  const withLink = clientMessage(Object.assign({}, r.message, { link: r.link }));
  if (body.value === r.defaultBody) body.value = withLink;
  r.defaultBody = withLink;
  const files = document.getElementById('sendReviewFiles');
  files.insertAdjacentHTML('beforeend', `<div class="send-review-file"><div><div class="send-review-file-name">Link to accept the quote</div>` +
    `<div class="send-review-file-meta">In the message. The client reads the quote and accepts or declines it on their phone</div></div></div>`);
}

// Saves the email typed on the check sheet to the job, then redraws the
// sheet so the send button sends to it.
function addSendReviewEmail() {
  const value = document.getElementById('sendReviewEmail').value.trim();
  if (!/^[^\s@<>,;"()]+@[^\s@<>,;"()]+\.[^\s@<>,;"()]+$/.test(value)) {
    showToast("That email address doesn't look right", 'error');
    return;
  }
  document.getElementById('jobClientEmail').value = value;
  saveJobInfo();
  openSendReview();
}

// The fix buttons on the check sheet. Each changes the report, then the
// sheet is redrawn from the report as it now is.
function fixSendGap(kind) { fixReportGap(kind, 'send'); }
function fixReportGap(kind, from = 'send') {
  const reopen = () => from === 'send' ? openSendReview() : showExtractSummary(extractSummaryBefore);
  const leave = () => from === 'send' ? closeSendReview() : closeExtractSummary();
  if (kind === 'quote') { leave(); sendAfterQuote = true; openQuoteFromReport(); return; }
  if (kind === 'agreement') { leave(); openAgreementSheet(); return; }
  if (kind === 'photos') { backUpPhotosFromGap(from); return; }
  if (kind.startsWith('finding:')) { leave(); addFindingForArea(kind.slice(8)); return; }
  if (kind.startsWith('found:')) { if (!reportData.areaResult) reportData.areaResult = {}; reportData.areaResult[kind.slice(6)] = 'FOUND'; syncObstructionData(); }
  else if (kind === 'clear') markRemainingAreasClear();
  else markRemainingAreasInspected(kind === 'na' ? 'NA' : 'INSPECTED');
  reopen();
}

// After "Build quote now", coming back from the quote reopens the check.
let sendAfterQuote = false;
function resumeSendReview() {
  if (!sendAfterQuote) return;
  sendAfterQuote = false;
  openSendReview();
}

function closeSendReview() {
  document.getElementById('sendReviewOverlay').classList.remove('open');
  sendReview = null;
}

// Builds this send's PDFs once and keeps them for a second tap.
async function sendReviewFiles(r) {
  if (r.files) return r.files;
  const report = await buildReportPdf();
  const files = [{ blob: report.blob, fname: report.fname }];
  if (r.quote) files.push(buildQuotePDF(r.quote));
  r.report = report;
  r.files = files;
  return files;
}

async function previewSendFile(i) {
  const r = sendReview;
  if (!r) return;
  let f;
  try { f = (await sendReviewFiles(r))[i]; } catch (e) { showToast('Could not make the PDF', 'error'); return; }
  if (!f) return;
  const url = URL.createObjectURL(f.blob);
  if (!window.open(url, '_blank')) downloadBlob(f.blob, f.fname);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function confirmSendReview() {
  const r = sendReview;
  if (!r || r.busy) return;
  const btn = document.getElementById('sendReviewBtn');
  r.busy = true;
  btn.disabled = true;
  try {
    if (!r.files) btn.textContent = 'Making the PDFs…';
    let files;
    try { files = await sendReviewFiles(r); }
    catch (e) {
      console.error('PDF build failed:', e);
      reportError(e, 'send_pdf');
      showToast((e && e.message) || 'Could not make the PDF', 'error');
      return;
    }
    btn.textContent = r.label;
    const sent = await sendPdfsToClient({
      files,
      to: (reportData.jobClientEmail || '').trim(),
      subject: document.getElementById('sendReviewSubject').value.trim(),
      body: document.getElementById('sendReviewBody').value,
    });
    if (!sent || sendReview !== r) return;
    closeSendReview();
    track('report_sent', { documents: files.length, with_quote: !!r.quote, with_link: !!r.link });
    if (r.quote) markQuoteSent(r.quote);
    recordReportSent(r.report.fingerprint, r.report.version);
  } finally {
    r.busy = false;
    btn.disabled = false;
    if (sendReview === r) btn.textContent = r.label;
  }
}

function generateReport() {
  const btn = document.getElementById('generateBtn');
  const originalText = btn.innerHTML;
  btn.innerHTML = 'Generating…';
  btn.disabled = true;
  btn.style.opacity = '0.7';

  // Defer to next tick so the UI updates before the (synchronous) PDF build
  setTimeout(() => {
    ensureJsPDFLoaded().then(() => {
      return _buildAndDownloadPDF();
    }).then(() => track('report_pdf_made')).catch((e) => {
      console.error('PDF generation failed:', e);
      reportError(e, 'report_pdf');
      showToast((e && e.message) || 'Could not generate the PDF — check your connection and try again', 'error');
    }).finally(() => {
      btn.innerHTML = originalText;
      btn.disabled = false;
      btn.style.opacity = '';
    });
  }, 50);
}

// The summary's Next inspection answer in a few words ("6 MONTHS"); the
// inspector's full wording prints under the question.
function nextInspectionChip(freq) {
  const f = String(freq || '').trim();
  if (!f) return 'WITHIN 12 MONTHS';
  const m = f.match(/(\d+)\s*(month|week|year)s?/i);
  if (m) return `${m[1]} ${m[2].toUpperCase()}${m[1] === '1' ? '' : 'S'}`;
  return f.split(/[,;]/)[0].trim().toUpperCase();
}

// ── SHARED PDF PIECES ── used by the inspection report and the quote PDF
// (js/quote.js) so both documents carry the same brand.
const PDF_COLORS = {
  white:       [255, 255, 255],
  pageBg:      [250, 251, 252],
  // Text
  ink:         [12,  18,  28],
  inkLight:    [36,  48,  64],
  inkMuted:    [72,  86, 104],
  // Accent: the brand's electric blue
  accent:      [47,  107, 255],
  accentDark:  [29,  78,  216],
  accentLight: [214, 226, 255],
  // Structure
  rule:        [208, 218, 228],
  ruleLight:   [230, 237, 244],
  rowAlt:      [245, 248, 251],
  headerBg:    [10,  15,  22],
  // Status
  danger:      [192,  48,  38],
  warn:        [175, 112,  16],
  safe:        [21,  128,  61],
  // Cover
  coverDark:   [10,  15,  22],
  coverMid:    [20,  30,  46],
};

// Letter-spaced text for small capital labels. align 'right' measures the
// spacing too, which jsPDF's own align doesn't.
function pdfTracked(doc, text, x, y, { cs = 0.35, align } = {}) {
  const w = doc.getTextWidth(text) + cs * Math.max(0, text.length - 1);
  doc.text(text, align === 'right' ? x - w : x, y, { charSpace: cs });
  return w;
}

// A rule that runs from blue through a lighter blue and fades into the page,
// like the lines on the app's section headers. jsPDF has no gradients, so it
// is drawn as thin steps. wash: a pale blue band that fades into the page.
function drawPdfFadeRule(doc, x, y, w, h, { wash = false } = {}) {
  const white = [255, 255, 255];
  const from = wash ? [226, 234, 255] : PDF_COLORS.accent;
  const mid = wash ? [241, 245, 255] : [125, 162, 255];
  const steps = Math.max(12, Math.round(w / 1.5)), sw = w / steps;
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    doc.setFillColor(...(t < 0.45 ? mix(from, mid, t / 0.45) : mix(mid, white, (t - 0.45) / 0.55)));
    doc.rect(x + i * sw, y, sw + 0.05, h, 'F');
  }
}

// The business's mark: the uploaded logo, else its initials (or S for
// SAYON) in a blue tile. size is the square it fits in, in mm.
function drawPdfCompanyMark(doc, company, x = 15, y = 12, size = 17) {
  const C = PDF_COLORS;
  if (company.logo) {
    try {
      const natW = company.logoWidth || 1, natH = company.logoHeight || 1;
      // Wide logos get up to twice the width, so a wordmark stays legible.
      let drawH = size, drawW = size * (natW / natH);
      if (drawW > size * 2) { drawW = size * 2; drawH = drawW * (natH / natW); }
      doc.addImage(company.logo, 'PNG', x, y + (size - drawH) / 2, drawW, drawH, undefined, 'FAST');
      return drawW;
    } catch (e) {}
  }
  const initials = (company.name || 'SAYON').split(/\s+/).filter(w => /^[A-Za-z0-9]/.test(w))
    .slice(0, 2).map(w => w[0].toUpperCase()).join('') || 'S';
  doc.setFillColor(...C.accent); doc.roundedRect(x, y, size, size, 2.2, 2.2, 'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(initials.length > 1 ? 11 : 13); doc.setTextColor(...C.white);
  doc.text(initials, x + size / 2, y + size / 2 + 1.6, { align:'center' });
  return size;
}

// The letterhead at the top of every client document: the business's mark,
// name and details on the left, the document and date on the right, over a
// blue rule. White, so it prints cleanly in black and white. Returns the y
// below it.
function drawPdfLetterhead(doc, company, { docLabel, date }) {
  const C = PDF_COLORS;
  const W = 210, M = 15;
  drawPdfFadeRule(doc, 0, 0, W, 1.6);
  const markW = drawPdfCompanyMark(doc, company, M, 11, 17);
  const tx = M + markW + 5;
  // A long business name steps down in size, then takes a second line,
  // and the details below move down with it rather than print over it.
  const name = company.name || 'SAYON', nameW = 112 - markW;
  let nameSize = 13.5;
  doc.setFont('helvetica','bold'); doc.setFontSize(nameSize); doc.setTextColor(...C.ink);
  while (nameSize > 11 && doc.getTextWidth(name) > nameW) doc.setFontSize(nameSize -= 0.5);
  const nameLines = doc.splitTextToSize(name, nameW).slice(0, 2);
  const two = nameLines.length > 1;
  doc.text(nameLines, tx, two ? 15 : 17.5, { lineHeightFactor: 1.15 });
  const dy = two ? 1.6 : 0;
  const sub = [];
  if (company.licence) sub.push(`Licence ${company.licence}`);
  if (company.abn) sub.push(`ABN ${company.abn}`);
  const contact = [company.phone, company.email].filter(Boolean);
  doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(...C.inkLight);
  if (sub.length) doc.text(sub.join('   ·   '), tx, 22.6 + dy);
  if (contact.length) doc.text(contact.join('   ·   '), tx, 26.6 + dy);
  if (!company.name) doc.text('Intelligent Inspection Platform', tx, 22.6);
  doc.setFont('helvetica','bold'); doc.setFontSize(6.8); doc.setTextColor(...C.accentDark);
  pdfTracked(doc, (docLabel || '').toUpperCase(), W - M, 17.5, { align: 'right' });
  doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(...C.inkLight);
  if (date) doc.text(date, W - M, 22.6, { align: 'right' });
  drawPdfFadeRule(doc, M, 33, W - M * 2, 0.5);
  return 33.5;
}

// A signature over a line, with a caption under it: a drawn signature, or a
// note (e.g. "Signed on paper") when there's none. y is the line.
function drawPdfSignature(doc, { x, y, w, image, note, caption }) {
  const C = PDF_COLORS;
  if (image) {
    try { doc.addImage(image, 'PNG', x + 1, y - 12.5, 36, 12, undefined, 'FAST'); } catch (e) {}
  } else if (note) {
    doc.setFont('helvetica','italic'); doc.setFontSize(8.5); doc.setTextColor(...C.inkLight);
    doc.text(note, x + 1, y - 2, { maxWidth: w - 2 });
  }
  doc.setDrawColor(...C.ink); doc.setLineWidth(0.3); doc.line(x, y, x + w, y);
  doc.setFont('helvetica','bold'); doc.setFontSize(6.3); doc.setTextColor(...C.inkMuted);
  pdfTracked(doc, (caption || 'SIGNATURE').toUpperCase(), x, y + 4, { cs: 0.3 });
}

// Text cut to fit w at the current font, with an ellipsis when it's cut.
function pdfFitText(doc, text, w) {
  text = String(text || '');
  if (doc.getTextWidth(text) <= w) return text;
  while (text.length > 1 && doc.getTextWidth(text + '…') > w) text = text.slice(0, -1);
  return text.trimEnd() + '…';
}

// A name or date written on a signature line (y is the line). Long names
// step down in size to fit the line instead of losing words.
function drawPdfOnLine(doc, text, x, y, w) {
  if (!text) return;
  let size = 9.5;
  doc.setFont('helvetica','bold'); doc.setFontSize(size); doc.setTextColor(...PDF_COLORS.ink);
  while (size > 7 && doc.getTextWidth(String(text)) > w - 2) doc.setFontSize(size -= 0.5);
  doc.text(pdfFitText(doc, text, w - 2), x + 1, y - 2);
}

// A labelled value, small tracked label over the value. Returns the value's
// line count.
function drawPdfField(doc, label, value, x, y, w, size = 9.5) {
  const C = PDF_COLORS;
  doc.setFont('helvetica','bold'); doc.setFontSize(6.3); doc.setTextColor(...C.inkMuted);
  pdfTracked(doc, label.toUpperCase(), x, y, { cs: 0.3 });
  doc.setFont('helvetica','bold'); doc.setFontSize(size); doc.setTextColor(...C.ink);
  const lines = doc.splitTextToSize(String(value), w);
  doc.text(lines, x, y + 4.8);
  return lines.length;
}

// Gets a finished PDF off the device. Inside the native app wrapper there is
// no Downloads folder for a browser-style <a download> click to land in — it
// silently does nothing — so go straight to the native Share sheet there.
// Browsers / PWA get a Safari-compatible blob download.
async function deliverPdfBlob(blob, fname, { title, text, readyToast }) {
  const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
  if (isNative) {
    const file = new File([blob], fname, { type: 'application/pdf' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ title, text, files: [file] });
        showToast(readyToast, 'success');
      } catch(e) {
        if (e.name !== 'AbortError') showToast('Share cancelled', 'info');
      }
    } else {
      showToast('PDF ready — tap Share to save or send it', 'info');
    }
    return;
  }
  downloadBlob(blob, fname);
  showToast('PDF downloaded', 'success');
}

// Safari-compatible blob download, falling back to opening it in a new tab.
function downloadBlob(blob, fname) {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 300);
  } catch(e) {
    window.open(url, '_blank');
    showToast('PDF opened in new tab — save from there', 'info');
  }
}

// Builds the report PDF as the report is now: { blob, fname, fingerprint,
// version }. Used by Generate PDF and by Send (after the check).
async function buildReportPdf() {
  // Photos live outside reportData (see PHOTO ATTACHMENTS), so read them all
  // up front; the drawing code below is synchronous.
  const photoSrc = {};
  for (const p of allReportPhotos(reportData)) {
    const blob = await getPhotoImage(p);
    if (blob) photoSrc[p.id] = await blobToDataUrl(blob);
  }

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 15, CW = W - M * 2;
  const address   = getFullAddress() || 'Address Not Set';
  const client    = document.getElementById('jobClient').value    || 'Not specified';
  const inspector = document.getElementById('jobInspector').value || 'Not specified';
  const today = new Date().toLocaleDateString('en-AU', { day:'numeric', month:'long', year:'numeric' });
  // The day of the inspection, not the day this PDF was made.
  const inspectedOn = reportData.jobInspectionDate || (reportData.agreement && reportData.agreement.inspectionDate);
  const inspectionDate = inspectedOn
    ? new Date(inspectedOn + 'T00:00:00').toLocaleDateString('en-AU', { day:'numeric', month:'long', year:'numeric' })
    : today;
  const reportNumber = ensureReportNumber();
  const version = reportVersion();
  const reportId = `${reportNumber} · Version ${version}`;
  const fingerprint = reportFingerprint();
  let y = 0;

  const STANDARD_NAMES = {
    'AS 3660.1-2014': 'New Building Work',
    'AS 4349.0-2007': 'Inspection of Buildings — General Requirements',
    'AS 3660.2-2017': 'Existing Buildings',
    'AS 3660.3-2014': 'Assessment Criteria',
    'AS 4349.1-2007': 'Building Inspections',
    'AS 4349.3-2010': 'Pre-Purchase Timber Pest',
  };
  const standard = reportData.standard || 'AS 3660.2-2017';
  const standardName = STANDARD_NAMES[standard] || '';
  const standardLabel = standardName ? `${standard} — ${standardName}` : standard;

  const C = PDF_COLORS;


  // Every page after the cover carries the header for the part it's in, so a
  // section that runs onto a new page is still labelled.
  let pageLabel = '';
  function newPage() { doc.addPage(); compactHeader(pageLabel); _rowShade = false; }
  function gap(n=5) { y += n; }
  // Starts a part of the report: on a fresh page when asked or when little of
  // the page is left, otherwise straight after what came before.
  function startPart(label, freshPage) {
    pageLabel = label;
    if (freshPage || y > 215) newPage(); else gap(8);
    _rowShade = false;
  }

  let pageNum = 1;

  // ── PAGE HEADER ──────────────────────────────────────────────────────────
  function compactHeader(sectionLabel) {
    pageNum++;
    // A light running header: who prepared it and for which property on the
    // left, the part of the report on the right, over a thin blue rule.
    const companyName = (getCompanyDetails().name || '').trim();
    doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...C.ink);
    doc.text(companyName || reportKindTitle(), M, 10);
    const addr = getFullAddress() || '';
    const sub = [companyName ? reportKindTitle() : '', addr].filter(Boolean).join('   ·   ');
    if (sub) {
      doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(...C.inkMuted);
      doc.text(pdfFitText(doc, sub, CW), M, 14);
    }
    doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(...C.accentDark);
    doc.text(sectionLabel.toUpperCase(), W-M, 10, { align:'right' });
    drawPdfFadeRule(doc, M, 17, CW, 0.35);
    y = 26;
  }

  // ── SECTION TITLE ─────────────────────────────────────────────────────────
  // no: the section's number from REPORT_PARTS (or 'A' for the appendix),
  // whose page the contents list records. A title never sits at the foot of
  // a page.
  const partPages = {};
  // keep: room needed below the title for its first content, so a title is
  // never left at the foot of a page with its content overleaf.
  function sectionTitle(title, no, keep = 30) {
    const num = no || '';
    if (y + 19 + keep > 277) newPage();
    gap(4);
    // As on the app's section headers: a blue line above, a soft blue wash
    // and a fine line below, all fading out to the right.
    drawPdfFadeRule(doc, M, y - 2.5, CW, 0.7);
    drawPdfFadeRule(doc, M, y - 1.8, CW, 10.6, { wash: true });
    // Number badge
    if (num) {
      doc.setFillColor(...C.accent); doc.roundedRect(M, y, 7, 7, 1, 1, 'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(...C.white);
      doc.text(String(num), M+3.5, y+5.2, { align:'center' });
    }
    if (num) partPages[num] = doc.internal.getNumberOfPages();
    // Title
    const titleX = num ? M+10 : M;
    doc.setFont('helvetica','bold'); doc.setFontSize(10.5); doc.setTextColor(...C.ink);
    doc.text(title, titleX, y+5.5);
    drawPdfFadeRule(doc, M, y+8.8, CW, 0.3);
    y += 15;
  }

  // ── DATA ROW ──────────────────────────────────────────────────────────────
  let _rowShade = false;
  // invert: for questions where YES is the good answer (e.g. "inspection
  // zone visible"), so NO shows red and YES green. 'plain' prints the
  // answer in ink, for a fact that is neither good nor bad.
  function row(label, value, invert) {
    const v     = String(value || '');
    const isEmpty = !value && value !== 0;
    // Nothing recorded: leave the row out rather than print a dash.
    if (isEmpty) return;
    const LABEL_W = 62;
    doc.setFontSize(9);
    const wrapped = doc.splitTextToSize(v, CW - LABEL_W - 6);
    const rowH = Math.max(8.5, wrapped.length * 4.6 + 4);
    if (y + rowH > 277) { newPage(); _rowShade = false; }

    // Alternating shade
    if (_rowShade) { doc.setFillColor(...C.rowAlt); doc.rect(M, y, CW, rowH, 'F'); }
    _rowShade = !_rowShade;

    // Bottom rule
    doc.setDrawColor(...C.ruleLight); doc.setLineWidth(0.25);
    doc.line(M, y+rowH, M+CW, y+rowH);

    // Label
    doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(...C.inkMuted);
    doc.text(label.toUpperCase(), M+3, y+5.7);

    // Value — colour-coded
    if (isEmpty) {
      doc.setTextColor(...C.inkMuted); doc.setFont('helvetica','italic');
    } else if (invert === 'plain') {
      doc.setTextColor(...C.ink); doc.setFont('helvetica','bold');
    } else if (invert && (v === 'YES' || v === 'NO')) {
      doc.setTextColor(...(v === 'NO' ? C.danger : C.safe)); doc.setFont('helvetica','bold');
    } else if (['YES','HIGH','OBSTRUCTED','BRIDGED','ACTIVE'].includes(v)) {
      doc.setTextColor(...C.danger); doc.setFont('helvetica','bold');
    } else if (['NO','LOW','CLEAR','NONE'].includes(v)) {
      doc.setTextColor(...C.safe); doc.setFont('helvetica','bold');
    } else if (['MEDIUM','INACTIVE','MODERATE'].includes(v)) {
      doc.setTextColor(...C.warn); doc.setFont('helvetica','bold');
    } else {
      doc.setTextColor(...C.ink); doc.setFont('helvetica','normal');
    }
    doc.setFontSize(9);
    doc.text(wrapped, M+LABEL_W, y+5.7);
    y += rowH;
  }

  function resetRowShade() { _rowShade = false; }

  // ── RISK BANNER ───────────────────────────────────────────────────────────
  function riskBanner(level) {
    if (y > 268) newPage();
    gap(4);
    const col = level==='HIGH' ? C.danger : level==='MEDIUM' ? C.warn : C.safe;
    const bgTint = level==='HIGH' ? [253,242,240] : level==='MEDIUM' ? [253,247,234] : [233,248,238];

    // Tinted background box
    doc.setFillColor(...bgTint); doc.roundedRect(M, y, CW, 18, 2, 2, 'F');
    // Coloured left bar
    doc.setFillColor(...col); doc.roundedRect(M, y, 4, 18, 2, 2, 'F');
    doc.rect(M+2, y, 2, 18, 'F'); // square off right edge
    // Border
    doc.setDrawColor(...col); doc.setLineWidth(0.6);
    doc.roundedRect(M, y, CW, 18, 2, 2, 'D');

    // Labels
    doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(...C.inkMuted);
    doc.text('RISK OF TERMITE ATTACK', M+8, y+6);
    doc.setFont('helvetica','bold'); doc.setFontSize(15); doc.setTextColor(...col);
    doc.text(level || 'NOT ASSESSED', M+8, y+14.5);
    doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(...C.inkLight);
    doc.text(standard, W-M-4, y+14.5, { align:'right' });
    y += 24;
  }

  // ── SUBHEADING ── a small label and rule over a group of rows
  function subhead(label) {
    if (y > 250) newPage();
    y += 3;
    doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(...C.accentDark);
    doc.text(label, M, y); y += 2.2;
    doc.setFillColor(...C.accentLight); doc.rect(M, y, CW, 0.5, 'F'); y += 1.5;
    _rowShade = false;
  }

  // Draws wrapped lines, carrying on over the page break where needed, so a
  // long paragraph never leaves its heading alone at the foot of a page.
  function flowLines(lines, x, leading, color) {
    const font = doc.getFont(), size = doc.getFontSize();
    lines.forEach(line => {
      if (y + leading > 280) { newPage(); doc.setFont(font.fontName, font.fontStyle); doc.setFontSize(size); }
      doc.setTextColor(...color);
      doc.text(line, x, y); y += leading;
    });
  }

  // ── DISCLAIMER ────────────────────────────────────────────────────────────
  function disclaimer(text) {
    doc.setFont('helvetica','italic'); doc.setFontSize(7.8); doc.setTextColor(...C.inkLight);
    const lines = doc.splitTextToSize(text, CW - 6);
    const blockH = lines.length * 4 + 3;
    if (y + blockH > 280) newPage();
    // Subtle left bar
    doc.setFillColor(...C.accentLight); doc.rect(M, y, 1.5, blockH, 'F');
    doc.text(lines, M+4, y+3); y += blockH + 2;
    doc.setFont('helvetica','normal');
  }

  // ── CALLOUT ── a tinted note with a coloured bar: a short bold title, then
  // plain text. tone: 'bad' | 'warn'.
  function callout(title, body, tone, x = M, w = CW) {
    const col = tone === 'warn' ? C.warn : C.danger;
    const bg  = tone === 'warn' ? [253,247,234] : [253,242,240];
    doc.setFont('helvetica','normal'); doc.setFontSize(8);
    const lines = doc.splitTextToSize(body, w - 12);
    const h = 11 + lines.length * 4;
    if (y + h > 278) newPage();
    doc.setFillColor(...bg); doc.roundedRect(x, y, w, h, 1.5, 1.5, 'F');
    doc.setFillColor(...col); doc.rect(x, y, 1.5, h, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(...col);
    doc.text(title.toUpperCase(), x + 6, y + 6);
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(...C.inkLight);
    doc.text(lines, x + 6, y + 11);
    y += h + 4;
    doc.setTextColor(...C.ink);
  }

  // ── BUILDER / ENGINEER REFERRAL BOX ────────────────────────────────────────────────
  function referralBox() {
    callout('Builder or engineer referral', 'The inspector recommends that the damage described above be assessed by a licensed builder or structural engineer. A timber pest inspection does not assess structural soundness or load-bearing capacity, and no opinion on either is given in this report.', 'bad');
  }

  // ── PHOTOS ─────────────────────────────────────────────────────────────
  // Every photo is numbered in report order, so the text can point to one.
  // 'cover' fills its box and trims the overflow (used for the front of the
  // house); 'contain' shows the whole photo on a light panel, so evidence is
  // never cropped or stretched.
  let photoNo = 0;
  function drawPhoto(src, x, top, w, h, mode = 'contain') {
    const fmt = src.startsWith('data:image/png') ? 'PNG' : 'JPEG';
    const props = doc.getImageProperties(src);
    const ratio = props.width / props.height;
    doc.saveGraphicsState();
    doc.roundedRect(x, top, w, h, 1.6, 1.6, null); doc.clip(); doc.discardPath();
    if (mode === 'cover') {
      let iw = w, ih = w / ratio;
      if (ih < h) { ih = h; iw = h * ratio; }
      doc.addImage(src, fmt, x + (w - iw) / 2, top + (h - ih) / 2, iw, ih, undefined, 'FAST');
    } else {
      doc.setFillColor(...C.rowAlt); doc.rect(x, top, w, h, 'F');
      let iw = w, ih = w / ratio;
      if (ih > h) { ih = h; iw = h * ratio; }
      doc.addImage(src, fmt, x + (w - iw) / 2, top + (h - ih) / 2, iw, ih, undefined, 'FAST');
    }
    doc.restoreGraphicsState();
    doc.setDrawColor(...C.rule); doc.setLineWidth(0.3);
    doc.roundedRect(x, top, w, h, 1.6, 1.6, 'D');
  }
  function photoUnavailable(x, top, w, h) {
    doc.setFillColor(...C.rowAlt); doc.roundedRect(x, top, w, h, 1.6, 1.6, 'F');
    doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(...C.inkMuted);
    doc.text('Photo not available', x + w / 2, top + h / 2, { align:'center' });
  }

  // Photos two to a row, each with its number and caption under it.
  function photoGrid(photos, x = M, w = CW) {
    const gutter = 5, boxW = (w - gutter) / 2, boxH = boxW * 0.72;
    for (let i = 0; i < photos.length; i += 2) {
      const pair = photos.slice(i, i + 2);
      doc.setFontSize(7);
      const caps = pair.map(p => doc.splitTextToSize((p.caption || '').trim(), boxW - 16).slice(0, 2));
      const rowH = boxH + 5 + Math.max(...caps.map(c => Math.max(1, c.length))) * 3.3 + 4;
      if (y + rowH > 280) newPage();
      pair.forEach((p, k) => {
        const px = x + k * (boxW + gutter);
        const no = ++photoNo;
        try {
          if (!photoSrc[p.id]) throw new Error('no image');
          drawPhoto(photoSrc[p.id], px, y, boxW, boxH);
        } catch (e) { photoUnavailable(px, y, boxW, boxH); }
        doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(...C.accentDark);
        doc.text(`Photo ${no}`, px, y + boxH + 4.5);
        if (caps[k].length) {
          doc.setFont('helvetica','normal'); doc.setTextColor(...C.inkLight);
          doc.text(caps[k], px + 14, y + boxH + 4.5, { lineHeightFactor: 1.35 });
        }
      });
      y += rowH;
    }
  }

  function renderSectionPhotosInPDF(sectionKey, label, list) {
    const photos = list || (reportData.photosBySection || {})[sectionKey] || [];
    if (photos.length === 0) return;
    gap(2);
    if (y + 70 > 278) newPage(); // keep the label with the first photos
    subhead('PHOTOS — ' + label.toUpperCase());
    photoGrid(photos);
    gap(3);
  }

  // The front of the house across the page, under its section's title.
  function heroPhoto(p, h, caption) {
    if (!p || !photoSrc[p.id]) return;
    if (y + h + 8 > 278) newPage();
    try { drawPhoto(photoSrc[p.id], M, y, CW, h, 'cover'); } catch (e) { return; }
    y += h + 2;
    if (caption) {
      doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(...C.inkMuted);
      doc.text(caption, M, y + 3); y += 6;
    }
    y += 3;
  }

  function photoGallery() {
    const photos = reportData.photos || [];
    startPart('Photographs');
    sectionTitle('PHOTOGRAPHS', REPORT_PARTS.photos);
    if (!photos.length) {
      doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(...C.inkLight);
      doc.text('No general photographs were attached. Photos of each area appear in the section they belong to.', M, y);
      y += 8;
      return;
    }
    photoGrid(photos);
    gap(4);
  }

  // ── NOTES BLOCK ───────────────────────────────────────────────────────────
  const FIELD_LABELS = {
    structureType:'Structure Type', wallConstruction:'Wall Construction', floorType:'Floor Type', roofType:'Roof Type',
    height:'Height', facadeDirection:'Orientation', occupancyStatus:'Occupancy Status', furnishing:'Furnishing', peoplePresent:'People Present', weatherConditions:'Weather Conditions', temperature:'Temperature', humidity:'Humidity', rainLast24h:'Rain in the Last 24 Hours', recentWeather:'Recent Weather', toolsUsed:'Tools Used', siteSurroundings:'Surroundings', siteSlope:'Site Slope', termiteHistory:'Known Termite History', mouldSeen:'Mould Seen', mouldWhere:'Mould: Where',
    constructionEra:'Year or Period Built', standard:'Applicable Standard',
    hinderedAreas:'Hindered Access: Where', obstructions:'Areas Not Inspected', restrictedAccess:'Obstructions', hinderedAreasDetail:'What Hindered Access', noAccessAreas:'Restricted Access: Where & Why', highRiskAreas:'High Risk Areas',
    previousTreatment:'Evidence of Previous Treatment', previousTreatmentDetails:'Previous Treatment: What', previousTreatmentWhere:'Previous Treatment: Where', siteDrainage:'Site Drainage', subfloorDrainage:'Subfloor Drainage',
    borerActivity:'Borers of Seasoned Timber', borerDetails:'Borer Type, Location & Evidence', decayFound:'Wood Decay Fungi (Rot)', decayDetails:'Wood Decay: What', decayWhere:'Wood Decay: Where',
    termiteActivity:'Termite Activity Status', species:'Species', damageDescription:'Damage Description', activityLocation:'Location of Activity', nestLocated:'Termite Nest Found?', structuralConcern:'Builder / Engineer Referral',
    waterLeaks:'Water Leaks', leakLocation:'Location of Moisture Ingress', moistureReadings:'Moisture Readings', timberSoil:'Timber-to-Soil Contact', slabEdge:'Slab Edge Concealed', weepHoles:'Weep Holes (Clear / Bridged)', existingSystem:'Existing System',
    durableNoticePresent:'Durable Notice Present', hardLandscaping:'Hard Landscaping Adjacent', zone25mmVisible:'25mm Inspection Zone Visible', softLandscaping:'Soft Landscaping Adjacent', zone75mmVisible:'75mm Inspection Zone Visible', antCapSoldered:'Ant Cap Joins Soldered',
    treatmentRecommended:'Treatment Recommended', treatmentType:'Treatment Type', inspectionFrequency:'Inspection Frequency', riskLevel:'Risk of Termite Attack',
    invasiveInspection:'Invasive Inspection Recommended', invasiveInspectionDetails:'Invasive Inspection: Where, Why and When', otherRecommendations:'Other Recommendations', antCapping:'Ant Capping', antCappingDetails:'Ant Capping: Where and What',
    delignification:'Chemical Delignification', delignificationDetails:'Delignification: What', delignificationWhere:'Delignification: Where', subfloorVentilation:'Subfloor Ventilation', nonDurableTimber:'Non-durable Timber in Damp Areas', nonDurableTimberDetails:'Non-durable Timber: What', nonDurableTimberWhere:'Non-durable Timber: Where',
  };

  function notesBlock(sectionKey) {
    const keys = (SECTIONS[sectionKey] && SECTIONS[sectionKey].fields) || [];
    const notes = keys.map(k => [k, (fieldNotes[k]||'').trim()]).filter(([,v]) => v.length > 0);
    if (notes.length === 0) return;
    if (y > 250) newPage();
    gap(3);
    doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(...C.inkMuted);
    doc.text('ADDITIONAL NOTES', M, y); y += 5;
    notes.forEach(([key, text]) => {
      if (y > 270) newPage();
      doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...C.accentDark);
      doc.text((FIELD_LABELS[key] || key) + ':', M, y); y += 4.5;
      doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(...C.ink);
      const wrapped = doc.splitTextToSize(text, CW-4);
      if (y + wrapped.length*4 > 280) newPage();
      doc.text(wrapped, M+2, y); y += wrapped.length*4+4;
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COVER PAGE
  // ═══════════════════════════════════════════════════════════════════════════
  // White cover — professional, clean, client-facing

  // Full white page
  doc.setFillColor(...C.white); doc.rect(0, 0, W, 297, 'F');

  const company = getCompanyDetails();
  drawPdfLetterhead(doc, company, { docLabel: 'Inspection Report', date: today });

  // ── TITLE BLOCK ───────────────────────────────────────────────────────────
  // The title follows the standard: a termite inspection (AS 3660.2) or a
  // timber pest inspection (AS 4349.3), pre-purchase when it is one.
  const prePurchase = isPrePurchaseJob();
  const reportTypeLabel = prePurchase ? 'PRE-PURCHASE TIMBER PEST' : reportKindTitle().replace(/ Inspection Report$/, '').toUpperCase();
  doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...C.accentDark);
  pdfTracked(doc, reportTypeLabel, M, 52, { cs: 0.7 });
  doc.setFont('helvetica','bold'); doc.setFontSize(34); doc.setTextColor(...C.ink);
  doc.text('Inspection Report', M, 66);
  doc.setFillColor(...C.accent); doc.rect(M, 70.5, 22, 1.4, 'F');

  // Standard reference
  doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(...C.inkLight);
  doc.text('Prepared with reference to', M, 80);
  doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(...C.ink);
  doc.text(doc.splitTextToSize(standardLabel, 100)[0], M, 85);

  // ── PROPERTY PHOTO ── the front of the house across the page, under the
  // title. Without one, the property block moves up into its place.
  const frontPhoto = ((reportData.photosBySection || {}).general || []).find(p => photoSrc[p.id]);
  const coverPhoto = frontPhoto || (reportData.photos || []).find(p => photoSrc[p.id]);
  let coverShift = 0;
  if (coverPhoto) {
    try { drawPhoto(photoSrc[coverPhoto.id], M, 93, CW, 62, 'cover'); coverShift = 68; } catch (e) {}
  }

  // ── THE PROPERTY ──────────────────────────────────────────────────────────
  // The client's property, large, then the job details in a two-column grid.
  doc.setFillColor(...C.accent); doc.rect(M, 96 + coverShift, CW, 0.5, 'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(6.5); doc.setTextColor(...C.inkMuted);
  pdfTracked(doc, 'PROPERTY INSPECTED', M, 104 + coverShift, { cs: 0.4 });
  doc.setFont('helvetica','bold'); doc.setFontSize(17); doc.setTextColor(...C.ink);
  const addrLines = doc.splitTextToSize(address, CW).slice(0, 2);
  doc.text(addrLines, M, 112 + coverShift, { lineHeightFactor: 1.2 });
  let gy = 112 + coverShift + (addrLines.length - 1) * 7.2 + 9;

  const coverRows = [
    ['CLIENT',            client],
    ['INSPECTION TYPE',   reportData.jobInspectionType || ''],
    ['INSPECTOR',         inspector],
    ['PEST LICENCE NO.',  reportData.inspectorLicence || ''],
    ['DATE OF INSPECTION',inspectionDate],
    ['INSPECTION TIME',   reportData.jobInspectionTime || ''],
    ['REPORT REFERENCE',  reportId],
  ].filter(([, v]) => v);

  const colW = (CW - 10) / 2, cellH = 13;
  gy -= 1;
  for (let i = 0; i < coverRows.length; i += 2) {
    [coverRows[i], coverRows[i + 1]].forEach((r, k) => {
      if (!r) return;
      const x = M + k * (colW + 10);
      doc.setFont('helvetica','bold'); doc.setFontSize(6.3); doc.setTextColor(...C.inkMuted);
      pdfTracked(doc, r[0], x, gy + 5.2, { cs: 0.3 });
      doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(...C.ink);
      doc.text(doc.splitTextToSize(String(r[1]), colW - 2)[0], x, gy + 10);
    });
    gy += cellH;
  }

  // ── RISK ASSESSMENT BADGE ─────────────────────────────────────────────────
  // The rating is spelt out in bold, so it reads the same printed in grey.
  const riskLvl   = reportData.riskLevel || null;
  const riskBadgeY = gy + 10;
  const riskCol    = riskLvl==='HIGH' ? C.danger : riskLvl==='MEDIUM' ? C.warn : riskLvl==='LOW' ? C.safe : C.inkMuted;
  const riskBgCol  = riskLvl==='HIGH' ? [253,242,240] : riskLvl==='MEDIUM' ? [253,247,234] : riskLvl==='LOW' ? [233,248,238] : [248,246,243];

  if (riskBadgeY < 262) {
    const rh = 22;
    doc.setFillColor(...riskBgCol); doc.rect(M, riskBadgeY, CW, rh, 'F');
    doc.setFillColor(...riskCol); doc.rect(M, riskBadgeY, 2.2, rh, 'F');
    doc.setDrawColor(...riskCol); doc.setLineWidth(0.35); doc.rect(M, riskBadgeY, CW, rh, 'D');
    doc.setFont('helvetica','bold'); doc.setFontSize(6.5); doc.setTextColor(...C.inkLight);
    pdfTracked(doc, 'RISK OF TERMITE ATTACK', M+8, riskBadgeY+7.5, { cs: 0.4 });
    doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.setTextColor(...riskCol);
    doc.text(riskLvl || 'PENDING ASSESSMENT', M+8, riskBadgeY+16.5);
    const basis = riskLvl ? reportSummary().basis : [];
    if (basis.length) {
      const bw = CW - 80;
      doc.setFont('helvetica','bold'); doc.setFontSize(6.3); doc.setTextColor(...C.inkMuted);
      pdfTracked(doc, 'BASED ON', W-M-6, riskBadgeY+7.5, { cs: 0.4, align: 'right' });
      doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(...C.inkLight);
      const lines = doc.splitTextToSize(basis.join(' · '), bw).slice(0, 2);
      lines.forEach((ln, i) => doc.text(ln, W-M-6, riskBadgeY+13 + i*4, { align:'right' }));
    }
  }

  // ── COVER FOOTER ──────────────────────────────────────────────────────────
  doc.setFillColor(...C.rule); doc.rect(M, 284, CW, 0.3, 'F');
  doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(...C.inkMuted);
  const footerPreparedBy = company.name ? `Prepared by ${company.name}` : 'Generated via SAYON';
  // A long business name would run into the centred line, so then the
  // centred line goes above the other two.
  const coverDisclaimer = 'This report does not conclusively determine that the property is free of termites.';
  const crowded = doc.getTextWidth(footerPreparedBy) + 4 > W/2 - doc.getTextWidth(coverDisclaimer)/2 - M;
  const footY = crowded ? 293 : 291;
  doc.text(coverDisclaimer, W/2, crowded ? 289 : 291, { align:'center' });
  doc.text(pdfFitText(doc, footerPreparedBy, CW - 40), M, footY);
  doc.setFont('helvetica','bold'); doc.setTextColor(...C.inkLight);
  doc.text(today, W-M, footY, { align:'right' });

  // ── CONTENTS ── its page is kept here and filled in at the end, once
  // every section's page is known.
  pageLabel = 'Contents';
  newPage();
  const contentsPageNo = doc.internal.getNumberOfPages();

  // A short paragraph of body text.
  function para(text, size = 8, color = C.inkLight) {
    doc.setFont('helvetica','normal'); doc.setFontSize(size);
    flowLines(doc.splitTextToSize(text, CW), M, size * 0.54, color);
    y += 3;
  }
  const co = getCompanyDetails();
  const clientPhone = reportData.jobClientPhone || document.getElementById('jobClientPhone')?.value?.trim();
  const clientEmail = reportData.jobClientEmail || document.getElementById('jobClientEmail')?.value?.trim();
  const inspectionTime = reportData.jobInspectionTime || document.getElementById('jobInspectionTime')?.value?.trim();
  const orderId  = reportData.jobOrderId || document.getElementById('jobOrderId')?.value?.trim();
  const inspType = reportData.jobInspectionType || document.getElementById('jobInspectionType')?.value?.trim();

  // ─────────────────────────────────────────────────────────────────────
  // 1. CLIENT & INSPECTION DETAILS: who it's for, where, when, what was
  // asked for, and who inspected it, before any result.
  // ─────────────────────────────────────────────────────────────────────
  startPart('Client & Inspection Details', true);
  sectionTitle('CLIENT & INSPECTION DETAILS', REPORT_PARTS.client);
  subhead('CLIENT');
  row('Client Name', client);
  row('Client Phone', clientPhone);
  row('Client Email', clientEmail);
  gap(4);
  subhead('THE INSPECTION');
  row('Property Inspected', address);
  row('Inspection Date', inspectionDate);
  row('Inspection Time', inspectionTime);
  if (reportData.peoplePresent) row('People Present', reportData.peoplePresent);
  row('Weather Conditions', reportData.weatherConditions);
  row('Temperature', reportData.temperature);
  row('Humidity', reportData.humidity);
  row('Rain in the Last 24 Hours', reportData.rainLast24h);
  if (reportData.recentWeather) row('Recent Weather', reportData.recentWeather);
  row('Inspection Type', inspType);
  row('Applicable Standard', standardLabel);
  if (reportData.toolsUsed) row('Tools Used', reportData.toolsUsed);
  row('Order / Job ID', orderId);
  row('Report Reference', reportId);
  gap(4);
  subhead('INSPECTION PROVIDER');
  row('Inspecting Company', co.name);
  row('Pest Control Licence', co.licence);
  row('ABN', co.abn);
  row('Company Phone', co.phone);
  row('Company Email', co.email);
  row('Inspector', inspector);
  row('Inspector Licence No.', reportData.inspectorLicence);
  gap(5);
  disclaimer('This report describes the property as it was on the day of the inspection. If it is relied on more than 30 days after that date, the property should be re-inspected first, because timber pest activity can start or spread in that time.');
  gap(1);
  disclaimer('The inspection covered the main building, and the other buildings, structures, fences and trees on the site within 50 metres of the main building and within the property boundaries. Anything further away was not inspected unless this report says it was.');
  if (/unit|apartment|terrace|townhouse/i.test(reportData.structureType || '')) {
    gap(1);
    disclaimer('For a unit, townhouse or other strata or company title property, only the interior of this unit and its immediate exterior were inspected. Common property and other units were not, and timber pests in them can spread to this unit. An inspection of the whole complex is recommended.');
  }

  // ─────────────────────────────────────────────────────────────────────
  // 2. SUMMARY: the reader's questions in three groups (access, activity,
  // safety & risk), each answer pointing to the section with the detail.
  // ─────────────────────────────────────────────────────────────────────
  startPart('Summary', true);
  sectionTitle('SUMMARY', REPORT_PARTS.summary);
  {
    const { groups, next } = reportSummary();
    const TONE = { bad: [C.danger, [253,242,240]], warn: [C.warn, [253,247,234]], good: [C.safe, [233,248,238]], none: [C.inkMuted, C.rowAlt] };
    const QW = CW - 72, chipW = 34, chipX = W - M - 26 - chipW;
    groups.forEach(g => {
      if (y + 22 > 276) newPage();
      doc.setFillColor(...C.accentDark); doc.rect(M, y, CW, 7, 'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...C.white);
      doc.text(g.title.toUpperCase(), M + 3, y + 4.8);
      y += 7;
      g.items.forEach(([q, answer, tone, section, detail], i) => {
        doc.setFont('helvetica','normal'); doc.setFontSize(7.2);
        const dl = detail ? doc.splitTextToSize(String(detail), QW).slice(0, 2) : [];
        const h = 9 + dl.length * 3.4;
        if (y + h > 278) newPage();
        if (i % 2 === 1) { doc.setFillColor(...C.rowAlt); doc.rect(M, y, CW, h, 'F'); }
        doc.setDrawColor(...C.ruleLight); doc.setLineWidth(0.25); doc.line(M, y + h, M + CW, y + h);
        doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(...C.ink);
        doc.text(q, M + 3, y + 5.6);
        if (dl.length) {
          doc.setFont('helvetica','normal'); doc.setFontSize(7.2); doc.setTextColor(...C.inkLight);
          doc.text(dl, M + 3, y + 9.4, { lineHeightFactor: 1.25 });
        }
        const [col, bg] = TONE[tone] || TONE.none;
        doc.setFillColor(...bg); doc.roundedRect(chipX, y + 1.8, chipW, 5.6, 1, 1, 'F');
        doc.setFillColor(...col); doc.rect(chipX, y + 1.8, 1.2, 5.6, 'F');
        doc.setFont('helvetica','bold'); doc.setTextColor(...col);
        doc.setFontSize(7.5);
        if (doc.getTextWidth(answer) > chipW - 3) doc.setFontSize(7.5 * (chipW - 3) / doc.getTextWidth(answer));
        doc.text(answer, chipX + chipW / 2 + 0.6, y + 5.6, { align: 'center' });
        doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(...C.inkMuted);
        doc.text(`See Section ${section}`, W - M - 2, y + 5.6, { align: 'right' });
        y += h;
      });
      y += 5;
    });

    if (next.length) {
      if (y + 14 > 270) newPage();
      doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(...C.accentDark);
      doc.text('WHAT TO DO NEXT', M, y); y += 2.2;
      doc.setFillColor(...C.accentLight); doc.rect(M, y, CW, 0.5, 'F'); y += 5;
      next.forEach((item, i) => {
        const lines = doc.splitTextToSize(item, CW - 8);
        if (y + lines.length * 4.3 > 276) newPage();
        doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(...C.accentDark);
        doc.text(`${i + 1}.`, M, y);
        doc.setFont('helvetica','normal'); doc.setTextColor(...C.ink);
        doc.text(lines, M + 6, y);
        y += lines.length * 4.3 + 1.8;
      });
      y += 4;
    }
    disclaimer('This summary gives the main results only. Read the full report, including the areas that could not be inspected, the limitations and the terms, before relying on it.');
  }

  // ─────────────────────────────────────────────────────────────────────
  // 3. ABOUT THE PROPERTY, with the limits that come with how it's built
  // and used printed beside the rows they belong to.
  // ─────────────────────────────────────────────────────────────────────
  startPart('About the Property', true);
  sectionTitle('ABOUT THE PROPERTY', REPORT_PARTS.property);
  heroPhoto(frontPhoto, 70, 'Front of the property');
  row('Structure Type', reportData.structureType);
  row('Height', RENAMED_CHOICES.height[reportData.height] || reportData.height);
  row('Wall Construction', reportData.wallConstruction);
  row('Floor Type', reportData.floorType);
  if (/slab/i.test(reportData.floorType || '')) {
    gap(1.5);
    disclaimer('Termites can enter a slab-on-ground building through cracks, joints and service pipes in the slab, and over its edge, where they cannot be seen. Keep the slab edge exposed and have the building inspected regularly.');
    resetRowShade();
  }
  row('Roof Type', reportData.roofType);
  row('Orientation', reportData.facadeDirection);
  row('Year / Period of Construction', reportData.constructionEra);
  // Asbestos is outside a timber pest inspection, so this is a general note
  // for buildings of the period, not a rating of this property.
  if (['1920s-1940s', '1945-1965', '1965-1985', '1985-2003'].includes(reportData.constructionEra)) {
    gap(1.5);
    disclaimer('Buildings from this period may contain asbestos-containing materials. This is not an asbestos inspection: nothing was tested or disturbed, and no opinion is given on whether asbestos is present. Have a licensed asbestos assessor check before any work that disturbs building materials.');
    resetRowShade();
  }
  if (reportData.siteSurroundings) row('Surroundings', reportData.siteSurroundings);
  if (reportData.siteSlope) row('Site Slope', reportData.siteSlope);
  if (reportData.termiteHistory) row('Known Termite History', reportData.termiteHistory);
  row('Occupancy Status', reportData.occupancyStatus);
  if (reportData.furnishing) row('Furnishing', reportData.furnishing);
  // The furniture note follows what was recorded about furniture; without
  // that, an occupied home is taken to be furnished, as before.
  const furnished = reportData.furnishing
    ? !/^unfurnished/i.test(reportData.furnishing)
    : /occupied|tenanted|owner/i.test(reportData.occupancyStatus || '');
  if (furnished) {
    gap(1.5);
    disclaimer(`The property was ${/partly/i.test(reportData.furnishing || '') ? 'partly furnished' : (reportData.furnishing ? 'furnished' : 'occupied and furnished')} at the time of inspection. Furniture, stored goods and floor coverings hid parts of the walls and floors, and timber pest activity or damage may be concealed behind them.`);
    resetRowShade();
  }

  // The termite management system, and whether it can still be inspected.
  subhead('TERMITE MANAGEMENT SYSTEM');
  row('Existing System', RENAMED_CHOICES.existingSystem[reportData.existingSystem] || reportData.existingSystem || 'None recorded');
  if (reportData.existingSystemOther) row('Specific System Name', reportData.existingSystemOther);
  row('Durable Notice Present (Meter Box)', reportData.durableNoticePresent, true);
  if (hasIdentifiedSystem(reportData.existingSystem)) {
    row('Hard Landscaping Adjacent', reportData.hardLandscaping, 'plain');
    row('25mm Inspection Zone Visible', reportData.zone25mmVisible, true);
    row('Soft Landscaping Adjacent', reportData.softLandscaping, 'plain');
    row('75mm Inspection Zone Visible', reportData.zone75mmVisible, true);
    row('Ant Cap / Strip Shield Joins Soldered', reportData.antCapSoldered, true);
    const concerns = [];
    if (reportData.durableNoticePresent === 'NO') concerns.push('Durable notice sticker not found in meter box');
    if (reportData.hardLandscaping === 'YES' && reportData.zone25mmVisible === 'NO') concerns.push('25mm inspection zone not visible against hard landscaping');
    if (reportData.softLandscaping === 'YES' && reportData.zone75mmVisible === 'NO') concerns.push('75mm inspection zone not visible against soft landscaping');
    if (reportData.antCapSoldered === 'NO') concerns.push('Ant cap / strip shield joins not soldered');
    if (concerns.length > 0) {
      gap(3);
      callout('System verification concern', concerns.join('. ') + '. These checks confirm the system can still be inspected, not that it works. Rectification and re-inspection are recommended.', 'bad');
    }
  }
  renderSectionPhotosInPDF('durable', 'Durable Notice');
  notesBlock('property');
  // Older reports could hold more than one front photo: the rest print here.
  renderSectionPhotosInPDF(null, 'Property', ((reportData.photosBySection || {}).general || []).filter(p => p !== frontPhoto));

  // ─────────────────────────────────────────────────────────────────────
  // 4. AREAS INSPECTED: every area, how much of it was inspected, and
  // what was found there.
  // ─────────────────────────────────────────────────────────────────────
  startPart('Areas Inspected');
  sectionTitle('AREAS INSPECTED', REPORT_PARTS.areas);
  resetRowShade();
  const AREA_STATUS_TEXT = { INSPECTED:'Inspected', PARTIAL:`Inspected with limits (see Section ${REPORT_PARTS.access})`, NOT:'NOT INSPECTED' };
  const anyStatus = Object.keys(OBS_ZONES).some(z => areaStatusOf(z));
  const noneRow = complete => row('Result', complete ? 'None' : 'Not recorded');
  para(`Each area of the property, how much of it could be inspected, and whether timber pest evidence was found there. Why an area could not be fully inspected is set out in Section ${REPORT_PARTS.access}.`);
  Object.entries(OBS_ZONES).forEach(([zoneId, zone]) => {
    const st = areaStatusOf(zoneId);
    // An area the property doesn't have isn't listed.
    if (!st || st === 'NA') return;
    const result = areaResultOf(zoneId);
    // With no result marked, evidence recorded elsewhere that names the area
    // still prints, rather than "not recorded" over a finding in it.
    const ev = result === 'FOUND' || !result ? areaEvidence(zoneId) : [];
    const resultText = !result && !ev.length ? 'Result not recorded'
      : ev.length ? `Timber pest evidence found, see ${ev.join('; ')}` : AREA_RESULT_TEXT[result];
    row(zone.label, AREA_STATUS_TEXT[st] + (areaWasEntered(zoneId) ? `. ${resultText}.` : ''));
  });
  if (!anyStatus) noneRow(false);
  notesBlock('obstructions');
  renderSectionPhotosInPDF('obstructions', 'Areas Inspected');

  // ─────────────────────────────────────────────────────────────────────
  // 5. AREAS UNABLE TO BE INSPECTED, AND WHY: hindered access (temporary
  // obstructions), restricted access (permanent or locked), the high risk
  // areas to which access should be gained, and whether an invasive
  // inspection is recommended because of them. See accessLimits().
  // ─────────────────────────────────────────────────────────────────────
  startPart('Areas Unable to Be Inspected');
  sectionTitle('AREAS UNABLE TO BE INSPECTED, AND WHY', REPORT_PARTS.access);
  const acc = accessLimits();
  const noLimits = !areasNotFullyInspected().length;

  subhead('OBSTRUCTIONS: TEMPORARY, AT THE TIME OF INSPECTION');
  acc.hindered.forEach(([label, text]) => row(label, text));
  if (!acc.hindered.length) noneRow(hinderedAnswer() === 'NO' || (acc.allMarked && noLimits));
  gap(3);

  subhead('RESTRICTED ACCESS: PERMANENT RESTRICTION OR LOCKED ENTRY');
  acc.restricted.forEach(([label, text]) => row(label, text));
  if (!acc.restricted.length) noneRow(acc.allMarked);
  gap(3);

  subhead('HIGH RISK AREAS TO WHICH ACCESS SHOULD BE GAINED, OR FULLY GAINED');
  if (acc.highRisk) {
    row('Access should be gained to', acc.highRisk);
    gap(3);
    disclaimer('These areas may show evidence of timber pest activity or damage. Access should be gained, or fully gained, and a further inspection carried out. Until then it must be assumed that timber pest activity or damage may exist in them.');
  } else {
    noneRow(acc.allMarked);
  }
  gap(3);

  subhead('INVASIVE INSPECTION');
  row('Invasive Inspection Recommended', reportData.invasiveInspection || 'Not recorded');
  if (reportData.invasiveInspectionDetails) row('Where, Why and When', reportData.invasiveInspectionDetails);
  if (reportData.invasiveInspection === 'YES') {
    gap(3);
    disclaimer('An invasive inspection may involve cutting, drilling or removing linings, floor coverings or timbers to see inside them. It needs the owner\'s written permission and a separate agreement.');
  }
  notesBlock('restrictions');
  renderSectionPhotosInPDF(null, 'Obstructions and restricted access', accessSpotPhotos());
  renderSectionPhotosInPDF('restrictions', 'Areas Unable to Be Inspected');

  // ─────────────────────────────────────────────────────────────────────
  // 6. FINDINGS
  // ─────────────────────────────────────────────────────────────────────
  startPart('Findings');
  sectionTitle('FINDINGS', REPORT_PARTS.findings, 85);

  const findings = (reportData.findings && reportData.findings.length > 0)
    ? reportData.findings
    : [{ termiteActivity: reportData.termiteActivity, species: reportData.species, damageDescription: reportData.damageDescription, activityLocation: reportData.activityLocation, nestLocated: reportData.nestLocated, structuralConcern: reportData.structuralConcern }];

  // ── Finding card renderer ────────────────────────────────────────────
  // One card per termite or borer finding: a coloured header with the
  // status, then the labelled facts, the builder referral and the photos.
  // card: { heading, status, tone (bad | warn | none), species, fields:
  // [[label, value, colour?]], referral, photosId }
  function pestCard(card) {
    const actCol = card.tone === 'bad' ? C.danger : card.tone === 'warn' ? C.warn : C.inkMuted;
    const actBg  = card.tone === 'bad' ? [253,242,240] : card.tone === 'warn' ? [253,247,234] : [248,246,243];
    const fields = card.fields.filter(([, v]) => v && String(v).trim());
    const lines  = fields.reduce((n, [, v]) => n + doc.splitTextToSize(String(v), CW - 12).length, 0);
    const cardEstH = 18 + (card.species ? 17 : 0) + fields.length * 9.5 + lines * 4.5 + (card.referral ? 20 : 0) + 8;

    if (y + Math.min(cardEstH, 60) > 275) newPage();

    const cardStartY = y, cardStartPage = doc.internal.getNumberOfPages();
    const bodyPad = 6;
    const bodyX   = M + bodyPad;
    const bodyW   = CW - bodyPad * 2;

    // Header
    const headerH = 13;
    doc.setFillColor(...actBg); doc.rect(M, y, CW, headerH, 'F');
    doc.setFillColor(...actCol); doc.rect(M, y, 1.5, headerH, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(...C.inkMuted);
    doc.text(card.heading, M+8, y+5.5);
    doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(...actCol);
    doc.text(card.status, M+8, y+10.5);
    y += headerH + 5;

    // Species
    if (card.species) {
      doc.setFillColor(245,243,240); doc.roundedRect(bodyX, y, bodyW, 10, 1, 1, 'F');
      doc.setDrawColor(...C.rule); doc.setLineWidth(0.3); doc.roundedRect(bodyX, y, bodyW, 10, 1, 1, 'D');
      doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(...C.inkMuted);
      doc.text('SPECIES / GENUS', bodyX+4, y+4.5);
      doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(...C.ink);
      doc.text(card.species, bodyX+4, y+8.5);
      y += 17;
    }

    // The facts, each a small label over its value. A coloured value is a
    // short answer (YES / NO), set in bold.
    fields.forEach(([label, value, colour]) => {
      if (y > 268) newPage();
      doc.setFont('helvetica','bold'); doc.setFontSize(6.5); doc.setTextColor(...C.inkMuted);
      doc.text(label.toUpperCase(), bodyX, y); y += 4.5;
      doc.setFont('helvetica', colour ? 'bold' : 'normal'); doc.setFontSize(8.5); doc.setTextColor(...(colour || C.ink));
      const w = doc.splitTextToSize(String(value), bodyW);
      if (y + w.length * 4.5 > 278) newPage();
      doc.text(w, bodyX, y); y += w.length * 4.5 + 3.5;
    });

    // Builder / engineer referral
    if (card.referral) {
      callout('Builder or engineer referral', 'The inspector recommends a licensed builder or structural engineer assess this damage, and any effect on the structure, before work proceeds.', 'bad', bodyX, bodyW);
    }

    // This finding's own photos, inside its card.
    const fPhotos = card.photosId ? ((reportData.photosBySection || {})[findingPhotoSection(card.photosId)] || []) : [];
    if (fPhotos.length) {
      // The label goes over with the first row of photos, never alone.
      const firstRowH = ((bodyW - 5) / 2) * 0.72 + 12;
      if (y + 3 + firstRowH > 280) newPage();
      doc.setFont('helvetica','bold'); doc.setFontSize(6.5); doc.setTextColor(...C.inkMuted);
      doc.text('PHOTOS', bodyX, y); y += 3;
      photoGrid(fPhotos, bodyX, bodyW);
    }

    // A card that ends on a line of text needs less room below it.
    y += card.referral || fPhotos.length ? 3 : 0;
    // The outline only fits a card that stayed on one page.
    if (doc.internal.getNumberOfPages() === cardStartPage) {
      doc.setDrawColor(...C.rule); doc.setLineWidth(0.4);
      doc.rect(M, cardStartY, CW, y - cardStartY, 'D');
    }
    y += 8;
  }

  function findingCard(f, idx) {
    const activity = (f.termiteActivity || '').toUpperCase();
    const nest = f.nestLocated === 'YES' ? ['YES', C.danger] : f.nestLocated ? ['NO', C.safe] : ['NOT RECORDED', C.inkMuted];
    pestCard({
      heading: `TERMITE FINDING ${idx + 1}`,
      status: activity === 'ACTIVE' ? 'LIVE TERMITES PRESENT' : activity === 'INACTIVE' ? 'EVIDENCE ONLY — NO LIVE TERMITES' : activity ? 'NO ACTIVITY FOUND' : 'NOT RECORDED',
      tone: activity === 'ACTIVE' ? 'bad' : activity === 'INACTIVE' ? 'warn' : 'none',
      species: f.species && f.species.trim(),
      fields: [
        ['Location of activity', f.activityLocation],
        ['Timber affected', f.timberAffected],
        ['Damage / workings description', f.damageDescription],
        ['Termite nest found?', nest[0], nest[1]],
      ],
      referral: f.structuralConcern === 'YES',
      photosId: f.id,
    });
  }

  function borerCard(b, idx) {
    pestCard({
      heading: `BORER FINDING ${idx + 1}`,
      status: b.borerActivity === 'ACTIVE' ? 'ACTIVE BORERS — FRESH FRASS OR HOLES' : 'OLD BORER DAMAGE — NOTHING FRESH',
      tone: b.borerActivity === 'ACTIVE' ? 'bad' : 'warn',
      fields: [
        ['Location', b.location],
        ['Timber affected', b.timberAffected],
        ['Borer type', b.borerType],
        ['What was seen', b.description],
      ],
      referral: b.structuralConcern === 'YES',
      photosId: b.id,
    });
  }

  subhead('TERMITES');
  // A report with nothing recorded about termites says so in a row, rather
  // than printing an empty "Not recorded" finding card.
  const findingRecorded = f => ['termiteActivity','species','activityLocation','timberAffected','damageDescription','nestLocated','structuralConcern']
    .some(k => f[k] && String(f[k]).trim()) || ((reportData.photosBySection || {})[findingPhotoSection(f.id)] || []).length;
  if (findings.some(findingRecorded)) findings.forEach((f, idx) => findingCard(f, idx));
  else { row('Termite Activity', 'Not recorded'); gap(4); }

  // Borers, decay and delignification: the other timber pests AS 4349.3
  // covers. Always printed, so an unanswered field reads "Not recorded"
  // rather than silently implying "none found" (row() drops empty values).
  subhead('BORERS, WOOD DECAY & CHEMICAL DELIGNIFICATION');
  row('Borers of Seasoned Timber', reportData.borerActivity || 'Not recorded');
  const borerCards = shownBorerFindings();
  if (borerCards.length) { gap(4); borerCards.forEach(borerCard); }
  row('Wood Decay Fungi (Rot)', reportData.decayFound || 'Not recorded');
  if (reportData.decayDetails) row('Wood Decay: What Was Seen', reportData.decayDetails);
  if (reportData.decayWhere) row('Wood Decay: Where', reportData.decayWhere);
  row('Chemical Delignification', reportData.delignification || 'Not recorded');
  if (reportData.delignificationDetails) row('Delignification: What Was Seen', reportData.delignificationDetails);
  if (reportData.delignificationWhere) row('Delignification: Where', reportData.delignificationWhere);
  gap(3);

  subhead('PREVIOUS TERMITE TREATMENT');
  row('Evidence of Previous Treatment', reportData.previousTreatment || 'Not recorded');
  if (reportData.previousTreatmentDetails) row('What Was Seen', reportData.previousTreatmentDetails);
  if (reportData.previousTreatmentWhere) row('Where', reportData.previousTreatmentWhere);
  gap(5);

  disclaimer('This inspection describes the location and visible extent of timber pest activity only. It does not assess structural damage severity — a licensed builder or structural engineer must be engaged for that purpose. Where live termites are found, concealed activity must be assumed in all areas not inspected.');
  notesBlock('findings');
  gap(4);
  renderSectionPhotosInPDF('findings', 'Findings');

  // ─────────────────────────────────────────────────────────────────────
  // 7. CONDUCIVE CONDITIONS. A condition that was found carries a line on
  // why it matters.
  // ─────────────────────────────────────────────────────────────────────
  startPart('Conducive Conditions');
  sectionTitle('CONDUCIVE CONDITIONS', REPORT_PARTS.conducive);
  resetRowShade();
  para('Conditions that make timber pest attack more likely. Each one found is explained, and should be fixed.');
  const WHY_IT_MATTERS = {
    waterLeaks: 'Leaking water keeps timber and soil damp, which attracts termites and lets wood decay start.',
    moistureReadings: 'Damp timber and building elements attract termites and let wood decay start.',
    siteDrainage: 'Water lying around the building keeps the soil damp, which attracts termites.',
    subfloorDrainage: 'Water lying in the subfloor keeps it damp, which attracts termites and lets wood decay start.',
    subfloorVentilation: 'A poorly ventilated subfloor stays damp, which attracts termites and lets wood decay start.',
    timberSoil: 'Timber touching the soil gives termites a hidden way into the timber, and from there into the building.',
    slabEdge: 'A covered slab edge lets termites enter the building out of sight. Keep the slab edge exposed so it can be inspected.',
    weepHoles: 'Weep holes covered by soil, paving or garden beds give termites a hidden way into the wall cavity.',
    antCapping: 'Ant caps do not stop termites, but make them build their mud leads in the open where they can be seen. Gaps or missing caps let them pass unseen.',
    nonDurableTimber: 'Untreated or non-durable timber in damp areas is readily attacked by termites and wood decay.',
    mouldSeen: 'Mould is a sign of damp conditions, which attract termites and let wood decay start. This is not a mould inspection, and no opinion is given on the mould itself.',
  };
  const ADVERSE = { waterLeaks: ['YES'], moistureReadings: ['YES'], siteDrainage: ['POOR'], subfloorDrainage: ['POOR'], subfloorVentilation: ['POOR'], mouldSeen: ['YES'],
    timberSoil: ['YES'], slabEdge: ['OBSTRUCTED'], weepHoles: ['BRIDGED'], antCapping: ['GAPS', 'NONE'], nonDurableTimber: ['YES'] };
  function condRow(label, key, shown) {
    const v = reportData[key];
    row(label, shown || v);
    if (v && (ADVERSE[key] || []).includes(v) && WHY_IT_MATTERS[key]) {
      doc.setFont('helvetica','italic'); doc.setFontSize(7.3);
      const lines = doc.splitTextToSize(WHY_IT_MATTERS[key], CW - 8);
      if (y + lines.length * 3.6 + 3 > 280) newPage();
      doc.setTextColor(...C.inkLight);
      doc.text(lines, M + 3, y + 3.6); y += lines.length * 3.6 + 2.5;
      doc.setFont('helvetica','normal');
      resetRowShade();
    }
  }

  // ── Moisture group ─────────────────────────────────────────────────────
  const meterReadings = (reportData.moistureTable || []).filter(r => r.location || r.reading);
  subhead('MOISTURE, DRAINAGE & VENTILATION');
  condRow('Water Leaks', 'waterLeaks');
  if (reportData.waterLeaks === 'YES' || reportData.leakLocation) {
    row('Location of Moisture Ingress', reportData.leakLocation);
    if (isAboveGroundLeak(reportData.leakLocation)) {
      gap(2);
      callout('Above-ground leak', 'Subterranean termites can establish a secondary moisture-dependent colony in roof voids and wall cavities with no soil contact. Timbers next to this leak should be checked specifically.', 'warn');
    }
  }
  condRow('Moisture Detected', 'moistureReadings');
  meterReadings.forEach(r => row('Moisture Meter Reading', [r.reading, r.location].filter(Boolean).join(' — ')));
  condRow('Site Drainage', 'siteDrainage');
  condRow('Subfloor Drainage', 'subfloorDrainage');
  condRow('Subfloor Ventilation', 'subfloorVentilation');
  if (reportData.mouldSeen) condRow('Mould Seen', 'mouldSeen');
  if (reportData.mouldWhere) row('Mould: Where', reportData.mouldWhere);
  gap(4);

  // ── Construction group ─────────────────────────────────────────────────
  subhead('CONSTRUCTION & PHYSICAL BARRIERS');
  condRow('Timber-to-Soil Contact', 'timberSoil');
  condRow('Slab Edge Concealed', 'slabEdge');
  condRow('Weep Holes', 'weepHoles', reportData.weepHoles === 'NONE' ? 'None located' : '');
  condRow('Ant Capping', 'antCapping');
  if (reportData.antCappingDetails) row('Ant Capping: Where and What', reportData.antCappingDetails);
  condRow('Non-durable Timber in Damp Areas', 'nonDurableTimber');
  if (reportData.nonDurableTimberDetails) row('Non-durable Timber: What', reportData.nonDurableTimberDetails);
  if (reportData.nonDurableTimberWhere) row('Non-durable Timber: Where', reportData.nonDurableTimberWhere);
  gap(4);

  notesBlock('conducive');
  gap(4);
  renderSectionPhotosInPDF('conducive', 'Conducive Conditions');

  // ─────────────────────────────────────────────────────────────────────
  // 8. RECOMMENDATIONS & RISK: the one risk opinion, and what to do.
  // ─────────────────────────────────────────────────────────────────────
  startPart('Recommendations & Risk');
  sectionTitle('RECOMMENDATIONS & RISK', REPORT_PARTS.recommendations);
  resetRowShade();
  if (reportData.riskLevel) { riskBanner(reportData.riskLevel); y -= 2; }
  disclaimer('The risk of termite attack is the inspector\'s opinion of how susceptible the property is to termite attack, from what was found, the conducive conditions and the areas that could not be inspected. It is not a rating of any termites found.');
  gap(2);
  if (!reportData.riskLevel) row('Risk of Termite Attack', 'Not recorded');
  row('Treatment Recommended', reportData.treatmentRecommended);
  row('Treatment Type', reportData.treatmentType);
  row('Re-inspection Interval', reportData.inspectionFrequency);
  if (reportData.invasiveInspection === 'YES') row('Invasive Inspection', `Recommended, see Section ${REPORT_PARTS.access}`);
  if (reportData.otherRecommendations) row('Other Recommendations', reportData.otherRecommendations);
  if (getRecLines().length) row('Also Recommended', getRecLines().map(l => `•  ${l.text}`).join('\n'));
  notesBlock('recommendations');
  renderSectionPhotosInPDF('recommendations', 'Recommendations');
  gap(4);
  disclaimer('Note: standard home and contents insurance policies in Australia typically do not cover damage caused by termites or other timber pests. Treatment and any resulting repairs are generally the responsibility of the property owner.');
  gap(8);

  // 9. PHOTOGRAPHS
  photoGallery();

  // ─────────────────────────────────────────────────────────────────────
  // 10. SCOPE, LIMITATIONS, DEFINITIONS & TERMS
  // ─────────────────────────────────────────────────────────────────────
  startPart('Scope, Limitations, Definitions & Terms', true);
  sectionTitle('SCOPE, LIMITATIONS, DEFINITIONS & TERMS', REPORT_PARTS.terms);

  function infoPara(text) {
    doc.setFont('helvetica','normal'); doc.setFontSize(8);
    flowLines(doc.splitTextToSize(text, CW), M, 4.3, C.inkLight);
    y += 4;
  }
  function infoHeading(text) {
    if (y > 262) newPage();
    gap(3);
    doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(...C.ink);
    doc.text(text, M, y); y += 6;
  }
  // A heading for each of the three parts of this section.
  function partHeading(text) {
    if (y > 250) newPage();
    gap(2);
    doc.setFont('helvetica','bold'); doc.setFontSize(9.5); doc.setTextColor(...C.accentDark);
    doc.text(text.toUpperCase(), M, y);
    doc.setFillColor(...C.ruleLight); doc.rect(M, y + 2.2, CW, 0.4, 'F');
    y += 9;
  }

  partHeading('Scope and limitations');
  infoPara('This was a visual, non-invasive inspection of the property for evidence of timber pest activity, damage, and conditions conducive to timber pest attack. It was carried out by a licensed timber pest inspector with reference to the applicable Australian Standard, and is limited to those areas and sections of the property that were safely and reasonably accessible at the time of inspection.');

  infoHeading('What timber pests are covered?');
  infoPara('This inspection covers subterranean termites (white ants), drywood termites, wood borers, wood decay fungi (rot) and chemical delignification where evidence is observable in accessible areas. These are the timber pests defined in AS 4349.3-2010.');

  infoHeading('What does "non-invasive" mean?');
  infoPara('This inspection does not involve moving furniture, lifting floor coverings, cutting into walls, removing ceiling linings, dismantling built-in cabinetry, or any other action that could cause damage to the property or its contents. The inspector uses visual observation, a probe or screwdriver for tapping and sounding, and a moisture meter where appropriate. Splinter testing of structural timbers in the subfloor or roof void may be carried out where it can be done safely and with the property owner\'s consent.');

  infoHeading('What is "Reasonable Access"?');
  infoPara('Reasonable access is defined in AS 4349.3-2010 as access to areas of the property that can be inspected without the need to remove, move, or dismantle any fixed or stored items, and which can be reached using a 3.6m ladder or less from the ground. Subfloor areas require a minimum clearance of 400mm under the lowest bearer, and roof voids require an access opening of at least 450mm x 400mm. Areas not meeting these criteria are outside the scope of this inspection.');

  infoHeading('Does this inspection guarantee the property is free of termites?');
  infoPara('No. A visual, non-invasive inspection of this type cannot detect timber pest activity or damage concealed within walls, under floors, inside structural timbers, or in any area that was not accessible at the time of inspection. Termites frequently operate within concealed spaces without external evidence. This report reflects the observable condition of the property at the specific date and time of inspection only. Regular professional re-inspections are the most effective ongoing protection available.');

  // ── DEFINITIONS ──────────────────────────────────────────────────────────
  gap(4);
  partHeading('Definitions');

  const defs = [
    ['Timber Pests', 'Subterranean termites, drywood termites, borers of seasoned timber, wood decay fungi (rot) and chemical delignification, as defined in AS 4349.3-2010.'],
    ['Chemical Delignification', 'The breakdown of timber by chemicals, often from salt air or industrial or chimney emissions, which leaves the surface of the timber looking furry or fibrous.'],
    ['Visual Inspection', 'An inspection conducted by an inspector who uses their unaided visual faculties, and may use a probe, screwdriver, or moisture meter, to observe accessible areas of the property for evidence of timber pest activity, damage, and conducive conditions.'],
    ['Reasonable Access', 'Access to areas of a building that are safe, accessible, and do not require any removal, dismantling, or disturbance of fixed or stored items. Access is via a standard 3.6m ladder from ground level. Subfloor access requires minimum 400mm clearance; roof void access requires minimum 450mm x 400mm opening.'],
    ['Readily Accessible Area', 'An area that can be inspected without moving furniture, stored goods, floor coverings, wall or ceiling linings, insulation, or personal possessions.'],
    ['Obstructions', 'An area, or part of one, that could not be fully inspected because of temporary obstructions at the time of inspection, such as furniture, stored goods, floor coverings, insulation, vegetation, or low clearance in the subfloor or roof void. The inspector is not required to move obstructions.'],
    ['Restricted Access', 'An area that could not be inspected because of a permanent restriction or locked entry, such as a locked room, a subfloor with no access opening, a roof with no roof void, or a part of the building beyond safe reach.'],
    ['High Risk Areas', 'Areas to which access was not available, or not fully available, that are considered at high risk of concealed timber pest activity. Access should be gained and these areas inspected.'],
    ['Invasive Inspection', 'A further inspection in which linings, floor coverings or timbers may be cut, drilled or removed to look inside them. It needs the owner\'s written permission and a separate agreement.'],
    ['Conducive Conditions', 'Conditions that may attract termites or provide conditions favourable to timber pest activity, including moisture, timber-to-soil contact, inadequate drainage and ventilation, and conditions that compromise the integrity of an existing termite management system.'],
    ['Active Termites', 'Live termites sighted by the inspector during the inspection.'],
    ['Inactive / Evidence Only', 'Evidence of termite activity, such as workings, mudding, damaged timber or galleries, where no live termites were seen at the time of inspection. It does not show when the activity happened or whether termites are still present in concealed areas, so it should be investigated further and the recommendations in this report followed.'],
    ['Previous Treatment', 'Signs that the property has been treated for termites before, such as drill holes in slabs or paving, dusting residue, or bait or monitoring stations. It does not show whether that treatment is still working.'],
  ];

  defs.forEach(([term, def]) => {
    if (y + 14 > 278) newPage();
    doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...C.ink);
    doc.text(term + ':', M, y); y += 4.5;
    const wrapped = doc.splitTextToSize(def, CW - 4);
    doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(...C.inkLight);
    doc.text(wrapped, M + 3, y); y += wrapped.length * 4 + 5;
  });

  gap(4);

  // ── IMPORTANT NOTICE ─────────────────────────────────────────────────────
  if (y + 28 > 278) newPage();
  doc.setFillColor(...C.accentLight); doc.roundedRect(M, y, CW, 28, 2, 2, 'F');
  doc.setFillColor(...C.accent); doc.roundedRect(M, y, 3, 28, 2, 2, 'F'); doc.rect(M+1.5, y, 1.5, 28, 'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...C.accentDark);
  doc.text('IMPORTANT NOTICE', M+7, y+7);
  doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(...C.ink);
  const noticeLines = doc.splitTextToSize('This inspection fee covers the cost of the inspection and report only. Treatment of any timber pest activity or damage identified, and any remedial work required, is not included in this fee and is the responsibility of the property owner. Standard home and contents insurance policies generally do not cover termite damage. If you have concerns about your coverage, contact your insurer directly.', CW - 14);
  doc.text(noticeLines, M+7, y+13);
  y += 34;

  pageLabel = 'Terms & Conditions of Inspection';
  newPage();
  partHeading('Terms and conditions of inspection');

  const TC = { font:'helvetica', size:8, color:[50,44,38], leading:4.4 };

  function tcHeading(text) {
    if (y > 262) newPage();
    gap(4);
    // Subtle blue left bar for each clause heading
    doc.setFillColor(...C.accent); doc.rect(M, y-1, 2, 8, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(...C.ink);
    doc.text(text, M+6, y+5); y += 11;
  }
  function tcPara(text) {
    doc.setFont(TC.font,'normal'); doc.setFontSize(TC.size);
    flowLines(doc.splitTextToSize(text, CW-6), M+6, TC.leading, TC.color);
    y += 4;
  }

  tcHeading('1. Purpose and Nature of This Inspection');
  tcPara(`This report records the findings of a visual, non-invasive timber pest inspection carried out with reference to ${standard}. The purpose is to identify observable evidence of timber pest activity, damage, and conditions conducive to pest attack within the accessible areas of the property at the time of inspection. This is not a structural inspection, a pest control treatment, a compliance audit, or a certificate of any kind, and it does not constitute a warranty or guarantee that the property is or will remain free of timber pests or associated damage.`);

  tcHeading('2. Scope of Inspection');
  tcPara('The inspection was confined to areas that were safely and reasonably accessible at the time of the inspection. Readily accessible areas are defined in AS 4349.3-2010 as those that can be inspected without moving furniture, lifting or removing floor coverings or wall linings, breaking apart building elements, exposing concealed spaces, or causing damage to the structure or its contents. The inspector did not move, displace, or remove any floor coverings, insulation, wall linings, ceiling materials, fixed cabinetry, furniture, stored items, or personal belongings. Subfloor and roof void areas were inspected only where safe and reasonable access was available and where minimum clearance dimensions prescribed in the relevant Standard were satisfied.');

  tcHeading('3. Areas Not Inspected — Obstructions and Restricted Access');
  tcPara(`Certain areas of the property could not be inspected, or fully inspected, because of temporary obstructions, or because access was restricted by a permanent restriction or locked entry, as recorded in Section ${REPORT_PARTS.access}. It is acknowledged that timber pest activity or damage may exist within any area that could not be inspected. Where high risk areas have been identified or further investigation recommended, a follow-up inspection should be carried out once access is available. The absence of recorded findings in any area is not a representation that those areas are free of timber pest activity or damage.`);

  tcHeading('4. Limitations of a Visual Non-Invasive Inspection');
  tcPara('A visual, non-invasive inspection of the type described in AS 4349.3-2010 cannot detect activity or damage concealed within wall cavities, structural timber members, beneath floor slabs or coverings, inside hollow trees or stumps, behind fixed linings, or in any area that cannot be directly observed without causing damage. Subterranean termites are frequently active inside walls, flooring, and structural framing without any external indicators being visible. The findings of this report reflect observable conditions in accessible areas at the time of inspection only. No inspection of this nature can conclusively establish that a property is free of timber pest infestation, activity, or damage.');

  tcHeading('5. Damage Assessment — No Structural Opinion');
  tcPara('Where timber pest damage has been recorded in this report, the description is limited to the observable location, affected building elements, and visible characteristics of the damage. The inspector is not qualified to assess the structural significance of any damage identified, and no opinion regarding structural integrity, load-bearing capacity, or engineering risk is expressed or implied in this report. Where a builder or engineer referral has been made, the client is strongly advised to engage a licensed builder or structural engineer to carry out a structural assessment before undertaking any remedial work or making decisions in reliance on that finding.');

  tcHeading('6. Conditions May Change After Inspection');
  tcPara('The findings of this report reflect the observable condition of the property at the specific date and time of inspection. Timber pest colonies are dynamic and can expand, relocate, or establish new workings rapidly. Conditions at the property may change materially after the inspection date due to moisture fluctuations, building alterations, landscaping changes, or the natural movement of pest colonies. This report does not warrant or predict the future condition of the property, and the client is advised that regular professional re-inspections are the most effective ongoing protection measure available.');

  tcHeading('7. Insurance');
  tcPara('Standard home, contents, and building insurance policies in Australia do not generally cover loss or damage caused by termites, timber borers, or other timber pests. Timber pest damage is typically treated by Australian insurers as gradual deterioration rather than a sudden or accidental event and is excluded from most mainstream policies. The client is encouraged to obtain written confirmation from their insurer regarding the specific extent of their coverage before acting in reliance on this report.');

  tcHeading('8. Reliance on This Report — Client Use Only');
  // The "get a pre-purchase inspection" advice only makes sense on a report
  // that isn't one.
  tcPara('This report has been prepared exclusively for the use of the client named on the cover page of this document. It must not be provided to, or relied upon by, any third party without the prior written consent of the inspecting company. '
    + (prePurchase ? '' : 'Where this report has been sought in connection with a proposed property purchase, a formal Prior-to-Purchase Timber Pest Inspection prepared with reference to AS 4349.3-2010 and obtained prior to exchange of contracts is strongly advised. ')
    + 'The inspecting company and inspector accept no responsibility or liability to any party other than the named client for any loss, damage, or expense arising from reliance on the contents of this report.');

  tcHeading('9. Recommended Re-inspection Frequency');
  tcPara("Annual timber pest inspections are the minimum recommended frequency under AS 3660.2-2017 in the absence of an installed termite management system. Where elevated risk factors are present — including proximity to bushland or trees, prior termite history at the property, high-moisture conditions in the subfloor or roof void, the presence of timber-to-soil contact, or susceptible construction materials — a six-monthly re-inspection interval is recommended. Where an existing termite management system is installed and verified, the re-inspection frequency specified by the system installer and manufacturer should be followed. Failure to maintain regular inspection intervals may affect the terms of any system warranty in place.");

  tcHeading('10. Applicable Standards and Legislation');
  tcPara(`This inspection and report have been prepared with reference to ${standard} and, where applicable, the AEPMA (Australian Environmental Pest Managers Association) Code of Practice for Timber Pest Inspections. Termite management recommendations refer to AS 3660.2-2017 (Termite Management — In and Around Existing Buildings and Structures). Where the property is newly constructed or has been subject to recent building work, the termite management provisions of the National Construction Code (NCC) and AS 3660.1-2014 (Termite Management — New Building Work) may also apply. State and Territory legislation may impose requirements additional to those set out in this Standard. This report is not a safety inspection, does not constitute advice regarding compliance with any building code or regulation, and is not a certificate of compliance under any legislation.`);

  gap(6);
  if (y + 12 > 278) newPage();
  doc.setFillColor(...C.accentLight);
  doc.setDrawColor(...C.accent);
  doc.setLineWidth(0.7);
  doc.roundedRect(M, y, CW, 12, 2, 2, 'FD');
  doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(...C.accentDark);
  doc.text('This report must be read in its entirety, including these Terms and Conditions, before any reliance is placed upon its contents.', M + CW/2, y + 7.5, { align:'center', maxWidth: CW - 8 });
  y += 18;

  // ─────────────────────────────────────────────────────────────────────
  // 11. INSPECTOR DETAILS and 12. CLIENT ACKNOWLEDGEMENT, kept together.
  // ─────────────────────────────────────────────────────────────────────
  startPart('Inspector Details', y > 120);
  sectionTitle('INSPECTOR DETAILS', REPORT_PARTS.inspector);
  // Signature blocks: the value sits on the line, its caption under it.
  const sigColW = (CW - 16) / 3;
  const onSigLine = (text, x) => drawPdfOnLine(doc, text, x, y, sigColW);
  const provider = [co.name, co.phone, co.email].filter(Boolean).join('  ·  ');
  if (provider) {
    doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(...C.inkLight);
    doc.text(provider, M, y); y += 4;
  }
  y += 14;
  onSigLine(inspector || 'Not specified', M);
  drawPdfSignature(doc, { x: M, y, w: sigColW, caption: 'Inspector name' });
  onSigLine(reportData.inspectorLicence, M + sigColW + 8);
  drawPdfSignature(doc, { x: M + sigColW + 8, y, w: sigColW, caption: 'Pest licence no.' });
  onSigLine(today, M + (sigColW + 8) * 2);
  drawPdfSignature(doc, { x: M + (sigColW + 8) * 2, y, w: sigColW, caption: 'Date' });
  y += 22;
  drawPdfSignature(doc, { x: M, y, w: sigColW * 2 + 8, caption: 'Inspector signature', image: reportData.inspectorSignature });
  y += 12;

  startPart('Client Acknowledgement', y > 175);
  sectionTitle('CLIENT ACKNOWLEDGEMENT', REPORT_PARTS.acknowledgement);
  disclaimer('This report relates to the condition of the property in respect of timber pest activity at the time of inspection, limited to those areas that were reasonably accessible. It is not a warranty, guarantee, or certificate of compliance with any law, insurance policy, or building standard, and does not guarantee the property is, or will remain, free of termites or other timber pests. Conditions affecting the property may change after the inspection date, and concealed or inaccessible areas may contain damage or activity that could not be identified.');
  gap(2);
  if (!prePurchase) {
    disclaimer('This report is for the sole use of the client named above and is not intended for use by third parties. It is not suitable for use where the property is being bought or sold — a Prior-to-Purchase inspection with reference to AS 4349.3-2010 should be obtained for that purpose.');
    gap(2);
  }
  disclaimer('The client acknowledges the contents of this report and that the inspection has limitations. This report does not conclusively determine that the property is free of termites.');

  // The client signs the pre-inspection agreement before the job; its full
  // wording is the appendix. Reports from before that change have a client
  // signature captured at sign-off instead, printed as it was.
  const agreement = reportData.agreement;
  if (y + 36 > 278) newPage();
  y += agreement ? 18 : 24;
  if (agreement) {
    onSigLine(agreement.signerName, M);
    drawPdfSignature(doc, { x: M, y, w: sigColW, caption: 'Agreed by' });
    drawPdfSignature(doc, { x: M + sigColW + 8, y, w: sigColW, caption: agreement.signature ? 'Client signature' : 'How it was signed',
      image: agreement.signature, note: agreement.signature ? '' : agreement.otherNote });
    onSigLine(formatAgreementSignedAt(agreement.signedAt), M + (sigColW + 8) * 2);
    drawPdfSignature(doc, { x: M + (sigColW + 8) * 2, y, w: sigColW, caption: agreement.method === 'other' ? 'Signed' : 'Signed, before the inspection' });
    y += 9;
    doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(...C.inkMuted);
    doc.text('Signed as the pre-inspection agreement. Its full wording is the appendix to this report.', M, y);
    y += 6;
  } else {
    if (!reportData.clientSignature) {
      doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(...C.warn);
      doc.text('No pre-inspection agreement was recorded for this inspection.', M, y - 14);
    }
    drawPdfSignature(doc, { x: M, y, w: sigColW, caption: 'Client name' });
    drawPdfSignature(doc, { x: M + sigColW + 8, y, w: sigColW, caption: 'Client signature', image: reportData.clientSignature });
    drawPdfSignature(doc, { x: M + (sigColW + 8) * 2, y, w: sigColW, caption: 'Date' });
    y += 14;
  }

  // ── Version history ─────────────────────────────────────────────────────
  // Every earlier completed version, and why each amendment was made (see
  // COMPLETED REPORTS), so a reader can see this isn't the first issue.
  const history = reportData.issueHistory || [];
  if (version > 1 && history.length) {
    if (y + 20 > 270) newPage();
    doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(...C.inkMuted);
    doc.text('VERSION HISTORY', M, y); y += 5;
    doc.setDrawColor(...C.rule); doc.setLineWidth(0.3); doc.line(M, y, M+CW, y); y += 5;
    const rows = [...history.map(h => ({ v: h.version, when: h.completedAt, reason: h.reason, changed: h.changed })),
      ...(version > history[history.length - 1].version
        ? [{ v: version, when: null, reason: reportData.amending && reportData.amending.reason }] : [])];
    rows.forEach(r => {
      const label = r.v === 1 ? 'Original report' : `Amended: ${r.reason || 'no reason given'}`;
      const detail = r.changed && r.changed.length ? `Changed: ${r.changed.join(', ')}` : '';
      const lines = doc.splitTextToSize([label, detail].filter(Boolean).join('. '), CW - 60);
      if (y + lines.length * 4.2 + 3 > 278) newPage();
      doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(...C.ink);
      doc.text(`Version ${r.v}`, M, y);
      doc.setFont('helvetica','normal'); doc.setTextColor(...C.inkLight);
      doc.text(r.when ? formatIssueDate(r.when) : 'This version', M+22, y);
      doc.setTextColor(...C.ink);
      doc.text(lines, M+60, y);
      y += lines.length * 4.2 + 3;
    });
    y += 5;
  }

  // Footer badge
  if (y + 17 > 284) newPage();
  doc.setFillColor(...C.rowAlt); doc.rect(M, y, CW, 16, 'F');
  doc.setFillColor(...C.accent); doc.rect(M, y, 1.5, 16, 'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(...C.inkLight);
  doc.text(`Generated by SAYON  ·  ${today}`, M+7, y+5);
  doc.setFont('helvetica','normal'); doc.setTextColor(...C.inkMuted);
  doc.text(`Report ID: ${reportId}  ·  Prepared with reference to ${standard}`, M+7, y+9);
  doc.text(`Content fingerprint: ${formatFingerprint(fingerprint)}  ·  changes to the report change this code`, M+7, y+13);

  if (agreement) {
    startPart('Appendix: Pre-Inspection Agreement', true);
    sectionTitle('APPENDIX: PRE-INSPECTION AGREEMENT', 'A');
    gap(2);
    y = drawAgreementBody(doc, agreement, y, { M, CW, onNewPage: () => { compactHeader('Appendix: Pre-Inspection Agreement'); return 22; } });
  }

  // ── CONTENTS ── every numbered section, what it holds, and its page.
  {
    doc.setPage(contentsPageNo);
    y = 26;
    doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.setTextColor(...C.ink);
    doc.text('Contents', M, y + 6);
    doc.setFillColor(...C.accent); doc.rect(M, y + 10, 22, 1.2, 'F');
    y += 22;
    const CONTENTS = [
      [REPORT_PARTS.client, 'Client & Inspection Details', 'Who the report is for, the property, and who inspected it.'],
      [REPORT_PARTS.summary, 'Summary', 'The main results under access, activity and safety & risk, with where to read more.'],
      [REPORT_PARTS.property, 'About the Property', 'How the building is built and used, and its termite management system.'],
      [REPORT_PARTS.areas, 'Areas Inspected', 'Each area, how much of it was inspected, and what was found there.'],
      [REPORT_PARTS.access, 'Areas Unable to Be Inspected, and Why', 'Obstructions, restricted access, high risk areas and invasive inspection.'],
      [REPORT_PARTS.findings, 'Findings', 'Termites, borers, wood decay, chemical delignification and previous treatment.'],
      [REPORT_PARTS.conducive, 'Conducive Conditions', 'Conditions that make timber pest attack more likely, and why each matters.'],
      [REPORT_PARTS.recommendations, 'Recommendations & Risk', 'The risk of termite attack, treatment and when to inspect again.'],
      [REPORT_PARTS.photos, 'Photographs', 'Photos taken during the inspection.'],
      [REPORT_PARTS.terms, 'Scope, Limitations, Definitions & Terms', 'What this inspection covers, the terms used, and the terms and conditions.'],
      [REPORT_PARTS.inspector, 'Inspector Details', 'The inspector, their licence and signature.'],
      [REPORT_PARTS.acknowledgement, 'Client Acknowledgement', 'The client\'s acknowledgement of the report and its limits.'],
      ...(agreement ? [['A', 'Appendix: Pre-Inspection Agreement', 'The agreement the client signed before the inspection.']] : []),
    ];
    CONTENTS.forEach(([no, title, desc]) => {
      const pg = partPages[no] ? partPages[no] - 1 : '';
      doc.setFillColor(...C.accent); doc.roundedRect(M, y - 4.6, 7, 7, 1, 1, 'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(...C.white);
      doc.text(String(no), M + 3.5, y + 0.6, { align: 'center' });
      doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(...C.ink);
      doc.text(title, M + 11, y);
      doc.setFont('helvetica','normal'); doc.setFontSize(7.8); doc.setTextColor(...C.inkLight);
      doc.text(desc, M + 11, y + 4.6);
      doc.setFont('helvetica','bold'); doc.setFontSize(9.5); doc.setTextColor(...C.accentDark);
      doc.text(String(pg), W - M, y, { align: 'right' });
      doc.setDrawColor(...C.ruleLight); doc.setLineWidth(0.25); doc.line(M, y + 8.5, W - M, y + 8.5);
      y += 15.5;
    });
  }

  // ── PAGE FOOTERS ──────────────────────────────────────────────────────────
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 2; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFillColor(...C.rule); doc.rect(M, 284, CW, 0.3, 'F');
    doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(...C.inkMuted);
    doc.text(`Report ${reportNumber}  ·  Version ${version}`, M, 290);
    doc.text(`Page ${p-1} of ${totalPages-1}`, W-M, 290, { align:'right' });
  }

  const fname = `SAYON_${fileNamePart(address) || 'Property'}_${fileNamePart(today)}.pdf`;
  const blob = doc.output('blob');
  saveDraft(); // keeps the report number it was given
  return { blob, fname, fingerprint, version };
}

async function _buildAndDownloadPDF() {
  const { blob, fname } = await buildReportPdf();
  // The dashboard counts a report with a PDF made as ready for its quote.
  reportData.pdfAt = Date.now();
  saveOpenReportNow();
  await deliverPdfBlob(blob, fname, {
    title: reportKindTitle(),
    text: `${reportKindTitle()} — ${getFullAddress() || 'Property'}`,
    readyToast: 'Report ready — choose where to save or send it',
  });
}
