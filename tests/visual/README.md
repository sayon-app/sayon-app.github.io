# Visual review bench

Renders every client PDF and screenshots the app so a person (or a model) can look at the actual pages for orphaned headings, awkward page breaks, overflow, clipping and broken states. Used for the 2026-10-30 review; before and after images are in `docs/visual-review/2026-10-30/`.

Sample jobs (`scenarios.js`, made-up names and addresses):
- `standard`: a typical pre-purchase job with two findings and a few photos.
- `heavy`: everything long at once: a long business name, client and address, five findings, borers, decay, many photos and quote lines.
- `clean`: a near-empty annual inspection with nothing found.

Run from the repo root:

```
sh tests/visual/setup.sh                       # jsPDF + the app's fonts into /tmp
python3 -m http.server 8765 &
export NODE_PATH=/opt/node-tools/node_modules
node tests/visual/pdfs.js /tmp/vr/pdf          # report, agreement (signed and unsigned), quote (open and accepted), certificate per job
node tests/visual/screens.js /tmp/vr/screens 320,390 heavy   # sign-in, menus, sheets, quote, treatment, website, sign page
node tests/visual/scrollshots.js /tmp/vr/strips 375 heavy     # each report step, scrolled top to bottom and stitched
for f in /tmp/vr/pdf/*.pdf; do pdftoppm -r 50 -png "$f" "${f%.pdf}"; done
```

Then look at the images. `screens.js` also writes `probe.json`, which flags a page that scrolls sideways and page errors; its OFFSCREEN lines for the closed drawer and CLIPPED lines for long text inside an input are expected. `ONLY=heavy` limits `pdfs.js` to one job.

Things the 2026-10-30 review found, to check again after PDF or layout changes: a section title left at the foot of a page, text style leaking across a page break, long business names in the letterhead, names on signature lines, a signature or the closing words alone on the last page, and answer buttons at 375 px wide.

## Client link

`tests/client-link/e2e.js <outDir>` runs the quote link end to end against canned Supabase and Worker routes: Send from the quote screen makes the link and emails it, the check sheet reuses it, the client accepts (and another declines) on `sign.html`, and the app reads the answer back. Same setup as above (`setup.sh`, the server on :8765). It writes screenshots and the accepted quote PDF to `<outDir>`.

## After-extract sheet

`tests/extract-sheet/e2e.js <outDir>` checks the "From your note" sheet: the Before you leave gaps with their one-tap fixes, the Record and Get it signed buttons, the read-back text, and that the send sheet's fixes still work. Screenshots at 390 and 320.

## Sample job

`tests/sample-job/e2e.js <outDir>` signs up a new business, opens the sample from the end of sign-up and checks it: finished and 100% filled in, at the business's own prices, SAMPLE on every page of every PDF, its job file emailed to the business, nothing sent to the account, off the Due list, removed and brought back from the empty Jobs list and the menu. It also checks that the first open already shows the agreement signed and the save line says the sample stays on the phone, that the report number carries the inspection date, and that saving or sending the sample's quote leaves the business's price list alone. It saves the PDFs to `<outDir>`.

## Last visit

`tests/last-visit/e2e.js <outDir>` saves a report, starts a new job at the same address typed differently, and checks the offer, Not now, Start from it (property details copied, findings and risk not, termite history written) and the Since last visit sheet.

## Photos while talking

`tests/talk-photo/e2e.js <outDir>` takes a photo from the voice popover between two stretches of speech about a gum tree, then a second photo a minute later about nothing in particular, fills the report from the standard scenario and checks that the first photo lands on the gum-tree finding with the right sentence as its caption, the second stays in the Findings photos, and both survive a reload.

## Send gaps

`tests/send-gaps/e2e.js <outDir>` adds two photos whose upload fails, opens the check sheet and expects the "only on this phone" gap, taps Back up now once failing and once working, then starts a fill against a slow canned AI and taps Keep for later, expecting the note under Waiting notes and in the draft.

## Full chain

`tests/full-chain/e2e.js <outDir> [width]` runs a whole job by tapping the real buttons on a phone: business setup, job details on the dashboard, the agreement signed on the phone, a typed note filled by a canned AI, the after-fill fixes, sign-off, the report sent, the quote sent, the client's accepted answer with a signature, the treatment record, the certificate emailed, then a reload. It checks that areas a finding names aren't marked "nothing found", that PDF file names keep the whole address, and that nothing is lost on reload. It writes a screenshot per step and the PDFs that were emailed to `<outDir>`. Run it at 390 and 320.

## Job page

`tests/visual/job-page.js <outDir> [width]` shoots This job at five points (a new job, waiting on the agreement, quote sent, quote accepted, the finished sample job) in light and dark, at the top and in full. Before and after shots from the 2026-11-06 clean-up are in `docs/screenshots/job-page/`.

