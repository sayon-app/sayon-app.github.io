// ══════════════════════════════════════════════════════════════════════════
// CHEMICAL REGISTER
// The products the business carries: active constituent, APVMA number,
// links to the label and the SDS, and the label's uses. A use is what the
// product is being used for (pest, method, and the surface or situation)
// with the label's mix rate, the amount applied and the life for that use.
//
// On the treatment record the technician picks a product, then what it's
// for, and the record fills the active constituent, the rate and the life
// from the register (js/treatment.js). Prices are a separate thing (Your
// prices, js/price-book.js): the register is only what the label says.
//
// SAYON starts the register with common Australian termiticides and baits
// and their usual uses, with no rates: a rate has to come from the label in
// the business's hands, and is typed once (here, or on a treatment record
// with "Keep this rate"). Stored per business under korva_chemicals_<id>
// and synced to the team in businesses.settings.chemicals
// (js/business-sync.js). Only the owner changes it; a technician reads it.
//
// register = { products: [{ id, name, maker, active, apvma, form, labelUrl,
//   sdsUrl, sdsExpires (YYYY-MM-DD), declUrl (manufacturer's declaration),
//   uses: [{ id, pest, method, surface, rate, volume, life }] }], updatedAt }
//
// The page works like a supplier's chemical register: search by name, tap a
// product, and its documents (SDS with its expiry date, label,
// manufacturer's declaration) are one tap from opening, or sending on.
// ══════════════════════════════════════════════════════════════════════════

const CHEMICAL_FORMS = {
  liquid: 'Liquid termiticide',
  foam: 'Foam',
  dust: 'Dust',
  bait: 'Termite bait',
  other: 'Other',
};

// The usual uses for each kind of product. The business checks them against
// the label: a label can have more, fewer, or other ones.
const CHEMICAL_STARTER_USES = {
  liquid: [
    { pest: 'Subterranean termites', method: 'Soil treatment', surface: 'Perimeter, beside the slab or footings (trench and rod)' },
    { pest: 'Subterranean termites', method: 'Soil treatment', surface: 'Under the slab, drilled through the concrete' },
    { pest: 'Subterranean termites', method: 'Soil treatment', surface: 'Subfloor, around piers and walls' },
  ],
  foam: [
    { pest: 'Subterranean termites', method: 'Foam', surface: 'Into termite workings, wall cavities and voids' },
  ],
  dust: [
    { pest: 'Subterranean termites', method: 'Dust', surface: 'Into active termite workings' },
  ],
  bait: [
    { pest: 'Subterranean termites', method: 'Bait', surface: 'In-ground station' },
    { pest: 'Subterranean termites', method: 'Bait', surface: 'Above-ground station on active workings' },
  ],
  other: [],
};

// The starting list: the products the treatment record already knows
// (TREATMENT_PRODUCTS in js/treatment.js), with their kind.
const CHEMICAL_STARTER_FORMS = {
  'Termidor': 'liquid', 'Termidor HE': 'liquid', 'Termidor Foam': 'foam', 'Termidor Dry': 'dust',
  'Termidust': 'dust', 'Premise': 'liquid', 'Premise Foam': 'foam', 'Altriset': 'liquid',
  'Biflex': 'liquid', 'Maxxthor 100': 'liquid', 'Exterra': 'bait', 'Exterra Focus': 'bait', 'Requiem': 'bait',
  'Sentricon': 'bait', 'Trelona': 'bait', 'Kordon': 'other',
};

