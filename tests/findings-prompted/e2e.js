// Findings shows only what the job calls for. Termites, Borers and Timber
// decay stay out of sight until something prompts them: an
// answer recorded there, an area marked "evidence found" answered as that
// pest, or "Found something?". Areas that all say nothing found answer the
// timber pests none, and an area that changes takes those answers back. The
// report prints none found only once that's said. Also checks the finding
// number on the icon tile: none on a lone or unanswered card.
// node e2e.js <outDir>  (serve the repo on :8765; jsPDF from tests/visual/setup.sh)
const { chromium } = require('playwright'); const fs = require('fs'); const { execFileSync } = require('child_process');
const OUT = process.argv[2] || '/tmp/findings-prompted'; fs.mkdirSync(OUT, { recursive: true });
const uid = 'u-owner', SP = process.env.JSPDF_DIR || '/tmp/jspdf';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
let fails = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails++; };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } }));
  await ctx.route(/supabase\.co/, r => r.request().url().includes('businesses?owner_id') ? r.fulfill({ json: [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] }) : r.fulfill({ json: [] }));
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1', '1'); }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/'); await p.waitForTimeout(2500);
  await p.evaluate((sc) => {
    storeCompanyDetails(sc.company); openApp('inspect'); resetReportState();
    for (const [k, v] of Object.entries(sc.job)) { const el = document.getElementById(k); if (el) el.value = v; }
    updateJob(); goStep('findings');
  }, sc);
  await p.waitForTimeout(400);
  const state = () => p.evaluate(() => ({
    shown: FINDINGS_GROUPS.filter(g => !document.getElementById(g.el).hidden).map(g => g.id),
    prev: !document.getElementById('fg-previous').hidden && document.getElementById('fg-previous').offsetHeight > 0,
    more: document.getElementById('findingsMore').hidden ? '' : document.getElementById('findingsMore').innerText.replace(/\s+/g, ' ').trim(),
    adds: [...document.querySelectorAll('#findingsMore .findings-more-btn')].map(x => x.textContent.trim()),
    prompts: document.getElementById('findingsFromAreas').hidden ? [] : [...document.querySelectorAll('#findingsFromAreas .area-finding-prompt')].map(e => e.textContent.replace(/\s+/g, ' ').trim()),
    // The quick fill, wherever it is: in the "Not answered yet" box, or at the top once that box isn't asking.
    quick: [...document.querySelectorAll('#nothingFound-findings, #findingsMore .findings-more-none')].filter(x => x.getBoundingClientRect().height > 0).map(x => x.querySelector('strong').textContent).join(' + '),
    quickAt: [...document.querySelectorAll('#nothingFound-findings, #findingsMore .findings-more-none')].filter(x => x.getBoundingClientRect().height > 0).map(x => x.id ? 'top' : 'box').join(' + '),
    badges: [...document.querySelectorAll('#findingsList .finding-card-header')].map(h => (h.querySelector('.finding-tile-num') || {}).textContent || ''),
    badgeBgs: [...document.querySelectorAll('#findingsList .finding-tile-num')].map(n => getComputedStyle(n).backgroundColor),
    pill: (() => { const c = document.querySelector('#fg-termites .fgroup-count'); return c && !c.hidden ? c.textContent : ''; })(),
    sts: document.getElementById('sts-findings').textContent,
    rd: { termites: (reportData.findings || []).map(f => f.termiteActivity || ''), borer: reportData.borerActivity || '', decay: reportData.decayFound || '', delig: reportData.delignification || '', auto: reportData.noneFromAreas || [] },
  }));
  const shoot = async name => {
    await p.evaluate(() => { const t = document.getElementById('toast'); if (t) t.className = 'toast'; });
    await p.waitForTimeout(250);
    const card = p.locator('#section-findings');
    const h = await card.evaluate(c => c.scrollHeight);
    await p.setViewportSize({ width: 390, height: Math.min(6000, h + 400) }); await p.waitForTimeout(250);
    await card.screenshot({ path: `${OUT}/${name}.png` });
    await p.setViewportSize({ width: 390, height: 844 });
  };

  // 1. A fresh report: nothing out but the quick fill and "Found something?".
  let s = await state();
  check(s.shown.length === 0, 'a fresh report shows no Findings groups: ' + JSON.stringify(s.shown));
  check(/Not answered yet: termites, borers, rot and delignification/.test(s.more) && s.adds.join(',') === 'Termites,Borers,Timber decay' && s.prev, 'the box says what is not answered and offers all three; Previous treatment still shows: ' + s.more + ' | ' + s.adds);
  check(s.quick === 'No timber pests found' && s.quickAt === 'box' && !/at the top/.test(s.more), 'the quick fill reads "No timber pests found" and is in the box that asks, not above it: ' + JSON.stringify([s.quick, s.quickAt]));
  await shoot('1-fresh');

  // 2. "No timber pests found": all answered none, still out of sight.
  await p.locator('#findingsMore .findings-more-none').click(); await p.waitForTimeout(500);
  s = await state();
  check(s.shown.length === 0 && /No termites, borers, rot or delignification found/.test(s.more) && s.rd.borer === 'NONE' && s.rd.decay === 'NO' && s.rd.delig === 'NO' && s.rd.termites.join() === 'NONE', 'the quick fill answers all none and they stay out of sight: ' + JSON.stringify(s));
  check(s.sts === 'Complete', 'Findings reads Complete: ' + s.sts);
  await shoot('2-quick-filled');
  // Undo puts the blanks back.
  await p.evaluate(() => document.querySelector('#toast button')?.click()); await p.waitForTimeout(400);
  s = await state();
  check(s.rd.borer === '' && s.rd.termites.join() === '' && /Not answered yet/.test(s.more), 'Undo puts the blanks back: ' + JSON.stringify(s.rd));

  // 3. "Found something?" brings a group in, open.
  await p.locator('#findingsMore .findings-more-btn', { hasText: 'Termites' }).click(); await p.waitForTimeout(400);
  s = await state();
  check(s.shown.includes('termites') && await p.evaluate(() => document.getElementById('fg-termites').open), 'Termites comes in open: ' + JSON.stringify(s.shown));
  check(!s.adds.includes('Termites') && /Found something else\?/.test(s.more) && /Not answered yet: borers, rot and delignification/.test(s.more), 'the box drops it and asks for anything else: ' + s.more);
  // The lone card, not answered: no number on its tile and no "1 finding".
  check(s.badges.join() === '' && s.pill === '', 'a lone card not answered has no number and no count: ' + JSON.stringify([s.badges, s.pill]));
  await shoot('3-termites-added');
  await p.locator('#findingsList .finding-card').first().locator('.findings-gate .choice-card', { hasText: 'ACTIVE' }).first().click(); await p.waitForTimeout(300);
  s = await state();
  check(s.badges.join() === '' && s.pill === '1 finding', 'a lone active card still has no number, and the count reads 1 finding: ' + JSON.stringify([s.badges, s.pill]));
  await p.locator('#addFindingBtn').click(); await p.waitForTimeout(300);
  s = await state();
  check(s.badges.join() === '1,' && s.pill === '1 finding', 'with two cards the active one shows 1 and the unanswered one nothing: ' + JSON.stringify([s.badges, s.pill]));
  await p.locator('#findingsList .finding-card').last().locator('.findings-gate .choice-card', { hasText: 'INACTIVE' }).first().click(); await p.waitForTimeout(300);
  s = await state();
  check(s.badges.join() === '1,2' && s.pill === '2 findings' && s.badgeBgs[1] !== s.badgeBgs[0], 'once answered both show their number in their colour: ' + JSON.stringify([s.badges, s.badgeBgs, s.pill]));
  // Picking None doesn't make Termites vanish under the finger.
  await p.locator('#findingsList .finding-card').last().locator('.finding-remove-btn').click(); await p.waitForTimeout(300);
  await p.locator('#findingsList .finding-card').first().locator('.findings-gate .choice-card', { hasText: 'NONE' }).first().click(); await p.waitForTimeout(300);
  s = await state();
  check(s.shown.includes('termites'), 'answering None keeps Termites on screen while the report is open');

  // 4. Areas that all say nothing found answer the timber pests none.
  await p.evaluate(() => { startBlankReport(); });
  await p.evaluate((sc) => { for (const [k, v] of Object.entries(sc.job)) { const el = document.getElementById(k); if (el) el.value = v; } updateJob(); }, sc);
  const markAreas = results => p.evaluate(results => {
    reportData.areaStatus = {}; reportData.areaResult = {};
    Object.keys(OBS_ZONES).forEach(z => { reportData.areaStatus[z] = results[z] === 'NA' ? 'NA' : 'INSPECTED'; if (results[z] && results[z] !== 'NA') reportData.areaResult[z] = results[z]; });
    syncObstructionData(); goStep('findings');
  }, results);
  const allClear = { interior: 'CLEAR', exterior: 'CLEAR', subfloor: 'CLEAR', roofvoid: 'CLEAR', outbuildings: 'NA', site: 'CLEAR', fences: 'CLEAR', retainingwalls: 'NA', landscapingtimbers: 'NA' };
  await markAreas(allClear); await p.waitForTimeout(500);
  s = await state();
  check(s.shown.length === 0 && s.rd.termites.join() === 'NONE' && s.rd.borer === 'NONE' && s.rd.decay === 'NO' && s.rd.delig === 'NO', 'every area clear answers termites, borers, rot and delignification none: ' + JSON.stringify(s.rd));
  check(/Every area says nothing found/.test(s.more) && !s.quick && s.sts === 'Complete', 'the box says so, the quick fill is gone and Findings is Complete: ' + JSON.stringify([s.more, s.quick, s.sts]));
  await shoot('4-areas-clear');
  // The report prints them as none found.
  const pdf = await p.evaluate(async () => { const { blob } = await buildReportPdf(); const buf = new Uint8Array(await blob.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(bin); });
  fs.writeFileSync(`${OUT}/report-areas-clear.pdf`, Buffer.from(pdf, 'base64'));
  const text = execFileSync('pdftotext', ['-layout', `${OUT}/report-areas-clear.pdf`, '-']).toString().replace(/\s+/g, ' ');
  const findingsText = text.slice(text.lastIndexOf('FINDINGS'), text.lastIndexOf('PREVIOUS TERMITE TREATMENT') + 200);
  check(/Termite Activity\s+NONE/i.test(findingsText) && !/TERMITE FINDING 1|NO ACTIVITY FOUND|NEST FOUND\?\s+NOT RECORDED/i.test(findingsText), 'the PDF prints no termites as one row, with no numbered card and no nest question');
  check(/Borers of Seasoned Timber\s+NONE/i.test(findingsText) && /Wood Decay Fungi \(Rot\)\s+NO\b/i.test(findingsText) && /Chemical Delignification\s+NO\b/i.test(findingsText), 'the PDF prints borers NONE, rot NO and delignification NO');

  // 5. An area changed to evidence found takes those answers back and asks what it was.
  await markAreas({ ...allClear, subfloor: 'FOUND' }); await p.waitForTimeout(500);
  s = await state();
  check(s.rd.termites.join() === '' && s.rd.borer === '' && s.rd.decay === '' && s.rd.delig === '' && !s.rd.auto.length, 'the answers Areas gave are taken back: ' + JSON.stringify(s.rd));
  check(s.prompts.length === 1 && /subfloor\. What was it\?/.test(s.prompts[0]) && /Termites/.test(s.prompts[0]) && /Borers/.test(s.prompts[0]) && /Rot/.test(s.prompts[0]) && /Delignification/.test(s.prompts[0]), 'the subfloor asks what was found: ' + JSON.stringify(s.prompts));
  await shoot('5-subfloor-found');
  // Borers: a borer finding for the subfloor, under the borer question.
  await p.locator('#findingsFromAreas .area-finding-add', { hasText: 'Borers' }).click(); await p.waitForTimeout(500);
  s = await state();
  const borer = await p.evaluate(() => ({ cards: getBorerFindings().map(b => ({ act: b.borerActivity || '', loc: b.location || '' })) }));
  check(s.shown.includes('borers') && !s.shown.includes('termites') && borer.cards.length === 1 && /^Subfloor/.test(borer.cards[0].loc), 'Borers brings in the Borers group with a finding for the subfloor: ' + JSON.stringify([s.shown, borer]));
  await p.locator('#choices-borerActivity .choice-card', { hasText: 'ACTIVE' }).first().click(); await p.waitForTimeout(500);
  s = await state();
  const borer2 = await p.evaluate(() => ({ cards: getBorerFindings().map(b => ({ act: b.borerActivity || '', loc: b.location || '' })), shown: shownBorerFindings().length }));
  check(borer2.cards[0].act === 'ACTIVE' && borer2.shown === 1 && !s.prompts.length, 'picking Active fills in the subfloor card and the prompt goes: ' + JSON.stringify([borer2, s.prompts]));
  check(s.quick === 'Nothing else found' && s.quickAt === 'box' && /Not answered yet: termites, rot and delignification/.test(s.more), 'the quick fill reads "Nothing else found" and the rest wait: ' + JSON.stringify([s.quick, s.quickAt, s.more]));
  await shoot('6-borers-written-up');
  // Rot in the roof void.
  await markAreas({ ...allClear, subfloor: 'FOUND', roofvoid: 'FOUND' }); await p.waitForTimeout(400);
  await p.locator('#findingsFromAreas .area-finding-add', { hasText: 'Rot' }).click(); await p.waitForTimeout(600);
  s = await state();
  const rot = await p.evaluate(() => ({ yes: reportData.decayFound, where: reportData.decayWhere, linked: areaEvidence('roofvoid') }));
  check(s.shown.includes('decay') && rot.yes === 'YES' && /roof void/i.test(rot.where) && rot.linked.length && !s.prompts.length, 'Rot answers yes with the roof void as where, and the prompt goes: ' + JSON.stringify([rot, s.prompts]));

  // 6. An answer the inspector gives isn't taken back by Areas.
  await p.evaluate(() => { startBlankReport(); });
  await markAreas(allClear); await p.waitForTimeout(400);
  await p.evaluate(() => { revealFindingsGroup('borers'); commitEdit(document.getElementById('f-borerActivity'), 'borerActivity', 'NONE'); });
  await markAreas({ ...allClear, interior: 'FOUND' }); await p.waitForTimeout(400);
  s = await state();
  check(s.rd.borer === 'NONE' && s.rd.decay === '' && s.rd.termites.join() === '', 'borers answered by hand stay NONE; the rest Areas gave go: ' + JSON.stringify(s.rd));

  // 7. Termites shown with an open card: the first area goes inside it.
  await p.evaluate(() => { startBlankReport(); });
  await markAreas({ ...allClear, interior: 'FOUND', subfloor: 'FOUND' }); await p.waitForTimeout(400);
  await p.locator('#findingsMore .findings-more-btn', { hasText: 'Termites' }).click(); await p.waitForTimeout(400);
  const slot = await p.evaluate(() => { const sl = document.querySelector('#findingsList .finding-area-slot'); return sl && !sl.hidden ? sl.textContent.replace(/\s+/g, ' ').trim() : ''; });
  s = await state();
  check(/interior\. Write it up here\?/.test(slot) && s.prompts.length === 1 && /subfloor too\. What was it\?/.test(s.prompts[0]), 'with Termites open the first area is in the card and the second asks what it was: ' + JSON.stringify([slot, s.prompts]));
  await shoot('7-slot');

  // 8. The check before sending: "Say what it was" goes to the area's question.
  await p.evaluate(() => { goStep('property'); openSendReview(); }); await p.waitForTimeout(700);
  const gapBtn = p.locator('#sendReviewGaps button', { hasText: 'Say what it was' });
  check(await gapBtn.count() >= 1, 'the check before sending offers "Say what it was" for an area not written up');
  await gapBtn.first().click(); await p.waitForTimeout(700);
  const where = await p.evaluate(() => ({ step: currentStep, open: document.getElementById('sendReviewOverlay').classList.contains('open') }));
  check(where.step === 'findings' && !where.open, 'it closes the sheet and opens Findings: ' + JSON.stringify(where));

  check(!errs.length, 'no page errors: ' + errs.join(' | '));
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
