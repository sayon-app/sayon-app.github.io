// SAYON app: Pre-inspection agreement and remote signing.
// One of the js/app/ files, which share one global scope: they load as plain
// scripts in the order index.html lists them, so a top-level name declared in
// any of them can be used from the others once the page has loaded.

// ── PRE-INSPECTION AGREEMENT ────────────────────────────────────────────
// AS 4349.3 expects a written agreement before a timber pest inspection
// starts, so the client signs (or the inspector records a paper / emailed
// agreement) before the job, not at the end. A signed agreement is kept on
// the report as reportData.agreement:
//   { method: 'onsite' | 'other', signerName, signature?, otherNote?,
//     signedAt, inspectionDate, fee, notes, standard, text }
// text is the exact wording agreed to, so editing the business's template
// later never changes what an earlier client signed.
let agreementSignaturePad = null;

const AGREEMENT_PLACEHOLDERS = ['company', 'client', 'address', 'date', 'standard', 'inspectionType', 'fee', 'notes'];

const DEFAULT_AGREEMENT_TEXT = `1. The inspection
{company} will carry out a {inspectionType} inspection of {address} for {client} on {date}, in line with {standard}.

2. What is inspected
A visual inspection of the readily accessible areas of the building and site for subterranean and drywood termites, borers of seasoned timber, wood decay fungi and chemical delignification, and for conditions that make timber pest attack more likely. This normally covers the interior, roof space, subfloor, exterior, outbuildings, and the site within 30 m of the building and inside the property boundary, where they can be safely reached.

3. How we inspect, and the limits
The inspection is visual and non-invasive. We may tap timbers and use a moisture meter or other tools that do not damage the building. We do not move furniture, stored goods, floor coverings, insulation or vegetation, and we do not cut, drill or remove any part of the building. Areas we cannot reach or see will be recorded in the report, and timber pests or damage may be hidden in them. The inspection cannot guarantee that the property is, or will stay, free of timber pests. It is not a building, structural, asbestos, mould or electrical inspection. If we find timber damage, we may recommend that a builder or engineer assesses it.

4. Invasive inspection
An invasive inspection is not included. If one is recommended, it needs a separate written agreement and fee.

5. Access
Please arrange safe access to all areas on the day, including the roof space, the subfloor and any locked areas. Any area we can't get into will be noted in the report. If you would like us to come back to inspect it, we will tell you the cost before we do.

6. The report
You will receive a written report by email after the inspection. It is for your use only and must not be relied on by anyone else without our written consent.

7. Voice notes and your details
The inspector may speak notes into a phone app during the inspection, and the phone may pick up conversation nearby. A speech-to-text service turns what it hears into written notes, and an AI service drafts the report from those notes and from photos; the inspector checks everything before it is issued. These services include providers outside Australia, mainly in the United States. The recording is not kept. If you would rather not be recorded, tell the inspector and they will type their notes instead. Your details and the report are only used and shared as needed to provide this service, as set out in SAYON's privacy policy at sayon-app.github.io/privacy.html.

8. Fee
{fee}

9. Special requests
{notes}

10. Your rights
Nothing in this agreement limits your rights under the Australian Consumer Law.

By signing, you confirm you have read and agree to this agreement before the inspection starts. You also agree to sign it electronically and to receive the report by email.`;

function getAgreementTemplate() {
  const custom = getCompanyDetails().agreementText;
  return (custom && custom.trim()) ? custom : DEFAULT_AGREEMENT_TEXT;
}

function agreementInspectionType() {
  return isPrePurchaseJob() ? 'pre-purchase timber pest' : 'timber pest';
}

// Fills the template's {placeholders} for this job. Anything still
// unknown prints as a blank line to write on rather than an empty gap.
function fillAgreementText(template, values) {
  return template.replace(/\{(\w+)\}/g, (m, key) => {
    if (!AGREEMENT_PLACEHOLDERS.includes(key)) return m;
    const v = values[key];
    return (v && String(v).trim()) ? String(v).trim() : '____________';
  });
}

