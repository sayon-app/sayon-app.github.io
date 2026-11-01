// ── SITE PLAN ───────────────────────────────────────────────────────────────
// A drawn plan of the site with a fixed set of symbols and a legend, so
// anyone reading the certificate (the client, an agent, a solicitor, the
// next technician) can see where the building, the treatment and each
// station are. It's kept with the treatment record as data, not a picture:
// q.treatment.plan = { v: 1, north: 0..7 (steps of 45°), items: [
//   { id, k: symbol key, x, y } for a point,
//   { ..., n } for a station (one number sequence across all station types),
//   { ..., w, h } for a building or an area (x, y its top-left corner),
//   { id, k, pts: [[x, y], ...] } for a line, or a closed shape (a building
//   of any shape),
//   any of them with a label, and layer: 'sub' when it's on the subfloor
//   plan (drawn under the same building, at the same scale) ],
//   mpu: metres per plan unit, once the technician gives one real size,
//   bg: a faded JPEG data URL of a map screenshot or photo to trace over }.
// Plan units are 1000 × 750 (4:3), top-left origin. The same drawing code
// paints the plan in the app (SVG) and on the PDFs (jsPDF), so they match.

const PLAN_W = 1000, PLAN_H = 750, PLAN_GRID = 25;

const PLAN_INK = {
  ink: '#0C121C', muted: '#566A7F', faint: '#C8D5E3', paper: '#FFFFFF',
  building: '#EEF2F7', shed: '#F5F7FA',
  blue: '#2F6BFF', blueDark: '#1D4ED8', bluePale: '#DCE6FF',
  pink: '#FF3D8B',
  green: '#15803D', greenFill: '#22C55E',
  red: '#C03026', redDark: '#8E1F18',
  orange: '#EA7A12', orangeDark: '#B45309',
  amber: '#D4920A', amberText: '#8A5A00', amberWash: '#FFF3D6',
  tree: '#5E7D5A',
};

// group: the tab it sits under in the editor. legend: the words in the key
// (symbols with the same words share one line of the legend).
const SITE_PLAN_GROUPS = { build: 'Buildings', yard: 'Yard', services: 'Services', treat: 'Treatment', stations: 'Stations', find: 'Findings',
  structure: 'Structure', subaccess: 'Access', subfind: 'Findings' };
// The tabs in each view of the editor: the site, and the subfloor under the
// building. Some symbols (access, termite activity) appear in both.
const SITE_PLAN_TRAYS = {
  site: ['build', 'yard', 'services', 'treat', 'stations', 'find'],
  sub: ['structure', 'subaccess', 'subfind'],
};
const SITE_PLAN_SUB_TRAY = {
  structure: ['subfloor', 'subfloorShape', 'slab', 'pier', 'pierrow', 'dwarf', 'vent'],
  subaccess: ['access', 'clearance', 'noaccess', 'subtreated', 'text'],
  subfind: ['activity', 'damage', 'decay', 'moisture', 'antcap', 'timber'],
};
const SITE_PLAN_SYMBOLS = {
  house:     { kind: 'rect', group: 'build', label: 'House, square', legend: 'House or main building', z: 0, def: { w: 400, h: 275, label: 'House' }, ph: 'e.g. House, Unit 2', size: true },
  outline:   { kind: 'area', group: 'build', label: 'House, any shape', legend: 'House or main building', z: 0, ph: 'e.g. House', size: true },
  shed:      { kind: 'rect', group: 'build', label: 'Garage or shed', legend: 'Garage, shed or other building', z: 0, def: { w: 175, h: 150, label: 'Garage' }, ph: 'e.g. Garage, Shed', size: true },
  deck:      { kind: 'rect', group: 'build', label: 'Deck or patio', legend: 'Deck, patio or verandah', z: 0, def: { w: 250, h: 125, label: 'Deck' }, ph: 'e.g. Rear deck' },
  text:      { kind: 'text', group: 'build', label: 'Label', legend: null, z: 5, ph: 'e.g. Street, Neighbour' },
  garden:    { kind: 'rect', group: 'yard', label: 'Garden bed', legend: 'Garden bed', z: 0, def: { w: 250, h: 50, label: '' }, ph: 'e.g. Mulched bed' },
  paving:    { kind: 'rect', group: 'yard', label: 'Paving or concrete', legend: 'Paving or concrete', z: 0, def: { w: 250, h: 100, label: 'Paving' }, ph: 'e.g. Rear paving' },
  driveway:  { kind: 'rect', group: 'yard', label: 'Driveway', legend: 'Driveway or path', z: 0, def: { w: 100, h: 275, label: 'Driveway' }, ph: 'e.g. Driveway' },
  pool:      { kind: 'rect', group: 'yard', label: 'Pool', legend: 'Pool or pond', z: 0, def: { w: 200, h: 100, label: 'Pool' }, ph: 'e.g. Pool' },
  fence:     { kind: 'line', group: 'yard', label: 'Fence', legend: 'Fence or boundary', z: 2, ph: 'e.g. Side fence' },
  retaining: { kind: 'line', group: 'yard', label: 'Retaining wall', legend: 'Retaining wall', z: 2, ph: 'e.g. Sleeper wall' },
  tree:      { kind: 'point', group: 'yard', label: 'Tree or stump', legend: 'Tree or stump', z: 3, ph: 'e.g. Gum tree' },
  tank:      { kind: 'point', group: 'yard', label: 'Water tank', legend: 'Water tank', z: 3, ph: 'e.g. Rainwater tank' },
  hws:       { kind: 'point', group: 'services', label: 'Hot water', legend: 'Hot water system', z: 3, ph: 'e.g. Gas hot water' },
  ac:        { kind: 'point', group: 'services', label: 'Air con unit', legend: 'Air conditioner unit', z: 3, ph: 'e.g. Split system' },
  downpipe:  { kind: 'point', group: 'services', label: 'Downpipe', legend: 'Downpipe', z: 3, ph: 'e.g. Not connected' },
  tap:       { kind: 'point', group: 'services', label: 'Garden tap', legend: 'Garden tap', z: 3, ph: 'e.g. Dripping' },
  meter:     { kind: 'point', group: 'services', label: 'Meter box', legend: 'Meter box', z: 3, ph: 'e.g. Electricity meter' },
  access:    { kind: 'point', group: 'services', label: 'Access point', legend: 'Subfloor or roof access', z: 3, ph: 'e.g. Subfloor hatch' },
  barrier:   { kind: 'line', group: 'treat', label: 'Chemical barrier', legend: 'Chemical barrier (treated soil)', z: 2, ph: 'e.g. Trenched and rodded', size: true },
  treated:   { kind: 'point', group: 'treat', label: 'Treated spot', legend: 'Direct treatment (foam, dust or spray)', z: 3, ph: 'e.g. Foamed wall cavity' },
  untreated: { kind: 'line', group: 'treat', label: 'Not treated', legend: 'Not treated', z: 2, ph: 'e.g. Under paving, no access', size: true },
  noaccess:  { kind: 'rect', group: 'treat', label: 'No access area', legend: 'Area not inspected or treated', z: 1, def: { w: 200, h: 100, label: 'No access' }, ph: 'e.g. Under rear deck' },
  notice:    { kind: 'point', group: 'treat', label: 'Durable notice', legend: 'Durable notice', z: 3, ph: 'e.g. Meter box' },
  inground:  { kind: 'station', group: 'stations', label: 'In-ground', legend: 'In-ground bait station', z: 4, ph: 'Where, e.g. rear left corner' },
  above:     { kind: 'station', group: 'stations', label: 'Above-ground', legend: 'Above-ground bait station', z: 4, ph: 'Where, e.g. laundry east wall' },
  monitor:   { kind: 'station', group: 'stations', label: 'Monitoring', legend: 'Monitoring station', z: 4, ph: 'Where, e.g. by the shed' },
  activity:  { kind: 'point', group: 'find', label: 'Termite activity', legend: 'Termite activity or damage found', z: 3, ph: 'e.g. Laundry door frame' },
  moisture:  { kind: 'point', group: 'find', label: 'Moisture or leak', legend: 'Moisture or leak', z: 3, ph: 'e.g. Leaking shower' },
  timber:    { kind: 'point', group: 'find', label: 'Timber on soil', legend: 'Timber on soil, woodpile or stored timber', z: 3, ph: 'e.g. Woodpile against wall' },
  bridge:    { kind: 'point', group: 'find', label: 'Bridging', legend: 'Bridging of the barrier or slab edge', z: 3, ph: 'e.g. Soil over slab edge' },
  // The subfloor plan's own symbols (SITE_PLAN_SUB_TRAY).
  subfloor:  { kind: 'rect', label: 'Subfloor, square', legend: 'Subfloor (suspended floor)', z: 0, def: { w: 400, h: 275, label: 'Subfloor' }, ph: 'e.g. Subfloor, 600 mm clearance', size: true },
  subfloorShape: { kind: 'area', label: 'Subfloor, any shape', legend: 'Subfloor (suspended floor)', z: 0, ph: 'e.g. Subfloor' },
  slab:      { kind: 'rect', label: 'Slab section', legend: 'Slab on ground (no subfloor)', z: 0, def: { w: 150, h: 150, label: 'Slab' }, ph: 'e.g. Laundry and bathroom on slab', size: true },
  pier:      { kind: 'point', label: 'Pier or stump', legend: 'Pier or stump', z: 3, ph: 'e.g. Timber stump' },
  pierrow:   { kind: 'line', label: 'Row of piers', legend: 'Pier or stump', z: 2, ph: 'e.g. Brick piers' },
  dwarf:     { kind: 'line', label: 'Dwarf wall', legend: 'Dwarf wall or sleeper wall', z: 2, ph: 'e.g. Brick dwarf wall' },
  vent:      { kind: 'point', label: 'Vent', legend: 'Subfloor vent', z: 3, ph: 'e.g. Blocked by garden bed' },
  clearance: { kind: 'rect', label: 'Low clearance', legend: 'Low clearance (restricted access)', z: 1, def: { w: 200, h: 100, label: 'Under 400 mm' }, ph: 'e.g. 250 mm clearance' },
  subtreated:{ kind: 'rect', label: 'Treated soil', legend: 'Treated soil under the floor', z: 1, def: { w: 200, h: 150, label: 'Treated' }, ph: 'e.g. Rodded and sprayed' },
  damage:    { kind: 'point', label: 'Timber damage', legend: 'Timber damage found', z: 3, ph: 'e.g. Bearer, north side' },
  decay:     { kind: 'point', label: 'Decay or rot', legend: 'Fungal decay (rot)', z: 3, ph: 'e.g. Joist ends' },
  antcap:    { kind: 'point', label: 'Ant cap problem', legend: 'Ant cap missing or damaged', z: 3, ph: 'e.g. Missing on 3 stumps' },
};
const SITE_PLAN_STATIONS = ['inground', 'above', 'monitor'];

