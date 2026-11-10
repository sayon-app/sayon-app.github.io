// SAYON app: Sign in and out, billing, password reset, delete account, your team, business load, entering the app.
// One of the js/app/ files, which share one global scope: they load as plain
// scripts in the order index.html lists them, so a top-level name declared in
// any of them can be used from the others once the page has loaded.

// ── AUTH STATE ───────────────────────────────────────────────────────────
let authSession  = null;   // current Supabase session
let authUser     = null;   // current user object
let authBusiness = null;   // current business object
let pendingRecoverySession = null; // { access_token, refresh_token } from a password-reset email link, until submitted

function getAuthToken() {
  return authSession?.access_token || SUPABASE_KEY;
}

// Every call to the Worker goes through here. A phone that was locked or
// had the app in the background sleeps through the 5-minute token refresh
// below, so the sign-in is checked first, and a call refused for an
// expired sign-in is refreshed and sent once more.
// Calls without their own signal give up after this long, so a weak signal
// can't leave a button stuck on "Reading plate…" or "Sending…" for ever.
const WORKER_DEFAULT_TIMEOUT_MS = 90000;

async function workerFetch(path, init = {}) {
  await maybeRefreshAuthSession();
  let timer = null;
  let signal = init.signal;
  if (!signal) {
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), WORKER_DEFAULT_TIMEOUT_MS);
    signal = controller.signal;
  }
  const send = () => fetch(KORVA_WORKER_URL + path, {
    ...init,
    signal,
    headers: { ...init.headers, 'Authorization': 'Bearer ' + getAuthToken() },
  });
  try {
    let res = await send();
    if (res.status === 401 && authSession?.refresh_token && await refreshSession(authSession.refresh_token)) {
      res = await send();
    }
    return res;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function getAuthHeaders(extra = {}) {
  const token = getAuthToken();
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${token}`,
    ...extra,
  };
}

// ── SESSION PERSISTENCE ──────────────────────────────────────────────────
function saveSession(session) {
  try {
    localStorage.setItem('korva_session', JSON.stringify(session));
  } catch(e) {}
}

function loadSession() {
  try {
    const s = localStorage.getItem('korva_session');
    return s ? JSON.parse(s) : null;
  } catch(e) { return null; }
}

// Counted so a renewal of the sign-in still on its way when the person
// signs out isn't kept (refreshSession).
let sessionsEnded = 0;
function clearSession() {
  sessionsEnded++;
  try { localStorage.removeItem('korva_session'); } catch(e) {}
  authSession = null; authUser = null; authBusiness = null;
  resetBillingDisplay();
}

// ── BILLING / STRIPE ─────────────────────────────────────────────────────
// Talks to the new /stripe/* routes on the same Worker that already proxies
// AI calls (see korva-worker-with-stripe.js). NOT live until that Worker
// version is deployed and real Stripe keys/price IDs are configured — until
// then these calls will fail gracefully and the UI explains why instead of
// breaking silently.
const KORVA_WORKER_URL = 'https://korva.byronguyatt2.workers.dev';
let billingStatusCache = null;
// Where "contact us" points, everywhere in the app.
const SUPPORT_EMAIL = 'sayon.application@gmail.com';

function resetBillingDisplay() {
  const el = document.getElementById('billingStatusText');
  if (el) el.textContent = 'Sign in to see your plan.';
  const manageBtn = document.getElementById('manageBillingBtn');
  if (manageBtn) manageBtn.style.display = 'none';
  billingStatusCache = null;
}

// A real job takes 8 to 20 fills (the pricing doc's measurement); plans are
// sized at 20 so a busy job never comes up short.
const FILLS_PER_INSPECTION = 20;

// "12 of 800 AI fills used this month, about 39 inspections left. They come
// back on 1 Dec." The Worker starts a new count each calendar month (UTC).
// A trial ends before its count matters, so it doesn't say when they come back.
function billingUsageText(sub, trial) {
  const used = sub.ai_calls_used_this_period ?? 0;
  const limit = sub.limit;
  const period = trial ? '' : ' this month';
  if (!limit) return `${used} AI fills used${period}.`;
  const left = Math.max(0, limit - used);
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const when = next.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  const inspections = Math.floor(left / FILLS_PER_INSPECTION);
  const leftText = left === 0 ? 'none left' : `about ${inspections} inspection${inspections === 1 ? '' : 's'} left`;
  return `${used} of ${limit} AI fills used${period}, ${leftText}.` + (trial ? '' : ` They come back on ${when}.`);
}

async function loadBillingStatus() {
  const el = document.getElementById('billingStatusText');
  const manageBtn = document.getElementById('manageBillingBtn');
  if (!authUser) return;
  const forUser = authUser.id;
  if (el) el.textContent = 'Loading…';
  if (manageBtn) manageBtn.style.display = 'none';
  try {
    const res = await workerFetch('/stripe/subscription-status', { method: 'GET' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const sub = await res.json();
    // Signed out, or into another account, while this was loading.
    if (!authUser || authUser.id !== forUser) return;
    billingStatusCache = sub;
    const planLabel = planDisplayLabel(sub.plan);
    if (el) el.textContent = billingStatusLine(sub, planLabel);
    const owner = !authBusiness || isBusinessOwner();
    if (manageBtn) manageBtn.style.display = sub.stripe_customer_id && owner ? '' : 'none';
    showPlanOptions(sub, owner);
    markCurrentPlan(sub);
    renderProfileMenu();
    return sub;
  } catch (e) {
    if (!authUser || authUser.id !== forUser) return;
    // Say which it is: no signal, an account still being set up, or a
    // failure to try again, never "billing isn't set up".
    const status = parseInt((String(e.message).match(/HTTP (\d+)/) || [])[1], 10);
    if (el) el.textContent = !navigator.onLine ? 'No signal, so your plan can\'t be checked right now. It still works offline.'
      : status === 403 ? 'Your account is still being set up. Close SAYON and open it again'
      : 'Couldn\'t load your plan. Close this panel and open Billing again';
    console.warn('loadBillingStatus failed:', e.message);
  }
}

// Display name for a stored plan key. The stored key (trial/starter/pro/business)
// never changes; only what we show for it does.
function planDisplayLabel(plan) {
  if (plan === 'starter') return 'Solo';
  if (plan === 'pro') return 'Team';
  if (!plan) return 'Trial';
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

// The one line under Current Plan, for each state the plan can be in.
function billingStatusLine(sub, planLabel) {
  const when = iso => iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '';
  if (sub.status === 'trialing') {
    const daysLeft = sub.trial_ends_at ? Math.max(0, Math.ceil((new Date(sub.trial_ends_at) - Date.now()) / 86400000)) : null;
    if (daysLeft === 0) return 'Your free trial has ended. Choose a plan below to keep using AI fills; your reports and notes are all still here.';
    return `Free trial${daysLeft !== null ? `, ${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : ''}. ${billingUsageText(sub, true)}`;
  }
  if (sub.status === 'past_due') return `${planLabel} plan, but the last payment failed. Update your card in Manage${sub.current_period_end ? ` before ${when(sub.current_period_end)}` : ''} or AI fills stop.`;
  if (sub.status === 'canceled' || sub.status === 'cancelled') return `Your ${planLabel} plan has ended. Choose a plan below to keep using AI fills; your reports stay in your account either way.`;
  if (sub.cancel_at_period_end && sub.current_period_end) return `${planLabel} plan, ending on ${when(sub.current_period_end)}. ${billingUsageText(sub)}`;
  return `${planLabel} plan${sub.per_seat ? ` for ${sub.seats} inspector${sub.seats === 1 ? '' : 's'}` : ''}. ${billingUsageText(sub)}`;
}

// Team and Business are charged per inspector. They're offered only once
// the Worker says it can charge that way (seat_plans), and only the owner
// sees the plans to choose from.
const SEAT_PLANS = {
  pro: { input: 'seatsPro', total: 'seatTotalPro', min: 2, max: 9, perMonth: 79, yearly: false },
  business: { input: 'seatsBusiness', total: 'seatTotalBusiness', min: 10, max: 200, perMonth: 69, yearly: true },
};

function showPlanOptions(sub, owner) {
  const seatPlans = !!(sub && sub.seat_plans);
  document.querySelectorAll('#billingPanel [data-plan]').forEach(row => {
    row.hidden = !owner || (row.hasAttribute('data-seat-plan') && !seatPlans);
  });
  document.getElementById('billingOwnerOnly').hidden = owner;
  // Prices, cancelling and paying are the owner's business, not a technician's.
  document.getElementById('billingTermsRow').hidden = !owner;
  document.getElementById('seatPlansSoon').hidden = seatPlans || !owner;
  document.getElementById('billingSeatTerms').hidden = !seatPlans || !owner;
  Object.keys(SEAT_PLANS).forEach(plan => {
    const input = document.getElementById(SEAT_PLANS[plan].input);
    // The current plan's row starts at the places already paid for.
    if (input && sub && sub.plan === plan && sub.per_seat) input.value = sub.seats;
    onSeatInput(plan);
  });
}

// The number typed, kept inside the plan's range.
function seatInputValue(plan) {
  const cfg = SEAT_PLANS[plan];
  const n = parseInt(document.getElementById(cfg.input).value, 10);
  return Number.isFinite(n) ? Math.min(cfg.max, Math.max(cfg.min, n)) : cfg.min;
}

function onSeatInput(plan) {
  const cfg = SEAT_PLANS[plan];
  const n = seatInputValue(plan);
  const total = document.getElementById(cfg.total);
  if (total) total.textContent = planPriceText(plan, n);
  const sub = billingStatusCache;
  // On the current plan the button saves a new number of places.
  if (sub && sub.plan === plan && sub.per_seat && ['active', 'past_due'].includes(sub.status)) {
    const row = document.querySelector(`#billingPanel [data-plan="${plan}"]`);
    const btn = row && row.querySelector('button');
    if (btn) {
      const changed = n !== sub.seats;
      btn.textContent = changed ? `Change to ${n}` : 'Current plan';
      btn.disabled = !changed;
    }
  }
}

function choosePlan(plan) {
  const sub = billingStatusCache;
  if (SEAT_PLANS[plan] && sub && sub.plan === plan && sub.per_seat && ['active', 'past_due'].includes(sub.status)) {
    updateSeats(seatInputValue(plan));
    return;
  }
  const seats = SEAT_PLANS[plan] ? seatInputValue(plan) : undefined;
  const paying = sub && sub.plan && sub.plan !== 'trial' && sub.subscribed && ['active', 'past_due'].includes(sub.status);
  if (paying && !confirm(`Switch to ${planDisplayLabel(plan)}${seats ? ` for ${seats} inspectors` : ''} at ${planPriceText(plan, seats)}? It's charged now, less the unused part of your current plan, and only happens if the payment goes through.`)) return;
  openCheckout(plan, seats);
}

// "$316 a month" / "$9,936 a year" for a plan and number of inspectors.
function planPriceText(plan, seats) {
  const money = v => '$' + v.toLocaleString('en-AU');
  const cfg = SEAT_PLANS[plan];
  if (!cfg) return '$89 a month';
  return cfg.yearly ? `${money(seats * cfg.perMonth * 12)} a year` : `${money(seats * cfg.perMonth)} a month`;
}

let seatChangeInFlight = false;
async function updateSeats(seats) {
  const sub = billingStatusCache;
  if (!sub || seatChangeInFlight) return;
  const more = seats > sub.seats;
  const ask = more
    ? `Pay for ${seats} inspectors instead of ${sub.seats} (${planPriceText(sub.plan, seats)})? The extra places are charged now for the rest of what you've paid for.`
    : `Pay for ${seats} inspectors instead of ${sub.seats} (${planPriceText(sub.plan, seats)})? The unused part comes off your next bill.`;
  if (!confirm(ask)) return;
  seatChangeInFlight = true;
  try {
    const res = await workerFetch('/stripe/update-seats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seats }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(data.message || 'Couldn\'t change your places. Try again', 'error'); return; }
    showToast(`You now pay for ${seats} inspectors`, 'success');
    track('seats_changed', { plan: sub.plan, seats });
    await loadBillingStatus();
  } catch (e) {
    showToast('Couldn\'t change your places. Check your signal and try again', 'error');
  } finally {
    seatChangeInFlight = false;
  }
}

