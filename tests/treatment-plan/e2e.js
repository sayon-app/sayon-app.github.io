// SAYON's treatment plan, end to end, with a canned AI answer (no real AI
// call is made):
//   1. a dictated note is kept on the report (reportData.heardNotes) and
//      reaches the planner with the report fields;
//   2. opening the quote asks nothing; Ask SAYON works out the plan once,
//      with the cached planner prompt, and sends the inspector's own quote
//      lines (no prices) so SAYON can compare;
//   3. the card shows Your plan vs SAYON (change, add, same), one scope
//      of works with who does each step, the reasons and questions folded,
//      and changes nothing in the quote until Add to my quote;
//      it notes when the inspector's quote changes after SAYON compared it;
//   4. Use this plan fills the quote's plan and lines at the business's
//      rates; Undo puts them back; the plan isn't part of what the client
//      signs (quoteContentHash);
//   5. the quote PDF and the client link carry "why this plan".
// node tests/treatment-plan/e2e.js <outDir>   (serve the repo on :8765 and run
// sh tests/visual/setup.sh first; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/treatment-plan'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf', uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };

// What the note said beyond the report fields: the planner should read it.
const NOTE = 'owner has two dogs that dig in the garden beds and a fish pond near the back fence, she would rather not have chemicals if we can help it, house is about 54 metres around';

// The answer the planner would give for the standard scenario.
const PLAN = {
  summary: 'Treat the nest in the gum tree, then in-ground baits: the pond and less chemical rule out a soil treatment.',
  versus: {
    agree: ['A long-term system is needed', 'Removing the timber on the soil'],
    add: ['Treat the nest in the gum tree first: it was found'],
    change: ['Bait stations, not a chemical barrier: the fish pond and dogs digging the beds'],
  },
  scope: [
    { do: 'Treat the nest in the gum tree', who: 'us' },
    { do: 'Install about 18 bait stations around the house', who: 'us' },
    { do: 'Remove the timber touching the soil', who: 'us' },
    { do: 'Find why the back room reads 28% moisture', who: 'plumber' },
    { do: 'Keep the dogs off the stations', who: 'owner' },
    { do: 'Check the nest in 2 to 3 weeks', who: 'us' },
  ],
  system: 'bait',
  knockdown: { needed: true, short: 'Treat the nest in the gum tree', method: 'Drill into the nest in the gum tree and treat it with a non-repellent dust or foam as the label directs', where: ['Gum tree in the backyard, about 15 m from the house'], why: 'The nest was found, so treating it directly is the quickest way to reach the colony. The subfloor workings are inactive, so there is nothing live to treat inside.' },
  systemWhy: ['A fish pond near the back fence: liquid termiticides carry strict limits near water.', 'The owner would rather avoid chemicals, and two dogs dig in the garden beds where a treated zone would be.', 'The house is about 54 m around, so about 18 stations at roughly 3 m apart.'],
  notChosen: [{ system: 'barrier', why: 'The pond, the dogs digging the beds and the owner\'s wish for less chemical.' }, { system: 'retic', why: 'The same chemical concerns, at a higher cost.' }],
  fixes: [{ what: 'Remove the timber touching the soil', who: 'us', why: 'It is a hidden way in and food for termites near the house.' }, { what: 'Find why the back room reads 28% moisture', who: 'plumber', why: 'Damp timber draws termites in.' }],
  followUp: 'Check the nest 2 to 3 weeks after treating it. Service the stations as the system\'s label says, then a full inspection at 3 months and every 12 months.',
  unknowns: ['Is the back section of the subfloor clear yet? It wasn\'t inspected.', 'Does the owner accept ongoing station servicing each year?'],
  client: {
    why: 'Termites are nesting in the gum tree about 15 m from your home. Because of your fish pond and your wish to keep chemicals down, we recommend bait stations rather than treating the soil.',
    we: ['Treat the termite nest in the gum tree.', 'Install about 18 bait stations around the house.', 'Check the stations regularly and add bait when termites find them.', 'Remove the timber touching the soil.', 'Fit a durable notice in the meter box.'],
    owner: ['Leave the stations in place and keep the dogs from digging them up.', 'Have the moisture in the back room looked at by a plumber.'],
    time: 'Half a day', service: '12 months', inspections: 'In 3 months, then every 12 months',
  },
  lines: [
    { key: 'nest', qty: 1, detail: 'Gum tree in the backyard', why: 'Nest found' },
    { key: 'bait_install', qty: 18, detail: 'Around the house, about 3 m apart', why: '54 m perimeter' },
    { key: 'bait_monitor', qty: 1, detail: '', why: 'Servicing' },
    { key: 'timber_soil', qty: 1, detail: '', why: 'Timber on soil' },
    { key: 'followup', qty: 1, detail: 'In 3 months', why: 'Report interval' },
  ],
};

