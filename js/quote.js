// ══════════════════════════════════════════════════════════════════════════
// QUOTE BUILDER
// Turns an inspection report's findings, conducive conditions and
// recommendations into an editable treatment quote, and exports it as a PDF in
// the same visual style as the inspection report.
//
// Loaded after the js/app/ files and relies on their globals:
// appInitialised, currentReportId, authUser, authBusiness, DRAFT_KEY,
// flushDraftSave, getSavedReports, setSavedReports, supabaseSave,
// getCompanyDetails, formatAddress, jsPDF, ensureJsPDFLoaded, PDF_COLORS,
// drawPdfCompanyMark, deliverPdfBlob, sendPdfsToClient, clientMessage,
// showToast, escapeHtml, toggleDrawer.
//
// Quotes are kept on the device (quotesStorageKey) and, once the report is
// saved, inside its saved-report entry as entry.quote, which syncs to the
// account with the report. getSavedQuotes() merges both, newest wins, so a
// quote restored from the cloud on another device shows up here too.
// ══════════════════════════════════════════════════════════════════════════

// Starting prices (AUD, ex GST) for a business's first quote. After that,
// each line starts at the rate the business last quoted for it (see
// quotePriceMemory), or at the price set in Your prices (js/price-book.js),
// which writes the same store. Most lines are per linear metre or per station.
const QUOTE_CATALOGUE = {
  barrier_lm:    { desc: 'Chemical soil treatment (termite barrier)', unit: 'lm', price: 28 },
  barrier_job:   { desc: 'Chemical soil treatment (termite barrier)', unit: 'job', price: 2400 },
  bait_install:  { desc: 'Termite baiting system: supply and install stations', unit: 'station', price: 165 },
  bait_monitor:  { desc: 'Bait station monitoring and servicing (12 months)', unit: 'year', price: 480 },
  retic_lm:      { desc: 'Reticulation system: install and charge with termiticide', unit: 'lm', price: 95 },
  physical_lm:   { desc: 'Physical termite barrier: supply and install', unit: 'lm', price: 120 },
  nest:          { desc: 'Locate and treat the termite nest', unit: 'job', price: 450 },
  system_topup:  { desc: 'Top-up / re-treatment of existing termite management system', unit: 'job', price: 1500 },
  treatment:     { desc: 'Termite management treatment', unit: 'job', price: 1800 },
  direct:        { desc: 'Direct treatment of active termite workings', unit: 'area', price: 380 },
  borer:         { desc: 'Borer treatment of affected timbers', unit: 'area', price: 450 },
  timber_soil:   { desc: 'Remove timber-to-soil contact', unit: 'job', price: 220 },
  weep_holes:    { desc: 'Clear bridged weep holes', unit: 'job', price: 180 },
  slab_edge:     { desc: 'Expose concealed slab edge for inspection', unit: 'job', price: 250 },
  followup:      { desc: 'Follow-up timber pest inspection', unit: 'visit', price: 280 },
  invasive:      { desc: 'Invasive timber pest inspection', unit: 'visit', price: 495 },
  custom:        { desc: '', unit: 'job', price: 0 },
};

const QUOTE_DEFAULT_NOTES =
  'All treatments are carried out by a licensed pest technician in accordance with AS 3660.2-2017 and the product label directions.\n' +
  'Treatment does not repair existing timber damage.';

const QUOTE_DEFAULT_PAYMENT_TERMS = 'Payment is due on completion of the work.';

let quoteState = null;        // the quote being edited
let quoteSources = [];        // reports the quote can be built from
let quoteReturnTo = 'app';    // where Back goes: the app, the one place a quote opens from
let quoteSaveTimer = null;

// ── STORAGE ─────────────────────────────────────────────────────────────────
function quotesStorageKey() {
  return (authUser && authUser.id) ? `korva_quotes_${authUser.id}` : 'korva_quotes';
}
function quotePricesStorageKey() {
  const owner = (authBusiness && authBusiness.id) || (authUser && authUser.id) || 'local';
  return `korva_quote_prices_${owner}`;
}
function readJSON(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch (e) { return fallback; }
}
function getSavedQuotes() {
  const all = readJSON(quotesStorageKey(), {});
  getSavedReports().forEach(r => {
    const q = r.quote;
    if (q && (!all[r.id] || (q.updatedAt || 0) > (all[r.id].updatedAt || 0))) all[r.id] = q;
  });
  return all;
}

// The quote for a report, or null. The unsaved draft's quote is keyed
// 'draft'. It is dropped when a new report starts (forgetDraftQuote), so it
// belongs to the open draft. It only fails to match when it was made for a
// different address: one made before the report had an address still
// counts once the address is typed, and so does one whose address was
// typed into the quote itself.
function quoteForReport(key, address) {
  const q = getSavedQuotes()[key];
  if (!q) return null;
  if (key === 'draft') {
    const madeFor = q.sourceAddress != null ? q.sourceAddress : (q.address || '');
    if (madeFor && madeFor !== (address || '')) return null;
  }
  return q;
}

// Called when a report is saved for the first time: its draft quote moves
// to the report's new id.
function adoptDraftQuote(id, address) {
  const q = quoteForReport('draft', address);
  if (!q) return;
  const all = readJSON(quotesStorageKey(), {});
  delete all.draft;
  all[id] = Object.assign({}, q, { reportKey: id, sourceAddress: address || '' });
  try { localStorage.setItem(quotesStorageKey(), JSON.stringify(all)); } catch (e) {}
  // The quote open on screen moves with it, or its later edits would be
  // saved under 'draft', which nothing reads once the report has an id.
  if (quoteState && quoteState.reportKey === 'draft') {
    quoteState.reportKey = id;
    quoteState.sourceAddress = address || '';
    const src = quoteSources.find(s => s.key === 'draft');
    if (src) src.key = id;
    const opt = document.querySelector('#quoteSource option[value="draft"]');
    if (opt) opt.value = id;
  }
  if (typeof moveTreatmentPlanKey === 'function') moveTreatmentPlanKey('draft', id);
}

// The unsaved report was thrown away, so its draft quote goes with it.
function forgetDraftQuote() {
  const all = readJSON(quotesStorageKey(), {});
  if (!all.draft) return;
  delete all.draft;
  try { localStorage.setItem(quotesStorageKey(), JSON.stringify(all)); } catch (e) {}
}

// Copies the quote into its saved report, and (cloud) syncs that report.
function storeQuoteOnReport(q, cloud) {
  const reports = getSavedReports();
  const entry = reports.find(r => r.id === q.reportKey);
  if (!entry) return;
  entry.quote = q;
  // A new save of the report, so another device takes the quote in.
  entry.cloudSavedAt = cloudBaseOf(entry);
  entry.savedAt = Date.now();
  if (setSavedReports(reports) && cloud) supabaseSave(entry);
}
function quotePriceMemory() { return readJSON(quotePricesStorageKey(), {}); }

// The payment terms on the business's last quote become the default for
// its next one, kept with its prices.
function defaultPaymentTerms() {
  const t = quotePriceMemory().__paymentTerms;
  return typeof t === 'string' ? t : QUOTE_DEFAULT_PAYMENT_TERMS;
}
function rememberPaymentTerms(text) {
  const mem = quotePriceMemory();
  if (mem.__paymentTerms === (text || '')) return;
  mem.__paymentTerms = text || '';
  storeQuotePriceMemory(mem);
}

// Whether the business adds GST. A business that isn't registered unticks
// it once, and its later quotes start without GST.
function defaultQuoteGst() {
  return quotePriceMemory().__gst !== false;
}
function rememberQuoteGst(on) {
  const mem = quotePriceMemory();
  if ((mem.__gst !== false) === on) return;
  mem.__gst = on;
  storeQuotePriceMemory(mem);
}

function rememberQuotePrice(key, price) {
  if (!key || key === 'custom' || !isFinite(price)) return;
  if (quoteState && isSampleJob(quoteState.reportKey)) return; // a price typed on the sample
  const mem = quotePriceMemory();
  if (mem[key] === price) return;
  mem[key] = price;
  storeQuotePriceMemory(mem);
}

// Stamped, so the account copy knows which is newer (see js/business-sync.js).
function storeQuotePriceMemory(mem) {
  mem.__updatedAt = Date.now();
  try { localStorage.setItem(quotePricesStorageKey(), JSON.stringify(mem)); } catch (e) { return; }
  scheduleBusinessSync();
}

function persistQuote() {
  if (!quoteState) return;
  quoteState.updatedAt = Date.now();
  const all = readJSON(quotesStorageKey(), {});
  all[quoteState.reportKey] = quoteState;
  try {
    localStorage.setItem(quotesStorageKey(), JSON.stringify(all));
    storeQuoteOnReport(quoteState, false);
    setQuoteSaveState('Saved');
    // A change after sending moves the header's pill and the Send button on.
    renderQuoteProgress();
  } catch (e) {
    setQuoteSaveState('Not saved');
    showToast('Could not save the quote. The phone\'s storage may be full', 'error');
  }
}
function scheduleQuoteSave() {
  setQuoteSaveState('Saving…');
  clearTimeout(quoteSaveTimer);
  quoteSaveTimer = setTimeout(persistQuote, 400);
}
// The app is being put away or closed: a change still waiting on the timer
// is saved now (saveBeforeLeaving in js/app/).
function flushQuoteSave() {
  if (!quoteSaveTimer) return;
  clearTimeout(quoteSaveTimer);
  quoteSaveTimer = null;
  persistQuote();
}

// ── UNSAVED SHEETS ──
// The treatment record and a bait station visit are filled in on a sheet
// and join the quote only when saved. While one is open, a copy of what's
// on it is kept on the phone as it changes, so if the phone closes the app
// or an update reloads it, opening the same sheet for the same job brings
// it all back. Saving or closing the sheet drops the copy.
const UNSAVED_SHEETS_KEY = 'korva_unsaved_sheets';
let unsavedSheet = null; // the open sheet: { key, read, changed }
let unsavedSheetTimer = null;

// The copy kept for a sheet ('treatment|<job>'), or null.
function unsavedSheetCopy(key) {
  return readJSON(UNSAVED_SHEETS_KEY, {})[key] || null;
}
// Called once the sheet is filled in: read() gives what's on it now.
function watchUnsavedSheet(key, read) {
  clearTimeout(unsavedSheetTimer);
  unsavedSheet = { key, read, changed: false };
}
function unsavedSheetChanged() {
  if (!unsavedSheet) return;
  unsavedSheet.changed = true;
  clearTimeout(unsavedSheetTimer);
  unsavedSheetTimer = setTimeout(keepUnsavedSheet, 600);
}
function keepUnsavedSheet() {
  clearTimeout(unsavedSheetTimer);
  unsavedSheetTimer = null;
  if (!unsavedSheet || !unsavedSheet.changed) return;
  const all = readJSON(UNSAVED_SHEETS_KEY, {});
  // A copy nobody came back for goes after two weeks.
  Object.keys(all).forEach(k => { if (Date.now() - (all[k].at || 0) > 14 * 864e5) delete all[k]; });
  try {
    all[unsavedSheet.key] = { at: Date.now(), data: unsavedSheet.read() };
    localStorage.setItem(UNSAVED_SHEETS_KEY, JSON.stringify(all));
  } catch (e) { /* storage full: the sheet still saves as usual */ }
}
// Saved or closed: the copy goes.
function dropUnsavedSheet() {
  clearTimeout(unsavedSheetTimer);
  unsavedSheetTimer = null;
  if (!unsavedSheet) return;
  const key = unsavedSheet.key;
  unsavedSheet = null;
  const all = readJSON(UNSAVED_SHEETS_KEY, {});
  if (!(key in all)) return;
  delete all[key];
  try { localStorage.setItem(UNSAVED_SHEETS_KEY, JSON.stringify(all)); } catch (e) {}
}
function setQuoteSaveState(text) {
  const el = document.getElementById('quoteSaveState');
  if (el) el.textContent = text;
}

// ── REPORT SOURCES ──────────────────────────────────────────────────────────
function hasReportContent(rd) {
  if (!rd) return false;
  const findings = Array.isArray(rd.findings) ? rd.findings : [];
  return !!(rd.treatmentRecommended || rd.treatmentType || rd.riskLevel ||
    findings.some(f => f && (f.termiteActivity || f.species || f.activityLocation)));
}

// The in-progress report (the autosaved draft) first, then saved reports.
// A saved report that is open as the draft is listed once, as the draft,
// since the draft carries its newest edits.
function collectQuoteSources() {
  // Only flush when the inspection app has run its setup: before that the job
  // inputs are empty and flushing would overwrite the stored draft.
  if (appInitialised) { try { flushDraftSave(); } catch (e) {} }
  const sources = [];
  const draft = readJSON(DRAFT_KEY, null);
  const draftHasJob = draft && (draft.jobAddress || hasReportContent(draft.reportData));
  if (draftHasJob) {
    sources.push({
      key: draft.currentReportId || 'draft',
      label: 'Current report',
      address: formatAddress(draft.jobAddress, draft.jobSuburb, draft.jobState, draft.jobPostcode),
      client: draft.jobClient || '',
      inspector: draft.jobInspector || '',
      reportData: draft.reportData || {},
      date: draft.savedAt,
    });
  }
  getSavedReports()
    .slice()
    .sort((a, b) => b.savedAt - a.savedAt)
    .forEach(r => {
      if (draftHasJob && draft.currentReportId === r.id) return;
      sources.push({
        key: r.id,
        label: '',
        address: r.address || formatAddress(r.jobAddress, r.jobSuburb, r.jobState, r.jobPostcode),
        client: r.client || '',
        inspector: r.inspector || '',
        reportData: r.reportData || {},
        date: r.savedAt,
      });
    });
  return sources;
}

// ── LINE ITEMS FROM A REPORT ────────────────────────────────────────────────
// The systems a recommendation can name, each with the words that name it.
// Topping up what's already there wins over the kind of system it is.
const TREATMENT_KIND_RES = [
  ['bait', /exterra|sentricon|trelona|bait/],
  ['system', /existing system|top.?up|re-?charge/],
  ['retic', /reticulat/],
  ['physical', /homeguard|kordon|termimesh|granitgard|physical/],
  ['barrier', /termidor|altriset|phantom|premise|fipronil|chlorantraniliprole|bifenthrin|biflex|talstar|maxxthor|chemical|soil treat|barrier/],
];

function classifyTreatment(text) {
  return treatmentKinds(text)[0] || 'generic';
}

// Every system the recommendation names, in that order. "chemical barrier
// or baiting system" gives ['bait', 'barrier'].
function treatmentKinds(text) {
  const t = (text || '').toLowerCase();
  const kinds = TREATMENT_KIND_RES.filter(([, re]) => re.test(t)).map(([k]) => k);
  // "Top up the reticulation system" is a top-up, not a new one.
  if (kinds.includes('system')) return kinds.filter(k => k !== 'retic' && k !== 'physical');
  // A physical barrier is a barrier too; "physical barrier" alone isn't chemical.
  if (kinds.includes('physical') && !/termidor|altriset|phantom|premise|fipronil|chlorantraniliprole|bifenthrin|biflex|talstar|maxxthor|chemical|soil treat/.test(t)) return kinds.filter(k => k !== 'barrier');
  return kinds;
}

// The systems to ask about when the recommendation offers a choice
// ("chemical barrier or baiting"), or [] when it names one (or names two to
// do together).
function treatmentChoices(text) {
  const kinds = treatmentKinds(text);
  return kinds.length > 1 && /\bor\b|\/|\beither\b/i.test(text || '') ? kinds : [];
}

// The systems the builder can quote, in the order it offers them. 'none'
// quotes only the live termites (and the rest of the work), no system.
const QUOTE_SYSTEM_LABELS = {
  bait: 'Baiting system', barrier: 'Chemical barrier', retic: 'Reticulation system',
  physical: 'Physical barrier', system: 'Top up existing', none: 'No system, termites only',
};
const quoteSystemLabel = k => QUOTE_SYSTEM_LABELS[k] || (k === 'generic' ? 'Termite management treatment' : k);

// The quote lines each system adds, to tell which system a quote holds.
const QUOTE_SYSTEM_LINE_KIND = {
  barrier_lm: 'barrier', barrier_job: 'barrier', bait_install: 'bait', bait_monitor: 'bait',
  retic_lm: 'retic', physical_lm: 'physical', system_topup: 'system', treatment: 'generic',
};

// A starting price is the catalogue price, shown on a line until this
// business sets a price for it (typed on any quote, so it is remembered).
// it.priceSet is true once the price was typed or came from the business's
// own remembered rate.
function isStartingPrice(it) {
  if (!it || it.priceSet || !it.key || it.key === 'custom' || !(it.key in QUOTE_CATALOGUE)) return false;
  return !(it.key in quotePriceMemory());
}

