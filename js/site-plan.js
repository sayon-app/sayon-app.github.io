// ── SITE PLAN ───────────────────────────────────────────────────────────────
// A drawn plan of the site with a fixed set of symbols and a legend, so
// anyone reading the certificate (the client, an agent, a solicitor, the
// next technician) can see where the building, the treatment and each
// station are. It's kept with the treatment record as data, not a picture:
// q.treatment.plan = { v: 1, north: 0..7 (steps of 45°), items: [
//   { id, k: symbol key, x, y } for a point,
//   { ..., n } for a station (one number sequence across all station types),
//   { ..., w, h } for a building or an area (x, y its top-left corner),
//     with rot: degrees clockwise about its centre when it's turned,
//   { id, k, pts: [[x, y], ...] } for a line, or a closed shape (a building
//   of any shape, or a building or area reshaped corner by corner; rot is
//   then the angle it was turned to, which the editor keeps corners square
//   to),
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

// Turn points by deg (clockwise, as y runs down) about c.
function planRotatePts(pts, c, deg) {
  const a = deg * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
  return pts.map(q => [c[0] + (q[0] - c[0]) * cos - (q[1] - c[1]) * sin, c[1] + (q[0] - c[0]) * sin + (q[1] - c[1]) * cos]);
}

// The outline of a building, area or shape in plan units: its corners, in
// order, turned when it's turned. Lines give their points.
function planItemPts(it) {
  if (it.pts) return it.pts;
  const pts = rectPts(it.x, it.y, it.w, it.h);
  return it.rot ? planRotatePts(pts, [it.x + it.w / 2, it.y + it.h / 2], it.rot) : pts;
}

// A building or area's width and depth while it's still a rectangle
// (turned or not), else null.
function planRectDims(it) {
  if (!it.pts) return { w: it.w, h: it.h };
  const q = it.pts;
  if (q.length !== 4) return null;
  const v = i => [q[(i + 1) % 4][0] - q[i][0], q[(i + 1) % 4][1] - q[i][1]];
  const len = i => Math.hypot(...v(i));
  for (let i = 0; i < 4; i++) {
    const a = v(i), b = v((i + 1) % 4);
    if (Math.abs(a[0] * b[0] + a[1] * b[1]) > 0.02 * len(i) * len((i + 1) % 4)) return null;
  }
  return { w: len(0), h: len(1) };
}

// 45° hatching inside a shape, as line segments: lines of y + dir·x = c,
// clipped to the shape (dir -1 hatches the other way, for cross-hatching).
function hatchPolygon(pts, gap, dir = 1) {
  const f = q => q[1] + dir * q[0];
  const cs = pts.map(f), lo = Math.min(...cs), hi = Math.max(...cs), segs = [];
  for (let c = lo + gap; c < hi; c += gap) {
    const xs = [];
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length], fa = f(a) - c, fb = f(b) - c;
      if ((fa < 0) !== (fb < 0)) xs.push(a[0] + (b[0] - a[0]) * fa / (fa - fb));
    });
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) segs.push([[xs[i], c - dir * xs[i]], [xs[i + 1], c - dir * xs[i + 1]]]);
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

