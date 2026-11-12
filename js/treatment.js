// ── TREATMENT RECORD AND CERTIFICATE ────────────────────────────────────────
// After the treatment, the technician records what was done on the accepted
// quote: q.treatment = { date, start, finish, technician, licence,
// supervisor, supervisorLicence, pest, weather, equipment, methods:
// { key: qty }, products: [{ name, active, batch, labelPhoto (JPEG data URL
// of the drum label), rate, amount, life, where }],
// areas, notTreated, site: { building, floor, surrounds, existing }, plan
// (the drawn site plan, see js/site-plan.js), sketch (JPEG data URL of a
// hand-drawn plan, used when there's no drawn one), notice:
// 'new'|'updated'|'none', noticeWhere, cautions, nextInspection, warranty,
// notes, signature, at, photos: [{ id, width, height, caption, kind:
// 'work'|'notice'|'slab', path? }] (PHOTOS ON THE RECORD below), build
// (a new construction job's building and slab, NEW CONSTRUCTION below) }.
// It's kept with the quote, so it syncs with the report, and gives the
// client a treatment certificate PDF. A new construction job has no quote,
// so its record is kept on one made for it (newBuildRecordQuote).
//
// The certificate carries what AS 3660.2 asks for (including a site plan),
// the wording of the durable notice (AS 3660.1, NCC 2022 Housing Provisions 3.4.3: system, date,
// chemical life per label, future inspections), and the state treatment
// records: NSW Pesticides Regulation cl 36,
// QLD pest control advice, VIC licence record keeping and WA treatment
// records (pest, start and finish time, product, active constituent, batch,
// rate, quantity, where, equipment, weather, re-entry precautions,
// technician and licence, the supervisor when a trainee did the work (NSW,
// VIC), signature).

// What was done. qty labels the number asked for, if any. quoteKeys are
// the quote lines that mean the method was quoted.
const TREATMENT_METHODS = {
  barrier: { label: 'Chemical soil treatment (termite barrier)', short: 'Chemical barrier', qty: 'linear metres', quoteKeys: ['barrier_lm', 'barrier_job'] },
  bait:    { label: 'Termite baiting system installed', short: 'Baiting system', qty: 'stations', quoteKeys: ['bait_install'] },
  retic:   { label: 'Reticulation system installed and charged', short: 'Reticulation', qty: 'linear metres', quoteKeys: ['retic_lm'] },
  physical: { label: 'Physical termite barrier installed', short: 'Physical barrier', qty: 'linear metres', quoteKeys: ['physical_lm'] },
  direct:  { label: 'Direct treatment of active termite workings', short: 'Direct treatment', quoteKeys: ['direct'] },
  nest:    { label: 'Termite nest located and treated', short: 'Nest treated', quoteKeys: ['nest'] },
  topup:   { label: 'Top-up of existing termite management system', short: 'System top-up', quoteKeys: ['system_topup'] },
  general: { label: 'Termite management treatment', short: 'Termite treatment', quoteKeys: ['treatment'] },
  borer:   { label: 'Borer treatment of affected timbers', short: 'Borer treatment', quoteKeys: ['borer'] },
};

// Common Australian termiticides and baits with their active constituent,
// for the product picker. The technician still enters the label rate.
const TREATMENT_PRODUCTS = {
  'Termidor': 'fipronil',
  'Termidor Foam': 'fipronil',
  'Termidor HE': 'fipronil',
  'Premise': 'imidacloprid',
  'Altriset': 'chlorantraniliprole',
  'Biflex': 'bifenthrin',
  'Biflex Ultra': 'bifenthrin',
  'Maxxthor 100': 'bifenthrin',
  'Exterra': 'chlorfluazuron',
  'Exterra Focus': '',
  'Requiem': 'chlorfluazuron',
  'Sentricon': 'hexaflumuron',
  'Sentricon AG': 'hexaflumuron',
  'Trelona': 'novaluron',
  'Kordon': 'physical barrier with deltamethrin',
};

// The termite baits among them (and their actives), which have no chemical
// life on the durable notice and are what a bait station visit tops up.
const BAIT_PRODUCT_RE = /exterra|requiem|sentricon|trelona|chlorfluazuron|noviflumuron|novaluron|bistrifluron|hexaflumuron/i;

const TREATMENT_NOTICE = {
  new: 'New durable notice placed',
  updated: 'Existing durable notice updated',
  none: 'No durable notice placed',
};

function treatmentCertNumber(q, prefix = 'TC') {
  return prefix + '-' + String(q.number || '').replace(/^Q-?/i, '');
}

// A chemical barrier, baiting system, reticulation system or physical
// barrier is a termite management system left in place, so the certificate
// gives it a row of its own, System installed, with where it went, and care
// lines on how to look after it.
const INSTALLED_SYSTEMS = ['barrier', 'bait', 'retic', 'physical'];
function installedSystems(t) {
  return INSTALLED_SYSTEMS.filter(k => t && t.methods && k in t.methods);
}