// "12 station" reads "12 stations". Short units (lm, m2) and units already
// ending in s stay as they are.
function pluralUnit(unit, qty) {
  const u = (unit || '').trim();
  const n = parseFloat(qty);
  if (!u || n === 1 || !/^[a-z]{3,}$/i.test(u) || /s$/i.test(u)) return u;
  return u + 's';
}

function newQuoteItem(key, overrides) {
  const cat = QUOTE_CATALOGUE[key] || QUOTE_CATALOGUE.custom;
  const mem = quotePriceMemory();
  return Object.assign({
    priceSet: key in mem,
    id: 'qi_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    key,
    desc: cat.desc,
    detail: '',
    qty: 1,
    unit: cat.unit,
    price: (key in mem) ? mem[key] : cat.price,
    source: '',
  }, overrides || {});
}

// system: 'bait' | 'barrier' | 'system' picks the main treatment line when
// the recommendation offers a choice; without it a choice adds no main line
// and the builder asks which to quote (q.systemChoice).
function buildQuoteItemsFromReport(rd, system) {
  rd = rd || {};
  const items = [];
  const findings = (Array.isArray(rd.findings) ? rd.findings : []).filter(f => f && f.termiteActivity);
  const active = findings.filter(f => f.termiteActivity === 'ACTIVE');
  const treatmentType = (rd.treatmentType || '').trim();
  // A recommendation that is only about borers ("Borer treatment of the
  // floorboards") is the borer line below, not a termite treatment as well.
  const borerOnly = !active.length && /borer|beetle|anobium|lyctus/i.test(treatmentType) && !/termite|barrier|bait|reticulation/i.test(treatmentType);
  const wantsTreatment = !borerOnly && (rd.treatmentRecommended === 'YES' || (treatmentType && rd.treatmentRecommended !== 'NO') || active.length > 0);

  // Active workings get one direct-treatment line, priced per area, that
  // names every location the report found live termites at (two lines
  // looked like the same job charged twice).
  // The detail is the locations only: the species line and the report's
  // recommendation wording are for the report, not the client's quote.
  if (active.length) {
    items.push(newQuoteItem('direct', {
      qty: active.length,
      detail: joinPlaces(active.map(f => f.activityLocation)),
      source: active.map(f => `Finding ${findings.indexOf(f) + 1}`).join(', ') + ': active termites',
    }));
  }

  if (wantsTreatment) {
    const choices = treatmentChoices(treatmentType);
    const kind = system || (choices.length ? 'ask' : classifyTreatment(treatmentType));
    // The main line's detail stays empty: the recommendation sentence is the
    // report's wording (and may name other systems), so it is not copied.
    const detail = '';
    const src = treatmentType ? `Recommendation: ${treatmentType}` : 'Recommendation: treatment';
    const lm = treatmentType.match(/(\d+(?:\.\d+)?)\s*(?:linear\s*)?(?:lm|m|metres|meters)\b/i);
    if (kind === 'barrier') {
      items.push(lm
        ? newQuoteItem('barrier_lm', { detail, qty: parseFloat(lm[1]), source: src })
        : newQuoteItem('barrier_job', { detail, source: src }));
    } else if (kind === 'retic' || kind === 'physical') {
      // Priced by the metre, like bait by the station: a starting length to change.
      items.push(newQuoteItem(kind + '_lm', { detail, qty: lm ? parseFloat(lm[1]) : 40, source: src }));
    } else if (kind === 'none') {
      // Only the live termites, already on their own lines.
    } else if (kind === 'bait') {
      const st = treatmentType.match(/(\d+)\s*(?:bait\s*)?stations?/i);
      items.push(newQuoteItem('bait_install', { detail, qty: st ? parseInt(st[1], 10) : 12, source: src }));
      items.push(newQuoteItem('bait_monitor', { source: src }));
    } else if (kind === 'system') {
      items.push(newQuoteItem('system_topup', { detail: rd.existingSystem || '', source: src }));
    } else if (kind === 'ask') {
      // The builder asks which system to quote (renderQuoteSystemChoice).
    } else {
      items.push(newQuoteItem('treatment', { detail, source: src }));
    }
  }

  // Active borers get treated; old borer damage and rot are repairs for a
  // builder, so they go in the exclusions instead (buildQuoteExclusions).
  // The detail names the places with live borers, not the old damage.
  if (rd.borerActivity === 'ACTIVE' || borerOnly) {
    const live = (Array.isArray(rd.borerFindings) ? rd.borerFindings : []).filter(b => b && b.borerActivity === 'ACTIVE')
      .map(b => [(b.location || '').trim(), lowerFirst(b.timberAffected)].filter(Boolean).join(', ')).filter(Boolean);
    items.push(newQuoteItem('borer', { detail: live.length ? joinPlaces(live) : (rd.borerDetails || ''), source: 'Finding: active borers' }));
  }

  if (rd.timberSoil === 'YES') {
    items.push(newQuoteItem('timber_soil', { source: 'Conducive condition: timber-to-soil contact' }));
  }
  if (rd.weepHoles === 'BRIDGED') {
    items.push(newQuoteItem('weep_holes', { source: 'Conducive condition: weep holes bridged' }));
  }
  if (rd.slabEdge === 'OBSTRUCTED') {
    items.push(newQuoteItem('slab_edge', { source: 'Conducive condition: slab edge concealed' }));
  }
  if (rd.invasiveInspection === 'YES') {
    items.push(newQuoteItem('invasive', { detail: rd.invasiveInspectionDetails || '', source: 'Recommendation: invasive inspection' }));
  }
  if (rd.inspectionFrequency) {
    items.push(newQuoteItem('followup', { detail: `Recommended frequency: ${rd.inspectionFrequency}`, source: 'Recommendation: inspection frequency' }));
  }
  return items;
}

// ── SPOKEN QUOTE ──
// What the inspector dictated for the quote (reportData.quoteSpoken, filled
// by mergeSpokenQuote in js/app/). Its lines replace the ones the builder
// would guess from the report, at the prices said; a line said with no
// price starts at the usual rate. Each line is matched to a catalogue line
// where it plainly is one, so the price is remembered for next time.
function spokenQuote(rd) {
  const sq = rd && rd.quoteSpoken;
  return sq && typeof sq === 'object' ? sq : null;
}

function spokenItemKey(desc, unit) {
  const d = (desc || '').toLowerCase(), u = (unit || '').toLowerCase();
  if (/monitor|servic/.test(d) && /bait|station/.test(d)) return 'bait_monitor';
  if (/bait|station/.test(d)) return 'bait_install';
  if (/top.?up|re-?treat|re-?charge/.test(d)) return 'system_topup';
  if (/reticulat/.test(d)) return 'retic_lm';
  if (/physical|kordon|termimesh|homeguard|granitgard/.test(d)) return 'physical_lm';
  if (/\bnest\b/.test(d)) return 'nest';
  if (/barrier|soil treatment|perimeter|trench/.test(d)) return /^(lm|m|metre|meter|linear)/.test(u) ? 'barrier_lm' : 'barrier_job';
  if (/borer/.test(d)) return 'borer';
  if (/invasive/.test(d)) return 'invasive';
  if (/follow.?up|re-?inspect|inspection/.test(d)) return 'followup';
  if (/colony|direct|nest|workings/.test(d)) return 'direct';
  if (/weep/.test(d)) return 'weep_holes';
  if (/slab edge/.test(d)) return 'slab_edge';
  if (/timber.{0,12}soil|sleeper/.test(d)) return 'timber_soil';
  return 'custom';
}

function spokenQuoteItems(rd) {
  const sq = spokenQuote(rd);
  const lines = sq && Array.isArray(sq.items) ? sq.items.filter(it => it && it.description) : [];
  return lines.map(it => {
    const key = spokenItemKey(it.description, it.unit);
    const priced = typeof it.price === 'number' && Number.isFinite(it.price);
    const over = { desc: it.description, qty: it.qty || 1, unit: it.unit || 'job', source: 'Said in a voice note' };
    if (priced) Object.assign(over, { price: it.price, priceSet: true });
    return newQuoteItem(key, over);
  });
}

// The spoken exclusions after the ones from the report, without repeats.
function withSpokenExclusions(list, rd) {
  const sq = spokenQuote(rd);
  const out = list.slice();
  (sq && Array.isArray(sq.exclusions) ? sq.exclusions : []).forEach(e => {
    if (e && !out.some(o => o.toLowerCase() === e.toLowerCase())) out.push(e.replace(/\.?$/, '.'));
  });
  return out;
}

// A spoken "half a day" or "12 months" lands on its chip; anything else is
// kept as said.
function spokenPlanChoice(value, options) {
  const v = (value || '').trim();
  if (!v) return '';
  return options.find(o => o.toLowerCase() === v.toLowerCase()) || v;
}

function withSpokenPlan(plan, rd) {
  const sq = spokenQuote(rd);
  if (!sq || !plan) return plan;
  return {
    ...plan,
    time: spokenPlanChoice(sq.timeframe, QUOTE_PLAN_TIMES) || plan.time,
    service: spokenPlanChoice(sq.servicePeriod, QUOTE_PLAN_SERVICE) || plan.service,
  };
}

function withSpokenNotes(notes, rd) {
  const sq = spokenQuote(rd);
  const add = sq && (sq.notes || '').trim();
  return add && !(notes || '').includes(add) ? [notes, add].filter(Boolean).join('\n') : notes;
}

// A quote made before the latest spoken quote details takes them in when
// it's opened, unless the client has answered it or the job is finalised.
// Returns whether it changed.
function applySpokenQuote(q, rd) {
  const sq = spokenQuote(rd);
  if (!q || !sq || !sq.at || (q.spokenAt || 0) >= sq.at || q.answer || isQuoteLocked()) return false;
  const items = spokenQuoteItems(rd);
  if (items.length) { q.items = items; q.systemChoice = null; }
  q.exclusions = withSpokenExclusions((q.exclusions || '').split('\n').map(l => l.trim()).filter(Boolean), rd).join('\n');
  if ((sq.paymentTerms || '').trim()) q.paymentTerms = sq.paymentTerms.trim();
  q.plan = withSpokenPlan(q.plan || buildQuotePlan(rd), rd);
  q.notes = withSpokenNotes(q.notes, rd);
  q.spokenAt = sq.at;
  return true;
}

// ── SAY THE QUOTE ──
// "Say the quote" on the quote screen: one spoken note adds, changes or
// takes off lines and sets the terms, the way a quote dictated in a report
// note does (SPOKEN QUOTE above), but onto the quote that's open. The AI is
// shown the current lines, numbered, so "make it 14 stations" changes the
// stations line rather than adding another. A line said with no price
// starts at the business's own price (or SAYON's starting price, tagged).
// Uses the report's "Say it instead" recorder (SAY IT INSTEAD in js/app/).
function sayQuote() {
  if (!quoteState) return;
  if (isQuoteLocked()) { sayLocked(); return; }
  if (quoteState.answer) { showToast('The client has answered this quote. Change it and they\'ll need to answer again', 'info'); }
  toggleSheetVoice('quote');
}

function quoteVoicePrompt() {
  const q = quoteState || { items: [] };
  const lines = q.items.length
    ? q.items.map((it, i) => `${i + 1}. ${it.desc || 'Untitled line'}: ${it.qty || 1} ${it.unit || 'job'} at $${it.price || 0} each`).join('\n')
    : '(no lines yet)';
  return `You update a timber pest treatment quote in SAYON, an app for Australian pest inspectors. The user message is what the inspector said, and the date today. The quote's current lines, numbered:
${lines}

Return ONLY a JSON object, no markdown:
{"items":[{"line":number|null,"description":string,"qty":number|null,"unit":string|null,"price":number|null}],"remove":[number],"exclusions":[string],"paymentTerms":string|null,"timeframe":string|null,"servicePeriod":string|null,"notes":string|null}
- items: one per piece of work they add or change, in the order said. line: the number of the current line it changes ("make it 14 stations" changes the stations line; "the barrier's $2,600" changes the barrier line), or null for new work. description: the work in plain client words ("Chemical soil barrier around the full perimeter", "Follow-up inspection"). qty and unit: the amount said ("48 linear metres" is qty 48, unit "lm"; "12 stations" is qty 12, unit "station"); null when not said. price: the dollar amount for ONE unit as a plain number ("$28 a metre" is 28; "48 metres, $2,400 all up" is qty 48, unit "lm", price 50; "$450" for one job is 450). Null when no amount was said for that line. Never invent a price.
- remove: the numbers of current lines they say to take off, drop or not quote.
- exclusions: each thing they say is not included, one per entry ("Repairs to the porch post").
- paymentTerms: how the client pays, in their words ("50% deposit to book, balance on completion").
- timeframe: how long the work takes, one of ${QUOTE_PLAN_TIMES.map(t => JSON.stringify(t)).join(', ')} when it fits, else as said. servicePeriod: a warranty or service period, one of ${QUOTE_PLAN_SERVICE.filter(t => t !== 'None').map(t => JSON.stringify(t)).join(', ')} when it fits. notes: anything else they want on the quote.
- Spoken numbers become digits: "two thousand four hundred" is 2400, "four fifty" for a price is 450.
- Only what was said. Never guess, and never repeat a current line they didn't mention.`;
}

let quoteVoiceChanges = 0;
function applyQuoteVoice(f) {
  quoteVoiceChanges = 0;
  const q = quoteState;
  if (!q || isQuoteLocked()) return 0;
  const clean = v => (typeof v === 'string' ? v.trim() : '');
  const num = v => { const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/[$,\s]/g, '')); return Number.isFinite(n) && n >= 0 ? n : null; };
  const lines = q.items.slice();   // the numbers the AI was shown
  const lineAt = v => { const i = Math.round(Number(v)); return i >= 1 && i <= lines.length ? lines[i - 1] : null; };
  const removed = new Set((Array.isArray(f.remove) ? f.remove : []).map(lineAt).filter(Boolean));
  let n = 0, mainLine = false;
  (Array.isArray(f.items) ? f.items : []).forEach(it => {
    if (!it || typeof it !== 'object') return;
    const price = num(it.price), qty = num(it.qty), unit = clean(it.unit);
    const line = lineAt(it.line);
    if (line && !removed.has(line)) {
      if (qty) line.qty = qty;
      if (unit) line.unit = unit;
      if (price != null) { line.price = price; line.priceSet = true; }
      if (qty || unit || price != null) n++;
      return;
    }
    const desc = clean(it.description);
    if (!desc) return;
    const key = spokenItemKey(desc, unit);
    const over = { desc, qty: qty || 1, unit: unit || (QUOTE_CATALOGUE[key] || QUOTE_CATALOGUE.custom).unit, source: 'Said on the quote' };
    if (price != null) Object.assign(over, { price, priceSet: true });
    q.items.push(newQuoteItem(key, over));
    if (['bait_install', 'barrier_lm', 'barrier_job', 'retic_lm', 'physical_lm'].includes(key)) mainLine = true;
    n++;
  });
  if (removed.size) { q.items = q.items.filter(it => !removed.has(it)); n += removed.size; }
  // A spoken main treatment answers "which system do you want to quote?".
  if (mainLine && q.systemChoice && !q.systemChoice.picked) q.systemChoice = null;
  const exclusions = (q.exclusions || '').split('\n').map(l => l.trim()).filter(Boolean);
  (Array.isArray(f.exclusions) ? f.exclusions : []).map(clean).filter(Boolean).forEach(e => {
    if (!exclusions.some(o => o.toLowerCase().replace(/\.$/, '') === e.toLowerCase().replace(/\.$/, ''))) { exclusions.push(e.replace(/\.?$/, '.')); n++; }
  });
  q.exclusions = exclusions.join('\n');
  if (clean(f.paymentTerms)) { q.paymentTerms = clean(f.paymentTerms); n++; }
  if (clean(f.timeframe) || clean(f.servicePeriod)) {
    q.plan = q.plan || buildQuotePlan(quoteReport(q));
    if (q.plan) {
      if (clean(f.timeframe)) { q.plan.time = spokenPlanChoice(f.timeframe, QUOTE_PLAN_TIMES); n++; }
      if (clean(f.servicePeriod)) { q.plan.service = spokenPlanChoice(f.servicePeriod, QUOTE_PLAN_SERVICE); n++; }
    }
  }
  if (clean(f.notes) && !(q.notes || '').includes(clean(f.notes))) { q.notes = [q.notes, clean(f.notes)].filter(Boolean).join('\n'); n++; }
  if (!n) return 0;
  quoteVoiceChanges = n;
  renderQuoteEditor();
  persistQuote();
  document.getElementById('quoteWorkFold').open = true;
  track('quote_said', { changes: n, lines: q.items.length });
  return n;
}

function quoteVoiceDone(n) {
  if (!n) return 'Nothing in that note changes the quote';
  return `Quote updated (${n} change${n === 1 ? '' : 's'}). Check the lines and prices`;
}

