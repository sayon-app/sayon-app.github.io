// Renders report, agreement, quote and certificate PDFs for several sample jobs.
// node pdfs.js <outDir> [PORT]
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2], PORT = process.argv[3] || '8765';
const SP = process.env.JSPDF_DIR || '/tmp/jspdf';
const uid = 'u-owner';
const sess = { access_token:'a.b.c', refresh_token:'r', expires_at: Math.floor(Date.now()/1000)+3600, user:{ id: uid, email:'office@example.com', user_metadata:{ name:'Alex Example', business_name:'Example Pest Co' } } };
const scenarios = require('./scenarios.js');
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  for (const sc of scenarios) {
    if (process.env.ONLY && process.env.ONLY !== sc.name) continue;
    const ctx = await b.newContext({ serviceWorkers:'block', viewport:{ width:390, height:844 }, acceptDownloads:true });
    await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP+'/package/dist/jspdf.umd.min.js'), contentType:'application/javascript' }));
    await ctx.route(/fonts\.g/, r => r.fulfill({ status:200, body:'', contentType:'text/css' }));
    await ctx.route(/sentry|posthog/, r => r.fulfill({ status:200, body:'' }));
    await ctx.route(/workers\.dev/, r => r.fulfill({ json:{ plan:'starter', status:'active', ai_calls_used_this_period:1, limit:150 } }));
    await ctx.route(/supabase\.co/, r => { const u = r.request().url(); if (u.includes('businesses?owner_id')) return r.fulfill({ json:[{ id:'b1', name:'Example Pest Co', owner_id: uid, settings:{} }] }); return r.fulfill({ json:[] }); });
    await ctx.addInitScript((s) => { localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1','1'); }, sess);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3000);
    await p.evaluate(async (sc) => {
      storeCompanyDetails(sc.company);
      openApp('inspect'); resetReportState();
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      for (const [k, v] of Object.entries(sc.job)) set(k, v);
      updateJob();
      populateFields(sc.fields);
    }, sc);
    await p.waitForTimeout(3000);
    await p.evaluate(async (sc) => {
      const mk = (w, h, hue, label) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
        const g = x.createLinearGradient(0,0,w,h); g.addColorStop(0, `hsl(${hue},35%,55%)`); g.addColorStop(1, `hsl(${hue+40},30%,30%)`); x.fillStyle = g; x.fillRect(0,0,w,h);
        x.fillStyle = 'rgba(255,255,255,.85)'; x.font = `${Math.round(h/8)}px sans-serif`; x.fillText(label, w*0.06, h*0.55); return new Promise(r => c.toBlob(r, 'image/jpeg', 0.8)); };
      const add = async (section, n, caption, portrait) => { if (!reportData.photosBySection) reportData.photosBySection = {}; const list = reportData.photosBySection[section] || (reportData.photosBySection[section] = []);
        for (let i = 0; i < n; i++) { const w = portrait ? 900 : 1200, h = portrait ? 1200 : 900; const blob = await mk(w, h, (i*47)%360, `${section} ${i+1}`); const id = genPhotoId(); await putPhotoBlob(id, blob); list.push({ id, width: w, height: h, caption: caption ? `${caption} ${i+1}` : '' }); } };
      for (const ph of (sc.photos || [])) {
        let sec = ph.section;
        if (sec.startsWith('finding#')) { const f = (reportData.findings || [])[+sec.slice(8)]; if (!f) continue; sec = findingPhotoSection(f.id); }
        await add(sec, ph.n, ph.caption, ph.portrait);
      }
      const c = document.createElement('canvas'); c.width = 300; c.height = 90; const x = c.getContext('2d'); x.strokeStyle = '#0c121c'; x.lineWidth = 3; x.beginPath(); x.moveTo(10,60); x.bezierCurveTo(60,10,90,90,140,40); x.bezierCurveTo(170,20,200,70,280,30); x.stroke();
      const sig = c.toDataURL('image/png'); window.__sig = sig;
      reportData.inspectorLicence = sc.company.licence; reportData.inspectorSignature = sig;
      const v = agreementFormValues();
      reportData.agreement = { method:'onsite', signerName: sc.job.jobClient, signature: sig, signedAt: Date.now() - 3600e3, inspectionDate: v.inspectionDate, fee: v.fee || '350', notes: sc.agreementNotes || v.notes, standard: v.standard, text: v.text };
      saveDraft(); renderReportWidgets && renderReportWidgets(); updateProgress();
    }, sc);
    const toB64 = `async blob => { const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768)); return btoa(s); }`;
    const save = async (body, name) => {
      try { const b64 = await p.evaluate(new Function(`return (async () => { const toB64 = ${toB64}; ${body} })()`)); if (b64) { fs.writeFileSync(`${OUT}/${sc.name}-${name}.pdf`, Buffer.from(b64, 'base64')); console.log('saved', sc.name, name); } else console.log('empty', sc.name, name); }
      catch (e) { console.log('FAILED', sc.name, name, e.message.split('\n')[0]); }
    };
    await save(`await ensureJsPDFLoaded(); const r = await buildReportPdf(); return toB64(r.blob);`, 'report');
    await save(`const r = buildAgreementPdf(reportData.agreement); return toB64(r.blob);`, 'agreement');
    await save(`const r = buildAgreementPdf(Object.assign({}, reportData.agreement, { unsigned: true, signature: null })); return toB64(r.blob);`, 'agreement-unsigned');
    await p.evaluate(() => { openQuoteFromReport(); }); await p.waitForTimeout(2000);
    if (sc.quoteTweak) await p.evaluate(sc.quoteTweak);
    await save(`const { blob } = await buildQuotePDF(quoteState); return toB64(blob);`, 'quote');
    await save(`const q = quoteState; const sig = window.__sig;
      q.answer = { status: 'accepted', method: 'onsite', by: document.getElementById('jobClient').value, date: new Date().toISOString().slice(0,10), signature: sig, at: Date.now() };
      const { blob } = await buildQuotePDF(q); return toB64(blob);`, 'quote-accepted');
    await save(`const q = quoteState; const sig = window.__sig;
      q.treatment = Object.assign({ date: new Date().toISOString().slice(0,10), technician: 'Alex Example', licence: 'NSW 000000', supervisor: '', supervisorLicence: '', start: '08:30', finish: '12:00', pest: 'Subterranean termites', weather: 'Fine and dry', equipment: 'Low-pressure sprayer, trenching tools',
        methods: { direct: '', bait: '8' }, products: [{ name: 'Termidor Foam', active: 'fipronil', rate: 'As per label', amount: '2 cans', batch: 'B-0000' }],
        areas: 'Backyard gum tree; perimeter of the house', notTreated: 'Back section of the subfloor (stored items)', sketch: '', notice: 'new', noticeWhere: 'Meter box', cautions: 'Keep garden beds below the slab edge and away from the bait stations', nextInspection: 'In 3 months', warranty: '', notes: '', signature: sig, at: Date.now() }, ${JSON.stringify(sc.treatment || {})});
      const { blob } = await buildTreatmentCertificatePDF(q); return toB64(blob);`, 'certificate');
    console.log(sc.name, 'errors', errs.length ? errs : 'none');
    await ctx.close();
  }
  await b.close();
})();
