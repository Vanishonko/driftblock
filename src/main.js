/* ============================================================
   DRIFTBLOCK — main
   ============================================================ */

import * as THREE from '../vendor/three.module.js';
import { Input } from './input.js';
import { GameAudio } from './audio.js';
import { TRACK_DEFS, Track, previewOutline } from './render/track.js';
import { createCarMesh, updateCarVisual, PAINTS } from './render/car.js';
import { ChaseCamera } from './render/camera.js';
import { Effects } from './render/effects.js';
import { HUD } from './render/hud.js';
import { Game, MODES, fmtTime, SCORE } from './game.js';
import { TUNE, clamp, invalidateTopSpeed } from './physics/index.js';
import { load as loadSettings, patch as patchSettings, flush as flushSettings } from './core/settings.js';
import { SPECS, applySpec } from './physics/specs.js';
import {
  init as initGarage, buildGarage, buildSpecCards, changeSpec,
} from './ui/garage.js';
import { init as initFfbDebug, toggle as toggleFfbDebug } from './ui/ffbdebug.js';
import {
  attach as attachDisplay, resize, displayInfo, isFullscreen,
  requestFullscreen, toggleFullscreen, applyFullscreenPreference,
} from './core/display.js';
import { WheelInput, defaultCalibration } from './wheel.js';
import { ForceFeedback } from './ffb.js';
import { WheelUI } from './wheelui.js';

/* ============================================================
   SAVE
   ============================================================
   All persisted state lives in core/settings.js. Nothing here
   touches localStorage directly: reads go through `save`, writes
   through `patch()`, which debounces and validates.
   ============================================================ */

/* ============================================================
   BOOT
   ============================================================ */
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, powerPreference: 'high-performance', stencil: false,
});
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.42;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.35, 4000);

const input = new Input();
const audio = new GameAudio();
const hud = new HUD();
const wheel = new WheelInput();
const ffb = new ForceFeedback();

const save = loadSettings();
applySpec(save.spec);

if (save.wheel) wheel.setCalibration(save.wheel);
wheel.enabled = true;
input.attachWheel(wheel, ffb);
ffb.setConfig(wheel.cal);

// Chrome hides a gamepad until the driver physically touches it. React the
// instant it appears so the setup panel stops saying "no wheel".
wheel.watch(() => {
  // wheelUI is declared below, so this only ever runs long after. Both
  // refreshes are guarded: the panel is built lazily and may not exist yet.
  if (!wheelUI) return;
  if (wheelUI.refreshControls) wheelUI.refreshControls();
  if (wheelUI.refreshStatus) wheelUI.refreshStatus();
});

const wheelUI = new WheelUI(wheel, ffb, save, () => {
  ffb.setConfig(wheel.cal);
  if (game) game.manualGearbox = !!save.gearbox;
});

/* If this page was served by the native bridge, force feedback is
   available — connect to it automatically. */
(async () => {
  try {
    const r = await fetch('/ffb-status', { cache: 'no-store' });
    if (!r.ok) return;
    const info = await r.json();
    ffb.bridge.connect();
    if (info.wheel) hud.toast('WHEEL: ' + info.name, 2.2);
  } catch { /* no bridge running, which is the normal case */ }
})();
const paint = PAINTS.find((p) => p.id === save.paint) || PAINTS[0];
audio.setMasterVolume(save.volume ?? 0.9);
audio.setEngineVolume(save.engineVol ?? 1.15);
audio.setWindVolume(save.windVol ?? 1.0);

/* ---------------- world ---------------- */
let track = null;
let effects = null;
let carMesh = null;
let game = null;
const camRig = new ChaseCamera(camera);

// Sizing, DPR, UI scale and fullscreen live in core/display.js; it needs the
// canvas, renderer and camera, but owns none of them.
attachDisplay({ canvas, renderer, camera });

initGarage({
  save, audio, hud, flush: flushSettings,
  getGame: () => game,
});

// The whole force-feedback chain on one screen, because every value needed to
// diagnose a dead wheel exists and is otherwise scattered across four modules.
initFfbDebug({ wheel, ffb, input });
camRig.track = null;

