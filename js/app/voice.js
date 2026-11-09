// SAYON app: Field notes, dictation, speech recognition, transcript cleanup, audio capture, Whisper, quick phrases, voice HUD.
// One of the js/app/ files, which share one global scope: they load as plain
// scripts in the order index.html lists them, so a top-level name declared in
// any of them can be used from the others once the page has loaded.

// ══════════════════════════════════════════════════════════════════════════
// FIELD NOTES — expandable description sub-sections per field
// ══════════════════════════════════════════════════════════════════════════
let fieldNotes = {};
let activeNotesTargetKey = null; // which field's notes the voice popover is dictating into

function enhanceFieldsWithNotes() {
  document.querySelectorAll('.field-val[id^="f-"]').forEach(valEl => {
    const key = valEl.id.replace('f-', '');
    const fieldEl = valEl.closest('.field') || valEl.closest('.findings-gate-question');
    if (!fieldEl) return;
    const labelEl = fieldEl.querySelector('.field-label');
    if (!labelEl || labelEl.dataset.enhanced) return;
    labelEl.dataset.enhanced = '1';

    // Build notes panel — attached after the field-val directly, no pencil button
    const panel = document.createElement('div');
    panel.className = 'field-notes';
    panel.id = 'notes-' + key;
    panel.innerHTML = `
      <textarea class="field-notes-textarea" id="notes-text-${key}" placeholder="Add detail — location, description, observations…" oninput="onNotesInput('${key}')"></textarea>
      <div class="field-notes-bar">
        <button class="field-notes-mic" type="button" onclick="openNotesVoice('${key}')">
          <svg class="icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
          Dictate
        </button>
        <span class="field-notes-charcount" id="notes-count-${key}"></span>
      </div>
    `;
    valEl.insertAdjacentElement('afterend', panel);
  });
}

function toggleFieldNotes(key) {
  // Don't open notes while the field value itself is being edited
  const fieldEl = document.getElementById('f-' + key);
  if (fieldEl && fieldEl.classList.contains('editing')) return;

  const panel = document.getElementById('notes-' + key);
  const toggle = document.getElementById('notes-toggle-' + key);
  if (!panel) return;
  const isOpen = panel.classList.toggle('open');
  if (toggle) toggle.classList.toggle('open', isOpen);
  if (isOpen) {
    const ta = document.getElementById('notes-text-' + key);
    if (ta) setTimeout(() => ta.focus(), 50);
  }
}

function getSectionForKey(key) {
  for (const [sec, cfg] of Object.entries(SECTIONS)) {
    if (cfg.fields.includes(key)) return sec;
  }
  return 'property';
}

function getFieldLabel(valEl) {
  const fieldEl = valEl.closest('.field') || valEl.closest('.findings-gate-question');
  return fieldEl ? fieldEl.querySelector('.field-label') : valEl.previousElementSibling;
}

function onNotesInput(key) {
  const ta = document.getElementById('notes-text-' + key);
  if (!ta) return;
  fieldNotes[key] = ta.value;
  updateNotesIndicator(key);
  saveDraft();
}

function updateNotesIndicator(key) {
  const toggle = document.querySelector(`[onclick="toggleFieldNotes('${key}')"]`);
  const countEl = document.getElementById('notes-count-' + key);
  const hasContent = !!(fieldNotes[key] && fieldNotes[key].trim());
  if (toggle) toggle.classList.toggle('has-content', hasContent);
  if (countEl) countEl.textContent = hasContent ? `${fieldNotes[key].trim().length} chars` : '';
}

function restoreFieldNotes() {
  Object.entries(fieldNotes).forEach(([key, val]) => {
    const ta = document.getElementById('notes-text-' + key);
    if (ta && val) {
      ta.value = val;
      updateNotesIndicator(key);
    }
  });
}

// ── Targeted voice dictation into field notes ──────────────────────────────
function openNotesVoice(key) {
  activeNotesTargetKey = key;
  const popover = document.getElementById('voicePopover');
  const title = document.getElementById('voicePopoverTitleText');
  const fab = document.getElementById('micFab');

  // Get field label for context
  const panel = document.getElementById(`notes-${key}`);
  const fieldEl = panel ? (panel.closest('.field') || panel.closest('.findings-gate-question')) : null;
  const labelEl = fieldEl ? fieldEl.querySelector('.field-label') : null;
  const labelText = labelEl ? labelEl.textContent.replace('edit', '').trim() : 'this field';

  if (title) title.textContent = `Dictating: ${labelText}`;
  document.getElementById('extractBtn').style.display = 'none';
  document.getElementById('useTranscriptBtn').style.display = 'block';

  if (!popover.classList.contains('open')) {
    popover.classList.add('open');
    showTestModeBadge();
    fab.classList.add('open');
  }

  // Pre-fill transcript box with existing notes if any
  const box = document.getElementById('transcriptBox');
  const existing = fieldNotes[key] || '';
  if (existing) {
    box.textContent = existing;
    box.classList.add('active');
    currentTranscript = existing;
  } else {
    box.textContent = 'Tap the mic and start speaking…';
    box.classList.remove('active');
    currentTranscript = '';
  }
  lowConfidenceFlagged = false;
  const warnElNotes = document.getElementById('lowConfidenceWarning');
  if (warnElNotes) warnElNotes.classList.remove('show');
  dismissCleanupSuggestion();
  dismissServerTranscript();
}

function useTranscriptForNotes() {
  if (!activeNotesTargetKey) return;
  const key = activeNotesTargetKey;
  const text = currentTranscript.trim();
  if (!text) {
    showToast('Nothing to add yet. Speak first', 'error');
    return;
  }

  fieldNotes[key] = text;
  const ta = document.getElementById('notes-text-' + key);
  if (ta) ta.value = text;
  updateNotesIndicator(key);

  // Ensure the notes panel is open
  const panel = document.getElementById('notes-' + key);
  const toggle = document.querySelector(`[onclick="toggleFieldNotes('${key}')"]`);
  if (panel && !panel.classList.contains('open')) {
    panel.classList.add('open');
    if (toggle) toggle.classList.add('open');
  }

  saveDraft();
  showToast('Notes added', 'success');
  resetVoicePopoverToDefault();
  toggleVoicePopover(); // close popover
}

function resetVoicePopoverToDefault() {
  activeNotesTargetKey = null;
  const title = document.getElementById('voicePopoverTitleText');
  if (title) title.textContent = 'Voice capture';
  document.getElementById('extractBtn').style.display = 'flex';
  document.getElementById('useTranscriptBtn').style.display = 'none';
  const box = document.getElementById('transcriptBox');
  box.textContent = 'Tap the mic and start speaking, or tap here to type instead.';
  box.classList.remove('active');
  currentTranscript = '';
  lowConfidenceFlagged = false;
  const warnElReset = document.getElementById('lowConfidenceWarning');
  if (warnElReset) warnElReset.classList.remove('show');
  dismissCleanupSuggestion();
  dismissServerTranscript();
}

// ── NATIVE SPEECH RECOGNITION ADAPTER ───────────────────────────────────────
// The browser's Web Speech API (window.SpeechRecognition) does not exist inside a
// Capacitor WKWebView on iOS — it only works in Safari itself. This class wraps the
// native @capacitor-community/speech-recognition plugin behind the same event-driven
// shape the rest of this file already uses (continuous/interimResults/lang props,
// start()/stop()/abort() methods, onresult/onerror/onend callbacks), so the existing
// startRecording() code below works unchanged on both platforms.
class NativeSpeechRecognition {
  constructor() {
    this.continuous = true;
    this.interimResults = true;
    this.lang = 'en-AU';
    this.maxAlternatives = 1;
    this.onresult = null;
    this.onerror = null;
    this.onend = null;
    this._listener = null;
    this._running = false;
  }

