// One name for each thing (N1): docs/words.md is the word list, and its
// Not column is what must not come back. Every word there is looked for in
// what people read: the app's page and scripts (comments left out), the
// client's sign page, and the public website. The Terms and Privacy Policy
// are legal text with their own versions, and the agreement's clauses are
// what a client signed, so they aren't searched.
// node e2e.js <outDir>   (needs no server)
const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const fails = []; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };

const list = fs.readFileSync(path.join(ROOT, 'docs/words.md'), 'utf8');
const rows = list.split('\n').filter(l => /^\| \*\*/.test(l)).map(l => l.split('|').map(c => c.trim()));
const banned = rows.flatMap(r => [...(r[3] || '').matchAll(/`([^`]+)`/g)].map(m => ({ word: m[1], say: r[1].replace(/\*/g, '') })));
check(rows.length >= 10 && banned.length >= 10, `the word list has its names (${rows.length}) and the words to leave behind (${banned.length})`);

// What people read, with code comments taken out.
const stripJs = s => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');
const stripHtml = s => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const files = [
  ...['index.html', 'sign.html', 'site/index.html'].map(f => ({ f, text: stripHtml(fs.readFileSync(path.join(ROOT, f), 'utf8')) })),
  ...fs.readdirSync(path.join(ROOT, 'js/app')).map(n => 'js/app/' + n),
  ...fs.readdirSync(path.join(ROOT, 'js')).filter(n => n.endsWith('.js')).map(n => 'js/' + n),
].map(x => typeof x === 'string' ? { f: x, text: stripJs(fs.readFileSync(path.join(ROOT, x), 'utf8')) } : x);
// The agreement's numbered clauses are signed text; they're left as they are.
const agr = files.find(x => x.f === 'js/app/agreement.js');
if (agr) agr.text = agr.text.replace(/const DEFAULT_AGREEMENT_TEXT[\s\S]*?`;/, '');

for (const { word, say } of banned) {
  const re = new RegExp("(^|\\W)" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\W|$)");
  const hits = [];
  files.forEach(({ f, text }) => text.split('\n').forEach((line, i) => { if (re.test(line)) hits.push(`${f}:${i + 1}`); }));
  check(!hits.length, `"${word}" is "${say}" now` + (hits.length ? ': ' + hits.slice(0, 4).join(', ') : ''));
}
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
process.exit(fails.length ? 1 : 0);
