// The Worker's card payments on invoices (Stripe Connect): the business's
// own Stripe account, the Pay by card link for an invoice, whether it's
// been paid, and switching a link off. Supabase and Stripe are stand-ins.
// node tests/billing-worker/connect.mjs
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
// The row before supabase/card-payments.sql has run has no column for the account.
const db = { owner: 'u1', sub: { id: 's1', business_id: 'b1', plan: 'starter', status: 'active', period_start: new Date().toISOString(), ai_calls_used_this_period: 0, stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', seats: 1 }, stripe: [] };
// Stripe's side: the connected accounts, and the links made on them.
const stripe = { accounts: {}, links: {}, n: 0 };
globalThis.fetch = async (url, init = {}) => {
  url = String(url); const m = init.method || 'GET';
  const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { 'Content-Type': 'application/json' } });
  if (url.includes('/auth/v1/user')) return J({ id: 'u1', email: 'o@x.com' });
  if (url.includes('/rest/v1/team_members?user_id')) return J([{ business_id: 'b1' }]);
  if (url.includes('/rest/v1/businesses?id=eq.b1&select=owner_id')) return J([{ owner_id: db.owner }]);
  if (url.includes('/rest/v1/subscriptions')) {
    if (m === 'PATCH') {
      // A conditional update: it lands only if the row still matches.
      const want = /stripe_connect_account_id=(is\.null|eq\.([^&]+))/.exec(url);
      if (want && (db.sub.stripe_connect_account_id || null) !== (want[2] ? decodeURIComponent(want[2]) : null)) return J([]);
      Object.assign(db.sub, JSON.parse(init.body)); return J([db.sub]);
    }
    return J([db.sub]);
  }
  if (url.startsWith('https://api.stripe.com')) {
    const path = url.slice(25), body = init.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : null, on = (init.headers || {})['Stripe-Account'] || '';
    db.stripe.push({ m, path, body, on });
    let x;
    if (m === 'POST' && path === '/accounts') { const id = 'acct_' + (++stripe.n); stripe.accounts[id] = { id, charges_enabled: false, details_submitted: false }; return J(stripe.accounts[id]); }
    if ((x = /^\/accounts\/(acct_\w+)$/.exec(path))) return stripe.accounts[x[1]] ? J(stripe.accounts[x[1]]) : J({ error: { message: 'The provided key does not have access to that account' } }, 403);
    if (path === '/account_links') return J({ url: 'https://connect.stripe.com/setup/' + body.account });
    if (path === '/prices') return J({ id: 'price_' + (++stripe.n) });
    if (m === 'POST' && path === '/payment_links') { const id = 'plink_' + (++stripe.n); stripe.links[id] = { id, url: 'https://buy.stripe.com/test_' + id, active: true, restrictions: { completed_sessions: { count: 0, limit: 1 } } }; return J(stripe.links[id]); }
    if ((x = /^\/payment_links\/(plink_\w+)$/.exec(path))) {
      const link = stripe.links[x[1]];
      if (!link) return J({ error: { message: 'No such payment link' } }, 404);
      if (m === 'POST') link.active = body.active !== 'false';
      return J(link);
    }
    if (path.startsWith('/checkout/sessions?payment_link=')) return J({ data: [{ created: 1794614400, payment_status: 'paid' }] });
    if (path.startsWith('/billing_portal')) return J({ url: 'https://portal' });
  }
  throw new Error('unmocked ' + m + ' ' + url);
};
const call = async (path, body, method = 'POST') => {
  const r = await worker.fetch(new Request('https://w' + path, { method, headers: { Origin: 'https://sayon-app.github.io', Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body || {}) : undefined }), env);
  return { status: r.status, json: await r.json().catch(() => null) };
};
const ok = (c, what) => { console.log((c ? 'ok   ' : 'FAIL ') + what); if (!c) process.exitCode = 1; };
const posts = path => db.stripe.filter(x => x.m === 'POST' && x.path === path);
const invoice = { number: 'INV-20261114-4821', address: '12 Wattle Street, Sampleville QLD 4000', amount_cents: 198000, report_id: 'report_1' };

// Before anyone sets it up.
let r = await call('/stripe/connect/status', null, 'GET');
ok(r.status === 200 && r.json.connected === false && r.json.ready === false && !db.stripe.length, 'with no account, status says not connected and asks Stripe nothing');
r = await call('/stripe/connect/payment-link', invoice);
ok(r.status === 409 && r.json.code === 'NOT_CONNECTED' && !db.stripe.length, 'no link before card payments are set up');
r = await call('/stripe/connect/payment-status', { ids: ['plink_1'] });
ok(r.status === 200 && JSON.stringify(r.json.paid) === '{}', 'and nothing reads as paid');

// Only the owner opens the business's Stripe account.
db.owner = 'someone-else';
r = await call('/stripe/connect/onboard', {});
ok(r.status === 403 && !posts('/accounts').length, 'an inspector on the team can\'t set up card payments');
db.owner = 'u1';
r = await call('/stripe/connect/onboard', { returnUrl: 'https://evil.example/?x' });
const made = posts('/accounts')[0], linked = posts('/account_links')[0];
ok(r.status === 200 && r.json.url === 'https://connect.stripe.com/setup/acct_1' && made.body.type === 'standard' && made.body.country === 'AU' && made.body['metadata[business_id]'] === 'b1' && !made.on, 'the owner gets Stripe\'s sign-up link for a new account of their own');
ok(db.sub.stripe_connect_account_id === 'acct_1', 'the account is kept on the business\'s row');
ok(linked.body.return_url === 'https://sayon-app.github.io/?billing=cards' && linked.body.type === 'account_onboarding', 'Stripe only ever sends them back to SAYON: ' + linked.body.return_url);
r = await call('/stripe/connect/onboard', { returnUrl: 'https://sayon-app.github.io/?billing=cards' });
ok(r.status === 200 && posts('/accounts').length === 1 && posts('/account_links').length === 2, 'going back to finish reuses the account');

