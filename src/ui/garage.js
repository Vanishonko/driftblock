/* ============================================================
   GARAGE — the car itself: paint and spec.

   Everything that is not the car (audio, display, gameplay) lives in
   ui/options.js. The spec cards are shared with the in-run pause
   picker, so a spec change uses exactly the same UI in both places.
   ============================================================ */

import * as THREE from '../../vendor/three.module.js';
import { PAINTS } from '../render/car.js';
import { SPECS, applySpec } from '../physics/specs.js';
import { TUNE } from '../physics/index.js';
import { patch as patchSettings } from '../core/settings.js';

let deps = null;

/** @param {{save:object, audio:object, hud:object, getGame:()=>object}} d */
export function init(d) { deps = d; }

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
  ph.innerHTML = '';
  for (const p of PAINTS) {
    const el = document.createElement('button');
    el.className = 'card' + (p.id === (deps.save.paint) ? ' sel' : '');
    const col = '#' + new THREE.Color(p.body).getHexString();
    const acc = '#' + new THREE.Color(p.accent).getHexString();
    el.innerHTML = `<div class="swatch" style="background:linear-gradient(90deg, ${col} 65%, ${acc} 65%)"></div>
      <h3>${p.name}</h3>`;
    el.onclick = () => {
      // Paint changes the mesh, so this one does need a rebuild. Save
      // immediately rather than waiting for the debounce.
      patchSettings({ paint: p.id });
      deps.flush();
      location.reload();
    };
    el.onmouseenter = () => deps.audio.ui('move');
    ph.appendChild(el);
  }

  buildSpecCards(document.getElementById('tuneCards'));
}
