/* ============================================================
   IMPORTED CITROEN C5 TOURER — the estate body from the supplied
   Sketchfab model, with its four wheels on steer/spin pivots and its
   red rear lenses wired to the game's brake-light state.

   COSMETIC ONLY. Nothing in here affects the simulation.
   ============================================================ */

import * as THREE from '../../vendor/three.module.js';
import { GLTFLoader } from '../../vendor/GLTFLoader.js';

const MODEL_URL = new URL(
  '../../assets/mods/citroen-c5/citroen-c5-tourer-game.glb',
  import.meta.url,
).href;

let citroenScene = null;
let loadPromise = null;

/**
 * Load the Tourer once, only when it is the selected car. In Node/boot tests
 * there is no window, so this resolves to null and the caller falls back to the
 * original car.
 * @returns {Promise<THREE.Group|null>}
 */
export async function loadCitroen() {
  if (citroenScene) return citroenScene;
  if (typeof window === 'undefined' || typeof fetch !== 'function') return null;
  if (!loadPromise) {
    loadPromise = new GLTFLoader().loadAsync(MODEL_URL)
      .then((gltf) => {
        citroenScene = gltf.scene;
        return citroenScene;
      })
      .catch((err) => {
        console.warn('[DRIFTBLOCK] Citroen C5 Tourer did not load; using the original car.', err);
        return null;
      });
  }
  return loadPromise;
}

/** A cheap Phong material for the imported body and wheels. */
function phong(options) {
  return new THREE.MeshPhongMaterial({
    side: THREE.DoubleSide,
    flatShading: false,
    ...options,
  });
}

/**
 * Build the visible Tourer on the game chassis. The model is already in
 * metres, grounded at y=0 and centred on its wheelbase, so the only offset is
 * the chassis ride height.
 * @param {object} paint one of PAINTS
 * @returns {object|null} the mesh plus its named parts, or null on a bad asset
 */
export function createCitroenCar(paint) {
  if (!citroenScene) return null;

  const root = new THREE.Group();
  const chassis = new THREE.Group();
  chassis.position.y = 0.52;
  root.add(chassis);

  const model = citroenScene.clone(true);
  model.position.set(0, -chassis.position.y, 0);
  chassis.add(model);

  const cache = new Map();
  const brakeMats = [];

  /** Convert one imported (transmission-heavy) material to a game material. */
  function convert(src) {
    if (!src) return src;
    const key = src.uuid + (src.name && src.name.startsWith('carpaint') ? ':' + paint.body : '');
    if (cache.has(key)) return cache.get(key);

    const name = (src.name || '').toLowerCase();
    const base = src.color ? src.color.getHex() : 0x888888;
    let mat;

    if (name.startsWith('carpaint')) {
      mat = phong({
        color: paint.body,
        specular: 0x3b4149,
        shininess: 58,
      });
    } else if (name.startsWith('redglass')) {
      // The Tourer's rear lens cluster. `updateCarVisual` drives emissive.
      mat = phong({
        color: 0x4a0a10,
        specular: 0x6a1a1a,
        shininess: 90,
        emissive: 0x000000,
        emissiveIntensity: 0,
      });
      brakeMats.push(mat);
    } else if (name.startsWith('windowglass')) {
      mat = phong({
        color: 0x05070b,
        specular: 0x1a2633,
        shininess: 90,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      });
    } else if (name.startsWith('clearglass')) {
      mat = phong({
        color: 0xaeb9c6,
        specular: 0xffffff,
        shininess: 120,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      });
    } else if (name.startsWith('chrome') || name.startsWith('mirror')) {
      mat = phong({
        color: 0xc4cbd4,
        specular: 0xffffff,
        shininess: 105,
      });
    } else if (name.startsWith('interior') || name.startsWith('lambert')) {
      mat = phong({
        color: 0x1c1712,
        specular: 0x24201c,
        shininess: 14,
      });
    } else if (name.startsWith('black')) {
      mat = phong({
        color: 0x111318,
        specular: 0x20242b,
        shininess: 25,
      });
    } else if (name.startsWith('tire')) {
      mat = phong({
        color: 0x0b0c0f,
        specular: 0x15171c,
        shininess: 8,
      });
    } else if (name.startsWith('rim')) {
      mat = phong({
        color: 0xbfc6d0,
        specular: 0xffffff,
        shininess: 100,
      });
    } else if (name.startsWith('brakedisk')) {
      mat = phong({
        color: 0x3b3f46,
        specular: 0x6a707a,
        shininess: 40,
      });
    } else if (name.startsWith('mattemetal')) {
      mat = phong({
        color: 0x9aa3ad,
        specular: 0xf0f0f0,
        shininess: 70,
      });
    } else {
      mat = phong({
        color: base,
        specular: 0x222222,
        shininess: 30,
      });
    }

    cache.set(key, mat);
    return mat;
  }

  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    o.receiveShadow = true;
    const src = Array.isArray(o.material) ? o.material : [o.material];
    const next = src.map(convert);
    o.material = Array.isArray(o.material) ? next : next[0];
  });

  // Imported wheel pivots (created by tools/blender/citroen_build.py).
  const wheels = [];
  for (const [corner, front] of [['FL', true], ['FR', true], ['RL', false], ['RR', false]]) {
    const pivot = model.getObjectByName('WHEEL_STEER_' + corner);
    const spin = model.getObjectByName('WHEEL_SPIN_' + corner);
    if (!pivot || !spin) {
      console.warn(`[DRIFTBLOCK] Citroen C5 Tourer has no ${corner} wheel pivots; using the original car.`);
      return null;
    }
    wheels.push({ pivot, spin, steer: front, keepPos: true });
  }

  return {
    _imported: true,
    kind: 'citroen',
    root, chassis, body: model, wheels, flames: [],
    brakeMat: new THREE.MeshPhongMaterial({ color: 0x8a101c }),
    brakeMats,
    headMat: new THREE.MeshPhongMaterial({ color: 0xfff6d0 }),
    paint,
    steerWheel: null,
    needles: null,
    needle2d: null,
    hazard: null,
    // Cosmetic smoke/skid contact points (wheelbase is already centred).
    wheelContact: { x: 0.7847, z: 1.39625 },
    _roll: 0, _pitch: 0, _steerVis: 0,
  };
}
