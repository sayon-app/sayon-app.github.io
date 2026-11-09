// SAYON app: Field rendering, findings, choice and select cards, borers, compass, moisture readings.
// One of the js/app/ files, which share one global scope: they load as plain
// scripts in the order index.html lists them, so a top-level name declared in
// any of them can be used from the others once the page has loaded.

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
const APPEND_TEXT_KEYS = new Set(['hinderedAreas', 'hinderedAreasDetail', 'noAccessAreas', 'highRiskAreas', 'borerDetails', 'decayDetails', 'decayWhere', 'delignificationDetails', 'delignificationWhere', 'nonDurableTimberDetails', 'nonDurableTimberWhere', 'previousTreatmentDetails', 'previousTreatmentWhere', 'leakLocation', 'timberSoilDetails', 'otherRecommendations', 'invasiveInspectionDetails']);
// Free-text fields where "None", "Nil" or "N/A" means nothing to record.
const NIL_TEXT_KEYS = new Set(['hinderedAreas', 'hinderedAreasDetail', 'noAccessAreas', 'highRiskAreas', 'borerDetails', 'decayDetails', 'decayWhere', 'delignificationDetails', 'delignificationWhere', 'nonDurableTimberDetails', 'nonDurableTimberWhere', 'previousTreatmentDetails', 'previousTreatmentWhere', 'leakLocation', 'timberSoilDetails', 'treatmentType', 'existingSystemOther']);
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
// A place's words, spelled one way: "skirting boards" and "skirting board",
// "sub-floor" and "subfloor", "north-east" and "northeast" match, and a
// room number counts ("bedroom two" is "bedroom 2", and never "bedroom 1").
const PLACE_NUMBERS = { one: 1, first: 1, two: 2, second: 2, three: 3, third: 3, four: 4, fourth: 4, five: 5, fifth: 5, six: 6, sixth: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const placeWords = t => String(t || '').toLowerCase()
  .replace(/\b(sub|under)[\s-]+floor/g, '$1floor').replace(/\b(north|south)[\s-]+(east|west)/g, '$1$2')
  .split(/[^a-z0-9]+/).map(w => {
    const n = PLACE_NUMBERS[w] || (/^\d+(st|nd|rd|th)?$/.test(w) && parseInt(w, 10));
    if (n) return '#' + n;
    if (w.length < 4 || KEY_WORD_SKIP.has(w)) return '';
    return w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
  }).filter(w => w && !PLACE_FILLER.has(w));
const repeatsPlace = (have, val) => { const h = new Set(placeWords(have)), v = placeWords(val); return v.length > 0 && v.every(w => h.has(w)); };
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
// A finding with no place of its own ("the termites there are
// Coptotermes", said in a later note) is more about the one recorded
// finding, when there is just one and its species doesn't differ. With two
// or more there's no telling which, so it stays a card of its own.
function findingFollowedUp(f, recorded) {
  if (f.activityLocation || f.termiteActivity === 'NONE') return null;
  const real = recorded.filter(k => k.termiteActivity === 'ACTIVE' || k.termiteActivity === 'INACTIVE');
  if (real.length !== 1) return null;
  const k = real[0];
  return !f.species || !k.species || f.species === k.species ? k : null;
}
function mergeFindingInto(have, f) {
  let changed = false;
  if (f.termiteActivity && (!have.termiteActivity || (f.termiteActivity === 'ACTIVE' && have.termiteActivity === 'INACTIVE'))) { have.termiteActivity = f.termiteActivity; changed = true; }
  if (f.activityLocation && (!have.activityLocation || (placeWords(f.activityLocation).length > placeWords(have.activityLocation).length && repeatsPlace(f.activityLocation, have.activityLocation)))) { have.activityLocation = f.activityLocation; changed = true; }
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

// What the inspector said, note by note (reportData.heardNotes [{ k, text,
// at }]), so SAYON's treatment plan (js/treatment-plan.js) can read things
// no field holds: an owner who wants no chemicals, a fish pond, the dogs.
// The same note filled again is kept once; the oldest go past about 16,000
// characters. Never printed: ISSUE_META_KEYS leaves it out of the report.
const HEARD_NOTES_MAX_CHARS = 16000;
function keepHeardNote(rd, k, text) {
  text = String(text || '').trim();
  if (!rd || !text) return;
  const notes = (Array.isArray(rd.heardNotes) ? rd.heardNotes : []).filter(n => n && n.k !== k);
  notes.push({ k, text, at: Date.now() });
  let total = notes.reduce((n, x) => n + x.text.length, 0);
  while (notes.length > 1 && total > HEARD_NOTES_MAX_CHARS) total -= notes.shift().text.length;
  rd.heardNotes = notes;
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
// True when a note covers the subfloor and not the outside of the house,
// and never mentions weep holes (as dictated: "weep", "wee poles", "weep
// holds"), so a weepHoles answer from it can only be a misread vent remark.
function weepHolesFromSubfloorNote(values, transcript) {
  const areas = values.areaStatus && typeof values.areaStatus === 'object' ? Object.keys(values.areaStatus) : [];
  if (!areas.includes('subfloor') || areas.includes('exterior')) return false;
  return !/\bwe+p|\bwee ?(?:p|h)oles?\b/i.test(String(transcript || ''));
}

function populateFields(data, transcript) {
  if (!data || typeof data !== 'object') return Promise.resolve();
  // Each field lands a moment after the last. If another job is opened in
  // the meantime, the rest stop rather than land in that job.
  const target = reportData;
  const noteKey = transcript ? noteTextKey(transcript) : null;
  if (noteKey) keepHeardNote(target, noteKey, transcript);
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
      const recorded = [...kept, ...accepted];
      const same = recorded.find(k => sameFindingPlace(k, f)) || findingFollowedUp(f, recorded);
      if (!same) { accepted.push(f); return; }
      if (mergeFindingInto(same, f)) merged = true;
    });
    incoming = accepted;

    if (incoming.length) untrackNoneFromAreas('termites');
    if (incoming.length) {
      const combined = [...kept, ...incoming];
      reportData.findings = combined.slice(0, MAX_FINDINGS);
      if (combined.length > MAX_FINDINGS) {
        showToast(`A report holds ${MAX_FINDINGS} findings, so some new ones weren't added. Add their details to the findings already there`, 'info');
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
  // Weep holes are on the outside walls. A note about the subfloor alone
  // that never says "weep" sometimes reads "vents are clear" as weep holes
  // clear, which would wipe "bridged" from an earlier exterior note.
  if (values.weepHoles && weepHolesFromSubfloorNote(values, transcript)) delete values.weepHoles;
  NIL_TEXT_KEYS.forEach(k => { if (values[k] !== undefined && values[k] !== null && (isNilText(values[k]) || (['hinderedAreas', 'hinderedAreasDetail', 'noAccessAreas'].includes(k) && saysNoAccessLimit(values[k])))) values[k] = k === 'hinderedAreas' ? '' : null; });
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
      untrackAutoAnswers(key);
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

// A detail box only shows once its question calls for one: not while the
// question is blank, and not after a "no", unless something was already
// written there (so nothing is ever hidden with words in it). A third entry
// lists what the app itself writes there, which doesn't count as words: a
// "no" to treatment fills the type with NO_TREATMENT_TYPE
// (applyFieldCascade), which the report prints.
const NO_TREATMENT_TYPE = 'No treatment required at this time';
const DETAIL_FIELD_FOR = {
  treatmentRecommended: ['treatmentType', ['NO', 'N/A'], [NO_TREATMENT_TYPE]],
  hardLandscaping: ['zone25mmVisible', ['NO', 'N/A']],
  softLandscaping: ['zone75mmVisible', ['NO', 'N/A']],
  decayFound: ['decayDetails', ['NO', 'N/A']],
  delignification: ['delignificationDetails', ['NO', 'N/A']],
  previousTreatment: ['previousTreatmentDetails', ['NO', 'N/A']],
  nonDurableTimber: ['nonDurableTimberDetails', ['NO', 'N/A']],
  mouldSeen: ['mouldWhere', ['NO', 'N/A']],
  antCapping: ['antCappingDetails', ['INTACT', 'N/A']],
  timberSoil: ['timberSoilDetails', ['NO', 'N/A']],
};

// More detail boxes that show and hide with the first one.
const MORE_DETAIL_FIELDS = { previousTreatment: ['previousTreatmentWhere'], decayFound: ['decayWhere'], delignification: ['delignificationWhere'], nonDurableTimber: ['nonDurableTimberWhere'] };
// "what (where)" for the summary and other one-line uses. When either
// already has brackets, the where follows a comma instead, so brackets never
// sit inside or beside brackets: "Fungal decay (wet rot), bottom of the door".
const whatWhere = (what, where) => {
  what = String(what || '').trim().replace(/[.;,]+$/, '');
  where = String(where || '').trim().replace(/[.;,]+$/, '');
  if (!what || !where) return what || where;
  return /[()]/.test(what + where) ? `${what}, ${lowerFirst(bracketText(where))}` : `${what}${inBrackets(where)}`;
};

function syncDetailField(key) {
  const [detailKey, noAnswers, filled = []] = DETAIL_FIELD_FOR[key] || [];
  if (!detailKey) return;
  [detailKey, ...(MORE_DETAIL_FIELDS[key] || [])].forEach(k => {
    const field = document.getElementById('f-' + k)?.closest('.field');
    if (!field) return;
    const words = String(reportData[k] || '').trim();
    const hide = (isBlankValue(reportData[key]) || noAnswers.includes(reportData[key])) && (!words || filled.includes(words));
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
  // "Pre-Purchase — Timber Pest" reads as Pre-Purchase over Timber Pest.
  panel.innerHTML = `<div class="choice-grid" style="--cols:${SELECT_CARDS[id].cols}">${opts.map(o => {
    const [main, sub] = o.textContent.split(' — ');
    return `
    <label class="choice-card tone-neutral">
      <input type="radio" class="sr-only" name="cards-${id}" value="${escapeHtml(o.value)}"${sel.value === o.value ? ' checked' : ''}>
      <span class="choice-card-code">${escapeHtml(main)}</span>${sub ? `<span class="choice-card-desc">${escapeHtml(sub)}</span>` : ''}
    </label>`; }).join('')}</div>`;
  if (hadFocus) { const c = panel.querySelector('input:checked'); if (c) c.focus({ preventScroll: true }); }
}

function syncAllSelectCards() { Object.keys(SELECT_CARDS).forEach(syncSelectCards); }

// A finding's head, in the look of an area's card: an icon tile in the
// colour of its activity (red active, amber inactive, green nothing found,
// grey not answered yet), where it is, and under that the activity in its
// colour. The finding's number sits on the tile's corner only once its
// activity is picked and there's more than one finding to tell apart: a
// lone or unanswered card with a "1" on it read as "1 active".
const FINDING_ICON = paths => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const FINDING_ICONS = {
  termite: FINDING_ICON('<path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M9 7.13v-1a3 3 0 1 1 6 0v1"/><path d="M6 13H2M22 13h-4M6.53 9C4.6 8.8 3 7.1 3 5M21 5c0 2.1-1.6 3.8-3.5 4M3 21c0-2.1 1.7-3.9 3.8-4M17.2 17c2.1.1 3.8 1.9 3.8 4"/>'),
  borer: FINDING_ICON('<rect x="3" y="7" width="18" height="10" rx="2"/><circle cx="8" cy="12" r="1"/><circle cx="12" cy="10.5" r="1"/><circle cx="16" cy="13" r="1"/>'),
};
const FINDING_ACT_LABEL = { ACTIVE: 'Active', INACTIVE: 'Inactive', NONE: 'Nothing found' };
const FINDING_REMOVE_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>';
function findingHeadHTML(icon, where, label, num, act, removeCall, removeLabel) {
  const state = act ? act.toLowerCase() : 'unset';
  const status = act ? FINDING_ACT_LABEL[act] || act : 'Not answered yet';
  // The title is where it is, or the label when that isn't known yet. num
  // is null when the corner number isn't shown (see above).
  where = String(where || '').replace(/[\s:;,–—-]+$/, '');
  return `<div class="finding-card-header finding-head-${state}">
        <span class="area-tile finding-tile" aria-hidden="true">${icon}${num ? `<span class="area-tile-badge finding-tile-num">${num}</span>` : ''}</span>
        <span class="finding-card-label"><span class="finding-card-title">${where ? escapeHtml(where) : label}</span>
          <small>${where ? `<span class="sr-only">${label}, </span>` : ''}<span class="finding-act">${status}</span></small></span>
        ${removeCall ? `<button type="button" class="finding-remove-btn" onclick="${removeCall}" title="${removeLabel}" aria-label="${removeLabel}">${FINDING_REMOVE_ICON}</button>` : ''}
      </div>`;
}

// Generates the HTML for one finding card
function findingCardHTML(finding, index, total) {
  const id = finding.id;
  const act = finding.termiteActivity;
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
      ${findingHeadHTML(FINDING_ICONS.termite, finding.activityLocation, label, act && total > 1 ? index + 1 : null, act, total > 1 ? `removeFinding('${id}')` : '', 'Remove this finding')}
      <div class="finding-card-body">
        <div class="area-finding-prompt finding-area-slot" hidden></div>
        <!-- Activity gate: the question every finding must answer -->
        <div class="findings-gate choice-panel${act ? '' : ' unset'}" role="radiogroup" aria-label="Termite activity status">
          <div class="field-label">Termite activity status</div>
          ${choiceCardsHTML('activity', 'activity-' + id, act, `data-finding="${id}" data-fkey="termiteActivity"`)}
          ${!act ? `<p class="findings-gate-hint">Pick one to continue.</p>` : ''}
        </div>
        ${showDetails ? `
        <div class="findings-details" style="display:block">
          <div class="section-fields">
            <div class="field field-wide"><div class="field-label">Location of activity</div>${pickFieldHTML(id, 'activityLocation', PLACES, finding.activityLocation)}</div>
            <div class="field field-wide"><div class="field-label">Timber affected</div>${pickFieldHTML(id, 'timberAffected', TIMBER_PARTS, finding.timberAffected)}</div>
            <div class="field field-wide"><div class="field-label">Damage description <span class="field-hint">Location, extent and what's visible. No severity opinion.</span></div>${pickFieldHTML(id, 'damageDescription', TERMITE_SIGNS, finding.damageDescription)}</div>
            <div class="field field-wide"><div class="field-label">Species / genus</div>${fv('species','specieslist')}</div>
            <div class="field choice-field"><div class="field-label">Termite nest found?</div>${fv('nestLocated','yesno')}</div>
            <div class="field choice-field"><div class="field-label">Builder or engineer referral</div>${fv('structuralConcern','yesno')}</div>
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
  renderBorerFindings();
  syncFindingsGroups();
  renderAreaFindingPrompts();

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
  ta.placeholder = 'Type a value';

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
  if (key === 'termiteActivity' && !isBorerFinding(finding)) untrackNoneFromAreas('termites');
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
  // Not over an area marked "evidence found" that isn't written up yet.
  if (section === 'findings' && termitesUnanswered() && !areasEvidenceUnlinked().length) blanks.unshift('termites');
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
      ? (reportData.findings || []).some(f => f && ['ACTIVE', 'INACTIVE'].includes(f.termiteActivity)) || borersFound() || reportData.decayFound === 'YES' || reportData.delignification === 'YES' || Object.keys(OBS_ZONES).some(z => areaResultOf(z) === 'FOUND')
      : reportData.waterLeaks === 'YES' || Object.entries(CONDUCIVE_CLEAN).some(([k, clean]) => !isBlankValue(reportData[k]) && ![clean, 'N/A'].includes(reportData[k]) && !(k === 'weepHoles' && reportData[k] === 'NONE'));
    const title = btn.querySelector('strong');
    if (title) title.textContent = section === 'findings'
      ? (somethingFound ? 'Nothing else found' : 'No timber pests found')
      : (somethingFound ? 'No other conducive conditions' : 'No conducive conditions');
  });
}

// ── FINDINGS SHOWN WHEN PROMPTED ─────────────────────────────────────────
// Findings shows only what the job calls for, so a clean house is a glance,
// not a scroll. The timber pest groups (Termites, Borers, Timber decay) each
// stay out of sight until something prompts them: an answer recorded there
// (spoken or tapped), an area marked "evidence found" that the inspector
// says was that pest, or the inspector adding it under "Found something?".
// What's out of sight still reads in a box under them (none found, or not
// answered yet), and the report prints only what's stored: "none found"
// once the inspector or the Areas said so, "Not recorded" otherwise.
// Previous treatment always shows: the Areas can't answer it, and the
// report's summary asks it.
// A group that's been shown stays shown while this report is open, so it
// never vanishes under a tap on None.
const FINDINGS_GROUPS = [
  { id: 'termites', el: 'fg-termites', name: 'Termites' },
  { id: 'borers', el: 'fg-borers', name: 'Borers' },
  { id: 'decay', el: 'fg-decay', name: 'Timber decay' },
];
const findingsGroupsShown = new WeakMap(); // reportData → Set of group ids shown
const FINDING_DETAIL_KEYS = ['species', 'damageDescription', 'activityLocation', 'timberAffected', 'nestLocated', 'structuralConcern'];

function findingsGroupCalledFor(id) {
  const has = k => !isBlankValue(reportData[k]);
  if (id === 'termites') return (reportData.findings || []).some(f => f && (
    FINDING_DETAIL_KEYS.some(k => !isBlankValue(f[k]))
    || ['ACTIVE', 'INACTIVE'].includes(f.termiteActivity)
    || (f.termiteActivity !== 'NONE' && ((reportData.photosBySection || {})[findingPhotoSection(f.id)] || []).length > 0)));
  if (id === 'borers') return borersFound();
  if (id === 'decay') return reportData.decayFound === 'YES' || reportData.delignification === 'YES'
    || ['decayDetails', 'decayWhere', 'delignificationDetails', 'delignificationWhere'].some(has);
  return false;
}

function findingsGroupShown(id) {
  let shown = findingsGroupsShown.get(reportData);
  if (!shown) findingsGroupsShown.set(reportData, shown = new Set());
  if (!shown.has(id) && findingsGroupCalledFor(id)) shown.add(id);
  return shown.has(id);
}

function syncFindingsGroups() {
  FINDINGS_GROUPS.forEach(g => {
    const el = document.getElementById(g.el);
    if (el) el.hidden = !findingsGroupShown(g.id);
  });
  renderFindingsMore();
}

// Brings a group into Findings (without moving the screen).
function revealFindingsGroup(id) {
  findingsGroupShown(id);
  findingsGroupsShown.get(reportData).add(id);
  syncFindingsGroups();
  return document.getElementById((FINDINGS_GROUPS.find(g => g.id === id) || {}).el);
}

// "Found something?": the group comes in open, and the screen goes to it.
function showFindingsGroup(id, target) {
  const el = revealFindingsGroup(id);
  if (!el) return;
  el.open = true;
  if (id === 'termites') renderAreaFindingPrompts();
  requestAnimationFrame(() => (target || el).scrollIntoView({ block: target ? 'center' : 'start', behavior: 'smooth' }));
}

// The box under the timber pest groups: what the ones out of sight hold,
// and a button for each to bring it in.
const FINDINGS_TICK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const FINDINGS_DASH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>';
const joinWithOr = list => list.length < 2 ? (list[0] || '') : list.slice(0, -1).join(', ') + ' or ' + list[list.length - 1];

function renderFindingsMore() {
  const box = document.getElementById('findingsMore');
  if (!box) return;
  const hidden = FINDINGS_GROUPS.filter(g => !findingsGroupShown(g.id));
  box.hidden = !hidden.length;
  if (!hidden.length) { box.innerHTML = ''; return; }
  const out = id => hidden.some(g => g.id === id);
  const said = (k, none) => none.includes(reportData[k]);
  // Each timber pest out of sight, and whether it's answered none.
  const pests = [];
  if (out('termites')) { const fs = reportData.findings || []; pests.push(['termites', fs.length > 0 && fs.every(f => f && f.termiteActivity === 'NONE')]); }
  if (out('borers')) pests.push(['borers', said('borerActivity', ['NONE'])]);
  if (out('decay')) pests.push(['rot', said('decayFound', ['NO', 'N/A'])], ['delignification', said('delignification', ['NO', 'N/A'])]);
  const none = pests.filter(p => p[1]).map(p => p[0]), blank = pests.filter(p => !p[1]).map(p => p[0]);
  const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
  let state = '';
  if (blank.length) {
    const btn = document.getElementById('nothingFound-findings');
    const quick = btn && !btn.hidden ? `Tap “${btn.querySelector('strong').textContent}” at the top if there was nothing.` : '';
    state = `<div class="findings-more-state is-blank"><span class="findings-more-icon">${FINDINGS_DASH}</span>
      <span class="findings-more-text"><strong>Not answered yet: ${joinWithAnd(blank)}</strong>
      ${none.length || quick ? `<small>${none.length ? `No ${joinWithOr(none)} found. ` : ''}${quick}</small>` : ''}</span></div>`;
  } else if (none.length) {
    const fromAreas = (reportData.noneFromAreas || []).length > 0;
    state = `<div class="findings-more-state is-none"><span class="findings-more-icon">${FINDINGS_TICK}</span>
      <span class="findings-more-text"><strong>No ${joinWithOr(none)} found</strong>
      <small>${fromAreas ? 'Every area says nothing found, so the report prints these as none found.' : 'The report prints these as none found.'}</small></span></div>`;
  }
  const anyShown = hidden.length < FINDINGS_GROUPS.length;
  box.innerHTML = `${state}<div class="findings-more-add"><span class="findings-more-label">${anyShown ? 'Found something else?' : 'Found something?'} Add it:</span>
    <div class="findings-more-btns">${hidden.map(g => `<button type="button" class="spot-photo-add findings-more-btn" onclick="showFindingsGroup('${g.id}')">${AREA_PLUS_ICON}${cap(g.name)}</button>`).join('')}</div></div>`;
}

// When every area is marked and every area entered says "Nothing found",
// the report already states "no visible evidence of timber pests" for each
// of them, so termites, borers, rot and delignification are answered none
// without a tap in Findings. Only blank answers are filled. The ones filled
// this way are listed in reportData.noneFromAreas and taken back out if an
// area stops saying nothing found; an answer the inspector gives or speaks
// takes the key off the list, so it's never taken back.
const NONE_FROM_AREAS = { borerActivity: 'NONE', decayFound: 'NO', delignification: 'NO' };
// An invasive inspection is answered no the same way, but only while every
// area was also inspected without limits (Section 5 hides it then).
const NONE_FROM_CLEAR_AREAS = { invasiveInspection: 'NO' };
function areasSayNothingFound() {
  const zones = Object.keys(OBS_ZONES), results = reportData.areaResult || {};
  const entered = zones.filter(areaWasEntered);
  return entered.length > 0 && zones.every(z => areaStatusOf(z)) && entered.every(z => results[z] === 'CLEAR');
}
function untrackNoneFromAreas(key) {
  const list = reportData.noneFromAreas;
  if (!Array.isArray(list) || !list.includes(key)) return;
  const left = list.filter(k => k !== key);
  if (left.length) reportData.noneFromAreas = left; else delete reportData.noneFromAreas;
}
function syncNoneFromAreas() {
  if (isReportLocked()) return;
  const filled = new Set(Array.isArray(reportData.noneFromAreas) ? reportData.noneFromAreas : []);
  const show = (key, val) => {
    const el = document.getElementById('f-' + key);
    if (!el) return;
    if (val) renderField(el, key, val);
    else { el.classList.remove('filled'); el.textContent = '—'; }
  };
  let changed = false;
  const clear = areasSayNothingFound();
  const want = !clear ? {} : areasNotFullyInspected().length ? NONE_FROM_AREAS : { ...NONE_FROM_AREAS, ...NONE_FROM_CLEAR_AREAS };
  if (clear) {
    // Cards added and left empty go: the one left says no termites found.
    // A card with a photo on it has been started, so it's left to answer.
    const photoed = getFindings().some(f => ((reportData.photosBySection || {})[findingPhotoSection(f.id)] || []).length);
    if (termitesUnanswered() && !photoed) { reportData.findings = [{ ...getFindings()[0], termiteActivity: 'NONE' }]; filled.add('termites'); changed = true; }
    Object.entries(want).forEach(([key, val]) => {
      if (!isBlankValue(reportData[key])) return;
      reportData[key] = val; filled.add(key); show(key, val); changed = true;
    });
  }
  // What the Areas no longer say is taken back, if it's still as filled.
  const auto = { ...NONE_FROM_AREAS, ...NONE_FROM_CLEAR_AREAS };
  [...filled].forEach(key => {
    if (key === 'termites') {
      if (clear) return;
      const fs = getFindings();
      if (fs.length === 1 && fs[0].termiteActivity === 'NONE' && !FINDING_DETAIL_KEYS.some(k => !isBlankValue(fs[0][k]))) fs[0].termiteActivity = null;
    } else {
      if (key in want) return;
      if (reportData[key] === auto[key]) { delete reportData[key]; show(key, null); }
    }
    filled.delete(key); changed = true;
  });
  if (filled.size) reportData.noneFromAreas = [...filled]; else delete reportData.noneFromAreas;
  if (changed) renderFindingsUI();
}

// ── WHAT FITS THIS HOUSE ─────────────────────────────────────────────────
// The Findings rule for Conducive: a question that doesn't fit the house
// stays out of sight and is answered for the inspector. Slab edge needs a
// slab, weep holes need brick or masonry walls, and subfloor drainage,
// ventilation and ant capping need a subfloor. Once the floor type, the
// walls or the Subfloor area say the house hasn't got one, the question
// goes and is answered N/A, which the report prints. Only blank answers are
// filled; those keys are in reportData.naFromHouse and are taken back out
// when the house changes, unless the inspector or a note has answered them
// since (untrackAutoAnswers). A question holding any other answer stays on
// screen, and while the floor or walls are unknown every question shows.
const HOUSE_FIT = { slabEdge: 'slab', weepHoles: 'masonry', subfloorDrainage: 'subfloor', subfloorVentilation: 'subfloor', antCapping: 'subfloor' };

// true, false, or null when the report doesn't say.
function houseHas() {
  const floor = String(reportData.floorType || '').toLowerCase().trim();
  const walls = String(reportData.wallConstruction || '').toLowerCase().trim();
  let slab = null, subfloor = null, masonry = null;
  if (floor && !/^other\b|mixed|unknown|not sure/.test(floor)) {
    slab = /slab/.test(floor);
    subfloor = /timber|stump|suspended|pier|elevated|bearer|joist/.test(floor);
    if (!slab && !subfloor) slab = subfloor = null;   // a floor it can't place
  }
  if (subfloor === null) {
    const area = areaStatusOf('subfloor');
    if (area) subfloor = area !== 'NA';
  }
  const brick = /brick|masonry|render|block|hebel|stone/.test(walls);
  const clad = /weatherboard|fibro|cement sheet|cladding|timber|vinyl|metal/.test(walls);
  if (walls && brick !== clad) masonry = brick;
  return { slab, subfloor, masonry };
}

function untrackAutoAnswers(key) {
  untrackNoneFromAreas(key);
  const list = reportData.naFromHouse;
  if (!Array.isArray(list) || !list.includes(key)) return;
  const left = list.filter(k => k !== key);
  if (left.length) reportData.naFromHouse = left; else delete reportData.naFromHouse;
}

function showFitField(key, show) {
  const field = document.getElementById('f-' + key)?.closest('.field');
  if (field) field.style.display = show ? '' : 'none';
}

function syncFitFields() {
  const has = houseHas();
  const filled = new Set(Array.isArray(reportData.naFromHouse) ? reportData.naFromHouse : []);
  const locked = isReportLocked();
  Object.entries(HOUSE_FIT).forEach(([key, need]) => {
    const el = document.getElementById('f-' + key);
    const fits = has[need] !== false;
    if (!locked && !fits && isBlankValue(reportData[key])) {
      reportData[key] = 'N/A'; filled.add(key);
      if (el) renderField(el, key, 'N/A');
    } else if (!locked && fits && filled.has(key)) {
      filled.delete(key);
      if (reportData[key] === 'N/A') { delete reportData[key]; if (el) { el.classList.remove('filled'); el.textContent = '—'; } }
    }
    showFitField(key, fits || !['N/A', '', null, undefined].includes(reportData[key]));
  });
  if (!locked) { if (filled.size) reportData.naFromHouse = [...filled]; else delete reportData.naFromHouse; }
}

// An area marked "evidence found", answered "Borers": a borer finding for
// that area, ready under the borer question.
function addBorerForArea(zoneId) {
  const where = OBS_ZONES[zoneId].label.replace(/^The /, '');
  const cards = getBorerFindings();
  let card = cards.find(b => isBlankValue(b.location) && isBlankValue(b.description) && isBlankValue(b.timberAffected));
  if (!card) {
    if (cards.length >= MAX_BORER_FINDINGS) { showToast(`Only ${MAX_BORER_FINDINGS} borer findings fit in a report. Name ${where} in an existing one's location`, 'info'); return; }
    card = { id: genFindingId(), borerActivity: null };
    cards.push(card);
  }
  card.location = where + ': ';
  if (!card.borerActivity && borersFound() && cards.length === 1) card.borerActivity = reportData.borerActivity;
  syncBorerFromCards();
  renderFindingsUI(); updateProgress(); saveDraft();
  const n = getBorerFindings().indexOf(card) + 1;
  showFindingsGroup('borers', borersFound() ? document.getElementById('finding-card-' + card.id) : document.getElementById('choices-borerActivity'));
  showToast(borersFound()
    ? `Borer finding ${n} is for the ${zoneName(zoneId).toLowerCase()}. ${card.borerActivity ? 'Add' : 'Pick Active or Inactive, then add'} what you saw`
    : `Pick Active or Inactive for the borers. A finding for the ${zoneName(zoneId).toLowerCase()} is ready under it`, 'info');
}

// The same for rot or chemical delignification: answered yes, with the area
// as where it was, and the screen on what was seen.
function addDecayForArea(zoneId, kind) {
  const [yesKey, whatKey, whereKey, label] = kind === 'delignification'
    ? ['delignification', 'delignificationDetails', 'delignificationWhere', 'Chemical delignification']
    : ['decayFound', 'decayDetails', 'decayWhere', 'Rot'];
  const area = zoneName(zoneId);
  revealFindingsGroup('decay');
  if (reportData[yesKey] !== 'YES') commitEdit(document.getElementById('f-' + yesKey), yesKey, 'YES');
  const where = reportData[whereKey];
  if (isBlankValue(where)) commitEdit(document.getElementById('f-' + whereKey), whereKey, area);
  else if (!textAreas(where).includes(zoneId)) commitEdit(document.getElementById('f-' + whereKey), whereKey, String(where).replace(/[.;,\s]+$/, '') + ', ' + area.toLowerCase());
  renderFindingsUI();
  showFindingsGroup('decay', document.getElementById('f-' + whatKey));
  showToast(`${label} recorded in the ${area.toLowerCase()}. Add what you saw`, 'info');
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

function borerCardHTML(b, index, all) {
  const id = b.id;
  const act = b.borerActivity;
  const fv = (key, hint) => `<div class="field-val${b[key] ? ' filled' : ''}" onclick="startFindingEdit('${id}','${key}','text')">${b[key] ? escapeHtml(b[key]) : '—'}</div>`;
  return `
    <div class="finding-card borer-card" id="finding-card-${id}">
      ${findingHeadHTML(FINDING_ICONS.borer, b.location, `Borer finding ${index + 1}`, act && all && all.length > 1 ? index + 1 : null, act, `removeBorerFinding('${id}')`, 'Remove this borer finding')}
      <div class="finding-card-body">
        <div class="findings-gate choice-panel${act ? '' : ' unset'}" role="radiogroup" aria-label="Borer activity here">
          <div class="field-label">Borer activity</div>
          ${choiceCardsHTML('borerCard', 'borer-' + id, act, `data-finding="${id}" data-fkey="borerActivity"`)}
        </div>
        <div class="findings-details" style="display:block">
        <div class="section-fields">
          <div class="field field-wide"><div class="field-label">Location</div>${pickFieldHTML(id, 'location', PLACES, b.location)}</div>
          <div class="field field-wide"><div class="field-label">Timber affected</div>${pickFieldHTML(id, 'timberAffected', TIMBER_PARTS, b.timberAffected)}</div>
          <div class="field field-wide"><div class="field-label">Borer type</div>${pickFieldHTML(id, 'borerType', BORER_TYPES, b.borerType)}</div>
          <div class="field field-wide"><div class="field-label">What was seen <span class="field-hint">Exit holes, frass, tunnelling. No severity opinion.</span></div>${pickFieldHTML(id, 'description', BORER_SIGNS, b.description)}</div>
          <div class="field choice-field"><div class="field-label">Builder or engineer referral</div><div class="choice-panel${b.structuralConcern ? '' : ' unset'}" role="radiogroup">${choiceCardsHTML('finding', `structuralConcern-${id}`, b.structuralConcern, `data-finding="${id}" data-fkey="structuralConcern"`)}</div></div>
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
    add.querySelector('span').textContent = cards.length ? 'Add another borer finding' : 'Add where borers were found';
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
    if (el) openFieldGroups(el);
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
  // The name only once there's a system to name, unless one was typed
  // already; the durable notice photo goes once "no system" is answered,
  // unless a photo of one is already there.
  const nameField = document.getElementById('f-existingSystemOther')?.closest('.field');
  if (nameField) nameField.style.display = !hasSystem && isBlankValue(reportData.existingSystemOther) ? 'none' : '';
  const durable = document.getElementById('durablePhotoWidget');
  if (durable) durable.style.display = !hasSystem && !isBlankValue(reportData.existingSystem) && !((reportData.photosBySection || {}).durable || []).length ? 'none' : '';
  if (!hasSystem) return;

  const flag = document.getElementById('systemVerifyFlag');
  const flagText = document.getElementById('systemVerifyFlagText');
  if (!flag) return;

  const concerns = [];
  if (reportData.durableNoticePresent === 'NO') concerns.push('durable notice sticker not found in meter box');
  if (reportData.hardLandscaping === 'YES' && reportData.zone25mmVisible === 'NO') concerns.push('25 mm inspection zone not visible against hard landscaping');
  if (reportData.softLandscaping === 'YES' && reportData.zone75mmVisible === 'NO') concerns.push('75 mm inspection zone not visible against soft landscaping');
  if (reportData.antCapSoldered === 'NO') concerns.push('ant cap / strip shield joins not soldered, so the shielding is inadequate');

  if (concerns.length > 0) {
    flagText.textContent = 'Verification concern' + (concerns.length > 1 ? 's' : '') + ': ' + concerns.join('; ') + '. Rectification and re-verification of the existing system are recommended.';
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
  'bathroom', 'shower', 'skylight', 'flashing', 'downpipe'
];
function isAboveGroundLeak(text) {
  if (!text) return false;
  const norm = text.toLowerCase();
  return ABOVE_GROUND_LEAK_KEYWORDS.some(k => norm.includes(k));
}

// Inspectors always recommend treatment when live termites are found, so a
// live finding fills Treatment Recommended with YES when it's still blank. It
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
    showToast('Live termites found, so Treatment Recommended is set to Yes', 'info');
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
        <button type="button" class="photo-remove-btn" onclick="removeMoistureReading('${r.id}')" aria-label="Remove reading">${FINDING_REMOVE_ICON}</button>
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