function loadWorld(trackDef) {
  if (track) {
    scene.remove(track.group);
    track.dispose();
  }
  if (effects) {
    scene.remove(effects.smoke.mesh, effects.sparks.mesh, effects.lines.mesh);
    for (const r of effects.skids.ribbons) scene.remove(r.mesh);
  }

  track = new Track(trackDef);
  scene.add(track.group);
  scene.fog = new THREE.FogExp2(trackDef.palette.fog, trackDef.palette.fogDensity);
  scene.background = new THREE.Color(trackDef.palette.fog);

  effects = new Effects(scene, trackDef.palette);

  if (carMesh) scene.remove(carMesh.root);
  carMesh = createCarMesh(paint);
  scene.add(carMesh.root);

  camRig.track = track;
  camRig._hint = -1;
  hud.setTrack(track);

  if (!game) {
    game = new Game({ track, hud, audio, effects, paint });
  } else {
    game.effects = effects;   // must re-point: loadWorld just replaced it
    game.setTrack(track);
  }
  game.onImpact = (strength) => camRig.addShake(strength * 0.9);
  game.onFinish = (res) => showResults(res);
}

/* ============================================================
   MENUS
   ============================================================ */
const overlay = document.getElementById('overlay');
const screens = {
  title: document.getElementById('screenTitle'),
  mode: document.getElementById('screenMode'),
  track: document.getElementById('screenTrack'),
  garage: document.getElementById('screenGarage'),
  options: document.getElementById('screenOptions'),
  wheel: document.getElementById('screenWheel'),
  how: document.getElementById('screenHow'),
  pause: document.getElementById('screenPause'),
  results: document.getElementById('screenResults'),
};

let currentScreen = 'title';
let pendingMode = MODES[0];

/**
 * Where BACK should return to. Screens can be reached from more than one
 * place — OPTIONS is on both the title and the pause menu — so "back" has to
 * remember the route rather than assuming the title. Without this, opening
 * options from a paused run and pressing BACK dropped you out of the run.
 */
const navStack = [];

function showScreen(name) {
  overlay.classList.remove('hidden');
  for (const [k, el] of Object.entries(screens)) el.classList.toggle('hidden', k !== name);
  currentScreen = name;
  hud.show(false);
  if (name === 'wheel') wheelUI.open(); else wheelUI.close();
}

/** Navigate, remembering where we came from. */
function navTo(name, build) {
  if (build) build();
  navStack.push(currentScreen);
  showScreen(name);
}

/** Step back one screen. Shared by the BACK button and Escape. */
function goBack() {
  const prev = navStack.pop() || 'title';
  if (prev === 'pause' && game && game.state === 'paused') showScreen('pause');
  else if (prev === 'options') navTo('options', buildOptions);
  else if (prev === 'mode') navTo('mode', buildModeCards);
  else if (prev === 'garage') navTo('garage', buildGarage);
  else { buildBestStrip(); showScreen('title'); }
}

function hideOverlay() {
  overlay.classList.add('hidden');
  hud.show(true);
}

/* ---------------- track preview minimap ---------------- */
function drawOutline(canvasEl, def, accent) {
  const pts = previewOutline(def, 180);
  const c = canvasEl.getContext('2d');
  const W = canvasEl.width, H = canvasEl.height;
  c.clearRect(0, 0, W, H);

  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const pad = 14;
  const sx = (W - pad * 2) / Math.max(1, maxX - minX);
  const sz = (H - pad * 2) / Math.max(1, maxZ - minZ);
  const s = Math.min(sx, sz);
  const ox = (W - (maxX - minX) * s) / 2 - minX * s;
  const oz = (H - (maxZ - minZ) * s) / 2 - minZ * s;

  c.beginPath();
  c.moveTo(pts[0].x * s + ox, pts[0].z * s + oz);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x * s + ox, pts[i].z * s + oz);
  c.closePath();

  const w = Math.max(3, def.width * s);
  c.lineJoin = 'round';
  c.strokeStyle = 'rgba(255,255,255,0.16)';
  c.lineWidth = w + 4;
  c.stroke();
  c.strokeStyle = accent;
  c.lineWidth = w;
  c.stroke();

  c.fillStyle = '#fff';
  const p0 = pts[0];
  c.fillRect(p0.x * s + ox - 4, p0.z * s + oz - 4, 8, 8);
}