// A building, area or shape of any outline, square or turned: its fill,
// hatching, walls and label. size ("10 × 7.5 m") goes under the label;
// mpu, when given, puts each wall's length outside it.
function drawPlanShape(P, k, pts, label, { size, mpu } = {}) {
  const o = planRectStyle(k);
  if (pts.length < 3) { P.poly(pts, { stroke: o.stroke, lw: o.lw, close: false }); return; }
  P.poly(pts, { fill: o.fill });
  if (o.hatch) hatchPolygon(pts, 18).forEach(seg => P.poly(seg, { stroke: o.hatch, lw: 1.5, close: false }));
  if (o.cross) hatchPolygon(pts, 18, -1).forEach(seg => P.poly(seg, { stroke: o.hatch, lw: 1.5, close: false }));
  P.poly(pts, { stroke: o.stroke, lw: o.lw, dash: o.dash });
  // The label goes on the shape's true centre (its centroid), sized to fit.
  let A = 0, cx = 0, cy = 0;
  pts.forEach((a, i) => { const b = pts[(i + 1) % pts.length], f = a[0] * b[1] - b[0] * a[1]; A += f; cx += (a[0] + b[0]) * f; cy += (a[1] + b[1]) * f; });
  if (Math.abs(A) > 1) { cx /= 3 * A; cy /= 3 * A; } else { cx = pts[0][0]; cy = pts[0][1]; }
  const xs = pts.map(q => q[0]);
  const fit = (Math.max(...xs) - Math.min(...xs)) / Math.max(1, String(label || '').length * 0.62);
  const main = ['house', 'outline', 'subfloorShape'].includes(k);
  if (label) P.text(cx, cy - (size ? 12 : 0), label, { size: main ? Math.max(14, Math.min(24, fit)) : Math.max(13, Math.min(19, fit)), bold: main, color: main ? PLAN_INK.ink : PLAN_INK.muted, halo: true });
  if (size) P.text(cx, cy + (label ? 14 : 0), size, { size: 16, color: PLAN_INK.muted, halo: true });
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
      const pts = planItemPts(it);
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
    if (sym.kind === 'rect') {
      // Still a rectangle: its width × depth. Reshaped: each wall's length.
      const dims = planRectDims(it);
      drawPlanShape(P, it.k, planItemPts(it), it.label, mpu && sym.size ? (dims ? { size: `${formatPlanMetres(dims.w * mpu).replace(' m', '')} × ${formatPlanMetres(dims.h * mpu)}` } : { mpu }) : {});
    } else if (sym.kind === 'area') drawPlanShape(P, it.k, it.pts || [], it.label, { mpu: it.k === 'outline' ? mpu : 0 });
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
  if (sym.kind === 'rect') drawPlanShape(P, k, rectPts(x - 34, y - 22, 68, 44), '');
  else if (sym.kind === 'area') drawPlanShape(P, k, [[x - 34, y - 22], [x + 10, y - 22], [x + 10, y - 4], [x + 34, y - 4], [x + 34, y + 22], [x - 34, y + 22]], '');
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
// for the selected item (its label, real size, angle, delete). A selected
// building, area or line shows handles: a white dot on each corner to drag
// it, a pink tab on each wall to push or pull that wall in or out, and a
// turn handle to set it at any angle (a house built on the diagonal). Tap a
// corner or a tab to pick it: then give the wall's real length, add a corner
// in it, step a corner in for an L shape, or remove a corner. Two fingers
// pinch to zoom. Opened from the treatment record; Save hands the plan back
// through sitePlanEditor.onSave.
const sitePlanEditor = { plan: null, layer: 'site', tool: null, group: 'build', sel: null, part: null, drawing: null, drag: null, undo: [], onSave: null,
  zoom: 1, cx: PLAN_W / 2, cy: PLAN_H / 2, upx: 3, ptrs: new Map(), pinch: null, down: null, partBase: null };
const PLAN_MAX_ZOOM = 4;

function newSitePlan() {
  const d = SITE_PLAN_SYMBOLS.house.def;
  return { v: 1, north: 0, items: [{ id: planId(), k: 'house', x: 300, y: 225, w: d.w, h: d.h, label: d.label }] };
}

function planId() { return 'p' + Math.random().toString(36).slice(2, 9); }

function openSitePlan(plan, onSave) {
  const E = sitePlanEditor;
  E.plan = sitePlanHasContent(plan) ? JSON.parse(JSON.stringify(plan)) : newSitePlan();
  if (E.plan.north == null) E.plan.north = 0;
  E.tool = null; E.sel = null; E.part = null; E.drawing = null; E.drag = null; E.undo = []; E.onSave = onSave;
  E.layer = 'site'; E.group = 'build'; E.zoom = 1; E.cx = PLAN_W / 2; E.cy = PLAN_H / 2;
  E.ptrs.clear(); E.pinch = null; E.down = null;
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
    svgWrap.addEventListener('wheel', onSitePlanWheel, { passive: false });
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
  E.drawing = null; E.part = null;
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
  E.layer = layer; E.tool = null; E.sel = null; E.part = null;
  E.group = SITE_PLAN_TRAYS[layer][0];
  if (layer === 'sub' && !sitePlanHasSubfloor(E.plan)) {
    pushSitePlanUndo();
    planLayerItems(E.plan, 'site').forEach(it => {
      const turned = it.rot ? { rot: it.rot } : {};
      if (it.k === 'house') E.plan.items.push(Object.assign({ id: planId(), k: 'subfloor', layer: 'sub', label: 'Subfloor' }, it.pts ? { pts: it.pts.map(q => q.slice()) } : { x: it.x, y: it.y, w: it.w, h: it.h }, turned));
      if (it.k === 'outline' && (it.pts || []).length > 2) E.plan.items.push(Object.assign({ id: planId(), k: 'subfloorShape', layer: 'sub', pts: it.pts.map(q => q.slice()), label: 'Subfloor' }, turned));
    });
  }
  renderSitePlanTray();
  renderSitePlanEditor();
}

function setSitePlanTool(k) {
  const E = sitePlanEditor;
  finishSitePlanLine();
  E.tool = E.tool === k ? null : k;
  E.sel = null; E.part = null;
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

const sitePlanSelected = () => sitePlanEditor.plan.items.find(it => it.id === sitePlanEditor.sel) || null;
const sitePlanClosed = it => SITE_PLAN_SYMBOLS[it.k].kind !== 'line';

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
  const sel = sitePlanSelected();
  if (E.drag && E.drag.mode === 'turn' && sel) return `Turned to ${Math.round(sel.rot || 0)}°. It clicks at every 15°.`;
  if (sel && sitePlanHandles(sel)) {
    const wall = sitePlanClosed(sel) ? 'wall' : 'stretch';
    if (E.part && E.part.type === 'corner') return `Drag the corner to reshape it. Below: ${sitePlanClosed(sel) ? 'step it in for an L shape, or ' : ''}remove it.`;
    if (E.part && E.part.type === 'wall') return `Drag the pink tab to push or pull this ${wall}. Below: its real length, or add a corner in it.`;
    return sitePlanClosed(sel) ? 'Drag a white corner or a wall\'s pink tab to reshape it, ↻ to turn it, or the middle to move it.'
      : 'Drag a white corner or a pink tab to reshape the line, ↻ to turn it, or the line itself to move it.';
  }
  if (sel) return 'Drag to move it. Name it below, or delete it.';
  if (E.zoom > 1) return 'Zoomed in: drag an empty spot to look around, pinch to zoom.';
  return E.layer === 'sub' ? 'The subfloor, under the house walls (grey). Mark the piers, vents, access and what you found.'
    : 'Pick a symbol below, then tap the plan. Tap something on the plan to move, reshape or name it.';
}

// The handles of a selected building, area or line, in plan units: its
// corners, a tab in the middle of each wall long enough for one, and the
// turn handle just above it (below it when there's no room). Handles keep
// the same size on screen however far the plan is zoomed.
function sitePlanHandles(it) {
  const kind = SITE_PLAN_SYMBOLS[it.k].kind;
  if (!['rect', 'area', 'line'].includes(kind)) return null;
  const pts = planItemPts(it), closed = kind !== 'line';
  if (pts.length < (closed ? 3 : 2)) return null;
  const u = sitePlanEditor.upx, walls = [];
  for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    walls.push({ i, a, b, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], tab: Math.hypot(b[0] - a[0], b[1] - a[1]) > 58 * u });
  }
  const bb = planBoundsOf(pts), [vx, vy, vw, vh] = sitePlanViewBox();
  const above = bb.y - 38 * u >= vy + 16 * u;
  const turn = [planClamp(bb.x + bb.w / 2, vx + 16 * u, vx + vw - 16 * u), planClamp(above ? bb.y - 38 * u : bb.y + bb.h + 38 * u, vy + 16 * u, vy + vh - 16 * u)];
  return { corners: pts, walls, closed, turn, from: [turn[0], above ? bb.y : bb.y + bb.h], centre: planCentre(pts) };
}

