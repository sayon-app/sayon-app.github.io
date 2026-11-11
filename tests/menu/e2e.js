// The menu, and what opens from it. Who's signed in sits on top and opens
// Your sign-in (name, email, a change of password). Under it are two lists:
// Your business (details, prices, chemical register, team, billing) and App
// (settings, sample job, report a problem, help). Sign out is last, a quiet
// link, and asks on SAYON's own sheet. Business details is a menu page with
// Save at the bottom: back with changes asks first, and opened from a check
// that found a detail missing it goes back to that check. Billing shows the
// plan, then the plans, with the explainer folded to one line. The app opens
// as soon as the sign-in is checked. The chemical register says where each
// product's rates came from. A part marked hidden never shows.
// node e2e.js <outDir>  (server on :8765; see tests/visual/README.md)
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2] || '/tmp/menu'; fs.mkdirSync(OUT, { recursive: true });
const PORT = '8765', uid = 'u-owner', SP = process.env.JSPDF_DIR || '/tmp/jspdf';
const user = { id: uid, email: 'office@example.com', user_metadata: { name: 'Alex Example', business_name: 'Example Pest Co' } };
const sess = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user };
const sc = require('../visual/scenarios.js').find(s => s.name === 'standard');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await require('../visual/fonts-route.js')(ctx);
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, r => r.fulfill({ body: fs.readFileSync(SP + '/package/dist/jspdf.umd.min.js'), contentType: 'application/javascript' }));
  await ctx.route(/sentry|posthog|maps\.googleapis|data\.gov\.au/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.route(/workers\.dev/, r => {
    const u = r.request().url(); let body = {}; try { body = r.request().postDataJSON() || {}; } catch (e) {}
    if (u.includes('/send-email')) return r.fulfill({ json: body.check ? { configured: true, textOnly: true } : { ok: true } });
    return r.fulfill({ json: { plan: 'starter', status: 'active', subscribed: true, ai_calls_used_this_period: 12, limit: 800, seat_plans: true, seats: 1 } });
  });
  const auth = [];
  await ctx.route(/supabase\.co/, r => {
    const req = r.request(), u = req.url(), m = req.method();
    let body = null; try { body = req.postDataJSON(); } catch (e) {}
    if (u.includes('/auth/v1/user') && m === 'PUT') {
      auth.push({ what: 'user', body, token: req.headers()['authorization'] });
      if (body && body.data) Object.assign(user.user_metadata, body.data);
      return r.fulfill({ json: user });
    }
    if (u.includes('/auth/v1/token') && u.includes('grant_type=password')) {
      auth.push({ what: 'password', body });
      if (body.password !== 'oldpass123') return r.fulfill({ status: 400, json: { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' } });
      return r.fulfill({ json: { access_token: 'f.r.esh', refresh_token: 'r2', expires_at: Math.floor(Date.now() / 1000) + 3600, user } });
    }
    if (u.includes('businesses?owner_id')) return r.fulfill({ json: [{ id: 'b1', name: sc.company.name, owner_id: uid, settings: {} }] });
    if (m === 'PATCH') return r.fulfill({ status: 204, body: '' });
    return r.fulfill({ json: [] });
  });
  await ctx.addInitScript((s) => {
    if (localStorage.getItem('korva_session')) return;
    localStorage.setItem('korva_session', JSON.stringify(s)); localStorage.setItem('korva_onboarded_v1:u-owner', '1');
    window.__splash = [];
    document.addEventListener('DOMContentLoaded', () => { const el = document.getElementById('splashStatus'); new MutationObserver(() => window.__splash.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true }); window.__splash.push(el.textContent); });
  }, sess);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const dialogs = []; p.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
  const shot = name => p.screenshot({ path: `${OUT}/${name}.png` });
  const toast = () => p.evaluate(() => document.getElementById('toast').textContent);
  const ask = () => p.evaluate(() => ({ open: document.getElementById('askOverlay').classList.contains('open'), title: document.getElementById('askTitle').textContent, text: document.getElementById('askText').textContent, yes: document.getElementById('askYes').textContent, no: document.getElementById('askNo').textContent }));
  const page = () => p.evaluate(() => ({ menu: document.getElementById('sidebarPanel').classList.contains('open'), onPage: document.getElementById('sidebarPanel').classList.contains('on-page'), title: document.getElementById('drawerTitle').textContent, place: navPlace() }));

  // 1. The app opens once the sign-in is checked: no fixed wait, and nothing
  // made up on the splash.
  const t0 = Date.now();
  await p.goto(`http://localhost:${PORT}/`);
  await p.waitForFunction(() => document.getElementById('app').style.display === 'flex', null, { timeout: 8000 }).catch(() => {});
  const took = Date.now() - t0;
  const splash = await p.evaluate(() => ({ lines: window.__splash.filter(Boolean), gone: getComputedStyle(document.getElementById('splash')).display === 'none' }));
  check(took < 2000 && splash.gone, `the app is up as soon as the sign-in is checked (${took} ms after the page was asked for)`);
  check(!splash.lines.length, 'the splash said nothing it wasn\'t doing: ' + JSON.stringify(splash.lines));
  await p.waitForTimeout(800);
  await p.evaluate(sc => { storeCompanyDetails(sc.company); renderProfileMenu(); }, sc);

  // 2. The menu: who's signed in, two lists, Sign out last.
  await p.evaluate(() => tabGo('menu')); await p.waitForTimeout(500); await shot('1-menu');
  const menu = await p.evaluate(() => {
    const scroll = document.querySelector('#sidebarPanel .drawer-scroll');
    const out = [];
    [...scroll.children].forEach(el => {
      if (el.getBoundingClientRect().height < 1) return;
      if (el.id === 'profileMenuWrap') out.push('WHO');
      else if (el.classList.contains('drawer-group-label')) out.push('[' + el.textContent.trim() + ']');
      else if (el.classList.contains('drawer-signout')) out.push('SIGN OUT');
      else if (el.classList.contains('drawer-legal')) out.push('LEGAL');
      else { const t = el.querySelector('.panel-title'); if (t) out.push(t.textContent.trim()); }
    });
    const who = document.getElementById('profileMenuWrap'), so = document.querySelector('.drawer-signout'), cs = getComputedStyle(so);
    return { order: out, whoText: who.innerText.replace(/\s+/g, ' ').trim(), whoButtons: who.querySelectorAll('button').length, whoIsButton: who.tagName === 'BUTTON',
      signout: { text: so.textContent.trim(), plain: cs.backgroundColor === 'rgba(0, 0, 0, 0)' && cs.borderTopWidth === '0px', tall: so.getBoundingClientRect().height >= 44 },
      summaries: Object.fromEntries(['businessPanel', 'chemicalsPanel', 'billingPanel'].map(id => [id, document.querySelector(`#${id} .job-panel-summary`).textContent])) };
  });
  console.log('menu:', JSON.stringify(menu.order));
  check(menu.order.join(' | ') === 'WHO | [Your business] | Business details | Your prices | Chemical register | Your team | Billing | [App] | Settings | Sample job | Report a problem | Help and support | SIGN OUT | LEGAL', 'the menu is who\'s signed in, then Your business and App as two lists, then Sign out');
  check(menu.whoIsButton && !menu.whoButtons && /Alex Example office@example\.com/.test(menu.whoText) && /Your sign-in/.test(menu.whoText), 'the card on top says who\'s signed in and holds no other buttons: ' + menu.whoText);
  check(menu.signout.text === 'Sign out' && menu.signout.plain && menu.signout.tall, 'Sign out is a quiet link, still big enough to tap: ' + JSON.stringify(menu.signout));
  check(menu.summaries.businessPanel === sc.company.name && /products/.test(menu.summaries.chemicalsPanel) && menu.summaries.billingPanel === 'Solo', 'the rows say what they hold: ' + JSON.stringify(menu.summaries));

  // 3. Sign out asks on SAYON's own sheet.
  await p.click('.drawer-signout'); await p.waitForTimeout(300); await shot('2-sign-out');
  let a = await ask();
  check(a.open && a.title === 'Sign out of SAYON?' && a.yes === 'Sign out' && a.no === 'Not now' && !dialogs.length, 'Sign out asks on SAYON\'s sheet, not the browser\'s grey box: ' + JSON.stringify(a));
  await p.evaluate(() => navBack()); await p.waitForTimeout(200);
  check(!(await ask()).open && (await page()).menu && await p.evaluate(() => !!authUser), 'back closes the question and nothing is signed out');

  // 4. Business details: a menu page, Save at the bottom.
  await p.click('#businessPanelToggle'); await p.waitForTimeout(400); await shot('3-business');
  const biz = await p.evaluate(() => {
    const save = document.getElementById('businessSave').getBoundingClientRect(), last = document.querySelector('#businessFields > .auth-field:last-child').getBoundingClientRect();
    const dock = document.querySelector('.tabbar');
    return { name: document.getElementById('ob-companyName').value, nameShown: document.getElementById('obNameField').getBoundingClientRect().height > 0,
      canWait: [...document.querySelectorAll('#businessFields .ob-setup-only')].some(el => el.getBoundingClientRect().height > 0),
      saveBelow: save.top >= last.bottom, back: document.getElementById('drawerBack').getBoundingClientRect().width > 0, dock: !!dock && dock.getBoundingClientRect().height > 0,
      logoScreen: getComputedStyle(document.getElementById('onboardScreen')).display };
  });
  const bp = await page();
  check(bp.onPage && bp.title === 'Business details' && biz.back && biz.dock && biz.logoScreen === 'none', 'Business details is a menu page: its title, a back arrow and the dock, not the sign-up card');
  check(biz.name === sc.company.name && biz.nameShown && !biz.canWait && biz.saveBelow, 'the name is editable here, nothing "can wait", and Save is at the bottom: ' + JSON.stringify(biz));
  await p.fill('#ob-phone', '0411 222 333'); await p.fill('#ob-abn', '');
  await p.click('#businessSave'); await p.waitForTimeout(400);
  const saved = await p.evaluate(() => getCompanyDetails());
  check(saved.phone === '0411 222 333' && saved.abn === '' && /Business details saved/.test(await toast()) && !(await page()).onPage, 'Save keeps the page as it stands (a cleared box too) and goes back to the menu');

  // Back with a change not saved: asked first, on SAYON's sheet.
  await p.click('#businessPanelToggle'); await p.waitForTimeout(300);
  await p.fill('#ob-phone', '0499 999 999');
  await p.click('#drawerBack'); await p.waitForTimeout(300); await shot('4-unsaved');
  a = await ask();
  check(a.open && a.title === 'Save your changes?' && a.yes === 'Save' && a.no === 'Don\'t save', 'back with a change asks whether to save it: ' + JSON.stringify(a));
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  check(!(await ask()).open && (await page()).title === 'Business details' && await p.inputValue('#ob-phone') === '0499 999 999', 'Esc stays on the page with what was typed');
  await p.click('#drawerBack'); await p.waitForTimeout(200); await p.click('#askNo'); await p.waitForTimeout(300);
  check(!(await page()).onPage && (await p.evaluate(() => getCompanyDetails().phone)) === '0411 222 333', '"Don\'t save" goes back to the menu and keeps the saved number');
  await p.click('#businessPanelToggle'); await p.waitForTimeout(300);
  check(await p.inputValue('#ob-phone') === '0411 222 333', 'the page opens on what\'s saved, not the dropped change');
  await p.fill('#ob-phone', '0488 888 888');
  await p.click('#drawerBack'); await p.waitForTimeout(200); await p.click('#askYes'); await p.waitForTimeout(300);
  check(!(await page()).onPage && (await p.evaluate(() => getCompanyDetails().phone)) === '0488 888 888', '"Save" saves and goes back');
  // Leaving by the dock can't ask, so it says the change wasn't saved.
  await p.click('#businessPanelToggle'); await p.waitForTimeout(300);
  await p.fill('#ob-phone', '0477 777 777');
  await p.evaluate(() => tabGo('dashboard')); await p.waitForTimeout(300);
  check(/Your changes to Business details weren't saved/.test(await toast()) && (await p.evaluate(() => getCompanyDetails().phone)) === '0488 888 888', 'leaving by the dock says the change wasn\'t saved: ' + await toast());

  // 5. From a check that found a detail missing: the page goes back to it.
  await p.evaluate(async (sc) => {
    const c = getCompanyDetails(); c.licence = ''; c.abn = '12 345 678 901'; storeCompanyDetails(c);
    closeDashboard(); resetReportState();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    for (const [k, v] of Object.entries(sc.job)) set(k, v); updateJob(); await populateFields(sc.fields);
    saveCurrentReport(true);
  }, sc);
  await p.waitForTimeout(1200);
  await p.evaluate(() => { tabGo('job'); openSendReview(); }); await p.waitForTimeout(900);
  const gap = await p.evaluate(() => document.getElementById('sendReviewGaps').innerText);
  check(/licence number is missing from Menu › Business details/.test(gap), 'the check names the page by its menu name: ' + (gap.match(/Your licence[^\n]*/) || [''])[0]);
  await p.locator('#sendReviewGaps li', { hasText: 'Business details' }).locator('button').click(); await p.waitForTimeout(500); await shot('5-from-check');
  let at = await page();
  check(at.menu && at.onPage && at.title === 'Business details' && await p.evaluate(() => !document.getElementById('sendReviewOverlay').classList.contains('open')), '"Add it" opens Business details, with the check out of the way');
  await p.click('#drawerBack'); await p.waitForTimeout(600);
  at = await page();
  check(at.place === 'job' && await p.evaluate(() => document.getElementById('sendReviewOverlay').classList.contains('open')), 'back from it returns to the job and its check, not the menu: ' + at.place);
  await p.locator('#sendReviewGaps li', { hasText: 'Business details' }).locator('button').click(); await p.waitForTimeout(500);
  await p.fill('#ob-licence', 'NSW 123456'); await p.click('#businessSave'); await p.waitForTimeout(900);
  const after = await p.evaluate(() => ({ place: navPlace(), open: document.getElementById('sendReviewOverlay').classList.contains('open'), gaps: document.getElementById('sendReviewGaps').innerText, licence: getCompanyDetails().licence }));
  check(after.place === 'job' && after.open && after.licence === 'NSW 123456' && !/licence number is missing/.test(after.gaps), 'Save returns to the check, which no longer lists the licence: ' + after.place);
  await p.evaluate(() => closeSendReview());

  // The quote's own "Add it" does the same, and comes back to the quote.
  await p.evaluate(() => { const c = getCompanyDetails(); c.abn = ''; storeCompanyDetails(c); tabGo('quote'); }); await p.waitForTimeout(900);
  const qgap = await p.evaluate(() => document.getElementById('quoteCompanyGaps').innerText);
  check(/won't show your ABN/.test(qgap), 'the quote says the ABN is missing: ' + qgap.replace(/\s+/g, ' ').slice(0, 80));
  await p.click('#quoteCompanyGaps button'); await p.waitForTimeout(500);
  at = await page();
  check(at.menu && at.onPage && at.title === 'Business details' && await p.evaluate(() => !document.getElementById('quoteScreen').classList.contains('open')), 'its "Add it" opens Business details');
  await p.fill('#ob-abn', '12 345 678 901'); await p.click('#businessSave'); await p.waitForTimeout(900);
  const backQ = await p.evaluate(() => ({ quote: document.getElementById('quoteScreen').classList.contains('open'), gaps: getComputedStyle(document.getElementById('quoteCompanyGaps')).display }));
  check(backQ.quote && backQ.gaps === 'none', 'and Save comes back to the quote, with the note gone');

  // 6. Your sign-in: the name, the email, a change of password.
  await p.evaluate(() => tabGo('menu')); await p.waitForTimeout(400);
  await p.click('#profileMenuWrap'); await p.waitForTimeout(400); await shot('6-sign-in');
  const me = await p.evaluate(() => ({ name: document.getElementById('meName').value, email: document.getElementById('meEmail').textContent, note: document.querySelector('#signinPanel .settings-row-desc a') && document.querySelector('#signinPanel .settings-row-desc a').getAttribute('href') }));
  check((await page()).title === 'Your sign-in' && me.name === 'Alex Example' && me.email === 'office@example.com' && /^mailto:/.test(me.note || ''), 'Your sign-in shows the name and the email, and says how to get the email changed');
  await p.fill('#meName', 'Alex B Example'); await p.click('#meNameSave'); await p.waitForTimeout(500);
  const named = await p.evaluate(() => ({ user: authUser.user_metadata.name, stored: JSON.parse(localStorage.getItem('korva_session')).user.user_metadata.name, card: document.getElementById('profileName').textContent, initials: document.getElementById('profileInitials').textContent }));
  const nameCall = auth.find(c => c.what === 'user' && c.body.data);
  check(nameCall && nameCall.body.data.name === 'Alex B Example' && named.user === 'Alex B Example' && named.stored === 'Alex B Example' && named.card === 'Alex B Example' && /Name saved/.test(await toast()), 'a new name is saved to the account and shows straight away: ' + JSON.stringify(named));
  // The password: the current one is checked first.
  await p.fill('#mePassNow', 'wrongpass'); await p.fill('#mePassNew', 'short'); await p.click('#mePassSave'); await p.waitForTimeout(200);
  check(/at least 8 characters/.test(await p.textContent('#mePassError')) && !auth.some(c => c.what === 'password'), 'a short new password is caught before anything is sent');
  await p.fill('#mePassNew', 'newpass456'); await p.click('#mePassSave'); await p.waitForTimeout(500);
  check(/isn't the password you have now/.test(await p.textContent('#mePassError')) && !auth.some(c => c.what === 'user' && c.body.password), 'the wrong current password is refused, and the password isn\'t changed: ' + await p.textContent('#mePassError'));
  await p.fill('#mePassNow', 'oldpass123'); await p.click('#mePassSave'); await p.waitForTimeout(600);
  const pw = auth.find(c => c.what === 'user' && c.body.password);
  const pwAfter = await p.evaluate(() => ({ token: authSession.access_token, stored: JSON.parse(localStorage.getItem('korva_session')).access_token, now: document.getElementById('mePassNow').value, next: document.getElementById('mePassNew').value, err: document.getElementById('mePassError').textContent }));
  check(pw && pw.body.password === 'newpass456' && pw.token === 'Bearer f.r.esh' && /Password changed/.test(await toast()), 'with the right one the password is changed, on a fresh sign-in');
  check(pwAfter.token === 'f.r.esh' && pwAfter.stored === 'f.r.esh' && !pwAfter.now && !pwAfter.next && !pwAfter.err, 'they stay signed in, and the boxes are cleared');

  // 7. Billing: the plan, then the plans, then one line that opens the explainer.
  await p.evaluate(() => openMenuPage('billingPanel')); await p.waitForTimeout(700); await shot('7-billing');
  const bill = await p.evaluate(() => {
    const top = el => el.getBoundingClientRect().top;
    const ex = document.querySelector('#billingPanel .billing-explainer');
    const shut = { open: ex.open, height: ex.getBoundingClientRect().height, summary: ex.querySelector('summary').textContent.trim() };
    ex.open = true;
    return { order: top(document.getElementById('billingStatusText')) < top(document.querySelector('#billingPanel [data-plan="starter"]')) && top(document.querySelector('#billingPanel [data-plan="business"]')) < top(ex), shut, text: ex.innerText };
  });
  check(bill.order && !bill.shut.open && bill.shut.height < 60 && bill.shut.summary === 'What counts as an AI fill?', 'Billing is the current plan, then the plans, then one line: "What counts as an AI fill?"');
  check(/tap Fill in the report/.test(bill.text) && /when you tap Describe/.test(bill.text) && !/Analyse|Extract data with AI/.test(bill.text), 'opened, it names the buttons as they are: Fill in the report and Describe');

  // 8. The chemical register says where each product's rates came from.
  await p.evaluate(() => openMenuPage('chemicalsPanel')); await p.waitForTimeout(600);
  const card = p.locator('#chemList .chem-card', { hasText: 'Termidor' }).first();
  await card.locator('summary').first().click(); await p.waitForTimeout(300);
  const note1 = await card.locator('.chem-rates-note').textContent();
  check(note1 === 'Rates from the label, checked 5 Nov 2026. Check they match yours.', 'a product at SAYON\'s rates says they came from the label, and when: ' + note1);
  await card.locator('.chem-edit > summary').click(); await p.waitForTimeout(200);
  const rate = card.locator('.chem-use input[data-u="rate"]').first();
  await rate.fill('55 mL per 10 L water'); await rate.dispatchEvent('change'); await p.waitForTimeout(300); await shot('8-chem-changed');
  const note2 = await card.locator('.chem-rates-note').textContent();
  const today = await p.evaluate(() => new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }));
  check(note2 === `Changed by you, ${today}`, 'once the business changes one, it says so and when: ' + note2);
  const other = await p.evaluate(() => [...document.querySelectorAll('#chemList .chem-card')].filter(c => !/termidor/i.test(c.dataset.find)).map(c => { c.open = true; const n = c.querySelector('.chem-rates-note'); return n ? n.textContent : ''; }).filter(Boolean));
  check(other.length > 0 && other.every(t => /^Rates from the label, checked 5 Nov 2026/.test(t)), 'the other products still say "from the label" (' + other.length + ')');
  check(await p.evaluate(() => { const c = [...document.querySelectorAll('#chemList .chem-card')].find(c => !c.querySelector('.chem-rate-val:not(.none)')); return !c || !c.querySelector('.chem-rates-note'); }), 'a product with no rate yet has no such line');

  // 9. Hidden means hidden: one rule in the styles, so a part with its own
  // layout can't ignore the mark (an unsigned report once showed "Sign again").
  const shown = await p.evaluate(() => [...document.querySelectorAll('[hidden]')].filter(e => getComputedStyle(e).display !== 'none').map(e => e.id || e.className));
  check(!shown.length, 'no part marked hidden is given a display by its own style: ' + shown.join(', '));
  const oneOff = [...fs.readFileSync('css/app.css', 'utf8').matchAll(/^[^{}\n]*\[hidden\][^{}\n]*\{\s*display:\s*none;?\s*\}/gm), ...fs.readFileSync('css/quote.css', 'utf8').matchAll(/^[^{}\n]*\[hidden\][^{}\n]*\{\s*display:\s*none;?\s*\}/gm)].map(m => m[0].trim()).filter(r => !/:has\(/.test(r));
  check(oneOff.length === 0, 'and no part has a rule of its own to obey it: ' + oneOff.slice(0, 3).join(' | '));

  check(!dialogs.length, 'the browser\'s grey box was never used: ' + dialogs.join(' | '));
  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
