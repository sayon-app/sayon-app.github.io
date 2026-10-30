// Scrolls the report's scroll container through each step and stitches the shots.
// node scrollshots.js <outDir> <width> [scenario] [steps]
const { chromium } = require('playwright'); const fs = require('fs'); const { execSync } = require('child_process');
const OUT = process.argv[2], W = +process.argv[3], SCN = process.argv[4] || 'heavy';
const STEPS = (process.argv[5] || 'property,areas,findings,conducive,recommendations,finish').split(',');
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf', uid = 'u-owner';
const sess = { access_token:'a.b.c', refresh_token:'r', expires_at: Math.floor(Date.now()/1000)+3600, user:{ id: uid, email:'office@example.com', user_metadata:{ name:'Alex Example', business_name:'Example Pest Co' } } };
const sc = require('./scenarios.js').find(s => s.name === SCN);
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers:'block', viewport:{ width:W, height: 760 }, deviceScaleFactor: 1.5, hasTouch: true, isMobile: true });
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP+'/package/dist/jspdf.umd.min.js'), contentType:'application/javascript' }));
  await require('./fonts-route.js')(ctx);
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status:200, body:'' }));
  await ctx.route(/workers\.dev/, r => r.fulfill({ json:{ plan:'starter', status:'active', ai_calls_used_this_period:1, limit:150 } }));
  await ctx.route(/supabase\.co/, r => { const u = r.request().url(); if (u.includes('businesses?owner_id')) return r.fulfill({ json:[{ id:'b1', name: sc.company.name, owner_id: uid, settings:{} }] }); return r.fulfill({ json:[] }); });
  await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1','1'); }, sess);
  const p = await ctx.newPage(); p.on('pageerror', e => console.log('pageerror', e.message));
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
  await p.evaluate(async (sc) => { storeCompanyDetails(sc.company); openApp('inspect'); resetReportState();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    for (const [k, v] of Object.entries(sc.job)) set(k, v); updateJob(); await populateFields(sc.fields); }, sc);
  await p.waitForTimeout(2500);
  for (const st of STEPS) {
    await p.evaluate(st => { goStep(st); document.querySelectorAll('details.fgroup').forEach(d => d.open = true); }, st);
    await p.waitForTimeout(500);
    const info = await p.evaluate(() => {
      let best = null; for (const el of document.querySelectorAll('*')) { const s = getComputedStyle(el); if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 50 && el.offsetParent) { if (!best || el.clientHeight * el.scrollHeight > best.clientHeight * best.scrollHeight) best = el; } }
      if (!best) return null; best.setAttribute('data-shot', '1'); best.scrollTop = 0; return { h: best.scrollHeight, c: best.clientHeight, id: best.id || best.className };
    });
    if (!info) { await p.screenshot({ path: `${OUT}/${W}-${st}-0.png` }); continue; }
    const files = []; let i = 0;
    for (let top = 0; top < info.h; top += Math.floor(info.c * 0.85)) {
      await p.evaluate(t => { document.querySelector('[data-shot]').scrollTop = t; }, top); await p.waitForTimeout(250);
      const f = `${OUT}/${W}-${st}-${i++}.png`; await p.screenshot({ path: f }); files.push(f);
      if (i > 14) break;
    }
    execSync(`montage ${files.join(' ')} -tile ${files.length}x -geometry +3+3 -background '#333' ${OUT}/strip-${W}-${st}.png`);
    console.log(st, info.id, info.h, files.length);
  }
  await b.close();
})();