function drawSitePlanHandles(P, sel) {
  const E = sitePlanEditor, u = E.upx, pink = PLAN_INK.pink, white = PLAN_INK.paper;
  const h = sitePlanHandles(sel);
  if (!h) {
    const b = sitePlanBounds(sel);
    P.poly(rectPts(b.x - 10, b.y - 10, b.w + 20, b.h + 20), { stroke: pink, lw: 3, dash: [10, 7] });
    return;
  }
  P.poly(h.corners, { stroke: pink, lw: 2.5 * u, close: h.closed ? undefined : false });
  const part = E.part;
  if (part && part.type === 'wall' && h.walls[part.i]) P.poly([h.walls[part.i].a, h.walls[part.i].b], { stroke: pink, lw: 7 * u, close: false });
  // The turn handle: a round button with a curved arrow, tied to the shape.
  const [tx, ty] = h.turn, r = 6.5 * u;
  P.poly([h.from, h.turn], { stroke: pink, lw: 1.5 * u, close: false, dash: [4 * u, 4 * u] });
  P.circle(tx, ty, 13 * u, { fill: white, stroke: pink, lw: 2.5 * u });
  const arc = [];
  for (let a = -160; a <= 100; a += 20) { const t = a * Math.PI / 180; arc.push([tx + r * Math.cos(t), ty + r * Math.sin(t)]); }
  P.poly(arc, { stroke: pink, lw: 2.2 * u, close: false });
  const t = 100 * Math.PI / 180, ex = tx + r * Math.cos(t), ey = ty + r * Math.sin(t), dx = -Math.sin(t), dy = Math.cos(t), s = 3.6 * u;
  P.poly([[ex + dx * s, ey + dy * s], [ex - dy * s, ey + dx * s], [ex + dy * s, ey - dx * s]], { fill: pink });
  if (E.drag && E.drag.mode === 'turn') P.text(tx, ty + (h.from[1] < ty ? 26 : -26) * u, `${Math.round(sel.rot || 0)}°`, { size: 15 * u, bold: true, color: pink, halo: true });
  // A tab on each wall: drag it to push or pull the wall.
  h.walls.forEach(w => {
    if (!w.tab) return;
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), ex2 = (w.b[0] - w.a[0]) / L, ey2 = (w.b[1] - w.a[1]) / L;
    const hl = 11 * u, hw = 4.5 * u, [mx, my] = w.mid, on = part && part.type === 'wall' && part.i === w.i;
    P.poly([[mx - ex2 * hl - ey2 * hw, my - ey2 * hl + ex2 * hw], [mx + ex2 * hl - ey2 * hw, my + ey2 * hl + ex2 * hw], [mx + ex2 * hl + ey2 * hw, my + ey2 * hl - ex2 * hw], [mx - ex2 * hl + ey2 * hw, my - ey2 * hl - ex2 * hw]],
      { fill: on ? white : pink, stroke: on ? pink : white, lw: 2 * u });
  });
  // With a scale, the picked wall's length (or the two walls either side of
  // the picked corner) in large type, outside the shape, as it's dragged.
  if (E.plan.mpu && part) {
    const n = h.corners.length, placed = [];
    const show = h.walls.filter(w => part.type === 'wall' ? w.i === part.i : w.i === part.i || w.i === (part.i - 1 + n) % n);
    show.forEach(w => {
      const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      let nx = -(w.b[1] - w.a[1]) / (L || 1), ny = (w.b[0] - w.a[0]) / (L || 1);
      if (h.closed && planInside(h.corners, [w.mid[0] + nx * 4, w.mid[1] + ny * 4])) { nx = -nx; ny = -ny; }
      // Beside a picked corner, each wall's length sits further from it, so the two don't meet.
      const f = part.type === 'wall' ? 0.5 : w.i === part.i ? 0.65 : 0.35;
      const words = formatPlanMetres(L * E.plan.mpu), size = 14 * u, bw = words.length * size * 0.62;
      let x = w.a[0] + (w.b[0] - w.a[0]) * f + nx * 22 * u, y = w.a[1] + (w.b[1] - w.a[1]) * f + ny * 22 * u;
      // In a tight corner, the second one steps further out so they don't overlap.
      for (let k = 0; k < 4 && placed.some(b => Math.abs(b[0] - x) < (b[2] + bw) / 2 && Math.abs(b[1] - y) < size * 1.1); k++) { x += nx * size; y += ny * size; }
      placed.push([x, y, bw]);
      P.text(x, y, words, { size, bold: true, color: PLAN_INK.pink, halo: true });
    });
  }
  // A dot on each corner: drag it to move the corner.
  h.corners.forEach((q, i) => {
    const on = part && part.type === 'corner' && part.i === i;
    P.circle(q[0], q[1], (on ? 10 : 8) * u, { fill: on ? pink : white, stroke: on ? white : pink, lw: 3 * u });
  });
}

// The plan and what's being drawn or picked. During a drag only this and the
// selection bar redraw; the legend and summary wait for the finger to lift.
function renderSitePlanCanvas() {
  const E = sitePlanEditor;
  const sel = sitePlanSelected();
  const vb = sitePlanViewBox();
  const wrap = document.getElementById('spCanvas');
  E.upx = vb[2] / (wrap.clientWidth || 350);
  wrap.innerHTML = sitePlanSVG(E.plan, { grid: true, layer: E.layer, cls: 'site-plan-svg sp-edit', viewBox: vb.join(' '), after: P => {
    if (E.drawing) {
      const it = E.plan.items.find(x => x.id === E.drawing);
      if (it) it.pts.forEach((p, i) => P.circle(p[0], p[1], (i ? 6 : 8) * E.upx, { fill: i ? PLAN_INK.paper : PLAN_INK.pink, stroke: PLAN_INK.pink, lw: 2.5 * E.upx }));
    }
    if (sel) drawSitePlanHandles(P, sel);
  } });
  document.getElementById('spHint').textContent = sitePlanHint();
  const fin = document.getElementById('spFinishLine');
  fin.hidden = !E.drawing;
  if (E.drawing) fin.textContent = SITE_PLAN_SYMBOLS[(E.plan.items.find(x => x.id === E.drawing) || {}).k || 'fence'].kind === 'area' ? 'Finish shape' : 'Finish line';
}

