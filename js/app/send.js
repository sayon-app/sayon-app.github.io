// SAYON app: Send to client and check before sending.
// One of the js/app/ files, which share one global scope: they load as plain
// scripts in the order index.html lists them, so a top-level name declared in
// any of them can be used from the others once the page has loaded.

// ── PDF GENERATION ────────────────────────────────────────────────────────
// ── SEND TO CLIENT ──────────────────────────────────────────────────────
// Once the Worker has email set up (/send-email, through Resend), the PDFs
// go straight to the client from the business, with a copy to the
// business's own email. Until then, or with no client email, or if that
// fails, it opens the phone's share sheet with the PDFs attached and a
// short message ready to go, so the inspector picks Mail (or Messages) and
// taps send. The client's email address is copied first, to paste into To.
// Browsers that can't share files (desktop) download the PDFs and open a
// new email to the client instead. The share sheet only opens straight
// from a tap, so the PDFs must already be built when this is called.
function clientMessage({ client, address, docs, note, signOff, link }) {
  const company = getCompanyDetails();
  const firstName = greetingName(client);
  return [
    firstName ? `Hi ${firstName},` : 'Hi,',
    '',
    `Please find attached your ${docs} for ${address || 'the property'}.${note ? ` ${note}` : ''}`,
    '',
    // The client link: read the quote and accept or decline it on a phone.
    ...(link ? ['You can read the quote and accept or decline it on your phone here:', link, ''] : []),
    ...questionsLine(),
    'Kind regards,',
    ...[signOff, company.name].filter(Boolean),
  ].join('\n');
}

// How the client gets back to the business, for the end of an email. An
// email SAYON sends takes replies at the email under Your business; with
// none there a reply would go to the address SAYON sends from, where nobody
// reads it, so the line gives the phone number only. An email from the
// phone's own mail app always takes its replies.
function contactWays() {
  const company = getCompanyDetails();
  const reply = !directEmail || !!(company.email || '').trim();
  return [reply ? 'just reply to this email' : '', company.phone ? `call us on ${company.phone}` : ''].filter(Boolean).join(' or ');
}
// "If you have any questions…" and the blank line after it, or nothing
// when there's no way to give.
function questionsLine() {
  const ways = contactWays();
  return ways ? [`If you have any questions, ${ways}.`, ''] : [];
}

// Whether the Worker can send email: null until checked, then true or
// false. Checked when the app opens, so the first tap already knows.
let directEmail = null;
let directEmailSending = false;
// Whether the Worker also sends an email with no PDFs (the re-inspection
// reminder, js/reinspection.js). Older Workers need a PDF on every email.
let directEmailText = false;

async function checkDirectEmail() {
  directEmail = null;
  directEmailText = false;
  if (!authUser) return;
  const forUser = authUser.id;
  try {
    const res = await workerFetch('/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ check: true }),
    });
    const data = res.ok ? await res.json() : {};
    if (authUser && authUser.id === forUser) { directEmail = !!data.configured; directEmailText = !!data.configured && !!data.textOnly; }
  } catch (e) {
    directEmail = false;
  }
}