// Where the installed system went, for the certificate's System installed: the
// treated areas without the spots that were only treated directly (the
// active workings the report found), which aren't part of the system.
function installedSystemAreas(t, rd) {
  if (!['direct', 'nest'].some(k => t.methods && k in t.methods)) return t.areas || '';
  // The spots: where the report found live termites, and where the products
  // that aren't part of the system went ("laundry skirting").
  const systems = installedSystems(t);
  const sysProduct = p => BAIT_PRODUCT_RE.test(`${p.name || ''} ${p.active || ''}`) ? systems.includes('bait') : systems.some(k => k === 'barrier' || k === 'retic');
  const spots = [
    ...((rd && rd.findings) || []).filter(f => f && f.termiteActivity === 'ACTIVE').map(f => f.activityLocation),
    ...(t.products || []).filter(p => p && !sysProduct(p)).map(p => p.where),
  ].filter(Boolean).map(s => ' ' + s.toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ');
  const SMALL = /^(the|a|an|on|in|of|at|near|by|and|to|into|with)$/;
  // A part is a spot when every word of it is in one of the spots.
  const isSpot = part => {
    const words = part.toLowerCase().split(/[^a-z0-9]+/).filter(w => w && !SMALL.test(w));
    return words.length && spots.some(s => words.every(w => s.includes(' ' + w + ' ')));
  };
  const left = String(t.areas || '').split(';').map(seg => seg.split(',').map(x => x.trim()).filter(x => x && !isSpot(x)).join(', '))
    .filter(Boolean).join('; ');
  return left.charAt(0).toUpperCase() + left.slice(1);
}

// The quote's report, for pre-filling a first record.
function treatmentSourceReport() {
  return quoteReport() || {};
}

// Months between inspections, from the report's recommendation
// ("three months after treatment, then every 12 months"), else 12.
function inspectionFrequencyMonths(rd) {
  const words = { one: 1, two: 2, three: 3, four: 4, six: 6, twelve: 12 };
  const m = String(rd.inspectionFrequency || '').match(/(\d+|one|two|three|four|six|twelve)\s*months?/i);
  if (!m) return 12;
  return words[m[1].toLowerCase()] || parseInt(m[1], 10) || 12;
}

// Months between later inspections, for the durable notice: the report's
// "then every N months", or a plain "N months". Never more than 12.
function ongoingInspectionMonths(rd) {
  const words = { one: 1, two: 2, three: 3, four: 4, six: 6, twelve: 12 };
  const text = String(rd.inspectionFrequency || '');
  const every = [...text.matchAll(/every\s+(\d+|one|two|three|four|six|twelve)\s*months?/gi)].pop();
  const plain = text.match(/^\s*(\d+|one|two|three|four|six|twelve)\s*months?\s*$/i);
  const m = every || plain;
  const n = m ? (words[m[1].toLowerCase()] || parseInt(m[1], 10)) : 12;
  return n > 0 && n < 12 ? n : 12;
}

// The report a quote was made from, for the certificate.
function treatmentReportFor(q) {
  if (q.reportKey === (currentReportId || 'draft')) return reportData || {};
  const r = getSavedReports().find(e => e.id === q.reportKey);
  return (r && r.reportData) || {};
}

// Where the certificate and visit reports go: the quote's email, or the
// job's when the quote went out without one.
function quoteClientEmail(q) {
  return ((q.clientEmail || '').trim() || (treatmentReportFor(q).jobClientEmail || '').trim());
}

// Same day N months on, or the month's last day when it's shorter
// (31 August + 6 months is 28 or 29 February, not 2 or 3 March).
function addMonthsIso(iso, months) {
  const d = new Date(iso + 'T00:00:00');
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return isoDate(d);
}

// A first record, filled in from the quote and report. The date starts as
// today; the technician is whoever is signed in, else the report's inspector.
function draftTreatment(q) {
  const rd = treatmentSourceReport();
  const build = isNewBuildJob(treatmentReportFor(q)) ? draftNewBuild() : null;
  const company = getCompanyDetails();
  const me = typeof lastInspectorDetails === 'function' ? lastInspectorDetails() : { name: '', licence: '' };
  const signedIn = (typeof authUser !== 'undefined' && authUser && authUser.user_metadata && authUser.user_metadata.name) || '';
  const date = todayIsoDate();
  const methods = {};
  Object.entries(TREATMENT_METHODS).forEach(([key, m]) => {
    const line = q.items.find(it => m.quoteKeys.includes(it.key));
    if (!line) return;
    methods[key] = m.qty && (line.unit === 'lm' || line.unit === 'station') ? String(parseFloat(line.qty) || '') : '';
  });
  // The product the report recommended, when it names a known one.
  const text = `${rd.treatmentType || ''} ${q.items.map(it => it.detail || '').join(' ')}`;
  const name = Object.keys(TREATMENT_PRODUCTS).sort((a, c) => c.length - a.length)
    .find(p => new RegExp(`\\b${p}\\b`, 'i').test(text));
  const places = (rd.findings || []).filter(f => f && f.termiteActivity === 'ACTIVE' && f.activityLocation)
    .map(f => f.activityLocation);
  if (['barrier', 'retic', 'physical'].some(k => methods[k] !== undefined)) places.push('Perimeter of the building');
  return {
    date,
    technician: signedIn || q.inspector || me.name || '',
    licence: rd.inspectorLicence || me.licence || company.licence || '',
    supervisor: '',
    supervisorLicence: '',
    start: '',
    finish: '',
    pest: treatmentPestFromReport(rd, methods),
    weather: '',
    equipment: '',
    methods,
    products: [{ name: name || '', active: name ? TREATMENT_PRODUCTS[name] : '', batch: '', rate: '', amount: '', life: '', where: '' }],
    areas: joinPlaces(places),
    notTreated: '',
    site: treatmentSiteFromReport(rd),
    plan: null,
    notice: 'new',
    noticeWhere: 'Meter box',
    cautions: TREATMENT_DEFAULT_CAUTIONS,
    nextInspection: addMonthsIso(date, build ? +build.inspectEvery : inspectionFrequencyMonths(rd)),
    warranty: treatmentWarrantyFromQuote(q),
    notes: '',
    ...(build ? { build } : {}),
  };
}

// The free service period the quote's plan offered, as the record's terms.
function treatmentWarrantyFromQuote(q) {
  const service = ((q.plan && q.plan.service) || '').trim();
  if (!service || /^none$/i.test(service)) return '';
  return `${service} free service period, while the recommended timber pest inspections are carried out.`;
}

// What the site is like, from the report: building, floor, surrounds and
// any termite management system already there.
function treatmentSiteFromReport(rd) {
  const join = (...v) => v.map(x => String(x || '').trim()).filter(x => x && !/^(n\/a|unknown|not specified)$/i.test(x)).join(', ');
  const sys = String(rd.existingSystem || '').trim();
  const existing = !sys ? '' : /^no system found$/i.test(sys) ? 'None found' : join(sys, rd.existingSystemOther);
  return {
    building: join(rd.structureType, rd.wallConstruction, rd.roofType && !/roof/i.test(rd.roofType) ? `${rd.roofType} roof` : rd.roofType),
    floor: join(rd.floorType),
    surrounds: join(rd.siteSurroundings, rd.siteSlope),
    existing,
  };
}

const TREATMENT_DEFAULT_CAUTIONS = 'Keep people and pets away from treated areas until the treatment has dried. ' +
  'Do not disturb treated soil, and do not wash treated surfaces.';

// "Subterranean termites (Coptotermes acinaciformis)", plus borers when
// they were treated too.
function treatmentPestFromReport(rd, methods) {
  const species = [...new Set((rd.findings || []).filter(f => f && f.termiteActivity === 'ACTIVE' && f.species)
    .map(f => f.species.trim()).filter(s => !/not identified|further investigation/i.test(s)))];
  const pests = [];
  if (Object.keys(methods).some(k => k !== 'borer') || !('borer' in methods)) {
    pests.push('Subterranean termites' + (species.length ? ` (${species.join(', ')})` : ''));
  }
  if (methods.borer !== undefined) pests.push('Borers');
  return pests.join('; ');
}

// ── ON THIS JOB ── The treatment is a step of the job (js/app/job.js): its
// record sheet opens from there, and once it's recorded the step opens to
// the record and its certificate. On a finalised job they're the record,
// and changing them starts with Amend.
function treatmentRecordLine(q) {
  const t = q.treatment;
  return `<p class="job-fold-text good"><strong>Treatment recorded</strong>: done on ${escapeHtml(formatAnswerDate(t.date))}${t.technician ? ` by ${escapeHtml(t.technician)}` : ''}</p>
    ${t.nextInspection ? `<div class="quote-answer-note">Next inspection due ${escapeHtml(formatAnswerDate(t.nextInspection))}</div>` : ''}
    ${isReportLocked() ? '' : '<div class="qp-links"><button type="button" class="quote-text-btn" onclick="openTreatmentRecord()">Edit the record</button></div>'}`;
}

// The certificate: where it goes or when it went, what it would go
// without, and the ways to give it to the client.
function treatmentCertificateCard(q) {
  const t = q.treatment;
  if (!t) return '';
  const who = (q.client || '').trim();
  const first = who.split(/\s+/)[0];
  const to = quoteClientEmail(q);
  const given = certificateGiven(q);
  // One line: where it goes, or when it went.
  const status = q.certificateSentAt ? `Emailed ${formatIssueDate(q.certificateSentAt)}${who ? ` to ${who}` : ''}`
    : q.certificateHandedAt ? `Given${who ? ` to ${who}` : ''} in person ${formatIssueDate(q.certificateHandedAt)}`
    : to ? `Goes to ${to}` : 'Not sent yet';
  // What the certificate would go without, said before it's emailed.
  const missing = treatmentRecordGaps(t).filter(Boolean).map(g => g.missing);
  // Its photos are read in now, ready for the tap that emails it.
  loadTreatmentPhotos(q);
  return `<div class="qp-cert ${given ? 'sent' : ''}">
      <div class="qp-cert-title">Treatment certificate</div>
      <p class="qp-cert-text">${escapeHtml(status)}</p>
      ${missing.length ? `<div class="qp-cert-gaps"><span>The certificate doesn't say ${escapeHtml(joinWithAnd(missing))} yet.</span>${isReportLocked() ? '' : `<button type="button" class="quote-link-btn" onclick="openTreatmentRecord()">Add ${missing.length === 1 ? 'it' : 'them'}</button>`}</div>` : ''}
      ${treatmentReportFor(q).propertyState === 'QLD' ? '<div class="quote-answer-note">In Queensland, email alone isn\'t enough: also hand the client a printed copy, or leave one in their letterbox.</div>' : ''}
      <div class="qp-cert-actions">
        <button type="button" class="${given ? 'quote-link-btn' : 'quote-btn primary'} qp-cert-email" onclick="emailTreatmentCertificate()">${q.certificateSentAt ? 'Email again' : q.certificateHandedAt ? 'Email a copy' : `Email${first ? ' to ' + escapeHtml(first) : ''}`}</button>
        <button type="button" class="quote-link-btn" onclick="downloadTreatmentCertificate()">PDF</button>
      </div>
      ${given ? '' : `<button type="button" class="qp-cert-handed" onclick="markCertificateHanded()">Handed it over in person? <span>Mark as given</span></button>`}
    </div>`;
}

// ── NEW CONSTRUCTION ── A new construction job (isNewBuildJob in
// js/app/job.js) is a termite management system put in while the building
// goes up, so its record carries what AS 3660.1 asks for as well, kept as
// t.build = { buildingClass, structure, systemIs, slab: 'yes'|'no'|'',
// slabTypes, inclusions, collars, softCollars, wraps, jointLm, jointLitres,
// discontinuities, slabNotes, suspended: 'yes'|'no'|'', suspendedNotes,
// physicalHow, limits, inspectEvery (months, as the system's maker
// directs), care: ['chemical', 'disturbed'] }. The sheet shows its parts
// (the building and slab fold, how a physical system went in, the limits,
// the care lines) and its certificate says AS 3660.1.
const NEW_BUILD_METHODS = ['physical', 'barrier', 'retic', 'bait'];
const NEW_BUILD_CLASSES = ['Class 1', 'Class 1 and 10', 'Class 2', 'Class 3', 'Class 4', 'Class 5 to 9', 'Class 10'];
const NEW_BUILD_SYSTEM_IS = {
  complete: 'A complete termite management system',
  integrated: 'Part of an integrated system, with the slab or another system',
  partial: 'A partial system, for part of the building only',
};
const NEW_BUILD_SLAB_TYPES = ['Raft', 'Waffle pod', 'Monolithic', 'Infill', 'Suspended', 'Driveway', 'Pathway'];
const NEW_BUILD_INCLUSIONS = ['Water pipes', 'In-slab heating', 'Hydronic heating', 'Underground tank'];
const NEW_BUILD_PHYSICAL_HOW = ['Perimeter', 'Slab penetrations', 'Construction joints', 'Slab cure', 'Block wall', 'Piers', 'Pole plate', 'Slab repair cut-out', 'Trim'];
const NEW_BUILD_PLACES = ['Perimeter of the building', 'Slab penetrations', 'Construction joints', 'Slab or path against the building', 'Driveway', 'Patios', 'Tilt panel joints', 'Block walls', 'Piers and stumps', 'Subfloor'];
const NEW_BUILD_CARE = {
  chemical: 'This system needs its chemical put back regularly to keep working. Keep up the timber pest inspections for the warranty.',
  disturbed: 'If the system, the building or the garden against it is changed or disturbed, the system needs inspecting and may need putting back.',
};

function draftNewBuild() {
  return { buildingClass: '', structure: '', systemIs: 'complete', slab: '', slabTypes: [], inclusions: [], collars: '', softCollars: '', wraps: '',
    jointLm: '', jointLitres: '', discontinuities: '', slabNotes: '', suspended: '', suspendedNotes: '', physicalHow: [], limits: '',
    inspectEvery: '12', care: ['disturbed'] };
}

// The record sheet is open on a new construction job's record.
function treatmentIsNewBuild() {
  return document.getElementById('treatmentOverlay').classList.contains('new-build');
}

// A new construction job has no quote, so the first time its treatment is
// recorded one is made for it, with no lines, to keep the record on: the
// record, its certificate and any bait visits then work as they do on any
// job (THE JOB'S QUOTE in js/quote.js). It's stored when the record is
// saved. The job is saved first, so the record has a job to go with.
function newBuildRecordQuote() {
  if (!getFullAddress()) { askForJobAddress(); return null; }
  if (!currentReportId && !saveCurrentReport(true)) return null;
  const client = ((document.getElementById('jobClient') || {}).value || '').trim();
  const seen = { client, clientPhone: (reportData.jobClientPhone || '').trim(), clientEmail: (reportData.jobClientEmail || '').trim() };
  quoteState = { reportKey: currentReportId, number: newQuoteNumber(), createdAt: Date.now(), updatedAt: Date.now(), ...seen, clientSeen: { ...seen },
    address: getFullAddress(), sourceAddress: getFullAddress(), inspector: inspectorDisplayName(), items: [], newBuild: true };
  return quoteState;
}

// Chips for a choice: radio (one, a yes or no) or several (multi).
function newBuildChips(id, options, picked, multi) {
  document.getElementById(id).innerHTML = options.map(o => {
    const on = picked.includes(o);
    return `<button type="button" role="${multi ? 'checkbox' : 'radio'}" aria-checked="${on}" class="qp-chip${on ? ' on' : ''}" data-value="${escapeHtml(o)}" onclick="tapNewBuildChip(this, ${!!multi})">${escapeHtml(o)}</button>`;
  }).join('');
}
function tapNewBuildChip(btn, multi) {
  const on = multi ? !btn.classList.contains('on') : true;
  if (!multi) btn.parentElement.querySelectorAll('.qp-chip').forEach(b => { b.classList.remove('on'); b.setAttribute('aria-checked', 'false'); });
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-checked', String(on));
  showNewBuildParts();
  renderTreatmentFolds();
  unsavedSheetChanged();
}
function newBuildChipValues(id) {
  return [...document.querySelectorAll(`#${id} .qp-chip.on`)].map(b => b.dataset.value);
}
const newBuildYes = id => ({ Yes: 'yes', No: 'no' })[newBuildChipValues(id)[0]] || '';

// Which of the new construction parts show: none on another job; how a
// physical system went in once one is ticked; the slab's details after a
// yes to the slab, and the suspended floor's after a yes to that.
function showNewBuildParts() {
  const nb = treatmentIsNewBuild();
  const physical = !!document.querySelector('#trMethods input[data-key="physical"]:checked');
  document.getElementById('trFold5').hidden = !nb;
  document.getElementById('trSiteMore').hidden = nb;
  ['trLimitsWrap', 'trCareWrap', 'trAreaChips'].forEach(id => { document.getElementById(id).hidden = !nb; });
  document.getElementById('trPhysicalWrap').hidden = !(nb && physical);
  document.getElementById('trBuildSlabWrap').hidden = !(nb && newBuildYes('trBuildSlab') === 'yes');
  document.getElementById('trBuildSuspendedWrap').hidden = !(nb && newBuildYes('trBuildSuspended') === 'yes');
}
// The slab's certification photos are kept while the system is part of a slab.
function slabPhotosKept() {
  return treatmentIsNewBuild() && newBuildYes('trBuildSlab') === 'yes';
}

function fillNewBuildForm(b) {
  b = b || draftNewBuild();
  const set = (id, v) => { document.getElementById(id).value = v == null ? '' : v; };
  document.getElementById('trBuildClass').innerHTML = '<option value="">Select…</option>'
    + [...new Set([...NEW_BUILD_CLASSES, b.buildingClass].filter(Boolean))].map(c => `<option>${escapeHtml(c)}</option>`).join('');
  document.getElementById('trBuildSystemIs').innerHTML = Object.entries(NEW_BUILD_SYSTEM_IS).map(([k, label]) => `<option value="${k}">${escapeHtml(label)}</option>`).join('');
  set('trBuildClass', b.buildingClass);
  set('trBuildStructure', b.structure);
  set('trBuildSystemIs', NEW_BUILD_SYSTEM_IS[b.systemIs] ? b.systemIs : 'complete');
  const yn = v => v === 'yes' ? ['Yes'] : v === 'no' ? ['No'] : [];
  newBuildChips('trBuildSlab', ['Yes', 'No'], yn(b.slab), false);
  newBuildChips('trBuildSlabTypes', [...new Set([...NEW_BUILD_SLAB_TYPES, ...(b.slabTypes || [])])], b.slabTypes || [], true);
  newBuildChips('trBuildInclusions', [...new Set([...NEW_BUILD_INCLUSIONS, ...(b.inclusions || [])])], b.inclusions || [], true);
  newBuildChips('trBuildSuspended', ['Yes', 'No'], yn(b.suspended), false);
  newBuildChips('trPhysicalHow', [...new Set([...NEW_BUILD_PHYSICAL_HOW, ...(b.physicalHow || [])])], b.physicalHow || [], true);
  [['trBuildCollars', b.collars], ['trBuildSoftCollars', b.softCollars], ['trBuildWraps', b.wraps], ['trBuildJointLm', b.jointLm],
    ['trBuildJointLitres', b.jointLitres], ['trBuildDiscontinuities', b.discontinuities], ['trBuildSlabNotes', b.slabNotes],
    ['trBuildSuspendedNotes', b.suspendedNotes], ['trLimits', b.limits]].forEach(([id, v]) => set(id, v));
  set('trInspectEvery', ['3', '6', '12'].includes(String(b.inspectEvery)) ? String(b.inspectEvery) : '12');
  document.getElementById('trInspectEvery').dataset.was = document.getElementById('trInspectEvery').value;
  document.getElementById('trInspectEvery').onchange = onNewBuildInspectEvery;
  document.getElementById('trCareChemical').checked = (b.care || []).includes('chemical');
  document.getElementById('trCareDisturbed').checked = (b.care || []).includes('disturbed');
  ['trBuildCollars', 'trBuildSoftCollars', 'trBuildWraps'].forEach(id => { document.getElementById(id).oninput = renderNewBuildPenTotal; });
  document.getElementById('trAreas').oninput = renderTreatmentAreaChips;
  renderNewBuildPenTotal();
  renderTreatmentAreaChips();
  showNewBuildParts();
}

function readNewBuildForm() {
  if (!treatmentIsNewBuild()) return null;
  const v = id => document.getElementById(id).value.trim();
  const slab = newBuildYes('trBuildSlab'), suspended = newBuildYes('trBuildSuspended');
  const inSlab = id => slab === 'yes' ? v(id) : '';
  const physical = !!document.querySelector('#trMethods input[data-key="physical"]:checked');
  // What sits under a "no" isn't kept.
  return {
    buildingClass: v('trBuildClass'), structure: v('trBuildStructure'), systemIs: v('trBuildSystemIs') || 'complete',
    slab,
    slabTypes: slab === 'yes' ? newBuildChipValues('trBuildSlabTypes') : [],
    inclusions: slab === 'yes' ? newBuildChipValues('trBuildInclusions') : [],
    collars: inSlab('trBuildCollars'), softCollars: inSlab('trBuildSoftCollars'), wraps: inSlab('trBuildWraps'),
    jointLm: inSlab('trBuildJointLm'), jointLitres: inSlab('trBuildJointLitres'),
    discontinuities: inSlab('trBuildDiscontinuities'), slabNotes: inSlab('trBuildSlabNotes'),
    suspended, suspendedNotes: suspended === 'yes' ? v('trBuildSuspendedNotes') : '',
    physicalHow: physical ? newBuildChipValues('trPhysicalHow') : [],
    limits: v('trLimits'),
    inspectEvery: v('trInspectEvery') || '12',
    care: [document.getElementById('trCareChemical').checked && 'chemical', document.getElementById('trCareDisturbed').checked && 'disturbed'].filter(Boolean),
  };
}

// "18 in all", beside the penetrations, as the counts are typed.
function newBuildPenetrations(b) {
  return ['collars', 'softCollars', 'wraps'].reduce((n, k) => n + (parseInt(b[k], 10) || 0), 0);
}
function renderNewBuildPenTotal() {
  const n = newBuildPenetrations({ collars: document.getElementById('trBuildCollars').value, softCollars: document.getElementById('trBuildSoftCollars').value, wraps: document.getElementById('trBuildWraps').value });
  document.getElementById('trBuildPenTotal').textContent = n ? `· ${n} in all` : '';
}

// The next inspection follows a change to how often the maker asks for
// one, unless it was typed in by hand.
function onNewBuildInspectEvery() {
  const sel = document.getElementById('trInspectEvery'), next = document.getElementById('trNext');
  const date = document.getElementById('trDate').value || todayIsoDate();
  if (!next.value || next.value === addMonthsIso(date, +sel.dataset.was || 12)) next.value = addMonthsIso(date, +sel.value);
  sel.dataset.was = sel.value;
  renderTreatmentFolds();
}

// The usual places a new build's system goes, as chips under Treated: a tap
// adds the place to the box, or takes it out again.
function renderTreatmentAreaChips() {
  const box = document.getElementById('trAreaChips');
  if (!box || !treatmentIsNewBuild()) return;
  const parts = document.getElementById('trAreas').value.split(/\s*[;,]\s*/).map(p => p.trim().toLowerCase());
  box.innerHTML = NEW_BUILD_PLACES.map(place => {
    const on = parts.includes(place.toLowerCase());
    return `<button type="button" role="checkbox" aria-checked="${on}" class="qp-chip${on ? ' on' : ''}" onclick="tapTreatmentArea(${escapeHtml(JSON.stringify(place))})">${escapeHtml(place)}</button>`;
  }).join('');
}
function tapTreatmentArea(place) {
  const el = document.getElementById('trAreas');
  const parts = el.value.split(/\s*;\s*/).map(p => p.trim()).filter(Boolean);
  const kept = parts.filter(p => p.toLowerCase() !== place.toLowerCase());
  el.value = joinPlaces(kept.length < parts.length ? kept : [...parts, place]);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

// What "Say it instead" also asks for on a new construction job.
function newBuildVoicePrompt() {
  const list = a => a.map(x => `"${x}"`).join(', ');
  return `
- This is a new construction job: a termite management system put in while the building goes up. Also return "build": {"buildingClass":string,"structure":string,"slab":"yes"|"no","slabTypes":[string],"inclusions":[string],"collars":number,"softCollars":number,"wraps":number,"jointLm":number,"jointLitres":number,"suspended":"yes"|"no","physicalHow":[string]}, each null unless said.
- buildingClass: one of ${list(NEW_BUILD_CLASSES)}. structure: the kind of building ("House, single dwelling"). slab: whether the system is part of the concrete slab. slabTypes from ${list(NEW_BUILD_SLAB_TYPES)}. inclusions (what's in the slab) from ${list(NEW_BUILD_INCLUSIONS)}.
- collars, softCollars and wraps: how many slab penetrations were treated each way. jointLm: metres of construction joint treated; jointLitres: litres applied to them. suspended: whether any of it is under a suspended floor. physicalHow: how a physical system went in, from ${list(NEW_BUILD_PHYSICAL_HOW)}.`;
}
function applyNewBuildVoice(b) {
  let n = 0;
  if (NEW_BUILD_CLASSES.includes(b.buildingClass)) n += setSpokenBox('trBuildClass', b.buildingClass);
  n += setSpokenBox('trBuildStructure', b.structure);
  const pick = (id, values, multi) => (Array.isArray(values) ? values : []).forEach(val => {
    const btn = [...document.querySelectorAll(`#${id} .qp-chip`)].find(c => c.dataset.value.toLowerCase() === String(val).toLowerCase());
    if (btn && !btn.classList.contains('on')) { tapNewBuildChip(btn, multi); n++; }
  });
  if (b.slab === 'yes' || b.slab === 'no') pick('trBuildSlab', [b.slab === 'yes' ? 'Yes' : 'No'], false);
  if (b.suspended === 'yes' || b.suspended === 'no') pick('trBuildSuspended', [b.suspended === 'yes' ? 'Yes' : 'No'], false);
  pick('trBuildSlabTypes', b.slabTypes, true);
  pick('trBuildInclusions', b.inclusions, true);
  pick('trPhysicalHow', b.physicalHow, true);
  [['collars', 'trBuildCollars'], ['softCollars', 'trBuildSoftCollars'], ['wraps', 'trBuildWraps'], ['jointLm', 'trBuildJointLm'], ['jointLitres', 'trBuildJointLitres']]
    .forEach(([k, id]) => { if (Number(b[k]) > 0) n += setSpokenBox(id, String(Number(b[k]))); });
  renderNewBuildPenTotal();
  return n;
}

// ── THE RECORD SHEET ──
let treatmentPad = null;
let treatmentSketch = null;

function openTreatmentRecord() {
  const q = quoteState;
  if (!q) return;
  // What was on the record when the app closed comes back, unless the
  // record has been saved since (UNSAVED SHEETS in js/quote.js).
  const sheetKey = 'treatment|' + q.reportKey;
  const copy = unsavedSheetCopy(sheetKey);
  const restored = !!copy && copy.at > ((q.treatment && q.treatment.at) || 0);
  const t = restored ? copy.data : q.treatment || draftTreatment(q);
  // A new construction job's record: its building and slab, its own care
  // lines, and the client as Job details has them now.
  const nb = isNewBuildJob(treatmentReportFor(q));
  if (nb && fillQuoteClientFromJob(q, { client: (document.getElementById('jobClient') || {}).value || q.client, reportData: treatmentReportFor(q) }) && q.treatment) persistQuote();
  document.getElementById('treatmentOverlay').classList.toggle('new-build', nb);
  track('screen_viewed', { screen: 'treatment_record' });
  document.getElementById('trDate').value = t.date || todayIsoDate();
  document.getElementById('trTech').value = t.technician || '';
  document.getElementById('trLicence').value = t.licence || '';
  document.getElementById('trSupervisor').value = t.supervisor || '';
  document.getElementById('trSupervisorLicence').value = t.supervisorLicence || '';
  document.getElementById('trSupervisorMore').open = !!(t.supervisor || t.supervisorLicence);
  document.getElementById('trStart').value = t.start || '';
  document.getElementById('trFinish').value = t.finish || '';
  document.getElementById('trPest').value = t.pest || '';
  document.getElementById('trWeather').value = t.weather || '';
  document.getElementById('trEquipment').value = t.equipment || '';
  document.getElementById('trCautions').value = t.cautions != null ? t.cautions : TREATMENT_DEFAULT_CAUTIONS;
  document.getElementById('trWarranty').value = t.warranty || '';
  // What was quoted shows ticked; every other kind of treatment waits under
  // "Something else", so the list stays short.
  const method = ([key, m]) => {
    const on = key in (t.methods || {});
    return `<label class="treat-method">
        <input type="checkbox" data-key="${key}" ${on ? 'checked' : ''} onchange="onTreatmentMethodToggle(this)">
        <span>${escapeHtml(m.label)}</span>
        ${m.qty ? `<input class="quote-input treat-method-qty" type="number" min="0" step="any" inputmode="decimal" data-qty="${key}"
          value="${escapeHtml((t.methods || {})[key] || '')}" placeholder="${m.qty}" aria-label="${m.qty}" ${on ? '' : 'hidden'}>` : ''}
      </label>`;
  };
  // A new construction job puts a system in, so those lead.
  const all = Object.entries(TREATMENT_METHODS), ticked = all.filter(([k]) => k in (t.methods || {}));
  const shown = ticked.length ? ticked : nb ? NEW_BUILD_METHODS.map(k => [k, TREATMENT_METHODS[k]]) : all;
  const rest = all.filter(([k]) => !shown.some(([s]) => s === k));
  document.getElementById('trMethods').innerHTML = shown.map(method).join('')
    + (rest.length ? `<details class="sheet-more treat-more" id="trMethodsMore"><summary>Something else done?</summary>${rest.map(method).join('')}</details>` : '');
  renderTreatmentProducts(t.products && t.products.length ? t.products : [{}]);
  const site = t.site || treatmentSiteFromReport(treatmentSourceReport());
  document.getElementById('trSiteBuilding').value = site.building || '';
  document.getElementById('trSiteFloor').value = site.floor || '';
  document.getElementById('trSiteSurrounds').value = site.surrounds || '';
  document.getElementById('trSiteExisting').value = site.existing || '';
  renderTreatmentSiteSummary();
  ['trSiteBuilding', 'trSiteFloor', 'trSiteSurrounds', 'trSiteExisting'].forEach(id => { document.getElementById(id).oninput = renderTreatmentSiteSummary; });
  // A new record starts from the report's plan, when the inspector drew
  // one: the house and what was found are there, to add the treatment to.
  const reportPlan = !q.treatment && treatmentSourceReport().sitePlan;
  treatmentPlanFromReport = !sitePlanHasContent(t.plan) && sitePlanHasContent(reportPlan);
  treatmentPlanDraft = sitePlanHasContent(t.plan) ? JSON.parse(JSON.stringify(t.plan))
    : treatmentPlanFromReport ? JSON.parse(JSON.stringify(reportPlan)) : null;
  renderTreatmentPlan();
  document.getElementById('trAreas').value = t.areas || '';
  document.getElementById('trNotTreated').value = t.notTreated || '';
  document.getElementById('trNotice').value = t.notice || 'new';
  document.getElementById('trNoticeWhere').value = t.noticeWhere || '';
  treatmentPhotosDraft = treatmentRecordPhotos(t).map(p => ({ ...p }));
  fillNewBuildForm(nb ? (t.build || draftNewBuild()) : null);
  renderTreatmentPhotos();
  onTreatmentNoticeChange();
  document.getElementById('trNext').value = t.nextInspection || '';
  document.getElementById('trNotes').value = t.notes || '';
  if (!q.treatment) fillTreatmentRatesFromRegister();
  cancelSheetVoice('treatment');
  document.getElementById('treatmentOverlay').classList.add('open');
  if (!treatmentPad) {
    treatmentPad = createSignaturePad(document.getElementById('trSigCanvas'), document.getElementById('trSigPlaceholder'), () => { keepSheetSignature(treatmentPad, false); updateTreatmentSaveBtn(); unsavedSheetChanged(); });
  }
  openSheetSignature(treatmentPad, t.signature || '', t.technician);
  if (!treatmentSketch) {
    treatmentSketch = createSignaturePad(document.getElementById('trSketchCanvas'), document.getElementById('trSketchPlaceholder'), unsavedSheetChanged);
  }
  treatmentSketch.ctx.strokeStyle = SIGNATURE_INK;
  treatmentSketch.show(t.sketch || '');
  document.getElementById('trSketchMore').open = !!t.sketch && !treatmentPlanDraft;
  updateTreatmentSaveBtn();
  renderTreatmentFolds(true);
  const sheet = document.getElementById('treatmentOverlay');
  if (!sheet.dataset.folds) {
    sheet.dataset.folds = '1';
    ['input', 'change'].forEach(ev => sheet.addEventListener(ev, () => { renderTreatmentFolds(); unsavedSheetChanged(); }));
  }
  document.querySelector('#treatmentOverlay .page-sheet-body').scrollTop = 0;
  watchUnsavedSheet(sheetKey, readTreatmentForm);
  if (restored) showToast('Picked up where you left off. Save the record when you\'re done', 'info');
}

// ── THE FOLDS ── Each part of the record folds to its title, with a tick
// once it's done, or a short amber note saying what the certificate still
// needs. On opening (and after a voice fill) the parts with a gap open and
// the rest fold.
function treatmentFoldLines() {
  const v = id => document.getElementById(id).value.trim();
  const methods = {};
  document.querySelectorAll('#trMethods input[type=checkbox]:checked').forEach(box => { methods[box.dataset.key] = ''; });
  return treatmentRecordGaps({ technician: v('trTech'), licence: v('trLicence'), methods, products: readTreatmentProducts(),
    areas: v('trAreas'), notice: v('trNotice'), noticeWhere: v('trNoticeWhere'), nextInspection: v('trNext'), build: readNewBuildForm() })
    .map(g => g ? { warn: true, text: g.need } : {});
}

// What a record's certificate still needs, part by part (four entries,
// null where a part is done). need is what the record sheet's fold says;
// missing is how the certificate card names it once the record is saved,
// since a record saves with gaps so a technician can finish it later.
function treatmentRecordGaps(t) {
  const gap = (need, missing) => ({ need, missing });
  const products = (t.products || []).map(p => p.name).filter(Boolean);
  return [
    !t.technician ? gap('Add the technician', 'the technician\'s name') : !t.licence ? gap('Add the licence no.', 'the technician\'s licence number') : null,
    !Object.keys(t.methods || {}).length ? gap('Tick what was done', 'what was done') : !products.length ? gap('Name the product used', 'the product used') : null,
    !t.areas ? gap('Add the areas treated', 'the areas treated') : null,
    t.notice !== 'none' && !t.noticeWhere ? gap('Say where the notice went', 'where the notice went') : !t.nextInspection ? gap('Add the next inspection date', 'the next inspection date') : null,
    // A new construction job's building and slab (the fold after Treatment applied).
    !t.build ? null : !t.build.buildingClass ? gap('Add the building class', 'the building class')
      : !t.build.slab ? gap('Say if it\'s part of the slab', 'whether the system is part of the slab') : null,
  ];
}

function renderTreatmentFolds(reset) {
  if (!document.getElementById('trFold1')) return;
  treatmentFoldLines().forEach((line, i) => {
    const fold = document.getElementById('trFold' + (i + 1));
    setFoldNote(fold, document.getElementById('trSub' + (i + 1)), line.text);
    if (reset) fold.open = !!line.warn;
  });
}

// The site, folded away as it comes from the report: its building, or what's
// missing, beside the heading.
function renderTreatmentSiteSummary() {
  const v = id => document.getElementById(id).value.trim();
  const building = v('trSiteBuilding');
  document.getElementById('trSiteSummary').textContent = building || (v('trSiteFloor') || v('trSiteSurrounds') ? '' : 'not filled in yet');
  if (!building && !v('trSiteFloor') && !v('trSiteSurrounds') && !v('trSiteExisting')) document.getElementById('trSiteMore').open = true;
}

// ── THE SITE PLAN ON THE RECORD ── The drawn plan (js/site-plan.js) is kept
// here until the record is saved. treatmentPlanFromReport: it's still the
// report's plan as it came, nothing added yet.
let treatmentPlanDraft = null, treatmentPlanFromReport = false;

function renderTreatmentPlan() {
  drawTreatmentPlan();
  renderTreatmentFolds();
}
function drawTreatmentPlan() {
  document.getElementById('trPlan').innerHTML = sitePlanCardHTML(treatmentPlanDraft, 'openTreatmentSitePlan', {
    empty: ['Draw the site plan', 'The building, what you treated, any stations and the notice. It prints on the certificate.'],
    note: treatmentPlanFromReport ? 'Started from the report\'s plan. Add what you treated and any stations.' : '',
  });
}

function openTreatmentSitePlan(layer) {
  // The stations counted on the record are how many Stations all round places.
  const baitQty = document.querySelector('#trMethods [data-qty="bait"]');
  const stations = baitQty && !baitQty.hidden ? parseInt(baitQty.value, 10) || 0 : 0;
  const methods = [...document.querySelectorAll('#trMethods input[type=checkbox]:checked')].map(box => box.dataset.key);
  openSitePlan(treatmentPlanDraft, plan => {
    treatmentPlanDraft = sitePlanHasContent(plan) ? plan : null;
    treatmentPlanFromReport = false;
    renderTreatmentPlan();
    unsavedSheetChanged();
    // The stations drawn fill an empty station count, and tick baiting.
    const n = sitePlanStations(plan).filter(s => s.k !== 'monitor').length;
    const box = document.querySelector('#trMethods input[data-key="bait"]');
    const qty = document.querySelector('#trMethods [data-qty="bait"]');
    if (n && box && !box.checked) { box.checked = true; onTreatmentMethodToggle(box); }
    if (n && qty && !qty.value.trim()) qty.value = String(n);
    // A plan with a scale gives the linear metres of each barrier or
    // reticulation system ticked.
    ['barrier', 'retic', 'physical'].forEach(k => {
      const lm = Math.round(sitePlanLength(plan, k));
      const lBox = document.querySelector(`#trMethods input[data-key="${k}"]`);
      const lQty = document.querySelector(`#trMethods [data-qty="${k}"]`);
      if (lm && lBox && lBox.checked && lQty && !lQty.value.trim()) lQty.value = String(lm);
    });
  }, { stations, methods });
  if (layer === 'sub') setSitePlanLayer('sub');
}

// A photo of the site (or of a plan drawn on paper) fills the sketch pad,
// and the technician marks it up in red.
function loadTreatmentSketchPhoto(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file || !treatmentSketch) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const { canvas, ctx } = treatmentSketch;
      const scale = Math.max(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
      const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
      treatmentSketch.clear();
      ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      ctx.strokeStyle = '#d02b20';
      treatmentSketch.empty = false;
      document.getElementById('trSketchPlaceholder').style.display = 'none';
    };
    img.onerror = () => showToast('Could not open that photo', 'error');
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

// The plan on white as a JPEG, which stays small enough to sync with the quote.
function treatmentSketchImage() {
  if (!treatmentSketch || treatmentSketch.empty) return '';
  const src = treatmentSketch.canvas;
  const out = document.createElement('canvas');
  out.width = src.width; out.height = src.height;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, 0, 0);
  return out.toDataURL('image/jpeg', 0.8);
}

function closeTreatmentRecord() {
  forgetSheetFrom('treatmentOverlay');
  dropUnsavedSheet();
  cancelSheetVoice('treatment');
  document.getElementById('treatmentOverlay').classList.remove('open');
}

// ── SAID INSTEAD OF TYPED ──
// What the "Say it instead" button on the record sends with the
// technician's note (see SAY IT INSTEAD in js/app/).
function treatmentVoicePrompt() {
  const methods = Object.entries(TREATMENT_METHODS).map(([k, m]) => `"${k}" (${m.label})`).join(', ');
  return `You fill in a termite treatment record for SAYON, an app for Australian timber pest technicians. The user message is what the technician said about a treatment they did, and the date today. Return ONLY a JSON object, no markdown, with these keys, each null unless the technician said it:
{"date":"YYYY-MM-DD","start":"HH:MM","finish":"HH:MM","technician":string,"licence":string,"supervisor":string,"supervisorLicence":string,"pest":string,"weather":string,"equipment":string,"methods":{"<method>":{"qty":number|null}},"products":[{"name":string,"rate":string,"amount":string,"batch":string,"life":string,"where":string}],"areas":string,"notTreated":string,"notice":"new"|"updated"|"none","noticeWhere":string,"nextInspectionMonths":number,"nextInspectionDate":"YYYY-MM-DD","warranty":string,"notes":string}
- date: the day it was done. "Today" and "yesterday" count from today's date. start and finish in 24-hour time ("8 till half 11" is 08:00 and 11:30).
- methods: only the methods they did, from: ${methods}. qty is the linear metres of barrier, reticulation or physical barrier, or the number of bait stations, when said.
- products: each product used, with the mix or application rate, the amount used, the batch number, the life on the label and where it went, as said. Brand names as written on the drum ("termite door" is Termidor), using one of these names when it is one of them: ${Object.keys(TREATMENT_PRODUCTS).join(', ')} ("Focus termite bait" is Exterra Focus).
- areas: where they treated, in brief. notTreated: anywhere they didn't treat and why ("Under the rear deck, no access").
- notice: "new" when they put a new durable notice up, "updated" when they updated the existing one, "none" when none was placed. noticeWhere: where it is ("Meter box").
- weather: as said ("Fine, 22°C"). equipment: what they used ("Rodding gun, foam rig").
- nextInspectionMonths or nextInspectionDate: when the next timber pest inspection is due, as said. A return visit to check bait stations or the knockdown is not the next inspection: it goes in notes.
- Only words actually said. Never guess, and never invent a rate, an amount or a batch number.${treatmentIsNewBuild() ? newBuildVoicePrompt() : ''}`;
}

// Fills the open record from the spoken note. Returns how many boxes changed.
function applyTreatmentVoice(f) {
  let n = 0;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(f.date || '') ? f.date : '';
  n += setSpokenBox('trDate', date);
  const time = v => /^\d{1,2}:\d{2}$/.test(v || '') ? v.padStart(5, '0') : '';
  n += setSpokenBox('trStart', time(f.start));
  n += setSpokenBox('trFinish', time(f.finish));
  ['technician:trTech', 'licence:trLicence', 'supervisor:trSupervisor', 'supervisorLicence:trSupervisorLicence', 'pest:trPest', 'weather:trWeather',
    'equipment:trEquipment', 'areas:trAreas', 'notTreated:trNotTreated', 'noticeWhere:trNoticeWhere', 'warranty:trWarranty', 'notes:trNotes']
    .forEach(pair => { const [k, id] = pair.split(':'); n += setSpokenBox(id, f[k]); });
  if (f.supervisor || f.supervisorLicence) document.getElementById('trSupervisorMore').open = true;
  if (TREATMENT_NOTICE[f.notice]) { n += setSpokenBox('trNotice', f.notice); onTreatmentNoticeChange(); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.nextInspectionDate || '')) n += setSpokenBox('trNext', f.nextInspectionDate);
  else if (Number(f.nextInspectionMonths) > 0) n += setSpokenBox('trNext', addMonthsIso(document.getElementById('trDate').value || todayIsoDate(), Number(f.nextInspectionMonths)));
  const said = f.methods && typeof f.methods === 'object' ? Object.keys(f.methods).filter(k => k in TREATMENT_METHODS) : [];
  if (said.length) {
    // What was said replaces the ticks the quote suggested.
    document.querySelectorAll('#trMethods input[type=checkbox]').forEach(box => {
      const on = said.includes(box.dataset.key);
      if (box.checked !== on) { box.checked = on; n++; }
      if (on && box.closest('#trMethodsMore')) document.getElementById('trMethodsMore').open = true;
      onTreatmentMethodToggle(box, true);
      const qty = document.querySelector(`#trMethods [data-qty="${box.dataset.key}"]`);
      const q = on && f.methods[box.dataset.key] && Number(f.methods[box.dataset.key].qty);
      if (qty && q > 0 && qty.value !== String(q)) { qty.value = String(q); n++; }
    });
  }
  const spoken = (Array.isArray(f.products) ? f.products : []).filter(p => p && Object.values(p).some(Boolean));
  if (spoken.length) {
    // A product already on the record is updated; a new one is added.
    const rows = readTreatmentProducts().filter(p => Object.values(p).some(Boolean));
    spoken.forEach(p => {
      const name = Object.keys(TREATMENT_PRODUCTS).find(k => k.toLowerCase() === String(p.name || '').trim().toLowerCase()) || String(p.name || '').trim();
      const row = rows.find(r => r.name && name && r.name.toLowerCase() === name.toLowerCase()) || (rows.length === 1 && !rows[0].name ? rows[0] : null);
      const target = row || {};
      if (name) target.name = name;
      if (name && TREATMENT_PRODUCTS[name] && !target.active) target.active = TREATMENT_PRODUCTS[name];
      ['rate', 'amount', 'batch', 'life', 'where'].forEach(k => { if (p[k]) target[k] = String(p[k]).trim(); });
      if (!row) rows.push(target);
      n++;
    });
    renderTreatmentProducts(rows.length ? rows : [{}]);
  }
  if (treatmentIsNewBuild() && f.build && typeof f.build === 'object') n += applyNewBuildVoice(f.build);
  n += fillTreatmentRatesFromRegister();
  updateTreatmentSaveBtn();
  renderTreatmentFolds(true);
  if (n) unsavedSheetChanged();
  return n;
}

