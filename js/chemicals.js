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
// and their uses, with each label's own rates where SAYON has read the
// label (CHEMICAL_STARTER_DETAILS). The business checks them against the
// label in its hands and can change any of them; each product's card says
// which it is showing (chemicalRatesNote). A rate SAYON doesn't have is
// typed once (here, or on a treatment record with "Keep this rate").
// Stored per business under korva_chemicals_<id>
// and synced to the team in businesses.settings.chemicals
// (js/business-sync.js). Only the owner changes it; a technician reads it.
//
// register = { products: [{ id, name, maker, active, apvma, form, labelUrl,
//   sdsUrl, sdsExpires (YYYY-MM-DD), declUrl (manufacturer's declaration),
//   uses: [{ id, pest, method, surface, rate, volume, life }],
//   ratesChangedAt (when the business last changed a use) }], updatedAt }
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
// Only products the APVMA's register lists as registered go in: that
// register is the rule for what SAYON offers.
const CHEMICAL_STARTER_FORMS = {
  'Termidor': 'liquid', 'Termidor HE': 'liquid', 'Termidor Foam': 'foam',
  'Premise': 'liquid', 'Altriset': 'liquid',
  'Biflex Ultra': 'liquid', 'Maxxthor 100': 'liquid', 'Exterra': 'bait', 'Exterra Focus': 'other', 'Requiem': 'bait',
  'Sentricon': 'bait', 'Trelona': 'bait', 'Kordon': 'other', 'Sentricon AG': 'bait',
};

// What SAYON knows about each starting product, all of it checked against
// the documents themselves (4-5 Nov 2026):
// - maker and APVMA product number from the APVMA's register (PubCRIS).
//   Products it no longer registers are in CHEMICAL_NOT_REGISTERED instead.
// - labelUrl: the APVMA's own copy of the current approved label
//   (elabels.apvma.gov.au/<product number>ELBL.pdf), opened and matched to
//   the register's latest label number. Makers' sites can lag behind it.
//   Exterra Focus is not a registered chemical, so its label is Ensystex's.
// - sdsUrl and sdsExpires: the maker's own SDS PDF (BASF, Envu, Ensystex); an SDS is reviewed every
//   5 years, so it expires 5 years after the issue date printed on it.
// - uses: each label's own rates for termite work, in its words. A product
//   with no uses here keeps the usual ones for its kind, with no rates.
const ELABEL = n => `https://elabels.apvma.gov.au/${n}ELBL.pdf`;
const BASF_FILES = 'https://pest-control.basf.com.au/sites/basf.com.au/files/';
const ENVU_FILES = 'https://www.assets.envu.com/-/media/prfaustralia/';
const ENSYSTEX_FILES = 'https://cdn.shopify.com/s/files/1/0561/5720/8620/files/';
const SOUTH = 'south of the Tropic of Capricorn';
const TERMITES = 'Subterranean termites';

// Termidor and Termidor HE share the label's soil-treatment layout.
const termidorUses = (mix, foamMix, underSlab, rodding) => [
  { pest: TERMITES, method: 'Soil treatment', surface: 'Perimeter, beside the slab or footings (trench and rod)',
    rate: mix, volume: '100 L of mix per m³ of soil (5.25 L per metre for a trench 150 x 350 mm)', life: '8 years' },
  { pest: TERMITES, method: 'Soil treatment', surface: 'Under the slab, drilled through the concrete',
    rate: mix, volume: underSlab, life: '8 years' },
  { pest: TERMITES, method: 'Soil treatment', surface: 'Under paths beside the wall, rodded through the concrete',
    rate: mix, volume: rodding, life: '8 years' },
  { pest: TERMITES, method: 'Soil treatment', surface: 'Subfloor, around piers and walls',
    rate: mix, volume: '100 L of mix per m³ around each pier and wall; 5 L per m² over the subfloor where clearance is under 400 mm', life: '8 years' },
  { pest: TERMITES, method: 'Reticulation system', surface: 'Through an approved reticulation system',
    rate: mix, volume: 'At least 100 L of mix per m³ of soil', life: '8 years' },
  { pest: TERMITES, method: 'Foam', surface: 'Into termite workings and wall cavities with live termites',
    rate: foamMix, volume: 'Foam (15:1) into the workings until saturated, then treat the soil', life: '' },
];

