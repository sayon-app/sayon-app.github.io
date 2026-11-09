// SAYON app: AI extraction, learned corrections, test mode, waiting notes, extract summary, read-back, plate scan, insect ID, photo descriptions.
// One of the js/app/ files, which share one global scope: they load as plain
// scripts in the order index.html lists them, so a top-level name declared in
// any of them can be used from the others once the page has loaded.

// ── AI EXTRACTION ─────────────────────────────────────────────────────────
// Sends one dictated note to the AI and returns the extracted fields.
// Throws an error with .noSignal set when the phone can't reach the
// internet (offline, a dropped connection or no answer in time), and with
// .status set when the Worker refuses the call (expired sign-in, plan
// ended, usage limit). Either way the note waits rather than being lost.
const EXTRACTION_TIMEOUT_MS = 120000;

// Times each note and records how it went (never the note itself). A
// refusal the inspector can fix (sign-in, plan, usage) or no signal isn't
// a bug, so only the rest go to Sentry, as the kind of failure only: the
// Worker's answer could quote the note.
async function requestExtraction(text) {
  const started = Date.now();
  const seconds = () => Math.round((Date.now() - started) / 100) / 10;
  try {
    const parsed = await callExtraction(text);
    track('note_filled', { seconds: seconds(), words: text.split(/\s+/).filter(Boolean).length });
    saveTestNote(text, parsed, null, seconds());
    return parsed;
  } catch (err) {
    const reason = err.kept ? 'kept_for_later' : err.noSignal ? 'no_signal' : err.tooLong ? 'too_long' : err.badAnswer ? 'bad_answer'
      : err.status ? 'http_' + err.status : 'other';
    track('note_failed', { reason, seconds: seconds() });
    saveTestNote(text, null, reason, seconds());
    if (!err.noSignal && ![401, 402, 429].includes(err.status)) reportError(new Error('Extraction failed: ' + reason), 'extraction');
    throw err;
  }
}

// The fill in flight, so "Keep for later" on the busy bar can stop it.
let activeExtraction = null;
function keepNoteForLater() {
  if (!activeExtraction) return;
  activeExtraction.kept = true;
  activeExtraction.controller.abort();
}

async function callExtraction(text) {
  const noSignal = (msg) => Object.assign(new Error(msg), { noSignal: true });
  if (!navigator.onLine) throw noSignal('no signal');

  const learned = learnedPromptBlock();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTRACTION_TIMEOUT_MS);
  const mine = activeExtraction = { controller, kept: false };
  let res, rawBody;
  try {
    res = await workerFetch('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        // The model thinks before it answers, and that thinking counts
        // toward max_tokens. At 4096 and its default (high) effort, a
        // whole-house note thought for so long the JSON was cut off.
        // Medium effort keeps the thinking proportionate; the Worker caps
        // max_tokens at its own ceiling.
        max_tokens: 16000,
        output_config: { effort: 'medium' },
        // The instructions are the same for every note, so they're cached
        // for an hour: after the first note, reading them costs a tenth.
        // The other prompts are too short for the model to cache.
        // The business's own corrections follow, cached too: they change
        // only when the inspector fixes something.
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral', ttl: '1h' } }]
          .concat(learned ? [{ type: 'text', text: learned, cache_control: { type: 'ephemeral', ttl: '1h' } }] : []),
        messages: [{ role: 'user', content: text }]
      }),
      signal: controller.signal,
    });
    rawBody = await res.text();
  } catch (err) {
    // fetch() only rejects when the request never got an answer.
    if (mine.kept) throw Object.assign(noSignal('kept for later'), { kept: true });
    throw noSignal(err && err.name === 'AbortError' ? 'no answer in time' : 'no connection');
  } finally {
    clearTimeout(timer);
    if (activeExtraction === mine) activeExtraction = null;
  }

  // The worker refuses a request (expired sign-in, plan ended, usage
  // limit, failed origin check) with a plain-text body like "Forbidden"
  // rather than JSON, so parse defensively and keep the status.
  const refused = (msg) => Object.assign(new Error(msg), { status: res.status });
  let data;
  try {
    data = JSON.parse(rawBody);
  } catch {
    throw refused(`HTTP ${res.status}: ${rawBody.slice(0, 200) || '(empty response)'}`);
  }

  if (!res.ok || data.error) {
    throw refused('API error: ' + (data.error?.message || data.error?.type || `HTTP ${res.status}`));
  }

  // FIX: if the response was cut off at the token limit, say so plainly
  // instead of letting JSON.parse() below throw an opaque "Unexpected
  // EOF" that's indistinguishable from any other malformed-response bug.
  if (data.stop_reason === 'max_tokens') {
    throw Object.assign(new Error('response cut off'), { tooLong: true });
  }

  const out = data.content.map(i => i.text || '').join('');
  let parsed;
  try {
    parsed = JSON.parse(out.replace(/```json|```/g, '').trim());
  } catch (e) {
    // The model answered with something that isn't JSON. Retrying the same
    // note would most likely do the same, so this is marked as the note's
    // own problem rather than a connection one.
    throw Object.assign(new Error('the answer was not valid JSON'), { badAnswer: true });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw Object.assign(new Error('the answer was not a JSON object'), { badAnswer: true });
  }
  return parsed;
}

// ── LEARNED CORRECTIONS ───────────────────────────────────────────────────
// SAYON learns from what the inspector fixes, per business:
//   - a field the AI filled and the inspector then changed is kept with the
//     words that were said, and later notes see it as an example;
//   - a few words changed in the transcript box before filling ("peers are
//     in Cunt" to "piers ant capped") are kept as a word fix. The AI and
//     Whisper see it at once, and once the same fix has been made twice it
//     is made in the transcript box automatically.
// Stored as { fields: [{ id, key, label, said, ai, fixed, at }],
// words: [{ id, heard, meant, count, at }], removed: [ids], updatedAt },
// per business, and synced in businesses.settings.learned (business-sync.js).
// The inspector sees and can remove them in Settings > Voice.
const LEARNED_MAX_FIELDS = 30;
const LEARNED_MAX_WORDS = 40;
const LEARNED_AUTO_FIX_COUNT = 2;
const LEARNED_PROMPT_MAX_CHARS = 8000;

function learnedStorageKey() {
  return (authBusiness && authBusiness.id) ? `korva_learned_${authBusiness.id}` : 'korva_learned';
}

function getLearned() {
  let l = null;
  try { l = JSON.parse(localStorage.getItem(learnedStorageKey()) || 'null'); } catch (e) { /* unreadable: start again */ }
  if (!l || typeof l !== 'object') l = {};
  return {
    fields: Array.isArray(l.fields) ? l.fields : [],
    words: Array.isArray(l.words) ? l.words : [],
    removed: Array.isArray(l.removed) ? l.removed : [],
    updatedAt: l.updatedAt || 0,
  };
}

function storeLearned(l, { sync = true } = {}) {
  l.fields = l.fields.slice(-LEARNED_MAX_FIELDS);
  // The words fixed most often are kept, then the newest.
  l.words = l.words.sort((a, b) => (b.count - a.count) || (b.at - a.at)).slice(0, LEARNED_MAX_WORDS);
  l.removed = l.removed.slice(-200);
  if (sync) l.updatedAt = Date.now();
  try { localStorage.setItem(learnedStorageKey(), JSON.stringify(l)); } catch (e) { return; }
  if (sync && typeof scheduleBusinessSync === 'function') scheduleBusinessSync();
  renderLearnedList();
}

