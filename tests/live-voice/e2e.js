// Listening on the move: with the mic on, the voice panel is one bar on the
// dock and the report behind it can still be scrolled and tapped. Moving to
// another step fills the report from what's been said so far, Fill in on the
// bar does it any time, and a fill doesn't pull the report away from a tech
// who's just touched it (the toast has Show). A tap on the bar opens the
// whole note; a tap outside, the X or back shrinks it again without
// stopping. "Lock for your pocket" brings back the old shield, and pressing
// and holding its label lets go. The phone's speech and the AI are stood in for.
// node e2e.js <outDir>  (server on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/live-voice'; fs.mkdirSync(OUT, { recursive: true });
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
  [/deposit/i, { paymentTerms: '50% deposit, balance on completion', items: [], remove: [] }],
  [/half a day/i, { timeframe: 'Half a day', items: [], remove: [] }],
];
const heard = []; // what Whisper hears in each phrase, in order
const notes = [];
let aiDelay = 0;

(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await ctx.route(/sentry|posthog|maps\.googleapis|open-meteo/, r => r.fulfill({ status: 200, body: '{}' }));
  await ctx.route(/workers\.dev/, async r => {
    const u = r.request().url(); let body = {}; try { body = r.request().postDataJSON() || {}; } catch (e) {}
    if (u.includes('/transcribe')) return r.fulfill({ json: { transcript: heard.shift() || '' } });
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
    // The microphone: a tone that __talk(ms) turns up for a while, as if someone spoke.
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext(); try { await ac.resume(); } catch (e) {}
      const osc = ac.createOscillator(); osc.frequency.value = 220;
      const g = ac.createGain(); g.gain.value = 0;
      const dest = ac.createMediaStreamDestination();
      osc.connect(g); g.connect(dest); osc.start();
      window.__gain = g; window.__micStream = dest.stream;
      return dest.stream;
    };
    window.__talk = async (ms) => { window.__gain.gain.value = 0.5; await new Promise(r => setTimeout(r, ms)); window.__gain.gain.value = 0; };
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
  const state = () => p.evaluate(() => {
    const pop = document.getElementById('voicePopover').getBoundingClientRect();
    return {
      rec: isRecording, step: currentStep, bar: document.body.classList.contains('listening-bar'),
      expanded: document.body.classList.contains('voice-expanded'), shield: !document.getElementById('pocketShield').hidden,
      popH: Math.round(pop.height), live: document.getElementById('voiceLiveText').textContent, transcript: currentTranscript,
      toast: (document.getElementById('toast') || {}).innerText || '', show: !!document.querySelector('#toast.show .toast-action'),
      place: navPlace(),
    };
  });
  const settle = async () => { await p.waitForTimeout(150); for (let i = 0; i < 40 && await p.evaluate(() => fillRunning); i++) await p.waitForTimeout(100); await p.waitForTimeout(400); };

  // 1. One tap on the mic: listening, as a bar, with nothing over the page.
  await p.locator('#micFab').tap(); await p.waitForTimeout(500);
  let s = await state();
  check(s.rec && s.bar && !s.shield, 'the mic listens as a bar, with no lock over the page: ' + JSON.stringify({ rec: s.rec, bar: s.bar, shield: s.shield }));
  check(s.popH < 100, `the bar is short (${s.popH}px)`);
  check(/fill it in, Sayon/.test(s.live), 'with nothing said, the bar says how to fill: ' + s.live);
  check(await p.evaluate(() => document.getElementById('voiceLiveFill').disabled), 'Fill in waits for something to fill');
  await p.evaluate(() => __say('Single storey brick veneer house built about 1995, tiled roof on a concrete slab.'));
  await p.waitForTimeout(200);
  s = await state();
  check(/concrete slab/.test(s.live), 'the bar shows the newest words: ' + s.live);
  check(await p.evaluate(() => !document.getElementById('voiceLiveFill').disabled), 'Fill in is ready once something is said');
  await p.screenshot({ path: `${OUT}/1-listening-bar.png` });

  // 2. The report scrolls under it and its fields take a tap.
  await p.mouse.move(195, 400); await p.mouse.wheel(0, 600); await p.waitForTimeout(500);
  check(await p.evaluate(() => document.getElementById('reportBody').scrollTop > 100), 'the report scrolls while the mic listens');
  const tapTarget = await p.evaluate(() => {
    const el = [...document.querySelectorAll('#section-property .field-val')].find(e => { const r = e.getBoundingClientRect(); return r.top > 300 && r.bottom < 600; });
    if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 };
  });
  const hit = tapTarget && await p.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest('#reportBody')); }, tapTarget);
  check(!!hit, 'a field on the report is under the finger, not a cover');

  // 3. Moving to another step fills what's been said, and leaves the tech where they went.
  const n0 = notes.length;
  await p.locator('#tab-conducive').tap(); await settle();
  s = await state();
  check(notes.length === n0 + 1 && /brick veneer/.test(notes[n0]), 'moving to the next step fills the report from the note so far');
  check(s.rec && s.step === 'conducive', 'still listening, and the report stays on the step the tech went to: ' + s.step);
  check(await p.evaluate(() => reportData.wallConstruction === 'Brick veneer'), 'the report took the fill');
  check(/Filled \d+ fields in Property\. Still listening/.test(s.toast) && s.show, 'the toast says where it filled, with Show: ' + s.toast.replace(/\s+/g, ' '));
  check(!s.transcript.trim(), 'the filled words leave the note');
  await p.screenshot({ path: `${OUT}/2-moved-and-filled.png` });

  // 4. A few words aren't worth a fill on their own.
  await p.evaluate(() => __say('Now the outside'));
  await p.locator('#tab-areas').tap(); await settle();
  check(notes.length === n0 + 1 && (await state()).transcript.trim() === 'Now the outside', 'a step change with only a few words said doesn\'t fill');

  // 5. Fill in on the bar, still listening.
  await p.locator('#tab-conducive').tap(); await settle();
  await p.evaluate(() => __say('the weep holes are bridged by garden beds along the back wall and the side fence palings are touching soil, drainage is poor.'));
  await p.waitForTimeout(9000); // hands off the page for a while
  await p.locator('#voiceLiveFill').tap(); await settle();
  s = await state();
  check(notes.length === n0 + 2 && /weep holes/.test(notes[n0 + 1]) && /Now the outside/.test(notes[n0 + 1]), 'Fill in fills from what\'s waiting');
  check(s.rec && s.bar, 'and the mic carries on');
  check(await p.evaluate(() => reportData.weepHoles === 'BRIDGED'), 'the report took it');

  // 6. Show on the toast goes to what was filled.
  await p.evaluate(() => { goStep('property'); __say('Moisture meter reading 28 percent behind the laundry tub in the back room.'); });
  await p.locator('#tab-findings').tap(); await settle();
  s = await state();
  check(s.step === 'findings' && s.show, 'touched just now, a fill leaves the report where it is: ' + s.step);
  await p.locator('#toast .toast-action').tap(); await p.waitForTimeout(500);
  check((await state()).step === 'conducive', 'Show turns to the step it filled');

  // 7. A tap on the bar opens the whole note; a tap outside shrinks it again.
  await p.evaluate(() => __say('Roof void next, access through the hallway manhole'));
  await p.locator('.voice-live-note').tap(); await p.waitForTimeout(400);
  s = await state();
  check(s.expanded && !s.bar && s.rec, 'a tap on the bar opens the note, still listening');
  check(await p.evaluate(() => getComputedStyle(document.getElementById('voiceListenActions')).display === 'flex'), 'the open note has Fill in so far and Lock for your pocket');
  await p.screenshot({ path: `${OUT}/3-note-open.png` });
  await p.locator('#tab-areas').tap(); await p.waitForTimeout(400);
  s = await state();
  check(s.bar && s.rec && s.step === 'areas', 'a tap on the page shrinks it back, and the tap still works: ' + s.step);
  await settle();

  // 8. The X and back shrink it; back then moves through the app with the mic on.
  await p.locator('.voice-live-note').tap(); await p.waitForTimeout(300);
  await p.locator('#voicePopoverClose').tap(); await p.waitForTimeout(300);
  s = await state();
  check(s.bar && s.rec, 'the X makes the note small and doesn\'t stop the mic');
  await p.evaluate(() => expandVoiceNote());
  await p.evaluate(() => navBack()); await p.waitForTimeout(300);
  s = await state();
  check(s.bar && s.rec && s.place === 'report', 'back makes the open note small first');
  await p.evaluate(() => navBack()); await p.waitForTimeout(600);
  s = await state();
  check(s.rec && s.place === 'job', 'then back goes to This job, still listening: ' + s.place);
  check(await p.evaluate(() => { const r = document.getElementById('voicePopover').getBoundingClientRect(); const e = document.elementFromPoint(r.left + 40, r.top + r.height / 2); return !!(e && e.closest('#voicePopover')); }), 'the bar is in sight over This job');
  await p.screenshot({ path: `${OUT}/4-this-job-listening.png` });
  await p.evaluate(() => tabGo('report')); await p.waitForTimeout(500);

  // 9. Locked for a pocket: the shield is back, and press and hold lets go.
  await p.evaluate(() => { expandVoiceNote(); lockForPocket(); }); await p.waitForTimeout(300);
  s = await state();
  check(s.shield && s.rec && !s.bar, 'Lock for your pocket puts the shield over the page');
  check(await p.evaluate(() => { const e = document.elementFromPoint(195, 400); return !!(e && e.closest('#pocketShield')); }), 'locked, a touch on the page lands on the shield');
  await p.screenshot({ path: `${OUT}/5-pocket-locked.png` });
  const hold = await p.locator('#pocketShieldHold').boundingBox();
  await p.mouse.move(hold.x + 20, hold.y + 10); await p.mouse.down(); await p.waitForTimeout(200); await p.mouse.up(); await p.waitForTimeout(200);
  check((await state()).shield, 'a quick tap doesn\'t unlock it');
  await p.mouse.down(); await p.waitForTimeout(1000); await p.mouse.up(); await p.waitForTimeout(300);
  s = await state();
  check(!s.shield && s.rec && s.bar, 'press and hold unlocks it, still listening, back to the bar');

  // 10. Stop on the dock stops, as before.
  await p.locator('#micFab').tap(); await p.waitForTimeout(800);
  s = await state();
  check(!s.rec && !s.bar && !s.expanded, 'Stop stops listening and the bar goes');
  check(await p.evaluate(() => document.getElementById('transcriptBox').getAttribute('contenteditable') === 'true'), 'the note can be typed in again');

  check(!errs.length, 'no page errors: ' + errs.join(' | '));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
  process.exit(fails.length ? 1 : 0);
})();