// Maxxthor 100 and Biflex Ultra share the same bifenthrin rate table.
const bifenthrinUses = () => {
  // The label's table runs from 250 mL to 1.5 L per 100 L, with a longer
  // life for a stronger mix north of the Tropic of Capricorn.
  const rate = '500 mL per 100 L water (label table: 250 mL to 1.5 L)';
  const life = `10 years ${SOUTH}, 2 years north`;
  return [
    { pest: TERMITES, method: 'Soil treatment', surface: 'Perimeter, beside the slab or footings (trench and rod)',
      rate, volume: 'At least 100 L of mix per m³ of soil (5 L per metre for 300 x 150 mm)', life },
    { pest: TERMITES, method: 'Soil treatment', surface: 'Under the slab, drilled through the concrete',
      rate, volume: 'Up to 10 L of mix per metre, holes 150-300 mm apart and within 150 mm of walls and joints', life },
    { pest: TERMITES, method: 'Soil treatment', surface: 'Subfloor, around piers and walls',
      rate, volume: '100 L of mix per m³ around each pier and wall; 5 L per m² over the subfloor where clearance is under 400 mm', life },
    { pest: TERMITES, method: 'Reticulation system', surface: 'Perimeter and service penetrations only',
      rate, volume: 'At least 100 L of mix per m³ of soil (5 L per metre for 300 x 150 mm)', life },
  ];
};

