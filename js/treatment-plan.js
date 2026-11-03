// ══════════════════════════════════════════════════════════════════════════
// SAYON'S TREATMENT PLAN
// Reads the whole report (and the notes the inspector dictated) and works out
// the plan of attack an experienced technician would choose for THIS
// property: how to knock out live termites, which long-term system suits the
// site and why it beats the others here, what needs fixing, when to come
// back, and what isn't known yet. One AI call per plan, through the Worker,
// with the same request shape as extraction (no Worker change).
//
// It's a second opinion the inspector asks for (Ask SAYON on the quote, or
// the button under the report's Recommendations), usually after working out
// their own plan; it never runs by itself. It reads their quote so far too,
// and says where it would change, add to or keep their plan. Shown on the quote in folded
// sections, and nothing reaches the client until "Add to my quote", which
// fills the quote's treatment plan and work lines (they stay editable, and
// Undo puts the quote back). The plan and its reasoning live on the quote
// as q.aiPlan, which quoteContentHash() leaves out, so it is never part of
// what the client signs.
//
// Loaded after js/quote.js and uses its globals (quoteState, newQuoteItem,
// QUOTE_CATALOGUE, QUOTE_SYSTEM_LABELS, QUOTE_PLAN_TIMES, QUOTE_PLAN_SERVICE,
// renderQuotePlan, renderQuoteItems, scheduleQuoteSave, quotePlanReport,
// currentQuoteSource, isQuoteLocked) and js/app.js's (workerFetch,
// escapeHtml, showToast, sha256Hex, stableJson, track, authSession).
// ══════════════════════════════════════════════════════════════════════════

const TREATMENT_PLAN_TIMEOUT_MS = 120000;