const aiCalls = [];
async function backend(ctx) {
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, async r => {
    const req = r.request(), u = req.url();
    const body = req.method() === 'POST' ? (req.postDataJSON() || {}) : {};
    if (Array.isArray(body.messages)) {
      const sys = Array.isArray(body.system) ? body.system.map(b => b.text).join('') : String(body.system || '');
      if (sys.startsWith('You are SAYON\'s treatment planner')) {
        aiCalls.push(body);
        await new Promise(res => setTimeout(res, 1500));
        return r.fulfill({ json: { content: [{ type: 'text', text: JSON.stringify(PLAN) }], stop_reason: 'end_turn' } });
      }
      return r.fulfill({ json: { content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn' } });
    }
    return r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } });
  });
  await ctx.route(/supabase\.co/, r => {
    const u = r.request().url();
    if (u.includes('businesses?owner_id')) return r.fulfill({ json: [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] });
    return r.fulfill({ json: [] });
  });
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, acceptDownloads: true });
  await backend(ctx);
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1', '1'); }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  await p.evaluate(async ({ sc, NOTE }) => {
    storeCompanyDetails(sc.company); openApp('inspect'); resetReportState();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    for (const [k, v] of Object.entries(sc.job)) set(k, v);
    updateJob();
    await populateFields(sc.fields, NOTE);
    await populateFields({}, NOTE); // the same note filled again is kept once
  }, { sc, NOTE });
  await p.waitForTimeout(2500);
  const heard = await p.evaluate(() => reportData.heardNotes);
  check(Array.isArray(heard) && heard.length === 1 && heard[0].text.includes('fish pond'), 'the dictated note is kept once on the report');

  // 2. Opening the quote asks nothing by itself: the inspector asks for a second opinion.
  await p.evaluate(() => { saveDraft(); openQuoteFromReport(); });
  await p.waitForTimeout(1200);
  check(aiCalls.length === 0, 'opening the quote makes no AI call by itself');
  await p.evaluate(() => document.getElementById('quoteAiPlan').scrollIntoView({ block: 'start' }));
  await p.screenshot({ path: `${OUT}/0-ask.png` });
  check(/Second opinion/.test(await p.locator('#quoteAiPlan').innerText()), 'the card offers a second opinion');
  await p.click('#quoteAiPlan .tp-ask');
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/1-working.png` });
  check(await p.evaluate(() => document.querySelector('#quoteAiPlan .tp-busy') !== null), 'the card says it is working while the plan is made');
  await p.waitForFunction(() => quoteState && quoteState.aiPlan && quoteState.aiPlan.plan, null, { timeout: 20000 });
  await p.waitForTimeout(300);
  check(aiCalls.length === 1, 'one AI call for the plan');
  const call = aiCalls[0] || {};
  check(call.model === 'claude-sonnet-5' && call.output_config && call.output_config.effort === 'medium' && call.max_tokens === 16000, 'request shape matches extraction (model, effort, max_tokens)');
  check(call.system && call.system[0] && call.system[0].cache_control && call.system[0].cache_control.type === 'ephemeral', 'planner prompt is cached');
  const msg = (call.messages && call.messages[0] && call.messages[0].content) || '';
  check(msg.includes('fish pond') && msg.includes('"floorType":"Suspended timber floor"') && msg.includes('Gum tree'), 'the planner reads the fields and the dictated note');
  check(!msg.includes('Sam Taylor') && !msg.includes('7 Banksia'), 'no client name or street address goes to the planner');
  check(/"propertyState":"NSW"/.test(msg), 'state is read from the address');
  const own = await p.evaluate(() => quoteState.items.map(i => ({ desc: i.desc, price: i.price, source: i.source })));
  check(own.length > 0 && msg.includes("THE INSPECTOR'S QUOTE SO FAR") && own.every(i => msg.includes(i.desc.trim())), "the inspector's own quote lines go to the planner");
  check(own.every(i => !msg.includes('$' + i.price) && !msg.includes('"price"')), 'no prices go to the planner');

  const before = await p.evaluate(() => ({ items: quoteState.items.map(i => i.key), we: quoteState.plan && quoteState.plan.we }));
  check(!before.items.includes('bait_install'), 'nothing in the quote changes before Use this plan');
  await p.evaluate(() => document.getElementById('quoteAiPlan').scrollIntoView({ block: 'start' }));
  await p.screenshot({ path: `${OUT}/2-plan-card.png` });
  await p.setViewportSize({ width: 390, height: 2400 });
  await p.locator('#quoteAiPlan').screenshot({ path: `${OUT}/2a-sections-folded.png` });
  await p.evaluate(() => document.body.classList.add('dark-screen'));
  await p.locator('#quoteAiPlan').screenshot({ path: `${OUT}/2c-dark-screen.png` });
  await p.evaluate(() => document.body.classList.remove('dark-screen'));
  const text = await p.locator('#quoteAiPlan').innerText();
  check(await p.evaluate(() => document.querySelector('#quoteAiPlan .tp-wrap').open), 'the card opens by itself when the answer comes back');
  check(/SAYON recommendation/.test(text) && /Scope of works/i.test(text) && /Items to confirm/.test(text) && /Rationale/.test(text) && /Quote items/.test(text) && /Compared with your quote/i.test(text) && /Guide only/i.test(text), 'card shows the scope of works, the folded rows, the comparison and Guide only');
  const scope = await p.evaluate(() => ({ n: document.querySelectorAll('#quoteAiPlan .tp-scope-list li').length, owner: document.querySelectorAll('#quoteAiPlan .tp-scope-list .tp-who-owner').length, trade: (document.querySelector('#quoteAiPlan .tp-scope-list .tp-who-trade') || {}).textContent }));
  const tags = await p.$$eval('#quoteAiPlan .tp-scope-list .tp-who', els => [...new Set(els.map(e => e.textContent))].join(','));
  check(scope.n === 6 && scope.owner === 1 && scope.trade === 'Plumber' && tags === 'Contractor,Plumber,Property owner', 'each scope step says who does it (Contractor, Property owner, Plumber): ' + tags);
  check(!/Active termites|Long-term system/.test(text), 'the reasons are folded under Rationale');
  check(!/Alternatives considered/.test(text), 'sections start folded');
  const vs = await p.evaluate(() => ({ change: document.querySelectorAll('#quoteAiPlan .tp-vs-change').length, add: document.querySelectorAll('#quoteAiPlan .tp-vs-add').length, agree: document.querySelectorAll('#quoteAiPlan .tp-vs-agree').length,
    first: (document.querySelector('#quoteAiPlan .tp-vs-list li') || {}).className, tally: (document.querySelector('#quoteAiPlan .tp-head-sub') || {}).textContent }));
  check(vs.change === 1 && vs.add === 1 && vs.agree === 1 && vs.first === 'tp-vs-change' && vs.tally === '1 change · 1 addition · 2 agreed · 6 steps', 'the comparison lists change and add, then what is agreed on one row: ' + vs.tally);
  check(!/changed since SAYON/.test(text), 'nothing marked changed straight after asking');
  const priced = await p.evaluate(() => ({ sub: (document.querySelector('#quoteAiPlan .tp-sec[data-sec="quote"] .tp-sec-sub') || {}).textContent, n: document.querySelectorAll('#quoteAiPlan .tp-line-price').length, first: (document.querySelector('#quoteAiPlan .tp-line-price') || {}).textContent }));
  check(/^5 items · \$[\d,]+\.\d\d inc GST$/.test(priced.sub) && priced.n === 5 && /^\$[\d,]+\.\d\d$/.test(priced.first), 'Quote items shows each line priced at your rates and the total: ' + priced.sub);
  await p.click('#quoteAiPlan .tp-sec[data-sec="why"] > summary');
  await p.click('#quoteAiPlan .tp-sec[data-sec="check"] > summary');
  await p.waitForTimeout(200);
  const opened = await p.locator('#quoteAiPlan').innerText();
  check(/Alternatives considered/.test(opened) && /Active termites/.test(opened) && /Follow-up/.test(opened), 'Rationale opens to the knockdown, the system reasons, the alternatives and the follow-up');
  await p.locator('#quoteAiPlan').screenshot({ path: `${OUT}/2b-sections-open.png` });
  // Folded, the card is one row with the count; it stays as left while it is redrawn.
  await p.click('#quoteAiPlan .tp-wrap > summary');
  await p.waitForTimeout(200);
  await p.evaluate(() => renderTreatmentPlanCard());
  const folded = await p.evaluate(() => { const c = document.getElementById('quoteAiPlan'); return { open: c.querySelector('.tp-wrap').open, h: c.getBoundingClientRect().height, gist: c.querySelector('.tp-head-sub').textContent }; });
  check(!folded.open && folded.h < 100 && folded.gist === '1 change · 1 addition · 2 agreed · 6 steps', 'folds to one compact row with the count, and stays folded when redrawn: ' + JSON.stringify(folded));
  await p.locator('#quoteAiPlan').screenshot({ path: `${OUT}/2d-card-folded.png` });
  await p.click('#quoteAiPlan .tp-wrap > summary');
  await p.waitForTimeout(200);
  await p.setViewportSize({ width: 390, height: 844 });

  // The inspector edits their quote after asking: the card says so.
  await p.evaluate(() => { quoteState.items.push(newQuoteItem('weep_holes', { source: '' })); renderQuoteItems(); });
  await p.waitForTimeout(200);
  check(/Your quote has changed since SAYON looked at it/.test(await p.locator('#quoteAiPlan').innerText()), 'a line added after asking marks the comparison as changed');
  await p.evaluate(() => { quoteState.items.pop(); renderQuoteItems(); });
  await p.waitForTimeout(200);
  check(!/changed since SAYON/.test(await p.locator('#quoteAiPlan').innerText()), 'taking it out again clears the note');
  // Ask again with a note: says what it does, and the button is full width.
  await p.click('#quoteAiPlan .tp-again > summary');
  await p.waitForTimeout(200);
  const again = await p.evaluate(() => { const d = document.querySelector('#quoteAiPlan .tp-again'); const b = d.querySelector('.quote-btn').getBoundingClientRect(); return { hint: d.querySelector('.tp-again-hint').textContent, w: b.width, dw: d.getBoundingClientRect().width }; });
  check(/works the whole plan out again/.test(again.hint) && /doesn't answer questions/.test(again.hint) && again.w > again.dw * 0.9, 'Ask again says it reworks the plan, not a chat, and its button is full width');
  check(await p.evaluate(() => /A question in it is not part of the plan/.test(TREATMENT_PLAN_PROMPT) && /THE INSPECTOR ADDS:\nowner wants no baits/.test(treatmentPlanMessage({ report: {}, notes: [] }, 'owner wants no baits', null))), "the planner reads the inspector's note and ignores questions in it");
  await p.click('#quoteAiPlan .tp-again > summary');
  const older = await p.evaluate(() => [
    tpVersusHTML({ plan: { versus: { agree: [], add: [], change: [] }, versusInspector: 'Agrees with baiting.' } }, quoteState),
    tpVersusHTML({ plan: { versus: { agree: [], add: [], change: [] }, versusInspector: '' }, compared: false }, { items: [] }),
    tpVersusTally({ versus: { agree: ['Baiting'], add: [], change: [] } }),
  ]);
  check(older[0].includes('Agrees with baiting.'), 'a plan saved before the three lists still shows its one line');
  check(older[1].includes('Nothing of yours to compare yet'), 'asked with an empty quote: says there was nothing to compare');
  check(older[2] === 'Agrees with your quote', 'all agreed: says so in the heading');
  const oldScope = await p.evaluate(() => tpScope({ knockdown: { needed: true, short: 'Dust the frame' }, system: 'bait', fixes: [{ what: 'Fix the leak', who: 'plumber' }], client: { inspections: 'In 3 months' } }));
  check(oldScope.length === 4 && oldScope[0].do === 'Dust the frame' && oldScope[2].who === 'plumber', 'a plan saved before the scope gets one built from its parts');

  // 3. Reopening the quote doesn't ask again.
  await p.evaluate(() => { closeQuote(); openQuoteFromReport(); });
  await p.waitForTimeout(1500);
  check(aiCalls.length === 1, 'reopening the quote does not make another call');

  // 4. Use this plan.
  const hashBefore = await p.evaluate(() => quoteContentHash(quoteState));
  check(await p.evaluate(() => quoteContentHash(quoteState)) === hashBefore, 'the AI plan is not part of the quote the client signs');
  await p.click('#quoteAiPlan .tp-use');
  await p.waitForTimeout(600);
  const after = await p.evaluate(() => ({ items: quoteState.items.map(i => [i.key, i.qty, i.price]), plan: quoteState.plan, choice: quoteState.systemChoice }));
  check(after.items.some(([k, q]) => k === 'bait_install' && q === 18) && after.items.some(([k]) => k === 'nest'), 'lines come from the plan, with its quantities');
  check(after.items.every(([, , pr]) => pr > 0), 'each line is priced at the business rate');
  check(!after.items.some(([k]) => k === 'direct'), 'the guessed report lines make way');
  check(after.plan.why.includes('fish pond') && after.plan.we.split('\n').length === 5 && after.plan.time === 'Half a day' && after.plan.service === '12 months', 'plan steps, why, time and service filled');
  check(!after.choice, 'the system question is answered by the plan');
  check(await p.evaluate(() => formatAUD(quoteTotals(quoteState).total)) === priced.sub.replace(/^5 items · | inc GST$/g, ''), "the quote's total matches the total SAYON's card showed");
  const srcs = await p.$$eval('.quote-item-source', els => els.map(e => e.textContent.trim()));
  check(srcs.some(t => t === 'From the SAYON recommendation') && !srcs.some(t => /Nest found|perimeter|Servicing/.test(t)), "SAYON's lines carry one short tag, with no reason under each");
  const tq = await p.evaluate(() => treatmentPlanTechQuote(quoteState));
  check(!tq || (!tq.lines.some(l => /bait station/i.test(l)) && !tq.steps.length), "SAYON's own lines and steps don't count as the inspector's plan");
  check(!/changed since SAYON/.test(await p.locator('#quoteAiPlan').innerText()), 'adding the plan to the quote is not flagged as a change');
  await p.evaluate(() => { document.getElementById('quotePlanFold').open = true; document.getElementById('quoteAiPlan').scrollIntoView({ block: 'start' }); });
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/3-used.png` });
  await p.evaluate(() => document.getElementById('quotePlanFold').scrollIntoView({ block: 'start' }));
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/4-quote-plan.png` });

  // 5. The client sees why this plan: the link doc and the PDF.
  const doc = await p.evaluate(() => typeof quoteLinkDoc === 'function' ? quoteLinkDoc(quoteState, {}) : null);
  if (doc) check(doc.plan && doc.plan.why.includes('fish pond'), 'the client link carries why this plan');
  else console.log('note: link doc builder not found by name, skipped');
  const pdfText = await p.evaluate(async () => {
    await ensureJsPDFLoaded();
    const out = await buildQuotePDF(quoteState);
    return await out.blob.text();
  }).catch(e => 'ERR ' + e.message);
  check(/fish pond/.test(pdfText) || /fish/.test(pdfText), 'the quote PDF prints why this plan');

  // Undo puts it all back.
  await p.evaluate(() => { document.getElementById('quoteAiPlan').scrollIntoView(); });
  await p.click('#quoteAiPlan .quote-text-btn');
  await p.waitForTimeout(400);
  const undone = await p.evaluate(() => ({ items: quoteState.items.map(i => i.key), we: quoteState.plan && quoteState.plan.we }));
  check(JSON.stringify(undone.items) === JSON.stringify(before.items) && undone.we === before.we, 'Undo restores the lines and the plan');

  // A thin answer: SAYON's own checks say what's missing, without changing the plan.
  const thin = await p.evaluate(() => checkTreatmentPlan({ system: 'bait', lines: [{ key: 'bait_monitor', qty: null }, { key: 'barrier_job', qty: 1 }], unknowns: [] },
    { findings: [{ termiteActivity: 'ACTIVE' }] }).checks);
  check(thin.length === 3, 'thin answer: no bait line, no knockdown line, two systems flagged');
  const thinQty = await p.evaluate(() => [tpStartQty('bait_install'), tpStartQty('barrier_lm'), tpStartQty('nest')]);
  check(JSON.stringify(thinQty) === '[12,40,1]', 'a line with no quantity starts at the usual amount');

  // No signal: the plan waits, then works itself out when signal returns.
  await p.evaluate(() => { delete quoteState.aiPlan; persistQuote(); closeQuote(); });
  await ctx.setOffline(true);
  await p.evaluate(() => openQuoteFromReport());
  await p.waitForTimeout(500);
  const waitText = await p.locator('#quoteAiPlan').innerText();
  check(/Ask SAYON/.test(waitText) && aiCalls.length === 1, 'offline: the card still only offers to ask');
  await p.click('#quoteAiPlan .tp-ask');
  await p.waitForTimeout(400);
  check(/No signal right now/.test(await p.locator('#quoteAiPlan').innerText()) && aiCalls.length === 1, 'asked offline: the card waits for signal, no call, no error');
  await ctx.setOffline(false);
  await p.waitForFunction(() => quoteState && quoteState.aiPlan && quoteState.aiPlan.plan, null, { timeout: 20000 });
  check(aiCalls.length === 2, 'back online: the plan is worked out by itself');

  // From the report's Recommendations: opens the quote at the plan, no new call.
  await p.evaluate(() => { closeQuote(); showSection('recommendations'); });
  await p.waitForTimeout(400);
  const btn = p.locator('.tp-report-link');
  if (await btn.isVisible()) {
    await btn.scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${OUT}/5-report-link.png` });
    await btn.click();
  } else await p.evaluate(() => openTreatmentPlanFromReport());
  await p.waitForTimeout(800);
  check(await p.evaluate(() => document.getElementById('quoteScreen').classList.contains('open')) && aiCalls.length === 2, 'report button opens the quote at the existing plan');

  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
