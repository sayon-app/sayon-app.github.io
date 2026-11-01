# Baseline scores

The prompt as it stood when the bench was added: `SYSTEM_PROMPT` in `js/app.js` at `e15f1f0` (2026-10-05, the same prompt that is live in `korva-v51`).

- Runner: Sonnet subagents given exactly the `eval-workflow.js` extract prompt (one agent per run, `out/baseline/`), standing in for the app's `claude-sonnet-5`. Treat it as a proxy, not the production number.
- 3 runs per case, scored with `score.mjs` against the keys in `gold/`.
- Mean = total weighted points over total possible across the runs. "Weight-3 fails" counts CRITICAL checks failed in each run.

| Case | Runs | Mean | Per run | Weight-3 fails per run |
|---|---|---|---|---|
| house-test-1 | 3 | 91.4% (384/420) | 94%, 90%, 91% | 2, 3, 3 |
| house-test-2 | 3 | 93.3% (417/447) | 94%, 91%, 95% | 1, 2, 1 |

The same prompt on the five written cases added on 2026-10-06 (tag `baseline-new`, run from a worktree of `origin/main` at `53d2aa7` with the new cases copied in):

| Case | Runs | Mean | Per run | Weight-3 fails per run |
|---|---|---|---|---|
| slab-barrier | 3 | 95.2% (277/291) | 94%, 96%, 96% | 0, 0, 0 |
| skirting-active | 3 | 98.1% (303/309) | 98%, 98%, 98% | 0, 0, 0 |
| subfloor-followup | 3 | 96.3% (312/324) | 96%, 96%, 96% | 1, 1, 1 |
| borers-rot | 3 | 96.9% (282/291) | 97%, 97%, 97% | 1, 1, 1 |
| rambling-nest | 3 | 88.9% (264/297) | 89%, 89%, 89% | 3, 3, 3 |

Checks the old prompt failed on them: `slab-barrier` existing-system-other-brand 0/3 (the key is new), no-obstructions 0/3, no-hindered-areas 2/3; `skirting-active` hindered-roof-only 0/3 (listed the exterior as a restricted area); `subfloor-followup` findings-count-zero 0/3 (a NONE card for one clean area), moisture-readings-empty 0/3; `borers-rot` no-hindered-areas 0/3 (every inspected area written into the restricted-areas row); `rambling-nest` finding-damage-nest-hedged 0/3 and finding-nest-not-located 0/3 (a "possible nest" became nestLocated YES), treatment-type-stump 0/3 and treatment-type-no-product 0/3 (the "Chemical Barrier Treatment" fallback replaced the stump colony).

House test 2 leaked into the prompt (its mishearings were added to the homophone list after the test), so it flatters the prompt. See `docs/handover/extraction.md` section 6.

## Checks that failed at least once

Most weight-3 failures are where the keys depart on purpose from the literal prompt (`docs/handover/extraction.md` section 6): what `hinderedAreas` holds, the "Chemical Barrier Treatment" fallback, and the "possible nest" hedge.

**house-test-1**

