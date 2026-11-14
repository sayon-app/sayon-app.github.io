// ── SAMPLE JOB ──────────────────────────────────────────────────────────────
// A finished, made-up job a new inspector can tap through before their first
// real one: the signed agreement, the report, the quote, the client's signed
// answer, the treatment record with its site plan and the certificate. It's
// built on this phone from the business's own details and prices, so every
// PDF looks like theirs, and each PDF is stamped SAMPLE (stampSamplePdf).
//
// It is an ordinary saved job with the id SAMPLE_JOB_ID (js/app/), kept on
// this phone only: it never goes to the account (supabaseSaveNow), the Due
// list, a backup or the last-visit offer, and anything sent from it goes to
// the business's own email, not a client (sampleJobSendTo). It's offered at
// the end of sign-up, on an empty Jobs list and in the menu, and can be
// removed and brought back any time. The address and client are made up.

const SAMPLE_JOB = {
  street: '14 Example Street', suburb: 'Epping', state: 'NSW', postcode: '2121',
  // The phone number is one the ACMA keeps for made-up uses, so it never
  // rings a real person; example.com never delivers mail.
  client: 'Jordan Sample', phone: '0491 570 156', email: 'jordan@example.com', fee: '330',
};

// Days before today each step happened, so the job always reads as recent.
const SAMPLE_DAYS = { inspected: 8, answered: 6, treated: 2 };