/* ---------------- build screens ---------------- */
function buildModeCards() {
  const host = document.getElementById('modeCards');
  host.innerHTML = '';
  for (const m of MODES) {
    const el = document.createElement('button');
    el.className = 'card' + (m.id === pendingMode.id ? ' sel' : '');
    el.innerHTML = `<h3>${m.name}</h3><div class="desc">${m.desc}</div><div class="meta">${m.meta}</div>`;
    el.onclick = () => {
      pendingMode = m;
      audio.ui('ok');
      buildTrackCards();
      navTo('track');
    };
    el.onmouseenter = () => audio.ui('move');
    host.appendChild(el);
  }
}

function buildTrackCards() {
  const host = document.getElementById('trackCards');
  host.innerHTML = '';
  for (const def of TRACK_DEFS) {
    const el = document.createElement('button');
    el.className = 'card';
    const key = `${def.id}:${pendingMode.id}`;
    const best = save.bests[key];
    const bestLine = best
      ? (pendingMode.laps > 0
        ? `BEST LAP ${fmtTime(best.bestLap)}`
        : `BEST ${(best.total || 0).toLocaleString()}`)
      : 'NO RECORD YET';

    const cv = document.createElement('canvas');
    cv.width = 240; cv.height = 132;
    cv.className = 'swatch';
    cv.style.height = '132px';
    cv.style.background = 'rgba(0,0,0,.28)';

    el.innerHTML = `<h3>${def.name}</h3><div class="desc">${def.desc}</div>
      <div class="meta">${def.difficulty} · ${def.length} · ${bestLine}</div>`;
    el.insertBefore(cv, el.firstChild);

    el.onclick = () => {
      audio.ui('ok');
      startRun(def, pendingMode);
    };
    el.onmouseenter = () => audio.ui('move');
    host.appendChild(el);
    requestAnimationFrame(() => drawOutline(cv, def, '#' + new THREE.Color(def.palette.curbB).getHexString()));
  }
}

/* ============================================================
   OPTIONS — everything that is not the car
   ============================================================ */
