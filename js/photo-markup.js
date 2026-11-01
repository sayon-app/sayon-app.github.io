// ── PHOTO MARKUP ──────────────────────────────────────────────────────────
// Draw a circle, an arrow, a freehand line or a short label on a report
// photo, so the client can see where the damage is. Opened from the photo
// viewer's Mark up button (see PHOTO VIEWER in js/app.js).
//
// The marks are kept on the photo as shapes (p.markup), in coordinates from
// 0 to 1 across the photo, so they can be changed later. The photo's stored
// image becomes the marked-up JPEG, so the report PDF, the backup and every
// grid show the marks with no other change. The untouched photo is kept on
// this device in the 'korvus-photos' store as 'orig_<photo id>', which lets
// the inspector move or remove marks later. Saving clears p.path so the
// marked image is uploaded again over the old cloud copy.

const MARKUP_ORIGINAL_PREFIX = 'orig_';
const MARKUP_COLOURS = { red: '#FF3B30', yellow: '#FFD60A', white: '#FFFFFF' };
const MARKUP_MAX_LABEL = 40;

const markupState = {
  photo: null,       // the report photo's metadata object
  base: null,        // HTMLImageElement of the photo without marks
  baseBlob: null,    // its Blob, kept as the original on save
  hadOriginal: false,
  shapes: [],
  tool: 'circle',
  colour: 'red',
  drawing: null,     // the shape being drawn, in photo coordinates
  pendingLabel: null // { x, y } where a label is about to go
};

const markupOriginalId = id => MARKUP_ORIGINAL_PREFIX + id;

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not open the photo')); };
    img.src = url;
  });
}

// The photo viewer shows the button only for a photo in the open report,
// and not while the job is complete and locked.
function updateMarkupButton(id) {
  const btn = document.getElementById('photoViewerMarkup');
  if (!btn) return;
  const p = allReportPhotos(reportData).find(ph => ph.id === id);
  btn.hidden = !p || isReportLocked();
  btn.dataset.photoId = p ? id : '';
}

async function openPhotoMarkup(id) {
  id = id || document.getElementById('photoViewerMarkup')?.dataset.photoId;
  const p = allReportPhotos(reportData).find(ph => ph.id === id);
  if (!p) return;
  if (isReportLocked()) { showToast('This job is complete and locked. Tap Amend to change it', 'info'); return; }
  let original = null;
  try { original = await getPhotoBlob(markupOriginalId(id)); } catch (e) {}
  const current = original || await getPhotoImage(p);
  if (!current) { showToast('This photo is not on this device yet', 'info'); return; }
  let base;
  try { base = await loadImageFromBlob(current); }
  catch (e) { showToast('Could not open this photo to mark up', 'error'); return; }

  Object.assign(markupState, {
    photo: p, base, baseBlob: current, hadOriginal: !!original,
    // Marks made on another phone are already part of the image there, so
    // only start from the saved shapes when the clean photo is here too.
    shapes: original && Array.isArray(p.markup) ? JSON.parse(JSON.stringify(p.markup)) : [],
    drawing: null, pendingLabel: null,
  });
  const canvas = document.getElementById('markupCanvas');
  canvas.width = base.naturalWidth;
  canvas.height = base.naturalHeight;
  document.getElementById('markupBakedNote').hidden = !!original || !(Array.isArray(p.markup) && p.markup.length);
  closeMarkupLabel();
  setMarkupTool(markupState.tool);
  setMarkupColour(markupState.colour);
  closePhotoViewer();
  document.getElementById('photoMarkup').hidden = false;
  drawMarkup();
}

function closePhotoMarkup() {
  const el = document.getElementById('photoMarkup');
  if (!el || el.hidden) return;
  el.hidden = true;
  closeMarkupLabel();
  Object.assign(markupState, { photo: null, base: null, baseBlob: null, shapes: [], drawing: null });
}