// What the quote fixes, in a sentence or two for the client, from the
// report's findings: live termites and where, past activity, live borers,
// and the conditions that invite termites. Locations are as the inspector
// wrote them. No risk rating and no verdict on the structure.
function buildQuoteProblem(rd) {
  rd = rd || {};
  const lc = lowerFirst;
  const where = list => list.length ? ` (${list.join('; ')})` : '';
  const findings = (Array.isArray(rd.findings) ? rd.findings : []).filter(f => f && f.termiteActivity);
  const at = status => findings.filter(f => f.termiteActivity === status).map(f => lc(f.activityLocation)).filter(Boolean);
  const out = [];
  if (findings.some(f => f.termiteActivity === 'ACTIVE')) out.push(`Live termites found${where(at('ACTIVE'))}.`);
  if (findings.some(f => f.termiteActivity === 'INACTIVE')) out.push(`Signs of past termite activity${where(at('INACTIVE'))}.`);
  if (rd.borerActivity === 'ACTIVE') {
    const live = (Array.isArray(rd.borerFindings) ? rd.borerFindings : []).filter(b => b && b.borerActivity === 'ACTIVE').map(b => lc(b.location)).filter(Boolean);
    out.push(`Live borers found${where(live)}.`);
  }
  const conditions = [
    rd.timberSoil === 'YES' && 'timber touching the soil',
    rd.weepHoles === 'BRIDGED' && 'bridged weep holes',
    rd.slabEdge === 'OBSTRUCTED' && 'a concealed slab edge',
    rd.waterLeaks === 'YES' && 'moisture from a leak',
  ].filter(Boolean);
  if (conditions.length) {
    const list = conditions.length < 2 ? conditions[0] : conditions.slice(0, -1).join(', ') + ' and ' + conditions[conditions.length - 1];
    out.push(`Conditions that invite termites: ${list}.`);
  }
  if (!out.length && rd.treatmentRecommended === 'YES') out.push('The inspection report recommends a termite treatment.');
  return out.join(' ');
}

// The quote's own wording once it has one, else fresh from the report.
// Quotes made before this was added have none, and aren't given one until
// it's edited, so a quote already sent doesn't read as changed.
function quoteProblem(q) {
  if (q && typeof q.problem === 'string') return q.problem;
  return buildQuoteProblem(quoteReport(q));
}

// A report detail set in brackets mid-sentence: "Fungal decay (wet rot)."
// reads as " (fungal decay, wet rot)" (inBrackets, js/app/).
function buildQuoteExclusions(rd) {
  rd = rd || {};
  const out = [];
  const detail = inBrackets;
  const findings = Array.isArray(rd.findings) ? rd.findings : [];
  if (findings.some(f => f && f.structuralConcern === 'YES')) {
    out.push('Assessment of termite damage by a licensed builder or structural engineer, and repair of damaged timbers.');
  } else if (findings.some(f => f && f.damageDescription)) {
    out.push('Repair or replacement of termite-damaged timbers.');
  }
  if (rd.borerActivity === 'ACTIVE' || rd.borerActivity === 'INACTIVE') {
    out.push('Repair or replacement of borer-damaged timbers.');
  }
  if (rd.decayFound === 'YES') {
    out.push(`Repair or replacement of decayed timbers${detail(rd.decayDetails)} by a licensed builder, and fixing the moisture that caused it.`);
  }
  if (rd.waterLeaks === 'YES') {
    out.push(`Repair of the moisture source${detail(rd.leakLocation)} by a licensed plumber or builder.`);
  }
  if (rd.antCapping === 'GAPS' || rd.antCapping === 'NONE') {
    out.push(`Repair or installation of ant caps${detail(rd.antCappingDetails)} by a builder.`);
  }
  if (rd.highRiskAreas) {
    out.push(`Areas not accessible at inspection${detail(rd.highRiskAreas)} unless access is provided.`);
  }
  return out;
}

// ── TREATMENT PLAN ──
// How the job will go, in plain words for the client: what we do, what we
// ask them to do, how long it takes, the free service period and the
// inspections after. q.plan = { we, owner, time, service, inspections },
// with we and owner one step per line. It starts from the report, which the
// voice notes fill, so the inspector only checks it. Quotes made before the
// plan was added have none until the inspector adds one, so a quote already
// sent doesn't change.
const QUOTE_PLAN_TIMES = ['1 to 2 hours', 'Half a day', '1 day', '2 days'];
const QUOTE_PLAN_SERVICE = ['None', '12 months', '24 months', '36 months', '60 months'];

function buildPlanWe(rd, system) {
  rd = rd || {};
  const lc = lowerFirst;
  const findings = (Array.isArray(rd.findings) ? rd.findings : []).filter(f => f && f.termiteActivity === 'ACTIVE');
  const places = findings.map(f => lc(f.activityLocation)).filter(Boolean);
  const type = (rd.treatmentType || '').trim();
  const wants = rd.treatmentRecommended === 'YES' || (type && rd.treatmentRecommended !== 'NO') || findings.length > 0;
  const choices = treatmentChoices(type);
  const kind = system || (choices.length ? '' : classifyTreatment(type));
  const out = [];
  if (findings.length) out.push(`Treat the live termites${places.length ? ` (${places.join('; ')})` : ''} to control the colony.`);
  if (wants) {
    if (kind === 'bait') out.push('Install bait stations around the building and check them regularly while termites are feeding, then keep monitoring.');
    else if (kind === 'barrier') out.push('Treat the soil around the building to form a continuous treated zone.');
    else if (kind === 'retic') out.push('Lay a reticulation system around the building and charge it with termiticide, so the treated zone can be topped up without trenching again.');
    else if (kind === 'physical') out.push('Install a physical termite barrier around the building.');
    else if (kind === 'system') out.push(`Top up the existing termite management system${rd.existingSystem ? ` (${rd.existingSystem})` : ''}.`);
    else if (kind && kind !== 'none') out.push('Install a termite management system.');
  }
  if (rd.borerActivity === 'ACTIVE') out.push('Treat the timbers with live borers.');
  if (rd.timberSoil === 'YES') out.push('Remove the timber touching the soil.');
  if (rd.weepHoles === 'BRIDGED') out.push('Clear the bridged weep holes.');
  if (rd.slabEdge === 'OBSTRUCTED') out.push('Expose the concealed slab edge so it can be inspected.');
  if (wants && kind && kind !== 'none') out.push('Fit a durable notice in the meter box showing what was used and when.');
  return out.join('\n');
}

// The owner's part: upkeep that keeps the treatment working. Repairs by a
// plumber or builder are in the exclusions, so they aren't repeated here.
function buildPlanOwner(rd) {
  rd = rd || {};
  const type = (rd.treatmentType || '').trim();
  const treated = rd.treatmentRecommended === 'YES' || (type && rd.treatmentRecommended !== 'NO') ||
    (rd.findings || []).some(f => f && f.termiteActivity === 'ACTIVE');
  const out = [];
  if (rd.siteDrainage === 'POOR' || rd.subfloorDrainage === 'POOR') {
    out.push(`Improve the drainage so water runs away from the building${rd.subfloorDrainage === 'POOR' ? ' and out of the subfloor' : ''}.`);
  }
  if (rd.subfloorVentilation === 'POOR') out.push('Improve the subfloor ventilation so it stays dry.');
  if (rd.timberSoil === 'YES') out.push(`Keep timber, firewood and stored goods off the soil and away from the walls${rd.timberSoilDetails ? ` (${rd.timberSoilDetails})` : ''}.`);
  if (rd.weepHoles === 'BRIDGED') out.push('Keep garden beds, mulch and paving below the weep holes.');
  if (rd.slabEdge === 'OBSTRUCTED' || rd.zone25mmVisible === 'NO' || rd.zone75mmVisible === 'NO') {
    out.push('Keep the slab edge clear and visible all the way around.');
  }
  if (treated) out.push('Leave the treated areas and any stations undisturbed, and tell us before any building or landscaping work near them.');
  return out.join('\n');
}

function buildPlanInspections(rd) {
  return planInspectionsText((rd && rd.inspectionFrequency) || '');
}

// The report's re-inspection interval as the quote's "Inspections after":
// "12 months" is "Every 12 months", but "3 months, then every 12 months"
// is "In 3 months, then every 12 months", and wording that already reads
// as a sentence ("Next inspection in 3 months", "Re-inspect 4 weeks after
// treatment") is kept, not given an "Every" it doesn't fit.
function planInspectionsText(f) {
  f = String(f || '').trim().replace(/\s*\((annual|yearly)\)/i, '');
  if (!f) return '';
  if (/^every\b/i.test(f)) return f;
  if (/^\d/.test(f)) return /\bthen\b/i.test(f) ? `In ${f}` : `Every ${f}`;
  return f.charAt(0).toUpperCase() + f.slice(1);
}
// An older version put "Every" before any wording ("Every Next inspection
// in 3 months"); a quote saved then prints without it.
function repairPlanInspections(v) {
  const f = String(v || '').trim().replace(/^every\s+(?=(next|re-?inspect|in|within|after)\b)/i, '');
  return f.charAt(0).toUpperCase() + f.slice(1);
}

function buildQuotePlan(rd, system) {
  return { we: buildPlanWe(rd, system), owner: buildPlanOwner(rd), time: '', service: '', inspections: buildPlanInspections(rd) };
}

function quoteScreenOpen() { return document.getElementById('quoteScreen').classList.contains('open'); }

// The report a quote was made from, or null. For the quote open on the
// quote screen it's the one picked there; otherwise (This job, or a stored
// quote being sent) it's the report the quote is saved against.
function quoteReport(q = quoteState) {
  if (!q) return null;
  const src = q === quoteState && quoteScreenOpen() ? currentQuoteSource() : null;
  if (src && src.key === q.reportKey) return src.key === (currentReportId || 'draft') ? reportData : src.reportData;
  return treatmentReportFor(q);
}

// One line for the folded row: what's set, and what's still to choose.
// What the plan still needs, as a short note, or '' once it's done.
// The treatment plan sets out how the work goes, so it waits for a line of
// work: an inspection on its own (follow-up or invasive) has no plan. Out of
// sight, it doesn't print or go on the client's page either.
const QUOTE_INSPECTION_KEYS = ['followup', 'invasive'];
function quotePlanShown(q) {
  return !!q && (q.items || []).some(it => !QUOTE_INSPECTION_KEYS.includes(it.key));
}

function quotePlanNote(q) {
  const p = q && q.plan;
  return !p ? 'Add a plan' : !p.time ? 'Set the time on site' : !p.service ? 'Set the service period' : '';
}

// A fold's status under its title: a short amber note saying what's still
// needed, or, once there's nothing to say, no line and a green tick.
function setFoldNote(fold, sub, note) {
  if (!fold || !sub) return;
  sub.textContent = note || '';
  sub.classList.toggle('warn', !!note);
  fold.classList.toggle('done', !note);
}

function quotePlanChipsHTML(field, options, value) {
  const custom = value && !options.includes(value);
  return options.map(o => `<button type="button" class="qp-chip${o === value ? ' on' : ''}" onclick="setQuotePlanChoice('${field}', ${escapeHtml(JSON.stringify(o))})">${escapeHtml(o)}</button>`).join('') +
    `<button type="button" class="qp-chip${custom ? ' on' : ''}" onclick="typeQuotePlanChoice('${field}')">${custom ? escapeHtml(value) : 'Type it'}</button>`;
}

function renderQuotePlan() {
  const q = quoteState;
  const body = document.getElementById('quotePlanBody');
  if (!q || !body) return;
  setFoldNote(document.getElementById('quotePlanFold'), document.getElementById('quotePlanSub'), quotePlanNote(q));
  const p = q.plan;
  if (!p) {
    body.innerHTML = `<div class="quote-hint" style="margin-top:0">Set out how the job will go: what you'll do, what the owner should do, how long it takes and the service period. It starts from the report.</div>
      <button class="quote-btn" style="margin-top:10px" onclick="addQuotePlan()">Add a plan from the report</button>`;
    return;
  }
  // The two lists of steps read as bullets, and the timing as a side line
  // from the day of the job to the inspections after it.
  body.innerHTML = `${p.why ? `
    <div class="fsub">Why this plan</div>
    <textarea class="quote-input quote-textarea" id="qPlanWhy" rows="2" aria-label="Why this plan suits the property" oninput="fitQuoteText(this); onQuotePlanInput()">${escapeHtml(p.why)}</textarea>` : ''}
    <div class="fsub">What we'll do<button type="button" class="link-btn fsub-action" onclick="editQuoteList('qPlanWe')">Edit</button></div>
    <textarea class="quote-input quote-textarea" id="qPlanWe" rows="3" data-qlist="No steps yet. Tap to add one." aria-label="What we'll do, one step per line" oninput="fitQuoteText(this); onQuotePlanInput()">${escapeHtml(p.we || '')}</textarea>
    <div class="fsub">What the owner does<button type="button" class="link-btn fsub-action" onclick="editQuoteList('qPlanOwner')">Edit</button></div>
    <textarea class="quote-input quote-textarea" id="qPlanOwner" rows="3" data-qlist="Nothing asked of the owner yet. Tap to add." aria-label="What we ask the owner to do, one per line" placeholder="e.g. Keep garden beds below the weep holes" oninput="fitQuoteText(this); onQuotePlanInput()">${escapeHtml(p.owner || '')}</textarea>
    <div class="fsub">Timing</div>
    <div class="q-line">
      <div class="quote-field"><span>Time on site</span><div class="qp-chips">${quotePlanChipsHTML('time', QUOTE_PLAN_TIMES, p.time)}</div></div>
      <div class="quote-field"><span>Service period</span><div class="qp-chips">${quotePlanChipsHTML('service', QUOTE_PLAN_SERVICE, p.service)}</div>
        ${p.service && p.service !== 'None' ? '<div class="quote-hint">The quote says it only holds while the recommended inspections are kept up and the owner does their part.</div>' : ''}</div>
      <label class="quote-field"><span>Re-inspections</span>
        <input class="quote-input" id="qPlanInspections" placeholder="e.g. Every 12 months" value="${escapeHtml(p.inspections || '')}" oninput="onQuotePlanInput()">
      </label>
    </div>
    <button class="quote-text-btn" onclick="rebuildQuotePlan()">Start the plan again from the report</button>`;
  syncQuoteLists();
  body.querySelectorAll('.quote-textarea').forEach(fitQuoteText);
}

// A one-per-line box reads as a bulleted list until it's tapped, then
// opens as the box to type in, and goes back to a list when left.
function syncQuoteLists() {
  document.querySelectorAll('#quoteEditor textarea[data-qlist]').forEach(ta => {
    if (document.activeElement === ta) return;
    let list = ta.previousElementSibling;
    if (!list || !list.classList.contains('qlist')) {
      list = document.createElement('div');
      list.className = 'qlist';
      list.setAttribute('role', 'button');
      list.tabIndex = 0;
      list.setAttribute('aria-label', 'Edit: ' + (ta.getAttribute('aria-label') || 'list'));
      list.addEventListener('click', () => editQuoteList(ta.id));
      list.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); editQuoteList(ta.id); } });
      ta.before(list);
      ta.addEventListener('blur', () => setTimeout(syncQuoteLists, 0));
    }
    const lines = ta.value.split('\n').map(l => l.trim()).filter(Boolean);
    list.innerHTML = lines.length ? `<ul>${lines.map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul>` : `<span class="qlist-empty">${escapeHtml(ta.dataset.qlist)}</span>`;
    list.hidden = false;
    ta.hidden = true;
  });
}
function editQuoteList(id) {
  const ta = document.getElementById(id);
  if (!ta) return;
  if (ta.previousElementSibling && ta.previousElementSibling.classList.contains('qlist')) ta.previousElementSibling.hidden = true;
  ta.hidden = false;
  fitQuoteText(ta);
  ta.focus();
}

function addQuotePlan() {
  if (!quoteState) return;
  const c = quoteState.systemChoice;
  quoteState.plan = buildQuotePlan(quoteReport(), c && c.picked);
  renderQuotePlan();
  scheduleQuoteSave();
}

async function rebuildQuotePlan() {
  const q = quoteState;
  if (!q || !q.plan) return;
  if (!(await askFirst({ title: 'Replace the plan\'s steps?', text: 'Fresh ones are written from the report. Your edits to them are lost.', yes: 'Replace the steps' })) || quoteState !== q || !q.plan) return;
  const c = q.systemChoice;
  const fresh = buildQuotePlan(quoteReport(), c && c.picked);
  q.plan.we = fresh.we;
  q.plan.owner = fresh.owner;
  q.plan.inspections = fresh.inspections;
  renderQuotePlan();
  scheduleQuoteSave();
}

function onQuotePlanInput() {
  const p = quoteState && quoteState.plan;
  if (!p) return;
  const why = document.getElementById('qPlanWhy');
  if (why) p.why = why.value;
  p.we = document.getElementById('qPlanWe').value;
  p.owner = document.getElementById('qPlanOwner').value;
  p.inspections = document.getElementById('qPlanInspections').value;
  setFoldNote(document.getElementById('quotePlanFold'), document.getElementById('quotePlanSub'), quotePlanNote(quoteState));
  scheduleQuoteSave();
}

