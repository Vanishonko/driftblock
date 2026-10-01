/* Runs every check suite and reports one summary.
   Run: node tools/checkall.mjs
   Some suites need the dev server:  node tools/serve.mjs --no-open */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** name, file, and whether it needs the dev server listening. */
const SUITES = [
  ['settings', 'settingscheck.mjs', false],
  ['boot', 'bootcheck.mjs', true],
  ['physics', 'revcheck.mjs', false],
  ['wheel/ffb', 'ffbcheck.mjs', false],
  ['tracks', 'trackcheck.mjs', false],
  ['fuzz', 'fuzz.mjs', false],
];

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));

function run(file) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'tools', file)], { cwd: ROOT });
    let out = '';
    p.stdout.on('data', (b) => { out += b; });
    p.stderr.on('data', (b) => { out += b; });
    p.on('close', (code) => resolve({ code, out }));
  });
}

const results = [];
for (const [name, file, needsServer] of SUITES) {
  if (only.length && !only.includes(name)) continue;
  process.stdout.write(`  ${name.padEnd(10)} `);
  const t0 = Date.now();
  const { code, out } = await run(file);
  const ms = Date.now() - t0;
  const failed = out.split('\n').filter((l) => /\bFAIL\b|FAILED/.test(l));
  results.push({ name, file, code, failed, out });

  if (code === 0) {
    console.log(`ok    ${String(ms).padStart(6)} ms`);
  } else {
    console.log(`FAIL  ${String(ms).padStart(6)} ms`);
    for (const l of failed.slice(0, 6)) console.log('             ' + l.trim());
    if (needsServer && /dev server answers/.test(out)) {
      console.log('             (this suite needs: node tools/serve.mjs --no-open)');
    }
  }
}

const bad = results.filter((r) => r.code !== 0);
console.log('');
if (!results.length) {
  console.log('No suites matched.\n');
  process.exit(1);
}
console.log(bad.length === 0
  ? `All ${results.length} suites passed.\n`
  : `${bad.length} of ${results.length} suites FAILED: ${bad.map((b) => b.name).join(', ')}\n`);
process.exit(bad.length ? 1 : 0);
