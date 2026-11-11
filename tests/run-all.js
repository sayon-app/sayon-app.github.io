// Every end-to-end test in one command:
//   node tests/run-all.js                 every tests/*/e2e.js
//   node tests/run-all.js navigation send-gaps    just those
// It serves the repo on :8765 if nothing is there yet, runs three tests at a
// time, prints each one's FAIL lines and ends with a count. It exits 1 if
// any test failed. Screenshots and PDFs go to /tmp/sayon-tests/<name>
// (OUT=<dir> to put them elsewhere, JOBS=<n> to run more or fewer at once).
// Needs what tests/visual/README.md sets up: sh tests/visual/setup.sh and
// NODE_PATH pointing at Playwright.
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path'); const net = require('net');
const ROOT = path.join(__dirname, '..'); const OUT = process.env.OUT || '/tmp/sayon-tests'; const JOBS = +process.env.JOBS || 3; const PORT = 8765;
const all = fs.readdirSync(__dirname).filter(d => fs.existsSync(path.join(__dirname, d, 'e2e.js'))).sort();
const want = process.argv.slice(2);
const unknown = want.filter(n => !all.includes(n));
if (unknown.length) { console.error('No such test: ' + unknown.join(', ')); process.exit(2); }
const names = want.length ? want : all;

const listening = () => new Promise(resolve => {
  const s = net.connect(PORT, '127.0.0.1');
  s.on('connect', () => { s.destroy(); resolve(true); });
  s.on('error', () => resolve(false));
});

function run(name) {
  return new Promise(resolve => {
    const started = Date.now(); let out = '';
    const child = spawn(process.execPath, [path.join(__dirname, name, 'e2e.js'), path.join(OUT, name)], { cwd: ROOT, env: process.env });
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
    // A test that hangs is a failure, not a stuck run.
    const timer = setTimeout(() => { out += '\nFAIL timed out after 10 minutes'; child.kill('SIGKILL'); }, 600000);
    child.on('close', code => { clearTimeout(timer); resolve({ name, ok: code === 0, out, secs: Math.round((Date.now() - started) / 1000) }); });
  });
}

(async () => {
  let server = null;
  if (!(await listening())) {
    server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
    for (let i = 0; i < 50 && !(await listening()); i++) await new Promise(r => setTimeout(r, 100));
  }
  fs.mkdirSync(OUT, { recursive: true });
  const queue = names.slice(); const results = [];
  await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, async () => {
    while (queue.length) {
      const r = await run(queue.shift());
      results.push(r);
      fs.writeFileSync(path.join(OUT, r.name + '.log'), r.out);
      console.log(`${r.ok ? 'pass' : 'FAIL'}  ${r.name}  (${r.secs}s)`);
      if (!r.ok) {
        const lines = r.out.split('\n').filter(l => /^FAIL /.test(l));
        (lines.length ? lines : r.out.trim().split('\n').slice(-12)).forEach(l => console.log('      ' + l.slice(0, 300)));
      }
    }
  }));
  if (server) server.kill();
  const failed = results.filter(r => !r.ok).map(r => r.name).sort();
  console.log(failed.length ? `\n${failed.length} of ${results.length} FAILED: ${failed.join(', ')}` : `\nALL ${results.length} PASSED`);
  process.exit(failed.length ? 1 : 0);
})();