function onTreatmentMethodToggle(box, quiet) {
  const qty = document.querySelector(`#trMethods [data-qty="${box.dataset.key}"]`);
  if (qty) qty.hidden = !box.checked;
  if (box.dataset.key === 'physical') showNewBuildParts();
  if (box.checked && !quiet) fillTreatmentRatesFromRegister();
  updateTreatmentSaveBtn();
}

function onTreatmentNoticeChange() {
  const none = document.getElementById('trNotice').value === 'none';
  document.getElementById('trNoticeWhereWrap').hidden = none;
  document.getElementById('trNoticePhotoWrap').hidden = none;
}

// ── PHOTOS ON THE RECORD ── Photos of the work (what went in, where) and
// of the durable notice, for the certificate's Photos page. Each is kept
// like a report photo: in the photo store on the phone and, once the job
// syncs, in the account's Storage (js/app/photos.js, which keeps and
// uploads them with the job's own). t.photos holds what they are.
const TREATMENT_PHOTO_KINDS = {
  work: { box: 'trWorkPhotos', limit: 12, label: 'The work' },
  // A new construction job's slab certification, from the builder or concreter.
  slab: { box: 'trSlabPhotos', limit: 3, label: 'The slab\'s certification' },
  notice: { box: 'trNoticePhotos', limit: 3, label: 'The durable notice' },
};
let treatmentPhotosDraft = [];

