// SAYON app: Report sync with Supabase, sync between devices, save status, older jobs.
// One of the js/app/ files, which share one global scope: they load as plain
// scripts in the order index.html lists them, so a top-level name declared in
// any of them can be used from the others once the page has loaded.

// ── STABLE DEVICE ID (still used as fallback) ────────────────────────────
function getDeviceId() {
  let id = localStorage.getItem('korva_device_id');
  if (!id) {
    id = 'dev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    localStorage.setItem('korva_device_id', id);
  }
  return id;
}

// ── SUPABASE REPORT SYNC (now auth-aware) ────────────────────────────────
// Returns true once the report is in the account. quiet: no error toast.
// Saves of one report go to the account one at a time, in order. Otherwise
// an autosave could check the account copy while this phone's previous save
// was still on its way, and take this phone's own save for another device's.
const reportSaveChains = new Map();
function supabaseSave(entry, quiet) {
  const prev = reportSaveChains.get(entry.id) || Promise.resolve();
  const run = prev.catch(() => {}).then(() => supabaseSaveNow(entry, quiet));
  reportSaveChains.set(entry.id, run);
  // Once it has landed (or been refused), the job's Jobs card says which.
  run.finally(() => { if (reportSaveChains.get(entry.id) === run) reportSaveChains.delete(entry.id); refreshDashboardIfOpen(); });
  return run;
}

async function supabaseSaveNow(entry, quiet) {
  if (!authSession) return false; // only sync when authenticated
  if (isSampleJob(entry)) return true; // the sample stays on this phone
  // Only the version stored on this phone goes up. When it has changed since
  // (a newer save, which goes up next, or the other device's copy taken in),
  // or the report was deleted, this older one is skipped.
  const stored = getSavedReports().find(r => r.id === entry.id);
  if (!stored || stored.savedAt !== entry.savedAt) return true;
  // Photos go to Storage, not into the row. Record their cloud paths on
  // the saved copy (and the open draft, which shares the photo objects).
  if (await uploadPendingPhotos(entry.reportData)) {
    const reports = getSavedReports();
    const i = reports.findIndex(r => r.id === entry.id);
    if (i >= 0 && reports[i].savedAt === entry.savedAt) { reports[i] = entry; setSavedReports(reports); }
    if (currentReportId === entry.id) saveDraft();
  }
  // Saved again on this phone while the photos went up: that save goes next.
  if ((getSavedReports().find(r => r.id === entry.id) || {}).savedAt !== entry.savedAt) return true;
  try {
    // Another device may have saved this report since this phone last
    // synced it. Then the account copy wins and this phone's version is
    // kept beside it, so neither is lost.
    const cloudAt = await cloudSavedAtOf(entry.id);
    const base = Math.max(cloudBaseOf(entry), cloudBaseOf(stored));
    if (cloudAt && cloudAt > base && cloudAt !== entry.savedAt) {
      return keepBothCopies(entry);
    }
    const row = {
      device_id:   getDeviceId(),
      user_id:     authUser?.id || null,
      business_id: authBusiness?.id || null,
      report_id:   entry.id,
      address:     entry.address || null,
      client:      entry.client || null,
      inspector:   entry.inspector || null,
      saved_at:    new Date(entry.savedAt).toISOString(),
      data:        entry,
    };
    // FIX: this POST previously had no on_conflict target, so
    // Prefer: resolution=merge-duplicates had nothing to tell it which
    // unique constraint to upsert against (report_id is unique, but the
    // request never said so, and id - the real primary key - isn't in the
    // payload at all). The first save of a report (brand new report_id)
    // always worked, a plain 201 insert. But re-saving the SAME report
    // (e.g. "add more stuff" after already saving once) tried another
    // plain insert, hit reports_report_id_key, and Postgres/PostgREST
    // rejected it with 409 - confirmed live in production logs
    // (POST | 409 | .../rest/v1/reports). That 409 does trigger the
    // "could not sync to your account" toast below, but to the user it
    // just looked like "reports aren't saving" since the whole point of
    // re-saving is to update the existing one. on_conflict=report_id makes
    // this a real upsert: same report_id updates the existing row instead
    // of colliding with it.
    const res = await fetch(`${SUPABASE_URL}/rest/v1/reports?on_conflict=report_id`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const detail = await res.text();
      console.warn('Supabase save failed:', detail);
      if (quiet) return false;
      // FIX: this used to fail completely silently - "Report saved" already
      // showed from the local save, so a rejected cloud sync (e.g. RLS
      // blocking a write to a report row that doesn't belong to the current
      // account/business) was invisible until someone noticed the report
      // missing elsewhere. Surface it so "saved" never quietly means
      // "saved on this device only, and the server said no."
      showToast('Saved on this device, but could not sync to your account', 'error');
      updateSyncStatus('cloud_error');
      return false;
    }
    markCloudSaved(entry.id, entry.savedAt);
    return true;
  } catch(e) {
    console.warn('Supabase sync error:', e.message);
    if (quiet) return false;
    showToast('Saved on this device, but could not sync to your account', 'error');
    updateSyncStatus('cloud_error');
    return false;
  }
}

// ── ONE-TIME MIGRATION: reports saved locally before auth was enabled ──────
// (e.g. anything created while login was bypassed) never made it to
// Supabase, since supabaseSave() no-ops without a session. Push them up
// the first time each device gets a real logged-in session, so nothing
// from that period is silently orphaned on one device.
async function migrateLocalReportsToCloud() {
  if (!authSession) return;
  const MIGRATION_KEY = 'korva_local_migrated_v1';
  if (localStorage.getItem(MIGRATION_KEY)) return;

  try {
    const local = getSavedReports().filter(r => !isSampleJob(r));
    if (local.length > 0) {
      for (const entry of local) {
        await supabaseSave(entry);
      }
      showToast(`Backed up ${local.length} local report${local.length > 1 ? 's' : ''} to your account`, 'info');
    }
  } catch (e) {
    console.warn('Local report migration failed:', e.message);
    return; // don't set the flag — try again next session
  }
  localStorage.setItem(MIGRATION_KEY, '1');
}

async function supabaseDelete(reportId) {
  if (!authSession) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/reports?report_id=eq.${encodeURIComponent(reportId)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    return res.ok;
  } catch(e) { console.warn('Supabase delete error:', e.message); return false; }
}