// The plan list says which row is the current plan, and the other buttons
// read Switch rather than Upgrade for someone already paying.
function markCurrentPlan(sub) {
  const paying = sub && sub.plan && sub.plan !== 'trial' && ['active', 'past_due'].includes(sub.status);
  document.querySelectorAll('#billingPanel [data-plan]').forEach(row => {
    const btn = row.querySelector('button');
    const current = paying && row.dataset.plan === sub.plan;
    row.classList.toggle('current-plan', current);
    if (btn) btn.textContent = current ? 'Current plan' : paying ? 'Switch' : 'Upgrade';
    if (btn) btn.disabled = !!current;
    // A per-inspector plan's own row can still change its number of places.
    if (current && SEAT_PLANS[sub.plan] && sub.per_seat) onSeatInput(sub.plan);
  });
}

// Back from Stripe Checkout: the webhook that records the payment can land
// a few seconds after the redirect. Until it does, the panel would still
// offer Upgrade, and a second tap could start a second subscription.
async function confirmBillingAfterCheckout() {
  const el = document.getElementById('billingStatusText');
  if (el) el.textContent = 'Confirming your payment…';
  for (let i = 0; i < 10; i++) {
    const sub = await loadBillingStatus();
    if (sub && (sub.status !== 'trialing' || sub.subscribed)) { showToast('Subscription updated. Thank you', 'success'); return; }
    if (el && i < 9) el.textContent = 'Confirming your payment…';
    await new Promise(r => setTimeout(r, 2000));
  }
  showToast('Payment received. Your plan shows here once Stripe confirms it, usually within a minute', 'info');
}

// Strips any existing query string / hash and attaches a `billing=` marker
// so handleBillingReturn() can tell, on the way back from Stripe, whether
// checkout succeeded or was cancelled and react accordingly.
function billingReturnUrl(marker) {
  return window.location.origin + window.location.pathname + '?billing=' + marker;
}

// One checkout at a time: two quick taps used to start two Stripe
// customers for the same business.
let checkoutInFlight = false;

async function openCheckout(plan, seats) {
  if (!authUser) { showToast('Sign in first', 'error'); return; }
  if (checkoutInFlight) return;
  checkoutInFlight = true;
  track('checkout_opened', { plan, seats });
  let status = 0;
  try {
    const res = await workerFetch('/stripe/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan,
        seats,
        successUrl: billingReturnUrl('success'),
        cancelUrl: billingReturnUrl('cancelled'),
      }),
    });
    status = res.status;
    const rawBody = await res.text();
    let data;
    try { data = JSON.parse(rawBody); } catch { throw new Error(rawBody.slice(0, 200) || `HTTP ${res.status}`); }
    // Already paying: the Worker switched the plan without leaving the app.
    if (res.ok && data.switched) {
      showToast(`You're now on ${planDisplayLabel(data.plan || plan)}`, 'success');
      await loadBillingStatus();
      return;
    }
    if (!res.ok || !data.url) throw new Error(data && data.message || rawBody || `HTTP ${res.status}`);
    window.location.href = data.url;
  } catch (e) {
    // 400, 402 and 409 carry a reason worth reading: the number of
    // inspectors, a declined card, or a team too big for the plan.
    showToast(status === 403
      ? 'Only the business owner can change the plan'
      : (status === 400 || status === 402 || status === 409) && e.message ? e.message.replace(/\.$/, '')
      : 'Could not open checkout. Check your signal and try again', 'error');
    console.warn('openCheckout failed:', e.message);
  } finally {
    // Leaving for Stripe keeps the lock on, so a tap during the redirect
    // does nothing.
    setTimeout(() => { checkoutInFlight = false; }, 3000);
  }
}

// Called once on app entry — notices if we've just been bounced back from
// a Stripe Checkout or Billing Portal redirect (see billingReturnUrl above)
// and reacts: toast + refresh the plan display, then scrubs the marker out
// of the URL so refreshing the page doesn't re-show the toast.
function handleBillingReturn() {
  try {
    const params = new URLSearchParams(window.location.search);
    const billing = params.get('billing');
    if (!billing) return;

    if (billing === 'success') {
      confirmBillingAfterCheckout();
    } else if (billing === 'cancelled') {
      showToast('Checkout cancelled. Nothing was changed', 'info');
    } else if (billing === 'updated') {
      loadBillingStatus();
    }

    params.delete('billing');
    const newSearch = params.toString();
    history.replaceState(null, '', window.location.pathname + (newSearch ? '?' + newSearch : '') + window.location.hash);
  } catch (e) {
    console.warn('handleBillingReturn error:', e.message);
  }
}

async function openBillingPortal() {
  if (!authUser) { showToast('Sign in first', 'error'); return; }
  try {
    const res = await workerFetch('/stripe/create-portal-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnUrl: billingReturnUrl('updated') }),
    });
    const rawBody = await res.text();
    let data;
    try { data = JSON.parse(rawBody); } catch { throw new Error(rawBody.slice(0, 200) || `HTTP ${res.status}`); }
    if (!res.ok || !data.url) throw new Error(data && data.message || rawBody || `HTTP ${res.status}`);
    window.location.href = data.url;
  } catch (e) {
    showToast('Could not open billing. Try again shortly', 'error');
    console.warn('openBillingPortal failed:', e.message);
  }
}