  async start() {
    const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SpeechRecognition;
    if (!plugin) { this._fail('not-available'); return; }

    try {
      const perm = await plugin.requestPermissions();
      const granted = !perm || !perm.speechRecognition || perm.speechRecognition === 'granted';
      if (!granted) { this._fail('not-allowed'); return; }
    } catch (e) { this._fail('not-allowed'); return; }

    try {
      this._listener = await plugin.addListener('partialResults', (data) => {
        const matches = (data && data.matches) || [];
        if (!matches.length || !this.onresult) return;
        // Native partial results deliver the whole phrase-so-far, not per-segment chunks
        // like the Web Speech API — treat every update as still-interim until the session
        // actually ends below, at which point we commit one final result.
        this.onresult({ resultIndex: 0, results: [ { isFinal: false, 0: { transcript: matches[0] } } ] });
      });
    } catch (e) { /* non-fatal — proceed without live partials */ }

    this._running = true;
    let finalMatches = null;

    // The device/Simulator doesn't always have every locale's speech model
    // available (the iOS Simulator in particular usually only ships en-US) —
    // when that happens the plugin throws "Failed to initialize recognizer".
    // A single session still only understands one English variant at a time
    // (there's no "understand every accent at once" mode), but different
    // variants are still broadly accent-tolerant — so try the locale best
    // suited to this app's actual users first (Australian English, for
    // local terms and slang), then cascade through other major English
    // variants until we find one this specific device actually supports,
    // so the app works regardless of which language packs happen to be
    // installed rather than failing outright. Once we find a locale that
    // actually initializes on this device, remember it for next time so
    // recording (which opens a new session after each pause) isn't
    // repeatedly retrying locales already known to fail here.
    const ENGLISH_LOCALE_FALLBACKS = ['en-AU', 'en-GB', 'en-US', 'en-NZ', 'en-CA', 'en-IE', 'en-ZA', 'en-IN'];
    const langsToTry = NativeSpeechRecognition._workingLang
      ? [NativeSpeechRecognition._workingLang]
      : [...new Set([this.lang || 'en-AU', ...ENGLISH_LOCALE_FALLBACKS])];
    let lastErr = null, started = false;
    for (const lang of langsToTry) {
      try {
        const res = await plugin.start({ language: lang, partialResults: true, popup: false });
        finalMatches = res && res.matches;
        NativeSpeechRecognition._workingLang = lang;
        started = true;
        break;
      } catch (e) {
        lastErr = e;
        const msg = ((e && (e.errorMessage || e.message)) || '') + '';
        if (!/initialize/i.test(msg)) break; // a different kind of error — don't mask it by retrying
      }
    }
    if (!started) {
      this._running = false;
      this._removeListener();
      this._fail((lastErr && (lastErr.errorMessage || lastErr.message)) || 'unknown');
      return;
    }

    this._running = false;
    this._removeListener();
    if (finalMatches && finalMatches.length && this.onresult) {
      this.onresult({ resultIndex: 0, results: [ { isFinal: true, 0: { transcript: finalMatches[0] } } ] });
    }
    if (this.onend) this.onend();
  }

  async stop() {
    if (!this._running) return;
    try {
      const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SpeechRecognition;
      if (plugin) await plugin.stop();
    } catch (e) {}
  }

  abort() { this.stop(); }

  _removeListener() {
    if (this._listener) { try { this._listener.remove(); } catch (e) {} this._listener = null; }
  }

  _fail(reason) {
    this._removeListener();
    if (this.onerror) this.onerror({ error: reason });
  }
}