async function supabaseLoadAll() {
  if (!authSession) return null;
  try {
    const filter = authUser?.id
      ? `user_id=eq.${authUser.id}&order=saved_at.desc`
      : `device_id=eq.${encodeURIComponent(getDeviceId())}&order=saved_at.desc`;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/reports?${filter}`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows.map(r => r.data);
  } catch(e) { console.warn('Supabase load error:', e.message); return null; }
}

// ── SYNC BETWEEN DEVICES ──────────────────────────────────────────────────
// Each saved report remembers the account copy it was built on
// (cloudSavedAt). Reports saved before this existed fall back to their own
// savedAt, the last time this phone saved them.
function cloudBaseOf(entry) {
  return entry.cloudSavedAt != null ? entry.cloudSavedAt : (entry.savedAt || 0);
}
function hasUnsyncedChanges(entry) {
  return entry.cloudSavedAt != null && (entry.savedAt || 0) > entry.cloudSavedAt;
}
// The account now holds this phone's save from savedAt. A later save on
// this phone was built on it, so it becomes that one's base too.
function markCloudSaved(id, savedAt) {
  const reports = getSavedReports();
  const r = reports.find(x => x.id === id);
  if (!r || (r.cloudSavedAt != null && r.cloudSavedAt >= savedAt) || (r.savedAt || 0) < savedAt) return;
  r.cloudSavedAt = savedAt;
  setSavedReports(reports);
}
async function cloudSavedAtOf(id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/reports?report_id=eq.${encodeURIComponent(id)}&select=saved_at`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error('saved_at check ' + res.status);
  const rows = await res.json();
  return rows.length ? Date.parse(rows[0].saved_at) : 0;
}
async function cloudReportOf(id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/reports?report_id=eq.${encodeURIComponent(id)}&select=data`, { headers: getAuthHeaders() });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows.length ? rows[0].data : null;
}
function sameReportContent(a, b) {
  return JSON.stringify([a.reportData, a.quote || null, a.client, a.address]) === JSON.stringify([b.reportData, b.quote || null, b.client, b.address]);
}

// The account's newer copy takes the report's place. This phone's version,
// if it differs, is saved as a separate job, tagged "Copy from this phone"
// on its Jobs card.
async function keepBothCopies(local) {
  const cloud = await cloudReportOf(local.id);
  if (!cloud) return false;
  const reports = getSavedReports();
  const i = reports.findIndex(r => r.id === local.id);
  const fresh = Object.assign({}, cloud, { cloudSavedAt: cloud.savedAt });
  if (i >= 0) reports[i] = fresh; else reports.unshift(fresh);
  let copy = null;
  if (!sameReportContent(local, cloud)) {
    copy = Object.assign({}, local, { id: 'report_' + Date.now(), cloudSavedAt: 0, conflictCopy: true, savedAt: Date.now() });
    if (copy.quote) copy.quote = Object.assign({}, copy.quote, { reportKey: copy.id });
    reports.unshift(copy);
  }
  if (!setSavedReports(reports)) return false;
  // The quote list keeps its own copy of each quote, newest wins. This
  // phone's quote goes with this phone's copy; the report takes the other
  // device's quote.
  if (typeof quotesStorageKey === 'function') {
    try {
      const quotes = JSON.parse(localStorage.getItem(quotesStorageKey()) || '{}');
      if (copy && copy.quote) quotes[copy.id] = copy.quote;
      if (cloud.quote) quotes[local.id] = cloud.quote; else delete quotes[local.id];
      localStorage.setItem(quotesStorageKey(), JSON.stringify(quotes));
    } catch (e) {}
  }
  if (currentReportId === local.id) loadReport(local.id, true);
  refreshJobsList();
  showToast(copy
    ? "This report was changed on another device, so that version is open now. This phone's version is saved beside it as a copy"
    : 'Updated this report with the newer copy from your other device', 'info');
  return copy ? supabaseSave(copy, true) : true;
}

async function supabaseSyncOnOpen() {
  if (!authSession) return;
  await flushPendingDeletes();
  const deleting = new Set(getPendingDeletes().map(d => d.id));
  const archived = new Set(getArchivedReportIds());
  const cloudReports = (await supabaseLoadAll() || []).filter(c => c && !deleting.has(c.id) && !archived.has(c.id));
  if (cloudReports.length === 0) return;
  const local = getSavedReports();
  const byId = new Map(local.map(r => [r.id, r]));
  const newFromCloud = [], newer = [], clashes = [];
  cloudReports.forEach(c => {
    if (!c || !c.id) return;
    const mine = byId.get(c.id);
    if (!mine) newFromCloud.push(Object.assign({}, c, { cloudSavedAt: c.savedAt }));
    else if ((c.savedAt || 0) > cloudBaseOf(mine) && (c.savedAt || 0) !== mine.savedAt) {
      (hasUnsyncedChanges(mine) ? clashes : newer).push(c);
    }
  });
  newer.forEach(c => byId.set(c.id, Object.assign({}, c, { cloudSavedAt: c.savedAt })));
  if (newFromCloud.length || newer.length) {
    const merged = [...newFromCloud, ...byId.values()].sort((a,b) => (b.savedAt||0) - (a.savedAt||0));
    if (setSavedReports(merged)) {
      const open = newer.find(c => c.id === currentReportId);
      if (open && reportSig() === lastReportSig) loadReport(open.id, true);
      refreshJobsList();
      const parts = [];
      if (newFromCloud.length) parts.push(`restored ${newFromCloud.length} report${newFromCloud.length > 1 ? 's' : ''}`);
      if (newer.length) parts.push(`updated ${newer.length} with newer changes`);
      showToast(`From your account: ${parts.join(', ')}`, 'info');
    }
  }
  for (const c of clashes) await keepBothCopies(byId.get(c.id));
}

// A report saved on this phone that the account doesn't have yet: saved
// with no signal, or while the account refused it. cloudSavedAt is 0 until
// the first save lands and null on reports from before it was recorded.
function notInAccount(entry) {
  return !!entry && !isSampleJob(entry) && entry.cloudSavedAt != null && (entry.savedAt || 0) > entry.cloudSavedAt;
}
// As the Jobs card tags it: signed in, the account doesn't hold this save,
// and it isn't on its way there right now.
function leftOffAccount(entry) {
  return !!authSession && notInAccount(entry) && !reportSaveChains.has(entry.id);
}
function inAccount(entry) {
  return !!entry && !isSampleJob(entry) && entry.cloudSavedAt != null && entry.cloudSavedAt >= (entry.savedAt || 0);
}
// Those reports go up the next time the app is online and in front, so a
// job finished in a subfloor is never left only on the phone.
let pushUnsyncedRunning = false;
async function pushUnsyncedReports() {
  if (!authSession || !navigator.onLine || pushUnsyncedRunning) return;
  pushUnsyncedRunning = true;
  try {
    const waiting = getSavedReports().filter(r => r && r.reportData && notInAccount(r));
    let landed = 0;
    for (const r of waiting) { if (await supabaseSave(r, true)) landed++; }
    if (landed) { refreshJobsList(); updateSyncStatus(); }
  } catch (e) { console.warn('pushUnsyncedReports:', e); }
  finally { pushUnsyncedRunning = false; }
}

// saveDraft() is called on nearly every keystroke and on every signature
// stroke, so it's debounced into a single write a short delay after the
// last call rather than writing to localStorage on every individual event.
// flushDraftSave() does the real work and is also called directly when the
// page is about to be hidden/closed, so a debounce in progress is never
// lost if the technician backgrounds or closes the app mid-edit.
let saveDraftTimer = null;
let saveDraftFailureNotified = false;
const SAVE_DRAFT_DEBOUNCE_MS = 400;

function saveDraft() {
  if (saveDraftTimer) clearTimeout(saveDraftTimer);
  saveDraftTimer = setTimeout(flushDraftSave, SAVE_DRAFT_DEBOUNCE_MS);
}

function flushDraftSave() {
  if (saveDraftTimer) { clearTimeout(saveDraftTimer); saveDraftTimer = null; }
  try {
    const draft = {
      jobAddress: document.getElementById('jobAddress').value,
      jobSuburb: document.getElementById('jobSuburb').value,
      jobState: document.getElementById('jobState').value,
      jobPostcode: document.getElementById('jobPostcode').value,
      jobClient: document.getElementById('jobClient').value,
      jobInspector: document.getElementById('jobInspector').value,
      reportData: { ...reportData },
      fieldNotes: { ...fieldNotes },
      currentReportId,
      // Words dictated but not filled in yet, so a reload (an app update,
      // or the phone closing the app) doesn't lose them.
      transcript: currentTranscript || '',
      savedAt: Date.now(),
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    saveDraftFailureNotified = false; // a later successful save clears the throttle
    lastLocalSaveAt = Date.now();
    updateSyncStatus('saved');
    scheduleReportAutosave();
  } catch (e) {
    // Previously a silent fail. Now surfaced once per failure episode so the
    // technician knows in-progress work (including a just-captured signature)
    // may not be persisting, without spamming a toast on every keystroke.
    if (!saveDraftFailureNotified) {
      saveDraftFailureNotified = true;
      showToast('Could not save your progress. The phone\'s storage may be full', 'error');
    }
    updateSyncStatus('error');
  }
}

// ── SYNC / SAVE STATUS INDICATOR ────────────────────────────────────────
// A technician working in a subfloor, basement, or a regional job with no
// signal needs to see their work is safe on-device even when it hasn't (or
// can't yet) reach the cloud — this makes that state visible instead of
// leaving them guessing whether "Save Report" actually did anything.
let lastLocalSaveAt = null;

function updateSyncStatus(state) {
  const el = document.getElementById('syncStatus');
  const textEl = document.getElementById('syncStatusText');
  if (!el || !textEl) return;
  el.classList.remove('saved', 'offline', 'error');

  // The sample never goes to the account, so it never says it's syncing.
  if (isSampleJob(currentReportId) && state !== 'error') {
    el.classList.add('saved');
    textEl.textContent = 'Sample job: kept on this phone only';
    return;
  }
  if (!navigator.onLine) {
    el.classList.add('offline');
    textEl.textContent = lastLocalSaveAt
      ? 'Saved on this phone. It syncs when you\'re back online'
      : 'Offline, so saving to this phone only';
    return;
  }
  if (state === 'error') {
    el.classList.add('error');
    textEl.textContent = 'Could not save. Check the phone\'s storage';
    return;
  }
  if (state === 'cloud_error') {
    el.classList.add('error');
    textEl.textContent = 'Saved on this phone, but not synced to your account';
    return;
  }
  if (state === 'saved' || lastLocalSaveAt) {
    el.classList.add('saved');
    // A job with no address yet is only a draft on the phone.
    const street = (document.getElementById('jobAddress') || {}).value;
    textEl.textContent = !(street || '').trim() ? 'Kept on this phone until the address is in'
      : (typeof authSession !== 'undefined' && authSession)
      ? 'Saved & syncing to your account'
      : 'Saved on this device';
    return;
  }
  textEl.textContent = 'Not saved yet';
}

window.addEventListener('online', () => { updateSyncStatus(); processPendingNotes(); pushUnsyncedReports(); });
window.addEventListener('offline', () => updateSyncStatus());

// Make sure a pending debounced save is never lost if the app is backgrounded
// or closed before the debounce timer would otherwise have fired.
// Coming back to the app: the sign-in may have expired while the phone
// slept, so refresh it before anything talks to the server.
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) {
    saveBeforeLeaving();
    if (updateReloadPending && !isRecording && !document.body.classList.contains('ai-busy') && !formSheetOpen()) location.reload();
    return;
  }
  // An app left open for days never navigates, so ask for a new version here.
  if (swRegistration) swRegistration.update().catch(() => {});
  await maybeRefreshAuthSession();
  processPendingNotes();
  pushUnsyncedReports();
  checkAddressMove();
  // A client may have signed or answered while the phone was away.
  if (!isRecording) checkLinksOut();
});
window.addEventListener('pagehide', saveBeforeLeaving);
window.addEventListener('beforeunload', saveBeforeLeaving);

// The app is being put away, closed or reloaded: everything still waiting
// to be saved is saved now. A box being typed in is let go first, so the
// ones that save when you leave them (Your prices, say) save too.
function saveBeforeLeaving() {
  const el = document.activeElement;
  if (el && el.matches('input, textarea')) el.blur();
  flushDraftSave();
  if (typeof flushQuoteSave === 'function') flushQuoteSave();
  if (typeof keepUnsavedSheet === 'function') keepUnsavedSheet();
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return false;
    const draft = JSON.parse(raw);

    if (draft.transcript && !currentTranscript) {
      currentTranscript = draft.transcript;
      const box = document.getElementById('transcriptBox');
      if (box) { box.textContent = currentTranscript; box.classList.add('active'); }
      const btn = document.getElementById('extractBtn');
      if (btn) btn.disabled = false;
    }

    // Don't restore empty drafts
    if (!draft.reportData || Object.keys(draft.reportData).length === 0) {
      if (!draft.jobAddress && !draft.jobClient) return false;
    }

    document.getElementById('jobAddress').value = draft.jobAddress || '';
    document.getElementById('jobSuburb').value = draft.jobSuburb || '';
    document.getElementById('jobState').value = draft.jobState || '';
    document.getElementById('jobPostcode').value = draft.jobPostcode || '';
    document.getElementById('jobClient').value = draft.jobClient || '';
    document.getElementById('jobInspector').value = draft.jobInspector || '';

    reportData = { ...draft.reportData };
    upgradeRenamedChoices(reportData);
    fieldNotes = { ...(draft.fieldNotes || {}) };
    currentReportId = draft.currentReportId || null;
    // After the job's own data is back: the Last visit check skips the open
    // job, so done before, it offered the job's own saved copy as an earlier
    // inspection ("Inspected here before" on today's job).
    updateJob();
    externalizePhotos(reportData).then(changed => { if (changed) saveDraft(); });

    Object.keys(reportData).forEach(key => {
      const el = document.getElementById('f-' + key);
      if (el) renderField(el, key, reportData[key]);
    });

    restoreFieldNotes();

    const sel = document.getElementById('standardSelect');
    if (sel && reportData.standard) sel.value = reportData.standard;

    updateProgress();
    checkAsbestosFlag();
    checkFindingsGate();
    checkSystemVerify();
    checkSecondaryColonyFlag();
    ensureTreatmentForLiveTermites();
    restoreSignaturePads(); restoreLicenceField();
    renderReportWidgets();
    renderFindingsUI();

    // FIX: this was a third independent copy of the same plain-presence
    // check already found to overcount the Findings section elsewhere
    // (see isFieldFilled) - sharing it here too so reopening a draft can't
    // land on the wrong tab for the same reason.
    let bestSection = 'property', bestCount = -1;
    Object.entries(SECTIONS).forEach(([sec, cfg]) => {
      const count = cfg.fields.filter(k => isFieldFilled(k)).length;
      if (count > bestCount) { bestCount = count; bestSection = sec; }
    });
    goStep(stepOf(bestSection).id);

    return true;
  } catch (e) {
    console.error('Failed to load draft', e);
    reportError(e, 'load_draft');
    return false;
  }
}

function clearDraft() {
  if (saveDraftTimer) { clearTimeout(saveDraftTimer); saveDraftTimer = null; }
  try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
}

function getSavedReports() {
  try {
    const raw = localStorage.getItem(reportsStorageKey());
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Failed to read saved reports', e);
    reportError(e, 'read_saved_reports');
    return [];
  }
}

function setSavedReports(reports, retrying) {
  try {
    localStorage.setItem(reportsStorageKey(), JSON.stringify(reports));
    return true;
  } catch (e) {
    console.error('Failed to save reports', e);
    reportError(e, 'save_reports');
    // Full phone: older jobs already in the account can leave the phone to
    // make room, then this save is tried once more.
    if (isQuotaError(e) && !retrying && freeStorageFor(reports)) return setSavedReports(reports, true);
    showToast(isQuotaError(e)
      ? 'Could not save. This phone\'s storage is full. Back up from Menu › Settings › Your data, then delete old jobs'
      : 'Could not save. Storage is full or unavailable', 'error');
    return false;
  }
}

function isQuotaError(e) {
  return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014 || /quota/i.test(String(e.message || '')));
}
function photoStoreProblem(e) {
  return isQuotaError(e) ? 'This phone\'s storage is full. Free some space or remove old jobs, then add the photo again' : 'Could not process photo';
}

// ── OLDER JOBS KEPT IN THE ACCOUNT ONLY ───────────────────────────────────
// When the phone is full, finished jobs that the account already holds are
// taken off the phone (their ids kept here, so the next sync doesn't bring
// them straight back). Bring them back clears the list and syncs again.
function archivedReportsKey() {
  return (authUser && authUser.id) ? `korva_archived_reports_${authUser.id}` : 'korva_archived_reports';
}
function getArchivedReportIds() {
  try { const v = JSON.parse(localStorage.getItem(archivedReportsKey()) || '[]'); return Array.isArray(v) ? v : []; }
  catch (e) { return []; }
}
function setArchivedReportIds(ids) {
  try { if (ids.length) localStorage.setItem(archivedReportsKey(), JSON.stringify(ids)); else localStorage.removeItem(archivedReportsKey()); } catch (e) {}
}
// Takes the oldest finished, backed-up jobs out of `reports` (in place)
// after the inspector agrees. Returns true when something was removed.
function freeStorageFor(reports) {
  if (!authSession) return false;
  const candidates = reports
    .filter(r => r && r.id !== currentReportId && r.reportData && r.reportData.issue && inAccount(r))
    .sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
  if (!candidates.length) return false;
  const n = Math.max(1, Math.ceil(candidates.length / 2));
  const going = candidates.slice(0, n);
  const ok = confirm(`This phone's storage is full. Take the ${n === 1 ? 'oldest finished job' : `${n} oldest finished jobs`} off this phone? ${n === 1 ? 'It stays' : 'They stay'} in your account and can be brought back from Jobs, under Done.`);
  if (!ok) return false;
  const ids = new Set(going.map(r => r.id));
  for (let i = reports.length - 1; i >= 0; i--) if (ids.has(reports[i].id)) reports.splice(i, 1);
  setArchivedReportIds([...new Set([...getArchivedReportIds(), ...ids])]);
  showToast(`${n} older job${n === 1 ? '' : 's'} now kept in your account only`, 'info');
  return true;
}
async function restoreArchivedReports() {
  if (!navigator.onLine) { showToast('No signal. Try again when you have one', 'error'); return; }
  setArchivedReportIds([]);
  await supabaseSyncOnOpen();
  refreshJobsList();
}

// How far along the open report is, as the Jobs list and the job's page
// show it: the same number as the ring on the report (reportProgress in
// js/app/dashboard.js), so the two never disagree.
function calculateCompletion() {
  return reportProgress().pct;
}

// The job's fee. Job details and the agreement share one field
// (reportData.jobFee); reports saved before that may hold it only on the
// signed agreement.
function jobFeeOf(data) {
  if (!data) return '';
  return String(data.jobFee || (data.agreement && data.agreement.fee) || '').trim();
}

// FIX: a plain "is this key present" check silently overcounted the
// Findings section. getFindings() (called during routine UI renders, not
// just user action) lazily creates a placeholder finding object with
// termiteActivity:null the first time anything reads the findings list -
// so reportData.findings was non-null/non-undefined on almost every report
// from the moment the page rendered once, even with zero real data
// recorded, and the progress bar silently counted that section as "done".
// Centralising the "filled" check here (rather than a one-off inline
// special case) also makes it the obvious place to extend if another
// field ever needs more than a bare presence check.
function isFieldFilled(key) {
  // Answered from the areas in Section 4 (see hinderedAnswer).
  if (key === 'hinderedAreas') return !!hinderedAnswer();
  if (reportData[key] === undefined || reportData[key] === null) return false;
  // An answer typed and then cleared (the licence number) is blank again.
  if (typeof reportData[key] === 'string' && !reportData[key].trim()) return false;
  if (key === 'findings') {
    return Array.isArray(reportData.findings) &&
      reportData.findings.some(f => f && (f.termiteActivity || f.species || f.damageDescription || f.activityLocation));
  }
  if (key === 'areaStatus') {
    // Every area needs a status (Inspected / Not inspected / Not applicable).
    return Object.keys(OBS_ZONES).every(z => areaStatusOf(z));
  }
  if (key === 'standard') {
    // resetReportState()/loadReport() force reportData.standard to
    // 'AS 3660.2-2017' before the technician has touched anything, so its
    // bare presence isn't evidence of real progress - every brand-new report
    // would otherwise show a few % complete and "In progress" on Property
    // before a single field is entered. Only count it once they've actually
    // picked a different standard, since that's the only signal we have
    // that this field was deliberately engaged with.
    return reportData.standard !== 'AS 3660.2-2017';
  }
  return true;
}

// quiet: no toast, for saves the app makes on its own (see processPendingNotes)
// A report with an address saves itself to the Jobs list (and the
// account) a few seconds after each change, so nobody has to dig through
// the menu for Save Report. reportSig() spots when nothing has changed, so
// opening a report or the save's own draft write doesn't save it again.
const REPORT_AUTOSAVE_MS = 4000;
let reportAutosaveTimer = null, lastReportSig = null;
// Which saved report each open report object was saved as.
const savedIdFor = new WeakMap();

// The open report is otherwise saved a few seconds after the last change.
// Opening another job, starting a new one or signing out saves it first,
// so those last few seconds of work (and their photos) aren't dropped.
function saveOpenReportNow() {
  flushDraftSave();
  if (reportAutosaveTimer) { clearTimeout(reportAutosaveTimer); reportAutosaveTimer = null; }
  if (document.getElementById('jobAddress').value.trim() && reportSig() !== lastReportSig) saveCurrentReport(true);
}
function reportSig() {
  return JSON.stringify([JOB_SUMMARY_FIELDS.map(id => (document.getElementById(id) || {}).value || ''), reportData, fieldNotes]);
}
function scheduleReportAutosave() {
  if (reportAutosaveTimer) clearTimeout(reportAutosaveTimer);
  reportAutosaveTimer = setTimeout(() => {
    reportAutosaveTimer = null;
    if (!document.getElementById('jobAddress').value.trim() || reportSig() === lastReportSig) return;
    saveCurrentReport(true);
  }, REPORT_AUTOSAVE_MS);
}

function saveCurrentReport(quiet) {
  const street = document.getElementById('jobAddress').value.trim();
  if (!street) {
    showToast('Enter a property address before saving', 'error');
    document.getElementById('jobAddress').focus();
    return;
  }

  const reports = getSavedReports();
  const id = currentReportId || ('report_' + Date.now());
  const prev = reports.find(r => r.id === id);
  // A quote started before the report was first saved moves to its new id.
  if (!currentReportId) adoptDraftQuote(id, getFullAddress());

  const entry = {
    id,
    address: getFullAddress(),
    jobAddress: street,
    jobSuburb: document.getElementById('jobSuburb').value.trim(),
    jobState: document.getElementById('jobState').value.trim(),
    jobPostcode: document.getElementById('jobPostcode').value.trim(),
    client: document.getElementById('jobClient').value.trim(),
    inspector: document.getElementById('jobInspector').value.trim(),
    reportData: { ...reportData },
    fieldNotes: { ...fieldNotes },
    savedAt: Date.now(),
    // The account copy this one was built on (see supabaseSave).
    cloudSavedAt: prev ? cloudBaseOf(prev) : 0,
    completion: calculateCompletion(),
  };
  // The quote rides along in the saved report, so it syncs to the account
  // with it (see the quote builder in js/quote.js).
  const quote = quoteForReport(id, entry.address);
  if (quote) entry.quote = quote;
  // This phone's side of a sync clash keeps its tag, so the two jobs for
  // one address can be told apart until one is deleted.
  if (prev && prev.conflictCopy) entry.conflictCopy = true;

  const existingIndex = reports.findIndex(r => r.id === id);
  if (existingIndex >= 0) {
    reports[existingIndex] = entry;
  } else {
    reports.unshift(entry);
  }

  if (setSavedReports(reports)) {
    currentReportId = id;
    savedIdFor.set(reportData, id);
    lastReportSig = reportSig();
    if (!quiet) showToast('Report saved', 'success');
    refreshJobsList();
    saveDraft();
    lastLocalSaveAt = Date.now();
    updateSyncStatus('saved');
    supabaseSave(entry); // background cloud sync — non-blocking
    return true;
  }
}

function loadReport(id, quiet) {
  // Saved first even when reopening the same job: what was done in the last
  // few seconds (a signed agreement) would otherwise be lost on the reload.
  saveOpenReportNow();
  if (id !== currentReportId) {
    // A report with no address yet is never saved, so it's dropped here,
    // and so is the quote made for it.
    if (!currentReportId && typeof forgetDraftQuote === 'function') forgetDraftQuote();
    clearFilledNotes();
  }
  const reports = getSavedReports();
  const entry = reports.find(r => r.id === id);
  if (!entry) return;

  // Reset current state
  resetReportState();

  // Restore job fields
  document.getElementById('jobAddress').value = entry.jobAddress || entry.address || '';
  document.getElementById('jobSuburb').value = entry.jobSuburb || '';
  document.getElementById('jobState').value = entry.jobState || '';
  document.getElementById('jobPostcode').value = entry.jobPostcode || '';
  document.getElementById('jobClient').value = entry.client || '';
  document.getElementById('jobInspector').value = entry.inspector || '';

  // Restore report data
  reportData = { ...entry.reportData };
  upgradeRenamedChoices(reportData);
  fieldNotes = { ...(entry.fieldNotes || {}) };
  currentReportId = entry.id;
  savedIdFor.set(reportData, entry.id);
  updateJob(); // once it's this job (see loadDraft)
  externalizePhotos(reportData).then(changed => { if (changed) saveDraft(); });

  // Re-render all fields
  Object.keys(reportData).forEach(key => {
    const el = document.getElementById('f-' + key);
    if (el) renderField(el, key, reportData[key]);
  });

  restoreFieldNotes();

  const sel = document.getElementById('standardSelect');
  if (sel) sel.value = reportData.standard || 'AS 3660.2-2017';
  if (!reportData.standard) setStandard('AS 3660.2-2017');

  updateProgress();
  checkAsbestosFlag();
  checkFindingsGate();
  checkSystemVerify();
  checkSecondaryColonyFlag();
  ensureTreatmentForLiveTermites();
  restoreSignaturePads(); restoreLicenceField();
  loadJobInfo();
  renderReportWidgets();

  // Reveal the section with the most data, default to property
  let bestSection = 'property', bestCount = -1;
  Object.entries(SECTIONS).forEach(([sec, cfg]) => {
    const count = cfg.fields.filter(k => isFieldFilled(k)).length;
    if (count > bestCount) { bestCount = count; bestSection = sec; }
  });
  goStep(stepOf(bestSection).id);
  lastReportSig = reportSig();
  saveDraft();

  if (!quiet) showToast(`Loaded: ${entry.address}`, 'info');
  processPendingNotes();
  if (document.getElementById('sidebarPanel').classList.contains('open')) {
    toggleDrawer();
  }
}

// Deleting a job takes it off the phone at once and offers Undo. The
// account copy and its photos go a few seconds later, once Undo has passed.
// Deletes waiting for the account (no signal, or the app closed first) are
// listed, so they're finished on the next open instead of coming back.
const DELETE_UNDO_MS = 6500;
const deleteTimers = {};
function pendingDeletesKey() {
  return (authUser && authUser.id) ? `korva_pending_deletes_${authUser.id}` : 'korva_pending_deletes';
}
function getPendingDeletes() {
  try { const v = JSON.parse(localStorage.getItem(pendingDeletesKey()) || '[]'); return Array.isArray(v) ? v : []; }
  catch (e) { return []; }
}
function setPendingDeletes(list) {
  try { localStorage.setItem(pendingDeletesKey(), JSON.stringify(list)); } catch (e) {}
}
async function finishDelete(item) {
  delete deleteTimers[item.id];
  const keep = referencedPhotoIds();
  const paths = (item.paths || []).filter((path, i) => !keep.has((item.photoIds || [])[i]));
  if (paths.length) deleteCloudPhotos(paths);
  if (!authSession || isSampleJob(item.id) || await supabaseDelete(item.id)) setPendingDeletes(getPendingDeletes().filter(d => d.id !== item.id));
}
async function flushPendingDeletes() {
  for (const item of getPendingDeletes()) {
    if (!deleteTimers[item.id]) await finishDelete(item);
  }
}

function deleteReport(id, event) {
  if (event) event.stopPropagation();
  const all = getSavedReports();
  const index = all.findIndex(r => r.id === id);
  const deleted = all[index];
  if (!deleted) return;
  // Always asked: the delete button sits beside the row's tap target, and
  // the account copy goes with it.
  const where = deleted.address || 'this property';
  const finished = deleted.reportData && deleted.reportData.issue;
  const extra = notInAccount(deleted) ? ' It isn\'t in your account yet, so it can\'t be brought back.' : '';
  if (!confirm(`Delete the ${finished ? 'finished job' : 'job'} at ${where}? Its report, quote and photos go too.${extra}`)) return;
  if (!setSavedReports(all.filter(r => r.id !== id))) return;
  const wasOpen = currentReportId === id;
  if (wasOpen) startBlankReport();
  refreshJobsList();

  const photos = allReportPhotos(deleted.reportData).filter(p => p.path);
  const item = { id, paths: photos.map(p => p.path), photoIds: photos.map(p => p.id) };
  setPendingDeletes([...getPendingDeletes().filter(d => d.id !== id), item]);
  deleteTimers[id] = setTimeout(() => finishDelete(item), DELETE_UNDO_MS);

  showToast('Job deleted', 'info', { label: 'Undo', run: () => {
    clearTimeout(deleteTimers[id]);
    delete deleteTimers[id];
    setPendingDeletes(getPendingDeletes().filter(d => d.id !== id));
    const reports = getSavedReports();
    if (!reports.some(r => r.id === id)) reports.splice(Math.min(index, reports.length), 0, deleted);
    setSavedReports(reports);
    if (wasOpen) loadReport(id, true);
    refreshJobsList();
    showToast('Job restored', 'success');
  } });
}

// Every saved job goes the way one does in deleteReport: off the list now,
// out of the account and photo store once the undo window closes.
function deleteAllReports() {
  const all = getSavedReports();
  if (!all.length) { showToast('There are no saved jobs to delete', 'info'); return; }
  const n = all.length === 1 ? '1 saved job' : `all ${all.length} saved jobs`;
  if (!confirm(`Delete ${n}? Their reports, quotes and photos go from this phone and your account. Your account, business details and prices stay.`)) return;
  if (!setSavedReports([])) return;
  const wasOpen = all.some(r => r.id === currentReportId) ? currentReportId : null;
  startBlankReport();
  refreshJobsList();

  const items = all.map(r => {
    const photos = allReportPhotos(r.reportData).filter(p => p.path);
    return { id: r.id, paths: photos.map(p => p.path), photoIds: photos.map(p => p.id) };
  });
  const ids = new Set(items.map(i => i.id));
  setPendingDeletes([...getPendingDeletes().filter(d => !ids.has(d.id)), ...items]);
  items.forEach(item => { deleteTimers[item.id] = setTimeout(() => finishDelete(item), DELETE_UNDO_MS); });

  showToast(all.length === 1 ? 'Job deleted' : `${all.length} jobs deleted`, 'info', { label: 'Undo', run: () => {
    items.forEach(item => { clearTimeout(deleteTimers[item.id]); delete deleteTimers[item.id]; });
    setPendingDeletes(getPendingDeletes().filter(d => !ids.has(d.id)));
    const kept = getSavedReports();
    setSavedReports([...all, ...kept.filter(r => !ids.has(r.id))]);
    if (wasOpen) loadReport(wasOpen, true);
    refreshJobsList();
    showToast('Jobs restored', 'success');
  } });
}

// ══════════════════════════════════════════════════════════════════════════
// DATA EXPORT / IMPORT
// ══════════════════════════════════════════════════════════════════════════
// Settings a backup carries. The sign-in, company details and the photo
// store's bookkeeping stay out: the company comes back from the account,
// and a backup must never hold a sign-in someone else could use.
const BACKUP_PREF_KEYS = ['korva_a11y_textsize', 'korva_a11y_contrast', 'korva_a11y_touch',
  'korva_a11y_motion', 'korva_a11y_colorvision', 'korva_audio_capture_enabled', 'korva_telemetry_off'];

async function exportAllData() {
  try {
    const reports = getSavedReports().filter(r => !isSampleJob(r));
    const prefs = {};
    BACKUP_PREF_KEYS.forEach(key => {
      const v = localStorage.getItem(key);
      if (v !== null) prefs[key] = v;
    });

    // Photos aren't in localStorage, so add each saved report's images.
    const photos = {};
    for (const r of reports) {
      for (const p of allReportPhotos(r.reportData)) {
        if (photos[p.id]) continue;
        const blob = await getPhotoImage(p);
        if (blob) photos[p.id] = await blobToDataUrl(blob);
      }
    }

    const backup = { app: 'SAYON', exportedAt: new Date().toISOString(), version: 2, reports, prefs, photos };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `sayon_backup_${todayIsoDate()}.json`);

    showToast(`Downloaded a copy of ${reports.length} saved report${reports.length === 1 ? '' : 's'} and your settings`, 'success');
  } catch (e) {
    console.error('Export failed', e);
    reportError(e, 'export');
    showToast("Couldn't download a copy. Try again", 'error');
  }
}