function sampleIsoDate(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function sampleTime(daysAgo, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}
// Four digits for a report or quote number, like the app's own (1000-9999).
function sampleDigits() {
  return String(Math.floor(Math.random() * 9000 + 1000));
}

// A signature drawn as a person would, from a few loops and a tail. seed
// picks the shape, so the inspector and the client sign differently.
function sampleSignature(seed) {
  const c = document.createElement('canvas');
  c.width = 600; c.height = 180;
  const x = c.getContext('2d');
  x.strokeStyle = '#0c121c'; x.lineWidth = 4; x.lineCap = 'round'; x.lineJoin = 'round';
  x.beginPath();
  const shapes = [
    [[40, 120], [70, 20, 110, 160, 150, 80], [180, 30, 200, 140, 240, 100], [270, 70, 290, 130, 330, 95], [380, 60, 420, 120, 470, 90], [510, 70, 540, 100, 570, 60]],
    [[50, 100], [60, 30, 130, 30, 120, 100], [110, 160, 60, 140, 90, 110], [140, 60, 200, 150, 250, 90], [290, 40, 320, 130, 360, 100], [420, 70, 480, 140, 560, 70]],
  ][seed % 2];
  x.moveTo(...shapes[0]);
  shapes.slice(1).forEach(b => x.bezierCurveTo(...b));
  x.stroke();
  // An underline flourish
  x.lineWidth = 3;
  x.beginPath(); x.moveTo(70 + seed * 20, 150); x.quadraticCurveTo(300, 132, 520, 146); x.stroke();
  return c.toDataURL('image/png');
}

// The report, as the inspector's note would have filled it.
function sampleReportData(inspector) {
  const inspected = sampleIsoDate(SAMPLE_DAYS.inspected);
  return {
    // Numbered on the day it was inspected and sent, as a real one would be.
    reportNumber: `SY-${inspected.replace(/-/g, '')}-${sampleDigits()}`,
    standard: 'AS 3660.2-2017',
    jobInspectionType: 'Annual — Existing Building',
    jobInspectionDate: inspected,
    jobInspectionTime: '09:00',
    jobFee: SAMPLE_JOB.fee,
    jobClientPhone: SAMPLE_JOB.phone,
    jobClientEmail: SAMPLE_JOB.email,
    jobOrderId: '', jobNotes: '',
    // The choices a spoken note fills these with (startEdit's lists).
    structureType: 'Detached house',
    height: 'Single storey',
    wallConstruction: 'Brick veneer',
    floorType: 'Concrete slab on ground',
    roofType: 'Tiled — concrete',
    constructionEra: '1985-2003',
    occupancyStatus: 'Owner occupied',
    furnishing: 'Fully furnished',
    peoplePresent: 'Client',
    weatherConditions: 'Fine and dry',
    toolsUsed: 'Moisture meter and sounding tool',
    facadeDirection: 'North',
    siteSurroundings: 'Suburban, few trees',
    siteSlope: 'Flat',
    termiteHistory: 'None known',
    existingSystem: 'No system found',
    previousTreatment: 'NO',
    durableNoticePresent: 'NO',
    softLandscaping: 'YES',
    areaStatus: { interior: 'INSPECTED', exterior: 'INSPECTED', subfloor: 'NA', roofvoid: 'PARTIAL', outbuildings: 'NA', site: 'INSPECTED', fences: 'INSPECTED', retainingwalls: 'NA', landscapingtimbers: 'NA' },
    areaResult: { interior: 'FOUND', exterior: 'FOUND', roofvoid: 'CLEAR', site: 'FOUND', fences: 'CLEAR' },
    areaReasons: { roofvoid: ['Low clearance'] },
    obstructions: 'Roof Void (inspected with limits)',
    restrictedAccess: 'Roof Void: Low clearance',
    findings: [
      { id: 'f_sample_1', termiteActivity: 'ACTIVE', species: 'Coptotermes acinaciformis',
        activityLocation: 'Laundry, the door frame and skirting on the eastern wall',
        timberAffected: 'Door frame and skirting board',
        damageDescription: 'Live termites when the skirting was sounded and probed; mud leading up from the slab edge on the outside wall; timber hollow behind the paint along about 1 m of skirting. Refer to a builder to repair the frame and skirting once treated.',
        nestLocated: 'NO', structuralConcern: 'NO' },
      { id: 'f_sample_2', termiteActivity: 'INACTIVE', species: null,
        activityLocation: 'Stump of a felled tree in the backyard, about 6 m from the house',
        timberAffected: 'Tree stump',
        damageDescription: 'Old workings in the stump; no live termites found when probed',
        nestLocated: 'NO', structuralConcern: 'NO' },
    ],
    borerActivity: 'NONE',
    decayFound: 'NO',
    delignification: 'NO',
    invasiveInspection: 'NO',
    waterLeaks: 'YES',
    leakLocation: 'Garden tap outside the laundry, dripping onto the slab edge',
    moistureReadings: 'YES',
    moistureTable: [
      { id: 'mr_sample_1', location: 'Laundry door frame', reading: '31%' },
      { id: 'mr_sample_2', location: 'Kitchen wall', reading: '14%' },
      { id: 'mr_sample_3', location: 'Bathroom wall', reading: '15%' },
    ],
    timberSoil: 'NO',
    slabEdge: 'OBSTRUCTED',
    weepHoles: 'BRIDGED',
    treatmentRecommended: 'YES',
    treatmentType: 'Treat the active termites in the laundry; then install a chemical soil barrier around the whole house',
    otherRecommendations: 'Fix the dripping garden tap; lower the garden bed on the eastern side below the slab edge and keep the weep holes clear',
    inspectionFrequency: 'Re-inspect 6 weeks after treatment, then every 12 months',
    riskLevel: 'HIGH',
    inspectorLicence: inspector.licence,
    inspectorSignature: inspector.signature,
    sitePlan: sampleSitePlan(false),
    photosBySection: { general: [], durable: [], obstructions: [], restrictions: [], findings: [], conducive: [], recommendations: [] },
  };
}

// The drawn site plan. The report's (treated false) is what the inspector
// saw: the house, the laundry where the termites were, the bridged weep
// holes behind the garden bed, the dripping tap and the old stump. The
// treatment record's is the same drawing with the barrier all round the
// house and the foamed laundry wall added, as a record started from the
// report's plan is. North is up and the street is at the top. 400 plan
// units across the house is 16 m. The laundry's marks sit on the east wall
// so their labels fall outside the house, clear of its walls, and the back
// fence clears the scale bar.
function sampleSitePlan(treated = true) {
  const treatment = [
    { id: 'ps_barrier', k: 'barrier', pts: [[290, 190], [710, 190], [710, 485], [290, 485]], loop: true, label: 'Trenched and rodded' },
    { id: 'ps_foam', k: 'treated', x: 688, y: 440, label: 'Foamed' },
  ];
  return { v: 1, north: 0, mpu: 0.04, items: [
    { id: 'ps_street', k: 'text', x: 500, y: 70, label: 'Example Street' },
    { id: 'ps_drive', k: 'driveway', x: 160, y: 120, w: 100, h: 330, label: 'Driveway' },
    { id: 'ps_house', k: 'house', x: 300, y: 200, w: 400, h: 275, label: 'House' },
    { id: 'ps_garden', k: 'garden', x: 728, y: 205, w: 45, h: 130, label: '' },
    { id: 'ps_bridge', k: 'bridge', x: 752, y: 300, label: 'Weep holes bridged' },
    { id: 'ps_found', k: 'activity', x: 688, y: 395, label: 'Laundry' },
    { id: 'ps_tap', k: 'tap', x: 740, y: 490, label: 'Dripping' },
    { id: 'ps_meter', k: 'notice', x: 310, y: 240, label: 'Meter box' },
    { id: 'ps_stump', k: 'tree', x: 470, y: 625, label: 'Old stump' },
    { id: 'ps_fence', k: 'fence', pts: [[60, 675], [940, 675]], label: 'Back fence' },
  ].concat(treated ? treatment : []) };
}

// The quote at the business's own prices, sent, then accepted and signed.
function sampleQuote(id, address, inspector, clientSignature) {
  const direct = newQuoteItem('direct', { detail: 'Laundry, the door frame and skirting on the eastern wall', source: 'Finding 1: active termites' });
  const barrier = newQuoteItem('barrier_lm', { qty: 57, detail: 'Trench and rod around the whole house', source: 'Recommendation: install a chemical soil barrier around the whole house' });
  const weep = newQuoteItem('weep_holes', { source: 'Conducive condition: weep holes bridged' });
  const followup = newQuoteItem('followup', { detail: 'Re-inspect 6 weeks after treatment', source: 'Recommendation: inspection frequency' });
  // Sent and accepted, so its prices count as checked. The sample never
  // teaches the business's price list (rememberQuotePrices).
  [direct, barrier, weep, followup].forEach(it => { it.priceSet = true; });
  const sentAt = sampleTime(SAMPLE_DAYS.inspected, '15:25');
  const q = {
    reportKey: id,
    number: `Q-${sampleIsoDate(SAMPLE_DAYS.inspected).replace(/-/g, '')}-${sampleDigits()}`,
    createdAt: sentAt - 5 * 60e3,
    updatedAt: sentAt,
    client: SAMPLE_JOB.client, clientPhone: SAMPLE_JOB.phone, clientEmail: SAMPLE_JOB.email,
    clientSeen: { client: SAMPLE_JOB.client, clientPhone: SAMPLE_JOB.phone, clientEmail: SAMPLE_JOB.email },
    address, sourceAddress: address,
    inspector: inspector.name,
    inspectionDate: sampleIsoDate(SAMPLE_DAYS.inspected),
    validDays: 30,
    gst: defaultQuoteGst(),
    problem: 'Live termites found (laundry, the door frame and skirting on the eastern wall). Signs of past termite activity (stump of a felled tree in the backyard). Conditions that invite termites: bridged weep holes, a concealed slab edge and moisture from a leak.',
    items: [direct, barrier, weep, followup],
    systemChoice: { options: ['barrier'], picked: 'barrier', added: [{ id: barrier.id }] },
    exclusions: 'Repair or replacement of termite-damaged timbers.\nRepair of the moisture source (garden tap outside the laundry) by a licensed plumber.',
    plan: {
      we: 'Treat the live termites in the laundry door frame and skirting to control the colony.\nTreat the soil around the house to form a continuous treated zone.\nClear the bridged weep holes.\nFit a durable notice in the meter box showing what was used and when.',
      owner: 'Fix the dripping garden tap outside the laundry.\nKeep garden beds, mulch and paving below the weep holes.\nLeave the treated areas undisturbed, and tell us before any building or landscaping work near them.',
      time: 'Half a day', service: '12 months', inspections: 'Re-inspect 6 weeks after treatment, then every 12 months',
    },
    paymentTerms: defaultPaymentTerms(),
    notes: QUOTE_DEFAULT_NOTES,
    spokenAt: 0,
  };
  const hash = quoteContentHash(q);
  Object.assign(q, { sentAt, sentHash: hash, issuedAt: sentAt, issuedHash: hash });
  q.answer = { status: 'accepted', by: SAMPLE_JOB.client, date: sampleIsoDate(SAMPLE_DAYS.answered), method: 'signed', note: '',
    at: sampleTime(SAMPLE_DAYS.answered, '18:40'), hash, signature: clientSignature };
  const treated = sampleIsoDate(SAMPLE_DAYS.treated);
  const nextInspection = new Date(treated + 'T00:00:00');
  nextInspection.setDate(nextInspection.getDate() + 42);
  q.treatment = {
    date: treated, start: '08:30', finish: '11:45',
    technician: inspector.name, licence: inspector.licence, supervisor: '', supervisorLicence: '',
    pest: 'Subterranean termites (Coptotermes acinaciformis)',
    weather: 'Fine and dry, 22°C',
    equipment: 'Foam applicator; trenching tools and rodding probe',
    methods: { direct: '', barrier: '57' },
    products: [
      { name: 'Termidor Foam', active: 'fipronil', batch: '', rate: 'Ready to use, no mixing (30 g makes about 1 L of foam)', amount: '1 can', life: '', where: 'Laundry door frame and skirting, eastern wall' },
      { name: 'Termidor HE', active: 'fipronil', batch: '', rate: '625 mL per 100 L water (0.06%)', amount: '300 L of mix', life: '8 years', where: 'Trenched and rodded around the whole house, 57 m' },
    ],
    areas: 'Laundry, the door frame and skirting on the eastern wall; the soil around the whole house',
    notTreated: '',
    site: { building: 'Single storey house, brick veneer, concrete tile roof', floor: 'Concrete slab on ground', surrounds: 'Garden bed on the eastern side; concrete driveway on the western side', existing: 'None found' },
    plan: sampleSitePlan(),
    notice: 'new', noticeWhere: 'Meter box',
    cautions: typeof TREATMENT_DEFAULT_CAUTIONS === 'string' ? TREATMENT_DEFAULT_CAUTIONS : '',
    nextInspection: `${nextInspection.getFullYear()}-${String(nextInspection.getMonth() + 1).padStart(2, '0')}-${String(nextInspection.getDate()).padStart(2, '0')}`,
    warranty: typeof treatmentWarrantyFromQuote === 'function' ? treatmentWarrantyFromQuote(q) : '', notes: '',
    signature: inspector.signature,
    at: sampleTime(SAMPLE_DAYS.treated, '11:50'),
  };
  q.certificateSentAt = sampleTime(SAMPLE_DAYS.treated, '12:05');
  // Invoiced the day of the work and paid two days later (js/invoice.js).
  if (typeof ensureInvoice === 'function') {
    const inv = ensureInvoice(q);
    inv.date = treated; inv.due = addDaysIso(treated, invoiceDays());
    inv.madeAt = inv.sentAt = sampleTime(SAMPLE_DAYS.treated, '12:10');
    inv.paidDate = addDaysIso(treated, 2); inv.paidAt = new Date(inv.paidDate + 'T10:00:00').getTime();
  }
  return q;
}

// Puts the sample on this phone's job list. False if the phone couldn't
// store it.
function addSampleJob() {
  const company = getCompanyDetails();
  const me = lastInspectorDetails();
  const inspector = { name: me.name || company.name || 'Your inspector', licence: me.licence || company.licence || '', signature: sampleSignature(0) };
  const address = formatAddress(SAMPLE_JOB.street, SAMPLE_JOB.suburb, SAMPLE_JOB.state, SAMPLE_JOB.postcode);
  const reportData = sampleReportData(inspector);
  const quote = sampleQuote(SAMPLE_JOB_ID, address, inspector, sampleSignature(1));
  const entry = {
    id: SAMPLE_JOB_ID, sample: true,
    address, jobAddress: SAMPLE_JOB.street, jobSuburb: SAMPLE_JOB.suburb, jobState: SAMPLE_JOB.state, jobPostcode: SAMPLE_JOB.postcode,
    client: SAMPLE_JOB.client, inspector: inspector.name,
    reportData, fieldNotes: {}, savedAt: Date.now(), cloudSavedAt: null, completion: 100, quote,
  };
  const reports = getSavedReports().filter(r => r.id !== SAMPLE_JOB_ID);
  reports.push(entry);
  if (!setSavedReports(reports)) return false;
  try {
    const all = JSON.parse(localStorage.getItem(quotesStorageKey()) || '{}');
    all[SAMPLE_JOB_ID] = quote;
    localStorage.setItem(quotesStorageKey(), JSON.stringify(all));
  } catch (e) {}
  return true;
}

// The parts that need the job open: the agreement's wording (from the
// business's own template) and the sent report's fingerprint.
function finishSampleJob() {
  const inspected = sampleIsoDate(SAMPLE_DAYS.inspected);
  const fee = agreementFeeText(SAMPLE_JOB.fee);
  reportData.agreement = {
    method: 'onsite', signerName: SAMPLE_JOB.client, signature: sampleSignature(1),
    signedAt: sampleTime(SAMPLE_DAYS.inspected, '08:55'), inspectionDate: inspected, fee, notes: '', standard: reportData.standard,
    text: fillAgreementText(getAgreementTemplate(), {
      company: getCompanyDetails().name || 'The inspecting company',
      client: SAMPLE_JOB.client, address: getFullAddress(), date: formatAgreementDate(inspected),
      standard: reportData.standard, inspectionType: agreementInspectionType(), fee: fee || 'As quoted.', notes: 'None.',
    }),
  };
  ensureReportNumber();
  reportData.sent = { at: sampleTime(SAMPLE_DAYS.inspected, '15:20'), fingerprint: reportFingerprint(), version: 1 };
  saveCurrentReport(true);
  // Opened again, so every banner and badge reads the finished job (the
  // agreement banner was drawn before the agreement was there).
  loadReport(SAMPLE_JOB_ID, true);
}

// Opens the sample job's page, putting the job on the phone first if it
// isn't there. from: where it was opened, for the usage count.
function openSampleJob(from) {
  saveOpenReportNow();
  const fresh = !getSavedReports().some(r => r.id === SAMPLE_JOB_ID);
  if (fresh && !addSampleJob()) return; // setSavedReports said why
  if (document.getElementById('dashboardOverlay').classList.contains('open')) closeDashboard();
  if (document.getElementById('sidebarPanel').classList.contains('open')) toggleDrawer();
  if (document.getElementById('app').style.display !== 'flex') openApp('inspect');
  loadReport(SAMPLE_JOB_ID, true);
  if (fresh) finishSampleJob();
  jobGo('job');
  track('sample_job_opened', { from: from || 'menu' });
}

// Takes the sample off the phone. It can be brought back from the menu.
function removeSampleJob() {
  const wasOpen = currentReportId === SAMPLE_JOB_ID;
  if (!setSavedReports(getSavedReports().filter(r => r.id !== SAMPLE_JOB_ID))) return;
  try {
    const all = JSON.parse(localStorage.getItem(quotesStorageKey()) || '{}');
    delete all[SAMPLE_JOB_ID];
    localStorage.setItem(quotesStorageKey(), JSON.stringify(all));
  } catch (e) {}
  if (wasOpen) startBlankReport();
  refreshJobsList();
  closeJobPage();
  openDashboard();
  showToast('Sample job removed. Bring it back from the menu any time', 'info');
  track('sample_job_removed');
}

// The note at the top of the sample's job page.
function sampleJobNoteHTML() {
  const me = sampleJobSendTo();
  return `<section class="sample-note">
      <div class="sample-note-tag">Sample job</div>
      <p>A made-up job from start to finish, so you can see what SAYON makes for your clients. Tap any step to open it, or Finalise job for the whole job in one PDF.${me ? ` Anything you send from here comes to you at ${escapeHtml(me)}, not a client.` : ''}</p>
      <button type="button" class="sample-note-remove" onclick="removeSampleJob()">Remove the sample</button>
    </section>`;
}

// Where an email from the sample goes: the business's own address, else the
// sign-in email.
function sampleJobSendTo() {
  return (getCompanyDetails().email || (authUser && authUser.email) || '').trim();
}
