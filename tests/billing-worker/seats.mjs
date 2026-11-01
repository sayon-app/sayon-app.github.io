// The Worker's per-inspector billing: checkout seats, the shared AI
// allowance, changing seats and switching plans in place. Supabase and
// Stripe are stand-ins. node tests/billing-worker/seats.mjs
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// worker.js is an ES module pasted into Cloudflare; copied as .mjs so Node loads it as one.
const here = dirname(fileURLToPath(import.meta.url));
const copy = join(mkdtempSync(join(tmpdir(), 'sayon-worker-')), 'worker.mjs');
writeFileSync(copy, readFileSync(join(here, '../../worker/worker.js')));
const { default: worker } = await import(pathToFileURL(copy).href);
const env = { STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'wh', SUPABASE_SERVICE_ROLE_KEY: 'srk', STRIPE_PRICE_STARTER: 'price_solo', STRIPE_PRICE_PRO: 'price_team', STRIPE_PRICE_BUSINESS: 'price_biz' };
const db = { sub: { id: 's1', business_id: 'b1', plan: 'trial', status: 'trialing', trial_ends_at: new Date(Date.now()+864e5).toISOString(), period_start: new Date().toISOString(), ai_calls_used_this_period: 0, stripe_customer_id: null, stripe_subscription_id: null, seats: 1 }, members: 1, invites: 0, stripe: [] };
let stripeSub = null;
globalThis.fetch = async (url, init = {}) => {
  url = String(url); const m = init.method || 'GET';
  const J = (o, st = 200, h = {}) => new Response(JSON.stringify(o), { status: st, headers: { 'Content-Type': 'application/json', ...h } });
  if (url.includes('/auth/v1/user')) return J({ id: 'u1', email: 'o@x.com' });
  if (url.includes('/rest/v1/team_members?user_id')) return J([{ business_id: 'b1' }]);
  if (url.includes('/rest/v1/businesses?id=eq.b1&select=owner_id')) return J([{ owner_id: 'u1' }]);
  if (m === 'HEAD' && url.includes('/rest/v1/team_members')) return new Response(null, { status: 200, headers: { 'Content-Range': `0-0/${db.members}` } });
  if (m === 'HEAD' && url.includes('/rest/v1/invites')) return new Response(null, { status: 200, headers: { 'Content-Range': `*/${db.invites}` } });
  if (url.includes('/rest/v1/subscriptions')) {
    if (m === 'PATCH') { const p = JSON.parse(init.body); Object.assign(db.sub, p); return J([db.sub]); }
    return J([db.sub]);
  }
  if (url.startsWith('https://api.stripe.com')) {
    const body = init.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : null;
    db.stripe.push({ m, path: url.slice(25), body });
    if (url.includes('/checkout/sessions')) return J({ url: 'https://checkout' });
    if (url.includes('/customers')) return J({ id: 'cus_1' });
    if (url.includes('/billing_portal')) return J({ url: 'https://portal' });
    if (url.match(/\/subscriptions\/sub_1$/)) {
      if (m === 'POST') { stripeSub.items.data[0].quantity = +body['items[0][quantity]']; if (body['items[0][price]']) stripeSub.items.data[0].price.id = body['items[0][price]']; }
      return J(stripeSub);
    }
    if (url.includes('/subscriptions?customer')) return J({ data: [] });
  }
  throw new Error('unmocked ' + m + ' ' + url);
};
const call = async (path, body, method = 'POST') => {
  const r = await worker.fetch(new Request('https://w' + path, { method, headers: { Origin: 'https://sayon-app.github.io', Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body || {}) : undefined }), env);
  return { status: r.status, json: await r.json().catch(() => null) };
};
const ok = (c, what) => { console.log((c ? 'ok   ' : 'FAIL ') + what); if (!c) process.exitCode = 1; };
let r = await call('/stripe/subscription-status', null, 'GET');
ok(r.json.seat_plans === true && r.json.seats === 1 && r.json.per_seat === false && r.json.limit === 50, 'status on trial ' + JSON.stringify(r.json));
r = await call('/stripe/create-checkout-session', { plan: 'pro', seats: 1 }); ok(r.status === 400, 'team with 1 seat refused');
r = await call('/stripe/create-checkout-session', { plan: 'pro', seats: 10 }); ok(r.status === 400, 'team with 10 refused');
r = await call('/stripe/create-checkout-session', { plan: 'business', seats: 9 }); ok(r.status === 400, 'business with 9 refused');
db.stripe = [];
r = await call('/stripe/create-checkout-session', { plan: 'pro', seats: 4 });
const co = db.stripe.find(x => x.path === '/checkout/sessions');
ok(r.status === 200 && co.body['line_items[0][quantity]'] === '4' && co.body['line_items[0][price]'] === 'price_team', 'team checkout charges 4 seats');
db.stripe = [];
r = await call('/stripe/create-checkout-session', { plan: 'starter', seats: 7 });
ok(db.stripe.find(x => x.path === '/checkout/sessions').body['line_items[0][quantity]'] === '1', 'solo ignores seats');
// webhook-equivalent: simulate paid team 4 seats
stripeSub = { id: 'sub_1', customer: 'cus_1', status: 'active', metadata: { business_id: 'b1' }, items: { data: [{ id: 'si_1', quantity: 4, price: { id: 'price_team' } }] } };
Object.assign(db.sub, { plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1', seats: 4 });
r = await call('/stripe/subscription-status', null, 'GET'); ok(r.json.limit === 3200 && r.json.per_seat, 'team 4 seats = 3200 fills');
db.members = 3; db.invites = 1;
r = await call('/stripe/update-seats', { seats: 3 }); ok(r.status === 409 && r.json.taken === 4, 'cannot drop below people on team');
r = await call('/stripe/update-seats', { seats: 12 }); ok(r.status === 400, 'team max 9');
db.stripe = [];
r = await call('/stripe/update-seats', { seats: 6 });
let up = db.stripe.find(x => x.m === 'POST');
ok(r.status === 200 && up.body['items[0][quantity]'] === '6' && up.body.proration_behavior === 'always_invoice' && db.sub.seats === 6, 'add seats charged now, stored ' + db.sub.seats);
db.stripe = []; db.invites = 0;
r = await call('/stripe/update-seats', { seats: 4 }); up = db.stripe.find(x => x.m === 'POST');
ok(r.status === 200 && up.body.proration_behavior === 'none' && db.sub.seats === 4, 'remove seats no refund');
r = await call('/stripe/create-checkout-session', { plan: 'pro', seats: 4 }); ok(r.status === 400, 'same plan refused');
r = await call('/stripe/create-checkout-session', { plan: 'starter' }); ok(r.status === 409, 'team of 3 cannot switch to solo');
db.stripe = [];
r = await call('/stripe/create-checkout-session', { plan: 'business', seats: 12 });
up = db.stripe.find(x => x.m === 'POST');
ok(r.status === 200 && r.json.switched && up.body['items[0][price]'] === 'price_biz' && db.sub.plan === 'business' && db.sub.seats === 12, 'switch to business 12 in place');
r = await call('/stripe/subscription-status', null, 'GET'); ok(r.json.limit === 9600, 'business 12 seats = 9600');
db.members = 1;
r = await call('/stripe/create-checkout-session', { plan: 'starter' });
ok(r.status === 200 && db.sub.plan === 'starter' && db.sub.seats === 1, 'switch down to solo, seats 1');
r = await call('/stripe/update-seats', { seats: 3 }); ok(r.status === 400, 'solo cannot change seats');
// sub row without seats column
delete db.sub.seats; Object.assign(db.sub, { plan: 'pro' });
r = await call('/stripe/subscription-status', null, 'GET'); ok(r.json.seats === 1 && r.json.limit === 800, 'missing column reads as 1 seat');
