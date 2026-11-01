// ── BAIT STATION VISITS ─────────────────────────────────────────────────────
// Once a baiting system is in (the treatment record ticks "Termite baiting
// system installed"), the technician comes back to check the stations until
// the baiting is finished. Each visit is kept with the quote, beside the
// treatment record, so it syncs with the report:
// q.baitVisits = [{ id, date, technician, licence, stations: [{ n, where,
// status, bait, note }], product: { name, active, batch }, nextVisit
// (YYYY-MM-DD, '' once finished), finished, notes, signature, at, sentAt }].
// Each visit gives the client a visit report PDF. The job's page lists the
// visits as a stage after Treatment, and the job comes back to To do when
// the next one is due.

// What a station can show. pdf is the client's wording.
const BAIT_STATUSES = {
  clear:    { label: 'Clear', pdf: 'No activity' },
  active:   { label: 'Active', pdf: 'Termites active' },
  eaten:    { label: 'Bait eaten', pdf: 'Bait eaten, no termites seen' },
  damaged:  { label: 'Damaged', pdf: 'Damaged or disturbed' },
  missing:  { label: 'Missing', pdf: 'Missing' },
  noaccess: { label: 'Couldn\'t check', pdf: 'Could not be checked' },
};
const BAIT_FEEDING = ['active', 'eaten'];
const BAIT_PROBLEMS = ['damaged', 'missing', 'noaccess'];
// The next visit starts here and the technician sets it to the bait's label:
// 4 weeks while termites are feeding, 3 months when every station is quiet.
const BAIT_WEEKS_FEEDING = 4;
const BAIT_MONTHS_QUIET = 3;

function baitInstalled(q) {
  return !!(q && q.treatment && q.treatment.methods && 'bait' in q.treatment.methods);
}

// Oldest first.
function baitVisitsOf(q) {
  const list = q && Array.isArray(q.baitVisits) ? q.baitVisits.slice() : [];
  return list.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || (a.at || 0) - (b.at || 0));
}

