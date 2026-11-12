// ── THE JOB PDF ─────────────────────────────────────────────────────────────
// Finalising a job, its one ending: the report and quote lock as a version
// (lockJob in js/app/dashboard.js) and every document the job made is
// joined into one PDF behind a contents page: the agreement, the report,
// the quote, the treatment certificate and the bait station visit reports.
// Each part keeps its own PDF. Steps the job skipped (no quote, a declined
// quote, no treatment) are left out, so a report-only job still gets its
// PDF. It's offered on This job once the job's steps are done and the
// client has the report as it stands (jobCanFinalise), not before.
//   reportData.jobPdfAt      when the job PDF was last made
//   reportData.jobPdfSentAt  when it was last emailed
// The pages are joined with pdf-lib (js/vendor), loaded the first time.

let jobPdfLib = null;
function ensurePdfLibLoaded() {
  if (jobPdfLib) return Promise.resolve(jobPdfLib);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'js/vendor/pdf-lib-1.17.1.min.js';
    s.onload = () => { jobPdfLib = window.PDFLib || null; jobPdfLib ? resolve(jobPdfLib) : reject(new Error('The PDF joining tools did not load')); };
    s.onerror = () => { s.remove(); reject(new Error('Could not load the PDF joining tools. Check your signal and try again')); };
    document.head.appendChild(s);
  });
}

// The pages of each PDF (a Blob, its bytes or a loaded PDFDocument), one
// after another, as one new PDFDocument.
async function joinPdfs(lib, pdfs) {
  const out = await lib.PDFDocument.create();
  for (const p of pdfs) {
    const src = p instanceof lib.PDFDocument ? p : await lib.PDFDocument.load(p instanceof Blob ? await p.arrayBuffer() : p);
    (await out.copyPages(src, src.getPageIndices())).forEach(page => out.addPage(page));
  }
  return out;
}

// Where the job PDF is emailed: the job's email, else the quote's.
function jobClientEmailOf() {
  return (reportData.jobClientEmail || (currentJobQuote() || {}).clientEmail || '').trim();
}

// The report counts once it's filled in, made as a PDF or sent.
function jobReportReady() {
  return !!(reportData.issue || reportData.sent || reportData.pdfAt || calculateCompletion() >= 100);
}

// The parts of the job PDF, in the order they go in: { kind, title, note,
// build() → { blob, fname } }. The agreement goes in once. The report
// carries it as its appendix, so with a report its line has no build and
// points there (inReport); with no report yet it's a document of its own.
function jobPdfParts() {
  const q = currentJobQuote();
  const parts = [];
  const a = reportData.agreement;
  const agreement = a && { kind: 'agreement', title: 'Pre-inspection agreement', note: `Signed${a.signerName ? ' by ' + a.signerName : ''}, ${formatAgreementSignedAt(a.signedAt)}` };
  if (agreement && !jobReportReady()) parts.push(Object.assign(agreement, { build: () => buildAgreementPdf(a) }));
  if (jobReportReady()) {
    const sent = reportData.sent ? `sent ${formatIssueDate(reportData.sent.at)}` : 'not sent yet';
    parts.push({ kind: 'report', title: reportKindTitle().replace(/ \w/g, w => w.toLowerCase()), note: `Report ${ensureReportNumber()}, version ${reportVersion()}, ${sent}`, build: () => buildReportPdf() });
    if (agreement) parts.push(Object.assign(agreement, { inReport: true, note: agreement.note + '. At the back of the report' }));
  }
  if (quoteHasItems(q)) {
    const ans = quoteAnswerState(q);
    const how = !ans ? (q.sentAt ? `sent ${formatIssueDate(q.sentAt)}, no answer yet` : 'not sent yet')
      : ans.status === 'accepted' ? `accepted ${formatAnswerDate(ans.date)}${ans.by ? ' by ' + ans.by : ''}` : `declined ${formatAnswerDate(ans.date)}`;
    parts.push({ kind: 'quote', title: `Quote ${q.number || ''}`.trim(), note: `${formatAUD(quoteTotals(q).total)}, ${how}`, build: () => buildQuotePDF(q) });
  }
  if (q && q.treatment) {
    const t = q.treatment;
    parts.push({ kind: 'cert', title: 'Treatment certificate', note: `Treated ${formatAnswerDate(t.date)}${t.technician ? ' by ' + t.technician : ''}`, build: async () => { await loadTreatmentPhotos(q, true); return buildTreatmentCertificatePDF(q); } });
  }
  if (q && typeof baitVisitsOf === 'function') baitVisitsOf(q).forEach(v => {
    parts.push({ kind: 'bait', title: `Bait station visit, ${formatAnswerDate(v.date)}`, note: baitVisitShort(v), build: () => buildBaitVisitPDF(q, v) });
  });
  return parts;
}

