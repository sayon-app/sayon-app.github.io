// ── SITE PLAN ───────────────────────────────────────────────────────────────
// A drawn plan of the site with a fixed set of symbols and a legend, so
// anyone reading the certificate (the client, an agent, a solicitor, the
// next technician) can see where the building, the treatment and each
// station are. It's kept with the treatment record as data, not a picture:
// q.treatment.plan = { v: 1, north: 0..7 (steps of 45°), items: [
//   { id, k: symbol key, x, y } for a point,
//   { ..., n } for a station (one number sequence across all station types),
//   { ..., w, h } for a building or an area (x, y its top-left corner),
//   { id, k, pts: [[x, y], ...] } for a line,
//   any of them with a label ] }.
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

// group: the tab it sits under in the editor. legend: the words in the key.
const SITE_PLAN_GROUPS = { site: 'The site', treat: 'Treatment', stations: 'Stations', find: 'Findings' };
const SITE_PLAN_SYMBOLS = {
  house:     { kind: 'rect', group: 'site', label: 'Building', legend: 'House or main building', z: 0, def: { w: 400, h: 275, label: 'House' }, ph: 'e.g. House, Unit 2' },
  shed:      { kind: 'rect', group: 'site', label: 'Garage or shed', legend: 'Garage, shed or other building', z: 0, def: { w: 175, h: 150, label: 'Garage' }, ph: 'e.g. Garage, Shed' },
  deck:      { kind: 'rect', group: 'site', label: 'Deck or patio', legend: 'Deck, patio or verandah', z: 0, def: { w: 250, h: 125, label: 'Deck' }, ph: 'e.g. Rear deck' },
  fence:     { kind: 'line', group: 'site', label: 'Fence', legend: 'Fence or boundary', z: 2, ph: 'e.g. Side fence' },
  tree:      { kind: 'point', group: 'site', label: 'Tree or stump', legend: 'Tree or stump', z: 3, ph: 'e.g. Gum tree' },
  text:      { kind: 'text', group: 'site', label: 'Label', legend: null, z: 5, ph: 'e.g. Driveway, Street' },
  barrier:   { kind: 'line', group: 'treat', label: 'Chemical barrier', legend: 'Chemical barrier (treated soil)', z: 2, ph: 'e.g. Trenched and rodded' },
  treated:   { kind: 'point', group: 'treat', label: 'Treated spot', legend: 'Direct treatment (foam, dust or spray)', z: 3, ph: 'e.g. Foamed wall cavity' },
  untreated: { kind: 'line', group: 'treat', label: 'Not treated', legend: 'Not treated', z: 2, ph: 'e.g. Under paving, no access' },
  noaccess:  { kind: 'rect', group: 'treat', label: 'No access area', legend: 'Area not inspected or treated', z: 1, def: { w: 200, h: 100, label: 'No access' }, ph: 'e.g. Under rear deck' },
  notice:    { kind: 'point', group: 'treat', label: 'Durable notice', legend: 'Durable notice', z: 3, ph: 'e.g. Meter box' },
  inground:  { kind: 'station', group: 'stations', label: 'In-ground', legend: 'In-ground bait station', z: 4, ph: 'Where, e.g. rear left corner' },
  above:     { kind: 'station', group: 'stations', label: 'Above-ground', legend: 'Above-ground bait station', z: 4, ph: 'Where, e.g. laundry east wall' },
  monitor:   { kind: 'station', group: 'stations', label: 'Monitoring', legend: 'Monitoring station', z: 4, ph: 'Where, e.g. by the shed' },
  activity:  { kind: 'point', group: 'find', label: 'Termite activity', legend: 'Termite activity or damage found', z: 3, ph: 'e.g. Laundry door frame' },
  moisture:  { kind: 'point', group: 'find', label: 'Moisture or leak', legend: 'Moisture, leak or conducive condition', z: 3, ph: 'e.g. Leaking tap' },
  access:    { kind: 'point', group: 'find', label: 'Access point', legend: 'Subfloor or roof access', z: 3, ph: 'e.g. Subfloor hatch' },
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

function sitePlanHasContent(plan) {
  return !!(plan && Array.isArray(plan.items) && plan.items.length);
}

function sitePlanStations(plan) {
  return ((plan && plan.items) || []).filter(it => SITE_PLAN_STATIONS.includes(it.k)).sort((a, b) => a.n - b.n);
}

// "12 in-ground bait stations, 2 above-ground bait stations and a
// chemical barrier": what the plan shows, for the record and the PDF.
function sitePlanSummary(plan) {
  const items = (plan && plan.items) || [];
  const count = k => items.filter(it => it.k === k).length;
  const bits = [];
  [['inground', 'in-ground bait station'], ['above', 'above-ground bait station'], ['monitor', 'monitoring station']].forEach(([k, word]) => {
    const n = count(k); if (n) bits.push(`${n} ${word}${n === 1 ? '' : 's'}`);
  });
  if (count('barrier')) bits.push('a chemical barrier');
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
    case 'text':
      P.text(x, y, it.label || 'Label', { size: 22, bold: true, color: I.ink, halo: true });
      break;
  }
}

