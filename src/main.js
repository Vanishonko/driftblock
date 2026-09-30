/* ============================================================
   DRIFTBLOCK — main
   ============================================================ */

import * as THREE from '../vendor/three.module.js';
import { Input } from './input.js';
import { GameAudio } from './audio.js';
import { TRACK_DEFS, Track, previewOutline } from './track.js';
import { createCarMesh, updateCarVisual, PAINTS } from './car.js';
import { ChaseCamera } from './camera.js';
import { Effects } from './effects.js';
import { HUD } from './hud.js';
import { Game, MODES, fmtTime, SCORE } from './game.js';
import { TUNE, clamp, invalidateTopSpeed } from './physics.js';
import { WheelInput, defaultCalibration } from './wheel.js';
import { ForceFeedback } from './ffb.js';
import { WheelUI } from './wheelui.js';

/* ============================================================
   TUNING PRESETS
   ============================================================ */
const BASE_TUNE = JSON.parse(JSON.stringify(TUNE));

const TUNES = [
  {
    id: 'balanced', name: 'BALANCED', desc: 'The default. Predictable on entry, forgiving on exit.',
    mods: {},
  },
  {
    id: 'drift', name: 'DRIFT SPEC', desc: 'Loose rear, faster steering, more yaw. Slides start instantly and hold forever.',
    mods: { gripNormal: 0.82, gripPower: 0.86, gripHandbrake: 0.88, maxYawRate: 1.10, alignK: 0.82, engineAccel: 0.96 },
  },
  {
    id: 'grip', name: 'GRIP SPEC', desc: 'More mechanical grip and a higher redline. Quicker lap times, harder to break traction.',
    mods: { gripNormal: 1.16, gripPower: 1.10, gripHandbrake: 1.14, topSpeed: 1.06, engineAccel: 1.06, maxYawRate: 0.94 },
  },
  {
    id: 'monster', name: 'MONSTER', desc: 'Absurd power, absurd top end, absurd consequences. Good luck.',
    mods: { engineAccel: 1.34, topSpeed: 1.14, gripNormal: 0.88, gripPower: 0.92, maxYawRate: 1.06, brakeAccel: 1.08 },
  },
];

function applyTune(id) {
  const t = TUNES.find((x) => x.id === id) || TUNES[0];
  for (const k of Object.keys(TUNE)) {
    if (typeof BASE_TUNE[k] === 'number') TUNE[k] = BASE_TUNE[k];
  }
  for (const [k, mul] of Object.entries(t.mods)) {
    if (typeof TUNE[k] === 'number') TUNE[k] = BASE_TUNE[k] * mul;
  }
  // the gearbox is scaled against the achievable top speed, which just moved
  invalidateTopSpeed();
  return t;
}

/* ============================================================
   SAVE
   ============================================================ */
const SAVE_KEY = 'driftblock.v1';
const DEFAULT_SAVE = { paint: 'magenta', tune: 'balanced', bests: {}, wheel: null, volume: 0.72, engineVol: 1.0, uiScale: null, gearbox: false };

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { ...DEFAULT_SAVE };
    return { ...DEFAULT_SAVE, ...JSON.parse(raw) };
  } catch { return { ...DEFAULT_SAVE }; }
}
function writeSave(s) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

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

const save = loadSave();
applyTune(save.tune);

if (save.wheel) wheel.setCalibration(save.wheel);
wheel.enabled = true;
input.attachWheel(wheel, ffb);
ffb.setConfig(wheel.cal);