// What the job skipped, said once on the contents page.
function jobPdfSkipped() {
  const q = currentJobQuote();
  const ans = quoteHasItems(q) ? quoteAnswerState(q) : null;
  if (!quoteHasItems(q)) return reportData.noQuoteNeeded && reportData.treatmentRecommended === 'YES'
    ? 'No quote: the client isn\'t going ahead with treatment.' : 'No quote was needed.';
  if (ans && ans.status !== 'accepted') return 'The client declined the quote, so there was no treatment.';
  return '';
}

async function buildJobPdf() {
  await ensureJsPDFLoaded();
  const lib = await ensurePdfLibLoaded();
  const parts = jobPdfParts();
  // One row of the contents each. A part with no build (the agreement, at
  // the back of the report) adds no pages: `at` is its page in the report.
  const built = [];
  let reportMade = null;
  for (const part of parts) {
    if (!part.build) { built.push({ part, pages: 0, at: (reportMade && reportMade.agreementPage) || 1 }); continue; }
    const made = await part.build();
    if (part.kind === 'report') reportMade = made;
    const src = await lib.PDFDocument.load(await made.blob.arrayBuffer());
    built.push({ part, src, pages: src.getPageCount() });
  }

  // The contents page, numbered for the pages that follow it. Rows past
  // the first page's room carry on over a second.
  const company = getCompanyDetails();
  const address = getFullAddress();
  const client = (document.getElementById('jobClient') || {}).value || '';
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const C = PDF_COLORS, M = 15, CW = 180;
  let y = drawPdfDocCover(doc, company, { kicker: 'Job file', title: 'Everything for this job', date: formatIssueDate(Date.now()), left: [
    ['CLIENT', client.trim()],
    ['PROPERTY ADDRESS', address || 'Not specified'],
  ], right: [
    ['REPORT NUMBER', ensureReportNumber()],
    ['DOCUMENTS', String(built.length)],
  ] });
  const rowH = 14, perFirst = Math.floor((272 - y - 14) / rowH), perNext = Math.floor((272 - 26) / rowH);
  const coverPages = 1 + Math.ceil(Math.max(0, built.length - perFirst) / perNext);
  let page = coverPages + 1;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...C.ink);
  doc.text('What\'s in this file', M, y + 4);
  y += 10;
  built.forEach((b, i) => {
    if (y + rowH > 272) { doc.addPage(); y = drawPdfRunningHeader(doc, company, 'Job file', address, ''); }
    doc.setFillColor(...C.accent); doc.roundedRect(M, y - 4.2, 7, 7, 1, 1, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...C.white);
    doc.text(String(i + 1), M + 3.5, y + 0.6, { align: 'center' });
    doc.setFontSize(10); doc.setTextColor(...C.ink);
    doc.text(pdfFitText(doc, b.part.title, CW - 34), M + 11, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.8); doc.setTextColor(...C.inkLight);
    doc.text(pdfFitText(doc, b.part.note || '', CW - 34), M + 11, y + 4.6);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...C.accentDark);
    // A part inside the one before it: that part's first page, plus where it sits in it.
    const before = built[i - 1];
    doc.text(`Page ${b.src ? page : page - before.pages + b.at - 1}`, M + CW, y, { align: 'right' });
    doc.setDrawColor(...C.ruleLight); doc.setLineWidth(0.25); doc.line(M, y + 8.5, M + CW, y + 8.5);
    page += b.pages;
    y += rowH;
  });
  const skipped = jobPdfSkipped();
  if (skipped) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.setTextColor(...C.inkMuted);
    doc.text(skipped, M, Math.min(y + 2, 278));
  }
  drawPdfDocFooters(doc, `Job file${company.name ? `  ·  ${company.name}` : ''}`);

  const out = await joinPdfs(lib, [await lib.PDFDocument.load(doc.output('arraybuffer')), ...built.filter(b => b.src).map(b => b.src)]);
  // Each document keeps its own "Page 1 of 2", so every page after the
  // contents also says where it is in the file: small, in the top right
  // corner, above every document's own header. That's the number the
  // contents page gives.
  const font = await out.embedFont(lib.StandardFonts.Helvetica);
  const MM = 72 / 25.4, grey = lib.rgb(...C.inkMuted.map(v => v / 255));
  out.getPages().forEach((pg, i) => {
    if (i < coverPages) return;
    const text = `Job file page ${i + 1}`;
    pg.drawText(text, { x: pg.getWidth() - 15 * MM - font.widthOfTextAtSize(text, 6.5), y: pg.getHeight() - 6.5 * MM, size: 6.5, font, color: grey });
  });
  out.setTitle(`Job file · ${address || 'Property'}`);
  if (company.name) out.setAuthor(company.name);
  const bytes = await out.save();
  return {
    blob: new Blob([bytes], { type: 'application/pdf' }),
    fname: pdfFileName('Job File', address),
  };
}

