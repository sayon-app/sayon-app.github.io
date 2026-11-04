// ══════════════════════════════════════════════════════════════════════════
// YOUR PRICES (the business's price book)
// Every quote line SAYON can add, with the business's own price for it. The
// prices live in the same place the quote builder already remembers typed
// prices (quotePriceMemory in js/quote.js), so the account copy syncs them
// to the team (js/business-sync.js), and a price set here is the price the
// next quote starts at. A line left blank stays at SAYON's starting price
// (QUOTE_CATALOGUE) and shows the "Starting price" tag on a quote.
//
// Set up two ways: a short step in onboarding with the lines most quotes
// use, and the full list in Menu › Your prices. Only the owner changes
// them; a technician gets the owner's.
// ══════════════════════════════════════════════════════════════════════════

const PRICE_BOOK_GROUPS = [
  { title: 'Termite management systems', keys: ['barrier_lm', 'barrier_job', 'bait_install', 'bait_monitor', 'retic_lm', 'physical_lm', 'system_topup', 'treatment'] },
  { title: 'Termite treatment', keys: ['direct', 'nest'] },
  { title: 'Borers', keys: ['borer'] },
  { title: 'Conducive conditions', keys: ['timber_soil', 'weep_holes', 'slab_edge'] },
  { title: 'Inspections', keys: ['followup', 'invasive'] },
];

// The lines most quotes are built from, asked for at sign-up.
const PRICE_BOOK_QUICK_KEYS = ['barrier_lm', 'bait_install', 'bait_monitor', 'direct', 'followup', 'invasive'];

const PRICE_BOOK_UNIT_WORDS = {
  lm: 'per linear metre', job: 'per job', station: 'per station', year: 'per year',
  area: 'per area', visit: 'per visit',
};
const priceBookUnit = u => PRICE_BOOK_UNIT_WORDS[u] || (u ? 'per ' + u : '');

// The business's own price for a line, or null while it's at the starting price.
function businessPrice(key) {
  const mem = quotePriceMemory();
  return (key in mem) && isFinite(mem[key]) ? mem[key] : null;
}

// "per linear metre", with SAYON's price while the business has none.
function priceBookUnitLine(key) {
  const cat = QUOTE_CATALOGUE[key];
  const unit = escapeHtml(priceBookUnit(cat.unit));
  return businessPrice(key) == null ? `${unit} · <span class="pb-start">SAYON suggests $${cat.price}</span>` : unit;
}

function priceBookRow(key, prefix) {
  const cat = QUOTE_CATALOGUE[key];
  const own = businessPrice(key);
  const id = `${prefix}-${key}`;
  return `<div class="pb-row" data-key="${key}">
      <label class="pb-row-text" for="${id}">
        <span class="pb-row-title">${escapeHtml(cat.desc)}</span>
        <span class="pb-row-unit">${priceBookUnitLine(key)}</span>
      </label>
      <span class="pb-price">
        <span class="pb-dollar" aria-hidden="true">$</span>
        <input class="job-input pb-input" id="${id}" type="text" inputmode="decimal" autocomplete="off"
          value="${priceBoxText(own)}" placeholder="${cat.price}"
          aria-label="${escapeHtml(cat.desc)}, ${escapeHtml(priceBookUnit(cat.unit))}, ex GST"
          onchange="onPriceBookInput(this)">
      </span>
    </div>`;
}

// 45.5 shows as 45.50; whole dollars show without cents.
const priceBoxText = n => n == null ? '' : (n % 1 ? n.toFixed(2) : String(n));