function setQuotePlanChoice(field, value) {
  const p = quoteState && quoteState.plan;
  if (!p) return;
  p[field] = p[field] === value ? '' : value;
  renderQuotePlan();
  scheduleQuoteSave();
}

async function typeQuotePlanChoice(field) {
  const p = quoteState && quoteState.plan;
  if (!p) return;
  const typed = await askFirst({ title: field === 'time' ? 'How long will the job take on site?' : 'How long is the service period?',
    input: { value: p[field] || '', placeholder: field === 'time' ? 'e.g. 3 hours' : 'e.g. 12 months' }, yes: 'Save' });
  if (typeof typed !== 'string' || !quoteState || quoteState.plan !== p) return;
  p[field] = typed;
  renderQuotePlan();
  scheduleQuoteSave();
}

function newSystemChoice(rd) {
  const choices = treatmentChoices((rd && rd.treatmentType) || '');
  return choices.length ? { options: choices, picked: null } : null;
}

function newQuoteNumber() {
  const d = new Date();
  const ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  return `Q-${ymd}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

function createQuoteFromSource(src) {
  const rd = src.reportData || {};
  const spoken = spokenQuoteItems(rd);
  const sq = spokenQuote(rd);
  return {
    reportKey: src.key,
    number: newQuoteNumber(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    client: src.client,
    clientPhone: rd.jobClientPhone || '',
    clientEmail: rd.jobClientEmail || '',
    clientSeen: jobClientDetails(src),
    address: src.address,
    // The report's address when the quote was made (see quoteForReport).
    sourceAddress: src.address || '',
    inspector: src.inspector,
    inspectionDate: rd.jobInspectionDate || (rd.agreement && rd.agreement.inspectionDate) || src.date || null,
    validDays: 30,
    gst: defaultQuoteGst(),
    problem: buildQuoteProblem(rd),
    items: spoken.length ? spoken : buildQuoteItemsFromReport(rd),
    systemChoice: spoken.length ? null : newSystemChoice(rd),
    exclusions: withSpokenExclusions(buildQuoteExclusions(rd), rd).join('\n'),
    plan: withSpokenPlan(buildQuotePlan(rd), rd),
    paymentTerms: (sq && (sq.paymentTerms || '').trim()) || defaultPaymentTerms(),
    notes: withSpokenNotes(QUOTE_DEFAULT_NOTES, rd),
    spokenAt: sq ? sq.at || 0 : 0,
  };
}

// ── THE CLIENT'S DETAILS, TYPED ONCE ────────────────────────────────────────
// The client's name, phone and email can go in on the job, the agreement or
// the quote, and whichever has them fills the others. A change on one carries
// to the other while the two still match, so a name typed differently on
// purpose (the owner on the quote, the buyer on the job) stays as typed. A
// quote that has gone to the client, or been answered, keeps what they got.
const QUOTE_CLIENT_FIELDS = [['client', 'jobClient'], ['clientPhone', 'jobClientPhone'], ['clientEmail', 'jobClientEmail']];

function jobClientDetails(src) {
  const rd = src.reportData || {};
  return { client: (src.client || '').trim(), clientPhone: (rd.jobClientPhone || '').trim(), clientEmail: (rd.jobClientEmail || '').trim() };
}

// On opening a saved quote: blanks, or values still as the job last had
// them, take the job's. True when anything changed.
function fillQuoteClientFromJob(q, src) {
  if (q.sentAt || q.answer) return false;
  const job = jobClientDetails(src);
  const seen = q.clientSeen || {};
  let changed = false;
  QUOTE_CLIENT_FIELDS.forEach(([f]) => {
    const v = (q[f] || '').trim(), j = job[f];
    if (j && v !== j && (!v || v === seen[f])) { q[f] = j; changed = true; }
  });
  q.clientSeen = job;
  return changed;
}

// Typing on the quote of the job that's open: the job's field follows when
// it was empty or matched what the quote had.
function carryQuoteClientToJob(q, before) {
  if (q.reportKey !== (currentReportId || 'draft')) return;
  let name = false, info = false;
  QUOTE_CLIENT_FIELDS.forEach(([f, id]) => {
    const el = document.getElementById(id);
    const nv = q[f] || '';
    if (!el || nv === (before[f] || '')) return;
    if (el.value.trim() && el.value.trim() !== (before[f] || '').trim()) return;
    el.value = nv;
    if (f === 'client') name = true; else info = true;
    q.clientSeen = Object.assign({}, q.clientSeen, { [f]: nv.trim() });
  });
  if (info && typeof saveJobInfo === 'function') saveJobInfo();
  if (name && typeof updateJob === 'function') updateJob();
}

// ── NAVIGATION ──────────────────────────────────────────────────────────────
function openQuote(from, preferKey) {
  // This job's copy of the quote (useJobQuote) is let go: the screen reads
  // the stored one.
  if (!quoteScreenOpen()) quoteState = null;
  quoteReturnTo = from || 'app';
  document.getElementById('app').style.display = 'none';
  document.getElementById('quoteScreen').classList.add('open');
  installQuoteLockGuard();
  quoteSources = collectQuoteSources();
  renderQuoteSourceOptions(preferKey);
  onQuoteSourceChange();
  document.querySelector('#quoteScreen .quote-scroll').scrollTop = 0;
  track('screen_viewed', { screen: 'quote' });
}

function openQuoteFromReport() {
  const sidebar = document.getElementById('sidebarPanel');
  if (sidebar && sidebar.classList.contains('open')) toggleDrawer();
  openQuote('app', currentReportId || 'draft');
}

function closeQuote() {
  if (!quoteScreenOpen()) return;
  cancelSheetVoice('quote');
  clearTimeout(quoteSaveTimer);
  if (quoteState) { persistQuote(); storeQuoteOnReport(quoteState, true); }
  // Forget it, so the next open reads the stored copy, which a report send
  // may have marked as sent since.
  quoteState = null;
  document.getElementById('quoteScreen').classList.remove('open');
  if (quoteReturnTo === 'app') {
    document.getElementById('app').style.display = 'flex';
    resumeSendReview();
  } else openApp('inspect');
}

// ── RENDERING ───────────────────────────────────────────────────────────────
function renderQuoteSourceOptions(preferKey) {
  const sel = document.getElementById('quoteSource');
  const hasSources = quoteSources.length > 0;
  document.getElementById('quoteEmpty').style.display = hasSources ? 'none' : 'flex';
  const forJob = !!preferKey && quoteSources.some(s => s.key === preferKey);
  sel.closest('.quote-source-pick').style.display = hasSources && !forJob ? '' : 'none';
  sel.innerHTML = quoteSources.map(s => {
    const date = s.date ? new Date(s.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '';
    const text = [s.label, s.address || 'Untitled property', date].filter(Boolean).join(' · ');
    return `<option value="${escapeHtml(s.key)}">${escapeHtml(text)}</option>`;
  }).join('');
  if (preferKey && quoteSources.some(s => s.key === preferKey)) sel.value = preferKey;
}

function currentQuoteSource() {
  const key = document.getElementById('quoteSource').value;
  return quoteSources.find(s => s.key === key) || null;
}

function onQuoteSourceChange() {
  cancelSheetVoice('quote');
  if (quoteState) { clearTimeout(quoteSaveTimer); persistQuote(); }
  const src = currentQuoteSource();
  const editor = document.getElementById('quoteEditor');
  const bar = document.getElementById('quoteBar');
  quoteOpenItems.clear();
  if (!src) { quoteState = null; editor.style.display = 'none'; bar.style.display = 'none'; return; }
  const saved = quoteForReport(src.key, src.address);
  quoteState = saved || createQuoteFromSource(src);
  const heard = saved && applySpokenQuote(quoteState, src.key === (currentReportId || 'draft') ? reportData : src.reportData);
  const filled = saved && fillQuoteClientFromJob(quoteState, src);
  if (!saved || heard || filled) persistQuote();
  else setQuoteSaveState('Saved');
  if (heard) showToast('Quote updated from your notes', 'success');
  renderQuoteEditor();
  renderQuoteLock();
  editor.style.display = 'flex';
  bar.style.display = '';
  ['quoteDetailsFold', 'quoteTermsFold'].forEach(id => { document.getElementById(id).open = false; });
  // The quote opens on the work: the system to pick, the lines and their
  // prices. Once it has gone to the client, the work folds to its total.
  document.getElementById('quoteWorkFold').open = !quoteHasGone(quoteState);
  editor.querySelectorAll('.quote-item-desc, .quote-item-detail, .quote-textarea').forEach(fitQuoteText);
}

function renderQuoteEditor() {
  const q = quoteState;
  document.getElementById('qClient').value = q.client || '';
  document.getElementById('qClientPhone').value = q.clientPhone || '';
  document.getElementById('qClientEmail').value = q.clientEmail || '';
  document.getElementById('qAddress').value = q.address || '';
  document.getElementById('qNumber').value = q.number || '';
  document.getElementById('qValidDays').value = q.validDays || '';
  document.getElementById('qProblem').value = quoteProblem(q);
  document.getElementById('qGst').checked = q.gst !== false;
  document.getElementById('qExclusions').value = q.exclusions || '';
  document.getElementById('qPaymentTerms').value = q.paymentTerms || '';
  document.getElementById('qNotes').value = q.notes || '';
  renderQuoteItems();
  renderQuoteCompanyGaps();
  renderQuoteFolds();
  renderQuotePlan();
  quoteStageDrawn = '';
  renderQuoteProgress();
  syncQuoteLists();
  ['qProblem', 'qPaymentTerms', 'qExclusions', 'qNotes'].forEach(id => fitQuoteText(document.getElementById(id)));
}

// Where the quote is up to, for the pill in the header.
function quoteStatusPill(q) {
  const a = quoteAnswerState(q);
  if (a && a.stale) return ['Needs a new answer', 'warn'];
  if (a && a.status === 'accepted') return q.treatment ? ['Treated', 'good'] : ['Accepted', 'good'];
  if (a) return ['Declined', 'bad'];
  if (!q.sentAt) return ['Draft', 'draft'];
  if (q.sentHash !== quoteContentHash(q)) return ['Changed since sent', 'warn'];
  return [`Sent ${new Date(q.sentAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`, 'wait'];
}

// The header: who the quote is for, then where. Tapping the name opens the
// client details to change them.
function renderQuoteHead() {
  const q = quoteState;
  const el = document.getElementById('quoteHead');
  if (!q || !el) return;
  const [pill, tone] = quoteStatusPill(q);
  const name = (q.client || '').trim();
  const problem = quoteProblem(q).trim();
  el.innerHTML = `<div class="quote-hero-top">
      <span class="quote-hero-kicker">Quote${q.number ? ' · ' + escapeHtml(q.number) : ''}</span>
      <span class="quote-hero-pill ${tone}">${escapeHtml(pill)}</span>
    </div>
    <button type="button" class="quote-hero-name${name ? '' : ' empty'}" onclick="openQuoteDetails()">${name ? escapeHtml(name) : 'Add the client\'s name'}</button>
    <div class="quote-hero-addr"><svg class="icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg><span>${escapeHtml(q.address || 'No address yet')}</span></div>
    ${problem ? `<button type="button" class="quote-hero-problem" onclick="openQuoteDetails('qProblem')">
      <span class="quote-hero-problem-label">Purpose of treatment</span>
      <span class="quote-hero-problem-text">${escapeHtml(problem)}</span>
    </button>` : ''}`;
}

function openQuoteDetails(focusId) {
  const fold = document.getElementById('quoteDetailsFold');
  fold.open = true;
  const target = focusId ? document.getElementById(focusId) : fold;
  fitQuoteText(document.getElementById('qProblem'));
  target.scrollIntoView({ behavior: 'smooth', block: focusId ? 'center' : 'start' });
}

// What each part of Write the quote still needs, as a short note, or ''
// once it's done.
function quoteFoldNotes(q) {
  const n = q.items.length, starting = q.items.filter(isStartingPrice).length;
  return {
    details: !(q.client || '').trim() ? "Add the client's name" : !(q.clientEmail || '').trim() ? "Add the client's email" : '',
    work: !n ? 'Add a line' : starting ? `Check ${starting === 1 ? 'one price' : starting + ' prices'}` : '',
    plan: quotePlanShown(q) ? quotePlanNote(q) : '',
    terms: !(q.paymentTerms || '').trim() ? 'Add payment terms' : '',
  };
}

// The folded sections: a tick when done, or what's still needed.
function renderQuoteFolds() {
  const q = quoteState;
  if (!q) return;
  const notes = quoteFoldNotes(q);
  setFoldNote(document.getElementById('quoteDetailsFold'), document.getElementById('quoteDetailsSub'), notes.details);
  setFoldNote(document.getElementById('quoteTermsFold'), document.getElementById('quoteTermsSub'), notes.terms);
}

// What's missing from the business details, which every quote's header shows.
function renderQuoteCompanyGaps() {
  const gaps = companyDetailGaps();
  const el = document.getElementById('quoteCompanyGaps');
  el.style.display = gaps.length ? '' : 'none';
  el.innerHTML = gaps.length
    ? `<div>Your quote won't show your ${escapeHtml(joinWithAnd(gaps))}. Clients and insurers look for ${gaps.length === 1 ? 'it' : 'these'}.</div>` +
      (canEditBusiness() ? `<button class="quote-link-btn" onclick="openBusinessForm(renderQuoteCompanyGaps)">Add ${gaps.length === 1 ? 'it' : 'them'}</button>` : '')
    : '';
}

// When the recommendation offers more than one system, the inspector picks
// which one this quote is for. Shown above the line items until picked.
// The quote's system choice. A recommendation that named one system made
// no choice; its lines say which system it is, so it can be changed too.
function quoteSystemChoice(q) {
  if (!q) return null;
  if (q.systemChoice) return q.systemChoice;
  const lines = q.items.filter(it => /^Recommendation: /.test(it.source || '') && QUOTE_SYSTEM_LINE_KIND[it.key]);
  if (!lines.length) return null;
  const kind = QUOTE_SYSTEM_LINE_KIND[lines[0].key];
  q.systemChoice = { options: [kind], picked: kind, added: lines.map(it => ({ id: it.id })) };
  return q.systemChoice;
}

function renderQuoteSystemChoice() {
  const el = document.getElementById('quoteSystemChoice');
  if (!el) return;
  const c = quoteSystemChoice(quoteState);
  if (!c || !Array.isArray(c.options) || !c.options.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = '';
  // Picked: one line saying which, to change it.
  if (c.picked) {
    el.classList.add('picked');
    // Changing needs the report to build the new lines from.
    const canChange = !isQuoteLocked() && !!currentQuoteSource();
    el.innerHTML = `<div class="quote-system-picked"><span>System: <strong>${escapeHtml(quoteSystemLabel(c.picked))}</strong></span>
      ${canChange ? '<button class="link-btn" onclick="changeQuoteSystem()">Change</button>' : ''}</div>`;
    return;
  }
  el.classList.remove('picked');
  const src = currentQuoteSource();
  const rec = src && src.reportData ? (src.reportData.treatmentType || '') : '';
  const others = Object.keys(QUOTE_SYSTEM_LABELS).filter(k => !c.options.includes(k));
  const btn = (k, cls) => `<button class="${cls}" onclick="pickQuoteSystem('${k}')">${escapeHtml(quoteSystemLabel(k))}</button>`;
  el.innerHTML = `<div class="quote-system-q">Which system are you quoting?</div>${rec ? `
    <div class="quote-system-rec">The report says: ${escapeHtml(rec)}</div>` : ''}
    <div class="quote-answer-btns">${c.options.map(k => btn(k, 'quote-btn')).join('')}</div>
    <div class="quote-system-more-label">Or something else</div>
    <div class="quote-system-more">${others.map(k => btn(k, 'quote-link-btn')).join('')}</div>`;
}

// Back to the question: the lines the last pick added go, edited or not
// (a typed price is remembered for next time anyway).
function changeQuoteSystem() {
  const q = quoteState, c = q && q.systemChoice;
  if (!c || !c.picked || !currentQuoteSource() || isQuoteLocked()) return;
  const added = c.added || [];
  q.items = q.items.filter(it => !added.some(a => a.id === it.id));
  c.was = c.picked; c.picked = null; c.added = [];
  renderQuoteItems();
  scheduleQuoteSave();
}

function pickQuoteSystem(kind) {
  const src = currentQuoteSource();
  const q = quoteState;
  if (!src || !q || !q.systemChoice) return;
  const rd = src.reportData || {};
  const fresh = buildQuoteItemsFromReport(rd, kind).filter(it => /^Recommendation: /.test(it.source) && it.key !== 'followup' && it.key !== 'invasive');
  // After the direct-treatment lines, before conducive conditions.
  let at = 0;
  while (at < q.items.length && q.items[at].key === 'direct') at++;
  q.items.splice(at, 0, ...fresh);
  const was = q.systemChoice.was || undefined;
  q.systemChoice.picked = kind;
  q.systemChoice.added = fresh.map(it => ({ id: it.id }));
  // The plan's steps name the system, so they follow the pick unless edited.
  if (q.plan && q.plan.we === buildPlanWe(rd, was)) {
    q.plan.we = buildPlanWe(rd, kind);
    renderQuotePlan();
  }
  renderQuoteItems();
  scheduleQuoteSave();
}

function markQuotePriceSet(id) {
  const it = quoteState && quoteState.items.find(i => i.id === id);
  if (!it || it.priceSet) return;
  it.priceSet = true;
  const tag = document.querySelector(`.qi[data-id="${id}"] .qi-tag`);
  if (tag) tag.remove();
  renderQuoteStartHint();
}

// Lines show as short rows: what, and the price. A tap opens the
// line to change it. Open lines stay open while the quote is redrawn.
const quoteOpenItems = new Set();

function quoteItemHTML(it) {
  const open = quoteOpenItems.has(it.id);
  const id = it.id;
  return `<div class="qi${open ? ' open' : ''}" data-id="${id}">
    <button type="button" class="qi-row" onclick="toggleQuoteItem('${id}')" aria-expanded="${open}">
      <span class="qi-main">
        <span class="qi-desc">${escapeHtml(it.desc || 'New line')}</span>
      </span>
      <span class="qi-end">
        <span class="qi-price" id="qiTotal_${id}">${formatAUD(lineTotal(it))}</span>
        ${isStartingPrice(it) ? '<span class="qi-tag">Starting price</span>' : ''}
      </span>
      <svg class="icon qi-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    <div class="qi-edit">
      <label class="quote-field"><span>Description</span><textarea class="quote-input quote-item-desc" rows="1" placeholder="e.g. Chemical soil treatment"
        oninput="fitQuoteText(this); updateQuoteItem('${id}','desc',this.value)">${escapeHtml(it.desc)}</textarea></label>
      <label class="quote-field"><span>Details (optional)</span><textarea class="quote-input quote-item-detail" rows="1" placeholder="e.g. Front porch post, left side"
        oninput="fitQuoteText(this); updateQuoteItem('${id}','detail',this.value)">${escapeHtml(it.detail)}</textarea></label>
      <div class="quote-item-nums">
        <label class="quote-field"><span>Qty</span><input class="quote-input" type="number" min="0" step="any" inputmode="decimal" value="${escapeHtml(String(it.qty))}"
          oninput="updateQuoteItem('${id}','qty',this.value)"></label>
        <label class="quote-field"><span>Unit</span><input class="quote-input" value="${escapeHtml(it.unit)}"
          oninput="updateQuoteItem('${id}','unit',this.value)"></label>
        <label class="quote-field"><span>Unit price, ex GST</span><input class="quote-input" type="number" min="0" step="any" inputmode="decimal" value="${escapeHtml(String(it.price))}"
          oninput="markQuotePriceSet('${id}'); updateQuoteItem('${id}','price',this.value)" onchange="rememberQuotePrice('${it.key}', parseFloat(this.value))"></label>
      </div>
      ${it.source ? `<div class="quote-item-source">${/^SAYON plan/.test(it.source) ? escapeHtml(it.source.replace(/^SAYON plan(: [^(]*)?/, "From the SAYON recommendation").trim()) : 'From the report: ' + escapeHtml(it.source)}</div>` : ''}
      <div class="qi-edit-btns">
        <button type="button" class="quote-text-btn danger" onclick="removeQuoteItem('${id}')">Remove line</button>
        <button type="button" class="quote-link-btn qi-done" onclick="toggleQuoteItem('${id}')">Done</button>
      </div>
    </div>
  </div>`;
}

function toggleQuoteItem(id) {
  const row = document.querySelector(`.qi[data-id="${id}"]`);
  if (!row) return;
  const open = !quoteOpenItems.has(id);
  if (open) quoteOpenItems.add(id); else quoteOpenItems.delete(id);
  row.classList.toggle('open', open);
  row.querySelector('.qi-row').setAttribute('aria-expanded', open);
  if (open) row.querySelectorAll('.quote-item-desc, .quote-item-detail').forEach(fitQuoteText);
}

function renderQuoteItems() {
  renderQuoteSystemChoice();
  const wrap = document.getElementById('quoteItems');
  if (!quoteState.items.length) {
    wrap.innerHTML = '<div class="quote-items-empty">No lines yet. The report has no findings or recommendations that call for work. Add a line to quote it yourself.</div>';
  } else {
    wrap.innerHTML = quoteState.items.map(quoteItemHTML).join('');
    wrap.querySelectorAll('.qi.open .quote-item-desc, .qi.open .quote-item-detail').forEach(fitQuoteText);
  }
  renderQuoteStartHint();
  renderQuoteTotals();
  // SAYON's second opinion notes when the lines it compared have changed.
  if (quoteState.aiPlan && quoteState.aiPlan.quoteHash && typeof renderTreatmentPlanCard === 'function') renderTreatmentPlanCard();
}

// The folded work row: a tick, or a line or prices still to check, and the total.
function renderQuoteWorkSummary() {
  const q = quoteState;
  const sub = document.getElementById('quoteItemCount');
  if (!q || !sub) return;
  const n = q.items.length;
  setFoldNote(document.getElementById('quoteWorkFold'), sub, quoteFoldNotes(q).work);
  document.getElementById('quoteWorkTotal').textContent = n ? formatAUD(quoteTotals(q).total) : '';
  const planFold = document.getElementById('quotePlanFold');
  if (planFold) planFold.hidden = !quotePlanShown(q);
}

// Explains the amber tag, only while a line still has one.
function renderQuoteStartHint() {
  const el = document.getElementById('quoteStartHint');
  if (!el || !quoteState) return;
  renderQuoteWorkSummary();
  const any = quoteState.items.some(isStartingPrice);
  el.style.display = '';
  el.innerHTML = (any ? '<b>Starting price</b> is SAYON\'s suggested rate. Tap a line to set your own, or <button type="button" class="quote-hint-link" onclick="openPriceBook()">set all your prices</button>, and new quotes start at your price. ' : '') +
    'You can also say the quote in your notes on the report: the work, prices, what isn\'t included and how they pay.';
}

// Grows a line's description box to fit its text, so long names wrap
// instead of being cut off on a phone.
function fitQuoteText(el) {
  // A hidden box measures 0 high, so it's sized once it's shown.
  if (!el || !el.offsetParent) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 2 + 'px';
}

// Money is worked out in whole cents, so the lines shown add up to the
// subtotal shown. (The tiny nudge stops 1.005 rounding down to 1.00.)
function toCents(v) { return Math.round(v * 100 + Math.sign(v) * 1e-6); }

// A stored signature only ever comes from the signing pad, but a synced or
// imported copy could hold anything, so only a picture is shown.
function isSignatureImage(v) { return typeof v === 'string' && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v); }

function lineTotal(it) {
  const qty = parseFloat(it.qty), price = parseFloat(it.price);
  return toCents((isFinite(qty) ? qty : 0) * (isFinite(price) ? price : 0)) / 100;
}

function quoteTotals(q) {
  const subCents = q.items.reduce((sum, it) => sum + toCents(lineTotal(it)), 0);
  const gstCents = q.gst !== false ? Math.round(subCents / 10) : 0;
  return { subtotal: subCents / 100, gst: gstCents / 100, total: (subCents + gstCents) / 100 };
}

function renderQuoteTotals() {
  const t = quoteTotals(quoteState);
  document.getElementById('qSubtotalLabel').textContent = quoteState.gst !== false ? 'Subtotal (ex GST)' : 'Subtotal';
  document.getElementById('qSubtotal').textContent = formatAUD(t.subtotal);
  document.getElementById('qGstAmt').textContent = formatAUD(t.gst);
  document.getElementById('qTotal').textContent = formatAUD(t.total);
  document.getElementById('quoteBarAmount').textContent = formatAUD(t.total);
  document.getElementById('quoteBarLabel').textContent = quoteState.gst !== false ? 'Total inc GST' : 'Total';
  renderQuoteWorkSummary();
}

// ── EDITING ─────────────────────────────────────────────────────────────────
function onQuoteFieldInput() {
  const q = quoteState;
  if (!q) return;
  const before = { client: q.client, clientPhone: q.clientPhone, clientEmail: q.clientEmail };
  q.client = document.getElementById('qClient').value;
  q.clientPhone = document.getElementById('qClientPhone').value;
  q.clientEmail = document.getElementById('qClientEmail').value;
  carryQuoteClientToJob(q, before);
  q.address = document.getElementById('qAddress').value;
  q.number = document.getElementById('qNumber').value;
  q.validDays = parseInt(document.getElementById('qValidDays').value, 10) || '';
  const problem = document.getElementById('qProblem').value;
  if (problem !== quoteProblem(q)) q.problem = problem;
  if (q.gst !== document.getElementById('qGst').checked) {
    q.gst = document.getElementById('qGst').checked;
    if (!isSampleJob(q.reportKey)) rememberQuoteGst(q.gst);
  }
  q.exclusions = document.getElementById('qExclusions').value;
  q.paymentTerms = document.getElementById('qPaymentTerms').value;
  q.notes = document.getElementById('qNotes').value;
  renderQuoteTotals();
  renderQuoteFolds();
  renderQuoteHead();
  scheduleQuoteSave();
}

function updateQuoteItem(id, field, value) {
  const it = quoteState && quoteState.items.find(i => i.id === id);
  if (!it) return;
  it[field] = value;
  const row = document.querySelector(`.qi[data-id="${id}"]`);
  if (row) {
    row.querySelector('.qi-desc').textContent = it.desc || 'New line';
  }
  if (field === 'qty' || field === 'price') {
    const cell = document.getElementById('qiTotal_' + id);
    if (cell) cell.textContent = formatAUD(lineTotal(it));
    renderQuoteTotals();
  }
  scheduleQuoteSave();
}

function addQuoteItem() {
  if (!quoteState) return;
  const it = newQuoteItem('custom');
  quoteState.items.push(it);
  quoteOpenItems.add(it.id);
  renderQuoteItems();
  scheduleQuoteSave();
  const desc = document.querySelector(`.qi[data-id="${it.id}"] .quote-item-desc`);
  if (desc) desc.focus();
}

function removeQuoteItem(id) {
  if (!quoteState) return;
  quoteState.items = quoteState.items.filter(i => i.id !== id);
  quoteOpenItems.delete(id);
  renderQuoteItems();
  scheduleQuoteSave();
}

async function rebuildQuoteFromReport() {
  const src = currentQuoteSource();
  if (!src || !quoteState) return;
  const q = quoteState;
  if (q.items.length && (!(await askFirst({ title: 'Replace the quote\'s lines?', text: 'The line items, exclusions and the problem are written fresh from the report. Your edits to them are lost.', yes: 'Replace them' })) || quoteState !== q)) return;
  const spoken = spokenQuoteItems(src.reportData);
  quoteState.items = spoken.length ? spoken : buildQuoteItemsFromReport(src.reportData);
  quoteState.systemChoice = spoken.length ? null : newSystemChoice(src.reportData);
  quoteState.exclusions = withSpokenExclusions(buildQuoteExclusions(src.reportData), src.reportData).join('\n');
  quoteState.problem = buildQuoteProblem(src.reportData);
  document.getElementById('qExclusions').value = quoteState.exclusions;
  document.getElementById('qProblem').value = quoteState.problem;
  syncQuoteLists();
  quoteOpenItems.clear();
  renderQuoteItems();
  renderQuoteFolds();
  scheduleQuoteSave();
  showToast('Line items rebuilt from the report', 'success');
}

// ── CLIENT'S ANSWER ─────────────────────────────────────────────────────────
// The inspector records whether the client accepted or declined the quote,
// how, and when. q.answer = { status: 'accepted'|'declined', by, date,
// method, signature?, note, at, hash }. hash is the quote's content when the
// client answered, so a later change to the quote shows the answer is for an
// older version. The answer is a step of the job, so it's recorded on This
// job (js/app/job.js): from its Next step card while the job is waiting on
// it, and under its Client's answer step.
const QUOTE_ANSWER_METHODS = {
  signed: 'signed on the phone',
  link: 'signed on their phone from the link',
  email: 'by email',
  phone: 'by phone',
  paper: 'on paper',
};

function quoteAnswerState(q) {
  const a = q && q.answer;
  if (!a) return null;
  return Object.assign({}, a, { stale: !!a.hash && a.hash !== quoteContentHash(q) });
}

function formatAnswerDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d) ? iso : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

// The quote has reached the client as it stands: sent and not changed
// since, or answered.
function quoteHasGone(q) {
  const a = quoteAnswerState(q);
  return !!q && (!!(a && !a.stale) || (!!q.sentAt && q.sentHash === quoteContentHash(q)));
}

// Accepted and Declined, with Check now and Share the link while the
// quote's link is out. lead: the job is waiting on the answer and the
// client has no link to answer from, so Accepted is the filled button.
function quoteAnswerButtons(q, lead) {
  const link = !q.answer && quoteLinkCurrent(q) && q.sentHash === quoteContentHash(q);
  return `<div class="quote-answer-btns">
      <button type="button" class="quote-btn${lead && !link ? ' primary' : ''}" onclick="openQuoteAnswer('accepted')">Accepted</button>
      <button type="button" class="quote-btn" onclick="openQuoteAnswer('declined')">Declined</button>
    </div>${link ? `<div class="qp-links">
      <button type="button" class="quote-text-btn" onclick="checkQuoteLink(quoteState, true)">Check now</button>
      <button type="button" class="quote-text-btn" onclick="shareQuoteLink(quoteState)">Share the link</button>
    </div>` : ''}`;
}

// What This job's Client's answer step opens to: the way to record it, or
// what was recorded. On a finalised job it's the record, and changing it
// starts with Amend.
function quoteAnswerPanel(q) {
  const esc = escapeHtml;
  const a = quoteAnswerState(q);
  if (!a) {
    const sentNow = !!q.sentAt && q.sentHash === quoteContentHash(q);
    const first = (q.client || '').trim().split(/\s+/)[0] || 'the client';
    const text = sentNow && quoteLinkCurrent(q) ? `The quote went with a link. When ${esc(first)} taps Accept or Decline on their phone, it shows here. Heard back another way? Record it here.`
      : sentNow ? `Waiting on ${esc(first)}. Record their answer when it comes.`
      : q.sentAt ? 'The quote changed after it was sent. Send the new version, or record their answer if they\'ve already given it.'
      : 'Already answered on the spot or by phone? Record it here.';
    return `<p class="job-fold-text">${text}</p>${quoteAnswerButtons(q, sentNow)}`;
  }
  const how = a.status === 'accepted' ? (QUOTE_ANSWER_METHODS[a.method] || '') : a.method === 'link' ? 'from the link on their phone' : '';
  return `<p class="job-fold-text ${a.stale ? 'warn' : a.status === 'accepted' ? 'good' : 'bad'}"><strong>${a.status === 'accepted' ? 'Accepted' : 'Declined'}</strong> by ${esc(a.by)} on ${esc(formatAnswerDate(a.date))}${how ? `, ${esc(how)}` : ''}</p>
    ${a.note ? `<div class="quote-answer-note">${esc(a.note)}</div>` : ''}
    ${isSignatureImage(a.signature) ? `<img class="quote-answer-sig" src="${a.signature}" alt="Client signature">` : ''}
    ${signedQuoteLine(q, a)}
    ${a.stale ? '<div class="quote-answer-warn">The quote has changed since then. Send the new version and record the client\'s answer again.</div>' : ''}
    ${isReportLocked() ? '' : `<div class="qp-links"><button type="button" class="quote-text-btn" onclick="clearQuoteAnswer()">${a.stale ? 'Record a new answer' : 'Change answer'}</button></div>`}`;
}

// ── THE CLIENT'S SIGNED COPY ────────────────────────────────────────────────
// A client who signs to accept (on this phone, or from the link) gets the
// quote back with their acceptance on it, to keep. Until it's emailed or
// marked as given it is the job's next step, ahead of the treatment
// (dashboardJob in js/app/dashboard.js); once the treatment is recorded
// it's no longer asked for. The marks sit on the answer, so a changed
// answer starts again.
function signedQuoteWanted(q) {
  const a = quoteAnswerState(q);
  return !!a && !a.stale && a.status === 'accepted' && (a.method === 'link' || isSignatureImage(a.signature));
}
function signedQuoteOwed(q) {
  return signedQuoteWanted(q) && !q.answer.copySentAt && !q.answer.copyGivenAt;
}
// Under the answer: where the signed copy went, or the way to send it.
function signedQuoteLine(q, a) {
  if (!signedQuoteWanted(q)) return '';
  const first = (q.client || '').trim().split(/\s+/)[0];
  const went = a.copySentAt ? `Signed copy emailed ${formatIssueDate(a.copySentAt)}` : a.copyGivenAt ? `${first || 'The client'} has a signed copy` : '';
  return `<div class="quote-answer-copy">${went ? `<span>${escapeHtml(went)}</span>` : ''}<button type="button" class="quote-text-btn" onclick="emailSignedQuote()">${a.copySentAt ? 'Email it again' : `Email ${escapeHtml(first || 'the client')} the signed quote`}</button></div>`;
}
// The Next step card's buttons while the copy is owed.
function signedQuoteNext(q) {
  const first = (q.client || '').trim().split(/\s+/)[0];
  return `<button type="button" class="dash-detail-primary job-signed-email" onclick="emailSignedQuote()">Email ${escapeHtml(first || 'the client')} the signed quote</button>
      <div class="dash-detail-links"><button type="button" onclick="markSignedQuoteGiven()">${escapeHtml(first || 'The client')} already has a copy</button></div>`;
}
// Built inside the tap, like the certificate's email, because the share
// sheet won't open after a wait.
function emailSignedQuote() {
  const q = quoteState;
  if (!q || !signedQuoteWanted(q)) return;
  if (!jsPDF) {
    ensureJsPDFLoaded()
      .then(() => showToast('Ready. Tap Email again to send it', 'info'))
      .catch(e => showToast((e && e.message) || 'Could not load the PDF tools', 'error'));
    return;
  }
  sendPdfsToClient({
    files: [buildQuotePDF(q)],
    to: quoteClientEmail(q),
    subject: `Your signed quote ${q.number || ''} — ${q.address || 'your property'}`.replace(/\s+/g, ' '),
    body: clientMessage({ client: q.client, address: q.address, docs: 'signed copy of the quote', note: 'Thank you for accepting it.', signOff: inspectorDisplayName() }),
  }).then(sent => {
    if (!sent || !q.answer) return;
    q.answer.copySentAt = Date.now();
    delete q.answer.copyGivenAt;
    storeSentQuote(q); refreshJobsList(); track('signed_quote_sent');
  });
}
function markSignedQuoteGiven() {
  const q = quoteState;
  if (!q || !q.answer) return;
  q.answer.copyGivenAt = Date.now();
  storeSentQuote(q); refreshJobsList();
}

// Every place that shows where the quote is up to. On the quote screen:
// the header's pill, the bar, and the cards that step aside once it has
// gone. On This job (which records the client's answer, the treatment and
// the bait visits against it): the page.
let quoteProgressDrawing = false;
function renderQuoteProgress() {
  if (quoteProgressDrawing) return;
  quoteProgressDrawing = true;
  try {
    if (quoteScreenOpen()) { renderQuoteHead(); renderQuoteStage(); }
    else if (document.getElementById('jobOverlay').classList.contains('open')) renderJobPage();
  } finally { quoteProgressDrawing = false; }
}

// The quote's first screen shows what it needs now. While it's being
// written: Say the quote over the work, and the second opinion under it
// once there are lines. Once it has gone, those two step aside and Send
// again is the quiet button beside PDF: the next step is on This job.
let quoteStageDrawn = '';
function renderQuoteStage() {
  const q = quoteState;
  if (!q) return;
  const gone = quoteHasGone(q);
  document.getElementById('quoteVoice').style.display = gone || isQuoteLocked() ? 'none' : '';
  // The second opinion is only redrawn when its place changes, so a note
  // being typed in it isn't lost to a save.
  const stage = [q.reportKey, gone, isQuoteLocked(), quoteHasItems(q)].join('|');
  if (stage !== quoteStageDrawn) { quoteStageDrawn = stage; renderTreatmentPlanCard(); }
  document.getElementById('quoteEmailBtn').classList.toggle('primary', !gone);
  document.getElementById('quoteSendLabel').textContent = !q.sentAt ? emailToLabel(q.client) : q.sentHash === quoteContentHash(q) ? 'Email again' : 'Email new version';
}

// ── THE JOB'S QUOTE, ON THIS JOB ────────────────────────────────────────────
// The client's answer, the treatment record and the bait visits are steps
// of the job, so they're done on This job, but they're stored on the quote
// and their sheets work on quoteState. While This job is open (and the
// quote screen isn't), quoteState is the job's saved quote. It stays the
// same object from one redraw to the next, so a send or a check still in
// flight marks the copy on screen; when the stored quote has changed under
// it (another device, a client's answer from the link) it takes that in.
function useJobQuote(saved) {
  if (quoteScreenOpen()) return;
  if (!saved) { quoteState = null; return; }
  if (!saved.reportKey) saved.reportKey = currentReportId || 'draft';
  if (!quoteState || quoteState.reportKey !== saved.reportKey) { quoteState = saved; return; }
  if (quoteState === saved || JSON.stringify(quoteState) === JSON.stringify(saved)) return;
  Object.keys(quoteState).forEach(k => delete quoteState[k]);
  Object.assign(quoteState, saved);
}
// This job has closed. A sheet still open over it (the answer, the
// treatment record, a bait visit) keeps the quote until it's saved or shut.
function releaseJobQuote() {
  if (quoteScreenOpen() || document.querySelector('#quoteAnswerOverlay.open, #treatmentOverlay.open, #baitOverlay.open, #sitePlanOverlay.open')) return;
  quoteState = null;
}

let quoteAnswerPad = null;
let quoteAnswerMode = 'accepted';

function openQuoteAnswer(mode) {
  if (!quoteState) return;
  quoteAnswerMode = mode;
  const accepted = mode === 'accepted';
  document.getElementById('quoteAnswerTitle').textContent = accepted ? 'Quote accepted' : 'Quote declined';
  document.getElementById('qaBy').value = quoteState.client || '';
  document.getElementById('qaDate').value = todayIsoDate();
  document.getElementById('qaNote').value = '';
  document.getElementById('qaNote').placeholder = accepted ? 'e.g. Wants the treatment done before 12 Oct' : 'e.g. Going with another company';
  document.getElementById('qaMethodWrap').style.display = accepted ? '' : 'none';
  // On the day the quote was written the client is usually standing there,
  // so it starts on the signature. Sent on an earlier day, they've rung or
  // written back since: it starts on "By phone".
  const sentEarlier = !!quoteState.sentAt && isoDate(new Date(quoteState.sentAt)) < todayIsoDate();
  document.getElementById('qaMethod').value = sentEarlier ? 'phone' : 'signed';
  document.getElementById('qaAcceptText').textContent = quoteAcceptText(quoteState);
  document.getElementById('quoteAnswerOverlay').classList.add('open');
  if (!quoteAnswerPad) {
    quoteAnswerPad = createSignaturePad(document.getElementById('qaSigCanvas'), document.getElementById('qaSigPlaceholder'), updateQuoteAnswerBtn);
  }
  quoteAnswerPad.clear();
  onQuoteAnswerMethod();
}

function onQuoteAnswerMethod() {
  const signing = quoteAnswerMode === 'accepted' && document.getElementById('qaMethod').value === 'signed';
  document.getElementById('qaSignWrap').style.display = signing ? '' : 'none';
  updateQuoteAnswerBtn();
}

function updateQuoteAnswerBtn() {
  const signing = quoteAnswerMode === 'accepted' && document.getElementById('qaMethod').value === 'signed';
  document.getElementById('qaSaveBtn').disabled = !document.getElementById('qaBy').value.trim()
    || (signing && (!quoteAnswerPad || quoteAnswerPad.empty));
}

function closeQuoteAnswer() {
  document.getElementById('quoteAnswerOverlay').classList.remove('open');
}

function saveQuoteAnswer() {
  const q = quoteState;
  if (!q) return;
  const accepted = quoteAnswerMode === 'accepted';
  const method = accepted ? document.getElementById('qaMethod').value : '';
  const answer = {
    status: quoteAnswerMode,
    by: document.getElementById('qaBy').value.trim(),
    date: document.getElementById('qaDate').value || todayIsoDate(),
    method,
    note: document.getElementById('qaNote').value.trim(),
    at: Date.now(),
    hash: quoteContentHash(q),
  };
  if (!answer.by) { showToast('Enter the client\'s name', 'error'); return; }
  if (accepted && method === 'signed') {
    if (!quoteAnswerPad || quoteAnswerPad.empty) return;
    answer.signature = quoteAnswerPad.canvas.toDataURL('image/png');
  }
  q.answer = answer;
  stampQuoteIssued(q);
  clearTimeout(quoteSaveTimer);
  persistQuote();
  storeQuoteOnReport(q, true);
  closeQuoteAnswer();
  renderQuoteProgress();
  if (typeof renderIssueState === 'function') renderIssueState();
  refreshJobsList();
  showToast(accepted ? 'Quote accepted' : 'Quote marked as declined', 'success');
  track('quote_answered', { answer: quoteAnswerMode, method: method || 'none' });
}

async function clearQuoteAnswer() {
  const q = quoteState;
  if (!q || !q.answer) return;
  if (!(await askFirst({ title: 'Clear the client\'s answer?', text: q.treatment ? 'The treatment record and certificate stay.' : 'The quote goes back to waiting on an answer.', yes: 'Clear the answer', danger: true })) || quoteState !== q) return;
  delete q.answer;
  clearTimeout(quoteSaveTimer);
  persistQuote();
  storeQuoteOnReport(q, true);
  renderQuoteProgress();
  if (typeof renderIssueState === 'function') renderIssueState();
  refreshJobsList();
}

// ── PDF EXPORT ──────────────────────────────────────────────────────────────
function exportQuotePDF() {
  if (!quoteState) return;
  clearTimeout(quoteSaveTimer);
  persistQuote();
  storeQuoteOnReport(quoteState, true);
  rememberQuotePrices(quoteState);
  const btn = document.getElementById('quotePdfBtn');
  btn.disabled = true;
  setTimeout(() => {
    ensureJsPDFLoaded()
      .then(() => buildQuotePDF(quoteState))
      .then(({ blob, fname }) => {
        track('quote_pdf_made', { items: quoteState.items.length });
        return deliverPdfBlob(blob, fname, {
          title: 'SAYON Quote',
          text: `Treatment quote — ${quoteState.address || 'Property'}`,
          readyToast: 'Quote ready. Choose where to save or send it',
        });
      })
      .catch(e => {
        console.error('Quote PDF failed:', e);
        reportError(e, 'quote_pdf');
        showToast((e && e.message) || 'Could not make the PDF. Check your signal and try again', 'error');
      })
      .finally(() => { btn.disabled = false; });
  }, 50);
}

// Remember every line's price, not just ones edited this session, so a quote
// that goes to a client becomes the business's price list for next time.
function rememberQuotePrices(q) {
  // The sample's prices only show the list; they never change it.
  if (isSampleJob(q.reportKey)) return;
  q.items.forEach(it => rememberQuotePrice(it.key, parseFloat(it.price)));
  if (q.paymentTerms !== undefined) rememberPaymentTerms(q.paymentTerms.trim());
}

// ── SENT AND LOCKED ─────────────────────────────────────────────────────────
// A quote records when it went to the client and a hash of what it said, so
// the job can only be finalised once the client has the current quote (see
// FINALISED JOBS in js/app/). Once the job is finalised the quote is locked
// with its report until the job is amended.
function quoteHasItems(q) { return !!(q && q.items && q.items.length); }
function quoteContentHash(q) {
  const content = Object.assign({}, q);
  // 'booking' and 'invoice' are left over from features that were removed;
  // older quotes may still carry them, and they never counted as content.
  ['updatedAt', 'createdAt', 'sentAt', 'sentHash', 'certificateSentAt', 'certificateHandedAt', 'reportKey', 'answer', 'booking', 'treatment', 'baitVisits', 'invoice',
    'sourceAddress', 'issuedAt', 'issuedHash', 'linkRequest', 'aiPlan', 'clientSeen'].forEach(k => delete content[k]);
  return sha256Hex(stableJson(content));
}
// The day this version of the quote was first given to the client. The PDF
// dates the quote and works out VALID UNTIL from it, so sending it again
// doesn't move either date. Changing the quote starts a new version.
function stampQuoteIssued(q) {
  const hash = quoteContentHash(q);
  if (q.issuedAt && q.issuedHash === hash) return;
  q.issuedAt = Date.now();
  q.issuedHash = hash;
}
function quoteIssuedAt(q) {
  return q.issuedAt && q.issuedHash === quoteContentHash(q) ? q.issuedAt : Date.now();
}
function markQuoteSent(q) {
  q.sentAt = Date.now();
  q.sentHash = quoteContentHash(q);
  stampQuoteIssued(q);
  storeSentQuote(q);
}
function markCertificateSent(q) {
  q.certificateSentAt = Date.now();
  storeSentQuote(q);
}
// For a certificate printed and handed over, or left in the letterbox,
// so a job without an email still finishes.
function markCertificateHanded() {
  const q = quoteState;
  if (!q || !q.treatment) return;
  q.certificateHandedAt = Date.now();
  storeSentQuote(q);
  showToast('Certificate marked as given in person', 'success', { label: 'Undo', run: () => { delete q.certificateHandedAt; storeSentQuote(q); } });
}
// The certificate has reached the client, by email or by hand.
function certificateGiven(q) { return !!(q && (q.certificateSentAt || q.certificateHandedAt)); }
// Saves a quote whose sent state changed, and redraws every place that
// shows it. The report's send marks the stored quote, so the open quote
// takes the same times.
function storeSentQuote(q) {
  if (quoteState && quoteState !== q && quoteState.reportKey === q.reportKey) {
    ['sentAt', 'sentHash', 'certificateSentAt', 'certificateHandedAt', 'issuedAt', 'issuedHash', 'linkRequest', 'answer'].forEach(k => {
      if (q[k]) quoteState[k] = q[k]; else if (k === 'certificateHandedAt' || k === 'linkRequest' || k === 'answer') delete quoteState[k];
    });
  }
  const all = readJSON(quotesStorageKey(), {});
  all[q.reportKey] = q;
  try { localStorage.setItem(quotesStorageKey(), JSON.stringify(all)); } catch (e) {}
  storeQuoteOnReport(q, true);
  if (quoteState && quoteState.reportKey === q.reportKey) renderQuoteProgress();
  if (typeof renderIssueState === 'function') renderIssueState();
}
function isQuoteLocked() {
  const rd = quoteReport();
  return !!(rd && rd.issue && !rd.amending);
}
function renderQuoteLock() {
  const note = document.getElementById('quoteLockNote');
  if (note) note.style.display = isQuoteLocked() ? '' : 'none';
}
// While locked, edits in the quote are stopped; the PDF and email still work.
let quoteLockGuardInstalled = false;
function installQuoteLockGuard() {
  if (quoteLockGuardInstalled) return;
  quoteLockGuardInstalled = true;
  const editor = document.getElementById('quoteEditor');
  const stop = e => {
    if (!isQuoteLocked() || e.target.closest('.qi-row, .qi-done, .quote-hero-name, .quote-hero-problem, summary')) return;
    if (e.type === 'touchstart') return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'focusin' && e.target.blur) e.target.blur();
    if (e.type === 'click') sayLocked();
  };
  ['mousedown', 'click', 'focusin', 'keydown'].forEach(t => editor.addEventListener(t, stop, true));
}

// ── CHECK BEFORE THE QUOTE GOES ─────────────────────────────────────────────
// Send to client on the quote opens the same check sheet the report sends
// from (CHECK BEFORE SENDING in js/app/send.js): who it goes to, the quote
// and its link, what the quote still needs with a button to each, and the
// message. Nothing goes until the button at its foot is tapped.

// What the quote still needs, each with the way to fix it: the same notes
// its sections show (quoteFoldNotes), said in full, then the system not
// picked and the business's own details.
function quoteSendGaps(q) {
  const items = [];
  const fixBtn = (kind, label) => `<button class="link-btn" onclick="fixQuoteGap('${kind}')">${label}</button>`;
  const push = (key, text, fix) => items.push({ key, text, fix });
  const n = q.items.length, starting = q.items.filter(isStartingPrice).length;
  if (!(q.client || '').trim()) push('client', 'The quote has no client name', fixBtn('client', 'Add it'));
  const c = quoteSystemChoice(q);
  if (c && Array.isArray(c.options) && c.options.length && !c.picked) push('system', 'No system is picked yet, so the quote doesn\'t price one', fixBtn('system', 'Pick one'));
  if (!n) push('work', 'The quote has no lines of work', fixBtn('work', 'Add a line'));
  else if (starting) push('prices', `${starting === 1 ? 'One price is' : starting + ' prices are'} still SAYON's starting price, not one you've set`, fixBtn('work', starting === 1 ? 'Check it' : 'Check them'));
  if (quotePlanShown(q)) {
    const p = q.plan;
    if (!p) push('plan', 'There\'s no treatment plan on the quote', fixBtn('plan', 'Add a plan'));
    else if (!p.time) push('plan', 'The plan doesn\'t say how long you\'ll be on site', fixBtn('plan', 'Set it'));
    else if (!p.service) push('plan', 'The plan doesn\'t give a service period', fixBtn('plan', 'Set it'));
  }
  if (!(q.paymentTerms || '').trim()) push('terms', 'There are no payment terms', fixBtn('terms', 'Add them'));
  // A finalised job's quote is locked with it: the list still says what
  // it went without, but nothing offers to change it.
  if (isQuoteLocked()) items.forEach(it => { it.fix = ''; });
  return items.concat(businessSendGaps('the quote', "fixQuoteGap('business')"));
}

function openQuoteSendReview() {
  if (!quoteState) return;
  clearTimeout(quoteSaveTimer);
  persistQuote();
  storeQuoteOnReport(quoteState, true);
  if (!jsPDF) {
    ensureJsPDFLoaded().then(openQuoteSendReview)
      .catch(e => showToast((e && e.message) || 'Could not load the PDF tools', 'error'));
    return;
  }
  const q = quoteState;
  const esc = escapeHtml;
  track('screen_viewed', { screen: 'check_before_quote_send' });
  const sampleTo = isSampleJob(q.reportKey) && typeof sampleJobSendTo === 'function' ? sampleJobSendTo() : '';
  const email = sampleTo || (q.clientEmail || '').trim();
  const client = (q.client || '').trim();
  const r = sendReview = { kind: 'quote', files: null, quote: q };

  document.getElementById('sendReviewTo').innerHTML =
    `<div class="send-review-name">${esc(sampleTo ? 'You, not a client: this is the sample job' : client || 'No client name')}</div>` +
    (email ? `<div class="send-review-email">${esc(email)}</div>`
      : `<div class="send-review-warn">No client email. Add it so SAYON can send it for you.</div>
         <div class="send-review-add-email"><input class="job-input" id="sendReviewEmail" type="email" placeholder="client@email.com" autocomplete="off">
         <button class="agreement-banner-btn" onclick="addSendReviewEmail()">Add</button></div>`);
  const copy = document.getElementById('sendReviewCopy');
  copy.innerHTML = ''; copy.hidden = true;
  document.getElementById('sendReviewFiles').innerHTML =
    `<div class="send-review-file"><div><div class="send-review-file-name">Treatment quote</div>` +
    `<div class="send-review-file-meta">${esc(q.number || '')} · ${formatAUD(quoteTotals(q).total)}${q.gst !== false ? ' inc GST' : ''}</div></div>` +
    `<button class="link-btn" onclick="previewSendFile(0)">Preview</button></div>`;
  // The report sheet's "What the client reads first" is the report's summary.
  document.getElementById('sendReviewSummaryLabel').hidden = true;
  const summary = document.getElementById('sendReviewSummary');
  summary.hidden = true; summary.innerHTML = '';

  const gaps = quoteSendGaps(q);
  const gapsWrap = document.getElementById('sendReviewGaps');
  gapsWrap.style.display = gaps.length ? '' : 'none';
  gapsWrap.innerHTML = reportGapsHtml(gaps);

  document.getElementById('sendReviewSubject').value = `Quote ${q.number || ''} — ${q.address || 'your property'}`.replace('  ', ' ');
  r.message = { client: q.client, address: q.address, docs: 'treatment quote', signOff: q.inspector };
  // The link the client accepts from goes in the message. Making it needs
  // signal and a moment, so it's made while the sheet is read.
  const current = quoteLinkCurrent(q);
  r.defaultBody = clientMessage(r.message);
  document.getElementById('sendReviewBody').value = r.defaultBody;
  if (current) showSendReviewLink(r, quoteLinkUrl(current.id));
  else if (authSession && navigator.onLine && !isSampleJob(q.reportKey)) r.linkPending = prepareQuoteSendLink(r);

  r.label = directEmail && email ? `Email to ${email}` : 'Open email to send';
  const btn = document.getElementById('sendReviewBtn');
  btn.textContent = r.label;
  btn.disabled = false;
  const open = document.getElementById('sendReviewOpen');
  open.hidden = !gaps.length;
  open.textContent = gaps.length === 1 ? '1 thing at the top is still open' : `${gaps.length} things at the top are still open`;
  document.getElementById('sendReviewOverlay').classList.add('open');
  const body = document.querySelector('#sendReviewOverlay .page-sheet-body');
  if (body) body.scrollTop = 0;
}

// The link for a quote going on its own: the client's page offers the
// quote PDF, and the report too when this quote belongs to the open job.
async function prepareQuoteSendLink(r) {
  const q = r.quote;
  let link = null;
  try {
    const files = { quote: (await sendReviewFiles(r))[0] };
    if (q.reportKey === (currentReportId || 'draft')) {
      try { files.report = await buildReportPdf(); } catch (e) { reportError(e, 'quote_link_report'); }
    }
    link = await ensureQuoteLink(q, files);
  } catch (e) {
    reportError(e, 'quote_send_link');
  }
  r.linkPending = null;
  if (link && sendReview === r) showSendReviewLink(r, quoteLinkUrl(link.id));
}

// The client's email typed on the check sheet, onto the quote and the job.
function setQuoteClientEmail(value) {
  const el = document.getElementById('qClientEmail');
  if (el) el.value = value;
  onQuoteFieldInput();
}

// A fix button on the quote's check: closes the sheet and goes to the
// place in the quote. The business's details are a menu page, which comes
// back to the quote and its check.
function fixQuoteGap(kind) {
  if (kind === 'business') { openBusinessForm(openQuoteSendReview, closeSendReview); return; }
  closeSendReview();
  const open = id => { const fold = document.getElementById(id); if (fold) fold.open = true; return fold; };
  if (kind === 'client') { openQuoteDetails('qClient'); const el = document.getElementById('qClient'); if (el) el.focus({ preventScroll: true }); return; }
  const target = kind === 'system' ? (open('quoteWorkFold'), document.getElementById('quoteSystemChoice'))
    : kind === 'work' ? open('quoteWorkFold') : kind === 'plan' ? open('quotePlanFold') : open('quoteTermsFold');
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── CLIENT LINK ─────────────────────────────────────────────────────────────
// The quote goes to the client with a link to sign.html, the same page as
// the agreement link (supabase/client-link.sql). The client reads the quote
// there and taps Accept, with a signature, or Decline, with a note. The
// quote keeps
//   q.linkRequest = { id, sentAt, hash, files }
// for this version of the quote (hash), and polls the row until it is
// answered, which becomes q.answer with method 'link', just as if the
// inspector had recorded it. A changed quote gets a new link.
const QUOTE_LINK_CHECK_MS = 60000;
const quoteLinkChecked = {};
const CLIENT_DOCS_BUCKET = 'client-docs';

function quoteLinkUrl(id) { return agreementLinkUrl(id); }
function quoteLinkCurrent(q) {
  const r = q && q.linkRequest;
  return r && r.hash === quoteContentHash(q) ? r : null;
}

// What the client agrees to when they accept, on the link and on the
// inspector's phone: "I accept quote Q-0012 for $1,254.00 (inc GST) and
// authorise the work described in it." "(inc GST)" stays on one line.
function quoteAcceptText(q) {
  return `I accept ${q.number ? `quote ${q.number}` : 'this quote'} for ${formatAUD(quoteTotals(q).total)}${q.gst !== false ? ' (inc\u00a0GST)' : ''} and authorise the work described in it.`;
}

// What the client's page shows: everything the quote PDF says.
function quoteLinkDoc(q, files) {
  const company = getCompanyDetails();
  const totals = quoteTotals(q);
  const issued = quoteIssuedAt(q);
  const validDays = parseInt(q.validDays, 10) || 30;
  const plan = (quotePlanShown(q) && q.plan) || {};
  const lines = v => (v || '').split('\n').map(s => s.trim()).filter(Boolean);
  return {
    kind: 'quote', company: company.name || '', phone: company.phone || '', email: company.email || '',
    client: (q.client || '').trim(), address: q.address || '', number: q.number || '',
    date: isoDate(new Date(issued)), validUntil: isoDate(new Date(issued + validDays * 86400000)), inspector: q.inspector || '',
    gst: q.gst !== false,
    items: q.items.map(it => ({ desc: it.desc || '', detail: it.detail || '', qty: it.qty, unit: pluralUnit(it.unit, it.qty),
      price: parseFloat(it.price) || 0, total: lineTotal(it) })),
    subtotal: totals.subtotal, gstAmount: totals.gst, total: totals.total,
    problem: quoteProblem(q).trim(),
    plan: { why: (plan.why || '').trim(), time: (plan.time || '').trim(), service: (plan.service || '').trim(), inspections: repairPlanInspections(plan.inspections),
      we: lines(plan.we), owner: lines(plan.owner) },
    exclusions: lines(q.exclusions), notes: lines(q.notes), paymentTerms: (q.paymentTerms || '').trim(),
    files: files || {},
    acceptText: quoteAcceptText(q),
  };
}

// Puts the PDFs where the client's page can offer them, under a folder only
// the link knows. Best effort: without the bucket the page shows the quote
// without downloads. Returns { report?, quote? } urls.
async function uploadClientDocs(folder, files) {
  const out = {};
  for (const [key, f] of Object.entries(files || {})) {
    if (!f || !f.blob) continue;
    const path = `${folder}/${key === 'report' ? 'inspection-report' : 'treatment-quote'}.pdf`;
    try {
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${CLIENT_DOCS_BUCKET}/${path}`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${getAuthToken()}`, 'Content-Type': 'application/pdf', 'x-upsert': 'true' },
        body: f.blob,
      });
      if (res.ok) out[key] = `${SUPABASE_URL}/storage/v1/object/public/${CLIENT_DOCS_BUCKET}/${path}`;
    } catch (e) { /* no signal: the page does without the file */ }
  }
  return out;
}

