# SAYON — guide for working on this repo

A voice-to-report PWA for Australian timber pest inspectors. The chain is: pre-inspection agreement → voice inspection report → quote → client's answer and signature → treatment record and certificate, each sent to the client. It is a static site on GitHub Pages: no build step and no framework. Plain HTML, CSS and JS that load in the browser.

**New to this repo, or starting a larger task? Read `docs/handover/README.md` first.** It covers the owner, what's live, the go-live recipe and the traps, and points to the rest.

Read only the files your task needs. The app's own code is split into 19 files in `js/app/` (140 to 1,900 lines each), so find the file and the section with `grep -rn "SECTION NAME" js/app/` and read that range instead of whole files.

## File map

| File | What's in it |
|---|---|
| `index.html` | Every screen and overlay: splash, sign-in, platform menu, report (sections 1–7 + sign-off), drawer menu pages, quote screen and sheets |
| `js/app/*.js` | The report app and everything shared, in 19 files (see below) |
| `js/quote.js` | Quote builder and the quote PDF. The quote screen is only the quote; the client's answer (its sheet and `quoteAnswerPanel`) is recorded from This job. THE JOB'S QUOTE (`useJobQuote`): while This job is open, `quoteState` is the job's saved quote, so the answer, treatment and bait sheets work there. THE CLIENT'S SIGNED COPY: a client who signed to accept is owed the signed quote by email (`signedQuoteOwed`), the job's next step until it's sent or the treatment is recorded |
| `js/price-book.js` | Your prices: the business's own price for every quote line, set in set-up and Menu › Your prices. Same store as the prices remembered from quotes (`quotePriceMemory`) |
| `js/photo-markup.js` | Mark up a report photo (circle, arrow, draw, label) from the photo viewer |
| `js/treatment.js` | Treatment record and the treatment certificate PDF, one for every job: a system left in place (barrier, bait stations, reticulation) has its own System installed row. NEW CONSTRUCTION: a new construction job's record also asks about the building and slab, how a physical system went in, the limits and the care lines (`t.build`), is kept on a quote made for the job with no lines (`newBuildRecordQuote`), and its certificate says AS 3660.1. Opened from This job, which shows the record line and the certificate card (`treatmentRecordLine`, `treatmentCertificateCard`). PHOTOS ON THE RECORD: photos of the work and of the durable notice (`t.photos`, kept in the photo store like a report's; `jobPhotos` in `js/app/photos.js` counts them as the job's for the tidy-up, sync, delete and backup) print on the certificate's Photos page, led by the report's front photo |
| `js/invoice.js` | The invoice: made from the accepted quote (`ensureInvoice`, kept on `q.taxInvoice`, never `q.invoice`, which old quotes still carry), the invoice PDF, emailed with the bank details set in Your prices › Getting paid (`invoicePayDetails`), then Mark paid. This job's Invoice step after the treatment (`invoicePanel`, `invoiceNext`); `dashboardJob` makes it the next step once the certificate has gone. Jobs treated before `INVOICE_FROM` don't get one |
| `js/bait.js` | Bait station visits after a baiting system goes in: the visit sheet, the client's visit report PDF, the job's due date. The visits card (`renderBaitBlock`) is This job's Bait station visits step |
| `js/safety.js` | The safety check before starting work on site: a card on This job before the work (the inspection, the treatment, a new build's installation, a bait visit, `safetyWorkFor`), its sheet (the eight questions, the hazards the SWMS doesn't cover with their control and a 5 × 5 risk score, permits, safe to start, signature) and its own PDF. Kept on `reportData.safetyChecks`, which isn't part of the report (`ISSUE_META_KEYS`) and isn't in the client's job PDF |
| `js/reinspection.js` | Re-inspections due: the Jobs screen's Due tab (each property whose next inspection is coming up or overdue, from the report date plus its interval, or the treatment record's date), the reminder email to the client, booking the new job in. A pre-purchase inspection says so (did they buy it?). Its marks (reminder sent, taken off the list) sync through the business's settings |
| `js/site-plan.js` | The drawn site plan: symbols, legend, the editor (drag corners and walls, turn to any angle, pinch to zoom), the plan card (`sitePlanCardHTML`), and the plan page on the treatment certificate and bait visit reports. It starts at the report (THE SITE PLAN IN THE REPORT: drawn on the Areas step if the inspector wants one, `reportData.sitePlan`, printed in Areas Inspected by `js/app/pdf.js`); a new treatment record starts from a copy and adds the treatment and stations (`q.treatment.plan`). `mode: 'report'` leaves the treatment's tabs out |
| `js/chemicals.js` | Chemical register (Menu › Chemical register): products, label and SDS links, each label use with its rate. The treatment record's product picker fills the active, rate and life from it. Once a week each APVMA No. is checked against the APVMA's list of registered products on data.gov.au, and a product that has dropped off is flagged. Each product says where its rates came from (`chemicalRatesNote`; move `CHEMICAL_RATES_CHECKED` when the starter rates are re-checked) |
| `js/job-pack.js` | Finalise, a job's one ending (This job, once its steps are done): locks the report and quote as a version and makes the job PDF, every document from the job joined behind a contents page (the agreement once: inside the report when there is one), each page stamped "Job file page N". The "Job finalised" card with Amend. Joins pages with pdf-lib (`js/vendor`) |
| `js/crash-guard.js` | Save on crash (an uncaught error saves everything still waiting at once), the "SAYON closed unexpectedly" notice after the page died on screen, and Menu › Report a problem, which sends to Supabase `problem_reports` (`supabase/problem-reports.sql`) or falls back to an email |
| `js/business-sync.js` | Syncs company details, quote prices and the Due list's marks to Supabase `businesses.settings` |
| `js/sample-job.js` | The sample job: a finished, made-up job (agreement to certificate) offered at the end of sign-up, on an empty Jobs list and in the menu. Built on the phone at the business's own prices; id `sample_job` (`isSampleJob` in `js/app/`) keeps it out of the account, Due list, backups and last visits, sends its emails to the business, and `stampSamplePdf` marks its PDFs SAMPLE |
| `css/app.css`, `css/quote.css` | Styles |
| `service-worker.js` | Offline cache. **Bump `CACHE_VERSION` (korva-vNN) whenever cached files change** |
| `worker/worker.js` | Cloudflare Worker `korva`: AI proxy, `/transcribe`, Stripe, `/send-email`. Pasted into Cloudflare by hand |
| `netlify.toml` | Netlify preview links only (`deploy-preview-N--sayon-preview.netlify.app`). Never the live site |
| `supabase/*.sql` | SQL baz applies in the Supabase SQL editor |
| `terms.html`, `privacy.html` | Legal pages |
| `docs/handover/` | Handover docs: start-here guide, current state, extraction and report-wording maps, a sample report PDF |
| `samples/` | The three sample PDFs the sign-in screen and the website link to. Remade with `docs/handover/samples/make-site-samples.js` whenever a client's PDF changes |
| `tests/extraction/` | Extraction test bench: real transcripts (made-up address), answer keys, scorer and runners |

