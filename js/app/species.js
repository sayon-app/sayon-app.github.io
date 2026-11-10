// SAYON app: Species intelligence database.
// One of the js/app/ files, which share one global scope: they load as plain
// scripts in the order index.html lists them, so a top-level name declared in
// any of them can be used from the others once the page has loaded.

// ══════════════════════════════════════════════════════════════════════════
// SPECIES INTELLIGENCE DATABASE
// Research-backed data for Australian termite species
// ══════════════════════════════════════════════════════════════════════════
const SPECIES_DB = {
  'Coptotermes acinaciformis': {
    commonName: 'Subterranean Termite',
    family: 'Rhinotermitidae',
    distribution: 'Most widely distributed termite in Australia — found continent-wide except Tasmania and parts of coastal Victoria.',
    fieldID: [
      '🔑 MILKY FLUID TEST: Press a soldier with multigrips or a probe — a white milky fluid secretes from the fontanelle (a pore on the top of the head). This is the definitive on-site field test for Coptotermes. No other common Australian species does this.',
      '👀 DAMAGE PATTERN: Smooth, clean galleries running with the grain of the timber. Timber hollowed out leaving a thin outer shell — sounds hollow when sounded with a screwdriver handle. No grit or soil packed into the galleries.',
      '🪵 SURFACE SIGNS: Mud tubes on stumps, piers, and walls — often brown-grey, firm, and pencil-thin. Paint or plaster may blister or bubble where termites have hollowed the substrate behind it.',
      '⚠️ SECONDARY COLONY NOTE: Can establish above-ground satellite nests with zero soil contact where there is an alternative moisture source — roof leaks, wall-cavity plumbing leaks. If active Coptotermes are found in a roof void or high wall cavity with no obvious ground path, check for a nearby moisture source.',
    ],
    identification: [
      'Workers: cream-white, eyeless, 4–5mm',
      'Soldiers: pale body, teardrop-shaped head with large mandibles, 5–7mm',
      'KEY ID: When soldiers are pressed, a white milky fluid secretes from a pore (fontanelle) on the head — unique to Coptotermes',
      'Reproductives (alates): dark brown, 12mm with four large wings'
    ],
    nestTypes: [
      'Underground subterranean nests',
      'Root crown/base of living trees (eucalypts, peppercorns, English oaks)',
      'Subsidiary nests in wall cavities — especially near moisture sources',
      'Under concrete slabs and floor structures',
      'Can nest under patios and below ground-level masonry'
    ],
    behaviour: [
      'Forages day and night through extensive underground tunnel networks',
      'Workers travel up to 100m from the colony',
      'Prefers both softwoods (radiata pine) and hardwoods (ash, Tasmanian oak)',
      'Mud tubes visible on stumps, walls, piers — often the first sign of attack',
      'Hollows out timber leaving a thin exterior shell — sounds hollow when sounded',
      'Individual termites returned to colony after separation are accepted; termites from other colonies rejected'
    ],
    conduciveConditions: [
      'Leaking pipes, poor drainage, damp wood',
      'Decayed tree stumps in yard',
      'Timber-soil contact',
      'High moisture environments'
    ],
    treatmentOptions: [
      { product: 'Termidor (Fipronil)', type: 'Chemical Barrier', notes: 'Industry standard. Non-repellent, transfer effect, excellent soil binding. 8+ year protection. Preferred where moisture movement in soil.', toxicity: 'Moderate' },
      { product: 'Altriset (Chlorantraniliprole)', type: 'Chemical Barrier', notes: 'Lowest toxicity — exempt from poison scheduling in Australia. Paralyses muscles, stops feeding within hours. Up to 8 years. Higher cost.', toxicity: 'Very Low' },
      { product: 'Premise (Imidacloprid)', type: 'Chemical Barrier', notes: 'Non-repellent, water-soluble. Better soil penetration. Less durable in wet soils. Risk to bees/plants.', toxicity: 'Low–Moderate' },
      { product: 'Sentricon Baiting System', type: 'Bait Station', notes: 'Insect growth regulator. Slow-acting colony elimination. Useful where chemical barrier is not practical.', toxicity: 'Very Low' }
    ],
    specialFlags: [],
    fieldNotePrompts: [
      'Perform milky fluid test on soldiers — document result (positive = Coptotermes confirmed)',
      'Sound all accessible timbers in affected area — note extent of hollowing',
      'Check for subsidiary nests in wall cavities — common near moisture sources',
      'If found in roof void or high wall cavity, look for moisture source (leak, plumbing) nearby',
      'Inspect root crowns of trees within 50m of structure',
      'Document mud tube locations with photos if possible',
      'Recommend licensed builder assessment for structural integrity of damaged timbers'
    ]
  },

  'Coptotermes frenchi': {
    commonName: 'Subterranean Termite',
    family: 'Rhinotermitidae',
    distribution: 'Southern Australian states — common in Victoria, parts of NSW and SA. Less common than C. acinaciformis.',
    fieldID: [
      '🔑 MILKY FLUID TEST: Same as C. acinaciformis — press a soldier and check for white milky fluid from the fontanelle. Confirms genus (Coptotermes). Species differentiation between frenchi and acinaciformis requires specialist examination.',
      '👀 DAMAGE PATTERN: Similar to C. acinaciformis — smooth clean galleries with the grain, hollow-sounding timber. Geography and host tree preference assist in species confirmation.',
      '🌳 HOST PREFERENCE: More commonly associated with specific host trees — Eucalyptus melliodora (yellow box), E. polyanthemos (red box). If these are present on or near the property, note them.',
    ],
    identification: [
      'Very similar to C. acinaciformis — specialist identification required',
      'Soldiers: pale body, teardrop-shaped head, 5–7mm',
      'KEY ID: Milky fluid from fontanelle when pressed — same as C. acinaciformis',
      'Geography and host tree preference assist species confirmation'
    ],
    nestTypes: [
      'Root crowns and bases of living trees',
      'Underground subterranean nests',
      'Timber stumps'
    ],
    behaviour: [
      'Mainly a forest pest but can invade buildings',
      'Attacks both hardwood and softwood',
      'Not as aggressive as C. acinaciformis'
    ],
    conduciveConditions: ['Decayed timber', 'Moisture', 'Tree stumps near structure'],
    treatmentOptions: [
      { product: 'Termidor (Fipronil)', type: 'Chemical Barrier', notes: 'Non-repellent, transfer effect. Industry standard for Coptotermes species.', toxicity: 'Moderate' },
      { product: 'Altriset (Chlorantraniliprole)', type: 'Chemical Barrier', notes: 'Low toxicity alternative. Stops feeding within hours.', toxicity: 'Very Low' }
    ],
    specialFlags: [],
    fieldNotePrompts: [
      'Perform milky fluid test on soldiers — confirms Coptotermes genus',
      'Note nearby tree species — yellow box, red box are typical hosts for C. frenchi',
      'Confirm species where possible — C. frenchi and C. acinaciformis require specialist differentiation',
      'Check root crowns of nearby trees',
      'Sound all accessible timber in affected area'
    ]
  },

  'Schedorhinotermes': {
    commonName: 'Subterranean Termite',
    family: 'Rhinotermitidae',
    distribution: 'Widespread across eastern Australia. Most common damaging species in some regions including coastal NSW and QLD.',
    fieldID: [
      '🔑 TWO SOLDIER CASTES — KEY FIELD TEST: Look carefully at the soldiers. Schedorhinotermes is the ONLY common Australian genus with two distinct soldier sizes in the same colony. Major soldiers (5–7.5mm, large bulbous head) and minor soldiers (3–5.5mm, narrower head). If you see both sizes, this confirms the genus.',
      '👀 DAMAGE PATTERN: Patchy, irregular damage with large gouges — particularly around nails, screws and fixings where the timber is softer. Unlike Coptotermes (smooth galleries with the grain), Schedorhinotermes damage often looks more chaotic and chewed.',
      '🏗️ WORKINGS: Characteristic fragile plaster-like earthen deposits covering galleries — brownish-grey, finer texture than Coptotermes mud tubes. Easily crumbled between fingers. Often called "plastering".',
      '⚠️ DO NOT DISTURB: Schedorhinotermes is highly skittish. If you disturb active workings during the inspection, the colony may relocate before treatment can be applied. Minimise exposure of active galleries.',
    ],
    identification: [
      'TWO soldier castes — key distinguishing feature:',
      'Major soldiers: 5–7.5mm, bulbous head, large mandibles',
      'Minor soldiers: 3–5.5mm, narrower head, slender mandibles — appear first in developing colony',
      'Characteristic "plastering" earthen workings — fragile plaster-like deposits covering their galleries',
      'White cigar-shaped body, pale to dark brown head on both castes'
    ],
    nestTypes: [
      'Tree stumps and root crowns of living trees',
      'Under patios, fireplaces and buried timber',
      'Under houses — multiple small nest sites rather than one central nest',
      'Queen lays eggs one at a time (unlike other species) — slower colony development'
    ],
    behaviour: [
      'VERY SKITTISH — will relocate entire colony if disturbed during treatment',
      'Creates multiple satellite nests — difficult to fully locate',
      'Attack is concealed under characteristic fragile plastering',
      'Queens and kings can live over 20 years',
      'Workers and soldiers live 1–2 years'
    ],
    conduciveConditions: ['Tree stumps', 'Buried timber', 'Subfloor moisture', 'Timber-soil contact'],
    treatmentOptions: [
      { product: 'Termidor (Fipronil)', type: 'Chemical Barrier', notes: 'Non-repellent essential — repellent chemicals will cause colony relocation. Full perimeter treatment required.', toxicity: 'Moderate' },
      { product: 'Altriset (Chlorantraniliprole)', type: 'Chemical Barrier', notes: 'Non-repellent, low toxicity. Stops feeding within hours. Preferred where minimal disturbance required.', toxicity: 'Very Low' }
    ],
    specialFlags: [
      { type: 'warning', icon: '⚠', text: 'DO NOT DISTURB — Schedorhinotermes is highly skittish. Any disturbance to active workings during inspection or treatment may cause the colony to relocate to an untreated area of the property. Avoid drilling, hammering, or directly exposing active galleries where possible until treatment strategy is confirmed.' }
    ],
    fieldNotePrompts: [
      'Note whether BOTH major AND minor soldiers are present — two castes confirm genus, major soldiers indicate mature colony',
      'Describe plastering deposit locations and texture — photograph all visible deposits',
      'Note damage pattern — look for gouging around nails/fixings, which is characteristic of this genus',
      'Check for multiple nest sites — stumps, under patio, subfloor, fireplaces',
      'Advise client: DO NOT disturb active workings until treatment is underway',
      'Only use non-repellent treatments — repellent chemicals will cause colony relocation'
    ]
  },

  'Schedorhinotermes intermedius': {
    commonName: 'Subterranean Termite',
    family: 'Rhinotermitidae',
    distribution: 'Eastern coastline of Australia. Common throughout NSW, QLD, VIC.',
    fieldID: [
      '🔑 TWO SOLDIER CASTES: Major soldiers (larger, bulbous head) and minor soldiers (smaller, narrower head) present together — confirms Schedorhinotermes genus. Minor soldiers appear first in young colonies; presence of majors = well-established colony.',
      '👀 DAMAGE PATTERN: Patchy gouging damage particularly around nails and fixings. Fragile plaster-like earthen workings (plastering) covering galleries — crumbles easily when disturbed.',
      '⚠️ SKITTISH — DO NOT DISTURB active workings. Colony will relocate if galleries are exposed.',
    ],
    identification: [
      'Major soldiers: bulbous head, 5–7.5mm',
      'Minor soldiers: narrower head, ~4mm — appear first in young colonies',
      'Characteristic fragile plaster-like earthen workings',
      'Very similar to other Schedorhinotermes species'
    ],
    nestTypes: ['Tree stumps', 'Root crowns', 'Under properties and patios', 'Under fireplaces'],
    behaviour: [
      'VERY SKITTISH — colony will relocate if disturbed',
      'Multiple nest sites make full elimination difficult',
      'Major soldiers indicate an established colony'
    ],
    conduciveConditions: ['Tree stumps', 'Subfloor moisture', 'Timber-soil contact'],
    treatmentOptions: [
      { product: 'Termidor (Fipronil)', type: 'Chemical Barrier', notes: 'Non-repellent — critical for skittish species. Full perimeter.', toxicity: 'Moderate' },
      { product: 'Altriset (Chlorantraniliprole)', type: 'Chemical Barrier', notes: 'Non-repellent, lowest toxicity. Ideal for sensitive situations.', toxicity: 'Very Low' }
    ],
    specialFlags: [
      { type: 'warning', icon: '⚠', text: 'DO NOT DISTURB — Schedorhinotermes intermedius will relocate if colony is disturbed. Use non-repellent treatments only. Avoid directly exposing galleries before treatment.' }
    ],
    fieldNotePrompts: [
      'Note presence of major vs minor soldiers — major soldiers = mature colony',
      'Document all plastering deposit locations — photograph each one',
      'Note damage pattern — gouging around nails/fixings is characteristic',
      'Advise client not to disturb affected areas prior to treatment',
      'Confirm non-repellent treatment only — repellent chemicals cause relocation'
    ]
  },

  'Nasutitermes walkeri': {
    commonName: 'Tree Termite',
    family: 'Termitidae',
    distribution: 'Eastern NSW and southeastern QLD. Found in mountains and coastal scrubland/wooded areas.',
    fieldID: [
      '🔑 POINTED SNOUT (NASUS): Nasutitermes soldiers have a distinctive pointed tube-like snout (nasus) on the front of the head instead of mandibles. They spray a sticky, amber-coloured defensive chemical from this snout when threatened — look for this if disturbed.',
      '👀 DARK MUD COVERING: Nasutitermes cover their workings and attacked timber with spacious, dark brown to black earthen material — distinctive dark mud galleries, often more open and roomy than Coptotermes workings. This dark colouring is a visual field ID marker.',
      '🌳 ARBOREAL NEST: Look for a brown papery-looking nest attached to a tree branch or trunk within 100m of the structure. Nasutitermes walkeri builds visible above-ground arboreal nests, typically in ironbark, stringybark, or tallowwood.',
    ],
    identification: [
      'Soldiers: rounded heads, long straight mandibles, yellowish-brown bodies, 5–7mm',
      'KEY ID: Pointed snout (nasus) on soldiers — sprays sticky defensive chemical instead of biting',
      'Arboreal nest visible on ironbark, stringybark, tallowwood trees',
      'Galleries extend down the trunk to maintain soil contact'
    ],
    nestTypes: [
      'Arboreal (tree) nests — attached to branches, commonly ironbark, stringybark, tallowwood',
      'Nest maintains soil contact via galleries running down tree trunk',
      'Kingfishers and lizards sometimes inhabit old nests'
    ],
    behaviour: [
      'Feeds on dead, decayed and weathered timber',
      'Can attack sound timber in buildings if given enough time undisturbed',
      'Nests are visible — easier to locate than subterranean species',
      'Covers attacked timber with characteristic dark brown to black earthen mud'
    ],
    conduciveConditions: ['Decayed timber', 'Weathered hardwood', 'Tree contact with structure'],
    treatmentOptions: [
      { product: 'Direct Nest Injection', type: 'Nest Treatment', notes: 'Locate arboreal nest in nearby trees. Inject nest and soil galleries with registered termiticide.', toxicity: 'Moderate' },
      { product: 'Termidor (Fipronil)', type: 'Chemical Barrier', notes: 'If nest cannot be located or eliminated, chemical barrier treatment around structure.', toxicity: 'Moderate' }
    ],
    specialFlags: [],
    fieldNotePrompts: [
      'Look for arboreal nest in nearby trees — check ironbark, stringybark, tallowwood within 100m',
      'Note whether nest has soil contact via trunk galleries',
      'Document the dark mud covering on attacked timber — photograph it',
      'Note whether the attack is on decayed or sound timber',
      'Check whether galleries run from tree trunk down to ground and into structure'
    ]
  },

  'Nasutitermes exitiosus': {
    commonName: 'Snouted Termite',
    family: 'Termitidae',
    distribution: 'Southern QLD to NSW and Victoria, ACT region. Common in Canberra. Builds low mounds in open ground near eucalypts.',
    fieldID: [
      '🔑 POINTED SNOUT (NASUS): Like all Nasutitermes — soldiers have a pointed tube-like snout that sprays defensive chemical. No mandibles. Amber sticky fluid sprayed when threatened.',
      '👀 DARK MUD COVERING: Attacked timber is covered in spacious, very dark (brown to black) earthen galleries — distinctive visual field marker for this genus.',
      '⛰️ MOUND NEST: N. exitiosus builds distinctive low dome-shaped mounds above ground — 30–75cm high, 30–120cm wide base. Check open ground near eucalypts within 60m of the structure. The mound is often the easiest way to confirm this species.',
    ],
    identification: [
      'Soldiers: dark, almost black head, pointed nasute snout, 4–6mm',
      'Workers: cream-coloured, soft-bodied, eyeless',
      'Alates: 8–10mm, darker brown, compound eyes, four pale wings — emerge after rain',
      'Mound nests: dome-shaped, 30–75cm high, 30–120cm wide basal diameter',
      'Queen size 25–30mm — visible when mound is opened at ground level'
    ],
    nestTypes: [
      'Dome-shaped mounds above ground (30–75cm high)',
      'In drier areas: underground or in tree stumps/stumps leaving bare earth',
      'Wall cavities and under floors in some cases',
      'Nests under properties often undetected until floor collapses'
    ],
    behaviour: [
      'Feeds primarily on hardwoods — prefers sapwood',
      'Workers travel up to 50–60m from the nest',
      'Pine timbers are resistant to attack by this species',
      'Mound nests in urban areas less common — easier to spot and treat',
      'Covers attacked timber with characteristic dark to black earthen material'
    ],
    conduciveConditions: ['Hardwood timber in ground contact', 'Decayed wood', 'Proximity to eucalypts'],
    treatmentOptions: [
      { product: 'Direct Mound Injection', type: 'Nest Treatment', notes: 'Locate and inject the mound directly with registered termiticide. Inject surrounding soil. Usually straightforward since nest is visible.', toxicity: 'Moderate' },
      { product: 'Termidor (Fipronil)', type: 'Chemical Barrier', notes: 'Full perimeter treatment if mound cannot be directly treated.', toxicity: 'Moderate' }
    ],
    specialFlags: [],
    fieldNotePrompts: [
      'Look for dome-shaped mound nest in open ground near eucalypts within 60m',
      'Note mound dimensions, condition, and whether it appears active',
      'Document dark mud covering on attacked timber — photograph it',
      'Check under floors if no mound found above ground — can nest below floor level',
      'Note timber type attacked — hardwood sapwood is preferred; pine timbers are resistant'
    ]
  },

  'Mastotermes darwiniensis': {
    commonName: 'Giant Northern Termite / Darwin Termite',
    family: 'Mastotermitidae',
    distribution: 'Northern Australia only — confined north of Tropic of Capricorn (tropical NT, far north QLD, northern WA). NOT found in southern states.',
    identification: [
      'Largest Australian termite species: 11–13mm body length',
      'Rounded yellow to reddish-brown head, short black mandibles',
      'Soldiers: long rectangular heads',
      'Most primitive living termite — shows similarities to cockroaches',
      'Lays eggs in bunches (like cockroaches) rather than singly',
      'Wings similar in design to cockroach wings'
    ],
    nestTypes: [
      'Subterranean nests — inconspicuous, NOT mound-building',
      'May also nest in trees or on top of posts',
      'Small ground mounds in some situations'
    ],
    behaviour: [
      'Eats almost anything organic: timber, leather, plastic, bagged salt, flour, damaged ivory, vegetation',
      'Can ringbark living trees by boring up into the trunk',
      'Agricultural pest of major significance — vegetable farming abandoned in parts of northern Australia',
      'Given irrigation and favourable conditions, colonies can reach millions rapidly',
      'Attacks building timbers and contents as well as living trees'
    ],
    conduciveConditions: ['Irrigation', 'Stored timber', 'Any organic material', 'Warm tropical conditions'],
    treatmentOptions: [
      { product: 'Specialist Treatment Required', type: 'Specialist', notes: 'Consult a specialist experienced with M. darwiniensis. Check each product label: not every bait or termiticide is registered for this species.', toxicity: 'Varies' }
    ],
    specialFlags: [
      { type: 'danger', icon: '🚨', text: 'SPECIALIST TREATMENT — Treatment for Mastotermes darwiniensis should be planned by a specialist experienced with this species. Check each product label, as not every bait or termiticide is registered for it. Refer any timber damage to a builder or engineer.' },
      { type: 'info', icon: 'ℹ', text: 'LOCATION CHECK — M. darwiniensis is confined to northern Australia (north of Tropic of Capricorn). If found in southern states, confirm identification — possible misidentification or transported specimen.' }
    ],
    fieldNotePrompts: [
      'Confirm property location is north of Tropic of Capricorn — species distribution limited',
      'Document all materials affected — M. darwiniensis attacks a wide range of organic materials, not just timber',
      'Assess colony size — colonies under favourable conditions can be enormous',
      'Refer treatment to a specialist experienced with M. darwiniensis'
    ]
  },

  'Cryptotermes brevis': {
    commonName: 'West Indian Drywood Termite',
    family: 'Kalotermitidae',
    distribution: "Invasive species — found in QLD (particularly around Maryborough/Brisbane). Listed under Australia's Biosecurity Act 2015. Regularly intercepted at Australian border.",
    identification: [
      'Soldiers: 4–6mm, cigar-shaped white body, head is sloping and rough (phragmotic)',
      'Mandibles: very short and broad — distinctive',
      'No fontanelle present on head',
      'KEY ID: Does NOT require soil contact — lives entirely within dry timber',
      'Frass (faecal pellets) found near infested timber — key sign of drywood termite'
    ],
    nestTypes: [
      'Lives entirely within dry timber — no soil contact required',
      'Can infest construction timber, furniture, picture frames, wooden vessels',
      'Multiple colonies can exist independently in same building',
      'Can survive and be transported in furniture and goods'
    ],
    behaviour: [
      'Does not need free water or soil contact — unique among major pest species',
      'Forms colonies, feeds and reproduces within a single piece of wood',
      'Cannot be detected by standard moisture meter methods',
      'Frass (pellets) ejected from small holes in timber surface',
      'Infested items can transport the species — a biosecurity risk'
    ],
    conduciveConditions: ['Imported timber', 'Second-hand furniture', 'Any dry timber'],
    treatmentOptions: [
      { product: 'Whole-Building Fumigation', type: 'Fumigation', notes: 'Wrapping entire building in plastic and fumigating with sulfuryl fluoride. Required when multiple colonies present throughout the structure. Expensive and disruptive but thorough.', toxicity: 'High (during application)' },
      { product: 'Localised Treatment', type: 'Spot Treatment', notes: 'Injection of insecticide into gallery entry holes in affected timber. Suitable for single or limited infestations. Requires thorough survey to confirm scope.', toxicity: 'Moderate' },
      { product: 'Heat Treatment', type: 'Physical', notes: 'Heating structure or items to specific temperature to kill termites. Energy-intensive, requires specialised equipment.', toxicity: 'None' }
    ],
    specialFlags: [
      { type: 'danger', icon: '🚨', text: 'NOTIFIABLE PEST — In Queensland, West Indian drywood termite is restricted matter under the Biosecurity Act 2014 (Qld): report it to Biosecurity Queensland within 24 hours on 13 25 23. In NSW, owners have a duty under the Biosecurity Act 2015 (NSW) to prevent its spread: report it to NSW DPI. In other states, report it to the state biosecurity authority. Do not remove any infested timber or furniture from the property until directed by the authority.' },
      { type: 'warning', icon: '⚠', text: 'BIOSECURITY RISK — Infested furniture, timber or materials must not be moved from the property. Transportation of infested goods is how this species spreads. Advise client immediately.' }
    ],
    fieldNotePrompts: [
      'Document all infested items — timber members, furniture, frames, picture frames',
      'Look for frass (small pellets) ejected from holes in timber surface — key diagnostic sign',
      'Survey entire building — multiple independent colonies likely',
      'NOTIFY appropriate state biosecurity authority — required by law',
      'Advise client: do not remove any items from property until authorities confirm'
    ]
  },

  'Porotermes adamsoni': {
    commonName: 'Common Dampwood Termite',
    family: 'Termopsidae',
    distribution: 'Southern coastal Australia — southern QLD to SA including ACT and Tasmania.',
    identification: [
      'Large species: workers and soldiers 10–15mm — noticeably larger than subterranean termites',
      'Pale-brown to reddish head, soft body typical of dampwood species',
      'Requires moist, decaying timber — key habitat indicator'
    ],
    nestTypes: [
      'Moist, decaying timber — trees, logs, garden structures',
      'Occasionally structural timber with persistent moisture issues'
    ],
    behaviour: [
      'Requires high moisture — not a threat to dry, well-maintained timber',
      'Associated with decayed and damp timber in houses',
      'Less mobile than subterranean species'
    ],
    conduciveConditions: ['Persistent leaks', 'Decayed timber', 'Poor ventilation', 'High subfloor moisture'],
    treatmentOptions: [
      { product: 'Structural Remediation', type: 'Physical', notes: 'PRIMARY TREATMENT — remove or replace affected decayed timber, eliminate moisture source. Termiticides are NOT registered for P. adamsoni control.', toxicity: 'None' },
      { product: 'Moisture Source Elimination', type: 'Environmental', notes: 'Address all moisture sources — plumbing leaks, drainage, ventilation. Without moisture, the species cannot sustain a colony in the structure.', toxicity: 'None' }
    ],
    specialFlags: [
      { type: 'warning', icon: '⚠', text: 'TREATMENT LIMITATION — Modern termiticides are NOT registered for the control of Porotermes adamsoni. Treatment is primarily structural: remove affected timber, eliminate all moisture sources, and improve ventilation. Termiticide application is not the appropriate response for this species.' }
    ],
    fieldNotePrompts: [
      'Identify and document all moisture sources — plumbing leaks, drainage issues, ventilation problems',
      'Note extent of timber decay — document which structural members are affected',
      'Advise plumber/builder assessment to eliminate moisture source as primary remediation',
      'Standard chemical barrier treatment is NOT appropriate — advise client accordingly'
    ]
  },

  'Heterotermes': {
    commonName: 'Subterranean Termite',
    family: 'Rhinotermitidae',
    distribution: 'Found across mainland Australia. More significant pest in northern Australia.',
    identification: [
      'Soldiers: similar appearance to Coptotermes but HEAD IS LONGER AND MORE RECTANGULAR',
      'Coptotermes soldiers have a teardrop-shaped head — key differentiation',
      'Often confused with Coptotermes in the field'
    ],
    nestTypes: ['Subterranean', 'Tree stumps', 'Decayed wood in soil'],
    behaviour: [
      'Forages underground like Coptotermes',
      'Less aggressive than Coptotermes in most regions',
      'Significant concern in northern Australia'
    ],
    conduciveConditions: ['Timber-soil contact', 'Moisture', 'Decayed wood'],
    treatmentOptions: [
      { product: 'Termidor (Fipronil)', type: 'Chemical Barrier', notes: 'Standard non-repellent chemical barrier treatment.', toxicity: 'Moderate' },
      { product: 'Altriset (Chlorantraniliprole)', type: 'Chemical Barrier', notes: 'Low toxicity alternative.', toxicity: 'Very Low' }
    ],
    specialFlags: [
      { type: 'info', icon: 'ℹ', text: 'IDENTIFICATION NOTE — Heterotermes soldiers are often confused with Coptotermes. Key difference: Heterotermes soldiers have a longer, more rectangular head vs the teardrop shape of Coptotermes. Confirm identification before finalising treatment recommendation.' }
    ],
    fieldNotePrompts: [
      'Confirm species identification — distinguish from Coptotermes by soldier head shape',
      'Document location and extent of activity'
    ]
  },

  'Microcerotermes': {
    commonName: 'Termite',
    family: 'Termitidae',
    distribution: 'Most of mainland Australia. Species distribution varies: M. turneri (east coast QLD to Port Macquarie NSW), M. distinctus (inland NSW/VIC), M. serratus (QLD, WA, NT, SA).',
    fieldID: [
      '👀 NEST TYPE: Look for a visible mound or arboreal nest. Microcerotermes may build low on-ground mounds, underground nests, or small arboreal mounds with distinctive stalactite-like projections — sometimes found on fence posts or halfway up tree trunks.',
      '🔑 SOLDIER HEAD: Rectangular head profile on soldiers — broader and more box-shaped than the rounded or teardrop heads of Coptotermes/Schedorhinotermes. No milky fluid (unlike Coptotermes) and no pointed snout (unlike Nasutitermes).',
      '🪵 TIMBER ATTACKED: Predominantly hardwood — check hardwood fences, posts, and structural timbers. Less likely to attack softwood (pine).',
    ],
    identification: [
      'Soldiers: rectangular head',
      'Various nesting habits — on-ground mounds, underground, or arboreal mounds with stalactite-like formations',
      'Arboreal mounds sometimes found on fence posts or halfway up tree trunks'
    ],
    nestTypes: [
      'Some species build on-ground mounds',
      'Others nest underground',
      'Others build distinctive arboreal mounds with stalactites'
    ],
    behaviour: ['Damages hardwood timber', 'Less aggressive than major pest species'],
    conduciveConditions: ['Timber-soil contact', 'Decayed wood', 'Hardwood structures'],
    treatmentOptions: [
      { product: 'Termidor (Fipronil)', type: 'Chemical Barrier', notes: 'Standard chemical barrier treatment.', toxicity: 'Moderate' },
      { product: 'Direct Nest Treatment', type: 'Nest Treatment', notes: 'If mound/nest is visible and accessible, direct injection is effective.', toxicity: 'Moderate' }
    ],
    specialFlags: [],
    fieldNotePrompts: [
      'Note nesting type — on-ground mound, underground, or arboreal with stalactites',
      'Check fence posts and hardwood timber structures in yard',
      'Document affected timber type and extent'
    ]
  }
};