const TREATMENT_PLAN_PROMPT = `You are SAYON's treatment planner. SAYON is an app for licensed Australian timber pest inspectors. The user message is one inspection: the report fields the app filled from the inspector's dictation (JSON), the notes the inspector actually said, often the inspector's own quote so far, and sometimes extra words from the inspector. Work out the plan of attack a highly experienced Australian termite technician would choose for THIS property, and explain it so the inspector can check your reasoning in ten seconds and the client can understand what they are paying for.

The inspector is the licensed professional and makes the final call. You are a second opinion: most inspectors have already formed their own plan and ask you to check it against yours. Give your honest best plan, and where the inspector has said or quoted what they intend, say plainly where you agree, what you would add and what you would do differently, and why. A generic answer ("install a termite management system") is useless to them. Every choice must be tied to the facts of this property, and every reason must name the fact it rests on.

Return ONLY a valid JSON object, no markdown and no commentary, in exactly this shape:
{"summary":string,
"versus":{"agree":[string],"add":[string],"change":[string]},
"scope":[{"do":string,"who":"us"|"owner"|"plumber"|"builder"|"arborist"|"electrician"}],
"system":"bait"|"barrier"|"retic"|"physical"|"system"|"none",
"knockdown":{"needed":boolean,"short":string,"method":string,"where":[string],"why":string},
"systemWhy":[string],
"notChosen":[{"system":"bait"|"barrier"|"retic"|"physical"|"system"|"none","why":string}],
"fixes":[{"what":string,"who":"us"|"owner"|"plumber"|"builder"|"arborist"|"electrician","why":string}],
"followUp":string,
"unknowns":[string],
"client":{"why":string,"we":[string],"owner":[string],"time":string,"service":string,"inspections":string},
"lines":[{"key":string,"qty":number or null,"detail":string,"why":string}]}

WHAT EACH FIELD IS
- summary: one line for the inspector, the plan in short ("Nest in the stump first, then in-ground baits: paving blocks trenching").
- versus: your plan against the inspector's own plan: their quote so far (THE INSPECTOR'S QUOTE SO FAR), the method they named (treatmentType or the notes) and the steps they wrote. agree: what in their plan you would also do ("Baiting over a soil treatment"). add: what you would add that their plan leaves out, with the fact behind it ("A nest search at the gum stump by the back fence"). change: what you would do differently, what instead and why ("Dust the window frame instead of AG baits: only a few termites left to carry it"). Name the line or method each time; never repeat an item across the three lists, and never pad agree with small items. All three are empty arrays when the inspector gave no plan, quote or method.
- scope: the scope of works, the one list the inspector reads first: every action in this plan, in the order it happens (treat the live termites, search for or treat the nest, put in or service the long-term system, each fix, the follow-up visits). do: the action with its place or amount, at most 10 words ("Dust the workings in the kitchen window frame", "Install about 18 bait stations around the house", "Fix the leaking shower in the ensuite", "Come back in 3 weeks to check the nest"). who: who does it. Only actions, never reasons: the reasons go in the other fields.
- system: the long-term termite management system you recommend. bait = in-ground baiting and monitoring system; barrier = chemical soil treatment (a treated zone); retic = reticulation system charged with termiticide; physical = physical barrier; system = service, top up or recharge the system already on the property; none = no new system (no termites and nothing calling for one, an existing system that is still working, or the inspector said no system).
- knockdown: what to do about LIVE termites now, separate from the long-term system. needed is false when no live termites were found. short: the method in at most 8 words ("Dust the workings, AG baits on the frame"). method names the method and its sequence ("AG stations on the live workings, checked every 2 to 3 weeks"). where lists each place, in the inspector's words. why ties it to what was found (how many places, nest found or not, what the timber is, whether termites can be reached).
- systemWhy: 2 or 3 reasons this system suits this property better than the others, each naming the fact behind it ("Paving covers most of the slab edge: a soil treatment means drilling concrete").
- notChosen: each of the other realistic options and the property-specific reason it lost here. Skip options that were never realistic (a physical barrier on an existing house is rarely realistic; say so once only if the inspector or owner raised it).
- fixes: conditions that invite or hide termites, each with who does it and why it matters for the plan (a leak keeps the soil and timber wet, which draws termites in and breaks down a soil treatment's working life; a garden bed over the slab edge hides any entry and bridges the treated zone).
- followUp: the visits after the job, for the inspector: when to check knockdown stations or treated workings, when to confirm activity has stopped, station servicing, and the next full inspection.
- unknowns: what the plan depends on that the report does not say, each as a short question the inspector can answer on site ("Perimeter length? Needed to price stations or metres.", "Is the slab edge exposed on the left side? Not said."). Put the most decisive ones first. Never fill these gaps with assumptions elsewhere in the plan.
- client: the plan as the client reads it on the quote, in plain Australian English and short sentences, no trade jargon. why: 1 or 2 sentences on why this plan suits their home, naming the property facts in everyday words. we: the steps we will do from the treatment visit on, in order, one action each (never what was done at the inspection). owner: what the owner must do to keep the treatment working (no repairs by trades: those go on the quote as exclusions). time: time on site for the treatment visit, as one of "1 to 2 hours", "Half a day", "1 day", "2 days", or your own short words. service: free service period, "None" or "12 months" (most businesses offer 12 months after a full treatment; use "None" when there is no treatment). inspections: when the next inspections are ("In 3 months, then every 12 months").
- lines: the work lines for the quote, using ONLY these keys: direct (direct treatment of live termite workings, unit area, one per place), nest (locate and treat the nest), barrier_lm (chemical soil treatment per linear metre), barrier_job (chemical soil treatment, whole job, only when the length is unknown), bait_install (supply and install in-ground bait stations, per station), bait_monitor (bait station monitoring and servicing, 12 months), retic_lm (reticulation system, per metre), physical_lm (physical barrier, per metre), system_topup (top up or recharge the existing system), borer (treat timbers with live borers), timber_soil (remove timber-to-soil contact), weep_holes (clear bridged weep holes), slab_edge (expose a concealed slab edge), followup (follow-up timber pest inspection), invasive (invasive inspection). qty is the number of units: a length or station count only from a figure in the report or notes (a perimeter said as "about 48 metres" gives 48 lm, or about 16 stations at roughly 3 m apart), the number of places for direct, 1 for a job or visit. When you cannot get a quantity from what was said, qty is null and the matching question goes in unknowns. detail: the client-facing place or scope ("Kitchen window frame", "Full perimeter, including drilling the rear patio"), or "". why: a few words for the inspector. Never give prices: the app prices each line at the business's own rates.

HOW AN EXPERIENCED TECHNICIAN DECIDES

1. Live termites come first.
- Never break open, spray or disturb live workings before treating: disturbed termites retreat and the chance to reach the colony is lost. Tell the owner not to touch or spray them (put that in client.owner).
- Nest found (tree, stump, pole, mound, wall or slab cavity): treat the nest directly, drilling into it and applying a non-repellent dust, foam or liquid as the label directs. It is the most direct way to destroy the colony. A dead stump should then be removed or ground out (owner or arborist); a living tree's health is for an arborist.
- Nest not found, plenty of live termites in timber you can reach: either non-repellent dust puffed into the workings through small holes (quick, works by termites carrying it back to the colony, needs good numbers of termites present), or above-ground bait stations fixed over the workings (slower, often weeks to months, aims to eliminate the colony, needs follow-up visits every few weeks while they feed). Choose dust when speed matters or the timber is being eaten out; choose above-ground baits when the colony is large or spread, the nest can't be found, or several places are active from what looks like one colony. Many technicians do both: above-ground stations where termites are feeding hard, dust where only a few can be reached.
- Termites in wall cavities, door jambs, architraves or hollow framing you can't reach: non-repellent foam into the voids.
- Never use a repellent spray on live termites; it scatters them.
- Live termites in a fence, landscaping timber, stump or tree away from the house still mean a colony is foraging near the building: treat them there and say so in client.why.
- Live termites inside the house with no nest found: the colony is usually outside, in trees, stumps, root crowns, under paving or a slab, or on a neighbouring property, within roughly 50 to 100 m. A nest search line is worth quoting when there are trees or stumps on site.
- After the knockdown, confirm activity has stopped (follow-up visit) before relying on the long-term system alone.

2. Choosing the long-term system. Weigh these facts from the report, in roughly this order:
- Whether a system is already there. existingSystem, durableNoticePresent, previousTreatment and termiteHistory tell you. A reticulation system in place: recharge it (system), unless it's failed or incomplete. Bait stations in place: service them and add above-ground stations on any activity (system). An older chemical zone: re-treat as a soil treatment (barrier) or top up (system) depending on its age and the label; say what you need to know about its date in unknowns. A system installed by another company and still under its warranty or service contract (the inspector or durable notice says so): the plan is for that installer to service it; don't quote replacing or servicing it yourself, and say so in client.we as advice ("Contact the installer to service and rebait the active stations under your warranty"). A chemical zone still inside its working life by the label, with no activity found: no new system (system "none"); keep the zone intact and fix whatever bridges it. Live termites inside despite a system means a breach (garden bed or paving over the zone, render, an extension, concealed slab edge, expired zone): find and fix the breach as part of the plan.
- Construction. Slab on ground: concealed entry through slab joints, pipe penetrations, infill slabs (patios, garages, extensions), and slab edges hidden by paving, garden beds, render or cladding. Suspended floor with a subfloor: treat soil around piers, stumps and internal walls as well as the outside perimeter, needs safe access and clearance (under about 400 mm limits it); ant caps matter. High-set or Queenslander stumps: treat around each stump and the perimeter; timber stumps in the ground are an entry point.
- What lies against the walls. Mostly open soil and garden beds with the slab edge exposed favour a chemical soil treatment (trench and treat). Paving, concrete paths, driveways and patios against the walls mean drilling and injecting through the concrete at close spacing, which is more work and can be impossible inside under floor coverings; this pushes towards baiting, or a soil treatment priced for drilling. A concealed slab edge with no way to treat or inspect it favours baiting and a slab_edge line.
- Water and sensitivity. Ponds, creeks, dams, wells, bores, aquaculture, a high water table, or soil that floods: liquid termiticides carry strict label limits near water, so baiting is usually preferred. Food gardens against the walls, a household that wants as little chemical as possible, or pets or children who dig in the garden beds also favour baiting.
- Activity level. Live termites with no nest found favour baiting, which aims to eliminate the colony rather than only block it; a soil treatment can follow once activity is controlled if the owner wants a treated zone. Inactive evidence only, with no system: a system is still advisable to prevent a return; it is not urgent knockdown work.
- The owner's commitment. Baiting needs ongoing servicing (often every 4 to 8 weeks in warmer months, less in cooler months, as the system's label says) and an ongoing yearly cost; if the owner said they don't want ongoing visits, a soil treatment or reticulation suits better. Reticulation costs more up front but lets the zone be recharged without trenching or drilling again; it suits new paving or landscaping planned along the walls, or an owner who wants a renewable zone.
- Physical barriers are installed during construction or with an extension (AS 3660.1). On an existing house they are rarely the right answer; recommend one only for planned building work.
- Climate and region (propertyState, postcode) shape season and servicing intervals; in the tropical north the giant northern termite (Mastotermes) occurs and baiting is commonly used against it. Species otherwise informs where to look for the nest and how to reach it (Coptotermes often nests in trees, stumps and root crowns or under slabs; Schedorhinotermes often has several linked nests, so expect more than one knockdown point). Species is never a reason the property is at higher risk, and never say so.
- If the inspector named or quoted a method (treatmentType, their notes or their quote so far), start from it and keep it when the facts support it. When the facts strongly argue against it, recommend what you would do and put the reason first in versus.change, so the inspector weighs it before anything else.
- If the inspector offered a choice ("chemical barrier or baiting"), choose one for this property and explain in systemWhy and notChosen.
- THE INSPECTOR ADDS is the inspector's note when they ask again. Facts in it (a measurement, the owner's wishes, something found) override the report. A direction in it ("quote a chemical barrier instead", "no baits") is the plan to build, as long as it is sound and safe; if you would still do it differently, say so in versus.change. A question in it is not part of the plan: ignore it.
- No termites, no evidence, no system needed: system "none", knockdown not needed, plan built around fixes and regular inspections.

3. Fix what invites termites. Leaks and high moisture readings (find and fix the source; termites follow moisture and a wet zone breaks down a soil treatment sooner), timber on the soil, bridged weep holes and slab edges, garden beds or paving over the inspection zone, poor drainage, poor subfloor ventilation, non-durable timber in the ground, gaps in ant capping, stored timber and firewood against the walls. Include each one the report raises, with who does it. Use the timber_soil, weep_holes and slab_edge lines only for work the pest business itself would do.

4. Borers and decay. Active borers in timber you can treat: a borer line, treated as the label directs. Old borer damage or decay: no treatment line; the owner's builder repairs it and fixes the moisture causing decay.

5. Coming back. AS 3660.2 recommends a timber pest inspection at least every 12 months, more often where the risk is higher. After a knockdown: check stations or treated workings every 2 to 3 weeks until activity stops, then confirm. After a full treatment, a first inspection at about 3 months is common, then every 12 months. Use the inspector's own interval (inspectionFrequency) when they gave one.

RULES THAT MUST NEVER BE BROKEN
- Never invent a fact. Every reason, place and quantity comes from the report fields or the notes. When the report is silent on something the plan depends on, say so in unknowns and choose what the known facts support. A field that is null or missing means "not said", not "no".
- Never give a structural verdict. Damage goes to a builder or structural engineer to assess ("have a builder check the window frame"), never "the frame is safe" or "structurally sound" or "compromised".
- Never rate the risk by termite species.
- No severity adjectives (minor, moderate, severe, extensive, significant, extreme) about damage. Say what was seen and where.
- Never promise an outcome. Say what the treatment aims to do ("aims to destroy the colony"), never "will eliminate", "guaranteed" or "permanent".
- Never name a product or brand in client text unless the inspector named it; say "non-repellent termiticide", "bait stations". The inspector picks the product and applies it as its label directs.
- Australian terms and spelling: metres, colour, licence (noun), paving, garden beds, meter box, durable notice.

KEEP IT SHORT (the inspector reads it on a phone, at a glance; every extra word is noise)
- Write like a technician's notes: the fact, then what it means, in a few words ("Fish pond near the back fence: liquid limits near water"). No filler, no full sentences where a phrase will do, never the same fact in two places.
- Never put the report's field names or codes in any text ("slabEdge", "OBSTRUCTED", "zone75mmVisible", "ACTIVE"); say it in plain words ("garden bed over the slab edge").
- summary at most 15 words.
- versus: at most 3 items in each list; agree items at most 8 words, add at most 12, change at most 15.
- scope: at most 8 actions, each at most 8 words.
- knockdown: short at most 8 words; method at most 12; why at most 12.
- systemWhy: at most 3 reasons, each at most 12 words. notChosen: at most 3, each at most 10 words.
- fixes: at most 5; what at most 8 words; why at most 8 words.
- followUp at most 15 words. unknowns: at most 4 questions, each at most 12 words, most decisive first.
- client.why: 1 or 2 short sentences, 25 words in all. client.we: at most 6 steps; client.owner: at most 4; each step at most 10 words.
- lines: detail at most 8 words; why at most 6 words.`;