function planRectStyle(k) {
  const I = PLAN_INK;
  return k === 'house' ? { fill: I.building, stroke: I.ink, lw: 5 }
    : k === 'shed' ? { fill: I.shed, stroke: I.muted, lw: 3.5 }
    : k === 'deck' ? { fill: I.paper, stroke: I.muted, lw: 2.5, dash: [10, 6], hatch: '#C8D5E3' }
    : { fill: '#F5F7FA', stroke: I.muted, lw: 2.5, dash: [5, 6], hatch: '#AAB7C4' };
}

function planLineStyle(k) {
  const I = PLAN_INK;
  return k === 'barrier' ? { stroke: I.blue, lw: 9 }
    : k === 'untreated' ? { stroke: I.muted, lw: 6, dash: [14, 10] }
    : { stroke: I.muted, lw: 2.5, dash: [18, 6, 3, 6] };
}

function drawPlanRect(P, k, x, y, w, h, label) {
  const o = planRectStyle(k);
  P.poly(rectPts(x, y, w, h), { fill: o.fill });
  if (o.hatch) hatchSegments(x, y, w, h, 18).forEach(seg => P.poly(seg, { stroke: o.hatch, lw: 1.5, close: false }));
  P.poly(rectPts(x, y, w, h), { stroke: o.stroke, lw: o.lw, dash: o.dash });
  if (label) P.text(x + w / 2, y + h / 2, label, { size: k === 'house' ? 24 : 19, bold: k === 'house', color: k === 'house' ? PLAN_INK.ink : PLAN_INK.muted, halo: !!o.hatch });
}