// Reads a typed price: "$1,250" and "28.50" both work. Blank is null
// (back to the starting price); anything else that isn't a price is NaN.
function parsePriceInput(raw) {
  const t = String(raw || '').replace(/[$,\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
}

function setBusinessPrice(key, price) {
  const mem = quotePriceMemory();
  if (price == null) { if (!(key in mem)) return; delete mem[key]; }
  else { if (mem[key] === price) return; mem[key] = price; }
  storeQuotePriceMemory(mem);
}

function onPriceBookInput(input) {
  const row = input.closest('.pb-row');
  const key = row && row.dataset.key;
  if (!key) return;
  const price = parsePriceInput(input.value);
  if (Number.isNaN(price)) {
    showToast('Type the price as a number, like 28 or 28.50', 'error');
    const own = businessPrice(key);
    input.value = priceBoxText(own);
    return;
  }
  input.value = priceBoxText(price);
  setBusinessPrice(key, price);
  row.querySelector('.pb-row-unit').innerHTML = priceBookUnitLine(key);
  renderPriceBookSummary();
}

function priceBookCounts() {
  const keys = PRICE_BOOK_GROUPS.flatMap(g => g.keys);
  return { set: keys.filter(k => businessPrice(k) != null).length, total: keys.length };
}

function renderPriceBookSummary() {
  const { set, total } = priceBookCounts();
  const sum = document.querySelector('#pricesPanel .job-panel-summary');
  if (sum) sum.textContent = set ? `${set} of ${total} set` : '';
  const status = document.getElementById('pbStatus');
  if (status) {
    status.textContent = set === total
      ? 'Every line has your price.'
      : set
        ? `${set} of ${total} lines have your price. The rest start at SAYON's price until you set them.`
        : 'No prices set yet. Quotes start at SAYON\'s suggested prices, which won\'t match yours.';
    status.classList.toggle('warn', set < total);
  }
}

// ── MENU › YOUR PRICES ──────────────────────────────────────────────────────
function renderPriceBook() {
  const list = document.getElementById('pbList');
  if (!list) return;
  const canEdit = canEditBusiness();
  list.innerHTML = PRICE_BOOK_GROUPS.map(g =>
    `<div class="settings-group-title">${escapeHtml(g.title)}</div>` + g.keys.map(k => priceBookRow(k, 'pb')).join('')
  ).join('');
  list.querySelectorAll('input').forEach(el => { el.disabled = !canEdit; });
  const gst = document.getElementById('pbGst');
  if (gst) { gst.classList.toggle('on', defaultQuoteGst()); gst.setAttribute('aria-pressed', String(defaultQuoteGst())); gst.disabled = !canEdit; }
  const terms = document.getElementById('pbTerms');
  if (terms) { terms.value = defaultPaymentTerms(); terms.disabled = !canEdit; }
  const back = document.getElementById('pbBackToQuote');
  if (back) back.hidden = !priceBookFromQuote;
  const owner = document.getElementById('pbOwnerNote');
  if (owner) owner.hidden = canEdit;
  renderPriceBookSummary();
}

function togglePriceBookGst() {
  if (!canEditBusiness()) return;
  const on = !defaultQuoteGst();
  rememberQuoteGst(on);
  const btn = document.getElementById('pbGst');
  if (btn) { btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', String(on)); }
}

function onPriceBookTerms(el) {
  if (!canEditBusiness()) return;
  rememberPaymentTerms(el.value.trim());
}

// The menu lives on the report screen, so from a quote the quote closes,
// the list opens, and "Back to the quote" reopens it with the lines that
// were still at SAYON's price moved to the new prices.
let priceBookFromQuote = false;

function openPriceBook() {
  const screen = document.getElementById('quoteScreen');
  priceBookFromQuote = !!(quoteState && screen && screen.classList.contains('open'));
  if (priceBookFromQuote) closeQuote();
  openMenuPage('pricesPanel');
}

function backToQuoteFromPrices() {
  priceBookFromQuote = false;
  openQuoteFromReport();
  const q = quoteState;
  // A sent quote keeps the prices the client saw.
  if (!q || q.sentAt || isQuoteLocked()) return;
  const mem = quotePriceMemory();
  let moved = 0;
  q.items.forEach(it => {
    if (it.priceSet || it.key === 'custom' || !(it.key in mem)) return;
    it.price = mem[it.key]; it.priceSet = true; moved++;
  });
  if (!moved) return;
  persistQuote();
  renderQuoteEditor();
  showToast(`${moved} line${moved === 1 ? '' : 's'} now at your price`, 'success');
}

// ── ONBOARDING STEP ─────────────────────────────────────────────────────────
function renderOnboardPrices() {
  const list = document.getElementById('obPriceList');
  if (!list) return;
  list.innerHTML = PRICE_BOOK_QUICK_KEYS.map(k => priceBookRow(k, 'obp')).join('');
  const gst = document.getElementById('obGst');
  if (gst) gst.checked = defaultQuoteGst();
}

// Continue keeps what was typed (each box already saved on change) and the GST choice.
function saveOnboardPrices() {
  let ok = true;
  document.querySelectorAll('#obPriceList .pb-input').forEach(input => {
    const price = parsePriceInput(input.value);
    if (Number.isNaN(price)) { ok = false; return; }
    setBusinessPrice(input.closest('.pb-row').dataset.key, price);
  });
  if (!ok) { showToast('Type each price as a number, like 28 or 28.50', 'error'); return false; }
  const gst = document.getElementById('obGst');
  if (gst) rememberQuoteGst(gst.checked);
  return true;
}