// What the planner reads: every report field that bears on the plan, as
// the app holds it, plus what the inspector said. No client name, phone,
// email or street address, which the plan has no use for.
const TREATMENT_PLAN_FIELDS = [
  'inspectionType', 'propertySuburb', 'propertyState', 'propertyPostcode',
  'structureType', 'height', 'wallConstruction', 'roofType', 'floorType', 'constructionEra', 'occupancyStatus',
  'siteSurroundings', 'siteSlope', 'termiteHistory', 'accessNotes', 'recentWeather', 'rainLast24h',
  'existingSystem', 'existingSystemOther', 'durableNoticePresent', 'hardLandscaping', 'zone25mmVisible', 'softLandscaping', 'zone75mmVisible',
  'antCapping', 'antCappingDetails', 'antCapSoldered',
  'areaStatus', 'areaResult', 'obstructions', 'restrictedAccess', 'noAccessAreas', 'highRiskAreas', 'hinderedAreas', 'hinderedAreasDetail',
  'borerActivity', 'decayFound', 'decayDetails', 'decayWhere', 'delignification', 'delignificationDetails',
  'previousTreatment', 'previousTreatmentDetails', 'previousTreatmentWhere',
  'moistureReadings', 'moistureMeterReadings', 'waterLeaks', 'leakLocation', 'mouldSeen', 'timberSoil', 'slabEdge', 'weepHoles',
  'siteDrainage', 'subfloorDrainage', 'subfloorVentilation', 'nonDurableTimber', 'nonDurableTimberDetails', 'nonDurableTimberWhere',
  'riskLevel', 'treatmentRecommended', 'treatmentType', 'inspectionFrequency', 'invasiveInspection', 'invasiveInspectionDetails', 'otherRecommendations',
];

// The dictated notes are the richest input (an owner who wants no chemicals,
// a fish pond, dogs), so they go in whole up to this many characters, the
// newest kept when there's more. The Worker refuses over 20,000 in all.
const TREATMENT_PLAN_NOTES_CHARS = 12000;

