#!/usr/bin/env node
// Sends one of the extraction bench's real transcripts to the treatment
// planner exactly the way js/treatment-plan.js does (same model, prompt,
// max_tokens and effort), with the transcript as the dictated notes and no
// report fields, and prints the plan. Costs one AI call per run, so run it
// on a few cases, not the whole bench. Needs SAYON_ANTHROPIC_KEY (or
// ANTHROPIC_API_KEY); see tests/extraction/run-api.mjs for why.
//   SAYON_ANTHROPIC_KEY=... node tests/treatment-plan/run-api.mjs deck-schedorhinotermes
// Add --quote "line; line" to give it the inspector's own quote lines, the
// way the app sends them, to see how it compares:
//   ... run-api.mjs deck-schedorhinotermes --quote "40 lm: Chemical soil treatment; 1 area: Direct treatment (Rear deck)"
// Add --site "..." to give it the house as measured on the quote's site
// plan (SITE MEASUREMENTS), the way the app sends it:
//   ... run-api.mjs piers-paving-pool --site "House perimeter: about 52 m (house about 16 × 10 m)."
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const name = process.argv[2];
const qi = process.argv.indexOf('--quote');
const quoteLines = qi > 0 ? String(process.argv[qi + 1] || '').split(';').map(t => t.trim()).filter(Boolean) : [];
const si = process.argv.indexOf('--site');
const site = si > 0 ? String(process.argv[si + 1] || '').trim() : '';
if (!name) { console.error('usage: run-api.mjs <transcript name>'); process.exit(2); }
const key = process.env.SAYON_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
if (!key) { console.error('No SAYON_ANTHROPIC_KEY or ANTHROPIC_API_KEY'); process.exit(2); }

function readTemplate(file, constName) {
  const src = readFileSync(join(repo, file), 'utf8');
  const start = src.indexOf(`const ${constName} = \``);
  if (start < 0) throw new Error(`${constName} not found in ${file}`);
  let i = start + `const ${constName} = \``.length, out = '';
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') { out += src[++i]; continue; }
    if (ch === '`') return out;
    out += ch;
  }
  throw new Error('no closing backtick');
}

const prompt = readTemplate('js/treatment-plan.js', 'TREATMENT_PLAN_PROMPT');
const transcript = readFileSync(join(repo, 'tests/extraction/transcripts', name + '.txt'), 'utf8').trim();
// Keep in step with treatmentPlanMessage() in js/treatment-plan.js.
const message = 'REPORT FIELDS (JSON):\n{}\n\nWHAT THE INSPECTOR SAID (notes in the order dictated):\n[1] ' + transcript + '\n\n' +
  (quoteLines.length
    ? "THE INSPECTOR'S QUOTE SO FAR (their own plan, before asking you; lines built from their recommendation count as theirs):\nWork lines:\n" + quoteLines.map(t => '- ' + t).join('\n')
    : "THE INSPECTOR'S QUOTE SO FAR: empty.") +
  (site ? '\n\nSITE MEASUREMENTS (from the site plan the inspector drew):\n' + site : '');
const started = Date.now();
const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
  body: JSON.stringify({
    model: 'claude-sonnet-5', max_tokens: 16000, output_config: { effort: 'medium' },
    system: [{ type: 'text', text: prompt, cache_control: { type: 'ephemeral', ttl: '1h' } }],
    messages: [{ role: 'user', content: message }],
  }),
});
const data = await res.json();
if (!res.ok) { console.error(JSON.stringify(data, null, 2)); process.exit(1); }
const text = data.content.map(c => c.text || '').join('');
const plan = JSON.parse(text.replace(/```json|```/g, '').trim());
mkdirSync(join(here, 'out'), { recursive: true });
writeFileSync(join(here, 'out', name + (quoteLines.length ? '-vs' : '') + (site ? '-site' : '') + '.json'), JSON.stringify({ plan, usage: data.usage, seconds: (Date.now() - started) / 1000 }, null, 2));
console.log(JSON.stringify(plan, null, 2));
console.log('usage', JSON.stringify(data.usage), 'seconds', (Date.now() - started) / 1000);
