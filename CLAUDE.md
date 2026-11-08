# SAYON — guide for working on this repo

A voice-to-report PWA for Australian timber pest inspectors. The chain is: pre-inspection agreement → voice inspection report → quote → client's answer and signature → treatment record and certificate, each sent to the client. It is a static site on GitHub Pages: no build step and no framework. Plain HTML, CSS and JS that load in the browser.

**New to this repo, or starting a larger task? Read `docs/handover/README.md` first.** It covers the owner, what's live, the go-live recipe and the traps, and points to the rest.

Read only the files your task needs. The app's own code is split into 18 files in `js/app/` (150 to 1,900 lines each), so find the file and the section with `grep -rn "SECTION NAME" js/app/` and read that range instead of whole files.

## File map

| File | What's in it |
|---|---|
| `index.html` | Every screen and overlay: splash, sign-in, platform menu, report (sections 1–7 + sign-off), drawer menu pages, quote screen and sheets |
| `js/app/*.js` | The report app and everything shared, in 18 files (see below) |
| `js/quote.js` | Quote builder, the client's answer and the quote PDF |
| `js/treatment.js` | Treatment record and the one-page certificate PDF |
| `js/business-sync.js` | Syncs company details and quote prices to Supabase `businesses.settings` |
| `css/app.css`, `css/quote.css` | Styles |
| `service-worker.js` | Offline cache. **Bump `CACHE_VERSION` (korva-vNN) whenever cached files change** |
| `worker/worker.js` | Cloudflare Worker `korva`: AI proxy, `/transcribe`, Stripe, `/send-email`. Pasted into Cloudflare by hand |
| `netlify.toml` | Netlify preview links only (`deploy-preview-N--sayon-preview.netlify.app`). Never the live site |
| `supabase/*.sql` | SQL baz applies in the Supabase SQL editor |
| `terms.html`, `privacy.html` | Legal pages |
| `docs/handover/` | Handover docs: start-here guide, current state, extraction and report-wording maps, a sample report PDF |
| `tests/extraction/` | Extraction test bench: real transcripts (made-up address), answer keys, scorer and runners |

## `js/app/` files (grep the banner text)

They are plain scripts, not modules: every top-level name is shared across all of them and the later files (`js/quote.js` and the rest). They load in the order `index.html` lists them, which is the order below and the order of the old single `js/app.js`. A top-level statement that runs while the page loads (not inside a function or an event handler) can only use names from its own file or an earlier one; a function called later can use anything. A new file goes in `index.html` and `service-worker.js`'s `APP_SHELL`.

| File | What's in it |
|---|---|
| `state.js` | STATE (shared `let`s such as `reportData`), onboarding, YOUR BUSINESS |
| `areas.js` | Areas inspected, OBSTRUCTION ZONE SELECTOR, hindered and restricted access, ACCESS SPOTS and their photos |
| `talk-photos.js` | PHOTOS WHILE TALKING |
| `species.js` | SPECIES INTELLIGENCE DATABASE (`SPECIES_DB`, `lookupSpecies`) |
| `prompts.js` | `SECTIONS`, `REQUIRED_FIELDS`, `SYSTEM_PROMPT`, the plate scan and insect ID prompts |
| `shell.js` | APP UPDATES, ADDRESS MOVE, SPLASH, PLATFORM NAVIGATION, keyboard access |
| `voice.js` | FIELD NOTES, NATIVE SPEECH RECOGNITION ADAPTER, VOICE, AI TRANSCRIPT CLEANUP, EXPERIMENTAL AUDIO CAPTURE, WHISPER LISTENING, QUICK PHRASES, VOICE HUD |
| `extraction.js` | AI EXTRACTION, LEARNED CORRECTIONS, TEST MODE, WAITING NOTES, EXTRACT SUMMARY, SPOKEN READ-BACK, COMPLIANCE PLATE SCAN, INSECT / SPECIES PHOTO ID |
| `fields.js` | FIELD RENDERING, MULTI-FINDING ENGINE, CHOICE CARDS, SELECT CARDS, BORER FINDINGS, COMPASS, MOISTURE METER READINGS |
| `editing.js` | EDITING, REPORT STEPS, PROGRESS, SIGNATURE PADS, SAY IT INSTEAD |
| `agreement.js` | PRE-INSPECTION AGREEMENT, REMOTE SIGNING |
| `photos.js` | PHOTO ATTACHMENTS, photo store, PHOTO VIEWER, SECTION-AWARE PHOTO SYSTEM, READY-MADE RECOMMENDATIONS |
| `job.js` | DRAWER, MENU, BOTTOM DOCK, THIS JOB, LAST VISIT, ADDRESS SUGGESTIONS, WEATHER, APPLICABLE STANDARD, JOB INFO, PERSISTENCE — SAVED REPORTS |
| `account.js` | AUTH STATE, BILLING / STRIPE, SIGN UP / IN / OUT, PASSWORD RESET, DELETE MY ACCOUNT, YOUR TEAM, BUSINESS LOAD, ENTER APP, SESSION RESTORE |
| `sync.js` | SUPABASE REPORT SYNC, SYNC BETWEEN DEVICES, SYNC / SAVE STATUS INDICATOR, OLDER JOBS, DATA EXPORT / IMPORT, ACCESSIBILITY SETTINGS |
| `dashboard.js` | DASHBOARD, STATUS / TOAST, COMPLETED JOBS, GAPS BEFORE YOU LEAVE |
| `send.js` | SEND TO CLIENT, CHECK BEFORE SENDING |
| `pdf.js` | jsPDF loading (`ensureJsPDFLoaded`), SHARED PDF PIECES, the inspection report PDF (`buildReportPdf`) |

## Rules that aren't obvious from the code

- **Merging is not deploying.** GitHub Pages publishes the `live` branch. Work goes into `main` by PR. Going live is a separate PR into `live`, built from `origin/live` plus cherry-picked commits, and only after the owner says "deploy". Never push to `live`.
- **Worker, Supabase and Stripe changes** are applied by hand, and only after the owner has seen the exact change.
- **Don't rename stored keys.** That covers `korva_*` localStorage keys, the `korvus-photos` IndexedDB and the Worker URL; renaming them loses users' data. The brand was renamed KORVUS → SAYON in display text only.
- **Replace, don't duplicate.** Reuse the shared helpers (`PDF_COLORS`, `drawPdfCompanyMark`, `deliverPdfBlob`, `formatAddress`) instead of adding copies.
- **Trade wording:** never give a structural verdict (refer to a builder or engineer), and never rate risk by termite species.
- **No App Store yet.**

## Testing

Serve the repo with `python3 -m http.server 8765` and drive it with Playwright (Chromium is at `/opt/pw-browsers`). Block the service worker in tests. Run `node --check` on every changed JS file.