function buildOptions() {
  // ---- audio
  const ah = document.getElementById('audioCards');
  if (ah) {
    ah.innerHTML = '';
    const mk = (label, get, set) => {
      const row = document.createElement('div');
      row.className = 'settings-row';
      row.innerHTML = `<span class="settings-label">${label}</span>`;
      const input = document.createElement('input');
      input.type = 'range'; input.min = 0; input.max = 1; input.step = 0.02;
      input.value = get();
      const out = document.createElement('span');
      out.className = 'settings-value';
      out.textContent = Math.round(get() * 100) + '%';
      input.oninput = () => {
        const v = parseFloat(input.value);
        set(v); out.textContent = Math.round(v * 100) + '%';
      };
      row.appendChild(input); row.appendChild(out);
      ah.appendChild(row);
    };
    mk('MASTER VOLUME', () => save.volume, (v) => { patchSettings({ volume: v }); audio.setMasterVolume(v); });
    mk('ENGINE VOLUME', () => save.engineVol, (v) => { patchSettings({ engineVol: v }); audio.setEngineVolume(v); });
    mk('WIND', () => save.windVol, (v) => { patchSettings({ windVol: v }); audio.setWindVolume(v); });

  }

  // ---- gameplay
  const gh = document.getElementById('gameplayCards');
  if (gh) {
    gh.innerHTML = '';

    const seg = (label, hint, current, options, onPick) => {
      const row = document.createElement('div');
      row.className = 'settings-row';
      row.innerHTML = `<span class="settings-label">${label}</span>`;
      const box = document.createElement('div');
      box.className = 'seg';
      for (const [val, text] of options) {
        const b = document.createElement('button');
        b.className = 'seg-btn' + (current === val ? ' on' : '');
        b.textContent = text;
        b.onclick = () => { onPick(val); audio.ui('select'); buildOptions(); };
        box.appendChild(b);
      }
      row.appendChild(box);
      gh.appendChild(row);
      if (hint) {
        const p = document.createElement('p');
        p.className = 'settings-note';
        p.textContent = hint;
        gh.appendChild(p);
      }
    };

    seg('MINI-TURBO', 'AUTO releases on leaving a charged drift and on your button. BUTTON is button only.',
      save.boostMode || 'auto',
      [['auto', 'AUTO'], ['manual', 'BUTTON'], ['off', 'OFF']],
      (v) => { patchSettings({ boostMode: v }); if (game) game.boostMode = v; });

    seg('GEARBOX', 'Manual lets you pick the gear, reach neutral, and use an H-pattern shifter.',
      save.gearbox ? 'manual' : 'auto',
      [['auto', 'AUTO'], ['manual', 'MANUAL']],
      (v) => {
        const manual = v === 'manual';
        patchSettings({ gearbox: manual });
        if (game) game.manualGearbox = manual;
      });
  }

  // ---- display / UI scale
  const dh = document.getElementById('displayCards');
  if (dh) {
    dh.innerHTML = '';
    const info = displayInfo();

    const row = document.createElement('div');
    row.className = 'settings-row';
    row.innerHTML = '<span class="settings-label">UI SCALE</span>';
    const input = document.createElement('input');
    input.type = 'range'; input.min = 0.5; input.max = 1.6; input.step = 0.02;
    input.value = info.autoScale;
    const out = document.createElement('span');
    out.className = 'settings-value';
    out.textContent = 'AUTO ×' + info.autoScale.toFixed(2);
    const apply = (v, manual) => {
      patchSettings({ uiScale: manual ? v : null });
      resize();
      const i2 = displayInfo();
      out.textContent = (manual ? '×' : 'AUTO ×') + (manual ? v.toFixed(2) : i2.autoScale.toFixed(2));
    };
    input.oninput = () => apply(parseFloat(input.value), true);
    row.appendChild(input); row.appendChild(out);
    dh.appendChild(row);

    // ---- fullscreen
    const frow = document.createElement('div');
    frow.className = 'settings-row';
    frow.innerHTML = '<span class="settings-label">FULLSCREEN</span>';
    const fbtn = document.createElement('button');
    fbtn.className = 'btn';
    fbtn.textContent = isFullscreen() ? 'EXIT FULLSCREEN  (F)' : 'GO FULLSCREEN  (F)';
    fbtn.onclick = () => {
      toggleFullscreen();
      setTimeout(() => { fbtn.textContent = isFullscreen() ? 'EXIT FULLSCREEN  (F)' : 'GO FULLSCREEN  (F)'; }, 250);
    };
    frow.appendChild(fbtn);
    dh.appendChild(frow);

    const dbg = document.createElement('button');
    dbg.className = 'btn';
    dbg.textContent = 'FORCE FEEDBACK DIAGNOSTICS  (Ctrl+D)';
    dbg.onclick = () => { toggleFfbDebug(true); hideOverlay(); };
    dh.appendChild(dbg);

    const fhint = document.createElement('p');
    fhint.className = 'wheel-hint';
    fhint.innerHTML = 'The game starts fullscreen by default. ' +
      '<code>F</code> toggles it at any time.';
    dh.appendChild(fhint);

    const autoBtn = document.createElement('button');
    autoBtn.className = 'btn btn-ghost';
    autoBtn.textContent = 'RESET TO AUTO';
    autoBtn.onclick = () => { input.value = info.autoScale; apply(info.autoScale, false); };
    dh.appendChild(autoBtn);

    const readout = document.createElement('div');
    readout.className = 'settings-readout';
    readout.innerHTML =
      `<b>window</b> ${info.viewport[0]}×${info.viewport[1]} &nbsp; ` +
      `<b>app</b> ${info.appBox[0]}×${info.appBox[1]} &nbsp; ` +
      `<b>screen</b> ${info.screen[0]}×${info.screen[1]} &nbsp; ` +
      `<b>dpr</b> ${info.dpr} &nbsp; ` +
      `<b>render</b> ${info.buffer[0]}×${info.buffer[1]} &nbsp; ` +
      `<b>canvas</b> ${info.cssSize[0]}×${info.cssSize[1]} &nbsp; ` +
      `<b>ui</b> ×${info.uiScale.toFixed(2)}`;
    dh.appendChild(readout);
  }

  const th = document.getElementById('tuneCards');
  th.innerHTML = '';
  for (const t of SPECS) {
    const el = document.createElement('button');
    el.className = 'card' + (t.id === save.spec ? ' sel' : '');
    el.innerHTML = `<h3>${t.name}</h3><div class="desc">${t.desc}</div>`;
    el.onclick = () => {
      patchSettings({ spec: t.id });
      applySpec(t.id);
      buildGarage();
      audio.ui('ok');
      hud.toast('TUNE: ' + t.name);
    };
    el.onmouseenter = () => audio.ui('move');
    th.appendChild(el);
  }
}