// Returns true only once the files were sent: the Worker sent them, or the
// share sheet reports it finished. When the app can't tell (the share sheet
// was closed, or the PDFs were downloaded for an email), it asks the
// inspector "Did that send?" and returns their answer.
async function sendPdfsToClient({ files, to, subject, body }) {
  // The sample job's emails come to the business, so they see what a client gets.
  if (isSampleJob(currentReportId) && typeof sampleJobSendTo === 'function') {
    to = sampleJobSendTo();
    subject = `Sample: ${subject}`;
  }
  if (directEmail && to) return sendPdfsDirect({ files, to, subject, body });
  const fileObjs = files.map(f => new File([f.blob], f.fname, { type: 'application/pdf' }));
  const many = files.length > 1;
  if (navigator.share && navigator.canShare && navigator.canShare({ files: fileObjs })) {
    if (to && navigator.clipboard) {
      navigator.clipboard.writeText(to).catch(() => {});
      showToast(`${to} copied. Paste it into To`, 'info');
    }
    try {
      await navigator.share({ title: subject, text: body, files: fileObjs });
      return true;
    } catch (e) {
      // Safari refuses if too long passed since the tap; a second tap works.
      if (e.name === 'NotAllowedError') { showToast('Tap Send again to open your email', 'info'); return false; }
      if (e.name !== 'AbortError') { showToast('Could not open sharing on this device', 'error'); return false; }
      return askDidItSend(many);
    }
  }
  files.forEach(f => downloadBlob(f.blob, f.fname));
  window.location.href = `mailto:${encodeURIComponent(to || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  showToast(`PDF${many ? 's' : ''} downloaded. Attach ${many ? 'them' : 'it'} to the email that just opened`, 'info');
  return askDidItSend(many);
}

// "Did that send?" Yes / Not yet. Resolves true on Yes. text: other wording.
let didItSendResolve = null;
function askDidItSend(many, text) {
  if (didItSendResolve) didItSendResolve(false);
  document.getElementById('didItSendText').textContent = text ? text : many
    ? 'Tap Yes once the email with the PDFs has gone to the client. If it hasn\'t, tap Not yet and send again.'
    : 'Tap Yes once the email with the PDF has gone to the client. If it hasn\'t, tap Not yet and send again.';
  document.getElementById('didItSendOverlay').classList.add('open');
  return new Promise(resolve => { didItSendResolve = resolve; });
}
function answerDidItSend(yes) {
  document.getElementById('didItSendOverlay').classList.remove('open');
  const r = didItSendResolve;
  didItSendResolve = null;
  if (r) r(!!yes);
  if (!yes) showToast('Not marked as sent', 'info');
}

// One "Sent" line per document the job has (report, quote, certificate),
// for the report banner and the quote screen. Each: { label, at, stale, verb }.
function sentDocs(rd, q) {
  const sent = rd && rd.sent;
  const docs = [{ label: 'Report', at: sent ? sent.at : null }];
  if (quoteHasItems(q)) {
    docs.push({ label: 'Quote', at: q.sentAt || null, stale: !!q.sentAt && q.sentHash !== quoteContentHash(q) });
    if (q.treatment) docs.push({ label: 'Certificate', at: q.certificateSentAt || q.certificateHandedAt || null, verb: !q.certificateSentAt && q.certificateHandedAt ? 'Given' : '' });
  }
  return docs;
}
function renderSentLines(rd, q) {
  return `<div class="doc-sent-lines">${sentDocs(rd, q).map(d =>
    `<div class="doc-sent ${d.at ? (d.stale ? 'stale' : 'sent') : 'unsent'}"><span>${d.label}</span>` +
    `<strong>${d.at ? `${d.verb || 'Sent'} ${formatIssueDate(d.at)}${d.stale ? ' · changed since' : ''}` : 'Not sent yet'}</strong></div>`).join('')}</div>`;
}

async function sendPdfsDirect({ files, to, subject, body }) {
  if (directEmailSending) return false;
  directEmailSending = true;
  const company = getCompanyDetails();
  const copyTo = (company.email || '').trim();
  showToast(`Sending to ${to}…`, 'info');
  try {
    const attachments = await Promise.all(files.map(async f => ({
      filename: f.fname,
      content: (await blobToDataUrl(f.blob)).split(',')[1],
    })));
    const res = await workerFetch('/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, text: body, attachments, fromName: company.name || '', replyTo: copyTo, copyTo }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Could not send from SAYON');
    }
    showToast(`Sent to ${to}${copyTo && copyTo !== to ? `. A copy went to ${copyTo}` : ''}`, 'success');
    return true;
  } catch (e) {
    // The phone's mail app from here on, this session. It needs a fresh
    // tap to open, so the inspector taps again.
    directEmail = false;
    if (!sendFailedForSignal(e)) reportError(e, 'send_email');
    showToast(`${sendFailureReason(e)}. Tap again to send it from your email app`, 'error');
    return false;
  } finally {
    directEmailSending = false;
  }
}

// Why an email through SAYON didn't go, for the toast. No signal, or no
// answer in time (90 seconds on a weak one), is "Could not reach SAYON".
// Otherwise it's the Worker's reason without its own advice ("Try again,
// or send it from your mail app"), as the next tap opens the mail app.
function sendFailedForSignal(e) {
  return e instanceof TypeError || !!(e && e.name === 'AbortError');
}
function sendFailureReason(e) {
  if (sendFailedForSignal(e)) return 'Could not reach SAYON to send it';
  return String((e && e.message) || 'Could not send from SAYON').split('. ')[0].replace(/\.$/, '');
}

// ── CHECK BEFORE SENDING ────────────────────────────────────────────────
// Send opens a review of exactly what the client will get: who it goes to,
// the PDFs attached, the headline results and the message, plus any gaps
// in the report, each with its own fix. The PDFs are built only once the
// inspector confirms, so what goes is the report as it is then. If the
// build takes too long for the share sheet, the built files are kept and
// the next tap sends them at once.
// The quote sent on its own opens the same sheet (CHECK BEFORE THE QUOTE
// GOES in js/quote.js): sendReview.kind is 'report' or 'quote'.
let sendReview = null;

function openSendReview() {
  if (!jsPDF) {
    ensureJsPDFLoaded().then(openSendReview)
      .catch(e => showToast((e && e.message) || 'Could not load the PDF tools', 'error'));
    return;
  }
  const sidebar = document.getElementById('sidebarPanel');
  if (sidebar && sidebar.classList.contains('open')) toggleDrawer();
  track('screen_viewed', { screen: 'check_before_send' });
  const quote = currentJobQuote();
  const address = getFullAddress();
  const client = document.getElementById('jobClient').value.trim();
  const sampleTo = isSampleJob(currentReportId) && typeof sampleJobSendTo === 'function' ? sampleJobSendTo() : '';
  const email = sampleTo || (reportData.jobClientEmail || '').trim();
  // A quote the client already declined isn't sent again with the report.
  const answer = quoteHasItems(quote) && typeof quoteAnswerState === 'function' ? quoteAnswerState(quote) : null;
  const declined = !!(answer && !answer.stale && answer.status !== 'accepted');
  const withQuote = quoteHasItems(quote) && !declined;
  sendReview = { kind: 'report', files: null, quote: withQuote ? quote : null };
  document.getElementById('sendReviewSummaryLabel').hidden = false;
  document.getElementById('sendReviewSummary').hidden = false;

  const esc = escapeHtml;
  document.getElementById('sendReviewTo').innerHTML =
    `<div class="send-review-name">${esc(sampleTo ? 'You, not a client: this is the sample job' : client || 'No client name')}</div>` +
    (email ? `<div class="send-review-email">${esc(email)}</div>`
      : isReportLocked() ? `<div class="send-review-warn">No client email. Type it into your email app.</div>`
      : `<div class="send-review-warn">No client email. Add it so SAYON can send it for you.</div>
         <div class="send-review-add-email"><input class="job-input" id="sendReviewEmail" type="email" placeholder="client@email.com" autocomplete="off">
         <button class="agreement-banner-btn" onclick="addSendReviewEmail()">Add</button></div>`);

  renderSendReviewCopy();

  const attach = [`<div class="send-review-file"><div><div class="send-review-file-name">Inspection report</div>` +
    `<div class="send-review-file-meta">${esc(ensureReportNumber())} · version ${reportVersion()}</div></div>` +
    `<button class="link-btn" onclick="previewSendFile(0)">Preview</button></div>`];
  if (withQuote) {
    attach.push(`<div class="send-review-file"><div><div class="send-review-file-name">Treatment quote</div>` +
      `<div class="send-review-file-meta">${esc(quote.number || '')} · ${formatAUD(quoteTotals(quote).total)}${quote.gst !== false ? ' inc GST' : ''}</div></div>` +
      `<button class="link-btn" onclick="previewSendFile(1)">Preview</button></div>`);
  } else if (!reportData.noQuoteNeeded && !declined) {
    attach.push('<div class="send-review-gap"><span class="send-review-warn">No quote is attached.</span>' +
      '<span class="send-review-fixes"><button class="link-btn" onclick="fixSendGap(\'quote\')">Build quote now</button></span></div>');
  }
  document.getElementById('sendReviewFiles').innerHTML = attach.join('');

  // The same questions, in the same groups, as the report's summary page.
  const { groups, limited } = reportSummary();
  document.getElementById('sendReviewSummary').innerHTML = groups.map(g =>
    `<div class="send-review-sub">${esc(g.title)}</div><div class="send-review-tiles">` + g.items.map(([label, value, tone]) =>
      `<div class="send-review-tile tone-${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('') + '</div>').join('') +
    (limited.length ? `<div class="send-review-sub">Not fully inspected</div><ul class="send-review-list">${limited.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : '');

  // What the report is still missing (the list Finish shows), then what
  // the business's own details are missing.
  const gaps = reportPrepGaps().concat(businessSendGaps('the PDFs', "fixSendGap('business')"));
  const gapsWrap = document.getElementById('sendReviewGaps');
  gapsWrap.style.display = gaps.length ? '' : 'none';
  gapsWrap.innerHTML = reportGapsHtml(gaps);

  document.getElementById('sendReviewSubject').value =
    `${withQuote ? 'Timber pest inspection report and quote' : 'Timber pest inspection report'} — ${address || 'your property'}`;
  sendReview.message = {
    client, address,
    docs: withQuote ? 'timber pest inspection report and treatment quote' : 'timber pest inspection report',
    signOff: document.getElementById('jobInspector').value.trim(),
  };
  sendReview.defaultBody = clientMessage(sendReview.message);
  document.getElementById('sendReviewBody').value = sendReview.defaultBody;
  // A quote the client already accepted goes as a copy, without a link to accept it again.
  if (withQuote && !(answer && !answer.stale)) prepareSendReviewLink(sendReview);
  // The button stays at the foot of the sheet and always says who it goes
  // to. With something still open above, a line over it says how many.
  sendReview.label = directEmail && email ? `Send to ${email}` : 'Open email to send';
  const btn = document.getElementById('sendReviewBtn');
  btn.textContent = sendReview.label;
  btn.disabled = false;
  const open = document.getElementById('sendReviewOpen');
  open.hidden = !gaps.length;
  open.textContent = gaps.length === 1 ? '1 thing at the top is still open' : `${gaps.length} things at the top are still open`;
  document.getElementById('sendReviewOverlay').classList.add('open');
  const body = document.querySelector('#sendReviewOverlay .page-sheet-body');
  if (body) body.scrollTop = 0;
}

// The client link for the quote (see CLIENT LINK in js/quote.js): made
// while the inspector reads the sheet, then added to the message and the
// Attached list. The PDFs are built now so the page can offer them; they
// are the same files the send then uses.
async function prepareSendReviewLink(r) {
  if (!authSession || !navigator.onLine || isSampleJob(currentReportId)) return;
  let link = null;
  try {
    const files = await sendReviewFiles(r);
    link = await ensureQuoteLink(r.quote, { report: files[0], quote: files[1] });
  } catch (e) {
    reportError(e, 'send_review_link');
  }
  if (!link || sendReview !== r) return;
  showSendReviewLink(r, quoteLinkUrl(link.id));
}

// The link, once it's made: into the message and onto the Attached list.
// A message the inspector has already changed keeps their words, with the
// link's two lines added above the sign-off.
function showSendReviewLink(r, url) {
  r.link = url;
  const body = document.getElementById('sendReviewBody');
  const withLink = clientMessage(Object.assign({}, r.message, { link: url }));
  if (body.value === r.defaultBody) body.value = withLink;
  else if (!body.value.includes(url)) {
    const lines = `You can read the quote and accept or decline it on your phone here:\n${url}\n\n`;
    const at = body.value.lastIndexOf('Kind regards,');
    body.value = at > -1 ? body.value.slice(0, at) + lines + body.value.slice(at) : `${body.value.replace(/\s+$/, '')}\n\n${lines}`;
  }
  r.defaultBody = withLink;
  document.getElementById('sendReviewFiles').insertAdjacentHTML('beforeend', `<div class="send-review-file"><div><div class="send-review-file-name">Link to accept the quote</div>` +
    `<div class="send-review-file-meta">In the message. The client reads the quote and accepts or declines it on their phone</div></div></div>`);
}

// What the business's own details are missing, for a check sheet: they
// print on every PDF, and the email is where a client's reply goes.
// what: 'the PDFs' or 'the quote'. fix: what its Add button runs.
function businessSendGaps(what, fix) {
  const gaps = [];
  const missing = companyDetailGaps();
  const where = canEditBusiness() ? 'Menu › Your business' : 'the details your business owner set';
  const addBtn = many => canEditBusiness() ? `<button class="link-btn" onclick="${fix}">Add ${many ? 'them' : 'it'}</button>` : '';
  if (missing.length) gaps.push({ key: 'company', text: `Your ${joinWithAnd(missing)} ${missing.length === 1 ? 'is' : 'are'} missing from ${where}, so ${what} won't show ${missing.length === 1 ? 'it' : 'them'}`, fix: addBtn(missing.length > 1) });
  if (directEmail && !(getCompanyDetails().email || '').trim()) gaps.push({ key: 'reply', text: `Your business email is missing from ${where}, so a client's reply to this email wouldn't reach you. The message gives your phone number instead`, fix: addBtn(false) });
  return gaps;
}

// Saves the email typed on the check sheet to the job, then redraws the
// sheet so the send button sends to it.
function addSendReviewEmail() {
  const value = document.getElementById('sendReviewEmail').value.trim();
  if (!/^[^\s@<>,;"()]+@[^\s@<>,;"()]+\.[^\s@<>,;"()]+$/.test(value)) {
    showToast("That email address doesn't look right", 'error');
    return;
  }
  if (sendReview && sendReview.kind === 'quote') { setQuoteClientEmail(value); openQuoteSendReview(); return; }
  document.getElementById('jobClientEmail').value = value;
  saveJobInfo();
  openSendReview();
}

// ── A COPY FOR THE AGENT OR SOLICITOR ──
// On a pre-purchase job the buyer's agent, solicitor or conveyancer often
// needs the report too. The check sheet takes one more address
// (reportData.copyTo = { email, at }); once the client's email has gone,
// SAYON sends that address the report on its own, never the quote, with a
// short note saying whose report it is. reportData.copySent records it.
// Through the phone's mail app there is one email, so the sheet says to add
// the address to it. Only with the client's OK, which the sheet says.
const COPY_EMAIL_RE = /^[^\s@<>,;"()]+@[^\s@<>,;"()]+\.[^\s@<>,;"()]+$/;
function sendCopyTo() {
  const c = reportData.copyTo;
  return c && typeof c.email === 'string' && COPY_EMAIL_RE.test(c.email.trim()) ? c.email.trim() : '';
}

function renderSendReviewCopy() {
  const wrap = document.getElementById('sendReviewCopy');
  if (!wrap) return;
  const esc = escapeHtml;
  const copy = sendCopyTo();
  const sample = isSampleJob(currentReportId);
  if (sample) { wrap.innerHTML = ''; wrap.hidden = true; return; }
  wrap.hidden = false;
  const sent = reportData.copySent && reportData.copySent.to === copy ? ` Sent ${formatIssueDate(reportData.copySent.at)}.` : '';
  if (copy) {
    wrap.innerHTML = `<div class="send-copy-row"><div><div class="send-review-file-name">Copy of the report to</div>` +
      `<div class="send-review-email">${esc(copy)}</div>` +
      `<div class="send-review-file-meta">${directEmail ? 'The report only, not the quote, once the client\'s email has gone.' : 'Add this address to the email yourself.'}${sent}</div></div>` +
      (isReportLocked() ? '' : `<button class="link-btn" onclick="removeSendReviewCopy()">Remove</button>`) + '</div>';
    return;
  }
  if (isReportLocked()) { wrap.innerHTML = ''; wrap.hidden = true; return; }
  wrap.innerHTML = `<button type="button" class="link-btn send-copy-open" onclick="openSendReviewCopy()">Also send the report to an agent or solicitor</button>` +
    `<div class="send-copy-add" id="sendCopyAdd" hidden><div class="send-review-add-email"><input class="job-input" id="sendCopyEmail" type="email" placeholder="agent@email.com" autocomplete="off" aria-label="Agent or solicitor's email">` +
    `<button class="agreement-banner-btn" onclick="addSendReviewCopy()">Add</button></div>` +
    `<div class="send-review-file-meta">Only with your client's OK. They get the report, not the quote.</div></div>`;
}

function openSendReviewCopy() {
  const add = document.getElementById('sendCopyAdd');
  const btn = document.querySelector('#sendReviewCopy .send-copy-open');
  if (add) add.hidden = false;
  if (btn) btn.hidden = true;
  const input = document.getElementById('sendCopyEmail');
  if (input) input.focus();
}

function addSendReviewCopy() {
  const value = (document.getElementById('sendCopyEmail').value || '').trim();
  if (!COPY_EMAIL_RE.test(value)) { showToast("That email address doesn't look right", 'error'); return; }
  if (value.toLowerCase() === (reportData.jobClientEmail || '').trim().toLowerCase()) { showToast('That\'s the client\'s own email', 'info'); return; }
  reportData.copyTo = { email: value, at: Date.now() };
  saveDraft();
  if (currentReportId) saveCurrentReport(true);
  renderSendReviewCopy();
}

function removeSendReviewCopy() {
  delete reportData.copyTo;
  saveDraft();
  if (currentReportId) saveCurrentReport(true);
  renderSendReviewCopy();
}

// The report on its own to the copy address, through the Worker. A failure
// here never undoes the client's send: it says so, and the copy can be
// forwarded from the business's own copy of the email.
async function sendReportCopy(file, to) {
  const company = getCompanyDetails();
  const replyTo = (company.email || '').trim();
  const client = document.getElementById('jobClient').value.trim();
  const address = getFullAddress();
  const signOff = document.getElementById('jobInspector').value.trim();
  const body = [
    'Hi,',
    '',
    `Please find attached a copy of the timber pest inspection report for ${address || 'the property'}${client ? `, sent to ${client} today at their request` : ', sent at the client\'s request'}.`,
    '',
    ...questionsLine(),
    'Kind regards,',
    ...[signOff, company.name].filter(Boolean),
  ].join('\n');
  try {
    const content = (await blobToDataUrl(file.blob)).split(',')[1];
    const res = await workerFetch('/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject: `Copy: timber pest inspection report — ${address || 'the property'}`, text: body, attachments: [{ filename: file.fname, content }], fromName: company.name || '', replyTo }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Could not send from SAYON');
    }
    reportData.copySent = { to, at: Date.now() };
    saveDraft();
    showToast(`Sent to the client, and a copy of the report to ${to}`, 'success');
    track('report_copy_sent');
    return true;
  } catch (e) {
    if (!sendFailedForSignal(e)) reportError(e, 'send_report_copy');
    showToast(`The client's email went, but the copy to ${to} didn't (${sendFailureReason(e)}). Forward it from your own copy`, 'error');
    return false;
  }
}

// The fix buttons on the check sheet. Each changes the report, then the
// sheet is redrawn from the report as it now is.
// from: 'send' (the check sheet), 'extract' (the sheet after a note) or
// 'finish' (the report's Finish step, which redraws itself).
function fixSendGap(kind) { fixReportGap(kind, 'send'); }
function fixReportGap(kind, from = 'send') {
  const reopen = () => from === 'send' ? openSendReview() : from === 'extract' ? showExtractSummary(extractSummaryBefore) : updateProgress();
  const leave = () => from === 'send' ? closeSendReview() : from === 'extract' ? closeExtractSummary() : null;
  if (kind === 'quote') { leave(); sendAfterQuote = true; openQuoteFromReport(); return; }
  if (kind === 'agreement') { leave(); openAgreementSheet(); return; }
  if (kind === 'address') {
    leave();
    jobGo('details');
    const el = document.getElementById('jobAddress');
    el.scrollIntoView({ block: 'center' });
    el.focus({ preventScroll: true });
    return;
  }
  if (kind === 'photos') { backUpPhotosFromGap(from); return; }
  if (kind === 'business') { openBusinessForm(reopen); return; }
  // "Show me": to the answer in the report, and the walk through the rest.
  if (kind.startsWith('go:')) { leave(); showBlank(kind.slice(3)); return; }
  if (kind.startsWith('finding:')) { leave(); showAreaFindingPrompt(kind.slice(8)); return; }
  if (kind === 'interval12') {
    reportData.inspectionFrequency = '12 months';
    const el = document.getElementById('f-inspectionFrequency');
    if (el) renderField(el, 'inspectionFrequency', reportData.inspectionFrequency);
    saveDraft();
    reopen();
    return;
  }
  if (/^(inspected|na):/.test(kind)) {
    const [k, z] = kind.split(':');
    if (!reportData.areaStatus) reportData.areaStatus = {};
    reportData.areaStatus[z] = k === 'na' ? 'NA' : 'INSPECTED';
    syncObstructionData();
  } else if (kind.startsWith('found:')) { if (!reportData.areaResult) reportData.areaResult = {}; reportData.areaResult[kind.slice(6)] = 'FOUND'; syncObstructionData(); }
  else if (kind === 'clear') markRemainingAreasClear();
  else markRemainingAreasInspected(kind === 'na' ? 'NA' : 'INSPECTED');
  reopen();
}

// After "Build quote now", coming back from the quote reopens the check.
let sendAfterQuote = false;
function resumeSendReview() {
  if (!sendAfterQuote) return;
  sendAfterQuote = false;
  openSendReview();
}

function closeSendReview() {
  document.getElementById('sendReviewOverlay').classList.remove('open');
  sendReview = null;
}

// Builds this send's PDFs once and keeps them for a second tap.
async function sendReviewFiles(r) {
  if (r.files) return r.files;
  if (r.kind === 'quote') { r.files = [buildQuotePDF(r.quote)]; return r.files; }
  const report = await buildReportPdf();
  const files = [{ blob: report.blob, fname: report.fname }];
  if (r.quote) files.push(buildQuotePDF(r.quote));
  r.report = report;
  r.files = files;
  return files;
}

async function previewSendFile(i) {
  const r = sendReview;
  if (!r) return;
  let f;
  try { f = (await sendReviewFiles(r))[i]; } catch (e) { showToast('Could not make the PDF', 'error'); return; }
  if (!f) return;
  const url = URL.createObjectURL(f.blob);
  if (!window.open(url, '_blank')) downloadBlob(f.blob, f.fname);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function confirmSendReview() {
  const r = sendReview;
  if (!r || r.busy) return;
  const btn = document.getElementById('sendReviewBtn');
  r.busy = true;
  btn.disabled = true;
  try {
    if (!r.files) btn.textContent = 'Making the PDFs…';
    let files;
    try { files = await sendReviewFiles(r); }
    catch (e) {
      console.error('PDF build failed:', e);
      reportError(e, 'send_pdf');
      showToast((e && e.message) || 'Could not make the PDF', 'error');
      return;
    }
    // The quote on its own waits for its link, which the client accepts from.
    if (r.linkPending) { btn.textContent = 'Making the link…'; await r.linkPending; }
    btn.textContent = r.label;
    const sent = await sendPdfsToClient({
      files,
      to: r.kind === 'quote' ? (r.quote.clientEmail || '').trim() : (reportData.jobClientEmail || '').trim(),
      subject: document.getElementById('sendReviewSubject').value.trim(),
      body: document.getElementById('sendReviewBody').value,
    });
    if (!sent || sendReview !== r) return;
    if (r.kind === 'quote') {
      closeSendReview();
      // Sent at these prices, so they're the business's own from here on.
      rememberQuotePrices(r.quote);
      markQuoteSent(r.quote);
      track('quote_sent', { with_link: !!r.link });
      return;
    }
    const copy = sendCopyTo();
    if (copy && directEmail && !isSampleJob(currentReportId)) await sendReportCopy(files[0], copy);
    closeSendReview();
    track('report_sent', { documents: files.length, with_quote: !!r.quote, with_link: !!r.link, with_copy: !!copy });
    if (r.quote) markQuoteSent(r.quote);
    recordReportSent(r.report.fingerprint, r.report.version);
  } finally {
    r.busy = false;
    btn.disabled = false;
    if (sendReview === r) btn.textContent = r.label;
  }
}

function generateReport() {
  const btn = document.getElementById('generateBtn');
  const originalText = btn.innerHTML;
  btn.innerHTML = 'Generating…';
  btn.disabled = true;
  btn.style.opacity = '0.7';

  // Defer to next tick so the UI updates before the (synchronous) PDF build
  setTimeout(() => {
    ensureJsPDFLoaded().then(() => {
      return _buildAndDownloadPDF();
    }).then(() => track('report_pdf_made')).catch((e) => {
      console.error('PDF generation failed:', e);
      reportError(e, 'report_pdf');
      showToast((e && e.message) || 'Could not make the PDF. Check your signal and try again', 'error');
    }).finally(() => {
      btn.innerHTML = originalText;
      btn.disabled = false;
      btn.style.opacity = '';
    });
  }, 50);
}

// The last line of "What to do next": when to inspect again, in the
// inspector's words. "Re-inspect 4 weeks after treatment…" stands on its own,
// "Next inspection in 3 months…" isn't given a second "Next inspection", and
// "12 months" reads "Next timber pest inspection: in 12 months".
function nextInspectionStep(freq) {
  const f = String(freq || '').trim().replace(/[.;,\s]+$/, '');
  if (!f) return 'Next timber pest inspection: within 12 months.';
  if (/^(re-?inspect|inspect)\b/i.test(f)) return f.charAt(0).toUpperCase() + f.slice(1) + '.';
  if (/^next (timber pest )?inspection\b/i.test(f)) return f.replace(/^next (timber pest )?inspection\b/i, 'Next timber pest inspection') + '.';
  const when = /^\d+\s*(week|month|year)s?\b/i.test(f) ? 'in ' + f : lowerFirst(f);
  return `Next timber pest inspection: ${when}.`;
}

// The summary's Next inspection answer in a few words ("6 MONTHS"); the
// inspector's full wording prints under the question.
function nextInspectionChip(freq) {
  const f = String(freq || '').trim();
  if (!f) return 'WITHIN 12 MONTHS';
  const m = f.match(/(\d+)\s*(month|week|year)s?/i);
  if (m) return `${m[1]} ${m[2].toUpperCase()}${m[1] === '1' ? '' : 'S'}`;
  return f.split(/[,;]/)[0].trim().toUpperCase();
}
