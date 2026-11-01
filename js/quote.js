// ══════════════════════════════════════════════════════════════════════════
// QUOTE BUILDER
// Turns an inspection report's findings, conducive conditions and
// recommendations into an editable treatment quote, and exports it as a PDF in
// the same visual style as the inspection report.
//
// Loaded after js/app.js and relies on its globals:
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
// quotePriceMemory). There's no price list to fill in: treatment prices come
// from the job, mostly per linear metre or per station.
const QUOTE_CATALOGUE = {
  barrier_lm:    { desc: 'Chemical soil treatment (termite barrier)', unit: 'lm', price: 28 },
  barrier_job:   { desc: 'Chemical soil treatment (termite barrier)', unit: 'job', price: 2400 },
  bait_install:  { desc: 'Termite baiting system: supply and install stations', unit: 'station', price: 165 },
  bait_monitor:  { desc: 'Bait station monitoring and servicing (12 months)', unit: 'year', price: 480 },
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
let quoteReturnTo = 'menu';   // 'menu' | 'app' — where Back goes
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
    // A change after sending moves the steps and the Send button on.
    renderQuoteAnswer();
  } catch (e) {
    setQuoteSaveState('Not saved');
    showToast('Could not save the quote — device storage may be full', 'error');
  }
}
function scheduleQuoteSave() {
  setQuoteSaveState('Saving…');
  clearTimeout(quoteSaveTimer);
  quoteSaveTimer = setTimeout(persistQuote, 400);
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
function classifyTreatment(text) {
  const t = (text || '').toLowerCase();
  if (/exterra|sentricon|trelona|bait/.test(t)) return 'bait';
  if (/homeguard|kordon|termimesh|reticulation|physical|existing system|top.?up/.test(t)) return 'system';
  if (/termidor|altriset|phantom|premise|fipronil|chlorantraniliprole|bifenthrin|biflex|talstar|maxxthor|chemical|barrier|soil treat/.test(t)) return 'barrier';
  return 'generic';
}

// Every system the recommendation names, in the order classifyTreatment
// checks them. "chemical barrier or baiting system" gives ['bait', 'barrier'].
function treatmentKinds(text) {
  const t = (text || '').toLowerCase();
  const kinds = [];
  if (/exterra|sentricon|trelona|bait/.test(t)) kinds.push('bait');
  if (/homeguard|kordon|termimesh|reticulation|physical|existing system|top.?up/.test(t)) kinds.push('system');
  if (/termidor|altriset|phantom|premise|fipronil|chlorantraniliprole|bifenthrin|biflex|talstar|maxxthor|chemical|barrier|soil treat/.test(t)) kinds.push('barrier');
  return kinds;
}

// The systems to ask about when the recommendation offers a choice
// ("chemical barrier or baiting"), or [] when it names one (or names two to
// do together).
function treatmentChoices(text) {
  const kinds = treatmentKinds(text);
  return kinds.length > 1 && /\bor\b|\/|\beither\b/i.test(text || '') ? kinds : [];
}

const QUOTE_SYSTEM_LABELS = { bait: 'Baiting system', barrier: 'Chemical barrier', system: 'Existing system top-up' };

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
  const wantsTreatment = rd.treatmentRecommended === 'YES' || (treatmentType && rd.treatmentRecommended !== 'NO') || active.length > 0;

  // Active workings get a direct treatment each, so the client sees every
  // location the report found live termites at.
  // The detail is the location only: the species line and the report's
  // recommendation wording are for the report, not the client's quote.
  active.forEach((f, i) => {
    items.push(newQuoteItem('direct', {
      detail: (f.activityLocation || '').trim(),
      source: `Finding ${findings.indexOf(f) + 1}: active termites`,
    }));
  });

  if (wantsTreatment) {
    const choices = treatmentChoices(treatmentType);
    const kind = system || (choices.length ? 'ask' : classifyTreatment(treatmentType));
    // The main line's detail stays empty: the recommendation sentence is the
    // report's wording (and may name other systems), so it is not copied.
    const detail = '';
    const src = treatmentType ? `Recommendation: ${treatmentType}` : 'Recommendation: treatment';
    if (kind === 'barrier') {
      const lm = treatmentType.match(/(\d+(?:\.\d+)?)\s*(?:linear\s*)?(?:lm|m|metres|meters)\b/i);
      items.push(lm
        ? newQuoteItem('barrier_lm', { detail, qty: parseFloat(lm[1]), source: src })
        : newQuoteItem('barrier_job', { detail, source: src }));
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
  if (rd.borerActivity === 'ACTIVE') {
    const live = (Array.isArray(rd.borerFindings) ? rd.borerFindings : []).filter(b => b && b.borerActivity === 'ACTIVE')
      .map(b => [b.location, b.timberAffected].filter(Boolean).join(', ')).filter(Boolean);
    items.push(newQuoteItem('borer', { detail: live.length ? live.join('; ') : (rd.borerDetails || ''), source: 'Finding: active borers' }));
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
// by mergeSpokenQuote in js/app.js). Its lines replace the ones the builder
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
  if (/barrier|soil treatment|perimeter|trench|reticulat/.test(d)) return /^(lm|m|metre|meter|linear)/.test(u) ? 'barrier_lm' : 'barrier_job';
  if (/top.?up|re-?treat/.test(d)) return 'system_topup';
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
// it's opened, unless the client has answered it or the job is complete.
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

// What the quote fixes, in a sentence or two for the client, from the
// report's findings: live termites and where, past activity, live borers,
// and the conditions that invite termites. Locations are as the inspector
// wrote them. No risk rating and no verdict on the structure.
function buildQuoteProblem(rd) {
  rd = rd || {};
  const lc = v => { v = (v || '').trim(); return /^[A-Z][a-z]/.test(v) ? v[0].toLowerCase() + v.slice(1) : v; };
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
  const src = currentQuoteSource();
  const rd = src && (src.key === (currentReportId || 'draft') ? reportData : src.reportData);
  return buildQuoteProblem(rd);
}

function buildQuoteExclusions(rd) {
  rd = rd || {};
  const out = [];
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
    out.push(`Repair or replacement of decayed timbers${rd.decayDetails ? ` (${rd.decayDetails})` : ''} by a licensed builder, and fixing the moisture that caused it.`);
  }
  if (rd.waterLeaks === 'YES') {
    out.push(`Repair of the moisture source${rd.leakLocation ? ` (${rd.leakLocation})` : ''} by a licensed plumber or builder.`);
  }
  if (rd.antCapping === 'GAPS' || rd.antCapping === 'NONE') {
    out.push(`Repair or installation of ant caps${rd.antCappingDetails ? ` (${rd.antCappingDetails})` : ''} by a builder.`);
  }
  if (rd.highRiskAreas) {
    out.push(`Areas not accessible at inspection (${rd.highRiskAreas}) unless access is provided.`);
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
  const lc = v => { v = (v || '').trim(); return /^[A-Z][a-z]/.test(v) ? v[0].toLowerCase() + v.slice(1) : v; };
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
    else if (kind === 'system') out.push(`Top up the existing termite management system${rd.existingSystem ? ` (${rd.existingSystem})` : ''}.`);
    else if (kind) out.push('Install a termite management system.');
  }
  if (rd.borerActivity === 'ACTIVE') out.push('Treat the timbers with live borers.');
  if (rd.timberSoil === 'YES') out.push('Remove the timber touching the soil.');
  if (rd.weepHoles === 'BRIDGED') out.push('Clear the bridged weep holes.');
  if (rd.slabEdge === 'OBSTRUCTED') out.push('Expose the concealed slab edge so it can be inspected.');
  if (wants && kind) out.push('Fit a durable notice in the meter box showing what was used and when.');
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
  if (rd.timberSoil === 'YES') out.push('Keep timber, firewood and stored goods off the soil and away from the walls.');
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

function quotePlanReport() {
  const src = currentQuoteSource();
  return src ? (src.key === (currentReportId || 'draft') ? reportData : src.reportData) : null;
}

// One line for the folded row: what's set, and what's still to choose.
function quotePlanSummary(q) {
  const p = q && q.plan;
  if (!p) return ['No plan yet', true];
  const steps = (p.we || '').split('\n').filter(l => l.trim()).length + (p.owner || '').split('\n').filter(l => l.trim()).length;
  const bits = [`${steps} step${steps === 1 ? '' : 's'}`];
  bits.push(p.time ? (QUOTE_PLAN_TIMES.includes(p.time) ? p.time.charAt(0).toLowerCase() + p.time.slice(1) + ' on site' : p.time) : 'job time not set');
  bits.push(p.service ? (p.service === 'None' ? 'no service period' : `${p.service} service`) : 'service period not set');
  return [bits.join(', '), !p.time || !p.service];
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
  const [sub, warn] = quotePlanSummary(q);
  const subEl = document.getElementById('quotePlanSub');
  subEl.textContent = sub;
  subEl.classList.toggle('warn', warn);
  const p = q.plan;
  if (!p) {
    body.innerHTML = `<div class="quote-hint" style="margin-top:0">Set out how the job will go: what you'll do, what the owner should do, how long it takes and the free service period. It starts from the report.</div>
      <button class="quote-btn" style="margin-top:10px" onclick="addQuotePlan()">Add a plan from the report</button>`;
    return;
  }
  // The two lists of steps read as bullets, and the timing as a side line
  // from the day of the job to the inspections after it.
  body.innerHTML = `
    <div class="fsub">What we'll do<button type="button" class="link-btn fsub-action" onclick="editQuoteList('qPlanWe')">Edit</button></div>
    <textarea class="quote-input quote-textarea" id="qPlanWe" rows="3" data-qlist="No steps yet. Tap to add one." aria-label="What we'll do, one step per line" oninput="fitQuoteText(this); onQuotePlanInput()">${escapeHtml(p.we || '')}</textarea>
    <div class="fsub">What the owner does<button type="button" class="link-btn fsub-action" onclick="editQuoteList('qPlanOwner')">Edit</button></div>
    <textarea class="quote-input quote-textarea" id="qPlanOwner" rows="3" data-qlist="Nothing asked of the owner yet. Tap to add." aria-label="What we ask the owner to do, one per line" placeholder="e.g. Keep garden beds below the weep holes" oninput="fitQuoteText(this); onQuotePlanInput()">${escapeHtml(p.owner || '')}</textarea>
    <div class="fsub">Timing</div>
    <div class="q-line">
      <div class="quote-field"><span>On the day: time on site</span><div class="qp-chips">${quotePlanChipsHTML('time', QUOTE_PLAN_TIMES, p.time)}</div></div>
      <div class="quote-field"><span>After: free service period</span><div class="qp-chips">${quotePlanChipsHTML('service', QUOTE_PLAN_SERVICE, p.service)}</div>
        ${p.service && p.service !== 'None' ? '<div class="quote-hint">The quote says it only holds while the recommended inspections are kept up and the owner does their part.</div>' : ''}</div>
      <label class="quote-field"><span>Then: timber pest inspections</span>
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
  quoteState.plan = buildQuotePlan(quotePlanReport(), c && c.picked);
  renderQuotePlan();
  scheduleQuoteSave();
}

function rebuildQuotePlan() {
  const q = quoteState;
  if (!q || !q.plan) return;
  if (!confirm('Replace the plan\'s steps with fresh ones from the report? Your edits to them will be lost.')) return;
  const c = q.systemChoice;
  const fresh = buildQuotePlan(quotePlanReport(), c && c.picked);
  q.plan.we = fresh.we;
  q.plan.owner = fresh.owner;
  q.plan.inspections = fresh.inspections;
  renderQuotePlan();
  scheduleQuoteSave();
}

function onQuotePlanInput() {
  const p = quoteState && quoteState.plan;
  if (!p) return;
  p.we = document.getElementById('qPlanWe').value;
  p.owner = document.getElementById('qPlanOwner').value;
  p.inspections = document.getElementById('qPlanInspections').value;
  const [sub, warn] = quotePlanSummary(quoteState);
  const subEl = document.getElementById('quotePlanSub');
  subEl.textContent = sub;
  subEl.classList.toggle('warn', warn);
  scheduleQuoteSave();
}

function setQuotePlanChoice(field, value) {
  const p = quoteState && quoteState.plan;
  if (!p) return;
  p[field] = p[field] === value ? '' : value;
  renderQuotePlan();
  scheduleQuoteSave();
}

function typeQuotePlanChoice(field) {
  const p = quoteState && quoteState.plan;
  if (!p) return;
  const typed = prompt(field === 'time' ? 'How long will the job take on site?' : 'How long is the free service period?', p[field] || '');
  if (typed === null) return;
  p[field] = typed.trim();
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

// ── NAVIGATION ──────────────────────────────────────────────────────────────
function openQuote(from, preferKey) {
  quoteReturnTo = from || 'menu';
  document.getElementById('mainMenu').style.display = 'none';
  document.getElementById('app').style.display = 'none';
  document.getElementById('quoteScreen').classList.add('open');
  installQuoteLockGuard();
  quoteSources = collectQuoteSources();
  renderQuoteSourceOptions(preferKey);
  onQuoteSourceChange();
  renderDocStrips();
  document.querySelector('#quoteScreen .quote-scroll').scrollTop = 0;
  track('screen_viewed', { screen: 'quote' });
}

function openQuoteFromReport() {
  const sidebar = document.getElementById('sidebarPanel');
  if (sidebar && sidebar.classList.contains('open')) toggleDrawer();
  openQuote('app', currentReportId || 'draft');
}

function closeQuote() {
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
function formatAUD(n) {
  const v = isFinite(n) ? n : 0;
  return v.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
}

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
  if (quoteState) { clearTimeout(quoteSaveTimer); persistQuote(); }
  const src = currentQuoteSource();
  const editor = document.getElementById('quoteEditor');
  const bar = document.getElementById('quoteBar');
  quoteOpenItems.clear();
  if (!src) { quoteState = null; editor.style.display = 'none'; bar.style.display = 'none'; return; }
  const saved = quoteForReport(src.key, src.address);
  quoteState = saved || createQuoteFromSource(src);
  const heard = saved && applySpokenQuote(quoteState, src.key === (currentReportId || 'draft') ? reportData : src.reportData);
  if (!saved || heard) persistQuote();
  else setQuoteSaveState('Saved');
  if (heard) showToast('Quote updated from your voice notes', 'success');
  renderQuoteEditor();
  renderQuoteLock();
  editor.style.display = 'flex';
  bar.style.display = '';
  ['quoteDetailsFold', 'quoteTermsFold'].forEach(id => { document.getElementById(id).open = false; });
  // The work stays folded unless there's a system to pick or no lines yet.
  const c = quoteState.systemChoice;
  document.getElementById('quoteWorkFold').open = !quoteState.items.length || !!(c && !c.picked && c.options && c.options.length);
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
  renderQuoteAnswer();
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

// The one-line summaries on the folded sections.
function renderQuoteFolds() {
  const q = quoteState;
  if (!q) return;
  const email = (q.clientEmail || '').trim();
  const det = [q.client || 'No client name', email || 'no email yet'];
  const detSub = document.getElementById('quoteDetailsSub');
  detSub.textContent = det.join(', ');
  detSub.classList.toggle('warn', !email);
  const excl = (q.exclusions || '').split('\n').filter(l => l.trim()).length;
  document.getElementById('quoteTermsSub').textContent =
    [(q.paymentTerms || '').trim() ? 'Payment terms set' : 'No payment terms', `${excl} exclusion${excl === 1 ? '' : 's'}`].join(', ');
}

// What's missing from the business details, which every quote's header shows.
function renderQuoteCompanyGaps() {
  const gaps = companyDetailGaps();
  const el = document.getElementById('quoteCompanyGaps');
  el.style.display = gaps.length ? '' : 'none';
  el.innerHTML = gaps.length
    ? `<div>Your quote won't show your ${escapeHtml(joinWithAnd(gaps))}. Clients and insurers look for these.</div>` +
      (canEditBusiness() ? '<button class="quote-link-btn" onclick="openBusinessForm(renderQuoteCompanyGaps)">Add them</button>' : '')
    : '';
}

// When the recommendation offers more than one system, the inspector picks
// which one this quote is for. Shown above the line items until picked.
function renderQuoteSystemChoice() {
  const el = document.getElementById('quoteSystemChoice');
  if (!el) return;
  const c = quoteState && quoteState.systemChoice;
  if (!c || c.picked || !Array.isArray(c.options) || !c.options.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
  const src = currentQuoteSource();
  const rec = src && src.reportData ? (src.reportData.treatmentType || '') : '';
  el.style.display = '';
  el.innerHTML = `<div class="quote-system-q">The report's advice names more than one system. Which do you want to quote?</div>${rec ? `
    <div class="quote-system-rec">${escapeHtml(rec)}</div>` : ''}
    <div class="quote-answer-btns">${c.options.map(k =>
      `<button class="quote-btn" onclick="pickQuoteSystem('${k}')">${escapeHtml(QUOTE_SYSTEM_LABELS[k] || k)}</button>`).join('')}</div>`;
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
  q.systemChoice.picked = kind;
  // The plan's steps name the system, so they follow the pick unless edited.
  if (q.plan && q.plan.we === buildPlanWe(rd)) {
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
      <label class="quote-field"><span>What</span><textarea class="quote-input quote-item-desc" rows="1" placeholder="e.g. Chemical soil treatment"
        oninput="fitQuoteText(this); updateQuoteItem('${id}','desc',this.value)">${escapeHtml(it.desc)}</textarea></label>
      <label class="quote-field"><span>Details (optional)</span><textarea class="quote-input quote-item-detail" rows="1" placeholder="e.g. Front porch post, left side"
        oninput="fitQuoteText(this); updateQuoteItem('${id}','detail',this.value)">${escapeHtml(it.detail)}</textarea></label>
      <div class="quote-item-nums">
        <label class="quote-field"><span>Qty</span><input class="quote-input" type="number" min="0" step="any" inputmode="decimal" value="${escapeHtml(String(it.qty))}"
          oninput="updateQuoteItem('${id}','qty',this.value)"></label>
        <label class="quote-field"><span>Unit</span><input class="quote-input" value="${escapeHtml(it.unit)}"
          oninput="updateQuoteItem('${id}','unit',this.value)"></label>
        <label class="quote-field"><span>Price each, ex GST</span><input class="quote-input" type="number" min="0" step="any" inputmode="decimal" value="${escapeHtml(String(it.price))}"
          oninput="markQuotePriceSet('${id}'); updateQuoteItem('${id}','price',this.value)" onchange="rememberQuotePrice('${it.key}', parseFloat(this.value))"></label>
      </div>
      ${it.source ? `<div class="quote-item-source">From the report: ${escapeHtml(it.source)}</div>` : ''}
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
}

// The folded work row: how many lines, any prices still to check, the total.
function renderQuoteWorkSummary() {
  const q = quoteState;
  const sub = document.getElementById('quoteItemCount');
  if (!q || !sub) return;
  const n = q.items.length;
  const starting = q.items.filter(isStartingPrice).length;
  sub.textContent = !n ? 'No lines yet' : `${n} line${n === 1 ? '' : 's'}` + (starting ? `, ${starting} price${starting === 1 ? '' : 's'} to check` : '');
  sub.classList.toggle('warn', !n || starting > 0);
  document.getElementById('quoteWorkTotal').textContent = n ? formatAUD(quoteTotals(q).total) : '';
}

// Explains the amber tag, only while a line still has one.
function renderQuoteStartHint() {
  const el = document.getElementById('quoteStartHint');
  if (!el || !quoteState) return;
  renderQuoteWorkSummary();
  const any = quoteState.items.some(isStartingPrice);
  el.style.display = '';
  el.innerHTML = (any ? '<b>Starting price</b> is a suggested rate. Tap a line to set your own, and new quotes start at your price. ' : '') +
    'You can also say the quote in your report voice notes: the work, prices, what isn\'t included and how they pay.';
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
  q.client = document.getElementById('qClient').value;
  q.clientPhone = document.getElementById('qClientPhone').value;
  q.clientEmail = document.getElementById('qClientEmail').value;
  q.address = document.getElementById('qAddress').value;
  q.number = document.getElementById('qNumber').value;
  q.validDays = parseInt(document.getElementById('qValidDays').value, 10) || '';
  const problem = document.getElementById('qProblem').value;
  if (problem !== quoteProblem(q)) q.problem = problem;
  if (q.gst !== document.getElementById('qGst').checked) {
    q.gst = document.getElementById('qGst').checked;
    rememberQuoteGst(q.gst);
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

function rebuildQuoteFromReport() {
  const src = currentQuoteSource();
  if (!src || !quoteState) return;
  if (quoteState.items.length && !confirm('Replace the line items, exclusions and the problem with fresh ones from the report? Your edits to them will be lost.')) return;
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
// older version. Recording an answer doesn't change the quote itself, so it
// works on a completed (locked) job.
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

// One line for the job banner and the saved reports list, or null when the
// job has no quote. tone: 'good' | 'bad' | 'wait' | 'warn'.
function quoteAnswerSummary(q) {
  if (!quoteHasItems(q)) return null;
  const a = quoteAnswerState(q);
  if (!a && q.linkRequest) checkQuoteLink(q, false);
  if (!a) return q.sentAt ? { short: 'Quote sent', text: quoteLinkCurrent(q) ? 'Quote sent with a link to accept it. Waiting on the client' : 'Waiting on the client\'s answer to the quote', tone: 'wait' } : null;
  if (a.stale) return { short: 'Quote changed', text: 'The quote changed after the client answered. Get their answer on the new version', tone: 'warn' };
  if (a.status === 'accepted' && q.treatment) return { short: 'Treatment done', text: `Treatment done on ${formatAnswerDate(q.treatment.date)}. ${certificateGiven(q) ? 'Certificate given' : 'Send the client the certificate'}`, tone: 'good' };
  if (a.status === 'accepted') return { short: 'Quote accepted', text: `Quote accepted by ${a.by} on ${formatAnswerDate(a.date)}. Record the treatment once it's done`, tone: 'good' };
  return { short: 'Quote declined', text: `Quote declined on ${formatAnswerDate(a.date)}${a.note ? ` · ${a.note}` : ''}`, tone: 'bad' };
}

// The job's progress, at the foot of the quote: priced, sent, the client's
// answer and the treatment, each with where it's up to and what to do next.
function renderQuoteAnswer() {
  const el = document.getElementById('quoteAnswer');
  const q = quoteState;
  renderQuoteHead();
  renderQuoteSendLabel();
  if (!q || !el) return;
  const a = quoteHasItems(q) ? quoteAnswerState(q) : null;
  const esc = escapeHtml;
  const sentNow = !!q.sentAt && q.sentHash === quoteContentHash(q);
  const answered = a && !a.stale;
  const n = q.items.length;
  const starting = q.items.filter(isStartingPrice).length;

  const priced = {
    title: 'Write the quote', state: sentNow || answered ? 'done' : 'now',
    text: !n ? 'No lines yet. Add the work below.' : `${n} line${n === 1 ? '' : 's'}, ${formatAUD(quoteTotals(q).total)}${q.gst !== false ? ' inc GST' : ''}`
      + (starting ? `, ${starting} starting price${starting === 1 ? '' : 's'} to check` : ''),
  };
  const sent = !q.sentAt
    ? { title: 'Sent to the client', state: answered ? 'skip' : 'todo', text: answered ? 'Not needed. They answered before it was sent.' : 'Not sent yet. Send it from the bar below.' }
    : sentNow || answered ? { title: 'Sent to the client', state: 'done', text: `Sent ${esc(formatIssueDate(q.sentAt))}.` }
    : { title: 'Sent to the client', state: 'warn', text: `Sent ${esc(formatIssueDate(q.sentAt))}. You've changed the quote since, so send the new version.` };

  let answer;
  const link = quoteLinkCurrent(q);
  if (!a && link && sentNow) {
    checkQuoteLink(q, false);
    answer = {
      title: 'Client\'s answer', state: 'now',
      text: `The quote went with a link. When ${esc((q.client || 'the client').split(/\s+/)[0])} taps Accept or Decline on their phone, it shows here. Heard back another way? Record it below.`,
      extra: `<div class="qp-links">
          <button class="quote-text-btn" onclick="checkQuoteLink(quoteState, true)">Check now</button>
          <button class="quote-text-btn" onclick="shareQuoteLink(quoteState)">Share the link</button>
        </div>
        <div class="quote-answer-btns">
          <button class="quote-btn" onclick="openQuoteAnswer('accepted')">Accepted</button>
          <button class="quote-btn" onclick="openQuoteAnswer('declined')">Declined</button>
        </div>`,
    };
  } else if (!a) {
    answer = {
      title: 'Client\'s answer', state: sentNow ? 'now' : 'todo',
      text: q.sentAt ? 'Waiting on the client. Record their answer when it comes.' : 'Already answered on the spot or by phone? Record it here.',
      extra: q.sentAt
        ? `<div class="quote-answer-btns">
            <button class="quote-btn primary" onclick="openQuoteAnswer('accepted')">Accepted</button>
            <button class="quote-btn" onclick="openQuoteAnswer('declined')">Declined</button>
          </div>`
        : `<div class="qp-links">
            <button class="quote-text-btn" onclick="openQuoteAnswer('accepted')">Accepted</button>
            <button class="quote-text-btn" onclick="openQuoteAnswer('declined')">Declined</button>
          </div>`,
    };
  } else {
    const how = a.status === 'accepted' ? (QUOTE_ANSWER_METHODS[a.method] || '') : a.method === 'link' ? 'from the link on their phone' : '';
    answer = {
      title: 'Client\'s answer', state: a.stale ? 'warn' : a.status === 'accepted' ? 'done' : 'bad',
      text: `<strong>${a.status === 'accepted' ? 'Accepted' : 'Declined'}</strong> by ${esc(a.by)} on ${esc(formatAnswerDate(a.date))}${how ? `, ${esc(how)}` : ''}`,
      extra: `${a.note ? `<div class="quote-answer-note">${esc(a.note)}</div>` : ''}
        ${isSignatureImage(a.signature) ? `<img class="quote-answer-sig" src="${a.signature}" alt="Client signature">` : ''}
        ${a.stale ? '<div class="quote-answer-warn">The quote has changed since then. Send the new version and record the client\'s answer again.</div>' : ''}
        <button class="quote-text-btn" onclick="clearQuoteAnswer()">${a.stale ? 'Record a new answer' : 'Change answer'}</button>`,
    };
  }

  const treatment = answered && a.status === 'accepted'
    ? { title: 'Treatment', state: q.treatment && certificateGiven(q) ? 'done' : 'now',
        text: !q.treatment ? 'Record it once the work is done.'
          : q.certificateSentAt ? `Finished. Certificate emailed ${esc(formatIssueDate(q.certificateSentAt))}.`
          : q.certificateHandedAt ? `Finished. Certificate given in person ${esc(formatIssueDate(q.certificateHandedAt))}.`
          : 'Recorded. One thing left: email the client their certificate.',
        extra: renderTreatmentBlock(q) }
    : answered ? { title: 'Treatment', state: 'skip', text: 'Not needed. The quote was declined.' }
    : { title: 'Treatment', state: 'todo', text: 'After the client accepts.' };

  const steps = [priced, sent, answer, treatment];
  // A step the job didn't need counts as done, so progress still reaches 4 of 4.
  const done = steps.filter(st => st.state === 'done' || st.state === 'skip').length;
  const tick = '<svg class="icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  // Each step is updated in place: step 1 holds the quote's folds, and
  // rebuilding it would drop whatever is being typed there.
  document.getElementById('quoteGuideCount').textContent = `${done} of 4 done`;
  steps.forEach((st, i) => {
    const li = document.getElementById('qgStep' + (i + 1));
    if (!li) return;
    li.className = 'qp-step ' + st.state;
    li.querySelector('.qp-dot').innerHTML = st.state === 'done' ? tick : st.state === 'skip' ? '–' : String(i + 1);
    li.querySelector('.qp-title').textContent = st.title;
    li.querySelector('.qp-text').innerHTML = st.text;
    const extra = li.querySelector('.qp-extra');
    const html = st.extra || '';
    if (extra.dataset.html !== html) { extra.innerHTML = html; extra.dataset.html = html; }
    extra.hidden = !html;
  });
}

// The bar's Send button says what sending does now.
function renderQuoteSendLabel() {
  const el = document.getElementById('quoteSendLabel');
  const q = quoteState;
  if (!el || !q) return;
  el.textContent = !q.sentAt ? 'Send to client' : q.sentHash === quoteContentHash(q) ? 'Send again' : 'Send new version';
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
  document.getElementById('qaMethod').value = 'signed';
  document.getElementById('qaAcceptText').textContent =
    `I accept quote ${quoteState.number || ''} for ${formatAUD(quoteTotals(quoteState).total)}${quoteState.gst !== false ? ' (inc GST)' : ''} and authorise the work described in it.`;
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
  renderQuoteAnswer();
  if (typeof renderIssueState === 'function') renderIssueState();
  if (typeof renderSavedList === 'function') renderSavedList();
  showToast(accepted ? 'Quote accepted' : 'Quote marked as declined', 'success');
  track('quote_answered', { answer: quoteAnswerMode, method: method || 'none' });
}

function clearQuoteAnswer() {
  const q = quoteState;
  if (!q || !q.answer) return;
  if (!confirm(q.treatment
    ? 'Clear the client\'s answer to this quote? The treatment record and certificate stay.'
    : 'Clear the client\'s recorded answer to this quote?')) return;
  delete q.answer;
  clearTimeout(quoteSaveTimer);
  persistQuote();
  storeQuoteOnReport(q, true);
  renderQuoteAnswer();
  if (typeof renderIssueState === 'function') renderIssueState();
  if (typeof renderSavedList === 'function') renderSavedList();
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
          readyToast: 'Quote ready — choose where to save or send it',
        });
      })
      .catch(e => {
        console.error('Quote PDF failed:', e);
        reportError(e, 'quote_pdf');
        showToast((e && e.message) || 'Could not generate the PDF — check your connection and try again', 'error');
      })
      .finally(() => { btn.disabled = false; });
  }, 50);
}

// Remember every line's price, not just ones edited this session, so a quote
// that goes to a client becomes the business's price list for next time.
function rememberQuotePrices(q) {
  q.items.forEach(it => rememberQuotePrice(it.key, parseFloat(it.price)));
  if (q.paymentTerms !== undefined) rememberPaymentTerms(q.paymentTerms.trim());
}

// ── SENT AND LOCKED ─────────────────────────────────────────────────────────
// A quote records when it went to the client and a hash of what it said, so
// the job can only be completed once the client has the current quote (see
// COMPLETED JOBS in js/app.js). Once the job is complete the quote is locked
// with its report until the job is amended.
function quoteHasItems(q) { return !!(q && q.items && q.items.length); }
function quoteContentHash(q) {
  const content = Object.assign({}, q);
  // 'booking' and 'invoice' are left over from features that were removed;
  // older quotes may still carry them, and they never counted as content.
  ['updatedAt', 'createdAt', 'sentAt', 'sentHash', 'certificateSentAt', 'certificateHandedAt', 'reportKey', 'answer', 'booking', 'treatment', 'invoice',
    'sourceAddress', 'issuedAt', 'issuedHash', 'linkRequest'].forEach(k => delete content[k]);
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
  if (quoteState && quoteState.reportKey === q.reportKey) renderQuoteAnswer();
  if (typeof renderIssueState === 'function') renderIssueState();
}
function isQuoteLocked() {
  const src = currentQuoteSource();
  const rd = src && (src.key === (currentReportId || 'draft') ? reportData : src.reportData);
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
    if (!isQuoteLocked() || e.target.closest('#quotePdfBtn, #quoteEmailBtn, #quoteAnswer, .qi-row, .qi-done, .quote-hero-name, .quote-hero-problem, summary')) return;
    if (e.type === 'touchstart') return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'focusin' && e.target.blur) e.target.blur();
    if (e.type === 'click') showToast('This job is complete and locked. Amend it from the report to change the quote', 'info');
  };
  ['mousedown', 'click', 'focusin', 'keydown'].forEach(t => editor.addEventListener(t, stop, true));
}

// Emails the quote PDF to the client. The PDF is built right here, inside
// the tap, because the share sheet won't open after a wait.
function emailQuoteToClient() {
  if (!quoteState) return;
  clearTimeout(quoteSaveTimer);
  persistQuote();
  storeQuoteOnReport(quoteState, true);
  rememberQuotePrices(quoteState);
  if (!jsPDF) {
    ensureJsPDFLoaded()
      .then(() => showToast('Ready — tap Email to client again', 'info'))
      .catch(e => showToast((e && e.message) || 'Could not load the PDF tools', 'error'));
    return;
  }
  const q = quoteState;
  const btn = document.getElementById('quoteEmailBtn');
  (async () => {
    // The link the client accepts from goes in the message. Making it needs
    // signal and a moment; without either the quote still goes as before.
    let link = null;
    if (authSession && navigator.onLine && !quoteLinkCurrent(q)) {
      btn.disabled = true;
      document.getElementById('quoteSendLabel').textContent = 'Making the link…';
      const files = { quote: buildQuotePDF(q) };
      if (q.reportKey === (currentReportId || 'draft')) {
        try { files.report = await buildReportPdf(); } catch (e) { reportError(e, 'quote_link_report'); }
      }
      link = await ensureQuoteLink(q, files);
      btn.disabled = false;
      renderQuoteSendLabel();
    } else link = quoteLinkCurrent(q);
    const sent = await sendPdfsToClient({
      files: [buildQuotePDF(q)],
      to: (q.clientEmail || '').trim(),
      subject: `Quote ${q.number || ''} — ${q.address || 'your property'}`.replace('  ', ' '),
      body: clientMessage({ client: q.client, address: q.address, docs: 'treatment quote', signOff: q.inspector, link: link ? quoteLinkUrl(link.id) : '' }),
    });
    if (sent) { markQuoteSent(q); track('quote_sent', { with_link: !!link }); }
  })();
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

// What the client's page shows: everything the quote PDF says.
function quoteLinkDoc(q, files) {
  const company = getCompanyDetails();
  const totals = quoteTotals(q);
  const issued = quoteIssuedAt(q);
  const validDays = parseInt(q.validDays, 10) || 30;
  const plan = q.plan || {};
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
    plan: { time: (plan.time || '').trim(), service: (plan.service || '').trim(), inspections: repairPlanInspections(plan.inspections),
      we: lines(plan.we), owner: lines(plan.owner) },
    exclusions: lines(q.exclusions), notes: lines(q.notes), paymentTerms: (q.paymentTerms || '').trim(),
    files: files || {},
    acceptText: `I accept quote ${q.number || ''} for ${formatAUD(totals.total)}${q.gst !== false ? ' (inc GST)' : ''} and authorise the work described in it.`,
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
  if (!authSession || !authUser || !navigator.onLine || !quoteHasItems(q)) return null;
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
  return `Hi ${(q.client || '').trim().split(/\s+/)[0] || 'there'}, here is the treatment quote from ${company} for ${q.address || 'your property'}. Open it to read it and accept or decline on your phone:`;
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
    prompt('Copy this link and send it to the client:', url);
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
    if (q.linkRequest !== r || q.answer) return;
    if (row && (row.status === 'signed' || row.status === 'declined')) {
      const accepted = row.status === 'signed';
      q.answer = { status: accepted ? 'accepted' : 'declined', by: row.signer_name || q.client || '', date: isoDate(new Date(row.signed_at)),
        method: 'link', note: (row.note || '').trim(), at: Date.now(), hash: r.hash };
      if (accepted && isSignatureImage(row.signature)) q.answer.signature = row.signature;
      delete q.linkRequest;
      storeSentQuote(q);
      if (typeof renderSavedList === 'function') renderSavedList();
      showToast(accepted ? `${q.answer.by} accepted the quote` : `${q.answer.by} declined the quote`, accepted ? 'success' : 'info');
      track('quote_answered', { answer: q.answer.status, method: 'link' });
    } else if (byTap) {
      showToast(row && row.status === 'cancelled' ? 'That link was cancelled' : 'No answer yet', 'info');
    }
  } catch (e) {
    if (byTap) showToast('Could not check. Try again when you have signal', 'error');
  }
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

// A table's heading row: a pale teal band, so tables print light.
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

function drawPdfDocFooters(doc, label) {
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
  const plan = q.plan || {};
  const planLines = v => (v || '').split('\n').map(s => s.trim()).filter(Boolean);
  const we = planLines(plan.we), owner = planLines(plan.owner);
  const facts = [['TIME ON SITE', plan.time], ['FREE SERVICE PERIOD', plan.service], ['INSPECTIONS AFTER', repairPlanInspections(plan.inspections)]]
    .map(([k, v]) => [k, (v || '').trim()]).filter(([, v]) => v);
  if (we.length || owner.length || facts.length) {
    const gap = 4, fw = facts.length ? (CW - gap * (facts.length - 1)) / facts.length : CW;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
    const wrapped = facts.map(([, v]) => doc.splitTextToSize(v, fw - 8));
    const fh = facts.length ? 10 + Math.max(...wrapped.map(l => l.length)) * 4.4 : 0;
    sectionTitle('TREATMENT PLAN', sectionNum++, facts.length ? fh + 6 : 18);
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

  drawPdfDocFooters(doc, `Quote ${q.number || ''}${company.name ? `  ·  ${company.name}` : ''}`);

  const safe = fileNamePart(q.address) || 'Property';
  return { blob: doc.output('blob'), fname: `SAYON_Quote_${(q.number || '').replace(/[^\w-]+/g, '')}_${safe}.pdf` };
}
