// Team and Business, charged per inspector: Billing offers them only once
// the Worker says it can (seat_plans), works out the price for the number
// of inspectors, sends that number to checkout and changes it on the
// current plan. Your team invites by email, counts places and makes a
// sign-up link with a secret; that link names the business on the sign-up
// card and joins it with nothing to set up. A wrong email, a dead link or
// no free place never joins anyone. A technician sees no plans to buy.
// node e2e.js <outDir> (server on :8765)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/team-seats'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf';
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
const OWNER = { id: 'u-owner', email: 'boss@acme.test', user_metadata: { name: 'Bo Boss', business_name: 'Acme Pest' } };
const TECH = { id: 'u-tech', email: 'tech@acme.test', user_metadata: { name: 'Tia Tech' } };
const BIZ_ID = 'b0000000-0000-4000-8000-00000000ac3e';
const TOKEN = 'a'.repeat(64), TOKEN2 = 'b'.repeat(64);
const BIZ = { id: BIZ_ID, name: 'Acme Pest', owner_id: 'u-owner', settings: { company: { name: 'Acme Pest', updatedAt: 1 } } };

async function setup(b, { user, sub, members, invites }) {
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://localhost:${PORT}` });
  if (fs.existsSync((process.env.FONTS_DIR || '/tmp/fonts') + '/fonts.css')) await require('../visual/fonts-route.js')(ctx);
  else await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => fs.existsSync(SP + '/package/dist/jspdf.umd.min.js') ? r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }) : r.fulfill({ body: '' }));
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  const st = { sub, members: members || [{ user_id: 'u-owner', role: 'owner', name: 'Bo Boss', email: 'boss@acme.test' }], invites: invites || [], calls: [], user, acceptReturns: null, invite: null };
  await ctx.route(/workers\.dev/, async r => {
    const req = r.request(); const path = req.url().replace(/^https:\/\/[^/]+/, '');
    const body = req.postData() ? JSON.parse(req.postData()) : null; st.calls.push({ path, body });
    if (path.startsWith('/stripe/subscription-status')) return r.fulfill({ json: st.sub });
    if (path.startsWith('/stripe/create-checkout-session')) return r.fulfill({ json: { url: `http://localhost:${PORT}/?billing=cancelled` } });
    if (path.startsWith('/stripe/update-seats')) { st.sub = Object.assign({}, st.sub, { seats: body.seats, limit: 800 * body.seats }); return r.fulfill({ json: { seats: body.seats } }); }
    return r.fulfill({ json: {} });
  });
  await ctx.route(/supabase\.co/, r => {
    const req = r.request(), u = req.url(), m = req.method();
    const body = req.postData() ? (() => { try { return JSON.parse(req.postData()); } catch { return null; } })() : null;
    st.calls.push({ path: u.replace(/^https:\/\/[^/]+/, ''), method: m, body });
    if (u.includes('/auth/v1/signup')) { st.user = Object.assign({}, TECH, { email: body.email }); return r.fulfill({ json: { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: st.user } }); }
    if (u.includes('/auth/v1/')) return r.fulfill({ json: {} });
    if (u.includes('/rpc/accept_invite')) {
      if (st.acceptReturns === 'NO_SEATS') return r.fulfill({ status: 400, json: { code: 'P0001', message: 'NO_SEATS' } });
      return r.fulfill({ json: body && body.p_token === TOKEN ? st.acceptReturns : null });
    }
    if (u.includes('/rpc/get_invite')) return r.fulfill({ json: body && body.p_token === TOKEN ? st.invite : null });
    if (u.includes('/rpc/invite_link')) return r.fulfill({ json: TOKEN2 });
    if (u.includes('/rpc/invite_member')) {
      const cap = st.sub.plan === 'trial' ? 3 : st.sub.seats;
      if (st.members.length + st.invites.length >= cap) return r.fulfill({ json: { status: 'no_seats' } });
      st.invites.push({ id: 'i-' + st.invites.length, email: body.p_email }); return r.fulfill({ json: { status: 'invited', token: TOKEN } });
    }
    if (u.includes('/rest/v1/team_members')) {
      if (m === 'DELETE') { const id = decodeURIComponent((u.match(/user_id=eq\.([^&]+)/) || [])[1]); st.members = st.members.filter(x => x.user_id !== id); return r.fulfill({ status: 204, body: '' }); }
      if (u.includes('user_id=eq.u-owner')) return r.fulfill({ json: [st.members[0]] });
      if (u.includes('user_id=eq.u-tech')) return r.fulfill({ json: st.techMember ? [{ business_id: BIZ_ID, user_id: 'u-tech', role: 'technician' }] : [] });
      return r.fulfill({ json: st.members });
    }
    if (u.includes('/rest/v1/invites')) {
      if (m === 'DELETE') { const id = decodeURIComponent((u.match(/id=eq\.([^&]+)/) || [])[1]); st.invites = st.invites.filter(x => x.id !== id); return r.fulfill({ status: 204, body: '' }); }
      return r.fulfill({ json: st.invites });
    }
    if (u.includes('/rest/v1/businesses')) {
      if (m === 'POST') { st.madeBusiness = true; return r.fulfill({ json: [Object.assign({ id: 'b-new', settings: {} }, body)] }); }
      if (u.includes('owner_id=eq.u-owner') || u.includes('id=eq.' + BIZ_ID)) return r.fulfill({ json: [BIZ] });
      return r.fulfill({ json: [] });
    }
    if (m === 'POST' || m === 'PATCH') return r.fulfill({ json: [{ id: 'x' }] });
    return r.fulfill({ json: [] });
  });
  if (user) await ctx.addInitScript(([u]) => {
    localStorage.setItem('korva_session', JSON.stringify({ access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: u }));
    localStorage.setItem('korva_onboarded_v1:' + u.id, '1');
  }, [user]);
  await ctx.addInitScript(() => { window.__toasts = []; window.confirm = () => true; });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.hookToasts = () => p.evaluate(() => { const o = window.showToast; window.showToast = (m, k) => { window.__toasts.push(k + ': ' + m); return o && o(m, k); }; });
  p.toasts = () => p.evaluate(() => window.__toasts.splice(0));
  return { ctx, p, st, errs };
}