// Who holds each starting product's registration, and its APVMA product
// number, from the APVMA's register (PubCRIS, checked 4 Nov 2026). Termidor
// Dry (60654) and Premise Foam (59345) are no longer registered there.
// Label and SDS links and label rates are added here only once the PDF has
// been opened and checked.
const CHEMICAL_STARTER_DETAILS = {
  'Termidor': { maker: 'BASF', apvma: '54624' },
  'Termidor HE': { maker: 'BASF', apvma: '80820' },
  'Termidor Foam': { maker: 'BASF', apvma: '70346' },
  'Termidor Dry': { maker: 'BASF', apvma: '60654' },
  'Premise': { maker: 'Envu', apvma: '49098' },
  'Premise Foam': { maker: 'Envu', apvma: '59345' },
  'Altriset': { maker: 'Syngenta', apvma: '64594' },
  'Biflex': { maker: 'Envu' },
  'Maxxthor 100': { maker: 'Ensystex', apvma: '60113' },
  'Exterra': { maker: 'Ensystex' },
  'Exterra Focus': { maker: 'Ensystex' },
  'Requiem': { maker: 'Ensystex', apvma: '56580' },
  'Sentricon': { maker: 'Corteva', apvma: '57843 (AG bait), 80120 (IG rod)' },
  'Trelona': { maker: 'BASF', apvma: '86731' },
  'Kordon': { maker: 'Envu', apvma: '60759' },
};

const chemId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function chemicalStarterProducts() {
  return Object.entries(CHEMICAL_STARTER_FORMS).map(([name, form], i) => ({
    id: 'start' + i,
    name, maker: '', active: TREATMENT_PRODUCTS[name] || '', apvma: '', form,
    labelUrl: '', sdsUrl: '', ...(CHEMICAL_STARTER_DETAILS[name] || {}),
    uses: CHEMICAL_STARTER_USES[form].map((u, j) => ({ id: `start${i}u${j}`, ...u, rate: '', volume: '', life: '' })),
  }));
}

function chemicalsStorageKey() {
  const owner = (authBusiness && authBusiness.id) || (authUser && authUser.id) || 'local';
  return `korva_chemicals_${owner}`;
}

// What this phone has stored (null until the register is first changed, or
// came from the account). Used by the sync.
function storedChemicalRegister() {
  try {
    const raw = localStorage.getItem(chemicalsStorageKey());
    const reg = raw ? JSON.parse(raw) : null;
    return reg && Array.isArray(reg.products) ? reg : null;
  } catch (e) { return null; }
}

function getChemicalRegister() {
  return storedChemicalRegister() || { products: chemicalStarterProducts() };
}

function storeChemicalRegister(reg, { sync = true } = {}) {
  reg.updatedAt = Date.now();
  try { localStorage.setItem(chemicalsStorageKey(), JSON.stringify(reg)); }
  catch (e) { showToast('Could not save the register on this phone', 'error'); return; }
  if (sync && typeof scheduleBusinessSync === 'function') scheduleBusinessSync();
}

const chemicalUseLabel = u => [u.method, u.surface].filter(Boolean).join(' · ') || 'Use';
// "60 mL per 10 L water; 5 L of mix per linear metre"
const chemicalUseRate = u => [u.rate, u.volume].map(s => String(s || '').trim()).filter(Boolean).join('; ');

function findChemical(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  return getChemicalRegister().products.find(p => p.name.trim().toLowerCase() === n) || null;
}

// Label and SDS links go straight to the document: the maker's or its
// Australian distributor's own copy, or the APVMA's. SAYON ships none it
// hasn't opened and checked, and never links a search page: with no link
// saved, the product says so.
const safeUrl = u => /^https:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '';

// Label · SDS links for a product, shared by the register and the treatment record.
function chemicalLinksHtml(p) {
  const esc = escapeHtml;
  const label = safeUrl(p.labelUrl), sds = safeUrl(p.sdsUrl);
  if (!label && !sds) return '<span class="chem-links"><span class="chem-nolink">No label or SDS link yet</span></span>';
  return `<span class="chem-links">
      ${label ? `<a href="${esc(label)}" target="_blank" rel="noopener">Label</a>` : '<span class="chem-nolink">No label link yet</span>'}
      ${sds ? `<a href="${esc(sds)}" target="_blank" rel="noopener">SDS</a>` : '<span class="chem-nolink">No SDS link yet</span>'}
    </span>`;
}

