// Opening the app on a weak signal, where every call to the account takes
// 15 seconds. The splash stays up (the screen is never blank), a phone that
// has kept the business opens within a few seconds with it, and the
// account's copy is taken in when it lands. A phone without it (a new one)
// waits for the account, so it never offers to set the business up again.
// node e2e.js <outDir>  (server on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/slow-signal'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', uid = 'u-owner', DELAY = 15000;
const user = { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } };
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
const wait = ms => new Promise(r => setTimeout(r, ms));

// One phone: whether it kept the business and finished setting up, and
// whether its sign-in has run out (so it's refreshed first).
async function open(b, { kept, expired }) {
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/sentry|posthog|maps\.googleapis|cdnjs/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, async r => { await wait(DELAY); r.fulfill({ json: { plan: 'starter', status: 'active', configured: false } }).catch(() => {}); });
  const landed = {};
  await ctx.route(/supabase\.co/, async r => {
    const u = r.request().url(); await wait(DELAY);
    if (u.includes('/auth/v1/token')) { landed.token = true; return r.fulfill({ json: { access_token: 'n.e.w', refresh_token: 'r2', expires_at: Math.floor(Date.now() / 1000) + 3600, user } }).catch(() => {}); }
    if (r.request().method() === 'PATCH') { landed.patch = (landed.patch || 0) + 1; return r.fulfill({ status: 204, body: '' }).catch(() => {}); }
    // The account's business: its details were changed on another device
    // after this phone last saw them.
    if (u.includes('businesses?owner_id') || u.includes('businesses?id=eq.b1')) { landed.business = true; return r.fulfill({ json: [{ id: 'b1', name: 'Example Pest Co', owner_id: uid, settings: { company: { name: 'Example Pest Co', phone: '02 9000 0000', updatedAt: Date.now() } } }] }).catch(() => {}); }
    if (u.includes('team_members?business_id')) { landed.team = true; return r.fulfill({ json: [{ id: 't1' }] }).catch(() => {}); }
    r.fulfill({ json: [] }).catch(() => {});
  });
  await ctx.addInitScript(({ user, kept, expired }) => {
    if (localStorage.getItem('korva_session')) return;
    localStorage.setItem('korva_session', JSON.stringify({ access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + (expired ? -100 : 3600), user }));
    if (kept) {
      localStorage.setItem('korva_business_cache', JSON.stringify({ user_id: user.id, business: { id: 'b1', name: 'Example Pest Co', owner_id: user.id, settings: {} } }));
      localStorage.setItem('korva_onboarded_v1:' + user.id, '1');
      localStorage.setItem('korva_company_b1', JSON.stringify({ name: 'Example Pest Co', updatedAt: 1 }));
    }
  }, { user, kept, expired });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const t0 = Date.now();
  await p.goto(`http://localhost:${PORT}/`);
  const at = () => (Date.now() - t0) / 1000;
  const screen = () => p.evaluate(() => {
    const shown = id => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== 'none'; };
    return { splash: shown('splash') ? document.getElementById('splashStatus').textContent : null, app: document.getElementById('app').style.display === 'flex',
      setup: shown('onboardScreen'), signIn: shown('authScreen'), business: typeof authBusiness !== 'undefined' && authBusiness ? authBusiness.id : null,
      phone: getCompanyDetails().phone || '', token: typeof authSession !== 'undefined' && authSession ? authSession.access_token : null };
  });
  // Something is on screen the whole time: the splash, then the app.
  const seen = [];
  let blank = 0;
  while (at() < 30) {
    const s = await screen(); seen.push([at(), s]);
    if (!s.splash && !s.app && !s.setup && !s.signIn) blank++;
    if (s.app && (!kept || s.phone)) break;
    await p.waitForTimeout(250);
  }
  return { ctx, p, errs, seen, blank, landed, screen, at };
}

(async () => {
  const b = await chromium.launch();

  // 1. A phone that kept the business, sign-in still good.
  let r = await open(b, { kept: true });
  let opened = r.seen.find(([, s]) => s.app);
  check(!r.blank, 'the screen is never blank while it signs in');
  check(r.seen.some(([t, s]) => s.splash === 'Signing in…'), 'the splash says "Signing in…" while it waits');
  check(opened && opened[0] < 10, `the app opens in a few seconds with the business kept on the phone (${opened ? opened[0].toFixed(1) + ' s' : 'not opened'})`);
  check(opened && opened[1].business === 'b1' && !opened[1].setup, 'with the business, and no "Set up your business"');
  await r.p.screenshot({ path: `${OUT}/1-opened.png` });
  // The business, then the check that the owner is on its team: two calls.
  while (!r.landed.team && r.at() < 45) await r.p.waitForTimeout(250);
  await r.p.waitForTimeout(1000);
  check((await r.screen()).phone === '02 9000 0000', "the account's copy of the business is taken in when it lands");
  check(!r.landed.patch, "and this phone's older details are not written over it" + (r.landed.patch ? ` (${r.landed.patch} writes)` : ''));
  check(!r.errs.length, 'no page errors' + (r.errs.length ? ': ' + r.errs.join(' | ') : ''));
  await r.ctx.close();

  // 2. The same phone with its sign-in run out: refreshed in the background.
  r = await open(b, { kept: true, expired: true });
  opened = r.seen.find(([, s]) => s.app);
  check(!r.blank && opened && opened[0] < 10, `sign-in run out: the app still opens in a few seconds (${opened ? opened[0].toFixed(1) + ' s' : 'not opened'})`);
  while (!r.landed.token && r.at() < 25) await r.p.waitForTimeout(250);
  await r.p.waitForTimeout(500);
  check((await r.screen()).token === 'n.e.w', 'and the refreshed sign-in is used once it lands');
  check(!r.errs.length, 'no page errors' + (r.errs.length ? ': ' + r.errs.join(' | ') : ''));
  await r.ctx.close();

  // 3. A new phone: nothing kept, so it waits for the account.
  r = await open(b, { kept: false });
  const at9 = r.seen.filter(([t]) => t > 8 && t < 12);
  check(!r.blank, 'a new phone: the screen is never blank while it waits');
  check(at9.length && at9.every(([, s]) => s.splash && !s.setup), 'it waits on the splash for the account rather than opening without the business');
  const after = r.seen[r.seen.length - 1][1];
  check(after.business === 'b1' && !after.setup, 'and opens with the business once it lands, without "Set up your business"');
  check(!r.errs.length, 'no page errors' + (r.errs.length ? ': ' + r.errs.join(' | ') : ''));
  await r.ctx.close();

  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
  process.exit(fails.length ? 1 : 0);
})();
