/* ============================================================
   BOOT CHECK — can the app actually start?

   WHY THIS EXISTS
   ---------------
   A missing method on an imported object shipped once:
   `main.js` called `wheel.watch(...)` when `WheelInput` had no such
   method. That is a TypeError thrown at module load, so main.js died
   before the frame loop ever ran. The page still served 200 and still
   drew the loading screen, so nothing looked broken — the game was
   simply dead, and every visible symptom ("no inputs", "the keyboard
   does nothing", "my wheel isn't detected", "ESC is broken") had the
   same cause. It cost a full debugging round because every test we had
   only exercised library modules, never the wiring between them.

   WHAT IT CHECKS
   --------------
     1. Every module reachable from src/main.js resolves over HTTP.
     2. Every module imports cleanly in Node.
     3. Every method main.js calls on an instance of an imported class
        actually exists on that class.
     4. The boot marker is wired at both ends, so a browser can report
        its own state without a console.

   WHAT IT DOES NOT CHECK
   ----------------------
   main.js itself cannot be imported here: it builds a WebGLRenderer,
   and there is no GL context in Node. Chrome's own sandbox is blocked
   in this environment as well, so a headless browser run is not
   available either. Check (3) is therefore a targeted static analysis
   over the real prototypes, not a type checker: it catches the wiring
   mistakes that actually happen, not every possible one.

   For anything deeper, ask the language server — it understands the
   real types. It resolves `wheel.watch` to its definition in wheel.js,
   and reports nothing found when the method is absent.

   Run: node tools/bootcheck.mjs
   Needs the dev server up:  node tools/serve.mjs --no-open
   ============================================================ */

import net from 'node:net';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.DRIFTBLOCK_URL || 'http://127.0.0.1:8177/';
const PORT = Number(new globalThis.URL(BASE).port || 8177);

let fail = 0;
const check = (l, c, x = '') => { if (!c) fail++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${l}${x ? '   ' + x : ''}`); };

console.log('\n================ BOOT ================\n');

/* ---- 1. the server is up ---- */
const reachable = await new Promise((resolve) => {
  const sock = net.connect({ host: '127.0.0.1', port: PORT }, () => { sock.end(); resolve(true); });
  sock.on('error', () => resolve(false));
  sock.setTimeout(1500, () => { sock.destroy(); resolve(false); });
});
check(`the dev server answers on ${PORT}`, reachable,
  reachable ? '' : 'start it with:  node tools/serve.mjs --no-open');
if (!reachable) { console.log('\n1 FAILED\n'); process.exit(1); }

/* ---- 2. the whole import graph resolves ---- */
const graph = new Set();
const brokenFiles = [];
async function walk(rel) {
  if (graph.has(rel)) return;
  graph.add(rel);
  let text;
  try {
    const r = await fetch(new globalThis.URL(rel, BASE));
    if (!r.ok) { brokenFiles.push(`${rel} -> HTTP ${r.status}`); return; }
    text = await r.text();
  } catch (e) { brokenFiles.push(`${rel} -> ${e.message}`); return; }

  const base = new globalThis.URL(rel, BASE);
  for (const m of text.matchAll(/(?:^|\n)\s*import\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g)) {
    if (!m[1].startsWith('.')) continue;               // this app has no bare specifiers
    await walk(new globalThis.URL(m[1], base).pathname.replace(/^\//, ''));
  }
}
await walk('src/main.js');
check('every module in the import graph resolves', brokenFiles.length === 0,
  brokenFiles.length ? brokenFiles.join(', ') : `${graph.size} modules`);

/* ---- 3. every module imports cleanly ---- */
// These build DOM at import time, so they cannot load under Node.
const DOM_MODULES = new Set(['src/main.js', 'src/wheelui.js']);
const loadFailures = [];
for (const rel of graph) {
  if (rel.startsWith('vendor/') || DOM_MODULES.has(rel)) continue;
  try {
    await import(pathToFileURL(path.join(ROOT, rel)).href);
  } catch (e) {
    loadFailures.push(`${rel}: ${e.message.split('\n')[0]}`);
  }
}
check('every module imports without throwing', loadFailures.length === 0,
  loadFailures.join(' | '));

/* ---- 4. the wiring: methods main.js calls must exist ---- */
{
  const mainSrc = await readFile(path.join(ROOT, 'src/main.js'), 'utf8');

  // local name -> module specifier, for `import { A, B } from './x.js'`
  const classFrom = new Map();
  for (const m of mainSrc.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/).pop().trim();
      if (name) classFrom.set(name, m[2]);
    }
  }

  // `const foo = new Foo(` and `foo = new Foo(` bindings
  const instances = new Map();
  for (const m of mainSrc.matchAll(/(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*=\s*new\s+([A-Z][\w$]*)\s*\(/g)) {
    instances.set(m[1], m[2]);
  }

  const problems = [];
  let checkedCalls = 0;

  for (const [varName, className] of instances) {
    const spec = classFrom.get(className);
    if (!spec) continue;                                // a THREE class, or similar

    // specifiers in main.js are relative to src/, not to the project root
    let mod;
    try { mod = await import(pathToFileURL(path.resolve(path.join(ROOT, 'src'), spec)).href); }
    catch (e) {
      problems.push(`could not load ${spec} to verify ${className}: ${e.message.split('\n')[0]}`);
      continue;
    }
    const Klass = mod[className];
    if (typeof Klass !== 'function') {
      problems.push(`${spec} does not export ${className}`);
      continue;
    }

    const calls = new Set();
    const re = new RegExp(`\\b${varName}\\s*\\.\\s*([A-Za-z_$][\\w$]*)\\s*\\(`, 'g');
    for (const m of mainSrc.matchAll(re)) calls.add(m[1]);

    for (const method of calls) {
      checkedCalls++;
      if (!(method in Klass.prototype)) {
        problems.push(`${className}.${method}() called in main.js but not on ${className}`);
      }
    }
  }

  // Guard against a vacuous pass: if the analysis resolved nothing, it has
  // proved nothing, and must not report OK.
  check('the wiring check actually inspected something', checkedCalls >= 20,
    `${checkedCalls} calls across ${instances.size} instances`);
  check('every method main.js calls on an instance exists',
    problems.length === 0,
    problems.length ? problems.join(' | ') : `${checkedCalls} calls across ${instances.size} instances`);
}

/* ---- 5. the boot marker is wired at both ends ---- */
{
  const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
  const mainSrc = await readFile(path.join(ROOT, 'src/main.js'), 'utf8');
  check('index.html records boot state',
    /dataset\.boot\s*=/.test(html) && /addEventListener\(\s*'error'/.test(html));
  check('main.js marks the boot complete once the loop is armed',
    /dataset\.boot\s*=\s*'ok'/.test(mainSrc));
}

console.log(fail === 0 ? '\nThe game boots.\n' : `\n${fail} FAILED\n`);
process.exit(fail ? 1 : 0);