function treatmentPlanInput(rd, address) {
  rd = rd || {};
  const report = {};
  const blank = v => v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
  TREATMENT_PLAN_FIELDS.forEach(k => { if (!blank(rd[k])) report[k] = rd[k]; });
  // The state and postcode set the climate and season. They sit on the job,
  // not the report fields, so they're read off the quote's address.
  const m = String(address || '').match(/\b(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b\s*(\d{4})?/i);
  if (m && !report.propertyState) report.propertyState = m[1].toUpperCase();
  if (m && m[2] && !report.propertyPostcode) report.propertyPostcode = m[2];
  const findings = (Array.isArray(rd.findings) ? rd.findings : []).filter(f => f && f.termiteActivity)
    .map(f => {
      const o = {};
      ['termiteActivity', 'activityLocation', 'species', 'timberAffected', 'damageDescription', 'nestLocated', 'structuralConcern']
        .forEach(k => { if (!blank(f[k])) o[k] = f[k]; });
      return o;
    });
  if (findings.length) report.findings = findings;
  const borers = (Array.isArray(rd.borerFindings) ? rd.borerFindings : []).filter(Boolean)
    .map(b => {
      const o = {};
      ['borerActivity', 'borerType', 'location', 'timberAffected', 'description'].forEach(k => { if (!blank(b[k])) o[k] = b[k]; });
      return o;
    }).filter(o => Object.keys(o).length);
  if (borers.length) report.borerFindings = borers;
  const sq = rd.quoteSpoken;
  if (sq && Array.isArray(sq.items) && sq.items.length) {
    report.quoteSaid = sq.items.filter(it => it && it.description).map(it => [it.qty, it.unit, it.description].filter(v => v != null && v !== '').join(' '));
  }
  // Newest notes win when they don't all fit.
  const notes = [];
  let room = TREATMENT_PLAN_NOTES_CHARS;
  (Array.isArray(rd.heardNotes) ? rd.heardNotes : []).slice().reverse().forEach(n => {
    const t = (n && n.text || '').trim();
    if (!t || room <= 0) return;
    notes.unshift(t.length > room ? '…' + t.slice(t.length - room) : t);
    room -= t.length;
  });
  return { report, notes };
}

// The inspector's own plan as it stands on the quote: the work lines they
// have (said, typed or built from their recommendation, not SAYON's), and
// the steps they wrote for the client. SAYON compares its plan with this.
// No prices: the comparison is about the work, not the money.
function treatmentPlanTechQuote(q) {
  if (!q) return null;
  const lines = (Array.isArray(q.items) ? q.items : [])
    .filter(it => it && !/^SAYON plan/.test(it.source || '') && (it.desc || '').trim())
    .map(it => {
      const n = Number(it.qty) || 0;
      const qty = n > 0 && it.unit ? `${n} ${pluralUnit(it.unit, n)}: ` : '';
      return qty + it.desc.trim() + ((it.detail || '').trim() ? ` (${it.detail.trim()})` : '');
    });
  // Steps SAYON wrote don't count as theirs.
  const ownSteps = q.plan && !(q.aiPlan && q.aiPlan.applied) ? String(q.plan.we || '') : '';
  const steps = ownSteps.split('\n').map(t => t.trim()).filter(Boolean);
  return lines.length || steps.length ? { lines, steps } : null;
}

function treatmentPlanQuoteHash(q) {
  return sha256Hex(stableJson(treatmentPlanTechQuote(q))).slice(0, 16);
}

function treatmentPlanMessage(input, extra, techQuote) {
  const parts = ['REPORT FIELDS (JSON):\n' + JSON.stringify(input.report)];
  parts.push(input.notes.length
    ? 'WHAT THE INSPECTOR SAID (notes in the order dictated):\n' + input.notes.map((t, i) => `[${i + 1}] ${t}`).join('\n')
    : 'WHAT THE INSPECTOR SAID: no notes kept for this report; plan from the fields.');
  if (techQuote) {
    const q = [];
    if (techQuote.lines.length) q.push('Work lines:\n' + techQuote.lines.map(t => '- ' + t).join('\n'));
    if (techQuote.steps.length) q.push('Steps they wrote for the client:\n' + techQuote.steps.map(t => '- ' + t).join('\n'));
    parts.push("THE INSPECTOR'S QUOTE SO FAR (their own plan, before asking you; lines built from their recommendation count as theirs):\n" + q.join('\n'));
  } else {
    parts.push("THE INSPECTOR'S QUOTE SO FAR: empty.");
  }
  if ((extra || '').trim()) parts.push('THE INSPECTOR ADDS:\n' + extra.trim());
  return parts.join('\n\n');
}

// A report worth planning for: termites found (live or not), a treatment
// recommended, or a system on the property.
function reportNeedsPlan(rd) {
  rd = rd || {};
  const findings = Array.isArray(rd.findings) ? rd.findings : [];
  return findings.some(f => f && (f.termiteActivity === 'ACTIVE' || f.termiteActivity === 'INACTIVE')) ||
    rd.treatmentRecommended === 'YES' || !!(rd.treatmentType || '').trim();
}

function treatmentPlanHash(rd, address) {
  return sha256Hex(stableJson(treatmentPlanInput(rd, address))).slice(0, 16);
}

// One request in flight per quote, so leaving and reopening the quote
// doesn't ask twice, and the answer lands on the right quote.
const treatmentPlanRuns = {};
// Quotes whose plan is waiting for signal (by report key): worked out when
// the phone is back online, not shown as an error.
const treatmentPlanWaiting = {};

async function requestTreatmentPlan(rd, address, extra, techQuote) {
  if (!navigator.onLine) throw Object.assign(new Error('No signal'), { noSignal: true });
  const input = treatmentPlanInput(rd, address);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TREATMENT_PLAN_TIMEOUT_MS);
  let res, raw;
  try {
    res = await workerFetch('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        // The plan is reasoning, so it thinks before answering; thinking
        // counts toward max_tokens (see callExtraction).
        max_tokens: 16000,
        output_config: { effort: 'medium' },
        // Same for every plan, so cached for an hour.
        system: [{ type: 'text', text: TREATMENT_PLAN_PROMPT, cache_control: { type: 'ephemeral', ttl: '1h' } }],
        messages: [{ role: 'user', content: treatmentPlanMessage(input, extra, techQuote) }],
      }),
      signal: controller.signal,
    });
    raw = await res.text();
  } catch (err) {
    throw Object.assign(new Error(err && err.name === 'AbortError' ? 'No answer in time' : 'No connection'), { noSignal: true });
  } finally {
    clearTimeout(timer);
  }
  let data;
  try { data = JSON.parse(raw); } catch (e) { throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status }); }
  if (!res.ok || data.error) throw Object.assign(new Error((data.error && (data.error.message || data.error.type)) || `HTTP ${res.status}`), { status: res.status });
  if (data.stop_reason === 'max_tokens') throw new Error('The answer was cut off');
  const out = (data.content || []).map(c => c.text || '').join('');
  let plan;
  try { plan = JSON.parse(out.replace(/```json|```/g, '').trim()); } catch (e) { throw new Error('The answer was not readable'); }
  return cleanTreatmentPlan(plan);
}