// The link for this version of the quote, made now if there isn't one.
// Resolves to the request, or null when it can't be made (signed out, no
// signal, or the table isn't set up yet), so sending carries on without it.
async function ensureQuoteLink(q, files) {
  if (!authSession || !authUser || !navigator.onLine || !quoteHasItems(q) || isSampleJob(q.reportKey)) return null;
  const current = quoteLinkCurrent(q);
  if (current) return current;
  stampQuoteIssued(q);
  const old = q.linkRequest;
  if (old) cancelQuoteLinkRow(old.id);
  try {
    const folder = `${authUser.id}/${(crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2))}`;
    const uploaded = await uploadClientDocs(folder, files);
    const doc = quoteLinkDoc(q, uploaded);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/sign_requests?select=id`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify({ user_id: authUser.id, report_id: q.reportKey || 'draft', doc }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const [row] = await res.json();
    q.linkRequest = { id: row.id, sentAt: Date.now(), hash: quoteContentHash(q), files: uploaded };
    storeSentQuote(q);
    track('quote_link_made', { with_report: !!uploaded.report });
    return q.linkRequest;
  } catch (e) {
    reportError(e, 'quote_link');
    return null;
  }
}

function cancelQuoteLinkRow(id) {
  if (!authSession || !id) return;
  fetch(`${SUPABASE_URL}/rest/v1/sign_requests?id=eq.${encodeURIComponent(id)}&status=eq.pending`, {
    method: 'PATCH', headers: getAuthHeaders(), body: JSON.stringify({ status: 'cancelled' }),
  }).catch(() => {});
}

function quoteLinkMessage(q) {
  const company = getCompanyDetails().name || 'your inspector';
  return `Hi ${greetingName(q.client) || 'there'}, here is the treatment quote from ${company} for ${q.address || 'your property'}. Please read it and accept or decline it on your phone:`;
}

// The share sheet (text, email, WhatsApp), or the clipboard where there's none.
async function shareQuoteLink(q) {
  const r = quoteLinkCurrent(q);
  if (!r) { showToast('Send the quote first: that makes the link', 'info'); return; }
  const url = quoteLinkUrl(r.id);
  const text = quoteLinkMessage(q);
  if (navigator.share) {
    try { await navigator.share({ title: 'Treatment quote', text, url }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    showToast('Link copied. Paste it into a text or email to the client', 'success');
  } catch (e) {
    showLinkToCopy(url);
  }
}

// Reads the row back. An accepted or declined quote becomes q.answer.
async function checkQuoteLink(q, byTap) {
  const r = q && q.linkRequest;
  if (!r || q.answer || !authSession) return;
  if (!byTap && Date.now() - (quoteLinkChecked[r.id] || 0) < QUOTE_LINK_CHECK_MS) return;
  quoteLinkChecked[r.id] = Date.now();
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/sign_requests?id=eq.${encodeURIComponent(r.id)}&select=status,signer_name,signature,signed_at,note`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const [row] = await res.json();
    if (!q.linkRequest || q.linkRequest.id !== r.id || q.answer) return;
    const said = applyQuoteLinkRow(q, row);
    if (said) {
      refreshJobsList();
      showToast(said, q.answer.status === 'accepted' ? 'success' : 'info');
    } else if (byTap) {
      showToast(row && row.status === 'cancelled' ? 'That link was cancelled' : 'No answer yet', 'info');
    }
  } catch (e) {
    if (byTap) showToast('Could not check. Try again when you have signal', 'error');
  }
}