// Fuzzy matching keys — maps common shorthand and variations to full species entries
const SPECIES_ALIASES = {
  'coptotermes': 'Coptotermes acinaciformis',
  'coptotermes acinaciformis': 'Coptotermes acinaciformis',
  'c. acinaciformis': 'Coptotermes acinaciformis',
  'acinaciformis': 'Coptotermes acinaciformis',
  'coptotermes frenchi': 'Coptotermes frenchi',
  'c. frenchi': 'Coptotermes frenchi',
  'frenchi': 'Coptotermes frenchi',
  'schedorhinotermes': 'Schedorhinotermes',
  'schedorhinotermes intermedius': 'Schedorhinotermes intermedius',
  'schedorhinotermes spp': 'Schedorhinotermes',
  'schedorhinotermes spp.': 'Schedorhinotermes',
  's. intermedius': 'Schedorhinotermes intermedius',
  'nasutitermes walkeri': 'Nasutitermes walkeri',
  'n. walkeri': 'Nasutitermes walkeri',
  'walkeri': 'Nasutitermes walkeri',
  'nasutitermes exitiosus': 'Nasutitermes exitiosus',
  'n. exitiosus': 'Nasutitermes exitiosus',
  'exitiosus': 'Nasutitermes exitiosus',
  'nasutitermes': 'Nasutitermes exitiosus',
  'nasutitermes spp': 'Nasutitermes exitiosus',
  'nasutitermes spp.': 'Nasutitermes exitiosus',
  'mastotermes': 'Mastotermes darwiniensis',
  'mastotermes darwiniensis': 'Mastotermes darwiniensis',
  'giant northern termite': 'Mastotermes darwiniensis',
  'darwin termite': 'Mastotermes darwiniensis',
  'cryptotermes': 'Cryptotermes brevis',
  'cryptotermes brevis': 'Cryptotermes brevis',
  'west indian drywood': 'Cryptotermes brevis',
  'drywood termite': 'Cryptotermes brevis',
  'porotermes': 'Porotermes adamsoni',
  'porotermes adamsoni': 'Porotermes adamsoni',
  'dampwood termite': 'Porotermes adamsoni',
  'heterotermes': 'Heterotermes',
  'heterotermes spp': 'Heterotermes',
  'microcerotermes': 'Microcerotermes',
  'microcerotermes spp': 'Microcerotermes',
  'microcerotermes spp.': 'Microcerotermes',
};

function lookupSpecies(raw) {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/\.$/, '');
  const words = key.split(/\s+/);
  const canonical = SPECIES_ALIASES[key] || SPECIES_ALIASES[words.slice(0,2).join(' ')];
  if (canonical && SPECIES_DB[canonical]) return { name: canonical, data: SPECIES_DB[canonical] };
  // A species the guide doesn't cover gets its genus card when the guide has
  // one, and otherwise nothing. Never another species' card: Cryptotermes
  // primus is native, and must not get C. brevis's notifiable-pest warning.
  const genus = Object.keys(SPECIES_DB).find(n => !n.includes(' ') && n.toLowerCase() === words[0]);
  return genus ? { name: genus, data: SPECIES_DB[genus] } : null;
}
