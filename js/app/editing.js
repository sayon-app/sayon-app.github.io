// SAYON app: Editing, report steps, progress, signature pads, Say it instead.
// One of the js/app/ files, which share one global scope: they load as plain
// scripts in the order index.html lists them, so a top-level name declared in
// any of them can be used from the others once the page has loaded.

// ── EDITING ───────────────────────────────────────────────────────────────
// There's no Edit Mode: any field opens for editing when tapped, unless the
// job is finalised and locked.

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
  if (isReportLocked()) { sayLocked(); return; }
  if (el.classList.contains('editing')) return;
  commitActive();
  activeEditEl = el;
  el.classList.add('editing');

  const cur = reportData[key] || '';
  const OPTIONS = {
    era:         ['Pre-1920s','1920s-1940s','1945-1965','1965-1985','1985-2003','Post-2003'],
    // Only the standards a timber pest report can be done to. AS 3660.1 (new
    // building work), AS 3660.3 (product test criteria) and AS 4349.0/.1
    // (building inspections) are not; an older report that saved one keeps
    // showing it, because the list puts the current value first.
    standard:    ['AS 4349.3-2010','AS 3660.2-2017'],
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
    input.placeholder = 'Type a value';
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
      reportData.treatmentType = NO_TREATMENT_TYPE;
      if (typeEl) { typeEl.textContent = NO_TREATMENT_TYPE; typeEl.classList.add('filled'); }
    } else if (value === 'YES') {
      if (reportData.treatmentType === NO_TREATMENT_TYPE) {
        reportData.treatmentType = '';
        if (typeEl) { typeEl.textContent = '—'; typeEl.classList.remove('filled'); }
      }
    }
  }

  // Questions that fit the house, and "where" boxes that follow an answer.
  syncFitFields();
}

