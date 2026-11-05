# SAYON — guide for working on this repo

A voice-to-report PWA for Australian timber pest inspectors. The chain is: pre-inspection agreement → voice inspection report → quote → client's answer and signature → treatment record and certificate, each sent to the client. It is a static site on GitHub Pages: no build step and no framework. Plain HTML, CSS and JS that load in the browser.

**New to this repo, or starting a larger task? Read `docs/handover/README.md` first.** It covers the owner, what's live, the go-live recipe and the traps, and points to the rest.

Read only the files your task needs. `js/app.js` is about 9,200 lines, so jump to a section with `grep -n "SECTION NAME" js/app.js` instead of reading it whole.

## File map

| File | What's in it |
|---|---|
| `index.html` | Every screen and overlay: splash, sign-in, platform menu, report (sections 1–7 + sign-off), drawer menu pages, quote screen and sheets |
| `js/app.js` | The report app and everything shared (see sections below) |
| `js/quote.js` | Quote builder, the client's answer and the quote PDF |
| `js/price-book.js` | Your prices: the business's own price for every quote line, set in onboarding and Menu › Your prices. Same store as the prices remembered from quotes (`quotePriceMemory`) |
| `js/photo-markup.js` | Mark up a report photo (circle, arrow, draw, label) from the photo viewer |
| `js/treatment.js` | Treatment record and the one-page certificate PDF |
| `js/bait.js` | Bait station visits after a baiting system goes in: the visit sheet, the client's visit report PDF, the job's due date |
| `js/reinspection.js` | Re-inspections due: the Jobs screen's Due tab (each property whose next inspection is coming up or overdue, from the report date plus its interval, or the treatment record's date), the reminder email to the client, starting the new report |
| `js/site-plan.js` | The drawn site plan on the treatment record: symbols, legend, the editor (drag corners and walls, turn to any angle, pinch to zoom), and the plan page on the certificates and bait visit reports |
| `js/chemicals.js` | Chemical register (Menu › Chemical register): products, label and SDS links, each label use with its rate. The treatment record's product picker fills the active, rate and life from it. Once a week each APVMA No. is checked against the APVMA's list of registered products on data.gov.au, and a product that has dropped off is flagged |
| `js/job-pack.js` | The job PDF: every document from the job joined behind a contents page, and the job page's Finalise step. Joins pages with pdf-lib (`js/vendor`) |
| `js/business-sync.js` | Syncs company details and quote prices to Supabase `businesses.settings` |
| `js/sample-job.js` | The sample job: a finished, made-up job (agreement to certificate) offered at the end of sign-up, on an empty Jobs list and in the menu. Built on the phone at the business's own prices; id `sample_job` (`isSampleJob` in `js/app.js`) keeps it out of the account, Due list, backups and last visits, sends its emails to the business, and `stampSamplePdf` marks its PDFs SAMPLE |
| `css/app.css`, `css/quote.css` | Styles |
| `service-worker.js` | Offline cache. **Bump `CACHE_VERSION` (korva-vNN) whenever cached files change** |
| `worker/worker.js` | Cloudflare Worker `korva`: AI proxy, `/transcribe`, Stripe, `/send-email`. Pasted into Cloudflare by hand |
| `netlify.toml` | Netlify preview links only (`deploy-preview-N--sayon-preview.netlify.app`). Never the live site |
| `supabase/*.sql` | SQL baz applies in the Supabase SQL editor |
| `terms.html`, `privacy.html` | Legal pages |
| `docs/handover/` | Handover docs: start-here guide, current state, extraction and report-wording maps, a sample report PDF |
| `tests/extraction/` | Extraction test bench: real transcripts (made-up address), answer keys, scorer and runners |

## `js/app.js` sections (grep the banner text)

- **Voice:** VOICE, NATIVE SPEECH RECOGNITION ADAPTER, AI TRANSCRIPT CLEANUP, HANDS-FREE MODE, EXPERIMENTAL AUDIO CAPTURE
- **Extraction:** AI EXTRACTION (`SYSTEM_PROMPT`), WAITING NOTES
- **Report:** FIELD RENDERING, MULTI-FINDING ENGINE, COMPASS, MOISTURE METER READINGS, OBSTRUCTION ZONE SELECTOR, SPECIES INTELLIGENCE DATABASE
- **Jobs:** PRE-INSPECTION AGREEMENT, PHOTO ATTACHMENTS, SIGNATURE PADS, COMPLETED JOBS
- **Account:** AUTH STATE, SIGN IN, BILLING / STRIPE, BUSINESS LOAD, DELETE MY ACCOUNT
- **Data:** PERSISTENCE — SAVED REPORTS, SUPABASE REPORT SYNC, DATA EXPORT / IMPORT
- **Screens:** DASHBOARD, MENU, ACCESSIBILITY SETTINGS
- **Output:** PDF GENERATION, SEND TO CLIENT

## Rules that aren't obvious from the code

- **Merging is not deploying.** GitHub Pages publishes the `live` branch. Work goes into `main` by PR. Going live is a separate PR into `live`, built from `origin/live` plus cherry-picked commits, and only after the owner says "deploy". Never push to `live`.
- **Worker, Supabase and Stripe changes** are applied by hand, and only after the owner has seen the exact change.
- **Don't rename stored keys.** That covers `korva_*` localStorage keys, the `korvus-photos` IndexedDB and the Worker URL; renaming them loses users' data. The brand was renamed KORVUS → SAYON in display text only.
- **Font sizes grow with Settings › Text size.** Write one as `calc(13px * var(--ts))`, not `13px`, which stays the same at Large and Extra large (`tests/text-size/e2e.js` checks).
- **Replace, don't duplicate.** Reuse the shared helpers (`PDF_COLORS`, `drawPdfCompanyMark`, `deliverPdfBlob`, `formatAddress`) instead of adding copies.
- **Trade wording:** never give a structural verdict (refer to a builder or engineer), and never rate risk by termite species.
- **No App Store yet.**

## Testing

Serve the repo with `python3 -m http.server 8765` and drive it with Playwright (Chromium is at `/opt/pw-browsers`). Block the service worker in tests. Run `node --check` on every changed JS file.
