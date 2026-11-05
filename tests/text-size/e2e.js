// Settings › Text size: Large and Extra large reach the text on every
// screen, the bars with a fixed amount of room keep their size, nothing is
// cut off on a 320 px phone, and the size is kept when the app opens again.
// Every font size in css/ is calc(Npx * var(--ts)); a plain px size doesn't
// grow with the setting, so the stylesheets are checked for one too.
// node e2e.js <outDir>  (server on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const OUT = process.argv[2] || '/tmp/text-size'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', uid = 'u-owner';
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };

// 1. The stylesheets: no font size left in plain px. The three sample
// letters on the Text size buttons keep theirs, and a size that follows its
// box (cqi) grows only up to calc(Npx * var(--ts)).
for (const f of ['css/app.css', 'css/quote.css']) {
  const src = fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
  const css = src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  const lines = src.split('\n'), plain = [];
  for (const m of css.matchAll(/(?:^|[;{\s])(?:font-size|font)\s*:\s*([^;}]*)/g)) {
    const rest = m[1].replace(/calc\(\s*[\d.]+px\s*\*\s*var\(--ts\)\s*\)/g, '').replace(/clamp\([^()]*cqi[^()]*\)/g, '');
    if (!/\d(\.\d+)?px/.test(rest)) continue;
    const n = css.slice(0, m.index + 1).split('\n').length;
    if (/\.text-size-btn\[data-size=/.test(lines[n - 1])) continue;
    plain.push(`${n}: ${lines[n - 1].trim().slice(0, 70)}`);
  }
  check(!plain.length, `${f}: every font size grows with Text size` + (plain.length ? ': ' + plain.join(' | ') : ''));
}

(async () => {
  const b = await chromium.launch();
  const open = async (width, textSize) => {
    const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width, height: 760 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await require('../visual/fonts-route.js')(ctx);
    await ctx.route(/sentry|posthog|maps\.googleapis|cdnjs/, r => r.fulfill({ status: 200, body: '' }));
    await ctx.route(/workers\.dev/, r => r.fulfill({ json: { plan: 'starter', status: 'active', ai_calls_used_this_period: 1, limit: 150 } }));
    await ctx.route(/supabase\.co/, r => r.fulfill({ json: r.request().url().includes('businesses?owner_id') ? [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] : [] }));
    await ctx.addInitScript(([s, ts]) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1', '1'); if (ts) localStorage.setItem('korva_a11y_textsize', ts); }, [sess, textSize]);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(2500);
    await p.evaluate(async sc => { storeCompanyDetails(sc.company); openApp('inspect'); resetReportState(); const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      for (const [k, v] of Object.entries(sc.job)) set(k, v); updateJob(); await populateFields(sc.fields); saveOpenReportNow(); }, sc);
    await p.waitForTimeout(1200);
    return { ctx, p, errs };
  };
  // Each piece of text on the screen and its size, by its place in the page.
  const sizes = p => p.evaluate(() => {
    const out = {};
    document.querySelectorAll('body *').forEach((el, i) => {
      if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return;
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
      out[i] = { size: parseFloat(getComputedStyle(el).fontSize), fixed: !!el.closest('.section-tabs, .quote-bar, .access-item-state, .text-size-btn'), fit: !!el.closest('.choice-card-code'), text: (el.id ? '#' + el.id + ' ' : '') + el.textContent.trim().slice(0, 30) };
    });
    return out;
  });
  const screens = [
    ['the report', "tabGo('report'); goStep('property')"],
    ['the quote', "tabGo('quote')"],
    ['the job page', "closeQuote(); tabGo('job')"],
    ['the Jobs list', "openDashboard()"],
    ['Settings', "toggleDrawer(); openMenuPage('settingsPanel')"],
  ];

  // 2. Extra large, then Large, against Normal on the same screens.
  const { ctx, p, errs } = await open(390, '');
  for (const [name, js] of screens) {
    await p.evaluate(js); await p.waitForTimeout(1200);
    const normal = await sizes(p);
    for (const [ts, k] of [['xl', 1.28], ['large', 1.12]]) {
      await p.evaluate(ts => setTextSize(ts), ts); await p.waitForTimeout(500); // some sizes ease in
      const big = await sizes(p);
      const grew = [], kept = [];
      for (const [i, n] of Object.entries(normal)) {
        if (!big[i]) continue;
        const ratio = big[i].size / n.size;
        if (n.fixed) { if (Math.abs(ratio - 1) > 0.01) kept.push(n.text); }
        // A choice card's answer grows as far as its card has room for.
        else if (n.fit) { if (ratio < 1 || ratio > k + 0.02) grew.push(`"${n.text}" ${n.size}px → ${big[i].size}px`); }
        else if (Math.abs(ratio - k) > 0.02) grew.push(`"${n.text}" ${n.size}px → ${big[i].size}px`);
      }
      check(!grew.length && Object.keys(normal).length > 20, `${name}, ${ts === 'xl' ? 'Extra large' : 'Large'}: every piece of text is ${k}× its normal size` + (grew.length ? ': ' + grew.slice(0, 6).join(' | ') : ''));
      check(!kept.length, `${name}, ${ts === 'xl' ? 'Extra large' : 'Large'}: the step tabs and the quote's total bar keep their size` + (kept.length ? ': ' + kept.slice(0, 4).join(' | ') : ''));
      await p.evaluate(() => setTextSize('normal')); await p.waitForTimeout(500);
    }
    const back = await sizes(p);
    check(Object.entries(normal).every(([i, n]) => !back[i] || back[i].size === n.size), `${name}: Normal puts every size back`);
  }
  // The way it's done on a phone: Menu › Settings, tap the big A, back to
  // the report. An answer filled in earlier is at its new size too (in
  // Chrome it once eased back to its old size and stayed there).
  await p.evaluate(() => { const pn = document.getElementById('sidebarPanel'); if (pn && pn.classList.contains('open')) toggleDrawer(); tabGo('report'); goStep('property'); });
  await p.waitForTimeout(800);
  const answer = () => p.evaluate(() => parseFloat(getComputedStyle(document.getElementById('f-structureType')).fontSize));
  const before = await answer();
  await p.evaluate(() => { toggleDrawer(); openMenuPage('settingsPanel'); }); await p.waitForTimeout(800);
  await p.click('#textSizeControl .text-size-btn[data-size="xl"]');
  const took = await p.evaluate(() => { const t = performance.now(); setTextSize('xl'); return performance.now() - t; });
  await p.waitForTimeout(300);
  await p.evaluate(() => { tabGo('report'); goStep('property'); });
  await p.waitForTimeout(800);
  const after = await answer();
  check(before > 0 && Math.abs(after / before - 1.28) < 0.02, `a filled-in answer on the report is at the new size after Settings: ${before}px → ${after}px`);
  check(took < 150, `switching size is quick (${Math.round(took)} ms)`);
  await p.screenshot({ path: `${OUT}/report-390-xl.png` });
  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();

  // 3. A 320 px phone at Extra large, the setting kept from last time.
  const small = await open(320, 'xl');
  const q = small.p;
  check(await q.evaluate(() => document.body.classList.contains('text-size-xl') && document.querySelector('#textSizeControl .text-size-btn.active').dataset.size === 'xl'), 'Extra large is kept when the app opens again');
  await q.evaluate(() => { goStep('areas'); const d = document.querySelector('#areaChecklist details'); if (d) d.open = true; }); await q.waitForTimeout(800);
  const cut = await q.evaluate(() => [...document.querySelectorAll('#areaChecklist .area-status-btn')].filter(b => b.offsetWidth && b.scrollWidth > b.clientWidth + 1).map(b => b.textContent.trim()));
  check(await q.evaluate(() => document.querySelectorAll('#areaChecklist .area-status-btn').length > 0) && !cut.length, 'Areas: each status button shows its words in full' + (cut.length ? ': ' + cut.join(', ') : ''));
  await q.screenshot({ path: `${OUT}/areas-320-xl.png` });
  for (const [name, js] of [['the report', "goStep('property')"], ['the quote', "tabGo('quote')"], ['the job page', "closeQuote(); tabGo('job')"], ['the Jobs list', 'openDashboard()']]) {
    await q.evaluate(js); await q.waitForTimeout(1200);
    const wide = await q.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(wide <= 0, `${name} at 320 px, Extra large: nothing runs off the side of the screen` + (wide > 0 ? ` (${wide}px)` : ''));
  }
  await q.screenshot({ path: `${OUT}/jobs-320-xl.png` });
  check(!small.errs.length, 'no page errors at 320 px' + (small.errs.length ? ': ' + small.errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
  process.exit(fails.length ? 1 : 0);
})();