const CHEMICAL_STARTER_DETAILS = {
  'Termidor': {
    maker: 'BASF', apvma: '54624', labelUrl: ELABEL(54624),
    sdsUrl: BASF_FILES + '2024-11/Termidor%C2%AEResidualTerm%20SDS.pdf', sdsExpires: '2029-02-27',
    uses: termidorUses('600 mL per 100 L water (0.06%)', '6 mL per 1 L water, plus foaming agent',
      'Up to 10 L of mix per m²: 300 mL per hole at 150 mm (heavy clay), 400 mL at 200 mm (other soils)',
      '200 L of mix per m³: 1.5 L per hole at 150 mm (heavy clay), 2 L at 200 mm (other soils)'),
  },
  'Termidor HE': {
    maker: 'BASF', apvma: '80820', labelUrl: ELABEL(80820),
    sdsUrl: BASF_FILES + '2024-11/Termidor%C2%AEHETermiticide%20SDS.pdf', sdsExpires: '2028-09-08',
    uses: termidorUses('625 mL per 100 L water (0.06%); through the High Pressure Device, also 625 mL per 50 L', '6.25 mL per 1 L water',
      'Up to 10 L of mix per m²: 1.1 L per hole at 350 mm (clay), 2 L at 450 mm (other soils)',
      '200 L of mix per m³: 3.5 L per hole at 350 mm (clay), 5 L at 450 mm (other soils)'),
  },
  'Termidor Foam': {
    maker: 'BASF', apvma: '70346', labelUrl: ELABEL(70346),
    sdsUrl: BASF_FILES + '2024-11/Termidor%C2%AEFoamTerm%20SDS.pdf', sdsExpires: '2028-11-16',
    uses: [{ pest: 'Subterranean and drywood termites', method: 'Foam', surface: 'Into termite workings, nests, wall cavities and voids',
      rate: 'Ready to use, no mixing (30 g makes about 1 L of foam)', volume: '10-30 seconds per injection point, or until foam flows back', life: '' }],
  },
  'Premise': {
    maker: 'Envu', apvma: '49098', labelUrl: ELABEL(49098),
    sdsUrl: ENVU_FILES + 'product-sds-and-labels/premise-200sc-termiticide-sds.ashx', sdsExpires: '2028-11-03',
    uses: [
      { pest: TERMITES, method: 'Soil treatment', surface: 'Perimeter, beside the slab or footings (trench and rod)',
        rate: '250 mL per 100 L water (500 mL for Mastotermes)', volume: 'At least 100 L of mix per m³ (at least 5 L per metre), to 100 mm below the top of the footing',
        life: `5 years ${SOUTH}, 2 years north; 1 year for Mastotermes` },
      { pest: TERMITES, method: 'Soil treatment', surface: 'Under the slab, drilled through the concrete',
        rate: '250 mL per 100 L water (500 mL for Mastotermes)', volume: 'At least 5 L of mix per m², holes 150-300 mm apart (at least 10 L per m² along cracks, joints and walls)',
        life: `5 years ${SOUTH}, 2 years north; 1 year for Mastotermes` },
      { pest: TERMITES, method: 'Soil treatment', surface: 'Under paths beside the wall, drilled through the concrete',
        rate: '250 mL per 100 L water (500 mL for Mastotermes)', volume: '100 L of mix per m³: 1.5 L per hole at 150 mm (heavy clay) up to 3 L at 300 mm (sand)',
        life: `5 years ${SOUTH}, 2 years north; 1 year for Mastotermes` },
      { pest: TERMITES, method: 'Soil treatment', surface: 'Subfloor, around piers and walls',
        rate: '250 mL per 100 L water (500 mL for Mastotermes)', volume: '100 L of mix per m³ around each pier and wall; the whole subfloor where clearance is under 400 mm',
        life: `5 years ${SOUTH}, 2 years north; 1 year for Mastotermes` },
      { pest: TERMITES, method: 'Foam', surface: 'Into termite workings and wall cavities (dry foam)',
        rate: '12.5 mL per 5 L water (0.05%), with a dry foaming agent', volume: 'Foam at 20:1 or drier into the workings; only alongside a soil treatment or baiting', life: '' },
      { pest: TERMITES, method: 'Nest treatment', surface: 'Nests in trees, stumps, poles and wall cavities',
        rate: '250 mL per 100 L water (500 mL for Mastotermes)', volume: 'At least 20 L of mix into the nest through drill holes', life: '' },
    ],
  },
  'Altriset': {
    maker: 'Syngenta', apvma: '64594', labelUrl: ELABEL(64594),
    uses: [
      { pest: TERMITES, method: 'Soil treatment', surface: 'Perimeter, beside the slab or footings (trench and rod)',
        rate: '250 mL per 100 L water (250 mL per m³ of soil)', volume: '100 L of mix per m³ of soil (5.25 L per metre for a trench 150 x 350 mm)',
        life: `Up to 8 years ${SOUTH}, up to 4 years north` },
      { pest: TERMITES, method: 'Soil treatment', surface: 'Under the slab, drilled through the concrete',
        rate: '250 mL per 100 L water (12.5 mL per m²)', volume: 'Up to 10 L of mix per m²: 225 mL per hole at 150 mm (heavy clay) up to 900 mL at 300 mm (sand)',
        life: `Up to 8 years ${SOUTH}, up to 4 years north` },
      { pest: TERMITES, method: 'Soil treatment', surface: 'Under paths beside the wall, rodded through the concrete',
        rate: '250 mL per 100 L water', volume: '200 L of mix per m³: 1.5 L per hole at 150 mm (heavy clay) up to 3 L at 300 mm (sand), 300 mm deep',
        life: `Up to 8 years ${SOUTH}, up to 4 years north` },
      { pest: TERMITES, method: 'Soil treatment', surface: 'Subfloor, around piers and walls',
        rate: '250 mL per 100 L water', volume: '100 L of mix per m³ around each pier and wall; 5 L per m² over the subfloor where clearance is under 400 mm',
        life: `Up to 8 years ${SOUTH}, up to 4 years north` },
      { pest: TERMITES, method: 'Foam', surface: 'Into termite workings and wall cavities',
        rate: '250 mL per 100 L water, with a non-repellent foaming agent (15 mL per L for 20:1)', volume: 'Into the galleries or as foam into infested voids', life: '' },
    ],
  },
  'Biflex Ultra': {
    maker: 'Envu', apvma: '59269', labelUrl: ELABEL(59269), uses: bifenthrinUses(),
    sdsUrl: ENVU_FILES + 'gss-web-downloads/biflex-ultra-lo-odour/biflex-ultra-sds-50001561_ext_sds_au_6n.ashx', sdsExpires: '2028-05-25',
  },
  'Maxxthor 100': {
    maker: 'Ensystex', apvma: '60113', labelUrl: ELABEL(60113),
    sdsUrl: ENSYSTEX_FILES + 'MAXXTHOR_100_Water-based_Termiticide_and_Insecticide_-_SDS_03-30.pdf?v=1743685506', sdsExpires: '2030-03-01',
    uses: bifenthrinUses(),
  },
  'Exterra': { maker: 'Ensystex' },
  'Exterra Focus': {
    maker: 'Ensystex', labelUrl: ENSYSTEX_FILES + 'L-AU-ENU110106_4.01_01.24_Exterra_Focus_Termite_1.1_kg_23.5_x_10.5_cm_EAU-v8_pt.pdf?v=1769394951',
    sdsUrl: ENSYSTEX_FILES + 'FOCUS_-_SDS_03-29.pdf?v=1710442941', sdsExpires: '2030-08-01',
    uses: [{ pest: TERMITES, method: 'Termite attractant', surface: 'In the hole under each new Exterra station',
      rate: '3/4 scoop (in-concrete or Ever-Ready EZ station), 1 1/2 scoops (Quarterra in-ground station)', volume: 'Once a year, onto moist soil', life: '' }],
  },
  'Requiem': {
    maker: 'Ensystex', apvma: '56580', labelUrl: ELABEL(56580),
    sdsUrl: ENSYSTEX_FILES + 'REQUIEM_Termite_Bait_-_SDS_03-29.pdf?v=1714677989', sdsExpires: '2029-03-01',
    uses: [
      { pest: TERMITES, method: 'Bait', surface: 'In-ground station',
        rate: '100 g of bait matrix mixed with 300-400 mL clean water (up to 100 mL more if hot and dry)', volume: 'Up to 500 g of paste per Exterra station; check every 3-8 weeks and top up', life: '' },
      { pest: TERMITES, method: 'Bait', surface: 'Above-ground station on active workings',
        rate: '100 g of bait matrix mixed with 300-400 mL clean water', volume: 'Up to 500 g per station or bait bag; check every 3-6 weeks, top up or moisten', life: '' },
    ],
  },
  'Sentricon': {
    maker: 'Corteva', apvma: '80120', labelUrl: ELABEL(80120),
    uses: [{ pest: TERMITES, method: 'Bait', surface: 'In-ground station',
      rate: 'One Sentricon rod in every in-ground station (ready to use)', volume: 'Replace the rod when more than half is eaten', life: '' }],
  },
  'Sentricon AG': {
    maker: 'Corteva', apvma: '57843', labelUrl: ELABEL(57843),
    uses: [{ pest: TERMITES, method: 'Bait', surface: 'Above-ground station on active workings',
      rate: 'One AG bait, wetted with 150-200 mL water or 10% sugar water', volume: 'Check every 2-6 weeks; replace when nearly all eaten', life: '' }],
  },
  'Trelona': {
    maker: 'BASF', apvma: '86731', labelUrl: ELABEL(86731),
    sdsUrl: BASF_FILES + '2024-11/Trelona%C2%AETermiteBait%20SDS.PDF', sdsExpires: '2028-09-08',
    uses: [
      { pest: TERMITES, method: 'Bait', surface: 'In-ground station',
        rate: 'One cartridge per station to monitor, or two for active on application', volume: 'Stations about 3 m apart; replace a cartridge once more than half is eaten', life: '' },
      { pest: TERMITES, method: 'Bait', surface: 'Above-ground station on active workings',
        rate: 'Trelona in a compatible above-ground station', volume: 'Check every 3-6 weeks and replenish', life: '' },
    ],
  },
  'Kordon': {
    maker: 'Envu', apvma: '60759', labelUrl: ELABEL(60759),
    sdsUrl: ENVU_FILES + 'product-sds-and-labels/kordon-termite-system-sds-ghs.ashx', sdsExpires: '2029-09-06',
    uses: [
      { pest: TERMITES, method: 'Physical barrier', surface: 'Full under-slab sheet (also the vapour barrier)',
        rate: 'Sheet, no mixing (2 g deltamethrin per m²)', volume: 'Laid on the bedding sand, joins taped with overlaps of at least 200 mm', life: 'At least 20 years' },
      { pest: TERMITES, method: 'Physical barrier', surface: 'Perimeter and service penetrations (collars)',
        rate: 'Sheet or collar, no mixing', volume: 'Collar pushed down each pipe onto the sheet, two zip ties', life: 'At least 20 years' },
    ],
  },
};

