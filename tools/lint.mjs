/* ============================================================
   LINT — the standards this project actually commits to.

   Not a general-purpose linter and not trying to be. These are the
   rules that have caught real mistakes here, or that keep the
   structure from decaying back into one big file. Anything a real
   linter would do better belongs in a real linter, and adding one
   would mean a dependency this project deliberately does not have.

   Run: node tools/lint.mjs
   ============================================================ */

import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const RULES = [
  {
    id: 'size',
    what: 'no source module over the ceiling, unless it is on the list',
    // A file past this is doing more than one job. main.js was 1073 and is
    // now 882; the rest are on the list below with a reason. The point is
    // that new ones cannot join them by accident.
    limit: 400,
    // Known-large, with why. These are the next extraction candidates, not
    // files that are fine as they are.
    known: {
      'src/main.js': 'bootstrap, menus, world loading and the frame loop; the loop is next out',
      'src/render/track.js': 'circuit generation plus scenery; the scenery belongs in its own module',
      'src/wheel.js': 'presets, calibration, input shaping and the learning wizard are four jobs',
      'src/render/effects.js': 'particles, skid marks and speed lines are three independent systems',
      'src/game.js': 'run lifecycle, scoring and the drift chain',
      'src/wheelui.js': 'the wheel setup screen, including the wizard UI',
      'src/audio.js': 'one synthesised engine, but a lot of voices',
    },
    skip: (rel) => rel.startsWith('vendor/'),
  },
  {
    id: 'console',
    what: 'no stray console.log in src/',
    // console.error and console.warn are fine — those are for failures.
    // A console.log left in is either debris or a diagnostic that should be
    // behind the debug overlay.
    allow: (rel) => rel.includes('ffbdebug') || rel.includes('crash'),
  },
  {
    id: 'var',
    what: 'no `var`',
  },
  {
    id: 'jsdoc',
    what: 'exported functions have a doc comment',
    // Not every one-liner; the check looks for a comment block ending within
    // a few lines above the export.
  },
];

const problems = [];
const knownLarge = [];
const note = (rel, line, rule, detail) => problems.push({ rel, line, rule, detail });

async function walk(dir, out = []) {
  for (const entry of await readdir(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    const st = await stat(full);
    if (st.isDirectory()) await walk(full, out);
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = await walk(path.join(ROOT, 'src'));
const rels = files.map((f) => path.relative(ROOT, f));

console.log('\n================ LINT ================\n');

for (const file of files) {
  const rel = path.relative(ROOT, file);
  const text = await readFile(file, 'utf8');
  const lines = text.split('\n');

  // ---- size
  const rule = RULES[0];
  if (!rule.skip(rel) && lines.length > rule.limit && !rule.known[rel]) {
    note(rel, lines.length, 'size', `${lines.length} lines, limit ${rule.limit}`);
  }
  if (rule.known[rel]) knownLarge.push({ rel, lines: lines.length });

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];

    // ---- console.log
    if (/\bconsole\.log\s*\(/.test(l) && !RULES[1].allow(rel)) {
      note(rel, i + 1, 'console', l.trim().slice(0, 60));
    }

    // ---- var
    if (/^\s*var\s+[A-Za-z_$]/.test(l)) {
      note(rel, i + 1, 'var', l.trim().slice(0, 60));
    }
  }

  // ---- JSDoc on exported functions
  // A single-line body is exempt: `export function gearCount() { return ... }`
  // does not need a paragraph, and demanding one produces filler.
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
    if (!m) continue;
    const bodyLines = lines.slice(i, i + 4).join(' ');
    if (/\}\s*$/.test(lines[i]) || bodyLines.length < 90) continue;
    const above = lines.slice(Math.max(0, i - 8), i).join('\n');
    if (!/\*\//.test(above)) {
      note(rel, i + 1, 'jsdoc', `export function ${m[1]}()`);
    }
  }
}

// ---- report
const byRule = new Map();
for (const p of problems) {
  if (!byRule.has(p.rule)) byRule.set(p.rule, []);
  byRule.get(p.rule).push(p);
}

for (const rule of RULES) {
  const hits = byRule.get(rule.id) || [];
  if (!hits.length) {
    console.log(`  OK    ${rule.what}`);
    if (rule.known && knownLarge.length) {
      for (const k of knownLarge.sort((a, b) => b.lines - a.lines)) {
        console.log(`          ${String(k.lines).padStart(4)}  ${k.rel}  — ${rule.known[k.rel]}`);
      }
    }
    continue;
  }
  console.log(`  FAIL  ${rule.what}   (${hits.length})`);
  for (const h of hits.slice(0, 8)) {
    console.log(`          ${h.rel}:${h.line}  ${h.detail}`);
  }
  if (hits.length > 8) console.log(`          ... and ${hits.length - 8} more`);
}

const ruleCount = RULES.length;
console.log('');
if (problems.length === 0) {
  console.log(`Clean across ${rels.length} modules, ${ruleCount} rules.\n`);
  process.exit(0);
}
console.log(`${problems.length} problem(s).\n`);
process.exit(1);
