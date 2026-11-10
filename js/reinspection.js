// ── RE-INSPECTIONS DUE ────────────────────────────────────────────────────
// Every report sets when the next timber pest inspection is due (its
// Re-inspection Frequency, "12 months" or "3 months, then every 12
// months"), and a treatment record can set its own date. The Jobs screen's
// Due tab lists each property whose next inspection is coming up or has
// passed, with an email to the client offering to book it and a button to
// start the new report.
//
// One row per property: the latest report at the address decides. A newer
// report there (even a draft) means the re-inspection has started, so the
// property drops off the list by itself.
//
// What the inspector did about a reminder (emailed, taken off the list) is
// kept on this phone under korva_reinspect_<user id>, not in the report, so
// a completed, locked report is never changed by it.

const REINSPECT_AHEAD_DAYS = 30;

function reinspectStorageKey() {
  return (typeof authUser !== 'undefined' && authUser && authUser.id) ? `korva_reinspect_${authUser.id}` : 'korva_reinspect';
}
function getReinspectMarks() {
  try { return JSON.parse(localStorage.getItem(reinspectStorageKey()) || '{}') || {}; } catch (e) { return {}; }
}
function setReinspectMark(id, patch) {
  const marks = getReinspectMarks();
  marks[id] = { ...(marks[id] || {}), ...patch };
  try { localStorage.setItem(reinspectStorageKey(), JSON.stringify(marks)); } catch (e) {}
}

function reinspectDaysBetween(fromIso, toIso) {
  return Math.round((new Date(toIso + 'T00:00:00') - new Date(fromIso + 'T00:00:00')) / 86400000);
}

// When this report's property is next due, or null for a report that isn't
// finished (a draft has no next inspection yet). { due, last, months, fromTreatment }
function reinspectionFor(r, quotes) {
  const d = r.reportData || {};
  if (!(d.issue || d.sent || d.pdfAt)) return null;
  const q = (quotes && quotes[r.id]) || r.quote || null;
  const t = q && q.treatment;
  const lastIso = d.jobInspectionDate || (d.agreement && d.agreement.inspectionDate) || isoDate(new Date(dashboardJobTime(r)));
  const months = inspectionFrequencyMonths(d);
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (t && iso.test(t.nextInspection || '')) return { due: t.nextInspection, last: lastIso, months, fromTreatment: true, treatedOn: t.date };
  if (!iso.test(lastIso)) return null;
  return { due: addMonthsIso(lastIso, months), last: lastIso, months, fromTreatment: false };
}

// Every property due within REINSPECT_AHEAD_DAYS or overdue, soonest first.
function reinspectionsDue() {
  const today = todayIsoDate();
  const quotes = typeof getSavedQuotes === 'function' ? getSavedQuotes() : {};
  const marks = getReinspectMarks();
  const latest = new Map();
  getSavedReports().forEach(r => {
    if (!r || !r.reportData || isSampleJob(r)) return;
    const key = addressKey(r.jobAddress, r.jobSuburb) || String(r.address || '').trim().toLowerCase();
    if (!key) return;
    const prev = latest.get(key);
    if (!prev || dashboardJobTime(r) > dashboardJobTime(prev) || (dashboardJobTime(r) === dashboardJobTime(prev) && (r.savedAt || 0) > (prev.savedAt || 0))) latest.set(key, r);
  });
  const out = [];
  latest.forEach(r => {
    const info = reinspectionFor(r, quotes);
    if (!info) return;
    const mark = marks[r.id] || {};
    if (mark.dismissedAt) return;
    const days = reinspectDaysBetween(today, info.due);
    if (days > REINSPECT_AHEAD_DAYS) return;
    out.push({ r, ...info, days, overdue: days < 0, mark });
  });
  return out.sort((a, b) => a.due < b.due ? -1 : a.due > b.due ? 1 : 0);
}

// "Overdue by 3 weeks", "Due today", "Due in 12 days".
function reinspectWhen(item) {
  const n = Math.abs(item.days);
  const span = n >= 60 ? `${Math.round(n / 30.4)} months` : n >= 14 ? `${Math.round(n / 7)} weeks` : `${n} day${n === 1 ? '' : 's'}`;
  if (item.days === 0) return 'Due today';
  if (item.days === 1) return 'Due tomorrow';
  return item.overdue ? `Overdue by ${span}` : `Due in ${span}`;
}

