// ── THE JOB PDF ─────────────────────────────────────────────────────────────
// Every document the job made, joined into one PDF behind a contents page:
// the agreement, the report, the quote, the treatment and installation
// certificates and the bait station visit reports. Each part keeps its own
// PDF; this one is for the client's or the business's records once the job
// is done. Steps the job skipped (no quote, a declined quote, no treatment)
// are left out, so a report-only job still gets its PDF.
//   reportData.jobPdfAt  when it was last made, from the job's page
// The pages are joined with pdf-lib (js/vendor), loaded the first time.

let jobPdfLib = null;
function ensurePdfLibLoaded() {
  if (jobPdfLib) return Promise.resolve(jobPdfLib);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'js/vendor/pdf-lib-1.17.1.min.js';
    s.onload = () => { jobPdfLib = window.PDFLib || null; jobPdfLib ? resolve(jobPdfLib) : reject(new Error('The PDF joining tools did not load')); };
    s.onerror = () => { s.remove(); reject(new Error('Could not load the PDF joining tools. Check your connection and try again.')); };
    document.head.appendChild(s);
  });
}

// Where the job PDF is emailed: the job's email, else the quote's.
function jobClientEmailOf() {
  return (reportData.jobClientEmail || (currentJobQuote() || {}).clientEmail || '').trim();
}

// The report counts once it's filled in, made as a PDF or sent.
function jobReportReady() {
  return !!(reportData.issue || reportData.sent || reportData.pdfAt || calculateCompletion() >= 100);
}