// The bar under the plan for what's selected: its name and label, its real
// size, its angle, and the picked corner or wall.
function renderSitePlanSelBar() {
  const E = sitePlanEditor;
  const sel = sitePlanSelected();
  const bar = document.getElementById('spSelBar');
  bar.hidden = !sel;
  if (!sel) return;
  const sym = SITE_PLAN_SYMBOLS[sel.k], m1 = v => String(Math.round(v * 10) / 10);
  document.getElementById('spSelName').textContent = sym.kind === 'station' ? `Station ${sel.n} · ${sym.label}` : sym.label.replace(', square', '');
  const inp = document.getElementById('spSelLabel');
  inp.placeholder = sym.ph || 'Name it';
  if (document.activeElement !== inp) inp.value = sel.label || '';
  // The real size: one known measurement sets the scale for the whole plan.
  const units = sitePlanItemUnits(sel);
  const row = document.getElementById('spSelSizeRow');
  row.hidden = !units;
  if (units) {
    document.getElementById('spSelSizeLabel').textContent = sym.kind === 'rect' && planRectDims(sel) ? 'Real width' : sym.kind === 'line' ? 'Real length' : 'Real length of the walls, all round';
    const m = document.getElementById('spSelMetres');
    if (document.activeElement !== m) m.value = E.plan.mpu ? m1(units * E.plan.mpu) : '';
  }
  const h = sitePlanHandles(sel);
  document.getElementById('spTurnRow').hidden = !h;
  const ang = document.getElementById('spAngle');
  if (h && document.activeElement !== ang) ang.value = String(Math.round(sel.rot || 0));
  // The picked corner or wall.
  const part = h && E.part && (E.part.type === 'corner' ? h.corners[E.part.i] : h.walls[E.part.i]) ? E.part : null;
  document.getElementById('spPart').hidden = !part;
  if (!part) return;
  const wallWord = h.closed ? 'wall' : 'stretch';
  document.getElementById('spPartName').textContent = part.type === 'corner' ? `Corner ${part.i + 1} of ${h.corners.length}` : `This ${wallWord}`;
  document.getElementById('spPartLenRow').hidden = part.type !== 'wall';
  if (part.type === 'wall') {
    const w = h.walls[part.i], len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    document.getElementById('spPartLenLabel').textContent = E.plan.mpu ? `Real length of this ${wallWord}` : `Real length of this ${wallWord} (sets the scale)`;
    const pm = document.getElementById('spPartMetres');
    if (document.activeElement !== pm) pm.value = E.plan.mpu ? m1(len * E.plan.mpu) : '';
  }
  document.getElementById('spPartAdd').hidden = part.type !== 'wall';
  document.getElementById('spPartStep').hidden = part.type !== 'corner' || !h.closed;
  document.getElementById('spPartRemove').hidden = part.type !== 'corner' || h.corners.length <= (h.closed ? 3 : 2);
}

function renderSitePlanEditor() {
  const E = sitePlanEditor;
  renderSitePlanCanvas();
  renderSitePlanSelBar();
  document.getElementById('spZoomOut').disabled = E.zoom <= 1;
  document.getElementById('spZoomIn').disabled = E.zoom >= PLAN_MAX_ZOOM;
  document.getElementById('spBgRemove').hidden = !E.plan.bg;
  document.querySelector('#sitePlanOverlay .sp-bg').hidden = E.layer === 'sub';
  document.getElementById('spBgLabel').firstChild.textContent = E.plan.bg ? 'Change the photo underneath' : 'Trace over a map or photo';
  document.getElementById('spUndo').disabled = !E.undo.length;
  document.getElementById('spNorth').textContent = `North: ${['up', 'up-right', 'right', 'down-right', 'down', 'down-left', 'left', 'up-left'][E.plan.north || 0]}`;
  document.getElementById('spScaleNote').textContent = E.plan.mpu
    ? 'The plan has a scale. Lengths show on the barrier and walls, and the barrier\'s metres fill the record.'
    : 'Tip: tap the house, then type its real width, and the plan works out every length from it.';
  document.getElementById('spLegend').innerHTML = sitePlanLegendHTML(E.plan, { layer: E.layer });
  const sum = E.layer === 'sub' ? sitePlanSubSummary(E.plan) : sitePlanSummary(E.plan);
  document.getElementById('spSummary').textContent = sum ? `The ${E.layer === 'sub' ? 'subfloor plan' : 'plan'} shows ${sum}.` : '';
}

const planBoundsOf = pts => {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};
// The middle of a shape's corners: what it turns about.
const planCentre = pts => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
const planRound = pts => pts.map(q => [Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10]);

function sitePlanBounds(it) {
  const sym = SITE_PLAN_SYMBOLS[it.k];
  if (sym.kind === 'rect' || sym.kind === 'line' || sym.kind === 'area') return planBoundsOf(planItemPts(it));
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
  E.zoom = step > 0 ? Math.min(PLAN_MAX_ZOOM, Math.floor(E.zoom + 1e-6) + 1) : Math.max(1, Math.ceil(E.zoom - 1e-6) - 1);
  // Zoom in on what's selected.
  const sel = sitePlanSelected();
  if (sel && step > 0) { const b = sitePlanBounds(sel); E.cx = b.x + b.w / 2; E.cy = b.y + b.h / 2; }
  renderSitePlanEditor();
}

// Zoom so the plan point under the screen point (sx, sy) stays under it.
function zoomSitePlanAt(zoom, anchor, sx, sy) {
  const E = sitePlanEditor, r = document.querySelector('#spCanvas svg').getBoundingClientRect();
  E.zoom = planClamp(zoom, 1, PLAN_MAX_ZOOM);
  const vw = PLAN_W / E.zoom, vh = PLAN_H / E.zoom;
  E.cx = anchor[0] - (sx - r.left) / r.width * vw + vw / 2;
  E.cy = anchor[1] - (sy - r.top) / r.height * vh + vh / 2;
}

// A mouse wheel or trackpad zooms too, on a computer.
function onSitePlanWheel(e) {
  e.preventDefault();
  const E = sitePlanEditor;
  zoomSitePlanAt(E.zoom * Math.exp(-e.deltaY * 0.0025), sitePlanPoint(e), e.clientX, e.clientY);
  renderSitePlanEditor();
}

// How long the item is in plan units, for giving its real size: a
// building's width, a line's length, a shape's walls all round.
function sitePlanItemUnits(it) {
  const sym = SITE_PLAN_SYMBOLS[it.k];
  if (sym.kind === 'rect') { const d = planRectDims(it); return d ? d.w : planPathLength(it.pts, true); }
  if (sym.kind === 'line') return (it.pts || []).length > 1 ? planPathLength(it.pts) : 0;
  if (sym.kind === 'area') return (it.pts || []).length > 2 ? planPathLength(it.pts, true) : 0;
  return 0;
}