// A station's colour on a visit's plan, by what the visit found there.
// Green is clear; red, orange and amber are the problems.
const SITE_PLAN_STATUS = {
  clear:   { fill: PLAN_INK.greenFill, stroke: PLAN_INK.green, text: '#FFFFFF', legend: 'Clear, no activity' },
  active:  { fill: PLAN_INK.red, stroke: PLAN_INK.redDark, text: '#FFFFFF', legend: 'Termites active' },
  eaten:   { fill: PLAN_INK.orange, stroke: PLAN_INK.orangeDark, text: '#FFFFFF', legend: 'Bait eaten, no termites seen' },
  problem: { fill: PLAN_INK.amberWash, stroke: PLAN_INK.amber, text: PLAN_INK.amberText, dash: [7, 5], legend: 'Damaged, missing or not checked' },
};
function sitePlanStatusStyle(status) {
  if (!status) return null;
  return SITE_PLAN_STATUS[status] || (['damaged', 'missing', 'noaccess'].includes(status) ? SITE_PLAN_STATUS.problem : null);
}

// Lengths in metres, once the plan has a scale.
function planPathLength(pts, closed) {
  let L = 0;
  (pts || []).forEach((p, i) => { if (i) L += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]); });
  if (closed && pts && pts.length > 2) L += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
  return L;
}
function sitePlanLength(plan, k) {
  if (!plan || !plan.mpu) return 0;
  return planLayerItems(plan).filter(it => it.k === k).reduce((a, it) => a + planPathLength(it.pts), 0) * plan.mpu;
}
function formatPlanMetres(m) {
  return `${m < 10 ? Math.round(m * 10) / 10 : Math.round(m)} m`;
}

// The items on one view: the site ('site') or the subfloor ('sub').
function planLayerItems(plan, layer = 'site') {
  return ((plan && plan.items) || []).filter(it => (it.layer || 'site') === layer);
}

function sitePlanHasSubfloor(plan) {
  return planLayerItems(plan, 'sub').length > 0;
}

// Where each pier in a row of piers sits: about every 1.8 m when the plan
// has a scale, else every 50 plan units, both ends included.
function pierRowPoints(pts, mpu) {
  const gap = mpu ? Math.max(20, 1.8 / mpu) : 50, out = [];
  (pts || []).forEach((b, i) => {
    if (!i) { out.push(b); return; }
    const a = pts[i - 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / gap));
    for (let k = 1; k <= n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  });
  return out;
}

// "28 piers or stumps, 4 vents, 1 low clearance area and 2 places timber
// damage was found": what the subfloor plan shows.
function sitePlanSubSummary(plan) {
  const items = planLayerItems(plan, 'sub');
  const count = k => items.filter(it => it.k === k).length;
  const piers = count('pier') + items.filter(it => it.k === 'pierrow').reduce((a, it) => a + pierRowPoints(it.pts, plan.mpu).length, 0);
  const n = (num, one, many) => `${num} ${num === 1 ? one : many}`;
  const bits = [];
  if (piers) bits.push(n(piers, 'pier or stump', 'piers or stumps'));
  if (count('dwarf')) bits.push(n(count('dwarf'), 'dwarf wall', 'dwarf walls'));
  if (count('vent')) bits.push(n(count('vent'), 'vent', 'vents'));
  if (count('access')) bits.push(n(count('access'), 'access point', 'access points'));
  if (count('slab')) bits.push(n(count('slab'), 'section on slab', 'sections on slab'));
  if (count('clearance')) bits.push(n(count('clearance'), 'low clearance area', 'low clearance areas'));
  if (count('noaccess')) bits.push(n(count('noaccess'), 'area that could not be reached', 'areas that could not be reached'));
  if (count('subtreated')) bits.push('treated soil');
  if (count('activity')) bits.push(n(count('activity'), 'place termite activity was found', 'places termite activity was found'));
  if (count('damage')) bits.push(n(count('damage'), 'place timber damage was found', 'places timber damage was found'));
  if (count('decay')) bits.push(n(count('decay'), 'place with decay', 'places with decay'));
  if (count('moisture')) bits.push(n(count('moisture'), 'damp or leaking spot', 'damp or leaking spots'));
  if (count('antcap')) bits.push(n(count('antcap'), 'ant cap problem', 'ant cap problems'));
  if (count('timber')) bits.push(n(count('timber'), 'place with timber on the soil', 'places with timber on the soil'));
  return bits.length ? joinWithAnd(bits) : '';
}

function sitePlanHasContent(plan) {
  return !!(plan && Array.isArray(plan.items) && plan.items.length);
}

function sitePlanStations(plan) {
  return planLayerItems(plan).filter(it => SITE_PLAN_STATIONS.includes(it.k)).sort((a, b) => a.n - b.n);
}

// "12 in-ground bait stations, 2 above-ground bait stations and a
// chemical barrier": what the plan shows, for the record and the PDF.
function sitePlanSummary(plan) {
  const items = planLayerItems(plan);
  const count = k => items.filter(it => it.k === k).length;
  const bits = [];
  [['inground', 'in-ground bait station'], ['above', 'above-ground bait station'], ['monitor', 'monitoring station']].forEach(([k, word]) => {
    const n = count(k); if (n) bits.push(`${n} ${word}${n === 1 ? '' : 's'}`);
  });
  const barrier = sitePlanLength(plan, 'barrier');
  if (count('barrier')) bits.push(`a chemical barrier${barrier ? ` (about ${formatPlanMetres(barrier)})` : ''}`);
  if (count('treated')) bits.push(`${count('treated')} direct treatment spot${count('treated') === 1 ? '' : 's'}`);
  if (count('untreated') + count('noaccess')) bits.push('areas not treated');
  if (count('activity')) bits.push(`${count('activity')} place${count('activity') === 1 ? '' : 's'} termite activity or damage was found`);
  return bits.length ? joinWithAnd(bits) : '';
}

// ── DRAWING ── A painter draws circles, polygons and text in plan units.
// svgPainter() collects SVG markup; pdfPainter() draws on a jsPDF page.
function svgPainter() {
  const out = [];
  const style = o => `fill="${o.fill || 'none'}" stroke="${o.stroke || 'none'}" stroke-width="${o.lw || 0}"` +
    (o.dash ? ` stroke-dasharray="${o.dash.join(' ')}"` : '') + ' stroke-linejoin="round" stroke-linecap="round"';
  return {
    out,
    circle(x, y, r, o) { out.push(`<circle cx="${x}" cy="${y}" r="${r}" ${style(o)}/>`); },
    poly(pts, o) {
      const d = pts.map(p => `${Math.round(p[0] * 10) / 10},${Math.round(p[1] * 10) / 10}`).join(' ');
      out.push(o.close === false ? `<polyline points="${d}" ${style(o)}/>` : `<polygon points="${d}" ${style(o)}/>`);
    },
    text(x, y, str, o) {
      const anchor = o.align === 'left' ? 'start' : o.align === 'right' ? 'end' : 'middle';
      out.push(`<text x="${x}" y="${y}" font-size="${o.size}" font-family="Inter, Helvetica, Arial, sans-serif" font-weight="${o.bold ? 700 : 500}" fill="${o.color}" text-anchor="${anchor}" dominant-baseline="central"` +
        (o.halo ? ` stroke="#fff" stroke-width="${o.size * 0.28}" paint-order="stroke" stroke-linejoin="round"` : '') + `>${escapeHtml(String(str))}</text>`);
    },
    raw(s) { out.push(s); },
  };
}