const learnedId = () => 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const learnedNorm = v => String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');
const learnedClip = (v, n) => { const t = String(v || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

// The sentence of a note that a field's value came from: the one sharing
// the most words with the value and the field's name. Notes from the phone's
// own speech have no full stops, so a long run is cut into 20-word pieces.
function saidAbout(transcript, words) {
  const stem = w => w.replace(/s$/, '');
  const want = new Set(keyWords(words).map(stem));
  if (!want.size || !transcript) return '';
  const parts = [];
  String(transcript).split(/(?<=[.!?])\s+/).forEach(s => {
    const w = s.split(/\s+/).filter(Boolean);
    for (let i = 0; i < w.length; i += 20) parts.push(w.slice(i, i + 24).join(' '));
  });
  let best = '', score = 0;
  parts.forEach(p => {
    const n = keyWords(p).filter(w => want.has(stem(w))).length;
    if (n > score) { score = n; best = p; }
  });
  return learnedClip(best, 200);
}

// A field's name as the inspector sees it; "What" under a side line reads
// as "Wood Decay Fungi (Rot): What".
function fieldLabelText(key) {
  const el = document.getElementById('f-' + key);
  const label = el && getFieldLabel(el);
  if (!label) return key;
  const field = el.closest('.field');
  const pairHead = field && field.closest('.field-pair')?.querySelector(':scope > .field:first-child');
  const lead = pairHead && pairHead !== field ? pairHead.querySelector('.field-label')?.textContent.trim() + ': ' : '';
  return learnedClip(lead + label.textContent, 80);
}

// Called by populateFields() for each field a note filled, with what this
// note gave it (a list-like field may also hold earlier notes' words).
function rememberAiFill(key, val, transcript) {
  if (!transcript) return;
  if (!reportData.aiFilled || typeof reportData.aiFilled !== 'object') reportData.aiFilled = {};
  const label = fieldLabelText(key);
  reportData.aiFilled[key] = { v: String(val), said: saidAbout(transcript, label + ' ' + val) };
}

// Called by commitEdit() when the inspector sets or clears a field. Adding
// to what the AI wrote isn't a correction; changing or removing it is. A
// second edit of the same fill updates its correction, and putting the AI's
// answer back removes it.
function learnFieldCorrection(key, value) {
  const fill = reportData.aiFilled && reportData.aiFilled[key];
  if (!fill) return;
  const ai = learnedNorm(fill.v), fixed = learnedNorm(value);
  const l = getLearned();
  const i = fill.cid ? l.fields.findIndex(f => f.id === fill.cid) : -1;
  if (fixed === ai || (ai.length >= 12 && fixed.includes(ai))) {
    if (i >= 0) { l.fields.splice(i, 1); delete fill.cid; storeLearned(l); }
    return;
  }
  const entry = { id: fill.cid || learnedId(), key, label: fieldLabelText(key), said: fill.said || '', ai: learnedClip(fill.v, 160), fixed: fixed ? learnedClip(value, 160) : '', at: Date.now() };
  if (i >= 0) l.fields[i] = entry;
  else {
    // The same fix made before is replaced by this one, not kept twice.
    l.fields = l.fields.filter(f => !(f.key === key && learnedNorm(f.ai) === learnedNorm(entry.ai) && learnedNorm(f.fixed) === learnedNorm(entry.fixed)));
    l.fields.push(entry);
  }
  fill.cid = entry.id;
  storeLearned(l);
}

// Where two transcripts differ, word by word: [{ from: [words], to: [words],
// before, after, toStart }] (toStart: the new words begin a sentence), from a longest-common-run match on the lowercased words.
const diffWord = w => w.toLowerCase().replace(/[^a-z0-9%'-]+/g, '');
function wordDiffHunks(a, b) {
  const A = String(a).split(/\s+/).filter(w => diffWord(w)), B = String(b).split(/\s+/).filter(w => diffWord(w));
  const x = A.map(diffWord), y = B.map(diffWord);
  if (x.length * y.length > 1500000) return [];
  const L = Array.from({ length: x.length + 1 }, () => new Uint16Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) {
    L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  }
  const hunks = [];
  let i = 0, j = 0, cur = null;
  const close = () => { if (cur) { cur.after = x[i] || ''; cur.afterTo = y[j] || ''; hunks.push(cur); cur = null; } };
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { close(); i++; j++; continue; }
    if (!cur) cur = { from: [], to: [], before: x[i - 1] || '', toStart: j === 0 || /[.!?]$/.test(B[j - 1]) };
    if (j < y.length && (i >= x.length || L[i][j + 1] >= L[i + 1][j])) cur.to.push(B[j++]);
    else cur.from.push(A[i++]);
  }
  close();
  return hunks;
}

// A word fix is a few misheard words swapped for a few others. A one-word
// fix keeps the next word with it ("bearer holes" to "borer holes"), since
// the word on its own is usually right. Numbers changed are facts
// corrected, not words misheard, so they're skipped.
function wordFixesFromEdit(heardText, typedText) {
  const fixes = [];
  wordDiffHunks(heardText, typedText).forEach(h => {
    if (!h.from.length || !h.to.length || h.from.length > 5 || h.to.length > 6) return;
    const from = h.from.map(diffWord), to = h.to.map(w => w.replace(/[.,;:!?]+$/, ''));
    if (from.join(' ') === to.map(diffWord).join(' ')) return;
    if (from.every(w => /^\d/.test(w)) || to.every(w => /^\d/.test(w))) return;
    // A capital that only starts a sentence isn't part of the fix; a
    // brand or genus keeps its own.
    if (h.toStart && !TRANSCRIPTION_VOCAB.some(v => v.toLowerCase() === diffWord(to[0]))) to[0] = to[0][0].toLowerCase() + to[0].slice(1);
    if (from.length === 1) {
      if (h.after && h.after === h.afterTo) { from.push(h.after); to.push(h.after); }
      else if (h.before) { from.unshift(h.before); to.unshift(h.before); }
      else return;
    }
    fixes.push({ heard: from.join(' '), meant: to.join(' ') });
  });
  return fixes;
}

function learnWordFixes(fixes) {
  if (!fixes.length) return;
  const l = getLearned();
  fixes.forEach(f => {
    const have = l.words.find(w => w.heard === f.heard);
    if (have && learnedNorm(have.meant) === learnedNorm(f.meant)) { have.count++; have.at = Date.now(); }
    else if (have) Object.assign(have, { meant: f.meant, count: 1, at: Date.now() });
    else l.words.push({ id: learnedId(), heard: f.heard, meant: f.meant, count: 1, at: Date.now() });
  });
  storeLearned(l);
}

// The transcript box as it was when the inspector tapped into it. What they
// changed is learned when they leave it, or when the note is filled.
let transcriptAtFocus = null;
function rememberTranscriptAtFocus(el) {
  transcriptAtFocus = el.classList.contains('active') ? el.textContent : null;
}
function learnFromTranscriptEdit() {
  if (transcriptAtFocus === null) return;
  const heard = transcriptAtFocus;
  transcriptAtFocus = null;
  if (heard.trim() && currentTranscript.trim() && heard !== currentTranscript) learnWordFixes(wordFixesFromEdit(heard, currentTranscript));
}

// Word fixes made twice are made in every transcript, the way
// correctKnownMishearings() makes its own.
function applyLearnedWordFixes(text) {
  if (!text) return text;
  let words;
  try { words = getLearned().words.filter(w => w.count >= LEARNED_AUTO_FIX_COUNT); } catch (e) { return text; }
  words.forEach(w => {
    const parts = String(w.heard).split(' ').filter(Boolean).map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!parts.length) return;
    const re = new RegExp('(^|[^a-z0-9])(' + parts.join('[\\s,.]+') + ')(?![a-z0-9])', 'gi');
    text = text.replace(re, (m, pre, hit, at, all) => {
      const start = /^\s*$|[.!?]\s+$/.test(all.slice(0, at + pre.length));
      return pre + (start ? w.meant[0].toUpperCase() + w.meant.slice(1) : w.meant);
    });
  });
  return text;
}

// The business's corrections, as a second block of instructions for the
// extraction. Newest last, and cut to a size that keeps every call cheap.
function learnedPromptBlock() {
  const l = getLearned();
  if (!l.fields.length && !l.words.length) return '';
  const lines = [];
  if (l.words.length) {
    lines.push('Words the phone misheard for this business (heard → meant):');
    l.words.forEach(w => lines.push(`- "${w.heard}" → "${w.meant}"`));
  }
  if (l.fields.length) {
    lines.push('Fields the inspector corrected after you filled them (the words said, what you filled, what it should have been):');
    l.fields.slice().reverse().forEach(f => {
      lines.push(`- ${f.label}.${f.said ? ` Said: "${f.said}".` : ''} You filled: "${f.ai}". Corrected to: ${f.fixed ? `"${f.fixed}"` : 'left blank'}.`);
    });
  }
  let body = '';
  for (const line of lines) {
    if (body.length + line.length + 1 > LEARNED_PROMPT_MAX_CHARS) break;
    body += line + '\n';
  }
  return 'THIS BUSINESS\'S OWN CORRECTIONS\nThe inspectors at this business fixed these after earlier notes. Learn from them: they show the words the phone mishears for their voices and how they want things recorded. When this note has the same words in the same kind of sentence, follow the correction. They come from earlier jobs: take nothing from them as a fact about this note.\n' + body.trim();
}

// The words the inspector corrected to, for Whisper's word hint.
function learnedHintWords(maxChars) {
  let out = '';
  getLearned().words.forEach(w => {
    const add = (out ? ', ' : '') + w.meant;
    if (out.length + add.length <= maxChars) out += add;
  });
  return out;
}

// Settings > Voice: what SAYON has learned, each with a Remove.
function renderLearnedList() {
  const list = document.getElementById('learnedList');
  if (!list) return;
  const l = getLearned();
  const forget = document.getElementById('learnedForgetAll');
  if (forget) forget.hidden = !(l.fields.length || l.words.length);
  if (!l.fields.length && !l.words.length) {
    list.innerHTML = '<div class="learned-empty">Nothing yet. Fix a word in the transcript box, or a box the AI filled, and it shows here.</div>';
    return;
  }
  const row = (id, text, note) => `<div class="learned-row"><div class="learned-text">${text}${note ? `<span class="learned-note">${note}</span>` : ''}</div><button type="button" class="link-btn learned-remove" onclick="forgetLearned('${id}')" aria-label="Remove">Remove</button></div>`;
  list.innerHTML =
    l.words.map(w => row(w.id, `"${escapeHtml(w.heard)}" is "${escapeHtml(w.meant)}"`,
      w.count >= LEARNED_AUTO_FIX_COUNT ? 'Fixed automatically' : 'Fix it once more and it’s fixed automatically')).join('') +
    l.fields.slice().reverse().map(f => row(f.id, `${escapeHtml(f.label)}: "${escapeHtml(f.ai)}" is ${f.fixed ? `"${escapeHtml(f.fixed)}"` : 'left blank'}`,
      f.said ? `When you said "${escapeHtml(learnedClip(f.said, 90))}"` : '')).join('');
}

function forgetLearned(id) {
  const l = getLearned();
  l.fields = l.fields.filter(f => f.id !== id);
  l.words = l.words.filter(w => w.id !== id);
  l.removed.push(id);
  storeLearned(l);
}

function forgetAllLearned() {
  if (!confirm('Forget everything SAYON has learned from your corrections?')) return;
  const l = getLearned();
  l.removed.push(...l.fields.map(f => f.id), ...l.words.map(w => w.id));
  l.fields = []; l.words = [];
  storeLearned(l);
  showToast('Forgotten', 'info');
}

// Two copies of what was learned (the account's and this phone's) put
// together: every correction either has, less any removed on either.
function mergeLearned(a, b) {
  const removed = [...new Set([...(a.removed || []), ...(b.removed || [])])];
  const gone = new Set(removed);
  const byId = (lists, pick) => {
    const m = new Map();
    lists.flat().forEach(e => { if (e && e.id && !gone.has(e.id)) { const h = m.get(e.id); m.set(e.id, h ? pick(h, e) : e); } });
    return [...m.values()];
  };
  return {
    fields: byId([a.fields || [], b.fields || []], (x, y) => (y.at > x.at ? y : x)).sort((x, y) => x.at - y.at),
    words: byId([a.words || [], b.words || []], (x, y) => ((y.count > x.count || (y.count === x.count && y.at > x.at)) ? y : x)),
    removed,
    updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0),
  };
}

// ── TEST MODE ─────────────────────────────────────────────────────────────
// Owner-only switch in Settings. While it's on, every note sent to the
// AI is saved to the owner's own Supabase table (supabase/test-notes.sql)
// with what came back, so a batch of real recordings can be scored on
// tests/extraction later. It never goes near Sentry or PostHog, and a failed
// save is dropped silently: testing must never get in the way of the report.
const TEST_MODE_KEY = 'korva_test_mode';

// The switch is for checking the AI on a business set up for it
// (businesses.settings.testMode), not for every customer.
function testModeAllowed() {
  return isBusinessOwner() && !!(authBusiness && authBusiness.settings && authBusiness.settings.testMode);
}
function testModeOn() {
  try { return localStorage.getItem(TEST_MODE_KEY) === '1' && testModeAllowed(); } catch (e) { return false; }
}

function saveTestNote(transcript, extraction, problem, seconds) {
  if (!testModeOn() || !navigator.onLine) return;
  fetch(`${SUPABASE_URL}/rest/v1/test_notes`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Prefer': 'return=minimal' }),
    body: JSON.stringify({ transcript: String(transcript).slice(0, 100000), extraction, problem, seconds }),
  }).catch(() => {});
}