// The day SAYON's starting rates were last read off the labels themselves.
const CHEMICAL_RATES_CHECKED = '2026-11-05';

const chemId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Products the APVMA's register (PubCRIS) no longer lists as registered,
// by APVMA product number, or by name where it never had one. They are not
// offered, and a register or treatment record that still has one says so.
const CHEMICAL_NOT_REGISTERED = {
  apvma: { '60654': 'Termidor Dry (lapsed 30 June 2025)', '59345': 'Premise Foam (lapsed 30 June 2022)' },
  name: { 'termidor dry': 'Termidor Dry (lapsed 30 June 2025)', 'premise foam': 'Premise Foam (lapsed 30 June 2022)', 'termidust': 'Termidust (no product by that name)' },
};
// "No longer registered with the APVMA", or '' for a product that is. The
// APVMA's own list decides, as the weekly check last found it (below); a
// number the phone hasn't checked yet, or a product with no number, goes
// by the list above.
function chemicalNotRegistered(p) {
  if (!p) return '';
  const live = apvmaListing(p);
  const hit = live !== undefined ? live === null
    : !!(CHEMICAL_NOT_REGISTERED.apvma[apvmaNo(p)] || CHEMICAL_NOT_REGISTERED.name[String(p.name || '').trim().toLowerCase()]);
  return hit ? 'Not registered with the APVMA' : '';
}

