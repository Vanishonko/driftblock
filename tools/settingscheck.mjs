/* Verifies settings load, migrate, validate and persist correctly.
   Run: node tools/settingscheck.mjs */
import {
  SCHEMA, KEY, DEFAULTS, load, patch, subscribe, flush, reset,
  toJSON, fromJSON, useStorage,
} from '../src/core/settings.js';

let fail = 0;
const check = (l, c, x = '') => { if (!c) fail++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${l}${x ? '   ' + x : ''}`); };

/** A fresh in-memory localStorage stand-in. */
function fakeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

/**
 * The module caches `current`, and there is deliberately no public "unload".
 * Re-importing with a cache-busting query gives each case a clean module
 * instance without the production code carrying test-only reset plumbing.
 */
let n = 0;
async function freshModule(store) {
  const mod = await import(`../src/core/settings.js?case=${n++}`);
  mod.useStorage(store);
  return mod;
}

console.log('\n================ SETTINGS ================\n');

// ---- 1. defaults
{
  const store = fakeStorage();
  const s = await freshModule(store);
  const v = s.load();
  check('a fresh install starts from defaults', v.spec === DEFAULTS.spec && v.volume === DEFAULTS.volume);
  check('and the schema is stamped', v.schema === SCHEMA, `schema ${v.schema}`);
  check('nothing is written until something changes', store.map.has(KEY) === false);

  s.patch({ volume: 0.5 });
  check('patch() does not write immediately', store.map.has(KEY) === false);
  s.flush();
  check('flush() writes it', JSON.parse(store.map.get(KEY)).volume === 0.5);
}

// ---- 2. debounce
{
  const store = fakeStorage();
  const s = await freshModule(store);
  let writes = 0;
  const realSet = store.setItem;
  store.setItem = (k, v) => { if (k === KEY) writes++; realSet(k, v); };

  for (let i = 0; i < 40; i++) s.patch({ volume: i / 100 });
  check('a slider drag does not write per event', writes === 0, `${writes} writes during 40 patches`);

  await new Promise((r) => setTimeout(r, 250));
  check('and collapses to exactly one write', writes === 1, `${writes} writes`);
  check('carrying the final value', JSON.parse(store.map.get(KEY)).volume === 0.39);
}

// ---- 3. subscribe
{
  const store = fakeStorage();
  const s = await freshModule(store);
  const seen = [];
  const off = s.subscribe((all, partial) => seen.push({ all, partial }));

  s.patch({ volume: 0.1 });
  check('subscribers are told what changed', seen.length === 1 && seen[0].partial.volume === 0.1);

  s.patch({ volume: 0.1 });
  check('an identical value does not notify', seen.length === 1, `${seen.length} notifications`);

  s.patch({ notARealKey: 5 });
  check('an unknown key is ignored', seen.length === 1 && s.all().notARealKey === undefined);

  off();
  s.patch({ volume: 0.2 });
  check('unsubscribing works', seen.length === 1);
}

// ---- 4. v1 migration
{
  const v1 = {
    paint: 'teal', tune: 'drift', bests: { 'a:b': { score: 10 } },
    volume: 0.4, engineVol: 0.8, boostMode: 'off', uiScale: 1.2,
    gearbox: true, wheel: { preset: 'g29', gearPattern: [null, [3], [4]] },
  };
  const store = fakeStorage({ 'driftblock.v1': JSON.stringify(v1) });
  const s = await freshModule(store);
  const v = s.load();

  check('v1 `tune` becomes `spec`', v.spec === 'drift', `spec=${v.spec}`);
  check('v1 `tune` is not carried over as a stray key', v.tune === undefined);
  check('other v1 values survive', v.paint === 'teal' && v.volume === 0.4 && v.gearbox === true);
  check('nested data survives intact',
    v.bests['a:b'].score === 10 && v.wheel.gearPattern[1][0] === 3);
  check('new keys take their defaults', v.windVol === DEFAULTS.windVol && v.fullscreen === DEFAULTS.fullscreen);
  check('the v1 blob is backed up before it is replaced',
    store.map.has('driftblock.v1.bak'), 'driftblock.v1.bak');

  s.flush();
  const saved = JSON.parse(store.map.get(KEY));
  check('and the migrated result is written under the new key', saved.spec === 'drift' && saved.schema === SCHEMA);
}

// ---- 5. corrupt data
{
  const store = fakeStorage({ [KEY]: '{ this is not json' });
  const s = await freshModule(store);
  const v = s.load();

  check('corrupt settings fall back to defaults', v.spec === DEFAULTS.spec && v.volume === DEFAULTS.volume);
  check('and the bad blob is kept for inspection',
    store.map.get('driftblock.v1.bak') === '{ this is not json');

  s.flush();
  check('a good copy is written over it', (() => {
    try { return JSON.parse(store.map.get(KEY)).schema === SCHEMA; } catch { return false; }
  })());
}

// ---- 6. validation
{
  const store = fakeStorage({
    [KEY]: JSON.stringify({
      schema: SCHEMA, volume: 'loud', bests: [1, 2, 3], wheel: 'nope',
      paint: 'teal', junk: true,
    }),
  });
  const s = await freshModule(store);
  const v = s.load();

  check('a value of the wrong type falls back to its default', v.volume === DEFAULTS.volume, `volume=${v.volume}`);
  check('an array where an object belongs is replaced', !Array.isArray(v.bests));
  check('a non-object wheel is dropped', v.wheel === null);
  check('valid values are kept', v.paint === 'teal');
  check('keys not in the schema are dropped', v.junk === undefined);
}

// ---- 7. hostile storage
{
  const store = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('QuotaExceededError'); },
    removeItem() {},
  };
  const s = await freshModule(store);
  let threw = false;
  try {
    s.load();
    s.patch({ volume: 0.3 });
    s.flush();
  } catch { threw = true; }
  check('storage that throws does not break the game', !threw);
  check('and settings still work in memory', s.all().volume === 0.3);
}

// ---- 8. export / import
{
  const store = fakeStorage();
  const s = await freshModule(store);
  s.patch({ volume: 0.33, paint: 'teal' });
  const snap = s.toJSON();

  s.patch({ volume: 0.9 });
  check('import restores a snapshot', s.fromJSON(snap) === true && s.all().volume === 0.33);
  check('import rejects nonsense without clobbering', s.fromJSON('{oops') === false && s.all().volume === 0.33);
}

// ---- 9. reset
{
  const store = fakeStorage();
  const s = await freshModule(store);
  s.patch({ volume: 0.11, paint: 'teal' });
  s.reset();
  check('reset returns everything to defaults',
    s.all().volume === DEFAULTS.volume && s.all().paint === DEFAULTS.paint);
  check('and persists that', (() => {
    try { return JSON.parse(store.map.get(KEY)).volume === DEFAULTS.volume; } catch { return false; }
  })());
}

console.log(fail === 0 ? '\nSettings behave.\n' : `\n${fail} FAILED\n`);
process.exit(fail ? 1 : 0);