function onSitePlanMetres(inp) {
  const E = sitePlanEditor;
  const it = sitePlanSelected();
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
// How finely corners and walls snap: half a grid square, finer zoomed in.
const sitePlanStep = () => PLAN_GRID / 2 / Math.pow(2, Math.floor(Math.log2(sitePlanEditor.zoom) + 1e-6));
// Angles run clockwise, 0 to 359.
const planAngle = deg => ((Math.round(deg * 10) / 10) % 360 + 360) % 360;

function planSegDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1;
  const t = planClamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L, 0, 1);
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

// Is p inside the shape (ray casting)?
function planInside(pts, p) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Snap q to the grid of a shape turned deg about o, so a turned house's
// corners stay square to its own walls.
function planSnapInFrame(q, o, deg, g) {
  const l = planRotatePts([q], o, -deg)[0];
  return planRotatePts([[o[0] + planSnap(l[0] - o[0], g), o[1] + planSnap(l[1] - o[1], g)]], o, deg)[0];
}

// Is p on the item?
function sitePlanItemHit(it, p) {
  const kind = SITE_PLAN_SYMBOLS[it.k].kind;
  if (kind === 'line') return it.pts.some((a, i) => i && planSegDist(p, it.pts[i - 1], a) < 24);
  if (kind === 'rect' || kind === 'area') {
    // Inside the shape, or on one of its walls.
    const pts = planItemPts(it);
    return (pts.length > 2 && planInside(pts, p)) || pts.some((a, i) => (i || pts.length > 2) && planSegDist(p, pts[(i || pts.length) - 1], a) < 20);
  }
  if (kind === 'text') { const b = sitePlanBounds(it); return p[0] >= b.x && p[0] <= b.x + b.w && Math.abs(p[1] - it.y) < 26; }
  return Math.hypot(p[0] - it.x, p[1] - it.y) < 38;
}

// The topmost item under a point: stations and symbols over lines over
// buildings, and the one drawn last when they're level.
function sitePlanHit(p) {
  const E = sitePlanEditor, z = it => SITE_PLAN_SYMBOLS[it.k].z || 0;
  return planLayerItems(E.plan, E.layer).map((it, i) => [it, i]).sort((a, b) => (z(b[0]) - z(a[0])) || (b[1] - a[1]))
    .map(x => x[0]).find(it => sitePlanItemHit(it, p)) || null;
}

// Which handle of the selected item is under p: the turn handle, a corner,
// or a wall's tab (the nearest wins).
function sitePlanHandleAt(sel, p) {
  const h = sitePlanHandles(sel);
  if (!h) return null;
  const u = sitePlanEditor.upx, dist = q => Math.hypot(p[0] - q[0], p[1] - q[1]);
  if (dist(h.turn) < 24 * u) return { type: 'turn' };
  let best = null, bd = Infinity;
  // A corner's reach shrinks on a short wall, so its middle still grabs the wall.
  const n = h.corners.length, wallLen = i => {
    if (!h.closed && (i < 0 || i >= n - 1)) return Infinity;
    const a = h.corners[(i + n) % n], b = h.corners[(i + 1) % n];
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  };
  h.corners.forEach((q, i) => {
    // Corner i sits between wall i - 1 and wall i.
    const reach = Math.max(10 * u, Math.min(22 * u, 0.4 * Math.min(wallLen(i - 1), wallLen(i))));
    const d = dist(q); if (d < reach && d < bd) { best = { type: 'corner', i }; bd = d; }
  });
  if (best) return best;
  h.walls.forEach(w => { const d = dist(w.mid); if (w.tab && d < 20 * u && d < bd) { best = { type: 'wall', i: w.i }; bd = d; } });
  return best;
}

// The wall of a selected building or area right under p, if any: a wall
// can be pushed or pulled from anywhere along it, not just its tab.
function sitePlanWallAt(sel, p) {
  const h = sitePlanHandles(sel);
  if (!h || !h.closed) return null;
  let best = null, bd = 11 * sitePlanEditor.upx;
  h.walls.forEach(w => { const d = planSegDist(p, w.a, w.b); if (d < bd) { best = w.i; bd = d; } });
  return best;
}

// Push or pull wall i (pts[i] to pts[i + 1]) t units along its normal. The
// walls either side stretch along their own lines, so their angles hold.
function planMoveWall(pts, i, t, closed) {
  const n = pts.length, j = (i + 1) % n, a = pts[i], b = pts[j];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
  const a2 = [a[0] + nx * t, a[1] + ny * t], b2 = [b[0] + nx * t, b[1] + ny * t];
  const meet = (p0, p1, from) => {
    const d1 = [p1[0] - p0[0], p1[1] - p0[1]], d2 = [b2[0] - a2[0], b2[1] - a2[1]], den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-6 * (Math.hypot(...d1) * Math.hypot(...d2) || 1)) return null;
    const s = ((a2[0] - p0[0]) * d2[1] - (a2[1] - p0[1]) * d2[0]) / den, q = [p0[0] + d1[0] * s, p0[1] + d1[1] * s];
    // A wall nearly in line with this one would shoot off: just slide.
    return Math.hypot(q[0] - from[0], q[1] - from[1]) > 3 * Math.abs(t) + 1 ? null : q;
  };
  const out = pts.map(q => q.slice());
  const prev = closed || i > 0 ? pts[(i - 1 + n) % n] : null, next = closed || j < n - 1 ? pts[(j + 1) % n] : null;
  out[i] = (prev && meet(prev, a, a)) || a2;
  out[j] = (next && meet(next, b, b)) || b2;
  return out;
}

// Make wall i of pts `target` units long. The wall after it moves, so a
// square-cornered building stays square; a line's last stretch just ends
// further along.
function planSetWallLength(pts, i, target, closed) {
  const n = pts.length, j = (i + 1) % n, a = pts[i], b = pts[j];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, delta = target - L;
  if (closed || j < n - 1) {
    const c = pts[(j + 1) % n], Ln = Math.hypot(c[0] - b[0], c[1] - b[1]) || 1;
    const dot = (-(c[1] - b[1]) / Ln) * ux + ((c[0] - b[0]) / Ln) * uy;
    if (Math.abs(dot) > 0.5) return planMoveWall(pts, j, delta * dot, closed);
  }
  const out = pts.map(q => q.slice());
  out[j] = [b[0] + ux * delta, b[1] + uy * delta];
  return out;
}

