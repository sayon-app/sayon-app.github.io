// The move to app.sayon.com.au (Cloudflare Pages, published from `live`):
//   1. served the way Cloudflare Pages serves it (/index.html and /x.html
//      redirect to / and /x, `_headers` applied), the offline copy still
//      opens: from the Home Screen icon (start_url ./index.html), at / and
//      at /?signup=1, online and with no signal;
//   2. the new address lets the old one read its manifest (`_headers`);
//   3. at the old address, sayon-app.github.io, a signed-in inspector's work
//      is backed up and they're sent to the new address, once it's up;
//   4. no notice while the new address doesn't answer, and none at the new
//      address itself.
// Both addresses are stood in for: Cloudflare by a small server here,
// GitHub Pages by serving the repo's files under its name.
// node e2e.js <outDir>
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path'); const http = require('http');
const OUT = process.argv[2] || '/tmp/new-address'; fs.mkdirSync(OUT, { recursive: true });
const ROOT = path.join(__dirname, '../..'); const CF_PORT = 8771;
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.pdf': 'application/pdf', '.svg': 'image/svg+xml' };
const type = f => TYPES[path.extname(f)] || 'application/octet-stream';
const file = rel => { const f = path.join(ROOT, rel); return f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile() ? f : null; };

// `_headers`, read the way Cloudflare Pages reads it: a path line, then
// indented "Name: value" lines.
function headersFor(urlPath) {
  const out = {}; let applies = false;
  for (const line of fs.readFileSync(path.join(ROOT, '_headers'), 'utf8').split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { const pat = line.trim(); applies = pat === urlPath || (pat.endsWith('*') && urlPath.startsWith(pat.slice(0, -1))); continue; }
    if (applies) { const i = line.indexOf(':'); out[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  }
  return out;
}

// Cloudflare Pages: /index.html and /dir/index.html go to /dir/, /x.html
// goes to /x (308, query kept), /x serves x.html.
const cf = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const p = decodeURIComponent(u.pathname);
  const go = to => { res.writeHead(308, { Location: to + u.search }); res.end(); };
  if (/(^|\/)index\.html$/.test(p)) return go(p.replace(/index\.html$/, ''));
  if (p.endsWith('.html')) return go(p.slice(0, -5));
  let f = p.endsWith('/') ? file(p + 'index.html') : (file(p) || file(p + '.html'));
  if (!f && file(p + '/index.html')) return go(p + '/');
  if (!f) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, Object.assign({ 'Content-Type': type(f), 'Cache-Control': 'public, max-age=0, must-revalidate' }, headersFor(p)));
  res.end(fs.readFileSync(f));
});

const stubs = async ctx => {
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/cdnjs\.cloudflare\.com|sentry|posthog|maps\.googleapis|open-meteo/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => r.fulfill({ json: { plan: 'trial', status: 'trialing', ai_calls_used_this_period: 0, limit: 50 } }));
  await ctx.route(/supabase\.co/, r => {
    const u = r.request().url();
    if (u.includes('/rest/v1/businesses')) return r.fulfill({ json: [{ id: 'b-1', name: 'Example Pest Co', owner_id: 'u-1', settings: {} }] });
    return r.fulfill({ json: [] });
  });
};