const wheelUI = new WheelUI(wheel, ffb, save, () => {
  writeSave(save);
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
audio.setMasterVolume(save.volume ?? 0.72);
audio.setEngineVolume(save.engineVol ?? 1.0);

/* ---------------- world ---------------- */
let track = null;
let effects = null;
let carMesh = null;
let game = null;
const camRig = new ChaseCamera(camera);
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
  wheel: document.getElementById('screenWheel'),
  how: document.getElementById('screenHow'),
  pause: document.getElementById('screenPause'),
  results: document.getElementById('screenResults'),
};

let currentScreen = 'title';
let pendingMode = MODES[0];

function showScreen(name) {
  overlay.classList.remove('hidden');
  for (const [k, el] of Object.entries(screens)) el.classList.toggle('hidden', k !== name);
  currentScreen = name;
  hud.show(false);
  if (name === 'wheel') wheelUI.open(); else wheelUI.close();
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
      showScreen('track');
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

function buildGarage() {
  const ph = document.getElementById('paintCards');
  ph.innerHTML = '';
  for (const p of PAINTS) {
    const el = document.createElement('button');
    el.className = 'card' + (p.id === paint.id ? ' sel' : '');
    const col = '#' + new THREE.Color(p.body).getHexString();
    const acc = '#' + new THREE.Color(p.accent).getHexString();
    el.innerHTML = `<div class="swatch" style="background:linear-gradient(90deg, ${col} 65%, ${acc} 65%)"></div>
      <h3>${p.name}</h3>`;
    el.onclick = () => {
      save.paint = p.id;
      writeSave(save);
      location.reload();
    };
    el.onmouseenter = () => audio.ui('move');
    ph.appendChild(el);
  }

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
        save.volume = save.volume; writeSave(save);
      };
      row.appendChild(input); row.appendChild(out);
      ah.appendChild(row);
    };
    mk('MASTER VOLUME', () => save.volume, (v) => { save.volume = v; audio.setMasterVolume(v); });
    mk('ENGINE VOLUME', () => save.engineVol, (v) => { save.engineVol = v; audio.setEngineVolume(v); });
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
      save.uiScale = manual ? v : null;
      writeSave(save);
      resize();
      const i2 = displayInfo();
      out.textContent = (manual ? '×' : 'AUTO ×') + (manual ? v.toFixed(2) : i2.autoScale.toFixed(2));
    };
    input.oninput = () => apply(parseFloat(input.value), true);
    row.appendChild(input); row.appendChild(out);
    dh.appendChild(row);

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
  for (const t of TUNES) {
    const el = document.createElement('button');
    el.className = 'card' + (t.id === save.tune ? ' sel' : '');
    el.innerHTML = `<h3>${t.name}</h3><div class="desc">${t.desc}</div>`;
    el.onclick = () => {
      save.tune = t.id;
      writeSave(save);
      applyTune(t.id);
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
  writeSave(save);

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
  audio.init();

  switch (a) {
    case 'start':
      audio.ui('ok');
      pendingMode = MODES[0];
      buildModeCards();
      showScreen('mode');
      break;
    case 'garage':
      audio.ui('ok');
      buildGarage();
      showScreen('garage');
      break;
    case 'howto':
      audio.ui('ok');
      showScreen('how');
      break;
    case 'wheel':
      audio.ui('ok');
      showScreen('wheel');
      break;
    case 'wipe':
      if (confirm('Erase all records and settings?')) {
        save.bests = {};
        writeSave(save);
        buildBestStrip();
        audio.ui('back');
      }
      break;
    case 'back':
      audio.ui('back');
      if (currentScreen === 'track') { buildModeCards(); showScreen('mode'); }
      else { buildBestStrip(); showScreen('title'); }
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
      game.state = 'idle';
      hud.show(false);
      buildBestStrip();
      showScreen('title');
      break;
  }
});

/* ============================================================
   RESIZE
   ============================================================ */
/**
 * Fit the canvas to the window.
 *
 * Several things make this fussier than it looks on a multi-monitor sim
 * rig: devicePixelRatio changes when the window moves between displays,
 * macOS fullscreen animates so the final size arrives after the event,
 * and a 5K panel at dpr 2 would ask for a ~33 megapixel drawing buffer.
 * So: re-read dpr every time, set the CSS size explicitly rather than
 * trusting the stylesheet, cap the buffer area, and listen to more than
 * just `resize`.
 */
const MAX_BUFFER_PIXELS = 5.5e6;
let lastUiScale = 1;
let lastAutoScale = 1;

