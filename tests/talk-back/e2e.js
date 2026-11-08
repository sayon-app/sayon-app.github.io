// Talk it through: the after-note questions asked aloud and answered out
// loud (js/app/talk-back.js). The phone's speech and listening are faked:
// every question said is recorded, and each listen hears the next scripted
// answer. node e2e.js <outDir>  (server on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/talk-back'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };

// Fake speech: speak() ends after a moment; a listen hears window.__answers.shift().
const FAKE_SPEECH = () => {
  window.__said = []; window.__answers = []; window.__listens = 0;
  const synth = {
    speaking: false, pending: false,
    getVoices: () => [{ lang: 'en-AU', name: 'Karen' }],
    cancel() { if (this._u) { const u = this._u; this._u = null; clearTimeout(this._t); u.onend && u.onend(); } },
    speak(u) { this._u = u; if (u.text.trim()) window.__said.push(u.text); this._t = setTimeout(() => { if (this._u === u) { this._u = null; u.onend && u.onend(); } }, 30); },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  class FakeRec {
    start() {
      window.__listens++;
      const a = window.__answers.shift();
      setTimeout(() => {
        if (a == null) { this.onerror && this.onerror({ error: 'no-speech' }); this.onend && this.onend(); return; }
        const alt = [{ transcript: a }]; alt.isFinal = true;
        const results = [alt]; results.length = 1;
        this.onresult && this.onresult({ resultIndex: 0, results });
        this.onend && this.onend();
      }, 20);
    }
    stop() {} abort() {}
  }
  window.SpeechRecognition = FakeRec; window.webkitSpeechRecognition = FakeRec;
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/sentry|posthog|maps\.googleapis|cdnjs/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } }));
  await ctx.route(/supabase\.co/, r => r.fulfill({ json: r.request().url().includes('businesses?owner_id') ? [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] : [] }));
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1', '1'); }, sess);
  await ctx.addInitScript(FAKE_SPEECH);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);

  // A report the way a note leaves it: two findings with no referral answer,
  // no height, system, notice, moisture or slab edge, and areas unmarked.
  const fields = Object.assign({}, sc.fields);
  ['moistureReadings', 'moistureMeterReadings', 'durableNoticePresent', 'height', 'existingSystem', 'slabEdge', 'riskLevel'].forEach(k => delete fields[k]);
  const load = async () => {
    await p.evaluate(async ({ sc, fields }) => {
      storeCompanyDetails(sc.company); openApp('inspect'); resetReportState();
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      for (const [k, v] of Object.entries(sc.job)) set(k, v); updateJob();
      window.__before = extractSnapshot();
      await populateFields(fields);
    }, { sc, fields });
    await p.waitForTimeout(2000);
    await p.evaluate(() => { reportData.areaStatus = {}; reportData.areaResult = {}; syncObstructionData(); });
  };
  const run = async (answers, waitFor = 'done') => {
    await p.evaluate(a => { window.__said = []; window.__answers = a.slice(); window.__listens = 0; }, answers);
    await p.evaluate(() => { stopTalkBack(true); showExtractSummary(window.__before); startTalkBack(); });
    await p.waitForFunction(w => w === 'done' ? (!talkBack || talkBack.done) && !(talkBack && talkBack.utter) : true, waitFor, { timeout: 20000 });
    await p.waitForTimeout(200);
    return p.evaluate(() => window.__said.slice());
  };

  // 1. The parser on its own.
  await load();
  const parse = await p.evaluate(() => {
    const qs = talkBackQuestions();
    const q = key => qs.find(x => x.key.startsWith(key));
    const v = (key, text) => { const r = talkBackHear(q(key), [text]); return r ? (r.cmd || r.opt.value) : null; };
    return {
      keys: qs.map(x => x.key),
      refNo: v('referral', 'no'), refNah: v('referral', 'nah not needed'), refYes: v('referral', 'yes refer it'), refRestate: v('referral', 'no wait yes'),
      refNotSure: v('referral', "I'm not sure"), refSkip: v('referral', 'skip that'), refStop: v('referral', "stop that's it"), refUndo: v('referral', 'undo'),
      refAmb: v('referral', 'yes no'), refRepeat: v('referral', 'repeat'),
      risk: v('f:riskLevel', 'medium'), riskAmb: v('f:riskLevel', 'low to medium'), riskRestate: v('f:riskLevel', 'low actually high'),
      height: v('f:height', 'two storey'), heightOne: v('f:height', 'single storey'), heightSplit: v('f:height', 'split level'),
      sys: v('f:existingSystem', 'none'), sysBait: v('f:existingSystem', 'baiting system, Exterra'), sysRetic: v('f:existingSystem', 'chemical reticulation'),
      sysUnknown: v('f:existingSystem', "not sure what type but there's one"), sysChem: v('f:existingSystem', 'chemical barrier'),
      moistNo: v('f:moistureReadings', 'no high readings'), moistDry: v('f:moistureReadings', 'all dry'), moistYes: v('f:moistureReadings', 'yes elevated in the laundry'),
      slabNone: v('f:slabEdge', 'no slab'), slabObs: v('f:slabEdge', 'garden bed covering it'), slabNotVis: v('f:slabEdge', 'not visible'), slabClear: v('f:slabEdge', 'clear'),
      notice: v('f:durableNoticePresent', 'yeah there is'), noticeNo: v('f:durableNoticePresent', "couldn't find one"),
    };
  });
  console.log('questions:', parse.keys.join(', '));
  check(parse.keys[0].startsWith('referral:') && parse.keys[1].startsWith('referral:'), 'referrals are asked first, one per finding');
  check(parse.keys.includes('status:all') && parse.keys.includes('f:height') && parse.keys.includes('f:existingSystem') && parse.keys.includes('f:moistureReadings') && parse.keys.includes('f:durableNoticePresent'), 'areas, height, system, moisture and notice are asked');
  check(parse.keys[parse.keys.length - 1] === 'f:riskLevel', 'risk is asked last');
  check(parse.refNo === 'NO' && parse.refNah === 'NO' && parse.refYes === 'YES' && parse.refRestate === 'YES', 'yes and no, and a restatement wins');
  check(parse.refNotSure === 'skip' && parse.refSkip === 'skip' && parse.refStop === 'stop' && parse.refUndo === 'undo' && parse.refRepeat === 'repeat', '"not sure" is a skip, never a no; skip, stop, undo, repeat');
  check(parse.refAmb === null && parse.riskAmb === null, `two answers at once count as none (${parse.refAmb}, ${parse.riskAmb})`);
  check(parse.risk === 'MEDIUM' && parse.riskRestate === 'HIGH', 'risk heard, and "low actually high" is high');
  check(parse.height === 'Double storey' && parse.heightOne === 'Single storey' && parse.heightSplit === 'Split level', 'height choices');
  check(parse.sys === 'No System Found' && parse.sysBait === 'Termite Baiting System' && parse.sysRetic === 'Chemical Reticulation System' && parse.sysUnknown === 'System Present — Type Unidentified' && parse.sysChem === 'Chemical Barrier', 'system choices, and "not sure what type but there\'s one" still answers');
  check(parse.moistNo === 'NO' && parse.moistDry === 'NO' && parse.moistYes === 'YES', '"no high readings" is a no');
  check(parse.slabNone === 'NOSLAB' && parse.slabObs === 'OBSTRUCTED' && parse.slabNotVis === 'OBSTRUCTED' && parse.slabClear === 'CLEAR', 'slab edge: "not visible" is obstructed');
  check(parse.notice === 'YES' && parse.noticeNo === 'NO', 'durable notice yes and no');

  // 2. A whole run, answered out loud.
  await load();
  const said = await run(['no', 'yes refer it', 'all inspected', 'yes', 'double storey', 'none', 'yeah there is', 'all dry', 'clear', 'high']);
  console.log('said:\n  ' + said.join('\n  '));
  const state = await p.evaluate(() => ({
    refs: reportData.findings.map(f => f.structuralConcern), height: reportData.height, sys: reportData.existingSystem, notice: reportData.durableNoticePresent,
    moist: reportData.moistureReadings, slab: reportData.slabEdge, risk: reportData.riskLevel,
    unmarked: Object.keys(OBS_ZONES).filter(z => !areaStatusOf(z)).length, noResult: areasMissingResult().length,
    blanks: extractBlanks().map(b => b.label), card: document.getElementById('talkBack').innerText, cardHidden: document.getElementById('talkBack').hidden,
  }));
  check(/^Filled \d+ fields from your note\. \d+ questions\./.test(said[0]), 'starts with what was filled and how many questions');
  check(/^Finding 1, gum tree in the backyard/.test(said[1]) && /Refer it to a builder or engineer\? Yes or no\./.test(said[1]), 'asks the referral with where the finding is');
  check(said.includes('Finding 1: no referral.') && said.includes('Finding 2: refer to a builder or engineer.'), 'says back each answer');
  check(state.refs[0] === 'NO' && state.refs[1] === 'YES', 'referrals saved on the findings');
  check(state.unmarked === 0 && state.noResult === 0, 'areas marked inspected, then nothing found (asked after)');
  check(said.some(s => /nothing is recorded as found there yet/.test(s)), 'the result question follows the status answer');
  check(state.height === 'Double storey' && state.sys === 'No System Found' && state.notice === 'YES' && state.moist === 'NO' && state.slab === 'CLEAR' && state.risk === 'HIGH', 'every field answer saved');
  check(state.blanks.length === 0, 'the sheet has no key fields blank afterwards');
  check(said.some(s => /^That's all\. 10 answered\./.test(s)), 'finishes with what was answered');
  check(said.some(s => /On the screen: .*agreement/.test(s)), 'names what can only be done on the screen');
  check(said.some(s => /Want me to ask these after every note\?/.test(s)), 'first run by hand offers to ask after every note');
  await p.screenshot({ path: `${OUT}/1-finished.png` });

  // 3. Skip, a mishearing asked again, undo, and stop part way.
  await load();
  const said2 = await run(['skip', 'banana', 'yes', 'undo', 'no', 'stop']);
  console.log('said (skip/undo/stop):\n  ' + said2.join('\n  '));
  const st2 = await p.evaluate(() => ({ refs: reportData.findings.map(f => f.structuralConcern), height: reportData.height }));
  check(said2.includes('Skipped.'), 'skip passes the question');
  check(said2.some(s => /Sorry, I didn't catch that\. Say yes or no\./.test(s)), 'a word it can\'t place is asked again');
  check(said2.includes('Undone.') && st2.refs[0] == null && st2.refs[1] === 'NO', 'undo takes the last answer back and asks it again');
  check(said2.some(s => /^Stopped\./.test(s) && /Left for you: builder referral on finding 1/.test(s)), 'stop names what was left');
  check(!said2.some(s => /Want me to ask these after every note/.test(s)), 'the offer is only made once');

  // 4. Tapping the answers works the same.
  await load();
  await p.evaluate(() => { stopTalkBack(true); window.__answers = []; window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; showExtractSummary(window.__before); startTalkBack(); });
  await p.waitForFunction(() => talkBack && talkBack.current && document.querySelectorAll('.talkback-opt').length === 2, null, { timeout: 5000 });
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/2-question-tap.png` });
  const shot = await p.evaluate(() => ({ state: document.getElementById('talkBackState').innerText, q: document.getElementById('talkBackQ').innerText, opts: [...document.querySelectorAll('.talkback-opt')].map(b => b.innerText) }));
  check(/tap your answer/i.test(shot.state) && /Refer it to a builder/.test(shot.q) && shot.opts.join('|') === 'Yes, refer|No referral', 'with no listening, the card asks for a tap');
  await p.locator('.talkback-opt', { hasText: 'No referral' }).click();
  await p.waitForFunction(() => talkBack && talkBack.current && /Finding 2/.test(talkBack.current.ask), null, { timeout: 5000 });
  check(await p.evaluate(() => reportData.findings[0].structuralConcern === 'NO'), 'a tapped answer is saved and the next question asked');
  await p.getByRole('button', { name: 'Stop', exact: true }).click();
  await p.waitForFunction(() => talkBack && talkBack.done, null, { timeout: 5000 });
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/3-stopped.png` });
  await p.evaluate(() => closeExtractSummary());
  check(await p.evaluate(() => talkBack === null && document.getElementById('talkBack').hidden), 'closing the sheet ends it');

  // 5. Ask me after each note: starts on its own after a filled note.
  await load();
  await p.evaluate(() => { setTalkBackAuto(true); window.__said = []; window.__answers = ['stop']; showExtractSummary(window.__before, { talk: true }); });
  await p.waitForFunction(() => window.__said.length >= 2, null, { timeout: 5000 });
  check(true, 'the setting starts it on its own when a note is filled');
  await p.evaluate(() => { stopTalkBack(true); showExtractSummary(window.__before); });
  await p.waitForTimeout(800);
  check(await p.evaluate(() => talkBack === null), 'reopening the sheet from a fix doesn\'t start it again');
  await p.evaluate(() => { closeExtractSummary(); openMenuPage && document.getElementById('toggleTalkBack'); });
  check(await p.evaluate(() => document.getElementById('toggleTalkBack').classList.contains('on')), 'Settings › Voice switch shows it on');

  check(errs.length === 0, `no page errors ${errs.join(' | ')}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
