// SAYON app: Areas inspected, hindered and restricted access, access spots and their photos.
// One of the js/app/ files, which share one global scope: they load as plain
// scripts in the order index.html lists them, so a top-level name declared in
// any of them can be used from the others once the page has loaded.

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
  let specific = Object.keys(AREA_EVIDENCE_WORDS).filter(z => !AREA_EVIDENCE_GENERAL.has(z) && hit(z));
  // A sleeper retaining wall is a retaining wall, not landscaping timbers.
  if (specific.includes('retainingwalls') && !['landscaping timber', 'garden edging', 'edging timber'].some(has)) specific = specific.filter(z => z !== 'landscapingtimbers');
  if (specific.length) return specific;
  const general = [...AREA_EVIDENCE_GENERAL].filter(hit);
  // "Skirting board, external wall, laundry" is inside the house, on the
  // external wall: a room or fixture inside wins over "external" or
  // "perimeter" alone. Only a part of the outside itself (fascia, eave,
  // cladding, deck...) or "outside" / "exterior" keeps the exterior too.
  if (general.length === 2) {
    const outsidePart = AREA_EVIDENCE_WORDS.exterior.filter(w => !['external', 'perimeter'].includes(w)).some(has);
    if (!outsidePart) return ['interior'];
  }
  return general;
}
// The evidence recorded in an area, as short references for the report:
// "Finding 2 (rear left fence post)", "Borers (front bedroom floorboards)".
function areaEvidence(zoneId) {
  const out = [];
  const short = t => {
    const s = lowerFirst(bracketText(t));
    return s.length <= 60 ? s : s.slice(0, 57).replace(/\s+\S*$/, '').replace(/[\s,;:–—-]+$/, '')
      .replace(/\s+(the|a|an|and|or|of|to|in|on|at|by|with|where|from|for)$/i, '') + '…';
  };
  (reportData.findings || []).forEach((f, i) => {
    if (!f || f.termiteActivity === 'NONE') return;
    if (textAreas([f.activityLocation, f.damageDescription].join(' ')).includes(zoneId)) out.push(`Finding ${i + 1}${f.activityLocation ? ` (${short(f.activityLocation)})` : ''}`);
  });
  shownBorerFindings().forEach((b, i) => {
    if (textAreas([b.location, b.timberAffected, b.description].join(' ')).includes(zoneId)) out.push(`Borer finding ${i + 1}${b.location ? ` (${short(b.location)})` : ''}`);
  });
  // Decay and delignification are named by where they are, or else by what.
  const other = [
    ['Wood decay', reportData.decayFound === 'YES', reportData.decayDetails, reportData.decayWhere],
    ['Chemical delignification', reportData.delignification === 'YES', reportData.delignificationDetails, reportData.delignificationWhere],
  ];
  other.forEach(([label, found, what, where]) => {
    if (found && textAreas([what, where].join(' ')).includes(zoneId)) out.push(`${label} (${short(where || what)})`);
  });
  return out;
}
// Areas marked "evidence found" with nothing recorded that names them.
function areasEvidenceUnlinked() { return Object.keys(OBS_ZONES).filter(z => areaResultOf(z) === 'FOUND' && !areaEvidence(z).length); }
// The termite finding an area's evidence can go into: the first one that
// doesn't say where it is or what was seen yet, and isn't "nothing found".
function openTermiteFinding() {
  return getFindings().find(x => x.termiteActivity !== 'NONE' && isBlankValue(x.activityLocation) && isBlankValue(x.damageDescription));
}
// Starts the write-up for an area: in the open finding, or a new one when
// there isn't one (or `fresh`, when the open one is kept for another area).
function addFindingForArea(zoneId, fresh) {
  const where = OBS_ZONES[zoneId].label.replace(/^The /, '');
  let f = fresh ? null : openTermiteFinding();
  if (!f) {
    const before = getFindings().length;
    addFinding();
    if (getFindings().length === before) { showToast(`Only ${MAX_FINDINGS} findings fit in a report. Name ${where} in an existing finding's location`, 'info'); return; }
    f = getFindings()[before];
  }
  f.activityLocation = where + ': ';
  renderFindingsUI(); saveDraft();
  showSection('findings');
  const card = document.getElementById('finding-card-' + f.id);
  const group = card && card.closest('details');
  if (group && !group.open) group.open = true;
  if (card) requestAnimationFrame(() => card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  showToast(`Finding ${getFindings().indexOf(f) + 1} is for the ${zoneName(zoneId).toLowerCase()}. ${f.termiteActivity ? 'Add' : 'Pick Active or Inactive, then add'} where exactly and what you saw`, 'info');
}

function areasMissingResult() { return Object.keys(OBS_ZONES).filter(z => areaWasEntered(z) && !areaResultOf(z)); }
function setAreaResult(zoneId, result) {
  if (!reportData.areaResult) reportData.areaResult = {};
  if (reportData.areaResult[zoneId] === result) delete reportData.areaResult[zoneId];
  else reportData.areaResult[zoneId] = result;
  syncObstructionData();
}

// Areas marked "evidence found" that nothing in Findings describes yet.
// The first goes inside the open finding card, if there is one, so it
// isn't offered as another finding beside an empty one. Any others sit at
// the top of Findings, each adding a finding of its own.
const AREA_PLUS_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';
function renderAreaFindingPrompts() {
  const el = document.getElementById('findingsFromAreas');
  if (!el) return;
  document.querySelectorAll('.finding-area-slot').forEach(s => { s.innerHTML = ''; s.hidden = true; });
  let zones = areasEvidenceUnlinked();
  const open = zones.length && openTermiteFinding();
  // Not inside a folded Termites group, where it couldn't be seen.
  let slot = open && document.querySelector(`#finding-card-${open.id} .finding-area-slot`);
  if (slot && slot.closest('details:not([open])')) slot = null;
  const tile = z => `<span class="area-tile" aria-hidden="true">${AREA_ICONS[z] || ''}</span>`;
  const where = z => 'the ' + zoneName(z).toLowerCase();
  if (slot) {
    const z = zones.shift();
    slot.innerHTML = `${tile(z)}<span class="area-finding-text">Evidence found in <strong>${where(z)}</strong>. Write it up here?</span>
      <button type="button" class="spot-photo-add area-finding-add" onclick="addFindingForArea('${z}')">Yes</button>`;
    slot.hidden = false;
  }
  el.innerHTML = zones.map(z => `<div class="area-finding-prompt">${tile(z)}
      <span class="area-finding-text">Evidence found in <strong>${where(z)}</strong>${slot ? ' too. Describe it in another finding.' : '. Describe it here.'}</span>
      <button type="button" class="spot-photo-add area-finding-add" onclick="addFindingForArea('${z}', ${slot ? 'true' : 'false'})">${AREA_PLUS_ICON}Add finding</button></div>`).join('');
  el.hidden = !zones.length;
}
// Unfolding Termites moves the first prompt back into the open finding.
document.addEventListener('toggle', e => { if (e.target && e.target.id === 'fg-termites') renderAreaFindingPrompts(); }, true);
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
  const zones = Object.keys(OBS_ZONES);
  const markAll = document.getElementById('markAllAreasBtn');
  if (markAll) markAll.hidden = zones.every(z => areaStatusOf(z));
  const marked = zones.filter(z => areaStatusOf(z)).length;
  const prog = document.getElementById('areasProgress');
  if (prog) prog.textContent = marked === zones.length ? `All ${zones.length} areas marked` : `${marked} of ${zones.length} areas marked`;
  // One bar per area, in its status colour, like the job page's progress.
  const segs = document.getElementById('areasSegs');
  if (segs) segs.innerHTML = zones.map(z => `<i class="${(areaStatusOf(z) || '').toLowerCase()}"></i>`).join('');
  wrap.innerHTML = Object.entries(OBS_ZONES).map(([zoneId, zone]) => {
    const status = areaStatusOf(zoneId);
    const lit = status === 'PARTIAL' ? 'INSPECTED' : status;
    const statusBtns = AREA_STATUS_BUTTONS.map(([val, label]) =>
      `<button type="button" class="obs-zone-btn area-status-btn${lit === val ? ' active status-' + status.toLowerCase() : ''}" aria-pressed="${lit === val}"
        onclick="setAreaStatus('${zoneId}','${val}')">${AREA_STATUS_ICONS[val]}<span>${label}</span></button>`).join('');
    // The hindered and restricted reasons show as soon as the area is
    // marked, so a limit is one tap away.
    let reasons = '';
    if (['INSPECTED', 'PARTIAL', 'NOT'].includes(status)) {
      const selected = (reportData.areaReasons || {})[zoneId] || [];
      const btn = item => {
        const safe = item.replace(/'/g, '&#39;');
        return `<button type="button" class="obs-item-btn${selected.includes(item) ? ' selected' : ''}" aria-pressed="${selected.includes(item)}"
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
        `<button type="button" class="obs-item-btn area-result-btn${picked === val ? ' selected result-' + val.toLowerCase() : ''}" aria-pressed="${picked === val}"
          onclick="setAreaResult('${zoneId}','${val}')">${label}</button>`).join('') + '</div>';
      if (picked === 'FOUND') {
        const ev = areaEvidence(zoneId);
        // Evidence not yet written up is picked up in Findings, not flagged
        // here, so the area doesn't read as a mistake.
        if (ev.length) result += `<div class="area-evidence">See ${escapeHtml(ev.join('; '))}</div>`;
      }
    }
    // Each area is a card like a job's step: the area's own icon on a tile
    // in its status colour, with a tick, cross or dash on its corner.
    const badge = { INSPECTED: AREA_DOT_TICK, PARTIAL: AREA_DOT_TICK, NOT: AREA_DOT_CROSS, NA: AREA_DOT_DASH }[status] || '';
    const tile = `<span class="area-tile" aria-hidden="true">${AREA_ICONS[zoneId] || ''}${badge ? `<span class="area-tile-badge">${badge}</span>` : ''}</span>`;
    return `<div class="area-node${status ? ' area-node-' + status.toLowerCase() : ''}${areaOpen.has(zoneId) ? ' open' : ''}" data-zone-node="${zoneId}">
      <details class="obs-zone-panel" data-zone="${zoneId}"${areaOpen.has(zoneId) ? ' open' : ''} ontoggle="onAreaToggle('${zoneId}', this.open)">
      <summary class="obs-zone-panel-header area-summary">${tile}${areaSummary(zoneId, zoneName(zoneId))}</summary>
      <div class="area-body"><div class="area-status">${statusBtns}</div>${result}${reasons}</div></details></div>`;
  }).join('');
}
const AREA_DOT_TICK = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const AREA_DOT_DASH = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"><path d="M5 12h14"/></svg>';
const AREA_DOT_CROSS = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const AREA_STATUS_ICONS = {
  INSPECTED: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  NOT: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  NA: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>',
};
// Each area's own icon, on its tile.
const AREA_ICON = paths => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const AREA_ICONS = {
  interior: AREA_ICON('<path d="M20 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v3"/><path d="M2 16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z"/><path d="M4 18v2"/><path d="M20 18v2"/>'),
  exterior: AREA_ICON('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9v12h14V9"/><path d="M10 21v-6h4v6"/>'),
  subfloor: AREA_ICON('<path d="M2 5h20"/><path d="M2 9h20"/><path d="M6 9v10"/><path d="M12 9v10"/><path d="M18 9v10"/><path d="M2 19h20"/>'),
  roofvoid: AREA_ICON('<path d="M2 17 12 6l10 11z"/><path d="M12 6v11"/><path d="M7 17l5-5 5 5"/>'),
  outbuildings: AREA_ICON('<path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z"/><path d="M6 18h12"/><path d="M6 14h12"/><path d="M6 10h12v12H6z"/>'),
  site: AREA_ICON('<path d="M8 19a4 4 0 0 1-2.24-7.32A3.5 3.5 0 0 1 9 6.03V6a3 3 0 1 1 6 0v.04a3.5 3.5 0 0 1 3.24 5.65A4 4 0 0 1 16 19Z"/><path d="M12 19v3"/>'),
  fences: AREA_ICON('<path d="M4 3 2 5v15c0 .6.4 1 1 1h2c.6 0 1-.4 1-1V5Z"/><path d="M6 8h4"/><path d="M6 18h4"/><path d="m12 3-2 2v15c0 .6.4 1 1 1h2c.6 0 1-.4 1-1V5Z"/><path d="M14 8h4"/><path d="M14 18h4"/><path d="m20 3-2 2v15c0 .6.4 1 1 1h2c.6 0 1-.4 1-1V5Z"/>'),
  retainingwalls: AREA_ICON('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 9v6"/><path d="M16 15v6"/><path d="M16 3v6"/><path d="M3 15h18"/><path d="M3 9h18"/><path d="M8 15v6"/><path d="M8 3v6"/>'),
  landscapingtimbers: AREA_ICON('<rect x="2" y="15" width="20" height="5" rx="2.5"/><rect x="4" y="9" width="16" height="5" rx="2.5"/><rect x="6" y="3" width="12" height="5" rx="2.5"/>'),
};

// Each area is a row that opens when tapped, showing what's recorded so the
// list reads at a glance. Which rows are open survives the re-render that
// every tap does.
const areaOpen = new Set();
function onAreaToggle(zoneId, open) {
  if (open) areaOpen.add(zoneId); else areaOpen.delete(zoneId);
  const node = document.querySelector(`[data-zone-node="${zoneId}"]`);
  if (node) node.classList.toggle('open', open);
}

// An area's name as the app shows it, in sentence case: "Interior", "Roof
// void". OBS_ZONES labels stay as they are: saved reports are read by them.
function zoneName(z) {
  const l = OBS_ZONES[z].label.replace(/^The /, '');
  return l.charAt(0) + l.slice(1).toLowerCase();
}

// Areas named in a sentence, from their labels: "The interior, subfloor
// and roof void".
function zoneList(labels) {
  return joinWithAnd(labels.map((l, i) => i ? l.replace(/^The /, '').toLowerCase() : l.charAt(0) + l.slice(1).toLowerCase()));
}

function areaSummary(zoneId, name) {
  const status = areaStatusOf(zoneId);
  const chev = '<svg class="area-sum-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
  if (!status) return `<span class="area-sum-text"><span class="area-sum-name">${name}</span><span class="area-sum-state">Tap to mark</span></span>${chev}`;
  const label = (AREA_STATUSES.find(([v]) => v === status) || [])[1] || status;
  const why = (reportData.areaReasons || {})[zoneId] || [];
  const found = areaWasEntered(zoneId) && areaResultOf(zoneId) === 'FOUND';
  const extra = why.length ? why[0] + (why.length > 1 ? ` +${why.length - 1}` : '') : (found ? 'Evidence found' : '');
  // What's recorded reads under the name, as a job's step does: its status
  // in colour, then why or what was found.
  return `<span class="area-sum-text"><span class="area-sum-name">${name}</span>`
    + `<span class="area-sum-line"><span class="area-sum-state area-sum-${status.toLowerCase()}">${label}</span>`
    + (extra ? `<span class="area-sum-why${found && !why.length ? ' area-sum-found' : ''}">${escapeHtml(extra)}</span>` : '')
    + `</span></span>${chev}`;
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
      showToast('Areas updated from your note. Check they match what you said', 'info');
    } else {
      // Nothing in our fixed area list matched — surface it rather than
      // silently losing it, so the technician marks the area manually.
      showToast(`Mark the area for this obstruction yourself: "${combinedText.slice(0, 120)}"`, 'info');
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
  return v.startsWith('NIL') || v.includes('N/A') || saysNoAccessLimit(v);
}
// Words that say nothing was in the way or restricted ("NIL — No restricted
// access areas", "No restrictions", "None"), from an older report's No
// button or a voice note. They answer No: never print them as a place.
function saysNoAccessLimit(v) {
  return /^\s*(nil\b|n\/a\b|none\b(?!\s+of)|no (restricted|restrictions?|hindered|obstructions?|obstructed|limits?|access (issues|restrictions?|problems?))\b|nothing (was )?(restricted|obstructed|hindered|in the way))/i.test(String(v || ''));
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
  if (!text || (kind === 'hindered' && hinderedTextIsNil()) || saysNoAccessLimit(text)) return out;
  text.split(/(?<=[.;])\s+|\n+/).map(t => t.trim()).filter(Boolean).forEach(seg => {
    const low = seg.toLowerCase();
    const z = zones.find(z => (ZONE_SPOT_ALIASES[z] || []).some(a => low.startsWith(a) && !/[a-z]/.test(low.charAt(a.length))));
    if (!z) { out._other.push(seg); return; }
    const alias = ZONE_SPOT_ALIASES[z].find(a => low.startsWith(a));
    const rest = seg.slice(alias.length).replace(/^[\s:,–—-]+/, '').replace(/[.;]$/, '').trim().replace(/^\(([^()]*)\)$/, '$1');
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

const ACCESS_CHEV = '<svg class="area-sum-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
const ACCESS_PIN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>';
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
    const st = areaStatusOf(z) === 'NOT' ? 'not' : 'partial';
    const status = st === 'not' ? 'Not inspected' : 'Inspected with limits';
    const kind = restricted ? 'restricted' : 'hindered';
    // The area's head is the same as its card in Areas (its icon on a tile
    // in its status colour) and opens it there.
    const tile = `<span class="area-tile" aria-hidden="true">${AREA_ICONS[z] || ''}<span class="area-tile-badge">${st === 'not' ? AREA_DOT_CROSS : AREA_DOT_TICK}</span></span>`;
    return `<div class="access-item access-item-${st}">
      <button type="button" class="access-item-head" onclick="openAreaRow('${z}')" aria-label="${zoneName(z)}, ${status}. Change in Areas">${tile}
        <span class="access-item-main"><span class="access-item-name">${zoneName(z)}</span><span class="access-item-state">${status}</span>${why}</span>${ACCESS_CHEV}</button>
      ${spotLine(kind, z)}${spotPhotos(kind, z)}</div>`;
  }).filter(Boolean);
  const spotLine = (kind, key) => {
    const spot = accessSpot(kind, key, accessZones(kind));
    return `<button type="button" class="access-spot${spot ? '' : ' empty'}" data-kind="${kind}" data-key="${key}" onclick="editAccessSpot('${kind}','${key}')">${ACCESS_PIN}<span>${spot ? escapeHtml(spot) : 'Add exact spot'}</span></button>`;
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
  if (intro) intro.innerHTML = allMarked || limited.length ? 'Filled in from your ticks in Areas. Tap an area to change it there, or add where exactly.'
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
  const detail = isBlankValue(reportData.hinderedAreasDetail) || reportData.hinderedAreas === 'NO' || saysNoAccessLimit(reportData.hinderedAreasDetail) ? '' : reportData.hinderedAreasDetail;
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
  const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
  if (hOther) hindered.push([areaRows ? 'Other spots' : 'Where', cap(hOther)]);
  // The inspector's own words about what was in the way always print, so a
  // dictated reason isn't lost behind the per-area rows.
  if (detail && !hinderedTextIsNil()) hindered.push(['What obstructed it', detail]);
  if (rOther) restricted.push([restricted.length ? 'Other spots' : 'Where and why', cap(rOther)]);
  const limited = areasNotFullyInspected();
  const highRisk = !isBlankValue(reportData.highRiskAreas) ? reportData.highRiskAreas
    : joinPlaces([!isBlankValue(reportData.noAccessAreas) && !saysNoAccessLimit(reportData.noAccessAreas) ? reportData.noAccessAreas : '', zoneList(limited.map(z => OBS_ZONES[z].label))]);
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

// A strip of photos, each with its own details box, Describe (the AI's
// suggested caption, PHOTO DESCRIPTION in extraction.js) and an add button.
const PHOTO_ADD_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z"/><circle cx="12" cy="13" r="4"/></svg>';
function spotPhotosHTML(section) {
  const photos = (reportData.photosBySection || {})[section] || [];
  const cards = photos.map(p => `<div class="spot-photo">
      <img data-photo-id="${p.id}" alt="Photo">
      <input class="photo-caption-input spot-photo-caption" type="text" placeholder="Add details…" value="${escapeHtml(p.caption || '')}"
        data-caption-for="${p.id}" oninput="updateSectionPhotoCaption('${p.id}','${section}',this.value)">
      <div class="photo-actions">
        ${describeButtonHTML(p)}
        <button type="button" class="photo-remove-btn" onclick="removeSpotPhoto('${p.id}','${section}')">Remove</button>
      </div>
      ${photoSuggestionHTML(p)}
    </div>`).join('');
  return `<div class="spot-photos" data-section="${section}">${cards}
    <button type="button" class="spot-photo-add" onclick="addSpotPhoto('${section}')">${PHOTO_ADD_ICON}Add photo</button></div>`;
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
      const where = (key === '_other' ? 'Other spot' : zoneName(key)) + (kind === 'restricted' ? ', restricted' : ', obstruction');
      photos.forEach(p => out.push({ ...p, caption: [where, (p.caption || '').trim()].filter(Boolean).join(': ') }));
    });
  });
  return out;
}

function restoreResState() { renderAccessSummary(); }
