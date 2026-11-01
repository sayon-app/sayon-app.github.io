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
const env = { STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'whsec_test', SUPABASE_SERVICE_ROLE_KEY: 'srk', STRIPE_PRICE_STARTER: 'price_solo', STRIPE_PRICE_PRO: 'price_team', STRIPE_PRICE_BUSINESS: 'price_biz' };
const db = { sub: { id: 's1', business_id: 'b1', plan: 'trial', status: 'trialing', trial_ends_at: new Date(Date.now() + 864e5).toISOString(), period_start: new Date().toISOString(), ai_calls_used_this_period: 0, stripe_customer_id: null, stripe_subscription_id: null, seats: 1 }, members: 1, invites: 0, stripe: [] };
let stripeSub = null;       // the subscription as Stripe has it now
let declineNext = false;    // the next paid change gets a declined card
globalThis.fetch = async (url, init = {}) => {
  url = String(url); const m = init.method || 'GET';
  const J = (o, st = 200, h = {}) => new Response(JSON.stringify(o), { status: st, headers: { 'Content-Type': 'application/json', ...h } });
  if (url.includes('/auth/v1/user')) return J({ id: 'u1', email: 'o@x.com' });
  if (url.includes('/rest/v1/team_members?user_id')) return J([{ business_id: 'b1' }]);
  if (url.includes('/rest/v1/businesses?id=eq.b1&select=owner_id')) return J([{ owner_id: 'u1' }]);
  if (m === 'HEAD' && url.includes('/rest/v1/team_members')) return new Response(null, { status: 200, headers: { 'Content-Range': `0-0/${db.members}` } });
  if (m === 'HEAD' && url.includes('/rest/v1/invites')) return new Response(null, { status: 200, headers: { 'Content-Range': `*/${db.invites}` } });
  if (url.includes('/rest/v1/subscriptions')) {
    if (m === 'PATCH') { Object.assign(db.sub, JSON.parse(init.body)); return J([db.sub]); }
    return J([db.sub]);
  }
  if (url.startsWith('https://api.stripe.com')) {
    const body = init.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : null;
    db.stripe.push({ m, path: url.slice(25), body });
    if (url.includes('/checkout/sessions')) return J({ url: 'https://checkout' });
    if (url.includes('/customers')) return J({ id: 'cus_1' });
    if (url.includes('/billing_portal')) return J({ url: 'https://portal' });
    if (url.match(/\/subscriptions\/sub_1$/)) {
      if (m === 'POST') {
        if (declineNext && body.payment_behavior === 'error_if_incomplete') { declineNext = false; return J({ error: { type: 'card_error', message: 'Your card was declined.' } }, 402); }
        stripeSub.items.data[0].quantity = +body['items[0][quantity]'];
        if (body['items[0][price]']) stripeSub.items.data[0].price.id = body['items[0][price]'];
      }
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
// A webhook signed the way Stripe signs it.
const webhook = async (event) => {
  const payload = JSON.stringify(event); const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`));
  const sig = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
  const r = await worker.fetch(new Request('https://w/stripe/webhook', { method: 'POST', headers: { 'Stripe-Signature': `t=${t},v1=${sig}` }, body: payload }), env);
  return r.status;
};
const ok = (c, what) => { console.log((c ? 'ok   ' : 'FAIL ') + what); if (!c) process.exitCode = 1; };
const lastPost = () => db.stripe.filter(x => x.m === 'POST').pop();

let r = await call('/stripe/subscription-status', null, 'GET');
ok(r.json.seat_plans === true && r.json.seats === 1 && r.json.per_seat === false && r.json.limit === 50, 'status on trial');
r = await call('/stripe/create-checkout-session', { plan: 'pro', seats: 1 }); ok(r.status === 400, 'Team with 1 inspector refused');
r = await call('/stripe/create-checkout-session', { plan: 'pro', seats: 10 }); ok(r.status === 400, 'Team with 10 refused');
r = await call('/stripe/create-checkout-session', { plan: 'business', seats: 9 }); ok(r.status === 400, 'Business with 9 refused');
db.stripe = [];
r = await call('/stripe/create-checkout-session', { plan: 'pro', seats: 4 });
const co = db.stripe.find(x => x.path === '/checkout/sessions');
ok(r.status === 200 && co.body['line_items[0][quantity]'] === '4' && co.body['line_items[0][price]'] === 'price_team', 'Team checkout charges 4 inspectors');
db.stripe = [];
r = await call('/stripe/create-checkout-session', { plan: 'starter', seats: 7 });
ok(db.stripe.find(x => x.path === '/checkout/sessions').body['line_items[0][quantity]'] === '1', 'Solo ignores seats');
db.members = 2; db.invites = 1; db.stripe = [];
r = await call('/stripe/create-checkout-session', { plan: 'starter' });
ok(r.status === 409 && r.json.taken === 3 && !db.stripe.some(x => x.path === '/checkout/sessions'), 'a trial team of 3 cannot buy Solo');
r = await call('/stripe/create-checkout-session', { plan: 'pro', seats: 2 });
ok(r.status === 409, 'a trial team of 3 cannot buy Team for 2');
r = await call('/stripe/create-checkout-session', { plan: 'pro', seats: 3 });
ok(r.status === 200, 'Team for 3 fits a team of 3');

// Paid Team, 4 inspectors.
stripeSub = { id: 'sub_1', customer: 'cus_1', status: 'active', metadata: { business_id: 'b1' }, items: { data: [{ id: 'si_1', quantity: 4, price: { id: 'price_team' } }] } };
Object.assign(db.sub, { plan: 'pro', status: 'active', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', seats: 4 });
r = await call('/stripe/subscription-status', null, 'GET'); ok(r.json.limit === 3200 && r.json.per_seat, 'Team of 4 gets 3200 fills');
db.members = 3; db.invites = 1;
r = await call('/stripe/update-seats', { seats: 3 }); ok(r.status === 409 && r.json.taken === 4, 'cannot pay for fewer places than people');
r = await call('/stripe/update-seats', { seats: 12 }); ok(r.status === 400, 'Team stops at 9');
db.stripe = [];
r = await call('/stripe/update-seats', { seats: 6 }); let up = lastPost();
ok(r.status === 200 && up.body['items[0][quantity]'] === '6' && up.body.proration_behavior === 'always_invoice' && up.body.payment_behavior === 'error_if_incomplete' && db.sub.seats === 6, 'more places: charged now, only if paid, stored');
declineNext = true;
r = await call('/stripe/update-seats', { seats: 8 });
ok(r.status === 402 && db.sub.seats === 6 && stripeSub.items.data[0].quantity === 6, 'a declined card leaves the places as they were');
db.invites = 0;
r = await call('/stripe/update-seats', { seats: 4 }); up = lastPost();
ok(r.status === 200 && up.body.proration_behavior === 'create_prorations' && !up.body.payment_behavior && db.sub.seats === 4, 'fewer places: unused part comes off the next bill');
db.sub.status = 'past_due';
r = await call('/stripe/update-seats', { seats: 5 }); ok(r.status === 402, 'no extra places while a payment is overdue');
r = await call('/stripe/create-checkout-session', { plan: 'business', seats: 200 }); ok(r.status === 402, 'no switch to a bigger plan while overdue');
db.sub.status = 'active';
r = await call('/stripe/create-checkout-session', { plan: 'pro', seats: 4 }); ok(r.status === 400, 'same plan refused');
r = await call('/stripe/create-checkout-session', { plan: 'starter' }); ok(r.status === 409, 'a team of 3 cannot switch to Solo');
declineNext = true;
r = await call('/stripe/create-checkout-session', { plan: 'business', seats: 12 });
ok(r.status === 402 && db.sub.plan === 'pro' && db.sub.seats === 4, 'a declined switch leaves the plan as it was');
db.stripe = [];
r = await call('/stripe/create-checkout-session', { plan: 'business', seats: 12 }); up = lastPost();
ok(r.status === 200 && r.json.switched && up.body['items[0][price]'] === 'price_biz' && up.body.payment_behavior === 'error_if_incomplete' && db.sub.plan === 'business' && db.sub.seats === 12, 'switch to Business for 12 in place');
r = await call('/stripe/subscription-status', null, 'GET'); ok(r.json.limit === 9600, 'Business for 12 gets 9600 fills');

// A late webhook event carrying an old quantity doesn't undo the change.
const stale = JSON.parse(JSON.stringify(stripeSub)); stale.items.data[0].quantity = 2; stale.items.data[0].price.id = 'price_team';
const st = await webhook({ type: 'customer.subscription.updated', data: { object: stale } });
ok(st === 200 && db.sub.seats === 12 && db.sub.plan === 'business', 'a late webhook is read back from Stripe, not trusted as sent');

db.members = 1;
r = await call('/stripe/create-checkout-session', { plan: 'starter' });
ok(r.status === 200 && db.sub.plan === 'starter' && db.sub.seats === 1, 'switch down to Solo stores 1 place');
r = await call('/stripe/update-seats', { seats: 3 }); ok(r.status === 400, 'Solo has no places to change');
delete db.sub.seats; Object.assign(db.sub, { plan: 'pro' });
r = await call('/stripe/subscription-status', null, 'GET'); ok(r.json.seats === 1 && r.json.limit === 800, 'before the seats column exists a business reads as 1 place');
