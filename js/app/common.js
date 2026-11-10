// ══════════════════════════════════════════════════════════════════════════
// SHARED HELPERS
// ══════════════════════════════════════════════════════════════════════════
// Loaded before every other part of the app, so any file can use these:
// the AI model's name, text, dates, money, addresses, the business's
// details and the pop-up message. Nothing here belongs to one stage of a
// job; a helper only one stage uses stays in that stage's file.

// ── THE AI MODEL ──────────────────────────────────────────────────────────
// Every call to the AI names it. The Worker (worker/worker.js,
// ALLOWED_MODEL) only lets this one through, so the two change together.
const AI_MODEL = 'claude-sonnet-5';

// ── TEXT ──────────────────────────────────────────────────────────────────
// Safe inside text and inside quoted attributes (value="…", src="…").
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// The name an email or text greets the client by: the first name ("Hi
// Jo,"), "Mr Smith" for "Mr John Smith", "Jo and Sam" for "Jo & Sam Lee",
// and nothing for a business or a bare initial, so the message opens "Hi,"
// instead of "Hi Mr," or "Hi Harbour,". A name typed all in lower or
// upper case gets its capitals.
const GREETING_TITLE = /^(mr|mrs|ms|miss|mx|dr|prof|sir|dame|rev)\.?$/i;
const GREETING_BUSINESS = /\b(pty|ltd|limited|inc|corp|co|company|strata|owners|corporation|council|trust|trustees?|estate|realty|property|properties|management|managers|agency|agents|partners|group|holdings|services|church|school|club|association|the)\b/i;
function greetingName(name) {
  const fix = w => w === w.toLowerCase() || w === w.toUpperCase()
    ? w.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()) : w;
  const words = String(name || '').replace(/[.,]+$/, '').trim().split(/\s+/).filter(Boolean);
  if (!words.length || GREETING_BUSINESS.test(words.join(' '))) return '';
  const and = i => words[i] === '&' || /^and$/i.test(words[i]);
  if (GREETING_TITLE.test(words[0])) {
    const title = w => fix(w.replace(/\.$/, ''));
    // "Mr & Mrs Smith": both titles and the surname.
    if (words.length > 3 && and(1) && GREETING_TITLE.test(words[2])) return `${title(words[0])} and ${title(words[2])} ${fix(words[words.length - 1])}`;
    const last = words[words.length - 1];
    return words.length > 1 && !and(words.length - 1) && !GREETING_TITLE.test(last) ? `${title(words[0])} ${fix(last)}` : '';
  }
  const first = words[0];
  if (/^\p{L}\.?$/u.test(first)) return '';
  // "Jo & Sam Lee", "Jo Lee and Sam Ng": both first names.
  const join = words.findIndex((w, i) => i > 0 && and(i));
  if (join > 0 && words[join + 1] && !GREETING_TITLE.test(words[join + 1])) return `${fix(first)} and ${fix(words[join + 1])}`;
  return fix(first);
}

// The inspector's words placed inside a sentence, used by the report, the
// quote and the certificate.
// lowerFirst: the first letter lower-cased ("Garage door" reads "garage
// door"), unless the first word looks like a name or an abbreviation
// ("NSW", "Smith St", "John's shed").
function lowerFirst(text) {
  const t = String(text || '').trim();
  const [first = '', second = ''] = t.split(/\s+/);
  if (!/^[A-Z][a-z]/.test(first) || /'s\b/.test(first) || /^[A-Z]/.test(second)) return t;
  return t.charAt(0).toLowerCase() + t.slice(1);
}
// bracketText: words to set inside brackets, with no brackets of their own
// ("Fungal decay (wet rot)" becomes "Fungal decay, wet rot") and no full
// stop or comma at the end.
function bracketText(text) {
  return String(text || '').trim().replace(/\s*\(([^()]*)\)/g, ', $1').replace(/[()]/g, '').replace(/[.;,\s]+$/, '').replace(/^[,\s]+/, '');
}
// inBrackets: " (words)" ready to follow a phrase, or '' when there are none.
function inBrackets(text) {
  const t = lowerFirst(bracketText(text));
  return t ? ` (${t})` : '';
}
// joinPlaces: places one after another with semicolons. The first keeps its
// capital unless lowerAll; the rest are lower-cased, so the list reads as one
// sentence: "Rear deck; garage door; front stump".
function joinPlaces(list, lowerAll) {
  return list.map(t => String(t || '').trim().replace(/[.;,]+$/, '')).filter(Boolean)
    .map((t, i) => i || lowerAll ? lowerFirst(t) : t).join('; ');
}

// ── DATES ─────────────────────────────────────────────────────────────────
// A date as YYYY-MM-DD on the phone's own calendar. toISOString() gives the
// UTC date, which in Australia is the day before until 10 or 11 in the morning.
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function todayIsoDate() { return isoDate(new Date()); }

// "10 November 2026" from YYYY-MM-DD.
function formatLongDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d) ? iso : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ── MONEY ─────────────────────────────────────────────────────────────────
function formatAUD(n) {
  const v = isFinite(n) ? n : 0;
  return v.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
}