## Jobs list

`tests/visual/jobs-list.js <outDir> [width]` builds a business with six made-up jobs at different stages (a report under way, one to quote, a quote waiting, one accepted, one treated, one declined) and shoots each tab, a job's sheet and a brand-new business's empty list. `MODES=light,dark` adds dark. Before and after shots are in `docs/screenshots/jobs-list/`.

`tests/jobs-list/e2e.js <outDir>` checks what the list says: the headline counts today's jobs (and says what's booked for later and which re-inspections are overdue), To do runs earlier, today, coming up with a booking's time on its card, an agreement whose link is out says when it went and who it waits on, opening Jobs asks about every link that's out in one request and a signed agreement or answered quote moves its job, a clash copy and a job the account doesn't hold are tagged, the dock names the open job by its street on Jobs and its mic won't record into a finished report, and deleting says "Job deleted".

## New job

`tests/visual/new-job.js <outDir> [width]` taps New job on the Jobs list and types a job in by hand, checking on the way: the job page opens empty with the address ready to type and today's date, the page shows the address as it's typed, a postcode fills in the state (but not over one picked by hand), Sign on this phone with no address asks for one, Save it for later puts the job on the Jobs list, and once saved the job page leads with the agreement. It shoots the empty page, the filled-in page, the Jobs list and the saved job's page. `MODES=light,dark` adds dark shots of the empty page. Before and after shots are in `docs/screenshots/new-job/`.

## Areas inspected

`tests/visual/areas.js <outDir> [width]` opens the report's Areas step on the standard job with a mix of statuses and three areas left to mark, then taps through: an area open, a reason ticked, Not inspected and back, a reason ticked and unticked, Nothing found, an unmarked area open, Mark the rest as inspected, an exact spot typed on the interior's own card under the reason ticked, then Areas unable to be inspected reading it back (nothing is entered there) and a tap on an area opening it in Areas. It checks each tap lands in the report and nothing runs past the card, and shoots both cards. `MODES=light,dark` adds dark. Before and after shots from the 2026-11-07 refresh are in `docs/screenshots/areas/`.

## Report tabs

`tests/visual/report-tabs.js <outDir> [width] [scenario] [steps]` shoots each report step's sections whole (Property, Areas, Findings, Conducive, Advice, Finish), not cut by the scroll box, and flags anything that runs past a card. `MODES=light,dark` adds dark, `TS=xl` shoots at Extra large text. `CHECKS=1` then taps through the parts the 2026-11-07 refresh restyled: Add another finding (a card not answered yet), picking Active (the head turns red), a finding's bin, the "Evidence found in …" prompt on Findings and its Termites answer, Add a reading and a reading's bin, and Sign again on the inspector's signature. Before and after shots are in `docs/screenshots/report-tabs/`.

## Evidence found prompt

`tests/visual/area-prompt.js <outDir> [width]` checks the "Evidence found in …" prompt on Findings when the report still has its one empty finding. With Termites out of sight the prompt asks "What was it?" at the top. Once Termites is brought in, the prompt sits inside that finding and asks "Write it up here?", and Yes puts the area on it instead of adding a second finding. It also checks that the prompt stays put after Active is picked, that a second area gets its own "What was it?" at the top (its Termites adds a finding), that a folded Termites group moves the prompt to the top, and that "No timber pests found" can't answer the finding "nothing found" over the area. `MODES=light,dark` adds dark. Before and after shots are in `docs/screenshots/area-prompt/`.

## Findings shown when prompted

`tests/findings-prompted/e2e.js <outDir>` checks that Termites, Borers and Timber decay stay out of sight until something calls for them: a fresh report shows the quick fill and "Found something? Add it", "No timber pests found" answers all none and Undo takes it back, Termites comes in open from its button, areas that all say nothing found answer the timber pests none (and the report PDF prints NONE / NO), an area changed to evidence found takes those answers back and asks "What was it?", Borers and Rot from that question start the write-up for that area, an answer given by hand isn't taken back, and "Say what it was" on the check before sending goes to the question. It also checks the finding number on a card's tile: none on a lone or unanswered card. `MODES=light,dark` adds dark shots.

## Every test at once

`node tests/run-all.js` runs every `tests/*/e2e.js`, three at a time, and ends with a count (`node tests/run-all.js navigation send-gaps` runs just those). It starts the server on :8765 if nothing is there. Each test's output is kept in `/tmp/sayon-tests/<name>.log`. The GitHub check (`.github/workflows/tests.yml`) runs the same on every pull request into `main`, and keeps the logs and screenshots of a failing run for 7 days.

## Before it goes

