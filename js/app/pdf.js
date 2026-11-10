// SAYON app: jsPDF loading, shared PDF pieces and the inspection report PDF.
// One of the js/app/ files, which share one global scope: they load as plain
// scripts in the order index.html lists them, so a top-level name declared in
// any of them can be used from the others once the page has loaded.

// jsPDF loads from a CDN (see the <script src> tag above, in <head>). If that
// request fails — poor connectivity, a corporate/site firewall, an ad blocker,
// or the CDN being briefly down — `window.jspdf` never gets defined. The old
// code here did `const { jsPDF } = window.jspdf;`, which THROWS the instant
// window.jspdf is undefined. Because this is a single top-level <script>
// block, that throw aborted the rest of this script right here — every
// function and constant declared below (including SECTIONS) never ran, so
// the ENTIRE app silently broke: no section would open, nothing would
// respond, with no error shown to the technician. Given this app is meant to
// be used in the field (subfloors, rural properties, patchy signal), a
// flaky connection at page-load should never be able to take down report
// entry — only PDF export actually needs jsPDF, so we defer the failure to
// there instead of crashing everything up front.
let jsPDF = (window.jspdf && window.jspdf.jsPDF) || null;
tidyPdfLineBreaks(jsPDF);

// If jsPDF didn't load the first time, retry loading it on demand (e.g. when
// the technician's connection comes back and they try to generate a PDF)
// instead of forcing a full page reload.
function ensureJsPDFLoaded() {
  if (jsPDF) return Promise.resolve(jsPDF);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-jspdf-retry]');
    if (existing) existing.remove();
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.setAttribute('data-jspdf-retry', '1');
    s.onload = () => {
      jsPDF = (window.jspdf && window.jspdf.jsPDF) || null;
      tidyPdfLineBreaks(jsPDF);
      if (jsPDF) resolve(jsPDF); else reject(new Error('jsPDF script loaded but did not define window.jspdf.jsPDF'));
    };
    s.onerror = () => reject(new Error('Could not load the PDF tools. Check your signal and try again'));
    document.head.appendChild(s);
  });
}


// ── SHARED PDF PIECES ── used by the inspection report and the quote PDF
// (js/quote.js) so both documents carry the same brand.

// Line breaks in every PDF: a dash never starts a line (it stays with the
// word before it); a standard, a measurement, a time or a date isn't split
// ("AS / 4349.3", "400 / mm", "8:30 / am", "28 / October 2026"); a
// paragraph's last line is never one word on its own when the line above
// has words to share; and a short value, or text in a narrow box, on two
// lines breaks after a comma where it can ("Unit 3, 12 Long Road, / Castle
// Hill NSW 2154", not "…Road, Castle / Hill NSW 2154"). Each rule only moves
// whole words between lines: a text never takes more lines than it did
// (layouts sized from splitTextToSize keep their height), and a word is
// never broken to make it fit. Installed once jsPDF has loaded.
function tidyPdfLineBreaks(lib) {
  const api = lib && lib.API;
  if (!api || typeof api.splitTextToSize !== 'function' || api.splitTextToSize.tidy) return;
  const split = api.splitTextToSize;
  const NB = '\u00A0'; // holds two words together while wrapping; a plain space when drawn
  const words = l => String(l).trim().split(/\s+/).filter(Boolean).length;
  const flat = lines => lines.map(l => String(l).trim()).join(' ');
  const tidy = function (text, maxlen, options) {
    if (typeof text !== 'string' || !text.includes(' ')) return split.call(this, text, maxlen, options);
    const run = t => split.call(this, t, maxlen, options).map(l => typeof l === 'string' ? l.split(NB).join(' ') : l);
    const plain = run(text);
    // Same lines, same words in the same order: only the breaks moved.
    const same = a => a.length === plain.length && flat(a) === flat(plain);
    let base = text.replace(/ (?=[—–] )/g, NB).replace(/\b(AS|AS\/NZS|No\.) (?=\d)/g, '$1' + NB)
      .replace(/(\d) (?=(mm|cm|m|km|L|mL|kg|g|ha|am|pm)\b)/g, '$1' + NB)
      .replace(/\b(\d{1,2}) (?=(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b)/g, '$1' + NB)
      .replace(/\b((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*) (?=\d{4}\b)/g, '$1' + NB);
    let lines = plain;
    if (base !== text) { const glued = run(base); if (same(glued)) lines = glued; else base = text; }
    const last = String(lines[lines.length - 1] || '').trim();
    if (lines.length > 1 && last && !/\s/.test(last) && words(lines[lines.length - 2]) >= 4) {
      const t = base.replace(/ +$/, ''), i = t.lastIndexOf(' ');
      if (i > t.lastIndexOf('\n')) {
        const again = run(t.slice(0, i) + NB + t.slice(i + 1));
        if (same(again)) lines = again;
      }
    }
    // A short value, or any text in a narrow box (a table cell, a value
    // beside its label), on two lines: the break after the last comma,
    // semicolon or middle dot that lets both parts fit, if the first line
    // stays at least half as long. Paragraphs across the page keep full
    // lines. A longer text never breaks inside brackets or before a capital
    // (Street, Epping).
    const short = text.length <= 80;
    const pageW = this && this.internal && this.internal.pageSize ? this.internal.pageSize.getWidth() : 0;
    const narrow = pageW > 0 && maxlen < pageW * 0.6;
    if (lines.length === 2 && (short || narrow) && !text.includes('\n')) {
      const t = base.trim();
      const at = from => Math.max(t.lastIndexOf(', ', from), t.lastIndexOf('; ', from), t.lastIndexOf('· ', from));
      for (let i = at(t.length); i > 0; i = at(i - 1)) {
        const head = t.slice(0, i + 1), rest = t.slice(i + 2);
        if (!short && (/^[A-Z]/.test(rest) || (head.match(/\(/g) || []).length > (head.match(/\)/g) || []).length)) continue;
        const a = run(head), b = run(rest);
        if (a.length > 1) continue;
        if (b.length === 1 && a[0].length * 2 >= String(lines[0]).length) lines = [a[0], b[0]];
        break;
      }
    }
    return lines;
  };
  tidy.tidy = true;
  api.splitTextToSize = tidy;
}

// Text cut to at most max lines. A cut ends the last line with "…", so a
// line never stops mid-sentence with no sign that there was more.
function pdfClipLines(doc, text, width, max) {
  const lines = doc.splitTextToSize(String(text || ''), width);
  if (lines.length <= max) return lines;
  const out = lines.slice(0, max);
  let last = String(out[max - 1]).replace(/[\s,;:–—-]+$/, '');
  while (/\s/.test(last) && doc.getTextWidth(last + '…') > width) last = last.replace(/\s+\S+$/, '').replace(/[\s,;:–—-]+$/, '');
  out[max - 1] = last + '…';
  return out;
}
// The sample job's PDFs (js/sample-job.js) carry SAMPLE across every page,
// faint enough to read through, so one can never pass as a real document.
// key: the job the PDF is for, the open job when left out.
function stampSamplePdf(doc, key) {
  if (!isSampleJob(key === undefined ? currentReportId : key)) return;
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const word = 'SAMPLE', deg = 35, a = deg * Math.PI / 180;
  for (let p = 1; p <= doc.internal.getNumberOfPages(); p++) {
    doc.setPage(p);
    doc.saveGraphicsState();
    if (doc.GState) doc.setGState(new doc.GState({ opacity: 0.09 }));
    doc.setFont('helvetica', 'bold'); doc.setFontSize(120); doc.setTextColor(...PDF_COLORS.accent);
    const tw = doc.getTextWidth(word), lift = 120 * 0.3528 * 0.35;
    // Centred on the page: from the middle, back half the word along its slope.
    doc.text(word, W / 2 - (tw / 2) * Math.cos(a) + lift * Math.sin(a), H / 2 + (tw / 2) * Math.sin(a) + lift * Math.cos(a), { angle: deg });
    doc.restoreGraphicsState();
  }
}

const PDF_COLORS = {
  white:       [255, 255, 255],
  pageBg:      [250, 251, 252],
  // Text
  ink:         [12,  18,  28],
  inkLight:    [36,  48,  64],
  inkMuted:    [72,  86, 104],
  // Accent: the brand's electric blue
  accent:      [47,  107, 255],
  accentDark:  [29,  78,  216],
  accentLight: [214, 226, 255],
  // Structure
  rule:        [208, 218, 228],
  ruleLight:   [230, 237, 244],
  rowAlt:      [245, 248, 251],
  headerBg:    [10,  15,  22],
  // Status
  danger:      [192,  48,  38],
  warn:        [175, 112,  16],
  safe:        [21,  128,  61],
  // Cover
  coverDark:   [10,  15,  22],
  coverMid:    [20,  30,  46],
};

// Letter-spaced text for small capital labels. align 'right' measures the
// spacing too, which jsPDF's own align doesn't.
function pdfTracked(doc, text, x, y, { cs = 0.35, align } = {}) {
  const w = doc.getTextWidth(text) + cs * Math.max(0, text.length - 1);
  doc.text(text, align === 'right' ? x - w : x, y, { charSpace: cs });
  return w;
}

// A rule that runs from blue through a lighter blue and fades into the page,
// like the lines on the app's section headers. jsPDF has no gradients, so it
// is drawn as thin steps. wash: a pale blue band that fades into the page.
function drawPdfFadeRule(doc, x, y, w, h, { wash = false } = {}) {
  const white = [255, 255, 255];
  const from = wash ? [226, 234, 255] : PDF_COLORS.accent;
  const mid = wash ? [241, 245, 255] : [125, 162, 255];
  const steps = Math.max(12, Math.round(w / 1.5)), sw = w / steps;
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    doc.setFillColor(...(t < 0.45 ? mix(from, mid, t / 0.45) : mix(mid, white, (t - 0.45) / 0.55)));
    doc.rect(x + i * sw, y, sw + 0.05, h, 'F');
  }
}

// The business's mark: the uploaded logo, else its initials (or S for
// SAYON) in a blue tile. size is the square it fits in, in mm.
function drawPdfCompanyMark(doc, company, x = 15, y = 12, size = 17) {
  const C = PDF_COLORS;
  if (company.logo) {
    try {
      const natW = company.logoWidth || 1, natH = company.logoHeight || 1;
      // Wide logos get up to twice the width, so a wordmark stays legible.
      let drawH = size, drawW = size * (natW / natH);
      if (drawW > size * 2) { drawW = size * 2; drawH = drawW * (natH / natW); }
      doc.addImage(company.logo, 'PNG', x, y + (size - drawH) / 2, drawW, drawH, undefined, 'FAST');
      return drawW;
    } catch (e) {}
  }
  const initials = (company.name || 'SAYON').split(/\s+/).filter(w => /^[A-Za-z0-9]/.test(w))
    .slice(0, 2).map(w => w[0].toUpperCase()).join('') || 'S';
  doc.setFillColor(...C.accent); doc.roundedRect(x, y, size, size, 2.2, 2.2, 'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(initials.length > 1 ? 11 : 13); doc.setTextColor(...C.white);
  doc.text(initials, x + size / 2, y + size / 2 + 1.6, { align:'center' });
  return size;
}

// The letterhead at the top of every client document: the business's mark,
// name and details on the left, the document and date on the right, over a
// blue rule. White, so it prints cleanly in black and white. Returns the y
// below it.
function drawPdfLetterhead(doc, company, { docLabel, date }) {
  const C = PDF_COLORS;
  const W = 210, M = 15;
  drawPdfFadeRule(doc, 0, 0, W, 1.6);
  const markW = drawPdfCompanyMark(doc, company, M, 11, 17);
  const tx = M + markW + 5;
  // A long business name steps down in size, then takes a second line,
  // and the details below move down with it rather than print over it.
  const name = company.name || 'SAYON', nameW = 112 - markW;
  let nameSize = 13.5;
  doc.setFont('helvetica','bold'); doc.setFontSize(nameSize); doc.setTextColor(...C.ink);
  while (nameSize > 11 && doc.getTextWidth(name) > nameW) doc.setFontSize(nameSize -= 0.5);
  const nameLines = pdfClipLines(doc, name, nameW, 2);
  const two = nameLines.length > 1;
  doc.text(nameLines, tx, two ? 15 : 17.5, { lineHeightFactor: 1.15 });
  const dy = two ? 1.6 : 0;
  const sub = [];
  if (company.licence) sub.push(`Licence ${company.licence}`);
  if (company.abn) sub.push(`ABN ${company.abn}`);
  const contact = [company.phone, company.email].filter(Boolean);
  doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(...C.inkLight);
  if (sub.length) doc.text(sub.join('   ·   '), tx, 22.6 + dy);
  if (contact.length) doc.text(contact.join('   ·   '), tx, 26.6 + dy);
  if (!company.name) doc.text('Intelligent Inspection Platform', tx, 22.6);
  doc.setFont('helvetica','bold'); doc.setFontSize(6.8); doc.setTextColor(...C.accentDark);
  pdfTracked(doc, (docLabel || '').toUpperCase(), W - M, 17.5, { align: 'right' });
  doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(...C.inkLight);
  if (date) doc.text(date, W - M, 22.6, { align: 'right' });
  drawPdfFadeRule(doc, M, 33, W - M * 2, 0.5);
  return 33.5;
}

// A signature over a line, with a caption under it: a drawn signature, or a
// note (e.g. "Signed on paper") when there's none. y is the line.
function drawPdfSignature(doc, { x, y, w, image, note, caption }) {
  const C = PDF_COLORS;
  if (image) {
    try { doc.addImage(image, 'PNG', x + 1, y - 12.5, 36, 12, undefined, 'FAST'); } catch (e) {}
  } else if (note) {
    doc.setFont('helvetica','italic'); doc.setFontSize(8.5); doc.setTextColor(...C.inkLight);
    doc.text(note, x + 1, y - 2, { maxWidth: w - 2 });
  }
  doc.setDrawColor(...C.ink); doc.setLineWidth(0.3); doc.line(x, y, x + w, y);
  doc.setFont('helvetica','bold'); doc.setFontSize(6.3); doc.setTextColor(...C.inkMuted);
  pdfTracked(doc, (caption || 'SIGNATURE').toUpperCase(), x, y + 4, { cs: 0.3 });
}

// Text cut to fit w at the current font, with an ellipsis when it's cut.
function pdfFitText(doc, text, w) {
  text = String(text || '');
  if (doc.getTextWidth(text) <= w) return text;
  while (text.length > 1 && doc.getTextWidth(text + '…') > w) text = text.slice(0, -1);
  return text.trimEnd() + '…';
}

// A name or date written on a signature line (y is the line). Long names
// step down in size to fit the line instead of losing words.
function drawPdfOnLine(doc, text, x, y, w) {
  if (!text) return;
  let size = 9.5;
  doc.setFont('helvetica','bold'); doc.setFontSize(size); doc.setTextColor(...PDF_COLORS.ink);
  while (size > 7 && doc.getTextWidth(String(text)) > w - 2) doc.setFontSize(size -= 0.5);
  doc.text(pdfFitText(doc, text, w - 2), x + 1, y - 2);
}

// A labelled value, small tracked label over the value. Returns the value's
// line count.
function drawPdfField(doc, label, value, x, y, w, size = 9.5) {
  const C = PDF_COLORS;
  doc.setFont('helvetica','bold'); doc.setFontSize(6.3); doc.setTextColor(...C.inkMuted);
  pdfTracked(doc, label.toUpperCase(), x, y, { cs: 0.3 });
  doc.setFont('helvetica','bold'); doc.setFontSize(size); doc.setTextColor(...C.ink);
  const lines = doc.splitTextToSize(String(value), w);
  doc.text(lines, x, y + 4.8);
  return lines.length;
}

// Gets a finished PDF off the device. Inside the native app wrapper there is
// no Downloads folder for a browser-style <a download> click to land in — it
// silently does nothing — so go straight to the native Share sheet there.
// Browsers / PWA get a Safari-compatible blob download.
async function deliverPdfBlob(blob, fname, { title, text, readyToast }) {
  const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
  if (isNative) {
    const file = new File([blob], fname, { type: 'application/pdf' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ title, text, files: [file] });
        showToast(readyToast, 'success');
      } catch(e) {
        if (e.name !== 'AbortError') showToast('Share cancelled', 'info');
      }
    } else {
      showToast('PDF ready. Tap Share to save or send it', 'info');
    }
    return;
  }
  downloadBlob(blob, fname);
  showToast('PDF downloaded', 'success');
}

