// ── SAFETY CHECK ────────────────────────────────────────────────────────────
// The technician's check before starting work on site: eight questions on
// the task, the hazards this site has that the safe work method statement
// (SWMS) doesn't cover, each with its control and a risk score from the
// 5 × 5 matrix, the permits, whether the job can be done safely, and the
// technician's signature. One for each visit (the inspection, the
// treatment, the installation on a new construction job, a bait station
// visit), done from This job, where a quiet card asks for it before the
// work and then says when it was done. Kept with the job but not part of
// the report (ISSUE_META_KEYS in js/app/dashboard.js), and not in the job
// PDF that goes to the client: each check has its own PDF.
//   reportData.safetyChecks [{ id, at, for, answers: { <SAFETY_QUESTIONS
//     key>: 'yes'|'no' }, extraHazards: 'yes'|'no', hazards: [{ hazard,
//     control, likelihood: 'A'..'E', consequence: 1..5 }], permits:
//     'done'|'none', safe: 'yes'|'no', name, signature }]

const SAFETY_QUESTIONS = [
  ['understand', 'Do you understand the task?'],
  ['competent', 'Are you competent to do it?'],
  ['procedure', 'Do you have a procedure or SWMS for it?'],
  ['advised', 'Have you told others who may be affected?'],
  ['ppe', 'Do you have the right PPE?'],
  ['danger', 'Is there any danger to people, pets or marine life?'],
  ['hazards', 'Have you found any hazards?'],
  ['siteRisk', 'Does this site need its own risk assessment?'],
];
// The first five want a yes before the work starts.
const SAFETY_WANT_YES = ['understand', 'competent', 'procedure', 'advised', 'ppe'];
// Risk score = the matrix's number for how likely (A almost certain to E
// rare) by how bad (1 insignificant to 5 catastrophic).
const SAFETY_LIKELIHOOD = { A: 'Almost certain', B: 'Likely', C: 'Possible', D: 'Unlikely', E: 'Rare' };
const SAFETY_CONSEQUENCE = ['Insignificant', 'Minor', 'Moderate', 'Major', 'Catastrophic'];
const SAFETY_MATRIX = { A: [11, 16, 20, 23, 25], B: [7, 12, 17, 21, 24], C: [4, 8, 13, 18, 22], D: [2, 6, 9, 14, 19], E: [1, 3, 5, 10, 15] };
const SAFETY_HAZARD_LIST = ['Working at heights', 'Roof void', 'Subfloor or confined space', 'Electrical', 'Asbestos', 'Dogs or other animals',
  'Slips, trips and falls', 'Heat', 'Chemical handling', 'Machinery or traffic on site', 'Open trenches or excavations', 'Overhead power lines', 'Sharp objects'];

function safetyRiskScore(h) {
  const row = SAFETY_MATRIX[h && h.likelihood];
  const c = parseInt(h && h.consequence, 10);
  return row && c >= 1 && c <= 5 ? row[c - 1] : null;
}
function safetyChecksOf(d = reportData) {
  return Array.isArray(d && d.safetyChecks) ? d.safetyChecks : [];
}

// What the check is for: the work this job does next on site, or '' when
// there's none (waiting on the client, or finished).
function safetyWorkFor(j) {
  const to = j && j.next && j.next.to;
  if (!j || j.group === 'done' || isReportLocked()) return '';
  if (j.newBuild) return to === 'treatment' ? 'installation' : '';
  if (j.status === 'Finish the report') return 'inspection';
  if (to === 'treatment') return 'treatment';
  if (to === 'bait' && /due/i.test(j.status)) return 'bait station visit';
  return '';
}