// The reports in a backup. Version 2 lists them; version 1 copied every
// korva_ key, so its reports sit under whichever account's key it was made on.
function backupReports(backup) {
  if (Array.isArray(backup.reports)) return backup.reports;
  const data = backup.data || {};
  const found = [];
  Object.keys(data).forEach(key => {
    if (!/^(korva_saved_reports(_.+)?|termiteai_saved_reports)$/.test(key)) return;
    try { const list = JSON.parse(data[key] || '[]'); if (Array.isArray(list)) found.push(...list); } catch (e) {}
  });
  return found;
}

// Adds a backup's reports to the phone's. Where both have the same report,
// the newer copy is kept, so a restore never undoes later work.
function mergeBackupReports(existing, incoming) {
  const byId = new Map(existing.map(r => [r.id, r]));
  let added = 0, updated = 0;
  incoming.forEach(r => {
    if (!r || !r.id || !r.reportData) return;
    const mine = byId.get(r.id);
    if (!mine) { byId.set(r.id, r); added++; }
    else if ((r.savedAt || 0) > (mine.savedAt || 0)) { byId.set(r.id, r); updated++; }
  });
  return { reports: [...byId.values()], added, updated };
}

function importAllData(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    let backup;
    try {
      backup = JSON.parse(e.target.result);
    } catch (err) {
      showToast('Could not read that file. Choose a SAYON backup', 'error');
      return;
    }

    if (!backup || typeof backup !== 'object' || !(backup.data || backup.reports) || !['SAYON','KORVUS'].includes(backup.app)) {
      showToast('That doesn\'t look like a SAYON backup file', 'error');
      return;
    }

    const incoming = backupReports(backup);
    const existing = getSavedReports();
    if (existing.length && !confirm(
      `This copy has ${incoming.length} report${incoming.length === 1 ? '' : 's'}. ` +
      `You have ${existing.length} on this phone.\n\n` +
      `Add the copy's reports to yours? Nothing on this phone is removed, and where both have the same report the newer one is kept.`
    )) return;

    try {
      const { reports, added, updated } = mergeBackupReports(existing, incoming);
      if (!setSavedReports(reports)) return;
      Object.entries(backup.photos || {}).forEach(([id, dataUrl]) => {
        const blob = dataUrlToBlob(dataUrl);
        if (blob) putPhotoBlob(id, blob).catch(() => {});
      });
      // Restored reports go to the account too, so they're on every device.
      reports.filter(r => incoming.some(i => i && i.id === r.id && i.savedAt === r.savedAt)).forEach(r => supabaseSave(r));

      // Settings only, from the allow-list. Never the sign-in or the draft.
      const prefs = backup.prefs || backup.data || {};
      BACKUP_PREF_KEYS.forEach(key => {
        if (typeof prefs[key] === 'string') { try { localStorage.setItem(key, prefs[key]); } catch (err) {} }
      });

      refreshJobsList();
      restoreA11ySettings();
      restoreAudioCaptureSetting();
      restoreTelemetrySetting();
      const parts = [];
      if (added) parts.push(`${added} added`);
      if (updated) parts.push(`${updated} updated`);
      showToast(parts.length ? `Restored from the copy: ${parts.join(', ')}` : 'Your reports were already up to date', 'success');
    } catch (err) {
      console.error('Import failed', err);
      reportError(err, 'import');
      showToast("Couldn't restore that copy. Check it's a SAYON download", 'error');
    }
  };

  reader.onerror = () => showToast('Could not read that file', 'error');
  reader.readAsText(file);

  // Reset the file input so the same file can be re-selected later if needed
  document.getElementById('importFileInput').value = '';
}