## `js/app/` files (grep the banner text)

They are plain scripts, not modules: every top-level name is shared across all of them and the later files (`js/quote.js` and the rest). They load in the order `index.html` lists them, which is the order below: `common.js` first, then the order of the old single `js/app.js`. A top-level statement that runs while the page loads (not inside a function or an event handler) can only use names from its own file or an earlier one; a function called later can use anything. A new file goes in `index.html` and `service-worker.js`'s `APP_SHELL`.

| File | What's in it |
|---|---|
| `common.js` | SHARED HELPERS, loaded first: `AI_MODEL` (the one place the app names the model; the Worker's `ALLOWED_MODEL` must match), text (`escapeHtml`, `greetingName`, `lowerFirst`, `joinPlaces`), dates (`isoDate`, `todayIsoDate`, `formatLongDate`), money (`formatAUD`), `formatAddress`, the business's details (`getCompanyDetails`) and the pop-up message (`showToast`). A helper only one stage uses stays in that stage's file |
| `state.js` | STATE (shared `let`s such as `reportData`), set-up (three cards: the business's details, Your prices, You're ready), YOUR BUSINESS (the Business details menu page, `openBusinessForm`; opened from a check, it goes back to that check) |
| `areas.js` | Areas inspected, OBSTRUCTION ZONE SELECTOR, hindered and restricted access, ACCESS SPOTS and their photos (entered on the area's own card; Areas unable to be inspected reads them back) |
| `talk-photos.js` | PHOTOS WHILE TALKING |
| `species.js` | SPECIES INTELLIGENCE DATABASE (`SPECIES_DB`, `lookupSpecies`) |
| `prompts.js` | `SECTIONS`, `REQUIRED_FIELDS`, `SYSTEM_PROMPT`, the plate scan and insect ID prompts |
| `shell.js` | APP UPDATES, ADDRESS MOVE, SPLASH, PLATFORM NAVIGATION, keyboard access, BACK (phone back, Esc and the iPhone edge swipe go up one level), WHERE YOU WERE, ASK FIRST (`askFirst`: SAYON's own sheet for a question, in place of the browser's `confirm()` and `prompt()`; `input` puts a box on it, `no: null` leaves one button; `showLinkToCopy` shows a link to press and hold), SHEETS OPENED FROM A PAGE |
| `voice.js` | FIELD NOTES, NATIVE SPEECH RECOGNITION ADAPTER, VOICE, AI TRANSCRIPT CLEANUP, EXPERIMENTAL AUDIO CAPTURE, WHISPER LISTENING, LISTENING ON THE MOVE (while the mic listens the panel is one bar on the dock and the report behind still works; moving to another step fills what's been said, `fillOnTheMove`; Lock for your pocket is the inspector's choice, `lockForPocket`), QUICK PHRASES, VOICE HUD |
| `extraction.js` | AI EXTRACTION, LEARNED CORRECTIONS, TEST MODE, WAITING NOTES, EXTRACT SUMMARY, SPOKEN READ-BACK, COMPLIANCE PLATE SCAN, INSECT / SPECIES PHOTO ID, ASK THE AI ABOUT A PHOTO (`askAiAboutPhoto`, shared by the photo calls), PHOTO DESCRIPTION (Describe: the AI's suggested photo caption) |
| `fields.js` | FIELD RENDERING, MULTI-FINDING ENGINE, CHOICE CARDS, SELECT CARDS, BORER FINDINGS, COMPASS, MOISTURE METER READINGS |
| `editing.js` | EDITING, REPORT STEPS, PROGRESS, REPORT DONE (the Done mark and the one next step), SHOW ME (walking what's still blank), SIGNATURE PADS, A SHEET'S SIGNATURE (the technician's kept signature on the treatment record and bait visit; `lastSignatureOf` in `sync.js` finds it), SAY IT INSTEAD |
| `agreement.js` | PRE-INSPECTION AGREEMENT, REMOTE SIGNING |
| `photos.js` | PHOTO ATTACHMENTS, photo store, PHOTO VIEWER, SECTION-AWARE PHOTO SYSTEM (Add photo is the camera, `takePhoto`; "Choose one instead" is the sheet, `choosePhotoSource`), CONDITION PHOTOS (a conducive condition's own photos, `photosBySection['cond-<field>']`), READY-MADE RECOMMENDATIONS |
| `job.js` | DRAWER, MENU (who's signed in, then two lists, Your business and App; each row opens as a page, `openMenuPage`), BOTTOM DOCK, THIS JOB (the one list of a job's steps: the client's answer, treatment, certificate and bait visits are done on it, `jobStepPanel`, `jobNextAction`; a new construction job, `isNewBuildJob`, is Job details then the treatment, with no agreement, report or quote), SPECIAL PURPOSE (a special purpose inspection, `isSpecialPurposeJob`: what it's for, `reportData.jobPurposes`, ticked on Job details or the agreement's sheet, and the first inspection's no.; the agreement's special requests and the report's section 1 say it), LAST VISIT, ADDRESS SUGGESTIONS, WEATHER (fills itself on the inspection day, `fillWeatherOnTheDay`), APPLICABLE STANDARD, JOB INFO, DATE CHIPS, PERSISTENCE — SAVED REPORTS. `pdfFileName` names every PDF (what it is, its number, the address) |
| `account.js` | AUTH STATE, BILLING / STRIPE, SIGN UP / IN / OUT, YOUR SIGN-IN (the name and a change of password, from the card on top of the menu), PASSWORD RESET, DELETE MY ACCOUNT, YOUR TEAM, BUSINESS LOAD, ENTER APP, SESSION RESTORE |
| `sync.js` | SUPABASE REPORT SYNC, SYNC BETWEEN DEVICES, SYNC / SAVE STATUS INDICATOR, OLDER JOBS, DATA EXPORT / IMPORT, ACCESSIBILITY SETTINGS |
| `dashboard.js` | DASHBOARD (the Jobs list), LINKS OUT (every agreement and quote link a client hasn't answered, checked when Jobs opens), AI STATUS, WHAT THE REPORT IS STILL MISSING (the one list Finish, the check sheet and the percentage read), FINALISED JOBS (the lock, versions and Amend), GAPS BEFORE YOU LEAVE |
| `send.js` | SEND TO CLIENT, CHECK BEFORE SENDING (the report's, and the quote's own from `js/quote.js`). `emailToLabel` names a send button ("Email to Sam") |
| `pdf.js` | jsPDF loading (`ensureJsPDFLoaded`), SHARED PDF PIECES, the inspection report PDF (`buildReportPdf`): a blank prints "Not recorded", a section with nothing in it stays out and the ones after it move up a number (`partNo`) |

## Rules that aren't obvious from the code

- **Merging is not deploying.** GitHub Pages publishes the `live` branch. Work goes into `main` by PR. Going live is a separate PR into `live`, built from `origin/live` plus cherry-picked commits, and only after the owner says "deploy". Never push to `live`.
- **Worker, Supabase and Stripe changes** are applied by hand, and only after the owner has seen the exact change.
- **Don't rename stored keys.** That covers `korva_*` localStorage keys, the `korvus-photos` IndexedDB and the Worker URL; renaming them loses users' data. The brand was renamed KORVUS → SAYON in display text only.
- **Font sizes grow with Settings › Text size.** Write one as `calc(13px * var(--ts))`, not `13px`, which stays the same at Large and Extra large (`tests/text-size/e2e.js` checks).
- **Hide with the `hidden` mark.** One rule at the top of `css/app.css` makes it stick for every part, so none needs a rule of its own. Don't show a part that carries the mark with an inline `display`.
- **Ask on SAYON's sheet.** A question goes through `askFirst` (`js/app/shell.js`): what will happen, a button that names it, "Not now". No new `confirm()` or `prompt()`; Delete all jobs is the one left, on purpose (`tests/asks/e2e.js` checks).
- **One name for each thing, one filled button.** `docs/words.md` is the word list: check new wording against it and add a line when a name is settled (`tests/words/e2e.js` fails on a word from its Not column). A screen or sheet has one filled button, the next thing to do (`tests/one-button/e2e.js` counts).
- **Replace, don't duplicate.** Reuse the shared helpers (`PDF_COLORS`, `drawPdfCompanyMark`, `deliverPdfBlob`, `formatAddress`, `pdfFileName`) instead of adding copies.
- **Trade wording:** never give a structural verdict (refer to a builder or engineer), and never rate risk by termite species.
- **No App Store yet.**

## Testing

Serve the repo with `python3 -m http.server 8765` and drive it with Playwright (Chromium is at `/opt/pw-browsers`). Block the service worker in tests. Run `node --check` on every changed JS file. `node tests/run-all.js` runs every `tests/*/e2e.js` (after `sh tests/visual/setup.sh`, with `NODE_PATH` pointing at Playwright). The GitHub check (`.github/workflows/tests.yml`) runs the same on every pull request into `main`.