function toggleTestMode() {
  try { localStorage.setItem(TEST_MODE_KEY, testModeOn() ? '0' : '1'); } catch (e) {}
  restoreTestModeSetting();
}

// A label on the mic popup, so the owner can see before recording that
// this browser will save the note (the switch is kept per browser).
function showTestModeBadge() {
  const badge = document.getElementById('testModeBadge');
  if (badge) badge.hidden = !testModeOn();
}

// The row only shows where test mode is allowed (see testModeAllowed).
function restoreTestModeSetting() {
  const row = document.getElementById('testModeRow');
  if (row) row.hidden = !testModeAllowed();
  const btn = document.getElementById('toggleTestMode');
  if (btn) {
    const on = testModeOn();
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
  }
}

// A problem that belongs to one note (too long, an unreadable answer) and
// would repeat on every retry, as opposed to the signal, the sign-in or the
// plan, which affect every note and clear up on their own.
function isNoteSpecificProblem(err) {
  return !!(err && (err.tooLong || err.badAnswer || err.status === 413));
}

// What the inspector reads when the AI can't fill in a note. The note is
// kept either way, so this says why and what to do about it.
function extractionProblem(err) {
  switch (err && err.status) {
    case 401: return 'Your sign-in has expired. Close SAYON, open it again and sign in';
    case 403: return 'Your account is still being set up. Close SAYON and open it again';
    case 402: return 'Your SAYON plan has ended. Subscribe in Menu › Billing';
    case 429: return 'This month\'s AI fills are used up. Your note is kept. Upgrade in Menu › Billing, or they come back on the 1st';
    case 413: return 'A note is too long for the AI in one go. Delete it and say it again in shorter parts';
  }
  if (err && err.tooLong) return 'A note is too long for the AI in one go. Delete it and say it again in shorter parts';
  if (err && err.badAnswer) return 'The AI\'s answer couldn\'t be read. Delete the note and say it again, or type it';
  const reason = ((err && err.message) ? String(err.message) : 'unknown error').slice(0, 140);
  return `The AI couldn't read it (${reason})`;
}

// whileRecording: a fill while the mic is still on. It reads the
// note as it stood when it started; words spoken during the AI call stay in
// the box for the next fill, and the voice popover and the after-Extract
// sheet stay out of the way. Returns true when the report was filled.
// A note sent from one job whose answer came back after another job was
// opened. It goes back to its own job as a waiting note, which fills in
// when that job is next opened. A job never saved stays in the box.
function noteForEarlierJob(target, note) {
  const id = savedIdFor.get(target);
  const reports = getSavedReports();
  const entry = id && reports.find(r => r.id === id);
  setAI('ready', 'AI ready');
  if (!isRecording) document.getElementById('extractBtn').disabled = false;
  if (!entry) {
    showToast('You changed job while that note was filling in, so it is still in the box', 'info');
    return;
  }
  const notes = Array.isArray(entry.reportData.pendingNotes) ? entry.reportData.pendingNotes : [];
  entry.reportData.pendingNotes = [...notes, { id: 'note_' + Date.now().toString(36), text: note.trim(), at: Date.now() }];
  entry.savedAt = Date.now();
  if (!setSavedReports(reports)) return;
  supabaseSave(entry, true);
  keepFilledNote(note);
  currentTranscript = currentTranscript.startsWith(note) ? currentTranscript.slice(note.length).trimStart() : '';
  saveDraft();
  const box = document.getElementById('transcriptBox');
  box.textContent = currentTranscript || 'Tap the mic and start speaking, or tap here to type instead.';
  box.classList.toggle('active', !!currentTranscript);
  showToast(`That note will fill in ${entry.address || 'the last job'} next time you open it`, 'info');
}