function formatAgreementDate(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T00:00:00');
  return isNaN(d) ? isoDate : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatAgreementSignedAt(ms) {
  return new Date(ms).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// A date as YYYY-MM-DD on the phone's own calendar. toISOString() gives the
// UTC date, which in Australia is the day before until 10 or 11 in the morning.
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function todayIsoDate() { return isoDate(new Date()); }

// The unsigned sheet is on screen, so its own boxes (who signs, special
// requests) count.
function agreementEditOpen() {
  return document.getElementById('agreementOverlay').classList.contains('open') && !reportData.agreement;
}

// What the agreement is filled from. The inspection type, date and fee are
// the job's own (Job details); the sheet adds any special requests and who
// signs. With the sheet shut (a link sent from This job) it is Job details
// alone.
function agreementFormValues() {
  const standard = reportData.standard || 'AS 3660.2-2017';
  const inspectionDate = reportData.jobInspectionDate || todayIsoDate();
  const fee = agreementFeeText(jobFeeOf(reportData));
  const open = agreementEditOpen();
  const notes = open ? document.getElementById('agreementNotes').value.trim() : '';
  return {
    standard, inspectionDate, fee, notes,
    text: fillAgreementText(getAgreementTemplate(), {
      company: getCompanyDetails().name || 'The inspecting company',
      // The inspection is for the client; someone else may sign for them.
      client: document.getElementById('jobClient').value.trim() || (open ? document.getElementById('agreementSignerName').value.trim() : ''),
      address: getFullAddress(),
      date: formatAgreementDate(inspectionDate),
      standard,
      inspectionType: agreementInspectionType(),
      fee: fee || 'As quoted.',
      notes: notes || 'None.',
    }),
  };
}

// Step 1 of the sheet: what Job details already say, on one line, and a
// box only for what's missing. Change swaps the line for all three boxes.
// Which boxes show is settled when the sheet opens (and by Change), so one
// doesn't vanish while it's being typed in.
let agreementJobAsk = { type: false, date: false, fee: false };
function renderAgreementJob() {
  const type = reportData.jobInspectionType || '';
  const day = reportData.jobInspectionDate ? new Date(reportData.jobInspectionDate + 'T00:00:00') : null;
  const fee = agreementFeeText(jobFeeOf(reportData));
  // The line carries what isn't in a box below it, so nothing shows twice.
  const ask = agreementJobAsk;
  const parts = [!ask.type && type,
    !ask.date && day && !isNaN(day) ? day.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : '',
    !ask.fee && fee].filter(Boolean);
  document.getElementById('agreementJobText').textContent = parts.join(' · ');
  document.getElementById('agreementJobLine').hidden = !parts.length;
  document.getElementById('agreementJobChange').hidden = ask.type && ask.date && ask.fee;
  document.getElementById('agreementTypeField').hidden = !ask.type;
  document.getElementById('agreementDateField').hidden = !ask.date;
  document.getElementById('agreementFeeField').hidden = !ask.fee;
  document.getElementById('agreementDateFeeRow').hidden = !ask.date && !ask.fee;
}
// A job with no day yet takes the agreement's (today), so the two match.
function keepAgreementDate(values) {
  const el = document.getElementById('jobInspectionDate');
  if (reportData.jobInspectionDate || !el) return;
  el.value = values.inspectionDate;
  saveJobInfo();
}
function changeAgreementJob() {
  if (isReportLocked()) { sayLocked(); return; }
  agreementJobAsk = { type: true, date: true, fee: true };
  renderAgreementJob();
  document.getElementById('agreementInspectionType').focus({ preventScroll: true });
}

// The banner on the report's first step, until the agreement is signed:
// red while there's nothing, amber once a link is out. A signed agreement
// has no banner; it is on This job's Agreement step.
function renderAgreementBanner() {
  const banner = document.getElementById('agreementBanner');
  if (!banner) return;
  const a = reportData.agreement;
  banner.hidden = !!a;
  const sent = !a && reportData.agreementRequest;
  banner.classList.toggle('waiting', !!sent);
  document.getElementById('agreementBannerText').textContent = sent
    ? `Link sent to ${sent.signerName}, waiting for them to sign` : 'Pre-inspection agreement not signed yet';
  if (sent) checkAgreementLink(false);
  document.getElementById('agreementBannerBtn').textContent = sent ? 'Open' : 'Get it signed';
}

function openAgreementSheet() {
  const a = reportData.agreement;
  track('screen_viewed', { screen: 'agreement' });
  document.getElementById('agreementEdit').style.display = a ? 'none' : '';
  document.getElementById('agreementView').style.display = a ? '' : 'none';
  if (a) {
    document.getElementById('agreementViewName').textContent = a.signerName;
    document.getElementById('agreementViewSummary').textContent =
      formatAgreementSignedAt(a.signedAt) + (a.method === 'other' ? ` · ${a.otherNote}` : a.method === 'remote' ? ' · signed on their phone from a link' : ' · signed on this device');
    renderAgreementDoc(document.getElementById('agreementViewText'), a.text);
    const img = document.getElementById('agreementViewSignature');
    img.style.display = a.signature ? '' : 'none';
    if (a.signature) img.src = a.signature;
    // A finalised job's agreement stays as it was signed (Amend first).
    document.getElementById('agreementRemoveBtn').hidden = isReportLocked();
  } else {
    document.getElementById('agreementAddr').textContent = getFullAddress() || 'No address yet';
    document.getElementById('agreementAddr').classList.toggle('empty', !getFullAddress());
    document.getElementById('agreementSignerName').value = document.getElementById('jobClient').value.trim() || ((typeof currentJobQuote === 'function' && currentJobQuote()) || {}).client || '';
    // The type, date and fee are the job's own: shown as one line, with a
    // box for any that Job details don't have yet.
    document.getElementById('agreementInspectionType').value = reportData.jobInspectionType || '';
    document.getElementById('agreementDate').value = reportData.jobInspectionDate || '';
    document.getElementById('agreementFee').value = jobFeeOf(reportData);
    agreementJobAsk = { type: !reportData.jobInspectionType, date: !reportData.jobInspectionDate, fee: !jobFeeOf(reportData) };
    document.getElementById('agreementNotes').value = '';
    document.getElementById('agreementAgree').checked = false;
    document.getElementById('agreementOtherNote').value = '';
    document.getElementById('agreementOtherWrap').style.display = 'none';
    if (agreementSignaturePad) agreementSignaturePad.clear();
    // What was typed and signed before the app closed comes back (UNSAVED
    // SHEETS in js/quote.js). Signing or closing the sheet drops the copy.
    const sheetKey = 'agreement|' + (currentReportId || 'draft');
    const copy = unsavedSheetCopy(sheetKey);
    if (copy && copy.data) restoreAgreementForm(copy.data);
    refreshAgreementPreview();
    const overlay = document.getElementById('agreementOverlay');
    if (!overlay.dataset.keeps) {
      overlay.dataset.keeps = '1';
      ['input', 'change'].forEach(ev => overlay.addEventListener(ev, unsavedSheetChanged));
    }
    watchUnsavedSheet(sheetKey, readAgreementForm);
    if (copy && copy.data) showToast('Picked up where you left off', 'info');
  }
  renderAgreementRemote();
  checkAgreementLink(false);
  cancelSheetVoice('agreement');
  document.getElementById('agreementOverlay').classList.add('open');
  document.querySelectorAll('#agreementOverlay .page-sheet-body').forEach(b => { b.scrollTop = 0; });
}

// The agreement as a document: each "N. Heading" block becomes a numbered
// clause, any other paragraph plain text, and a blank still to fill in is
// marked. Works on a business's own wording as well as the default.
function renderAgreementDoc(el, text) {
  el.textContent = '';
  const withBlanks = (node, str) => {
    str.split(/(_{4,})/).forEach(part => {
      if (!part) return;
      if (/^_{4,}$/.test(part)) {
        const b = document.createElement('span');
        b.className = 'agr-blank'; b.textContent = 'not filled in';
        node.appendChild(b);
      } else node.appendChild(document.createTextNode(part));
    });
  };
  const para = (parent, str, cls) => {
    const p = document.createElement('p');
    if (cls) p.className = cls;
    withBlanks(p, str);
    parent.appendChild(p);
  };
  let sawClause = false;
  String(text || '').split(/\n\s*\n/).forEach(block => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return;
    const m = lines[0].match(/^(\d+)\.\s+(.+)$/);
    if (m) {
      sawClause = true;
      const sec = document.createElement('section');
      sec.className = 'agr-clause';
      const num = document.createElement('span');
      num.className = 'agr-clause-num'; num.textContent = m[1];
      const h = document.createElement('h4');
      h.className = 'agr-clause-title'; h.textContent = m[2];
      sec.append(num, h);
      lines.slice(1).forEach(l => para(sec, l));
      el.appendChild(sec);
    } else {
      lines.forEach(l => para(el, l, sawClause ? 'agr-doc-close' : 'agr-doc-intro'));
    }
  });
}

// The fee as the agreement prints it: "$440 inc GST" from "440".
function agreementFeeText(raw) {
  const fee = String(raw || '').trim();
  if (!fee) return '';
  return `${/^\$|^[^0-9]/.test(fee) ? '' : '$'}${fee}${/gst/i.test(fee) ? '' : ' inc GST'}`;
}

// Fee boxes put the $ in front as soon as a figure is typed, keeping the
// cursor where it was.
function addDollarSign(el) {
  const v = el.value;
  if (v.trim() === '$') { el.value = ''; return; }
  if (!/\d/.test(v) || /^\s*\$/.test(v)) return;
  const pos = el.selectionStart;
  el.value = '$' + v.replace(/^\s+/, '');
  if (pos != null) { const p = pos + el.value.length - v.length; el.setSelectionRange(p, p); }
}

// The agreement's fee box is the Job details fee: typing in either updates
// the one stored value.
function onAgreementFeeInput() {
  const v = document.getElementById('agreementFee').value;
  reportData.jobFee = v;
  const jobEl = document.getElementById('jobFee');
  if (jobEl) jobEl.value = v;
  saveDraft();
  refreshAgreementPreview();
}

// What's on the unsigned sheet, kept on the phone while it's open.
function readAgreementForm() {
  const val = id => document.getElementById(id).value;
  return {
    signerName: val('agreementSignerName'), notes: val('agreementNotes'),
    otherNote: val('agreementOtherNote'), agreed: document.getElementById('agreementAgree').checked,
    signature: agreementSignaturePad && !agreementSignaturePad.empty ? agreementSignaturePad.canvas.toDataURL('image/png') : '',
  };
}
function restoreAgreementForm(d) {
  if (d.signerName) document.getElementById('agreementSignerName').value = d.signerName;
  if (d.notes) document.getElementById('agreementNotes').value = d.notes;
  if (d.otherNote) {
    document.getElementById('agreementOtherNote').value = d.otherNote;
    document.getElementById('agreementOtherWrap').style.display = '';
  }
  document.getElementById('agreementAgree').checked = !!d.agreed;
  if (d.signature && agreementSignaturePad) agreementSignaturePad.show(d.signature);
}

function closeAgreementSheet() {
  forgetSheetFrom('agreementOverlay');
  if (typeof dropUnsavedSheet === 'function') dropUnsavedSheet();
  cancelSheetVoice('agreement');
  document.getElementById('agreementOverlay').classList.remove('open');
}

function refreshAgreementPreview() {
  if (!reportData.agreement) renderAgreementDoc(document.getElementById('agreementText'), agreementFormValues().text);
  renderAgreementJob();
  const hint = document.getElementById('agreementFeeHint');
  if (hint) hint.hidden = !!jobFeeOf(reportData);
  updateAgreementSignButton();
}

// The agreement sheet's date box is the job's inspection date: changing it
// here changes Job details, so the job and the signed agreement can't
// carry two different days. Cleared, it goes back to the job's day.
function onAgreementDateChange() {
  const el = document.getElementById('agreementDate');
  const jobEl = document.getElementById('jobInspectionDate');
  if (!el.value || isReportLocked()) el.value = reportData.jobInspectionDate || '';
  else if (jobEl && jobEl.value !== el.value) { jobEl.value = el.value; saveJobInfo(); }
  refreshAgreementPreview();
}

// The agreement sheet's inspection type is the job's inspection type: it is
// the same field, shown here because the client signs before anything else
// is known, and clause 1 names the type and the standard it sets.
function onAgreementTypeChange() {
  const type = document.getElementById('agreementInspectionType').value;
  const jobSel = document.getElementById('jobInspectionType');
  if (jobSel && jobSel.value !== type) { jobSel.value = type; onInspectionTypeChange(); }
  refreshAgreementPreview();
}

function agreementTypeChosen() {
  return !!reportData.jobInspectionType;
}

function updateAgreementSignButton() {
  const btn = document.getElementById('agreementSignBtn');
  if (!btn) return;
  const typed = agreementTypeChosen();
  const named = !!document.getElementById('agreementSignerName').value.trim();
  const agreed = document.getElementById('agreementAgree').checked;
  const drawn = !!(agreementSignaturePad && !agreementSignaturePad.empty);
  btn.disabled = !(typed && named && agreed && drawn);
  // The side line: each step ticks off once it's done.
  const steps = [['agreementStepJob', typed], ['agreementStepRead', agreed], ['agreementStepSign', named && drawn]];
  let nowSet = false;
  steps.forEach(([id, done]) => {
    const li = document.getElementById(id);
    if (!li) return;
    li.classList.toggle('done', done);
    li.classList.toggle('now', !done && !nowSet);
    if (!done) nowSet = true;
  });
  // The bar under the header: one segment per step, filled once it's done.
  const bar = document.getElementById('agreementProgress');
  if (bar) [...bar.children].forEach((seg, i) => seg.classList.toggle('done', steps[i][1]));
  const by = document.getElementById('agreementSigBy');
  if (by) by.textContent = named ? document.getElementById('agreementSignerName').value.trim() : 'Client';
  const need = [!typed && 'choose the inspection type', !agreed && 'tick that the client has read it',
    !named && "enter the client's name", !drawn && 'get their signature'].filter(Boolean);
  const needEl = document.getElementById('agreementSignNeed');
  if (needEl) {
    needEl.hidden = !need.length;
    needEl.textContent = need.length ? `To sign, ${joinWithAnd(need)}.` : '';
  }
}

function toggleAgreementOther() {
  const wrap = document.getElementById('agreementOtherWrap');
  wrap.style.display = wrap.style.display === 'none' ? '' : 'none';
}

// method 'onsite': the client signed on this device. 'other': the inspector
// records an agreement signed on paper or by email, with a short note.
function signAgreement(method) {
  const signerName = document.getElementById('agreementSignerName').value.trim();
  if (!agreementTypeChosen()) { showToast('Choose the inspection type first: it sets the standard the agreement names', 'error'); return; }
  if (!signerName) { showToast('Enter the name of the person signing', 'error'); return; }
  const values = agreementFormValues();
  const agreement = { method, signerName, signedAt: Date.now(),
    inspectionDate: values.inspectionDate, fee: values.fee, notes: values.notes,
    standard: values.standard, text: values.text };
  if (method === 'onsite') {
    if (!document.getElementById('agreementAgree').checked || !agreementSignaturePad || agreementSignaturePad.empty) return;
    agreement.signature = agreementSignaturePad.canvas.toDataURL('image/png');
  } else {
    agreement.otherNote = document.getElementById('agreementOtherNote').value.trim();
    if (!agreement.otherNote) { showToast('Say how it was signed, e.g. "Signed on paper"', 'error'); return; }
  }
  reportData.agreement = agreement;
  keepAgreementDate(values);
  if (reportData.agreementRequest) {
    const id = reportData.agreementRequest.id;
    if (authSession) fetch(`${SUPABASE_URL}/rest/v1/sign_requests?id=eq.${encodeURIComponent(id)}&status=eq.pending`, {
      method: 'PATCH', headers: getAuthHeaders(), body: JSON.stringify({ status: 'cancelled' }),
    }).catch(() => {});
    delete reportData.agreementRequest;
  }
  if (!document.getElementById('jobClient').value.trim()) {
    document.getElementById('jobClient').value = signerName;
    updateJob();
  }
  saveDraft();
  updateProgress();
  renderAgreementBanner();
  closeAgreementSheet();
  showToast('Agreement signed', 'success');
  track('agreement_signed', { method });
}

// ── REMOTE SIGNING ───────────────────────────────────────────────────────
// When the client isn't on site, the inspector sends a link instead. The
// exact wording goes to Supabase sign_requests (supabase/remote-signing.sql)
// and the client signs it on sign.html with no account. The report keeps
//   reportData.agreementRequest = { id, signerName, sentAt, values }
// until the signed row is read back, which then becomes reportData.agreement
// with method 'remote', just as if they had signed on this phone.
const AGREEMENT_LINK_CHECK_MS = 60000;
let agreementLinkCheckedAt = 0;

function agreementLinkUrl(id) {
  return new URL(`sign.html?id=${encodeURIComponent(id)}`, location.href).href;
}

async function sendAgreementLink() {
  if (isReportLocked()) { sayLocked(); return; }
  if (isSampleJob(currentReportId)) { showToast('The sample job doesn\'t make signing links. Try it on a real job', 'info'); return; }
  // From the sheet, whoever is named there signs. From This job's Next
  // step card the sheet is shut: the client signs, and anything missing
  // is asked for on the sheet.
  const onSheet = agreementEditOpen();
  const signerName = (onSheet ? document.getElementById('agreementSignerName') : document.getElementById('jobClient')).value.trim();
  const need = !agreementTypeChosen() ? 'Choose the inspection type first: it sets the standard the agreement names'
    : !signerName ? 'Enter the name of the person signing' : '';
  if (need) {
    if (!onSheet) jobGo('agreement');
    showToast(need, 'error');
    return;
  }
  if (!authSession) { showToast('Sign in to send a link', 'error'); return; }
  if (!navigator.onLine) { showToast('Sending a link needs signal. Try again when you have it', 'error'); return; }
  const values = agreementFormValues();
  const company = getCompanyDetails();
  const doc = { company: company.name || '', phone: company.phone || '', email: company.email || '',
    inspector: (document.getElementById('jobInspector') || {}).value?.trim() || '', client: signerName, address: getFullAddress(),
    inspectionDate: values.inspectionDate, standard: values.standard, text: values.text };
  const btns = [...document.querySelectorAll('#agreementLinkBtn, #jobOverlay .job-way-link')];
  btns.forEach(b => { b.disabled = true; });
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/sign_requests?select=id`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify({ user_id: authUser.id, report_id: currentReportId || 'draft', doc }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const [row] = await res.json();
    reportData.agreementRequest = { id: row.id, signerName, sentAt: Date.now(), values };
    keepAgreementDate(values);
    if (!document.getElementById('jobClient').value.trim()) {
      document.getElementById('jobClient').value = signerName;
      updateJob();
    }
    // Onto the saved job straight away, so Jobs shows it waiting on the client.
    saveOpenReportNow();
    renderAgreementBanner();
    renderAgreementRemote();
    track('agreement_link_sent', { from: onSheet ? 'sheet' : 'job' });
    await sendAgreementLinkOn();
  } catch (e) {
    reportError(e, 'agreement_link');
    showToast('Could not make the link. Check your signal and try again', 'error');
  } finally {
    btns.forEach(b => { b.disabled = false; });
    // This job's Next step card now says it's waiting on the client.
    if (document.getElementById('jobOverlay').classList.contains('open')) renderJobPage();
  }
}

// Emailed from SAYON to the client's email in Job Details, with the
// agreement attached, when email is set up. Otherwise the share sheet.
async function sendAgreementLinkOn() {
  const r = reportData.agreementRequest;
  if (!r) return;
  const to = (document.getElementById('jobClientEmail') || {}).value?.trim() || '';
  if (directEmail && to) {
    try {
      await ensureJsPDFLoaded();
      const file = buildAgreementPdf({ ...r.values, signerName: r.signerName, unsigned: true });
      const company = getCompanyDetails().name || 'your inspector';
      const sent = await sendPdfsDirect({ files: [file], to,
        subject: `Please sign: pre-inspection agreement for ${getFullAddress() || 'your inspection'}`,
        body: `${agreementLinkMessage(r)}\n\n${agreementLinkUrl(r.id)}\n\nA copy of the agreement is attached.\n\nKind regards,\n${[(document.getElementById('jobInspector') || {}).value?.trim(), company].filter(Boolean).join('\n')}` });
      if (sent) {
        r.emailedTo = to; r.emailedAt = Date.now();
        saveDraft(); renderAgreementRemote();
        return;
      }
    } catch (e) {
      reportError(e, 'agreement_link_email');
    }
  }
  shareAgreementLink();
}

function agreementLinkMessage(r) {
  const company = getCompanyDetails().name || 'your inspector';
  return `Hi ${greetingName(r.signerName) || 'there'}, here is the pre-inspection agreement from ${company} for ${getFullAddress() || 'your inspection'}. Please read it and sign on your phone before the inspection:`;
}

// The share sheet (text, email, WhatsApp), or the clipboard where there's none.
async function shareAgreementLink() {
  const r = reportData.agreementRequest;
  if (!r) return;
  const url = agreementLinkUrl(r.id);
  const text = agreementLinkMessage(r);
  if (navigator.share) {
    try { await navigator.share({ title: 'Pre-inspection agreement', text, url }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    showToast('Link copied. Paste it into a text or email to the client', 'success');
  } catch (e) {
    prompt('Copy this link and send it to the client:', url);
  }
}

async function checkAgreementLink(byTap) {
  const r = reportData.agreementRequest;
  if (!r || reportData.agreement || !authSession) return;
  if (!byTap && Date.now() - agreementLinkCheckedAt < AGREEMENT_LINK_CHECK_MS) return;
  agreementLinkCheckedAt = Date.now();
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/sign_requests?id=eq.${encodeURIComponent(r.id)}&select=status,signer_name,signature,signed_at`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const [row] = await res.json();
    // The report may have moved on while the request was out.
    if (reportData.agreementRequest !== r) return;
    if (row && row.status === 'signed') {
      takeOpenAgreement(row);
      showToast(`${row.signer_name} signed the agreement`, 'success');
    } else if (byTap) {
      showToast(row && row.status === 'cancelled' ? 'That link was cancelled' : 'Not signed yet', 'info');
    }
  } catch (e) {
    if (byTap) showToast('Could not check. Try again when you have signal', 'error');
  }
}

