// SAYON app: Talk it through, the after-note questions asked aloud.
// One of the js/app/ files, which share one global scope: they load as plain
// scripts in the order index.html lists them, so a top-level name declared in
// any of them can be used from the others once the page has loaded.

// ── TALK IT THROUGH ─────────────────────────────────────────────────────
// After a note is filled, the sheet lists what's still blank and what the
// standard still needs. Talk it through asks those aloud, one at a time,
// and listens for the answer, so the inspector can finish the report with
// the phone in a pocket: "Finding 2, rear bearer. Refer it to a builder or
// engineer? Yes or no." "No." "Finding 2: no referral." Then the next one.
//
// Only questions with a short spoken answer are asked: yes or no, or one of
// a few choices (an area inspected or not applicable, the building type,
// the risk). Anything else (an address, the agreement, a photo backup) is
// named at the end as left for the screen. The answer is read locally
// from the words heard, never by the AI: a word it can't place is asked
// again once, then left blank. A guessed answer in a report is worse than
// a blank, so two answers in one breath ("low to medium") count as none.
//
// Say "skip" to pass one, "undo" to take the last answer back, "repeat"
// to hear it again and "stop" to finish. Every choice is also a button on
// the sheet. The phone's own speech (Web Speech) does the listening; with
// none, the questions are still read and answered by tapping.
//
// Settings › Voice › "Ask me after each note" starts it on its own when a
// dictated note has been filled (off by default), and the first time it's
// run by hand it offers to turn that on.

const TALK_BACK_AUTO_KEY = 'korva_talk_back_auto';
const TALK_BACK_OFFERED_KEY = 'korva_talk_back_offered';
const TALK_BACK_LISTEN_MS = 8000;     // quiet this long and the question is asked again
const TALK_BACK_LISTEN_MAX_MS = 16000;

// { asked: Set of question keys, current, answered, left: [labels],
//   history: [{ key, undo }], tries, recognition, timers, auto, done, offer }
let talkBack = null;

function talkBackAuto() {
  try { return localStorage.getItem(TALK_BACK_AUTO_KEY) === '1'; } catch (e) { return false; }
}
function setTalkBackAuto(on) {
  try { localStorage.setItem(TALK_BACK_AUTO_KEY, on ? '1' : '0'); localStorage.setItem(TALK_BACK_OFFERED_KEY, '1'); } catch (e) { /* kept for this visit only */ }
  restoreTalkBackSetting();
}
function toggleTalkBackAutoSetting() { setTalkBackAuto(!talkBackAuto()); }
function restoreTalkBackSetting() {
  const btn = document.getElementById('toggleTalkBack');
  if (btn) btn.classList.toggle('on', talkBackAuto());
}

function talkBackSupported() { return 'speechSynthesis' in window; }
function talkBackCanListen() { return typeof getSpeechRecognitionCtor === 'function' && !!getSpeechRecognitionCtor(); }

// iPhones only let a page speak once it has spoken from a tap. The mic tap
// says nothing out loud, so the questions can start on their own later.
function primeTalkBackSpeech() {
  if (!talkBackSupported() || !talkBackAuto()) return;
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) { /* no speech on this phone */ }
}