function getSpeechRecognitionCtor() {
  const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
  const hasNativePlugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SpeechRecognition;
  if (isNative && hasNativePlugin) return NativeSpeechRecognition;
  if (isNative) return null; // native app, plugin not installed yet — no browser fallback exists here
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

// ── VOICE ─────────────────────────────────────────────────────────────────
function toggleRecording() {
  isRecording ? stopRecording() : startRecording();
}

// Evidence-based correction for specific, repeated mishearings documented
// during real-device dictation testing (iOS Safari, 2 Oct 2026) — NOT a
// general-purpose fuzzy matcher. Each entry here is a pattern that was
// observed to fail the SAME way more than once, with the correction scoped
// tightly enough (surrounding context required) that it shouldn't touch
// unrelated speech. Add to this list only once a mishearing has been seen
// to repeat — a one-off garble isn't worth the false-positive risk.
function correctKnownMishearings(text) {
  if (!text) return text;
  // "Kordon" (termite barrier brand) has never once been recognised
  // correctly in testing - it comes back as a phonetically similar common
  // phrase instead. Scoped to only fire directly before "physical termite
  // barrier" so it can't misfire on an unrelated use of e.g. "quote on".
  // "caught on" added after a second test run produced yet another variant -
  // this word clearly has no stable "wrong" spelling, so expect to keep
  // adding to this alternation as new variants turn up.
  text = text.replace(/\b(cold on|quote on|code on|called on|coded on|caught on)\b(?=\s+physical termite barrier)/gi, 'Kordon');
  // "bearer" (a structural timber term) has now been seen mangled three
  // different ways: "Easter Barra", "eastern barrel" (direction word
  // correct, only "bearer" wrong this time), and "barer" ("subfloor
  // barer", "rear barer"). "barrel" is a real, common word, so it's only
  // fixed after a direction; "barer" never comes up in an inspection, so
  // it's fixed wherever it appears.
  text = text.replace(/\beaster\s+(?:barra|barrow|bearer)\b/gi, 'eastern bearer');
  text = text.replace(/\b(eastern|western|northern|southern)\s+barrel\b/gi, '$1 bearer');
  text = text.replace(/\bbarer\b/gi, 'bearer');
  // The three below mirror patterns already vetted in SYSTEM_PROMPT's
  // homophone-handling section (so they're evidence-based, not new guesses)
  // - ported here so they're also fixed in the transcript box itself.
  text = text.replace(/\binsulation\b(?=\s+(?:termite management system|barrier))/gi, 'installation');
  text = text.replace(/\baccess moisture\b/gi, 'excess moisture');
  text = text.replace(/\bweep? poles\b/gi, 'weep holes');
  // Heard once, in the second house test. They're here despite the rule
  // above because none has a sensible literal reading in an inspection,
  // so a wrong fix can't cost anything.
  text = text.replace(/\bsub for\b(?=\s+vents?\b)/gi, 'subfloor');
  text = text.replace(/\bskirting balls\b/gi, 'skirting boards');
  text = text.replace(/\bborrowers\b/gi, 'borers');
  text = text.replace(/\bbatting system\b/gi, 'baiting system');
  text = text.replace(/\bwater strains\b/gi, 'water stains');
  text = text.replace(/\bcalled roof\b/gi, 'tiled roof');
  // Heard in the 12 Oct 2026 car test. None has a sensible literal reading
  // in an inspection; "wheels" and "roof for" are fixed only in the phrase
  // they were heard in.
  text = text.replace(/\b(?:blood tubing|mud shooting)\b/gi, 'mud tubing');
  text = text.replace(/\bdribble notice\b/gi, 'durable notice');
  text = text.replace(/\broof oil\b/gi, 'roof void');
  text = text.replace(/\broof for\b(?=\s+now\b)/gi, 'roof void');
  text = text.replace(/\bchemical barry\b/gi, 'chemical barrier');
  text = text.replace(/\bwheels\b(?=\s+(?:are|were)\s+(?:all\s+)?clear\b)/gi, 'weep holes');
  // Second car test, same day: "ant capped" came back as "in capped", and
  // "subfloor" as "sub for" before "now".
  text = text.replace(/\b(?:in|and|an)\s+capped\b/gi, 'ant capped');
  text = text.replace(/\bsub for\b(?=\s+now\b)/gi, 'subfloor');
  text = text.replace(/\b(subfloor)\s+peers\b/gi, '$1 piers');
  text = text.replace(/\bpeers\b(?=\s+in the subfloor\b)/gi, 'piers');
  // "strawberry" directly before "along the boundary" (or similar) only -
  // left narrower than the AI prompt's version since "strawberry" alone is
  // a real word that could legitimately come up (e.g. a garden bed).
  text = text.replace(/\bstrawberry\b(?=\s+(?:along|growing along|against)\s+the\s+boundary)/gi, 'shrubbery');
  // Scan of all 59 test notes, 30 Oct 2026. Each has no sensible literal
  // reading in an inspection, or is fixed only in the phrase it was heard in.
  // A fix at the start of a sentence keeps its capital letter.
  const fix = (re, to) => {
    text = text.replace(re, (m, at, all) => /^\s*$|[.!?]\s+$/.test(all.slice(0, at)) ? to[0].toUpperCase() + to.slice(1) : to);
  };
  // "piers ant capped" came back four ways from Safari.
  fix(/\b(?:peers|peas)\s+(?:are\s+)?(?:in|and|an|ant|a|currently a)\s+(?:cunt|cut|cat|capped)\b/gi, 'piers ant capped');
  fix(/\band capping\b/gi, 'ant capping');
  fix(/\bport coast\b/gi, 'porch post');
  fix(/\binvestment inspection\b/gi, 'invasive inspection');
  fix(/\bgarden belts\b/gi, 'garden beds');
  fix(/\bstalled items\b/gi, 'stored items');
  fix(/\bbearer holes\b/gi, 'borer holes');
  fix(/\bre-deck\b/gi, 'rear deck');
  fix(/\bat the re and\b/gi, 'at the rear and');
  fix(/\bwe pull a clear\b/gi, 'weep holes clear');
  fix(/\bfrench bus\b/gi, 'fresh frass');
  fix(/\broof fluid\b/gi, 'roof void');
  // Live phone test, 2 Nov 2026, twice in one note each: "Cordon physical
  // barrier", "this cordon barrier"; "bats laid over everything", "once the
  // bats are removed" (insulation batts, also heard in an earlier test).
  fix(/\bcordon\b(?=\s+(?:physical\s+|termite\s+)*barrier\b)/gi, 'Kordon');
  fix(/\bbats\b(?=\s+(?:laid|lying|covering|over (?:the\s+)?(?:ceiling|joists|top plates|everything)|(?:are|were|get|have been)\s+(?:re)?moved)\b)/gi, 'batts');
  fix(/\binsulation bats\b/gi, 'insulation batts');
  // "soil barrier" lost its first letter at a phrase break ("Oil barrier").
  text = text.replace(/(^|[.!?]\s+|\bchemical\s+)oil barrier\b/gi, (m, pre) => pre + (/^\s*$|[.!?]\s*$/.test(pre) ? 'Soil' : 'soil') + ' barrier');
  // Subfloor clearance is always millimetres; "400ml", "400 mil".
  text = text.replace(/\b(clearance\D{0,20}?\d+)\s*(?:ml|mils?)\b/gi, '$1 mm');
  // ...and said the other way round: "about 200 mil clearance" (2 Nov 2026).
  text = text.replace(/\b(\d+)\s*(?:ml|mils?)\b(?=\s+(?:of\s+)?clearance\b)/gi, '$1 mm');
  // Whisper writes a cough as words.
  text = text.replace(/(?:^|\s)(?:\(?cough\)?[.,]?\s*)+(?=\s|$)/gi, ' ').replace(/\s{2,}/g, ' ').trim();
  // And the fixes this business has made twice (see LEARNED CORRECTIONS).
  return applyLearnedWordFixes(text);
}

// Brand/product names and species genera, sent to the transcription
// backend as a vocabulary hint (see buildTranscriptionVocabHint below).
// There used to be a client-side fuzzy matcher over this list too. It was
// removed after a real test (5 Oct 2026) showed it rewriting ordinary words
// into brand names: "termites" became "Termimesh" and "external" became
// "Exterra". Brand names in the wrong slot are left to SYSTEM_PROMPT's
// contextual reasoning, which can see the whole sentence.
const TRANSCRIPTION_VOCAB = [
  'Kordon', 'Termidor', 'Altriset', 'Premise', 'Bifenthrin', 'Biflex',
  'Exterra', 'Sentricon', 'Trelona', 'Termimesh',
  'Coptotermes', 'Schedorhinotermes', 'Nasutitermes', 'Cryptotermes',
];

// ── AI TRANSCRIPT CLEANUP (suggest-and-confirm, never automatic) ──────────
// Unlike correctKnownMishearings() above, which only fixes specific phrases
// already seen to go wrong in testing, this asks the AI to reason about
// genuinely garbled stretches of the transcript - the
// "Shut up Scott Stratford Number Double" kind of result that doesn't
// resemble anything on a word-list. That's real signal loss, not a simple
// mishearing, and an AI asked to "fix" it can't recover what was actually
// said - it can only invent something plausible. For a transcript that
// becomes evidence in a professional report, a confident-looking
// fabrication slipping through unnoticed is worse than an obviously
// garbled one, so this NEVER touches the transcript on its own. It always
// shows the inspector exactly what it would change and waits for Apply.
const TRANSCRIPT_CLEANUP_PROMPT = `You are proofreading a voice-dictated transcript from an Australian termite/pest inspection technician (SAYON app). The transcript came from on-device speech recognition and may contain mishearings - a garbled word or phrase standing in for the real one, based on how it sounds.

Your job: produce a corrected version of the transcript, fixing ONLY mishearings you can confidently resolve from context - the same judgement an experienced inspector would use proofreading a colleague's dictation. Known categories to watch for: brand/product names (Kordon, Termidor, Altriset, Phantom, Bifenthrin, Biflex, Maxxthor, Talstar, Exterra, Sentricon, Trelona, Termimesh, HomeGuard Blue), species names (e.g. Coptotermes acinaciformis), and pest-inspection technical terms (e.g. "bearer", "joists", "piers", "ant caps", "skirting boards", "borers", "weep holes", "shrubbery", "installation", "subfloor", "exterior", "baiting system"). A brand name can also be wrong: if one sits where an ordinary word belongs (e.g. "active Termimesh found in the tree"), restore the ordinary word ("termites").

CRITICAL: if a stretch of the transcript is too garbled to confidently reconstruct - not a mispronounced word, but content that doesn't resemble anything sensible in a pest-inspection context at all - do NOT invent or guess what it might have meant. Leave that exact stretch exactly as transcribed, and set hasUncertainSections to true. It is always better to leave garbage as garbage than to fabricate plausible-sounding content for a professional report. Only rewrite what you're genuinely confident about.

Return ONLY valid JSON, no other text: {"cleaned": string, "hasUncertainSections": boolean}`;

let cleanupSuggestion = null;
let cleanupOriginalText = null;

async function suggestTranscriptCleanup() {
  if (!currentTranscript.trim()) return;
  const btn = document.getElementById('cleanupSuggestBtn');
  const originalLabel = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Thinking…'; }
  cleanupOriginalText = currentTranscript;

  try {
    const res = await workerFetch('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        // Thinking counts toward max_tokens (see requestExtraction()), and
        // the answer repeats the whole transcript, so leave room for both.
        max_tokens: 8000,
        output_config: { effort: 'low' },
        system: TRANSCRIPT_CLEANUP_PROMPT,
        messages: [{ role: 'user', content: currentTranscript }]
      })
    });
    const rawBody = await res.text();
    let data;
    try { data = JSON.parse(rawBody); }
    catch { throw new Error(`HTTP ${res.status}: ${rawBody.slice(0, 200) || '(empty response)'}`); }
    if (!res.ok || data.error) {
      const errMsg = data.error?.message || data.error?.type || `HTTP ${res.status}`;
      throw new Error('API error: ' + errMsg);
    }
    if (data.stop_reason === 'max_tokens') {
      throw new Error('AI response was cut off (transcript too long for the response limit)');
    }
    const text = data.content.map(i => i.text || '').join('');
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    if (!parsed || typeof parsed.cleaned !== 'string') throw new Error('Unexpected response shape');
    cleanupSuggestion = parsed;
    showCleanupSuggestion(parsed);
  } catch (err) {
    const reason = ((err && err.message) ? String(err.message) : 'unknown error').slice(0, 140);
    showToast('AI cleanup unavailable: ' + reason, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
  }
}

function showCleanupSuggestion(suggestion) {
  const panel = document.getElementById('cleanupPanel');
  const textEl = document.getElementById('cleanupPanelText');
  const noteEl = document.getElementById('cleanupPanelNote');
  if (!panel || !textEl) return;
  textEl.textContent = suggestion.cleaned;
  if (noteEl) noteEl.style.display = suggestion.hasUncertainSections ? 'block' : 'none';
  panel.style.display = 'block';
}

function applyCleanupSuggestion() {
  if (!cleanupSuggestion) return;
  // If the transcript changed since this suggestion was generated (the
  // inspector kept editing, or started a new recording), the suggestion no
  // longer matches what's in the box - dismiss rather than silently
  // overwrite edits the inspector made in the meantime.
  if (currentTranscript !== cleanupOriginalText) {
    showToast('The transcript changed after this suggestion was made, so it was dropped to keep your edits', 'error');
    dismissCleanupSuggestion();
    return;
  }
  currentTranscript = cleanupSuggestion.cleaned;
  const box = document.getElementById('transcriptBox');
  if (box) {
    box.textContent = currentTranscript;
    box.classList.add('active');
  }
  showToast('Cleanup applied. Check it before extracting', 'success');
  dismissCleanupSuggestion();
}

function dismissCleanupSuggestion() {
  cleanupSuggestion = null;
  cleanupOriginalText = null;
  const panel = document.getElementById('cleanupPanel');
  if (panel) panel.style.display = 'none';
}