// Not ready until Stripe has what it needs.
r = await call('/stripe/connect/status', null, 'GET');
ok(r.json.connected === true && r.json.ready === false, 'connected, not ready, while Stripe still needs details');
r = await call('/stripe/connect/payment-link', invoice);
ok(r.status === 409 && r.json.code === 'NOT_READY' && !posts('/prices').length, 'no link until the account can take payments');
Object.assign(stripe.accounts.acct_1, { charges_enabled: true, details_submitted: true });
r = await call('/stripe/connect/status', null, 'GET');
ok(r.json.connected === true && r.json.ready === true, 'ready once Stripe says charges are on');

// The link for one invoice.
for (const bad of [0, 99, 5000001, 1980.5, '198000', null]) {
  r = await call('/stripe/connect/payment-link', { ...invoice, amount_cents: bad });
  if (r.status !== 400) ok(false, 'an amount of ' + JSON.stringify(bad) + ' is refused');
}
ok(!posts('/prices').length, 'amounts under $1, over $50,000 or not whole cents are refused');
r = await call('/stripe/connect/payment-link', { ...invoice, number: '  ' });
ok(r.status === 400 && !posts('/prices').length, 'an invoice with no number is refused');
// An inspector on the team can email an invoice, and can't choose the account.
db.owner = 'someone-else';
r = await call('/stripe/connect/payment-link', { ...invoice, account: 'acct_evil', address: '12 Wattle Street,\nSampleville QLD 4000' });
db.owner = 'u1';
const price = posts('/prices')[0], plink = posts('/payment_links')[0];
ok(r.status === 200 && /^plink_/.test(r.json.id) && /^https:\/\/buy\.stripe\.com\//.test(r.json.url), 'an inspector gets the Pay by card link: ' + JSON.stringify(r.json));
ok(price.on === 'acct_1' && plink.on === 'acct_1', 'made on the business\'s own account, whatever the app sends');
ok(price.body.currency === 'aud' && price.body.unit_amount === '198000' && price.body['product_data[name]'] === 'Invoice INV-20261114-4821, 12 Wattle Street, Sampleville QLD 4000', 'for the invoice\'s amount, named by its number and address: ' + price.body['product_data[name]']);
ok(plink.body['payment_method_types[0]'] === 'card' && plink.body['restrictions[completed_sessions][limit]'] === '1' && plink.body['line_items[0][quantity]'] === '1' && plink.body['metadata[sayon_invoice]'] === invoice.number, 'card only, one payment, tagged with the invoice');
ok(!Object.keys(plink.body).some(k => /application_fee/.test(k)), 'SAYON takes no fee');
const linkId = r.json.id;

// Has it been paid?
db.stripe = [];
r = await call('/stripe/connect/payment-status', { ids: [linkId, 'plink_unknown', 'acct_1', 'plink_../x', 42] });
ok(r.status === 200 && r.json.paid[linkId] === false && r.json.paid.plink_unknown === false && Object.keys(r.json.paid).length === 2, 'unpaid reads false, and only link ids are asked about: ' + JSON.stringify(r.json.paid));
ok(db.stripe.every(x => x.on === 'acct_1'), 'asked on the business\'s own account');
stripe.links[linkId].restrictions.completed_sessions.count = 1; stripe.links[linkId].active = false;
r = await call('/stripe/connect/payment-status', { ids: [linkId] });
ok(r.json.paid[linkId] && r.json.paid[linkId].at === 1794614400, 'paid, with when: ' + JSON.stringify(r.json.paid));
db.stripe = [];
r = await call('/stripe/connect/payment-status', { ids: Array.from({ length: 60 }, (x, i) => 'plink_many' + i) });
ok(Object.keys(r.json.paid).length === 20 && db.stripe.length === 20, 'twenty links at most in one call');

// Paid another way: the link is switched off.
r = await call('/stripe/connect/payment-link', { ...invoice, number: 'INV-2' });
const second = r.json.id; db.stripe = [];
r = await call('/stripe/connect/close-link', { id: second });
ok(r.status === 200 && r.json.closed === true && stripe.links[second].active === false && db.stripe[0].on === 'acct_1' && db.stripe[0].body.active === 'false', 'a link can be switched off');
r = await call('/stripe/connect/close-link', { id: 'price_1' });
ok(r.status === 400, 'only a link id is taken');

// The business took SAYON off its Stripe account.
delete stripe.accounts.acct_1;
r = await call('/stripe/connect/status', null, 'GET');
ok(r.status === 200 && r.json.connected === false, 'an account SAYON can no longer reach reads as not connected');
r = await call('/stripe/connect/payment-link', invoice);
ok(r.status === 409 && r.json.code === 'NOT_READY', 'and makes no links');
r = await call('/stripe/connect/onboard', {});
ok(r.status === 200 && db.sub.stripe_connect_account_id !== 'acct_1' && /^acct_/.test(db.sub.stripe_connect_account_id), 'setting up again starts a new account: ' + db.sub.stripe_connect_account_id);

// The rest of billing is as it was.
db.owner = 'someone-else';
r = await call('/stripe/create-portal-session', {});
ok(r.status === 403, 'the plan\'s billing is still the owner\'s alone');
db.owner = 'u1';
r = await call('/stripe/connect/nothing', {});
ok(r.status === 404, 'an unknown card route is not found');
console.log(process.exitCode ? '\nFAILED' : '\nALL PASSED');