// A link's row that came back answered becomes the quote's answer, saved.
// Returns what to say ("Sam Taylor accepted the quote"), or '' when the
// client hasn't answered.
function applyQuoteLinkRow(q, row) {
  if (!row || (row.status !== 'signed' && row.status !== 'declined')) return '';
  const accepted = row.status === 'signed';
  q.answer = { status: accepted ? 'accepted' : 'declined', by: row.signer_name || q.client || '', date: isoDate(new Date(row.signed_at)),
    method: 'link', note: (row.note || '').trim(), at: Date.now(), hash: q.linkRequest.hash };
  if (accepted && isSignatureImage(row.signature)) q.answer.signature = row.signature;
  delete q.linkRequest;
  storeSentQuote(q);
  track('quote_answered', { answer: q.answer.status, method: 'link' });
  return `${q.answer.by || 'The client'} ${accepted ? 'accepted' : 'declined'} the quote`;
}

// From the Jobs list's check of every link that's out (checkLinksOut in
// js/app/dashboard.js). Returns what to say, or '' when there's no answer.
function takeQuoteLinkAnswer(reportId, row) {
  const q = getSavedQuotes()[reportId];
  if (!q || !q.linkRequest || q.linkRequest.id !== row.id || q.answer) return '';
  if (!q.reportKey) q.reportKey = reportId;
  return applyQuoteLinkRow(q, row);
}