// Only what the card and the quote can use, in the shapes they expect.
function cleanTreatmentPlan(p) {
  if (!p || typeof p !== 'object') throw new Error('The answer was not readable');
  // A report field name that slips into the text, like "(slabEdge
  // OBSTRUCTED, zone75mmVisible NO)", comes out.
  const tidy = t => t.replace(/\s*\((?=[^)]*\b[a-z]+[A-Z]\w*)[^)]*\)/g, '').trim();
  const str = v => (typeof v === 'string' ? tidy(v.trim()) : '');
  const list = v => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
  const systems = Object.keys(QUOTE_SYSTEM_LABELS);
  const kd = p.knockdown && typeof p.knockdown === 'object' ? p.knockdown : {};
  const client = p.client && typeof p.client === 'object' ? p.client : {};
  const vs = p.versus && typeof p.versus === 'object' ? p.versus : {};
  return {
    summary: str(p.summary),
    system: systems.includes(p.system) ? p.system : 'none',
    versus: { agree: list(vs.agree).slice(0, 3), add: list(vs.add).slice(0, 3), change: list(vs.change).slice(0, 3) },
    scope: (Array.isArray(p.scope) ? p.scope : []).filter(x => x && str(x.do)).slice(0, 8)
      .map(x => ({ do: str(x.do), who: x.who in TP_WHO ? x.who : 'us' })),
    // Plans from before the three lists said it in one line.
    versusInspector: str(p.versusInspector),
    knockdown: { needed: kd.needed === true, short: str(kd.short), method: str(kd.method), where: list(kd.where), why: str(kd.why) },
    systemWhy: list(p.systemWhy),
    notChosen: (Array.isArray(p.notChosen) ? p.notChosen : []).filter(n => n && systems.includes(n.system) && str(n.why))
      .map(n => ({ system: n.system, why: str(n.why) })),
    fixes: (Array.isArray(p.fixes) ? p.fixes : []).filter(f => f && str(f.what)).map(f => ({ what: str(f.what), who: str(f.who), why: str(f.why) })),
    followUp: str(p.followUp),
    unknowns: list(p.unknowns),
    client: { why: str(client.why), we: list(client.we), owner: list(client.owner), time: str(client.time), service: str(client.service), inspections: str(client.inspections) },
    lines: (Array.isArray(p.lines) ? p.lines : []).filter(l => l && l.key in QUOTE_CATALOGUE && l.key !== 'custom' && l.key !== 'treatment')
      .map(l => ({ key: l.key, qty: typeof l.qty === 'number' && isFinite(l.qty) && l.qty > 0 ? l.qty : null, detail: str(l.detail), why: str(l.why) })),
  };
}

// The lines each long-term system needs on the quote.
const TP_SYSTEM_LINES = { bait: ['bait_install'], barrier: ['barrier_lm', 'barrier_job'], retic: ['retic_lm'], physical: ['physical_lm'], system: ['system_topup'] };

// SAYON's own checks on the answer, added to "Check before you send" rather
// than changing the plan: a system named with no line to quote it (which
// can be right, say another company's system under its warranty), live
// termites with no line to treat them, or lines for two systems at once.
function checkTreatmentPlan(plan, rd) {
  const keys = plan.lines.map(l => l.key);
  const notes = [];
  const want = TP_SYSTEM_LINES[plan.system];
  if (want && !want.some(k => keys.includes(k))) notes.push(`The plan picks ${TP_SYSTEM_LABELS[plan.system].toLowerCase()} but gives no line to quote it. Add one if you're doing that work.`);
  const live = (Array.isArray(rd && rd.findings) ? rd.findings : []).filter(f => f && f.termiteActivity === 'ACTIVE').length;
  if (live && !keys.includes('direct') && !keys.includes('nest')) notes.push('Live termites were found but the plan has no line to treat them. Check the knockdown is quoted.');
  const systems = Object.keys(TP_SYSTEM_LINES).filter(s => TP_SYSTEM_LINES[s].some(k => keys.includes(k)));
  if (systems.length > 1) notes.push(`The lines quote more than one system (${systems.map(s => TP_SYSTEM_LABELS[s].toLowerCase()).join(' and ')}). Keep both only if you mean to do both.`);
  if (plan.lines.some(l => l.qty == null)) notes.push('Some lines have no quantity from your notes, so they start at a usual amount. Check them before sending.');
  plan.checks = notes;
  return plan;
}

// A line with no quantity said starts where the report-built quote would
// (12 stations, 40 metres), marked to check.
function tpStartQty(key) {
  if (key === 'bait_install') return 12;
  if (/_lm$/.test(key)) return 40;
  return 1;
}

// A draft quote that moves to its report's new id (adoptDraftQuote) takes
// a plan being worked out with it.
const treatmentPlanMoved = {};
function tpKey(k) { while (treatmentPlanMoved[k]) k = treatmentPlanMoved[k]; return k; }
function moveTreatmentPlanKey(from, to) {
  treatmentPlanMoved[from] = to;
  if (treatmentPlanRuns[from]) { treatmentPlanRuns[to] = true; delete treatmentPlanRuns[from]; }
  if (from in treatmentPlanWaiting) { treatmentPlanWaiting[to] = treatmentPlanWaiting[from]; delete treatmentPlanWaiting[from]; }
}

// Stores the plan's state on the quote it belongs to, whether or not that
// quote is still open.
function setTreatmentPlanState(reportKey, ai) {
  reportKey = tpKey(reportKey);
  if (quoteState && quoteState.reportKey === reportKey) {
    quoteState.aiPlan = ai;
    persistQuote();
    renderTreatmentPlanCard();
    return;
  }
  const all = readJSON(quotesStorageKey(), {});
  const q = all[reportKey];
  if (!q) return;
  q.aiPlan = ai;
  try { localStorage.setItem(quotesStorageKey(), JSON.stringify(all)); } catch (e) { return; }
  storeQuoteOnReport(q, false);
}

