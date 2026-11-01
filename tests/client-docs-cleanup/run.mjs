// The Worker's daily clean-up of client-link PDFs: rows past the 14 days
// plus 30 get their files deleted from client-docs and doc.files emptied.
// A failed delete leaves the row for the next run. node run.mjs
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(os.tmpdir(), 'worker-cleanup-' + process.pid + '.mjs');
fs.copyFileSync(path.join(here, '../../worker/worker.js'), tmp);
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
const SB = 'https://bmjgvogxutwyeklxxeao.supabase.co';
const pub = p => `${SB}/storage/v1/object/public/client-docs/${p}`;
let calls = [], failDeleteFor = null;
const rows = [
  { id: 'r1', doc: { kind: 'quote', files: { report: pub('u1/f1/inspection-report.pdf'), quote: pub('u1/f1/treatment-quote.pdf') } } },
  { id: 'r2', doc: { kind: 'quote', files: { quote: pub('u2/f2/treatment-quote.pdf') } } },
];
globalThis.fetch = async (url, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : null; calls.push({ url: String(url), method: opts.method || 'GET', body, headers: opts.headers });
  if (String(url).includes('/rest/v1/sign_requests?select=')) return new Response(JSON.stringify(rows), { status: 200 });
  if (String(url).includes('/storage/v1/object/client-docs')) {
    if (failDeleteFor && body.prefixes.some(p => p.startsWith(failDeleteFor))) return new Response('no', { status: 500 });
    return new Response(JSON.stringify(body.prefixes.map(n => ({ name: n }))), { status: 200 });
  }
  if (String(url).includes('/rest/v1/sign_requests?id=eq.')) return new Response(null, { status: 204 });
  return new Response('{}', { status: 404 });
};
const worker = (await import(tmp)).default;
const env = { SUPABASE_SERVICE_ROLE_KEY: 'service' };
const run = async () => { const waits = []; await worker.scheduled({}, env, { waitUntil: p => waits.push(p) }); await Promise.all(waits); };

await run();
const list = calls.find(c => c.url.includes('select=id,doc'));
const cutoff = decodeURIComponent((list.url.match(/expires_at=lt\.([^&]+)/) || [])[1] || '');
const days = (Date.now() - Date.parse(cutoff)) / 864e5;
check(days > 29.9 && days < 30.1, 'only links whose 14 days ended more than 30 days ago: ' + cutoff);
check(/or=\(doc->files->>report\.not\.is\.null,doc->files->>quote\.not\.is\.null\)/.test(decodeURIComponent(list.url)), 'only links that still have files');
check(list.headers.Authorization === 'Bearer service', 'uses the service key');
const dels = calls.filter(c => c.method === 'DELETE');
check(dels.length === 2 && JSON.stringify(dels[0].body.prefixes) === JSON.stringify(['u1/f1/inspection-report.pdf', 'u1/f1/treatment-quote.pdf']) && dels[1].body.prefixes[0] === 'u2/f2/treatment-quote.pdf', 'deletes exactly the files the links point at');
const patches = calls.filter(c => c.method === 'PATCH');
check(patches.length === 2 && patches.every(p => JSON.stringify(p.body.doc.files) === '{}' && p.body.doc.kind === 'quote'), 'empties doc.files and keeps the rest of the doc');

calls = []; failDeleteFor = 'u1/';
await run();
const p2 = calls.filter(c => c.method === 'PATCH');
check(p2.length === 1 && p2[0].url.includes('id=eq.r2'), 'a failed delete leaves that link for the next run, the others still clear');

calls = [];
await worker.scheduled({}, {}, { waitUntil: p => p });
check(calls.length === 0, 'no service key: does nothing');

fs.unlinkSync(tmp);
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
process.exit(fails.length ? 1 : 0);