// ══════════════════════════════════════════════════════════════════════════
// ACCESSIBILITY SETTINGS
// ══════════════════════════════════════════════════════════════════════════
function setTextSize(size) {
  // Every piece of text takes its new size at once, with nothing easing
  // (text-size-switching in app.css). Otherwise, in Chrome, text that had
  // eased before (a report answer once filled in) eased to its old size and
  // stayed there until something else redrew it.
  document.body.classList.add('text-size-switching');
  document.body.classList.remove('text-size-large', 'text-size-xl');
  if (size === 'large') document.body.classList.add('text-size-large');
  if (size === 'xl') document.body.classList.add('text-size-xl');
  document.querySelectorAll('body *').forEach(el => getComputedStyle(el).fontSize);
  requestAnimationFrame(() => document.body.classList.remove('text-size-switching'));

  document.querySelectorAll('#textSizeControl .text-size-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.size === size);
  });

  try { localStorage.setItem('korva_a11y_textsize', size); } catch (e) {}
}

function toggleA11y(className, btnId, storageKey) {
  const on = document.body.classList.toggle(className);
  const btn = document.getElementById(btnId);
  if (btn) btn.classList.toggle('on', on);
  try { localStorage.setItem(storageKey, on ? '1' : '0'); } catch (e) {}
}