// The file a link opens, as the supplier named it: "Maxxthor_100_Leaflet.pdf".
function chemicalDocName(url) {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    return last || u.hostname;
  } catch (e) { return url; }
}

const chemPdfIcon = '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 15h6"/><path d="M9 18h4"/></svg>';
const chemSendIcon = '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>';

// "28/02/2030", and whether it has passed or is within three months.
function chemicalSdsExpiry(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return null;
  const when = new Date(+m[1], +m[2] - 1, +m[3]);
  const days = Math.floor((when - new Date(new Date().toDateString())) / 86400000);
  return { text: `${m[3]}/${m[2]}/${m[1]}`, expired: days < 0, soon: days >= 0 && days <= 90 };
}

function chemicalDocRow(p, kind) {
  const esc = escapeHtml;
  const docs = {
    sds: { title: 'SDS', url: p.sdsUrl },
    label: { title: 'Label', url: p.labelUrl },
    decl: { title: "Manufacturer's declaration", url: p.declUrl },
  };
  const d = docs[kind];
  const url = safeUrl(d.url);
  let head = d.title;
  if (kind === 'sds') {
    const exp = chemicalSdsExpiry(p.sdsExpires);
    if (exp) head += ` <span class="chem-doc-exp${exp.expired ? ' expired' : exp.soon ? ' soon' : ''}">· ${exp.expired ? 'Expired' : 'Expires'} ${exp.text}</span>`;
  }
  return `<div class="chem-doc">
      <div class="chem-doc-title">${head}</div>
      ${url ? `<div class="chem-doc-row">
        <a class="chem-doc-link" href="${esc(url)}" target="_blank" rel="noopener">${chemPdfIcon}<span>${esc(chemicalDocName(url))}</span></a>
        <button type="button" class="chem-doc-send" data-url="${esc(url)}" data-title="${esc(`${p.name} ${d.title}`)}" onclick="sendChemicalDoc(this)" aria-label="Send the ${esc(d.title)}">${chemSendIcon}</button>
      </div>` : '<div class="chem-doc-none">No link yet</div>'}
    </div>`;
}

function chemicalDocsHtml(p) {
  return `<div class="chem-docs">${chemicalDocRow(p, 'sds')}${chemicalDocRow(p, 'label')}${safeUrl(p.declUrl) ? chemicalDocRow(p, 'decl') : ''}</div>`;
}

// The label's rates, to read: the edit form holds the same in boxes.
function chemicalRatesHtml(p) {
  const esc = escapeHtml;
  const uses = p.uses || [];
  if (!uses.length) return '<div class="chem-rates"></div>';
  return `<div class="chem-rates">
      <div class="chem-doc-title">Label rates</div>
      ${uses.map(u => `<div class="chem-rate">
        <div class="chem-rate-use">${esc([u.pest, chemicalUseLabel(u)].filter(Boolean).join(' · '))}</div>
        <div class="chem-rate-val${chemicalUseRate(u) ? '' : ' none'}">${esc(chemicalUseRate(u) || 'No rate yet')}${u.life ? ` · ${esc(u.life)}` : ''}</div>
      </div>`).join('')}
    </div>`;
}