// ── THE WEEKLY APVMA CHECK ──────────────────────────────────────────────────
// Once a week the phone looks up every APVMA No. in the register on the
// APVMA's own list of registered products. The APVMA publishes that list on
// data.gov.au and reloads it every week (PubCRIS, product.csv). A number
// that has dropped off it is a product whose registration was cancelled,
// lapsed or wasn't renewed, and the register and the treatment record say
// so. The list has no recalls: the APVMA posts those on its own website.
// A product's number is checked as soon as it's typed, too.
//
// Kept on this phone under korva_apvma_check: { checkedAt (ms), total (rows
// in the APVMA's list then), listId, numbers: { '54624': { name, holder,
// expires (YYYY-MM-DD) }, '60654': null } }, null being a number not on the
// list.
const APVMA_API = 'https://data.gov.au/data/api/3/action/';
const APVMA_DATASET = '0de37904-43e0-4814-b21b-5b64fafefe6f';
const APVMA_PRODUCT_LIST = 'b4bb5394-b60b-4602-8bde-2e206ffc498f';
const APVMA_CHECK_KEY = 'korva_apvma_check';
const APVMA_CHECK_EVERY = 7 * 86400000;

// The product number: the first part of "54624/138127", without leading zeros.
const apvmaNo = p => { const m = String((p && p.apvma) || '').match(/\d{4,6}/); return m ? String(parseInt(m[0], 10)) : ''; };

function apvmaCheck() {
  try {
    const c = JSON.parse(localStorage.getItem(APVMA_CHECK_KEY) || 'null');
    return c && c.numbers ? c : null;
  } catch (e) { return null; }
}

// What the last check found for a product's number: its listing, null when
// it wasn't on the list, undefined when it hasn't been checked.
function apvmaListing(p) {
  const no = apvmaNo(p), c = apvmaCheck();
  return no && c && Object.prototype.hasOwnProperty.call(c.numbers, no) ? c.numbers[no] : undefined;
}

// "30/06/2027 12:00:00 AM" → "2027-06-30"
const apvmaIsoDate = s => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(s || ''));
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
};
const apvmaDayText = ms => new Date(ms).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

async function apvmaGet(action, params) {
  const r = await fetch(`${APVMA_API}${action}?${new URLSearchParams(params)}`);
  const d = await r.json().catch(() => null);
  if (!d || !d.success || !d.result) throw new Error(`APVMA list (${r.status})`);
  return d.result;
}

// If the APVMA ever replaces the list's file on data.gov.au, the new one is
// found by its name in the APVMA's dataset.
async function apvmaFindList() {
  const set = await apvmaGet('package_show', { id: APVMA_DATASET });
  const file = (set.resources || []).find(r => r.name === 'product.csv' && r.datastore_active);
  if (!file) throw new Error('APVMA list not found');
  return file.id;
}