// Finalise (how: 'email' | 'save'). The first time, and after an amendment,
// the job locks as its next version; a job that's already locked just gets
// its PDF made again. The lock only stands once the PDF has been made and
// has gone where it was sent: anything short of that takes it back off.
let jobPdfBusy = false;
async function makeJobPdf(how) {
  if (jobPdfBusy) return;
  const j = currentJobSummary();
  const locking = !isReportLocked();
  if (locking && !jobCanFinalise(j)) { showToast('Finish the job\'s steps first. Finalise comes after the last one', 'error'); return; }
  const to = jobClientEmailOf();
  if (how === 'email' && !to) { showToast('Add the client\'s email in Job details first', 'error'); return; }
  jobPdfBusy = true;
  renderJobPdfButtons(true);
  const unlock = locking ? lockJob() : null;
  let done = false;
  try {
    const pack = await buildJobPdf();
    if (how === 'email') {
      done = await sendPdfsToClient({
        files: [pack],
        to,
        subject: `Your job file — ${getFullAddress() || 'your property'}`,
        body: clientMessage({ client: (document.getElementById('jobClient') || {}).value || '', address: getFullAddress(), docs: 'job file', note: 'It has every document from the job in one PDF.', signOff: inspectorDisplayName() }),
      });
      if (done) {
        reportData.jobPdfSentAt = Date.now();
        track('job_pdf_sent');
      }
    } else {
      await deliverPdfBlob(pack.blob, pack.fname, { title: 'Job file', text: `Job file — ${getFullAddress() || 'Property'}`, readyToast: 'Job PDF ready. Choose where to save or send it' });
      done = true;
      track('job_pdf_made');
    }
    if (done) {
      reportData.jobPdfAt = Date.now();
      saveCurrentReport(true);
      if (locking) {
        const v = reportData.issue.version;
        showToast(v > 1 ? `Version ${v} finalised. The report and quote are locked` : 'Job finalised. The report and quote are locked', 'success');
        track('report_completed', { version: v });
      }
    } else if (unlock) {
      // The send has said why it didn't go; the page still offers Finalise.
      unlock();
    }
  } catch (e) {
    if (unlock && !done) unlock();
    reportError(e, 'job_pdf');
    showToast((e && e.message) || 'Could not make the job PDF', 'error');
  } finally {
    jobPdfBusy = false;
    if (document.getElementById('jobOverlay')?.classList.contains('open')) renderJobPage();
  }
}

function renderJobPdfButtons(busy) {
  document.querySelectorAll('.job-pdf-btn').forEach(b => { b.disabled = !!busy; if (busy && b.dataset.busy) b.textContent = b.dataset.busy; });
}

// What's in it, in a few words: "Agreement, report, quote, certificate
// and 2 bait visit reports".
function jobPdfContentsLine(parts) {
  const n = kind => parts.filter(p => p.kind === kind).length;
  const words = [n('agreement') && 'agreement', n('report') && 'report', n('quote') && 'quote',
    n('cert') && 'certificate',
    n('bait') && (n('bait') > 1 ? `${n('bait')} bait visit reports` : 'a bait visit report')].filter(Boolean);
  const line = words.length > 1 ? words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1] : words.join('');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

// What went into the job since its PDF was last made, in a few words, or ''.
function jobPdfMissing() {
  const at = reportData.jobPdfAt, q = currentJobQuote();
  if (!at || !q) return '';
  const visits = typeof baitVisitsOf === 'function' ? baitVisitsOf(q).filter(v => (v.at || 0) > at).length : 0;
  if (visits) return visits === 1 ? 'a bait station visit' : `${visits} bait station visits`;
  if (q.treatment && (q.treatment.at || q.treatment.savedAt || 0) > at) return 'the treatment record';
  return '';
}

// "What's in it", folded: the parts of the job PDF as it would be made now.
function jobPdfContentsHTML(parts) {
  return `<details class="job-pdf-more">
        <summary>What's in it</summary>
        <ol class="job-pdf-list">${parts.map(p => `<li><strong>${escapeHtml(p.title)}</strong><span>${escapeHtml(p.note || '')}</span></li>`).join('')}</ol>
        <p class="job-pdf-note">${jobPdfSkipped() ? escapeHtml(jobPdfSkipped()) + ' ' : ''}A contents page goes first, and each part still has its own PDF.</p>
      </details>`;
}