function reinspectStatusLine(item) {
  if (item.mark.sentAt) return `Reminder sent ${dashDate(item.mark.sentAt)}`;
  return reinspectWhen(item);
}

const REINSPECT_ICON = '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/></svg>';

// The Due tab's list, drawn into the Jobs screen.
function renderReinspectionList(fade) {
  const items = reinspectionsDue();
  if (!items.length) {
    return `<p class="dash-none${fade ? ' fade-in' : ''}">No properties are due for a re-inspection in the next ${REINSPECT_AHEAD_DAYS} days. Each finished report puts its property here when its next inspection comes up.</p>`;
  }
  // The same cards as the other tabs: the calendar in red when overdue,
  // amber while it's coming up, blue once the reminder has gone.
  return `
    <div class="dash-cards${fade ? ' fade-in' : ''}">
      ${items.map(it => {
        const addr = (it.r.address || 'No address').trim();
        const cut = addr.indexOf(', ');
        const tile = it.mark.sentAt ? 'now' : it.overdue ? 'bad' : 'wait';
        return `
        <div class="dash-card reinspect-card${it.overdue ? ' overdue' : ''}${it.mark.sentAt ? ' reminded' : ''}">
          <button type="button" class="dash-card-main reinspect-row" onclick="openReinspectDetail('${it.r.id}')">
            <span class="job-tile ${tile}" aria-hidden="true">${REINSPECT_ICON}</span>
            <span class="dash-card-text">
              <span class="dash-card-street">${escapeHtml(cut > 0 ? addr.slice(0, cut) : addr)}</span>
              ${cut > 0 ? `<span class="dash-card-suburb">${escapeHtml(addr.slice(cut + 2))}</span>` : ''}
              <span class="dash-card-sub"><span>${[it.r.client, reinspectStatusLine(it)].filter(Boolean).map(escapeHtml).join(' · ')}</span></span>
            </span>
            <span class="dash-card-end">
              <span class="dash-card-when">${it.overdue ? 'Was due' : 'Due'}</span>
              <span class="dash-card-total">${escapeHtml(dashDay(it.due))}</span>
            </span>
          </button>
        </div>`; }).join('')}
    </div>`;
}

function reinspectItem(id) {
  return reinspectionsDue().find(it => it.r.id === id) || null;
}

function reinspectClientEmail(r) {
  return String((r.reportData && r.reportData.jobClientEmail) || '').trim();
}

const REINSPECT_CLOSE_BTN = `<button type="button" class="dash-detail-close" onclick="closeDashboardDetail()" aria-label="Close">
        <svg class="icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>
      </button>`;