function renderTreatmentPhotos() {
  Object.entries(TREATMENT_PHOTO_KINDS).forEach(([kind, k]) => {
    const box = document.getElementById(k.box);
    if (!box) return;
    const photos = treatmentPhotosDraft.filter(p => p.kind === kind);
    box.innerHTML = photos.map(p => `<div class="spot-photo">
        <img data-photo-id="${escapeHtml(p.id)}" alt="Photo">
        <input class="photo-caption-input spot-photo-caption" type="text" placeholder="Add details…" value="${escapeHtml(p.caption || '')}"
          aria-label="Details of the photo" oninput="updateTreatmentPhotoCaption('${escapeHtml(p.id)}', this.value)">
        <div class="photo-actions"><button type="button" class="photo-remove-btn" onclick="removeTreatmentPhoto('${escapeHtml(p.id)}')">Remove</button></div>
      </div>`).join('')
      + (photos.length >= k.limit ? '' : `<div class="photo-add-row"><button type="button" class="spot-photo-add" onclick="addTreatmentPhoto('${kind}')">${PHOTO_ADD_ICON}Add photo</button>
        <button type="button" class="link-btn photo-choose" onclick="addTreatmentPhoto('${kind}', true)">Choose one instead</button></div>`);
    hydratePhotoImages(box, photos);
  });
}