// Finalise as the job's next step, once its steps are done: what it does,
// then Email and Save. j: currentJobSummary().
function jobFinaliseNext(j) {
  const who = (j.r.client || '').trim().split(/\s+/)[0] || 'the client';
  const email = jobClientEmailOf();
  const locked = isReportLocked();
  const v = reportVersion();
  const sample = isSampleJob(currentReportId);
  const what = locked ? 'Every document from the job goes into one PDF.'
    : `Finalising locks the report and quote${v > 1 ? ` as version ${v}` : ''}, so they match what ${who} received, and puts every document from the job into one PDF.`;
  const lead = `Everything\'s done${j.group === 'waiting' ? ' apart from the bait station checks' : ''}. `;
  const emailBtn = email ? `<button type="button" class="dash-detail-primary job-pdf-btn" data-busy="Making it…" onclick="makeJobPdf('email')">${sample ? 'Finalise and email it to me' : `Finalise and email to ${escapeHtml(who)}`}</button>` : '';
  // With no email for the client, saving it is the one button.
  const saveBtn = `<button type="button" class="${email ? '' : 'dash-detail-primary '}job-pdf-btn" data-busy="Making it…" onclick="makeJobPdf('save')">Finalise and save the PDF</button>`;
  return {
    status: locked ? 'Make the job PDF' : v > 1 ? `Finalise version ${v}` : 'Finalise the job',
    hint: lead + what,
    html: `${emailBtn}
      ${email ? `<div class="dash-detail-links">${saveBtn}</div>` : saveBtn}
      ${jobPdfContentsHTML(jobPdfParts())}`,
  };
}

// The job page's last card, once the job is finalised: the record of it
// (the version, when, where the PDF went), the PDF again, and Amend.
// While it's being amended the card says why.
function jobFinalisedHTML(j) {
  const issue = reportData.issue;
  if (!issue || !getFullAddress()) return '';
  j = j || currentJobSummary();
  const tick = '<span class="job-tile-tick"><svg class="icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>';
  const head = (label, line, done) => `<div class="job-pdf-head">
        <span class="job-tile${done ? ' done' : ''}" aria-hidden="true">${jobIcon('jobpdf', 20)}${done ? tick : ''}</span>
        <span class="job-step-main"><span class="job-step-label">${label}</span><span class="job-step-text">${escapeHtml(line)}</span></span>
      </div>`;
  if (reportData.amending) return `
    <section class="job-pdf amending">
      ${head(`Amending to version ${reportVersion()}`, `${reportData.amending.reason}. Version ${issue.version} was finalised ${formatIssueDate(issue.completedAt)}.`)}
      <div class="dash-detail-links"><button type="button" onclick="cancelAmendment()">Cancel amendment</button></div>
    </section>`;
  const client = ((document.getElementById('jobClient') || {}).value || '').trim();
  const who = client.split(/\s+/)[0];
  const email = jobClientEmailOf();
  const sample = isSampleJob(currentReportId);
  const missing = jobPdfMissing();
  const pdf = reportData.jobPdfSentAt ? `Job PDF emailed${sample ? ' to you' : client ? ' to ' + client : ''} ${formatIssueDate(reportData.jobPdfSentAt)}.`
    : reportData.jobPdfAt ? `Job PDF saved ${formatIssueDate(reportData.jobPdfAt)}.` : '';
  const line = `Version ${issue.version}, ${formatIssueDate(issue.completedAt)}. ${pdf}${missing ? ` Make it again to take in ${missing}.` : ''}`.trim();
  // A job locked before its last step (from before Finalise did the
  // locking) carries on down its steps; its PDF comes at the end.
  const pdfButtons = j.finished ? `
        ${email ? `<button type="button" class="job-pdf-btn${missing ? ' primary' : ''}" data-busy="Making it…" onclick="makeJobPdf('email')">${sample ? 'Email it to me' : reportData.jobPdfSentAt ? 'Email again' : `Email${who ? ' to ' + escapeHtml(who) : ''}`}</button>` : ''}
        <button type="button" class="job-pdf-btn" data-busy="Making it…" onclick="makeJobPdf('save')">Save PDF</button>` : '';
  return `
    <section class="job-pdf made">
      ${head(j.finished ? 'Job finalised' : 'Report and quote locked', line, true)}
      <div class="dash-detail-links">${pdfButtons}
        <button type="button" class="job-pdf-amend" onclick="openAmendForm()">Amend</button>
      </div>
      <div class="issue-amend-form" id="issueAmendForm" hidden>
        <label for="issueAmendReason">Why is it changing?</label>
        <textarea id="issueAmendReason" rows="2" placeholder="e.g. Client asked for the garage to be added"></textarea>
        <div class="issue-amend-actions">
          <button type="button" class="link-btn" onclick="closeAmendForm()">Cancel</button>
          <button type="button" class="agreement-banner-btn issue-primary" onclick="startAmendment()">Unlock for version ${issue.version + 1}</button>
        </div>
      </div>
      ${j.finished ? jobPdfContentsHTML(jobPdfParts()) : ''}
    </section>`;
}