// Sends a document on: the phone's share sheet where it has one, otherwise
// an email with the link.
async function sendChemicalDoc(btn) {
  const url = btn.dataset.url, title = btn.dataset.title;
  if (navigator.share) {
    try { await navigator.share({ title, url }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  window.location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(url)}`;
}

function onChemicalSearch(input) {
  const q = input.value.trim().toLowerCase();
  let shown = 0;
  document.querySelectorAll('#chemList .chem-card').forEach(card => {
    const hit = !q || card.dataset.find.includes(q);
    card.hidden = !hit;
    if (hit) shown++;
  });
  const none = document.getElementById('chemNoMatch');
  if (none) none.hidden = shown > 0;
}

// ── MENU › CHEMICAL REGISTER ────────────────────────────────────────────────
function renderChemicalRegister() {
  const list = document.getElementById('chemList');
  if (!list) return;
  const reg = getChemicalRegister();
  const canEdit = canEditBusiness();
  list.innerHTML = reg.products.length
    ? reg.products.map(p => chemicalCardHtml(p, canEdit)).join('')
    : '<div class="settings-row-desc">No products yet. Add the ones you carry.</div>';
  const add = document.getElementById('chemAdd');
  if (add) add.hidden = !canEdit;
  const owner = document.getElementById('chemOwnerNote');
  if (owner) owner.hidden = canEdit;
  const reset = document.getElementById('chemReset');
  if (reset) reset.hidden = !canEdit || !storedChemicalRegister();
  const search = document.getElementById('chemSearch');
  if (search) onChemicalSearch(search);
  renderChemicalSummary();
}

function renderChemicalSummary() {
  const reg = getChemicalRegister();
  const uses = reg.products.flatMap(p => p.uses || []);
  const noRate = uses.filter(u => !u.rate).length;
  const sum = document.querySelector('#chemicalsPanel .job-panel-summary');
  if (sum) sum.textContent = reg.products.length ? `${reg.products.length} products` : '';
  const status = document.getElementById('chemStatus');
  if (status) {
    status.textContent = !uses.length ? ''
      : noRate
        ? `${noRate} of ${uses.length} uses have no rate yet. Type each one from the label once, and treatment records fill it from then on.`
        : 'Every use has its label rate.';
    status.classList.toggle('warn', noRate > 0);
    status.hidden = !uses.length;
  }
}

function chemicalCardHtml(p, canEdit) {
  const esc = escapeHtml;
  const dis = canEdit ? '' : ' disabled';
  const field = (f, label, ph, extra = '') => `<div class="job-field">
        <div class="job-field-label">${label}</div>
        <input class="job-input" data-f="${f}" value="${esc(p[f] || '')}" placeholder="${ph}"${extra}${dis} onchange="onChemicalEdit(this)">
      </div>`;
  const uses = (p.uses || []).map(u => `
      <div class="chem-use" data-use="${esc(u.id)}">
        <div class="job-row">
          <div class="job-field"><div class="job-field-label">Pest</div>
            <input class="job-input" data-u="pest" value="${esc(u.pest || '')}" placeholder="e.g. Subterranean termites"${dis} onchange="onChemicalEdit(this)"></div>
          <div class="job-field"><div class="job-field-label">Method</div>
            <input class="job-input" data-u="method" value="${esc(u.method || '')}" placeholder="e.g. Soil treatment"${dis} onchange="onChemicalEdit(this)"></div>
        </div>
        <div class="job-field"><div class="job-field-label">Surface or situation</div>
          <input class="job-input" data-u="surface" value="${esc(u.surface || '')}" placeholder="e.g. Perimeter, beside the slab"${dis} onchange="onChemicalEdit(this)"></div>
        <div class="job-row">
          <div class="job-field"><div class="job-field-label">Application rate (label)</div>
            <input class="job-input" data-u="rate" value="${esc(u.rate || '')}" placeholder="e.g. mL per 10 L water"${dis} onchange="onChemicalEdit(this)"></div>
          <div class="job-field"><div class="job-field-label">Quantity to apply (label)</div>
            <input class="job-input" data-u="volume" value="${esc(u.volume || '')}" placeholder="e.g. L of mix per linear metre"${dis} onchange="onChemicalEdit(this)"></div>
        </div>
        <div class="job-field"><div class="job-field-label">Life expectancy (label)</div>
          <input class="job-input" data-u="life" value="${esc(u.life || '')}" placeholder="e.g. Up to 8 years"${dis} onchange="onChemicalEdit(this)"></div>
        ${canEdit ? `<button type="button" class="quote-link-btn" onclick="removeChemicalUse('${esc(p.id)}', '${esc(u.id)}')">Remove this use</button>` : ''}
      </div>`).join('');
  const missing = (p.uses || []).filter(u => !u.rate).length;
  const find = [p.name, p.active, p.maker, p.apvma].filter(Boolean).join(' ').toLowerCase();
  return `<details class="chem-card" data-id="${esc(p.id)}" data-find="${esc(find)}">
      <summary>
        <span class="chem-card-text">
          <span class="chem-card-name">${esc(p.name || 'New product')}</span>
          <span class="chem-card-sub">${esc([p.active, CHEMICAL_FORMS[p.form] || ''].filter(Boolean).join(' · '))}${missing ? ` · <span class="pb-start">${missing === 1 ? '1 rate' : missing + ' rates'} to add</span>` : ''}</span>
        </span>
        <svg class="icon quote-fold-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
      </summary>
      <div class="chem-card-body">
        ${chemicalDocsHtml(p)}
        ${chemicalRatesHtml(p)}
        ${canEdit ? `<details class="sheet-more chem-edit">
          <summary>Edit the product, its documents and rates</summary>
          <div class="chem-edit-body">
        <div class="job-row">
          ${field('name', 'Product', 'e.g. Termidor')}
          ${field('active', 'Active constituent', 'e.g. 100 g/L fipronil')}
        </div>
        <div class="job-row">
          ${field('apvma', 'APVMA No.', 'On the label')}
          ${field('maker', 'Maker or supplier', 'e.g. the maker')}
        </div>
        <div class="job-field">
          <div class="job-field-label">Kind</div>
          <select class="job-input" data-f="form" onchange="onChemicalEdit(this)">
            ${Object.entries(CHEMICAL_FORMS).map(([k, v]) => `<option value="${k}"${p.form === k ? ' selected' : ''}>${v}</option>`).join('')}
          </select>
        </div>
        <div class="settings-row-desc">Paste the link to each PDF itself, from the maker's or supplier's own website, so one tap opens it.</div>
        ${field('labelUrl', 'Link to the label', 'https://…', ' type="url" inputmode="url" autocomplete="off"')}
        <div class="job-row">
          ${field('sdsUrl', 'Link to the SDS', 'https://…', ' type="url" inputmode="url" autocomplete="off"')}
          ${field('sdsExpires', 'SDS expires', '', ' type="date"')}
        </div>
        ${field('declUrl', "Link to the manufacturer's declaration (if any)", 'https://…', ' type="url" inputmode="url" autocomplete="off"')}
        <div class="settings-group-title">What it's used for</div>
        <div class="settings-row-desc">Each use on the label, with its rate. A treatment record asks which one, then fills the rate.</div>
        ${uses || '<div class="settings-row-desc">No uses yet.</div>'}
        <button type="button" class="quote-link-btn" onclick="addChemicalUse('${esc(p.id)}')">Add a use</button>
        <button type="button" class="quote-link-btn chem-remove" onclick="removeChemical('${esc(p.id)}')">Remove ${esc(p.name || 'this product')} from the register</button>
          </div>
        </details>` : ''}
      </div>
    </details>`;
}

// Reads a card back into the register, so every box saves on change.
function onChemicalEdit(el) {
  if (!canEditBusiness()) return;
  const card = el.closest('.chem-card');
  const reg = getChemicalRegister();
  const p = reg.products.find(x => x.id === card.dataset.id);
  if (!p) return;
  if (el.dataset.f) {
    let v = el.value.trim();
    if (['labelUrl', 'sdsUrl', 'declUrl'].includes(el.dataset.f) && v) v = 'https://' + v.replace(/^https?:\/\//i, '');
    p[el.dataset.f] = v;
    el.value = v;
  } else if (el.dataset.u) {
    const u = (p.uses || []).find(x => x.id === el.closest('.chem-use').dataset.use);
    if (u) u[el.dataset.u] = el.value.trim();
  }
  storeChemicalRegister(reg);
  // The heading, documents and rates follow the edit; the form stays put.
  const fresh = document.createElement('div');
  fresh.innerHTML = chemicalCardHtml(p, true);
  const next = fresh.firstElementChild;
  card.dataset.find = next.dataset.find;
  ['summary', '.chem-docs', '.chem-rates'].forEach(sel => card.querySelector(sel).replaceWith(next.querySelector(sel)));
  renderChemicalSummary();
  const reset = document.getElementById('chemReset');
  if (reset) reset.hidden = false;
}

function rerenderChemicalCard(id, open = true) {
  renderChemicalRegister();
  const card = document.querySelector(`#chemList .chem-card[data-id="${id}"]`);
  if (card && open) {
    card.open = true;
    const edit = card.querySelector('.chem-edit');
    if (edit) edit.open = true;
  }
  return card;
}

function addChemical() {
  if (!canEditBusiness()) return;
  const reg = getChemicalRegister();
  const p = { id: chemId(), name: '', maker: '', active: '', apvma: '', form: 'liquid', labelUrl: '', sdsUrl: '', sdsExpires: '', declUrl: '', uses: [] };
  p.uses = [{ id: chemId(), pest: 'Subterranean termites', method: '', surface: '', rate: '', volume: '', life: '' }];
  reg.products.unshift(p);
  storeChemicalRegister(reg);
  const card = rerenderChemicalCard(p.id);
  const name = card && card.querySelector('[data-f="name"]');
  if (name) name.focus();
}

function removeChemical(id) {
  if (!canEditBusiness()) return;
  const reg = getChemicalRegister();
  const i = reg.products.findIndex(p => p.id === id);
  if (i < 0) return;
  const [gone] = reg.products.splice(i, 1);
  storeChemicalRegister(reg);
  renderChemicalRegister();
  showToast(`${gone.name || 'Product'} removed from the register`, 'success');
}

function addChemicalUse(id) {
  if (!canEditBusiness()) return;
  const reg = getChemicalRegister();
  const p = reg.products.find(x => x.id === id);
  if (!p) return;
  const last = (p.uses || [])[p.uses.length - 1];
  (p.uses = p.uses || []).push({ id: chemId(), pest: last ? last.pest : 'Subterranean termites', method: last ? last.method : '', surface: '', rate: '', volume: '', life: last ? last.life : '' });
  storeChemicalRegister(reg);
  const card = rerenderChemicalCard(id);
  const uses = card ? card.querySelectorAll('.chem-use [data-u="surface"]') : [];
  if (uses.length) uses[uses.length - 1].focus();
}

function removeChemicalUse(id, useId) {
  if (!canEditBusiness()) return;
  const reg = getChemicalRegister();
  const p = reg.products.find(x => x.id === id);
  if (!p) return;
  p.uses = (p.uses || []).filter(u => u.id !== useId);
  storeChemicalRegister(reg);
  rerenderChemicalCard(id);
}

// Puts back any starting product that was removed, keeping everything typed.
function restoreChemicalStarters() {
  if (!canEditBusiness()) return;
  const reg = getChemicalRegister();
  const have = new Set(reg.products.map(p => p.name.trim().toLowerCase()));
  const back = chemicalStarterProducts().filter(p => !have.has(p.name.toLowerCase()));
  if (!back.length) { showToast('Every starting product is already in your register', 'success'); return; }
  reg.products.push(...back.map(p => ({ ...p, id: chemId(), uses: p.uses.map(u => ({ ...u, id: chemId() })) })));
  storeChemicalRegister(reg);
  renderChemicalRegister();
  showToast(`${back.length} product${back.length === 1 ? '' : 's'} added back`, 'success');
}

// ── TREATMENT RECORD: "Keep this rate" ──────────────────────────────────────
// A rate typed on a treatment record for a use with none in the register
// goes into the register, so the next job fills it.
function keepChemicalRate(productName, useId, rate, life) {
  if (!canEditBusiness()) return false;
  const reg = getChemicalRegister();
  const p = reg.products.find(x => x.name.trim().toLowerCase() === String(productName || '').trim().toLowerCase());
  const u = p && (p.uses || []).find(x => x.id === useId);
  if (!u) return false;
  u.rate = rate;
  if (life && !u.life) u.life = life;
  storeChemicalRegister(reg);
  return true;
}