// Add photo is the camera; choosing: "Choose one instead" (js/app/photos.js).
function addTreatmentPhoto(kind, choosing) {
  const input = document.getElementById('trPhotoInput');
  input.dataset.kind = kind;
  if (choosing) choosePhotoSource(input, true); else takePhoto(input);
}

async function handleTreatmentPhotoFiles(input) {
  const kind = TREATMENT_PHOTO_KINDS[input.dataset.kind] ? input.dataset.kind : 'work';
  const files = Array.from(input.files || []);
  input.value = '';
  if (!files.length) return;
  const draft = treatmentPhotosDraft;
  const limit = TREATMENT_PHOTO_KINDS[kind].limit;
  const take = files.slice(0, Math.max(0, limit - draft.filter(p => p.kind === kind).length));
  if (files.length > take.length) showToast(`Only ${take.length} of ${files.length} added. This box holds ${limit} photos`, 'error');
  for (const file of take) {
    try {
      const { blob, width, height } = await compressPhotoFile(file);
      const id = genPhotoId();
      await putPhotoBlob(id, blob);
      draft.push({ id, width, height, caption: '', kind });
    } catch (e) { showToast(photoStoreProblem(e), 'error'); }
  }
  // The sheet was closed, or opened for another job, while they were stored.
  if (draft !== treatmentPhotosDraft) return;
  renderTreatmentPhotos();
  unsavedSheetChanged();
}

// Removing a photo offers Undo, which puts it back where it was.
function removeTreatmentPhoto(id) {
  const draft = treatmentPhotosDraft;
  const i = draft.findIndex(p => p.id === id);
  if (i < 0) return;
  const [photo] = draft.splice(i, 1);
  renderTreatmentPhotos();
  unsavedSheetChanged();
  showToast('Photo removed', 'info', { label: 'Undo', run: () => {
    if (draft !== treatmentPhotosDraft || draft.some(p => p.id === id)) return;
    draft.splice(Math.min(i, draft.length), 0, photo);
    renderTreatmentPhotos();
    unsavedSheetChanged();
  } });
}

function updateTreatmentPhotoCaption(id, value) {
  const p = treatmentPhotosDraft.find(x => x.id === id);
  if (p) p.caption = value;
}

// Once the job has synced, its record's photos are in the account's
// Storage. Their paths go on the quote kept on this phone as well, so
// later saves keep them and another device can fetch the photos.
function keepTreatmentPhotoPaths(reportId, photos) {
  const paths = new Map(photos.filter(p => p && p.path).map(p => [p.id, p.path]));
  if (!paths.size) return;
  const mark = q => treatmentRecordPhotos(q && q.treatment).forEach(p => { if (!p.path && paths.has(p.id)) p.path = paths.get(p.id); });
  const all = readJSON(quotesStorageKey(), {});
  if (all[reportId]) {
    mark(all[reportId]);
    try { localStorage.setItem(quotesStorageKey(), JSON.stringify(all)); } catch (e) {}
  }
  if (quoteState && quoteState.reportKey === reportId) mark(quoteState);
}

function renderTreatmentProducts(products) {
  const esc = escapeHtml;
  // The product list offers the chemical register first, then the products
  // SAYON knows that aren't in it.
  const list = document.getElementById('trProductList');
  if (list && typeof getChemicalRegister === 'function') {
    const names = [...new Set([...getChemicalRegister().products.map(c => c.name).filter(Boolean), ...Object.keys(TREATMENT_PRODUCTS)])];
    list.innerHTML = names.map(n => `<option value="${esc(n)}">`).join('');
  }
  document.getElementById('trProducts').innerHTML = products.map((p, i) => `
    <div class="treat-product" data-i="${i}">
      <div class="treat-product-head">Product ${i + 1}</div>
      <div class="job-row">
        <div class="job-field">
          <div class="job-field-label">Name</div>
          <input class="job-input" data-f="name" list="trProductList" value="${esc(p.name || '')}" placeholder="e.g. Termidor" oninput="onTreatmentProductName(this)">
        </div>
        <div class="job-field">
          <div class="job-field-label">Active constituent</div>
          <input class="job-input" data-f="active" value="${esc(p.active || '')}" placeholder="e.g. fipronil">
        </div>
      </div>
      <div class="treat-use" data-chem="${esc(((typeof findChemical === 'function' && findChemical(p.name)) || {}).id || '')}">${treatmentUseHtml(p)}</div>
      <div class="job-row">
        <div class="job-field">
          <div class="job-field-label">Application rate</div>
          <input class="job-input" data-f="rate" value="${esc(p.rate || '')}" placeholder="As on the label" oninput="onTreatmentRateInput(this)">
          <button type="button" class="quote-link-btn treat-keep-rate" hidden onclick="keepTreatmentRate(this)">Keep this rate for next time</button>
        </div>
        <div class="job-field">
          <div class="job-field-label">Quantity used</div>
          <input class="job-input" data-f="amount" value="${esc(p.amount || '')}" placeholder="e.g. 640 L of mix">
        </div>
      </div>
      <div class="job-field">
        <div class="job-field-label">Batch No.</div>
        <div class="treat-batch">
          <input class="job-input" data-f="batch" value="${esc(p.batch || '')}" placeholder="On the drum">
          <label class="quote-link-btn treat-label-btn" onclick="if (event.target === this) { event.preventDefault(); choosePhotoSource(this.querySelector('input')); }">${p.labelPhoto ? 'Retake label photo' : 'Photo of the label'}
            <input type="file" accept="image/*" hidden onchange="loadTreatmentLabelPhoto(this, ${i})">
          </label>
        </div>
        <input type="hidden" data-f="labelPhoto" value="${esc(p.labelPhoto || '')}">
        ${p.labelPhoto ? `<img class="treat-label-thumb" src="${esc(p.labelPhoto)}" alt="Drum label photo">` : ''}
      </div>
      <div class="job-field">
        <div class="job-field-label">Life expectancy</div>
        <input class="job-input" data-f="life" value="${esc(p.life || '')}" placeholder="e.g. Up to 8 years">
      </div>
      <div class="job-field">
        <div class="job-field-label">Where applied</div>
        <input class="job-input" data-f="where" value="${esc(p.where || '')}" placeholder="e.g. Trenched and rodded around the perimeter" onchange="fillTreatmentRatesFromRegister()">
      </div>
      ${products.length > 1 ? `<button class="quote-link-btn" onclick="removeTreatmentProduct(${i})">Remove product</button>` : ''}
    </div>`).join('');
}

function readTreatmentProducts() {
  return [...document.querySelectorAll('#trProducts .treat-product')].map(row => {
    const p = {};
    row.querySelectorAll('[data-f]').forEach(inp => { p[inp.dataset.f] = inp.value.trim(); });
    return p;
  });
}

// A photo of the drum label keeps the batch number on record without typing
// it out. It's compressed by the shared photo helper and kept with the product.
async function loadTreatmentLabelPhoto(input, i) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  try {
    const { blob } = await compressPhotoFile(file);
    const url = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result); fr.onerror = rej;
      fr.readAsDataURL(blob);
    });
    const products = readTreatmentProducts();
    if (!products[i]) return;
    products[i].labelPhoto = url;
    renderTreatmentProducts(products);
    unsavedSheetChanged();
    const batch = document.querySelector(`#trProducts .treat-product[data-i="${i}"] [data-f="batch"]`);
    if (batch && !batch.value) { batch.placeholder = 'Type the batch number from the photo'; batch.focus(); }
  } catch (e) {
    showToast('Could not open that photo', 'error');
  }
}

function addTreatmentProduct() {
  renderTreatmentProducts([...readTreatmentProducts(), {}]);
}

function removeTreatmentProduct(i) {
  const products = readTreatmentProducts();
  products.splice(i, 1);
  renderTreatmentProducts(products.length ? products : [{}]);
}

// ── WHAT IT'S FOR (the chemical register, js/chemicals.js) ──
// A product in the register asks what it's being used for: the label's
// uses, grouped by pest. Picking one fills the rate and life from the
// register. The choice is kept on the product as useId and use (its words).
function treatmentUseHtml(p) {
  const esc = escapeHtml;
  const chem = typeof findChemical === 'function' ? findChemical(p.name) : null;
  const uses = (chem && chem.uses) || [];
  if (!chem) return '';
  const pests = [...new Set(uses.map(u => u.pest || 'Other'))];
  const opt = u => `<option value="${esc(u.id)}"${u.id === p.useId ? ' selected' : ''}>${esc(chemicalUseLabel(u))}${u.rate ? '' : ' (no rate yet)'}</option>`;
  const options = pests.length > 1
    ? pests.map(pe => `<optgroup label="${esc(pe)}">${uses.filter(u => (u.pest || 'Other') === pe).map(opt).join('')}</optgroup>`).join('')
    : uses.map(opt).join('');
  const picked = uses.find(u => u.id === p.useId);
  return `<div class="job-field">
      <div class="job-field-label">What it's used for${pests.length === 1 ? ` <span class="treat-use-pest">· ${esc(pests[0])}</span>` : ''}</div>
      ${uses.length ? `<select class="job-input" data-f="useId" onchange="onTreatmentUse(this)">
        <option value="">Pick from the label's uses</option>${options}
        <option value="other"${p.useId === 'other' ? ' selected' : ''}>Something else (type the rate)</option>
      </select>` : '<div class="settings-row-desc">No uses in your chemical register for this product yet.</div>'}
      <input type="hidden" data-f="use" value="${esc(p.use || '')}">
      <div class="treat-use-note" ${picked && !picked.rate ? '' : 'hidden'}>No rate in your chemical register for this use yet. Type it from the label.</div>
      ${chemicalLinksHtml(chem)}
    </div>`;
}

function treatmentRowChemical(row) {
  const chem = findChemical(row.querySelector('[data-f="name"]').value);
  const sel = row.querySelector('[data-f="useId"]');
  const use = chem && sel ? (chem.uses || []).find(u => u.id === sel.value) : null;
  return { chem, use };
}