function buildBestStrip() {
  const host = document.getElementById('bestStrip');
  const rows = [];
  for (const def of TRACK_DEFS) {
    for (const m of MODES) {
      const b = save.bests[`${def.id}:${m.id}`];
      if (!b) continue;
      const v = m.laps > 0 ? fmtTime(b.bestLap) : (b.total || 0).toLocaleString();
      rows.push(`<span>${def.name} · ${m.short} <b>${v}</b></span>`);
    }
  }
  host.innerHTML = rows.length ? rows.join('') : '<span>No records yet — go set one.</span>';
}

/* ============================================================
   RUN LIFECYCLE
   ============================================================ */
function startRun(trackDef, mode) {
  audio.init();
  audio.resume();
  document.getElementById('loading').classList.remove('done');

  requestAnimationFrame(() => {
    if (!track || track.def.id !== trackDef.id) loadWorld(trackDef);
    game.manualGearbox = !!save.gearbox;
    game.boostMode = save.boostMode || 'auto';
    // this click is a user gesture, so it is the right moment to go fullscreen
    if (save.fullscreen !== false && !isFullscreen()) requestFullscreen();
    game.start(mode);
    camRig.snap(game.car);
    if (ffb.bridge.status === 'on') ffb.bridge.setRange(wheel.cal.rangeDeg);
    hud.setMode(mode.name);
    hud.setLap(mode.laps > 0 ? `1/${mode.laps}` : '—', mode.laps > 0 ? 'LAP' : 'FREE');
    hideOverlay();
    document.getElementById('loading').classList.add('done');
  });
}

function showResults(res) {
  const key = `${res.track.id}:${res.mode.id}`;
  const prev = save.bests[key];
  let record = false;

  if (res.mode.laps > 0) {
    if (res.bestLap && (!prev || !prev.bestLap || res.bestLap < prev.bestLap)) record = true;
    save.bests[key] = {
      bestLap: record ? res.bestLap : (prev ? prev.bestLap : res.bestLap),
      total: Math.max(res.total, prev ? prev.total || 0 : 0),
      topSpeed: Math.max(res.topSpeed, prev ? prev.topSpeed || 0 : 0),
    };
  } else {
    if (res.total > (prev ? prev.total || 0 : 0)) record = true;
    save.bests[key] = {
      total: Math.max(res.total, prev ? prev.total || 0 : 0),
      bestDrift: Math.max(res.bestDrift, prev ? prev.bestDrift || 0 : 0),
      topSpeed: Math.max(res.topSpeed, prev ? prev.topSpeed || 0 : 0),
    };
  }
  flushSettings();

  const rows = [];
  const add = (k, v, cls = '') => rows.push(`<div class="res-row ${cls}"><span class="k">${k}</span><span class="v">${v}</span></div>`);

  if (res.mode.laps > 0) {
    add('TOTAL TIME', fmtTime(res.elapsed), 'big');
    res.laps.forEach((t, i) => add(`LAP ${i + 1}`, fmtTime(t), t === res.bestLap ? 'rec' : ''));
    add('BEST LAP', fmtTime(res.bestLap), 'rec');
  } else {
    add('FINAL SCORE', res.total.toLocaleString(), 'big');
  }
  add('BEST SINGLE DRIFT', res.bestDrift.toLocaleString());
  add('LONGEST DRIFT', res.longestDrift.toFixed(1) + 's');
  add('DRIFTS BANKED', String(res.drifts));
  add('MINI-TURBOS FIRED', String(res.boosts));
  add('NEAR MISSES', String(res.nearMisses));
  add('WALL CONTACTS', String(res.walls));
  add('TOP SPEED', (res.topSpeed * 3.6).toFixed(0) + ' km/h');

  document.getElementById('resultsTitle').textContent =
    record ? 'NEW RECORD' : 'RUN COMPLETE';
  document.getElementById('resultsBody').innerHTML =
    (record ? '<div class="res-badge">▲ personal best ▲</div>' : '') + rows.join('');

  if (record) audio.ui('record');
  showScreen('results');
}