`tests/agreement-ways/e2e.js <outDir>` checks the agreement, either way: the Next step card leads with Sign on this phone on the day and with "Email it to Sam to sign" on a job booked for a later day with an email, the link goes from the card filled from Job details (and the sheet opens to ask for the inspection type when that's missing), the sheet's first step is one line read from Job details with a box only for what's missing, a date changed on the sheet changes the job's date, the client's sign page says a copy comes with the report, a signed agreement's two buttons sit under the signature, the PDF cover names the job's client when someone else signs, and the Jobs card of a job booked ahead opens This job with the link button lit.

`tests/report-steps/e2e.js <outDir>` checks the report's steps in the order the inspector meets them: the Property step runs Visit, Building, Site, Termite system; the weather fills itself once when a job booked ahead is opened on its day, and moving the day clears what it filled and keeps the inspector's own reading; a signed agreement has no banner and no Sign-off block; Areas reads In progress from the first area marked; a ticked reason puts the exact spot and Add photo on the area's card, and Areas unable to be inspected reads them back; Add photo opens the camera and Choose one instead asks photo library or files; a conducive condition answered as a problem takes its own photos, printed captioned with it, and the old section boxes only show for a report with photos in them; the viewer shows the caption only; the note reads "Your note" and "Fill in the report"; the inspector's signature carries to the next report with Sign again, can't be drawn over, and doesn't stay under another name.

`tests/before-it-goes/e2e.js <outDir>` checks that nothing leaves with a hole in it: Finish and the check before sending show one list of what the report is still missing, and the percentage reads off it; Show me goes to a blank answer and Next walks the rest; the Send button stays at the foot of the sheet and names who it goes to; a business with no email is told replies won't reach it; the quote's Send to client opens the same check and nothing goes until its button is tapped; the certificate card says what the certificate would go without.

`tests/one-ending/e2e.js <outDir>` checks a job's one ending: This job lists and counts only the steps the job has, each step says what it's waiting on and the dock shows the same count; Finalise isn't offered until the steps are done and the client has the report as it stands; after the report has gone, Finish is one button back to the job; Finalise locks the job and makes its PDF, and doesn't lock it when the PDF doesn't go; a locked report says so in one line, Amend is on This job, and an amended report is sent before version 2; a report changed after it was sent reads so (saving a PDF doesn't count); a declined job counts only its own steps, and a missing agreement on a report that has gone is a quiet line.

`tests/menu/e2e.js <outDir>` checks the menu and what opens from it: the app opens without the splash's old made-up lines; the menu is who's signed in, then Your business and App, with Sign out a quiet link that asks on SAYON's own sheet; Business details saves from the bottom, asks before a change is dropped and, opened from a check that found a detail missing, goes back to that check (the report's and the quote's); Your sign-in saves a name and changes the password only with the current one; Billing reads plan, plans, then one folded line; the chemical register says where each product's rates came from. It also checks that no part marked `hidden` is given a display by its own style, and that the browser's grey box is never used.

`tests/client-sees/e2e.js <outDir>` checks what reaches the client: a blank in the report prints "Not recorded" and no conducive conditions is "NONE FOUND" only once the questions are answered; no termites is one row, not a numbered card; Photographs stays out when there are no general photos and the sections after it move up; over 17 page positions the last photo of a set is never alone on a new page, and the next section starts under photos that ran over; every PDF's file name is what it is, then the address; the job file has the agreement once, its contents rows point at the right pages and every page after the contents says which page of the file it is; a client who signed to accept is owed the signed quote as the job's next step (not for a phone answer), and `sign.html` says it's coming; the privacy policy's version is the one sign-up records, the public pages name things as the app does, and the website's sample report says what a report made today says. It reads the PDFs with `pdftotext`.

`tests/asks/e2e.js <outDir>` checks that SAYON asks on its own sheet: no `confirm()` or `prompt()` is left in the app's scripts but Delete all jobs; Delete my account keeps its button off until DELETE is typed in the sheet's box; the plan's "Type it" asks in the sheet and saves on Enter, and Esc leaves it as it was; replacing the plan's steps, clearing the client's answer, deleting a saved note and removing a signed agreement each ask, and backing out changes nothing; a link the phone couldn't copy is shown in the sheet to press and hold; the site plan's X, Esc and Cancel ask before changes are lost, and close at once when there are none.

`tests/one-button/e2e.js <outDir>` counts the filled buttons: one at most on This job at each stage of a job, on every report step (being written, done but not sent, and sent), on the quote (a draft and sent), on Jobs, and on the Add photo, agreement and check-before-sending sheets. A selected tab or chip isn't counted. It also checks that a button that sends says how and to whom ("Email to Sam", "Email to sam@example.com").

`tests/words/e2e.js` (no server) reads the word list, `docs/words.md`, and fails if a word from its Not column is back on a screen, in the app's scripts (comments left out) or on the public website. The agreement's clauses and the legal pages aren't searched.