function onTreatmentUse(sel) {
  const row = sel.closest('.treat-product');
  const { chem, use } = treatmentRowChemical(row);
  const rate = row.querySelector('[data-f="rate"]');
  const life = row.querySelector('[data-f="life"]');
  const active = row.querySelector('[data-f="active"]');
  row.querySelector('[data-f="use"]').value = use ? [use.pest, chemicalUseLabel(use)].filter(Boolean).join(' · ') : '';
  // A rate the register filled is replaced by the next use's; one the
  // technician typed is kept.
  if (use && use.rate) { rate.value = chemicalUseRate(use); rate.dataset.filled = '1'; }
  else if (rate.dataset.filled) { rate.value = ''; delete rate.dataset.filled; }
  if (use && use.life && (!life.value.trim() || life.dataset.filled)) { life.value = use.life; life.dataset.filled = '1'; }
  if (chem && chem.active && !active.value.trim()) active.value = chem.active;
  row.querySelector('.treat-use-note').hidden = !use || !!use.rate;
  onTreatmentRateInput(rate);
  if (use && !use.rate) rate.focus();
}

function onTreatmentRateInput(inp) {
  const row = inp.closest('.treat-product');
  const { use } = treatmentRowChemical(row);
  if (inp.value !== chemicalUseRate(use || {})) delete inp.dataset.filled;
  row.querySelector('.treat-keep-rate').hidden = !(use && !use.rate && inp.value.trim() && canEditBusiness());
}

// ── THE RATE FROM THE REGISTER ──
// A product from the chemical register with no rate yet takes it from the
// label's use that fits what was done: the methods ticked, then the words
// on where it went. One use fits: it's picked, as if tapped. Several fit
// with the same mix (Termidor around the perimeter and under the slab): the
// mix goes in and the use is left to pick. A rate already there is never
// replaced, and a saved record is only filled when it's edited.
const TREAT_METHOD_USES = { barrier: ['Soil treatment'], retic: ['Reticulation system'], bait: ['Bait', 'Termite attractant'],
  physical: ['Physical barrier'], direct: ['Foam', 'Dust'], nest: ['Nest treatment', 'Foam', 'Dust'], topup: ['Soil treatment', 'Reticulation system', 'Bait'] };
const TREAT_USE_PLACES = [
  [/perimeter|trench|footings?|external walls?|around the (house|home|building)/i, /perimeter/i],
  [/under (the )?slab|through the slab|slab drill|drill(ed|ing)? (through )?(the )?(slab|floor)/i, /under the slab/i],
  [/\bpaths?\b|paving|patio|driveway|apron/i, /paths/i],
  [/sub-? ?floor|\bpiers?\b|\bstumps?\b/i, /subfloor/i],
  [/foam|workings|cavit/i, /workings|cavit/i],
  [/above[- ]?ground/i, /above-ground/i],
  [/in[- ]?ground/i, /in-ground/i],
  [/\bnests?\b/i, /nest/i],
];
// The product's own "where" decides the place; Areas treated only when it says none.
function treatmentUsesThatFit(chem, methods, where, areas = '') {
  let fits = (chem.uses || []).filter(u => u.rate);
  const kinds = methods.flatMap(k => TREAT_METHOD_USES[k] || []);
  if (kinds.length) fits = fits.filter(u => kinds.includes(u.method));
  const placesIn = text => TREAT_USE_PLACES.filter(([said]) => said.test(text)).map(([, surface]) => surface);
  const places = placesIn(where).length ? placesIn(where) : placesIn(areas);
  const placed = fits.filter(u => places.some(re => re.test(u.surface || '')));
  return placed.length ? placed : fits;
}
function fillTreatmentRatesFromRegister() {
  if (typeof findChemical !== 'function') return 0;
  const methods = [...document.querySelectorAll('#trMethods input[type=checkbox]:checked')].map(b => b.dataset.key);
  const rows = [...document.querySelectorAll('#trProducts .treat-product')];
  // Areas treated speaks for the product only when there's one.
  const areas = rows.length === 1 ? (document.getElementById('trAreas') || {}).value || '' : '';
  let n = 0;
  rows.forEach(row => {
    const rate = row.querySelector('[data-f="rate"]'), sel = row.querySelector('[data-f="useId"]');
    if (!rate || !sel || sel.value) return;
    const chem = findChemical(row.querySelector('[data-f="name"]').value);
    if (!chem) return;
    // Empty, or only the mix this filled in before (it can now become the whole use).
    const had = rate.value.trim();
    if (had && !(chem.uses || []).some(u => String(u.rate || '').trim() === had)) return;
    const fits = treatmentUsesThatFit(chem, methods, row.querySelector('[data-f="where"]').value, areas);
    if (fits.length === 1) { sel.value = fits[0].id; onTreatmentUse(sel); n++; return; }
    const same = k => fits.length > 1 && fits.every(u => String(u[k] || '').trim() === String(fits[0][k] || '').trim());
    if (!same('rate') || had) return;
    rate.value = fits[0].rate.trim(); rate.dataset.filled = '1';
    const life = row.querySelector('[data-f="life"]');
    if (fits[0].life && same('life') && !life.value.trim()) { life.value = fits[0].life; life.dataset.filled = '1'; }
    const active = row.querySelector('[data-f="active"]');
    if (chem.active && !active.value.trim()) active.value = chem.active;
    n++;
  });
  return n;
}

function keepTreatmentRate(btn) {
  const row = btn.closest('.treat-product');
  const { chem, use } = treatmentRowChemical(row);
  const rate = row.querySelector('[data-f="rate"]').value.trim();
  if (!chem || !use || !rate) return;
  if (!keepChemicalRate(chem.name, use.id, rate, row.querySelector('[data-f="life"]').value.trim())) return;
  btn.hidden = true;
  row.querySelector('.treat-use-note').hidden = true;
  const opt = row.querySelector(`[data-f="useId"] option[value="${CSS.escape(use.id)}"]`);
  if (opt) opt.textContent = chemicalUseLabel(use);
  showToast(`Saved to your chemical register for ${chem.name}`, 'success');
}

function onTreatmentProductName(inp) {
  const row = inp.closest('.treat-product');
  const chem = typeof findChemical === 'function' ? findChemical(inp.value) : null;
  const useWrap = row.querySelector('.treat-use');
  const wasChem = useWrap.dataset.chem || '';
  if ((chem ? chem.id : '') !== wasChem) {
    useWrap.dataset.chem = chem ? chem.id : '';
    useWrap.innerHTML = treatmentUseHtml({ name: inp.value });
    // One use on the label: it's the one.
    const sel = useWrap.querySelector('[data-f="useId"]');
    if (sel && chem.uses.length === 1) { sel.value = chem.uses[0].id; onTreatmentUse(sel); }
    else fillTreatmentRatesFromRegister();
  }
  const name = chem ? chem.name : Object.keys(TREATMENT_PRODUCTS).find(p => p.toLowerCase() === inp.value.trim().toLowerCase());
  const known = chem && chem.active ? chem.active : name && TREATMENT_PRODUCTS[name];
  const active = row.querySelector('[data-f="active"]');
  if (known && !active.value.trim()) {
    active.value = known;
    // Filled in for them: a tap on it selects it, so typing the full
    // constituent ("fipronil 9.1 g/L") replaces it instead of adding to it.
    active.addEventListener('focus', () => setTimeout(() => active.select(), 0), { once: true });
  }
}

function updateTreatmentSaveBtn() {
  const anyMethod = !!document.querySelector('#trMethods input[type=checkbox]:checked');
  document.getElementById('trSaveBtn').disabled = !anyMethod || !treatmentPad || treatmentPad.empty;
  const by = document.getElementById('trSigBy');
  if (by) by.textContent = document.getElementById('trTech').value.trim() || 'the technician';
}

// The record as the sheet has it now: what Save keeps, and the copy kept
// while it's being filled in.
function readTreatmentForm() {
  const methods = {};
  document.querySelectorAll('#trMethods input[type=checkbox]:checked').forEach(box => {
    const qty = document.querySelector(`#trMethods [data-qty="${box.dataset.key}"]`);
    methods[box.dataset.key] = qty ? qty.value.trim() : '';
  });
  const v = id => document.getElementById(id).value.trim();
  return {
    date: v('trDate') || todayIsoDate(),
    technician: v('trTech'),
    licence: v('trLicence'),
    supervisor: v('trSupervisor'),
    supervisorLicence: v('trSupervisor') ? v('trSupervisorLicence') : '',
    start: v('trStart'),
    finish: v('trFinish'),
    pest: v('trPest'),
    weather: v('trWeather'),
    equipment: v('trEquipment'),
    methods,
    // A row counts if anything was filled in, a batch number or label photo included.
    products: readTreatmentProducts().filter(p => Object.values(p).some(Boolean)),
    areas: v('trAreas'),
    notTreated: v('trNotTreated'),
    site: { building: v('trSiteBuilding'), floor: v('trSiteFloor'), surrounds: v('trSiteSurrounds'), existing: v('trSiteExisting') },
    plan: treatmentPlanDraft,
    sketch: treatmentSketchImage(),
    notice: v('trNotice'),
    noticeWhere: v('trNotice') === 'none' ? '' : v('trNoticeWhere'),
    cautions: v('trCautions'),
    nextInspection: v('trNext'),
    warranty: v('trWarranty'),
    notes: v('trNotes'),
    // The notice's photos only while a notice was placed, the slab's only
    // while the system is part of one.
    photos: treatmentPhotosDraft.filter(p => (p.kind !== 'notice' || v('trNotice') !== 'none') && (p.kind !== 'slab' || slabPhotosKept()))
      .map(p => ({ ...p })),
    signature: padSignature(treatmentPad),
    at: Date.now(),
    ...(treatmentIsNewBuild() ? { build: readNewBuildForm() } : {}),
  };
}

function saveTreatmentRecord() {
  const q = quoteState;
  if (!q) return;
  const t = readTreatmentForm();
  if (!Object.keys(t.methods).length) { showToast('Tick what was done', 'error'); return; }
  if (!treatmentPad || treatmentPad.empty) { showToast('Sign the record first', 'error'); return; }
  q.treatment = t;
  clearTimeout(quoteSaveTimer);
  persistQuote();
  storeQuoteOnReport(q, true);
  closeTreatmentRecord();
  renderQuoteProgress();
  if (typeof renderIssueState === 'function') renderIssueState();
  refreshJobsList();
  // On to the certificate, which is This job's next step.
  jobShowNext();
  showToast('Treatment recorded. The certificate is ready to send', 'success');
  track('treatment_recorded', { methods: Object.keys(t.methods).length });
}

// ── CERTIFICATE PDF ──
// The card's PDF button.
// ── PHOTOS ON THE CERTIFICATE ── The PDF is made inside the tap that
// emails it, so the record's photos (and the report's front photo, which
// leads them) are read from the photo store beforehand, when the
// certificate card shows: treatmentPhotoSrc maps a photo's id to its data
// URL, or to null when it couldn't be found (tried again when the PDF is
// made: retry).
const treatmentPhotoSrc = {};
function treatmentPdfPhotos(q) {
  const t = q && q.treatment;
  const own = treatmentRecordPhotos(t).filter(p => p.kind !== 'notice' || t.notice !== 'none');
  if (!own.length) return [];
  const front = ((treatmentReportFor(q).photosBySection || {}).general || [])[0];
  const kindOf = p => TREATMENT_PHOTO_KINDS[p.kind] ? p.kind : 'work';
  // The work, then the slab's certification, then the notice.
  return [
    ...(front ? [{ ...front, label: 'Front of the property', caption: '' }] : []),
    ...['work', 'slab', 'notice'].flatMap(kind => own.filter(p => kindOf(p) === kind).map(p => ({ ...p, label: TREATMENT_PHOTO_KINDS[kind].label }))),
  ];
}
async function loadTreatmentPhotos(q, retry) {
  for (const p of treatmentPdfPhotos(q)) {
    if (treatmentPhotoSrc[p.id] || (p.id in treatmentPhotoSrc && !retry)) continue;
    try {
      const blob = await getPhotoImage(p);
      treatmentPhotoSrc[p.id] = blob ? await blobToDataUrl(blob) : null;
    } catch (e) { treatmentPhotoSrc[p.id] = null; }
  }
}
function treatmentPhotosLoaded(q) {
  return treatmentPdfPhotos(q).every(p => p.id in treatmentPhotoSrc);
}

function downloadTreatmentCertificate() {
  const q = quoteState;
  if (!q || !q.treatment) return;
  ensureJsPDFLoaded()
    .then(() => loadTreatmentPhotos(q, true))
    .then(() => buildTreatmentCertificatePDF(q))
    .then(({ blob, fname }) => { track('certificate_pdf_made'); return deliverPdfBlob(blob, fname, {
      title: 'Treatment certificate',
      text: `Treatment certificate — ${q.address || 'Property'}`,
      readyToast: 'Certificate ready. Choose where to save or send it',
    }); })
    .catch(e => {
      console.error('Certificate PDF failed:', e);
      reportError(e, 'certificate_pdf');
      showToast((e && e.message) || 'Could not make the certificate. Check your signal and try again', 'error');
    });
}