const trial = (extra) => Object.assign({ plan: 'trial', status: 'trialing', ai_calls_used_this_period: 3, limit: 50, trial_ends_at: new Date(Date.now() + 5 * 864e5).toISOString(), subscribed: false, seats: 1, per_seat: false }, extra);
const openBilling = async p => { await p.evaluate(() => openMenuPage('billingPanel')); await p.waitForTimeout(600); };
const rowState = p => p.evaluate(() => [...document.querySelectorAll('#billingPanel [data-plan]')].map(r => r.dataset.plan + (r.hidden ? ':hidden' : ':' + r.querySelector('button').textContent + (r.querySelector('button').disabled ? '(off)' : ''))).join(' '));

(async () => {
  const b = await chromium.launch();

  // 1. A Worker that can't charge per inspector yet: only Solo, and "coming soon".
  {
    const { ctx, p, errs } = await setup(b, { user: OWNER, sub: trial() });
    await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3200); await openBilling(p);
    check(/starter:Upgrade pro:hidden business:hidden/.test(await rowState(p)), 'old Worker: Team and Business stay hidden: ' + await rowState(p));
    check(await p.evaluate(() => !document.getElementById('seatPlansSoon').hidden && document.getElementById('profileYourTeam').hidden), 'old Worker: "coming soon" shows and there is no Your team');
    check(await p.evaluate(() => !document.getElementById('billingTermsRow').hidden), 'the owner sees the prices and cancelling wording');
    check(!errs.length, 'no page errors ' + errs.join('; '));
    await ctx.close();
  }

  // 2. Owner on the trial with the new Worker: plans, prices, checkout seats, team invites.
  {
    const { ctx, p, st, errs } = await setup(b, { user: OWNER, sub: trial({ seat_plans: true }) });
    await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3200); await p.hookToasts(); await openBilling(p);
    check(/starter:Upgrade pro:Upgrade business:Upgrade/.test(await rowState(p)), 'Team and Business are offered: ' + await rowState(p));
    const totals = await p.evaluate(() => [document.getElementById('seatTotalPro').textContent, document.getElementById('seatTotalBusiness').textContent]);
    check(totals[0] === '$158 a month' && totals[1] === '$8,280 a year', 'prices for the starting numbers: ' + totals.join(', '));
    await p.fill('#seatsPro', '4'); await p.waitForTimeout(100);
    check(await p.textContent('#seatTotalPro') === '$316 a month', 'Team for 4 is $316 a month');
    await p.fill('#seatsBusiness', '3'); await p.waitForTimeout(100);
    check(await p.textContent('#seatTotalBusiness') === '$8,280 a year', 'Business below 10 is priced at 10');
    await p.dispatchEvent('#seatsBusiness', 'change');
    check(await p.inputValue('#seatsBusiness') === '10', 'leaving the box puts a number below 10 up to 10');
    check(await p.evaluate(() => !document.getElementById('billingSeatTerms').hidden && document.getElementById('seatPlansSoon').hidden), 'per-inspector terms show, "coming soon" goes');
    await p.screenshot({ path: `${OUT}/2-billing-plans.png`, fullPage: false });
    await p.evaluate(() => { const rows = document.querySelectorAll('#billingPanel [data-plan]'); rows[rows.length - 1].scrollIntoView(); }); await p.screenshot({ path: `${OUT}/2b-billing-business.png` });
    await p.evaluate(() => choosePlan('pro')); await p.waitForTimeout(800);
    const co = st.calls.find(c => c.path.startsWith('/stripe/create-checkout-session'));
    check(co && co.body.plan === 'pro' && co.body.seats === 4, 'checkout asks for Team with 4 inspectors: ' + JSON.stringify(co && co.body));
    await p.waitForTimeout(3500); await p.hookToasts();

    // Your team: on the trial, 3 places.
    await p.evaluate(() => renderProfileMenu());
    check(await p.evaluate(() => !document.getElementById('profileYourTeam').hidden), 'the owner has Your team in the account menu');
    await p.evaluate(() => openMenuPage('teamPanel')); await p.waitForTimeout(600);
    check(/1 of 3 places used/.test(await p.textContent('#teamPlacesText')), 'trial: 1 of 3 places: ' + await p.textContent('#teamPlacesText'));
    await p.fill('#teamInviteEmail', 'nope'); await p.click('#teamInviteBtn'); await p.waitForTimeout(200);
    check((await p.toasts()).some(t => /doesn't look right/.test(t)), 'a bad email is caught before inviting');
    await p.fill('#teamInviteEmail', 'Tech@Acme.test'); await p.click('#teamInviteBtn'); await p.waitForTimeout(900);
    const inv = st.calls.find(c => c.path.includes('/rpc/invite_member'));
    check(inv && inv.body.p_email === 'tech@acme.test', 'invite goes to invite_member with the email in lower case');
    const clip = await p.evaluate(() => navigator.clipboard.readText());
    const link = (clip.match(/https?:\S+/) || [''])[0];
    const lp = new URL(link || 'http://x/').searchParams;
    check(lp.get('signup') === '1' && lp.get('invite') === TOKEN && !lp.get('email') && /Sign up with tech@acme\.test/.test(clip), 'the sign-up link carries only the secret, and the message names their email: ' + link);
    const list = await p.evaluate(() => [...document.querySelectorAll('#teamList .team-row')].map(r => r.innerText.replace(/\s+/g, ' ').trim()));
    check(list.length === 2 && /Bo Boss \(you\)/.test(list[0]) && /tech@acme\.test Invited/.test(list[1]), 'the list shows you and the pending invite: ' + JSON.stringify(list));
    check(/2 of 3 places used/.test(await p.textContent('#teamPlacesText')), 'the invite holds a place');
    await p.fill('#teamInviteEmail', 'two@acme.test'); await p.click('#teamInviteBtn'); await p.waitForTimeout(900);
    const full = await p.evaluate(() => ({ btn: document.getElementById('teamInviteBtn').disabled, more: !document.getElementById('teamMorePlaces').hidden, text: document.getElementById('teamPlacesText').textContent }));
    check(full.btn && full.more && /3 of 3/.test(full.text), 'with every place taken, Invite is off and More places shows');
    await p.screenshot({ path: `${OUT}/2c-team-full.png` });
    await p.evaluate(() => navigator.clipboard.writeText(''));
    await p.evaluate(() => shareTeamInvite('i-0')); await p.waitForTimeout(600);
    check(st.calls.some(c => c.path.includes('/rpc/invite_link') && c.body.p_invite_id === 'i-0') && (await p.evaluate(() => navigator.clipboard.readText())).includes('invite=' + 'b'.repeat(64)), 'Send link makes a fresh link');
    await p.evaluate(() => cancelTeamInvite('i-1')); await p.waitForTimeout(800);
    check(st.calls.some(c => c.method === 'DELETE' && c.path.includes('/rest/v1/invites?id=eq.i-1')) && /2 of 3/.test(await p.textContent('#teamPlacesText')), 'cancelling an invite frees its place');
    check(!errs.length, 'no page errors ' + errs.join('; '));
    await ctx.close();
  }

  // 3. Paying for Team with 4 inspectors: the row is current and changes the number.
  {
    const sub = { plan: 'pro', status: 'active', ai_calls_used_this_period: 100, limit: 3200, subscribed: true, stripe_customer_id: 'c', seats: 4, per_seat: true, seat_plans: true };
    const members = [{ user_id: 'u-owner', role: 'owner', name: 'Bo Boss', email: 'boss@acme.test' }, { user_id: 'u-tech', role: 'technician', name: 'Tia Tech', email: 'tech@acme.test' }];
    const { ctx, p, st, errs } = await setup(b, { user: OWNER, sub, members });
    await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3200); await p.hookToasts(); await openBilling(p);
    check(/Team plan for 4 inspectors\. 100 of 3200 AI fills/.test(await p.textContent('#billingStatusText')), 'status names Team and the inspectors: ' + await p.textContent('#billingStatusText'));
    check(/starter:Switch pro:Current plan\(off\) business:Switch/.test(await rowState(p)) && await p.inputValue('#seatsPro') === '4', 'Team is current at 4: ' + await rowState(p));
    await p.fill('#seatsPro', '6'); await p.waitForTimeout(100);
    check(/pro:Change to 6/.test(await rowState(p)), 'a new number offers Change to 6');
    await p.evaluate(() => choosePlan('pro')); await p.waitForTimeout(900);
    const up = st.calls.find(c => c.path.startsWith('/stripe/update-seats'));
    check(up && up.body.seats === 6 && !st.calls.some(c => c.path.startsWith('/stripe/create-checkout')), 'Change sends 6 to update-seats, not checkout');
    check(/for 6 inspectors/.test(await p.textContent('#billingStatusText')) && /pro:Current plan/.test(await rowState(p)), 'the plan shows 6 afterwards');
    await p.screenshot({ path: `${OUT}/3-team-current.png` });
    await p.evaluate(() => openMenuPage('teamPanel')); await p.waitForTimeout(600);
    check(/2 of 6 inspector places used on your Team plan/.test(await p.textContent('#teamPlacesText')), 'Your team counts against the paid places');
    check(await p.evaluate(() => getComputedStyle(document.getElementById('teamMorePlaces')).display === 'none' && !document.getElementById('teamInviteBtn').disabled), 'with places free, Invite works and More places stays out of sight');
    await p.evaluate(() => removeTeamMember('u-tech')); await p.waitForTimeout(800);
    check(st.calls.some(c => c.method === 'DELETE' && c.path.includes(`team_members?business_id=eq.${BIZ_ID}&user_id=eq.u-tech`)) && /1 of 6/.test(await p.textContent('#teamPlacesText')), 'removing a technician frees a place');
    await p.screenshot({ path: `${OUT}/3b-team-page.png` });
    check(!errs.length, 'no page errors ' + errs.join('; '));
    await ctx.close();
  }

  // 4. A technician on the business sees no plans to buy and no Your team.
  {
    const sub = { plan: 'pro', status: 'active', ai_calls_used_this_period: 100, limit: 3200, subscribed: true, stripe_customer_id: 'c', seats: 4, per_seat: true, seat_plans: true };
    const { ctx, p, st, errs } = await setup(b, { user: TECH, sub });
    st.techMember = true;
    await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3200); await openBilling(p);
    const t = await p.evaluate(() => ({ rows: [...document.querySelectorAll('#billingPanel [data-plan]')].every(r => r.hidden), note: !document.getElementById('billingOwnerOnly').hidden, manage: document.getElementById('manageBillingBtn').style.display, team: document.getElementById('profileYourTeam').hidden }));
    check(t.rows && t.note && t.manage === 'none' && t.team, 'technician: no plan rows, no Manage, no Your team, and a note: ' + JSON.stringify(t));
    check(await p.evaluate(() => document.getElementById('billingTermsRow').hidden), 'technician: no prices, cancelling or paying wording');
    check(!errs.length, 'no page errors ' + errs.join('; '));
    await ctx.close();
  }

  // 5. The invite link: sign-up names the business, then joins it with nothing to set up.
  {
    const { ctx, p, st, errs } = await setup(b, { user: null, sub: { plan: 'pro', status: 'active', limit: 3200, ai_calls_used_this_period: 0, seats: 4, per_seat: true, seat_plans: true, subscribed: true } });
    st.acceptReturns = BIZ_ID; st.invite = { business: 'Acme Pest', email: 'tech@acme.test' };
    await p.goto(`http://localhost:${PORT}/?signup=1&invite=${TOKEN}`); await p.waitForTimeout(3400); await p.hookToasts();
    const card = await p.evaluate(() => ({ title: document.getElementById('suTitle').textContent, email: document.getElementById('suEmail').value, bizShown: getComputedStyle(document.getElementById('suBusinessField')).display, url: location.search, kept: localStorage.getItem('korva_pending_invite') }));
    check(card.title === 'Join Acme Pest on SAYON' && card.email === 'tech@acme.test' && card.bizShown === 'none', 'the invite link fills in the sign-up card from the database: ' + JSON.stringify(card));
    check(!/invite=/.test(card.url) && card.kept === TOKEN, 'the secret leaves the address bar and is kept for sign-in');
    await p.screenshot({ path: `${OUT}/5-invite-signup.png` });
    // A different email can't use the invite: the business box comes back.
    await p.fill('#suEmail', 'other@x.test');
    check(await p.evaluate(() => !document.getElementById('suBusinessField').hidden && /wasn't invited/.test(document.getElementById('suSubtitle').textContent)), 'changing the email brings back the business box and says why');
    await p.fill('#suEmail', 'tech@acme.test');
    check(await p.evaluate(() => document.getElementById('suBusinessField').hidden), 'putting the invited email back hides it again');
    await p.fill('#suName', 'Tia Tech'); await p.fill('#suPassword', 'longenough1'); await p.check('#suConsent'); await p.click('#suBtn'); await p.waitForTimeout(2800);
    const su = st.calls.find(c => c.path.includes('/auth/v1/signup'));
    check(su && !su.body.data.business_name, 'the sign-up doesn\'t name a business of their own');
    check(su.body.data.terms_version === 3 && su.body.data.privacy_version === 6 && su.body.data.terms_accepted_at, 'an invited inspector\'s sign-up records the Terms and Privacy versions too');
    const acc = st.calls.find(c => c.path.includes('/rpc/accept_invite'));
    check(acc && acc.body.p_token === TOKEN, 'sign-in sends the secret to accept_invite');
    const joined = await p.evaluate(() => ({ biz: authBusiness && authBusiness.id, ob: document.getElementById('onboardScreen').style.display, panel1: document.getElementById('ob-panel-1').style.display, kept: localStorage.getItem('korva_pending_invite'), toasts: window.__toasts.slice() }));
    check(joined.biz === BIZ_ID && !st.madeBusiness && !joined.kept, 'the new inspector joins Acme, no business of their own is made, the secret is used up');
    check(joined.toasts.some(t => /joined Acme Pest/.test(t)), 'they are told they joined: ' + joined.toasts.join(' | '));
    check(joined.ob !== 'flex' || joined.panel1 === 'flex', 'they skip the business set-up');
    check(!errs.length, 'no page errors ' + errs.join('; '));
    await ctx.close();
  }

  // 5b. A dead link: a plain sign-up card that says so, and no secret kept.
  {
    const { ctx, p, errs } = await setup(b, { user: null, sub: trial({ seat_plans: true }) });
    await p.goto(`http://localhost:${PORT}/?signup=1&invite=${'c'.repeat(64)}`); await p.waitForTimeout(3400);
    const dead = await p.evaluate(() => ({ title: document.getElementById('suTitle').textContent, sub: document.getElementById('suSubtitle').textContent, biz: !document.getElementById('suBusinessField').hidden, kept: localStorage.getItem('korva_pending_invite') }));
    check(dead.title === 'Create your account' && /expired or been replaced/.test(dead.sub) && dead.biz && !dead.kept, 'a dead invite link says so and leaves a normal sign-up: ' + JSON.stringify(dead));
    check(!errs.length, 'no page errors ' + errs.join('; '));
    await ctx.close();
  }

  // 5c. No free place: no business of their own is made, and the secret is kept for next time.
  {
    const { ctx, p, st, errs } = await setup(b, { user: null, sub: trial({ seat_plans: true }) });
    st.acceptReturns = 'NO_SEATS'; st.invite = { business: 'Acme Pest', email: 'tech@acme.test' };
    await p.goto(`http://localhost:${PORT}/?signup=1&invite=${TOKEN}`); await p.waitForTimeout(3400); await p.hookToasts();
    await p.fill('#suName', 'Tia Tech'); await p.fill('#suPassword', 'longenough1'); await p.check('#suConsent'); await p.click('#suBtn'); await p.waitForTimeout(2800);
    const ns = await p.evaluate(() => ({ biz: authBusiness, kept: localStorage.getItem('korva_pending_invite'), toasts: window.__toasts.slice() }));
    check(!ns.biz && !st.madeBusiness && ns.kept === 'a'.repeat(64) && ns.toasts.some(t => /no free inspector place/.test(t)), 'no free place: nothing is made, they are told, and the next sign-in tries again');
    check(!errs.length, 'no page errors ' + errs.join('; '));
    await ctx.close();
  }

  // 6. No invite: sign-up makes a business of their own as before.
  {
    const { ctx, p, st, errs } = await setup(b, { user: null, sub: trial({ seat_plans: true }) });
    await p.goto(`http://localhost:${PORT}/?signup=1`); await p.waitForTimeout(3200);
    check(await p.evaluate(() => document.getElementById('suTitle').textContent === 'Create your account' && !document.getElementById('suBusinessField').hidden), 'a plain sign-up card is unchanged');
    await p.fill('#suName', 'Sol Owner'); await p.fill('#suBusiness', 'Sol Pest'); await p.fill('#suEmail', 'sol@x.test'); await p.fill('#suPassword', 'longenough1'); await p.check('#suConsent'); await p.click('#suBtn'); await p.waitForTimeout(2800);
    check(!st.calls.some(c => c.path.includes('/rpc/accept_invite')) && st.madeBusiness, 'no invite link: no invite is looked for, and their own business is made');
    check(!errs.length, 'no page errors ' + errs.join('; '));
    await ctx.close();
  }

  // 7. An invite link opened while already signed in: say whose it is, keep nothing.
  for (const [who, email, want] of [['someone else', 'tech@acme.test', /invite is for tech@acme\.test, but you're signed in as boss@acme\.test/], ['the same person', 'boss@acme.test', /already signed in as boss@acme\.test/], ['a dead link', null, /expired or been replaced/]]) {
    const { ctx, p, st, errs } = await setup(b, { user: OWNER, sub: trial({ seat_plans: true }) });
    st.invite = email ? { business: 'Acme Pest', email } : null;
    await ctx.addInitScript(() => { window.__seen = []; document.addEventListener('DOMContentLoaded', () => { const t = document.getElementById('toast'); new MutationObserver(() => window.__seen.push(t.textContent)).observe(t, { childList: true, subtree: true, characterData: true }); }); });
    await p.goto(`http://localhost:${PORT}/?signup=1&invite=${TOKEN}`); await p.waitForTimeout(4200);
    const r = await p.evaluate(() => ({ seen: window.__seen, url: location.search, kept: localStorage.getItem('korva_pending_invite'), app: getComputedStyle(document.getElementById('authScreen')).display }));
    check(r.seen.some(t => want.test(t)), `signed in, invite for ${who}: told so: ` + JSON.stringify(r.seen.filter(t => /invite|signed in|expired/.test(t))));
    check(!/invite=|signup=/.test(r.url) && !r.kept && !st.calls.some(c => c.path.includes('/rpc/accept_invite')) && r.app === 'none', `signed in, invite for ${who}: link cleared from the address bar, nothing kept or accepted, still in the app`);
    check(!errs.length, 'no page errors ' + errs.join('; '));
    await ctx.close();
  }

  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