function addDaysIso(iso, days) {
  const d = new Date((iso || todayIsoDate()) + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

// Where the baiting is up to: the visits so far, whether it's finished, and
// when the next check is due (the first, 4 weeks after the install).
function baitProgram(q) {
  if (!baitInstalled(q)) return null;
  const visits = baitVisitsOf(q);
  const last = visits[visits.length - 1] || null;
  const finished = !!(last && last.finished);
  const due = finished ? '' : last ? (last.nextVisit || '') : addDaysIso(q.treatment.date, BAIT_WEEKS_FEEDING * 7);
  const today = todayIsoDate();
  return { visits, last, finished, due, dueNow: !!due && due <= today, overdue: !!due && due < today };
}

// The stage on the job's page.
function baitJobStep(b) {
  const n = b.visits.length;
  const plural = n === 1 ? '' : 's';
  const text = b.finished ? `Finished after ${n} visit${plural}`
    : !b.due ? `${n} visit${plural}`
    : `${n ? `${n} visit${plural}, next` : 'First check'} due ${dashDay(b.due)}${b.overdue ? ', overdue' : ''}`;
  return { label: 'Bait station visits', to: 'bait', state: b.finished ? 'done' : b.dueNow ? 'now' : 'todo', text };
}

function baitStationNumbers(stations, status) {
  return stations.filter(s => s.status === status).map(s => s.n);
}

// A few words for the visit's row: "2 of 12 active, 1 missing".
function baitVisitShort(v) {
  const s = v.stations || [];
  const bits = [];
  const count = k => s.filter(x => x.status === k).length;
  if (count('active')) bits.push(`${count('active')} of ${s.length} active`);
  if (count('eaten')) bits.push(`${count('eaten')} bait eaten`);
  if (count('damaged')) bits.push(`${count('damaged')} damaged`);
  if (count('missing')) bits.push(`${count('missing')} missing`);
  if (count('noaccess')) bits.push(`${count('noaccess')} not checked`);
  return bits.length ? bits.join(', ') : `All ${s.length} clear`;
}

// What the visit found, in sentences, for the client's report.
function baitVisitSummary(v) {
  const s = v.stations || [];
  const which = nums => `station${nums.length === 1 ? '' : 's'} ${joinWithAnd(nums.map(String))}`;
  const lines = [`${s.length} station${s.length === 1 ? '' : 's'} checked.`];
  const active = baitStationNumbers(s, 'active');
  const eaten = baitStationNumbers(s, 'eaten');
  const clear = baitStationNumbers(s, 'clear');
  if (active.length) lines.push(`Termites active in ${which(active)}.`);
  if (eaten.length) lines.push(`Bait eaten with no termites seen in ${which(eaten)}.`);
  if (clear.length) lines.push(clear.length === s.length ? 'No activity in any station.' : `No activity in ${clear.length === 1 ? which(clear) : `the other ${clear.length}`}.`);
  BAIT_PROBLEMS.forEach(k => { const nums = baitStationNumbers(s, k); if (nums.length) lines.push(`${which(nums).replace(/^s/, 'S')}: ${BAIT_STATUSES[k].pdf.toLowerCase()}.`); });
  const fed = s.filter(x => (x.bait || '').trim());
  if (fed.length) lines.push(`Bait added to ${which(fed.map(x => x.n))}.`);
  return lines.join(' ');
}

function baitVisitNumber(q, v) {
  const n = baitVisitsOf(q).findIndex(x => x.id === v.id) + 1;
  return `${treatmentCertNumber(q, 'BV')}-${n || 1}`;
}

// ── ON THE QUOTE ── Under the treatment certificate.
function renderBaitBlock(q) {
  const b = baitProgram(q);
  if (!b) return '';
  const esc = escapeHtml;
  const stations = parseInt(q.treatment.methods.bait, 10) || 0;
  const n = b.visits.length;
  const status = b.finished ? `Baiting finished on ${esc(formatAnswerDate(b.last.date))}, after ${n} visit${n === 1 ? '' : 's'}.`
    : !n ? `First check of the stations due ${esc(formatAnswerDate(b.due))}${stations ? `. ${stations} station${stations === 1 ? '' : 's'} installed` : ''}.`
    : `${n} visit${n === 1 ? '' : 's'} so far. Next due ${esc(formatAnswerDate(b.due))}${b.overdue ? ', overdue' : ''}.`;
  const newest = b.visits.slice().reverse();
  const rows = newest.map((v, i) => {
    const sent = v.sentAt ? `Emailed ${esc(formatIssueDate(v.sentAt))}` : 'Not sent yet';
    // The newest visit's report, not sent yet, is the obvious next tap.
    const lead = i === 0 && !v.sentAt;
    return `<div class="bait-visit-row">
        <div class="bait-visit-main"><strong>${esc(formatAnswerDate(v.date))}</strong> · ${esc(baitVisitShort(v))}</div>
        <div class="bait-visit-sent${v.sentAt ? ' sent' : ''}">${sent}</div>
        <div class="bait-visit-actions">
          <button class="${lead ? 'quote-btn primary' : 'quote-link-btn'}" onclick="emailBaitVisit('${esc(v.id)}')">${v.sentAt ? 'Email again' : `Email report${q.client ? ' to ' + esc(q.client.trim().split(/\s+/)[0]) : ''}`}</button>
          <button class="quote-link-btn" onclick="downloadBaitVisit('${esc(v.id)}')">PDF</button>
          <button class="quote-link-btn" onclick="openBaitVisit('${esc(v.id)}')">Edit</button>
        </div>
      </div>`;
  }).join('');
  return `<div class="qp-cert bait-card${b.finished ? ' sent' : ''}" id="qpBait">
      <div class="qp-cert-title">Bait station visits</div>
      <p class="qp-cert-text">${status}</p>
      ${baitPlanHTML(q, b.last)}
      ${rows ? `<div class="bait-visits">${rows}</div>` : ''}
      <div class="quote-step-actions">
        <button class="${b.finished || (newest[0] && !newest[0].sentAt) ? 'quote-link-btn' : 'quote-btn primary'}" onclick="openBaitVisit()">${b.finished ? 'Record another visit' : 'Record a visit'}</button>
      </div>
    </div>`;
}

// The site plan with each station coloured by what a visit found, so the
// card shows where the activity is at a glance.
function baitStatusesOf(v) {
  const out = {};
  ((v && v.stations) || []).forEach(s => { if (s.status) out[s.n] = s.status; });
  return out;
}

function baitPlanHTML(q, v) {
  const plan = q.treatment && q.treatment.plan;
  if (typeof sitePlanStations !== 'function' || !sitePlanStations(plan).length) return '';
  const statuses = v ? baitStatusesOf(v) : null;
  return `<div class="bait-plan">
      ${sitePlanSVG(plan, { statuses })}
      <div class="bait-plan-caption">${v ? `Stations as found on ${escapeHtml(formatAnswerDate(v.date))}` : 'Stations as installed'}</div>
      ${sitePlanLegendHTML(plan, { statuses, stationsOnly: true })}
    </div>`;
}

// ── THE VISIT SHEET ──
let baitPad = null;
// The visit on the sheet: { id (null for a new one), stations, nextTouched }.
let baitDraft = null;

function draftBaitVisit(q, prev) {
  const t = q.treatment;
  const signedIn = (typeof authUser !== 'undefined' && authUser && authUser.user_metadata && authUser.user_metadata.name) || '';
  const count = parseInt(t.methods.bait, 10) || 0;
  // The stations and where they are carry over; what was found doesn't.
  // A first visit takes them from the site plan when one was drawn.
  const drawn = typeof sitePlanStations === 'function' ? sitePlanStations(t.plan) : [];
  const drawnWhere = n => { const d = drawn.find(x => x.n === n); return d ? (d.label || '').trim() : ''; };
  const stations = prev && prev.stations && prev.stations.length
    ? prev.stations.map(s => ({ n: s.n, where: s.where || drawnWhere(s.n), status: '', bait: '', note: '' }))
    : drawn.length ? drawn.slice(0, 99).map(d => ({ n: d.n, where: (d.label || '').trim(), status: '', bait: '', note: '' }))
    : Array.from({ length: Math.min(count, 99) }, (_, i) => ({ n: i + 1, where: '', status: '', bait: '', note: '' }));
  // The bait the last visit used, else the one the treatment record named.
  const fromRecord = (t.products || []).find(p => BAIT_PRODUCT_RE.test(`${p.name || ''} ${p.active || ''}`));
  const product = prev && prev.product && prev.product.name ? { name: prev.product.name, active: prev.product.active || '', batch: prev.product.batch || '' }
    : fromRecord ? { name: fromRecord.name || '', active: fromRecord.active || '', batch: fromRecord.batch || '' }
    : { name: '', active: '', batch: '' };
  return { date: todayIsoDate(), technician: signedIn || t.technician || '', licence: t.licence || '', stations, product, nextVisit: '', finished: false, notes: '' };
}

function openBaitVisit(id) {
  const q = quoteState;
  if (!q || !baitInstalled(q)) return;
  const visits = baitVisitsOf(q);
  const existing = id ? visits.find(v => v.id === id) : null;
  const v = existing ? JSON.parse(JSON.stringify(existing)) : draftBaitVisit(q, visits[visits.length - 1]);
  baitDraft = { id: existing ? existing.id : null, stations: v.stations || [], nextTouched: !!existing };
  track('screen_viewed', { screen: 'bait_visit' });
  document.getElementById('baitTitle').textContent = existing ? 'Edit the bait station visit' : 'Bait station visit';
  document.getElementById('bvDate').value = v.date || todayIsoDate();
  document.getElementById('bvTech').value = v.technician || '';
  document.getElementById('bvLicence').value = v.licence || '';
  document.getElementById('bvProduct').value = (v.product && v.product.name) || '';
  document.getElementById('bvActive').value = (v.product && v.product.active) || '';
  document.getElementById('bvBatch').value = (v.product && v.product.batch) || '';
  document.getElementById('bvNext').value = v.nextVisit || '';
  document.getElementById('bvFinished').checked = !!v.finished;
  document.getElementById('bvNotes').value = v.notes || '';
  onBaitFinishedChange();
  renderBaitStations();
  cancelSheetVoice('bait');
  document.getElementById('baitOverlay').classList.add('open');
  document.querySelector('#baitOverlay .page-sheet-body').scrollTop = 0;
  if (!baitPad) baitPad = createSignaturePad(document.getElementById('bvSigCanvas'), document.getElementById('bvSigPlaceholder'), updateBaitSaveBtn);
  baitPad.show(v.signature || '');
  updateBaitSaveBtn();
}

function closeBaitVisit() {
  cancelSheetVoice('bait');
  document.getElementById('baitOverlay').classList.remove('open');
}

function baitStationHTML(s, i) {
  const esc = escapeHtml;
  const feeding = BAIT_FEEDING.includes(s.status);
  const problem = BAIT_PROBLEMS.includes(s.status);
  return `<div class="bait-station${s.status ? ' set ' + s.status : ''}" data-i="${i}">
      <div class="bait-station-head">
        <span class="bait-station-no" aria-hidden="true">${s.n}</span>
        <input class="job-input bait-station-where" value="${esc(s.where || '')}" placeholder="Where, e.g. rear left corner" aria-label="Where station ${s.n} is" oninput="baitDraft.stations[${i}].where = this.value">
      </div>
      <div class="qp-chips bait-chips" role="radiogroup" aria-label="What you found at station ${s.n}">
        ${Object.entries(BAIT_STATUSES).map(([k, st]) => `<button type="button" role="radio" aria-checked="${s.status === k}" class="qp-chip bait-chip ${k}${s.status === k ? ' on' : ''}" onclick="setBaitStation(${i}, '${k}')">${st.label}</button>`).join('')}
      </div>
      ${feeding || (s.bait || '').trim() ? `<label class="bait-station-extra"><span>Bait added</span><input class="job-input" value="${esc(s.bait || '')}" placeholder="e.g. 2 cartridges, blank if none" oninput="baitDraft.stations[${i}].bait = this.value"></label>` : ''}
      ${problem || (s.note || '').trim() ? `<label class="bait-station-extra"><span>What you did</span><input class="job-input" value="${esc(s.note || '')}" placeholder="e.g. Lid replaced" oninput="baitDraft.stations[${i}].note = this.value"></label>` : ''}
    </div>`;
}

function renderBaitStations() {
  const list = document.getElementById('bvStations');
  const none = !baitDraft.stations.length;
  document.getElementById('bvCountRow').style.display = none ? '' : 'none';
  document.getElementById('bvStationTools').style.display = none ? 'none' : '';
  list.innerHTML = baitDraft.stations.map(baitStationHTML).join('');
  updateBaitSummary();
}

// Redraws one station, so the list doesn't jump.
function redrawBaitStation(i) {
  const el = document.querySelector(`#bvStations .bait-station[data-i="${i}"]`);
  if (el) el.outerHTML = baitStationHTML(baitDraft.stations[i], i);
}

function setBaitStation(i, status) {
  const s = baitDraft.stations[i];
  if (!s) return;
  s.status = s.status === status ? '' : status;
  redrawBaitStation(i);
  baitStatusChanged();
}

function markRestBaitClear() {
  let n = 0;
  baitDraft.stations.forEach((s, i) => { if (!s.status) { s.status = 'clear'; redrawBaitStation(i); n++; } });
  if (!n) { showToast('Every station is already marked', 'info'); return; }
  baitStatusChanged();
}

function setBaitStationCount() {
  const n = Math.min(parseInt(document.getElementById('bvCount').value, 10) || 0, 99);
  if (n < 1) { showToast('Type how many stations are in the ground', 'error'); return; }
  baitDraft.stations = Array.from({ length: n }, (_, i) => ({ n: i + 1, where: '', status: '', bait: '', note: '' }));
  renderBaitStations();
}

function addBaitStation() {
  const n = baitDraft.stations.reduce((m, s) => Math.max(m, s.n), 0) + 1;
  baitDraft.stations.push({ n, where: '', status: '', bait: '', note: '' });
  renderBaitStations();
  const last = document.querySelector('#bvStations .bait-station:last-child .bait-station-where');
  if (last) last.focus();
}

function removeLastBaitStation() {
  const s = baitDraft.stations[baitDraft.stations.length - 1];
  if (!s) return;
  if (s.status && !confirmRemoveBait(s)) return;
  baitDraft.stations.pop();
  renderBaitStations();
  baitStatusChanged();
}
// A station already marked asks first, so a stray tap doesn't lose it.
function confirmRemoveBait(s) {
  const btn = document.getElementById('bvRemoveStation');
  if (btn.dataset.armed === String(s.n)) { delete btn.dataset.armed; btn.textContent = 'Remove the last station'; return true; }
  btn.dataset.armed = String(s.n);
  btn.textContent = `Tap again to remove station ${s.n}`;
  return false;
}

// The next visit follows what was found, until it's set by hand.
function baitStatusChanged() {
  updateBaitSummary();
  suggestBaitNextVisit();
  updateBaitSaveBtn();
}

function suggestBaitNextVisit() {
  if (!baitDraft || baitDraft.nextTouched || document.getElementById('bvFinished').checked) return;
  const s = baitDraft.stations;
  if (!s.some(x => x.status)) return;
  const date = document.getElementById('bvDate').value || todayIsoDate();
  document.getElementById('bvNext').value = s.some(x => BAIT_FEEDING.includes(x.status))
    ? addDaysIso(date, BAIT_WEEKS_FEEDING * 7) : addMonthsIso(date, BAIT_MONTHS_QUIET);
}

function onBaitNextInput() {
  baitDraft.nextTouched = !!document.getElementById('bvNext').value;
  updateBaitSaveBtn();
}

function onBaitDateChange() {
  suggestBaitNextVisit();
}

function onBaitFinishedChange() {
  const done = document.getElementById('bvFinished').checked;
  document.getElementById('bvNextWrap').hidden = done;
  if (!done) suggestBaitNextVisit();
  updateBaitSaveBtn();
}

function onBaitProductName(inp) {
  const name = Object.keys(TREATMENT_PRODUCTS).find(p => p.toLowerCase() === inp.value.trim().toLowerCase());
  const active = document.getElementById('bvActive');
  if (name && !active.value.trim()) active.value = TREATMENT_PRODUCTS[name];
}

function updateBaitSummary() {
  const s = baitDraft.stations;
  const el = document.getElementById('bvSummary');
  if (!s.length) { el.textContent = ''; return; }
  const left = s.filter(x => !x.status).length;
  const bits = Object.entries(BAIT_STATUSES).map(([k, st]) => {
    const n = s.filter(x => x.status === k).length;
    return n ? `${n} ${k === 'noaccess' ? 'not checked' : st.label.toLowerCase()}` : '';
  }).filter(Boolean);
  if (left) bits.push(`${left} still to mark`);
  el.textContent = `${s.length} station${s.length === 1 ? '' : 's'}: ${bits.join(', ')}`;
}

// What still stops the save, in words, or '' when it can be saved.
function baitSaveNeed() {
  const s = baitDraft ? baitDraft.stations : [];
  if (!s.length) return 'Add the stations first.';
  const left = s.filter(x => !x.status).length;
  if (left) return `Mark ${left === s.length ? 'each station' : `the ${left} station${left === 1 ? '' : 's'} left`}, or tap Rest are clear.`;
  if (!document.getElementById('bvFinished').checked && !document.getElementById('bvNext').value) return 'Set the next visit, or tick Baiting finished.';
  if (!baitPad || baitPad.empty) return 'Sign the visit.';
  return '';
}

function updateBaitSaveBtn() {
  const need = baitSaveNeed();
  document.getElementById('bvSaveBtn').disabled = !!need;
  const el = document.getElementById('bvNeed');
  el.textContent = need;
  el.hidden = !need;
  const by = document.getElementById('bvSigBy');
  if (by) by.textContent = document.getElementById('bvTech').value.trim() || 'the technician';
}

function saveBaitVisit() {
  const q = quoteState;
  if (!q || !baitDraft) return;
  const need = baitSaveNeed();
  if (need) { showToast(need, 'error'); return; }
  const v = id => document.getElementById(id).value.trim();
  const finished = document.getElementById('bvFinished').checked;
  const visit = {
    id: baitDraft.id || 'bv' + Date.now().toString(36),
    date: v('bvDate') || todayIsoDate(),
    technician: v('bvTech'),
    licence: v('bvLicence'),
    stations: baitDraft.stations.map(s => ({ n: s.n, where: (s.where || '').trim(), status: s.status, bait: (s.bait || '').trim(), note: (s.note || '').trim() })),
    product: { name: v('bvProduct'), active: v('bvActive'), batch: v('bvBatch') },
    nextVisit: finished ? '' : v('bvNext'),
    finished,
    notes: v('bvNotes'),
    signature: baitPad.canvas.toDataURL('image/png'),
    at: Date.now(),
  };
  const old = (q.baitVisits || []).find(x => x.id === visit.id);
  // An edit that changes what the client was told needs sending again.
  const said = x => JSON.stringify([x.date, x.stations, x.product, x.nextVisit, x.finished, x.notes, x.technician, x.licence]);
  if (old && old.sentAt && said(old) === said(visit)) visit.sentAt = old.sentAt;
  q.baitVisits = [...(q.baitVisits || []).filter(x => x.id !== visit.id), visit];
  clearTimeout(quoteSaveTimer);
  persistQuote();
  storeQuoteOnReport(q, true);
  closeBaitVisit();
  renderQuoteAnswer();
  if (typeof renderSavedList === 'function') renderSavedList();
  showToast(visit.sentAt ? 'Visit saved' : 'Visit saved. Email the client their visit report', 'success');
  track('bait_visit_recorded', { stations: visit.stations.length, active: visit.stations.filter(s => BAIT_FEEDING.includes(s.status)).length, finished });
  // The report to email is the next tap.
  setTimeout(() => { const card = document.getElementById('qpBait'); if (card) card.scrollIntoView({ block: 'center' }); }, 60);
}

// ── SAID INSTEAD OF TYPED ──
// What the "Say it instead" button on the visit sends with the note (see SAY
// IT INSTEAD in js/app.js). The stations on the sheet go with it, so "the
// one by the shed" can find its number.
function baitVoicePrompt() {
  const stations = (baitDraft ? baitDraft.stations : []).map(s => `${s.n}${s.where ? ` (${s.where})` : ''}`).join(', ') || 'none yet';
  return `You fill in a termite bait station visit for SAYON, an app for Australian timber pest technicians. The user message is what the technician said about checking the bait stations, and the date today. The stations on this visit: ${stations}. Return ONLY a JSON object, no markdown, with these keys, each null unless the technician said it:
{"date":"YYYY-MM-DD","technician":string,"licence":string,"stations":[{"n":number,"status":"clear"|"active"|"eaten"|"damaged"|"missing"|"noaccess","bait":string,"note":string,"where":string}],"restClear":boolean,"product":{"name":string,"batch":string},"nextVisitDate":"YYYY-MM-DD","nextVisitWeeks":number,"nextVisitMonths":number,"finished":boolean,"notes":string}
- stations: each station they mention, by number, or by where it is when that matches a station above. A range counts for every station in it ("1 to 5 clear" is stations 1, 2, 3, 4 and 5).
- status: "clear" for no activity, nothing, untouched or dry; "active" for termites in it, live termites, feeding or workers present; "eaten" for bait eaten or gone with no termites in it now; "damaged" for broken, lid off, dug up, mowed over or flooded; "missing" for gone or can't be found; "noaccess" for couldn't get to it, covered over or locked away.
- bait: how much bait they added to that station, as said ("2 cartridges", "1 matrix"). Null when none.
- note: what they did about a damaged, missing or unreachable station ("lid replaced", "reinstalled").
- where: only when they say where a station is.
- restClear: true when they say all the others, or the rest, are clear.
- product: the bait used, brand name as written on the box ("extera" is Exterra, "centricon" is Sentricon, "trelona" is Trelona), and its batch number.
- nextVisitDate, nextVisitWeeks or nextVisitMonths: when the next visit is, as said. finished: true when they say the baiting is finished, the colony is gone and no more visits are needed.
- notes: anything for the client ("keep the mulch clear of station 4").
- Only words actually said. Never guess, and never invent an amount or a batch number.`;
}

// Fills the open visit from the spoken note. Returns how many boxes changed.
function applyBaitVoice(f) {
  let n = 0;
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.date || '')) n += setSpokenBox('bvDate', f.date);
  n += setSpokenBox('bvTech', f.technician);
  n += setSpokenBox('bvLicence', f.licence);
  const said = Array.isArray(f.stations) ? f.stations : [];
  said.forEach(x => {
    const num = parseInt(x && x.n, 10);
    if (!(num >= 1 && num <= 99)) return;
    let s = baitDraft.stations.find(st => st.n === num);
    // A station said that isn't on the list yet is one more in the ground.
    if (!s && num <= baitDraft.stations.length + 3) {
      for (let k = baitDraft.stations.reduce((m, st) => Math.max(m, st.n), 0) + 1; k <= num; k++) baitDraft.stations.push({ n: k, where: '', status: '', bait: '', note: '' });
      s = baitDraft.stations.find(st => st.n === num);
    }
    if (!s) return;
    if (BAIT_STATUSES[x.status] && s.status !== x.status) { s.status = x.status; n++; }
    ['bait', 'note', 'where'].forEach(k => { const val = x[k] == null ? '' : String(x[k]).trim(); if (val && s[k] !== val) { s[k] = val; n++; } });
  });
  if (f.restClear) baitDraft.stations.forEach(s => { if (!s.status) { s.status = 'clear'; n++; } });
  if (f.product && typeof f.product === 'object') {
    const name = Object.keys(TREATMENT_PRODUCTS).find(k => k.toLowerCase() === String(f.product.name || '').trim().toLowerCase()) || String(f.product.name || '').trim();
    if (name && setSpokenBox('bvProduct', name)) { n++; onBaitProductName(document.getElementById('bvProduct')); }
    n += setSpokenBox('bvBatch', f.product.batch);
  }
  if (f.finished === true && !document.getElementById('bvFinished').checked) { document.getElementById('bvFinished').checked = true; n++; }
  const date = document.getElementById('bvDate').value || todayIsoDate();
  const next = /^\d{4}-\d{2}-\d{2}$/.test(f.nextVisitDate || '') ? f.nextVisitDate
    : Number(f.nextVisitWeeks) > 0 ? addDaysIso(date, Math.round(Number(f.nextVisitWeeks) * 7))
    : Number(f.nextVisitMonths) > 0 ? addMonthsIso(date, Number(f.nextVisitMonths)) : '';
  if (next && f.finished !== true) {
    if (setSpokenBox('bvNext', next)) n++;
    baitDraft.nextTouched = true;
  }
  n += setSpokenBox('bvNotes', f.notes);
  renderBaitStations();
  onBaitFinishedChange();
  baitStatusChanged();
  return n;
}