// Built inside the tap, like the quote email, because the share sheet
// won't open after a wait.
function emailTreatmentCertificate() {
  const q = quoteState;
  if (!q || !q.treatment) return;
  if (!jsPDF || !treatmentPhotosLoaded(q)) {
    ensureJsPDFLoaded()
      .then(() => loadTreatmentPhotos(q, true))
      .then(() => showToast('Ready. Tap Email again to send it', 'info'))
      .catch(e => showToast((e && e.message) || 'Could not load the PDF tools', 'error'));
    return;
  }
  sendPdfsToClient({
    files: [buildTreatmentCertificatePDF(q)],
    to: quoteClientEmail(q),
    subject: `Termite treatment certificate — ${q.address || 'your property'}`,
    body: clientMessage({ client: q.client, address: q.address, docs: 'termite treatment certificate', signOff: q.treatment.technician }),
  }).then(sent => { if (sent) { markCertificateSent(q); track('certificate_sent'); } });
}

// The treatment certificate. A system left in place (a barrier, bait
// stations, reticulation) gets its own row, System installed, and its own
// care lines, on the same certificate.
function buildTreatmentCertificatePDF(q) {
  const C = PDF_COLORS;
  const t = q.treatment;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 15, CW = W - M * 2, BOTTOM = 281;
  const company = getCompanyDetails();
  const number = treatmentCertNumber(q);
  const docName = 'Treatment Certificate';
  const systems = installedSystems(t);
  // A new construction job's record (NEW CONSTRUCTION above): its building
  // and slab, and AS 3660.1 in place of AS 3660.2.
  const build = t.build || null;
  const standard = build ? 'AS 3660.1' : 'AS 3660.2';
  let y = 0;

  // A new page keeps the text style it broke in, as the header changes it.
  const ensure = h => {
    if (y + h <= BOTTOM) return;
    const font = doc.getFont(), size = doc.getFontSize(), color = doc.getTextColor();
    doc.addPage();
    y = drawPdfRunningHeader(doc, company, docName, q.address, number);
    doc.setFont(font.fontName, font.fontStyle); doc.setFontSize(size); doc.setTextColor(color);
  };
  // Lighter headings than the quote's numbered ones, so most certificates
  // fit one page. Blue like the report's subheads, with a clear gap above
  // so a heading never sits on the table or box before it.
  const section = title => {
    ensure(24);
    y += 2.5;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...C.accentDark);
    pdfTracked(doc, title, M, y, { cs: 0.6 });
    doc.setFillColor(...C.accentLight); doc.rect(M, y + 2, CW, 0.5, 'F');
    y += 6.5;
  };
  const para = (text, opts = {}) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal'); doc.setFontSize(opts.size || 9);
    doc.setTextColor(...(opts.color || C.ink));
    const lines = doc.splitTextToSize(text, opts.w || CW);
    const lh = opts.lh || 4.4;
    ensure(lines.length * lh);
    doc.text(lines, opts.x || M, y);
    y += lines.length * lh + (opts.after == null ? 2 : opts.after);
  };
  // A row of small labelled cells side by side, e.g. pest, equipment, weather.
  const cellRow = pairs => {
    const cells = pairs.filter(([, v]) => v);
    if (!cells.length) return;
    const w = (CW - (cells.length - 1) * 6) / cells.length;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    const lines = cells.map(([, v]) => doc.splitTextToSize(v, w));
    const h = 4 + Math.max(...lines.map(l => l.length)) * 4;
    ensure(h);
    cells.forEach(([label], k) => {
      const x = M + k * (w + 6);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...C.inkMuted);
      doc.text(label.toUpperCase(), x, y);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...C.ink);
      doc.text(lines[k], x, y + 4);
    });
    y += h + 1;
  };

  y = drawPdfDocCover(doc, company, { compact: true, kicker: build ? 'Termite management · new construction' : 'Termite management', title: docName, date: formatLongDate(t.date), left: [
    ['CLIENT', q.client || 'Not specified'],
    ['PROPERTY ADDRESS', q.address || 'Not specified'],
    ['CONTACT', [q.clientPhone, q.clientEmail].map(v => (v || '').trim()).filter(Boolean).join('  ·  ')],
  ], right: [
    ['CERTIFICATE NO.', number],
    [build ? 'DATE INSTALLED' : 'TREATMENT DATE', formatLongDate(t.date) + (t.start ? `, ${formatClockTime(t.start)}${t.finish ? ` to ${formatClockTime(t.finish)}` : ''}` : '')],
    ['TECHNICIAN', t.technician],
    ['LICENCE NO.', t.licence],
    ['SUPERVISOR', t.supervisor],
    ['SUPERVISOR LICENCE', t.supervisor && t.supervisorLicence],
    ['STANDARD', build && standard],
  ] });

  // ── WHAT WAS DONE ──
  section('TREATMENT CARRIED OUT');
  // Pest, equipment and weather in a row of small labelled cells.
  // A species qualifier ("not identified, further investigation required")
  // belongs on the inspection report, not on a certificate for work done.
  const pest = (t.pest || '').replace(/\s*\([^)]*(not identified|further investigation)[^)]*\)/gi, '').trim();
  cellRow([['Target pest', pest], ['Equipment', t.equipment], ['Weather', t.weather]]);
  // What each method says, with its quantity.
  const methodText = (key, qty) => { const m = TREATMENT_METHODS[key]; return m ? m.label + (m.qty && qty ? `, ${qty} ${m.qty}` : '') : ''; };
  // One line for each method. A system left in place has its own row
  // below instead, so nothing is said twice.
  Object.entries(t.methods || {}).forEach(([key, qty]) => {
    if (systems.includes(key) || !TREATMENT_METHODS[key]) return;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    const lines = doc.splitTextToSize(methodText(key, qty), CW - 6);
    ensure(lines.length * 4.4 + 2);
    doc.setFillColor(...C.accent); doc.circle(M + 1.6, y - 1.1, 0.8, 'F');
    doc.setTextColor(...C.ink); doc.text(lines, M + 5, y);
    y += lines.length * 4.4 + 1;
  });

  // Where, in the same row style.
  // A drawn plan prints on the last page; the row says so.
  const planNote = !sitePlanHasContent(t.plan) ? '' : sitePlanHasSubfloor(t.plan) ? 'Site and subfloor plans on the last pages, with legends' : 'Drawn on the last page, with a legend';
  if (t.areas || t.notTreated || planNote) { y += 1.5; cellRow([['Areas treated', t.areas], ['Areas not treated', t.notTreated], ['Site plan', planNote]]); }

  // System installed: what stays at the property, and where, when that
  // isn't every area treated (just above). One row; the closing line says
  // what it was installed to.
  if (systems.length) {
    const where = installedSystemAreas(t, treatmentReportFor(q));
    y += 1.5; cellRow([['System installed', Object.entries(t.methods).filter(([k]) => systems.includes(k)).map(([k, qty]) => methodText(k, qty)).join('; ')], ['Where it was installed', where !== (t.areas || '') ? where : '']]);
  }

  // ── THE BUILDING AND SLAB ── A new construction job's, in the same rows.
  if (build) {
    section('THE BUILDING AND SLAB');
    const yesNo = v => v === 'yes' ? 'Yes' : v === 'no' ? 'No' : '';
    // Chips as one phrase: "Raft and waffle pod".
    const phrase = list => joinWithAnd((list || []).map((x, i) => i ? lowerFirst(x) : x));
    cellRow([['Building class', build.buildingClass], ['Structure', build.structure], ['The system is', NEW_BUILD_SYSTEM_IS[build.systemIs]]]);
    const slab = build.slab === 'yes';
    cellRow([['Part of the slab', yesNo(build.slab)], ['Slab type', slab ? phrase(build.slabTypes) : ''],
      ['In the slab', slab ? (build.inclusions || []).length ? phrase(build.inclusions) : 'Nothing noted' : '']]);
    const pens = newBuildPenetrations(build);
    const each = [['collars', 'collar'], ['softCollars', 'soft collar'], ['wraps', 'wrap']].map(([k, word]) => { const n = parseInt(build[k], 10) || 0; return n ? `${n} ${word}${n === 1 ? '' : 's'}` : ''; }).filter(Boolean);
    const joints = build.jointLm ? `${build.jointLm} linear metres${build.jointLitres ? `, ${build.jointLitres} litres applied` : ''}` : build.jointLitres ? `${build.jointLitres} litres applied` : '';
    cellRow([['Penetrations treated', pens ? `${pens} in all: ${joinWithAnd(each)}` : ''], ['Construction joints', joints],
      ['How the physical system went in', phrase(build.physicalHow)]]);
    const certPhoto = treatmentRecordPhotos(t).some(p => p.kind === 'slab') && slab;
    cellRow([['Breaks in the slab or its edges', build.discontinuities], ['Slab notes', build.slabNotes], ['Slab certification', certPhoto ? 'Photo on the Photos page' : '']]);
    cellRow([['Under a suspended floor', build.suspended === 'yes' ? (build.suspendedNotes || 'Yes') : yesNo(build.suspended)], ['Limits on the installation', build.limits || 'None noted']]);
  }

  // ── THE SITE ──
  const site = t.site || {};
  if (!build && (site.building || site.floor || site.surrounds || site.existing)) {
    section('THE SITE');
    cellRow([['Building', site.building], ['Floor and footings', site.floor], ['Surrounds', site.surrounds], ['Existing system', site.existing]]);
  }

  // ── PRODUCTS ──
  const products = (t.products || []).filter(p => p.name || p.active);
  if (products.length) {
    section('PRODUCTS APPLIED');
    // The product cell carries the active constituent on its second line.
    // Only the columns something was entered in, so there's no row of dashes.
    const optional = [
      { h: 'APPLICATION RATE', w: 30, f: p => p.rate },
      { h: 'QUANTITY', w: 24, f: p => p.amount },
      { h: 'BATCH NO.', w: 24, f: p => p.batch },
      { h: 'LIFE EXPECTANCY', w: 30, f: p => p.life },
      { h: 'WHERE', w: 40, f: p => p.where },
    ].filter(c => products.some(p => String(c.f(p) || '').trim()));
    const cols = [{ h: 'PRODUCT', w: 40, f: p => p.name || p.active }, ...optional];
    // Spread the spare width over the columns in proportion.
    const base = cols.reduce((a, c) => a + c.w, 0);
    cols.forEach(c => { c.w = c.w * CW / base; });
    const head = () => {
      drawPdfTableHeadRule(doc, M, y, CW);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.3); doc.setTextColor(...C.inkLight);
      let x = M + 3;
      cols.forEach(c => { pdfTracked(doc, c.h, x, y + 5.3, { cs: 0.3 }); x += c.w; });
      y += 8;
    };
    ensure(20); y -= 2.5; head();
    products.forEach((p, i) => {
      // Each cell is measured in the font it's drawn in: the product name is
      // bold, and a long one measured in normal ran into the next column.
      doc.setFontSize(8.5);
      const cells = cols.map((c, ci) => { doc.setFont('helvetica', ci === 0 ? 'bold' : 'normal'); return doc.splitTextToSize(c.f(p) || '', c.w - 3); });
      doc.setFontSize(7.5);
      const active = p.name && p.active ? doc.splitTextToSize(p.active, cols[0].w - 3) : [];
      const rowH = Math.max(cells[0].length * 4 + active.length * 3.4, ...cells.slice(1).map(l => l.length * 4)) + 4;
      if (y + rowH > BOTTOM) { doc.addPage(); y = drawPdfRunningHeader(doc, company, docName, q.address, number); head(); }
      if (i % 2 === 1) { doc.setFillColor(...C.rowAlt); doc.rect(M, y, CW, rowH, 'F'); }
      doc.setDrawColor(...C.ruleLight); doc.setLineWidth(0.25); doc.line(M, y + rowH, M + CW, y + rowH);
      let x = M + 3;
      cells.forEach((lines, ci) => {
        doc.setFont('helvetica', ci === 0 ? 'bold' : 'normal'); doc.setFontSize(8.5); doc.setTextColor(...C.ink);
        doc.text(lines, x, y + 5);
        if (ci === 0 && active.length) {
          doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...C.inkLight);
          doc.text(active, x, y + 5 + lines.length * 4);
        }
        x += cols[ci].w;
      });
      y += rowH;
    });
    y += 4;
  }

  const drawn = sitePlanHasContent(t.plan);

  // ── DURABLE NOTICE AND SITE PLAN ── The wording on the notice itself
  // (AS 3660.1, NCC 2022 Housing Provisions 3.4.3) in a grid, with a hand-drawn plan beside it
  // when there's no drawn one.
  const sketch = !drawn && t.sketch;
  const planW = sketch ? 64 : 0, planH = planW * 0.75;
  const boxW = sketch ? CW - planW - 5 : CW, ncols = sketch ? 2 : 3;
  const cellW = (boxW - 8 - (ncols - 1) * 5) / ncols;
  // The notice names the system left in place; a spot treatment isn't one.
  const methodNames = Object.keys(t.methods || {}).filter(k => !systems.length || systems.includes(k) || k === 'topup').map(k => TREATMENT_METHODS[k] && TREATMENT_METHODS[k].label).filter(Boolean);
  // Chemical life only when a chemical was applied, not on a baiting-only
  // job, and only for the chemicals (not the baits).
  // When a system went in, the notice is about that system: a chemical life
  // only for a chemical soil treatment or reticulation, not the foam or dust
  // used on the workings beside a baiting system.
  const chemicalApplied = systems.length ? systems.some(k => k === 'barrier' || k === 'retic')
    : Object.keys(t.methods || {}).some(k => k !== 'bait' && k !== 'physical');
  const productLife = !chemicalApplied ? [] : products.filter(p => !BAIT_PRODUCT_RE.test(`${p.name || ''} ${p.active || ''}`)).map(p => `${p.name || p.active}${p.name && p.active ? ` (${p.active})` : ''}: ${p.life || 'see label'}`);
  const every = build ? (+build.inspectEvery || 12) : ongoingInspectionMonths(treatmentReportFor(q));
  const everyText = `at least every ${every} month${every === 1 ? '' : 's'}`;
  // A trainee's work carries the licensed supervisor's name on the notice too.
  const installer = [company.name, [t.technician, t.licence ? `licence ${t.licence}` : ''].filter(Boolean).join(', '),
    t.supervisor ? `Supervised by ${t.supervisor}${t.supervisorLicence ? `, licence ${t.supervisorLicence}` : ''}` : ''].filter(Boolean).join('\n');
  const noticeCells = t.notice === 'none' ? [['Notice', 'No durable notice was placed at this treatment.']] : [
    ['System', methodNames.join('; ')],
    ['Date installed', formatLongDate(t.date)],
    ['Life expectancy', productLife.join('; ')],
    ['Future inspections', t.nextInspection ? `First by ${formatLongDate(t.nextInspection)}, then ${everyText}` : everyText.charAt(0).toUpperCase() + everyText.slice(1)],
    ['Installed by', installer],
    ['Notice', TREATMENT_NOTICE[t.notice] ? `${TREATMENT_NOTICE[t.notice]}${t.noticeWhere ? `: ${lowerFirst(t.noticeWhere)}` : ''}` : t.noticeWhere],
  ].filter(([, v]) => v);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  const noticeLines = noticeCells.map(([, v]) => doc.splitTextToSize(v, cellW));
  const rowHs = [];
  for (let i = 0; i < noticeLines.length; i += ncols) {
    rowHs.push(4 + Math.max(...noticeLines.slice(i, i + ncols).map(l => l.length)) * 3.6 + 1.5);
  }
  const boxH = Math.max(4 + rowHs.reduce((a, h) => a + h, 0), planH);
  // The heading goes over with the box, never left at the foot of a page.
  ensure(9 + boxH + 2);
  section(sketch ? 'DURABLE NOTICE AND SITE PLAN' : 'DURABLE NOTICE');
  const top = y - 3.5;
  doc.setFillColor(...C.rowAlt); doc.rect(M, top, boxW, boxH, 'F');
  doc.setFillColor(...C.accent); doc.rect(M, top, 0.8, boxH, 'F');
  let ny = top + 6;
  noticeCells.forEach(([label], i) => {
    const x = M + 4 + (i % ncols) * (cellW + 5);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...C.inkMuted);
    doc.text(label.toUpperCase(), x, ny);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.ink);
    doc.text(noticeLines[i], x, ny + 3.8);
    if (i % ncols === ncols - 1 || i === noticeCells.length - 1) ny += rowHs[Math.floor(i / ncols)];
  });
  if (sketch) {
    const px = M + CW - planW;
    try { doc.addImage(sketch, 'JPEG', px, top, planW, planH); } catch (e) {}
    doc.setDrawColor(...C.rule); doc.setLineWidth(0.3); doc.rect(px, top, planW, planH);
  }
  y = top + boxH + 3.5;

  // ── NEXT STEPS ──
  const steps = [];
  if (t.cautions) steps.push(`Safety and re-entry: ${String(t.cautions).trim().replace(/[.;,\s]*$/, '.')}`);
  // What keeps a system left in place working.
  if (systems.includes('barrier')) steps.push('The barrier only works while the treated soil stays unbroken. Do not dig, pave, build or garden against the house without asking us first.');
  if (systems.includes('bait')) steps.push('The bait stations need checking as often as the manufacturer directs. Do not move, cover or remove them.');
  if (systems.includes('retic')) steps.push('The reticulation system needs recharging when the label\'s life runs out. Keep its filling points clear and don\'t cut or dig through the pipes.');
  if (systems.includes('physical')) steps.push('The physical barrier only works while it stays whole and visible. Do not cover, cut or build over it.');
  // A new build's care lines, and its inspections as the system's maker directs.
  if (build) (build.care || []).forEach(k => { if (NEW_BUILD_CARE[k]) steps.push(NEW_BUILD_CARE[k]); });
  if (build) steps.push(`${t.nextInspection ? `Book a timber pest inspection by ${formatLongDate(t.nextInspection)}, then` : 'Have a timber pest inspection'} at least every ${every} month${every === 1 ? '' : 's'}, as the system's maker directs. It lowers the risk of hidden termite attack and keeps any product warranty.`);
  else if (t.nextInspection) steps.push(`Book your next timber pest inspection by ${formatLongDate(t.nextInspection)}. AS 3660.2 recommends one at least every 12 months.`);
  // Short points, so the signature can stay on page 1. Treated soil is
  // said once: the barrier's own line already covers it.
  steps.push((systems.includes('retic') && !systems.includes('barrier') ? 'Do not dig or build against the treated soil without asking us. ' : '') +
    'Keep weep holes clear and leaks fixed, and call us if you see termites or mud leads.');
  // The list stays together, so it never starts at the foot of a page.
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  const stepLines = steps.map(st => doc.splitTextToSize(st, CW - 7));
  const stepsH = 12 + stepLines.reduce((a, l) => a + l.length * 3.9 + 0.8, 0);
  // The closing words under the signature, measured now so the sign-off
  // can keep them with it.
  const closing = build
    ? `The termite management system above was installed by this technician in line with the manufacturer's directions, the product label and ${standard}. No system can guarantee termites will never get in. Regular inspections are the best protection.`
    : systems.length
    ? 'The treatment above was carried out, and the system installed, by this technician in line with the manufacturer\'s directions, the product label and AS 3660.2. Neither repairs existing damage, and no treatment or system can guarantee termites will never return. Regular inspections are the best protection.'
    : 'The treatment above was carried out by this technician in line with the product label directions and AS 3660.2. It does not repair existing damage, and no treatment can guarantee termites will never return. Regular inspections are the best protection.';
  doc.setFontSize(7);
  const signOffH = (t.supervisor ? 36 : 31) + doc.splitTextToSize(closing, CW).length * 3.2;
  doc.setFontSize(8.5);
  const notesLines = [t.warranty, t.notes].filter(Boolean).map(v => doc.splitTextToSize(v, t.warranty && t.notes ? (CW - 6) / 2 : CW).length);
  const notesH = notesLines.length ? 6.5 + Math.max(...notesLines) * 4 : 0;
  // When the sign-off won't fit under the steps, the steps go over with
  // it, so page 2 never holds a signature on its own.
  if (y + stepsH + notesH + signOffH > BOTTOM && 26 + stepsH + notesH + signOffH <= BOTTOM) ensure(BOTTOM);
  ensure(stepsH);
  section('KEEPING THE PROPERTY PROTECTED');
  stepLines.forEach((lines, i) => {
    ensure(lines.length * 3.9 + 2);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...C.accentDark);
    doc.text(`${i + 1}.`, M, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.ink);
    doc.text(lines, M + 6, y);
    y += lines.length * 3.9 + 0.8;
  });
  if (t.warranty || t.notes) { y += 1.5; cellRow([['Warranty and service terms', t.warranty], ['Technician notes', t.notes]]); }

  // ── SIGN-OFF ── (kept together): who, licence and date on the left,
  // the signature on the right.
  const pages = doc.internal.getNumberOfPages();
  ensure(signOffH);
  y += 3;
  // At the top of a page the running header's rule is already there.
  if (doc.internal.getNumberOfPages() === pages) { doc.setFillColor(...C.accent); doc.rect(M, y, CW, 0.5, 'F'); }
  y += 19;
  const colW = (CW - 16) / 3;
  drawPdfOnLine(doc, t.technician, M, y, colW);
  drawPdfSignature(doc, { x: M, y, w: colW, caption: t.licence ? `Technician · Licence ${t.licence}` : 'Technician' });
  drawPdfSignature(doc, { x: M + colW + 8, y, w: colW, caption: 'Signature', image: t.signature });
  drawPdfOnLine(doc, formatLongDate(t.date), M + (colW + 8) * 2, y, colW);
  drawPdfSignature(doc, { x: M + (colW + 8) * 2, y, w: colW, caption: 'Date' });
  y += 9;
  if (t.supervisor) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...C.inkLight);
    doc.text(`Supervised by ${t.supervisor}${t.supervisorLicence ? `, licence ${t.supervisorLicence}` : ''}`, M, y);
    y += 5;
  }
  para(closing, { size: 7, lh: 3.2, color: C.inkMuted });

  // ── SITE PLAN ── A page of its own, so the plan is big enough to read.
  if (drawn) {
    doc.addPage();
    y = drawPdfRunningHeader(doc, company, docName, q.address, number);
    section('SITE PLAN');
    const sum = sitePlanSummary(t.plan);
    if (sum) para(`The plan shows ${sum}.`, { size: 9, lh: 4.3, after: 2 });
    y += drawSitePlanPdf(doc, t.plan, { x: M, y: y - 1, w: CW }) + 5;
    y += drawSitePlanLegendPdf(doc, t.plan, { x: M, y, w: CW }) + 4;
    drawSitePlanStationListPdf(doc, t.plan, { x: M, y: y + 2, w: CW });
  }
  // ── SUBFLOOR PLAN ── Its own page too, under the same building and scale.
  if (drawn && sitePlanHasSubfloor(t.plan)) {
    doc.addPage();
    y = drawPdfRunningHeader(doc, company, docName, q.address, number);
    section('SUBFLOOR PLAN');
    const subSum = sitePlanSubSummary(t.plan);
    para(`The area under the suspended floor, with the building's walls above it in grey.${subSum ? ` It shows ${subSum}.` : ''}`, { size: 9, lh: 4.3, after: 2 });
    y += drawSitePlanPdf(doc, t.plan, { x: M, y: y - 1, w: CW, layer: 'sub' }) + 5;
    drawSitePlanLegendPdf(doc, t.plan, { x: M, y, w: CW, layer: 'sub' });
  }

  // ── PHOTOS ── The work and the durable notice, two to a row, led by the
  // front of the property so the reader knows the place. A page of their
  // own after the plans, so the first page stays the certificate itself.
  const photos = treatmentPdfPhotos(q).filter(p => treatmentPhotoSrc[p.id]);
  if (photos.some(p => p.label !== 'Front of the property')) {
    doc.addPage();
    y = drawPdfRunningHeader(doc, company, docName, q.address, number);
    section('PHOTOS');
    const gap = 6, boxW = (CW - gap) / 2, boxH = boxW * 0.72;
    for (let i = 0; i < photos.length; i += 2) {
      const row = photos.slice(i, i + 2);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
      const caps = row.map(p => doc.splitTextToSize((p.caption || '').trim(), boxW));
      const rowH = boxH + 6 + Math.max(...caps.map(c => c.length)) * 3.4 + 4;
      ensure(rowH);
      row.forEach((p, k) => {
        const x = M + k * (boxW + gap);
        try { drawPdfPhoto(doc, treatmentPhotoSrc[p.id], x, y, boxW, boxH); } catch (e) {}
        doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...C.inkMuted);
        pdfTracked(doc, p.label.toUpperCase(), x, y + boxH + 4.5, { cs: 0.3 });
        if (caps[k].length) {
          doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...C.ink);
          doc.text(caps[k], x, y + boxH + 8.5);
        }
      });
      y += rowH;
    }
  }

  drawPdfDocFooters(doc, `Certificate ${number}${company.name ? `  ·  ${company.name}` : ''}`, q.reportKey);
  return { blob: doc.output('blob'), fname: pdfFileName('Treatment Certificate', q.address, { ref: number }) };
}