async function runTreatmentPlan(extra) {
  const q = quoteState;
  const rd = quotePlanReport();
  if (!q || !rd || treatmentPlanRuns[q.reportKey]) return;
  const key = q.reportKey;
  const prev = q.aiPlan || {};
  const hash = treatmentPlanHash(rd, q.address);
  const techQuote = treatmentPlanTechQuote(q);
  const quoteHash = treatmentPlanQuoteHash(q);
  const started = Date.now();
  treatmentPlanRuns[key] = true;
  delete treatmentPlanWaiting[key];
  if (q.aiPlan) q.aiPlan.error = '';
  renderTreatmentPlanCard();
  try {
    const plan = checkTreatmentPlan(await requestTreatmentPlan(rd, q.address, extra, techQuote), rd);
    track('treatment_plan_made', { seconds: Math.round((Date.now() - started) / 1000), system: plan.system, compared: !!techQuote });
    delete treatmentPlanRuns[tpKey(key)];
    tpCardOpen.add(tpKey(key));
    setTreatmentPlanState(key, { plan, hash, quoteHash, compared: !!techQuote, at: Date.now(), extra: extra || '', applied: false, before: null });
  } catch (err) {
    if (err.noSignal && !(prev && prev.plan)) {
      delete treatmentPlanRuns[tpKey(key)];
      treatmentPlanWaiting[tpKey(key)] = extra || '';
      if (quoteState && quoteState.reportKey === tpKey(key)) renderTreatmentPlanCard();
      return;
    }
    const why = err.noSignal ? 'No signal. Try again when you\'re back online.'
      : err.status === 402 ? 'Your plan has ended, so SAYON can\'t work out a plan.'
      : err.status === 429 ? 'You\'ve used this month\'s AI allowance.'
      : `SAYON couldn't work out a plan (${err.message}).`;
    track('treatment_plan_failed', { reason: err.noSignal ? 'no_signal' : err.status ? 'http_' + err.status : 'other' });
    delete treatmentPlanRuns[tpKey(key)];
    setTreatmentPlanState(key, Object.assign({}, prev, { error: why }));
  } finally {
    delete treatmentPlanRuns[tpKey(key)];
  }
}

window.addEventListener('online', () => {
  const q = quoteState;
  if (q && q.reportKey in treatmentPlanWaiting && document.getElementById('quoteScreen').classList.contains('open')) {
    runTreatmentPlan(treatmentPlanWaiting[q.reportKey]);
  }
});

function askTreatmentPlanAgain() {
  const box = document.getElementById('tpExtra');
  runTreatmentPlan(box ? box.value : ((quoteState && quoteState.aiPlan && quoteState.aiPlan.extra) || ''));
}

// From the report's Recommendations: open the quote at the plan, and work
// it out if there isn't one yet (the inspector asked, so even a report with
// nothing found gets one).
function openTreatmentPlanFromReport() {
  openQuoteFromReport();
  const q = quoteState;
  if (q && !q.aiPlan && !treatmentPlanRuns[q.reportKey] && !isQuoteLocked()) {
    if (navigator.onLine) runTreatmentPlan(''); else { treatmentPlanWaiting[q.reportKey] = ''; renderTreatmentPlanCard(); }
  } else if (q && q.aiPlan) showTreatmentPlan();
  const card = document.getElementById('quoteAiPlan');
  if (card) setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}

// ── USING THE PLAN ──
const TP_REPORT_SOURCE = /^(Finding|Recommendation|Conducive condition)/;

function planChoice(value, options) {
  const v = (value || '').trim();
  return options.find(o => o.toLowerCase() === v.toLowerCase()) || v;
}

function useTreatmentPlan() {
  const q = quoteState;
  const ai = q && q.aiPlan;
  if (!ai || !ai.plan || isQuoteLocked()) return;
  const p = ai.plan;
  const before = { items: q.items, plan: q.plan || null, systemChoice: q.systemChoice || null };
  // Lines the inspector dictated with their prices stay as said; lines the
  // inspector added by hand stay too. Lines guessed from the report make
  // way for the plan's.
  const spoken = q.items.some(it => it.source === 'Said in a voice note');
  if (!spoken && p.lines.length) {
    const own = q.items.filter(it => !TP_REPORT_SOURCE.test(it.source || '') && !/^SAYON plan/.test(it.source || ''));
    const fresh = p.lines.map(l => newQuoteItem(l.key, {
      detail: l.detail,
      qty: l.qty != null ? l.qty : tpStartQty(l.key),
      source: 'SAYON plan' + (l.qty == null ? ' (quantity to check)' : ''),
    }));
    q.items = fresh.concat(own);
    q.systemChoice = null;
  }
  const c = p.client;
  const plan = Object.assign({}, q.plan || { we: '', owner: '', time: '', service: '', inspections: '' });
  if (c.why) plan.why = c.why;
  if (c.we.length) plan.we = c.we.join('\n');
  if (c.owner.length) plan.owner = c.owner.join('\n');
  if (c.time) plan.time = planChoice(c.time, QUOTE_PLAN_TIMES);
  if (c.service) plan.service = planChoice(c.service, QUOTE_PLAN_SERVICE);
  if (c.inspections) plan.inspections = c.inspections;
  q.plan = plan;
  ai.applied = true;
  ai.keptLines = spoken;
  ai.before = before;
  quoteOpenItems.clear();
  renderQuoteItems();
  renderQuotePlan();
  renderTreatmentPlanCard();
  scheduleQuoteSave();
  track('treatment_plan_used', { system: p.system });
  showToast(spoken ? 'Added to the quote. Your spoken quote lines are kept as you said them' : 'Added to the quote. Check the lines and prices', 'success');
}

function undoTreatmentPlan() {
  const q = quoteState;
  const ai = q && q.aiPlan;
  if (!ai || !ai.applied || !ai.before || isQuoteLocked()) return;
  q.items = ai.before.items;
  q.plan = ai.before.plan || undefined;
  if (!q.plan) delete q.plan;
  q.systemChoice = ai.before.systemChoice;
  ai.applied = false;
  ai.before = null;
  quoteOpenItems.clear();
  renderQuoteItems();
  renderQuotePlan();
  renderTreatmentPlanCard();
  scheduleQuoteSave();
}

function showTreatmentPlan() {
  const q = quoteState;
  if (!q) return;
  if (!q.aiPlan) { runTreatmentPlan(''); return; }
  tpCardOpen.add(q.reportKey);
  renderTreatmentPlanCard();
}


// ── THE CARD ──
// 'none' on the quote's picker means "termites only"; in a plan it can also
// mean the system already there is still doing its job.
const TP_SYSTEM_LABELS = Object.assign({}, QUOTE_SYSTEM_LABELS, { none: 'No new system' });
// The who tags in the terms a scope of works uses: the pest business is the
// contractor; 'us' and 'owner' stay as stored keys.
const TP_WHO = { us: 'Contractor', owner: 'Property owner', plumber: 'Plumber', builder: 'Builder', arborist: 'Arborist', electrician: 'Electrician' };

function tpList(items, cls) {
  return items.length ? `<ul class="tp-list${cls ? ' ' + cls : ''}">${items.map(t => `<li>${t}</li>`).join('')}</ul>` : '';
}

// The suggestion in folded sections, each with a one-line heading, so it
// reads at a glance and opens where the inspector wants detail. Which
// sections are open is kept while the card is redrawn.
const tpOpenSections = new Set();
function tpToggleSection(el) {
  if (el.open) tpOpenSections.add(el.dataset.sec); else tpOpenSections.delete(el.dataset.sec);
}