// ── The words ──
const TB_SKIP_RE = /\b(?:skip(?: it| that| this)?|pass|next(?: one)?|don'?t know|do not know|dunno|not sure|unsure|leave it(?: blank)?|later|come back to (?:it|that))\b/;
const TB_STOP_RE = /\b(?:stop(?: asking| it| now| sayon)?|that'?s (?:all|it|enough)|finish(?:ed)?|cancel|quit|end it|enough)\b/;
const TB_UNDO_RE = /\b(?:undo|go back|change (?:that|it)|that'?s wrong|wrong one|take (?:that|it) back)\b/;
const TB_REPEAT_RE = /^(?:repeat(?: that| it)?|say (?:that|it) again|again|pardon|what|sorry what|come again|what was that)$/;
// A restatement: only what's said after the last one counts.
const TB_CORRECTION_RE = /\b(?:no wait|wait|actually|i mean|hang on|scratch that|make that|correction)\b/g;
const TB_YES = /\b(?:yes|yeah|yep|yup|yah|ya|correct|affirmative|sure|definitely|absolutely|there is|there are|there was|there were|it is|it was|we do|i do|i did|found one|got one)\b/;
const TB_NO = /\b(?:no|nope|nah|none|negative|not|nil|nothing|never|isn'?t|aren'?t|wasn'?t|weren'?t|don'?t|doesn'?t|didn'?t|couldn'?t|can'?t|haven'?t|hasn'?t)\b/;
// The words that turn a yes into a no ("there is not"). A bare "no" beside
// a "yes" isn't one of them: "yes no" is two answers, so it's asked again.
const TB_NEGATES = /\b(?:not|never|isn'?t|aren'?t|wasn'?t|weren'?t|don'?t|doesn'?t|didn'?t|couldn'?t|can'?t|haven'?t|hasn'?t)\b/;

function talkBackWords(text) {
  return ' ' + String(text || '').toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9' +]/g, ' ')
    .replace(/\s+/g, ' ').trim() + ' ';
}

// The option the words name, or null when they name none or more than one.
function talkBackMatch(q, text) {
  let part = talkBackWords(text);
  const cuts = [...part.matchAll(TB_CORRECTION_RE)];
  if (cuts.length) {
    const last = cuts[cuts.length - 1];
    const after = part.slice(last.index + last[0].length);
    if (after.trim()) part = ' ' + after.trim() + ' ';
  }
  // "Not high" is a no, not a yes that happens to have a "not" in it.
  if (q.yesWords) part = part.replace(new RegExp(`\\b(?:not|no|never|isn'?t|aren'?t|wasn'?t|weren'?t)\\s+(?:\\w+\\s+)?(?:${q.yesWords.source})`, 'g'), ' no ');
  const hits = q.options.filter(o => o.re.test(part) && !(o.not && o.not.test(part)));
  return hits.length === 1 ? hits[0] : null;
}

// What the inspector said: a command, an answer, or nothing it can use.
function talkBackHear(q, alternatives) {
  const texts = alternatives.map(t => String(t || '').trim()).filter(Boolean);
  for (const text of texts) {
    const w = talkBackWords(text).trim();
    if (TB_UNDO_RE.test(w)) return { cmd: 'undo' };
    if (TB_STOP_RE.test(w)) return { cmd: 'stop' };
    if (TB_REPEAT_RE.test(w)) return { cmd: 'repeat' };
    if (q) {
      // "Not sure what type, but there is one" still answers; a plain
      // "not sure" is a skip, never a "no".
      const skip = TB_SKIP_RE.test(w);
      const opt = talkBackMatch(q, skip ? w.replace(new RegExp(TB_SKIP_RE.source, 'g'), ' ') : w);
      if (opt) return { opt };
      if (skip) return { cmd: 'skip' };
    } else if (TB_SKIP_RE.test(w)) return { cmd: 'skip' };
  }
  return null;
}

// ── The questions ──
// Built fresh before each one, from the report as it is now, so an answer
// that opens a new gap (areas marked inspected now need a result) is asked
// about next, and one that closes a gap isn't asked twice.
function talkBackYesNo(extraYes, extraNo) {
  const no = extraNo ? new RegExp(`${TB_NO.source}|\\b(?:${extraNo.source})`) : TB_NO;
  const negates = extraNo ? new RegExp(`${TB_NEGATES.source}|\\b(?:${extraNo.source})`) : TB_NEGATES;
  return [
    { value: 'YES', label: 'Yes', re: extraYes ? new RegExp(`${TB_YES.source}|\\b(?:${extraYes.source})`) : TB_YES, not: negates },
    { value: 'NO', label: 'No', re: no },
  ];
}

// Where a finding is, short enough to say: its first parts, up to 8 words
// ("gum tree in the backyard", "subfloor, rear bearer and the joist above it").
function talkBackShortPlace(text) {
  const parts = String(text || '').replace(/[.;].*$/, '').split(',').map(p => p.trim()).filter(Boolean);
  const out = [];
  let n = 0;
  for (const part of parts) {
    const w = part.split(/\s+/).length;
    if (out.length && n + w > 8) break;
    out.push(out.length ? part : part.split(/\s+/).slice(0, 8).join(' '));
    n += w;
  }
  return out.join(', ').toLowerCase();
}

// Undo for the area answers: the areas as they were before.
function talkBackAreaSnapshot() {
  const keep = { areaStatus: JSON.stringify(reportData.areaStatus || null), areaResult: JSON.stringify(reportData.areaResult || null) };
  return () => {
    reportData.areaStatus = JSON.parse(keep.areaStatus) || undefined;
    reportData.areaResult = JSON.parse(keep.areaResult) || undefined;
    syncObstructionData();
    saveDraft();
  };
}

// Undo for a report field: back to what it held, or blank.
function talkBackFieldSetter(key) {
  return v => {
    const el = document.getElementById('f-' + key);
    const prev = reportData[key];
    if (!el) return () => {};
    commitEdit(el, key, v);
    return () => {
      if (isBlankValue(prev)) {
        reportData[key] = null;
        el.classList.remove('filled');
        el.textContent = '—';
        getFieldLabel(el)?.querySelector('.edited-dot')?.remove();
        updateProgress();
        saveDraft();
      } else commitEdit(el, key, prev);
    };
  };
}

function talkBackQuestions() {
  const qs = [];
  const blank = k => isBlankValue(reportData[k]);

  // 1. A builder or engineer referral on each termite finding: the one
  // question the report can't answer for the inspector.
  findingsMissingReferral().forEach(n => {
    const f = reportData.findings[n - 1];
    const where = talkBackShortPlace(f.activityLocation || f.timberAffected);
    qs.push({
      key: 'referral:' + f.id,
      label: `builder referral on finding ${n}`,
      ask: `Finding ${n}${where ? `, ${where}` : ''}. Refer it to a builder or engineer? Yes or no.`,
      hint: 'Say yes or no.',
      options: talkBackYesNo(/refer it|refer that|refer to|get a builder|needs a builder|needs an engineer/, /no need|no referral|don'?t refer|not needed/)
        .map(o => ({ ...o, label: o.value === 'YES' ? 'Yes, refer' : 'No referral' })),
      said: o => o.value === 'YES' ? `Finding ${n}: refer to a builder or engineer.` : `Finding ${n}: no referral.`,
      apply: o => {
        const prev = f.structuralConcern || null;
        commitFindingEdit(f.id, 'structuralConcern', o.value);
        return () => commitFindingEdit(f.id, 'structuralConcern', prev);
      },
    });
  });

  // 2. Areas with no inspection status: each on its own when there are a
  // few, all together when there are many.
  const unmarked = Object.keys(OBS_ZONES).filter(z => !areaStatusOf(z));
  const statusOptions = [
    { value: 'INSPECTED', label: 'Inspected', re: /\b(?:inspected|inspect|looked|checked|done|yes|yep|yeah|fine|all good|walked|went through|all clear)\b/, not: /not applicable|\bn ?a\b|\bnone\b|partly|partial|access|couldn'?t|\bnot\b/ },
    { value: 'NA', label: 'Not applicable', re: /not applicable|\bn ?a\b|\bnone\b|\bno\b|there (?:isn'?t|aren'?t|is no|are no|was no|were no)|doesn'?t have|don'?t have|not there|haven'?t got|hasn'?t got/, not: /access|partly|partial|couldn'?t get/ },
    { value: 'LEAVE', label: 'Partly', re: /partly|partially|part of|couldn'?t (?:get|access|reach)|no access|blocked|restricted|limited/ },
  ];
  if (unmarked.length && unmarked.length <= 3) {
    unmarked.forEach(z => qs.push({
      key: 'status:' + z,
      label: `${zoneName(z).toLowerCase()} status`,
      ask: `${zoneName(z)}. Inspected, or not applicable?`,
      hint: 'Say inspected, or not applicable.',
      options: statusOptions,
      said: o => o.value === 'LEAVE' ? `${zoneName(z)}: I'll leave that for you to mark on the screen, with what limited it.` : `${zoneName(z)}: ${o.value === 'NA' ? 'not applicable' : 'inspected'}.`,
      apply: o => {
        if (o.value === 'LEAVE') return null;
        const undo = talkBackAreaSnapshot();
        if (!reportData.areaStatus) reportData.areaStatus = {};
        reportData.areaStatus[z] = o.value;
        syncObstructionData();
        saveDraft();
        return undo;
      },
    }));
  } else if (unmarked.length) {
    const names = joinWithAnd(unmarked.map(z => zoneName(z).toLowerCase()));
    qs.push({
      key: 'status:all',
      label: `status of ${unmarked.length} areas`,
      ask: `${unmarked.length} areas have no status yet: ${names}. All inspected, or all not applicable?`,
      hint: 'Say all inspected, or all not applicable. Or skip.',
      options: statusOptions.filter(o => o.value !== 'LEAVE'),
      said: o => `${unmarked.length} areas marked ${o.value === 'NA' ? 'not applicable' : 'inspected'}.`,
      apply: o => { const undo = talkBackAreaSnapshot(); markRemainingAreasInspected(o.value); saveDraft(); return undo; },
    });
  }

  // 3. Areas inspected with no result for what was found there.
  const noResult = areasMissingResult();
  if (noResult.length) {
    const names = joinWithAnd(noResult.map(z => zoneName(z).toLowerCase()));
    const one = noResult.length === 1;
    qs.push({
      key: 'result',
      label: `what was found in ${names}`,
      ask: `${names.charAt(0).toUpperCase() + names.slice(1)}: nothing is recorded as found there yet. Mark ${one ? 'it' : 'them'} nothing found? Yes or no.`,
      hint: 'Say yes or no.',
      options: talkBackYesNo(/nothing found|clear|all clear/),
      said: o => o.value === 'YES' ? `${one ? 'Marked' : 'All marked'} nothing found, except where a finding names ${one ? 'it' : 'one'}.` : `Okay, I'll leave ${one ? 'that' : 'those'} for you.`,
      leaveOn: 'NO',
      apply: o => { if (o.value !== 'YES') return null; const undo = talkBackAreaSnapshot(); markRemainingAreasClear(); saveDraft(); return undo; },
    });
  }

  // 4. The fields an inspector most often comes back for.
  if (blank('structureType')) qs.push({
    key: 'f:structureType', label: 'structure type',
    ask: 'What type of building is it? For example, detached house, duplex or unit.',
    hint: 'Say detached house, semi, townhouse, duplex, unit, granny flat or commercial.',
    options: [
      { value: 'Semi-detached', label: 'Semi', re: /\bsemi/ },
      { value: 'Granny flat', label: 'Granny flat', re: /granny/ },
      { value: 'Terrace / townhouse', label: 'Townhouse', re: /terrace|town ?house|town ?home/ },
      { value: 'Duplex', label: 'Duplex', re: /duplex/ },
      { value: 'Unit / apartment', label: 'Unit', re: /\b(?:unit|apartment|flat)\b/, not: /granny/ },
      { value: 'Commercial building', label: 'Commercial', re: /commercial|\bshop\b|office|warehouse|factory/ },
      { value: 'Detached house', label: 'Detached house', re: /\b(?:detached|house|home|freestanding|free standing|standalone|stand alone|dwelling)\b/, not: /\bsemi|town ?house|granny/ },
    ],
    said: o => `Structure type: ${o.value.toLowerCase()}.`,
    apply: o => talkBackFieldSetter('structureType')(o.value),
  });
  if (blank('height')) qs.push({
    key: 'f:height', label: 'height',
    ask: 'How many storeys? Single, double or split level?',
    hint: 'Say single storey, double storey, split level or multiple.',
    options: [
      { value: 'Split level', label: 'Split level', re: /\bsplit/ },
      { value: 'Multiple storey', label: 'Multiple', re: /\b(?:multi\w*|three|3|four|4|several)\b/ },
      { value: 'Double storey', label: 'Double', re: /\b(?:double|two|2|second)\b|upstairs/, not: /\bsplit|\bmulti/ },
      { value: 'Single storey', label: 'Single', re: /\b(?:single|one|1|ground|bungalow|low ?set)\b/, not: /\bsplit|\bdouble|\btwo\b|\bmulti|\bthree\b/ },
    ],
    said: o => `Height: ${o.value.toLowerCase()}.`,
    apply: o => talkBackFieldSetter('height')(o.value),
  });
  if (blank('existingSystem')) qs.push({
    key: 'f:existingSystem', label: 'termite management system',
    ask: 'Any termite management system? Say none, or chemical, baiting, physical or reticulation.',
    hint: 'Say none, chemical barrier, baiting, physical barrier or reticulation.',
    options: [
      { value: 'Combination System — Physical + Chemical', label: 'Combination', re: /combination|\bboth\b|physical (?:and|plus) chemical|chemical (?:and|plus) physical/ },
      { value: 'Chemical Reticulation System', label: 'Reticulation', re: /reticulat|retic\b/ },
      { value: 'Termite Baiting System', label: 'Baiting', re: /\bbait|exterra|sentricon|trelona|stations/ },
      { value: 'Physical Barrier', label: 'Physical', re: /physical|kordon|termimesh|homeguard|granitgard|\bmesh\b/, not: /chemical|combination/ },
      { value: 'Chemical Barrier', label: 'Chemical', re: /chemical|termidor|altriset|biflex|soil treatment|\bbarrier\b/, not: /reticulat|combination|physical/ },
      { value: 'System Present — Type Unidentified', label: 'Type unknown', re: /unidentified|unknown|can'?t tell|couldn'?t tell|some sort of|there'?s one|there is one|not sure what/ },
      { value: NO_SYSTEM_FOUND, label: 'None', re: /\b(?:none|no system|nothing|no|not one|no sign of one)\b/, not: /chemical|\bbait|physical|reticul|barrier|there'?s one|there is one/ },
    ],
    said: o => o.value === NO_SYSTEM_FOUND ? 'No termite management system found.' : `Termite management system: ${o.label.toLowerCase()}.`,
    apply: o => talkBackFieldSetter('existingSystem')(o.value),
  });
  if (blank('durableNoticePresent')) qs.push({
    key: 'f:durableNoticePresent', label: 'durable notice',
    ask: 'Is there a durable notice in the meter box? Yes or no.',
    hint: 'Say yes or no.',
    options: talkBackYesNo(/there'?s one|sticker|plate|notice is there/, /missing|couldn'?t find|no notice/),
    said: o => `Durable notice: ${o.value === 'YES' ? 'yes' : 'no'}.`,
    apply: o => talkBackFieldSetter('durableNoticePresent')(o.value),
  });
  if (blank('moistureReadings')) {
    const yesWords = /high|elevated|damp|wet/;
    qs.push({
      key: 'f:moistureReadings', label: 'moisture readings',
      ask: 'Any high moisture readings? Yes or no.',
      hint: 'Say yes or no.',
      yesWords,
      options: talkBackYesNo(yesWords, /dry|normal|low/),
      said: o => o.value === 'YES' ? 'Moisture: high readings. Add where on the screen.' : 'Moisture: no high readings.',
      apply: o => talkBackFieldSetter('moistureReadings')(o.value),
    });
  }
  if (blank('slabEdge')) qs.push({
    key: 'f:slabEdge', label: 'slab edge',
    ask: 'Slab edge: clear, or obstructed? Say no slab if there isn\'t one.',
    hint: 'Say clear, obstructed, or no slab.',
    options: [
      { value: 'NOSLAB', label: 'No slab', re: /no slab|not (?:a )?slab|suspended|timber floor|stumps|piers|not applicable|\bn ?a\b/ },
      { value: 'OBSTRUCTED', label: 'Obstructed', re: /obstruct|cover|bridg|hidden|garden|paving|pavers|soil|mulch|render|cladding|not visible|can'?t see|couldn'?t see|blocked|conceal/, not: /no slab|not (?:a )?slab/ },
      { value: 'CLEAR', label: 'Clear', re: /\b(?:clear|visible|exposed|fine|good|okay|ok)\b/, not: /not visible|can'?t see|couldn'?t see|not clear|unclear|no slab/ },
    ],
    said: o => o.value === 'NOSLAB' ? 'No slab. Left blank.' : `Slab edge: ${o.value.toLowerCase()}.`,
    apply: o => o.value === 'NOSLAB' ? null : talkBackFieldSetter('slabEdge')(o.value),
  });
  // Last, once everything it rests on is in: the inspector's own rating.
  if (blank('riskLevel')) qs.push({
    key: 'f:riskLevel', label: 'risk level',
    ask: 'Overall risk of termite attack: low, medium or high?',
    hint: 'Say low, medium or high.',
    options: [
      { value: 'LOW', label: 'Low', re: /\blow\b/ },
      { value: 'MEDIUM', label: 'Medium', re: /medium|moderate|\bmid\b|middle/ },
      { value: 'HIGH', label: 'High', re: /\bhigh\b/ },
    ],
    said: o => `Risk: ${o.value.toLowerCase()}.`,
    apply: o => talkBackFieldSetter('riskLevel')(o.value),
  });
  return qs;
}

// What's left that can only be done on the screen, in a few words each.
function talkBackScreenLeft() {
  const words = {
    address: 'the property address',
    agreement: 'the agreement',
    photos: 'backing up the photos',
  };
  return reportPrepGaps('extract')
    .filter(g => ['address', 'contradiction', 'evidence', 'agreement', 'photos'].includes(g.key))
    .map(g => words[g.key] || g.text.replace(/"/g, '').replace(/,.*$/, ''));
}

// ── Speaking ──
function talkBackSay(text, then) {
  const tb = talkBack;
  if (!tb) return;
  talkBackStopListening();
  clearTimeout(tb.sayTimer);
  talkBackRender('speaking');
  const done = () => {
    if (talkBack !== tb || tb.utter !== u) return;
    tb.utter = null;
    clearTimeout(tb.sayTimer);
    if (then) then();
  };
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-AU';
  u.rate = 1;
  const voice = speechSynthesis.getVoices().find(v => /en[-_]AU/i.test(v.lang));
  if (voice) u.voice = voice;
  u.onend = u.onerror = done;
  tb.utter = u;   // kept, or some phones drop it before it ends
  tb.spoken = text;
  try { speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) { setTimeout(done, 0); return; }
  // Some phones never say it ended: carry on after about as long as it takes.
  tb.sayTimer = setTimeout(done, 2500 + text.length * 85);
}

// ── Listening ──
function talkBackListen() {
  const tb = talkBack;
  if (!tb || tb.listening) return;
  talkBackRender('listening');
  if (!talkBackCanListen() || tb.tapOnly) return;   // the buttons answer
  const SR = getSpeechRecognitionCtor();
  let recognition;
  try { recognition = new SR(); } catch (e) { tb.tapOnly = true; talkBackRender('listening'); return; }
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 3;
  recognition.lang = 'en-AU';
  const heard = { finals: [], interim: '' };
  tb.listening = { recognition, heard };
  recognition.onresult = e => {
    if (talkBack !== tb || tb.listening?.recognition !== recognition) return;
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) heard.finals.push([...r].map(a => a.transcript));
      else interim += r[0].transcript;
    }
    heard.interim = interim;
    const shown = heard.finals.length ? heard.finals.map(f => f[0]).join(' ') : interim;
    talkBackHeardText(shown);
    // Once someone is talking, give them longer to finish.
    if (shown && !heard.long) { heard.long = true; clearTimeout(tb.listenTimer); tb.listenTimer = setTimeout(() => talkBackStopListening(true), TALK_BACK_LISTEN_MAX_MS); }
  };
  recognition.onerror = e => {
    if (talkBack !== tb) return;
    if (e && (e.error === 'not-allowed' || e.error === 'service-not-allowed')) {
      tb.tapOnly = true;
      tb.listening = null;
      clearTimeout(tb.listenTimer);
      talkBackRender('listening');
      showToast('Microphone not allowed, so tap the answers instead', 'info');
    }
  };
  recognition.onend = () => {
    if (talkBack !== tb || !tb.listening || tb.listening.recognition !== recognition) return;
    tb.listening = null;
    clearTimeout(tb.listenTimer);
    // Whole sentences first, each with the phone's other guesses; else
    // whatever was heard so far.
    const alts = heard.finals.length
      ? [heard.finals.map(f => f[0]).join(' '), ...heard.finals.flatMap(f => f.slice(1))]
      : heard.interim ? [heard.interim] : [];
    talkBackHandle(alts);
  };
  tb.listenTimer = setTimeout(() => talkBackStopListening(true), TALK_BACK_LISTEN_MS);
  try {
    if (typeof playTone === 'function') playTone(660, 110, 0.12);
    recognition.start();
  } catch (e) {
    tb.listening = null;
    tb.tapOnly = true;
    talkBackRender('listening');
  }
}

// keep: let it finish with what it heard (onend runs); else drop it.
function talkBackStopListening(keep) {
  const tb = talkBack;
  if (!tb) return;
  clearTimeout(tb.listenTimer);
  const l = tb.listening;
  if (!l) return;
  if (keep) { try { l.recognition.stop(); } catch (e) { tb.listening = null; talkBackHandle([]); } return; }
  tb.listening = null;
  try { l.recognition.onend = null; l.recognition.abort(); } catch (e) { /* already stopped */ }
}

// ── The flow ──
function startTalkBack(auto) {
  if (talkBack || !talkBackSupported()) return;
  if (typeof isReportLocked === 'function' && isReportLocked()) { showToast('This job is complete and locked. Tap Amend to change it', 'info'); return; }
  if (typeof isRecording !== 'undefined' && isRecording) return;
  stopReadBack();
  talkBack = { asked: new Set(), current: null, answered: 0, left: [], history: [], tries: 0, auto: !!auto, tapOnly: !talkBackCanListen() };
  const total = talkBackQuestions().length;
  const n = extractSummaryFilledCount;
  const intro = [n ? `Filled ${n} field${n !== 1 ? 's' : ''} from your note.` : 'Nothing new was filled from your note.'];
  if (total) intro.push(`${total} question${total === 1 ? '' : 's'}. Say skip to pass one, or stop to finish.`);
  track('talk_back_started', { auto: !!auto, questions: total });
  talkBackSay(intro.join(' '), talkBackNext);
}

function talkBackNext() {
  const tb = talkBack;
  if (!tb) return;
  tb.tries = 0;
  const q = talkBackQuestions().find(x => !tb.asked.has(x.key));
  if (!q) { talkBackFinish(); return; }
  tb.asked.add(q.key);
  tb.current = q;
  talkBackHeardText('');
  talkBackSay(q.ask, talkBackListen);
}

// Takes what was heard (or a tapped answer) for the question being asked.
function talkBackHandle(alternatives, tapped) {
  const tb = talkBack;
  if (!tb) return;
  const q = tb.offer || tb.current;
  const got = tapped || talkBackHear(q, alternatives);
  const heardText = (alternatives && alternatives[0]) || (tapped && tapped.opt ? tapped.opt.label : '');
  if (testModeOn() && heardText) {
    try { saveTestEvent('talk-back', heardText, { question: q ? q.ask : '', answer: got ? (got.cmd || got.opt.value) : null, tapped: !!tapped, alternatives: (alternatives || []).slice(1, 4) }); } catch (e) { /* testing never gets in the way */ }
  }
  if (got && got.cmd === 'stop') { talkBackFinish(true); return; }
  if (got && got.cmd === 'undo') { talkBackUndo(); return; }
  if (tb.offer) { talkBackOfferAnswer(got); return; }
  if (!q) return;
  if (got && got.cmd === 'repeat') { talkBackSay(q.ask, talkBackListen); return; }
  if (got && got.cmd === 'skip') { tb.left.push(q.label); talkBackSay('Skipped.', talkBackNext); return; }
  if (got && got.opt) {
    const undo = q.apply(got.opt);
    if (undo) { tb.history.push({ key: q.key, undo }); tb.answered++; }
    else if (got.opt.value === 'LEAVE' || got.opt.value === q.leaveOn) tb.left.push(q.label);
    talkBackSay(q.said(got.opt), talkBackNext);
    return;
  }
  // Nothing usable: once more, then it's left for the screen.
  tb.tries++;
  if (tb.tries < 2) {
    talkBackSay(alternatives && alternatives.length ? `Sorry, I didn't catch that. ${q.hint}` : `${q.ask}`, talkBackListen);
    return;
  }
  tb.left.push(q.label);
  talkBackSay('I\'ll leave that one for you.', talkBackNext);
}

function talkBackUndo() {
  const tb = talkBack;
  if (!tb) return;
  const last = tb.history.pop();
  if (!last) { talkBackSay('Nothing to undo yet.', tb.offer ? talkBackListen : () => tb.current ? talkBackSay(tb.current.ask, talkBackListen) : talkBackNext()); return; }
  try { last.undo(); } catch (e) { reportError(e, 'talk_back_undo'); }
  tb.answered = Math.max(0, tb.answered - 1);
  tb.offer = null;
  tb.done = false;
  // Asked again; any after it that the answer opened are asked again too.
  tb.asked.delete(last.key);
  talkBackSay('Undone.', talkBackNext);
}

function talkBackFinish(stopped) {
  const tb = talkBack;
  if (!tb) return;
  talkBackStopListening();
  const cur = tb.current;
  if (stopped && cur && !tb.history.some(h => h.key === cur.key) && !tb.left.includes(cur.label)) tb.left.push(cur.label);
  tb.current = null;
  tb.done = true;
  // The sheet again, with what's now filled.
  if (extractSummaryBefore) showExtractSummary(extractSummaryBefore);
  const notAsked = stopped ? talkBackQuestions().filter(q => !tb.asked.has(q.key)).map(q => q.label) : [];
  const left = [...tb.left, ...notAsked];
  const screen = talkBackScreenLeft();
  const lines = [stopped ? 'Stopped.' : 'That\'s all.'];
  if (tb.answered) lines.push(`${tb.answered} answered.`);
  if (left.length) lines.push(`Left for you: ${joinWithAnd(left)}.`);
  if (screen.length) lines.push(`On the screen: ${joinWithAnd(screen)}.`);
  if (!left.length && !screen.length) lines.push('Nothing else the report needs before you leave.');
  tb.summary = lines.join(' ');
  track('talk_back_finished', { answered: tb.answered, left: left.length, stopped: !!stopped });
  // The first time it's run by hand, offer to ask after every note.
  let offered = true;
  try { offered = localStorage.getItem(TALK_BACK_OFFERED_KEY) === '1'; } catch (e) { /* asked once per visit at most */ }
  if (!stopped && !tb.auto && !talkBackAuto() && !offered) {
    try { localStorage.setItem(TALK_BACK_OFFERED_KEY, '1'); } catch (e) { /* fine */ }
    tb.offer = {
      key: 'offer', label: 'ask after each note',
      ask: 'Want me to ask these after every note? Yes or no.',
      hint: 'Say yes or no.',
      options: talkBackYesNo(),
    };
    tb.tries = 0;
    talkBackSay(`${lines.join(' ')} ${tb.offer.ask}`, talkBackListen);
    return;
  }
  talkBackSay(lines.join(' '), () => talkBackRender('done'));
}

function talkBackOfferAnswer(got) {
  const tb = talkBack;
  if (!got || !got.opt) {
    tb.tries++;
    if (tb.tries < 2 && !(got && got.cmd === 'skip')) { talkBackSay('Yes or no?', talkBackListen); return; }
    tb.offer = null;
    talkBackSay('Okay. You can turn it on in Settings, under Voice.', () => talkBackRender('done'));
    return;
  }
  const yes = got.opt.value === 'YES';
  setTalkBackAuto(yes);
  tb.offer = null;
  talkBackSay(yes ? 'Done. I\'ll ask after each note. Turn it off in Settings, under Voice.' : 'Okay. You can turn it on in Settings, under Voice.', () => talkBackRender('done'));
}

// The Stop button, or the sheet being closed (quiet: no goodbye).
function stopTalkBack(quiet) {
  const tb = talkBack;
  if (!tb) return;
  if (!quiet && !tb.done) { talkBackFinish(true); return; }
  talkBackStopListening();
  clearTimeout(tb.sayTimer);
  tb.utter = null;
  try { speechSynthesis.cancel(); } catch (e) { /* nothing speaking */ }
  talkBack = null;
  talkBackRender();
}

// The Skip, Undo and Repeat buttons.
function talkBackCommand(cmd) {
  const tb = talkBack;
  if (!tb || tb.done && !tb.offer) return;
  talkBackStopListening();
  talkBackHandle([], { cmd });
}

// A choice tapped on the sheet.
function talkBackPick(i) {
  const tb = talkBack;
  const q = tb && (tb.offer || tb.current);
  if (!q || !q.options[i]) return;
  talkBackStopListening();
  talkBackHandle([], { opt: q.options[i] });
}

// ── The card on the sheet ──
function talkBackHeardText(text) {
  const el = document.getElementById('talkBackHeard');
  if (!el) return;
  el.textContent = text ? `Heard: "${text}"` : '';
  el.hidden = !text;
}

function talkBackRender(state) {
  const card = document.getElementById('talkBack');
  const talkBtn = document.getElementById('extractTalkBtn');
  const readBtn = document.getElementById('extractReadBackBtn');
  const tb = talkBack;
  if (talkBtn) talkBtn.hidden = !!tb || !talkBackSupported();
  if (readBtn) readBtn.hidden = !!tb || !('speechSynthesis' in window);
  if (!card) return;
  if (!tb) { card.hidden = true; return; }
  card.hidden = false;
  card.dataset.state = state || 'speaking';
  const q = tb.offer || tb.current;
  const stateEl = document.getElementById('talkBackState');
  if (stateEl) {
    stateEl.textContent = state === 'done' ? 'Finished'
      : state === 'listening' ? (tb.tapOnly || !talkBackCanListen() ? 'Tap your answer' : 'Listening… say your answer')
      : 'Speaking…';
  }
  const qEl = document.getElementById('talkBackQ');
  if (qEl) qEl.textContent = state === 'done' ? (tb.summary || tb.spoken || '') : q ? q.ask : (tb.spoken || '');
  if (state === 'done') talkBackHeardText('');
  const opts = document.getElementById('talkBackOpts');
  if (opts) {
    opts.innerHTML = q && state !== 'done'
      ? q.options.map((o, i) => `<button type="button" class="talkback-opt" onclick="talkBackPick(${i})">${escapeHtml(o.label)}</button>`).join('')
      : '';
  }
  const live = document.getElementById('talkBackActions');
  if (live) live.hidden = state === 'done';
  const closeBtn = document.getElementById('talkBackClose');
  if (closeBtn) closeBtn.hidden = state !== 'done';
  const undo = document.getElementById('talkBackUndo');
  if (undo) undo.disabled = !tb.history.length;
}