/* ============================================================
   MENU WIRING
   ============================================================ */
overlay.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const a = btn.dataset.action;
  // audio.init() creates an AudioContext, which a browser can refuse. If it
  // throws here it would take the whole menu action with it: the button would
  // appear to do nothing at all. Sound is never worth losing the game over.
  try { audio.init(); } catch (err) { console.error('[DRIFTBLOCK] audio init failed:', err); }

  switch (a) {
    case 'start':
      audio.ui('ok');
      pendingMode = MODES[0];
      navStack.length = 0;
      navTo('mode', buildModeCards);
      break;
    case 'garage':
      audio.ui('ok');
      navTo('garage', buildGarage);
      break;
    case 'options':
      audio.ui('ok');
      navTo('options', buildOptions);
      break;
    case 'howto':
      audio.ui('ok');
      navTo('how');
      break;
    case 'wheel':
      audio.ui('ok');
      navTo('wheel');
      break;
    case 'wipe':
      if (confirm('Erase all records and settings?')) {
        patchSettings({ bests: {} });
        flushSettings();
        buildBestStrip();
        audio.ui('back');
      }
      break;
    case 'back':
      audio.ui('back');
      goBack();
      break;
    case 'resume':
      audio.ui('ok');
      game.state = 'running';
      hideOverlay();
      break;
    case 'restart':
      audio.ui('ok');
      startRun(track.def, game.mode);
      break;
    case 'quit':
      audio.ui('back');
      navStack.length = 0;
      game.state = 'idle';
      hud.show(false);
      buildBestStrip();
      showScreen('title');
      break;
  }
});

/* ============================================================
   FLOAT TEXT PROJECTION
   ============================================================ */
const _v = new THREE.Vector3();
function projectToScreen(x, y, z) {
  _v.set(x, y, z).project(camera);
  if (_v.z > 1) return null;
  return {
    x: (_v.x * 0.5 + 0.5) * innerWidth,
    y: (-_v.y * 0.5 + 0.5) * innerHeight,
  };
}

/* ============================================================
   MAIN LOOP
   ============================================================ */
const FIXED = 1 / 120;
let acc = 0;
let last = performance.now();
let floatCd = 0;
let ffbTick = 0;

/* ============================================================
   FRAME LOOP — AND WHY IT IS WRAPPED IN A try/catch
   ============================================================
   A single thrown error inside the loop used to stop
   requestAnimationFrame being re-armed, which killed the loop for good.
   The game then sat frozen on its last frame: steering, pedals, buttons
   and even Escape all dead, with the UI still showing whatever it last
   rendered. That is indistinguishable from "my wheel stopped working",
   and it sent us chasing a force-feedback bug that was really a
   ReferenceError in the smoke code.

   Re-arming FIRST means the loop survives anything the body does, and
   the error is put on screen so it can never fail silently again.
   ============================================================ */
let frameErrors = 0;
function reportFrameError(err) {
  frameErrors++;
  const msg = (err && err.message) || String(err);
  const where = (err && err.stack) ? String(err.stack).split('\n')[1] : '';
  console.error('[DRIFTBLOCK] frame error:', err);

  let box = document.getElementById('crashBox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'crashBox';
    document.body.appendChild(box);
  }
  box.innerHTML =
    '<b>Something broke in the game loop</b>' +
    `<code>${msg}</code>` +
    `<span>${where.trim()}</span>` +
    `<em>The game keeps running so you can save and report this. ` +
    `${frameErrors} error${frameErrors === 1 ? '' : 's'} so far.</em>`;
  box.classList.add('show');
}