// Red-green colour blindness (protanopia, deuteranopia): SAYON's own blue
// already stays apart from the red, amber and green, so those keep it (the
// lighter blue they used to set put white text on buttons at 2.4:1).
// Blue-yellow (tritanopia): magenta instead, each shade as dark as the blue
// it stands in for, so white text on it reads as well.
const COLOUR_VISION_ACCENTS = {
  tritanopia: { accent: '#DB0093', accent2: '#AD0074', accent3: '#7A0052', rgb: '219,0,147' },
};

function setColourVisionMode(mode) {
  const colours = COLOUR_VISION_ACCENTS[mode];
  const root = document.documentElement.style;
  // The default blue lives in the stylesheet (light and dark differ), so
  // "none" clears the override rather than setting a colour of its own.
  if (!colours) ['--accent', '--accent2', '--accent3', '--accent-rgb'].forEach(k => root.removeProperty(k));
  else {
    root.setProperty('--accent', colours.accent);
    root.setProperty('--accent2', colours.accent2);
    root.setProperty('--accent3', colours.accent3);
    root.setProperty('--accent-rgb', colours.rgb);
  }
  try { localStorage.setItem('korva_a11y_colorvision', mode); } catch (e) {}
}

function restoreA11ySettings() {
  try {
    const textSize = localStorage.getItem('korva_a11y_textsize');
    if (textSize && textSize !== 'normal') setTextSize(textSize);

    if (localStorage.getItem('korva_a11y_contrast') === '1') {
      document.body.classList.add('high-contrast');
      document.getElementById('toggleHighContrast').classList.add('on');
    }
    if (localStorage.getItem('korva_a11y_touch') === '1') {
      document.body.classList.add('large-touch');
      document.getElementById('toggleLargeTouch').classList.add('on');
    }
    if (localStorage.getItem('korva_a11y_motion') === '1') {
      document.body.classList.add('reduce-motion');
      document.getElementById('toggleReduceMotion').classList.add('on');
    }
    const cvd = localStorage.getItem('korva_a11y_colorvision');
    if (cvd && cvd !== 'none') {
      setColourVisionMode(cvd);
      const sel = document.getElementById('colourVisionSelect');
      if (sel) sel.value = cvd;
    }
  } catch (e) {}
}