// A note that has gone into the report leaves the box, so it isn't sent
// twice, but stays readable above it until the job changes.
function keepFilledNote(note) {
  const text = String(note || '').trim();
  const wrap = document.getElementById('transcriptDone');
  if (!text || !wrap) return;
  const body = wrap.querySelector('.transcript-done-text');
  body.textContent = (body.textContent ? body.textContent + ' ' : '') + text;
  wrap.hidden = false;
}

function clearFilledNotes() {
  voiceJobEpoch++; // words still with Whisper belong to the old job
  const wrap = document.getElementById('transcriptDone');
  if (!wrap) return;
  wrap.querySelector('.transcript-done-text').textContent = '';
  wrap.hidden = true;
}

let fillRunning = false, fillAgain = false;
async function processTranscript(opts) {
  // One fill at a time, so the same words are never sent twice. A fill
  // asked for meanwhile runs after, on whatever words are left.
  if (fillRunning) { fillAgain = true; return false; }
  fillRunning = true;
  try { return await runFill(opts); }
  finally {
    fillRunning = false;
    if (fillAgain) {
      fillAgain = false;
      if (!isRecording && currentTranscript.trim()) setTimeout(() => processTranscript(), 0);
    }
  }
}

async function runFill({ whileRecording = false } = {}) {
  // The last phrase may still be with Whisper.
  if (!whileRecording) await whisperSettled();
  learnFromTranscriptEdit();
  const note = currentTranscript;
  if (!note.trim()) return false;
  setAI('thinking', 'Filling in the report from your note…');
  document.getElementById('extractBtn').disabled = true;
  const before = extractSnapshot();
  const fillTarget = reportData;
  let extracted = false;

  try {
    // Notes fill the report in the order they were dictated. If earlier
    // notes are still waiting (no signal in the subfloor, say), this one
    // joins the queue behind them and the queue is run, so an older note
    // can never land on top of a newer one and overwrite it.
    if (getPendingNotes().length && navigator.onLine) {
      if (!queuePendingNote(note)) {
        setAI('ready', 'AI ready');
        if (!isRecording) document.getElementById('extractBtn').disabled = false;
        return false;
      }
      extractSummaryOwned = true;
      try { await processPendingNotes(true); } finally { extractSummaryOwned = false; }
      extracted = !getPendingNotes().length;
    } else {
      const data = await requestExtraction(note);
      if (reportData !== fillTarget) { noteForEarlierJob(fillTarget, note); return false; }
      await populateFields(data, note);
      extracted = true;
      pendingNotesProblem = null;
      setAI('ready', 'Data extracted');
      // The after-Extract sheet says what was filled, so no toast here.
    }
  } catch (err) {
    // A note too long to answer in one go would fail the same way every
    // time, so it stays in the box to be split up.
    if (err.tooLong || err.status === 413) {
      setAI('ready', 'AI ready');
      if (!isRecording) document.getElementById('extractBtn').disabled = false;
      showToast('That note is too long for the AI in one go. Split it into shorter notes and fill each one in', 'error');
      return false;
    }
    // Nothing is guessed from the note: it waits with any others until the
    // AI can read it. A problem of the note's own (an unreadable answer) is
    // written on the note, so the queue skips it instead of stopping.
    pendingNotesProblem = (err.noSignal || isNoteSpecificProblem(err)) ? null : extractionProblem(err);
    if (reportData !== fillTarget) { noteForEarlierJob(fillTarget, note); return false; }
    if (!queuePendingNote(note)) {
      setAI('ready', 'AI ready');
      if (!isRecording) document.getElementById('extractBtn').disabled = false;
      return false;
    }
    if (err.kept) {
      setAI('ready', 'Note saved');
      showToast('Note saved under Waiting notes. Tap Fill in now when you\'re ready', 'info');
    } else if (isNoteSpecificProblem(err)) {
      const waiting = getPendingNotes()[getPendingNotes().length - 1];
      if (waiting) { waiting.problem = extractionProblem(err); saveDraft(); renderPendingNotes(); }
      setAI('ready', 'Note saved');
      showToast(`${extractionProblem(err)}. Your note is saved under Waiting notes`, 'error');
    } else if (err.noSignal) {
      setAI('ready', 'Saved until there\'s signal');
      showToast('No signal, so your note is saved. It fills in the report when you\'re back online', 'info');
    } else {
      setAI('ready', 'Note saved');
      showToast(`${pendingNotesProblem}. Your note is saved and fills in once that's sorted`, 'error');
    }
  }

  // On a phone the popover closes to show the filled report, unless the
  // inspector is already dictating again or has closed it themselves.
  if (window.innerWidth <= 768 && !whileRecording && !isRecording && document.getElementById('voicePopover').classList.contains('open')) toggleVoicePopover();
  keepFilledNote(note);
  currentTranscript = currentTranscript.startsWith(note) ? currentTranscript.slice(note.length).trimStart() : '';
  saveDraft();
  const box = document.getElementById('transcriptBox');
  box.textContent = currentTranscript || 'Tap the mic and start speaking, or tap here to type instead.';
  box.classList.toggle('active', !!currentTranscript);
  lowConfidenceFlagged = false;
  const warnElDone = document.getElementById('lowConfidenceWarning');
  if (warnElDone) warnElDone.classList.remove('show');
  dismissCleanupSuggestion();
  dismissServerTranscript();
  if (extracted && whileRecording) {
    const n = countExtractFilled(before);
    if (n) showToast(`Filled ${n} field${n !== 1 ? 's' : ''}. Still listening`, 'info');
  } else if (extracted) showExtractSummary(before);
  return extracted;
}

// ── WAITING NOTES ───────────────────────────────────────────────────────
// A dictated note the AI can't read yet waits on the report in
// reportData.pendingNotes, so it's saved with the draft and the saved
// report. That's usually no signal (subfloors, roof voids, regional jobs),
// but can also be a refused call (plan ended, expired sign-in). It's sent
// again when the phone is back online, the app is reopened or the
// inspector taps Fill in now. Nothing is filled in from it until the AI
// reads it: a guessed answer in a report is worse than a blank one.
const MAX_PENDING_NOTES = 50;
let pendingNotesRunning = false;
let pendingNotesProblem = null; // why the AI last refused; null means no signal

function getPendingNotes() {
  return Array.isArray(reportData.pendingNotes) ? reportData.pendingNotes : [];
}

function queuePendingNote(text) {
  const notes = getPendingNotes();
  if (notes.length >= MAX_PENDING_NOTES) {
    showToast(`${MAX_PENDING_NOTES} notes are already waiting. Fill those in before adding more`, 'error');
    return false;
  }
  const id = 'note_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  reportData.pendingNotes = [...notes, { id, text: text.trim(), at: Date.now() }];
  saveDraft();
  renderPendingNotes();
  return true;
}

function removePendingNote(id) {
  if (!confirm('Delete this saved note? It hasn\'t been added to the report yet.')) return;
  reportData.pendingNotes = getPendingNotes().filter(n => n.id !== id);
  if (!reportData.pendingNotes.length) delete reportData.pendingNotes;
  saveDraft();
  renderPendingNotes();
}