// ── ADDRESSES ─────────────────────────────────────────────────────────────
function formatAddress(street, suburb, state, postcode) {
  const line2 = [suburb, [state, postcode].filter(Boolean).join(' ')].filter(Boolean).join(' ');
  return [street, line2].filter(Boolean).join(', ');
}

// ── THE BUSINESS'S DETAILS ────────────────────────────────────────────────
// Stored separately from report data, per-business, used on every report.
// Keyed by the business, so on a shared phone one business's name, licence
// and logo never show on another business's reports.
const COMPANY_KEY = 'korva_company'; // the old key shared by every business, read only to move details over (migrateLegacyCompanyDetails in job.js)

function companyStorageKey(business = authBusiness) {
  return (business && business.id) ? `korva_company_${business.id}` : COMPANY_KEY;
}

function getCompanyDetails() {
  try {
    const stored = localStorage.getItem(companyStorageKey());
    return stored ? JSON.parse(stored) : {};
  } catch(e) { return {}; }
}

// ── THE POP-UP MESSAGE (toast) ────────────────────────────────────────────
// action: optional { label, run } adds a button to the toast (e.g. Undo).
function showToast(msg, type = 'default', action) {
  const t = document.getElementById('toast');
  clearTimeout(t._timeout);

  const svgIcon = (path) => `<svg class="icon toast-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

  const icons = {
    success: svgIcon('<path d="M20 6 9 17l-5-5"/>'),
    error: svgIcon('<path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
    info: svgIcon('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
    default: svgIcon('<circle cx="12" cy="12" r="9"/><circle class="logo-dot" cx="12" cy="4" r="2" fill="currentColor"/>'),
  };

  t.innerHTML = `${icons[type] || icons.default}<span>${escapeHtml(String(msg))}</span>`;
  // Where inspectors get stuck. Toasts are the app's own wording; details
  // in brackets (an error's own text) and any email or long number are
  // blanked before it's sent.
  if (type === 'error') track('error_shown', { message: scrubTelemetryText(String(msg).replace(/\([^)]*\)/g, '(…)')) });
  t.className = 'toast show toast-' + type + (action ? ' toast-has-action' : '');
  if (action) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.onclick = () => { dismissToast(); action.run(); };
    t.appendChild(btn);
  }

  t._shownAt = Date.now();
  // Errors, and toasts with a button to press, stay up longer.
  t._timeout = setTimeout(() => t.classList.remove('show'), (action && action.ms) || ((type === 'error' || action) ? 6000 : 2800));
}

function dismissToast() {
  const t = document.getElementById('toast');
  if (!t) return;
  clearTimeout(t._timeout);
  t.classList.remove('show');
}

// A toast belongs to the screen it was shown on: when the screen changes
// (the menu, a menu page, the quote screen, the dashboard or a sheet opens
// or closes), an older toast goes, so it never sits over the next screen's
// buttons. A toast shown by the same tap that changed the screen stays.
function installToastScreenWatch() {
  // The toast sits inside the report app's markup, so it was hidden with
  // the app (on the quote screen, for one). It belongs to the page.
  const toast = document.getElementById('toast');
  if (toast && toast.parentElement !== document.body) document.body.appendChild(toast);
  const ids = ['app', 'quoteScreen', 'sidebarPanel', 'dashboardOverlay'];
  const targets = ids.map(id => document.getElementById(id))
    .concat([...document.querySelectorAll('.page-sheet-overlay, .menu-page, .saved-panel')])
    .filter(Boolean);
  const obs = new MutationObserver(() => {
    const t = document.getElementById('toast');
    if (t && t.classList.contains('show') && Date.now() - (t._shownAt || 0) > 400) dismissToast();
  });
  targets.forEach(el => obs.observe(el, { attributes: true, attributeFilter: ['class', 'style'] }));
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installToastScreenWatch);
else installToastScreenWatch();
