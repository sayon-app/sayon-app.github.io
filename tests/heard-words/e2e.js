// The words the phone or Whisper keeps mishearing come back right in the
// note (correctKnownMishearings in js/app/voice.js), and ordinary words that
// look like them are left alone. No browser: the function is read from the file.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'app', 'voice.js'), 'utf8');
const start = src.indexOf('function correctKnownMishearings');
let end = src.indexOf('{', start);
for (let depth = 0; end < src.length; end++) {
  if (src[end] === '{') depth++;
  if (src[end] === '}' && --depth === 0) break;
}
const applyLearnedWordFixes = t => t; // eslint-disable-line no-unused-vars
const correctKnownMishearings = new Function('applyLearnedWordFixes', src.slice(start, end + 1) + '\nreturn correctKnownMishearings;')(applyLearnedWordFixes);

const cases = [
  // Every-section car test, 12 Nov 2026.
  ['Used a thermal camera. And, turn my track.', 'Used a thermal camera. And, Termatrac.'],
  ['Durable notice for a terminal chemical barrier from 2019.', 'Durable notice for a Termidor chemical barrier from 2019.'],
  ['Treat the laundry with terminal foam, then a soil barrier.', 'Treat the laundry with Termidor Foam, then a soil barrier.'],
  ['Coptotermes, Acinasiformis, known as found.', 'Coptotermes, acinaciformis, no nest found.'],
  ['Mud tubing up the pier near the laundry. The barrier is damaged.', 'Mud tubing up the pier near the laundry. The bearer is damaged.'],
  ['Old borer hole in the hallway flood boards. Looks like anubium.', 'Old borer hole in the hallway floorboards. Looks like Anobium.'],
  ['Replace the missing ink capping.', 'Replace the missing ant capping.'],
  // Left alone.
  ['The bus terminal is two streets away.', 'The bus terminal is two streets away.'],
  ['The barrier is damaged along the slab edge.', 'The barrier is damaged along the slab edge.'],
  ['An old Kordon physical barrier at the slab edge.', 'An old Kordon physical barrier at the slab edge.'],
];

let failed = 0;
for (const [said, want] of cases) {
  const got = correctKnownMishearings(said);
  if (got === want) console.log('PASS ' + want);
  else { failed++; console.log('FAIL ' + said + '\n  got:  ' + got + '\n  want: ' + want); }
}
console.log(failed ? `${failed} of ${cases.length} failed` : `All ${cases.length} passed`);
process.exit(failed ? 1 : 0);