function renderPendingNotes() {
  const notes = getPendingNotes();
  const n = notes.length;
  const badge = document.getElementById('pendingNotesBadge');
  if (badge) { badge.textContent = n; badge.style.display = n ? '' : 'none'; }
  const bar = document.getElementById('pendingNotesBar');
  if (!bar) return;
  bar.style.display = n ? '' : 'none';
  document.getElementById('pendingNotesText').textContent = pendingNotesProblem
    ? `${n} note${n !== 1 ? 's' : ''} waiting. ${pendingNotesProblem}`
    : `${n} note${n !== 1 ? 's' : ''} waiting for signal`;
  const btn = document.getElementById('pendingNotesBtn');
  btn.disabled = pendingNotesRunning;
  btn.textContent = pendingNotesRunning ? 'Filling in…' : 'Fill in now';
  document.getElementById('pendingNotesList').innerHTML = notes.map(note => {
    const time = new Date(note.at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
    // A note with its own problem (too long, unreadable answer) is skipped
    // by the queue and shows why, so the inspector can delete and redo it
    // while the notes behind it still fill in.
    const problem = note.problem ? `<span class="pending-note-text" style="color:var(--risk)">${escapeHtml(note.problem)}</span>` : '';
    return `<div class="pending-note">
      <span class="pending-note-time">${time}</span>
      <span class="pending-note-text">${escapeHtml(note.text)}</span>${problem}
      <button class="pending-note-remove" onclick="removePendingNote('${note.id}')" title="Delete note" aria-label="Delete note">✕</button>
    </div>`;
  }).join('');
}

// Sends the open report's waiting notes to the AI, oldest first. Stops if
// the signal drops again or a different report is opened part-way through,
// so a note can only ever fill in the report it was dictated on.
async function processPendingNotes(manual) {
  if (pendingNotesRunning || !getPendingNotes().length || isReportLocked()) return;
  if (!navigator.onLine) {
    if (manual) showToast('Still no signal. The notes fill in when you\'re back online', 'info');
    return;
  }
  const target = reportData;
  const before = extractSnapshot();
  pendingNotesRunning = true;
  renderPendingNotes();
  setAI('thinking', 'Filling in saved notes…');
  let filled = 0, stillNoSignal = false, stuck = 0, kept = false;
  try {
    // Oldest first. A note with a problem of its own (too long, an answer
    // that isn't JSON) is marked and skipped so it can't block the notes
    // behind it; a problem that would hit every note (no signal, sign-in,
    // plan) stops the run.
    const skip = new Set();
    for (let note = getPendingNotes().find(n => !skip.has(n.id)); note && reportData === target; note = getPendingNotes().find(n => !skip.has(n.id))) {
      let extracted;
      try {
        extracted = await requestExtraction(note.text);
      } catch (err) {
        if (err.kept) { kept = true; break; }
        if (err.noSignal) { stillNoSignal = true; break; }
        if (isNoteSpecificProblem(err)) {
          note.problem = extractionProblem(err);
          skip.add(note.id);
          stuck++;
          saveDraft();
          continue;
        }
        pendingNotesProblem = extractionProblem(err);
        if (manual) showToast(`${pendingNotesProblem}. Your notes are still saved`, 'error');
        break;
      }
      pendingNotesProblem = null;
      if (reportData !== target) break;
      // Wait for the staggered field writes, so the saves below hold them.
      await populateFields(extracted, note.text);
      if (reportData !== target) break;
      reportData.pendingNotes = getPendingNotes().filter(n => n.id !== note.id);
      filled++;
      saveDraft();
    }
  } finally {
    pendingNotesRunning = false;
    if (reportData === target && !getPendingNotes().length) delete reportData.pendingNotes;
    renderPendingNotes();
    setAI('ready', 'AI ready');
  }
  // A report that's already in Saved Reports is re-saved, so its copy
  // there doesn't keep the notes and fill them in a second time.
  if (filled && reportData === target && currentReportId && getSavedReports().some(r => r.id === currentReportId)) {
    saveCurrentReport(true);
  }
  if (filled) showToast(`${filled} saved note${filled !== 1 ? 's' : ''} filled in. Check the report`, 'success');
  // Fill in now shows what the notes filled; processTranscript() shows its
  // own sheet when it ran the queue.
  if (filled && manual && !extractSummaryOwned && reportData === target) showExtractSummary(before);
  else if (kept) showToast('Your notes are kept under Waiting notes. Tap Fill in now when you\'re ready', 'info');
  else if (stillNoSignal && manual) showToast('Still no signal. The notes fill in when you\'re back online', 'info');
  if (stuck && (manual || !filled)) showToast(`${stuck} note${stuck !== 1 ? 's' : ''} couldn't be read. See why under ${stuck !== 1 ? 'each note' : 'the note'}`, 'error');
}

// ── EXTRACT SUMMARY ─────────────────────────────────────────────────────
// After Extract, one sheet says how many fields the note filled and which
// of the fields that matter most are still blank, each a tap to that
// field. "Not used from your note" isn't listed: the extraction answer is
// field values, not which sentences they came from, so it can't be told
// reliably which sentences were left out.
let extractSummaryOwned = false; // processTranscript() is running the queue

const JOB_SUMMARY_FIELDS = ['jobAddress', 'jobSuburb', 'jobState', 'jobPostcode', 'jobClient', 'jobInspectionType'];

function extractSnapshot() {
  const data = {};
  Object.keys(reportData).forEach(k => { if (k !== 'findings' && k !== 'pendingNotes') data[k] = JSON.stringify(reportData[k]); });
  const findings = {};
  (reportData.findings || []).forEach(f => { if (f && f.id) findings[f.id] = { ...f }; });
  const job = {};
  JOB_SUMMARY_FIELDS.forEach(id => { const el = document.getElementById(id); job[id] = el ? el.value : ''; });
  return { data, findings, job };
}

const isBlankValue = v => v === undefined || v === null || v === '' || (typeof v === 'string' && !v.trim());

function countExtractFilled(before) {
  let n = 0;
  Object.keys(reportData).forEach(k => {
    if (k === 'findings' || k === 'pendingNotes' || k === 'noteText' || k === 'heardNotes' || k === 'weatherFilled' || isBlankValue(reportData[k])) return;
    if (JSON.stringify(reportData[k]) !== before.data[k]) n++;
  });
  (reportData.findings || []).forEach(f => {
    if (!f) return;
    const old = before.findings[f.id] || {};
    ['termiteActivity', 'species', 'damageDescription', 'activityLocation', 'timberAffected', 'nestLocated', 'structuralConcern']
      .forEach(k => { if (!isBlankValue(f[k]) && f[k] !== old[k]) n++; });
  });
  JOB_SUMMARY_FIELDS.forEach(id => { const el = document.getElementById(id); if (el && el.value.trim() && el.value !== before.job[id]) n++; });
  return n;
}

// The fields an inspector most often has to come back for, when blank.
function extractBlanks() {
  const blanks = [];
  const blank = k => isBlankValue(reportData[k]);
  if (blank('structureType')) blanks.push({ label: 'structure type', target: 'f-structureType' });
  if (blank('height')) blanks.push({ label: 'height', target: 'f-height' });
  if (blank('existingSystem')) blanks.push({ label: 'termite management system', target: 'f-existingSystem' });
  const missing = findingsMissingReferral();
  if (missing.length) {
    const f = reportData.findings[missing[0] - 1];
    blanks.push({ label: `builder referral (finding${missing.length > 1 ? 's' : ''} ${missing.join(', ')})`, target: 'finding-card-' + f.id, referral: true });
  }
  if (blank('slabEdge')) blanks.push({ label: 'slab edge', target: 'f-slabEdge' });
  if (blank('riskLevel')) blanks.push({ label: 'risk level', target: 'f-riskLevel' });
  return blanks;
}

let extractSummaryBlanks = [];
let extractSummaryBefore = null;   // the snapshot the sheet counts from, kept so a fix can redraw it
let extractSummaryFilledCount = 0;

function showExtractSummary(before) {
  const overlay = document.getElementById('extractSummaryOverlay');
  if (!overlay) return;
  extractSummaryBefore = before || extractSummaryBefore || extractSnapshot();
  const n = extractSummaryFilledCount = countExtractFilled(extractSummaryBefore);
  extractSummaryBlanks = extractBlanks();
  document.getElementById('extractSummaryFilled').textContent = n
    ? `Filled ${n} field${n !== 1 ? 's' : ''} from your note.`
    : 'Nothing new was filled from your note.';
  document.getElementById('extractSummaryBlankLabel').style.display = extractSummaryBlanks.length ? '' : 'none';
  document.getElementById('extractSummaryBlanks').innerHTML = extractSummaryBlanks.length
    ? extractSummaryBlanks.map((b, i) => `<button class="extract-blank-btn" onclick="goToExtractBlank(${i})">${escapeHtml(b.label)}<span aria-hidden="true">›</span></button>`).join('')
    : '<div class="extract-summary-done">None of the key fields are blank.</div>';
  // Before you leave: what the standard needs that the notes didn't cover.
  const gaps = driveawayGaps();
  document.getElementById('extractSummaryGaps').innerHTML = gaps.length
    ? gaps.map(g => `<div class="extract-gap"><span>${escapeHtml(g.text)}</span>${g.fix ? `<span class="send-review-fixes">${g.fix}</span>` : ''}</div>`).join('')
    : '<div class="extract-summary-done">Nothing the standard asks for is missing. Safe to leave.</div>';
  const readBtn = document.getElementById('extractReadBackBtn');
  if (readBtn) { readBtn.hidden = !('speechSynthesis' in window); readBtn.textContent = 'Read it back'; }
  overlay.classList.add('open');
}

function closeExtractSummary() {
  const overlay = document.getElementById('extractSummaryOverlay');
  if (overlay) overlay.classList.remove('open');
  stopReadBack();
}

// ── SPOKEN READ-BACK ────────────────────────────────────────────────────
// The sheet's headline, said aloud, so the inspector can check what the
// note filled with their hands still full. Only the questions a client
// asks first, then what's left to do. Same facts as the sheet, never more.
function readBackText() {
  const lines = [];
  const n = extractSummaryFilledCount;
  lines.push(n ? `Filled ${n} field${n !== 1 ? 's' : ''} from your note.` : 'Nothing new was filled from your note.');
  const { groups, limited } = reportSummary();
  const items = {};
  groups.forEach(g => g.items.forEach(([q, a, , , detail]) => { items[q] = { a, detail }; }));
  const say = (q, label) => {
    const it = items[q];
    if (!it) return;
    const a = it.a === 'NOT RECORDED' ? 'not recorded' : it.a.toLowerCase();
    lines.push(`${label}: ${a}${it.detail && it.a !== 'NOT RECORDED' ? `, ${it.detail}` : ''}.`);
  };
  say('Live termites found?', 'Live termites');
  say('Termite workings or damage found?', 'Workings or damage');
  say('Builder or engineer referral?', 'Builder referral');
  say('Conditions conducive to timber pests?', 'Conducive conditions');
  say('Termite treatment recommended?', 'Treatment recommended');
  say('Risk of termite attack', 'Risk');
  if (limited.length) lines.push(`${limited.length} area${limited.length === 1 ? '' : 's'} not fully inspected: ${limited.join('; ')}.`);
  const blanks = extractSummaryBlanks.map(b => b.label);
  if (blanks.length) lines.push(`Left blank: ${blanks.join(', ')}.`);
  const gaps = driveawayGaps().map(g => g.text.replace(/"/g, ''));
  lines.push(gaps.length ? `Before you leave: ${gaps.join('. ')}.` : 'Nothing the standard asks for is missing.');
  return lines.join(' ');
}

let readBackUtterance = null;
function toggleReadBack() {
  if (!('speechSynthesis' in window)) return;
  if (speechSynthesis.speaking || speechSynthesis.pending) { stopReadBack(); return; }
  const u = new SpeechSynthesisUtterance(readBackText());
  u.lang = 'en-AU';
  u.rate = 1;
  const voice = speechSynthesis.getVoices().find(v => /en[-_]AU/i.test(v.lang));
  if (voice) u.voice = voice;
  const btn = document.getElementById('extractReadBackBtn');
  u.onend = u.onerror = () => { readBackUtterance = null; if (btn) btn.textContent = 'Read it back'; };
  readBackUtterance = u;
  if (btn) btn.textContent = 'Stop reading';
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
  track('read_back');
}
function stopReadBack() {
  if (!('speechSynthesis' in window) || !readBackUtterance) return;
  readBackUtterance = null;
  speechSynthesis.cancel();
  const btn = document.getElementById('extractReadBackBtn');
  if (btn) btn.textContent = 'Read it back';
}

function goToExtractBlank(i) {
  const b = extractSummaryBlanks[i];
  closeExtractSummary();
  if (!b) return;
  goToReportField(b.target, b.referral);
}

// Takes the inspector to a field in the report: its section, its group
// opened, scrolled into view and flashed.
function goToReportField(target, referral) {
  const popover = document.getElementById('voicePopover');
  if (popover && popover.classList.contains('open')) toggleVoicePopover();
  let el = document.getElementById(target);
  if (!el) return;
  if (el.classList.contains('choice-source')) el = document.getElementById(target.replace(/^f-/, 'choices-')) || el;
  const section = el.closest('.report-section');
  if (section && section.id.startsWith('section-')) showSection(section.id.slice(8));
  openFieldGroups(el);
  if (referral) {
    // The "Builder or engineer referral" field inside the finding card.
    const label = [...el.querySelectorAll('.field-label')].find(l => /builder (or|\/) engineer/i.test(l.textContent));
    if (label && label.nextElementSibling) el = label.nextElementSibling;
  }
  setTimeout(() => {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (!el.hasAttribute('tabindex') && !/^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
    el.classList.add('extract-blank-flash');
    setTimeout(() => el.classList.remove('extract-blank-flash'), 1800);
  }, 60);
}

// ── COMPLIANCE PLATE SCAN ───────────────────────────────────────────────
// Photographs a termite management system durable notice/plate and asks
// the AI to read it, then fills existingSystem/existingSystemOther/
// durableNoticePresent the same way populateFields() already does for
// voice extraction — same "AI drafts, technician can always edit" model,
// just a photo instead of a transcript as the input. fromFile skips the
// camera and opens the photo library or files instead.
async function scanCompliancePlate(fromFile) {
  const btn = document.getElementById('scanPlateBtn');
  const fileBtn = document.getElementById('scanPlateFileBtn');
  const btnText = document.getElementById('scanPlateBtnText');
  if ((btn && btn.disabled) || (fileBtn && fileBtn.disabled)) return; // already running

  let base64 = null;
  let mediaType = 'image/jpeg';

  const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
  const cameraPlugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Camera;

  try {
    if (isNative && cameraPlugin) {
      const photo = await cameraPlugin.getPhoto({
        quality: 70,
        allowEditing: false,
        resultType: 'base64',
        source: fromFile ? 'PHOTOS' : 'PROMPT', // PROMPT lets the technician choose Camera or an existing photo
        direction: 'REAR',
      });
      if (!photo || !photo.base64String) return; // cancelled
      base64 = photo.base64String;
      mediaType = photo.format === 'png' ? 'image/png' : 'image/jpeg';
    } else {
      const picked = await pickImageFileAsBase64(!fromFile);
      if (!picked) return; // cancelled
      if (picked.unreadable) {
        showToast("Couldn't open that photo here. Try a JPEG or PNG, or take it with the phone", 'error');
        return;
      }
      ({ base64, mediaType } = picked);
    }
  } catch (e) {
    const msg = ((e && e.message) || '') + '';
    if (!/cancel/i.test(msg)) {
      showToast('Could not open the camera. Check the camera permission in Settings', 'error');
    }
    return;
  }

  // Keep the photo for the report, whether or not the plate can be read.
  try {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    await handleSectionPhotoFiles([new File([bytes], 'durable-notice', { type: mediaType })], 'durable');
  } catch (e) { console.warn('Could not keep the durable notice photo:', e); }

  if (btn) btn.disabled = true;
  if (fileBtn) fileBtn.disabled = true;
  if (btnText) btnText.textContent = 'Reading plate…';
  setAI('thinking', 'Reading the compliance plate…');

  try {
    const parsed = await askAiAboutPhoto({
      system: PLATE_SYSTEM_PROMPT, base64, mediaType, maxTokens: 2000, effort: 'low',
      text: 'Read this termite management system durable notice and return the JSON described in your instructions.',
    });

    if (parsed.systemFound === 'YES') {
      const update = {};
      if (parsed.existingSystem) update.existingSystem = parsed.existingSystem;
      if (parsed.existingSystemOther) update.existingSystemOther = parsed.existingSystemOther;
      update.durableNoticePresent = 'YES';
      populateFields(update);
      const label = [parsed.existingSystemOther, parsed.existingSystem].filter(Boolean).join(' — ') || 'system identified';
      showToast(`Plate read: ${label}`, 'success');
      if (parsed.extraDetails) {
        setTimeout(() => showToast(parsed.extraDetails, 'info'), 1600);
      }
    } else {
      showToast("Couldn't read a compliance plate in that photo. Try again in better light, or type it in", 'info');
    }
    setAI('ready', 'Ready');

  } catch (err) {
    console.warn('Plate scan failed:', err);
    showToast('Could not read the plate. Check your signal and try again', 'error');
    setAI('ready', 'Ready');
  } finally {
    if (btn) btn.disabled = false;
    if (fileBtn) fileBtn.disabled = false;
    if (btnText) btnText.textContent = 'Take a photo of the durable notice';
  }
}

// Web/PWA fallback for scanCompliancePlate() — no native Camera plugin there.
// useCamera opens the camera straight away; without it the phone offers the
// photo library and files. Resolves { base64, mediaType }, null when
// cancelled, or { unreadable: true } when the browser can't open the file.
// The photo is always re-drawn as a JPEG of at most 1600px first: a laptop
// photo can be a HEIC, or a full-size file too big for the AI to accept.
function pickImageFileAsBase64(useCamera) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (useCamera) input.capture = 'environment';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) { resolve(null); return; }
      try {
        const { blob } = await compressPhotoFile(file, { maxDim: 1600, quality: 0.85, maxBytes: 3500000 });
        const base64 = String(await blobToDataUrl(blob)).split(',')[1];
        resolve(base64 ? { base64, mediaType: 'image/jpeg' } : { unreadable: true });
      } catch (e) {
        console.warn('Could not open the durable notice photo:', e);
        resolve({ unreadable: true });
      }
    };
    input.click();
  });
}


