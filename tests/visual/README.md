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