| Check | Weight | Passed | What the answers did |
|---|---|---|---|
| hindered-areas-not-every-area | 3 | 0/3 | Listed every inspected area, as the schema's "readily accessible areas inspected" asks; the PDF prints it as restricted areas |
| treatment-no-method-words | 3 | 0/3 | "Chemical Barrier Treatment" (the prompt's fallback) for a tree colony whose treatment was left to the client |
| subfloor-finding | 3 | 1/3 | Kept the filler "Wall" as a location ("activity at the wall, joists and bearers") |
| highrisk-rear-subfloor | 2 | 0/3 | Left the obstructed back of the subfloor out of high-risk areas |
| treatment-targets-tree | 2 | 0/3 | Treatment text didn't name the tree |
| moisture-row-back-room | 2 | 1/3 | Dropped the reading taken in the back room (no value was said) |
| risk-high | 2 | 2/3 | MEDIUM once |

**house-test-2**

| Check | Weight | Passed | What the answers did |
|---|---|---|---|
| finding-tree | 3 | 0/3 | Dropped the "possible nest" hedge (nestLocated YES with no "possible" in the text), so the PDF says a nest was found |
| finding-subfloor | 3 | 2/3 | Lost "no damage visible" once |
| restrictions-said | 2 | 0/3 | Put the backyard tree in `hinderedAreas` and missed the low clearance and furniture |
| restricted-access | 2 | 0/3 | Wrote "blocking access" / "side access door" in the subfloor phrase, which makes the app tick "No access to subfloor" |
| restricted-access-matcher-words | 1 | 0/3 | Didn't use the reason words the app's matcher ticks ("stored articles", "furniture") |
| treatment-type | 2 | 2/3 | Missed the tree or the system install once |
| no-zone-75 | 1 | 2/3 | Filled a verification field with no system present |

## After the rewrite (2026-10-06)

`SYSTEM_PROMPT` as rewritten on branch `claude/voice-extraction-rdusm7` (revision 2; revision 1 differed only in the riskLevel paragraph and rated `borers-rot` HIGH in one of three runs). Same runner, 3 runs per case, tag `rev2`.

| Case | Before: mean (weight-3 fails per run) | After: mean (weight-3 fails per run) |
|---|---|---|
| house-test-1 | 91.4% (2, 3, 3) | 100% (0, 0, 0) |
| house-test-2 (leaked into the prompt; reported, not tuned for) | 93.3% (1, 2, 1) | 100% (0, 0, 0) |
| slab-barrier | 95.2% (0, 0, 0) | 100% (0, 0, 0) |
| skirting-active | 98.1% (0, 0, 0) | 100% (0, 0, 0) |
| subfloor-followup | 96.3% (1, 1, 1) | 99.1% (0, 0, 0): only the weight-1 "moistureReadings empty preferred" check fails, the answer is NO for a reading called normal |
| borers-rot | 96.9% (1, 1, 1) | 100% (0, 0, 0) |
| rambling-nest | 88.9% (3, 3, 3) | 100% (0, 0, 0) |

Pass bar (every weight-3 check in 3 of 3 runs on house test 1 and the five written cases; no case's mean below its baseline): met. Every answer was valid JSON. No key was changed to make a run pass; the only key edits after drafting were made before any run (`risk-low-or-medium` on `slab-barrier` and `borers-rot` also accepts empty, because the inspector didn't state a risk; `no-hindered-areas` on `slab-barrier` lowered to weight 2; the "east" substring checks on `rambling-nest` narrowed to "eastern"/"east side" so "least" can't trip them).

## 2026-10-30: first run on the real API

Runner: `run-api.mjs` against `claude-sonnet-5` at effort medium (exactly what the app sends), 2 runs per case, all 14 cases. Tags `base`, `v1`, `v2` in `out/`.

**Answer keys brought up to date first.** Several keys predated prompt changes the owner had already made, so they failed answers that follow today's prompt:
- "No System Found" (2026-10-27): `no-existing-system` / `existing-system-empty` / `no-system` on borers-rot, car-test-clean, car-test-full, house-test-1, phone-full-job and skirting-active now accept "No System Found" or empty, like the newer house-test-2 and rambling-nest keys already did.
- What / Where split (2026-10-25): `decay-details` (borers-rot) and `delig-where` (fence-workings) now read `decayWhere` / `delignificationWhere`; `previous-treatment-details` (drainage-treatment) is split into a details check and a `previousTreatmentWhere` check.
- `moisture-readings-empty` (subfloor-followup) accepts "NO", which the prompt asks for when a reading is called normal.
- `restricted-access-matcher-words` (house-test-2) accepts the current "Stored items" label as well as the old "stored articles".

| Prompt | Mean, all 14 cases | Checks failing at least once |
|---|---|---|
| Before (old keys) | 97.1% (2024/2084) | 18, mostly the stale keys above |
| Before (updated keys) | 99.3% (2070/2084) | timber-soil-no (borers-rot), risk-high (house-test-1, null once), restricted-access ×3 (house-test-2, skirting-active), no-zone-75 (house-test-2), leak-location (phone-full-job) |
| v1: five prompt rules | 99.8% (2080/2084) | restricted-access-matcher-words (house-test-2, the stale label), interior (locked-bedroom) |
| v2: v1 + locked room makes interior PARTIAL | 99.7% (1975/1981) | one-offs: soft-landscaping (car-test-full), restricted-access (house-test-2), roofvoid (locked-bedroom) |

v2 is missing skirting-active run 2: the API credit ran out mid-round. No weight-3 check failed in v1 or v2. The v2 one-offs each passed in the other run and in v1, so they look like run-to-run noise, not a rule the prompt gets wrong.

### Round 2 (same day, after more credit)

| Prompt | Mean, all 14 cases | Checks failing at least once |
|---|---|---|
| v3: v2 re-run complete (what #247 merged) | 99.8% (2080/2084) | restricted-access + matcher words (house-test-2, null once), roofvoid (locked-bedroom, INSPECTED once) |
| v4: restrictedAccess never null when an area is PARTIAL or NOT; a limit said right after "inspected" still makes the area PARTIAL | 99.9% (2082/2084) | subfloor-finding-detail (house-test-2, once) |

The two v3 failures were the same ones v2 had, so they were a real gap, not noise; v4 fixes both. No weight-3 check failed in either round.

## 2026-10-30/31: 14 more cases, pushing toward a sellable standard

Two agents each wrote seven new cases independently (different trades and edge cases: borers-only, a leaking shower with decay, an existing baiting system, treated old damage, a tenant refusing access, a genus-only termite ID, an obstructed slab edge; and a highset Queenslander, a strata townhouse, a rural block with sheds and a paddock mound, dictation given out of order, corrected numbers, an all-clear inspection, and a wet-weather partial). Real run-on dictation, mishearings, self-corrections, invented addresses. 1291 points across 597 checks.

All 14 original cases were also re-run on the current prompt (2 runs each): every case scored 100% except `car-test-full`, which missed one weight-2 check (`soft-landscaping`) in one of two runs — the same single-run flicker noted before, not chased further.

Of the 14 new cases, 12 scored 100% on both runs straight away. Two needed work:

- **A garden bed, paving or soil covering the slab edge or weep holes was sometimes logged as an obstruction** (`obstructions`, `hinderedAreas`, `highRiskAreas`) instead of a conducive condition (`slabEdge`, `weepHoles`, `softLandscaping`/`hardLandscaping`, `zone75mmVisible`/`zone25mmVisible`), even though the inspector walked and saw that stretch of the exterior fully. Seen in `townhouse-strata` (1 of 2 runs) and `backwards-order` (1 of 2 runs). Added one sentence to `SYSTEM_PROMPT` after the `highRiskAreas` rule making the distinction explicit (a cover that was seen and assessed is not an obstruction). Re-ran all three affected cases (`townhouse-strata`, `backwards-order`, `clear-but-conducive`, which had the same category of exterior-field slip) twice each on the updated prompt: all six runs scored 100%.
- **`piers-paving-pool`'s `no-live-termites` check was a false positive**, not a model problem: the correct, prompt-compliant answer legitimately contains the substring "live termites" inside "no live termites moving" (from the transcript's own words), and `termiteActivity` was already correctly `INACTIVE` with a separate `findingMatch` check covering that. Deleted the redundant text check.
- `deck-schedorhinotermes` had three test-writing bugs, not prompt bugs, now fixed: three `findingMatch` checks all needed to match the same one or two findings, which the scorer's "each finding used once" rule can't do (merged them into the deck and pergola `findingMatch` checks); `nestLocated` was required to be empty for a hedged "probably in the retaining wall... I didn't locate a nest", but the transcript's explicit "I didn't locate a nest" is exactly what the prompt's own rule calls `NO` (now accepts `NO` or null); and a subfloor status of `NA` was expected on a slab-on-ground house where the note never raises the subfloor, when the prompt says to leave an unmentioned area out of `areaStatus` altogether (removed the check).

One known minor gap, not chased: `deck-schedorhinotermes`'s `nest-hedge-kept` (weight 1) — a hedged nest location not tied to any finding (the retaining wall itself is clear) doesn't reliably survive anywhere in `damageDescription`, failing 2 of 2 runs. Worth a look if it recurs in real reports.

No weight-3 check failed on the final runs of any of the 28 cases (14 old + 14 new).

## 2026-11-01: overnight run, 8 new cases, six prompt rules

Runner: `run-api.mjs` on the real API (`claude-sonnet-5`, effort medium), tags `night0`–`night4` in `out/`. About 90 calls in all, roughly 1.39M tokens in and 0.30M out: about $9 at $3 / $15 per million tokens.

**Two keys fixed before scoring** (both failed a correct answer):
- `old-damage-treated`: `no-live-termites` and `finding-damage-what-seen` tripped on the inspector's own "no live termites". `score.mjs` now takes `negationOk: true` on a check, which ignores a banned term straight after "no", "not", "without" or "nil"; both checks use it.
- `piers-paving-pool`: `finding-damage-tubes` didn't accept "shelter tubing".

**Baseline** (`night0`, the prompt as merged, 1 run per case, keys fixed): 26 of 28 cases at 100%. `house-test-2` 147/149 (the subfloor finding said only "No damage visible" and lost the "termite workings" that were seen) and `deck-schedorhinotermes` 75/76 (the known `nest-hedge-kept` gap).

**8 new cases** (`night1`, 2 runs each), written to probe what the bench didn't cover: three findings with one nest (`three-spots-nest`), every site and weather field (`site-conditions-tools`), heavy mishearings with a retracted system (`garbled-kordon`), one-area notes (`subfloor-all-clear`, `roofvoid-only`), structural verdicts, severity and species-based risk said out loud (`verdict-and-severity`), asides and chatter (`chatter-and-asides`), and negation traps (`negation-traps`). Six scored 100% on both runs. Two real gaps: `subfloor-all-clear` set `weepHoles` CLEAR from "vents are clear" (2 of 2; in the app that would overwrite an earlier "weep holes bridged"), and `negation-traps` marked the interior CLEAR although old borer holes were reported in a bedroom (2 of 2).

**Prompt changes** (all in `SYSTEM_PROMPT`):
1. damageDescription names the evidence seen (workings, mud leads, shelter tubes) and keeps "No damage visible" after it, never on its own.
2. A nest said to be "probably in the retaining wall" but not found: nestLocated NO, the hedge kept in a finding's damageDescription.
3. Subfloor vents are not weep holes (in both the weepHoles and subfloorVentilation rules).
4. "All clear" about termites doesn't outweigh borers, decay or delignification in the same area: still FOUND.
5. Not seeing the slab edge or 75 mm zone under a garden bed is the conducive condition, not an obstruction.
6. A return visit to finish unreached areas ("come back in two weeks when it's dry") goes in otherRecommendations, not inspectionFrequency.

**After** (`night2`, rules 1–4, all 36 cases, 1 run each plus a second run on the four cases the rules aimed at): 3151/3178 (99.2%). Fixed: `house-test-2` 100% on 2 of 2 (workings kept), `deck-schedorhinotermes` `nest-hedge-kept` now passes 2 of 2, `negation-traps` interior FOUND 1 of 2, `subfloor-all-clear` weep holes 1 of 2. One-off misses elsewhere: `townhouse-strata` (garden bed logged as an exterior obstruction, the 75 mm zone wording), `wet-day-partial` (the two-week return visit in inspectionFrequency, otherRecommendations empty), `deck-schedorhinotermes` (the model added "major and minor" for the two soldier sizes, which trips the severity check).

`night3`/`night4` (rules 5–6 added, only the cases they touch): `townhouse-strata` 100%, `negation-traps` 100%, `wet-day-partial` 98% (put the flooded rear subfloor in noAccessAreas instead of hinderedAreas once), `subfloor-all-clear` weep holes still wrong in 2 of 3 runs. The whole bench was not re-run on the final prompt (budget); rules 5 and 6 only touch the slab-edge cover and the re-inspection interval.

Still open: `subfloor-all-clear` weep holes (worth a code guard: ignore weepHoles from a note that only covers the subfloor), and soldier caste words ("major", "minor") reading as severity.