// ── SHARED PDF PARTS (quote and treatment certificate) ──────────────────────
// The letterhead, the document title and the details panel: client
// details on the left, document details in a two-column grid on the right.
// Returns the y position below the panel. compact: a smaller title, for
// one-page documents.
function drawPdfDocCover(doc, company, { kicker, title, date, left, right, compact }) {
  const C = PDF_COLORS;
  const W = 210, M = 15, CW = W - M * 2;
  left = left.filter(([, v]) => v);
  right = right.filter(([, v]) => v);
  const top = drawPdfLetterhead(doc, company, { docLabel: title, date });

  const kickerY = top + (compact ? 9.5 : 12);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...C.accentDark);
  pdfTracked(doc, kicker.toUpperCase(), M, kickerY, { cs: 0.6 });
  const titleY = kickerY + (compact ? 8.5 : 10.5);
  doc.setFontSize(compact ? 21 : 25); doc.setTextColor(...C.ink);
  doc.text(title, M, titleY);
  doc.setFillColor(...C.accent); doc.rect(M, titleY + 3.5, 18, 1.2, 'F');

  // Panel: a light tint with a hairline, no shadow, so it prints flat.
  const gutter = 10, leftW = (CW - gutter - 12) * 0.46;
  const rightX = M + 6 + leftW + gutter, cellW = (M + CW - 6 - rightX) / 2;
  const cardY = titleY + 10;
  const measure = (rows, w) => rows.map(([, v]) => 7.2 + doc.splitTextToSize(String(v), w - 3).length * 4.4);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
  const leftHs = measure(left, leftW);
  const rightHs = measure(right, cellW);
  const leftH = leftHs.reduce((a, b) => a + b, 0);
  let rightH = 0;
  for (let i = 0; i < rightHs.length; i += 2) rightH += Math.max(rightHs[i], rightHs[i + 1] || 0);
  const cardH = Math.max(leftH, rightH) + 7;
  doc.setFillColor(...C.rowAlt); doc.roundedRect(M, cardY, CW, cardH, 2.5, 2.5, 'F');
  let ly = cardY + 7.5;
  left.forEach(([label, val], i) => { drawPdfField(doc, label, val, M + 6, ly, leftW - 3); ly += leftHs[i]; });
  let ry = cardY + 7.5;
  for (let i = 0; i < right.length; i += 2) {
    drawPdfField(doc, right[i][0], right[i][1], rightX, ry, cellW - 3, 9);
    if (right[i + 1]) drawPdfField(doc, right[i + 1][0], right[i + 1][1], rightX + cellW, ry, cellW - 3, 9);
    ry += Math.max(rightHs[i], rightHs[i + 1] || 0);
  }
  return cardY + cardH + 7;
}