// ── EXPERIMENTAL AUDIO CAPTURE / SERVER-SIDE TRANSCRIPTION ─────────────────
// See the long comment at the state declarations above for why this is
// opt-in and defaults off. Everything below is written so that if any part
// of it fails — unsupported browser, mic busy, network error, the Worker
// endpoint not existing yet — the technician sees nothing different at all:
// the existing Web Speech transcript is already complete and usable by the
// time any of this would matter.

function toggleAudioCaptureSetting() {
  audioCaptureEnabled = !audioCaptureEnabled;
  const btn = document.getElementById('toggleAudioCapture');
  if (btn) btn.classList.toggle('on', audioCaptureEnabled);
  try { localStorage.setItem('korva_audio_capture_enabled', audioCaptureEnabled ? '1' : '0'); } catch (e) {}
  // Re-arm the self-disable guard whenever the technician deliberately
  // turns this back on, so a failure from a much earlier session (or a
  // since-fixed bug) doesn't permanently lock the toggle into a no-op.
  if (audioCaptureEnabled) audioCaptureFailedThisSession = false;
}

function restoreAudioCaptureSetting() {
  try {
    audioCaptureEnabled = localStorage.getItem('korva_audio_capture_enabled') === '1';
    const btn = document.getElementById('toggleAudioCapture');
    if (btn) btn.classList.toggle('on', audioCaptureEnabled);
  } catch (e) {}
}

function isAudioCaptureSupported() {
  if (audioCaptureSupportCache !== null) return audioCaptureSupportCache;
  audioCaptureSupportCache = !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function' && typeof window.MediaRecorder === 'function');
  return audioCaptureSupportCache;
}

function pickAudioMimeType() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  // audio/mp4 first: that's what iOS Safari (the primary target device for
  // this app) actually supports and records in — webm/ogg are Chrome/Firefox
  // formats Safari's MediaRecorder doesn't produce.
  const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return ''; // let the browser pick its own default rather than fail outright
}

function stopAudioCaptureTracks() {
  if (audioCaptureStream) {
    try { audioCaptureStream.getTracks().forEach(t => t.stop()); } catch (e) {}
  }
  audioCaptureStream = null;
}

// Starts a SECOND, independent mic capture purely for the experimental
// higher-accuracy path — called from startRecording() only when the opt-in
// setting is on. Every failure path here is silent (console.warn only): the
// primary Web Speech transcript already has its own separate mic access via
// recognition.start() and is unaffected either way.
async function startAudioCapture() {
  audioRecordedChunks = [];
  if (!audioCaptureEnabled || audioCaptureFailedThisSession || !isAudioCaptureSupported()) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCaptureStream = stream;
    const mimeType = pickAudioMimeType();
    mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) audioRecordedChunks.push(e.data);
    };
    mediaRecorder.onerror = (e) => {
      // If the recorder itself throws mid-session, don't keep trying on
      // every future recording this session — something about this
      // device/combination isn't working, and the dictation feature it
      // runs alongside must never be put at risk chasing it.
      console.warn('Audio capture error — disabling experimental audio transcription for the rest of this session:', e && e.error);
      audioCaptureFailedThisSession = true;
      stopAudioCaptureTracks();
    };
    mediaRecorder.start();
  } catch (err) {
    console.warn('Audio capture unavailable this recording (speech-recognition transcript is unaffected):', err && err.message);
    mediaRecorder = null;
    audioCaptureStream = null;
  }
}

// Stops the parallel recording (if any) and resolves with a Blob once the
// recorder has actually flushed its last chunk, or null if nothing was
// captured / capture wasn't running. Never rejects.
function stopAudioCapture() {
  return new Promise((resolve) => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      stopAudioCaptureTracks();
      resolve(null);
      return;
    }
    const recorder = mediaRecorder;
    const mimeType = recorder.mimeType || 'audio/webm';
    recorder.onstop = () => {
      stopAudioCaptureTracks();
      const chunks = audioRecordedChunks;
      audioRecordedChunks = [];
      resolve(chunks.length ? new Blob(chunks, { type: mimeType }) : null);
    };
    try { recorder.stop(); } catch (e) { stopAudioCaptureTracks(); resolve(null); }
    mediaRecorder = null;
  });
}

// Vocabulary hint sent to the transcription backend (Whisper's
// initial_prompt biases recognition toward words it's given, without
// forcing them). Written like an inspection note, since Whisper follows the
// style of its prompt as well as the words. Every trade word here is one
// Whisper or Safari has misheard in a real test (scan of 59 test notes,
// 30 Oct 2026). The everyday words sit alongside the brand names so the hint
// doesn't pull "termites" or "exterior" towards a similar-sounding brand.
// Keep it under about 650 characters: Whisper only reads the last ~220
// tokens of a prompt, and the words just spoken are added after this.
function buildTranscriptionVocabHint() {
  // Plus the words this business has corrected to (LEARNED CORRECTIONS).
  const learned = learnedHintWords(100);
  return 'Timber pest inspection notes, Australia. Termites, subfloor, bearers and joists, brick piers ant capped, ' +
    'ant capping, roof void, insulation, weep holes clear, slab edge, garden beds, skirting boards, porch post, ' +
    'rear deck, stored items, exterior, shrubbery. Mud leads, borer holes, fresh frass, moisture reading 28%, ' +
    'clearance 400 mm, durable notice, termite management system, soil barrier, invasive inspection. ' +
    TRANSCRIPTION_VOCAB.join(', ') + '.' + (learned ? ' ' + learned + '.' : '');
}

// Uploads the captured audio to the Worker's transcription endpoint and, on
// a clean result, offers it as a suggestion — the same suggest-and-confirm
// pattern as AI cleanup above, for the same reason: this has never run in
// real field conditions, and silently swapping out a transcript the
// technician can already see and trust is a bigger risk than a wording fix.
// On ANY failure (network error, non-2xx, Worker AI error, bad
// response shape) this fails completely silently — console.warn only — so
// the Web Speech transcript already in the box remains exactly as if this
// feature didn't exist.
//
// Served by the Worker's /transcribe route (worker/worker.js, v7+), which
// expects multipart `audio` + optional `initial_prompt` and returns
// { transcript }.
async function tryServerSideTranscription(blob, before) {
  if (!blob) return;
  try {
    const formData = new FormData();
    const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    formData.append('audio', blob, `recording.${ext}`);
    formData.append('initial_prompt', buildTranscriptionVocabHint());
    const res = await workerFetch('/transcribe', {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data || typeof data.transcript !== 'string' || !data.transcript.trim()) throw new Error('Unexpected response shape');
    showServerTranscriptionSuggestion(data.transcript.trim(), before);
  } catch (err) {
    console.warn('Server-side transcription unavailable this recording — keeping the on-device transcript:', err && err.message);
  }
}

function showServerTranscriptionSuggestion(transcript, before) {
  // Guard against a slow response landing after the technician already
  // moved on (extracted, started a new recording, navigated away) — only
  // show it if we're still looking at the same transcript this capture
  // started with.
  if (isRecording || currentTranscript !== serverTranscriptOriginalText || !currentTranscript.startsWith(before)) return;
  serverTranscriptSuggestion = transcript;
  serverTranscriptBefore = before;
  const panel = document.getElementById('serverTranscriptPanel');
  const textEl = document.getElementById('serverTranscriptPanelText');
  if (!panel || !textEl) return;
  textEl.textContent = transcript;
  panel.style.display = 'block';
}

function applyServerTranscript() {
  if (!serverTranscriptSuggestion) return;
  if (currentTranscript !== serverTranscriptOriginalText) {
    showToast('The transcript changed after this version was made, so it was dropped to keep your edits', 'error');
    dismissServerTranscript();
    return;
  }
  const before = serverTranscriptBefore;
  const gap = before && !/\s$/.test(before) ? ' ' : '';
  currentTranscript = before + gap + serverTranscriptSuggestion + ' ';
  const box = document.getElementById('transcriptBox');
  if (box) { box.textContent = currentTranscript; box.classList.add('active'); }
  showToast('Swapped in the other version of your last recording. Check it before you extract', 'success');
  dismissServerTranscript();
}

function dismissServerTranscript() {
  serverTranscriptSuggestion = null;
  serverTranscriptOriginalText = null;
  serverTranscriptBefore = '';
  const panel = document.getElementById('serverTranscriptPanel');
  if (panel) panel.style.display = 'none';
}

// ── WHISPER LISTENING ─────────────────────────────────────────────────────
// The phone's own speech service (Web Speech in Safari) badly mishears trade
// words: "live termites in the front porch post" came back as "last night in
// Port Coast" in the 28 Oct field test. When the phone is online and signed
// in, the mic is recorded instead and each phrase is sent to Whisper through
// the Worker's /transcribe, with the trade vocabulary as a hint. Text lands a
// moment after each pause, in order. Only one thing uses the mic at a time:
// Web Speech is the fallback when Whisper can't be used, never alongside it.
const WHISPER_PAUSE_MS = 1200;       // a pause this long ends a phrase
const WHISPER_MAX_SEGMENT_MS = 15000; // a phrase is cut here even mid-flow
const WHISPER_LONG_SEGMENT_MS = 8000;  // after this, a short breath ends the phrase
const WHISPER_SHORT_PAUSE_MS = 500;
const WHISPER_MIN_SPEECH_MS = 300;    // less than this is a cough or a bump
const WHISPER_POLL_MS = 100;
// What Whisper is known to "hear" in near-silence.
const WHISPER_NOISE_RE = /^(?:thank you|thanks for watching|thank you for watching|you|bye|okay|\.)[.!\s]*$/i;

let whisper = null;          // the live session, or null
let whisperOff = false;      // Whisper failed this visit: use the phone's speech
let whisperQueue = [];       // phrases sent or waiting, in the order spoken
let whisperSettleWaiters = [];
let voiceJobEpoch = 0;       // goes up when the job changes, see clearFilledNotes

function canUseWhisperListening() {
  const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
  return !isNative && !whisperOff && navigator.onLine && !!authSession?.access_token
    && isAudioCaptureSupported() && !!(window.AudioContext || window.webkitAudioContext);
}

// Resolves once every phrase spoken so far has come back (or after a
// timeout), so a fill never runs before the last words are in.
function whisperSettled(timeoutMs = 15000) {
  if (!whisperQueue.length) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(done, timeoutMs);
    function done() { clearTimeout(timer); whisperSettleWaiters = whisperSettleWaiters.filter(f => f !== done); resolve(); }
    whisperSettleWaiters.push(done);
  });
}