// ── AUTH API CALLS ───────────────────────────────────────────────────────
async function supabaseAuth(endpoint, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
    body: JSON.stringify(body),
  });
  // Supabase itself being down is not a refusal: callers treat a thrown
  // error like no signal and keep the saved sign-in.
  if (res.status >= 500) throw new Error(`Supabase auth HTTP ${res.status}`);
  const data = await res.json().catch(() => ({}));
  // FIX: callers (signIn/signUp) were written against the older OAuth2-style
  // error shape ({error: {message: '...'}}) and checked `if (data.error)`.
  // Supabase Auth's current API returns failures as {code, error_code, msg}
  // instead - there is no `.error` property at all - so a wrong password or
  // nonexistent account was falling through the `if (data.error)` check as
  // if it were a successful login, then crashing on `data.user.id` (data.user
  // is undefined on an error response), which got caught by the generic
  // try/catch and mislabeled as "Network error — please try again." Every
  // failed sign-in hit this, 100% reproducibly, regardless of connectivity.
  // Normalizing here means every existing `data.error` / `data.error.message`
  // check downstream keeps working, whichever shape Supabase actually sent.
  // The older OAuth2 shape sends `error` as a plain string code.
  if (!res.ok && (!data.error || typeof data.error === 'string')) {
    data.error = {
      code: data.error_code || (typeof data.error === 'string' ? data.error : null),
      message: data.msg || data.error_description || 'Request failed',
    };
  }
  return data;
}

// ── PASSWORD RESET (via emailed recovery link) ───────────────────────────
// Supabase's "forgot password" email links back to this app with
// #access_token=...&refresh_token=...&type=recovery in the URL hash. Read it
// once at boot, then let the user set a new password with it.
function parseRecoveryHash() {
  const hash = window.location.hash || '';
  if (!hash || hash.indexOf('type=recovery') === -1) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const access_token = params.get('access_token');
  if (!access_token) return null;
  return { access_token, refresh_token: params.get('refresh_token') || null };
}

async function submitPasswordReset() {
  const pw     = document.getElementById('rpPassword').value;
  const pw2    = document.getElementById('rpPasswordConfirm').value;
  const errEl  = document.getElementById('rpError');
  const btn    = document.getElementById('rpBtn');

  errEl.textContent = '';
  if (!pw || pw.length < 8) { errEl.textContent = 'Password must be at least 8 characters.'; return; }
  if (pw !== pw2) { errEl.textContent = 'Passwords do not match.'; return; }
  if (!pendingRecoverySession?.access_token) {
    errEl.textContent = 'This reset link has expired. Ask for a new one from Forgot password on the sign-in screen.';
    return;
  }

  btn.disabled = true; btn.textContent = 'Updating…';
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${pendingRecoverySession.access_token}`,
      },
      body: JSON.stringify({ password: pw }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      errEl.textContent = data.msg || data.error_description || data.error?.message || 'Could not update the password. The link may have expired.';
      return;
    }
    pendingRecoverySession = null;
    document.getElementById('rpPassword').value = '';
    document.getElementById('rpPasswordConfirm').value = '';
    showAuth('authSignIn');
    showToast('Password updated. Sign in with your new password', 'success');
  } catch(e) {
    errEl.textContent = 'Couldn\'t reach SAYON. Check your signal and try again.';
  } finally {
    btn.disabled = false; btn.textContent = 'Update password';
  }
}

// True when the last refresh never reached Supabase (no signal), as opposed
// to Supabase refusing the refresh token.
let lastRefreshWasOffline = false;

async function refreshSession(refreshToken) {
  lastRefreshWasOffline = false;
  const ended = sessionsEnded;
  try {
    const data = await supabaseAuth('token?grant_type=refresh_token', { refresh_token: refreshToken });
    // Signed out while it was on its way (on a weak signal it can take a
    // while): the new sign-in would sign them back in, so it's dropped.
    if (data.access_token && ended === sessionsEnded) {
      authSession = data;
      saveSession(data);
      return true;
    }
  } catch(e) { lastRefreshWasOffline = true; }
  return false;
}

// ── BACKGROUND AUTH REFRESH ──────────────────────────────────────────────
// Supabase access tokens are short-lived (~1hr). Inspectors often keep the
// app open for an entire job (or a full day in the field) without ever
// reloading it, which previously meant the token would silently expire
// mid-session and every Supabase call would start failing with no retry.
// This keeps the session alive proactively so that never happens.
let authAutoRefreshTimer = null;
const AUTH_AUTO_REFRESH_CHECK_MS = 5 * 60 * 1000;   // re-check every 5 minutes
const AUTH_REFRESH_LEAD_SECONDS  = 10 * 60;         // refresh once within 10 min of expiry

let authRefreshInFlight = null; // shared, so callers at the same moment refresh once

async function maybeRefreshAuthSession() {
  if (!authSession?.refresh_token) return;
  const exp = authSession.expires_at || 0;
  const now = Math.floor(Date.now() / 1000);
  if (now > exp - AUTH_REFRESH_LEAD_SECONDS) {
    authRefreshInFlight ||= refreshSession(authSession.refresh_token).finally(() => { authRefreshInFlight = null; });
    await authRefreshInFlight;
  }
}

function startAuthAutoRefresh() {
  stopAuthAutoRefresh();
  authAutoRefreshTimer = setInterval(maybeRefreshAuthSession, AUTH_AUTO_REFRESH_CHECK_MS);
}

function stopAuthAutoRefresh() {
  if (authAutoRefreshTimer) { clearInterval(authAutoRefreshTimer); authAutoRefreshTimer = null; }
}

// ── SIGN UP ──────────────────────────────────────────────────────────────
// The Terms and Privacy versions a new account agrees to at sign-up. Raise
// these with the "Version N" lines at the top of terms.html and privacy.html.
const LEGAL_VERSIONS = { terms: 3, privacy: 8 };

async function signUp() {
  const name     = document.getElementById('suName').value.trim();
  const business = document.getElementById('suBusiness').value.trim();
  const email    = document.getElementById('suEmail').value.trim();
  const password = document.getElementById('suPassword').value;
  const errEl    = document.getElementById('suError');
  const btn      = document.getElementById('suBtn');

  errEl.textContent = '';
  // Joining from an invite link: the business is theirs to join, not to name.
  const joining = document.getElementById('suBusinessField').hidden;
  const missing = [!name && 'your name', !business && !joining && 'your business name', !email && 'your email', !password && 'a password'].filter(Boolean);
  if (missing.length) { errEl.textContent = `Add ${joinWithAnd(missing)}.`; return; }
  if (!document.getElementById('suConsent').checked) { errEl.textContent = 'Tick the box to agree to the Terms of Service and Privacy Policy.'; return; }
  // Receipts and password resets go to this address, so a typo locks the
  // account out of both.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { errEl.textContent = 'That email address doesn\'t look right. Check it: your receipts and password resets go there.'; return; }
  if (password.length < 8) { errEl.textContent = 'Password must be at least 8 characters.'; return; }

  btn.disabled = true; btn.textContent = 'Creating account…';
  try {
    // Store business name locally — survives the email confirmation redirect
    if (!joining) localStorage.setItem('korva_pending_business', business);

    const data = await supabaseAuth('signup', {
      email, password,
      // Which Terms and Privacy versions they ticked, and when, kept with the login.
      data: Object.assign(joining ? { name } : { name, business_name: business },
        { terms_version: LEGAL_VERSIONS.terms, privacy_version: LEGAL_VERSIONS.privacy, terms_accepted_at: new Date().toISOString() }),
    });
    if (data.error) {
      if (data.error.code === 'user_already_exists' || /already (registered|exists)/i.test(data.error.message || '')) {
        errEl.innerHTML = 'There\'s already a SAYON account for this email. <button type="button" class="auth-inline-link" onclick="signInAs(document.getElementById(\'suEmail\').value)">Sign in</button> or <button type="button" class="auth-inline-link" onclick="showAuth(\'authForgot\')">reset the password</button>.';
        return;
      }
      errEl.textContent = data.error.code === 'weak_password' ? 'That password is too easy to guess. Try a longer one.' : (data.error.message || 'Couldn\'t create the account. Try again.');
      return;
    }

    if (data.access_token) {
      // Email confirmation is disabled on this project, so Supabase already handed back
      // a working session — log the new user straight in instead of telling them to check
      // an email that will never need to arrive.
      authSession = data;
      authUser    = data.user;
      saveSession(data);
      localStorage.setItem('korva_last_user_id', data.user.id);
      telemetryIdentify(data.user.id);
      track('signed_up');

      await loadBusiness();
      startAuthAutoRefresh();
      enterApp();
      return;
    }

    // Fallback for if email confirmation is ever turned back on for this project —
    // Supabase then returns a user with no session until the confirmation link is clicked.
    document.getElementById('authConfirmEmail').textContent = email;
    showAuth('authConfirm');
  } catch(e) {
    errEl.textContent = 'Couldn\'t reach SAYON. Check your signal and try again.';
  } finally {
    btn.disabled = false; btn.textContent = 'Create account';
  }
}

// Back to the sign-in card with the email already typed.
function signInAs(email) {
  const el = document.getElementById('siEmail');
  if (el && email) el.value = email.trim();
  showAuth('authSignIn');
}

// ── SIGN IN ──────────────────────────────────────────────────────────────
async function signIn() {
  const email    = document.getElementById('siEmail').value.trim();
  const password = document.getElementById('siPassword').value;
  const errEl    = document.getElementById('siError');
  const btn      = document.getElementById('siBtn');

  errEl.textContent = '';
  if (!email || !password) { errEl.textContent = !email && !password ? 'Enter your email and password.' : !email ? 'Enter your email.' : 'Enter your password.'; return; }

  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const data = await supabaseAuth('token?grant_type=password', { email, password });
    if (data.error) {
      // Branch on the stable error code, not the message text, which Supabase
      // can reword between API versions (see supabaseAuth()'s normalization).
      errEl.textContent = data.error.code === 'invalid_credentials' || data.error.message === 'Invalid login credentials'
        ? 'That email and password don\'t match. Check them, or tap Forgot password.' : (data.error.message || 'Couldn\'t sign in. Try again.');
      return;
    }
    authSession = data;
    authUser    = data.user;
    saveSession(data);
    telemetryIdentify(data.user.id);
    track('signed_in');

    // Saved reports are now scoped per-account (reportsStorageKey()), so a
    // different user signing in on this device simply reads their OWN key -
    // nothing to wipe here any more. An in-progress unsaved draft is still
    // cleared, since that one genuinely shouldn't follow a different account.
    const prevUserId = localStorage.getItem('korva_last_user_id');
    if (prevUserId && prevUserId !== data.user.id) {
      localStorage.removeItem(DRAFT_KEY);
      localStorage.removeItem(UNSAVED_SHEETS_KEY);
    }
    localStorage.setItem('korva_last_user_id', data.user.id);

    await loadBusiness();
    startAuthAutoRefresh();
    enterApp();
  } catch(e) {
    errEl.textContent = 'Couldn\'t reach SAYON. Check your signal and try again.';
  } finally {
    btn.disabled = false; btn.textContent = 'Sign in';
  }
}

// ── FORGOT PASSWORD ──────────────────────────────────────────────────────
async function forgotPassword() {
  const email = document.getElementById('fpEmail').value.trim();
  const errEl = document.getElementById('fpError');
  const btn   = document.getElementById('fpBtn');

  errEl.textContent = '';
  errEl.style.color = '';
  if (!email) { errEl.textContent = 'Enter the email you signed up with.'; return; }

  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    // Send the reset link back to wherever this app is currently being served
    // from, so clicking it in the user's email returns them straight to the
    // in-app "set a new password" screen instead of a dead end.
    const redirectTo = encodeURIComponent(window.location.origin + window.location.pathname);
    const res = await fetch(`${SUPABASE_URL}/auth/v1/recover?redirect_to=${redirectTo}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      errEl.textContent = res.status === 429
        ? 'Too many reset requests. Wait a few minutes and try again.'
        : 'Could not send the reset link. Please try again.';
      return;
    }
    errEl.style.color = 'var(--green)';
    errEl.textContent = 'Reset link sent. Check your email, including junk.';
  } catch(e) {
    errEl.textContent = 'Couldn\'t reach SAYON. Check your signal and try again.';
  } finally {
    btn.disabled = false; btn.textContent = 'Send reset link';
  }
}