// ── THE CLIENT'S VISIT REPORT ──
function findBaitVisit(id) {
  const q = quoteState;
  return q && (q.baitVisits || []).find(v => v.id === id);
}

function downloadBaitVisit(id) {
  const q = quoteState, v = findBaitVisit(id);
  if (!v) return;
  ensureJsPDFLoaded()
    .then(() => buildBaitVisitPDF(q, v))
    .then(({ blob, fname }) => { track('bait_visit_pdf_made'); return deliverPdfBlob(blob, fname, {
      title: 'Bait station visit report',
      text: `Bait station visit report — ${q.address || 'Property'}`,
      readyToast: 'Visit report ready — choose where to save or send it',
    }); })
    .catch(e => {
      console.error('Bait visit PDF failed:', e);
      reportError(e, 'bait_visit_pdf');
      showToast((e && e.message) || 'Could not make the visit report. Try again', 'error');
    });
}

// Built inside the tap, like the certificate, because the share sheet won't
// open after a wait.
function emailBaitVisit(id) {
  const q = quoteState, v = findBaitVisit(id);
  if (!v) return;
  if (!jsPDF) {
    ensureJsPDFLoaded()
      .then(() => showToast('Ready. Tap Email again to send it', 'info'))
      .catch(e => showToast((e && e.message) || 'Could not load the PDF tools', 'error'));
    return;
  }
  sendPdfsToClient({
    files: [buildBaitVisitPDF(q, v)],
    to: (q.clientEmail || '').trim(),
    subject: `Bait station visit report — ${q.address || 'your property'}`,
    body: clientMessage({ client: q.client, address: q.address, docs: 'bait station visit report', signOff: v.technician }),
  }).then(sent => {
    if (!sent) return;
    v.sentAt = Date.now();
    storeSentQuote(q);
    track('bait_visit_sent');
  });
}