// The signed agreement, from the link's request and the row the client signed.
function agreementFromLink(r, row) {
  const v = r.values || {};
  return { method: 'remote', signerName: row.signer_name, signature: row.signature,
    signedAt: new Date(row.signed_at).getTime(), inspectionDate: v.inspectionDate, fee: v.fee,
    notes: v.notes, standard: v.standard, text: v.text };
}

// The open job's link came back signed: every place that shows the
// agreement takes it.
function takeOpenAgreement(row) {
  reportData.agreement = agreementFromLink(reportData.agreementRequest, row);
  delete reportData.agreementRequest;
  saveDraft();
  updateProgress();
  renderAgreementBanner();
  if (document.getElementById('agreementOverlay').classList.contains('open')) openAgreementSheet();
  if (document.getElementById('jobOverlay').classList.contains('open')) renderJobPage();
  track('agreement_signed', { method: 'remote' });
}

// From the Jobs list's check of every link that's out (checkLinksOut in
// js/app/dashboard.js): the open job's agreement, or one on a saved job.
// Returns what to say, or '' when it isn't signed yet.
function takeSignedAgreement(reportId, row) {
  if (!row || row.status !== 'signed') return '';
  if (reportId === currentReportId) {
    const r = reportData.agreementRequest;
    if (!r || r.id !== row.id || reportData.agreement) return '';
    takeOpenAgreement(row);
    saveOpenReportNow();
  } else {
    const reports = getSavedReports();
    const entry = reports.find(x => x.id === reportId);
    const d = entry && entry.reportData;
    if (!d || !d.agreementRequest || d.agreementRequest.id !== row.id || d.agreement) return '';
    d.agreement = agreementFromLink(d.agreementRequest, row);
    delete d.agreementRequest;
    // A new save of the report, so another device takes the agreement in.
    entry.cloudSavedAt = cloudBaseOf(entry);
    entry.savedAt = Date.now();
    if (!setSavedReports(reports)) return '';
    supabaseSave(entry, true);
    track('agreement_signed', { method: 'remote' });
  }
  return `${row.signer_name || 'The client'} signed the agreement`;
}