// Same light running header as the inspection report. Returns the y where
// content starts.
function drawPdfRunningHeader(doc, company, docName, address, number) {
  const C = PDF_COLORS;
  const W = 210, M = 15, CW = W - M * 2;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...C.ink);
  doc.text(company.name || docName, M, 10);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...C.inkMuted);
  const sub = [company.name ? docName : '', address || ''].filter(Boolean).join('   ·   ');
  if (sub) doc.text(pdfFitText(doc, sub, CW), M, 14);
  doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.accentDark);
  doc.text(number || '', W - M, 10, { align: 'right' });
  doc.setFillColor(...C.accent); doc.rect(M, 17, CW, 0.35, 'F');
  return 26;
}

function drawPdfNumberedTitle(doc, y, title, num) {
  const C = PDF_COLORS;
  const M = 15, CW = 180;
  y += 4;
  doc.setFillColor(...C.accent); doc.roundedRect(M, y, 7, 7, 1, 1, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...C.white);
  doc.text(String(num), M + 3.5, y + 5.2, { align: 'center' });
  doc.setFontSize(10.5); doc.setTextColor(...C.ink);
  doc.text(title, M + 10, y + 5.5);
  doc.setFillColor(...C.rule); doc.rect(M, y + 9, CW, 0.3, 'F');
  return y + 15;
}

// A table's heading row: a pale blue band, so tables print light.
function drawPdfTableHeadRule(doc, x, y, w) {
  const C = PDF_COLORS;
  doc.setFillColor(...C.accentLight); doc.rect(x, y, w, 8, 'F');
}

// The line items table: description and detail, qty, unit price, amount.
// newPage() starts a fresh page and returns its top y. Returns the y below
// the table.
function drawPdfLineItems(doc, y, allItems, { bottom, newPage }) {
  const C = PDF_COLORS;
  const M = 15, CW = 180;
  const X_QTY = M + CW - 66, X_PRICE = M + CW - 30, X_AMT = M + CW - 3;
  const DESC_W = X_QTY - M - 22;
  function tableHead() {
    drawPdfTableHeadRule(doc, M, y, CW);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.3); doc.setTextColor(...C.inkLight);
    pdfTracked(doc, 'DESCRIPTION', M + 3, y + 5.3, { cs: 0.3 });
    pdfTracked(doc, 'QTY', X_QTY, y + 5.3, { cs: 0.3, align: 'right' });
    pdfTracked(doc, 'UNIT PRICE', X_PRICE, y + 5.3, { cs: 0.3, align: 'right' });
    pdfTracked(doc, 'AMOUNT', X_AMT, y + 5.3, { cs: 0.3, align: 'right' });
    y += 8;
  }
  tableHead();
  const items = allItems.filter(it => (it.desc || '').trim() || lineTotal(it));
  if (!items.length) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.setTextColor(...C.inkMuted);
    doc.text('No line items.', M + 3, y + 6); y += 10;
  }
  items.forEach((it, i) => {
    doc.setFontSize(9);
    const descLines = doc.splitTextToSize((it.desc || '').trim() || 'Item', DESC_W);
    doc.setFontSize(7.5);
    const detailLines = (it.detail || '').trim() ? doc.splitTextToSize(it.detail.trim(), DESC_W) : [];
    const rowH = Math.max(9, descLines.length * 4.4 + detailLines.length * 3.6 + 5);
    if (y + rowH > bottom) { y = newPage(); tableHead(); }
    if (i % 2 === 1) { doc.setFillColor(...C.rowAlt); doc.rect(M, y, CW, rowH, 'F'); }
    doc.setDrawColor(...C.ruleLight); doc.setLineWidth(0.25); doc.line(M, y + rowH, M + CW, y + rowH);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...C.ink);
    doc.text(descLines, M + 3, y + 5.5);
    if (detailLines.length) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...C.inkLight);
      doc.text(detailLines, M + 3, y + 5.5 + descLines.length * 4.4);
    }
    const qty = parseFloat(it.qty);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...C.ink);
    doc.text(`${isFinite(qty) ? +qty.toFixed(2) : 0} ${pluralUnit(it.unit, qty)}`.trim(), X_QTY, y + 5.5, { align: 'right' });
    doc.text(formatAUD(parseFloat(it.price)), X_PRICE, y + 5.5, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.text(formatAUD(lineTotal(it)), X_AMT, y + 5.5, { align: 'right' });
    y += rowH;
  });
  return y;
}

// Totals box, right-aligned: label/amount rows, then a highlighted final
// row ([label, amount]).
const PDF_TOTALS_BOX_W = 80;
function pdfTotalsBoxHeight(rows) { return rows.length * 6.5 + 14; }
function drawPdfTotalsBox(doc, y, rows, [finalLabel, finalValue]) {
  const C = PDF_COLORS;
  const M = 15, CW = 180, boxW = PDF_TOTALS_BOX_W;
  const bx = M + CW - boxW;
  doc.setFillColor(...C.rowAlt); doc.roundedRect(bx, y, boxW, pdfTotalsBoxHeight(rows), 2, 2, 'F');
  let ty = y + 6.5;
  rows.forEach(([label, val]) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...C.inkLight);
    doc.text(label, bx + 5, ty);
    doc.setTextColor(...C.ink); doc.text(formatAUD(val), bx + boxW - 4, ty, { align: 'right' });
    ty += 6.5;
  });
  doc.setFillColor(...C.accentDark); doc.rect(bx, ty - 3, boxW, 10, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...C.white);
  doc.text(finalLabel, bx + 5, ty + 3.4);
  doc.text(formatAUD(finalValue), bx + boxW - 4, ty + 3.4, { align: 'right' });
}

// key: the job the PDF is for (the open job when left out), so the sample
// job's PDFs are stamped SAMPLE.
function drawPdfDocFooters(doc, label, key) {
  stampSamplePdf(doc, key);
  const C = PDF_COLORS;
  const W = 210, M = 15, CW = W - M * 2;
  const pages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFillColor(...C.rule); doc.rect(M, 284, CW, 0.3, 'F');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...C.inkMuted);
    doc.text(label, M, 290);
    doc.text(`Page ${p} of ${pages}`, W - M, 290, { align: 'right' });
  }
}

function buildQuotePDF(q) {
  const C = PDF_COLORS;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 15, CW = W - M * 2, BOTTOM = 276;
  const fmtDate = d => new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  const issued = quoteIssuedAt(q);
  const today = fmtDate(issued);
  const validDays = parseInt(q.validDays, 10) || 30;
  const validUntil = fmtDate(issued + validDays * 86400000);
  const company = getCompanyDetails();
  const totals = quoteTotals(q);
  let y = 0;

  function pageTopBand() { y = drawPdfRunningHeader(doc, company, 'Treatment Quote', q.address, q.number); }
  // A new page keeps the text style it broke in, as the header changes it.
  function ensure(h) {
    if (y + h <= BOTTOM) return;
    const font = doc.getFont(), size = doc.getFontSize(), color = doc.getTextColor();
    doc.addPage(); pageTopBand();
    doc.setFont(font.fontName, font.fontStyle); doc.setFontSize(size); doc.setTextColor(color);
  }
  // keep: room for the section's first content, so a title never sits at
  // the foot of a page with its content overleaf.
  function sectionTitle(title, num, keep = 0) { ensure(20 + keep); y = drawPdfNumberedTitle(doc, y, title, num); }

  y = drawPdfDocCover(doc, company, { kicker: 'Timber pest', title: 'Treatment Quote', date: today, left: [
    ['PREPARED FOR', q.client || 'Not specified'],
    ['PROPERTY ADDRESS', q.address || 'Not specified'],
    ['CONTACT', [q.clientPhone, q.clientEmail].map(v => (v || '').trim()).filter(Boolean).join('  ·  ')],
  ], right: [
    ['QUOTE NO.', q.number],
    ['DATE', today],
    ['VALID UNTIL', validUntil],
    ['INSPECTION DATE', q.inspectionDate ? fmtDate(q.inspectionDate) : ''],
    ['INSPECTOR', q.inspector],
  ] });

  // What the quote fixes, so the scope below reads as the answer to it.
  const problem = quoteProblem(q).trim();
  if (problem) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    const lines = doc.splitTextToSize(problem, CW - 12);
    const h = 11 + lines.length * 4.6;
    ensure(h + 6);
    doc.setFillColor(...C.accentLight); doc.roundedRect(M, y, CW, h, 2, 2, 'F');
    doc.setFillColor(...C.accent); doc.rect(M, y, 1.4, h, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...C.accentDark);
    pdfTracked(doc, 'PURPOSE OF TREATMENT', M + 6, y + 6, { cs: 0.5 });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...C.ink);
    doc.text(lines, M + 6, y + 11.5);
    y += h + 7;
  }

  // ── 1. SCOPE OF WORKS ──
  sectionTitle('SCOPE OF WORKS', 1);
  y = drawPdfLineItems(doc, y, q.items, { bottom: BOTTOM, newPage: () => { doc.addPage(); pageTopBand(); return y; } });
  const totalRows = [[q.gst !== false ? 'Subtotal (ex GST)' : 'Subtotal', totals.subtotal]];
  if (q.gst !== false) totalRows.push(['GST (10%)', totals.gst]);
  const boxH = pdfTotalsBoxHeight(totalRows);
  const boxW = PDF_TOTALS_BOX_W;
  const terms = (q.paymentTerms || '').trim();
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  const termLines = terms ? doc.splitTextToSize(terms, CW - boxW - 10) : [];
  // Every line of the terms prints (bank details often run to six lines);
  // long terms run on below the totals box.
  const TERM_LINE_H = 3.6;
  const blockH = Math.max(boxH, termLines.length ? 11 + termLines.length * TERM_LINE_H : 0);
  ensure(blockH + 6);
  y += 5;
  drawPdfTotalsBox(doc, y, totalRows, [q.gst !== false ? 'TOTAL (inc GST)' : 'TOTAL', totals.total]);
  if (termLines.length) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...C.inkMuted);
    doc.text('PAYMENT TERMS', M, y + 6.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...C.ink);
    termLines.forEach((line, i) => doc.text(line, M, y + 11 + i * TERM_LINE_H));
  }
  y += blockH + 4;

  let sectionNum = 2;
  // ── 2. TREATMENT PLAN ──
  const plan = (quotePlanShown(q) && q.plan) || {};
  const planLines = v => (v || '').split('\n').map(s => s.trim()).filter(Boolean);
  const we = planLines(plan.we), owner = planLines(plan.owner);
  const facts = [['TIME ON SITE', plan.time], ['FREE SERVICE PERIOD', plan.service], ['INSPECTIONS AFTER', repairPlanInspections(plan.inspections)]]
    .map(([k, v]) => [k, (v || '').trim()]).filter(([, v]) => v);
  const why = (plan.why || '').trim();
  if (we.length || owner.length || facts.length || why) {
    const gap = 4, fw = facts.length ? (CW - gap * (facts.length - 1)) / facts.length : CW;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
    const wrapped = facts.map(([, v]) => doc.splitTextToSize(v, fw - 8));
    const fh = facts.length ? 10 + Math.max(...wrapped.map(l => l.length)) * 4.4 : 0;
    sectionTitle('TREATMENT PLAN', sectionNum++, facts.length ? fh + 6 : 18);
    // Why this plan suits the property, in a sentence or two, above the steps.
    if (why) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
      const lines = doc.splitTextToSize(why, CW);
      ensure(lines.length * 4.2 + 4);
      doc.setTextColor(...C.ink); doc.text(lines, M, y);
      y += lines.length * 4.2 + 3;
    }
    if (facts.length) {
      ensure(fh + 6);
      facts.forEach(([k], i) => {
        const x = M + i * (fw + gap);
        doc.setFillColor(...C.accentLight); doc.roundedRect(x, y, fw, fh, 2, 2, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...C.accentDark);
        pdfTracked(doc, k, x + 4, y + 5.5, { cs: 0.5 });
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...C.ink);
        doc.text(wrapped[i], x + 4, y + 10.8);
      });
      y += fh + 6;
    }
    const steps = (label, list, numbered) => {
      if (!list.length) return;
      ensure(14);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...C.inkMuted);
      pdfTracked(doc, label, M, y, { cs: 0.5 });
      y += 5;
      list.forEach((line, i) => {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
        const lines = doc.splitTextToSize(line, CW - 8);
        ensure(lines.length * 4.2 + 2);
        if (numbered) {
          doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.accentDark);
          doc.text(`${i + 1}.`, M, y);
          doc.setFont('helvetica', 'normal');
        } else {
          doc.setFillColor(...C.accent); doc.circle(M + 1.6, y - 1.1, 0.8, 'F');
        }
        doc.setTextColor(...C.ink); doc.text(lines, M + 5, y);
        y += lines.length * 4.2 + 2;
      });
      y += 3;
    };
    steps('WHAT WE WILL DO', we, true);
    steps('WHAT WE ASK YOU TO DO', owner, false);
    if (plan.service && plan.service.trim() && !/^none$/i.test(plan.service.trim())) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5);
      const lines = doc.splitTextToSize(`During the free service period, if termites return to the treated areas we will come back and treat them at no charge. ` +
        `This only applies while the recommended timber pest inspections are carried out and the steps asked of you above are done.`, CW - 5);
      const h = lines.length * 4 + 3;
      ensure(h);
      doc.setFillColor(...C.ruleLight); doc.rect(M, y - 3, 1.5, h - 2, 'F');
      doc.setTextColor(...C.inkMuted); doc.text(lines, M + 4, y);
      y += h + 2;
    }
  }

  // ── EXCLUSIONS ──
  const exclusions = (q.exclusions || '').split('\n').map(s => s.trim()).filter(Boolean);
  if (exclusions.length) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    sectionTitle('EXCLUSIONS & WORK BY OTHERS', sectionNum++, doc.splitTextToSize(exclusions[0], CW - 8).length * 4.2 + 2);
    exclusions.forEach(ex => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
      const lines = doc.splitTextToSize(ex, CW - 8);
      ensure(lines.length * 4.2 + 2);
      doc.setFillColor(...C.accent); doc.circle(M + 1.6, y - 1.1, 0.8, 'F');
      doc.setTextColor(...C.ink); doc.text(lines, M + 5, y);
      y += lines.length * 4.2 + 2;
    });
    y += 2;
  }

  // ── TERMS & NOTES ──
  const notes = (q.notes || '').trim();
  if (notes) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5);
    sectionTitle('TERMS & NOTES', sectionNum++, doc.splitTextToSize(notes.split('\n')[0], CW - 5).length * 4 + 3);
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(...C.inkMuted);
    notes.split('\n').map(s => s.trim()).filter(Boolean).forEach(p => {
      const lines = doc.splitTextToSize(p, CW - 5);
      const h = lines.length * 4 + 3;
      ensure(h);
      doc.setFillColor(...C.ruleLight); doc.rect(M, y - 3, 1.5, h - 2, 'F');
      doc.text(lines, M + 4, y);
      y += h;
    });
  }

  // ── ACCEPTANCE ── (kept together, and compact so most quotes fit one page)
  ensure(40);
  y += 3;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...C.ink);
  pdfTracked(doc, 'ACCEPTANCE', M, y + 3, { cs: 0.6 });
  doc.setFillColor(...C.accent); doc.rect(M, y + 5, CW, 0.5, 'F');
  y += 11;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...C.inkLight);
  doc.text(doc.splitTextToSize(`I accept this quote of ${formatAUD(totals.total)}${q.gst !== false ? ' (inc GST)' : ''} and authorise the work described above.`, CW), M, y);
  y += 19;
  // A current acceptance fills the block in; otherwise it's left blank to sign.
  const ans = quoteAnswerState(q);
  const accepted = ans && ans.status === 'accepted' && !ans.stale ? ans : null;
  const colW = (CW - 16) / 3;
  const valueOnLine = (text, x) => drawPdfOnLine(doc, text, x, y, colW);
  valueOnLine(accepted && accepted.by, M);
  drawPdfSignature(doc, { x: M, y, w: colW, caption: 'Client name' });
  drawPdfSignature(doc, { x: M + colW + 8, y, w: colW, caption: 'Client signature',
    image: accepted && isSignatureImage(accepted.signature) ? accepted.signature : null,
    note: accepted && !isSignatureImage(accepted.signature) ? `Accepted ${QUOTE_ANSWER_METHODS[accepted.method] || ''}`.trim() : '' });
  valueOnLine(accepted && formatLongDate(accepted.date), M + (colW + 8) * 2);
  drawPdfSignature(doc, { x: M + (colW + 8) * 2, y, w: colW, caption: 'Date' });
  y += 8;

  drawPdfDocFooters(doc, `Quote ${q.number || ''}${company.name ? `  ·  ${company.name}` : ''}`, q.reportKey);

  return { blob: doc.output('blob'), fname: pdfFileName('Quote', q.address, { ref: q.number }) };
}