// ── SIGN OUT ─────────────────────────────────────────────────────────────
// Client details, signatures and photos leave the phone with the account, so
// a shared or lost phone doesn't hold them. Everything is backed up to the
// account first; signing back in restores the reports from there (see
// supabaseSyncOnOpen) and photos download again as they're viewed. If the
// backup can't finish (no signal), the inspector chooses whether to wait.
async function signOut() {
  if (authSession) {
    saveOpenReportNow();
    const reports = getSavedReports();
    let failed = 0;
    if (reports.length) showToast('Backing up your reports before signing out…', 'info');
    for (const entry of reports) {
      const ok = await supabaseSave(entry, true);
      if (!ok || allReportPhotos(entry.reportData).some(p => !p.path)) failed++;
    }
    const unsaved = !currentReportId && hasReportContent(reportData);
    if (failed || unsaved) {
      const lost = [
        failed ? `${failed} saved report${failed === 1 ? '' : 's'} couldn't be backed up (no signal?)` : '',
        unsaved ? 'The open report hasn\'t been saved' : '',
      ].filter(Boolean).join('. ');
      if (!confirm(`${lost}.\n\nSigning out removes reports from this phone. Sign out anyway and lose them?`)) {
        showToast('Still signed in. Your reports are safe on this phone', 'info');
        return;
      }
    }
  }
  try {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${getAuthToken()}` },
    });
  } catch(e) {}
  await endSessionOnDevice();
}

// Clears the session and every report, quote, draft and photo from this
// phone, then shows the sign-in screen.
async function endSessionOnDevice() {
  const reportsKey = reportsStorageKey(), quotesKey = quotesStorageKey();
  telemetrySignedOut();
  stopAuthAutoRefresh();
  clearSession();
  localStorage.removeItem('korva_last_user_id');
  localStorage.removeItem(BUSINESS_CACHE_KEY);
  [reportsKey, quotesKey, DRAFT_KEY, UNSAVED_SHEETS_KEY].forEach(k => localStorage.removeItem(k));
  try { await photoStoreRequest('readwrite', st => st.clear()); } catch (e) {}
  currentReportId = null;
  if (appInitialised) {
    resetReportState();
    ['jobAddress','jobSuburb','jobState','jobPostcode','jobClient','jobInspector'].forEach(id => { document.getElementById(id).value = ''; });
    updateJob();
    renderSavedList();
  }
  document.getElementById('mainMenu').style.display  = 'none';
  document.getElementById('app').style.display       = 'none';
  document.getElementById('authScreen').style.display = 'flex';
  showAuth('authSignIn');
}

// ── DELETE MY ACCOUNT ────────────────────────────────────────────────────
// Permanently deletes the signed-in user's account and everything stored
// against it (see supabase/delete-account.sql). The database checks run
// first, so nothing is removed if the account can't be deleted yet. Photos
// go next, through the storage API, then the account itself, then this
// phone's copy.
const DELETE_ACCOUNT_BLOCKERS = {
  ACTIVE_SUBSCRIPTION: 'Your plan is still active. Cancel it in Menu › Billing › Manage first, then delete your account',
  HAS_TEAM: 'Other people are still on your team. Remove them in Menu › Your team first, then delete your account',
};

async function deleteAccountRpc(dryRun) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/delete_my_account`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ dry_run: dryRun }),
  });
  if (res.ok) return null;
  const err = await res.json().catch(() => ({}));
  const code = Object.keys(DELETE_ACCOUNT_BLOCKERS).find(k => (err.message || '').includes(k));
  return code ? DELETE_ACCOUNT_BLOCKERS[code] : 'Could not delete your account. Check your signal and try again';
}

// The owner's Stripe customer (name, email, saved card) goes with the
// account, through the Worker. Returns an error message, or null to carry
// on: a business with no Stripe customer, someone who isn't the owner (403), and
// a Worker without this route yet (404) or without billing (503) all carry
// on, so deleting an account never waits on billing being set up.
async function deleteMyStripeCustomer() {
  const res = await workerFetch('/stripe/delete-customer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (res.ok || res.status === 403 || res.status === 404 || res.status === 503) return null;
  const err = await res.json().catch(() => ({}));
  const code = Object.keys(DELETE_ACCOUNT_BLOCKERS).find(k => (err.message || '').includes(k));
  return code ? DELETE_ACCOUNT_BLOCKERS[code] : 'Could not close your billing account. Check your signal and try again';
}

async function deleteMyPhotos() {
  await deleteMyFiles(PHOTO_BUCKET);
  // The PDFs behind client links: <user id>/<link folder>/<file>.pdf.
  await deleteMyFiles(CLIENT_DOCS_BUCKET, true);
}

// Deletes everything under <user id>/ in a bucket, through the storage
// policies. With nested, each folder under it is emptied too.
async function deleteMyFiles(bucket, nested) {
  const listFolder = async prefix => {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
    });
    // The client-docs bucket may never have been set up: nothing of ours in it.
    if (nested && (res.status === 400 || res.status === 404)) return [];
    if (!res.ok) throw new Error(`list ${bucket} ` + res.status);
    return res.json();
  };
  const top = authUser.id + '/';
  const folders = nested ? (await listFolder(top)).filter(f => !f.id).map(f => top + f.name + '/') : [top];
  for (const prefix of folders) await deleteFolder(bucket, prefix, listFolder);
}