function pdfPainter(doc, ox, oy, s) {
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const X = x => ox + x * s, Y = y => oy + y * s;
  const apply = o => {
    if (o.fill) doc.setFillColor(...rgb(o.fill));
    if (o.stroke) { doc.setDrawColor(...rgb(o.stroke)); doc.setLineWidth(Math.max(0.1, (o.lw || 1) * s)); }
    doc.setLineDashPattern(o.dash && o.stroke ? o.dash.map(d => d * s) : [], 0);
    return o.fill && o.stroke ? 'FD' : o.fill ? 'F' : 'S';
  };
  const done = () => doc.setLineDashPattern([], 0);
  return {
    circle(x, y, r, o) { if (!o.fill && !o.stroke) return; doc.circle(X(x), Y(y), r * s, apply(o)); done(); },
    poly(pts, o) {
      if (pts.length < 2 || (!o.fill && !o.stroke)) return;
      const st = apply(o);
      const deltas = pts.slice(1).map((p, i) => [(p[0] - pts[i][0]) * s, (p[1] - pts[i][1]) * s]);
      doc.lines(deltas, X(pts[0][0]), Y(pts[0][1]), [1, 1], o.close === false ? 'S' : st, o.close !== false);
      done();
    },
    text(x, y, str, o) {
      doc.setFont('helvetica', o.bold ? 'bold' : 'normal');
      doc.setFontSize(o.size * s / 0.3528);
      doc.setTextColor(...rgb(o.color));
      doc.text(String(str), X(x), Y(y), { align: o.align || 'center', baseline: 'middle' });
    },
    raw() {},
  };
}

const rectPts = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

// 45° hatching inside a rectangle, as line segments.
function hatchSegments(x0, y0, w, h, gap) {
  const x1 = x0 + w, y1 = y0 + h, segs = [];
  for (let c = x0 + y0 + gap; c < x1 + y1; c += gap) {
    const a = Math.max(x0, c - y1), b = Math.min(x1, c - y0);
    if (b > a) segs.push([[a, c - a], [b, c - b]]);
  }
  return segs;
}

// One symbol centred on x, y. it carries n for a station; status colours a
// station on a visit's plan.
function drawPlanSymbol(P, k, x, y, it = {}, status) {
  const I = PLAN_INK;
  if (SITE_PLAN_STATIONS.includes(k)) {
    const s = sitePlanStatusStyle(status);
    const o = { fill: s ? s.fill : I.paper, stroke: s ? s.stroke : I.blue, lw: 4, dash: s && s.dash };
    const R = 24;
    if (k === 'inground') P.circle(x, y, R, o);
    else if (k === 'above') P.poly(rectPts(x - R + 2, y - R + 2, 2 * R - 4, 2 * R - 4), o);
    else P.poly([[x, y - R - 5], [x + R + 5, y], [x, y + R + 5], [x - R - 5, y]], o);
    if (it.n != null) P.text(x, y + 1, it.n, { size: it.n >= 10 ? 20 : 24, bold: true, color: s ? s.text : I.blueDark });
    return;
  }
  switch (k) {
    case 'activity':
      P.poly([[x, y - 26], [x + 26, y + 20], [x - 26, y + 20]], { fill: I.red, stroke: I.redDark, lw: 2 });
      P.text(x, y + 5, '!', { size: 26, bold: true, color: '#FFFFFF' });
      break;
    case 'treated':
      P.circle(x, y, 15, { fill: I.blue, stroke: I.blueDark, lw: 2 });
      P.poly([[x - 7, y], [x + 7, y]], { stroke: '#FFFFFF', lw: 4, close: false });
      P.poly([[x, y - 7], [x, y + 7]], { stroke: '#FFFFFF', lw: 4, close: false });
      break;
    case 'moisture': {
      // A drop: a point on top, round below.
      const pts = [[x, y - 26]];
      for (let a = -30; a <= 210; a += 15) { const r = a * Math.PI / 180; pts.push([x + 15 * Math.cos(r), y + 6 + 15 * Math.sin(r)]); }
      P.poly(pts, { fill: I.amber, stroke: I.orangeDark, lw: 2 });
      break;
    }
    case 'access':
      P.poly(rectPts(x - 20, y - 20, 40, 40), { fill: I.paper, stroke: I.ink, lw: 3 });
      P.poly([[x - 20, y - 20], [x + 20, y + 20]], { stroke: I.ink, lw: 2.5, close: false });
      P.poly([[x + 20, y - 20], [x - 20, y + 20]], { stroke: I.ink, lw: 2.5, close: false });
      break;
    case 'notice':
      P.poly(rectPts(x - 22, y - 16, 44, 32), { fill: I.pink, stroke: '#C2185B', lw: 2 });
      P.text(x, y + 1, 'N', { size: 22, bold: true, color: '#FFFFFF' });
      break;
    case 'tree': {
      const pts = [];
      for (let a = 0; a < 360; a += 30) { const r = a * Math.PI / 180, rr = a % 60 ? 18 : 24; pts.push([x + rr * Math.cos(r), y + rr * Math.sin(r)]); }
      P.poly(pts, { fill: '#E7EFE5', stroke: I.tree, lw: 2.5 });
      P.circle(x, y, 4, { fill: I.tree });
      break;
    }
    case 'tank':
      P.circle(x, y, 22, { fill: '#D7ECFB', stroke: '#2D7DD2', lw: 3 });
      P.circle(x, y, 13, { stroke: '#2D7DD2', lw: 1.5 });
      break;
    case 'hws':
      P.poly(rectPts(x - 19, y - 19, 38, 38), { fill: I.paper, stroke: I.ink, lw: 2.5 });
      P.text(x, y + 1, 'HW', { size: 16, bold: true, color: I.ink });
      break;
    case 'ac':
      P.poly(rectPts(x - 21, y - 16, 42, 32), { fill: I.paper, stroke: I.ink, lw: 2.5 });
      P.circle(x, y, 10, { stroke: I.ink, lw: 2 });
      P.poly([[x - 7, y - 7], [x + 7, y + 7]], { stroke: I.ink, lw: 1.5, close: false });
      P.poly([[x + 7, y - 7], [x - 7, y + 7]], { stroke: I.ink, lw: 1.5, close: false });
      break;
    case 'downpipe':
      P.circle(x, y, 11, { fill: I.muted, stroke: I.ink, lw: 2 });
      P.circle(x, y, 4, { fill: I.paper });
      break;
    case 'tap':
      P.circle(x, y + 4, 10, { fill: I.paper, stroke: '#2D7DD2', lw: 3 });
      P.poly([[x - 11, y - 12], [x + 11, y - 12]], { stroke: '#2D7DD2', lw: 4, close: false });
      P.poly([[x, y - 12], [x, y - 6]], { stroke: '#2D7DD2', lw: 3, close: false });
      break;
    case 'meter':
      P.poly(rectPts(x - 18, y - 22, 36, 44), { fill: I.paper, stroke: I.ink, lw: 2.5 });
      P.text(x, y + 1, 'M', { size: 20, bold: true, color: I.ink });
      break;
    case 'timber':
      [-12, 0, 12].forEach(dy => P.poly(rectPts(x - 22, y + dy - 5, 44, 10), { fill: '#FCE7C4', stroke: I.orangeDark, lw: 2 }));
      break;
    case 'bridge':
      P.poly([[x, y - 24], [x + 24, y], [x, y + 24], [x - 24, y]], { fill: I.amber, stroke: I.orangeDark, lw: 2 });
      P.text(x, y + 1, 'B', { size: 20, bold: true, color: '#FFFFFF' });
      break;
    case 'pier':
      P.poly(rectPts(x - 8, y - 8, 16, 16), { fill: '#3D5166', stroke: I.ink, lw: 1.5 });
      break;
    case 'vent':
      P.poly(rectPts(x - 19, y - 10, 38, 20), { fill: I.paper, stroke: I.ink, lw: 2.5 });
      [-9, 0, 9].forEach(dx => P.poly([[x + dx, y - 6], [x + dx, y + 6]], { stroke: I.ink, lw: 2, close: false }));
      break;
    case 'damage':
      P.poly(rectPts(x - 18, y - 18, 36, 36), { fill: I.red, stroke: I.redDark, lw: 2 });
      P.text(x, y + 1, 'D', { size: 22, bold: true, color: '#FFFFFF' });
      break;
    case 'decay':
      P.circle(x, y, 19, { fill: '#8B5A2B', stroke: '#5C3B1C', lw: 2 });
      P.text(x, y + 1, 'R', { size: 21, bold: true, color: '#FFFFFF' });
      break;
    case 'antcap':
      P.poly(rectPts(x - 8, y - 2, 16, 20), { fill: '#3D5166', stroke: I.ink, lw: 1.5 });
      P.poly([[x - 22, y - 4], [x + 22, y - 4], [x + 13, y - 17], [x - 13, y - 17]], { fill: I.amber, stroke: I.orangeDark, lw: 2 });
      break;
    case 'text':
      P.text(x, y, it.label || 'Label', { size: 22, bold: true, color: I.ink, halo: true });
      break;
  }
}

