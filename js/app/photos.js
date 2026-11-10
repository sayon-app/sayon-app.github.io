// SAYON app: Photo attachments, photo store, photo viewer, section photos, ready-made recommendations.
// One of the js/app/ files, which share one global scope: they load as plain
// scripts in the order index.html lists them, so a top-level name declared in
// any of them can be used from the others once the page has loaded.

// ── PHOTO ATTACHMENTS ────────────────────────────────────────────────────
// Every photo is resized and re-encoded as a compressed JPEG on the phone.
// The image itself lives outside reportData: as a Blob in IndexedDB on the
// device (works offline, far more room than localStorage) and, once the
// technician is signed in, as a file in the Supabase Storage bucket
// 'report-photos' at <user id>/<photo id>.jpg. reportData only carries each
// photo's metadata: { id, width, height, caption, path? } where path is set
// once the upload has succeeded, so another device (or the business owner)
// can download it. Older reports kept the image inline as p.dataUrl;
// externalizePhotos() moves those into IndexedDB the first time they're seen.
const MAX_PHOTOS_PER_REPORT = 100;
const PHOTO_MAX_DIMENSION = 1280;
const PHOTO_BUCKET = 'report-photos';

function genPhotoId() {
  return 'photo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

// Resizes/re-encodes a single File to a compressed JPEG Blob, returning
// {blob, width, height} so the PDF can preserve the correct aspect ratio
// later without needing to re-decode the image. opts lets a caller that
// sends the photo to the AI keep more detail (bigger, less squeezed).
function compressPhotoFile(file, opts = {}) {
  const maxDim = opts.maxDim || PHOTO_MAX_DIMENSION;
  const quality = opts.quality || 0.7;
  const maxBytes = opts.maxBytes || 225000;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not decode image'));
      img.onload = () => {
        let w = img.naturalWidth, h = img.naturalHeight;
        if (w > maxDim || h > maxDim) {
          if (w >= h) { h = Math.round(h * (maxDim / w)); w = maxDim; }
          else { w = Math.round(w * (maxDim / h)); h = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => {
          if (!blob) { reject(new Error('Could not encode image')); return; }
          // Re-compress harder if a particularly busy/detailed photo still came out large
          if (blob.size <= maxBytes) { resolve({ blob, width: w, height: h }); return; }
          canvas.toBlob(smaller => resolve({ blob: smaller || blob, width: w, height: h }), 'image/jpeg', 0.5);
        }, 'image/jpeg', quality);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ── Photo store (IndexedDB on the device, Supabase Storage in the cloud) ──
let photoDbPromise = null;
function photoDb() {
  if (!photoDbPromise) {
    photoDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('korvus-photos', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('photos');
      req.onsuccess = () => {
        const db = req.result;
        // iPhone can close the store while the app sleeps; the next use reopens it.
        db.onclose = () => { photoDbPromise = null; };
        db.onversionchange = () => { db.close(); photoDbPromise = null; };
        resolve(db);
      };
      req.onerror = () => { photoDbPromise = null; reject(req.error); };
    });
  }
  return photoDbPromise;
}

function photoStoreRequest(mode, fn, retried) {
  return photoDb().then(db => new Promise((resolve, reject) => {
    let tx;
    try { tx = db.transaction('photos', mode); }
    catch (e) {
      // A connection the phone closed throws here: reopen and try once more.
      photoDbPromise = null;
      if (!retried) { photoStoreRequest(mode, fn, true).then(resolve, reject); return; }
      reject(e); return;
    }
    const req = fn(tx.objectStore('photos'));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    // A full phone aborts the write instead of failing it.
    tx.onabort = () => reject(tx.error || new Error('Photo storage write was stopped'));
  }));
}
const putPhotoBlob    = (id, blob) => photoStoreRequest('readwrite', st => st.put(blob, id));
const getPhotoBlob    = (id) => photoStoreRequest('readonly', st => st.get(id));
const deletePhotoBlob = (id) => photoStoreRequest('readwrite', st => st.delete(id));
const listPhotoBlobIds = () => photoStoreRequest('readonly', st => st.getAllKeys());

function allReportPhotos(rd) {
  if (!rd) return [];
  return [...(rd.photos || []), ...Object.values(rd.photosBySection || {}).flat()];
}

function dataUrlToBlob(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function photoObjectUrl(path) {
  return `${SUPABASE_URL}/storage/v1/object/${PHOTO_BUCKET}/${path}`;
}

// The photo's image as a Blob: from the device, else (for an older report)
// its inline dataUrl, else downloaded from the cloud and kept on the device.
async function getPhotoImage(p) {
  try {
    const local = await getPhotoBlob(p.id);
    if (local) return local;
  } catch (e) {}
  if (p.dataUrl) return dataUrlToBlob(p.dataUrl);
  if (p.path && authSession) {
    try {
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/${PHOTO_BUCKET}/${p.path}`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${getAuthToken()}` },
      });
      if (res.ok) {
        const blob = await res.blob();
        putPhotoBlob(p.id, blob).catch(() => {});
        return blob;
      }
    } catch (e) {}
  }
  return null;
}

// Moves any inline (legacy) photo images in rd into IndexedDB and drops
// the dataUrl from the metadata. Returns true if rd changed.
async function externalizePhotos(rd) {
  let changed = false;
  for (const p of allReportPhotos(rd)) {
    if (!p.dataUrl) continue;
    const blob = dataUrlToBlob(p.dataUrl);
    if (!blob) continue;
    try {
      await putPhotoBlob(p.id, blob);
      delete p.dataUrl;
      changed = true;
    } catch (e) { return changed; } // IndexedDB unavailable: keep the inline copy
  }
  return changed;
}

// Uploads every photo in rd that isn't in the cloud yet. Returns true if
// any photo gained a path. A missing bucket or no signal just leaves the
// photo pending, to try again on the next save.
async function uploadPendingPhotos(rd) {
  if (!authSession || !authUser?.id) return false;
  let changed = false;
  for (const p of allReportPhotos(rd)) {
    if (p.path) continue;
    const blob = await getPhotoImage(p);
    if (!blob) continue;
    const path = `${authUser.id}/${p.id}.jpg`;
    try {
      const res = await fetch(photoObjectUrl(path), {
        method: 'POST',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${getAuthToken()}`, 'Content-Type': blob.type || 'image/jpeg', 'x-upsert': 'true' },
        body: blob,
      });
      if (!res.ok) break;
      p.path = path;
      delete p.dataUrl;
      changed = true;
    } catch (e) { break; }
  }
  return changed;
}

function deleteCloudPhotos(paths) {
  if (!authSession || paths.length === 0) return;
  fetch(`${SUPABASE_URL}/storage/v1/object/${PHOTO_BUCKET}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
    body: JSON.stringify({ prefixes: paths }),
  }).catch(() => {});
}

// Photo ids still used by the open report, the draft, or any saved report
// on this device, for every account that has signed in here (each keeps
// its saved reports under its own korva_saved_reports_<id> key).
function referencedPhotoIds() {
  const ids = new Set(allReportPhotos(reportData).map(p => p.id));
  const add = (raw, pick) => {
    try { pick(JSON.parse(raw || 'null')).forEach(rd => allReportPhotos(rd).forEach(p => ids.add(p.id))); } catch (e) {}
  };
  add(localStorage.getItem(DRAFT_KEY), d => [d && d.reportData]);
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(STORAGE_KEY)) add(localStorage.getItem(key), list => (list || []).map(r => r && r.reportData));
  }
  return ids;
}

// Run once when the app opens: moves older saved reports' inline photos
// into IndexedDB, then removes device copies no report uses any more
// (photos removed from a report, or reports deleted).
async function tidyPhotoStorage() {
  try {
    const reports = getSavedReports();
    let changed = false;
    for (const r of reports) {
      if (await externalizePhotos(r.reportData)) changed = true;
    }
    if (changed) setSavedReports(reports);

    const keep = referencedPhotoIds();
    const stored = await listPhotoBlobIds();
    for (const id of stored) {
      // A marked-up photo's clean copy (see PHOTO MARKUP) lives as long as the photo.
      const photoId = String(id).startsWith('orig_') ? String(id).slice(5) : id;
      if (!keep.has(photoId)) await deletePhotoBlob(id);
    }
  } catch (e) { console.warn('Photo tidy-up skipped:', e && e.message); }
}

// Grids render each <img data-photo-id> empty, then this fills them in.
async function hydratePhotoImages(container, photos) {
  for (const p of photos) {
    const img = container.querySelector(`img[data-photo-id="${p.id}"]`);
    if (!img) continue;
    const blob = await getPhotoImage(p);
    if (blob) {
      const url = URL.createObjectURL(blob);
      img.onload = () => URL.revokeObjectURL(url);
      img.src = url;
    } else {
      img.alt = 'Photo not on this device yet';
    }
  }
}

// ── PHOTO VIEWER ──────────────────────────────────────────────────────────
// Tap any photo to see it full screen and zoom in (pinch, double-tap, or the
// mouse wheel), to check it is sharp enough before it goes in the report.
const photoView = { scale: 1, x: 0, y: 0, pointers: new Map(), pinch: null, lastTap: 0 };

async function openPhotoViewer(id) {
  const p = allReportPhotos(reportData).find(ph => ph.id === id);
  if (!p) return;
  const blob = await getPhotoImage(p);
  if (!blob) { showToast('This photo is not on this device yet', 'info'); return; }
  const img = document.getElementById('photoViewerImg');
  if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
  img.dataset.url = URL.createObjectURL(blob);
  img.src = img.dataset.url;
  document.getElementById('photoViewerInfo').textContent =
    [(p.caption || '').trim(), p.width && p.height ? `${p.width} × ${p.height}` : ''].filter(Boolean).join('  ·  ');
  setPhotoZoom(1, 0, 0);
  if (typeof updateMarkupButton === 'function') updateMarkupButton(id);
  document.getElementById('photoViewer').hidden = false;
}

function closePhotoViewer() {
  const viewer = document.getElementById('photoViewer');
  if (!viewer || viewer.hidden) return;
  viewer.hidden = true;
  const img = document.getElementById('photoViewerImg');
  if (img.dataset.url) { URL.revokeObjectURL(img.dataset.url); delete img.dataset.url; }
  img.removeAttribute('src');
  photoView.pointers.clear(); photoView.pinch = null;
}

// Zooms to scale with the photo offset by (x, y) from the centre, kept so
// the photo never slides off the screen.
function setPhotoZoom(scale, x, y) {
  const img = document.getElementById('photoViewerImg');
  const stage = document.getElementById('photoViewerStage');
  scale = Math.min(5, Math.max(1, scale));
  const maxX = Math.max(0, (img.clientWidth * scale - stage.clientWidth) / 2);
  const maxY = Math.max(0, (img.clientHeight * scale - stage.clientHeight) / 2);
  photoView.scale = scale;
  photoView.x = Math.min(maxX, Math.max(-maxX, x));
  photoView.y = Math.min(maxY, Math.max(-maxY, y));
  img.style.transform = `translate(${photoView.x}px, ${photoView.y}px) scale(${scale})`;
  document.getElementById('photoViewer').classList.toggle('zoomed', scale > 1);
}

// Zooms about a point on screen, so what is under the finger stays there.
function zoomPhotoAt(scale, clientX, clientY) {
  const r = document.getElementById('photoViewerStage').getBoundingClientRect();
  const px = clientX - (r.left + r.width / 2), py = clientY - (r.top + r.height / 2);
  const k = Math.min(5, Math.max(1, scale)) / photoView.scale;
  setPhotoZoom(scale, px - (px - photoView.x) * k, py - (py - photoView.y) * k);
}

function initPhotoViewer() {
  const stage = document.getElementById('photoViewerStage');
  if (!stage) return;
  const pts = photoView.pointers;
  stage.addEventListener('pointerdown', e => {
    stage.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      photoView.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: photoView.scale };
    }
  });
  stage.addEventListener('pointermove', e => {
    const pt = pts.get(e.pointerId);
    if (!pt) return;
    const dx = e.clientX - pt.x, dy = e.clientY - pt.y;
    pt.x = e.clientX; pt.y = e.clientY;
    if (pts.size === 2 && photoView.pinch) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomPhotoAt(photoView.pinch.scale * d / photoView.pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (pts.size === 1 && photoView.scale > 1) {
      setPhotoZoom(photoView.scale, photoView.x + dx, photoView.y + dy);
    }
  });
  const up = e => {
    const pt = pts.get(e.pointerId);
    pts.delete(e.pointerId);
    if (pts.size < 2) photoView.pinch = null;
    if (!pt || e.type === 'pointercancel' || pts.size) return;
    // A quick second tap in the same place zooms in, or back out.
    if (Math.hypot(e.clientX - pt.sx, e.clientY - pt.sy) > 10) return;
    const now = Date.now();
    if (now - photoView.lastTap < 300) {
      photoView.lastTap = 0;
      if (photoView.scale > 1) setPhotoZoom(1, 0, 0); else zoomPhotoAt(2.5, e.clientX, e.clientY);
    } else photoView.lastTap = now;
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    zoomPhotoAt(photoView.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
  }, { passive: false });
  // Esc closes it through BACK (js/app/shell.js), like every other layer.
  // Any photo in the app opens here.
  document.addEventListener('click', e => {
    const img = e.target.closest && e.target.closest('img[data-photo-id]');
    if (img && img.getAttribute('src')) openPhotoViewer(img.dataset.photoId);
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPhotoViewer); else initPhotoViewer();

// After new photos are added: try to back them up now, and record their
// cloud paths in the draft if that worked.
function backUpNewPhotos() {
  uploadPendingPhotos(reportData).then(changed => { if (changed) saveDraft(); });
}

// ── SECTION-AWARE PHOTO SYSTEM ─────────────────────────────────────────────
// Photos are stored per-section in reportData.photosBySection
// The old reportData.photos array is kept for backward compatibility (general photos tab)

const MAX_SECTION_PHOTOS = 30;
// The property box takes one photo, the front of the house, which goes on
// the report cover. Adding another replaces it.
const SECTION_PHOTO_LIMITS = { general: 1 };
const sectionPhotoLimit = section => SECTION_PHOTO_LIMITS[section] || MAX_SECTION_PHOTOS;
const SECTION_PHOTO_KEYS = ['general','durable','obstructions','restrictions','findings','conducive','recommendations'];

function getSectionPhotos(section) {
  if (!reportData.photosBySection) reportData.photosBySection = {};
  if (!reportData.photosBySection[section]) reportData.photosBySection[section] = [];
  return reportData.photosBySection[section];
}

async function handleSectionPhotoFiles(fileList, section) {
  const files = Array.from(fileList || []);
  // Reset the input so the same file can be selected again
  const input = document.getElementById(`sectionPhotoInput-${section}`);
  if (input) input.value = '';
  if (!files.length) return;

  const limit = sectionPhotoLimit(section);
  // A one-photo box (the cover) swaps its photo only once the new one is
  // stored, so a file that fails leaves the old photo in place.
  const replacing = limit === 1 && getSectionPhotos(section).length > 0;
  const existing = replacing ? [] : getSectionPhotos(section);
  const remaining = limit - existing.length;
  if (remaining <= 0) { showToast(`This box is full. It holds ${limit} photos`, 'error'); return; }
  const toProcess = files.slice(0, remaining);
  if (files.length > toProcess.length) showToast(`Only ${toProcess.length} of ${files.length} added. This box holds ${limit} photos`, 'error');

  for (const file of toProcess) {
    try {
      const { blob, width, height } = await compressPhotoFile(file);
      const id = genPhotoId();
      await putPhotoBlob(id, blob);
      existing.push({ id, width, height, caption: '' });
    } catch(e) { showToast(photoStoreProblem(e), 'error'); }
  }
  if (replacing && existing.length) reportData.photosBySection[section] = existing;
  renderSectionPhotoGrid(section);
  updateProgress();
  saveDraft();
  backUpNewPhotos();
}

// "Add Photo" asks where the photo comes from, because a plain photo input
// lets the phone decide and some phones only offer the camera. The chosen
// file input keeps its own onchange handler.
let photoSourceInput = null;
function choosePhotoSource(input) {
  photoSourceInput = typeof input === 'string' ? document.getElementById(input) : input;
  if (!photoSourceInput) return;
  document.getElementById('photoSourceOverlay').classList.add('open');
}
function closePhotoSource() {
  document.getElementById('photoSourceOverlay').classList.remove('open');
}
function pickPhotoSource(kind) {
  closePhotoSource();
  const input = photoSourceInput;
  photoSourceInput = null;
  if (!input) return;
  // Listing file types without image/* makes Android open its file browser
  // instead of the photo picker; iPhone offers Choose File either way.
  input.accept = kind === 'files' ? '.jpg,.jpeg,.png,.webp,.heic,.heif' : 'image/*';
  if (kind === 'camera') input.setAttribute('capture', 'environment');
  else input.removeAttribute('capture');
  input.click();
}

// Removing a photo offers Undo, which puts it back where it was.
function removeSectionPhoto(id, section, refresh) {
  const list = reportData.photosBySection?.[section];
  if (!list) return;
  const index = list.findIndex(p => p.id === id);
  if (index < 0) return;
  const photo = list[index];
  const target = reportData;
  reportData.photosBySection[section] = list.filter(p => p.id !== id);
  renderSectionPhotoGrid(section);
  updateProgress();
  saveDraft();
  showToast('Photo removed', 'info', { label: 'Undo', run: () => {
    if (reportData !== target) return;
    const now = (reportData.photosBySection = reportData.photosBySection || {})[section] || [];
    if (now.some(p => p.id === id)) return;
    now.splice(Math.min(index, now.length), 0, photo);
    reportData.photosBySection[section] = now;
    renderSectionPhotoGrid(section);
    if (refresh) refresh();
    updateProgress();
    saveDraft();
  } });
}

function updateSectionPhotoCaption(id, section, value) {
  const photos = getSectionPhotos(section);
  const photo = photos.find(p => p.id === id);
  if (photo) { photo.caption = value; saveDraft(); if (photo.suggested) updatePhotoAiUI(id); }
}

function renderSectionPhotoGrid(section) {
  const grid  = document.getElementById(`sectionPhotoGrid-${section}`);
  const count = document.getElementById(`sectionPhotoCount-${section}`);
  const btn   = document.getElementById(`sectionPhotoBtn-${section}`);
  if (!grid) return;
  const photos = getSectionPhotos(section);
  const limit = sectionPhotoLimit(section);
  if (count) count.textContent = limit === 1 ? '' : `${photos.length} of ${limit} photos`;
  // Areas and Access take photos per spot now; their old boxes only show
  // for reports that already have photos in them.
  const box = grid.closest('[data-legacy-photos]');
  if (box) box.hidden = !photos.length;
  if (btn && limit === 1) btn.lastChild.textContent = photos.length ? ' Replace photo' : ' Add photo';
  else if (btn) btn.disabled = photos.length >= limit;
  if (photos.length === 0) {
    grid.innerHTML = '<div class="section-photo-empty">No photos added</div>';
    return;
  }
  // The cover photo's caption is fixed ("Front of the property"), so it has
  // no Describe.
  const describe = section !== 'general';
  grid.innerHTML = photos.map(p => `
    <div class="section-photo-card">
      <img data-photo-id="${p.id}" alt="Photo">
      <div class="section-photo-body">
        <input class="photo-caption-input" type="text" placeholder="Caption…" data-caption-for="${p.id}"
               value="${escapeHtml(p.caption||'')}"
               oninput="updateSectionPhotoCaption('${p.id}','${section}',this.value)">
        ${describe ? photoSuggestionHTML(p) : ''}
        <div class="photo-actions">
          ${describe ? describeButtonHTML(p) : ''}
          <button class="photo-remove-btn" onclick="removeSectionPhoto('${p.id}','${section}')">Remove</button>
        </div>
      </div>
    </div>
  `).join('');
  hydratePhotoImages(grid, photos);
}

function renderAllSectionPhotoGrids() {
  SECTION_PHOTO_KEYS.forEach(s => renderSectionPhotoGrid(s));
}

// Re-draws the parts of the report that aren't plain fields, after a
// report is loaded, restored or reset.
function renderReportWidgets() {
  renderRecLines();
  renderPhotoGrid();
  renderAllSectionPhotoGrids();
  renderAreaChecklist();
  renderMoistureTable();
  syncFitFields();
  renderPendingNotes();
  renderIssueState();
}

// ── READY-MADE RECOMMENDATIONS ─────────────────────────────────────────────
// Lines the inspector would otherwise say on most jobs, added with a tap.
// The report stores the text as it was when added (reportData.recLines =
// [{ id, text }]), so a later change of wording never changes a report
// already sent. Never a structural verdict, never a risk by species.
const REC_LINES = [
  ['maintain', 'Maintain the system', 'Keep the termite management system on this property maintained as its installer specifies, and follow the recommendations in this report.'],
  ['warranty', 'Keep the warranty', 'Have the termite management system inspected and serviced as its warranty requires, so any warranty or service period stays in place.'],
  ['expired', 'System may be expired', 'The termite management system on this property may be past its service life. Have it assessed and, if needed, re-treated or replaced.'],
  ['install', 'Install a system', 'Have a termite management system installed to AS 3660.2, such as a chemical soil treated zone or a monitoring and baiting system. A quote can be provided.'],
  ['zone', 'Keep inspection zones clear', 'Keep the slab edge and the inspection zones around the building clear of soil, garden beds, paving and stored items, so termite entry can be seen.'],
  ['debris', 'Clear timber and debris', 'Remove stored timber, garden debris and other materials from against the building and from the subfloor.'],
  ['drainage', 'Keep water away', 'Keep gutters, downpipes, taps and drainage in good repair, and keep the ground around the building dry and draining away from it.'],
  ['plumber', 'Plumber for moisture', 'Have a licensed plumber find and fix the source of the moisture noted in this report.'],
  ['ventilation', 'Improve ventilation', 'Improve subfloor ventilation and keep the vents clear: damp subfloors attract termites and decay.'],
  ['stumps', 'Check trees and stumps', 'Have trees and stumps on the property checked for termite nests, and remove dead stumps and old landscaping timbers.'],
  ['declined', 'Client declined for now', 'Termite management options were discussed with the client, who chose not to go ahead at this time. A quote can be provided on request.'],
  ['sample', 'Sample sent for ID', 'A sample was taken for identification. Further advice will follow once it has been identified.'],
];

function getRecLines() { return Array.isArray(reportData.recLines) ? reportData.recLines : []; }

// The Findings rule for Advice: the lines that fit what the report says come
// first, with any already added, and the rest wait under More. While the
// report says nothing they'd follow from, every line shows. Each test reads
// answers only, so a line never comes or goes with the inspector's words.
const REC_LINE_FITS = {
  maintain: rd => hasIdentifiedSystem(rd.existingSystem),
  warranty: rd => hasIdentifiedSystem(rd.existingSystem),
  expired: rd => hasIdentifiedSystem(rd.existingSystem),
  install: rd => (!isBlankValue(rd.existingSystem) && !hasIdentifiedSystem(rd.existingSystem)) || rd.treatmentRecommended === 'YES',
  zone: rd => rd.slabEdge === 'OBSTRUCTED' || rd.weepHoles === 'BRIDGED' || rd.zone25mmVisible === 'NO' || rd.zone75mmVisible === 'NO',
  debris: rd => rd.timberSoil === 'YES' || rd.nonDurableTimber === 'YES',
  drainage: rd => rd.waterLeaks === 'YES' || rd.siteDrainage === 'POOR' || rd.subfloorDrainage === 'POOR',
  plumber: rd => rd.waterLeaks === 'YES' || rd.moistureReadings === 'YES',
  ventilation: rd => rd.subfloorVentilation === 'POOR' || rd.mouldSeen === 'YES',
  stumps: rd => /tree|bush|reserve|rural/i.test(rd.siteSurroundings || ''),
  declined: rd => rd.treatmentRecommended === 'YES',
};
const REC_LINE_KEYS = ['existingSystem', 'treatmentRecommended', 'slabEdge', 'weepHoles', 'timberSoil', 'nonDurableTimber', 'waterLeaks', 'siteDrainage', 'moistureReadings', 'subfloorVentilation', 'mouldSeen', 'siteSurroundings'];
const recLinesOpened = new WeakSet(); // reports whose More was tapped
const recLinesSeen = new WeakMap();   // report → ids shown, which stay shown (never gone under a tap)

function recLinesShown() {
  const have = new Set(getRecLines().map(l => l.id));
  const known = REC_LINE_KEYS.some(k => !isBlankValue(reportData[k]));
  if (!known || recLinesOpened.has(reportData)) return { first: REC_LINES, more: [] };
  let seen = recLinesSeen.get(reportData);
  if (!seen) recLinesSeen.set(reportData, seen = new Set());
  const fits = ([id]) => seen.has(id) || have.has(id) || (REC_LINE_FITS[id] && REC_LINE_FITS[id](reportData));
  const first = REC_LINES.filter(fits);
  first.forEach(([id]) => seen.add(id));
  return { first, more: REC_LINES.filter(l => !fits(l)) };
}

function openMoreRecLines() {
  recLinesOpened.add(reportData);
  renderRecLines();
}

// The second opinion compares a treatment, so it waits for one, as its
// card on the quote does (reportNeedsPlan).
function syncRecLines() {
  const link = document.getElementById('tpReportLink');
  if (link) link.hidden = !reportNeedsPlan(reportData);
  const el = document.getElementById('recLines');
  if (el && el._fits !== JSON.stringify(recLinesShown().first.map(l => l[0]))) renderRecLines();
}

function renderRecLines() {
  const el = document.getElementById('recLines');
  if (!el) return;
  const have = new Set(getRecLines().map(l => l.id));
  const { first, more } = recLinesShown();
  el._fits = JSON.stringify(first.map(l => l[0]));
  el.innerHTML = first.map(([id, label]) =>
    `<button type="button" class="rec-line${have.has(id) ? ' on' : ''}" aria-pressed="${have.has(id)}" onclick="toggleRecLine('${id}')">${escapeHtml(label)}</button>`).join('')
    + (more.length ? `<button type="button" class="rec-line rec-line-more" onclick="openMoreRecLines()">${more.length} more</button>` : '');
  const added = document.getElementById('recLinesAdded');
  if (added) {
    added.innerHTML = getRecLines().map(l => `<li>${escapeHtml(l.text)}</li>`).join('');
    added.hidden = !have.size;
  }
  const n = have.size;
  const count = document.getElementById('recLinesCount');
  if (count) count.textContent = n ? `${n} added to the report` : 'Tap to add to the report';
}

function toggleRecLine(id) {
  if (isReportLocked()) { sayLocked(); return; }
  const line = REC_LINES.find(l => l[0] === id);
  if (!line) return;
  const list = getRecLines();
  reportData.recLines = list.some(l => l.id === id) ? list.filter(l => l.id !== id) : [...list, { id, text: line[2] }];
  renderRecLines();
  renderFieldGroups();
  saveDraft();
}

// ── LEGACY GENERAL PHOTOS (Photos tab) ─────────────────────────────────────
async function handlePhotoFiles(fileList) {
  const files = Array.from(fileList || []);
  document.getElementById('photoFileInput').value = '';
  if (!files.length) return;

  if (!reportData.photos) reportData.photos = [];
  const remaining = MAX_PHOTOS_PER_REPORT - reportData.photos.length;
  if (remaining <= 0) { showToast(`Photo limit reached (${MAX_PHOTOS_PER_REPORT} per report)`, 'error'); return; }
  const toProcess = files.slice(0, remaining);
  if (files.length > toProcess.length) showToast(`Only ${toProcess.length} of ${files.length} added. A report holds ${MAX_PHOTOS_PER_REPORT} photos`, 'error');

  for (const file of toProcess) {
    try {
      const { blob, width, height } = await compressPhotoFile(file);
      const id = genPhotoId();
      await putPhotoBlob(id, blob);
      reportData.photos.push({ id, width, height, caption: '' });
    } catch(e) { showToast('Could not process one of the selected photos', 'error'); }
  }
  renderPhotoGrid();
  updateProgress();
  saveDraft();
  backUpNewPhotos();
}

function removePhoto(id) {
  if (!reportData.photos) return;
  const index = reportData.photos.findIndex(p => p.id === id);
  if (index < 0) return;
  const photo = reportData.photos[index];
  const target = reportData;
  reportData.photos = reportData.photos.filter(p => p.id !== id);
  if (reportData.photos.length === 0) delete reportData.photos;
  renderPhotoGrid();
  updateProgress();
  saveDraft();
  showToast('Photo removed', 'info', { label: 'Undo', run: () => {
    if (reportData !== target) return;
    const now = reportData.photos || [];
    if (now.some(p => p.id === id)) return;
    now.splice(Math.min(index, now.length), 0, photo);
    reportData.photos = now;
    renderPhotoGrid();
    updateProgress();
    saveDraft();
  } });
}

function updatePhotoCaption(id, value) {
  if (!reportData.photos) return;
  const photo = reportData.photos.find(p => p.id === id);
  if (photo) { photo.caption = value; saveDraft(); if (photo.suggested) updatePhotoAiUI(id); }
}

function renderPhotoGrid() {
  const grid = document.getElementById('photoGrid');
  const empty = document.getElementById('photoEmptyState');
  const countEl = document.getElementById('photoCount');
  const addBtn = document.getElementById('addPhotoBtn');
  if (!grid) return;

  const photos = reportData.photos || [];
  countEl.textContent = `${photos.length} of ${MAX_PHOTOS_PER_REPORT} photos`;
  countEl.classList.toggle('at-cap', photos.length >= MAX_PHOTOS_PER_REPORT);
  addBtn.disabled = photos.length >= MAX_PHOTOS_PER_REPORT;

  if (photos.length === 0) {
    grid.style.display = 'none';
    empty.style.display = 'block';
    grid.innerHTML = '';
    return;
  }
  empty.style.display = 'none';
  grid.style.display = 'grid';
  grid.innerHTML = photos.map(p => `
    <div class="photo-card">
      <img data-photo-id="${p.id}" alt="Inspection photo">
      <div class="photo-card-body">
        <input class="photo-caption-input" type="text" placeholder="What does this show?" data-caption-for="${p.id}"
               value="${escapeHtml(p.caption || '')}"
               oninput="updatePhotoCaption('${p.id}', this.value)">
        ${photoSuggestionHTML(p)}
        <div class="photo-card-footer">
          ${describeButtonHTML(p)}
          <button class="photo-analyze-btn" id="analyzeBtn-${p.id}" onclick="analyzeGalleryPhoto('${p.id}')">Insect ID</button>
          <button class="photo-remove-btn" onclick="removePhoto('${p.id}')">Remove</button>
        </div>
      </div>
    </div>
  `).join('');
  hydratePhotoImages(grid, photos);
}