// ── ASK THE AI ABOUT A PHOTO ────────────────────────────────────────────
// One photo and an instruction to the AI; the answer comes back as the JSON
// object the system prompt asks for. The plate scan, insect ID and Describe
// all go through here. Throws with .noSignal when the phone can't reach the
// AI, and with .status when the Worker refuses the call (sign-in, plan, the
// month's AI allowance). Each call is one call against the plan's allowance.
const AI_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
async function askAiAboutPhoto({ system, base64, mediaType, text, maxTokens, effort }) {
  const noSignal = (msg) => Object.assign(new Error(msg), { noSignal: true });
  if (!navigator.onLine) throw noSignal('no signal');
  let res, rawBody;
  try {
    res = await workerFetch('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        // Room for the model's thinking as well as the small JSON answer
        // (see callExtraction()).
        max_tokens: maxTokens,
        output_config: { effort },
        system,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: AI_IMAGE_TYPES.includes(mediaType) ? mediaType : 'image/jpeg', data: base64 } },
            { type: 'text', text },
          ],
        }],
      }),
    });
    rawBody = await res.text();
  } catch (err) {
    // fetch() only rejects when the request never got an answer.
    throw noSignal(err && err.name === 'AbortError' ? 'no answer in time' : 'no connection');
  }
  // A refusal from the Worker is plain text, not JSON.
  const refused = (msg) => Object.assign(new Error(msg), { status: res.status });
  let data;
  try {
    data = JSON.parse(rawBody);
  } catch {
    throw refused(`HTTP ${res.status}: ${rawBody.slice(0, 200) || '(empty response)'}`);
  }
  if (!res.ok || data.error) {
    throw refused('API error: ' + (data.error?.message || data.error?.type || `HTTP ${res.status}`));
  }
  const out = (data.content || []).map(i => i.text || '').join('');
  const parsed = JSON.parse(out.replace(/```json|```/g, '').trim());
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('the answer was not a JSON object');
  return parsed;
}