async function deleteFolder(bucket, prefix, listFolder) {
  // Bounded: if a delete ever reports success but removes nothing, the
  // same files would be listed again and this would never finish.
  for (let round = 0; round < 50; round++) {
    const files = (await listFolder(prefix)).filter(f => f.id).map(f => prefix + f.name);
    if (!files.length) return;
    const del = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      body: JSON.stringify({ prefixes: files }),
    });
    if (!del.ok) throw new Error(`delete ${bucket} ` + del.status);
    const removed = await del.json().catch(() => null);
    if (Array.isArray(removed) && removed.length === 0) throw new Error(`delete ${bucket} removed nothing`);
  }
  throw new Error(`delete ${bucket} did not finish`);
}

async function deleteMyAccount() {
  if (!authSession || !authUser) { showToast('Sign in to delete your account', 'error'); return; }
  if (!navigator.onLine) { showToast('You need signal to delete your account', 'error'); return; }
  const typed = prompt(
    'This permanently deletes your SAYON account, every saved report and photo, ' +
    (authBusiness && authBusiness.owner_id === authUser.id ? 'your business details, ' : '') +
    'and everything on this phone. It cannot be undone.\n\nExport your data first if you want a copy.\n\nType DELETE to confirm.');
  if (typed === null) return;
  if (typed.trim().toUpperCase() !== 'DELETE') { showToast('Not deleted. Type DELETE to confirm', 'info'); return; }
  showToast('Deleting your account…', 'info');
  try {
    const blocked = await deleteAccountRpc(true);
    if (blocked) { showToast(blocked, 'error'); return; }
    const billing = await deleteMyStripeCustomer();
    if (billing) { showToast(billing, 'error'); return; }
    await deleteMyPhotos();
    const failed = await deleteAccountRpc(false);
    if (failed) { showToast(failed, 'error'); return; }
  } catch (e) {
    console.warn('deleteMyAccount:', e);
    showToast('Could not delete your account. Check your signal and try again', 'error');
    return;
  }
  await endSessionOnDevice();
  showToast('Your account and data have been deleted', 'info');
}

// Makes sure the current user has a team_members row for authBusiness.
// Needed because older accounts could end up with a business but no
// team_members row (e.g. the insert silently failed before the RLS fix).
// Safe to call repeatedly — it's a no-op once the row exists.
async function ensureOwnerTeamMember() {
  try {
    const chk = await fetch(
      `${SUPABASE_URL}/rest/v1/team_members?business_id=eq.${authBusiness.id}&user_id=eq.${authUser.id}&limit=1`,
      { headers: getAuthHeaders() }
    );
    if (!chk.ok) return;
    const rows = await chk.json();
    if (rows.length > 0) return; // already there
    const meta = authUser.user_metadata || {};
    await fetch(`${SUPABASE_URL}/rest/v1/team_members`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        business_id: authBusiness.id,
        user_id: authUser.id,
        role: 'owner',
        name: meta.name || authUser.email,
        email: authUser.email,
      }),
    });
  } catch(e) { console.warn('ensureOwnerTeamMember error:', e); }
}

// The secret from an invite link, kept until sign-in uses it (it has to
// survive the sign-up and any reload in between).
const PENDING_INVITE_KEY = 'korva_pending_invite';

function pendingInviteToken() {
  try { return localStorage.getItem(PENDING_INVITE_KEY) || ''; } catch (e) { return ''; }
}
function clearPendingInvite() {
  try { localStorage.removeItem(PENDING_INVITE_KEY); } catch (e) {}
}

// With an invite link's secret on this phone: the business id once they've
// joined it, null when there's nothing to join (carry on and make their own
// business), or false when it can't be settled now (no signal, or no free
// place yet), so no business of their own is made and the next sign-in
// tries again.
async function acceptTeamInvite() {
  const token = pendingInviteToken();
  if (!token) return null;
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/accept_invite`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ p_token: token }) });
  } catch (e) {
    console.warn('acceptTeamInvite failed:', e);
    return false;
  }
  if (res.ok) {
    const id = await res.json().catch(() => null);
    clearPendingInvite();
    if (typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)) return id;
    showToast('That invite link didn\'t work for this account (it may have expired or been replaced), so you have an account of your own. Email SAYON if you should be on their team', 'info');
    return null;
  }
  const err = await res.json().catch(() => ({}));
  if (/NO_SEATS/.test(err.message || '')) {
    showToast('The business that invited you has no free inspector place right now. Ask them to add one, then open SAYON again', 'info');
    return false;
  }
  if (res.status >= 500) return false;
  // Anything else (the database not set up for teams yet): carry on as before.
  clearPendingInvite();
  return null;
}

// ── YOUR TEAM ────────────────────────────────────────────────────────────
// The owner invites inspectors by email and sends them a sign-up link. On
// Team and Business each person takes one paid inspector place, the owner
// included; a pending invite holds one too. The database does the counting
// (invite_member and accept_invite in supabase/team-seats.sql); this page
// shows it and the Worker refuses fewer places than people.

// Must match business_seat_cap() in supabase/team-seats.sql.
function teamPlaceCap(sub) {
  if (!sub) return null;
  if (sub.status === 'canceled' || sub.status === 'cancelled') return 0;
  if (sub.plan === 'trial') return 3;
  if (sub.plan === 'starter') return 1;
  return Math.max(1, sub.seats || 1);
}

let teamCache = { members: [], invites: [] };

async function loadTeam() {
  const list = document.getElementById('teamList');
  const placesEl = document.getElementById('teamPlacesText');
  if (!authBusiness || !isBusinessOwner()) {
    placesEl.textContent = 'Your business owner looks after the team.';
    list.innerHTML = '';
    return;
  }
  placesEl.textContent = 'Loading…';
  try {
    const [mRes, iRes, sub] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/team_members?business_id=eq.${authBusiness.id}&select=user_id,role,name,email&order=joined_at.asc`, { headers: getAuthHeaders() }),
      fetch(`${SUPABASE_URL}/rest/v1/invites?business_id=eq.${authBusiness.id}&status=eq.pending&select=id,email&order=created_at.asc`, { headers: getAuthHeaders() }),
      billingStatusCache ? Promise.resolve(billingStatusCache) : loadBillingStatus(),
    ]);
    if (!mRes.ok || !iRes.ok) throw new Error('HTTP ' + (mRes.ok ? iRes.status : mRes.status));
    teamCache = { members: await mRes.json(), invites: await iRes.json() };
    renderTeam(sub);
  } catch (e) {
    console.warn('loadTeam failed:', e.message);
    placesEl.textContent = navigator.onLine ? 'Couldn\'t load your team. Close this page and open it again' : 'Your team loads when you have signal.';
  }
}

function renderTeam(sub) {
  const { members, invites } = teamCache;
  const cap = teamPlaceCap(sub);
  const taken = members.length + invites.length;
  const placesEl = document.getElementById('teamPlacesText');
  const plan = sub ? planDisplayLabel(sub.plan) : '';
  if (cap === null) placesEl.textContent = `${taken} on your team.`;
  else if (sub.plan === 'starter') placesEl.textContent = 'Solo is for one inspector. To add inspectors, move to Team in Billing.';
  else if (sub.plan === 'trial') placesEl.textContent = `${taken} of ${cap} places used. The free trial lets you try SAYON with up to ${cap} people; Team takes up to 9.`;
  else placesEl.textContent = `${taken} of ${cap} inspector places used on your ${plan} plan.`;
  const full = cap !== null && taken >= cap;
  document.getElementById('teamInviteBtn').disabled = full;
  document.getElementById('teamInviteEmail').disabled = full;
  document.getElementById('teamMorePlaces').hidden = !full;

  const rows = members.map(m => {
    const you = m.user_id === authUser.id;
    const who = escapeHtml(m.name && m.name !== m.email ? m.name : m.email || 'Inspector');
    return `<div class="team-row">
      <div class="team-row-text"><div class="team-row-name">${who}${you ? ' (you)' : ''}</div>
      <div class="team-row-sub">${escapeHtml(m.email || '')}${m.role === 'owner' ? ' · Owner' : ''}</div></div>
      ${you || m.role === 'owner' ? '' : `<button class="link-btn team-row-btn" data-id="${escapeHtml(m.user_id)}" onclick="removeTeamMember(this.dataset.id)">Remove</button>`}
    </div>`;
  });
  invites.forEach(i => {
    rows.push(`<div class="team-row team-row-pending">
      <div class="team-row-text"><div class="team-row-name">${escapeHtml(i.email)}</div>
      <div class="team-row-sub">Invited, not signed up yet</div></div>
      <button class="link-btn team-row-btn" data-id="${escapeHtml(i.id)}" onclick="shareTeamInvite(this.dataset.id)">Send link</button>
      <button class="link-btn team-row-btn" data-id="${escapeHtml(i.id)}" onclick="cancelTeamInvite(this.dataset.id)">Cancel</button>
    </div>`);
  });
  document.getElementById('teamList').innerHTML = rows.join('');
}