function whisperShowPending() {
  const box = document.getElementById('transcriptBox');
  if (!box) return;
  const waiting = whisperQueue.length || (whisper && whisper.speechMs >= WHISPER_MIN_SPEECH_MS);
  box.textContent = currentTranscript + (waiting ? '…' : '');
  box.classList.toggle('active', !!(currentTranscript || waiting));
}

// Returns true when Whisper listening started; false means use Web Speech.
async function startWhisperListening() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  // Made inside the tap, before any await, so iPhone lets it run.
  const ctx = new Ctx();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (err) {
    try { ctx.close(); } catch (e) {}
    console.warn('Whisper listening: no mic stream, using the phone\'s speech instead:', err && err.message);
    return false;
  }
  if (!isRecording) { stream.getTracks().forEach(t => t.stop()); try { ctx.close(); } catch (e) {} return true; }
  try { await ctx.resume(); } catch (e) {}
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const s = whisper = {
    ctx, stream, analyser, buf: new Float32Array(analyser.fftSize),
    recorder: null, chunks: [], startedAt: 0, speechMs: 0, quietMs: 0,
    floor: 0.01, epoch: voiceJobEpoch, timer: null,
  };
  whisperNewSegment(s);
  s.timer = setInterval(() => whisperTick(s), WHISPER_POLL_MS);
  return true;
}

function whisperNewSegment(s) {
  const mimeType = pickAudioMimeType();
  const rec = mimeType ? new MediaRecorder(s.stream, { mimeType }) : new MediaRecorder(s.stream);
  const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };
  rec.start();
  s.recorder = rec; s.chunks = chunks; s.startedAt = Date.now(); s.speechMs = 0; s.quietMs = 0;
}

function whisperTick(s) {
  if (whisper !== s) return;
  s.analyser.getFloatTimeDomainData(s.buf);
  let sum = 0;
  for (let i = 0; i < s.buf.length; i++) sum += s.buf[i] * s.buf[i];
  const rms = Math.sqrt(sum / s.buf.length);
  const threshold = Math.max(0.012, s.floor * 3);
  if (rms > threshold) {
    s.speechMs += WHISPER_POLL_MS; s.quietMs = 0;
    waveLevel = Math.min(1, Math.max(waveLevel, rms * 8));
  } else {
    s.quietMs += WHISPER_POLL_MS;
    s.floor = s.floor * 0.95 + rms * 0.05; // follows the background noise
  }
  if (s.speechMs >= WHISPER_MIN_SPEECH_MS && s.speechMs < WHISPER_MIN_SPEECH_MS + WHISPER_POLL_MS) whisperShowPending();
  const age = Date.now() - s.startedAt;
  // Someone reading straight through barely pauses, so a long phrase ends
  // at the next breath rather than being cut mid-word at the limit.
  const pause = age >= WHISPER_LONG_SEGMENT_MS ? WHISPER_SHORT_PAUSE_MS : WHISPER_PAUSE_MS;
  if ((s.speechMs >= WHISPER_MIN_SPEECH_MS && s.quietMs >= pause) || age >= WHISPER_MAX_SEGMENT_MS) whisperCutSegment(s);
}

// Ends the current phrase and starts the next one straight away, so no
// words fall between the two.
function whisperCutSegment(s, last) {
  const rec = s.recorder, chunks = s.chunks, hadSpeech = s.speechMs >= WHISPER_MIN_SPEECH_MS;
  if (!rec) return Promise.resolve();
  if (!last) whisperNewSegment(s);
  const entry = hadSpeech ? { text: null, done: false, epoch: s.epoch } : null;
  if (entry) whisperQueue.push(entry);
  const finished = new Promise(resolve => {
    rec.onstop = () => resolve(chunks.length ? new Blob(chunks, { type: rec.mimeType || 'audio/mp4' }) : null);
    try { rec.stop(); } catch (e) { resolve(null); }
  });
  if (!entry) return finished;
  whisperShowPending();
  return finished.then(blob => whisperSend(entry, blob, 0));
}

async function whisperSend(entry, blob, tries) {
  if (!blob) { entry.done = true; whisperApply(); return; }
  try {
    const form = new FormData();
    const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    form.append('audio', blob, `phrase.${ext}`);
    // The words just before help Whisper with the next phrase.
    const context = currentTranscript.trim().slice(-300);
    form.append('initial_prompt', (buildTranscriptionVocabHint() + ' Say "Stop Sayon" to finish.' + (context ? ' ' + context : '')).slice(-1000));
    const res = await workerFetch('/transcribe', { method: 'POST', body: form });
    if (res.status === 502 && /no text/i.test(await res.text().catch(() => ''))) { entry.text = ''; entry.done = true; whisperApply(); return; } // nothing heard
    if (!res.ok) { const err = new Error('HTTP ' + res.status); err.status = res.status; throw err; }
    const data = await res.json();
    entry.text = typeof data?.transcript === 'string' ? data.transcript.trim() : '';
    entry.done = true;
    whisperApply();
  } catch (err) {
    const status = err && err.status;
    if (!status && tries < 20) {
      // No signal: try again once it's back, the words aren't lost.
      const wait = navigator.onLine ? Math.min(2000 * (tries + 1), 10000) : 0;
      if (!navigator.onLine) window.addEventListener('online', () => whisperSend(entry, blob, tries + 1), { once: true });
      else setTimeout(() => whisperSend(entry, blob, tries + 1), wait);
      return;
    }
    // Whisper on the server sometimes fails one phrase and answers the
    // next: try a failed phrase twice more before giving up on it.
    if (status >= 500 && status !== 501 && (entry.serverTries || 0) < 2) {
      entry.serverTries = (entry.serverTries || 0) + 1;
      setTimeout(() => whisperSend(entry, blob, tries), 1500 * entry.serverTries);
      return;
    }
    console.warn('Whisper listening failed, using the phone\'s speech instead:', err && err.message);
    entry.text = ''; entry.done = true;
    whisperApply();
    // The phrase that failed is lost, so say so: the inspector can repeat it.
    whisperFallBack(status === 429 ? 'This month\'s AI fills are used up. The last few words were missed, so say them again' : 'The last few words were missed. Say them again, the phone\'s own speech is listening now');
  }
}

