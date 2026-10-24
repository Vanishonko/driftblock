/* ============================================================
   SETTINGS — the single owner of everything persisted.

   One module reads, migrates, validates and writes all saved
   state, so nothing else has to know the storage key, the schema
   version, or how to recover from a blob written by an older
   build.

   Everything goes through `patch()`. Writing is debounced so a
   slider drag costs one write rather than one per pixel, and
   `subscribe()` lets the audio/display layers react without the
   UI reaching into them directly.
   ============================================================ */

/** Bump when a persisted shape changes in a way that needs migrating. */
export const SCHEMA = 2;

export const KEY = 'driftblock.v2';
const LEGACY_KEYS = ['driftblock.v1'];
const BACKUP_KEY = 'driftblock.v1.bak';

const WRITE_DEBOUNCE_MS = 150;

/**
 * Every persisted key, with its default. This object is the schema: anything
 * not listed here is dropped on load rather than carried around forever.
 */
export const DEFAULTS = Object.freeze({
  schema: SCHEMA,
  paint: 'magenta',
  spec: 'balanced',        // was `tune` in v1
  car: 'stock',            // stock | citroen | brabus (hidden)
  brabusUnlocked: false,  // set by typing the garage code
  bests: {},
  wheel: null,             // the whole wheel calibration, see input/wheel.js
  volume: 0.9,
  engineVol: 1.15,
  windVol: 1.0,
  boostMode: 'manual',     // auto | manual | off — button by default
  uiScale: null,           // null = derive from the viewport
  gearbox: false,          // manual gearbox
  fullscreen: true,
});

/* ---------------- storage ---------------- */

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

let storage;
try {
  storage = (typeof localStorage !== 'undefined' && localStorage) || memoryStorage();
} catch {
  // Safari in private mode throws on access rather than being undefined.
  storage = memoryStorage();
}

let storageWarned = false;
function warnOnce(err) {
  if (storageWarned) return;
  storageWarned = true;
  console.warn('[DRIFTBLOCK] settings cannot be saved; continuing in memory.', err);
}

/** Swap the backing store. For tests, and for hosts with no localStorage. */
export function useStorage(store) { storage = store || memoryStorage(); }

/* ---------------- state ---------------- */

let current = null;
const listeners = new Set();
let writeTimer = null;

/** Keep only keys the schema knows about, and only of the right shape. */
function sanitise(raw) {
  const out = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  for (const k of Object.keys(DEFAULTS)) {
    if (raw[k] === undefined || raw[k] === null) continue;
    if (typeof raw[k] !== typeof DEFAULTS[k] && DEFAULTS[k] !== null) continue;
    out[k] = raw[k];
  }
  out.schema = SCHEMA;
  // `bests` and `wheel` are free-form; make sure they are at least objects.
  if (typeof out.bests !== 'object' || Array.isArray(out.bests)) out.bests = {};
  if (out.wheel !== null && typeof out.wheel !== 'object') out.wheel = null;
  return out;
}

/**
 * Bring a v1 blob forward.
 *
 * v1 called the car spec `tune` and had no wind or fullscreen setting. The
 * rename is the only thing that actually has to move; the rest just takes
 * defaults.
 */
function migrate(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const out = { ...raw };
  if (out.tune !== undefined && out.spec === undefined) out.spec = out.tune;
  delete out.tune;
  return out;
}

/**
 * Read the saved settings, migrating if needed.
 * Never throws: a corrupt or unreadable blob falls back to defaults and keeps
 * a copy of the bad data so it can be looked at rather than silently lost.
 */
export function load() {
  if (current) return current;

  let text = null;
  try { text = storage.getItem(KEY); } catch (e) { warnOnce(e); }

  let raw = null;
  let needsWrite = false;

  if (text === null) {
    // Nothing under the current key — look for a v1 blob to bring forward.
    for (const legacy of LEGACY_KEYS) {
      let old = null;
      try { old = storage.getItem(legacy); } catch { /* same as above */ }
      if (old === null) continue;
      try {
        raw = migrate(JSON.parse(old));
        needsWrite = true;
        // keep the original around; a migration is exactly the moment you
        // want the previous state back
        try { storage.setItem(BACKUP_KEY, old); } catch { /* best effort */ }
      } catch {
        try { storage.setItem(BACKUP_KEY, old); } catch { /* best effort */ }
      }
      break;
    }
  } else {
    try {
      const parsed = JSON.parse(text);
      raw = parsed && parsed.schema === SCHEMA ? parsed : migrate(parsed);
      if (!parsed || parsed.schema !== SCHEMA) needsWrite = true;
    } catch {
      // Corrupt. Keep the evidence, then start clean.
      try { storage.setItem(BACKUP_KEY, text); } catch { /* best effort */ }
      console.warn('[DRIFTBLOCK] saved settings were unreadable; starting from defaults. ' +
        `The old copy is in localStorage["${BACKUP_KEY}"].`);
      raw = null;
      needsWrite = true;
    }
  }

  current = sanitise(raw);
  if (needsWrite) scheduleWrite();
  return current;
}

/** The live settings object. Do not mutate it directly — use `patch()`. */
export function all() { return load(); }

export function get(key) { return load()[key]; }

/**
 * Merge a partial update and schedule a write.
 * @param {object} partial
 */
export function patch(partial) {
  const s = load();
  let changed = false;
  for (const [k, v] of Object.entries(partial)) {
    if (!(k in DEFAULTS)) continue;
    if (s[k] === v) continue;
    s[k] = v;
    changed = true;
  }
  if (changed) {
    scheduleWrite();
    for (const fn of listeners) {
      try { fn(s, partial); } catch (err) { console.error('[DRIFTBLOCK] settings listener failed:', err); }
    }
  }
  return s;
}

/**
 * Be told after each committed change.
 * @param {(all:object, partial:object|null) => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function scheduleWrite() {
  if (writeTimer !== null) return;
  writeTimer = setTimeout(() => { writeTimer = null; flush(); }, WRITE_DEBOUNCE_MS);
}

/** Write now, cancelling any pending debounce. Used on pagehide. */
export function flush() {
  if (writeTimer !== null) { clearTimeout(writeTimer); writeTimer = null; }
  if (!current) return;
  try {
    storage.setItem(KEY, JSON.stringify(current));
  } catch (e) {
    warnOnce(e);
  }
}

/** Wipe everything back to defaults (keeps the schema). */
export function reset() {
  current = { ...DEFAULTS, bests: {} };
  flush();
  for (const fn of listeners) {
    try { fn(current, null); } catch { /* a listener must not break a reset */ }
  }
  return current;
}

/** Snapshot for a bug report or a manual backup. */
export function toJSON() { return JSON.stringify(load(), null, 2); }

/** Replace everything from a snapshot. Invalid input leaves settings alone. */
export function fromJSON(text) {
  try {
    current = sanitise(migrate(JSON.parse(text)));
    flush();
    return true;
  } catch {
    return false;
  }
}
