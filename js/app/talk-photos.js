// SAYON app: Photos taken while talking, placed on the finding they were taken for.
// One of the js/app/ files, which share one global scope: they load as plain
// scripts in the order index.html lists them, so a top-level name declared in
// any of them can be used from the others once the page has loaded.

// ── PHOTOS WHILE TALKING ─────────────────────────────────────────────────
// The inspector describes a spot and photographs it in the same breath.
// A photo taken from the voice popover is kept with the words heard around
// the moment it was taken (reportData.photosBySection.findings[i].heard),
// and once the note has filled the report it moves onto the finding whose
// place those words name, with the sentence as its caption. One that
// matches no finding stays in the Findings photos, caption blank.
const TALK_WINDOW_BEFORE_MS = 30000, TALK_WINDOW_AFTER_MS = 20000;
let speechTimeline = []; // [{ t, text }] for the open report, this session

function speechHeard(text) {
  const t = Date.now();
  const clean = String(text || '').trim();
  if (!clean) return;
  speechTimeline.push({ t, text: clean });
  if (speechTimeline.length > 400) speechTimeline = speechTimeline.slice(-300);
  // Words said just after the photo belong to it too.
  let touched = false;
  for (const p of getSectionPhotos('findings')) {
    if (p.heard && !p.heard.placed && t - p.heard.at <= TALK_WINDOW_AFTER_MS) { p.heard.text = heardAround(p.heard.at); touched = true; }
  }
  if (touched) saveDraft();
}

function heardAround(at) {
  // Each stretch of speech on its own line, so a caption can be one of them.
  return speechTimeline.filter(e => e.t >= at - TALK_WINDOW_BEFORE_MS && e.t <= at + TALK_WINDOW_AFTER_MS).map(e => e.text).join('\n').trim();
}

function takePhotoWhileTalking() {
  const input = document.getElementById('talkPhotoInput');
  if (!input) return;
  input.value = '';
  input.click();
}

async function handleTalkPhotoFiles(input) {
  const files = Array.from(input.files || []);
  input.value = '';
  if (!files.length) return;
  const at = Date.now();
  const before = new Set(getSectionPhotos('findings').map(p => p.id));
  await handleSectionPhotoFiles(files, 'findings');
  const added = getSectionPhotos('findings').filter(p => !before.has(p.id));
  added.forEach(p => { p.heard = { at, text: heardAround(at) }; });
  if (added.length) {
    showToast(added.length === 1 ? 'Photo kept. It lands on the finding you\'re describing once the note is filled in' : `${added.length} photos kept for the findings you're describing`, 'success');
    renderSectionPhotoGrid('findings');
    saveDraft();
  }
  updateTalkPhotoButton();
}

function talkPhotosWaiting() {
  return getSectionPhotos('findings').filter(p => p.heard && !p.heard.placed);
}

function updateTalkPhotoButton() {
  const btn = document.getElementById('voicePhotoBtn'), label = document.getElementById('voicePhotoBtnText');
  if (!btn || !label) return;
  const n = talkPhotosWaiting().length;
  btn.classList.toggle('has-photos', n > 0);
  label.textContent = n ? `${n} photo${n === 1 ? '' : 's'} waiting for the fill · take another` : 'Photo of what you\'re describing';
}

// Words that say where a finding is, for matching speech to a finding.
const talkPlaceWords = t => keyWords(t).filter(w => !PLACE_FILLER.has(w) && !TALK_SKIP.has(w));
const TALK_SKIP = new Set(['termite', 'termites', 'live', 'active', 'activity', 'there', 'here', 'yeah', 'okay', 'right', 'just', 'like', 'some', 'then', 'also', 'have', 'been', 'were', 'what', 'about', 'looks', 'look', 'found', 'photo', 'picture', 'taking', 'take']);