// Adds finished phrases to the transcript in the order they were spoken.
function whisperApply() {
  while (whisperQueue.length && whisperQueue[0].done) {
    const entry = whisperQueue.shift();
    let text = (entry.text || '').trim();
    if (!text || WHISPER_NOISE_RE.test(text)) continue;
    if (entry.epoch !== voiceJobEpoch) { showToast('You changed job before the last words came back, so they were left out', 'info'); continue; }
    text = correctKnownMishearings(text);
    const stopAt = text.search(VOICE_STOP_LIVE_RE);
    if (stopAt >= 0) text = text.slice(0, stopAt).trim();
    if (text) { currentTranscript += text + ' '; speechHeard(text); }
    pulseWave();
    if (stopAt >= 0 && isRecording) {
      stopRecording();
      playTone(440, 200, 0.2);
      setTimeout(() => { if (!isRecording && currentTranscript.trim()) processTranscript(); }, 600);
    }
    if (!isRecording && currentTranscript.trim()) document.getElementById('extractBtn').disabled = false;
    saveDraft();
  }
  whisperShowPending();
  if (!whisperQueue.length) whisperSettleWaiters.slice().forEach(f => f());
}

// Ends the session; the last phrase is still sent. Resolves when the mic
// is released.
function stopWhisperListening() {
  const s = whisper;
  if (!s) return Promise.resolve();
  whisper = null;
  clearInterval(s.timer);
  const last = whisperCutSegment(s, true);
  return Promise.resolve(last).catch(() => {}).finally(() => {
    try { s.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
    try { s.ctx.close(); } catch (e) {}
  });
}

// Whisper can't be used (not set up, allowance used, signed out): finish
// this recording with the phone's speech, and keep to it for this visit.
function whisperFallBack(message) {
  if (whisperOff) return;
  whisperOff = true;
  if (!whisper) return;
  showToast(message, 'info');
  stopWhisperListening().then(() => { if (isRecording && whisperFallbackListen) whisperFallbackListen(); });
}
let whisperFallbackListen = null;

// The wave under the mic moves with what the phone hears: each batch of
// words it recognises kicks the bars up, and they settle back while it's
// quiet. It reads the speech results, not the microphone, so it never opens
// a second mic (two at once isn't proven safe on iPhone) and it only moves
// when words are actually coming through.
let waveLevel = 0, waveFrame = 0;
function pulseWave() { waveLevel = Math.min(1, waveLevel + 0.55); }
function driveWave(on) {
  cancelAnimationFrame(waveFrame);
  const bars = [...document.querySelectorAll('#waveform .wave-bar, #micFab .wave-bar')];
  if (!on) { waveLevel = 0; bars.forEach(b => { b.style.height = ''; }); return; }
  const tick = t => {
    waveLevel *= 0.95;
    bars.forEach((b, i) => {
      const swing = 0.55 + 0.45 * Math.sin(t / 90 + i * 1.3);
      b.style.height = (3 + 1.5 * (0.5 + 0.5 * Math.sin(t / 400 + i)) + 14 * waveLevel * swing).toFixed(1) + 'px';
    });
    waveFrame = requestAnimationFrame(tick);
  };
  waveFrame = requestAnimationFrame(tick);
}

function startRecording() {
  const SR = getSpeechRecognitionCtor();
  const useWhisper = canUseWhisperListening();
  if (!SR && !useWhisper) { showToast('Speech recognition isn\'t supported here. Tap the transcript box to type instead', 'error'); return; }
  track('dictation_started');

  lowConfidenceFlagged = false;
  const warnEl0 = document.getElementById('lowConfidenceWarning');
  if (warnEl0) warnEl0.classList.remove('show');
  dismissCleanupSuggestion();
  dismissServerTranscript();
  recordingStartText = currentTranscript;

  // Browsers end a speech session on their own after a quiet stretch or a
  // minute or so of talk. While the inspector still has recording on, open a
  // new session straight away so the phone keeps listening room to room,
  // even when nobody is speaking into it. stopRecording() replaces onend, so
  // a deliberate stop never restarts. A session that keeps dying at once
  // (mic taken by another app) stops after a few tries instead of looping.
  let quickEnds = 0;
  const listen = () => {
    const startedAt = Date.now();
    recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-AU';

    // Safari re-delivers results it has already finalised (the same index
    // comes back as final again, or the same phrase arrives as a fresh final
    // result a moment later), which doubled phrases like "Wall construction
    // Wall construction". Commit each result index once, and drop a final
    // chunk that exactly repeats the one just committed.
    let committedUpTo = -1;
    let lastFinalText = '';
    let lastFinalAt = 0;
    // Words heard but not yet final. When the phone ends a session on its
    // own mid-sentence they never come back as final, which lost a whole
    // room in a field test, so onend keeps them before listening again.
    let pendingInterim = '';

    recognition.onresult = (e) => {
      let interim = '', final = '', stopByVoice = false;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          if (i <= committedUpTo) continue;
          committedUpTo = i;
          const rawChunk = e.results[i][0].transcript.trim();
          const now = Date.now();
          if (rawChunk.toLowerCase() === lastFinalText && now - lastFinalAt < 3000) continue;
          lastFinalText = rawChunk.toLowerCase();
          lastFinalAt = now;
          let finalChunk = e.results[i][0].transcript;
          // Some platforms never populate confidence (comes back as exactly
          // 0 or undefined) - treat that as "unknown", not "low", so this
          // doesn't false-flag every result on devices that don't support it.
          const conf = e.results[i][0].confidence;
          if (typeof conf === 'number' && conf > 0 && conf < 0.6) {
            lowConfidenceFlagged = true;
          }
          finalChunk = correctKnownMishearings(finalChunk);
          // Cut from the stop words on, again if the phone repeated them.
          for (let stopAt; (stopAt = finalChunk.search(VOICE_STOP_RE)) >= 0;) { finalChunk = finalChunk.slice(0, stopAt); stopByVoice = true; }
          if (finalChunk.trim()) final += finalChunk.trim() + ' ';
        }
        else interim += e.results[i][0].transcript;
      }
      currentTranscript += final;
      pendingInterim = interim;
      // Each phrase goes to the draft as it lands, so a tab the phone kills
      // mid-dictation loses the current sentence at most.
      if (final) { speechHeard(final); saveDraft(); }
      pulseWave();
      const box = document.getElementById('transcriptBox');
      box.textContent = currentTranscript + interim;
      box.classList.add('active');
      const warnEl = document.getElementById('lowConfidenceWarning');
      if (warnEl) warnEl.classList.toggle('show', lowConfidenceFlagged);
      if (!stopByVoice && VOICE_STOP_LIVE_RE.test(interim)) stopByVoice = true;
      if (stopByVoice && isRecording) {
        // "Stop Sayon": stop, then fill in the rest once the last phrase is
        // in. Heard first in the live text, the final copy that follows the
        // stop has the words cut off above and doesn't stop twice.
        stopRecording();
        playTone(440, 200, 0.2);
        setTimeout(() => { if (!isRecording && currentTranscript.trim()) processTranscript(); }, 2100);
      }
    };

    recognition.onerror = (e) => {
      // FIX: this used to silently discard the error entirely, so when
      // recognition failed or produced garbage there was no way to tell
      // whether it was a network drop, a mic/permission problem, no speech
      // detected, or something else — every failure looked identical from
      // the outside. Surface the actual reason (console + toast) so a bad
      // field test can actually be diagnosed instead of guessed at.
      const reason = (e && e.error) ? e.error : 'unknown';
      console.warn('Speech recognition error:', reason);
      // A quiet stretch (moving between rooms, phone in a pocket) is not a
      // reason to stop: onend opens a fresh session and keeps listening.
      if (reason === 'no-speech' || reason === 'aborted') return;
      const messages = {
        'network': 'No signal for voice recording. Tap the box and use your keyboard\'s mic to dictate instead. The note is saved and fills in when you\'re back online',
        'audio-capture': 'The microphone isn\'t available. Check the mic permission and that no other app is using it',
        'not-allowed': 'Microphone permission is off. Turn it on in your browser or phone settings',
        'service-not-allowed': 'Speech recognition isn\'t allowed. Check your browser or phone permissions',
        'language-not-supported': 'This phone doesn\'t support Australian English speech recognition',
      };
      showToast(messages[reason] || `Speech recognition stopped (${reason})`, 'error');
      stopRecording();
    };
    recognition.onend = () => {
      if (!isRecording) return;
      let kept = correctKnownMishearings(pendingInterim).trim();
      pendingInterim = '';
      if (kept) {
        const stopAt = kept.search(VOICE_STOP_RE);
        if (stopAt >= 0) kept = kept.slice(0, stopAt).trim();
        if (kept) currentTranscript += kept + ' ';
        document.getElementById('transcriptBox').textContent = currentTranscript;
        if (stopAt >= 0) {
          stopRecording();
          playTone(440, 200, 0.2);
          setTimeout(() => { if (!isRecording && currentTranscript.trim()) processTranscript(); }, 2100);
          return;
        }
      }
      quickEnds = Date.now() - startedAt < 1500 ? quickEnds + 1 : 0;
      if (quickEnds >= 5) { showToast('Recording stopped: the microphone kept dropping out', 'error'); stopRecording(); return; }
      try { listen(); } catch (e) { stopRecording(); }
    };
    recognition.start();
  };
  whisperFallbackListen = SR ? () => { try { listen(); } catch (e) { stopRecording(); } } : null;
  if (useWhisper) {
    recognition = null;
    startWhisperListening().catch(err => { console.warn('Whisper listening could not start:', err && err.message); stopWhisperListening(); return false; }).then(ok => {
      if (ok || !isRecording) return;
      if (whisperFallbackListen) whisperFallbackListen(); else stopRecording();
    });
  } else listen();
  holdScreenAwake();
  setPocketLock(true);
  isRecording = true;
  updateVoiceHud();
  document.getElementById('voiceBtn').classList.add('recording');
  document.getElementById('voiceBtnText').textContent = 'Recording… tap to stop';
  document.getElementById('waveform').classList.add('show');
  driveWave(true);
  document.getElementById('extractBtn').disabled = true;

  // EXPERIMENTAL, opt-in (see the state-declaration comment above) — started
  // AFTER recognition.start() so the primary, working dictation path is
  // already underway before this second, unproven mic consumer gets
  // involved at all. Fire-and-forget: startAudioCapture() handles its own
  // errors internally and never throws. Not needed while Whisper is
  // already listening.
  if (!useWhisper) startAudioCapture();
}