function commitEdit(el, key, value) {
  untrackAutoAnswers(key);
  if (key === 'borerActivity' && ['ACTIVE', 'INACTIVE'].includes(value)) {
    // Borers found: the first card is ready, and a lone card waiting on its
    // activity (one started for an area) takes this answer.
    const cards = getBorerFindings();
    if (!cards.length) cards.push({ id: genFindingId(), borerActivity: value });
    else if (cards.length === 1 && !cards[0].borerActivity) cards[0].borerActivity = value;
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
  // On Finish the list of what's missing is right there, so the bar that
  // walks it goes (SHOW ME).
  renderBlankWalk();
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
  constructionEra: v => 'built ' + v.replace(/(\ds?)-(\d)/g, '$1\u2060–\u2060$2'),
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
    // The count is of termites found, so a card not answered yet doesn't
    // read as "1 finding".
    return {
      done: list.length > 0 && acts.length === list.length, started: acts.length > 0,
      count: live + old ? `${live + old} finding${live + old === 1 ? '' : 's'}` : '',
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

// Opens any folded group around el, so a jump to a question can show it,
// and brings in a Findings or Section 5 group that's out of sight.
function openFieldGroups(el) {
  for (let n = el && el.parentElement; n; n = n.parentElement) {
    if (n.matches && n.matches('details.fgroup[hidden]')) {
      const g = FINDINGS_GROUPS.find(x => x.el === n.id);
      if (g) revealFindingsGroup(g.id);
      const a = ACCESS_GROUPS.find(x => x.el === n.id);
      if (a) revealAccessGroup(a.id);
    }
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
  renderConditionPhotos();
  // FIX: this duplicated calculateCompletion()'s old plain-presence check
  // independently, so the same bug (a routine render lazily creating a
  // placeholder finding via getFindings(), silently marking the Findings
  // tab "Complete" with a green dot and enabling its Next button even with
  // zero real finding data) showed up here too - now sharing one
  // definition (isFieldFilled) so this can't drift out of sync again.
  let filled = 0, total = 0;
  const secState = {};
  Object.entries(SECTIONS).forEach(([sec, cfg]) => {
    const all = REQUIRED_FIELDS[sec] || [];
    filled += all.filter(k => isFieldFilled(k)).length; total += all.length;
    // A section's badge counts what the section itself asks. The agreement
    // is a step of the job, signed before the report is touched: it is on
    // the percentage and the list of what's missing, not on Sign-off's badge.
    const own = k => k !== 'agreement';
    const req = all.filter(own);
    const reqFilled = req.filter(k => isFieldFilled(k)).length;
    // Areas is under way from the first area marked, not only once all are.
    const any = cfg.fields.some(k => own(k) && isFieldFilled(k)) || (sec === 'obstructions' && Object.keys(OBS_ZONES).some(z => areaStatusOf(z)));

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
    // A report marked done (or a completed job) ticks every step: the
    // inspector has said it's finished, so nothing reads as half done.
    dot.className = isReportDone() || counted.every(v => v === 'done') ? 'tab-dot done' : states.some(v => v !== 'empty') ? 'tab-dot partial' : 'tab-dot';
  });
  renderFieldGroups();

  // A completed (locked) job reads Complete whatever the count says. The
  // percentage is read off the one list of what's missing (reportProgress
  // in js/app/dashboard.js), so it and Finish can't disagree.
  const locked = isReportLocked();
  const done = isReportDone();
  const progress = typeof reportProgress === 'function' ? reportProgress()
    : { gaps: [], open: total - filled, blank: total - filled, checks: 0, total, pct: Math.round((filled / total) * 100) };
  const pct = locked || done ? 100 : progress.pct;
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
    ringText.textContent = locked || done ? '✓' : pct + '%';
    const wrap = ringFill.closest('.progress-ring-wrap');
    if (wrap) {
      wrap.classList.toggle('locked', locked || done);
      wrap.title = locked ? 'Job finalised' : done ? 'Report done' : `Report ${pct}% complete`;
      wrap.setAttribute('aria-label', wrap.title);
    }
    const label = document.getElementById('progressRingLabel');
    if (label) { label.style.display = locked || done ? '' : 'none'; label.textContent = locked ? 'Finalised' : 'Done'; }
  }
  renderFinishNext(progress);
  renderBlankWalk(progress);
  renderReportJobCard();
  syncDockReport();
  syncDockJobs();
  syncNothingFoundButtons();
  syncFindingsGroups();
  syncAccessGroups();
  syncRecLines();
}

// ── REPORT DONE ───────────────────────────────────────────────────────────
// The inspector says the report is finished: reportData.doneAt. Every step
// then reads done, the header and the dock show a tick, a line at the top of
// the report says so with the next step, and the job moves on to the quote
// or sending. It's a mark, not a lock: the report can still be changed, and
// "Keep working on it" takes the mark off. Sent or completed counts as done.
function isReportDone() {
  return !!(reportData.doneAt || reportData.sent || reportData.issue);
}

function setReportDone(on) {
  if (isReportLocked()) return;
  if (on) reportData.doneAt = Date.now(); else delete reportData.doneAt;
  if (document.getElementById('jobAddress').value.trim()) saveCurrentReport(true); else saveDraft();
  updateProgress();
  renderLastVisitBanner();
  if (on) {
    showToast('Report done', 'success');
    track('report_marked_done', {});
    const next = document.getElementById('finishNext');
    if (next) next.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

// What comes after the report: the quote while the report recommends a
// treatment and there's none yet, else sending. 'sent' once it has gone
// and hasn't changed since (gone: the client has it as it stands).
function reportNextStep() {
  const q = currentJobQuote(), hasQuote = quoteHasItems(q);
  const wantsQuote = reportData.treatmentRecommended === 'YES' && !reportData.noQuoteNeeded;
  const sent = reportData.sent;
  const gone = !!sent && (isReportLocked() || reportMatches(sent.fingerprint));
  return { q, hasQuote, wantsQuote, sent, gone, next: wantsQuote && !hasQuote ? 'quote' : gone ? 'sent' : 'send' };
}

// When it was ticked off or sent: "today", "yesterday", else the date.
function doneWhen(ts) {
  const w = dashWhen(ts);
  return w === 'Today' || w === 'Yesterday' ? w.toLowerCase() : formatIssueDate(ts);
}

// The Finish step's end: what the report is still missing, each with its
// way there, then Report done until it's ticked, then one big button for
// the next step and the rest quiet. progress: reportProgress().
function renderFinishNext(progress) {
  const doneBtn = document.getElementById('reportDoneBtn');
  if (!doneBtn || typeof quoteHasItems !== 'function') return;
  const done = isReportDone(), locked = isReportLocked();
  const { q, hasQuote, wantsQuote, sent, gone, next } = reportNextStep();
  doneBtn.hidden = done;
  // The same list the check before sending shows. Once the report has
  // gone (or the job is locked) it's the record, and the list goes quiet.
  const gapsBox = document.getElementById('finishGaps');
  const gaps = locked || gone ? [] : progress.gaps;
  gapsBox.hidden = !gaps.length;
  gapsBox.innerHTML = gaps.length ? reportGapsHtml(gaps) : '';
  const { blank, checks } = progress;
  document.getElementById('reportDoneSub').textContent = blank || checks
    ? `${[blank ? `${blank} still blank` : '', checks ? `${checks} to check` : ''].filter(Boolean).join(' and ')}. You can tick it off anyway.`
    : 'Ticks it off on the job. You can still change it.';
  document.getElementById('finishDone').hidden = !done;
  document.getElementById('finishDoneWhen').textContent = locked ? 'Job finalised and locked'
    : sent && !gone ? `Changed since it was sent ${doneWhen(sent.at)}`
    : sent ? `Sent ${doneWhen(sent.at)}` : reportData.doneAt ? `Ticked off ${doneWhen(reportData.doneAt)}` : '';
  // Only a plain mark comes off; a sent or completed report stays done.
  document.getElementById('finishDoneUndo').hidden = !reportData.doneAt || !!sent || !!reportData.issue;
  // Once the report has gone (and nothing's waiting on a quote), there's
  // nothing more to do here: one button back to the job, where the next
  // step is, and sending again as a quiet link.
  const away = done && next === 'sent';
  document.getElementById('finishNextLabel').hidden = !done || away;
  const quoteBtn = document.getElementById('finishQuoteBtn');
  const shareBtn = document.getElementById('shareBtn');
  quoteBtn.hidden = !done || away || !(hasQuote || wantsQuote);
  shareBtn.hidden = !done || away;
  document.getElementById('finishJobBtn').hidden = !away;
  document.getElementById('finishResend').hidden = !away;
  document.getElementById('finishQuoteTitle').textContent = hasQuote ? 'Open the quote' : 'Write the quote';
  document.getElementById('finishQuoteSub').textContent = hasQuote ? (q.sentAt ? 'Sent ' + formatIssueDate(q.sentAt) : 'Check it before it goes') : 'Starts from what the report found';
  document.getElementById('shareTitle').textContent = sent && !gone ? 'Send it again' : 'Send to client';
  document.getElementById('shareSub').textContent = sent && !gone ? 'So the client has it as it is now'
    : hasQuote ? 'Check the report, then email it with the quote' : 'Check the report, then email it';
  // One big button.
  quoteBtn.classList.toggle('primary', done && next === 'quote');
  shareBtn.classList.toggle('primary', done && next === 'send');
  if (next === 'quote') quoteBtn.after(shareBtn); else shareBtn.after(quoteBtn);

  // The line at the top of every step, for a report done but not sent yet.
  const banner = document.getElementById('reportDoneBanner');
  if (banner) {
    banner.hidden = !reportData.doneAt || !!sent || locked;
    if (!banner.hidden) {
      document.getElementById('reportDoneBannerText').textContent = `Report done ${doneWhen(reportData.doneAt)}. Next, ${next === 'quote' ? 'the quote' : 'send it to the client'}.`;
      const btn = document.getElementById('reportDoneBannerBtn');
      btn.textContent = next === 'quote' ? 'Write the quote' : 'Send to client';
      btn.onclick = next === 'quote' ? () => tabGo('quote') : () => openSendReview();
    }
  }
}

// ── SHOW ME ──
// "Show me" on the list of what's missing goes to the answer in the report.
// A small bar then stays above the dock with how many are left and Next,
// which goes on to the next one down the report, so the list is walked
// without going back to Finish each time. The bar goes on its cross, on
// the Finish step (the list is there), and with the report: it sits
// inside the report's panel.
let blankWalk = null; // { last: the place shown last } while it's being walked
// Every place the list points at, in its order ("id" or "id:referral").
const blankTargets = gaps => gaps.flatMap(g => g.targets || []);
const blankTargetEl = t => document.getElementById(String(t).replace(/:referral$/, ''));
// The places further down the report than the one shown last.
function blankTargetsAhead(gaps) {
  const targets = blankTargets(gaps);
  const last = blankWalk && blankTargetEl(blankWalk.last);
  if (!last) return targets;
  return targets.filter(t => { const el = blankTargetEl(t); return el && (last.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) && !last.contains(el); });
}

function showBlank(target) {
  if (navPlace() !== 'report') tabGo('report');
  blankWalk = { last: target };
  goToReportField(target.replace(/:referral$/, ''), target.endsWith(':referral'));
  renderBlankWalk();
}

// On to the next one down the report; past the last, back to Finish,
// where the list shows whatever is still on it.
function blankWalkNext() {
  const next = blankWalk && blankTargetsAhead(reportPrepGaps('finish'))[0];
  if (next) { showBlank(next); return; }
  stopBlankWalk();
  goStep('finish');
  document.getElementById('finishNext').scrollIntoView({ block: 'start' });
}

function stopBlankWalk() {
  blankWalk = null;
  renderBlankWalk();
}

function renderBlankWalk(progress) {
  const bar = document.getElementById('blankWalk');
  if (!bar) return;
  if (blankWalk && (currentStep === 'finish' || isReportLocked())) blankWalk = null;
  bar.hidden = !blankWalk;
  if (!blankWalk) return;
  const { blank, checks, gaps } = progress || reportProgress();
  document.getElementById('blankWalkText').textContent = blank || checks
    ? [blank ? `${blank} still blank` : '', checks ? `${checks} to check` : ''].filter(Boolean).join(', ')
    : 'Nothing left on the list';
  document.getElementById('blankWalkNext').textContent = blankTargetsAhead(gaps).length ? 'Next' : 'Back to Finish';
}

// The Property step's Job details card: the address and client, then the
// inspection type, day and time. A tap goes back to edit them.
function renderReportJobCard() {
  const sub = document.getElementById('reportJobSub');
  if (!sub) return;
  const v = id => ((document.getElementById(id) || {}).value || '').trim();
  const when = v('jobInspectionDate') ? new Date(v('jobInspectionDate') + 'T00:00:00') : null;
  const line1 = [getFullAddress(), v('jobClient')].filter(Boolean).join(' · ');
  const line2 = [v('jobInspectionType').split(' — ')[0],
    when && !isNaN(when) ? when.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : '',
    v('jobInspectionTime') ? formatClockTime(v('jobInspectionTime')) : ''].filter(Boolean).join(' · ');
  sub.textContent = [line1, line2].filter(Boolean).join('\n') || 'Add the address, client and booking';
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
    agreementSignaturePad = createSignaturePad(agreementCanvas, document.getElementById('agreementSigPlaceholder'), () => { updateAgreementSignButton(); unsavedSheetChanged(); });
  }
}

// "Sign again": the pad empties to be signed afresh.
function clearInspectorSignature() {
  if (inspectorSignaturePad) inspectorSignaturePad.clear();
  delete reportData.inspectorSignature;
  keepInspectorSignature(false);
  setInspectorSignatureStatus(false);
  updateProgress();
  saveDraft();
}

// A signature already on the report (saved with it, or carried over from
// the inspector's last report) can't be drawn on: a thumb scrolling past
// would mark it. Sign again empties the pad to draw a new one.
function keepInspectorSignature(kept) {
  const wrap = document.getElementById('sigCanvasInspector');
  if (wrap) wrap.parentElement.classList.toggle('kept', kept);
}

function setInspectorSignatureStatus(signed) {
  const status = document.getElementById('sigStatusInspector');
  if (status) {
    const name = (document.getElementById('jobInspector').value || '').trim();
    status.textContent = signed ? (name ? `Signed as ${name}` : 'Signed') : 'Not signed';
    status.classList.toggle('signed', signed);
  }
  const again = document.getElementById('sigAgainInspector');
  if (again) again.hidden = !signed;
}

// The inspector's name changed. A signature carried over from the last
// report was signed as the name it came with, so it doesn't stay under
// another one; a signature drawn on this report does.
function onInspectorName() {
  const last = lastInspectorDetails(currentReportId);
  const name = document.getElementById('jobInspector').value.trim();
  if (reportData.inspectorSignature && reportData.inspectorSignature === last.signature && name !== last.name) clearInspectorSignature();
  else setInspectorSignatureStatus(!!reportData.inspectorSignature);
  saveDraft();
  updateProgress();
}

function restoreLicenceField() {
  const el = document.getElementById('inspectorLicence');
  if (el) el.value = reportData.inspectorLicence || '';
}

// Redraws the saved inspector signature after a draft or saved report is
// loaded, and brings the agreement banner up to date.
function restoreSignaturePads() {
  if (inspectorSignaturePad) inspectorSignaturePad.show(reportData.inspectorSignature);
  keepInspectorSignature(!!reportData.inspectorSignature);
  setInspectorSignatureStatus(!!reportData.inspectorSignature);
  renderAgreementBanner();
}

// ── SAY IT INSTEAD ──────────────────────────────────────────────────────
// The agreement and the treatment record can be spoken as well as typed:
// a "Say it instead" button at the top of each sheet records one note,
// Whisper hears it phrase by phrase (or the phone's own speech when Whisper
// can't be reached), "Stop Sayon" or a tap ends it, and a short AI call
// fills the sheet's boxes from it. Every box
// stays editable, and a box the note doesn't mention is left as it was.
// SHEET_VOICE[kind] = { box, prompt(), apply(fields) }; the prompts live
// with their sheets (agreement below, treatment in js/treatment.js, bait
// station visits in js/bait.js).
const SHEET_VOICE_MAX_MS = 180000;
let sheetVoice = null;   // { kind, text, timer } and either { sink, queue } (Whisper) or { recognition, finals }

function sheetVoiceKinds() {
  return {
    agreement: { box: 'agreementVoice', prompt: agreementVoicePrompt, apply: applyAgreementVoice },
    treatment: { box: 'trVoice', prompt: typeof treatmentVoicePrompt === 'function' ? treatmentVoicePrompt : null, apply: typeof applyTreatmentVoice === 'function' ? applyTreatmentVoice : null },
    bait: { box: 'bvVoice', prompt: typeof baitVoicePrompt === 'function' ? baitVoicePrompt : null, apply: typeof applyBaitVoice === 'function' ? applyBaitVoice : null },
    quote: { box: 'quoteVoice', idle: 'Say the quote', prompt: typeof quoteVoicePrompt === 'function' ? quoteVoicePrompt : null, apply: typeof applyQuoteVoice === 'function' ? applyQuoteVoice : null, done: typeof quoteVoiceDone === 'function' ? quoteVoiceDone : null },
  };
}

function setSheetVoiceState(kind, state, text) {
  const k = sheetVoiceKinds()[kind];
  const box = document.getElementById(k.box);
  if (!box) return;
  box.dataset.state = state;
  const idle = k.idle || 'Say it instead';
  const label = box.querySelector('.sheet-voice-label');
  if (label) label.textContent = { idle, listening: 'Listening… say "stop Sayon" or tap', hearing: 'Hearing it…', filling: 'Filling it in…' }[state] || idle;
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
  if (canUseWhisperListening()) startSheetRecorder(kind);
  else startSheetRecognition(kind);
}

// Online, the Say box listens the way the report does: each phrase goes to
// Whisper at a pause and its words show under the button as they come, so
// "Stop Sayon" can end it hands-free, the same as on the report.
function startSheetRecorder(kind) {
  const v = sheetVoice = { kind, queue: [], text: '' };
  setSheetVoiceState(kind, 'listening', '');
  v.sink = {
    queue: v.queue,
    live: () => sheetVoice === v && !v.stopping,
    context: () => v.text,
    pending: () => { if (sheetVoice === v && !v.stopping) setSheetVoiceState(kind, 'listening', v.text + (v.queue.length ? '…' : '')); },
    apply: () => sheetPhrasesIn(v),
    // Whisper gave up on a phrase: like the report, the phone's own speech
    // is used from the next listen on.
    failed: status => { whisperOff = true; showToast(status === 429 ? 'This month\'s AI fills are used up. The last few words were missed' : 'The last few words were missed. Say them again, or type them', 'info'); },
  };
  // Started inside the tap, before any await, so an iPhone lets it record.
  startWhisperListening(v.sink).catch(() => false).then(ok => {
    if (ok) { if (sheetVoice === v && !v.stopping) v.timer = setTimeout(stopSheetVoice, SHEET_VOICE_MAX_MS); return; }
    if (sheetVoice !== v) return;
    sheetVoice = null;
    setSheetVoiceState(kind, 'idle');
    showToast('Microphone not allowed. Check the microphone permission', 'error');
  });
}

// Whisper's phrases, in the order spoken. "Stop Sayon" ends the listening;
// once every phrase is back the words fill the sheet.
function sheetPhrasesIn(v) {
  if (v.cancelled) return;
  while (v.queue.length && v.queue[0].done) {
    let text = correctKnownMishearings((v.queue.shift().text || '').trim());
    if (!text || WHISPER_NOISE_RE.test(text) || v.heardStop) continue;
    const stopAt = text.search(VOICE_STOP_LIVE_RE);
    if (stopAt >= 0) text = text.slice(0, stopAt).trim();
    if (text) v.text = (v.text + ' ' + text).trim();
    if (stopAt >= 0) { v.heardStop = true; playTone(440, 200, 0.2); stopSheetVoice(); }
  }
  if (!v.stopping) { v.sink.pending(); return; }
  if (v.queue.length || !v.released || v.finished) return;
  v.finished = true;
  if (sheetVoice === v) sheetVoice = null;
  sheetVoiceFill(v.kind, v.text);
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
    // "Stop Sayon" ends it, as on the report.
    const stopAt = sheetVoice.text.search(VOICE_STOP_LIVE_RE);
    if (stopAt >= 0) sheetVoice.text = sheetVoice.text.slice(0, stopAt).trim();
    setSheetVoiceState(kind, 'listening', sheetVoice.text);
    if (stopAt >= 0 && !sheetVoice.stopping) { playTone(440, 200, 0.2); stopSheetVoice(); }
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
  if (!v || v.stopping) return;
  clearTimeout(v.timer);
  if (v.sink) {
    // The last phrase is still sent; it fills once every phrase is back.
    v.stopping = true;
    setSheetVoiceState(v.kind, 'hearing', v.text);
    stopWhisperListening().then(() => { v.released = true; sheetPhrasesIn(v); });
    return;
  }
  if (v.recognition) { v.stopping = true; try { v.recognition.stop(); } catch (e) { sheetVoice = null; sheetVoiceFill(v.kind, v.text); } }
}

// Closing a sheet stops its listening and throws the words away.
function cancelSheetVoice(kind) {
  const v = sheetVoice;
  if (!v || v.kind !== kind) { setSheetVoiceState(kind, 'idle', ''); return; }
  sheetVoice = null;
  clearTimeout(v.timer);
  if (v.sink) { v.cancelled = true; if (!v.stopping) stopWhisperListening(); }
  try { if (v.recognition) { v.recognition.onend = null; v.recognition.abort(); } } catch (e) {}
  setSheetVoiceState(kind, 'idle', '');
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
    showToast(k.done ? k.done(n) : n ? `Filled in ${n} box${n === 1 ? '' : 'es'}. Check them before you save` : 'Nothing in that note fits these boxes', n ? 'success' : 'info');
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
