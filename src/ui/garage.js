/* ============================================================
   GARAGE — the car itself: paint and spec.

   Everything that is not the car (audio, display, gameplay) lives in
   ui/options.js. The spec cards are shared with the in-run pause
   picker, so a spec change uses exactly the same UI in both places.
   ============================================================ */

import * as THREE from '../../vendor/three.module.js';
import { PAINTS, SECRET_PAINT } from '../render/car.js';
import { SPECS, applySpec } from '../physics/specs.js';
import { TUNE } from '../physics/index.js';
import { patch as patchSettings } from '../core/settings.js';

let deps = null;
let secretBuffer = '';
let secretBound = false;

/** @param {{save:object, audio:object, hud:object, getGame:()=>object, flush:()=>void}} d */
export function init(d) {
  deps = d;
  bindSecretCode();
}

/** Type `brabus` while the garage is open to reveal the owner's car. */
function bindSecretCode() {
  if (secretBound || typeof window === 'undefined') return;
  secretBound = true;
  window.addEventListener('keydown', (e) => {
    const screen = document.getElementById('screenGarage');
    if (!screen || screen.classList.contains('hidden')) { secretBuffer = ''; return; }
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (!e.key || e.key.length !== 1) return;
    secretBuffer = (secretBuffer + e.key.toLowerCase()).slice(-6);
    if (secretBuffer === 'brabus' && !deps.save.brabusUnlocked) {
      secretBuffer = '';
      patchSettings({ brabusUnlocked: true });
      deps.flush();
      deps.audio.ui('ok');
      deps.hud.toast('SECRET CAR UNLOCKED', 2.4);
      buildGarage();
    }
  });
}

/** Select the original shell, the imported Tourer, or the unlocked R170. */
function chooseCar(id) {
  if (id === 'brabus' && !deps.save.brabusUnlocked) return;
  if ((deps.save.car || 'stock') === id) return;
  patchSettings({ car: id });
  deps.flush();
  deps.audio.ui('ok');
  location.reload();
}

/** Car cards: the factory shell, the imported Tourer, and the secret R170. */
function buildCarCards() {
  const host = document.getElementById('carCards');
  if (!host) return;
  host.innerHTML = '';
  const unlocked = !!deps.save.brabusUnlocked;
  const active = deps.save.car === 'brabus' && unlocked ? 'brabus'
    : deps.save.car === 'citroen' ? 'citroen' : 'stock';

  const stock = document.createElement('button');
  stock.className = 'card car-card' + (active === 'stock' ? ' sel' : '');
  stock.innerHTML = `<div class="car-thumb stock"></div>
    <h3>ORIGINAL</h3>
    <div class="desc">The original DRIFTBLOCK car. Bright, boxy, unbothered.</div>
    <div class="meta">OG BODY</div>`;
  stock.onclick = () => chooseCar('stock');
  stock.onmouseenter = () => deps.audio.ui('move');
  host.appendChild(stock);

  const citroen = document.createElement('button');
  citroen.className = 'card car-card' + (active === 'citroen' ? ' sel' : '');
  citroen.innerHTML = `<div class="car-thumb citroen"></div>
    <h3>CITROEN C5 TOURER</h3>
    <div class="desc">The imported C5 Tourer — a long-roof French cruiser with steering front wheels and working brake lights.</div>
    <div class="meta">IMPORTED · CC BY 4.0</div>`;
  citroen.onclick = () => chooseCar('citroen');
  citroen.onmouseenter = () => deps.audio.ui('move');
  host.appendChild(citroen);

  if (!unlocked) return;
  const hidden = document.createElement('button');
  hidden.className = 'card car-card hidden-car' + (active === 'brabus' ? ' sel' : '');
  hidden.innerHTML = `<div class="car-thumb brabus"></div>
    <h3>BRABUS 200 K</h3>
    <div class="desc">The full imported R170 — black paint, real cockpit, working gauges.</div>
    <div class="meta">SECRET · OWNER'S CAR</div>`;
  hidden.onclick = () => chooseCar('brabus');
  hidden.onmouseenter = () => deps.audio.ui('move');
  host.appendChild(hidden);
}

/**
 * Change the car spec. Safe mid-run: a spec only moves grip, yaw, engine and
 * brake values, none of which the car's mesh depends on, so the car keeps its
 * geometry, position and speed.
 *
 * The one piece of bookkeeping needed is the gearbox: a spec can change the
 * achievable top speed, which rescales every gear's redline speed, so the
 * selected gear may no longer exist or may be out of range afterwards.
 *
 * @param {string} id
 */
export function changeSpec(id) {
  const spec = applySpec(id);
  patchSettings({ spec: id });

  const game = deps.getGame();
  if (game && game.car) {
    const maxGear = TUNE.gearRatios.length;
    game.car.playerGear = Math.max(-1, Math.min(maxGear, game.car.playerGear));
    game.car.gear = Math.min(maxGear, game.car.gear);
  }

  deps.hud.toast('SPEC: ' + spec.name, 1.4);
  deps.audio.ui('ok');
  return spec;
}

/** Refresh both spec pickers after a change. */
export function rebuildSpecPickers() {
  buildSpecCards(document.getElementById('tuneCards'));
  buildSpecCards(document.getElementById('pauseSpecCards'), { compact: true });
}

/**
 * The spec cards. Shared by the garage and the in-run pause picker.
 * @param {HTMLElement} host
 * @param {{compact?: boolean, onPick?: () => void}} [opts]
 */
export function buildSpecCards(host, opts = {}) {
  if (!host) return;
  host.innerHTML = '';
  for (const t of SPECS) {
    const el = document.createElement('button');
    el.className = 'card' + (t.id === deps.save.spec ? ' sel' : '') + (opts.compact ? ' compact' : '');
    el.innerHTML = `<h3>${t.name}</h3><div class="desc">${t.desc}</div>`;
    el.onclick = () => {
      changeSpec(t.id);
      rebuildSpecPickers();
      if (opts.onPick) opts.onPick();
    };
    el.onmouseenter = () => deps.audio.ui('move');
    host.appendChild(el);
  }
}

/** Paint swatches plus the spec cards. */
export function buildGarage() {
  const ph = document.getElementById('paintCards');
  if (!ph) return;
  buildCarCards();
  ph.innerHTML = '';
  const secret = deps.save.car === 'brabus' && deps.save.brabusUnlocked;
  // The original car can wear any OG paint. The owner's car is fixed black.
  const palette = secret ? [SECRET_PAINT] : PAINTS;
  const active = secret
    ? SECRET_PAINT.id
    : (PAINTS.some((p) => p.id === deps.save.paint) ? deps.save.paint : PAINTS[0].id);
  for (const p of palette) {
    const el = document.createElement('button');
    el.className = 'card' + (p.id === active ? ' sel' : '') + (secret ? ' fixed' : '');
    const col = '#' + new THREE.Color(p.body).getHexString();
    const acc = '#' + new THREE.Color(p.accent).getHexString();
    el.innerHTML = `<div class="swatch" style="background:linear-gradient(90deg, ${col} 65%, ${acc} 65%)"></div>
      <h3>${p.name}</h3>`;
    if (secret) {
      el.style.cursor = 'default';
    } else {
      el.onclick = () => {
        // Paint changes the mesh, so this one does need a rebuild. Save
        // immediately rather than waiting for the debounce.
        patchSettings({ paint: p.id });
        deps.flush();
        location.reload();
      };
    }
    el.onmouseenter = () => deps.audio.ui('move');
    ph.appendChild(el);
  }

  buildSpecCards(document.getElementById('tuneCards'));
}