// One property's sheet: when it's due and why, the email, starting the new report.
function openReinspectDetail(id) {
  const it = reinspectItem(id);
  const sheet = document.getElementById('dashboardDetailSheet');
  if (!it || !sheet) return;
  const r = it.r;
  const who = (r.client || '').trim();
  const first = who.split(/\s+/)[0];
  const email = reinspectClientEmail(r);
  const why = it.fromTreatment
    ? `The treatment record from ${formatLongDate(it.treatedOn || it.last)} set the next inspection for ${formatLongDate(it.due)}.`
    : `Last inspected ${formatLongDate(it.last)}. The report recommended the next inspection within ${it.months} month${it.months === 1 ? '' : 's'}, so it ${it.overdue ? 'was' : 'is'} due ${formatLongDate(it.due)}.`;
  const sent = it.mark.sentAt ? ` You emailed ${escapeHtml(first || 'the client')} a reminder on ${escapeHtml(formatIssueDate(it.mark.sentAt))}.` : '';
  sheet.innerHTML = `
    <div class="dash-detail-grab" aria-hidden="true"></div>
    <div class="dash-detail-head">
      <div class="dash-detail-head-text">
        <span class="dash-detail-chip ${it.overdue ? 'overdue' : 'waiting'}">${escapeHtml(reinspectWhen(it))}</span>
        <h3 class="dash-detail-addr">${escapeHtml(r.address || 'No address')}</h3>
      </div>
      ${REINSPECT_CLOSE_BTN}
    </div>
    <dl class="dash-detail-facts">
      <div><dt>Client</dt><dd>${escapeHtml(who || 'Not entered')}</dd></div>
      <div><dt>Last</dt><dd>${escapeHtml(formatAnswerDate(it.last))}</dd></div>
      <div><dt>${it.overdue ? 'Was due' : 'Due'}</dt><dd>${escapeHtml(formatAnswerDate(it.due))}</dd></div>
    </dl>
    <section class="dash-next ${it.overdue ? '' : 'waiting'}">
      <div class="dash-next-label">Next step</div>
      <div class="dash-next-title">Book the re-inspection</div>
      <p class="dash-next-hint">${escapeHtml(why)}${sent}</p>
      <button type="button" class="dash-detail-primary" onclick="openReinspectEmail('${r.id}')">${it.mark.sentAt ? 'Email them again' : `Email ${escapeHtml(first || 'the client')} to book it`}</button>
      <div class="dash-detail-links">
        <button type="button" onclick="startReinspection('${r.id}')">Start the report</button>
        <button type="button" onclick="openDashboardJob('${r.id}', 'report')">Open last report</button>
      </div>
    </section>
    ${email ? '' : `<p class="reinspect-note">There's no email for ${escapeHtml(who || 'this client')} on the last report. You can add one on the next screen${r.reportData && r.reportData.jobClientPhone ? ` or call them on ${escapeHtml(r.reportData.jobClientPhone)}` : ''}.</p>`}
    <div class="dash-detail-foot">
      <button type="button" class="dash-detail-delete" onclick="dismissReinspection('${r.id}')">Take it off this list</button>
    </div>
  `;
  sheet.scrollTop = 0;
  document.getElementById('dashboardDetail').classList.add('open');
}

function reinspectEmailText(it) {
  const company = getCompanyDetails();
  const r = it.r;
  const first = greetingName(r.client);
  const me = typeof lastInspectorDetails === 'function' ? lastInspectorDetails().name : '';
  const address = r.address || 'your property';
  // A reply only reaches the business with its email set (contactWays).
  const ways = contactWays() || 'get in touch';
  const whenLine = it.overdue
    ? `Your last timber pest inspection at ${address} was on ${formatLongDate(it.last)}, and the next one was due on ${formatLongDate(it.due)}.`
    : `Your next timber pest inspection at ${address} is due on ${formatLongDate(it.due)}. The last one was on ${formatLongDate(it.last)}.`;
  return {
    subject: `Time for your next timber pest inspection — ${address}`,
    body: [
      first ? `Hi ${first},` : 'Hi,',
      '',
      whenLine,
      '',
      'Regular inspections are the best way to find termites early, before they cause much damage. Australian Standard AS 3660.2 recommends an inspection at least every 12 months.',
      '',
      `${ways.charAt(0).toUpperCase()}${ways.slice(1)} and we'll book a time that suits you.`,
      '',
      'Kind regards,',
      ...[me, company.name].filter(Boolean),
    ].join('\n'),
  };
}

// The email, shown in full before it goes, so the inspector can change it.
function openReinspectEmail(id) {
  const it = reinspectItem(id);
  const sheet = document.getElementById('dashboardDetailSheet');
  if (!it || !sheet) return;
  const msg = reinspectEmailText(it);
  const email = reinspectClientEmail(it.r);
  const direct = !!(directEmail && directEmailText);
  sheet.innerHTML = `
    <div class="dash-detail-grab" aria-hidden="true"></div>
    <div class="dash-peek-bar">
      <button type="button" class="dash-peek-back" onclick="openReinspectDetail('${id}')">
        <svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>Back
      </button>
    </div>
    <div class="dash-peek-kicker">${escapeHtml(it.r.address || 'No address')}</div>
    <h3 class="dash-peek-title">Email to book the re-inspection</h3>
    <div class="reinspect-form">
      <label class="send-review-label" for="reinspectTo">To</label>
      <input class="job-input" id="reinspectTo" type="email" value="${escapeHtml(email)}" placeholder="client@email.com" autocomplete="off">
      <label class="send-review-label" for="reinspectSubject">Subject</label>
      <input class="job-input" id="reinspectSubject" type="text" value="${escapeHtml(msg.subject)}">
      <label class="send-review-label" for="reinspectBody">Message</label>
      <textarea class="job-input reinspect-body" id="reinspectBody" rows="12">${escapeHtml(msg.body)}</textarea>
    </div>
    <p class="reinspect-note">${direct ? 'SAYON sends it from your business, with a copy to your own email.' : 'This opens your email app with the message ready. Check it and tap send there.'}</p>
    <div class="dash-detail-actions">
      <button type="button" class="dash-detail-primary" id="reinspectSendBtn" onclick="sendReinspectEmail('${id}')">${direct ? 'Send' : 'Open in my email app'}</button>
    </div>`;
  sheet.scrollTop = 0;
}