// Put new corners on the item. A building or area that was a rectangle
// stays one (its width, depth and centre come from the corners). The change
// is refused if it would turn the shape inside out or squash it flat.
const planArea = pts => pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
function setSitePlanItemPts(it, orig, pts) {
  if (orig.pts) {
    if (sitePlanClosed(orig)) { const a0 = planArea(orig.pts), a1 = planArea(pts); if (Math.sign(a1) !== Math.sign(a0) || Math.abs(a1) < PLAN_GRID * PLAN_GRID) return false; }
    it.pts = planRound(pts); return true;
  }
  const r = (orig.rot || 0) * Math.PI / 180, u = [Math.cos(r), Math.sin(r)], v = [-Math.sin(r), Math.cos(r)];
  const w = (pts[1][0] - pts[0][0]) * u[0] + (pts[1][1] - pts[0][1]) * u[1];
  const h = (pts[3][0] - pts[0][0]) * v[0] + (pts[3][1] - pts[0][1]) * v[1];
  if (w < PLAN_GRID || h < PLAN_GRID) return false;
  const c = planCentre(pts);
  it.w = Math.round(w * 10) / 10; it.h = Math.round(h * 10) / 10;
  it.x = Math.round((c[0] - it.w / 2) * 10) / 10; it.y = Math.round((c[1] - it.h / 2) * 10) / 10;
  return true;
}

// A rectangle becomes a shape of corners, to add, step or remove one.
function sitePlanToShape(it) {
  if (it.pts) return;
  it.pts = planRound(planItemPts(it));
  delete it.x; delete it.y; delete it.w; delete it.h;
}

// Turn the item to deg, about its middle. orig is how it was before.
function setSitePlanItemAngle(it, orig, deg) {
  const rot = planAngle(deg);
  if (orig.pts) it.pts = planRound(planRotatePts(orig.pts, planCentre(orig.pts), rot - (orig.rot || 0)));
  if (rot) it.rot = rot; else delete it.rot;
}

// Nudge the item back inside the plan if a turn or a stretch took it over
// the edge.
function keepSitePlanItemIn(it) {
  const b = planBoundsOf(planItemPts(it));
  const dx = b.w > PLAN_W ? 0 : b.x < 0 ? -b.x : b.x + b.w > PLAN_W ? PLAN_W - b.x - b.w : 0;
  const dy = b.h > PLAN_H ? 0 : b.y < 0 ? -b.y : b.y + b.h > PLAN_H ? PLAN_H - b.y - b.h : 0;
  if (!dx && !dy) return;
  if (it.pts) it.pts = planRound(it.pts.map(q => [q[0] + dx, q[1] + dy]));
  else { it.x += dx; it.y += dy; }
}

function onSitePlanDown(e) {
  const E = sitePlanEditor;
  e.preventDefault();
  // A tap on the plan puts the keyboard away.
  const typing = document.activeElement;
  if (typing && typing.closest && typing.closest('#spSelBar')) typing.blur();
  try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
  E.ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (E.ptrs.size === 2) { startSitePlanPinch(); return; }
  if (E.ptrs.size > 2 || E.pinch) return;
  // How things were, in case a second finger turns this into a pinch.
  E.down = { plan: JSON.stringify(E.plan), undo: E.undo.length, sel: E.sel, part: E.part, drawing: E.drawing, tool: E.tool };
  const p = sitePlanPoint(e);
  const tool = E.tool, sym = tool && SITE_PLAN_SYMBOLS[tool];
  const pt = [planClamp(planSnap(p[0], PLAN_GRID / 2), 10, PLAN_W - 10), planClamp(planSnap(p[1], PLAN_GRID / 2), 10, PLAN_H - 10)];
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
    E.sel = it.id; E.part = null;
    return;
  }
  if (sym) {
    pushSitePlanUndo();
    const it = { id: planId(), k: tool, x: pt[0], y: pt[1] };
    if (E.layer === 'sub') it.layer = 'sub';
    if (sym.kind === 'station') it.n = sitePlanStations(E.plan).reduce((m, s) => Math.max(m, s.n || 0), 0) + 1;
    if (sym.kind === 'text') it.label = '';
    E.plan.items.push(it);
    E.sel = it.id; E.part = null;
    // Stations keep the tool, so a run of them goes in tap after tap.
    if (sym.kind !== 'station') E.tool = null;
    E.drag = { mode: 'move', id: it.id, start: p, orig: JSON.parse(JSON.stringify(it)), moved: false, undoPushed: true };
    renderSitePlanTray(); renderSitePlanEditor();
    if (sym.kind === 'text') setTimeout(() => document.getElementById('spSelLabel').focus(), 50);
    return;
  }
  // No tool: a handle of what's selected, then what's under the finger.
  const sel = sitePlanSelected(), before = E.down.plan, clone = it => JSON.parse(JSON.stringify(it));
  const hd = sel && sitePlanHandleAt(sel, p);
  if (hd) {
    if (hd.type === 'turn') E.drag = { mode: 'turn', id: sel.id, start: p, c: planCentre(planItemPts(sel)), orig: clone(sel), before, moved: false };
    else { E.part = { type: hd.type, i: hd.i }; E.drag = { mode: hd.type, id: sel.id, i: hd.i, start: p, orig: clone(sel), before, moved: false }; }
    renderSitePlanEditor();
    return;
  }
  const hit = sitePlanHit(p), z = it => SITE_PLAN_SYMBOLS[it.k].z || 0;
  // The selected building keeps the finger unless a symbol sits on top of it.
  if (sel && !(hit && hit !== sel && z(hit) > z(sel))) {
    const wall = sitePlanWallAt(sel, p);
    if (wall != null) {
      E.part = { type: 'wall', i: wall };
      E.drag = { mode: 'wall', id: sel.id, i: wall, start: p, orig: clone(sel), before, moved: false };
      renderSitePlanEditor();
      return;
    }
    if (sitePlanItemHit(sel, p)) {
      E.part = null;
      E.drag = { mode: 'move', id: sel.id, start: p, orig: clone(sel), moved: false, before };
      renderSitePlanEditor();
      return;
    }
  }
  E.sel = hit ? hit.id : null; E.part = null;
  E.drag = hit ? { mode: 'move', id: hit.id, start: p, orig: clone(hit), moved: false, before }
    : E.zoom > 1 ? { mode: 'pan', sx: e.clientX, sy: e.clientY, cx: E.cx, cy: E.cy } : null;
  renderSitePlanEditor();
}