let apvmaChecking = null, apvmaTriedAt = 0, apvmaAgain = false;
// Checks when a week has passed or a number is new, and quietly does
// nothing offline or when the list can't be read (the last check stands).
function checkApvmaList() {
  // A number typed while a check is under way is looked up straight after.
  if (apvmaChecking) { apvmaAgain = true; return apvmaChecking; }
  const products = getChemicalRegister().products;
  const numbers = [...new Set(products.map(apvmaNo).filter(Boolean))];
  const last = apvmaCheck();
  const fresh = numbers.filter(n => !last || !Object.prototype.hasOwnProperty.call(last.numbers, n));
  const due = !last || Date.now() - last.checkedAt > APVMA_CHECK_EVERY || fresh.length > 0;
  // A failed try waits a minute before the next.
  if (!numbers.length || !due || navigator.onLine === false || Date.now() - apvmaTriedAt < 60000) return Promise.resolve(null);
  apvmaTriedAt = Date.now();
  const lookUp = listId => Promise.all([
    apvmaGet('datastore_search', { resource_id: listId, limit: '0' }),
    apvmaGet('datastore_search', { resource_id: listId, filters: JSON.stringify({ pcode: numbers }), fields: 'pcode,fpname,sname,expdate', limit: '1000' }),
  ]).then(([all, found]) => ({ all, found, listId }));
  const listId = (last && last.listId) || APVMA_PRODUCT_LIST;
  apvmaChecking = lookUp(listId).catch(e => apvmaFindList().then(id => {
    if (id === listId) throw e;
    return lookUp(id);
  })).then(({ all, found, listId }) => {
    // The APVMA reloads the list every week. Caught half-loaded, it would
    // make every product look cancelled, so a list much shorter than last
    // time's (it holds about 19,000 products and actives) isn't used.
    if (!(all.total >= Math.max(10000, ((last && last.total) || 0) * 0.8))) throw new Error('APVMA list part-loaded');
    const listed = {};
    numbers.forEach(n => { listed[n] = null; });
    (found.records || []).forEach(r => {
      const n = String(parseInt(r.pcode, 10));
      if (n in listed) listed[n] = { name: r.fpname || '', holder: r.sname || '', expires: apvmaIsoDate(r.expdate) };
    });
    const check = { checkedAt: Date.now(), total: all.total, listId, numbers: listed };
    try { localStorage.setItem(APVMA_CHECK_KEY, JSON.stringify(check)); } catch (e) { return null; }
    apvmaTriedAt = 0;
    // A product that has just dropped off the list (or was off it when
    // first checked) gets a heads-up, once.
    const gone = products.filter(p => listed[apvmaNo(p)] === null && !(last && last.numbers[apvmaNo(p)] === null));
    if (gone.length && typeof showToast === 'function') {
      const names = [...new Set(gone.map(p => p.name || `APVMA No. ${apvmaNo(p)}`))];
      showToast(`${names.join(', ')} ${names.length === 1 ? "isn't" : "aren't"} registered with the APVMA any more`, 'info',
        { label: 'See', run: () => openMenuPage('chemicalsPanel') });
    }
    refreshChemicalCards();
    return check;
  }).catch(() => null).finally(() => {
    apvmaChecking = null;
    if (apvmaAgain) { apvmaAgain = false; checkApvmaList(); }
  });
  return apvmaChecking;
}

// The phone stays open for days, so the check also runs on coming back to it.
window.addEventListener('load', () => setTimeout(checkApvmaList, 15000));
window.addEventListener('online', () => checkApvmaList());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkApvmaList(); });

// What the APVMA's list says about the product, on its card.
function chemicalApvmaHtml(p) {
  const esc = escapeHtml;
  const no = apvmaNo(p), live = apvmaListing(p), c = apvmaCheck();
  if (!no || live === undefined) return '';
  const when = `checked ${apvmaDayText(c.checkedAt)}`;
  if (live === null) {
    return `<div class="chem-apvma gone">APVMA No. ${esc(no)} is not on the APVMA's list of registered products (${when}). Check the number on the label. If it's right, the product's registration has been cancelled or has lapsed: check with the maker or the APVMA before using it.</div>`;
  }
  // The list has most names in capitals: "TERMIDOR RESIDUAL TERMITICIDE".
  // Small joining words stay lower case: "Termiticide and Insecticide".
  const name = live.name === live.name.toUpperCase()
    ? live.name.toLowerCase().replace(/\b[a-z]/g, ch => ch.toUpperCase()).replace(/(?!^)\b(And|Or|Of|For|The|With|In|On|To)\b/g, w => w.toLowerCase())
    : live.name;
  return `<div class="chem-apvma">Registered with the APVMA as ${esc(name)} (No. ${esc(no)}), ${esc(when)}.</div>`;
}