// The parts of the job PDF, in order: { title, note, build() → { blob, fname } }.
function jobPdfParts() {
  const q = currentJobQuote();
  const parts = [];
  const a = reportData.agreement;
  if (a) parts.push({ title: 'Pre-inspection agreement', note: `Signed${a.signerName ? ' by ' + a.signerName : ''}, ${formatAgreementSignedAt(a.signedAt)}`,
    build: () => buildAgreementPdf(a) });
  if (jobReportReady()) {
    const sent = reportData.sent ? `sent ${formatIssueDate(reportData.sent.at)}` : 'not sent yet';
    parts.push({ title: reportKindTitle(), note: `Report ${ensureReportNumber()}, version ${reportVersion()}, ${sent}`, report: true, build: () => buildReportPdf() });
  }
  if (quoteHasItems(q)) {
    const ans = quoteAnswerState(q);
    const how = !ans ? (q.sentAt ? `sent ${formatIssueDate(q.sentAt)}, no answer yet` : 'not sent yet')
      : ans.status === 'accepted' ? `accepted${ans.by ? ' by ' + ans.by : ''} ${formatAnswerDate(ans.date)}` : `declined ${formatAnswerDate(ans.date)}`;
    parts.push({ title: `Quote ${q.number || ''}`.trim(), note: `${formatAUD(quoteTotals(q).total)}, ${how}`, build: () => buildQuotePDF(q) });
  }
  if (q && q.treatment) {
    const t = q.treatment;
    parts.push({ title: 'Treatment certificate', note: `Done ${formatAnswerDate(t.date)}${t.technician ? ' by ' + t.technician : ''}`, build: () => buildTreatmentCertificatePDF(q) });
    if (installedSystems(t).length) parts.push({ title: 'Certificate of installation', note: installedSystems(t).map(k => (TREATMENT_METHODS[k] || {}).label || k).join(', '), build: () => buildTreatmentCertificatePDF(q, { install: true }) });
  }
  if (q && typeof baitVisitsOf === 'function') baitVisitsOf(q).forEach(v => {
    parts.push({ title: `Bait station visit, ${formatAnswerDate(v.date)}`, note: baitVisitShort(v), build: () => buildBaitVisitPDF(q, v) });
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
  const built = [];
  let report = null;
  for (const part of parts) {
    const made = await part.build();
    if (part.report) report = made;
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
    doc.text(`Page ${page}`, M + CW, y, { align: 'right' });
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

  const out = await lib.PDFDocument.create();
  const cover = await lib.PDFDocument.load(doc.output('arraybuffer'));
  for (const src of [cover, ...built.map(b => b.src)]) {
    (await out.copyPages(src, src.getPageIndices())).forEach(p => out.addPage(p));
  }
  out.setTitle(`Job file · ${address || 'Property'}`);
  if (company.name) out.setAuthor(company.name);
  const bytes = await out.save();
  return {
    blob: new Blob([bytes], { type: 'application/pdf' }),
    fname: `SAYON_Job_${fileNamePart(address) || 'Property'}.pdf`,
    report,
  };
}

let jobPdfBusy = false;
async function makeJobPdf(how) {
  if (jobPdfBusy) return;
  if (!jobReportReady()) { showToast('Finish the report first. The job PDF starts from it', 'error'); return; }
  jobPdfBusy = true;
  renderJobPdfButtons(true);
  try {
    const pack = await buildJobPdf();
    reportData.jobPdfAt = Date.now();
    saveOpenReportNow();
    if (how === 'email') {
      const to = jobClientEmailOf();
      const sent = await sendPdfsToClient({
        files: [pack],
        to,
        subject: `Your job file — ${getFullAddress() || 'your property'}`,
        body: clientMessage({ client: (document.getElementById('jobClient') || {}).value || '', address: getFullAddress(), docs: 'job file, with every document from the job in one PDF', signOff: inspectorDisplayName() }),
      });
      if (sent) {
        reportData.jobPdfSentAt = Date.now();
        // The report went with it, so a report not sent on its own counts as sent.
        if (pack.report && !(reportData.sent && reportData.sent.fingerprint === pack.report.fingerprint)) recordReportSent(pack.report.fingerprint, pack.report.version);
        saveOpenReportNow();
        track('job_pdf_sent');
      }
    } else {
      await deliverPdfBlob(pack.blob, pack.fname, { title: 'Job file', text: `Job file — ${getFullAddress() || 'Property'}`, readyToast: 'Job PDF ready — choose where to save or send it' });
      track('job_pdf_made');
    }
  } catch (e) {
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

// The job page's section: what goes in, and the buttons.
function jobPdfSectionHTML() {
  if (!getFullAddress()) return '';
  // Until the report is finished the section says so, rather than hiding.
  if (!jobReportReady()) return `<div class="job-section-head">Job PDF</div>
    <section class="job-pdf">
      <p class="job-pdf-lede">Everything from this job in one PDF, with a contents page: the agreement, report, quote, certificates and bait visits.</p>
      <p class="job-pdf-note">Finish the report first (${calculateCompletion()}% filled in). The job PDF starts from it.</p>
      <div class="dash-detail-links"><button type="button" class="job-pdf-btn" disabled>Save PDF</button></div>
    </section>`;
  const parts = jobPdfParts();
  const who = ((document.getElementById('jobClient') || {}).value || '').trim().split(/\s+/)[0];
  const email = jobClientEmailOf();
  const made = reportData.jobPdfAt ? `Made ${formatIssueDate(reportData.jobPdfAt)}${reportData.jobPdfSentAt ? `, emailed ${formatIssueDate(reportData.jobPdfSentAt)}` : ''}. Make it again to take in anything new.` : '';
  return `<div class="job-section-head">Job PDF</div>
    <section class="job-pdf">
      <p class="job-pdf-lede">Everything from this job in one PDF, with a contents page. Each part still has its own PDF too.</p>
      <ol class="job-pdf-list">${parts.map(p => `<li><strong>${escapeHtml(p.title)}</strong><span>${escapeHtml(p.note || '')}</span></li>`).join('')}</ol>
      ${jobPdfSkipped() ? `<p class="job-pdf-note">${escapeHtml(jobPdfSkipped())}</p>` : ''}
      ${made ? `<p class="job-pdf-note">${escapeHtml(made)}</p>` : ''}
      <div class="dash-detail-links">
        <button type="button" class="job-pdf-btn" data-busy="Making it…" onclick="makeJobPdf('save')">Save PDF</button>
        ${email ? `<button type="button" class="job-pdf-btn" data-busy="Making it…" onclick="makeJobPdf('email')">Email${who ? ' to ' + escapeHtml(who) : ''}</button>` : ''}
      </div>
    </section>`;
}