// The whole suggestion folds to one row: the title and a one-line count.
// Folded when the quote opens; it opens by itself when an answer the
// inspector asked for comes back, and stays as they left it while the card
// is redrawn. Kept by quote (report key) for this visit only.
const tpCardOpen = new Set();
function tpToggleCard(el) {
  const k = quoteState && quoteState.reportKey;
  if (!k) return;
  if (el.open) tpCardOpen.add(k); else tpCardOpen.delete(k);
}

function tpSection(key, mark, title, sub, body, cls) {
  if (!body) return '';
  return `<details class="tp-sec${cls ? ' ' + cls : ''}" data-sec="${key}"${tpOpenSections.has(key) ? ' open' : ''} ontoggle="tpToggleSection(this)">
    <summary><span class="tp-sec-mark">${mark}</span><span class="tp-sec-text"><span class="tp-sec-title">${title}</span>${sub ? `<span class="tp-sec-sub">${sub}</span>` : ''}</span>
      <svg class="icon tp-sec-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary>
    <div class="tp-sec-body">${body}</div></details>`;
}

// The scope of works: every action in order, each with who does it. Plans
// from before the scope was asked for get one built from their parts.
function tpScope(p) {
  if (p.scope && p.scope.length) return p.scope;
  const out = [];
  const kd = p.knockdown || {};
  if (kd.needed && (kd.short || kd.method)) out.push({ do: kd.short || kd.method, who: 'us' });
  if (p.system && p.system !== 'none') out.push({ do: TP_SYSTEM_LABELS[p.system] || p.system, who: 'us' });
  (p.fixes || []).forEach(f => out.push({ do: f.what, who: f.who in TP_WHO ? f.who : 'us' }));
  if (p.client && p.client.inspections) out.push({ do: 'Inspect again: ' + p.client.inspections, who: 'us' });
  return out;
}

function tpWhoTag(who) {
  return `<span class="tp-who tp-who-${who === 'us' || who === 'owner' ? who : 'trade'}">${escapeHtml(TP_WHO[who] || who)}</span>`;
}

// The suggestion as one scope of works the inspector reads at a glance,
// with the reasons, the questions and the quote lines folded below it.
function treatmentPlanBodyHTML(ai) {
  const p = ai.plan;
  const e = escapeHtml;
  const kd = p.knockdown;
  const scope = tpScope(p);
  const checks = p.unknowns.map(e).concat((p.checks || []).map(t => `<span class="tp-own-check">${e(t)}</span>`));
  const lines = p.lines.map(l => {
    const cat = QUOTE_CATALOGUE[l.key] || {};
    const n = l.qty != null ? l.qty : tpStartQty(l.key);
    const qty = `${n} ${pluralUnit(cat.unit, n)}${l.qty == null ? ', to check' : ''}`;
    return `<li><span class="tp-line-desc">${e(cat.desc || l.key)}${l.detail ? ` <span class="tp-dim">· ${e(l.detail)}</span>` : ''}</span><span class="tp-line-qty${l.qty == null ? ' warn' : ''}">${e(qty)}</span></li>`;
  }).join('');
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const sysLabel = TP_SYSTEM_LABELS[p.system] || p.system;
  const whySub = sysLabel + (p.notChosen.length ? ' over ' + p.notChosen.map(x => (TP_SYSTEM_LABELS[x.system] || x.system).toLowerCase()).join(', ') : '');
  // One short line per point: the scope already says what each step is.
  const why = [
    kd.needed ? `<div class="tp-sub">Active termites</div><div class="tp-text">${e(kd.method || kd.short)}${kd.where.length ? ` <span class="tp-dim">· ${e(kd.where.join('; '))}</span>` : ''}</div>` : '',
    p.systemWhy.length ? `<div class="tp-sub">${e(sysLabel)}</div>${tpList(p.systemWhy.map(e))}` : '',
    p.notChosen.length ? `<div class="tp-sub">Alternatives considered</div>${tpList(p.notChosen.map(x => `<strong>${e(TP_SYSTEM_LABELS[x.system] || x.system)}:</strong> ${e(x.why)}`), 'tp-why-not')}` : '',
    p.followUp ? `<div class="tp-sub">Follow-up</div><div class="tp-text">${e(p.followUp)}</div>` : '',
  ].join('');
  return `${scope.length ? `<div class="tp-scope"><div class="tp-scope-head"><span class="tp-scope-label">Scope of works</span><span class="tp-scope-count">${plural(scope.length, 'step', 'steps')}</span></div>
      <ol class="tp-scope-list">${scope.map((x, i) => `<li><span class="tp-scope-n">${i + 1}</span><span class="tp-scope-do">${e(x.do)}</span>${tpWhoTag(x.who)}</li>`).join('')}</ol></div>` : ''}
    <div class="tp-secs">
    ${tpSection('check', '!', 'Items to confirm', plural(checks.length, 'item', 'items') + ' before quoting', tpList(checks), 'tp-sec-warn')}
    ${tpSection('why', '?', 'Rationale', e(whySub), why)}
    ${lines || p.client.why ? tpSection('quote', '$', 'Quote items', lines ? plural(p.lines.length, 'item', 'items') + ' at your rates' : 'Client summary',
      `${lines ? `<ul class="tp-lines">${lines}</ul>` : ''}
       ${p.client.why ? `<div class="tp-sub">Client summary</div><div class="tp-text tp-client">${e(p.client.why)}</div>` : ''}`) : ''}
  </div>`;
}

// Compared with your quote: what SAYON would do differently first, then what it
// would add, then where it agrees, one short line each.
const TP_VS_ICONS = {
  change: '<path d="M7 7h12l-4-4"/><path d="M17 17H5l4 4"/>',
  add: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  agree: '<path d="M20 6 9 17l-5-5"/>',
};
const TP_VS_WORDS = { change: 'Change', add: 'Add', agree: 'Agreed' };

// The comparison's one-line count, also shown on the folded card.
function tpVersusTally(p) {
  const vs = p.versus || { agree: [], add: [], change: [] };
  if (!vs.change.length && !vs.add.length) return vs.agree.length ? 'Agrees with your quote' : '';
  const n = (k, one, many) => vs[k].length ? `${vs[k].length} ${vs[k].length === 1 ? one : many}` : '';
  return [n('change', 'change', 'changes'), n('add', 'addition', 'additions'), n('agree', 'agreed', 'agreed')].filter(Boolean).join(' · ');
}