// A starting product's id comes from its name, so taking one off the list
// never changes another's (treatment records keep the use they picked).
const chemStarterId = name => 'start-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function chemicalStarterProducts() {
  return Object.entries(CHEMICAL_STARTER_FORMS).map(([name, form]) => {
    const { uses, ...known } = CHEMICAL_STARTER_DETAILS[name] || {};
    const id = chemStarterId(name);
    return {
      id,
      name, maker: '', active: TREATMENT_PRODUCTS[name] || '', apvma: '', form,
      labelUrl: '', sdsUrl: '', sdsExpires: '', declUrl: '', ...known,
      uses: (uses || CHEMICAL_STARTER_USES[form].map(u => ({ ...u, rate: '', volume: '', life: '' })))
        .map((u, j) => ({ id: `${id}-u${j}`, ...u })),
    };
  });
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
  const reg = storedChemicalRegister();
  return reg ? withStarterDetails(reg) : { products: chemicalStarterProducts() };
}

// A register saved before SAYON knew a starting product's links and label
// rates gets them where it has nothing of its own: a blank field, or uses
// that are still the starting ones with no rate typed. Nothing typed is
// ever replaced.
const STARTER_ACTIVE_FIXED = { 'Sentricon': 'noviflumuron', 'Exterra Focus': 'chlorfluazuron' };
function withStarterDetails(reg) {
  const starters = new Map(chemicalStarterProducts().map(p => [p.name.toLowerCase(), p]));
  reg.products.forEach(p => {
    const s = starters.get(String(p.name || '').trim().toLowerCase());
    if (!s) return;
    // The first starting list had two actives wrong: Sentricon in Australia
    // is hexaflumuron, and Exterra Focus is an attractant with none.
    if (STARTER_ACTIVE_FIXED[p.name.trim()] === p.active) p.active = s.active;
    ['maker', 'active', 'apvma', 'labelUrl', 'sdsUrl', 'sdsExpires'].forEach(f => { if (!p[f] && s[f]) p[f] = s[f]; });
    const untouched = (p.uses || []).every(u => /^start/.test(u.id || '') && !u.rate && !u.volume && !u.life);
    if (untouched && s.uses.some(u => u.rate)) p.uses = s.uses.map(u => ({ ...u }));
  });
  return reg;
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
  const unreg = chemicalNotRegistered(p) ? `<span class="chem-unreg">${esc(chemicalNotRegistered(p))}</span>` : '';
  if (!label && !sds) return `<span class="chem-links">${unreg}<span class="chem-nolink">No label or SDS link yet</span></span>`;
  return `<span class="chem-links">${unreg}
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
  return `<div class="chem-docs">${chemicalApvmaHtml(p)}${chemicalDocRow(p, 'sds')}${chemicalDocRow(p, 'label')}${safeUrl(p.declUrl) ? chemicalDocRow(p, 'decl') : ''}</div>`;
}

// Where a product's rates came from, since they print on the certificate:
// SAYON's reading of the label (and the day it was read), or the business.
// '' for a product with no rate yet.
function chemicalRatesNote(p) {
  const uses = p.uses || [];
  if (!uses.some(u => chemicalUseRate(u) || u.life)) return '';
  const sig = list => JSON.stringify(list.map(u => [u.pest, u.method, u.surface, u.rate, u.volume, u.life].map(v => String(v || '').trim())));
  const starter = chemicalStarterProducts().find(s => s.name.toLowerCase() === String(p.name || '').trim().toLowerCase());
  const fromLabel = !!starter && starter.uses.some(u => u.rate);
  if (fromLabel && sig(starter.uses) === sig(uses)) {
    return `Rates from the label, checked ${apvmaDayText(new Date(CHEMICAL_RATES_CHECKED + 'T00:00:00').getTime())}. Check they match yours.`;
  }
  const when = p.ratesChangedAt ? new Date(p.ratesChangedAt) : null;
  const day = when ? ', ' + when.toLocaleDateString('en-AU', when.getFullYear() === new Date().getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const who = canEditBusiness() ? 'you' : 'your business';
  return `${fromLabel ? 'Changed' : 'Rates typed'} by ${who}${day}`;
}

// The label's rates, to read: the edit form holds the same in boxes.
function chemicalRatesHtml(p) {
  const esc = escapeHtml;
  const uses = p.uses || [];
  if (!uses.length) return '<div class="chem-rates"></div>';
  const note = chemicalRatesNote(p);
  return `<div class="chem-rates">
      <div class="chem-doc-title">Label rates</div>
      ${note ? `<div class="chem-rates-note">${esc(note)}</div>` : ''}
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
  checkApvmaList();
}

