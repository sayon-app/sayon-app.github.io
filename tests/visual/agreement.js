// Screenshots of the pre-inspection agreement sheet: not signed (part way
// through, so the step states show), and signed. Phone and desktop, light
// and dark. node agreement.js <outDir>
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/agr', PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf', uid = 'u-owner';
const sess = { access_token:'a.b.c', refresh_token:'r', expires_at: Math.floor(Date.now()/1000)+3600, user:{ id: uid, email:'office@example.com', user_metadata:{ name:'Alex Example', business_name:'Example Pest Co' } } };
const sc = require('./scenarios.js').find(s => s.name === 'standard');
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch(); const errs = [];
  for (const [W, H, mobile] of [[390, 3600, true], [1280, 3200, false]]) for (const scheme of ['light', 'dark']) {
    const ctx = await b.newContext({ serviceWorkers:'block', viewport:{ width:W, height:H }, deviceScaleFactor: mobile ? 2 : 1, hasTouch: mobile, isMobile: mobile, colorScheme: scheme });
    await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP+'/package/dist/jspdf.umd.min.js'), contentType:'application/javascript' }));
    await require('./fonts-route.js')(ctx);
    await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status:200, body:'' }));
    await ctx.route(/workers\.dev/, r => r.fulfill({ json:{ plan:'starter', status:'active', ai_calls_used_this_period:1, limit:150 } }));
    await ctx.route(/supabase\.co/, r => { const u = r.request().url(); if (u.includes('businesses?owner_id')) return r.fulfill({ json:[{ id:'b1', name: sc.company.name, owner_id: uid, settings:{} }] }); return r.fulfill({ json:[] }); });
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(`${W}-${scheme}: ${e.message}`));
    await p.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1','1'); }, sess);
    await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(2500);
    await p.evaluate(async (sc) => { storeCompanyDetails(sc.company); openApp('inspect'); resetReportState();
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      for (const [k, v] of Object.entries(sc.job)) set(k, v); updateJob(); }, sc);
    await p.waitForTimeout(800);
    const tag = `${W}-${scheme}`;
    await p.evaluate(() => { openAgreementSheet(); document.getElementById('agreementInspectionType').value = 'Annual — Existing Building'; onAgreementTypeChange(); });
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${OUT}/${tag}-1-top.png`, clip: { x: 0, y: 0, width: W, height: 1100 } });
    await p.screenshot({ path: `${OUT}/${tag}-2-full.png`, fullPage: true });
    // Signed
    await p.evaluate(() => {
      document.getElementById('agreementAgree').checked = true;
      const c = document.getElementById('agreementSigCanvas'), x = c.getContext('2d');
      x.lineWidth = 3; x.beginPath(); x.moveTo(60, 150); x.bezierCurveTo(140, 40, 200, 200, 300, 90); x.bezierCurveTo(360, 40, 420, 170, 520, 110); x.stroke();
      if (agreementSignaturePad) agreementSignaturePad.empty = false; document.getElementById('agreementSigPlaceholder').style.display = 'none';
      updateAgreementSignButton();
    });
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${OUT}/${tag}-3-ready.png`, fullPage: true });
    await p.locator('#agreementStepRead').screenshot({ path: `${OUT}/${tag}-3a-read.png` });
    await p.locator('#agreementStepSign').screenshot({ path: `${OUT}/${tag}-3b-sign.png` });
    await p.evaluate(() => signAgreement('onsite'));
    await p.waitForTimeout(600);
    await p.evaluate(() => openAgreementSheet());
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${OUT}/${tag}-4-signed.png`, clip: { x: 0, y: 0, width: W, height: 1100 } });
    await ctx.close();
  }
  await b.close();
  console.log(errs.length ? errs.join('\n') : 'no page errors');
})();