async function inviteTeamMember() {
  const input = document.getElementById('teamInviteEmail');
  const email = input.value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { showToast('That email address doesn\'t look right', 'error'); input.focus(); return; }
  const btn = document.getElementById('teamInviteBtn');
  btn.disabled = true;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/invite_member`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ p_email: email }) });
    const answer = res.ok ? await res.json() : null;
    const result = answer && answer.status;
    const say = {
      invited: null,
      already_invited: 'They\'re already invited. Tap Send link to send it again',
      already_member: 'They\'re already on your team',
      no_seats: 'Every inspector place is taken. Add more in Billing first',
      bad_email: 'That email address doesn\'t look right',
      not_owner: 'Only the business owner can invite people',
    };
    if (!result || !(result in say)) { showToast('Couldn\'t send the invite. Check your signal and try again', 'error'); return; }
    if (result !== 'invited') { showToast(say[result], result === 'already_invited' ? 'info' : 'error'); return; }
    input.value = '';
    track('team_invite_sent');
    await loadTeam();
    await sendInviteLink(email, answer.token);
  } catch (e) {
    showToast('Couldn\'t send the invite. Check your signal and try again', 'error');
  } finally {
    btn.disabled = false;
    if (billingStatusCache) renderTeam(billingStatusCache);
  }
}

// The sign-up link for an invited inspector. Its secret is what lets them
// join, so it's only ever in the link the owner sends; the sign-up card
// looks up the business and email from it.
function teamInviteLink(token) {
  const u = new URL(window.location.origin + window.location.pathname);
  u.searchParams.set('signup', '1');
  u.searchParams.set('invite', token);
  return u.toString();
}

// "Send link" on a waiting invite: a fresh link (the old one stops working).
async function shareTeamInvite(inviteId) {
  const inv = teamCache.invites.find(x => x.id === inviteId);
  if (!inv) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/invite_link`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ p_invite_id: inviteId }) });
    const token = res.ok ? await res.json() : null;
    if (!token) throw new Error('HTTP ' + res.status);
    await sendInviteLink(inv.email, token);
  } catch (e) {
    showToast('Couldn\'t make a new link. Check your signal and try again', 'error');
  }
}

async function sendInviteLink(email, token) {
  const biz = getCompanyDetails().name || authBusiness?.name || 'our business';
  const link = teamInviteLink(token);
  const text = `You're invited to use SAYON with ${biz}. Sign up with ${email} here and you'll join our account. The link works for 14 days:`;
  try {
    if (navigator.share) { await navigator.share({ title: 'Join ' + biz + ' on SAYON', text, url: link }); return; }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(`${text} ${link}`);
    showToast('Sign-up link copied. Paste it into a text or email to them', 'success');
  } catch (e) {
    showToast(`Send them this sign-up link: ${link}`, 'info');
  }
}

async function removeTeamMember(userId) {
  const m = teamCache.members.find(x => x.user_id === userId);
  if (!m || userId === authUser.id) return;
  if (!confirm(`Take ${m.name || m.email} off your team? They can't use SAYON with your business after this. Their reports stay in their account.`)) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/team_members?business_id=eq.${authBusiness.id}&user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE', headers: getAuthHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    showToast('Taken off your team. That frees an inspector place; change how many you pay for in Billing', 'success');
    loadTeam();
  } catch (e) {
    showToast('Couldn\'t take them off. Check your signal and try again', 'error');
  }
}

async function cancelTeamInvite(id) {
  const i = teamCache.invites.find(x => x.id === id);
  if (!i || !confirm(`Cancel the invite for ${i.email}?`)) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/invites?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: getAuthHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    showToast('Invite cancelled', 'success');
    loadTeam();
  } catch (e) {
    showToast('Couldn\'t cancel the invite. Check your signal and try again', 'error');
  }
}

// The sign-up card, opened from an invite link (?signup=1&invite=<secret>):
// the database says which business and email the secret is for, and the
// card fills those in, so there's nothing to set up. The secret is kept for
// sign-in and taken out of the address bar.
async function applyInviteToSignUp() {
  const params = new URLSearchParams(window.location.search);
  const token = (params.get('invite') || '').trim();
  if (!/^[0-9a-f]{64}$/.test(token)) return;
  params.delete('invite');
  history.replaceState(null, '', window.location.pathname + (params.toString() ? '?' + params : '') + window.location.hash);
  try { localStorage.setItem(PENDING_INVITE_KEY, token); } catch (e) {}
  let invite = null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({ p_token: token }),
    });
    if (res.ok) invite = await res.json();
  } catch (e) { /* no signal: a plain sign-up card, and sign-in still tries the secret */ }
  const sub = document.getElementById('suSubtitle');
  if (!invite || !invite.business || !invite.email) {
    if (invite === null) clearPendingInvite();
    if (invite === null) sub.textContent = 'That invite link has expired or been replaced. Ask for a new one, or sign up as your own business.';
    return;
  }
  inviteSignUp = { business: String(invite.business).slice(0, 120), email: String(invite.email) };
  document.getElementById('suEmail').value = inviteSignUp.email;
  showInviteSignUp(true);
}

// An invite link opened on a phone that's already signed in: the link is
// for signing up, so say whose it is instead of quietly ignoring it. The
// secret isn't kept, so it can't be used by whoever is signed in.
async function noticeInviteWhileSignedIn() {
  const params = new URLSearchParams(window.location.search);
  const token = (params.get('invite') || '').trim();
  if (!token) return;
  params.delete('invite');
  params.delete('signup');
  history.replaceState(null, '', window.location.pathname + (params.toString() ? '?' + params : '') + window.location.hash);
  if (!/^[0-9a-f]{64}$/.test(token)) return;
  let invite = null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({ p_token: token }),
    });
    if (res.ok) invite = await res.json();
  } catch (e) { return; }
  const me = (authUser && authUser.email || '').toLowerCase();
  if (!invite || !invite.email) {
    showToast('That invite link has expired or been replaced. Ask for a new one', 'info');
  } else if (String(invite.email).toLowerCase() === me) {
    showToast(`You're already signed in as ${invite.email}`, 'info');
  } else {
    showToast(`That invite is for ${invite.email}, but you're signed in as ${authUser.email}. To use it, sign out and open the link again`, 'error');
  }
}

// The invite's business and email while the sign-up card is joining one.
let inviteSignUp = null;

// Joining shows the business by name and hides the Business Name box. A
// different email can't use the invite, so changing it brings the box back.
function showInviteSignUp(joining) {
  const field = document.getElementById('suBusinessField');
  field.hidden = joining;
  if (joining) document.getElementById('suBusiness').value = '';
  document.getElementById('suTitle').textContent = joining ? `Join ${inviteSignUp.business} on SAYON` : 'Create your account';
  document.getElementById('suSubtitle').textContent = joining
    ? `${inviteSignUp.business} has added you. Sign up with this email and you'll join their account, with their company details on your reports.`
    : `This email wasn't invited, so this sets up a business of your own. To join ${inviteSignUp.business}, use ${inviteSignUp.email}.`;
}

function onSignUpEmailInput() {
  if (!inviteSignUp) return;
  const joining = document.getElementById('suEmail').value.trim().toLowerCase() === inviteSignUp.email.toLowerCase();
  if (joining === document.getElementById('suBusinessField').hidden) return;
  showInviteSignUp(joining);
}