// After a check: each card's heading and documents follow it, and an open
// card or edit form stays as it is.
function refreshChemicalCards() {
  const list = document.getElementById('chemList');
  if (!list || !list.children.length) return;
  const reg = getChemicalRegister();
  list.querySelectorAll('.chem-card').forEach(card => {
    const p = reg.products.find(x => x.id === card.dataset.id);
    if (p) refreshChemicalCard(card, p);
  });
  renderChemicalSummary();
}

function refreshChemicalCard(card, p) {
  const fresh = document.createElement('div');
  fresh.innerHTML = chemicalCardHtml(p, canEditBusiness());
  const next = fresh.firstElementChild;
  card.dataset.find = next.dataset.find;
  ['summary', '.chem-docs', '.chem-rates'].forEach(sel => card.querySelector(sel).replaceWith(next.querySelector(sel)));
}

function renderChemicalSummary() {
  const reg = getChemicalRegister();
  const uses = reg.products.flatMap(p => p.uses || []);
  const noRate = uses.filter(u => !u.rate).length;
  const sum = document.querySelector('#chemicalsPanel .job-panel-summary');
  if (sum) sum.textContent = reg.products.length ? `${reg.products.length} products` : '';
  const gone = [...new Set(reg.products.filter(chemicalNotRegistered).map(p => p.name || 'A product'))];
  const status = document.getElementById('chemStatus');
  if (status) {
    status.textContent = [
      gone.length ? `${gone.join(', ')} ${gone.length === 1 ? "isn't" : "aren't"} registered with the APVMA any more.` : '',
      !uses.length ? ''
        : noRate
          ? `${noRate} of ${uses.length} uses have no rate yet. Type each one from the label once, and treatment records fill it from then on.`
          : 'Every use has its label rate.',
    ].filter(Boolean).join(' ');
    status.classList.toggle('warn', noRate > 0 || gone.length > 0);
    status.hidden = !status.textContent;
  }
  const note = document.getElementById('chemApvmaNote');
  const c = apvmaCheck();
  if (note) {
    note.textContent = c ? `SAYON checks each APVMA No. against the APVMA's list of registered products once a week. Last checked ${apvmaDayText(c.checkedAt)}.` : '';
    note.hidden = !c;
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
          <span class="chem-card-sub">${chemicalNotRegistered(p) ? `<span class="chem-unreg">${esc(chemicalNotRegistered(p))}</span> · ` : ''}${esc([p.active, CHEMICAL_FORMS[p.form] || ''].filter(Boolean).join(' · '))}${missing ? ` · <span class="pb-start">${missing === 1 ? '1 rate' : missing + ' rates'} to add</span>` : ''}</span>
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
    if (u) { u[el.dataset.u] = el.value.trim(); p.ratesChangedAt = Date.now(); }
  }
  storeChemicalRegister(reg);
  // The heading, documents and rates follow the edit; the form stays put.
  refreshChemicalCard(card, p);
  renderChemicalSummary();
  // A new APVMA No. is looked up on the APVMA's list straight away.
  if (el.dataset.f === 'apvma') checkApvmaList();
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
  p.ratesChangedAt = Date.now();
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
  p.ratesChangedAt = Date.now();
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
  p.ratesChangedAt = Date.now();
  storeChemicalRegister(reg);
  return true;
}