// A report photo as { base64, mediaType } for the AI, or null when the
// image can't be found or read.
async function photoForAi(photo) {
  const image = await getPhotoImage(photo);
  const match = /^data:([^;]+);base64,(.+)$/.exec(image ? await blobToDataUrl(image) : '');
  return match ? { mediaType: match[1], base64: match[2] } : null;
}

// ── INSECT / SPECIES PHOTO ID ───────────────────────────────────────────
// Analyses a photo the technician already attached via the normal Add
// Photos flow (reportData.photos) — deliberately opt-in per photo, not
// automatic on upload, since not every photo taken during an inspection is
// of a specimen worth identifying. Writes the result into that photo's own
// caption (only if it's still empty) as a plain-language suggestion — never
// into a Finding directly. The technician decides whether and where to use
// it, same "AI drafts, technician confirms" model as everywhere else here.
async function analyzeGalleryPhoto(photoId) {
  const photo = (reportData.photos || []).find(p => p.id === photoId);
  if (!photo) return;

  const btn = document.getElementById('analyzeBtn-' + photoId);
  if (btn && btn.disabled) return; // already running

  const image = await photoForAi(photo);
  if (!image) { showToast('Could not read that photo', 'error'); return; }

  if (btn) { btn.disabled = true; btn.textContent = 'Identifying…'; }
  setAI('thinking', 'Identifying the insect…');

  try {
    const parsed = await askAiAboutPhoto({
      system: INSECT_ID_SYSTEM_PROMPT, ...image, maxTokens: 4000, effort: 'medium',
      text: 'Identify the insect or insect damage shown in this photo and return the JSON described in your instructions.',
    });

    if (parsed.identified === 'YES' && parsed.species) {
      const confLabel = parsed.confidence ? parsed.confidence.toLowerCase() + ' confidence' : 'unconfirmed';
      const note = `Possible ID: ${parsed.species} (${confLabel})`;
      if (!photo.caption || !photo.caption.trim()) {
        photo.caption = note;
        renderPhotoGrid();
        saveDraft();
      }
      showToast(`${note}. Check it before you add it to a finding`, 'success');
      if (parsed.notes) {
        setTimeout(() => showToast(parsed.notes, 'info'), 1600);
      }
    } else {
      showToast(parsed.notes || "Couldn't identify anything with confidence in that photo", 'info');
    }
    setAI('ready', 'Ready');

  } catch (err) {
    console.warn('Photo analysis failed:', err);
    showToast('Could not analyse the photo. Check your signal and try again', 'error');
    setAI('ready', 'Ready');
  } finally {
    renderPhotoGrid(); // restores the button (re-render clears the disabled/label override above)
  }
}

// ── PHOTO DESCRIPTION ───────────────────────────────────────────────────
// Describe on a report photo: the AI looks at the photo and suggests a
// one-line caption (PHOTO_CAPTION_PROMPT). The suggestion shows under the
// caption box until the inspector taps Use (Add to caption when there's
// already one) or Not this; it never goes into the caption by itself.
// It waits on the photo as p.suggested, so a redraw, another section or
// the app being closed doesn't lose it, and it never prints.
// One tap is one AI call against the plan's monthly allowance, the same as
// a voice fill. That's why it isn't run on every photo as it's added: a
// job's worth of photos would use up the allowance the voice fills need.
const describingPhotos = new Set(); // ids of photos the AI is looking at
const SPARKLE_ICON = '<svg class="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/></svg>';

// The photo and the box it's in: a key of photosBySection, or 'other' for
// the Other photos section (reportData.photos).
function findReportPhoto(id) {
  for (const [section, list] of Object.entries(reportData.photosBySection || {})) {
    const photo = (list || []).find(p => p.id === id);
    if (photo) return { photo, section };
  }
  const photo = (reportData.photos || []).find(p => p.id === id);
  return photo ? { photo, section: 'other' } : null;
}