// ── BUSINESS LOAD ────────────────────────────────────────────────────────
// FIX: loadBusiness() used to be a plain check-then-create with no lock -
// "is authBusiness already set? no -> look for an existing business row ->
// none found -> create one." Two overlapping calls (confirmed live: sign-in
// retried minutes apart after the team_members 500 below made it LOOK like
// something had failed, each a fresh call since authBusiness resets on
// reload) could both pass the "none found" check before either one's POST
// landed, and both would create a business row for the same owner - exactly
// what happened to two of the real test accounts (two "Korva Pest Control"
// rows, two "JC Pest Control" rows, same owner_id each time, confirmed via
// the businesses table and edge_logs). There's also no unique constraint on
// businesses.owner_id at the database level, so nothing stopped it there
// either. This in-flight lock makes every call for the same page session
// share one real attempt instead of racing - a second caller just awaits
// the first one's result instead of starting its own.
let _loadBusinessInFlight = null;
async function loadBusiness() {
  if (!authUser) return;
  if (authBusiness) return; // already loaded — don't overwrite it
  if (_loadBusinessInFlight) return _loadBusinessInFlight;
  _loadBusinessInFlight = _loadBusinessImpl().finally(() => { _loadBusinessInFlight = null; });
  return _loadBusinessInFlight;
}
// The business row is cached per account, so company details, logo and
// licence still reach the PDFs when the app is opened with no signal.
const BUSINESS_CACHE_KEY = 'korva_business_cache';

function rememberBusiness() {
  try {
    if (authBusiness && authUser) localStorage.setItem(BUSINESS_CACHE_KEY, JSON.stringify({ user_id: authUser.id, business: authBusiness }));
  } catch (e) {}
}

// The business as kept on this phone, when the account couldn't be read
// (no signal) or hadn't answered yet (a weak one). Its settings can be
// older than the account's, so the account's copy is read again before
// anything is written to it (pushBusinessSettings).
let businessFromCache = null;
function restoreCachedBusiness() {
  try {
    const cached = JSON.parse(localStorage.getItem(BUSINESS_CACHE_KEY) || 'null');
    if (cached && authUser && cached.user_id === authUser.id && cached.business) authBusiness = businessFromCache = cached.business;
  } catch (e) {}
}
function businessIsFromCache() {
  return !!authBusiness && authBusiness === businessFromCache;
}
// The account's copy of the business, read again. True once it's in.
async function readBusinessFromAccount() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/businesses?id=eq.${authBusiness.id}&limit=1`, { headers: getAuthHeaders() });
    const rows = res.ok ? await res.json() : [];
    if (!rows.length) return false;
    authBusiness = rows[0];
    rememberBusiness();
    return true;
  } catch (e) { return false; }
}

async function _loadBusinessImpl() {
  try {
    await _lookUpBusiness();
  } catch (e) { console.warn('loadBusiness error:', e); }
  if (authBusiness) rememberBusiness();
  else restoreCachedBusiness();
}

async function _lookUpBusiness() {
    // First try to find existing business for this user (as owner)
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/businesses?owner_id=eq.${authUser.id}&limit=1`,
      { headers: getAuthHeaders() }
    );
    if (res.ok) {
      const rows = await res.json();
      if (rows.length > 0) {
        authBusiness = rows[0];
        await ensureOwnerTeamMember();
        loadBillingStatus();
        return;
      }
    } else {
      // A failed lookup is not "no business": creating one here made
      // duplicate businesses for the same owner.
      return;
    }

    // Not an owner — check if they're a technician already on someone
    // else's business (accounts that joined before Team was removed)
    const tmRes = await fetch(
      `${SUPABASE_URL}/rest/v1/team_members?user_id=eq.${authUser.id}&limit=1`,
      { headers: getAuthHeaders() }
    );
    if (tmRes.ok) {
      const tmRows = await tmRes.json();
      if (tmRows.length > 0) {
        const bizRes = await fetch(
          `${SUPABASE_URL}/rest/v1/businesses?id=eq.${tmRows[0].business_id}&limit=1`,
          { headers: getAuthHeaders() }
        );
        if (bizRes.ok) {
          const bizRows = await bizRes.json();
          if (bizRows.length > 0) {
            authBusiness = bizRows[0];
            loadBillingStatus();
            return;
          }
        } else {
          return;
        }
      }
    } else {
      return;
    }

    // Invited by a business owner (Your team): join that business instead
    // of making one. A failed check is not "no invite", so nothing is made.
    const joined = await acceptTeamInvite();
    if (joined === false) return;
    if (joined) {
      const bizRes = await fetch(`${SUPABASE_URL}/rest/v1/businesses?id=eq.${joined}&limit=1`, { headers: getAuthHeaders() });
      const bizRows = bizRes.ok ? await bizRes.json() : [];
      if (bizRows.length) {
        authBusiness = bizRows[0];
        localStorage.removeItem('korva_pending_business');
        showToast(`You've joined ${authBusiness.name} on SAYON`, 'success');
        track('team_invite_accepted');
        loadBillingStatus();
      }
      return;
    }

    // No business found — try to create one
    // Get business name from: signup metadata → localStorage → email prefix
    const meta = authUser.user_metadata || {};
    const storedName = localStorage.getItem('korva_pending_business');
    const bizName = meta.business_name || storedName ||
                    authUser.email.split('@')[0].replace(/[^a-zA-Z0-9 ]/g,' ').trim();

    const cr = await fetch(`${SUPABASE_URL}/rest/v1/businesses`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Prefer': 'return=representation' },
      body: JSON.stringify({ name: bizName, owner_id: authUser.id }),
    });

    if (cr.ok) {
      const created = await cr.json();
      authBusiness = Array.isArray(created) ? created[0] : created;
      localStorage.removeItem('korva_pending_business');

      // Add owner as team member. The Worker refuses every AI call until
      // this row exists, so a failed insert is tried once more here rather
      // than left for the next launch.
      let tm = null;
      try {
        tm = await fetch(`${SUPABASE_URL}/rest/v1/team_members`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            business_id: authBusiness.id,
            user_id: authUser.id,
            role: 'owner',
            name: meta.name || authUser.email,
            email: authUser.email,
          }),
        });
      } catch (e) { console.warn('team_members insert failed:', e); }
      if (!tm || !tm.ok) await ensureOwnerTeamMember();
      loadBillingStatus();
    }
}

// ── ENTER APP ─────────────────────────────────────────────────────────────
function enterApp() {
  if (authUser) telemetryIdentify(authUser.id);
  document.getElementById('authScreen').style.display   = 'none';
  document.getElementById('onboardScreen').style.display = 'none';
  handleBillingReturn(); // notice + clean up a return from Stripe Checkout/Portal, if that's why we're here
  checkDirectEmail();

  // FIX: a DIFFERENT account just became active than whichever one was last
  // active in this browser tab (sign out, then sign back in as someone else,
  // with no page reload in between). signIn()'s "previous user" check only
  // clears localStorage (STORAGE_KEY/DRAFT_KEY) - it never touches the LIVE
  // in-memory reportData object, the already-rendered form fields, or
  // currentReportId, because those only exist once the Inspect module has
  // been opened (appInitialised). Left alone, the new account would see the
  // previous account's open report (job/client details, property fields,
  // findings, everything) still sitting on screen, and worse: saving under
  // the new account would reuse the PREVIOUS account's currentReportId,
  // which Supabase's RLS then silently rejects on sync (it updates a report
  // row owned by a different user) - the local save still looks successful,
  // but the cloud copy never lands, which is exactly the "report didn't save
  // onto this account" behaviour found during live testing. Forcing a full
  // reset here - the same reset newReport() does - closes all of that off.
  if (appInitialised && authUser && lastActiveAccountUserId && lastActiveAccountUserId !== authUser.id) {
    currentReportId = null;
    resetReportState();
    document.getElementById('jobAddress').value = '';
    document.getElementById('jobSuburb').value = '';
    document.getElementById('jobState').value = '';
    document.getElementById('jobPostcode').value = '';
    document.getElementById('jobClient').value = '';
    document.getElementById('jobInspector').value = '';
    updateJob();
    clearDraft();
    // Saved reports are scoped per-account (reportsStorageKey()), same as
    // company details - no wipe needed here any more. An earlier version of
    // this fix DID wipe the list here and relied on supabaseSyncOnOpen() to
    // pull it back from the cloud, but that raced saveCurrentReport()'s
    // non-blocking background push: switching away and back again within a
    // few seconds of saving could show the just-saved report as missing,
    // because the local copy had just been deleted and the cloud copy
    // hadn't landed yet. Per-account keys mean nothing ever gets deleted on
    // a switch - the previous account's reports stay exactly where they
    // were, under their own key, completely untouched.
    renderSavedList();
  }
  lastActiveAccountUserId = authUser ? authUser.id : lastActiveAccountUserId;

  // One-time claim of whatever was sitting in the old shared flat key,
  // same idea as migrateLegacyCompanyDetails() below. Harmless no-op once
  // this account already has its own per-user key (which it will, after
  // the first time this runs).
  migrateLegacySavedReports();

  if (authBusiness) {
    // Claim any pre-fix legacy data for this business, then take the
    // account's copy if it's newer than this phone's.
    migrateLegacyCompanyDetails();
    applyCloudBusinessSettings();
    // The sign-up name fills an empty record, but isn't stamped as an edit:
    // it mustn't count as newer than real details on another phone.
    const details = getCompanyDetails();
    if (!details.name && isBusinessOwner() && authBusiness.name) {
      details.name = authBusiness.name;
      try { localStorage.setItem(companyStorageKey(), JSON.stringify(details)); } catch (e) {}
    }
  }
  renderProfileMenu();
  migrateLocalReportsToCloud();

  // FIX: this was the actual cause of "reports aren't saving after logging
  // out" (it isn't a server problem — the reports were always safely in
  // Supabase the whole time, confirmed directly against the database).
  // supabaseSyncOnOpen() is what pulls an account's cloud-saved reports
  // DOWN into this device's local list so the Dashboard can show them — but
  // it only ever lived inside openApp('inspect')'s one-time setup block,
  // which runs once per browser tab no matter how many times someone signs
  // out and back in without a full page reload. So: the FIRST account
  // opened in a tab got its cloud reports pulled down once, same as always
  // - but every account after that (a different account switching in, OR
  // the same account signing out and back in, since signOut() wipes the
  // local report list on purpose) got NOTHING re-downloaded, and the
  // Dashboard correctly-but-misleadingly reported "No saved reports yet on
  // this device." Calling it here too means every real sign-in restores
  // that account's cloud reports to this device, not just the first one.
  supabaseSyncOnOpen();
  checkAddressMove();

  // New users see onboarding; returning users go straight into the app.
  if (shouldShowOnboarding()) showOnboarding();
  else openApp('inspect');
  // CRASH GUARD (js/crash-guard.js): reports written with no signal go now,
  // and if the app closed while in use last time, offer to tell us.
  sendQueuedProblemReports();
  maybeOfferCrashReport();
}