async function sendReinspectEmail(id) {
  const it = reinspectItem(id);
  if (!it) return;
  const to = document.getElementById('reinspectTo').value.trim();
  const subject = document.getElementById('reinspectSubject').value.trim();
  const body = document.getElementById('reinspectBody').value;
  if (to && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { showToast('That email address doesn\'t look right', 'error'); return; }
  if (!subject) { showToast('The email needs a subject', 'error'); return; }
  let sent = false;
  if (directEmail && directEmailText && to) {
    const btn = document.getElementById('reinspectSendBtn');
    if (btn) btn.disabled = true;
    sent = await sendTextEmailDirect({ to, subject, body });
    if (btn) btn.disabled = false;
    if (!sent) { openReinspectEmail(id); return; }
  } else {
    if (to && navigator.clipboard) navigator.clipboard.writeText(to).catch(() => {});
    window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    sent = await askDidItSend(false, 'Tap Yes once the reminder email has gone to the client. If it hasn\'t, tap Not yet.');
  }
  if (!sent) return;
  setReinspectMark(id, { sentAt: Date.now(), to });
  if (typeof track === 'function') track('reinspection_reminder_sent', { overdue: it.overdue, direct: !!(directEmail && directEmailText) });
  if (!(directEmail && directEmailText)) showToast('Marked as sent', 'success');
  closeDashboardDetail();
  renderDashboardJobs();
}

// A plain email with no PDFs, through the Worker's /send-email.
async function sendTextEmailDirect({ to, subject, body }) {
  if (directEmailSending) return false;
  directEmailSending = true;
  const company = getCompanyDetails();
  const copyTo = (company.email || '').trim();
  showToast(`Sending to ${to}…`, 'info');
  try {
    const res = await workerFetch('/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, text: body, attachments: [], fromName: company.name || '', replyTo: copyTo, copyTo }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Could not send from SAYON');
    }
    showToast(`Sent to ${to}${copyTo && copyTo !== to ? `. A copy went to ${copyTo}` : ''}`, 'success');
    return true;
  } catch (e) {
    directEmailText = false;
    if (!sendFailedForSignal(e)) reportError(e, 'send_reminder_email');
    showToast(`${sendFailureReason(e)}. Tap again to send it from your email app`, 'error');
    return false;
  } finally {
    directEmailSending = false;
  }
}

function dismissReinspection(id) {
  setReinspectMark(id, { dismissedAt: Date.now() });
  closeDashboardDetail();
  renderDashboardJobs();
  showToast('Taken off the Due list', 'info');
}

// A new report at the same address, with the client's details carried over.
// The report then offers "Inspected here before … Start from it" as usual.
function startReinspection(id) {
  const r = getSavedReports().find(x => x.id === id);
  if (!r) return;
  closeDashboardDetail();
  closeDashboard();
  saveOpenReportNow();
  startBlankReport();
  const set = (elId, v) => { const el = document.getElementById(elId); if (el) el.value = v || ''; };
  set('jobAddress', r.jobAddress || r.address);
  set('jobSuburb', r.jobSuburb);
  set('jobState', r.jobState);
  set('jobPostcode', r.jobPostcode);
  set('jobClient', r.client);
  const pd = r.reportData || {};
  reportData.jobClientEmail = pd.jobClientEmail || '';
  reportData.jobClientPhone = pd.jobClientPhone || '';
  // The client owns and lives in the house now, whatever the last job was.
  reportData.jobInspectionType = 'Annual — Existing Building';
  loadJobInfo();
  setStandard(INSPECTION_TYPE_STANDARD[reportData.jobInspectionType]);
  updateJob();
  if (typeof track === 'function') track('reinspection_started');
  showToast('Re-inspection started', 'info');
  jobGo('details');
}