function planRectStyle(k) {
  const I = PLAN_INK;
  return k === 'house' || k === 'outline' ? { fill: I.building, stroke: I.ink, lw: 5 }
    : k === 'shed' ? { fill: I.shed, stroke: I.muted, lw: 3.5 }
    : k === 'deck' ? { fill: I.paper, stroke: I.muted, lw: 2.5, dash: [10, 6], hatch: '#C8D5E3' }
    : k === 'garden' ? { fill: '#EEF6EA', stroke: I.tree, lw: 2.5, hatch: '#BFD8B5', cross: false }
    : k === 'paving' ? { fill: '#F3F5F7', stroke: '#8899AA', lw: 2, hatch: '#D5DDE5', cross: true }
    : k === 'driveway' ? { fill: '#E6EAF0', stroke: '#8899AA', lw: 2 }
    : k === 'pool' ? { fill: '#D7ECFB', stroke: '#2D7DD2', lw: 3 }
    : k === 'subfloor' || k === 'subfloorShape' ? { fill: '#F7F1E6', stroke: '#A58A5A', lw: 3 }
    : k === 'slab' ? { fill: '#E9EDF2', stroke: '#8899AA', lw: 2.5, hatch: '#CFD8E1', cross: true }
    : k === 'clearance' ? { fill: I.amberWash, stroke: I.amber, lw: 2.5, dash: [8, 6], hatch: '#F2D59A' }
    : k === 'subtreated' ? { fill: '#EAF0FF', stroke: I.blue, lw: 2.5, dash: [8, 6], hatch: '#B9CBFF' }
    : { fill: '#F5F7FA', stroke: I.muted, lw: 2.5, dash: [5, 6], hatch: '#AAB7C4' };
}

function planLineStyle(k) {
  const I = PLAN_INK;
  return k === 'barrier' ? { stroke: I.blue, lw: 9 }
    : k === 'untreated' ? { stroke: I.muted, lw: 6, dash: [14, 10] }
    : k === 'retaining' ? { stroke: I.ink, lw: 6, ticks: true }
    : k === 'pierrow' ? { stroke: '#AAB7C4', lw: 2, dash: [6, 8], piers: true }
    : k === 'dwarf' ? { stroke: I.muted, lw: 12, inner: '#FFFFFF' }
    : { stroke: I.muted, lw: 2.5, dash: [18, 6, 3, 6] };
}

function drawPlanRect(P, k, x, y, w, h, label, size) {
  const o = planRectStyle(k);
  P.poly(rectPts(x, y, w, h), { fill: o.fill });
  if (o.hatch) hatchSegments(x, y, w, h, 18).forEach(seg => P.poly(seg, { stroke: o.hatch, lw: 1.5, close: false }));
  if (o.cross) hatchSegments(-x - w, y, w, h, 18).forEach(seg => P.poly(seg.map(q => [-q[0], q[1]]), { stroke: o.hatch, lw: 1.5, close: false }));
  P.poly(rectPts(x, y, w, h), { stroke: o.stroke, lw: o.lw, dash: o.dash });
  if (label) P.text(x + w / 2, y + h / 2 - (size ? 12 : 0), label, { size: k === 'house' ? 24 : 19, bold: k === 'house', color: k === 'house' ? PLAN_INK.ink : PLAN_INK.muted, halo: !!o.hatch });
  if (size) P.text(x + w / 2, y + h / 2 + (label ? 14 : 0), size, { size: 16, color: PLAN_INK.muted, halo: !!o.hatch });
}

// A building of any shape, with each wall's length once there's a scale.
function drawPlanArea(P, k, pts, label, mpu) {
  const o = planRectStyle(k);
  if (pts.length < 3) { P.poly(pts, { stroke: o.stroke, lw: o.lw, close: false }); return; }
  P.poly(pts, { fill: o.fill, stroke: o.stroke, lw: o.lw });
  // The label goes on the shape's true centre (its centroid), sized to fit.
  let A = 0, cx = 0, cy = 0;
  pts.forEach((a, i) => { const b = pts[(i + 1) % pts.length], f = a[0] * b[1] - b[0] * a[1]; A += f; cx += (a[0] + b[0]) * f; cy += (a[1] + b[1]) * f; });
  if (Math.abs(A) > 1) { cx /= 3 * A; cy /= 3 * A; } else { cx = pts[0][0]; cy = pts[0][1]; }
  const xs = pts.map(q => q[0]);
  const fit = (Math.max(...xs) - Math.min(...xs)) / Math.max(1, String(label || '').length * 0.62);
  if (label) P.text(cx, cy, label, { size: Math.max(14, Math.min(24, fit)), bold: true, color: PLAN_INK.ink, halo: true });
  if (!mpu) return;
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 60) return;
    // Outside the wall: away from the middle of the shape.
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    let nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
    if ((mx + nx - cx) ** 2 + (my + ny - cy) ** 2 < (mx - cx) ** 2 + (my - cy) ** 2) { nx = -nx; ny = -ny; }
    P.text(mx + nx * 22, my + ny * 22, formatPlanMetres(L * mpu), { size: 15, color: PLAN_INK.muted, halo: true });
  });
}

function drawPlanLine(P, k, pts, mpu) {
  if (pts.length < 2) return;
  const o = planLineStyle(k);
  P.poly(pts, Object.assign({ close: false }, o));
  // A brick dwarf wall reads as a double line.
  if (o.inner) P.poly(pts, { stroke: o.inner, lw: 4, close: false });
  if (o.piers) pierRowPoints(pts, mpu).forEach(q => drawPlanSymbol(P, 'pier', q[0], q[1]));
  // A retaining wall carries ticks on its low side.
  if (o.ticks) pts.forEach((a, i) => {
    if (!i) return;
    const b = pts[i - 1], L = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
    const ux = (a[0] - b[0]) / L, uy = (a[1] - b[1]) / L;
    for (let d = 10; d < L; d += 22) P.poly([[b[0] + ux * d, b[1] + uy * d], [b[0] + ux * d - uy * 12, b[1] + uy * d + ux * 12]], { stroke: o.stroke, lw: 3, close: false });
  });
}

// A scale bar, bottom right, once the plan has a scale.
function drawPlanScaleBar(P, mpu) {
  if (!mpu) return;
  const nice = [1, 2, 5, 10, 20, 50, 100].find(m => m / mpu >= 90) || 100;
  const L = nice / mpu, x1 = PLAN_W - 30, x0 = x1 - L, yb = PLAN_H - 28;
  P.poly(rectPts(x0, yb - 6, L, 12), { fill: PLAN_INK.paper, stroke: PLAN_INK.ink, lw: 2 });
  P.poly(rectPts(x0, yb - 6, L / 2, 12), { fill: PLAN_INK.ink });
  P.text(x0 + L / 2, yb - 22, `${nice} m`, { size: 17, bold: true, color: PLAN_INK.ink, halo: true });
}