(async () => {
  await new Promise(r => cf.listen(CF_PORT, r));
  const b = await chromium.launch();

  // ── 1. The offline copy, served the way Cloudflare Pages serves it ──
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    await stubs(ctx);
    const p = await ctx.newPage();
    const base = `http://localhost:${CF_PORT}/`;
    await p.goto(base); await p.waitForTimeout(1500);
    const ready = await p.evaluate(async () => { const reg = await navigator.serviceWorker.ready; return !!reg.active; });
    await p.reload(); await p.waitForTimeout(1500);
    check(ready && await p.evaluate(() => !!navigator.serviceWorker.controller), 'the offline copy installs on the new address');
    const opens = async (url, what) => {
      let err = '';
      try { await p.goto(url, { waitUntil: 'load', timeout: 10000 }); } catch (e) { err = e.message.split('\n')[0]; }
      const ok = !err && await p.evaluate(() => !!document.getElementById('splash') && typeof checkAddressMove === 'function').catch(() => false);
      check(ok, what + (err ? ': ' + err : ''));
    };
    await opens(base + 'index.html', 'the Home Screen icon (./index.html) opens the app, online');
    await ctx.setOffline(true);
    await opens(base + 'index.html', 'the Home Screen icon opens the app with no signal');
    await opens(base, 'the address itself opens with no signal');
    await opens(base + '?signup=1', 'a link with a query (?signup=1) opens with no signal');
    await ctx.setOffline(false);
    await ctx.close();
  }

  // ── 2. The new address lets another address read its manifest ──
  {
    const res = await new Promise(r => http.get(`http://localhost:${CF_PORT}/manifest.json`, r));
    check(res.headers['access-control-allow-origin'] === '*', 'the manifest is readable from the old address (Access-Control-Allow-Origin: *)');
    res.resume();
  }

  // ── 3 and 4. The notice at the old address ──
  const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u-1', email: 'owner@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } } };
  // GitHub Pages under its own name: the repo's files as they are.
  const asGithub = async (ctx, origin) => ctx.route(origin + '/**', r => {
    const p = decodeURIComponent(new URL(r.request().url()).pathname); const f = file(p.endsWith('/') ? p + 'index.html' : p);
    return f ? r.fulfill({ body: fs.readFileSync(f), contentType: type(f), headers: { 'Access-Control-Allow-Origin': '*' } }) : r.fulfill({ status: 404, body: '' });
  });
  // The new address: whatever the Cloudflare stand-in answers, headers and all.
  let newUp = true;
  const asCloudflare = async ctx => ctx.route('https://app.sayon.com.au/**', async r => {
    if (!newUp) return r.abort('namenotresolved');
    const u = new URL(r.request().url());
    const res = await new Promise(done => http.get(`http://localhost:${CF_PORT}${u.pathname}${u.search}`, done));
    const chunks = []; for await (const c of res) chunks.push(c);
    return r.fulfill({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) });
  });
  const visit = async (origin, what) => {
    const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await stubs(ctx); await asGithub(ctx, 'https://sayon-app.github.io'); await asCloudflare(ctx);
    if (origin === 'https://app.sayon.com.au') await asGithub(ctx, origin);
    await ctx.addInitScript(s => localStorage.setItem('korva_session', JSON.stringify(s)), sess);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(origin + '/'); await p.waitForTimeout(4500);
    const st = await p.evaluate(() => ({
      open: document.getElementById('moveOverlay').classList.contains('open'),
      text: document.getElementById('moveText').textContent,
      status: document.getElementById('moveStatus').textContent,
      href: document.getElementById('moveOpenBtn').getAttribute('href'),
      button: !document.getElementById('moveOpenBtn').hidden,
    }));
    return { ctx, p, st, errs };
  };

  newUp = false;
  let v = await visit('https://sayon-app.github.io');
  check(!v.st.open, 'at the old address, no notice while the new address isn\'t up');
  await v.ctx.close();

  newUp = true;
  v = await visit('https://sayon-app.github.io');
  await v.p.screenshot({ path: `${OUT}/1-old-address-notice.png` });
  check(v.st.open && /app\.sayon\.com\.au/.test(v.st.text), 'at the old address, the notice names the new one: ' + v.st.text);
  check(/Everything is backed up/.test(v.st.status) && v.st.button && v.st.href === 'https://app.sayon.com.au/', 'the work is backed up first, then Open the new address goes there: ' + v.st.status + ' ' + v.st.href);
  check(!v.errs.length, 'no page errors at the old address: ' + v.errs.join(' | '));
  await v.ctx.close();

  v = await visit('https://app.sayon.com.au');
  check(!v.st.open, 'at the new address, no notice');
  check(!v.errs.length, 'no page errors at the new address: ' + v.errs.join(' | '));
  await v.ctx.close();

  // The website sends people to the new address.
  const site = fs.readFileSync(path.join(ROOT, 'site/index.html'), 'utf8');
  check(!/sayon-app\.github\.io/.test(site) && (site.match(/https:\/\/app\.sayon\.com\.au\//g) || []).length >= 4, 'the website\'s Sign in and Start your free trial go to app.sayon.com.au');

  await b.close(); cf.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