function tpVersusHTML(ai, q) {
  const p = ai.plan;
  const e = escapeHtml;
  const vs = p.versus || { agree: [], add: [], change: [] };
  const row = (k, t) => `<li class="tp-vs-${k}"><span class="tp-vs-icon" aria-hidden="true"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${TP_VS_ICONS[k]}</svg></span><span class="tp-vs-text"><span class="tp-vs-word">${TP_VS_WORDS[k]}</span>${t}</span></li>`;
  // Changes and additions one per row; what's the same on a single row.
  const rows = vs.change.map(t => row('change', e(t))).concat(vs.add.map(t => row('add', e(t))),
    vs.agree.length ? [row('agree', vs.agree.map(e).join(' <span class="tp-dim">·</span> '))] : []);
  if (rows.length) {
    // The count is on the card's heading, so it isn't repeated here.
    return `<div class="tp-vs"><div class="tp-vs-head"><span class="tp-vs-label">Compared with your quote</span></div><ul class="tp-vs-list">${rows.join('')}</ul></div>`;
  }
  if (p.versusInspector) return `<div class="tp-vs"><div class="tp-vs-head"><span class="tp-vs-label">Compared with your quote</span></div><div class="tp-text">${e(p.versusInspector)}</div></div>`;
  // Asked before there was anything of theirs on the quote.
  if (ai.compared === false && !ai.applied && !treatmentPlanTechQuote(q)) {
    return '<div class="tp-vs tp-vs-empty">Nothing of yours to compare yet. Add your own lines to the quote, then ask again for a comparison.</div>';
  }
  return '';
}

const TP_SPARK = '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>';

function renderTreatmentPlanCard() {
  const el = document.getElementById('quoteAiPlan');
  if (!el) return;
  const q = quoteState;
  const rd = quotePlanReport();
  const ai = q && q.aiPlan;
  const locked = isQuoteLocked();
  const busy = !!(q && treatmentPlanRuns[q.reportKey]);
  const waiting = !!(q && q.reportKey in treatmentPlanWaiting);
  // Nothing to plan for and nothing asked: no card.
  if (!q || (!ai && !busy && !waiting && (!reportNeedsPlan(rd) || locked))) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = '';
  const head = (title, sub, tag) => `<div class="tp-head"><span class="tp-mark" aria-hidden="true">${TP_SPARK}</span>
    <span class="tp-head-text"><span class="tp-title-row"><span class="tp-title">${title}</span>${tag ? `<span class="tp-tag">${tag}</span>` : ''}</span>${sub ? `<span class="tp-head-sub">${sub}</span>` : ''}</span></div>`;
  el.className = 'quote-card tp-card';

  // Not asked yet: the inspector works out their own plan, then asks.
  if (!ai && !busy && !waiting) {
    el.classList.add('tp-idle');
    el.innerHTML = `<div class="tp-idle-row">${head('Second opinion', 'Worked out your treatment? See what SAYON would do here.')}
      <button class="quote-link-btn tp-ask" onclick="runTreatmentPlan('')">Ask SAYON</button></div>`;
    return;
  }
  if (!ai && waiting && !busy) {
    el.innerHTML = `${head('Second opinion', 'No signal right now. SAYON will look at it when you\'re back online, while this quote is open.')}
      <button class="quote-link-btn tp-ask" onclick="runTreatmentPlan(treatmentPlanWaiting[quoteState.reportKey] || '')">Try now</button>`;
    return;
  }
  if (!ai || (busy && !ai.plan)) {
    el.innerHTML = `${head('Second opinion', '')}<div class="tp-busy"><span class="tp-spinner"></span>SAYON is reading the report. About half a minute; you can keep working on the quote.</div>`;
    return;
  }
  if (!ai.plan) {
    el.innerHTML = `${head('Second opinion', '')}<div class="tp-error">${escapeHtml(ai.error || 'No suggestion yet.')}</div>
      <button class="quote-link-btn tp-ask" onclick="runTreatmentPlan('')">Try again</button>`;
    return;
  }
  const p = ai.plan;
  const reportChanged = rd && ai.hash && treatmentPlanHash(rd, q.address) !== ai.hash;
  // Their quote changed after SAYON compared it (only before Add to my
  // quote, which changes it on purpose).
  const quoteChanged = !ai.applied && ai.quoteHash && treatmentPlanQuoteHash(q) !== ai.quoteHash;
  const stale = reportChanged || quoteChanged;
  if (ai.applied) el.classList.add('tp-applied');
  const steps = tpScope(p).length;
  const gist = [stale ? '<span class="tp-gist-warn">Out of date</span>' : '',
    escapeHtml(tpVersusTally(p) || TP_SYSTEM_LABELS[p.system] || ''),
    steps ? `${steps} ${steps === 1 ? 'step' : 'steps'}` : ''].filter(Boolean).join(' · ');
  el.innerHTML = `<details class="tp-wrap"${tpCardOpen.has(q.reportKey) ? ' open' : ''} ontoggle="tpToggleCard(this)">
    <summary class="tp-wrap-sum">${head('SAYON recommendation', gist, ai.applied ? 'In the quote' : 'Guide only')}
      <svg class="icon tp-wrap-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary>
    <div class="tp-wrap-body">
    ${p.summary ? `<div class="tp-summary">${escapeHtml(p.summary)}</div>` : ''}
    ${tpVersusHTML(ai, q)}
    ${stale ? `<div class="tp-stale">${reportChanged && quoteChanged ? 'The report and your quote have' : reportChanged ? 'The report has' : 'Your quote has'} changed since SAYON looked at it.</div>` : ''}
    ${ai.error ? `<div class="tp-error">${escapeHtml(ai.error)}</div>` : ''}
    ${treatmentPlanBodyHTML(ai)}
    <div class="tp-actions">
      ${busy ? '<div class="tp-busy"><span class="tp-spinner"></span>Looking at it again…</div>' : ai.applied
        ? (locked ? '' : '<span class="tp-status">Edit it under Treatment plan and the work lines.</span><button class="quote-text-btn" onclick="undoTreatmentPlan()">Undo</button>')
        : locked ? '' : '<button class="quote-btn tp-use" onclick="useTreatmentPlan()">Add to my quote</button>'}
    </div>
    ${busy || locked || ai.applied ? '' : `<details class="tp-again"${stale ? ' open' : ''}><summary>Ask again${stale ? ' with the changes' : ' with a note'}</summary>
      <div class="tp-again-hint">SAYON works the whole plan out again from the report, your quote and this note. Add a fact it didn't have or a different direction. It doesn't answer questions.</div>
      <textarea class="quote-input quote-textarea" id="tpExtra" rows="2" placeholder="e.g. owner wants no chemicals; quote a barrier instead; nest found in the gum tree">${escapeHtml(ai.extra || '')}</textarea>
      <button class="quote-btn" onclick="askTreatmentPlanAgain()">Ask again</button></details>`}
    <div class="tp-foot">Guide only, based on your report. The final call is yours.</div>
    </div></details>`;
}