// The north arrow, top right. north counts 45° steps clockwise.
function drawPlanNorth(P, north) {
  const cx = 945, cy = 70, a = (north || 0) * Math.PI / 4;
  const rot = (dx, dy) => [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
  P.circle(cx, cy, 34, { fill: PLAN_INK.paper, stroke: PLAN_INK.faint, lw: 2 });
  P.poly([rot(0, -26), rot(11, 12), rot(0, 5), rot(-11, 12)], { fill: PLAN_INK.ink });
  const t = rot(0, -44);
  P.text(t[0], t[1], 'N', { size: 20, bold: true, color: PLAN_INK.ink, halo: true });
}

// The whole plan. opts.statuses maps a station number to what a visit found.
// opts.layer 'sub' draws the subfloor plan: the building's walls from the
// site plan in grey, with the subfloor items under and over them.
function drawSitePlan(P, plan, opts = {}) {
  const layer = opts.layer || 'site';
  const items = planLayerItems(plan, layer).slice()
    .sort((a, b) => ((SITE_PLAN_SYMBOLS[a.k] || {}).z || 0) - ((SITE_PLAN_SYMBOLS[b.k] || {}).z || 0));
  let walls = layer !== 'sub';
  const drawWalls = () => {
    walls = true;
    planLayerItems(plan, 'site').filter(it => ['house', 'outline', 'shed', 'deck'].includes(it.k)).forEach(it => {
      const pts = it.pts || rectPts(it.x, it.y, it.w, it.h);
      if (pts.length < 3) return;
      P.poly(pts, { stroke: '#8899AA', lw: it.k === 'deck' ? 2 : 4, dash: it.k === 'deck' ? [10, 6] : null });
      const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
      if (it.label) P.text(Math.min(...xs) + 4, Math.min(...ys) - 14, it.label, { size: 15, color: '#8899AA', align: 'left', halo: true });
    });
  };
  items.forEach(it => {
    const sym = SITE_PLAN_SYMBOLS[it.k];
    if (!sym) return;
    if (!walls && (sym.z || 0) >= 2) drawWalls();
    const mpu = plan.mpu;
    if (sym.kind === 'rect') drawPlanRect(P, it.k, it.x, it.y, it.w, it.h, it.label, mpu && sym.size ? `${formatPlanMetres(it.w * mpu).replace(' m', '')} × ${formatPlanMetres(it.h * mpu)}` : '');
    else if (sym.kind === 'area') drawPlanArea(P, it.k, it.pts || [], it.label, it.k === 'outline' ? mpu : 0);
    else if (sym.kind === 'line') {
      drawPlanLine(P, it.k, it.pts || [], plan.mpu);
      const len = mpu && sym.size && it.pts && it.pts.length > 1 ? formatPlanMetres(planPathLength(it.pts) * mpu) : '';
      const words = [it.label, len].filter(Boolean).join(' · ');
      if (words && it.pts && it.pts.length > 1) {
        // On the longest stretch, above the line.
        let best = 1;
        it.pts.forEach((q, i) => { if (i && Math.hypot(q[0] - it.pts[i - 1][0], q[1] - it.pts[i - 1][1]) > Math.hypot(it.pts[best][0] - it.pts[best - 1][0], it.pts[best][1] - it.pts[best - 1][1])) best = i; });
        const a = it.pts[best - 1], b = it.pts[best];
        // A third of the way along, as stations often sit mid-wall.
        P.text(a[0] + (b[0] - a[0]) * 0.33, a[1] + (b[1] - a[1]) * 0.33 - 20, words, { size: 18, color: it.k === 'barrier' ? PLAN_INK.blueDark : PLAN_INK.muted, bold: it.k === 'barrier', halo: true });
      }
    } else {
      drawPlanSymbol(P, it.k, it.x, it.y, it, opts.statuses && it.n != null ? opts.statuses[it.n] : null);
      // Points carry their label beside them; stations are listed by number.
      if (sym.kind === 'point' && it.label) {
        const left = it.x > PLAN_W - 220;
        P.text(it.x + (left ? -32 : 32), it.y, it.label, { size: 19, color: PLAN_INK.ink, align: left ? 'right' : 'left', halo: true });
      }
    }
  });
  if (!walls) drawWalls();
  drawPlanNorth(P, plan && plan.north);
  drawPlanScaleBar(P, plan && plan.mpu);
}

// The keys a plan needs in its legend, in the order of SITE_PLAN_SYMBOLS.
function sitePlanLegendKeys(plan, layer = 'site') {
  const used = new Set(planLayerItems(plan, layer).map(it => it.k));
  const words = new Set();
  // The subfloor's legend follows its tabs: structure, access, findings.
  const order = layer === 'sub' ? Object.values(SITE_PLAN_SUB_TRAY).flat() : Object.keys(SITE_PLAN_SYMBOLS);
  return order.filter(k => {
    const w = SITE_PLAN_SYMBOLS[k].legend;
    if (!used.has(k) || !w || words.has(w)) return false;
    words.add(w); return true;
  });
}

// A legend entry's swatch, centred on x, y.
function drawPlanSwatch(P, k, x, y) {
  const sym = SITE_PLAN_SYMBOLS[k];
  if (sym.kind === 'rect') drawPlanRect(P, k, x - 34, y - 22, 68, 44, '');
  else if (sym.kind === 'area') drawPlanArea(P, k, [[x - 34, y - 22], [x + 10, y - 22], [x + 10, y - 4], [x + 34, y - 4], [x + 34, y + 22], [x - 34, y + 22]], '');
  else if (sym.kind === 'line') drawPlanLine(P, k, [[x - 36, y], [x + 36, y]], k === 'pierrow' ? 0.025 : 0);
  else drawPlanSymbol(P, k, x, y, SITE_PLAN_STATIONS.includes(k) ? { n: '' } : {});
}

function sitePlanSVG(plan, opts = {}) {
  const P = svgPainter();
  if (plan && plan.bg && opts.layer !== 'sub') P.raw(`<image href="${escapeHtml(plan.bg)}" x="0" y="0" width="${PLAN_W}" height="${PLAN_H}" preserveAspectRatio="none"/>`);
  if (opts.grid) {
    for (let x = 50; x < PLAN_W; x += 50) P.raw(`<line x1="${x}" y1="0" x2="${x}" y2="${PLAN_H}" stroke="${x % 250 ? '#EEF2F7' : '#DCE4EE'}" stroke-width="1.5"/>`);
    for (let y = 50; y < PLAN_H; y += 50) P.raw(`<line x1="0" y1="${y}" x2="${PLAN_W}" y2="${y}" stroke="${y % 250 ? '#EEF2F7' : '#DCE4EE'}" stroke-width="1.5"/>`);
  }
  drawSitePlan(P, plan, opts);
  if (opts.after) opts.after(P);
  return `<svg class="${opts.cls || 'site-plan-svg'}" viewBox="${opts.viewBox || `0 0 ${PLAN_W} ${PLAN_H}`}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Site plan">${P.out.join('')}</svg>`;
}

// The legend as HTML, with each swatch drawn by the same code as the plan.
function sitePlanLegendHTML(plan, opts = {}) {
  const swatch = draw => { const P = svgPainter(); draw(P); return `<svg viewBox="-42 -30 84 60" aria-hidden="true">${P.out.join('')}</svg>`; };
  const count = k => planLayerItems(plan, opts.layer).filter(it => it.k === k).length;
  // opts.stationsOnly keeps just the station symbols, for the small bait card.
  const rows = sitePlanLegendKeys(plan, opts.layer).filter(k => !opts.stationsOnly || SITE_PLAN_STATIONS.includes(k)).map(k => `<li>${swatch(P => drawPlanSwatch(P, k, 0, 0))}<span>${escapeHtml(SITE_PLAN_SYMBOLS[k].legend)}${SITE_PLAN_STATIONS.includes(k) ? ` (${count(k)})` : ''}</span></li>`);
  if (opts.layer === 'sub' && rows.length) rows.unshift(`<li>${swatch(P => P.poly([[-36, 0], [36, 0]], { stroke: '#8899AA', lw: 4, close: false }))}<span>Walls of the building above</span></li>`);
  if (opts.statuses) {
    const seen = new Set(Object.values(opts.statuses).map(s => s && (SITE_PLAN_STATUS[s] ? s : 'problem')));
    Object.entries(SITE_PLAN_STATUS).filter(([key]) => seen.has(key)).forEach(([key, s]) => {
      rows.push(`<li>${swatch(P => P.circle(0, 0, 20, { fill: s.fill, stroke: s.stroke, lw: 4, dash: s.dash }))}<span>${escapeHtml(s.legend)}</span></li>`);
    });
  }
  return rows.length ? `<ul class="site-plan-legend">${rows.join('')}</ul>` : '';
}

// ── ON A PDF ── The plan gets a page of its own at the end of the
// certificate or visit report: the plan across the page, the legend under it
// in columns, then where each station is.

// The plan in a box at x, y, w wide (4:3). Returns its height in mm.
function drawSitePlanPdf(doc, plan, { x, y, w, statuses, layer } = {}) {
  const C = PDF_COLORS;
  const h = w * PLAN_H / PLAN_W;
  doc.setFillColor(255, 255, 255); doc.rect(x, y, w, h, 'F');
  if (plan && plan.bg && layer !== 'sub') { try { doc.addImage(plan.bg, 'JPEG', x, y, w, h); } catch (e) {} }
  drawSitePlan(pdfPainter(doc, x, y, w / PLAN_W), plan, { statuses, layer });
  doc.setLineDashPattern([], 0);
  doc.setDrawColor(...C.rule); doc.setLineWidth(0.3); doc.rect(x, y, w, h);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...C.inkMuted);
  doc.text(plan && plan.mpu ? 'Approximate scale' : 'Not to scale', x + 2.5, y + h - 2.5);
  return h;
}

// The legend at x, y, w wide, in columns: each symbol used, then the
// station colours when a visit's statuses are given. Returns its height.
function drawSitePlanLegendPdf(doc, plan, { x, y, w, cols = 3, statuses, layer } = {}) {
  const C = PDF_COLORS;
  const count = k => planLayerItems(plan, layer).filter(it => it.k === k).length;
  const block = (title, rows, top) => {
    if (!rows.length) return 0;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...C.inkMuted);
    pdfTracked(doc, title, x, top + 2, { cs: 0.5 });
    const colW = (w - (cols - 1) * 5) / cols, perCol = Math.ceil(rows.length / cols), RH = 6.6;
    rows.forEach(([draw, words], i) => {
      const cx = x + Math.floor(i / perCol) * (colW + 5), cy = top + 8.5 + (i % perCol) * RH;
      draw(pdfPainter(doc, cx + 4.6, cy, 0.11));
      doc.setLineDashPattern([], 0);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6); doc.setTextColor(...C.ink);
      doc.text(doc.splitTextToSize(words, colW - 12)[0], cx + 11, cy, { baseline: 'middle' });
    });
    return 6 + perCol * RH;
  };
  const rows = sitePlanLegendKeys(plan, layer).map(k => [P => drawPlanSwatch(P, k, 0, 0),
    SITE_PLAN_SYMBOLS[k].legend + (SITE_PLAN_STATIONS.includes(k) ? ` (${count(k)})` : '')]);
  if (layer === 'sub') rows.unshift([P => P.poly([[-36, 0], [36, 0]], { stroke: '#8899AA', lw: 4, close: false }), 'Walls of the building above']);
  let h = block('LEGEND', rows, y);
  if (statuses) {
    const seen = new Set(Object.values(statuses).map(st => st && (SITE_PLAN_STATUS[st] ? st : 'problem')));
    const rows = Object.entries(SITE_PLAN_STATUS).filter(([key]) => seen.has(key))
      .map(([, st]) => [P => P.circle(0, 0, 20, { fill: st.fill, stroke: st.stroke, lw: 4, dash: st.dash }), st.legend]);
    if (rows.length) h += 3 + block('STATIONS ON THIS VISIT', rows, y + h + 3);
  }
  return h;
}

