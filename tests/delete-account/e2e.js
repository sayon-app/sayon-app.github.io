// Delete my account: removes the user's report photos and the PDFs behind
// their client links (one folder per link) before deleting the account, and
// says how to remove the team when that blocks it. The owner's Stripe
// customer is deleted through the Worker after the checks and before any
// file; an older Worker without that route (404) doesn't hold it up.
// node e2e.js (server on :8765)
const { chromium } = require('playwright');
const PORT = '8765';
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
const USER = { id: 'u-1', email: 'boss@acme.test', user_metadata: { name: 'Bo Boss' } };

async function run(b, { blocker, stripe = { status: 200, json: { deleted: true } } } = {}) {
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|sentry|posthog|maps\.googleapis|cdnjs/, r => r.fulfill({ status: 200, body: '' }));
  const st = { calls: [], photos: ['a.jpg', 'b.jpg'], docs: { f1: ['inspection-report.pdf', 'treatment-quote.pdf'], f2: ['treatment-quote.pdf'] } };
  await ctx.route(/workers\.dev/, r => {
    if (r.request().url().endsWith('/stripe/delete-customer')) { st.calls.push({ path: '/stripe/delete-customer', method: 'POST' }); return r.fulfill(stripe); }
    return r.fulfill({ json: { plan: 'trial', status: 'trialing', limit: 50, ai_calls_used_this_period: 0 } });
  });
  await ctx.route(/supabase\.co/, r => {
    const req = r.request(), u = req.url(), m = req.method();
    const body = req.postData() ? (() => { try { return JSON.parse(req.postData()); } catch { return null; } })() : null;
    st.calls.push({ path: u.replace(/^https:\/\/[^/]+/, ''), method: m, body });
    if (u.includes('/storage/v1/object/list/report-photos')) return r.fulfill({ json: st.photos.map(n => ({ id: 'id-' + n, name: n })) });
    if (u.includes('/storage/v1/object/list/client-docs')) {
      const pre = body.prefix;
      if (pre === 'u-1/') return r.fulfill({ json: Object.keys(st.docs).map(n => ({ id: null, name: n })) });
      const f = pre.split('/')[1]; return r.fulfill({ json: (st.docs[f] || []).map(n => ({ id: 'id-' + n, name: n })) });
    }
    if (m === 'DELETE' && u.includes('/storage/v1/object/report-photos')) { st.photos = []; return r.fulfill({ json: body.prefixes.map(n => ({ name: n })) }); }
    if (m === 'DELETE' && u.includes('/storage/v1/object/client-docs')) { const f = body.prefixes[0].split('/')[1]; st.docs[f] = []; return r.fulfill({ json: body.prefixes.map(n => ({ name: n })) }); }
    if (u.includes('/rpc/delete_my_account')) return blocker ? r.fulfill({ status: 400, json: { message: blocker } }) : r.fulfill({ status: 204, body: '' });
    if (u.includes('/rest/v1/businesses')) return r.fulfill({ json: [{ id: 'b1', name: 'Acme', owner_id: 'u-1', settings: {} }] });
    if (u.includes('/rest/v1/team_members')) return r.fulfill({ json: [{ business_id: 'b1', user_id: 'u-1', role: 'owner' }] });
    return r.fulfill({ json: [] });
  });
  await ctx.addInitScript(u => {
    localStorage.setItem('korva_session', JSON.stringify({ access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: u }));
    localStorage.setItem('korva_onboarded_v1:' + u.id, '1');
    window.prompt = () => 'DELETE'; window.confirm = () => true; window.__toasts = [];
  }, USER);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3200);
  await p.evaluate(() => { const o = window.showToast; window.showToast = (m, k) => { window.__toasts.push(m); return o(m, k); }; });
  await p.evaluate(() => deleteMyAccount()); await p.waitForTimeout(1500);
  const toasts = await p.evaluate(() => window.__toasts);
  await ctx.close();
  return { st, toasts, errs };
}

const callOrder = st => st.calls.map(c => c.path === '/stripe/delete-customer' ? 'stripe' : c.method === 'DELETE' ? 'del' : c.path.includes('delete_my_account') ? (c.body.dry_run ? 'check' : 'rpc') : null).filter(Boolean);

(async () => {
  const b = await chromium.launch();
  {
    const { st, toasts, errs } = await run(b);
    const dels = st.calls.filter(c => c.method === 'DELETE').map(c => c.path.split('/').pop() + ':' + c.body.prefixes.join(','));
    check(dels.includes('report-photos:u-1/a.jpg,u-1/b.jpg'), 'report photos are deleted: ' + dels.join(' | '));
    check(dels.includes('client-docs:u-1/f1/inspection-report.pdf,u-1/f1/treatment-quote.pdf') && dels.includes('client-docs:u-1/f2/treatment-quote.pdf'), 'every client-link PDF folder is emptied');
    const order = callOrder(st);
    check(order[0] === 'check' && order[1] === 'stripe' && order[2] === 'del' && order[order.length - 1] === 'rpc', 'Stripe customer, then files, after the checks and before the account: ' + order.join(','));
    check(toasts.some(t => /account and data have been deleted/.test(t)), 'they are told it is done');
    check(!errs.length, 'no page errors ' + errs.join('; '));
  }
  {
    const { st, toasts } = await run(b, { blocker: 'HAS_TEAM' });
    check(toasts.some(t => /Remove them in Menu › Your team first/.test(t)) && !st.calls.some(c => c.method === 'DELETE'), 'with a team: told to remove them in Your team, nothing deleted');
  }
  {
    const { st, toasts } = await run(b, { stripe: { status: 409, json: { message: 'HAS_TEAM' } } });
    check(toasts.some(t => /Remove them in Menu › Your team first/.test(t)) && callOrder(st).join(',') === 'check,stripe', 'Worker refuses for a team: told why, nothing deleted');
  }
  {
    const { st, toasts } = await run(b, { stripe: { status: 502, json: { message: 'Billing request failed' } } });
    check(toasts.some(t => /Could not close your billing account/.test(t)) && callOrder(st).join(',') === 'check,stripe', 'Stripe fails: account kept, they are told');
  }
  {
    const { st, toasts } = await run(b, { stripe: { status: 404, json: { message: 'Not found' } } });
    check(callOrder(st).at(-1) === 'rpc' && toasts.some(t => /account and data have been deleted/.test(t)), 'older Worker without the route: account still deleted');
  }
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