// A new job starts with the inspector's name and licence from the most
// recent saved report on this account, so the sign-off isn't retyped on
// every job.
function lastInspectorDetails() {
  const latest = getSavedReports()
    .filter(r => !isSampleJob(r) && (r.inspector || (r.reportData && r.reportData.inspectorLicence)))
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))[0];
  // No report yet: the signed-in person's own name is the best guess.
  const meta = (typeof authUser !== 'undefined' && authUser && authUser.user_metadata) || {};
  return {
    name: (latest ? latest.inspector || '' : '') || (meta.name || '').trim(),
    licence: latest && latest.reportData ? latest.reportData.inspectorLicence || '' : '',
  };
}

// quiet: the page that opens already says it's a new job.
function newReport(quiet) {
  saveOpenReportNow();
  track('report_started');
  startBlankReport();
  refreshDashboardIfOpen();
  if (!quiet) showToast('New report started', 'info');
}

// Empties the screen for a new job. Doesn't save the one that was open.
function startBlankReport() {
  // Before the reset, so the banners it redraws don't show the last job's
  // quote and certificate.
  if (!currentReportId && typeof forgetDraftQuote === 'function') forgetDraftQuote();
  clearFilledNotes();
  currentReportId = null;
  resetReportState();
  document.getElementById('jobAddress').value = '';
  document.getElementById('jobSuburb').value = '';
  document.getElementById('jobState').value = '';
  delete document.getElementById('jobState').dataset.auto;
  document.getElementById('jobPostcode').value = '';
  document.getElementById('jobClient').value = '';
  const lastInspector = lastInspectorDetails();
  document.getElementById('jobInspector').value = lastInspector.name;
  if (lastInspector.licence) reportData.inspectorLicence = lastInspector.licence;
  restoreLicenceField();
  // A new job is usually inspected the day it's started.
  reportData.jobInspectionDate = todayIsoDate();
  loadJobInfo();
  updateJob();
  clearDraft();
  lastReportSig = reportSig();
  showSection('property');
}