function frame(now) {
  // re-arm BEFORE the body, so a throw cannot kill the loop
  addEventListener('pagehide', flushSettings);
addEventListener('visibilitychange', () => { if (document.hidden) flushSettings(); });

requestAnimationFrame(frame);
  try {
    frameBody(now);
  } catch (err) {
    reportFrameError(err);
  }
}

function frameBody(now) {
  const rawDt = Math.min(0.05, (now - last) / 1000);
  last = now;

  input.update(rawDt);

  if (input.state.fullscreenToggle) toggleFullscreen();

  // 1-4 change spec on the fly, mid-corner, without pausing
  if (input.state.specPick >= 0 && game && game.state !== 'idle') {
    const spec = SPECS[input.state.specPick];
    if (spec && spec.id !== save.spec) changeSpec(spec.id);
  }

  if (input.state.pause) {
    const inSubScreen = overlay && !overlay.classList.contains('hidden') && currentScreen !== 'pause';
    if (game && game.state === 'paused' && inSubScreen) {
      // Escape while reading a sub-screen steps back to the pause menu rather
      // than dropping you straight back into the run.
      audio.ui('back');
      goBack();
    } else if (game && game.state === 'running') {
      game.state = 'paused';
      navStack.length = 0;
      buildSpecCards(document.getElementById('pauseSpecCards'), { compact: true });
      showScreen('pause');
      audio.suspend();
    } else if (game && game.state === 'paused') {
      game.state = 'running';
      hideOverlay();
      audio.resume();
    }
  }

  if (game && input.state.camToggle) {
    hud.toast('CAM: ' + camRig.cycle(), 1.0);
  }
  if (game && input.state.reset && (game.state === 'running')) {
    game.resetCar();
  }

  // ---- fixed-step simulation
  const active = game && (game.state === 'running' || game.state === 'countdown');
  acc += rawDt;
  let steps = 0;
  while (acc >= FIXED && steps < 8) {
    if (active) {
      game.step(FIXED, input.state);
    } else if (game && game.state === 'finished') {
      game.step(FIXED, input.state);
    }
    acc -= FIXED;
    steps++;
  }
  if (acc > FIXED * 8) acc = 0;

  // ---- visuals
  if (game && track) {
    const st = game.car;
    updateCarVisual(carMesh, st, input.state, rawDt, game.onGrass);
    effects.update(rawDt, st, { onGrass: game.onGrass, boost: st.boost, wheelspin: st.wheelspin, painting: paint });
    camRig.update(rawDt, st, { boost: st.boost, accel: st.longAccel });
    track.updateShadow(st);
    track.updateClouds(rawDt);

    // ---- audio
    const rpm = game.hudData(rawDt);
    audio.updateEngine({
      rpm: st.rpm,
      rpm01: rpm.rpm01,
      limiter: st.limiter,
      overrun: st.overrun,
      throttle: input.state.throttle,
      speed01: clamp(st.speed / (TUNE.topSpeed), 0, 1),
      slip: st.absSlip,
      onGrass: game.onGrass,
      engineOn: game.state !== 'idle' && game.state !== 'paused',
      boost: st.boost,
    });

    // a gear change is an event, not a state — announce it once
    if (st.justShifted) {
      audio.shift(st.shiftUp);
      camRig.addShake(st.shiftUp ? 0.10 : 0.16);
    }

    // ---- hud
    hud.update(rawDt, rpm);

    hud.drawMinimap(st.x, st.z, st.yaw, game.drifting);

    // ---- force feedback
    if (game.state !== 'paused') {
      ffb.update(rawDt, st, {
        drifting: game.drifting,
        onGrass: game.onGrass,
        boost: st.boost,
        rpm01: rpm.rpm01,
        active: game.state === 'running' || game.state === 'countdown',
      });
    }

    if (game.mode.time > 0) hud.setTimer(game.timeLeft);
    else hud.setTimer(game.elapsed);

    if (game.mode.laps > 0) {
      hud.setLap(`${Math.min(game.lap, game.mode.laps)}/${game.mode.laps}`, 'LAP');
    } else if (game.mode.id === 'drift') {
      hud.setLap(String(game.stats.drifts), 'DRIFTS BANKED');
    } else {
      hud.setLap((st.speed * 3.6).toFixed(0), 'KM/H');
    }

    // ---- banked-score float over the car
    if (game._pendingFloat) {
      const f = game._pendingFloat;
      f.t -= rawDt;
      const p = projectToScreen(st.x, 2.3, st.z);
      if (p && f.t > 0 && !f.el) {
        hud.float(p.x, p.y, f.text, '#46f5a0');
        f.el = true;
      }
      if (f.t <= 0) game._pendingFloat = null;
    }

    // ---- countdown numbers
    if (game.state === 'countdown') {
      const n = Math.ceil(game.countdown);
      if (n !== game._lastCount) {
        game._lastCount = n;
        if (n >= 1 && n <= 3) hud.pop(String(n), 'pop-lap');
      }
    }

    // ---- screen space effects
    // Read off the camera's own FOV transient rather than recomputing it, so
    // the frame and the lens are driven by the same number and cannot drift
    // apart. `fovPunch` is the part of the FOV that is NOT steady-state speed.
    const app = document.getElementById('app');
    const sf01 = clamp(st.speed / TUNE.topSpeed, 0, 1);
    const punch = camRig.fovPunch || 0;

    const vig = clamp(0.26 + sf01 * 0.42 + punch * 0.20, 0, 1);
    app.style.setProperty('--vig', vig.toFixed(3));

    // the clear centre closes in with speed, and harder when the view is
    // being pushed — this is the effect that actually reads as going fast
    const pull = clamp(sf01 * 9 + punch * 13, 0, 22);
    app.style.setProperty('--vigPull', pull.toFixed(1) + '%');

    // and the edges cool towards blue under load, then warm back out
    const tintA = clamp(sf01 * 0.30 + punch * 0.45, 0, 0.8);
    app.style.setProperty('--vigTintA', tintA.toFixed(3));
    app.style.setProperty('--vigTint', punch > 0.35
      ? 'rgba(40,90,190,0.85)' : 'rgba(12,16,32,0.85)');
  }

  // the wheel can be plugged in at any time; re-probe periodically
  ffbTick += rawDt;
  if (ffbTick > 0.5) {
    ffbTick = 0;
    const pad = wheel.wheel || null;
    const before = ffb.supported;
    ffb.probe(pad);
    if (ffb.supported !== before) wheelUI.refreshStatus();
  }
  wheelUI.update();

  renderer.render(scene, camera);
  input.endFrame();
}