async function cancelAgreementLink() {
  const r = reportData.agreementRequest;
  if (!r || !confirm('Cancel this link? The client won\'t be able to sign with it.')) return;
  if (authSession) {
    fetch(`${SUPABASE_URL}/rest/v1/sign_requests?id=eq.${encodeURIComponent(r.id)}&status=eq.pending`, {
      method: 'PATCH', headers: getAuthHeaders(), body: JSON.stringify({ status: 'cancelled' }),
    }).catch(() => {});
  }
  delete reportData.agreementRequest;
  saveDraft();
  renderAgreementBanner();
  renderAgreementRemote();
}

function renderAgreementRemote() {
  const box = document.getElementById('agreementRemote');
  if (!box) return;
  const r = !reportData.agreement && reportData.agreementRequest;
  box.hidden = !r;
  if (r) {
    document.getElementById('agreementRemoteText').textContent =
      `Link ${r.emailedTo ? `emailed to ${r.emailedTo}` : `sent to ${r.signerName}`} on ${formatAgreementSignedAt(r.emailedAt || r.sentAt)}. It shows as signed here once they sign. You can still have them sign on this phone instead.`;
  }
}

function removeAgreement() {
  if (isReportLocked()) { sayLocked(); return; }
  if (!confirm('Remove the signed agreement from this report? The client will need to sign again.')) return;
  delete reportData.agreement;
  saveDraft();
  updateProgress();
  renderAgreementBanner();
  closeAgreementSheet();
}

