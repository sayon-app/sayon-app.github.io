// Hands-free in the car: one tap on the dock mic opens the voice panel
// already listening; "Fill it in, Sayon" fills the report from what's been
// said so far while the mic stays on, and the report turns to the step it
// filled; "Stop Sayon" still stops and fills the rest. The phone's speech
// and Whisper are both stood in for, so no microphone is needed.
// node e2e.js <outDir>  (server on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/hands-free'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', uid = 'u-owner', SP = process.env.JSPDF_DIR || '/tmp/jspdf';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };

// What the canned AI answers for each note, picked by its words.
const ANSWERS = [
  [/brick veneer/i, { structureType: 'Single storey', wallConstruction: 'Brick veneer', roofType: 'Tiled', floorType: 'Concrete slab', constructionEra: '1985-2003' }],
  [/weep holes/i, { weepHoles: 'BRIDGED', timberSoil: 'YES', timberSoilDetails: 'Side fence palings touching soil', siteDrainage: 'POOR' }],
  [/laundry/i, { moistureReadings: 'YES', leakLocation: 'Laundry' }],
  [/roof void/i, { roofType: 'Tiled', toolsUsed: 'Torch, moisture meter' }],
];
const notes = [];
let aiDelay = 0;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await ctx.route(/sentry|posthog|maps\.googleapis|open-meteo/, r => r.fulfill({ status: 200, body: '{}' }));
  await ctx.route(/workers\.dev/, async r => {
    const u = r.request().url(); let body = {}; try { body = r.request().postDataJSON() || {}; } catch (e) {}
    if (/workers\.dev\/?$/.test(u) && body.messages) {
      const said = JSON.stringify(body.messages[body.messages.length - 1]);
      notes.push(said);
      if (aiDelay) await new Promise(res => setTimeout(res, aiDelay));
      const hit = ANSWERS.find(([re]) => re.test(said));
      return r.fulfill({ json: { content: [{ type: 'text', text: JSON.stringify(hit ? hit[1] : {}) }], stop_reason: 'end_turn' } });
    }
    return r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } });
  });
  await ctx.route(/supabase\.co/, r => r.fulfill({ json: r.request().url().includes('businesses?owner_id') ? [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] : [] }));
  await ctx.addInitScript((s) => {
    localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1', '1');
    // The phone's speech, driven by the test: __say(text) hands over a finished phrase.
    class FakeRecognition {
      constructor() { window.__sr = this; this.results = []; }
      start() { window.__srStarts = (window.__srStarts || 0) + 1; }
      stop() { setTimeout(() => this.onend && this.onend(), 10); }
      abort() {}
    }
    window.SpeechRecognition = window.webkitSpeechRecognition = FakeRecognition;
    window.__say = (text) => {
      const sr = window.__sr; const res = [{ transcript: text, confidence: 0.9 }]; res.isFinal = true;
      sr.results.push(res); sr.onresult({ resultIndex: sr.results.length - 1, results: sr.results });
    };
    // The beeps, counted by pitch.
    window.__tones = [];
  }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  await p.evaluate(async (sc) => {
    storeCompanyDetails(sc.company); openApp('inspect'); resetReportState();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    for (const [k, v] of Object.entries(sc.job)) set(k, v); updateJob();
    whisperOff = true; // the phone's speech first; Whisper is fed by hand further down
    const tone = playTone; playTone = (f, d, v) => { window.__tones.push(f); tone(f, d, v); };
    goStep('property');
  }, sc);
  const state = () => p.evaluate(() => ({
    open: document.getElementById('voicePopover').classList.contains('open'), rec: isRecording,
    box: document.getElementById('transcriptBox').textContent, transcript: currentTranscript, step: currentStep,
    toasts: [...document.querySelectorAll('.toast, #toast')].map(t => t.textContent.trim()).filter(Boolean).join(' | '),
    summary: document.getElementById('extractSummaryOverlay').classList.contains('open'), tones: window.__tones.slice(),
  }));
  const settle = async () => { for (let i = 0; i < 40 && await p.evaluate(() => fillRunning); i++) await p.waitForTimeout(100); await p.waitForTimeout(300); };

  // 1. One tap on the dock mic: the panel opens already listening.
  await p.locator('#micFab').tap(); await p.waitForTimeout(500);
  let s = await state();
  check(s.open && s.rec, 'one tap on the mic opens the panel and starts listening: ' + JSON.stringify({ open: s.open, rec: s.rec }));
  check(/fill it in, Sayon/.test(s.box) && /stop Sayon/.test(s.box), 'the empty note box says how to fill hands-free: ' + s.box);
  await p.screenshot({ path: `${OUT}/1-listening.png` });

  // 2. "Fill it in, Sayon": the words before it fill, the mic stays on.
  await p.evaluate(() => __say('Single storey brick veneer house built about 1995, tiled roof on a concrete slab.'));
  await p.evaluate(() => __say('Fill it in, Sayon. Now outside'));
  await settle();
  s = await state();
  console.log('after fill 1:', JSON.stringify(s));
  check(notes.length === 1 && /brick veneer/.test(notes[0]) && !/Fill it in/i.test(notes[0]) && !/Now outside/.test(notes[0]), 'the fill sends the words before "fill it in", without the command or the words after');
  check(s.rec, 'still listening after the fill');
  check(await p.evaluate(() => reportData.wallConstruction === 'Brick veneer' && reportData.roofType === 'Tiled'), 'the report took the fill');
  check(s.transcript.trim() === 'Now outside', 'the words after the command wait for the next fill: ' + JSON.stringify(s.transcript));
  check(/Filled \d+ fields in Property\. Still listening/.test(s.toasts), 'toast names the step and says it is still listening: ' + s.toasts);
  check(s.tones.includes(660) && s.tones.includes(880), 'a beep when the words are heard and another when it has filled: ' + s.tones);
  check(!s.summary, 'no summary sheet over the report while listening');

  // 3. The next fill is about the outside: the report turns to Conducive.
  await p.evaluate(() => __say('the weep holes are bridged by garden beds along the back wall and the side fence palings are touching soil, drainage is poor. Fill that in Simon.'));
  await settle();
  s = await state();
  check(notes.length === 2 && /Now outside/.test(notes[1]) && /weep holes/.test(notes[1]) && !/brick veneer/.test(notes[1]), 'the second fill sends only what was said since the first');
  check(s.step === 'conducive' && s.rec, 'the report turned to the Conducive step while still listening: ' + s.step);
  check(await p.evaluate(() => document.getElementById('tab-conducive').classList.contains('active')), 'the Conducive tab is the active one');
  await p.waitForTimeout(700); await p.screenshot({ path: `${OUT}/2-turned-to-conducive.png` });

  // 4. Whisper's phrases: the command in the middle of a phrase.
  await p.evaluate(() => { whisperQueue.push({ text: 'Moisture meter reading 28 percent behind the laundry tub. Fill it in, Sayon. Next the roof void', done: true, epoch: voiceJobEpoch }); whisperApply(); });
  await settle();
  s = await state();
  check(notes.length === 3 && /laundry/.test(notes[2]) && !/roof void/.test(notes[2]), 'a Whisper phrase fills up to the command: ' + (notes[2] || '').slice(0, 120));
  check(s.transcript.trim() === 'Next the roof void' && s.rec, 'and keeps the rest of the phrase for later, still listening: ' + JSON.stringify(s.transcript));

  // 5. Two fills asked for while the AI is slow: the second runs after the first.
  aiDelay = 1500;
  await p.evaluate(() => __say('The roof void has tiled roof, checked with a torch and moisture meter. Fill it in Sayon.'));
  await p.waitForTimeout(200);
  await p.evaluate(() => __say('Weep holes along the front are clear. Fill it in, Sayon.'));
  await settle(); await settle();
  aiDelay = 0;
  check(notes.length === 5 && /roof void/.test(notes[3]) && /front are clear/.test(notes[4]) && !/roof void/.test(notes[4]), 'a second "fill it in" during a fill runs after it, on the newer words: ' + notes.length);
  check((await state()).rec, 'still listening after both');

  // 6. "Stop Sayon" still stops and fills what's left, with the summary sheet.
  await p.evaluate(() => __say('Mud tubes on the rear bearer in the laundry. Stop Sayon.'));
  await p.waitForTimeout(3000); await settle();
  s = await state();
  check(!s.rec && notes.length === 6 && /rear bearer/.test(notes[5]), '"Stop Sayon" stops and fills the rest');
  check(s.summary, 'the summary sheet shows after the stop');
  await p.screenshot({ path: `${OUT}/3-after-stop.png` });
  await p.evaluate(() => closeExtractSummary());

  // 7. With the panel open and quiet, the mic button closes it (no listening).
  await p.evaluate(() => { if (!document.getElementById('voicePopover').classList.contains('open')) toggleVoicePopover(); });
  await p.locator('#micFab').tap(); await p.waitForTimeout(400);
  s = await state();
  check(!s.open && !s.rec, 'with the panel open and quiet, the mic button closes it');

  // 8. "Fill in the gaps" and "I filled in the form" are ordinary words.
  check(await p.evaluate(() => splitAtFillWords('fill in the gaps under the door') === null && splitAtFillWords('I filled in the form') === null), 'ordinary "fill in" talk is not a command');
  check(await p.evaluate(() => JSON.stringify(splitAtFillWords('Fill that in, Sayon. Fill that in, Sayon. The subfloor')) === JSON.stringify(['', 'The subfloor'])), 'a repeated command is dropped');

  check(!errs.length, 'no page errors: ' + errs.join(' | '));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
  process.exit(fails.length ? 1 : 0);
})();