// Resolves once recognition has delivered its last result. Web Speech
// sends the final phrase in onresult AFTER stop(), so anything that reads
// currentTranscript right after stopping misses it. Falls back after 2s in
// case onend never fires (e.g. stop() after an error already ended it).
function waitForRecognitionEnd(rec) {
  if (!rec) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(resolve, 2000);
    rec.onend = () => { clearTimeout(timer); resolve(); };
  });
}

// Pocket lock: while recording, a shield under the voice popover takes
// every touch, so the page behind can't be scrolled or tapped from a pocket,
// the transcript box can't be typed into and the popover's close button is
// hidden. A tap on Stop (or "Stop Sayon") ends the recording.
function setPocketLock(on) {
  const shield = document.getElementById('pocketShield');
  if (shield) shield.hidden = !on;
  document.body.classList.toggle('pocket-lock', on);
  const box = document.getElementById('transcriptBox');
  if (box) box.setAttribute('contenteditable', on ? 'false' : 'true');
  if (on && document.activeElement && document.activeElement.blur) document.activeElement.blur();
}
document.getElementById('pocketShield')?.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

// The note box keeps its newest words in sight: while listening only a few
// lines show. Left alone while the inspector is typing in it.
(() => {
  const box = document.getElementById('transcriptBox');
  if (!box || typeof MutationObserver !== 'function') return;
  new MutationObserver(() => { if (document.activeElement !== box) box.scrollTop = box.scrollHeight; })
    .observe(box, { childList: true, characterData: true, subtree: true });
})();

// The screen stays on while recording: a phone that locks itself in a
// pocket stops hearing, because the browser drops the mic.
let screenWakeLock = null;
async function holdScreenAwake() {
  try { if (navigator.wakeLock && !screenWakeLock) { screenWakeLock = await navigator.wakeLock.request('screen'); screenWakeLock.addEventListener('release', () => { screenWakeLock = null; }); } } catch (e) {}
}
function releaseScreenAwake() {
  try { if (screenWakeLock) screenWakeLock.release(); } catch (e) {}
  screenWakeLock = null;
}
// The lock is let go whenever the app is hidden, so take it again on return.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && isRecording) holdScreenAwake(); });

function stopRecording() {
  stopWhisperListening();
  releaseScreenAwake();
  setPocketLock(false);
  const recognitionEnded = waitForRecognitionEnd(recognition);
  if (recognition) recognition.stop();
  isRecording = false;
  updateVoiceHud();
  document.getElementById('voiceBtn').classList.remove('recording');
  document.getElementById('voiceBtnText').textContent = 'Tap to speak';
  document.getElementById('waveform').classList.remove('show');
  driveWave(false);
  if (currentTranscript.trim()) document.getElementById('extractBtn').disabled = false;
  recognitionEnded.then(() => {
    if (!isRecording && currentTranscript.trim()) document.getElementById('extractBtn').disabled = false;
  });

  // EXPERIMENTAL, opt-in — everything above this point has already
  // completed exactly as it always has, regardless of what happens below.
  // This resolves in the background and, on a clean result, offers it as a
  // suggestion (see tryServerSideTranscription). Any failure is silent.
  // The snapshot that showServerTranscriptionSuggestion() compares against
  // is taken only after the last phrase has landed - taken earlier, that
  // late phrase made the transcript "changed" and the suggestion was
  // silently dropped.
  if (audioCaptureEnabled && !audioCaptureFailedThisSession) {
    const before = recordingStartText;
    Promise.all([stopAudioCapture(), recognitionEnded]).then(([blob]) => {
      if (isRecording) return;
      serverTranscriptOriginalText = currentTranscript;
      tryServerSideTranscription(blob, before);
    });
  } else {
    stopAudioCaptureTracks();
  }
}

// ── MANUAL TRANSCRIPT EDITING ────────────────────────────────────────────
// The transcript box is editable directly (not just filled by voice), so
// extraction can be tested or used without a working microphone, and so a
// technician can quickly fix a mis-heard word or type in a noisy/quiet
// environment instead of speaking.
function clearTranscriptPlaceholderIfNeeded(el) {
  if (!el.classList.contains('active')) el.textContent = '';
}

// Paste as plain text: a copy from a web page or document would otherwise
// bring its font and highlight into the box.
function onTranscriptPaste(e) {
  const text = (e.clipboardData || window.clipboardData).getData('text/plain');
  if (!text) return;
  e.preventDefault();
  document.execCommand('insertText', false, text);
}

function onTranscriptEdited(el) {
  currentTranscript = el.textContent;
  const hasText = currentTranscript.trim().length > 0;
  el.classList.toggle('active', hasText);
  const extractBtn = document.getElementById('extractBtn');
  if (extractBtn) extractBtn.disabled = !hasText;
  saveDraft();
}

// ── QUICK PHRASES ────────────────────────────────────────────────────────
// A short, curated set of sentences to tap in when speaking isn't practical.
// They are worded the way an inspector would say them, so Extract reads them
// like dictation and nothing else in the chain changes. Keep them free of
// severity words, species risk and structural verdicts.
const QUICK_PHRASES = [
  { group: 'Roof void', phrases: [
    'Roof void inspected, no termite activity or damage seen in the roof void.',
    'Roof void inspection limited by insulation.',
    'Roof void inspection limited by low clearance at the eaves.',
    'Sarking prevented a full inspection of the roof timbers.',
    'No roof void access hatch found.',
  ]},
  { group: 'Subfloor', phrases: [
    'Subfloor inspected, no live termites, workings or damage seen.',
    'Subfloor inspection limited by low clearance in parts.',
    'Ant caps missing or damaged on some piers.',
    'Subfloor ventilation is poor.',
  ]},
  { group: 'Outside', phrases: [
    'Garden beds built up against the walls above the slab edge.',
    'Slab edge covered and unable to be inspected.',
    'Weep holes covered by soil or paving.',
    'Timber in contact with the ground.',
  ]},
  { group: 'Inside', phrases: [
    'Interior inspected, no termite activity or damage seen.',
    'Furniture and floor coverings limited the interior inspection.',
    'Moisture meter readings normal throughout.',
  ]},
];

function renderQuickPhrases() {
  const list = document.getElementById('quickPhrasesList');
  if (!list || list.childElementCount) return;
  list.innerHTML = QUICK_PHRASES.map(g => `
    <div class="quick-phrases-group">${g.group}</div>
    <div class="quick-phrases-row">${g.phrases.map(p =>
      `<button type="button" class="quick-phrase" onclick="addQuickPhrase(this)">${p}</button>`).join('')}</div>`).join('');
}

function addQuickPhrase(btn) {
  const box = document.getElementById('transcriptBox');
  if (!box) return;
  const text = btn.textContent.trim();
  const before = box.classList.contains('active') ? (currentTranscript || '').trim() : '';
  box.textContent = before ? before + ' ' + text : text;
  onTranscriptEdited(box);
  btn.classList.add('added');
  setTimeout(() => btn.classList.remove('added'), 900);
}