function renderProfileMenu() {
  if (!authUser) return;
  const meta = authUser.user_metadata || {};
  const name = meta.name || authUser.email.split('@')[0];
  const initials = name.trim().split(/\s+/).slice(0,2).map(w => w[0]).join('').toUpperCase() || '?';
  const initialsEl = document.getElementById('profileInitials');
  if (initialsEl) initialsEl.textContent = initials;
  const topInitials = document.getElementById('topbarInitials');
  if (topInitials) topInitials.textContent = initials;
  const nameEl = document.getElementById('profileName');
  if (nameEl) nameEl.textContent = name;
  const emailEl = document.getElementById('profileEmail');
  if (emailEl) emailEl.textContent = authUser.email;
  const bizRow = document.getElementById('profileBusinessRow');
  if (bizRow) {
    // The name the PDFs print, which "Your business" edits
    const bizName = getCompanyDetails().name || authBusiness?.name || '';
    document.getElementById('profileBusinessName').textContent = bizName;
    bizRow.style.display = authBusiness && bizName ? 'flex' : 'none';
  }
  const bizBtn = document.getElementById('profileYourBusiness');
  if (bizBtn) bizBtn.hidden = !canEditBusiness();
  // Your team needs a business of your own and a Worker that knows about
  // inspector places (supabase/team-seats.sql is applied before it).
  const teamBtn = document.getElementById('profileYourTeam');
  if (teamBtn) teamBtn.hidden = !(authBusiness && isBusinessOwner() && billingStatusCache && billingStatusCache.seat_plans);
}
function openBillingFromProfile() {
  openMenuPage('billingPanel');
}
function signOutFromProfile() {
  if (confirm('Sign out of SAYON?')) signOut();
}

// ── AUTH UI HELPERS ──────────────────────────────────────────────────────
function showAuth(panel) {
  ['authSignIn','authSignUp','authForgot','authConfirm','authResetPassword'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = id === panel ? 'flex' : 'none';
  });
  // Fix: ensure displayed card uses flex column
  const active = document.getElementById(panel);
  if (active) active.style.flexDirection = 'column';
  track('screen_viewed', { screen: 'auth_' + panel });
}

// Show / Hide on a password field: easier to type right on a phone.
function toggleAuthReveal(btn) {
  const input = btn.parentElement.querySelector('input');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.textContent = show ? 'Hide' : 'Show';
  btn.setAttribute('aria-pressed', String(show));
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
}

// ── SESSION RESTORE ON LOAD ──────────────────────────────────────────────
// On a phone that has kept the account's business and finished setting it
// up, opening the app waits this long at most for the account (the sign-in
// and the business together). On a weak signal a call can hang for
// minutes, so after this the app opens with what the phone has kept and
// takes in the account's copy when it lands. Any other phone (a new one,
// or one where setting up was left unfinished and done on another phone)
// waits for the account as before, or it would offer to set up the
// business again.
const START_NETWORK_WAIT_MS = 6000;
let startDeadline = 0;
function startWait(promise, userId) {
  if (!businessKeptFor(userId)) return promise;
  return Promise.race([promise, new Promise(done => setTimeout(() => done('slow'), Math.max(0, startDeadline - Date.now())))]);
}
// Set up on this phone: what shouldShowOnboarding() reads.
function businessKeptFor(userId) {
  try {
    const cached = JSON.parse(localStorage.getItem(BUSINESS_CACHE_KEY) || 'null');
    if (!(cached && userId && cached.user_id === userId && cached.business)) return false;
    if (localStorage.getItem(obKey(userId))) return true;
    const company = JSON.parse(localStorage.getItem(companyStorageKey(cached.business)) || 'null');
    return !!(company && company.updatedAt);
  } catch (e) { return false; }
}

async function loadBusinessForStart() {
  const loading = loadBusiness();
  if (await startWait(loading.then(() => 'done'), authUser && authUser.id) !== 'slow') return;
  if (!authBusiness) restoreCachedBusiness();
  loading.then(takeInAccountBusiness);
}
// The account's copy of the business, landed after the app opened with the
// phone's: taken in as enterApp() takes it in.
function takeInAccountBusiness() {
  if (!authBusiness || businessIsFromCache()) return;
  migrateLegacyCompanyDetails();
  applyCloudBusinessSettings();
  renderProfileMenu();
}
// The sign-in renewed after the app opened with the old one: the account
// refused what was read or sent with that, so the business and the reports
// are read again now, and reports saved meanwhile go up.
function afterLateSignIn() {
  if (!authUser || !authBusiness) return;
  if (businessIsFromCache()) readBusinessFromAccount().then(read => { if (read) takeInAccountBusiness(); });
  supabaseSyncOnOpen();
  pushUnsyncedReports();
}

async function restoreAuthSession() {
  const stored = loadSession();
  if (!stored?.access_token) return false;
  startDeadline = Date.now() + START_NETWORK_WAIT_MS;

  // Check if token is still valid (exp is in seconds)
  const exp = stored.expires_at || 0;
  const now = Math.floor(Date.now() / 1000);

  if (now < exp - 60) {
    authSession = stored;
    authUser    = stored.user;
    // Saved reports are scoped per-account (reportsStorageKey()) - nothing
    // to clear here for a switched user any more, just the unsaved draft.
    const prevUserId = localStorage.getItem('korva_last_user_id');
    if (prevUserId && prevUserId !== stored.user?.id) {
      localStorage.removeItem(DRAFT_KEY);
      localStorage.removeItem(UNSAVED_SHEETS_KEY);
    }
    if (stored.user?.id) localStorage.setItem('korva_last_user_id', stored.user.id);
    await loadBusinessForStart();
    startAuthAutoRefresh();
    return true;
  }

  // Try to refresh. A refresh still on its way when the app opens is the
  // one any other call waits for (authRefreshInFlight), so the same token
  // is never sent twice.
  if (stored.refresh_token) {
    authRefreshInFlight = refreshSession(stored.refresh_token).finally(() => { authRefreshInFlight = null; });
    const ok = await startWait(authRefreshInFlight, stored.user && stored.user.id);
    if (ok === true) {
      authUser = authSession.user;
      await loadBusinessForStart();
      startAuthAutoRefresh();
      return true;
    }
    // No signal (in a subfloor, out of range), or too weak to answer in
    // time: keep the saved sign-in and open the app so the inspector can
    // keep working. The token is refreshed once the signal is back; only a
    // refusal from Supabase signs them out.
    if (ok === 'slow' || lastRefreshWasOffline || !navigator.onLine) {
      const renewing = ok === 'slow' && authRefreshInFlight;
      authSession = stored;
      authUser    = stored.user;
      await loadBusinessForStart();
      startAuthAutoRefresh();
      if (renewing) renewing.then(renewed => { if (renewed === true) afterLateSignIn(); });
      return true;
    }
    // Refused: say so, or "did I lose my report?" is the first thought.
    setTimeout(() => showToast('Your sign-in expired. Sign in again; your work is still on this phone', 'info'), 900);
  }

  clearSession();
  return false;
}