function resize() {
  // Measure the element the canvas actually lives in rather than trusting
  // window.innerWidth/innerHeight, which can disagree with the real layout
  // box on a scaled display and leave the canvas short of the viewport.
  const host = canvas.parentElement || document.documentElement;
  const box = host.getBoundingClientRect();
  const w = Math.max(1, Math.round(box.width) || window.innerWidth || 1);
  const h = Math.max(1, Math.round(box.height) || window.innerHeight || 1);

  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  while (dpr > 1 && w * h * dpr * dpr > MAX_BUFFER_PIXELS) dpr -= 0.25;

  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);

  // set the CSS size in pixels too, so the canvas cannot disagree with the
  // window about how big it should be
  const cv = renderer.domElement;
  cv.style.width = w + 'px';
  cv.style.height = h + 'px';

  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  applyUiScale(w, h);
}

/**
 * Size the HUD so it occupies a consistent fraction of the screen.
 *
 * The HUD is laid out in fixed pixels, so on a display whose CSS viewport is
 * much smaller than the panel — a scaled HiDPI mode, or browser zoom — it
 * balloons: the speedometer alone goes from 13% of the width at 1920 to 25%
 * at 1024. Scaling it keeps the interface the same relative size everywhere.
 */
function applyUiScale(w, h) {
  const auto = clamp(Math.min(w / 1920, h / 1080), 0.55, 1.35);
  const manual = (typeof save.uiScale === 'number' && save.uiScale > 0) ? save.uiScale : null;
  const ui = manual === null ? auto : clamp(manual, 0.4, 2);
  document.documentElement.style.setProperty('--ui', ui.toFixed(3));
  lastUiScale = ui;
  lastAutoScale = auto;
}

/** Everything the display settings panel needs to explain what is going on. */
function displayInfo() {
  const cv = renderer.domElement;
  return {
    viewport: [window.innerWidth, window.innerHeight],
    appBox: (() => {
      const host = renderer.domElement.parentElement;
      const b = host ? host.getBoundingClientRect() : null;
      return b ? [Math.round(b.width), Math.round(b.height)] : [0, 0];
    })(),
    screen: [window.screen ? window.screen.width : 0, window.screen ? window.screen.height : 0],
    dpr: window.devicePixelRatio || 1,
    buffer: [cv.width, cv.height],
    cssSize: [Math.round(cv.getBoundingClientRect().width), Math.round(cv.getBoundingClientRect().height)],
    uiScale: lastUiScale,
    autoScale: lastAutoScale,
  };
}


addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 60));
if (window.visualViewport) {
  visualViewport.addEventListener('resize', resize);
  visualViewport.addEventListener('scroll', resize);
}
// fullscreen animates on macOS, so re-fit once it has settled
for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) {
  document.addEventListener(ev, () => {
    resize();
    setTimeout(resize, 80);
    setTimeout(resize, 320);
  });
}
if (window.ResizeObserver) {
  new ResizeObserver(resize).observe(document.documentElement);
}
addEventListener('load', resize);
resize();

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

function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = Math.min(0.05, (now - last) / 1000);
  last = now;

  input.update(rawDt);

  if (input.state.pause) {
    if (game && game.state === 'running') {
      game.state = 'paused';
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
    effects.update(rawDt, st, { onGrass: game.onGrass, boost: st.boost, painting: paint });
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

    // ---- vignette intensity from speed
    const vig = clamp(0.30 + (st.speed / TUNE.topSpeed) * 0.55 + (st.boost > 0 ? 0.15 : 0), 0, 1);
    document.getElementById('app').style.setProperty('--vig', vig.toFixed(3));
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
requestAnimationFrame(frame);

// expose for debugging / tuning from the console
window.DRIFTBLOCK = {
  TUNE, camera, renderer, scene, startRun, loadWorld, TRACK_DEFS, MODES, PAINTS,
  input, hud, audio, camRig, wheel, ffb, wheelUI,
  // live handles — these are reassigned when the world is rebuilt
  get game() { return game; },
  get track() { return track; },
  get effects() { return effects; },
  get carMesh() { return carMesh; },
};