// ── ON THIS JOB ── A card under the Next step: before the work, a quiet
// button to do the check; once it's done today, when and by whom, and its
// PDF. Nothing on a job with no work on site to come and no checks.
function safetyCheckHTML(j) {
  const checks = safetyChecksOf();
  const work = safetyWorkFor(j);
  if (!work && !checks.length) return '';
  const today = checks.filter(c => isoDate(new Date(c.at)) === todayIsoDate());
  const last = today[today.length - 1] || (!work ? checks[checks.length - 1] : null);
  const when = c => isoDate(new Date(c.at)) === todayIsoDate()
    ? `today at ${formatClockTime(new Date(c.at).toTimeString().slice(0, 5))}` : formatLongDate(isoDate(new Date(c.at)));
  const line = last ? `${last.for ? last.for.charAt(0).toUpperCase() + last.for.slice(1) + ', done' : 'Done'} ${when(last)}${last.name ? ' by ' + last.name : ''}${last.safe === 'no' ? '. Not safe to start' : ''}`
    : `Before you start the ${work}`;
  const tile = last ? (last.safe === 'no' ? 'bad' : 'done') : 'todo';
  const tick = '<span class="job-tile-tick"><svg class="icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>';
  const shield = '<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';
  return `
    <section class="job-safety ${tile}">
      <div class="job-pdf-head">
        <span class="job-tile ${tile}" aria-hidden="true">${shield}${tile === 'done' ? tick : ''}</span>
        <span class="job-step-main"><span class="job-step-label">Safety check</span><span class="job-step-text">${escapeHtml(line)}</span></span>
      </div>
      <div class="dash-detail-links">
        ${!last && work ? `<button type="button" class="job-safety-start" onclick="openSafetyCheck('${work}')">Do the safety check</button>` : ''}
        ${last ? `<button type="button" onclick="downloadSafetyCheck('${escapeHtml(last.id)}')">PDF</button>` : ''}
        ${last && work && !today.length ? `<button type="button" onclick="openSafetyCheck('${work}')">Do today's</button>` : ''}
      </div>
    </section>`;
}

// ── THE SHEET ──
let safetyPad = null;
let safetyDraft = null;

function openSafetyCheck(work) {
  if (isReportLocked()) return;
  const me = (typeof authUser !== 'undefined' && authUser && authUser.user_metadata && authUser.user_metadata.name) || inspectorDisplayName();
  safetyDraft = { id: 'sc_' + Date.now().toString(36), for: work || '', answers: {}, extraHazards: '', hazards: [], permits: '', safe: '', name: me };
  document.getElementById('scFor').textContent = work ? `Before the ${work}.` : 'Before the work starts.';
  document.getElementById('scName').value = me;
  document.getElementById('scHazardList').innerHTML = SAFETY_HAZARD_LIST.map(h => `<option value="${escapeHtml(h)}">`).join('');
  renderSafetyQuestions();
  renderSafetyHazards();
  renderSafetyChoice('scExtra', 'extraHazards', [['yes', 'Yes'], ['no', 'No']]);
  renderSafetyChoice('scPermits', 'permits', [['done', 'Permits done'], ['none', 'None needed']]);
  renderSafetyChoice('scSafe', 'safe', [['yes', 'Yes'], ['no', 'No']]);
  showSafetyParts();
  document.getElementById('safetyOverlay').classList.add('open');
  if (!safetyPad) safetyPad = createSignaturePad(document.getElementById('scSigCanvas'), document.getElementById('scSigPlaceholder'), () => { keepSheetSignature(safetyPad, false); updateSafetySaveBtn(); });
  openSheetSignature(safetyPad, '', me);
  updateSafetySaveBtn();
  document.querySelector('#safetyOverlay .page-sheet-body').scrollTop = 0;
  track('screen_viewed', { screen: 'safety_check' });
}
function closeSafetyCheck() {
  forgetSheetFrom('safetyOverlay');
  document.getElementById('safetyOverlay').classList.remove('open');
  safetyDraft = null;
}

// Yes or no as two chips; what's picked is kept on the draft.
function safetyChipsHTML(group, value, options) {
  return options.map(([v, label]) => `<button type="button" role="radio" aria-checked="${value === v}" class="qp-chip${value === v ? ' on' : ''}" onclick="setSafetyAnswer('${group}', '${v}')">${label}</button>`).join('');
}
function renderSafetyQuestions() {
  document.getElementById('scQuestions').innerHTML = SAFETY_QUESTIONS.map(([k, q], i) => {
    const v = safetyDraft.answers[k] || '';
    const warn = v === 'no' && SAFETY_WANT_YES.includes(k);
    return `<div class="sc-question${warn ? ' warn' : ''}">
        <div class="sc-question-text" id="scQ${i}">${escapeHtml(q)}</div>
        <div class="qp-chips" role="radiogroup" aria-labelledby="scQ${i}">${safetyChipsHTML('q:' + k, v, [['yes', 'Yes'], ['no', 'No']])}</div>
        ${warn ? '<p class="sc-warn">Sort this out before you start.</p>' : ''}
      </div>`;
  }).join('');
}
function renderSafetyChoice(id, field, options) {
  document.getElementById(id).innerHTML = safetyChipsHTML(field, safetyDraft[field] || '', options);
}
function setSafetyAnswer(group, value) {
  if (!safetyDraft) return;
  if (group.startsWith('q:')) {
    safetyDraft.answers[group.slice(2)] = value;
    renderSafetyQuestions();
    // A hazard found, or a site that needs its own assessment, goes to the hazards.
    if ((group === 'q:hazards' || group === 'q:siteRisk') && value === 'yes' && !safetyDraft.extraHazards) {
      safetyDraft.extraHazards = 'yes';
      if (!safetyDraft.hazards.length) safetyDraft.hazards.push({ hazard: '', control: '', likelihood: '', consequence: '' });
      renderSafetyHazards();
      renderSafetyChoice('scExtra', 'extraHazards', [['yes', 'Yes'], ['no', 'No']]);
    }
  } else {
    safetyDraft[group] = value;
    if (group === 'extraHazards') {
      if (value === 'yes' && !safetyDraft.hazards.length) safetyDraft.hazards.push({ hazard: '', control: '', likelihood: '', consequence: '' });
      renderSafetyHazards();
      renderSafetyChoice('scExtra', 'extraHazards', [['yes', 'Yes'], ['no', 'No']]);
    }
    if (group === 'permits') renderSafetyChoice('scPermits', 'permits', [['done', 'Permits done'], ['none', 'None needed']]);
    if (group === 'safe') renderSafetyChoice('scSafe', 'safe', [['yes', 'Yes'], ['no', 'No']]);
  }
  showSafetyParts();
  updateSafetySaveBtn();
}
function showSafetyParts() {
  document.getElementById('scHazardWrap').hidden = safetyDraft.extraHazards !== 'yes';
  document.getElementById('scNotSafe').hidden = safetyDraft.safe !== 'no';
}

// Each hazard: what it is, how it's controlled, and how likely and how bad,
// which give its score.
function renderSafetyHazards() {
  const opt = (v, label, on) => `<option value="${v}"${on ? ' selected' : ''}>${label}</option>`;
  document.getElementById('scHazards').innerHTML = safetyDraft.hazards.map((h, i) => {
    const score = safetyRiskScore(h);
    return `<div class="sc-hazard">
        <div class="sc-hazard-head"><span>Hazard ${i + 1}</span>${safetyDraft.hazards.length > 1 ? `<button type="button" class="quote-link-btn" onclick="removeSafetyHazard(${i})">Remove</button>` : ''}</div>
        <input class="job-input" list="scHazardList" value="${escapeHtml(h.hazard || '')}" placeholder="e.g. Roof void" aria-label="Hazard ${i + 1}" oninput="setSafetyHazard(${i}, 'hazard', this.value)">
        <textarea class="job-input" rows="2" placeholder="What you'll do about it" aria-label="Control measures for hazard ${i + 1}" oninput="setSafetyHazard(${i}, 'control', this.value)">${escapeHtml(h.control || '')}</textarea>
        <div class="job-row">
          <select class="job-input" aria-label="How likely" onchange="setSafetyHazard(${i}, 'likelihood', this.value)">${opt('', 'How likely…', !h.likelihood)}${Object.entries(SAFETY_LIKELIHOOD).map(([k, l]) => opt(k, `${k}: ${l}`, h.likelihood === k)).join('')}</select>
          <select class="job-input" aria-label="How bad" onchange="setSafetyHazard(${i}, 'consequence', this.value)">${opt('', 'How bad…', !h.consequence)}${SAFETY_CONSEQUENCE.map((l, n) => opt(n + 1, `${n + 1}: ${l}`, +h.consequence === n + 1)).join('')}</select>
        </div>
        <p class="sc-score" id="scScore${i}">${score ? `Risk score ${score} of 25` : 'Pick both for its risk score'}</p>
      </div>`;
  }).join('');
}
function setSafetyHazard(i, field, value) {
  const h = safetyDraft && safetyDraft.hazards[i];
  if (!h) return;
  h[field] = value;
  if (field === 'likelihood' || field === 'consequence') {
    const score = safetyRiskScore(h);
    document.getElementById('scScore' + i).textContent = score ? `Risk score ${score} of 25` : 'Pick both for its risk score';
  }
}
function addSafetyHazard() {
  safetyDraft.hazards.push({ hazard: '', control: '', likelihood: '', consequence: '' });
  renderSafetyHazards();
}
function removeSafetyHazard(i) {
  safetyDraft.hazards.splice(i, 1);
  renderSafetyHazards();
}

// What the check still needs before it's signed off, or ''.
function safetyCheckGap(d) {
  if (SAFETY_QUESTIONS.some(([k]) => !d.answers[k])) return 'Answer each question first';
  if (!d.extraHazards) return 'Say if there are hazards the SWMS doesn\'t cover';
  if (d.extraHazards === 'yes' && !d.hazards.some(h => (h.hazard || '').trim())) return 'Name the hazard first';
  if (d.extraHazards === 'yes' && d.hazards.some(h => (h.hazard || '').trim() && !(h.control || '').trim())) return 'Say how each hazard is controlled';
  if (!d.permits) return 'Say if permits were needed';
  if (!d.safe) return 'Say if you can do the job safely';
  return '';
}
function updateSafetySaveBtn() {
  document.getElementById('scSaveBtn').disabled = !safetyPad || safetyPad.empty;
}

function saveSafetyCheck() {
  const d = safetyDraft;
  if (!d) return;
  const gap = safetyCheckGap(d);
  if (gap) { showToast(gap, 'error'); return; }
  if (!safetyPad || safetyPad.empty) { showToast('Sign it first', 'error'); return; }
  const check = {
    id: d.id, at: Date.now(), for: d.for, answers: { ...d.answers }, extraHazards: d.extraHazards,
    hazards: d.extraHazards === 'yes' ? d.hazards.filter(h => (h.hazard || '').trim()).map(h => ({ hazard: h.hazard.trim(), control: (h.control || '').trim(), likelihood: h.likelihood || '', consequence: h.consequence ? +h.consequence : '' })) : [],
    permits: d.permits, safe: d.safe,
    name: document.getElementById('scName').value.trim(),
    signature: padSignature(safetyPad),
  };
  reportData.safetyChecks = [...safetyChecksOf(), check];
  if (getFullAddress()) saveCurrentReport(true); else saveDraft();
  closeSafetyCheck();
  if (document.getElementById('jobOverlay').classList.contains('open')) renderJobPage();
  showToast(check.safe === 'no' ? 'Saved. Don\'t start until it\'s safe' : 'Safety check saved', check.safe === 'no' ? 'info' : 'success');
  track('safety_check_saved', { safe: check.safe, hazards: check.hazards.length });
}

// ── ITS PDF ── One page: the job, the answers, the hazards with their
// controls and scores, the permits, and the signature.
function downloadSafetyCheck(id) {
  const c = safetyChecksOf().find(x => x.id === id);
  if (!c) return;
  ensureJsPDFLoaded()
    .then(() => buildSafetyCheckPDF(c))
    .then(({ blob, fname }) => deliverPdfBlob(blob, fname, { title: 'Safety check', text: `Safety check — ${getFullAddress() || 'Property'}`, readyToast: 'Safety check ready. Choose where to save or send it' }))
    .catch(e => { reportError(e, 'safety_pdf'); showToast((e && e.message) || 'Could not make the PDF', 'error'); });
}

function buildSafetyCheckPDF(c) {
  const C = PDF_COLORS;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const M = 15, CW = 180, BOTTOM = 276;
  const company = getCompanyDetails();
  const address = getFullAddress();
  const docName = 'Safety Check';
  const at = new Date(c.at);
  const date = formatLongDate(isoDate(at));
  let y = drawPdfDocCover(doc, company, { compact: true, kicker: 'Work health and safety', title: docName, date, left: [
    ['PROPERTY ADDRESS', address || 'Not specified'],
    ['CLIENT', ((document.getElementById('jobClient') || {}).value || '').trim()],
  ], right: [
    ['DATE', date],
    ['TIME', formatClockTime(at.toTimeString().slice(0, 5))],
    ['FOR', c.for ? c.for.charAt(0).toUpperCase() + c.for.slice(1) : ''],
    ['DONE BY', c.name],
  ] });
  const ensure = h => { if (y + h > BOTTOM) { doc.addPage(); y = drawPdfRunningHeader(doc, company, docName, address, ''); } };
  const section = title => {
    ensure(20);
    y += 2.5;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...C.accentDark);
    pdfTracked(doc, title, M, y, { cs: 0.6 });
    doc.setFillColor(...C.accentLight); doc.rect(M, y + 2, CW, 0.5, 'F');
    y += 7.5;
  };
  const yesNo = v => v === 'yes' ? 'Yes' : v === 'no' ? 'No' : '';
  // A line of question and answer, the answer on the right.
  const answerRow = (q, a, i) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    const lines = doc.splitTextToSize(q, CW - 30);
    const h = lines.length * 4.4 + 3;
    ensure(h);
    if (i % 2 === 1) { doc.setFillColor(...C.rowAlt); doc.rect(M, y - 4, CW, h, 'F'); }
    doc.setTextColor(...C.ink); doc.text(lines, M + 3, y);
    doc.setFont('helvetica', 'bold'); doc.text(a, M + CW - 3, y, { align: 'right' });
    y += h;
  };

  section('BEFORE STARTING');
  SAFETY_QUESTIONS.forEach(([k, q], i) => answerRow(q, yesNo(c.answers[k]), i));

  section('HAZARDS THE SWMS DOESN\'T COVER');
  if (!c.hazards.length) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...C.ink);
    doc.text('None. The safe work method statement covers this site.', M, y); y += 6;
  } else {
    const cols = [{ h: 'HAZARD', w: 50 }, { h: 'CONTROL MEASURES', w: 95 }, { h: 'RISK SCORE', w: 35 }];
    // As the certificate's products table: the head, then each row from its top.
    y -= 3;
    drawPdfTableHeadRule(doc, M, y, CW);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.3); doc.setTextColor(...C.inkLight);
    let x = M + 3; cols.forEach(col => { pdfTracked(doc, col.h, x, y + 5.3, { cs: 0.3 }); x += col.w; });
    y += 8;
    c.hazards.forEach((h, i) => {
      const score = safetyRiskScore(h);
      doc.setFontSize(8.5);
      const cells = [h.hazard, h.control, score ? `${score} (${h.likelihood}${h.consequence})` : 'Not scored'].map((t, ci) => { doc.setFont('helvetica', ci === 0 ? 'bold' : 'normal'); return doc.splitTextToSize(t || '', cols[ci].w - 3); });
      const rowH = Math.max(...cells.map(l => l.length)) * 4 + 4;
      ensure(rowH);
      if (i % 2 === 1) { doc.setFillColor(...C.rowAlt); doc.rect(M, y, CW, rowH, 'F'); }
      doc.setDrawColor(...C.ruleLight); doc.setLineWidth(0.25); doc.line(M, y + rowH, M + CW, y + rowH);
      let cx = M + 3;
      cells.forEach((lines, ci) => { doc.setFont('helvetica', ci === 0 ? 'bold' : 'normal'); doc.setTextColor(...C.ink); doc.text(lines, cx, y + 5); cx += cols[ci].w; });
      y += rowH;
    });
    y += 4;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...C.inkMuted);
    ensure(8);
    doc.text(doc.splitTextToSize('Risk score from the 5 × 5 matrix: how likely (A almost certain, B likely, C possible, D unlikely, E rare) by how bad (1 insignificant to 5 catastrophic), 1 to 25.', CW), M, y + 1);
    y += 8;
  }

  section('BEFORE THE WORK STARTS');
  answerRow('Permits', c.permits === 'done' ? 'Completed' : c.permits === 'none' ? 'Not needed' : '', 0);
  answerRow('Can the job be done safely?', yesNo(c.safe), 1);

  // The acknowledgement and the signature, kept together.
  ensure(40);
  y += 4;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...C.ink);
  const ack = doc.splitTextToSize('By signing, the technician confirms they have been trained in, and understand, the hazards and control measures above.', CW);
  doc.text(ack, M, y); y += ack.length * 4.2 + 18;
  const colW = (CW - 16) / 3;
  drawPdfOnLine(doc, c.name, M, y, colW);
  drawPdfSignature(doc, { x: M, y, w: colW, caption: 'Name' });
  drawPdfSignature(doc, { x: M + colW + 8, y, w: colW, caption: 'Signature', image: c.signature });
  drawPdfOnLine(doc, date, M + (colW + 8) * 2, y, colW);
  drawPdfSignature(doc, { x: M + (colW + 8) * 2, y, w: colW, caption: 'Date' });

  drawPdfDocFooters(doc, `Safety check${company.name ? `  ·  ${company.name}` : ''}`, currentReportId);
  return { blob: doc.output('blob'), fname: pdfFileName('Safety Check', address, { date: isoDate(at) }) };
}