// A PDF of the signed agreement for the client to keep.
function shareAgreementPdf() {
  const a = reportData.agreement;
  if (!a || !window.jspdf) { showToast('PDF tools are still loading. Try again in a moment', 'error'); return; }
  const { blob, fname } = buildAgreementPdf(a);
  deliverPdfBlob(blob, fname, {
    title: 'Pre-Inspection Agreement',
    text: `Pre-inspection agreement — ${getFullAddress() || 'Property'}`,
    readyToast: 'Agreement ready. Choose where to save or send it',
  });
}

// The agreement as a PDF. a.unsigned: the copy that goes with a link to sign.
function buildAgreementPdf(a) {
  const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
  const M = 15, CW = 180;
  const company = getCompanyDetails();
  const header = () => drawPdfRunningHeader(doc, company, 'Pre-Inspection Agreement', getFullAddress(), '');
  let y = drawPdfDocCover(doc, company, { compact: true, kicker: 'Timber pest inspection', title: 'Pre-Inspection Agreement',
    date: formatAgreementDate(todayIsoDate()), left: [
      // The client is the job's client. Whoever signed for them (an agent,
      // a partner) is named in the signature block.
      ['CLIENT', document.getElementById('jobClient').value.trim() || a.signerName],
      ['PROPERTY ADDRESS', getFullAddress() || 'Not specified'],
    ], right: [
      ['INSPECTION DATE', a.inspectionDate ? formatAgreementDate(a.inspectionDate) : ''],
      ['INSPECTION FEE', agreementFeeText(a.fee)],
      ['AGREED', a.unsigned ? 'Not signed yet' : formatAgreementSignedAt(a.signedAt)],
      ['STANDARD', a.standard],
    ] });
  y += 2;
  y = drawAgreementBody(doc, a, y, { M, CW, onNewPage: header });
  drawPdfDocFooters(doc, `Pre-Inspection Agreement${company.name ? `  ·  ${company.name}` : ''}`);
  const fname = `Agreement_${fileNamePart(getFullAddress()) || 'Property'}.pdf`;
  return { blob: doc.output('blob'), fname };
}