// Safari-compatible blob download, falling back to opening it in a new tab.
function downloadBlob(blob, fname) {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 300);
  } catch(e) {
    window.open(url, '_blank');
    showToast('PDF opened in a new tab. Save it from there', 'info');
  }
}

// Builds the report PDF as the report is now: { blob, fname, fingerprint,
// version }. Used by Generate PDF and by Send (after the check).
async function buildReportPdf() {
  // Photos live outside reportData (see PHOTO ATTACHMENTS), so read them all
  // up front; the drawing code below is synchronous.
  const photoSrc = {};
  for (const p of allReportPhotos(reportData)) {
    const blob = await getPhotoImage(p);
    if (blob) photoSrc[p.id] = await blobToDataUrl(blob);
  }

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 15, CW = W - M * 2;
  const address   = getFullAddress() || 'Address Not Set';
  const client    = document.getElementById('jobClient').value    || 'Not specified';
  const inspector = document.getElementById('jobInspector').value || 'Not specified';
  // The report's date: the day it was completed, so a finished report made
  // as a PDF again later keeps its date; a draft carries today's.
  const issuedAt = reportData.issue && reportData.issue.completedAt;
  const today = (issuedAt ? new Date(issuedAt) : new Date()).toLocaleDateString('en-AU', { day:'numeric', month:'long', year:'numeric' });
  // The day of the inspection, not the day this PDF was made.
  const inspectedOn = reportData.jobInspectionDate || (reportData.agreement && reportData.agreement.inspectionDate);
  const inspectionDate = inspectedOn
    ? new Date(inspectedOn + 'T00:00:00').toLocaleDateString('en-AU', { day:'numeric', month:'long', year:'numeric' })
    : today;
  const reportNumber = ensureReportNumber();
  const version = reportVersion();
  const reportId = `${reportNumber} · Version ${version}`;
  // A locked report carries the code it was locked under, so the same
  // version made again reads the same.
  const fingerprint = isReportLocked() && reportData.issue.fingerprint || reportFingerprint();
  let y = 0;

  const STANDARD_NAMES = {
    'AS 3660.1-2014': 'New Building Work',
    'AS 4349.0-2007': 'Inspection of Buildings — General Requirements',
    'AS 3660.2-2017': 'Existing Buildings',
    'AS 3660.3-2014': 'Assessment Criteria',
    'AS 4349.1-2007': 'Building Inspections',
    'AS 4349.3-2010': 'Timber Pest Inspections',
  };
  const standard = reportData.standard || 'AS 3660.2-2017';
  const standardName = STANDARD_NAMES[standard] || '';
  const standardLabel = standardName ? `${standard} — ${standardName}` : standard;

  const C = PDF_COLORS;


  // Every page after the cover carries the header for the part it's in, so a
  // section that runs onto a new page is still labelled.
  let pageLabel = '';
  // Where the page's own content starts: under the running header, and
  // under a section title, subheading or intro that sits at the top of it.
  // Anything starting there is at the top of its page, for keep().
  let pageTopUntil = 0;
  // titleUntil: where the room just under the last section title on this
  // page ends (the title and the lines straight after it), or -1.
  let titleUntil = -1;
  function newPage() { doc.addPage(); compactHeader(pageLabel); _rowShade = false; pageTopUntil = y; titleUntil = -1; }
  const atPageTop = () => y <= pageTopUntil + 0.5;
  function gap(n=5) { y += n; }
  // Starts a part of the report: on a fresh page when asked or when little of
  // the page is left, otherwise straight after what came before. false (not
  // just unset) means the part is drawn through keep(), which moves it to a
  // fresh page itself if it doesn't fit.
  function startPart(label, freshPage) {
    pageLabel = label;
    if (freshPage || (freshPage !== false && y > 215)) newPage();
    else if (!atPageTop()) gap(8);
    _rowShade = false;
  }

  // ── KEEPING A PART TOGETHER ───────────────────────────────────────────────
  // keep(draw) draws a part where it falls, with draw(false). If it runs
  // over onto another page and didn't start at the top of one, it's taken
  // off again and drawn from a fresh page, with draw(true). So a part that
  // fits on a page is never split across two. A longer one starts at the top
  // of its own page, unless a good part of the page before was left: then it
  // starts there, as it splits either way. Taking a part off cuts the pages
  // it added and the page's drawing back to where they were.
  function pdfState() {
    const n = doc.internal.getNumberOfPages();
    return { n, len: doc.internal.pages[n].length, y, pageNum, pageLabel, pageTopUntil, titleUntil, shade: _rowShade, photoNo, parts: { ...partPages },
      font: doc.getFont(), size: doc.getFontSize(), text: doc.getTextColor() };
  }
  function restorePdfState(s) {
    while (doc.internal.getNumberOfPages() > s.n) doc.deletePage(doc.internal.getNumberOfPages());
    doc.setPage(s.n);
    doc.internal.pages[s.n].length = s.len;
    y = s.y; pageNum = s.pageNum; pageLabel = s.pageLabel; pageTopUntil = s.pageTopUntil; titleUntil = s.titleUntil; _rowShade = s.shade; photoNo = s.photoNo;
    Object.keys(partPages).forEach(k => delete partPages[k]);
    Object.assign(partPages, s.parts);
    doc.setFont(s.font.fontName, s.font.fontStyle); doc.setFontSize(s.size); doc.setTextColor(s.text);
  }
  // leftTitle: set when a part straight under a section title was moved on
  // to the next page, leaving the title behind.
  let leftTitle = false;
  function keep(draw) {
    const outer = leftTitle;
    const s = pdfState();
    const run = fresh => { leftTitle = false; draw(fresh); };
    run(false);
    if (doc.internal.getNumberOfPages() > s.n && s.y > s.pageTopUntil + 4) {
      restorePdfState(s);
      run(true);
      let moved = true;
      // Longer than a page even from the top of one, it splits either way,
      // so it goes back where it fell when a good part of that page was
      // left, unless that leaves its title without the first thing under it.
      if (doc.internal.getNumberOfPages() > s.n + 1 && s.y < 190) {
        restorePdfState(s);
        run(false);
        moved = false;
        if (leftTitle) { restorePdfState(s); run(true); moved = true; }
      }
      if (moved && s.y <= s.titleUntil + 4) leftTitle = true;
    }
    leftTitle = outer || leftTitle;
  }
  // A subheading and its rows, kept together the same way.
  function keepGroup(draw) { keep(fresh => { if (fresh) newPage(); draw(); }); }

  let pageNum = 1;

  // ── PAGE HEADER ──────────────────────────────────────────────────────────
  function compactHeader(sectionLabel) {
    pageNum++;
    // A light running header: who prepared it and for which property on the
    // left, the part of the report on the right, over a thin blue rule.
    const companyName = (getCompanyDetails().name || '').trim();
    doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...C.ink);
    doc.text(companyName || reportKindTitle(), M, 10);
    const addr = getFullAddress() || '';
    const sub = [companyName ? reportKindTitle() : '', addr].filter(Boolean).join('   ·   ');
    if (sub) {
      doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(...C.inkMuted);
      doc.text(pdfFitText(doc, sub, CW), M, 14);
    }
    doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(...C.accentDark);
    doc.text(sectionLabel.toUpperCase(), W-M, 10, { align:'right' });
    drawPdfFadeRule(doc, M, 17, CW, 0.35);
    y = 26;
  }

  // ── SECTION TITLE ─────────────────────────────────────────────────────────
  // no: the section's number from REPORT_PARTS (or 'A' for the appendix),
  // whose page the contents list records. A title never sits at the foot of
  // a page.
  const partPages = {};
  // keep: room needed below the title for its first content, so a title is
  // never left at the foot of a page with its content overleaf.
  function sectionTitle(title, no, keep = 30) {
    const num = no || '';
    if (y + 19 + keep > 277) newPage();
    const top = atPageTop();
    gap(4);
    // As on the app's section headers: a blue line above, a soft blue wash
    // and a fine line below, all fading out to the right.
    drawPdfFadeRule(doc, M, y - 2.5, CW, 0.7);
    drawPdfFadeRule(doc, M, y - 1.8, CW, 10.6, { wash: true });
    // Number badge
    if (num) {
      doc.setFillColor(...C.accent); doc.roundedRect(M, y, 7, 7, 1, 1, 'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(...C.white);
      doc.text(String(num), M+3.5, y+5.2, { align:'center' });
    }
    if (num) partPages[num] = doc.internal.getNumberOfPages();
    // Title
    const titleX = num ? M+10 : M;
    doc.setFont('helvetica','bold'); doc.setFontSize(10.5); doc.setTextColor(...C.ink);
    doc.text(title, titleX, y+5.5);
    drawPdfFadeRule(doc, M, y+8.8, CW, 0.3);
    y += 15;
    if (top) pageTopUntil = y;
    titleUntil = y;
  }

  // ── DATA ROW ──────────────────────────────────────────────────────────────
  let _rowShade = false;
  // invert: for questions where YES is the good answer (e.g. "inspection
  // zone visible"), so NO shows red and YES green. 'plain' prints the
  // answer in ink, for a fact that is neither good nor bad.
  // Sets the font and colour for an answer: red, green or amber for the
  // answers that mean something on their own (YES, NO, HIGH...), ink for the
  // rest. invert: for questions where YES is the good answer (e.g. "inspection
  // zone visible"), so NO shows red and YES green. 'plain' prints the answer
  // in ink, for a fact that is neither good nor bad. 'bad' is red whatever
  // word it reads as (no ant caps, poor drainage).
  function valueStyle(v, invert) {
    if (invert === 'plain') {
      doc.setTextColor(...C.ink); doc.setFont('helvetica','bold');
    } else if (invert === 'bad') {
      doc.setTextColor(...C.danger); doc.setFont('helvetica','bold');
    } else if (invert && (v === 'YES' || v === 'NO')) {
      doc.setTextColor(...(v === 'NO' ? C.danger : C.safe)); doc.setFont('helvetica','bold');
    } else if (['YES','HIGH','OBSTRUCTED','BRIDGED','ACTIVE'].includes(v)) {
      doc.setTextColor(...C.danger); doc.setFont('helvetica','bold');
    } else if (['NO','LOW','CLEAR','NONE'].includes(v)) {
      doc.setTextColor(...C.safe); doc.setFont('helvetica','bold');
    } else if (['MEDIUM','INACTIVE','MODERATE'].includes(v)) {
      doc.setTextColor(...C.warn); doc.setFont('helvetica','bold');
    } else {
      doc.setTextColor(...C.ink); doc.setFont('helvetica','normal');
    }
  }

  // A label and its answer across the page. A long label wraps in its
  // column rather than running into the answer.
  const LABEL_W = 62;
  function row(label, value, invert) {
    const v = String(value || '');
    // Nothing recorded: leave the row out rather than print a dash.
    if (!value && value !== 0) return;
    doc.setFont('helvetica','bold'); doc.setFontSize(7);
    const labelLines = doc.splitTextToSize(label.toUpperCase(), LABEL_W - 7);
    doc.setFont('helvetica','normal'); doc.setFontSize(9);
    const wrapped = doc.splitTextToSize(v, CW - LABEL_W - 6);
    const rowH = Math.max(7.6, wrapped.length * 4.3 + 3.4, labelLines.length * 3.1 + 4.4);
    if (y + rowH > 277) { newPage(); _rowShade = false; }

    if (_rowShade) { doc.setFillColor(...C.rowAlt); doc.rect(M, y, CW, rowH, 'F'); }
    _rowShade = !_rowShade;
    doc.setDrawColor(...C.ruleLight); doc.setLineWidth(0.25);
    doc.line(M, y+rowH, M+CW, y+rowH);

    doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(...C.inkMuted);
    doc.text(labelLines, M+3, y+5.2, { lineHeightFactor: 1.25 });
    valueStyle(v, invert);
    doc.setFontSize(9);
    doc.text(wrapped, M+LABEL_W, y+5.2, { lineHeightFactor: 1.35 });
    y += rowH;
  }

  // ── FACTS ── short answers two to a line, each column a label and its
  // answer, so a run of one-word facts takes half the room of full rows.
  // A long answer, or one marked 'wide', takes the full width, its answer
  // lined up with the left column's answers.
  // items: [label, value, invert?, 'wide'?]; empty values are left out.
  function facts(items) {
    const list = items.filter(([, v]) => v || v === 0);
    const half = (CW - 6) / 2, labW = 33, valW = half - labW - 4, wideW = CW - labW - 6;
    const fits = ([label, v, , wide]) => {
      if (wide) return false;
      doc.setFont('helvetica','normal'); doc.setFontSize(9);
      const vl = doc.splitTextToSize(String(v), valW).length;
      doc.setFont('helvetica','bold'); doc.setFontSize(7);
      return vl <= 2 && doc.splitTextToSize(label.toUpperCase(), labW - 4).length <= 3;
    };
    let pending = [];
    const flush = (wide) => {
      if (!pending.length) return;
      const cells = pending.map(([label, v, invert]) => {
        doc.setFont('helvetica','bold'); doc.setFontSize(7);
        const ll = doc.splitTextToSize(label.toUpperCase(), labW - 4);
        doc.setFont('helvetica','normal'); doc.setFontSize(9);
        return { ll, vl: doc.splitTextToSize(String(v), wide ? wideW : valW), v: String(v), invert };
      });
      const rowH = Math.max(7.6, ...cells.map(c => Math.max(c.vl.length * 4.3 + 3.4, c.ll.length * 3.1 + 4.4)));
      if (y + rowH > 277) { newPage(); _rowShade = false; }
      if (_rowShade) { doc.setFillColor(...C.rowAlt); doc.rect(M, y, CW, rowH, 'F'); }
      _rowShade = !_rowShade;
      doc.setDrawColor(...C.ruleLight); doc.setLineWidth(0.25);
      doc.line(M, y+rowH, M+CW, y+rowH);
      cells.forEach((c, k) => {
        const x = M + 3 + k * (half + 6);
        doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(...C.inkMuted);
        doc.text(c.ll, x, y+5.2, { lineHeightFactor: 1.25 });
        valueStyle(c.v, c.invert);
        doc.setFontSize(9);
        doc.text(c.vl, x + labW, y+5.2, { lineHeightFactor: 1.35 });
      });
      y += rowH;
      pending = [];
    };
    list.forEach(item => {
      if (!fits(item)) { flush(); pending = [item]; flush(true); return; }
      pending.push(item);
      if (pending.length === 2) flush();
    });
    flush();
  }

  function resetRowShade() { _rowShade = false; }

  // ── RISK BANNER ───────────────────────────────────────────────────────────
  function riskBanner(level) {
    if (y > 268) newPage();
    gap(4);
    const col = level==='HIGH' ? C.danger : level==='MEDIUM' ? C.warn : C.safe;
    const bgTint = level==='HIGH' ? [253,242,240] : level==='MEDIUM' ? [253,247,234] : [233,248,238];

    // Tinted background box
    doc.setFillColor(...bgTint); doc.roundedRect(M, y, CW, 18, 2, 2, 'F');
    // Coloured left bar
    doc.setFillColor(...col); doc.roundedRect(M, y, 4, 18, 2, 2, 'F');
    doc.rect(M+2, y, 2, 18, 'F'); // square off right edge
    // Border
    doc.setDrawColor(...col); doc.setLineWidth(0.6);
    doc.roundedRect(M, y, CW, 18, 2, 2, 'D');

    // Labels
    doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(...C.inkMuted);
    doc.text('RISK OF TERMITE ATTACK', M+8, y+6);
    doc.setFont('helvetica','bold'); doc.setFontSize(15); doc.setTextColor(...col);
    doc.text(level || 'NOT ASSESSED', M+8, y+14.5);
    doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(...C.inkLight);
    doc.text(standard, W-M-4, y+14.5, { align:'right' });
    y += 24;
  }

  // ── SUBHEADING ── a small label and rule over a group of rows
  function subhead(label) {
    if (y > 250) newPage();
    const top = atPageTop(), underTitle = y <= titleUntil + 0.5;
    y += 3;
    doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(...C.accentDark);
    doc.text(label, M, y); y += 2.2;
    doc.setFillColor(...C.accentLight); doc.rect(M, y, CW, 0.5, 'F'); y += 1.5;
    _rowShade = false;
    if (top) pageTopUntil = y;
    if (underTitle) titleUntil = y;
  }

  // Draws wrapped lines, carrying on over the page break where needed, so a
  // long paragraph never leaves its heading alone at the foot of a page.
  function flowLines(lines, x, leading, color) {
    const font = doc.getFont(), size = doc.getFontSize();
    lines.forEach(line => {
      if (y + leading > 280) { newPage(); doc.setFont(font.fontName, font.fontStyle); doc.setFontSize(size); }
      doc.setTextColor(...color);
      doc.text(line, x, y); y += leading;
    });
  }

  // ── DISCLAIMER ────────────────────────────────────────────────────────────
  function disclaimer(text) {
    doc.setFont('helvetica','italic'); doc.setFontSize(7.8); doc.setTextColor(...C.inkLight);
    const lines = doc.splitTextToSize(text, CW - 6);
    const blockH = lines.length * 4 + 3;
    if (y + blockH > 280) newPage();
    // Subtle left bar
    doc.setFillColor(...C.accentLight); doc.rect(M, y, 1.5, blockH, 'F');
    doc.text(lines, M+4, y+3); y += blockH + 2;
    doc.setFont('helvetica','normal');
  }

  // Several short notes in one block, a line or two each.
  function noteList(notes) {
    doc.setFont('helvetica','italic'); doc.setFontSize(7.8);
    const blocks = notes.map(n => doc.splitTextToSize(n, CW - 6));
    const blockH = blocks.reduce((h, l) => h + l.length * 3.6 + 1.6, 0) + 1.6;
    if (y + blockH > 280) newPage();
    doc.setFillColor(...C.accentLight); doc.rect(M, y, 1.5, blockH, 'F');
    doc.setTextColor(...C.inkLight);
    let ty = y + 3.2;
    blocks.forEach(lines => { doc.text(lines, M + 4, ty, { lineHeightFactor: 1.3 }); ty += lines.length * 3.6 + 1.6; });
    y += blockH + 2;
    doc.setFont('helvetica','normal');
  }

  // ── CALLOUT ── a tinted note with a coloured bar: a short bold title, then
  // plain text. tone: 'bad' | 'warn'.
  function callout(title, body, tone, x = M, w = CW) {
    const col = tone === 'warn' ? C.warn : C.danger;
    const bg  = tone === 'warn' ? [253,247,234] : [253,242,240];
    doc.setFont('helvetica','normal'); doc.setFontSize(8);
    const lines = doc.splitTextToSize(body, w - 12);
    const h = 11 + lines.length * 4;
    if (y + h > 278) newPage();
    doc.setFillColor(...bg); doc.roundedRect(x, y, w, h, 1.5, 1.5, 'F');
    doc.setFillColor(...col); doc.rect(x, y, 1.5, h, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(...col);
    doc.text(title.toUpperCase(), x + 6, y + 6);
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(...C.inkLight);
    doc.text(lines, x + 6, y + 11);
    y += h + 4;
    doc.setTextColor(...C.ink);
  }

  // ── BUILDER / ENGINEER REFERRAL BOX ────────────────────────────────────────────────
  function referralBox() {
    callout('Builder or engineer referral', 'The inspector recommends that the damage described above be assessed by a licensed builder or structural engineer. A timber pest inspection does not assess structural soundness or load-bearing capacity, and no opinion on either is given in this report.', 'bad');
  }

  // ── PHOTOS ─────────────────────────────────────────────────────────────
  // Every photo is numbered in report order, so the text can point to one.
  // 'cover' fills its box and trims the overflow (used for the front of the
  // house); 'contain' shows the whole photo on a light panel, so evidence is
  // never cropped or stretched.
  let photoNo = 0;
  function drawPhoto(src, x, top, w, h, mode = 'contain') {
    const fmt = src.startsWith('data:image/png') ? 'PNG' : 'JPEG';
    const props = doc.getImageProperties(src);
    const ratio = props.width / props.height;
    doc.saveGraphicsState();
    doc.roundedRect(x, top, w, h, 1.6, 1.6, null); doc.clip(); doc.discardPath();
    if (mode === 'cover') {
      let iw = w, ih = w / ratio;
      if (ih < h) { ih = h; iw = h * ratio; }
      doc.addImage(src, fmt, x + (w - iw) / 2, top + (h - ih) / 2, iw, ih, undefined, 'FAST');
    } else {
      doc.setFillColor(...C.rowAlt); doc.rect(x, top, w, h, 'F');
      let iw = w, ih = w / ratio;
      if (ih > h) { ih = h; iw = h * ratio; }
      doc.addImage(src, fmt, x + (w - iw) / 2, top + (h - ih) / 2, iw, ih, undefined, 'FAST');
    }
    doc.restoreGraphicsState();
    doc.setDrawColor(...C.rule); doc.setLineWidth(0.3);
    doc.roundedRect(x, top, w, h, 1.6, 1.6, 'D');
  }
  function photoUnavailable(x, top, w, h) {
    doc.setFillColor(...C.rowAlt); doc.roundedRect(x, top, w, h, 1.6, 1.6, 'F');
    doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(...C.inkMuted);
    doc.text('Photo not available', x + w / 2, top + h / 2, { align:'center' });
  }

  // Photos two to a row, each with its number and caption under it.
  // The height of one row of the grid: two photos and their captions.
  function photoRow(pair, w = CW) {
    const boxW = (w - 5) / 2, boxH = boxW * 0.72;
    doc.setFontSize(7);
    const caps = pair.map(p => pdfClipLines(doc, (p.caption || '').trim(), boxW - 16, 2));
    return { boxW, boxH, caps, h: boxH + 5 + Math.max(...caps.map(c => Math.max(1, c.length))) * 3.3 + 4 };
  }
  function photoGrid(photos, x = M, w = CW) {
    const gutter = 5;
    for (let i = 0; i < photos.length; i += 2) {
      const pair = photos.slice(i, i + 2);
      const { boxW, boxH, caps, h: rowH } = photoRow(pair, w);
      if (y + rowH > 280) newPage();
      pair.forEach((p, k) => {
        const px = x + k * (boxW + gutter);
        const no = ++photoNo;
        try {
          if (!photoSrc[p.id]) throw new Error('no image');
          drawPhoto(photoSrc[p.id], px, y, boxW, boxH);
        } catch (e) { photoUnavailable(px, y, boxW, boxH); }
        doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(...C.accentDark);
        doc.text(`Photo ${no}`, px, y + boxH + 4.5);
        if (caps[k].length) {
          doc.setFont('helvetica','normal'); doc.setTextColor(...C.inkLight);
          doc.text(caps[k], px + 14, y + boxH + 4.5, { lineHeightFactor: 1.35 });
        }
      });
      y += rowH;
    }
  }

  function renderSectionPhotosInPDF(sectionKey, label, list) {
    const photos = list || (reportData.photosBySection || {})[sectionKey] || [];
    if (photos.length === 0) return;
    gap(2);
    // Keep the label with the first row of photos.
    if (y + 9 + photoRow(photos.slice(0, 2)).h > 280) newPage();
    subhead('PHOTOS — ' + label.toUpperCase());
    photoGrid(photos);
    gap(3);
  }

  // The front of the house across the page, under its section's title.
  function heroPhoto(p, h, caption) {
    if (!p || !photoSrc[p.id]) return;
    if (y + h + 8 > 278) newPage();
    try { drawPhoto(photoSrc[p.id], M, y, CW, h, 'cover'); } catch (e) { return; }
    y += h + 2;
    if (caption) {
      doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(...C.inkMuted);
      doc.text(caption, M, y + 3); y += 6;
    }
    y += 3;
  }

  function photoGallery() {
    const photos = reportData.photos || [];
    // With no photos it's two lines: they fit under the recommendations
    // instead of taking a near-empty page of their own.
    if (!photos.length) { pageLabel = 'Photographs'; if (y + 24 > 278) newPage(); else gap(8); _rowShade = false; }
    else startPart('Photographs');
    sectionTitle('PHOTOGRAPHS', REPORT_PARTS.photos, photos.length ? photoRow(photos.slice(0, 2)).h : 30);
    if (!photos.length) {
      doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(...C.inkLight);
      doc.text('No general photographs were attached. Photos of each area appear in the section they belong to.', M, y);
      y += 8;
      return;
    }
    photoGrid(photos);
    gap(4);
  }

  // ── NOTES BLOCK ───────────────────────────────────────────────────────────
  const FIELD_LABELS = {
    structureType:'Structure Type', wallConstruction:'Wall Construction', floorType:'Floor Type', roofType:'Roof Type',
    height:'Height', facadeDirection:'Orientation', occupancyStatus:'Occupancy Status', furnishing:'Furnishing', peoplePresent:'People Present', weatherConditions:'Weather Conditions', temperature:'Temperature', humidity:'Humidity', rainLast24h:'Rain in the Last 24 Hours', recentWeather:'Recent Weather', toolsUsed:'Tools Used', siteSurroundings:'Surroundings', siteSlope:'Site Slope', termiteHistory:'Termite History', mouldSeen:'Mould Seen', mouldWhere:'Mould: Where',
    constructionEra:'Year or Period Built', standard:'Applicable Standard',
    hinderedAreas:'Hindered Access: Where', obstructions:'Areas Not Inspected', restrictedAccess:'Obstructions', hinderedAreasDetail:'What Hindered Access', noAccessAreas:'Restricted Access: Where & Why', highRiskAreas:'High Risk Areas',
    previousTreatment:'Evidence of Previous Treatment', previousTreatmentDetails:'Previous Treatment: What', previousTreatmentWhere:'Previous Treatment: Where', siteDrainage:'Site Drainage', subfloorDrainage:'Subfloor Drainage',
    borerActivity:'Borers of Seasoned Timber', borerDetails:'Borer Type, Location & Evidence', decayFound:'Wood Decay Fungi (Rot)', decayDetails:'Wood Decay: What', decayWhere:'Wood Decay: Where',
    termiteActivity:'Termite Activity Status', species:'Species', damageDescription:'Damage Description', activityLocation:'Location of Activity', nestLocated:'Termite Nest Found?', structuralConcern:'Builder / Engineer Referral',
    waterLeaks:'Water Leaks', leakLocation:'Location of Moisture Ingress', moistureReadings:'Moisture Readings', timberSoil:'Timber-to-Soil Contact', timberSoilDetails:'Timber-to-Soil: Where and What', slabEdge:'Slab Edge Exposure', weepHoles:'Weep Holes', existingSystem:'Existing System',
    durableNoticePresent:'Durable Notice Present', hardLandscaping:'Hard Landscaping Adjacent', zone25mmVisible:'25 mm Inspection Zone Visible', softLandscaping:'Soft Landscaping Adjacent', zone75mmVisible:'75 mm Inspection Zone Visible', antCapSoldered:'Ant Cap Joins Soldered',
    treatmentRecommended:'Treatment Recommended', treatmentType:'Treatment Type', inspectionFrequency:'Re-inspection Interval', riskLevel:'Risk of Termite Attack',
    invasiveInspection:'Invasive Inspection Recommended', invasiveInspectionDetails:'Invasive Inspection: Where, Why and When', otherRecommendations:'Other Recommendations', antCapping:'Ant Capping', antCappingDetails:'Ant Capping: Where and What',
    delignification:'Chemical Delignification', delignificationDetails:'Delignification: What', delignificationWhere:'Delignification: Where', subfloorVentilation:'Subfloor Ventilation', nonDurableTimber:'Non-durable Timber in Damp Areas', nonDurableTimberDetails:'Non-durable Timber: What', nonDurableTimberWhere:'Non-durable Timber: Where',
  };

  function notesBlock(sectionKey) {
    const keys = (SECTIONS[sectionKey] && SECTIONS[sectionKey].fields) || [];
    const notes = keys.map(k => [k, (fieldNotes[k]||'').trim()]).filter(([,v]) => v.length > 0);
    if (notes.length === 0) return;
    if (y > 250) newPage();
    gap(3);
    doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(...C.inkMuted);
    doc.text('ADDITIONAL NOTES', M, y); y += 5;
    notes.forEach(([key, text]) => {
      if (y > 270) newPage();
      doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...C.accentDark);
      doc.text((FIELD_LABELS[key] || key) + ':', M, y); y += 4.5;
      doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(...C.ink);
      const wrapped = doc.splitTextToSize(text, CW-4);
      if (y + wrapped.length*4 > 280) newPage();
      doc.text(wrapped, M+2, y); y += wrapped.length*4+4;
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COVER PAGE
  // ═══════════════════════════════════════════════════════════════════════════
  // White cover — professional, clean, client-facing

  // Full white page
  doc.setFillColor(...C.white); doc.rect(0, 0, W, 297, 'F');

  const company = getCompanyDetails();
  drawPdfLetterhead(doc, company, { docLabel: 'Inspection Report', date: today });

  // ── TITLE BLOCK ───────────────────────────────────────────────────────────
  // The title follows the standard: a termite inspection (AS 3660.2) or a
  // timber pest inspection (AS 4349.3), pre-purchase when it is one.
  const prePurchase = isPrePurchaseJob();
  const reportTypeLabel = prePurchase ? 'PRE-PURCHASE TIMBER PEST' : reportKindTitle().replace(/ Inspection Report$/, '').toUpperCase();
  doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...C.accentDark);
  pdfTracked(doc, reportTypeLabel, M, 52, { cs: 0.7 });
  doc.setFont('helvetica','bold'); doc.setFontSize(34); doc.setTextColor(...C.ink);
  doc.text('Inspection Report', M, 66);
  doc.setFillColor(...C.accent); doc.rect(M, 70.5, 22, 1.4, 'F');

  // Standard reference
  doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(...C.inkLight);
  doc.text('Prepared with reference to', M, 80);
  doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(...C.ink);
  doc.text(doc.splitTextToSize(standardLabel, 100)[0], M, 85);

  // ── PROPERTY PHOTO ── the front of the house across the page, under the
  // title. Without one, the property block moves up into its place.
  const frontPhoto = ((reportData.photosBySection || {}).general || []).find(p => photoSrc[p.id]);
  const coverPhoto = frontPhoto || (reportData.photos || []).find(p => photoSrc[p.id]);
  let coverShift = 0;
  if (coverPhoto) {
    try { drawPhoto(photoSrc[coverPhoto.id], M, 93, CW, 62, 'cover'); coverShift = 68; } catch (e) {}
  }

  // ── THE PROPERTY ──────────────────────────────────────────────────────────
  // The client's property, large, then the job details in a two-column grid.
  doc.setFillColor(...C.accent); doc.rect(M, 96 + coverShift, CW, 0.5, 'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(6.5); doc.setTextColor(...C.inkMuted);
  pdfTracked(doc, 'PROPERTY INSPECTED', M, 104 + coverShift, { cs: 0.4 });
  doc.setFont('helvetica','bold'); doc.setFontSize(17); doc.setTextColor(...C.ink);
  const addrLines = pdfClipLines(doc, address, CW, 2);
  doc.text(addrLines, M, 112 + coverShift, { lineHeightFactor: 1.2 });
  let gy = 112 + coverShift + (addrLines.length - 1) * 7.2 + 9;

  const coverRows = [
    ['CLIENT',            client],
    ['INSPECTION TYPE',   reportData.jobInspectionType || ''],
    ['INSPECTOR',         inspector],
    ['PEST LICENCE NO.',  reportData.inspectorLicence || ''],
    ['DATE OF INSPECTION',inspectionDate],
    ['INSPECTION TIME',   formatClockTime(reportData.jobInspectionTime || '')],
    ['REPORT REFERENCE',  reportId],
  ].filter(([, v]) => v);

  const colW = (CW - 10) / 2, cellH = 13;
  gy -= 1;
  for (let i = 0; i < coverRows.length; i += 2) {
    [coverRows[i], coverRows[i + 1]].forEach((r, k) => {
      if (!r) return;
      const x = M + k * (colW + 10);
      doc.setFont('helvetica','bold'); doc.setFontSize(6.3); doc.setTextColor(...C.inkMuted);
      pdfTracked(doc, r[0], x, gy + 5.2, { cs: 0.3 });
      doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(...C.ink);
      doc.text(doc.splitTextToSize(String(r[1]), colW - 2)[0], x, gy + 10);
    });
    gy += cellH;
  }

  // ── RISK ASSESSMENT BADGE ─────────────────────────────────────────────────
  // The rating is spelt out in bold, so it reads the same printed in grey.
  const riskLvl   = reportData.riskLevel || null;
  const riskBadgeY = gy + 10;
  const riskCol    = riskLvl==='HIGH' ? C.danger : riskLvl==='MEDIUM' ? C.warn : riskLvl==='LOW' ? C.safe : C.inkMuted;
  const riskBgCol  = riskLvl==='HIGH' ? [253,242,240] : riskLvl==='MEDIUM' ? [253,247,234] : riskLvl==='LOW' ? [233,248,238] : [248,246,243];

  if (riskBadgeY < 262) {
    const rh = 22;
    doc.setFillColor(...riskBgCol); doc.rect(M, riskBadgeY, CW, rh, 'F');
    doc.setFillColor(...riskCol); doc.rect(M, riskBadgeY, 2.2, rh, 'F');
    doc.setDrawColor(...riskCol); doc.setLineWidth(0.35); doc.rect(M, riskBadgeY, CW, rh, 'D');
    doc.setFont('helvetica','bold'); doc.setFontSize(6.5); doc.setTextColor(...C.inkLight);
    pdfTracked(doc, 'RISK OF TERMITE ATTACK', M+8, riskBadgeY+7.5, { cs: 0.4 });
    doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.setTextColor(...riskCol);
    doc.text(riskLvl || 'PENDING ASSESSMENT', M+8, riskBadgeY+16.5);
    const basis = riskLvl ? reportSummary().basis : [];
    if (basis.length) {
      const bw = CW - 80;
      doc.setFont('helvetica','bold'); doc.setFontSize(6.3); doc.setTextColor(...C.inkMuted);
      pdfTracked(doc, 'BASED ON', W-M-6, riskBadgeY+7.5, { cs: 0.4, align: 'right' });
      doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(...C.inkLight);
      const lines = pdfClipLines(doc, basis.join(' · '), bw, 2);
      lines.forEach((ln, i) => doc.text(ln, W-M-6, riskBadgeY+13 + i*4, { align:'right' }));
    }
  }

  // ── COVER FOOTER ──────────────────────────────────────────────────────────
  doc.setFillColor(...C.rule); doc.rect(M, 284, CW, 0.3, 'F');
  doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(...C.inkMuted);
  const footerPreparedBy = company.name ? `Prepared by ${company.name}` : 'Generated via SAYON';
  // A long business name would run into the centred line, so then the
  // centred line goes above the other two.
  const coverDisclaimer = 'This report does not conclusively determine that the property is free of termites.';
  const crowded = doc.getTextWidth(footerPreparedBy) + 4 > W/2 - doc.getTextWidth(coverDisclaimer)/2 - M;
  const footY = crowded ? 293 : 291;
  doc.text(coverDisclaimer, W/2, crowded ? 289 : 291, { align:'center' });
  doc.text(pdfFitText(doc, footerPreparedBy, CW - 40), M, footY);
  doc.setFont('helvetica','bold'); doc.setTextColor(...C.inkLight);
  doc.text(today, W-M, footY, { align:'right' });

  // ── CONTENTS ── its page is kept here and filled in at the end, once
  // every section's page is known.
  pageLabel = 'Contents';
  newPage();
  const contentsPageNo = doc.internal.getNumberOfPages();

  // A short paragraph of body text.
  function para(text, size = 8, color = C.inkLight) {
    const top = atPageTop(), underTitle = y <= titleUntil + 0.5;
    const page = doc.internal.getNumberOfPages();
    doc.setFont('helvetica','normal'); doc.setFontSize(size);
    flowLines(doc.splitTextToSize(text, CW), M, size * 0.54, color);
    y += 3;
    if (top) pageTopUntil = y;
    if (underTitle && doc.internal.getNumberOfPages() === page) titleUntil = y;
  }
  const co = getCompanyDetails();
  const clientPhone = reportData.jobClientPhone || document.getElementById('jobClientPhone')?.value?.trim();
  const clientEmail = reportData.jobClientEmail || document.getElementById('jobClientEmail')?.value?.trim();
  const inspectionTime = formatClockTime(reportData.jobInspectionTime || document.getElementById('jobInspectionTime')?.value?.trim() || '');
  const orderId  = reportData.jobOrderId || document.getElementById('jobOrderId')?.value?.trim();
  const inspType = reportData.jobInspectionType || document.getElementById('jobInspectionType')?.value?.trim();

  // ─────────────────────────────────────────────────────────────────────
  // 1. CLIENT & INSPECTION DETAILS: who it's for, where, when, what was
  // asked for, and who inspected it, before any result.
  // ─────────────────────────────────────────────────────────────────────
  startPart('Client & Inspection Details', true);
  sectionTitle('CLIENT & INSPECTION DETAILS', REPORT_PARTS.client);
  subhead('CLIENT');
  facts([['Client Name', client], ['Client Phone', clientPhone], ['Client Email', clientEmail]]);
  gap(4);
  subhead('THE INSPECTION');
  facts([
    ['Property Inspected', address, false, 'wide'],
    ['Inspection Date', inspectionDate], ['Inspection Time', inspectionTime],
    ['Inspection Type', inspType], ['People Present', reportData.peoplePresent],
    ['Weather Conditions', reportData.weatherConditions], ['Temperature', reportData.temperature],
    ['Humidity', reportData.humidity], ['Rain in the Last 24 Hours', reportData.rainLast24h],
    ['Recent Weather', reportData.recentWeather], ['Tools Used', reportData.toolsUsed],
    ['Applicable Standard', standardLabel, false, 'wide'],
    ['Order / Job ID', orderId], ['Report Reference', reportId],
  ]);
  gap(4);
  subhead('INSPECTION PROVIDER');
  facts([
    ['Inspecting Company', co.name], ['Pest Control Licence', co.licence],
    ['ABN', co.abn], ['Company Phone', co.phone],
    ['Company Email', co.email], ['Inspector', inspector],
    ['Inspector Licence No.', reportData.inspectorLicence],
  ]);
  gap(5);
  disclaimer('This report describes the property as it was on the day of the inspection. If it is relied on more than 30 days after that date, the property should be re-inspected first, because timber pest activity can start or spread in that time.');
  gap(1);
  disclaimer('The inspection covered the main building, and the other buildings, structures, fences and trees on the site within 30 metres of the main building and within the property boundaries. Anything further away was not inspected unless this report says it was.');
  if (/unit|apartment|terrace|townhouse/i.test(reportData.structureType || '')) {
    gap(1);
    disclaimer('For a unit, townhouse or other strata or company title property, only the interior of this unit and its immediate exterior were inspected. Common property and other units were not, and timber pests in them can spread to this unit. An inspection of the whole complex is recommended.');
  }

  // ─────────────────────────────────────────────────────────────────────
  // 2. SUMMARY: the reader's questions in three groups (access, activity,
  // safety & risk), each answer pointing to the section with the detail.
  // ─────────────────────────────────────────────────────────────────────
  // The summary is a page of its own. If it runs over, it's drawn again a
  // little tighter, which brings all but the longest back onto one page.
  // One that still runs over is followed straight on by the next part,
  // rather than leaving its last few lines alone on a page.
  const { groups: summaryGroups, next: summaryNext } = reportSummary();
  function drawSummary(tight) {
    startPart('Summary', true);
    sectionTitle('SUMMARY', REPORT_PARTS.summary);
    const groups = summaryGroups, next = summaryNext;
    const T = tight ? { row: 7.6, line: 3.1, head: 6.2, groupGap: 2.5, item: 4, itemGap: 0.9, after: 2 }
      : { row: 9, line: 3.4, head: 7, groupGap: 5, item: 4.3, itemGap: 1.8, after: 4 };
    const TONE = { bad: [C.danger, [253,242,240]], warn: [C.warn, [253,247,234]], good: [C.safe, [233,248,238]], none: [C.inkMuted, C.rowAlt] };
    const QW = CW - 72, chipW = 34, chipX = W - M - 26 - chipW;
    groups.forEach(g => {
      if (y + 22 > 276) newPage();
      doc.setFillColor(...C.accentDark); doc.rect(M, y, CW, T.head, 'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...C.white);
      doc.text(g.title.toUpperCase(), M + 3, y + T.head - 2.2);
      y += T.head;
      g.items.forEach(([q, answer, tone, section, detail], i) => {
        doc.setFont('helvetica','normal'); doc.setFontSize(7.2);
        const dl = detail ? pdfClipLines(doc, detail, QW, 2) : [];
        const h = T.row + dl.length * T.line;
        if (y + h > 278) newPage();
        if (i % 2 === 1) { doc.setFillColor(...C.rowAlt); doc.rect(M, y, CW, h, 'F'); }
        doc.setDrawColor(...C.ruleLight); doc.setLineWidth(0.25); doc.line(M, y + h, M + CW, y + h);
        doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(...C.ink);
        doc.text(q, M + 3, y + T.row - 3.4);
        if (dl.length) {
          doc.setFont('helvetica','normal'); doc.setFontSize(7.2); doc.setTextColor(...C.inkLight);
          doc.text(dl, M + 3, y + T.row + 0.4, { lineHeightFactor: tight ? 1.15 : 1.25 });
        }
        const [col, bg] = TONE[tone] || TONE.none;
        const chipY = y + T.row / 2 - 2.7;
        doc.setFillColor(...bg); doc.roundedRect(chipX, chipY, chipW, 5.6, 1, 1, 'F');
        doc.setFillColor(...col); doc.rect(chipX, chipY, 1.2, 5.6, 'F');
        doc.setFont('helvetica','bold'); doc.setTextColor(...col);
        doc.setFontSize(7.5);
        if (doc.getTextWidth(answer) > chipW - 3) doc.setFontSize(7.5 * (chipW - 3) / doc.getTextWidth(answer));
        doc.text(answer, chipX + chipW / 2 + 0.6, chipY + 3.8, { align: 'center' });
        doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(...C.inkMuted);
        doc.text(`See Section ${section}`, W - M - 2, y + T.row - 3.4, { align: 'right' });
        y += h;
      });
      y += T.groupGap;
    });

    if (next.length) {
      if (tight) y += 2.5;
      if (y + 14 > 270) newPage();
      doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(...C.accentDark);
      doc.text('WHAT TO DO NEXT', M, y); y += 2.2;
      doc.setFillColor(...C.accentLight); doc.rect(M, y, CW, 0.5, 'F'); y += 5;
      next.forEach((item, i) => {
        const lines = doc.splitTextToSize(item, CW - 8);
        if (y + lines.length * T.item > 276) newPage();
        doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(...C.accentDark);
        doc.text(`${i + 1}.`, M, y);
        doc.setFont('helvetica','normal'); doc.setTextColor(...C.ink);
        doc.text(lines, M + 6, y);
        y += lines.length * T.item + T.itemGap;
      });
      y += T.after;
    }
    disclaimer('This summary gives the main results only. Read the full report, including the areas that could not be inspected, the limitations and the terms, before relying on it.');
  }
  const summaryState = pdfState();
  drawSummary(false);
  if (doc.internal.getNumberOfPages() > summaryState.n + 1) { restorePdfState(summaryState); drawSummary(true); }
  const summaryOnOnePage = doc.internal.getNumberOfPages() === summaryState.n + 1;

  // ─────────────────────────────────────────────────────────────────────
  // 3. ABOUT THE PROPERTY, with the limits that come with how it's built
  // and used printed beside the rows they belong to.
  // ─────────────────────────────────────────────────────────────────────
  keep(fresh => {
    startPart('About the Property', fresh || summaryOnOnePage);
    sectionTitle('ABOUT THE PROPERTY', REPORT_PARTS.property);
    heroPhoto(frontPhoto, 70, 'Front of the property');
    facts([
      ['Structure Type', reportData.structureType],
      ['Height', RENAMED_CHOICES.height[reportData.height] || reportData.height],
      ['Wall Construction', reportData.wallConstruction],
      ['Floor Type', reportData.floorType],
      ['Roof Type', reportData.roofType],
      ['Orientation', reportData.facadeDirection],
      ['Year / Period of Construction', String(reportData.constructionEra || '').replace(/(\ds?)-(\d)/g, '$1–$2')],
      ['Occupancy Status', reportData.occupancyStatus],
      ['Furnishing', reportData.furnishing],
      ['Site Slope', reportData.siteSlope],
      ['Surroundings', reportData.siteSurroundings],
      ['Termite History', reportData.termiteHistory],
    ]);
    // What the way it's built and used means for the inspection, as short
    // notes under the facts rather than between them.
    const propertyNotes = [];
    if (/slab/i.test(reportData.floorType || '')) {
      propertyNotes.push('Slab floor: termites can get in unseen through cracks, joints and pipes in the slab, and over its edge. Keep the slab edge exposed and have the building inspected regularly.');
    }
    // Asbestos is outside a timber pest inspection, so this is a general note
    // for buildings of the period, not a rating of this property.
    if (['1920s-1940s', '1945-1965', '1965-1985', '1985-2003'].includes(reportData.constructionEra)) {
      propertyNotes.push('Built in this period: it may contain asbestos. This is not an asbestos inspection, nothing was tested or disturbed, and no opinion is given on it. Have a licensed asbestos assessor check before work that disturbs building materials.');
    }
    // The furniture note follows what was recorded about furniture; without
    // that, an occupied home is taken to be furnished, as before.
    const furnished = reportData.furnishing
      ? !/^unfurnished/i.test(reportData.furnishing)
      : /occupied|tenanted|owner/i.test(reportData.occupancyStatus || '');
    if (furnished) {
      const how = /partly/i.test(reportData.furnishing || '') ? 'Partly furnished' : (reportData.furnishing ? 'Furnished' : 'Occupied and furnished');
      propertyNotes.push(`${how}: furniture, stored goods and floor coverings hid parts of the walls and floors, where timber pest activity or damage may be concealed.`);
    }
    if (propertyNotes.length) { gap(2); noteList(propertyNotes); resetRowShade(); }

    // The termite management system, and whether it can still be inspected.
    keepGroup(() => {
      subhead('TERMITE MANAGEMENT SYSTEM');
      const identified = hasIdentifiedSystem(reportData.existingSystem);
      facts([
        ['Existing System', RENAMED_CHOICES.existingSystem[reportData.existingSystem] || reportData.existingSystem || 'None recorded'],
        ['System Name', reportData.existingSystemOther],
        ['Durable Notice Present (Meter Box)', reportData.durableNoticePresent, true],
        ...(identified ? [
          ['Hard Landscaping Adjacent', reportData.hardLandscaping, 'plain'],
          ['25 mm Inspection Zone Visible', reportData.zone25mmVisible, true],
          ['Soft Landscaping Adjacent', reportData.softLandscaping, 'plain'],
          ['75 mm Inspection Zone Visible', reportData.zone75mmVisible, true],
          ['Ant Cap / Strip Shield Joins Soldered', reportData.antCapSoldered, true],
        ] : []),
      ]);
      if (identified) {
        const concerns = [];
        if (reportData.durableNoticePresent === 'NO') concerns.push('Durable notice sticker not found in meter box');
        if (reportData.hardLandscaping === 'YES' && reportData.zone25mmVisible === 'NO') concerns.push('25 mm inspection zone not visible against hard landscaping');
        if (reportData.softLandscaping === 'YES' && reportData.zone75mmVisible === 'NO') concerns.push('75 mm inspection zone not visible against soft landscaping');
        if (reportData.antCapSoldered === 'NO') concerns.push('Ant cap / strip shield joins not soldered');
        if (concerns.length > 0) {
          gap(3);
          callout('System verification concern', concerns.join('. ') + '. These checks confirm the system can still be inspected, not that it works. Rectification and re-inspection are recommended.', 'bad');
        }
      }
    });
    renderSectionPhotosInPDF('durable', 'Durable Notice');
    notesBlock('property');
    // Older reports could hold more than one front photo: the rest print here.
    renderSectionPhotosInPDF(null, 'Property', ((reportData.photosBySection || {}).general || []).filter(p => p !== frontPhoto));
  });

  // ─────────────────────────────────────────────────────────────────────
  // 4. AREAS INSPECTED: every area, how much of it was inspected, and
  // what was found there.
  // ─────────────────────────────────────────────────────────────────────
  const AREA_STATUS_TEXT = { INSPECTED:'Inspected', PARTIAL:`Inspected with limits (see Section ${REPORT_PARTS.access})`, NOT:'NOT INSPECTED' };
  const anyStatus = Object.keys(OBS_ZONES).some(z => areaStatusOf(z));
  const noneRow = complete => row('Result', complete ? 'None' : 'Not recorded');
  keep(fresh => {
    startPart('Areas Inspected', fresh);
    sectionTitle('AREAS INSPECTED', REPORT_PARTS.areas);
    resetRowShade();
    para(`Each area of the property, how much of it could be inspected, and whether timber pest evidence was found there. Why an area could not be fully inspected is set out in Section ${REPORT_PARTS.access}.`);
    Object.entries(OBS_ZONES).forEach(([zoneId, zone]) => {
      const st = areaStatusOf(zoneId);
      // An area the property doesn't have isn't listed.
      if (!st || st === 'NA') return;
      const result = areaResultOf(zoneId);
      // With no result marked, evidence recorded elsewhere that names the area
      // still prints, rather than "not recorded" over a finding in it.
      const ev = result === 'FOUND' || !result ? areaEvidence(zoneId) : [];
      const resultText = !result && !ev.length ? 'Result not recorded'
        : ev.length ? `Timber pest evidence found, see ${ev.join('; ')}` : AREA_RESULT_TEXT[result];
      row(zone.label, AREA_STATUS_TEXT[st] + (areaWasEntered(zoneId) ? `. ${resultText}.` : ''));
    });
    if (!anyStatus) noneRow(false);
    notesBlock('obstructions');
    renderSectionPhotosInPDF('obstructions', 'Areas Inspected');
  });

  // ─────────────────────────────────────────────────────────────────────
  // 5. AREAS UNABLE TO BE INSPECTED, AND WHY: hindered access (temporary
  // obstructions), restricted access (permanent or locked), the high risk
  // areas to which access should be gained, and whether an invasive
  // inspection is recommended because of them. See accessLimits().
  // ─────────────────────────────────────────────────────────────────────
  keep(fresh => {
    startPart('Areas Unable to Be Inspected', fresh);
    sectionTitle('AREAS UNABLE TO BE INSPECTED, AND WHY', REPORT_PARTS.access);
    const acc = accessLimits();
    const noLimits = !areasNotFullyInspected().length;

    // Each of the four is a heading over what was recorded under it. One
    // with nothing to list is a single line instead, its heading as the
    // label, so a clear property doesn't spend a page saying so.
    let afterRow = false;  // a one-line group just above: leave a gap under it
    function accessGroup(title, entries, complete, after) {
      if (!entries.length && !after) { row(title, complete ? 'None' : 'Not recorded'); afterRow = true; return; }
      resetRowShade();
      const spaced = afterRow;
      afterRow = false;
      keepGroup(() => {
        if (spaced && !atPageTop()) gap(5);
        subhead(title);
        entries.forEach(([label, text]) => row(label, text));
        if (!entries.length) noneRow(complete);
        if (after) after();
        gap(3);
      });
    }
    accessGroup('OBSTRUCTIONS: TEMPORARY, AT THE TIME OF INSPECTION', acc.hindered, hinderedAnswer() === 'NO' || (acc.allMarked && noLimits));
    accessGroup('RESTRICTED ACCESS: PERMANENT RESTRICTION OR LOCKED ENTRY', acc.restricted, acc.allMarked);
    accessGroup('HIGH RISK AREAS TO WHICH ACCESS SHOULD BE GAINED, OR FULLY GAINED', acc.highRisk ? [['Access should be gained to', acc.highRisk]] : [], acc.allMarked,
      acc.highRisk && (() => { gap(3); disclaimer('These areas may show evidence of timber pest activity or damage. Access should be gained, or fully gained, and a further inspection carried out. Until then it must be assumed that timber pest activity or damage may exist in them.'); }));
    if (reportData.invasiveInspectionDetails || reportData.invasiveInspection === 'YES') {
      accessGroup('INVASIVE INSPECTION', [['Invasive Inspection Recommended', reportData.invasiveInspection || 'Not recorded'], ['Where, Why and When', reportData.invasiveInspectionDetails]].filter(([, v]) => v), false,
        reportData.invasiveInspection === 'YES' && (() => { gap(3); disclaimer('An invasive inspection may involve cutting, drilling or removing linings, floor coverings or timbers to see inside them. It needs the owner\'s written permission and a separate agreement.'); }));
    } else {
      row('Invasive Inspection Recommended', reportData.invasiveInspection || 'Not recorded');
    }
    notesBlock('restrictions');
    renderSectionPhotosInPDF(null, 'Obstructions and restricted access', accessSpotPhotos());
    renderSectionPhotosInPDF('restrictions', 'Areas Unable to Be Inspected');
  });

  // ─────────────────────────────────────────────────────────────────────
  // 6. FINDINGS
  // ─────────────────────────────────────────────────────────────────────
  keep(fresh => {
    startPart('Findings', fresh);
    sectionTitle('FINDINGS', REPORT_PARTS.findings, 85);

    const findings = (reportData.findings && reportData.findings.length > 0)
      ? reportData.findings
      : [{ termiteActivity: reportData.termiteActivity, species: reportData.species, damageDescription: reportData.damageDescription, activityLocation: reportData.activityLocation, nestLocated: reportData.nestLocated, structuralConcern: reportData.structuralConcern }];

    // ── Finding card renderer ────────────────────────────────────────────
    // One card per termite or borer finding: a coloured header with the
    // status, then the labelled facts, the builder referral and the photos.
    // card: { heading, status, tone (bad | warn | none), species, fields:
    // [[label, value, colour?]], referral, photosId }
    // A card is kept whole on one page (see keep()); one too long for a
    // page starts at the top of one.
    function pestCard(card) {
      const actCol = card.tone === 'bad' ? C.danger : card.tone === 'warn' ? C.warn : C.inkMuted;
      const actBg  = card.tone === 'bad' ? [253,242,240] : card.tone === 'warn' ? [253,247,234] : [248,246,243];
      const fields = card.fields.filter(([, v]) => v && String(v).trim());
      keep(fresh => {
        if (fresh) newPage();
        const cardStartY = y, cardStartPage = doc.internal.getNumberOfPages();
        const bodyPad = 6;
        const bodyX   = M + bodyPad;
        const bodyW   = CW - bodyPad * 2;

        // Header
        const headerH = 13;
        doc.setFillColor(...actBg); doc.rect(M, y, CW, headerH, 'F');
        doc.setFillColor(...actCol); doc.rect(M, y, 1.5, headerH, 'F');
        doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(...C.inkMuted);
        doc.text(card.heading, M+8, y+5.5);
        doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(...actCol);
        doc.text(card.status, M+8, y+10.5);
        y += headerH + 5;

        // Species
        if (card.species) {
          doc.setFillColor(245,243,240); doc.roundedRect(bodyX, y, bodyW, 10, 1, 1, 'F');
          doc.setDrawColor(...C.rule); doc.setLineWidth(0.3); doc.roundedRect(bodyX, y, bodyW, 10, 1, 1, 'D');
          doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(...C.inkMuted);
          doc.text('SPECIES / GENUS', bodyX+4, y+4.5);
          doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(...C.ink);
          doc.text(card.species, bodyX+4, y+8.5);
          y += 17;
        }

        // The facts, each a small label over its value, two to a line where
        // both are short and across the card where one is long. A coloured
        // value is a short answer (YES / NO), set in bold.
        const halfW = (bodyW - 8) / 2;
        const valueLines = (v, w) => { doc.setFont('helvetica','normal'); doc.setFontSize(8.5); return doc.splitTextToSize(String(v), w); };
        const factRows = [];
        for (let i = 0; i < fields.length; i++) {
          const a = fields[i], b = fields[i + 1];
          if (b && valueLines(a[1], halfW).length <= 2 && valueLines(b[1], halfW).length <= 2) { factRows.push([a, b]); i++; }
          else factRows.push([a]);
        }
        factRows.forEach(cells => {
          const w = cells.length === 2 ? halfW : bodyW;
          const lines = cells.map(([, v]) => valueLines(v, w));
          const h = 4.2 + Math.max(...lines.map(l => l.length)) * 3.9 + 3.2;
          if (y + h > 280) newPage();
          cells.forEach(([label, , colour], k) => {
            const x = bodyX + k * (halfW + 8);
            doc.setFont('helvetica','bold'); doc.setFontSize(6.5); doc.setTextColor(...C.inkMuted);
            doc.text(label.toUpperCase(), x, y);
            doc.setFont('helvetica', colour ? 'bold' : 'normal'); doc.setFontSize(8.5); doc.setTextColor(...(colour || C.ink));
            doc.text(lines[k], x, y + 4.2, { lineHeightFactor: 1.3 });
          });
          y += h;
        });

        // Builder / engineer referral
        if (card.referral) {
          callout('Builder or engineer referral', 'The inspector recommends a licensed builder or structural engineer assess this damage, and any effect on the structure, before work proceeds.', 'bad', bodyX, bodyW);
        }

        // This finding's own photos, inside its card.
        const fPhotos = card.photosId ? ((reportData.photosBySection || {})[findingPhotoSection(card.photosId)] || []) : [];
        if (fPhotos.length) {
          // The label goes over with the first row of photos, never alone.
          if (y + 3 + photoRow(fPhotos.slice(0, 2), bodyW).h > 280) newPage();
          doc.setFont('helvetica','bold'); doc.setFontSize(6.5); doc.setTextColor(...C.inkMuted);
          doc.text('PHOTOS', bodyX, y); y += 3;
          photoGrid(fPhotos, bodyX, bodyW);
        }

        // A card that ends on a line of text needs less room below it.
        y += card.referral || fPhotos.length ? 3 : 0;
        // The outline only fits a card that stayed on one page.
        if (doc.internal.getNumberOfPages() === cardStartPage) {
          doc.setDrawColor(...C.rule); doc.setLineWidth(0.4);
          doc.rect(M, cardStartY, CW, y - cardStartY, 'D');
        }
        y += 8;
      });
    }

    function findingCard(f, idx) {
      const activity = (f.termiteActivity || '').toUpperCase();
      const nest = f.nestLocated === 'YES' ? ['YES', C.danger] : f.nestLocated ? ['NO', C.safe] : ['NOT RECORDED', C.inkMuted];
      pestCard({
        heading: `TERMITE FINDING ${idx + 1}`,
        status: activity === 'ACTIVE' ? 'LIVE TERMITES PRESENT' : activity === 'INACTIVE' ? 'EVIDENCE ONLY — NO LIVE TERMITES' : activity ? 'NO ACTIVITY FOUND' : 'NOT RECORDED',
        tone: activity === 'ACTIVE' ? 'bad' : activity === 'INACTIVE' ? 'warn' : 'none',
        species: f.species && f.species.trim(),
        fields: [
          ['Location of activity', f.activityLocation],
          ['Timber affected', f.timberAffected],
          ['Damage / workings description', f.damageDescription],
          ['Termite nest found?', nest[0], nest[1]],
        ],
        referral: f.structuralConcern === 'YES',
        photosId: f.id,
      });
    }

    function borerCard(b, idx) {
      pestCard({
        heading: `BORER FINDING ${idx + 1}`,
        status: b.borerActivity === 'ACTIVE' ? 'ACTIVE BORERS — FRESH FRASS OR HOLES' : 'OLD BORER DAMAGE — NOTHING FRESH',
        tone: b.borerActivity === 'ACTIVE' ? 'bad' : 'warn',
        fields: [
          ['Location', b.location],
          ['Timber affected', b.timberAffected],
          ['Borer type', b.borerType],
          ['What was seen', b.description],
        ],
        referral: b.structuralConcern === 'YES',
        photosId: b.id,
      });
    }

    subhead('TERMITES');
    // A report with nothing recorded about termites says so in a row, rather
    // than printing an empty "Not recorded" finding card.
    const findingRecorded = f => ['termiteActivity','species','activityLocation','timberAffected','damageDescription','nestLocated','structuralConcern']
      .some(k => f[k] && String(f[k]).trim()) || ((reportData.photosBySection || {})[findingPhotoSection(f.id)] || []).length;
    if (findings.some(findingRecorded)) findings.forEach((f, idx) => findingCard(f, idx));
    else { row('Termite Activity', 'Not recorded'); gap(4); }

    // Borers, decay and delignification: the other timber pests AS 4349.3
    // covers. Always printed, so an unanswered field reads "Not recorded"
    // rather than silently implying "none found" (row() drops empty values).
    keepGroup(() => {
      subhead('BORERS, WOOD DECAY & CHEMICAL DELIGNIFICATION');
      row('Borers of Seasoned Timber', reportData.borerActivity || 'Not recorded');
      const borerCards = shownBorerFindings();
      if (borerCards.length) { gap(4); borerCards.forEach(borerCard); }
      row('Wood Decay Fungi (Rot)', reportData.decayFound || 'Not recorded');
      if (reportData.decayDetails) row('Wood Decay: What Was Seen', reportData.decayDetails);
      if (reportData.decayWhere) row('Wood Decay: Where', reportData.decayWhere);
      row('Chemical Delignification', reportData.delignification || 'Not recorded');
      if (reportData.delignificationDetails) row('Delignification: What Was Seen', reportData.delignificationDetails);
      if (reportData.delignificationWhere) row('Delignification: Where', reportData.delignificationWhere);
      gap(3);
    });

    keepGroup(() => {
      subhead('PREVIOUS TERMITE TREATMENT');
      row('Evidence of Previous Treatment', reportData.previousTreatment || 'Not recorded');
      if (reportData.previousTreatmentDetails) row('What Was Seen', reportData.previousTreatmentDetails);
      if (reportData.previousTreatmentWhere) row('Where', reportData.previousTreatmentWhere);
      gap(5);

      disclaimer('This inspection describes the location and visible extent of timber pest activity only. It does not assess structural damage severity — a licensed builder or structural engineer must be engaged for that purpose. Where live termites are found, concealed activity must be assumed in all areas not inspected.');
    });
    notesBlock('findings');
    gap(4);
    renderSectionPhotosInPDF('findings', 'Findings');
  });

  // ─────────────────────────────────────────────────────────────────────
  // 7. CONDUCIVE CONDITIONS. A condition that was found carries a line on
  // why it matters.
  // ─────────────────────────────────────────────────────────────────────
  keep(fresh => {
    startPart('Conducive Conditions', fresh);
    sectionTitle('CONDUCIVE CONDITIONS', REPORT_PARTS.conducive);
    resetRowShade();
    para('Conditions that make timber pest attack more likely. Each one found is explained, and should be fixed.');
    const WHY_IT_MATTERS = {
      waterLeaks: 'Leaking water keeps timber and soil damp, which attracts termites and lets wood decay start.',
      moistureReadings: 'Damp timber and building elements attract termites and let wood decay start.',
      siteDrainage: 'Water lying around the building keeps the soil damp, which attracts termites.',
      subfloorDrainage: 'Water lying in the subfloor keeps it damp, which attracts termites and lets wood decay start.',
      subfloorVentilation: 'A poorly ventilated subfloor stays damp, which attracts termites and lets wood decay start.',
      timberSoil: 'Timber touching the soil gives termites a hidden way into the timber, and from there into the building.',
      slabEdge: 'A covered slab edge lets termites enter the building out of sight. Keep the slab edge exposed so it can be inspected.',
      weepHoles: 'Weep holes covered by soil, paving or garden beds give termites a hidden way into the wall cavity.',
      antCapping: 'Ant caps do not stop termites, but make them build their mud leads in the open where they can be seen. Gaps or missing caps let them pass unseen.',
      nonDurableTimber: 'Untreated or non-durable timber in damp areas is readily attacked by termites and wood decay.',
      mouldSeen: 'Mould is a sign of damp conditions, which attract termites and let wood decay start. This is not a mould inspection, and no opinion is given on the mould itself.',
    };
    const ADVERSE = { waterLeaks: ['YES'], moistureReadings: ['YES'], siteDrainage: ['POOR'], subfloorDrainage: ['POOR'], subfloorVentilation: ['POOR'], mouldSeen: ['YES'],
      timberSoil: ['YES'], slabEdge: ['OBSTRUCTED'], weepHoles: ['BRIDGED'], antCapping: ['GAPS', 'NONE'], nonDurableTimber: ['YES'] };
    function condRow(label, key, shown) {
      const v = reportData[key];
      row(label, shown || v, v && (ADVERSE[key] || []).includes(v) ? 'bad' : undefined);
      if (v && (ADVERSE[key] || []).includes(v) && WHY_IT_MATTERS[key]) {
        doc.setFont('helvetica','italic'); doc.setFontSize(7.3);
        const lines = doc.splitTextToSize(WHY_IT_MATTERS[key], CW - 8);
        if (y + lines.length * 3.6 + 3 > 280) newPage();
        doc.setTextColor(...C.inkLight);
        doc.text(lines, M + 3, y + 3.6); y += lines.length * 3.6 + 2.5;
        doc.setFont('helvetica','normal');
        resetRowShade();
      }
    }

    // ── Moisture group ─────────────────────────────────────────────────────
    const meterReadings = (reportData.moistureTable || []).filter(r => r.location || r.reading);
    keepGroup(() => {
      subhead('MOISTURE, DRAINAGE & VENTILATION');
      condRow('Water Leaks', 'waterLeaks');
      if (reportData.waterLeaks === 'YES' || reportData.leakLocation) {
        row('Location of Moisture Ingress', reportData.leakLocation);
        if (isAboveGroundLeak(reportData.leakLocation)) {
          gap(2);
          callout('Above-ground leak', 'Subterranean termites can establish a secondary moisture-dependent colony in roof voids and wall cavities with no soil contact. Timbers next to this leak should be checked specifically.', 'warn');
        }
      }
      condRow('Moisture Detected', 'moistureReadings');
      meterReadings.forEach(r => row('Moisture Meter Reading', [r.reading, r.location].filter(Boolean).join(' — ')));
      condRow('Site Drainage', 'siteDrainage');
      condRow('Subfloor Drainage', 'subfloorDrainage');
      condRow('Subfloor Ventilation', 'subfloorVentilation');
      if (reportData.mouldSeen) condRow('Mould Seen', 'mouldSeen');
      if (reportData.mouldWhere) row('Mould: Where', reportData.mouldWhere);
      gap(4);
    });

    // ── Construction group ─────────────────────────────────────────────────
    keepGroup(() => {
      subhead('CONSTRUCTION & PHYSICAL BARRIERS');
      condRow('Timber-to-Soil Contact', 'timberSoil');
      if (reportData.timberSoilDetails) row('Timber-to-Soil: Where and What', reportData.timberSoilDetails);
      condRow('Slab Edge Exposure', 'slabEdge');
      condRow('Weep Holes', 'weepHoles', reportData.weepHoles === 'NONE' ? 'None located' : '');
      condRow('Ant Capping', 'antCapping');
      if (reportData.antCappingDetails) row('Ant Capping: Where and What', reportData.antCappingDetails);
      condRow('Non-durable Timber in Damp Areas', 'nonDurableTimber');
      if (reportData.nonDurableTimberDetails) row('Non-durable Timber: What', reportData.nonDurableTimberDetails);
      if (reportData.nonDurableTimberWhere) row('Non-durable Timber: Where', reportData.nonDurableTimberWhere);
      gap(4);
    });

    notesBlock('conducive');
    gap(4);
    // Each condition's own photos, then any from the old section box.
    renderSectionPhotosInPDF(null, 'Conducive Conditions', [...conditionPhotos(), ...((reportData.photosBySection || {}).conducive || [])]);
  });

  // ─────────────────────────────────────────────────────────────────────
  // 8. RECOMMENDATIONS & RISK: the one risk opinion, and what to do.
  // ─────────────────────────────────────────────────────────────────────
  keep(fresh => {
    startPart('Recommendations & Risk', fresh);
    sectionTitle('RECOMMENDATIONS & RISK', REPORT_PARTS.recommendations);
    resetRowShade();
    if (reportData.riskLevel) { riskBanner(reportData.riskLevel); y -= 2; }
    disclaimer('The risk of termite attack is the inspector\'s opinion of how susceptible the property is to termite attack, from what was found, the conducive conditions and the areas that could not be inspected. It is not a rating of any termites found.');
    gap(2);
    if (!reportData.riskLevel) row('Risk of Termite Attack', 'Not recorded');
    row('Treatment Recommended', reportData.treatmentRecommended);
    row('Treatment Type', reportData.treatmentType);
    row('Re-inspection Interval', reportData.inspectionFrequency);
    if (reportData.invasiveInspection === 'YES') row('Invasive Inspection', `Recommended, see Section ${REPORT_PARTS.access}`);
    if (reportData.otherRecommendations) row('Other Recommendations', reportData.otherRecommendations);
    if (getRecLines().length) row('Also Recommended', getRecLines().map(l => `•  ${l.text}`).join('\n'));
    notesBlock('recommendations');
    renderSectionPhotosInPDF('recommendations', 'Recommendations');
    gap(4);
    disclaimer('Note: standard home and contents insurance policies in Australia typically do not cover damage caused by termites or other timber pests. Treatment and any resulting repairs are generally the responsibility of the property owner.');
    gap(8);
  });

  // 9. PHOTOGRAPHS
  photoGallery();

  // ─────────────────────────────────────────────────────────────────────
  // 10. SCOPE, LIMITATIONS, DEFINITIONS & TERMS
  // ─────────────────────────────────────────────────────────────────────
  // Straight on from the part before when half a page or more is left: the
  // columns start there and run on over the page.
  startPart('Scope, Limitations, Definitions & Terms', y > 150);
  sectionTitle('SCOPE, LIMITATIONS, DEFINITIONS & TERMS', REPORT_PARTS.terms);

  // ── TWO COLUMNS ── the scope, definitions and terms are fine print, set
  // in two columns: the text runs down the left column, then the right,
  // then on to the next page. Same words as before, in half the pages.
  const COL_GAP = 8, COL_W = (CW - COL_GAP) / 2, COL_BOTTOM = 280;
  let colIdx = 0, colTop = y, colLeftEnd = y;
  const colX = () => M + colIdx * (COL_W + COL_GAP);
  function nextColumn() {
    const font = doc.getFont(), size = doc.getFontSize();
    if (colIdx === 0) { colLeftEnd = y; colIdx = 1; y = colTop; }
    else { newPage(); colIdx = 0; colTop = colLeftEnd = y; }
    doc.setFont(font.fontName, font.fontStyle); doc.setFontSize(size);
  }
  // Moves on a column when less than h is left in this one.
  function colRoom(h) { if (y + h > COL_BOTTOM) nextColumn(); }
  function colLines(text, dx, size, leading, color, style = 'normal') {
    doc.setFont('helvetica', style); doc.setFontSize(size);
    doc.splitTextToSize(text, COL_W - dx).forEach(line => {
      if (y + leading > COL_BOTTOM) nextColumn();
      doc.setTextColor(...color);
      doc.text(line, colX() + dx, y); y += leading;
    });
  }
  // Back to the full width, under whichever column ran longer.
  function endColumns() {
    if (colIdx === 1) y = Math.max(y, colLeftEnd);
    colIdx = 0;
  }

  function infoPara(text) {
    colLines(text, 0, 7.6, 3.5, C.inkLight);
    y += 2.4;
  }
  function infoHeading(text) {
    colRoom(14);
    gap(1.5);
    colLines(text, 0, 8, 3.7, C.ink, 'bold');
    y += 0.6;
  }
  // A heading for each of the three parts of this section.
  function partHeading(text) {
    colRoom(22);
    if (y > colTop + 1) gap(3);
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(...C.accentDark);
    doc.text(text.toUpperCase(), colX(), y + 1);
    doc.setFillColor(...C.ruleLight); doc.rect(colX(), y + 3, COL_W, 0.4, 'F');
    y += 8;
  }

  partHeading('Scope and limitations');
  infoPara('This was a visual, non-invasive inspection of the property for evidence of timber pest activity, damage, and conditions conducive to timber pest attack. It was carried out by a licensed timber pest inspector with reference to the applicable Australian Standard, and is limited to those areas and sections of the property that were safely and reasonably accessible at the time of inspection.');

  infoHeading('What timber pests are covered?');
  infoPara('This inspection covers subterranean termites (white ants), drywood termites, wood borers, wood decay fungi (rot) and chemical delignification where evidence is observable in accessible areas. These are the timber pests defined in AS 4349.3-2010.');

  infoHeading('What does "non-invasive" mean?');
  infoPara('This inspection does not involve moving furniture, lifting floor coverings, cutting into walls, removing ceiling linings, dismantling built-in cabinetry, or any other action that could cause damage to the property or its contents. The inspector uses visual observation, a probe or screwdriver for tapping and sounding, and a moisture meter where appropriate. Splinter testing of structural timbers in the subfloor or roof void may be carried out where it can be done safely and with the property owner\'s consent.');

  infoHeading('What is "Reasonable Access"?');
  infoPara('Areas were inspected where there was safe and reasonable access, as applied under AS 4349.3-2010: they can be reached safely, without cutting access holes or removing, moving or dismantling anything. In practice that means a roof void access hole of at least 500 mm × 400 mm, reachable with a 3.6 m ladder, with at least 600 mm × 600 mm of crawl space; a roof exterior reachable with a 3.6 m ladder placed on the ground; and a subfloor access hole of at least 500 mm × 400 mm, with at least 400 mm of crawl space beneath the lowest bearer, or 500 mm beneath the lowest part of a concrete floor. Areas that did not meet these are outside the scope of this inspection and are listed in the report.');

  infoHeading('Does this inspection guarantee the property is free of termites?');
  infoPara('No. A visual, non-invasive inspection of this type cannot detect timber pest activity or damage concealed within walls, under floors, inside structural timbers, or in any area that was not accessible at the time of inspection. Termites frequently operate within concealed spaces without external evidence. This report reflects the observable condition of the property at the specific date and time of inspection only. Regular professional re-inspections are the most effective ongoing protection available.');

  // ── DEFINITIONS ──────────────────────────────────────────────────────────
  gap(4);
  partHeading('Definitions');

  const defs = [
    ['Timber Pests', 'Subterranean termites, drywood termites, borers of seasoned timber, wood decay fungi (rot) and chemical delignification, as defined in AS 4349.3-2010.'],
    ['Chemical Delignification', 'The breakdown of timber by chemicals, often from salt air or industrial or chimney emissions, which leaves the surface of the timber looking furry or fibrous.'],
    ['Visual Inspection', 'An inspection conducted by an inspector who uses their unaided visual faculties, and may use a probe, screwdriver, or moisture meter, to observe accessible areas of the property for evidence of timber pest activity, damage, and conducive conditions.'],
    ['Reasonable Access', 'Safe access to an area without cutting access holes or removing, dismantling or disturbing fixed or stored items. Roof void: an access hole of at least 500 mm × 400 mm, reachable with a 3.6 m ladder, and at least 600 mm × 600 mm of crawl space. Roof exterior: reachable with a 3.6 m ladder placed on the ground. Subfloor: an access hole of at least 500 mm × 400 mm and at least 400 mm of crawl space beneath the lowest bearer, or 500 mm beneath the lowest part of a concrete floor.'],
    ['Readily Accessible Area', 'An area that can be inspected without moving furniture, stored goods, floor coverings, wall or ceiling linings, insulation, or personal possessions.'],
    ['Obstructions', 'An area, or part of one, that could not be fully inspected because of temporary obstructions at the time of inspection, such as furniture, stored goods, floor coverings, insulation, vegetation, or low clearance in the subfloor or roof void. The inspector is not required to move obstructions.'],
    ['Restricted Access', 'An area that could not be inspected because of a permanent restriction or locked entry, such as a locked room, a subfloor with no access opening, a roof with no roof void, or a part of the building beyond safe reach.'],
    ['High Risk Areas', 'Areas to which access was not available, or not fully available, that are considered at high risk of concealed timber pest activity. Access should be gained and these areas inspected.'],
    ['Invasive Inspection', 'A further inspection in which linings, floor coverings or timbers may be cut, drilled or removed to look inside them. It needs the owner\'s written permission and a separate agreement.'],
    ['Conducive Conditions', 'Conditions that may attract termites or provide conditions favourable to timber pest activity, including moisture, timber-to-soil contact, inadequate drainage and ventilation, and conditions that compromise the integrity of an existing termite management system.'],
    ['Active Termites', 'Live termites sighted by the inspector during the inspection.'],
    ['Inactive / Evidence Only', 'Evidence of termite activity, such as workings, mudding, damaged timber or galleries, where no live termites were seen at the time of inspection. It does not show when the activity happened or whether termites are still present in concealed areas, so it should be investigated further and the recommendations in this report followed.'],
    ['Previous Treatment', 'Signs that the property has been treated for termites before, such as drill holes in slabs or paving, dusting residue, or bait or monitoring stations. It does not show whether that treatment is still working.'],
  ];

  defs.forEach(([term, def]) => {
    colRoom(11);
    colLines(term + ':', 0, 7.6, 3.5, C.ink, 'bold');
    colLines(def, 2.5, 7.3, 3.3, C.inkLight);
    y += 2.2;
  });

  gap(3);

  // ── IMPORTANT NOTICE ─────────────────────────────────────────────────────
  doc.setFont('helvetica','normal'); doc.setFontSize(7.3);
  const noticeLines = doc.splitTextToSize('This inspection fee covers the cost of the inspection and report only. Treatment of any timber pest activity or damage identified, and any remedial work required, is not included in this fee and is the responsibility of the property owner. Standard home and contents insurance policies generally do not cover termite damage. If you have concerns about your coverage, contact your insurer directly.', COL_W - 10);
  const noticeH = 12 + noticeLines.length * 3.3;
  colRoom(noticeH + 2);
  doc.setFillColor(...C.accentLight); doc.roundedRect(colX(), y, COL_W, noticeH, 2, 2, 'F');
  doc.setFillColor(...C.accent); doc.roundedRect(colX(), y, 3, noticeH, 2, 2, 'F'); doc.rect(colX()+1.5, y, 1.5, noticeH, 'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...C.accentDark);
  doc.text('IMPORTANT NOTICE', colX()+7, y+6);
  doc.setFont('helvetica','normal'); doc.setFontSize(7.3); doc.setTextColor(...C.ink);
  doc.text(noticeLines, colX()+7, y+11, { lineHeightFactor: 1.28 });
  y += noticeH + 4;

  // Pages from here on are headed with the terms.
  pageLabel = 'Terms & Conditions of Inspection';
  partHeading('Terms and conditions of inspection');

  const TC_COLOR = [50,44,38];
  function tcHeading(text) {
    doc.setFont('helvetica','bold'); doc.setFontSize(8);
    const lines = doc.splitTextToSize(text, COL_W - 5);
    colRoom(lines.length * 3.7 + 12);
    if (y > colTop + 1) gap(2);
    // Subtle blue left bar for each clause heading
    doc.setFillColor(...C.accent); doc.rect(colX(), y - 3, 1.6, lines.length * 3.7 + 1.4, 'F');
    doc.setTextColor(...C.ink);
    doc.text(lines, colX() + 4.5, y, { lineHeightFactor: 1.3 });
    y += lines.length * 3.7 + 1.4;
  }
  function tcPara(text) {
    colLines(text, 0, 7.6, 3.5, TC_COLOR);
    y += 2.4;
  }

  tcHeading('1. Purpose and Nature of This Inspection');
  tcPara(`This report records the findings of a visual, non-invasive timber pest inspection carried out with reference to ${standard}. The purpose is to identify observable evidence of timber pest activity, damage, and conditions conducive to pest attack within the accessible areas of the property at the time of inspection. This is not a structural inspection, a pest control treatment, a compliance audit, or a certificate of any kind, and it does not constitute a warranty or guarantee that the property is or will remain free of timber pests or associated damage.`);

  tcHeading('2. Scope of Inspection');
  tcPara('The inspection was confined to areas that were safely and reasonably accessible at the time of the inspection. Readily accessible areas are defined in AS 4349.3-2010 as those that can be inspected without moving furniture, lifting or removing floor coverings or wall linings, breaking apart building elements, exposing concealed spaces, or causing damage to the structure or its contents. The inspector did not move, displace, or remove any floor coverings, insulation, wall linings, ceiling materials, fixed cabinetry, furniture, stored items, or personal belongings. Subfloor and roof void areas were inspected only where safe and reasonable access was available and where minimum clearance dimensions prescribed in the relevant Standard were satisfied.');

  tcHeading('3. Areas Not Inspected — Obstructions and Restricted Access');
  tcPara(`Certain areas of the property could not be inspected, or fully inspected, because of temporary obstructions, or because access was restricted by a permanent restriction or locked entry, as recorded in Section ${REPORT_PARTS.access}. It is acknowledged that timber pest activity or damage may exist within any area that could not be inspected. Where high risk areas have been identified or further investigation recommended, a follow-up inspection should be carried out once access is available. The absence of recorded findings in any area is not a representation that those areas are free of timber pest activity or damage.`);

  tcHeading('4. Limitations of a Visual Non-Invasive Inspection');
  tcPara('A visual, non-invasive inspection of the type described in AS 4349.3-2010 cannot detect activity or damage concealed within wall cavities, structural timber members, beneath floor slabs or coverings, inside hollow trees or stumps, behind fixed linings, or in any area that cannot be directly observed without causing damage. Subterranean termites are frequently active inside walls, flooring, and structural framing without any external indicators being visible. The findings of this report reflect observable conditions in accessible areas at the time of inspection only. No inspection of this nature can conclusively establish that a property is free of timber pest infestation, activity, or damage.');

  tcHeading('5. Damage Assessment — No Structural Opinion');
  tcPara('Where timber pest damage has been recorded in this report, the description is limited to the observable location, affected building elements, and visible characteristics of the damage. The inspector is not qualified to assess the structural significance of any damage identified, and no opinion regarding structural integrity, load-bearing capacity, or engineering risk is expressed or implied in this report. Where a builder or engineer referral has been made, the client is strongly advised to engage a licensed builder or structural engineer to carry out a structural assessment before undertaking any remedial work or making decisions in reliance on that finding.');

  tcHeading('6. Conditions May Change After Inspection');
  tcPara('The findings of this report reflect the observable condition of the property at the specific date and time of inspection. Timber pest colonies are dynamic and can expand, relocate, or establish new workings rapidly. Conditions at the property may change materially after the inspection date due to moisture fluctuations, building alterations, landscaping changes, or the natural movement of pest colonies. This report does not warrant or predict the future condition of the property, and the client is advised that regular professional re-inspections are the most effective ongoing protection measure available.');

  tcHeading('7. Insurance');
  tcPara('Standard home, contents, and building insurance policies in Australia do not generally cover loss or damage caused by termites, timber borers, or other timber pests. Timber pest damage is typically treated by Australian insurers as gradual deterioration rather than a sudden or accidental event and is excluded from most mainstream policies. The client is encouraged to obtain written confirmation from their insurer regarding the specific extent of their coverage before acting in reliance on this report.');

  tcHeading('8. Reliance on This Report — Client Use Only');
  // The "get a pre-purchase inspection" advice only makes sense on a report
  // that isn't one.
  tcPara('This report has been prepared exclusively for the use of the client named on the cover page of this document. It must not be provided to, or relied upon by, any third party without the prior written consent of the inspecting company. '
    + (prePurchase ? '' : 'Where this report has been sought in connection with a proposed property purchase, a formal Prior-to-Purchase Timber Pest Inspection prepared with reference to AS 4349.3-2010 and obtained prior to exchange of contracts is strongly advised. ')
    + 'The inspecting company and inspector accept no responsibility or liability to any party other than the named client for any loss, damage, or expense arising from reliance on the contents of this report.');

  tcHeading('9. Recommended Re-inspection Frequency');
  tcPara("AS 3660.2-2017 recommends a timber pest inspection at least every 12 months, whether or not a termite management system is installed. Where elevated risk factors are present — including proximity to bushland or trees, prior termite history at the property, high-moisture conditions in the subfloor or roof void, the presence of timber-to-soil contact, or susceptible construction materials — a six-monthly re-inspection interval is recommended. Where a termite management system is installed, follow its installer's or manufacturer's inspection interval where it asks for inspections more often than every 12 months. Failure to maintain regular inspection intervals may affect the terms of any system warranty in place.");

  tcHeading('10. Applicable Standards and Legislation');
  tcPara(`This inspection and report have been prepared with reference to ${standard} and, where applicable, the AEPMA (Australian Environmental Pest Managers Association) Code of Practice for Timber Pest Inspections. Termite management recommendations refer to AS 3660.2-2017 (Termite Management — In and Around Existing Buildings and Structures). Where the property is newly constructed or has been subject to recent building work, the termite management provisions of the National Construction Code (NCC) and AS 3660.1-2014 (Termite Management — New Building Work) may also apply. State and Territory legislation may impose requirements additional to those set out in this Standard. This report is not a safety inspection, does not constitute advice regarding compliance with any building code or regulation, and is not a certificate of compliance under any legislation.`);

  // The closing note sits in the column, so it never ends up alone on a page.
  {
    y += 2;
    doc.setFont('helvetica','bold'); doc.setFontSize(7.5);
    const readAll = doc.splitTextToSize('This report must be read in its entirety, including these Terms and Conditions, before any reliance is placed upon its contents.', COL_W - 8);
    const boxH = readAll.length * 3.4 + 6;
    colRoom(boxH);
    doc.setFillColor(...C.accentLight);
    doc.setDrawColor(...C.accent);
    doc.setLineWidth(0.7);
    doc.roundedRect(colX(), y, COL_W, boxH, 2, 2, 'FD');
    doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(...C.accentDark);
    doc.text(readAll, colX() + COL_W/2, y + 5.4, { align:'center', lineHeightFactor: 1.2 });
    y += boxH + 4;
  }
  endColumns();
  gap(4);

  // ─────────────────────────────────────────────────────────────────────
  // 11. INSPECTOR DETAILS and 12. CLIENT ACKNOWLEDGEMENT, kept together.
  // ─────────────────────────────────────────────────────────────────────
  startPart('Inspector Details', y > 120);
  sectionTitle('INSPECTOR DETAILS', REPORT_PARTS.inspector);
  // Signature blocks: the value sits on the line, its caption under it.
  const sigColW = (CW - 16) / 3;
  const onSigLine = (text, x) => drawPdfOnLine(doc, text, x, y, sigColW);
  const provider = [co.name, co.phone, co.email].filter(Boolean).join('  ·  ');
  if (provider) {
    doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(...C.inkLight);
    doc.text(provider, M, y); y += 4;
  }
  y += 14;
  onSigLine(inspector || 'Not specified', M);
  drawPdfSignature(doc, { x: M, y, w: sigColW, caption: 'Inspector name' });
  onSigLine(reportData.inspectorLicence, M + sigColW + 8);
  drawPdfSignature(doc, { x: M + sigColW + 8, y, w: sigColW, caption: 'Pest licence no.' });
  onSigLine(today, M + (sigColW + 8) * 2);
  drawPdfSignature(doc, { x: M + (sigColW + 8) * 2, y, w: sigColW, caption: 'Date' });
  y += 22;
  drawPdfSignature(doc, { x: M, y, w: sigColW * 2 + 8, caption: 'Inspector signature', image: reportData.inspectorSignature });
  y += 12;

  startPart('Client Acknowledgement', y > 175);
  sectionTitle('CLIENT ACKNOWLEDGEMENT', REPORT_PARTS.acknowledgement);
  disclaimer('This report relates to the condition of the property in respect of timber pest activity at the time of inspection, limited to those areas that were reasonably accessible. It is not a warranty, guarantee, or certificate of compliance with any law, insurance policy, or building standard, and does not guarantee the property is, or will remain, free of termites or other timber pests. Conditions affecting the property may change after the inspection date, and concealed or inaccessible areas may contain damage or activity that could not be identified.');
  gap(2);
  if (!prePurchase) {
    disclaimer('This report is for the sole use of the client named above and is not intended for use by third parties. It is not suitable for use where the property is being bought or sold — a Prior-to-Purchase inspection with reference to AS 4349.3-2010 should be obtained for that purpose.');
    gap(2);
  }
  disclaimer('The client acknowledges the contents of this report and that the inspection has limitations. This report does not conclusively determine that the property is free of termites.');

  // The client signs the pre-inspection agreement before the job; its full
  // wording is the appendix. Reports from before that change have a client
  // signature captured at sign-off instead, printed as it was.
  const agreement = reportData.agreement;
  if (y + 36 > 278) newPage();
  y += agreement ? 18 : 24;
  if (agreement) {
    onSigLine(agreement.signerName, M);
    drawPdfSignature(doc, { x: M, y, w: sigColW, caption: 'Agreed by' });
    drawPdfSignature(doc, { x: M + sigColW + 8, y, w: sigColW, caption: agreement.signature ? 'Client signature' : 'How it was signed',
      image: agreement.signature, note: agreement.signature ? '' : agreement.otherNote });
    onSigLine(formatAgreementSignedAt(agreement.signedAt), M + (sigColW + 8) * 2);
    drawPdfSignature(doc, { x: M + (sigColW + 8) * 2, y, w: sigColW, caption: agreement.method === 'other' ? 'Signed' : 'Signed before the inspection' });
    y += 9;
    doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(...C.inkMuted);
    doc.text('Signed as the pre-inspection agreement. Its full wording is the appendix to this report.', M, y);
    y += 6;
  } else {
    if (!reportData.clientSignature) {
      doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(...C.warn);
      doc.text('No pre-inspection agreement was recorded for this inspection.', M, y - 14);
    }
    drawPdfSignature(doc, { x: M, y, w: sigColW, caption: 'Client name' });
    drawPdfSignature(doc, { x: M + sigColW + 8, y, w: sigColW, caption: 'Client signature', image: reportData.clientSignature });
    drawPdfSignature(doc, { x: M + (sigColW + 8) * 2, y, w: sigColW, caption: 'Date' });
    y += 14;
  }

  // ── Version history ─────────────────────────────────────────────────────
  // Every earlier finalised version, and why each amendment was made (see
  // FINALISED JOBS), so a reader can see this isn't the first issue.
  const history = reportData.issueHistory || [];
  if (version > 1 && history.length) {
    if (y + 20 > 270) newPage();
    doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(...C.inkMuted);
    doc.text('VERSION HISTORY', M, y); y += 5;
    doc.setDrawColor(...C.rule); doc.setLineWidth(0.3); doc.line(M, y, M+CW, y); y += 5;
    const rows = [...history.map(h => ({ v: h.version, when: h.completedAt, reason: h.reason, changed: h.changed })),
      ...(version > history[history.length - 1].version
        ? [{ v: version, when: null, reason: reportData.amending && reportData.amending.reason }] : [])];
    rows.forEach(r => {
      const label = r.v === 1 ? 'Original report' : `Amended: ${r.reason || 'no reason given'}`;
      const detail = r.changed && r.changed.length ? `Changed: ${r.changed.join(', ')}` : '';
      const lines = doc.splitTextToSize([label, detail].filter(Boolean).join('. '), CW - 60);
      if (y + lines.length * 4.2 + 3 > 278) newPage();
      doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(...C.ink);
      doc.text(`Version ${r.v}`, M, y);
      doc.setFont('helvetica','normal'); doc.setTextColor(...C.inkLight);
      doc.text(r.when ? formatIssueDate(r.when) : 'This version', M+22, y);
      doc.setTextColor(...C.ink);
      doc.text(lines, M+60, y);
      y += lines.length * 4.2 + 3;
    });
    y += 5;
  }

  // Footer badge
  if (y + 17 > 284) newPage();
  doc.setFillColor(...C.rowAlt); doc.rect(M, y, CW, 16, 'F');
  doc.setFillColor(...C.accent); doc.rect(M, y, 1.5, 16, 'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(...C.inkLight);
  doc.text(`Generated by SAYON  ·  ${today}`, M+7, y+5);
  doc.setFont('helvetica','normal'); doc.setTextColor(...C.inkMuted);
  doc.text(`Report ID: ${reportId}  ·  Prepared with reference to ${standard}`, M+7, y+9);
  doc.text(`Content fingerprint: ${formatFingerprint(fingerprint)}  ·  changes to the report change this code`, M+7, y+13);

  if (agreement) {
    startPart('Appendix: Pre-Inspection Agreement', true);
    sectionTitle('APPENDIX: PRE-INSPECTION AGREEMENT', 'A');
    gap(2);
    y = drawAgreementBody(doc, agreement, y, { M, CW, onNewPage: () => { compactHeader('Appendix: Pre-Inspection Agreement'); return 22; } });
  }

  // ── CONTENTS ── every numbered section, what it holds, and its page.
  {
    doc.setPage(contentsPageNo);
    y = 26;
    doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.setTextColor(...C.ink);
    doc.text('Contents', M, y + 6);
    doc.setFillColor(...C.accent); doc.rect(M, y + 10, 22, 1.2, 'F');
    y += 22;
    const CONTENTS = [
      [REPORT_PARTS.client, 'Client & Inspection Details', 'Who the report is for, the property, and who inspected it.'],
      [REPORT_PARTS.summary, 'Summary', 'The main results under access, activity and safety & risk, with where to read more.'],
      [REPORT_PARTS.property, 'About the Property', 'How the building is built and used, and its termite management system.'],
      [REPORT_PARTS.areas, 'Areas Inspected', 'Each area, how much of it was inspected, and what was found there.'],
      [REPORT_PARTS.access, 'Areas Unable to Be Inspected, and Why', 'Obstructions, restricted access, high risk areas and invasive inspection.'],
      [REPORT_PARTS.findings, 'Findings', 'Termites, borers, wood decay, chemical delignification and previous treatment.'],
      [REPORT_PARTS.conducive, 'Conducive Conditions', 'Conditions that make timber pest attack more likely, and why each matters.'],
      [REPORT_PARTS.recommendations, 'Recommendations & Risk', 'The risk of termite attack, treatment and when to inspect again.'],
      [REPORT_PARTS.photos, 'Photographs', 'Photos taken during the inspection.'],
      [REPORT_PARTS.terms, 'Scope, Limitations, Definitions & Terms', 'What this inspection covers, the terms used, and the terms and conditions.'],
      [REPORT_PARTS.inspector, 'Inspector Details', 'The inspector, their licence and signature.'],
      [REPORT_PARTS.acknowledgement, 'Client Acknowledgement', 'The client\'s acknowledgement of the report and its limits.'],
      ...(agreement ? [['A', 'Appendix: Pre-Inspection Agreement', 'The agreement the client signed before the inspection.']] : []),
    ];
    CONTENTS.forEach(([no, title, desc]) => {
      const pg = partPages[no] ? partPages[no] - 1 : '';
      doc.setFillColor(...C.accent); doc.roundedRect(M, y - 4.6, 7, 7, 1, 1, 'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(...C.white);
      doc.text(String(no), M + 3.5, y + 0.6, { align: 'center' });
      doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(...C.ink);
      doc.text(title, M + 11, y);
      doc.setFont('helvetica','normal'); doc.setFontSize(7.8); doc.setTextColor(...C.inkLight);
      doc.text(desc, M + 11, y + 4.6);
      doc.setFont('helvetica','bold'); doc.setFontSize(9.5); doc.setTextColor(...C.accentDark);
      doc.text(String(pg), W - M, y, { align: 'right' });
      doc.setDrawColor(...C.ruleLight); doc.setLineWidth(0.25); doc.line(M, y + 8.5, W - M, y + 8.5);
      y += 15.5;
    });
  }

  // ── PAGE FOOTERS ──────────────────────────────────────────────────────────
  stampSamplePdf(doc);
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 2; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFillColor(...C.rule); doc.rect(M, 284, CW, 0.3, 'F');
    doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(...C.inkMuted);
    doc.text(`Report ${reportNumber}  ·  Version ${version}`, M, 290);
    doc.text(`Page ${p-1} of ${totalPages-1}`, W-M, 290, { align:'right' });
  }

  const fname = `SAYON_${fileNamePart(address) || 'Property'}_${fileNamePart(today)}.pdf`;
  const blob = doc.output('blob');
  saveDraft(); // keeps the report number it was given
  return { blob, fname, fingerprint, version };
}

async function _buildAndDownloadPDF() {
  const { blob, fname } = await buildReportPdf();
  // The dashboard counts a report with a PDF made as ready for its quote.
  reportData.pdfAt = Date.now();
  saveOpenReportNow();
  await deliverPdfBlob(blob, fname, {
    title: reportKindTitle(),
    text: `${reportKindTitle()} — ${getFullAddress() || 'Property'}`,
    readyToast: 'Report ready. Choose where to save or send it',
  });
}