function resetReportState() {
  reportData = {};
  speechTimeline = [];
  setAI('ready', 'AI ready');
  fieldNotes = {};
  pendingSpeciesMatch = null;
  clearJobInfo();
  const confirm = document.getElementById('speciesConfirm');
  const intel = document.getElementById('speciesIntel');
  if (confirm) confirm.style.display = 'none';
  if (intel) intel.style.display = 'none';
  // Clear all field displays. Every field-val, not just the ones counted in
  // SECTIONS, so detail fields (leak location, borer details, etc.) don't
  // carry the previous report's text into the next one.
  document.querySelectorAll('.field-val[id^="f-"]').forEach(el => {
    const key = el.id.replace('f-', '');
    el.classList.remove('filled', 'flash');
    el.innerHTML = '—';
    // Remove edited-dot indicators
    const label = getFieldLabel(el);
    if (label) {
      const dot = label.querySelector('.edited-dot');
      if (dot) dot.remove();
    }
    // Clear notes
    const ta = document.getElementById('notes-text-' + key);
    if (ta) ta.value = '';
    const panel = document.getElementById('notes-' + key);
    if (panel) panel.classList.remove('open');
    updateNotesIndicator(key);
  });
  updateProgress();
  const banner = document.getElementById('asbestosBanner');
  if (banner) banner.style.display = 'none';
  checkFindingsGate();
  checkSystemVerify();
  checkSecondaryColonyFlag();
  ensureTreatmentForLiveTermites();
  if (inspectorSignaturePad) inspectorSignaturePad.clear();
  setInspectorSignatureStatus(false);
  renderAgreementBanner();
  renderReportWidgets();
  renderFindingsUI();
  setStandard('AS 3660.2-2017');
}