// Where each station is, "1  Rear left corner", in columns under the plan.
// Returns the height used.
function drawSitePlanStationListPdf(doc, plan, { x, y, w, cols = 3 } = {}) {
  const C = PDF_COLORS;
  const list = sitePlanStations(plan).filter(s => (s.label || '').trim());
  if (!list.length) return 0;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...C.inkMuted);
  pdfTracked(doc, 'WHERE EACH STATION IS', x, y, { cs: 0.5 });
  const colW = (w - (cols - 1) * 4) / cols;
  const perCol = Math.ceil(list.length / cols);
  doc.setFontSize(7.5);
  list.forEach((s, i) => {
    const cx = x + Math.floor(i / perCol) * (colW + 4), cy = y + 4.5 + (i % perCol) * 3.8;
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.accentDark);
    doc.text(String(s.n), cx, cy);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.ink);
    const kind = s.k === 'above' ? ' (above-ground)' : s.k === 'monitor' ? ' (monitoring)' : '';
    doc.text(doc.splitTextToSize(s.label.trim() + kind, colW - 6)[0], cx + 5, cy);
  });
  return 4.5 + perCol * 3.8;
}

// ── THE EDITOR ──
// A full-screen sheet with the plan, a tray of symbols by group, and a bar
// for the selected item (its label, delete). Opened from the treatment
// record; Save hands the plan back through sitePlanEditor.onSave.
const sitePlanEditor = { plan: null, layer: 'site', tool: null, group: 'build', sel: null, drawing: null, drag: null, undo: [], onSave: null, zoom: 1, cx: PLAN_W / 2, cy: PLAN_H / 2 };

function newSitePlan() {
  const d = SITE_PLAN_SYMBOLS.house.def;
  return { v: 1, north: 0, items: [{ id: planId(), k: 'house', x: 300, y: 225, w: d.w, h: d.h, label: d.label }] };
}

function planId() { return 'p' + Math.random().toString(36).slice(2, 9); }

function openSitePlan(plan, onSave) {
  const E = sitePlanEditor;
  E.plan = sitePlanHasContent(plan) ? JSON.parse(JSON.stringify(plan)) : newSitePlan();
  if (E.plan.north == null) E.plan.north = 0;
  E.tool = null; E.sel = null; E.drawing = null; E.drag = null; E.undo = []; E.onSave = onSave;
  E.layer = 'site'; E.group = 'build'; E.zoom = 1; E.cx = PLAN_W / 2; E.cy = PLAN_H / 2;
  track('screen_viewed', { screen: 'site_plan' });
  document.getElementById('sitePlanOverlay').classList.add('open');
  renderSitePlanTray();
  renderSitePlanEditor();
  const svgWrap = document.getElementById('spCanvas');
  if (!svgWrap.dataset.bound) {
    svgWrap.dataset.bound = '1';
    svgWrap.addEventListener('pointerdown', onSitePlanDown);
    svgWrap.addEventListener('pointermove', onSitePlanMove);
    svgWrap.addEventListener('pointerup', onSitePlanUp);
    svgWrap.addEventListener('pointercancel', onSitePlanUp);
  }
}

function closeSitePlan() {
  document.getElementById('sitePlanOverlay').classList.remove('open');
}

function saveSitePlan() {
  const E = sitePlanEditor;
  finishSitePlanLine();
  // A line of one point says nothing; drop it.
  E.plan.items = E.plan.items.filter(it => {
    const kind = SITE_PLAN_SYMBOLS[it.k].kind;
    return kind === 'line' ? (it.pts || []).length > 1 : kind === 'area' ? (it.pts || []).length > 2 : true;
  });
  closeSitePlan();
  if (E.onSave) E.onSave(JSON.parse(JSON.stringify(E.plan)));
  track('site_plan_saved', { items: E.plan.items.length, stations: sitePlanStations(E.plan).length });
}

function pushSitePlanUndo() {
  const E = sitePlanEditor;
  E.undo.push(JSON.stringify(E.plan));
  if (E.undo.length > 40) E.undo.shift();
}

function undoSitePlan() {
  const E = sitePlanEditor;
  if (!E.undo.length) return;
  E.plan = JSON.parse(E.undo.pop());
  E.drawing = null;
  if (E.sel && !E.plan.items.some(it => it.id === E.sel)) E.sel = null;
  renderSitePlanEditor();
}

function setSitePlanGroup(g) {
  sitePlanEditor.group = g;
  renderSitePlanTray();
}

// Switch between the site plan and the subfloor plan. The first time, the
// subfloor starts as the house's footprint, to adjust or delete.
function setSitePlanLayer(layer) {
  const E = sitePlanEditor;
  finishSitePlanLine();
  if (E.layer === layer) return;
  E.layer = layer; E.tool = null; E.sel = null;
  E.group = SITE_PLAN_TRAYS[layer][0];
  if (layer === 'sub' && !sitePlanHasSubfloor(E.plan)) {
    pushSitePlanUndo();
    planLayerItems(E.plan, 'site').forEach(it => {
      if (it.k === 'house') E.plan.items.push({ id: planId(), k: 'subfloor', layer: 'sub', x: it.x, y: it.y, w: it.w, h: it.h, label: 'Subfloor' });
      if (it.k === 'outline' && (it.pts || []).length > 2) E.plan.items.push({ id: planId(), k: 'subfloorShape', layer: 'sub', pts: it.pts.map(q => q.slice()), label: 'Subfloor' });
    });
  }
  renderSitePlanTray();
  renderSitePlanEditor();
}

function setSitePlanTool(k) {
  const E = sitePlanEditor;
  finishSitePlanLine();
  E.tool = E.tool === k ? null : k;
  E.sel = null;
  renderSitePlanTray();
  renderSitePlanEditor();
}