// A second finger: whatever the first one started is put back, and the two
// pinch to zoom about the point between them.
function startSitePlanPinch() {
  const E = sitePlanEditor, s = E.down;
  if (s) {
    E.plan = JSON.parse(s.plan); E.undo.length = Math.min(E.undo.length, s.undo);
    E.sel = s.sel; E.part = s.part; E.drawing = s.drawing; E.tool = s.tool;
  }
  E.drag = null; E.down = null;
  const [a, b] = [...E.ptrs.values()], mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  E.pinch = { d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, z0: E.zoom, anchor: sitePlanPoint({ clientX: mid[0], clientY: mid[1] }) };
  renderSitePlanTray(); renderSitePlanEditor();
}

function onSitePlanMove(e) {
  const E = sitePlanEditor;
  if (E.ptrs.has(e.pointerId)) E.ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (E.pinch) {
    e.preventDefault();
    if (E.ptrs.size < 2) return;
    const [a, b] = [...E.ptrs.values()];
    zoomSitePlanAt(E.pinch.z0 * Math.hypot(a[0] - b[0], a[1] - b[1]) / E.pinch.d0, E.pinch.anchor, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    renderSitePlanCanvas();
    return;
  }
  const d = E.drag;
  if (!d) return;
  e.preventDefault();
  if (d.mode === 'pan') {
    const r = document.querySelector('#spCanvas svg').getBoundingClientRect();
    E.cx = d.cx - (e.clientX - d.sx) / r.width * PLAN_W / E.zoom;
    E.cy = d.cy - (e.clientY - d.sy) / r.height * PLAN_H / E.zoom;
    renderSitePlanCanvas();
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
  } else {
    let dx = p[0] - d.start[0], dy = p[1] - d.start[1];
    if (!d.moved && Math.hypot(dx, dy) < 5 * E.upx) return;
    d.moved = true;
    const kind = SITE_PLAN_SYMBOLS[it.k].kind, g = sitePlanStep();
    if (d.mode === 'corner') dragSitePlanCorner(it, d, p, g);
    else if (d.mode === 'wall') {
      const pts = planItemPts(d.orig), a = pts[d.i], b = pts[(d.i + 1) % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const t = planSnap(dx * -(b[1] - a[1]) / L + dy * (b[0] - a[0]) / L, g);
      const apply = t => setSitePlanItemPts(it, d.orig, planMoveWall(pts, d.i, t, sitePlanClosed(it)));
      // Pulled too far, the wall stops as close to the far wall as it can go.
      if (!apply(t)) { let lo = 0, hi = t; for (let k = 0; k < 12; k++) { const m = (lo + hi) / 2; if (apply(m)) lo = m; else hi = m; } apply(lo); }
    } else if (d.mode === 'turn') {
      let deg = (d.orig.rot || 0) + (Math.atan2(p[1] - d.c[1], p[0] - d.c[0]) - Math.atan2(d.start[1] - d.c[1], d.start[0] - d.c[0])) * 180 / Math.PI;
      // Whole degrees, clicking to every 15°.
      deg = Math.round(deg);
      if (Math.abs(deg - planSnap(deg, 15)) <= 4) deg = planSnap(deg, 15);
      setSitePlanItemAngle(it, d.orig, deg);
    } else if (kind === 'rect' || kind === 'line' || kind === 'area') {
      // The whole thing moves, kept inside the plan.
      const b = planBoundsOf(planItemPts(d.orig));
      dx = planClamp(planSnap(dx, 2 * g), -b.x, PLAN_W - b.x - b.w); dy = planClamp(planSnap(dy, 2 * g), -b.y, PLAN_H - b.y - b.h);
      if (d.orig.pts) it.pts = d.orig.pts.map(q => [q[0] + dx, q[1] + dy]);
      else { it.x = d.orig.x + dx; it.y = d.orig.y + dy; }
    } else {
      it.x = planClamp(planSnap(d.orig.x + dx, PLAN_GRID / 2), 10, PLAN_W - 10);
      it.y = planClamp(planSnap(d.orig.y + dy, PLAN_GRID / 2), 10, PLAN_H - 10);
    }
  }
  renderSitePlanCanvas();
  renderSitePlanSelBar();
}

// Drag a corner. A rectangle stays a rectangle, its far corner staying put;
// a shape's or line's corner goes under the finger, on the grid of the way
// the shape is turned, so its walls stay square.
function dragSitePlanCorner(it, d, p, g) {
  const q = [planClamp(p[0], 0, PLAN_W), planClamp(p[1], 0, PLAN_H)];
  if (!d.orig.pts) {
    const r = (d.orig.rot || 0) * Math.PI / 180, u = [Math.cos(r), Math.sin(r)], v = [-Math.sin(r), Math.cos(r)];
    const pts = planItemPts(d.orig), o = pts[(d.i + 2) % 4], c0 = pts[d.i];
    const along = (pt, ax) => (pt[0] - o[0]) * ax[0] + (pt[1] - o[1]) * ax[1];
    const sx = Math.sign(along(c0, u)) || 1, sy = Math.sign(along(c0, v)) || 1;
    const w = Math.max(PLAN_GRID, planSnap(along(q, u) * sx, g)), h = Math.max(PLAN_GRID, planSnap(along(q, v) * sy, g));
    const cx = o[0] + u[0] * sx * w / 2 + v[0] * sy * h / 2, cy = o[1] + u[1] * sx * w / 2 + v[1] * sy * h / 2;
    it.w = w; it.h = h; it.x = Math.round((cx - w / 2) * 10) / 10; it.y = Math.round((cy - h / 2) * 10) / 10;
    return;
  }
  const pts = d.orig.pts.map(x => x.slice());
  pts[d.i] = planSnapInFrame(q, d.orig.pts[d.i ? 0 : 1], d.orig.rot || 0, g);
  it.pts = planRound(pts);
}

function onSitePlanUp(e) {
  const E = sitePlanEditor;
  E.ptrs.delete(e.pointerId);
  if (E.pinch) {
    // The pinch ends when both fingers are off.
    if (!E.ptrs.size) E.pinch = null;
    renderSitePlanEditor();
    return;
  }
  const d = E.drag;
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
  if (it && d.moved && ['corner', 'wall', 'turn'].includes(d.mode)) keepSitePlanItemIn(it);
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
  else if (it) { E.sel = it.id; E.part = null; }
  E.tool = null;
  renderSitePlanTray();
  renderSitePlanEditor();
}

function onSitePlanLabel(inp) {
  const E = sitePlanEditor;
  const it = sitePlanSelected();
  if (!it) return;
  if (!inp.dataset.undo) { pushSitePlanUndo(); inp.dataset.undo = '1'; }
  it.label = inp.value;
  renderSitePlanEditor();
}

// Turn the selected building, area or line to the next 15° either way.
function turnSitePlanItem(dir) {
  const it = sitePlanSelected();
  if (!it || !sitePlanHandles(it)) return;
  pushSitePlanUndo();
  const cur = it.rot || 0;
  setSitePlanItemAngle(it, JSON.parse(JSON.stringify(it)), dir > 0 ? (Math.floor(cur / 15 + 1e-6) + 1) * 15 : (Math.ceil(cur / 15 - 1e-6) - 1) * 15);
  keepSitePlanItemIn(it);
  renderSitePlanEditor();
}

// Or type the angle: 0 to 359, clockwise.
function onSitePlanAngle(inp) {
  const it = sitePlanSelected(), deg = parseFloat(inp.value);
  if (!it || !isFinite(deg)) return;
  if (!inp.dataset.undo) { pushSitePlanUndo(); inp.dataset.undo = '1'; }
  setSitePlanItemAngle(it, JSON.parse(JSON.stringify(it)), deg);
  keepSitePlanItemIn(it);
  renderSitePlanEditor();
}

// The picked wall's real length. With no scale yet it sets the scale for the
// whole plan; with one, the wall after it moves so this wall is that long.
// Each keystroke works from the wall as it was when the box was tapped.
function onSitePlanPartFocus(inp) {
  delete inp.dataset.undo; delete inp.dataset.scale;
  const E = sitePlanEditor, it = sitePlanSelected();
  E.partBase = it && E.part ? { key: it.id + ':' + E.part.type + E.part.i, it: JSON.parse(JSON.stringify(it)) } : null;
}
function onSitePlanPartMetres(inp) {
  const E = sitePlanEditor, it = sitePlanSelected();
  if (!it || !E.part || E.part.type !== 'wall') return;
  // Another wall picked since the box was tapped: start again from this one.
  if (!E.partBase || E.partBase.key !== it.id + ':' + E.part.type + E.part.i) onSitePlanPartFocus(inp);
  const base = E.partBase.it;
  const m = parseFloat(String(inp.value).replace(',', '.'));
  const pts = planItemPts(base), a = pts[E.part.i], b = pts[(E.part.i + 1) % pts.length], units = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!(m > 0 && m < 2000) || !units) return;
  if (!inp.dataset.undo) { pushSitePlanUndo(); inp.dataset.undo = '1'; }
  if (!E.plan.mpu || inp.dataset.scale) {
    // No scale yet: this wall sets it, and keeps setting it while typing.
    E.plan.mpu = m / units; inp.dataset.scale = '1';
  } else {
    if (setSitePlanItemPts(it, base, planSetWallLength(pts, E.part.i, m / E.plan.mpu, sitePlanClosed(it)))) keepSitePlanItemIn(it);
  }
  renderSitePlanEditor();
}

// Add a corner in the middle of the picked wall, picked to drag.
function addSitePlanCorner() {
  const E = sitePlanEditor, it = sitePlanSelected(), part = E.part;
  if (!it || !part || part.type !== 'wall') return;
  pushSitePlanUndo();
  sitePlanToShape(it);
  const a = it.pts[part.i], b = it.pts[(part.i + 1) % it.pts.length];
  it.pts.splice(part.i + 1, 0, planRound([[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]])[0]);
  E.part = { type: 'corner', i: part.i + 1 };
  renderSitePlanEditor();
}

// Step the picked corner in, for an L shape or a notch: it becomes three
// corners, the same way along each wall.
function stepSitePlanCorner() {
  const E = sitePlanEditor, it = sitePlanSelected(), part = E.part;
  if (!it || !part || part.type !== 'corner' || !sitePlanClosed(it)) return;
  pushSitePlanUndo();
  sitePlanToShape(it);
  const n = it.pts.length, i = part.i, c = it.pts[i], a = it.pts[(i - 1 + n) % n], b = it.pts[(i + 1) % n];
  const la = Math.hypot(a[0] - c[0], a[1] - c[1]) || 1, lb = Math.hypot(b[0] - c[0], b[1] - c[1]) || 1;
  const s = Math.max(PLAN_GRID / 2, planSnap(Math.min(la, lb) / 3, PLAN_GRID / 2));
  const p1 = [c[0] + (a[0] - c[0]) / la * s, c[1] + (a[1] - c[1]) / la * s], p2 = [c[0] + (b[0] - c[0]) / lb * s, c[1] + (b[1] - c[1]) / lb * s];
  it.pts.splice(i, 1, ...planRound([p1, [p1[0] + p2[0] - c[0], p1[1] + p2[1] - c[1]], p2]));
  E.part = { type: 'corner', i: i + 1 };
  renderSitePlanEditor();
}

function removeSitePlanCorner() {
  const E = sitePlanEditor, it = sitePlanSelected(), part = E.part;
  if (!it || !part || part.type !== 'corner') return;
  if (planItemPts(it).length <= (sitePlanClosed(it) ? 3 : 2)) return;
  pushSitePlanUndo();
  sitePlanToShape(it);
  it.pts.splice(part.i, 1);
  E.part = null;
  renderSitePlanEditor();
}

function deleteSitePlanItem() {
  const E = sitePlanEditor;
  if (!E.sel) return;
  pushSitePlanUndo();
  if (E.drawing === E.sel) E.drawing = null;
  E.plan.items = E.plan.items.filter(x => x.id !== E.sel);
  E.sel = null; E.part = null;
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
  E.sel = null; E.part = null; E.drawing = null;
  renderSitePlanEditor();
}

// The label box starts a fresh undo step each time it gains focus.
function onSitePlanLabelFocus(inp) { delete inp.dataset.undo; }