// The finding the heard words name best: the most place words in common,
// at least two, or one when only one finding has a place at all.
function findingForHeard(text, findings) {
  const said = new Set(talkPlaceWords(text));
  if (!said.size) return null;
  const placed = findings.filter(f => f && f.id && f.termiteActivity !== 'NONE' && (f.activityLocation || f.damageDescription || f.timberAffected));
  let best = null, bestScore = 0, second = 0;
  for (const f of placed) {
    const words = new Set(talkPlaceWords([f.activityLocation, f.timberAffected, f.damageDescription].join(' ')));
    let score = 0; words.forEach(w => { if (said.has(w)) score++; });
    if (score > bestScore) { second = bestScore; bestScore = score; best = f; }
    else if (score > second) second = score;
  }
  if (!best || bestScore === second) return null;
  if (bestScore >= 2 || (bestScore === 1 && placed.length === 1)) return best;
  return null;
}

// The sentence of the heard words that names the finding, tidied for a
// caption: fillers out, first letter up, cut at a reasonable length.
function talkCaption(text, finding) {
  const want = new Set(talkPlaceWords([finding.activityLocation, finding.timberAffected, finding.damageDescription].join(' ')));
  const parts = String(text).split(/\n+|(?<=[.!?])\s+|\s+(?=(?:and then|then|so|okay|right|um|next)\b)/i).map(s => s.trim()).filter(Boolean);
  // The stretch that names the finding best.
  let pick = '', pickScore = 0;
  for (const part of parts) { const n = talkPlaceWords(part).filter(w => want.has(w)).length; if (n > pickScore) { pickScore = n; pick = part; } }
  if (!pick) pick = parts[0] || '';
  pick = pick.replace(/\b(um+|uh+|erm)\b[,.]?\s*/gi, ' ').replace(/^(?:\s*(?:okay|ok|right|so|yeah|like|and|then|well)\b[,.]?\s*)+/i, '').replace(/\s+/g, ' ').replace(/^[\s,.;:-]+|[\s,;:-]+$/g, '').trim();
  if (pick.length > 110) pick = pick.slice(0, 107).replace(/\s+\S*$/, '') + '…';
  return pick ? pick.charAt(0).toUpperCase() + pick.slice(1) : '';
}

function placeTalkPhotos() {
  const waiting = talkPhotosWaiting();
  if (!waiting.length) return 0;
  const findings = reportData.findings || [];
  let moved = 0;
  for (const p of waiting) {
    const text = p.heard.text || heardAround(p.heard.at);
    const f = findingForHeard(text, findings);
    saveTestEvent('talk-photo', text, { placedOn: f ? [f.activityLocation, f.timberAffected].filter(Boolean).join(', ') : null, caption: f && !p.caption ? talkCaption(text, f) : (p.caption || null) });
    if (!f) continue;
    const section = findingPhotoSection(f.id);
    if (getSectionPhotos(section).length >= sectionPhotoLimit(section)) continue;
    reportData.photosBySection.findings = getSectionPhotos('findings').filter(x => x.id !== p.id);
    if (!p.caption) p.caption = talkCaption(text, f);
    p.heard.placed = f.id;
    getSectionPhotos(section).push(p);
    moved++;
  }
  if (moved) {
    renderSectionPhotoGrid('findings');
    renderFindingsUI();
    showToast(moved === 1 ? 'Your photo is on the finding you described' : `${moved} photos are on the findings you described`, 'success');
  }
  updateTalkPhotoButton();
  return moved;
}

// Findings with termite activity or evidence where "Refer to a builder or
// engineer?" has no answer. A blank is never read as "no referral".
function findingsMissingReferral() {
  return (reportData.findings || [])
    .map((f, i) => ({ f, n: i + 1 }))
    .filter(({ f }) => f && (f.termiteActivity === 'ACTIVE' || f.termiteActivity === 'INACTIVE') && f.structuralConcern !== 'YES' && f.structuralConcern !== 'NO')
    .map(({ n }) => n);
}