function renderSitePlanTray() {
  const E = sitePlanEditor;
  document.querySelectorAll('#spViews .sp-view').forEach(b => { const on = b.dataset.layer === E.layer; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  document.getElementById('spGroups').innerHTML = SITE_PLAN_TRAYS[E.layer].map(g => [g, SITE_PLAN_GROUPS[g]]).map(([g, name]) =>
    `<button type="button" role="tab" aria-selected="${E.group === g}" class="sp-group${E.group === g ? ' on' : ''}" onclick="setSitePlanGroup('${g}')">${name}</button>`).join('');
  const swatch = k => { const P = svgPainter(); drawPlanSwatch(P, k, 0, 0); return `<svg viewBox="-42 -30 84 60" aria-hidden="true">${k === 'text' ? '<text x="0" y="2" font-size="30" font-weight="800" text-anchor="middle" dominant-baseline="central" fill="#0C121C">Aa</text>' : P.out.join('')}</svg>`; };
  const keys = E.layer === 'sub' ? SITE_PLAN_SUB_TRAY[E.group] || [] : Object.keys(SITE_PLAN_SYMBOLS).filter(k => SITE_PLAN_SYMBOLS[k].group === E.group);
  document.getElementById('spTools').innerHTML = keys.map(k => [k, SITE_PLAN_SYMBOLS[k]]).map(([k, s]) =>
    `<button type="button" class="sp-tool${E.tool === k ? ' on' : ''}" aria-pressed="${E.tool === k}" onclick="setSitePlanTool('${k}')">${swatch(k)}<span>${s.label}</span></button>`).join('');
}

function sitePlanHint() {
  const E = sitePlanEditor;
  if (E.drawing) {
    const area = SITE_PLAN_SYMBOLS[(E.plan.items.find(x => x.id === E.drawing) || {}).k || 'fence'].kind === 'area';
    return area ? 'Tap each corner of the building in turn. Tap the first corner again, or Finish shape, to close it.' : 'Tap each corner of the line. Tap Finish line when it\'s done.';
  }
  if (E.tool) {
    const s = SITE_PLAN_SYMBOLS[E.tool];
    return s.kind === 'rect' ? `Drag on the plan to draw the ${s.label.toLowerCase()}, or tap to drop one.`
      : s.kind === 'line' ? `Tap where the ${s.label.toLowerCase()} starts, then each corner.`
      : s.kind === 'area' ? 'Tap each corner of the building in turn, all the way round.'
      : s.kind === 'station' ? `Tap the plan to place each ${s.label.toLowerCase()} station. They number themselves.`
      : `Tap the plan to place it.`;
  }
  if (E.sel) return 'Drag to move it. Name it below, give its real size, or delete it.';
  if (E.zoom > 1) return 'Zoomed in: drag an empty spot to look around.';
  return E.layer === 'sub' ? 'The subfloor, under the house walls (grey). Mark the piers, vents, access and what you found.'
    : 'Pick a symbol below, then tap the plan. Tap something on the plan to move or name it.';
}

function renderSitePlanEditor() {
  const E = sitePlanEditor;
  const sel = E.plan.items.find(it => it.id === E.sel);
  const vb = sitePlanViewBox();
  document.getElementById('spCanvas').innerHTML = sitePlanSVG(E.plan, { grid: true, layer: E.layer, cls: 'site-plan-svg sp-edit', viewBox: vb.join(' '), after: P => {
    if (E.drawing) {
      const it = E.plan.items.find(x => x.id === E.drawing);
      if (it) it.pts.forEach((p, i) => P.circle(p[0], p[1], i ? 9 : 13, { fill: i ? PLAN_INK.paper : PLAN_INK.pink, stroke: PLAN_INK.pink, lw: 3 }));
    }
    if (!sel) return;
    const b = sitePlanBounds(sel);
    P.poly(rectPts(b.x - 10, b.y - 10, b.w + 20, b.h + 20), { stroke: PLAN_INK.pink, lw: 3, dash: [10, 7] });
    if (SITE_PLAN_SYMBOLS[sel.k].kind === 'rect') P.circle(sel.x + sel.w, sel.y + sel.h, 16, { fill: PLAN_INK.pink, stroke: PLAN_INK.paper, lw: 4 });
  } });
  document.getElementById('spHint').textContent = sitePlanHint();
  const fin = document.getElementById('spFinishLine');
  fin.hidden = !E.drawing;
  if (E.drawing) fin.textContent = SITE_PLAN_SYMBOLS[(E.plan.items.find(x => x.id === E.drawing) || {}).k || 'fence'].kind === 'area' ? 'Finish shape' : 'Finish line';
  document.getElementById('spZoomOut').disabled = E.zoom <= 1;
  document.getElementById('spZoomIn').disabled = E.zoom >= 3;
  document.getElementById('spBgRemove').hidden = !E.plan.bg;
  document.querySelector('#sitePlanOverlay .sp-bg').hidden = E.layer === 'sub';
  document.getElementById('spBgLabel').firstChild.textContent = E.plan.bg ? 'Change the photo underneath' : 'Trace over a map or photo';
  document.getElementById('spUndo').disabled = !E.undo.length;
  document.getElementById('spNorth').textContent = `North: ${['up', 'up-right', 'right', 'down-right', 'down', 'down-left', 'left', 'up-left'][E.plan.north || 0]}`;
  const bar = document.getElementById('spSelBar');
  bar.hidden = !sel;
  if (sel) {
    const sym = SITE_PLAN_SYMBOLS[sel.k];
    document.getElementById('spSelName').textContent = sym.kind === 'station' ? `Station ${sel.n} · ${sym.label}` : sym.label;
    const inp = document.getElementById('spSelLabel');
    inp.placeholder = sym.ph || 'Name it';
    if (document.activeElement !== inp) inp.value = sel.label || '';
    // The real size: one known measurement sets the scale for the whole plan.
    const units = sitePlanItemUnits(sel);
    const row = document.getElementById('spSelSizeRow');
    row.hidden = !units;
    if (units) {
      document.getElementById('spSelSizeLabel').textContent = sym.kind === 'rect' ? 'Real width' : sym.kind === 'area' ? 'Real length of the walls, all round' : 'Real length';
      const m = document.getElementById('spSelMetres');
      if (document.activeElement !== m) m.value = E.plan.mpu ? String(Math.round(units * E.plan.mpu * 10) / 10) : '';
    }
  }
  document.getElementById('spScaleNote').textContent = E.plan.mpu
    ? 'The plan has a scale. Lengths show on the barrier and walls, and the barrier\'s metres fill the record.'
    : 'Tip: tap the house, then type its real width, and the plan works out every length from it.';
  document.getElementById('spLegend').innerHTML = sitePlanLegendHTML(E.plan, { layer: E.layer });
  const sum = E.layer === 'sub' ? sitePlanSubSummary(E.plan) : sitePlanSummary(E.plan);
  document.getElementById('spSummary').textContent = sum ? `The ${E.layer === 'sub' ? 'subfloor plan' : 'plan'} shows ${sum}.` : '';
}

function sitePlanBounds(it) {
  const sym = SITE_PLAN_SYMBOLS[it.k];
  if (sym.kind === 'rect') return { x: it.x, y: it.y, w: it.w, h: it.h };
  if (sym.kind === 'line' || sym.kind === 'area') {
    const xs = it.pts.map(p => p[0]), ys = it.pts.map(p => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  const r = sym.kind === 'text' ? 0 : 26;
  const tw = sym.kind === 'text' ? Math.max(40, (it.label || 'Label').length * 12) : r;
  return { x: it.x - tw, y: it.y - (r || 14), w: tw * 2, h: (r || 14) * 2 };
}

// What part of the plan shows: all of it, or a zoomed-in window.
function sitePlanViewBox() {
  const E = sitePlanEditor, vw = PLAN_W / E.zoom, vh = PLAN_H / E.zoom;
  E.cx = planClamp(E.cx, vw / 2, PLAN_W - vw / 2); E.cy = planClamp(E.cy, vh / 2, PLAN_H - vh / 2);
  return [E.cx - vw / 2, E.cy - vh / 2, vw, vh];
}

function zoomSitePlan(step) {
  const E = sitePlanEditor;
  E.zoom = planClamp(E.zoom + step, 1, 3);
  // Zoom in on what's selected.
  const sel = E.plan.items.find(it => it.id === E.sel);
  if (sel && step > 0) { const b = sitePlanBounds(sel); E.cx = b.x + b.w / 2; E.cy = b.y + b.h / 2; }
  renderSitePlanEditor();
}

// How long the item is in plan units, for giving its real size: a
// building's width, a line's length, a shape's walls all round.
function sitePlanItemUnits(it) {
  const sym = SITE_PLAN_SYMBOLS[it.k];
  if (sym.kind === 'rect') return it.w;
  if (sym.kind === 'line') return (it.pts || []).length > 1 ? planPathLength(it.pts) : 0;
  if (sym.kind === 'area') return (it.pts || []).length > 2 ? planPathLength(it.pts, true) : 0;
  return 0;
}

function onSitePlanMetres(inp) {
  const E = sitePlanEditor;
  const it = E.plan.items.find(x => x.id === E.sel);
  const m = parseFloat(String(inp.value).replace(',', '.'));
  const units = it ? sitePlanItemUnits(it) : 0;
  if (!units) return;
  if (!inp.dataset.undo) { pushSitePlanUndo(); inp.dataset.undo = '1'; }
  if (m > 0 && m < 2000) E.plan.mpu = m / units;
  else if (!String(inp.value).trim()) delete E.plan.mpu;
  renderSitePlanEditor();
}

// A map screenshot or photo of the site goes underneath, faded so the
// symbols stay clear, and cropped to the plan's shape.
function loadSitePlanBackground(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = PLAN_W; c.height = PLAN_H;
      const ctx = c.getContext('2d');
      const sc = Math.max(PLAN_W / img.naturalWidth, PLAN_H / img.naturalHeight);
      const w = img.naturalWidth * sc, h = img.naturalHeight * sc;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, PLAN_W, PLAN_H);
      ctx.drawImage(img, (PLAN_W - w) / 2, (PLAN_H - h) / 2, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillRect(0, 0, PLAN_W, PLAN_H);
      let url = c.toDataURL('image/jpeg', 0.6);
      if (url.length > 260000) url = c.toDataURL('image/jpeg', 0.4);
      pushSitePlanUndo();
      sitePlanEditor.plan.bg = url;
      renderSitePlanEditor();
    };
    img.onerror = () => showToast('Could not open that picture', 'error');
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function removeSitePlanBackground() {
  pushSitePlanUndo();
  delete sitePlanEditor.plan.bg;
  renderSitePlanEditor();
}

function sitePlanPoint(e) {
  const r = document.querySelector('#spCanvas svg').getBoundingClientRect();
  const [vx, vy, vw, vh] = sitePlanViewBox();
  return [vx + (e.clientX - r.left) / r.width * vw, vy + (e.clientY - r.top) / r.height * vh];
}

const planSnap = (v, g = PLAN_GRID) => Math.round(v / g) * g;
const planClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// The topmost item under a point, stations first.
function sitePlanHit(p) {
  const E = sitePlanEditor;
  const items = planLayerItems(E.plan, E.layer).slice().sort((a, b) => (SITE_PLAN_SYMBOLS[b.k].z || 0) - (SITE_PLAN_SYMBOLS[a.k].z || 0));
  const segDist = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1;
    const t = planClamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L, 0, 1);
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  return items.find(it => {
    const kind = SITE_PLAN_SYMBOLS[it.k].kind;
    if (kind === 'rect') return p[0] >= it.x && p[0] <= it.x + it.w && p[1] >= it.y && p[1] <= it.y + it.h;
    if (kind === 'line') return it.pts.some((a, i) => i && segDist(p, it.pts[i - 1], a) < 24);
    if (kind === 'area') {
      // Inside the shape (ray casting), or on one of its walls.
      let inside = false;
      for (let i = 0, j = it.pts.length - 1; i < it.pts.length; j = i++) {
        const [xi, yi] = it.pts[i], [xj, yj] = it.pts[j];
        if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) inside = !inside;
      }
      return inside || it.pts.some((a, i) => segDist(p, it.pts[(i || it.pts.length) - 1], a) < 20);
    }
    if (kind === 'text') { const b = sitePlanBounds(it); return p[0] >= b.x && p[0] <= b.x + b.w && Math.abs(p[1] - it.y) < 26; }
    return Math.hypot(p[0] - it.x, p[1] - it.y) < 38;
  }) || null;
}

function onSitePlanDown(e) {
  const E = sitePlanEditor;
  if (!e.isPrimary) return;
  e.preventDefault();
  const p = sitePlanPoint(e);
  const tool = E.tool, sym = tool && SITE_PLAN_SYMBOLS[tool];
  const pt = [planClamp(planSnap(p[0], PLAN_GRID / 2), 10, PLAN_W - 10), planClamp(planSnap(p[1], PLAN_GRID / 2), 10, PLAN_H - 10)];
  e.currentTarget.setPointerCapture(e.pointerId);
  if (sym && (sym.kind === 'line' || sym.kind === 'area')) {
    const gp = [planSnap(p[0]), planSnap(p[1])].map((v, i) => planClamp(v, 0, i ? PLAN_H : PLAN_W));
    let it = E.drawing && E.plan.items.find(x => x.id === E.drawing);
    if (it) {
      const last = it.pts[it.pts.length - 1];
      // Tapping the last corner again finishes the line; tapping the first
      // corner closes a shape.
      if (Math.hypot(last[0] - gp[0], last[1] - gp[1]) < 20) { finishSitePlanLine(); return; }
      if (sym.kind === 'area' && it.pts.length > 2 && Math.hypot(it.pts[0][0] - gp[0], it.pts[0][1] - gp[1]) < 30) { finishSitePlanLine(); return; }
      pushSitePlanUndo(); it.pts.push(gp);
    } else {
      pushSitePlanUndo();
      it = { id: planId(), k: tool, pts: [gp] };
      if (sym.kind === 'area') it.label = tool === 'subfloorShape' ? 'Subfloor' : 'House';
      if (E.layer === 'sub') it.layer = 'sub';
      E.plan.items.push(it); E.drawing = it.id;
    }
    renderSitePlanEditor();
    return;
  }
  if (sym && sym.kind === 'rect') {
    pushSitePlanUndo();
    const gp = [planSnap(p[0]), planSnap(p[1])];
    const it = { id: planId(), k: tool, x: gp[0], y: gp[1], w: 0, h: 0, label: sym.def.label };
    if (E.layer === 'sub') it.layer = 'sub';
    E.plan.items.push(it);
    E.drag = { mode: 'newrect', id: it.id, from: gp, moved: false };
    E.sel = it.id;
    return;
  }
  if (sym) {
    pushSitePlanUndo();
    const it = { id: planId(), k: tool, x: pt[0], y: pt[1] };
    if (E.layer === 'sub') it.layer = 'sub';
    if (sym.kind === 'station') it.n = sitePlanStations(E.plan).reduce((m, s) => Math.max(m, s.n || 0), 0) + 1;
    if (sym.kind === 'text') it.label = '';
    E.plan.items.push(it);
    E.sel = it.id;
    // Stations keep the tool, so a run of them goes in tap after tap.
    if (sym.kind !== 'station') E.tool = null;
    E.drag = { mode: 'move', id: it.id, start: p, orig: JSON.parse(JSON.stringify(it)), moved: false, undoPushed: true };
    renderSitePlanTray(); renderSitePlanEditor();
    if (sym.kind === 'text') setTimeout(() => document.getElementById('spSelLabel').focus(), 50);
    return;
  }
  // No tool: pick up what's under the finger, or the selected building's corner handle.
  const sel = E.plan.items.find(it => it.id === E.sel);
  if (sel && SITE_PLAN_SYMBOLS[sel.k].kind === 'rect' && Math.hypot(p[0] - sel.x - sel.w, p[1] - sel.y - sel.h) < 34) {
    E.drag = { mode: 'resize', id: sel.id, moved: false, before: JSON.stringify(E.plan) };
    return;
  }
  const hit = sitePlanHit(p);
  E.sel = hit ? hit.id : null;
  E.drag = hit ? { mode: 'move', id: hit.id, start: p, orig: JSON.parse(JSON.stringify(hit)), moved: false, before: JSON.stringify(E.plan) }
    : E.zoom > 1 ? { mode: 'pan', sx: e.clientX, sy: e.clientY, cx: E.cx, cy: E.cy } : null;
  renderSitePlanEditor();
}

function onSitePlanMove(e) {
  const E = sitePlanEditor, d = E.drag;
  if (!d) return;
  e.preventDefault();
  if (d.mode === 'pan') {
    const r = document.querySelector('#spCanvas svg').getBoundingClientRect();
    E.cx = d.cx - (e.clientX - d.sx) / r.width * PLAN_W / E.zoom;
    E.cy = d.cy - (e.clientY - d.sy) / r.height * PLAN_H / E.zoom;
    renderSitePlanEditor();
    return;
  }
  const p = sitePlanPoint(e);
  const it = E.plan.items.find(x => x.id === d.id);
  if (!it) return;
  if (d.mode === 'newrect') {
    const gp = [planClamp(planSnap(p[0]), 0, PLAN_W), planClamp(planSnap(p[1]), 0, PLAN_H)];
    it.x = Math.min(d.from[0], gp[0]); it.y = Math.min(d.from[1], gp[1]);
    it.w = Math.abs(gp[0] - d.from[0]); it.h = Math.abs(gp[1] - d.from[1]);
    d.moved = true;
  } else if (d.mode === 'resize') {
    it.w = Math.max(PLAN_GRID * 2, planClamp(planSnap(p[0]), 0, PLAN_W) - it.x);
    it.h = Math.max(PLAN_GRID * 2, planClamp(planSnap(p[1]), 0, PLAN_H) - it.y);
    d.moved = true;
  } else {
    let dx = p[0] - d.start[0], dy = p[1] - d.start[1];
    if (!d.moved && Math.hypot(dx, dy) < 8) return;
    d.moved = true;
    const kind = SITE_PLAN_SYMBOLS[it.k].kind;
    if (kind === 'rect') {
      it.x = planClamp(planSnap(d.orig.x + dx), 0, PLAN_W - it.w);
      it.y = planClamp(planSnap(d.orig.y + dy), 0, PLAN_H - it.h);
    } else if (kind === 'line' || kind === 'area') {
      dx = planSnap(dx); dy = planSnap(dy);
      it.pts = d.orig.pts.map(q => [planClamp(q[0] + dx, 0, PLAN_W), planClamp(q[1] + dy, 0, PLAN_H)]);
    } else {
      it.x = planClamp(planSnap(d.orig.x + dx, PLAN_GRID / 2), 10, PLAN_W - 10);
      it.y = planClamp(planSnap(d.orig.y + dy, PLAN_GRID / 2), 10, PLAN_H - 10);
    }
  }
  renderSitePlanEditor();
}

function onSitePlanUp() {
  const E = sitePlanEditor, d = E.drag;
  if (!d) return;
  E.drag = null;
  const it = E.plan.items.find(x => x.id === d.id);
  if (d.mode === 'newrect' && it) {
    // A tap, or a sliver, drops the symbol at its usual size.
    if (it.w < PLAN_GRID * 2 || it.h < PLAN_GRID * 2) {
      const def = SITE_PLAN_SYMBOLS[it.k].def;
      it.w = def.w; it.h = def.h;
      it.x = planClamp(planSnap(d.from[0] - def.w / 2), 0, PLAN_W - def.w);
      it.y = planClamp(planSnap(d.from[1] - def.h / 2), 0, PLAN_H - def.h);
    }
    E.tool = null;
    renderSitePlanTray();
  }
  // A move only counts for undo once something moved.
  if (d.before && d.moved) { E.undo.push(d.before); if (E.undo.length > 40) E.undo.shift(); }
  renderSitePlanEditor();
}

function finishSitePlanLine() {
  const E = sitePlanEditor;
  if (!E.drawing) return;
  const it = E.plan.items.find(x => x.id === E.drawing);
  E.drawing = null;
  if (it && it.pts.length < (SITE_PLAN_SYMBOLS[it.k].kind === 'area' ? 3 : 2)) E.plan.items = E.plan.items.filter(x => x !== it);
  else if (it) E.sel = it.id;
  E.tool = null;
  renderSitePlanTray();
  renderSitePlanEditor();
}

function onSitePlanLabel(inp) {
  const E = sitePlanEditor;
  const it = E.plan.items.find(x => x.id === E.sel);
  if (!it) return;
  if (!inp.dataset.undo) { pushSitePlanUndo(); inp.dataset.undo = '1'; }
  it.label = inp.value;
  renderSitePlanEditor();
}

function deleteSitePlanItem() {
  const E = sitePlanEditor;
  if (!E.sel) return;
  pushSitePlanUndo();
  if (E.drawing === E.sel) E.drawing = null;
  E.plan.items = E.plan.items.filter(x => x.id !== E.sel);
  E.sel = null;
  renderSitePlanEditor();
}

function rotateSitePlanNorth() {
  const E = sitePlanEditor;
  pushSitePlanUndo();
  E.plan.north = ((E.plan.north || 0) + 1) % 8;
  renderSitePlanEditor();
}

function clearSitePlan() {
  const E = sitePlanEditor;
  const btn = document.getElementById('spClear');
  // Asks first, so a stray tap doesn't lose the plan.
  if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'Tap again to clear'; setTimeout(() => { delete btn.dataset.armed; btn.textContent = 'Start again'; }, 3000); return; }
  delete btn.dataset.armed; btn.textContent = 'Start again';
  pushSitePlanUndo();
  if (E.layer === 'sub') {
    // Only the subfloor goes; the site plan stays.
    E.plan.items = planLayerItems(E.plan, 'site');
  } else {
    const keep = { north: E.plan.north, items: [...newSitePlan().items, ...planLayerItems(E.plan, 'sub')] };
    if (E.plan.bg) keep.bg = E.plan.bg;
    E.plan = Object.assign(newSitePlan(), keep);
  }
  E.sel = null; E.drawing = null;
  renderSitePlanEditor();
}

// The label box starts a fresh undo step each time it gains focus.
function onSitePlanLabelFocus(inp) { delete inp.dataset.undo; }