function drawPlanLine(P, k, pts) {
  if (pts.length < 2) return;
  P.poly(pts, Object.assign({ close: false }, planLineStyle(k)));
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
function drawSitePlan(P, plan, opts = {}) {
  const items = ((plan && plan.items) || []).slice()
    .sort((a, b) => ((SITE_PLAN_SYMBOLS[a.k] || {}).z || 0) - ((SITE_PLAN_SYMBOLS[b.k] || {}).z || 0));
  items.forEach(it => {
    const sym = SITE_PLAN_SYMBOLS[it.k];
    if (!sym) return;
    if (sym.kind === 'rect') drawPlanRect(P, it.k, it.x, it.y, it.w, it.h, it.label);
    else if (sym.kind === 'line') {
      drawPlanLine(P, it.k, it.pts || []);
      if (it.label && it.pts && it.pts.length > 1) {
        const [a, b] = it.pts;
        P.text((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 20, it.label, { size: 19, color: PLAN_INK.muted, halo: true });
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
  drawPlanNorth(P, plan && plan.north);
}

// The keys a plan needs in its legend, in the order of SITE_PLAN_SYMBOLS.
function sitePlanLegendKeys(plan) {
  const used = new Set(((plan && plan.items) || []).map(it => it.k));
  return Object.keys(SITE_PLAN_SYMBOLS).filter(k => used.has(k) && SITE_PLAN_SYMBOLS[k].legend);
}

// A legend entry's swatch, centred on x, y.
function drawPlanSwatch(P, k, x, y) {
  const sym = SITE_PLAN_SYMBOLS[k];
  if (sym.kind === 'rect') drawPlanRect(P, k, x - 34, y - 22, 68, 44, '');
  else if (sym.kind === 'line') drawPlanLine(P, k, [[x - 36, y], [x + 36, y]]);
  else drawPlanSymbol(P, k, x, y, SITE_PLAN_STATIONS.includes(k) ? { n: '' } : {});
}

function sitePlanSVG(plan, opts = {}) {
  const P = svgPainter();
  if (opts.grid) {
    for (let x = 50; x < PLAN_W; x += 50) P.raw(`<line x1="${x}" y1="0" x2="${x}" y2="${PLAN_H}" stroke="${x % 250 ? '#EEF2F7' : '#DCE4EE'}" stroke-width="1.5"/>`);
    for (let y = 50; y < PLAN_H; y += 50) P.raw(`<line x1="0" y1="${y}" x2="${PLAN_W}" y2="${y}" stroke="${y % 250 ? '#EEF2F7' : '#DCE4EE'}" stroke-width="1.5"/>`);
  }
  drawSitePlan(P, plan, opts);
  if (opts.after) opts.after(P);
  return `<svg class="${opts.cls || 'site-plan-svg'}" viewBox="0 0 ${PLAN_W} ${PLAN_H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Site plan">${P.out.join('')}</svg>`;
}

// The legend as HTML, with each swatch drawn by the same code as the plan.
function sitePlanLegendHTML(plan, opts = {}) {
  const swatch = draw => { const P = svgPainter(); draw(P); return `<svg viewBox="-42 -30 84 60" aria-hidden="true">${P.out.join('')}</svg>`; };
  const count = k => ((plan && plan.items) || []).filter(it => it.k === k).length;
  // opts.stationsOnly keeps just the station symbols, for the small bait card.
  const rows = sitePlanLegendKeys(plan).filter(k => !opts.stationsOnly || SITE_PLAN_STATIONS.includes(k)).map(k => `<li>${swatch(P => drawPlanSwatch(P, k, 0, 0))}<span>${escapeHtml(SITE_PLAN_SYMBOLS[k].legend)}${SITE_PLAN_STATIONS.includes(k) ? ` (${count(k)})` : ''}</span></li>`);
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
function drawSitePlanPdf(doc, plan, { x, y, w, statuses } = {}) {
  const C = PDF_COLORS;
  const h = w * PLAN_H / PLAN_W;
  doc.setFillColor(255, 255, 255); doc.rect(x, y, w, h, 'F');
  drawSitePlan(pdfPainter(doc, x, y, w / PLAN_W), plan, { statuses });
  doc.setLineDashPattern([], 0);
  doc.setDrawColor(...C.rule); doc.setLineWidth(0.3); doc.rect(x, y, w, h);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...C.inkMuted);
  doc.text('Not to scale', x + 2.5, y + h - 2.5);
  return h;
}

// The legend at x, y, w wide, in columns: each symbol used, then the
// station colours when a visit's statuses are given. Returns its height.
function drawSitePlanLegendPdf(doc, plan, { x, y, w, cols = 3, statuses } = {}) {
  const C = PDF_COLORS;
  const count = k => ((plan && plan.items) || []).filter(it => it.k === k).length;
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
  let h = block('LEGEND', sitePlanLegendKeys(plan).map(k => [P => drawPlanSwatch(P, k, 0, 0),
    SITE_PLAN_SYMBOLS[k].legend + (SITE_PLAN_STATIONS.includes(k) ? ` (${count(k)})` : '')]), y);
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
const sitePlanEditor = { plan: null, tool: null, group: 'site', sel: null, drawing: null, drag: null, undo: [], onSave: null };

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
  E.group = 'site';
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
  E.plan.items = E.plan.items.filter(it => SITE_PLAN_SYMBOLS[it.k].kind !== 'line' || (it.pts || []).length > 1);
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
  document.getElementById('spGroups').innerHTML = Object.entries(SITE_PLAN_GROUPS).map(([g, name]) =>
    `<button type="button" role="tab" aria-selected="${E.group === g}" class="sp-group${E.group === g ? ' on' : ''}" onclick="setSitePlanGroup('${g}')">${name}</button>`).join('');
  const swatch = k => { const P = svgPainter(); drawPlanSwatch(P, k, 0, 0); return `<svg viewBox="-42 -30 84 60" aria-hidden="true">${k === 'text' ? '<text x="0" y="2" font-size="30" font-weight="800" text-anchor="middle" dominant-baseline="central" fill="#0C121C">Aa</text>' : P.out.join('')}</svg>`; };
  document.getElementById('spTools').innerHTML = Object.entries(SITE_PLAN_SYMBOLS).filter(([, s]) => s.group === E.group).map(([k, s]) =>
    `<button type="button" class="sp-tool${E.tool === k ? ' on' : ''}" aria-pressed="${E.tool === k}" onclick="setSitePlanTool('${k}')">${swatch(k)}<span>${s.label}</span></button>`).join('');
}

function sitePlanHint() {
  const E = sitePlanEditor;
  if (E.drawing) return 'Tap each corner of the line. Tap Finish line when it\'s done.';
  if (E.tool) {
    const s = SITE_PLAN_SYMBOLS[E.tool];
    return s.kind === 'rect' ? `Drag on the plan to draw the ${s.label.toLowerCase()}, or tap to drop one.`
      : s.kind === 'line' ? `Tap where the ${s.label.toLowerCase()} starts, then each corner.`
      : s.kind === 'station' ? `Tap the plan to place each ${s.label.toLowerCase()} station. They number themselves.`
      : `Tap the plan to place it.`;
  }
  if (E.sel) return 'Drag to move it. Name it below, or delete it.';
  return 'Pick a symbol below, then tap the plan. Tap something on the plan to move or name it.';
}

function renderSitePlanEditor() {
  const E = sitePlanEditor;
  const sel = E.plan.items.find(it => it.id === E.sel);
  document.getElementById('spCanvas').innerHTML = sitePlanSVG(E.plan, { grid: true, cls: 'site-plan-svg sp-edit', after: P => {
    if (E.drawing) {
      const it = E.plan.items.find(x => x.id === E.drawing);
      if (it) it.pts.forEach(p => P.circle(p[0], p[1], 9, { fill: PLAN_INK.paper, stroke: PLAN_INK.pink, lw: 3 }));
    }
    if (!sel) return;
    const b = sitePlanBounds(sel);
    P.poly(rectPts(b.x - 10, b.y - 10, b.w + 20, b.h + 20), { stroke: PLAN_INK.pink, lw: 3, dash: [10, 7] });
    if (SITE_PLAN_SYMBOLS[sel.k].kind === 'rect') P.circle(sel.x + sel.w, sel.y + sel.h, 16, { fill: PLAN_INK.pink, stroke: PLAN_INK.paper, lw: 4 });
  } });
  document.getElementById('spHint').textContent = sitePlanHint();
  document.getElementById('spFinishLine').hidden = !E.drawing;
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
  }
  document.getElementById('spLegend').innerHTML = sitePlanLegendHTML(E.plan);
  const sum = sitePlanSummary(E.plan);
  document.getElementById('spSummary').textContent = sum ? `The plan shows ${sum}.` : '';
}

function sitePlanBounds(it) {
  const sym = SITE_PLAN_SYMBOLS[it.k];
  if (sym.kind === 'rect') return { x: it.x, y: it.y, w: it.w, h: it.h };
  if (sym.kind === 'line') {
    const xs = it.pts.map(p => p[0]), ys = it.pts.map(p => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  const r = sym.kind === 'text' ? 0 : 26;
  const tw = sym.kind === 'text' ? Math.max(40, (it.label || 'Label').length * 12) : r;
  return { x: it.x - tw, y: it.y - (r || 14), w: tw * 2, h: (r || 14) * 2 };
}

function sitePlanPoint(e) {
  const r = document.querySelector('#spCanvas svg').getBoundingClientRect();
  return [(e.clientX - r.left) / r.width * PLAN_W, (e.clientY - r.top) / r.height * PLAN_H];
}

const planSnap = (v, g = PLAN_GRID) => Math.round(v / g) * g;
const planClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// The topmost item under a point, stations first.
function sitePlanHit(p) {
  const E = sitePlanEditor;
  const items = E.plan.items.slice().sort((a, b) => (SITE_PLAN_SYMBOLS[b.k].z || 0) - (SITE_PLAN_SYMBOLS[a.k].z || 0));
  const segDist = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1;
    const t = planClamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L, 0, 1);
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  return items.find(it => {
    const kind = SITE_PLAN_SYMBOLS[it.k].kind;
    if (kind === 'rect') return p[0] >= it.x && p[0] <= it.x + it.w && p[1] >= it.y && p[1] <= it.y + it.h;
    if (kind === 'line') return it.pts.some((a, i) => i && segDist(p, it.pts[i - 1], a) < 24);
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
  if (sym && sym.kind === 'line') {
    const gp = [planSnap(p[0]), planSnap(p[1])].map((v, i) => planClamp(v, 0, i ? PLAN_H : PLAN_W));
    let it = E.drawing && E.plan.items.find(x => x.id === E.drawing);
    if (it) {
      const last = it.pts[it.pts.length - 1];
      // Tapping the last corner again finishes the line.
      if (Math.hypot(last[0] - gp[0], last[1] - gp[1]) < 20) { finishSitePlanLine(); return; }
      pushSitePlanUndo(); it.pts.push(gp);
    } else {
      pushSitePlanUndo();
      it = { id: planId(), k: tool, pts: [gp] };
      E.plan.items.push(it); E.drawing = it.id;
    }
    renderSitePlanEditor();
    return;
  }
  if (sym && sym.kind === 'rect') {
    pushSitePlanUndo();
    const gp = [planSnap(p[0]), planSnap(p[1])];
    const it = { id: planId(), k: tool, x: gp[0], y: gp[1], w: 0, h: 0, label: sym.def.label };
    E.plan.items.push(it);
    E.drag = { mode: 'newrect', id: it.id, from: gp, moved: false };
    E.sel = it.id;
    return;
  }
  if (sym) {
    pushSitePlanUndo();
    const it = { id: planId(), k: tool, x: pt[0], y: pt[1] };
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
  E.drag = hit ? { mode: 'move', id: hit.id, start: p, orig: JSON.parse(JSON.stringify(hit)), moved: false, before: JSON.stringify(E.plan) } : null;
  renderSitePlanEditor();
}

function onSitePlanMove(e) {
  const E = sitePlanEditor, d = E.drag;
  if (!d) return;
  e.preventDefault();
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
    } else if (kind === 'line') {
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
  if (it && it.pts.length < 2) E.plan.items = E.plan.items.filter(x => x !== it);
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
  E.plan = Object.assign(newSitePlan(), { north: E.plan.north });
  E.sel = null; E.drawing = null;
  renderSitePlanEditor();
}

// The label box starts a fresh undo step each time it gains focus.
function onSitePlanLabelFocus(inp) { delete inp.dataset.undo; }