// Prints the agreed wording and who signed it, from y down. Used for the
// client's copy and the last page of the report. Returns the new y.
function drawAgreementBody(doc, a, y, { M, CW, onNewPage }) {
  const C = PDF_COLORS;
  const bottom = 281;
  const room = (h) => { if (y + h > bottom) { doc.addPage(); y = onNewPage(); return true; } return false; };
  const GUT = 9, LH = 4;
  // Same blocks as the sheet: "N. Heading" clauses with a numbered gutter
  // and a hairline between, other paragraphs plain, the closing shaded.
  const blocks = String(a.text || '').split(/\n\s*\n/).map(b => b.split('\n').map(l => l.trim()).filter(Boolean)).filter(b => b.length);
  let sawClause = false, first = true;
  blocks.forEach((lines, bi) => {
    const m = lines[0].match(/^(\d+)\.\s+(.+)$/);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    if (m) {
      sawClause = true;
      const body = lines.slice(1).map(l => doc.splitTextToSize(l, CW - GUT - 3));
      let firstH = 5 + (body[0] ? Math.min(body[0].length, 2) * LH : 0);
      // The last clause goes over with the closing words and the signatures,
      // so they never sit on a page of their own.
      const next = blocks[bi + 1];
      if (next && bi + 1 === blocks.length - 1 && !/^\d+\.\s/.test(next[0]) && !a.unsigned) {
        const closingH = next.flatMap(l => doc.splitTextToSize(l, CW - 13)).length * LH + 9;
        firstH = 7.4 + body.reduce((h, w, i) => h + w.length * LH + (i ? 1.5 : 0), 0) + 2.6 + closingH + 34;
      }
      if (!room(firstH + 4) && !first) {
        doc.setDrawColor(...C.ruleLight); doc.setLineWidth(0.2); doc.line(M + GUT, y - 1.6, M + CW, y - 1.6);
      }
      y += 2.2;
      doc.setFillColor(...C.accentLight); doc.roundedRect(M, y - 3.4, 5.6, 4.6, 1, 1, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...C.accentDark);
      doc.text(m[1], M + 2.8, y, { align: 'center' });
      doc.setFontSize(9.5); doc.setTextColor(...C.ink);
      doc.text(doc.splitTextToSize(m[2], CW - GUT - 3)[0], M + GUT, y);
      y += 4.8;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...C.inkLight);
      body.forEach((wrapped, i) => {
        if (i) y += 1.5;
        wrapped.forEach(w => { room(LH); doc.text(w, M + GUT, y); y += LH; });
      });
      y += 2.6;
    } else if (sawClause) {
      const wrapped = lines.flatMap(l => doc.splitTextToSize(l, CW - 13));
      const h = wrapped.length * LH + 6;
      // The last paragraph keeps the signatures company on its page.
      room(h + 2 + (bi === blocks.length - 1 ? 34 : 0));
      y += 1;
      doc.setFillColor(...C.rowAlt); doc.roundedRect(M, y, CW, h, 1.5, 1.5, 'F');
      doc.setFillColor(...C.accent); doc.rect(M, y, 0.8, h, 'F');
      doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.ink);
      wrapped.forEach((w, i) => doc.text(w, M + 5, y + 4.6 + i * LH));
      y += h + 2;
    } else {
      doc.setTextColor(...C.inkLight);
      lines.forEach(l => doc.splitTextToSize(l, CW).forEach(w => { room(LH); doc.text(w, M, y); y += LH; }));
      y += 2.5;
    }
    first = false;
  });
  // A copy sent to be signed online has no signature block yet.
  if (a.unsigned) {
    y += 4; room(14);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...C.ink);
    doc.text('To sign, open the link in the email this came with.', M, y);
    return y + 8;
  }
  // Who agreed, how and when, as a signature block.
  y += 4;
  room(30);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...C.accentDark);
  pdfTracked(doc, 'AGREED AND SIGNED', M, y, { cs: 0.6 });
  y += 20;
  const colW = (CW - 16) / 3;
  const onLine = (text, x) => drawPdfOnLine(doc, text, x, y, colW);
  onLine(a.signerName, M);
  drawPdfSignature(doc, { x: M, y, w: colW, caption: 'Agreed by' });
  drawPdfSignature(doc, { x: M + colW + 8, y, w: colW, caption: a.signature ? 'Client signature' : 'How it was signed',
    image: a.signature, note: a.signature ? '' : (a.otherNote || 'Recorded by the inspector') });
  onLine(formatAgreementSignedAt(a.signedAt), M + (colW + 8) * 2);
  drawPdfSignature(doc, { x: M + (colW + 8) * 2, y, w: colW, caption: 'Signed' });
  return y + 8;
}