function buildBaitVisitPDF(q, v) {
  const C = PDF_COLORS;
  const t = q.treatment || {};
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 15, CW = W - M * 2, BOTTOM = 281;
  const company = getCompanyDetails();
  const number = baitVisitNumber(q, v);
  const docName = 'Bait Station Visit Report';
  const stations = v.stations || [];
  let y = 0;

  const ensure = h => {
    if (y + h <= BOTTOM) return;
    const font = doc.getFont(), size = doc.getFontSize(), color = doc.getTextColor();
    doc.addPage();
    y = drawPdfRunningHeader(doc, company, docName, q.address, number);
    doc.setFont(font.fontName, font.fontStyle); doc.setFontSize(size); doc.setTextColor(color);
  };
  // The certificate's light section heads.
  const section = title => {
    ensure(24);
    y += 1;
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
  const cellRow = pairs => {
    const cells = pairs.filter(([, val]) => val);
    if (!cells.length) return;
    const w = (CW - (cells.length - 1) * 6) / cells.length;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    const lines = cells.map(([, val]) => doc.splitTextToSize(String(val), w));
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

  y = drawPdfDocCover(doc, company, { compact: true, kicker: 'Termite baiting system', title: docName, date: formatLongDate(v.date), left: [
    ['CLIENT', q.client || 'Not specified'],
    ['PROPERTY ADDRESS', q.address || 'Not specified'],
    ['CONTACT', [q.clientPhone, q.clientEmail].map(val => (val || '').trim()).filter(Boolean).join('  ·  ')],
  ], right: [
    ['REPORT NO.', number],
    ['VISIT DATE', formatLongDate(v.date)],
    ['TECHNICIAN', v.technician],
    ['LICENCE NO.', v.licence],
    ['SYSTEM INSTALLED', t.date ? formatLongDate(t.date) : ''],
  ] });

  // ── WHAT WE FOUND ──
  section('WHAT WE FOUND');
  const mapped = typeof sitePlanStations === 'function' && sitePlanStations(t.plan).length > 0;
  para(baitVisitSummary(v) + (mapped ? ' The station map on the last page shows where each station is and what was found there.' : ''), { size: 9.5, lh: 4.6, after: 2 });
  const feeding = stations.filter(s => BAIT_FEEDING.includes(s.status)).length;
  const p = v.product || {};
  const bait = [p.name, p.name && p.active ? `(${p.active})` : p.active].filter(Boolean).join(' ');
  cellRow([
    ['Stations checked', String(stations.length)],
    ['Termites feeding', `${feeding} of ${stations.length}`],
    ['Next visit', v.finished ? 'None, baiting finished' : v.nextVisit ? formatLongDate(v.nextVisit) : ''],
    ['Bait used', [bait, p.batch ? `batch ${p.batch}` : ''].filter(Boolean).join(', ')],
  ]);

  // ── STATIONS ── Only the columns something was entered in.
  section('EACH STATION');
  const optional = [
    { h: 'WHERE', w: 52, f: s => s.where },
    { h: 'BAIT ADDED', w: 32, f: s => s.bait },
    { h: 'NOTE', w: 40, f: s => s.note },
  ].filter(c => stations.some(s => String(c.f(s) || '').trim()));
  const cols = [{ h: 'NO.', w: 12, f: s => String(s.n) }, ...optional.slice(0, 1), { h: 'FINDING', w: 44, f: s => (BAIT_STATUSES[s.status] || {}).pdf || '' }, ...optional.slice(1)];
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
  stations.forEach((s, i) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    const cells = cols.map(c => doc.splitTextToSize(c.f(s) || '', c.w - 3));
    // Short rows: twelve or more stations still leave room for the sign-off.
    const rowH = Math.max(...cells.map(l => l.length * 3.6)) + 1.7;
    if (y + rowH > BOTTOM) { doc.addPage(); y = drawPdfRunningHeader(doc, company, docName, q.address, number); head(); }
    if (i % 2 === 1) { doc.setFillColor(...C.rowAlt); doc.rect(M, y, CW, rowH, 'F'); }
    doc.setDrawColor(...C.ruleLight); doc.setLineWidth(0.25); doc.line(M, y + rowH, M + CW, y + rowH);
    let x = M + 3;
    cells.forEach((lines, ci) => {
      const finding = cols[ci].h === 'FINDING';
      // Feeding stations stand out in bold.
      doc.setFont('helvetica', ci === 0 || (finding && BAIT_FEEDING.includes(s.status)) ? 'bold' : 'normal');
      doc.setFontSize(8.5); doc.setTextColor(...(finding && BAIT_FEEDING.includes(s.status) ? C.accentDark : C.ink));
      doc.text(lines, x, y + 3.8);
      x += cols[ci].w;
    });
    y += rowH;
  });
  y += 2;

  // ── WHAT HAPPENS NEXT ──
  const steps = [];
  if (v.finished) steps.push('No more bait station visits are planned. Keep up your timber pest inspections: AS 3660.2 recommends one at least every 12 months.');
  else if (v.nextVisit) steps.push(`Your next bait station visit is due ${formatLongDate(v.nextVisit)}.`);
  if (!v.finished) steps.push('Please do not move, open, cover or remove the stations, and keep mulch, garden beds and stored items clear of them.');
  steps.push('If you see termites, mud leads or new damage, call us. Please do not spray or break open termite workings: it can drive the termites away from the bait.');
  section('WHAT HAPPENS NEXT');
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  steps.forEach((st, i) => {
    const lines = doc.splitTextToSize(st, CW - 7);
    ensure(lines.length * 3.7 + 2);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...C.accentDark);
    doc.text(`${i + 1}.`, M, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.ink);
    doc.text(lines, M + 6, y);
    y += lines.length * 3.7 + 0.8;
  });
  if (v.notes) { y += 1.5; cellRow([['Technician notes', v.notes]]); }

  // ── SIGN-OFF ── kept together.
  const closing = 'Baiting works as termites carry the bait back to their colony, which takes time. This report records what was seen at each station on the day of the visit. It does not report on the rest of the property, and it does not repair existing damage.';
  doc.setFontSize(7);
  const signOffH = 25 + doc.splitTextToSize(closing, CW).length * 3.2;
  const pages = doc.internal.getNumberOfPages();
  ensure(signOffH);
  y += 2;
  if (doc.internal.getNumberOfPages() === pages) { doc.setFillColor(...C.accent); doc.rect(M, y, CW, 0.5, 'F'); }
  y += 14;
  const colW = (CW - 16) / 3;
  drawPdfOnLine(doc, v.technician, M, y, colW);
  drawPdfSignature(doc, { x: M, y, w: colW, caption: v.licence ? `Technician · Licence ${v.licence}` : 'Technician' });
  drawPdfSignature(doc, { x: M + colW + 8, y, w: colW, caption: 'Signature', image: v.signature });
  drawPdfOnLine(doc, formatLongDate(v.date), M + (colW + 8) * 2, y, colW);
  drawPdfSignature(doc, { x: M + (colW + 8) * 2, y, w: colW, caption: 'Date' });
  y += 9;
  para(closing, { size: 7, lh: 3.2, color: C.inkMuted });

  // ── STATION MAP ── The site plan on a page of its own, each station
  // coloured by what this visit found.
  if (mapped) {
    doc.addPage();
    y = drawPdfRunningHeader(doc, company, docName, q.address, number);
    section('STATION MAP');
    para(`Each station is coloured by what was found on ${formatLongDate(v.date)}.`, { size: 9, lh: 4.3, after: 2 });
    y += drawSitePlanPdf(doc, t.plan, { x: M, y: y - 1, w: CW, statuses: baitStatusesOf(v) }) + 5;
    y += drawSitePlanLegendPdf(doc, t.plan, { x: M, y, w: CW, statuses: baitStatusesOf(v) }) + 4;
  }

  drawPdfDocFooters(doc, `Bait station visit ${number}${company.name ? `  ·  ${company.name}` : ''}`);
  const safe = fileNamePart(q.address) || 'Property';
  return { blob: doc.output('blob'), fname: `SAYON_Bait_Visit_${number.replace(/[^\w-]+/g, '')}_${safe}.pdf` };
}