function setMarkupTool(tool) {
  markupState.tool = tool;
  document.querySelectorAll('#photoMarkup [data-markup-tool]').forEach(b => {
    const on = b.dataset.markupTool === tool;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const hints = {
    circle: 'Drag over the spot to circle it',
    arrow: 'Drag from where the arrow starts to what it points at',
    pen: 'Draw with your finger',
    text: 'Tap where the label should go',
  };
  document.getElementById('markupHint').textContent = hints[tool] || '';
  if (tool !== 'text') closeMarkupLabel();
}

function setMarkupColour(colour) {
  markupState.colour = MARKUP_COLOURS[colour] ? colour : 'red';
  document.querySelectorAll('#photoMarkup [data-markup-colour]').forEach(b => {
    const on = b.dataset.markupColour === markupState.colour;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function undoMarkup() {
  if (markupState.pendingLabel) { closeMarkupLabel(); return; }
  markupState.shapes.pop();
  drawMarkup();
}

function clearMarkup() {
  markupState.shapes = [];
  closeMarkupLabel();
  drawMarkup();
}

function updateMarkupButtons() {
  const n = markupState.shapes.length;
  document.getElementById('markupUndo').disabled = !n;
  document.getElementById('markupClear').disabled = !n;
}

// ── Drawing ──
// Line width and text size follow the photo's longer side, so marks look
// the same on a small photo and a large one, on screen and in the PDF.
function markupScale(w, h) { return Math.max(w, h); }

function strokeTwice(ctx, colour, width, path) {
  // A dark edge under the colour keeps a mark visible on pale timber and
  // on dark subfloor soil alike.
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = width * 1.7;
  path(); ctx.stroke();
  ctx.strokeStyle = colour; ctx.lineWidth = width;
  path(); ctx.stroke();
}

function drawMarkupShape(ctx, s, w, h) {
  const colour = MARKUP_COLOURS[s.colour] || MARKUP_COLOURS.red;
  const size = markupScale(w, h);
  const lw = Math.max(3, size * 0.007);
  if (s.type === 'circle') {
    const cx = (s.x1 + s.x2) / 2 * w, cy = (s.y1 + s.y2) / 2 * h;
    const rx = Math.max(lw, Math.abs(s.x2 - s.x1) / 2 * w), ry = Math.max(lw, Math.abs(s.y2 - s.y1) / 2 * h);
    strokeTwice(ctx, colour, lw, () => { ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); });
  } else if (s.type === 'arrow') {
    const x1 = s.x1 * w, y1 = s.y1 * h, x2 = s.x2 * w, y2 = s.y2 * h;
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const head = Math.max(lw * 4, Math.min(size * 0.05, Math.hypot(x2 - x1, y2 - y1) * 0.5));
    strokeTwice(ctx, colour, lw, () => {
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.moveTo(x2 - head * Math.cos(ang - 0.5), y2 - head * Math.sin(ang - 0.5));
      ctx.lineTo(x2, y2);
      ctx.lineTo(x2 - head * Math.cos(ang + 0.5), y2 - head * Math.sin(ang + 0.5));
    });
  } else if (s.type === 'pen' && s.points && s.points.length) {
    strokeTwice(ctx, colour, lw, () => {
      ctx.beginPath();
      s.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
      if (s.points.length === 1) ctx.lineTo(s.points[0][0] * w + 0.1, s.points[0][1] * h);
    });
  } else if (s.type === 'text' && s.text) {
    const fs = Math.max(14, Math.round(size * 0.035));
    ctx.font = `700 ${fs}px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
    ctx.textBaseline = 'middle';
    const pad = fs * 0.35;
    const tw = ctx.measureText(s.text).width;
    // Keep the whole label on the photo.
    const x = Math.min(Math.max(s.x * w, 0), Math.max(0, w - tw - pad * 2));
    const y = Math.min(Math.max(s.y * h, fs / 2 + pad), h - fs / 2 - pad);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x, y - fs / 2 - pad, tw + pad * 2, fs + pad * 2);
    ctx.fillStyle = colour;
    ctx.fillText(s.text, x + pad, y);
  }
}

function paintMarkup(ctx, base, shapes, w, h) {
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(base, 0, 0, w, h);
  shapes.forEach(s => drawMarkupShape(ctx, s, w, h));
}

function drawMarkup() {
  const canvas = document.getElementById('markupCanvas');
  if (!canvas || !markupState.base) return;
  const shapes = markupState.drawing ? [...markupState.shapes, markupState.drawing] : markupState.shapes;
  paintMarkup(canvas.getContext('2d'), markupState.base, shapes, canvas.width, canvas.height);
  updateMarkupButtons();
}

// Where a finger is on the photo, from 0 to 1 each way.
function markupPoint(e) {
  const r = document.getElementById('markupCanvas').getBoundingClientRect();
  const clamp = v => Math.min(1, Math.max(0, v));
  return [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)];
}

function initPhotoMarkup() {
  const canvas = document.getElementById('markupCanvas');
  if (!canvas) return;
  canvas.addEventListener('pointerdown', e => {
    if (!markupState.base || markupState.drawing) return;
    e.preventDefault();
    const [x, y] = markupPoint(e);
    if (markupState.tool === 'text') { openMarkupLabel(x, y); return; }
    canvas.setPointerCapture(e.pointerId);
    markupState.drawing = markupState.tool === 'pen'
      ? { type: 'pen', colour: markupState.colour, points: [[x, y]], pointerId: e.pointerId }
      : { type: markupState.tool, colour: markupState.colour, x1: x, y1: y, x2: x, y2: y, pointerId: e.pointerId };
    drawMarkup();
  });
  canvas.addEventListener('pointermove', e => {
    const d = markupState.drawing;
    if (!d || d.pointerId !== e.pointerId) return;
    const [x, y] = markupPoint(e);
    if (d.type === 'pen') d.points.push([x, y]); else { d.x2 = x; d.y2 = y; }
    drawMarkup();
  });
  const end = e => {
    const d = markupState.drawing;
    if (!d || d.pointerId !== e.pointerId) return;
    markupState.drawing = null;
    delete d.pointerId;
    // A tap with the circle or arrow tool makes nothing useful: skip it.
    const tiny = d.type !== 'pen' && Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 0.02;
    if (!tiny && e.type !== 'pointercancel') {
      if (d.type === 'pen') d.points = d.points.map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]);
      markupState.shapes.push(d);
    }
    drawMarkup();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  document.getElementById('markupLabelInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addMarkupLabel(); }
    if (e.key === 'Escape') { e.preventDefault(); closeMarkupLabel(); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !document.getElementById('photoMarkup').hidden && !markupState.pendingLabel) closePhotoMarkup();
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPhotoMarkup); else initPhotoMarkup();

function openMarkupLabel(x, y) {
  markupState.pendingLabel = { x, y };
  const bar = document.getElementById('markupLabelBar');
  bar.hidden = false;
  const input = document.getElementById('markupLabelInput');
  input.value = '';
  input.focus();
}

function closeMarkupLabel() {
  markupState.pendingLabel = null;
  const bar = document.getElementById('markupLabelBar');
  if (bar) bar.hidden = true;
}

function addMarkupLabel() {
  const at = markupState.pendingLabel;
  const text = document.getElementById('markupLabelInput').value.replace(/\s+/g, ' ').trim().slice(0, MARKUP_MAX_LABEL);
  if (at && text) markupState.shapes.push({ type: 'text', colour: markupState.colour, x: at.x, y: at.y, text });
  closeMarkupLabel();
  drawMarkup();
}

// ── Saving ──
function canvasToJpeg(canvas) {
  return new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/jpeg', 0.8));
}

async function savePhotoMarkup() {
  const p = markupState.photo;
  if (!p || !markupState.base) return;
  if (markupState.pendingLabel) addMarkupLabel();
  if (isReportLocked()) { showToast('This job is complete and locked. Tap Amend to change it', 'info'); return; }
  const btn = document.getElementById('markupSave');
  btn.disabled = true;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = markupState.base.naturalWidth;
    canvas.height = markupState.base.naturalHeight;
    const shapes = markupState.shapes;
    let image;
    if (!shapes.length && markupState.hadOriginal) image = markupState.baseBlob;
    else {
      paintMarkup(canvas.getContext('2d'), markupState.base, shapes, canvas.width, canvas.height);
      image = await canvasToJpeg(canvas);
    }
    if (!image) throw new Error('Could not save the photo');
    // Keep the clean photo first, so a failed save never loses it.
    if (!markupState.hadOriginal) await putPhotoBlob(markupOriginalId(p.id), markupState.baseBlob);
    await putPhotoBlob(p.id, image);
    if (shapes.length) p.markup = shapes; else delete p.markup;
    delete p.path; // upload the marked-up image again
    p.width = canvas.width; p.height = canvas.height;
    saveDraft();
    if (typeof backUpNewPhotos === 'function') backUpNewPhotos();
    refreshPhotoThumbs(p.id, image);
    if (typeof updateProgress === 'function') updateProgress();
    closePhotoMarkup();
    showToast(shapes.length ? 'Marks saved on the photo' : 'Marks removed', 'success');
  } catch (e) {
    showToast('Could not save the marks. Try again', 'error');
  } finally {
    btn.disabled = false;
  }
}

// Every copy of the photo on screen shows the new image.
function refreshPhotoThumbs(id, blob) {
  document.querySelectorAll(`img[data-photo-id="${id}"]`).forEach(img => {
    const url = URL.createObjectURL(blob);
    img.onload = () => URL.revokeObjectURL(url);
    img.src = url;
  });
}
