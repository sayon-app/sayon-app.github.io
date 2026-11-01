// The first day as a paying customer: the website's trial button lands on
// sign-up, sign-up checks the email and names a duplicate account, a new
// person on a used phone still sets up their business, the app opens
// straight into the report, Billing names each plan state and the current
// plan, payment confirmation waits for Stripe, test mode is hidden, help
// is reachable. node e2e.js <outDir>  (server on :8765)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/first-day'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', SP = process.env.JSPDF_DIR || '/tmp/jspdf';
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await ctx.route(/sentry|posthog|maps\.googleapis/, r => r.fulfill({ status: 200, body: '' }));
  const state = { sub: { plan: 'trial', status: 'trialing', ai_calls_used_this_period: 0, limit: 50, trial_ends_at: new Date(Date.now() + 5 * 86400000).toISOString() }, subStatus: 200, statusCalls: 0, signupError: null, signupCalls: [], bizSettings: {} };
  await ctx.route(/workers\.dev/, r => {
    const path = r.request().url().replace(/^https:\/\/[^/]+/, '');
    if (path.startsWith('/stripe/subscription-status')) { state.statusCalls++; return state.subStatus === 200 ? r.fulfill({ json: state.sub }) : r.fulfill({ status: state.subStatus, body: 'no' }); }
    return r.fulfill({ json: {} });
  });
  await ctx.route(/supabase\.co/, r => {
    const req = r.request(), u = req.url(), m = req.method();
    if (u.includes('/auth/v1/signup')) {
      if (state.signupError) return r.fulfill({ status: 422, json: state.signupError });
      const body = JSON.parse(req.postData()); state.signupCalls.push(body); return r.fulfill({ json: { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u-' + body.email.split('@')[0], email: body.email, user_metadata: body.data } } });
    }
    if (u.includes('/auth/v1/')) return r.fulfill({ json: {} });
    if (u.includes('/rest/v1/businesses')) {
      if (m === 'POST') return r.fulfill({ json: [Object.assign({ id: 'b-new', settings: state.bizSettings }, JSON.parse(req.postData()))] });
      const uid = (u.match(/owner_id=eq\.([^&]+)/) || [])[1];
      return r.fulfill({ json: uid === 'u-sam' ? [{ id: 'b-sam', name: 'Newby Pest Management', owner_id: 'u-sam', settings: state.bizSettings }] : [] });
    }
    if (m === 'POST' || m === 'PATCH') return r.fulfill({ json: [{ id: 'x' }] });
    return r.fulfill({ json: [] });
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const toasts = []; await ctx.addInitScript(() => { window.__toasts = []; });
  const hookToasts = () => p.evaluate(() => { const o = window.showToast; window.showToast = (m, k) => { window.__toasts.push(k + ': ' + m); return o && o(m, k); }; });
  const takeToasts = async () => { const t = await p.evaluate(() => window.__toasts.splice(0)); toasts.push(...t); return t; };

  // 1. The website's button lands on the sign-up card.
  await p.goto(`http://localhost:${PORT}/?signup=1`); await p.waitForTimeout(3200); await hookToasts();
  const card = await p.evaluate(() => ({ signup: document.getElementById('authSignUp').style.display, signin: document.getElementById('authSignIn').style.display, sub: document.querySelector('#authSignUp .auth-subtitle').textContent, help: !!document.querySelector('.auth-footer a[href^="mailto:"]') }));
  check(card.signup === 'flex' && card.signin === 'none', '?signup=1 opens the sign-up card');
  check(/14 days free, no card needed/.test(card.sub), 'sign-up says 14 days free, no card needed');
  check(card.help, 'the sign-in screen has an email-us link');
  await p.screenshot({ path: `${OUT}/1-signup.png` });

  // 2. A typo in the email is caught; a duplicate account points to sign in.
  await p.fill('#suName', 'Sam Newby'); await p.fill('#suBusiness', 'Newby Pest Management'); await p.fill('#suEmail', 'sam@gmial'); await p.fill('#suPassword', 'longenough1');
  await p.click('#suBtn'); await p.waitForTimeout(300);
  const unticked = await p.evaluate(() => ({ err: document.getElementById('suError').textContent, terms: document.querySelector('.auth-consent a[href="terms.html"]')?.target, privacy: document.querySelector('.auth-consent a[href="privacy.html"]')?.target }));
  check(/Tick the box to agree to the Terms of Service and Privacy Policy/.test(unticked.err) && !state.signupCalls.length, 'sign-up waits for the Terms and Privacy tick-box: ' + unticked.err);
  check(unticked.terms === '_blank' && unticked.privacy === '_blank', 'the tick-box links open the Terms and Privacy pages in a new tab');
  await p.screenshot({ path: `${OUT}/1b-consent.png` });
  await p.check('#suConsent');
  await p.click('#suBtn'); await p.waitForTimeout(300);
  check(/doesn't look right/.test(await p.textContent('#suError')), 'a bad email address is caught before sign-up: ' + (await p.textContent('#suError')).slice(0, 50));
  state.signupError = { code: 422, error_code: 'user_already_exists', msg: 'User already registered' };
  await p.fill('#suEmail', 'sam@example.com'); await p.click('#suBtn'); await p.waitForTimeout(800);
  const dup = await p.evaluate(() => ({ text: document.getElementById('suError').innerText, link: !!document.querySelector('#suError .auth-inline-link') }));
  check(/already a SAYON account/.test(dup.text) && dup.link, 'a duplicate email says so with a Sign in link: ' + dup.text.slice(0, 70));
  await p.screenshot({ path: `${OUT}/2-duplicate.png` });
  await p.click('#suError .auth-inline-link'); await p.waitForTimeout(200);
  check(await p.evaluate(() => document.getElementById('authSignIn').style.display === 'flex' && document.getElementById('siEmail').value === 'sam@example.com'), 'Sign in opens with the email filled');

  // 3. Sign up for real: onboarding, then straight into the app (no hub).
  state.signupError = null;
  await p.evaluate(() => showAuth('authSignUp'));
  await p.fill('#suEmail', 'sam@example.com'); await p.fill('#suPassword', 'longenough1'); await p.click('#suBtn'); await p.waitForTimeout(2500);
  check(await p.evaluate(() => document.getElementById('onboardScreen').style.display === 'flex'), 'a new account sees the business set-up');
  const sent = state.signupCalls[state.signupCalls.length - 1].data;
  check(sent.terms_version === 3 && sent.privacy_version === 6 && !isNaN(Date.parse(sent.terms_accepted_at)), 'the sign-up records which Terms and Privacy versions were agreed to, and when: ' + JSON.stringify(sent));
  const labels = await p.evaluate(() => [...document.querySelectorAll('#ob-panel-0 .auth-label')].map(l => l.textContent.trim()));
  check(labels.some(l => /Licence.*can wait/.test(l)) && labels.some(l => /Phone.*can wait/.test(l)), 'licence and phone are marked as able to wait');
  await p.evaluate(() => { obNext(0); obNext(1); obFinish(); }); await p.waitForTimeout(1200);
  const landed = await p.evaluate(() => ({ app: document.getElementById('app').style.display, menu: getComputedStyle(document.getElementById('mainMenu')).display, ob: localStorage.getItem('korva_onboarded_v1:u-sam') }));
  check(landed.app === 'flex' && landed.menu === 'none' && landed.ob === '1', 'after set-up the report screen opens and the flag is per account');
  // Reload: straight into the app, not a one-tile menu.
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(3200); await hookToasts();
  const reopened = await p.evaluate(() => ({ app: document.getElementById('app').style.display, menu: getComputedStyle(document.getElementById('mainMenu')).display, ob: document.getElementById('onboardScreen').style.display }));
  check(reopened.app === 'flex' && reopened.menu === 'none' && reopened.ob !== 'flex', 'reopening lands in the report screen, with no set-up and no hub');
  await p.screenshot({ path: `${OUT}/3-reopened.png` });

  // 4. Another person signs up on this phone: they still set up their business.
  await p.evaluate(() => { localStorage.removeItem('korva_session'); });
  await p.goto(`http://localhost:${PORT}/?signup=1`); await p.waitForTimeout(3200); await hookToasts();
  await p.fill('#suName', 'Jo Other'); await p.fill('#suBusiness', 'Other Pest Co'); await p.fill('#suEmail', 'jo@example.com'); await p.fill('#suPassword', 'longenough1'); await p.check('#suConsent'); await p.click('#suBtn'); await p.waitForTimeout(2500);
  check(await p.evaluate(() => document.getElementById('onboardScreen').style.display === 'flex'), 'a second person on the same phone still sets up their business');
  await p.evaluate(() => { obNext(0); obNext(1); obFinish(); }); await p.waitForTimeout(1200);

  // 5. Billing states.
  const line = async () => { await p.evaluate(() => loadBillingStatus()); await p.waitForTimeout(400); return p.evaluate(() => document.getElementById('billingStatusText').textContent); };
  check(/Free trial, 5 days left/.test(await line()), 'trial: days left');
  state.sub = Object.assign({}, state.sub, { trial_ends_at: new Date(Date.now() - 1000).toISOString() });
  check(/Your free trial has ended/.test(await line()), 'trial ended is named');
  state.sub = { plan: 'pro', status: 'past_due', ai_calls_used_this_period: 12, limit: 400, stripe_customer_id: 'c', stripe_subscription_id: 's', current_period_end: new Date(Date.now() + 3 * 86400000).toISOString() };
  check(/last payment failed/.test(await line()), 'a failed payment is named');
  state.sub = { plan: 'starter', status: 'active', ai_calls_used_this_period: 12, limit: 800, stripe_customer_id: 'c', stripe_subscription_id: 's' };
  await line();
  const rows = await p.evaluate(() => [...document.querySelectorAll('#billingPanel [data-plan]')].map(r => r.dataset.plan + ':' + r.querySelector('button').textContent + (r.classList.contains('current-plan') ? '*' : '')));
  check(rows.join() === 'starter:Current plan*,pro:Switch,business:Switch' && await p.evaluate(() => [...document.querySelectorAll('#billingPanel [data-seat-plan]')].every(r => r.hidden)), 'Solo is current and Team and Business wait for the per-inspector Worker: ' + rows.join());
  await p.evaluate(() => { toggleDrawer(); openMenuPage('billingPanel'); }); await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/4-billing-current.png`, fullPage: false });
  await p.evaluate(() => { showMenuPage(null); toggleDrawer(); });
  state.subStatus = 403;
  check(/still being set up/.test(await line()), 'a 403 says the account is still being set up');
  state.subStatus = 500;
  check(/Couldn't load your plan/.test(await line()), 'another failure says to try again, not "billing isn\'t set up"');
  state.subStatus = 200;

  // 6. Back from checkout: the panel waits for Stripe before offering Upgrade again.
  state.sub = { plan: 'trial', status: 'trialing', ai_calls_used_this_period: 0, limit: 50 }; state.statusCalls = 0;
  await takeToasts();
  const confirming = p.evaluate(() => confirmBillingAfterCheckout());
  await p.waitForTimeout(600);
  check(/Confirming your payment/.test(await p.evaluate(() => document.getElementById('billingStatusText').textContent)), 'shows "Confirming your payment…" while the webhook is pending');
  state.sub = { plan: 'starter', status: 'active', ai_calls_used_this_period: 0, limit: 150, stripe_customer_id: 'c', stripe_subscription_id: 's' };
  await confirming;
  const t = await takeToasts();
  check(state.statusCalls >= 2 && t.some(x => /Subscription updated/.test(x)) && /Solo plan/.test(await p.evaluate(() => document.getElementById('billingStatusText').textContent)), 'then shows the plan once Stripe has it (' + state.statusCalls + ' checks)');

  // 7. Test mode is hidden unless the business allows it; help is in the drawer.
  const misc = await p.evaluate(() => { restoreTestModeSetting(); return { testRow: document.getElementById('testModeRow').hidden, help: !!document.querySelector('.drawer-help[href^="mailto:"]'), owner: isBusinessOwner() }; });
  check(misc.owner && misc.testRow, 'test mode is hidden for an ordinary owner');
  check(await p.evaluate(() => { authBusiness.settings = { testMode: true }; restoreTestModeSetting(); const shown = !document.getElementById('testModeRow').hidden; authBusiness.settings = {}; restoreTestModeSetting(); return shown; }), 'and shown where settings.testMode is on');
  check(misc.help, 'Help and support is in the drawer');

  // 8. The client's page shows who sent it and how to reach them.
  await ctx.route(/rpc\/get_sign_request/, r => r.fulfill({ json: { status: 'pending', doc: { kind: 'quote', company: 'Example Pest Co', phone: '0400 000 000', email: 'office@example.com', inspector: 'Alex Example', client: 'Pat Client', address: '12 Sample St', number: 'Q-1', date: '2026-10-31', validUntil: '2026-11-30', gst: true, items: [{ desc: 'Barrier', qty: 1, unit: 'job', price: 100, total: 100 }], subtotal: 100, gstAmount: 10, total: 110, plan: { we: [], owner: [] }, exclusions: [], notes: [], acceptText: 'I accept.' } } }));
  await p.goto(`http://localhost:${PORT}/sign.html?id=0b7d4c3e-1111-4222-8333-444455556666`); await p.waitForTimeout(1500);
  const from = await p.evaluate(() => ({ text: document.querySelector('.from')?.textContent, tel: document.querySelector('.from a[href^="tel:"]')?.getAttribute('href'), foot: document.querySelector('.foot')?.textContent }));
  check(/Sent by Alex Example, Example Pest Co/.test(from.text || '') && from.tel === 'tel:0400000000', 'sign page says who sent it with a tappable number: ' + from.text);
  check(/the reporting app your inspector uses/.test(from.foot || ''), 'the footer says what SAYON is');
  await p.screenshot({ path: `${OUT}/5-sign-from.png` });

  // 9. Legal pages: no draft banner, light brand, en-AU.
  for (const f of ['terms.html', 'privacy.html']) {
    await p.goto(`http://localhost:${PORT}/${f}`); await p.waitForTimeout(600);
    const legal = await p.evaluate(() => ({ draft: /Draft — not yet/.test(document.body.innerText) || /pending legal review/i.test(document.body.innerText), lang: document.documentElement.lang, bg: getComputedStyle(document.body).backgroundColor, menu: /your initials/i.test(document.body.innerText) || /\[[A-Z ]+\]/.test(document.body.innerText) }));
    check(!legal.draft && legal.lang === 'en-AU' && legal.bg !== 'rgb(10, 11, 13)' && !legal.menu, `${f}: no draft banner, en-AU, light, no old menu path, no placeholders`);
    // The version a new account ticks at sign-up must match the page.
    const pageVersion = Number(((await p.textContent('.updated')) || '').match(/Version (\d+)/)?.[1]);
    const ticked = Number(fs.readFileSync(require('path').join(__dirname, '../../js/app.js'), 'utf8').match(new RegExp(`LEGAL_VERSIONS = \\{[^}]*${f.replace('.html', '')}: (\\d+)`))?.[1]);
    check(pageVersion && pageVersion === ticked, `${f}: sign-up records the page's version (page ${pageVersion}, sign-up ${ticked})`);
    await p.screenshot({ path: `${OUT}/6-${f.replace('.html', '')}.png` });
  }
  // 10. Website.
  await p.goto(`http://localhost:${PORT}/site/`); await p.waitForTimeout(1000);
  const site = await p.evaluate(() => ({ trial: [...document.querySelectorAll('a.btn-main')].every(a => /signup=1/.test(a.href)), plans: /About 40 inspections a month/.test(document.body.innerText) && [...document.querySelectorAll('#pricing .price h3')].map(h => h.textContent).join() === 'Solo,Team,Business' && /\$79/.test(document.body.innerText) && /\$828 per inspector a year/.test(document.body.innerText), faq: /Who owns my reports/.test(document.body.innerText) && /How do I cancel/.test(document.body.innerText), stats: !/45 min/.test(document.body.innerText), samples: !!document.querySelector('a[href$="sample-report.pdf"]'), contact: !!document.querySelector('footer a[href^="mailto:"]'), team: /open Your team and add an inspector/.test(document.body.textContent) }));
  check(Object.values(site).every(Boolean), 'website: trial buttons to sign-up, Solo, Team and Business plans, new FAQ, no unproven minutes, samples, contact: ' + JSON.stringify(site));
  await p.screenshot({ path: `${OUT}/7-site.png`, fullPage: true });

  check(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