document.addEventListener('DOMContentLoaded', renderQuickPhrases);

function usePrompt(el) {
  // Make sure the popover is in default (extraction) mode, not notes-dictation mode
  if (activeNotesTargetKey) resetVoicePopoverToDefault();

  const popover = document.getElementById('voicePopover');
  const fab = document.getElementById('micFab');
  if (!popover.classList.contains('open')) {
    popover.classList.add('open');
    showTestModeBadge();
    fab.classList.add('open');
  }

  currentTranscript = el.dataset.prompt;
  const box = document.getElementById('transcriptBox');
  box.textContent = currentTranscript;
  box.classList.add('active');
  document.getElementById('extractBtn').disabled = false;
}

// ══════════════════════════════════════════════════════════════════════════
// VOICE STOP WORDS
// ══════════════════════════════════════════════════════════════════════════
// One voice button. Recording carries on until a tap on Stop or "stop
// Sayon". The report is filled once, from the whole note: "stop Sayon"
// fills it straight away, and after a tap the note waits in the box for
// Extract, so it can be checked first. Filling at every pause was taken out
// on 28 Oct: on an iPhone it mangled the words that followed each fill.
// Phones punctuate and mishear the name ("Stop. Simon.", "stop saying"),
// so the words can be split by punctuation and "Sayon" has its common
// mishearings. It's checked on the live (interim) text as well as the
// final text, because some phones only finalise a phrase after a pause.
const VOICE_STOP_LIVE_RE = /\b(?:stop|done|pause|finish)[\s,.!?-]+(?:sayon|say on|sayan|saying|sayin|zion|sion|xion|scion|simon|sean|shaun|cyan|saigon|siam)\b|\bstop listening\b/i;
// "Stops on" and "stop son" (how a phone heard it in the 25 Oct pocket
// test) are ordinary words too ("the lead stops on the bearer"), so they
// only count as the last words of a finished phrase, never in live text.
const VOICE_STOP_RE = new RegExp(VOICE_STOP_LIVE_RE.source + '|\\bstops?[\\s,.!?-]+(?:on|son)[\\s,.!?]*$', 'i');
// ── Soft audio tone: a beep the inspector hears with the phone in a pocket ──
function playTone(freq = 880, duration = 120, vol = 0.3) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration/1000);
    osc.start(); osc.stop(ctx.currentTime + duration/1000);
    setTimeout(() => ctx.close(), duration + 100);
  } catch(e) {}
}

// ── VOICE HUD ─────────────────────────────────────────────────────────────
// A border round the whole screen, so the inspector can tell from the
// corner of their eye what the app is doing without reading anything:
//   listening the mic is taking a note: thick, slow pulse
//   thinking  the AI is filling the report: thick, fast pulse
// Read from the existing state (isRecording, the AI busy flag); nothing
// here changes how voice or extraction work.
function updateVoiceHud() {
  let state = '';
  if (isRecording) state = 'listening';
  else if (document.body.classList.contains('ai-busy')) state = 'thinking';
  if (state) document.body.dataset.voice = state;
  else delete document.body.dataset.voice;
  syncDockTalk(state);
}

// Talk in the bottom dock follows the voice state: the time while it
// listens (and Stop to tap). Which word shows (Talk, Close, Filling,
// Stop) is css, read off the same state.
let dockTalkTimer = 0, dockTalkStart = 0;
function syncDockTalk(state) {
  const fab = document.getElementById('micFab');
  const time = document.getElementById('micFabTime');
  if (!fab) return;
  const listening = state === 'listening';
  fab.classList.toggle('recording', listening);
  clearInterval(dockTalkTimer);
  if (listening) {
    if (!dockTalkStart) dockTalkStart = Date.now();
    const tick = () => {
      const sec = Math.floor((Date.now() - dockTalkStart) / 1000);
      if (time) time.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    };
    tick();
    dockTalkTimer = setInterval(tick, 1000);
  } else dockTalkStart = 0;
  fab.setAttribute('aria-label', listening ? 'Stop recording' : fab.classList.contains('open') ? 'Close the voice panel' : 'Talk');
}

let pendingSpeciesMatch = null; // holds the confirmed species match to apply

function triggerSpeciesIntelligence(rawSpeciesValue) {
  const match = lookupSpecies(rawSpeciesValue);
  if (!match) return;

  pendingSpeciesMatch = match;

  // Show confirmation prompt
  const confirm = document.getElementById('speciesConfirm');
  const confirmName = document.getElementById('speciesConfirmName');
  if (confirm && confirmName) {
    confirmName.textContent = match.name;
    confirm.style.display = 'block';
    confirm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function confirmSpecies() {
  if (!pendingSpeciesMatch) return;

  const { name, data } = pendingSpeciesMatch;

  // Hide confirm, show intelligence panel
  document.getElementById('speciesConfirm').style.display = 'none';
  showSpeciesIntel(name, data);

  pendingSpeciesMatch = null;
}

function dismissSpeciesConfirm() {
  document.getElementById('speciesConfirm').style.display = 'none';
  pendingSpeciesMatch = null;
}

function closeSpeciesIntel() {
  document.getElementById('speciesIntel').style.display = 'none';
}

function showSpeciesIntel(name, data) {
  const panel = document.getElementById('speciesIntel');
  const title = document.getElementById('speciesIntelName');
  const body = document.getElementById('speciesIntelBody');
  if (!panel || !body) return;

  title.textContent = name + (data.commonName ? ' — ' + data.commonName : '');
  body.innerHTML = buildSpeciesIntelHTML(data);
  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function buildSpeciesIntelHTML(data) {
  let html = '';

  // On-site field identification — rendered first, most useful in the moment
  if (data.fieldID && data.fieldID.length > 0) {
    html += `<div class="intel-section intel-section-field-id">
      <div class="intel-section-title">🔍 On site: what to look for</div>
      <div class="intel-list">`;
    data.fieldID.forEach(item => {
      html += `<div class="intel-item intel-field-id-item">${item}</div>`;
    });
    html += `</div></div>`;
  }

  // Special flags (warnings, danger notices)
  if (data.specialFlags && data.specialFlags.length > 0) {
    data.specialFlags.forEach(flag => {
      html += `
        <div class="species-flag ${flag.type}">
          <span class="species-flag-icon">${flag.icon}</span>
          <span class="species-flag-text">${flag.text}</span>
        </div>`;
    });
  }

  // Identification markers
  if (data.identification && data.identification.length > 0) {
    html += `<div class="intel-section">
      <div class="intel-section-title">Identification</div>
      <div class="intel-list">`;
    data.identification.forEach(item => {
      html += `<div class="intel-item">${item}</div>`;
    });
    html += `</div></div>`;
  }

  // Nest locations
  if (data.nestTypes && data.nestTypes.length > 0) {
    html += `<div class="intel-section">
      <div class="intel-section-title">Nest locations</div>
      <div class="intel-list">`;
    data.nestTypes.forEach(item => {
      html += `<div class="intel-item">${item}</div>`;
    });
    html += `</div></div>`;
  }

  // Behaviour
  if (data.behaviour && data.behaviour.length > 0) {
    html += `<div class="intel-section">
      <div class="intel-section-title">Behaviour</div>
      <div class="intel-list">`;
    data.behaviour.forEach(item => {
      html += `<div class="intel-item">${item}</div>`;
    });
    html += `</div></div>`;
  }

  // Treatment options
  if (data.treatmentOptions && data.treatmentOptions.length > 0) {
    html += `<div class="intel-section">
      <div class="intel-section-title">Treatment options</div>
      <div class="intel-treatments">`;
    data.treatmentOptions.forEach(opt => {
      html += `<div class="intel-treatment">
        <div class="intel-treatment-header">
          <span class="intel-treatment-product">${opt.product}</span>
          <span class="intel-treatment-type">${opt.type}</span>
        </div>
        <div class="intel-treatment-notes">${opt.notes}</div>
        <div class="intel-treatment-toxicity">Toxicity: ${opt.toxicity}</div>
      </div>`;
    });
    html += `</div></div>`;
  }

  // Field note prompts
  if (data.fieldNotePrompts && data.fieldNotePrompts.length > 0) {
    html += `<div class="intel-section">
      <div class="intel-section-title">Field note prompts</div>
      <div class="intel-prompts">`;
    data.fieldNotePrompts.forEach(prompt => {
      html += `<div class="intel-prompt-item">${prompt}</div>`;
    });
    html += `</div></div>`;
  }

  return html;
}