// Where in the report the photo was added, in words, so the AI knows why
// it was taken (never what's in it).
const PHOTO_PLACE_NAMES = {
  durable: 'Durable notice (the termite management system notice)', obstructions: 'Obstructions',
  restrictions: 'Restricted access', findings: 'Termite and borer findings', conducive: 'Conducive conditions',
  recommendations: 'Recommendations', other: 'Other photos',
};
function photoPlaceLabel(section) {
  const spot = /^spot-(hindered|restricted)-(.+)$/.exec(section);
  if (spot) {
    const [, kind, key] = spot;
    let where = key === '_other' ? 'another spot' : OBS_ZONES[key] ? zoneName(key) : 'an area';
    try {
      const exact = String(accessSpot(kind, key, accessZones(kind)) || '').trim();
      if (exact) where += ` (${exact.slice(0, 120)})`;
    } catch (e) {}
    return (kind === 'restricted' ? 'Restricted access: ' : 'Obstructions: ') + where;
  }
  const finding = /^finding-(.+)$/.exec(section);
  if (finding) {
    const termite = (reportData.findings || []).find(f => f.id === finding[1]);
    const borer = !termite && (reportData.borerFindings || []).find(b => b.id === finding[1]);
    const where = String((termite ? termite.activityLocation : borer ? borer.location : '') || '').trim();
    return (borer ? 'Borer finding' : 'Termite finding') + (where ? `, at ${where.slice(0, 120)}` : '');
  }
  return PHOTO_PLACE_NAMES[section] || 'Inspection photos';
}

// The AI's caption, tidied for the report. A severity word before what it
// describes comes out ("extensive damage" reads "damage"); the prompt
// forbids them and this is the backstop. Any other severity word, a
// structural verdict or a risk rating means the suggestion isn't shown.
const CAPTION_SEVERITY = '(?:minor|moderate|severe|extensive|significant|extreme)(?:ly)?';
const CAPTION_NOT_ALLOWED = new RegExp(`\\b${CAPTION_SEVERITY}\\b|\\bstructurally\\b|\\bstructural (?:damage|failure|integrity|soundness)\\b|\\bunsound\\b|\\bcompromised\\b|\\bunsafe\\b|\\brisk\\b`, 'i');
function cleanPhotoCaption(text) {
  let t = typeof text === 'string' ? text : '';
  t = t.replace(/\s+/g, ' ').trim().replace(/^["'“‘]+|["'”’]+$/g, '').trim();
  t = t.replace(new RegExp(`\\b${CAPTION_SEVERITY}\\s+(?=[a-z])`, 'gi'), '').replace(/[\s.]+$/, '').trim();
  if (!t || CAPTION_NOT_ALLOWED.test(t)) return '';
  if (t.length > 160) t = t.slice(0, 160).replace(/\s+\S*$/, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// What the inspector reads when Describe can't give a suggestion.
function photoAiProblem(err) {
  if (err && err.noSignal) return 'No signal, so SAYON couldn\'t look at the photo. Tap Describe again once you\'re back in range';
  if (err && err.status === 429) return 'This month\'s AI allowance is used up. Upgrade in Menu › Billing, or it comes back on the 1st';
  if (err && [401, 402, 403].includes(err.status)) return extractionProblem(err);
  return 'SAYON couldn\'t describe the photo. Try again';
}

// The Describe button and the suggestion box, drawn into each photo card
// (spotPhotosHTML, renderSectionPhotoGrid, renderPhotoGrid).
function describeButtonHTML(p) {
  const busy = describingPhotos.has(p.id);
  return `<button type="button" class="photo-describe-btn" data-describe-for="${p.id}" onclick="describePhoto('${p.id}')"
    ${busy ? 'disabled aria-busy="true"' : ''}${p.suggested ? ' hidden' : ''}>${SPARKLE_ICON}<span>${busy ? 'Looking…' : 'Describe'}</span></button>`;
}
function photoSuggestionHTML(p) {
  return `<div class="photo-suggest" data-suggest-for="${p.id}"${p.suggested ? '' : ' hidden'}>${p.suggested ? photoSuggestionInner(p) : ''}</div>`;
}
function photoSuggestionInner(p) {
  const has = !!(p.caption || '').trim();
  return `<div class="photo-suggest-label">${SPARKLE_ICON}SAYON suggests</div>
    <div class="photo-suggest-text">${escapeHtml(p.suggested)}</div>
    <div class="photo-suggest-actions">
      <button type="button" class="photo-suggest-use" onclick="useSuggestedCaption('${p.id}')">${has ? 'Add to caption' : 'Use'}</button>
      <button type="button" class="photo-suggest-skip" onclick="dismissSuggestedCaption('${p.id}')">Not this</button>
    </div>`;
}

// Brings the photo's card up to date in place, wherever it's drawn, so a
// caption being typed in another photo or field keeps its place.
function updatePhotoAiUI(id) {
  const found = findReportPhoto(id);
  const p = found ? found.photo : { id };
  const busy = describingPhotos.has(id);
  document.querySelectorAll(`[data-describe-for="${id}"]`).forEach(btn => {
    btn.disabled = busy;
    btn.toggleAttribute('aria-busy', busy);
    btn.hidden = !!p.suggested;
    btn.querySelector('span').textContent = busy ? 'Looking…' : 'Describe';
  });
  document.querySelectorAll(`[data-suggest-for="${id}"]`).forEach(box => {
    box.hidden = !p.suggested;
    box.innerHTML = p.suggested ? photoSuggestionInner(p) : '';
  });
  document.querySelectorAll(`[data-caption-for="${id}"]`).forEach(input => {
    if (input.value !== (p.caption || '')) input.value = p.caption || '';
  });
}

async function describePhoto(id) {
  if (describingPhotos.has(id)) return;
  if (isReportLocked()) { showToast('This job is complete and locked. Tap Amend to change it', 'info'); return; }
  const found = findReportPhoto(id);
  if (!found) return;
  if (!navigator.onLine) { showToast(photoAiProblem({ noSignal: true }), 'info'); return; }
  const target = reportData;
  const started = Date.now();
  describingPhotos.add(id);
  updatePhotoAiUI(id);
  try {
    const image = await photoForAi(found.photo);
    if (!image) { showToast('Couldn\'t open that photo to describe it', 'error'); return; }
    const place = photoPlaceLabel(found.section);
    const parsed = await askAiAboutPhoto({
      system: PHOTO_CAPTION_PROMPT, ...image, maxTokens: 2000, effort: 'low',
      text: `The inspector added this photo to: ${place}. Suggest its caption as your instructions describe.`,
    });
    const caption = cleanPhotoCaption(parsed.caption);
    const unclear = typeof parsed.unclear === 'string' ? parsed.unclear.trim().replace(/[\s.]+$/, '') : '';
    if (typeof saveTestEvent === 'function') saveTestEvent('photo-caption', place, { caption: caption || null, said: parsed.caption || null, unclear: unclear || null });
    track('photo_described', { seconds: Math.round((Date.now() - started) / 100) / 10, suggested: !!caption });
    // Another job may have been opened while the AI looked.
    const now = reportData === target && findReportPhoto(id);
    if (!now) return;
    if (caption) {
      now.photo.suggested = caption;
      saveDraft();
    } else {
      showToast(unclear ? `SAYON couldn't make this photo out (${unclear.slice(0, 60)}). Add the caption yourself` : 'SAYON couldn\'t suggest a caption for this photo. Add it yourself', 'info');
    }
  } catch (err) {
    console.warn('Photo description failed:', err);
    track('photo_describe_failed', { reason: err.noSignal ? 'no_signal' : err.status ? 'http_' + err.status : 'other' });
    showToast(photoAiProblem(err), 'error');
  } finally {
    describingPhotos.delete(id);
    updatePhotoAiUI(id);
  }
}

// Use puts the suggestion in the caption, after any words already there;
// the caption box stays editable as always.
function useSuggestedCaption(id) {
  if (isReportLocked()) { showToast('This job is complete and locked. Tap Amend to change it', 'info'); return; }
  const found = findReportPhoto(id);
  if (!found || !found.photo.suggested) return;
  const p = found.photo;
  const before = (p.caption || '').trim();
  p.caption = before ? `${before.replace(/[\s.,;:–—-]+$/, '')}. ${p.suggested}` : p.suggested;
  delete p.suggested;
  saveDraft();
  updatePhotoAiUI(id);
  track('photo_caption_used', { added: !!before });
}

function dismissSuggestedCaption(id) {
  const found = findReportPhoto(id);
  if (!found || !found.photo.suggested) return;
  delete found.photo.suggested;
  saveDraft();
  updatePhotoAiUI(id);
}