/* ============================================================
   GO
   ============================================================ */
loadWorld(TRACK_DEFS[0]);
buildBestStrip();
buildModeCards();
hud.show(false);

// idle showcase: let the camera drift slowly around the start line
camRig.snap(game.car);
game.state = 'idle';

setTimeout(() => document.getElementById('loading').classList.add('done'), 350);
// The loop is armed and every module resolved: record it so a headless
// check can tell "running" from "the module threw on load".
document.documentElement.dataset.boot = 'ok';
requestAnimationFrame(frame);

// expose for debugging / tuning from the console
window.DRIFTBLOCK = {
  TUNE, camera, renderer, scene, startRun, loadWorld, TRACK_DEFS, MODES, PAINTS,
  input, hud, audio, camRig, wheel, ffb, wheelUI, save,
  // live handles — these are reassigned when the world is rebuilt
  get game() { return game; },
  get track() { return track; },
  get effects() { return effects; },
  get carMesh() { return carMesh; },
  /** One-line health summary, for smoke tests and bug reports. */
  health() {
    return {
      booted: true,
      state: game ? game.state : 'none',
      settings: Object.keys(save).sort(),
      wheelSeen: !!(wheel && wheel.connected),
      wheelEverSeen: !!(wheel && wheel.everSeen),
      ffb: ffb ? ffb.bridge.status : 'none',
      track: track ? track.def.id : 'none',
      frameErrors: typeof frameErrors === 'number' ? frameErrors : -1,
    };
  },
};
