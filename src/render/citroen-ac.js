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

/** One point of a five-pointed star, for the EU badge. */
function drawStar(ctx, cx, cy, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + i * Math.PI / 5;
    const radius = i % 2 === 0 ? r : r * 0.42;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * A Bulgarian plate: EU blue band with stars and BG, then the registration
 * grouped as the country displays it.
 * @returns {THREE.CanvasTexture|null}
 */
function makeBulgarianPlate() {
  if (typeof document === 'undefined') return null;

  const W = 1024, H = 216;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#f4f2e8';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#1b1e24';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, W - 10, H - 10);

  const band = 122;
  ctx.fillStyle = '#003399';
  ctx.fillRect(10, 10, band, H - 20);
  const cx = 10 + band / 2;
  for (let i = 0; i < 12; i++) {
    const angle = -Math.PI / 2 + i * Math.PI / 6;
    drawStar(ctx, cx + Math.cos(angle) * 29, 78 + Math.sin(angle) * 29, 5.5, '#ffd617');
  }
  ctx.fillStyle = '#f4f2e8';
  ctx.font = 'bold 42px Arial, Helvetica, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('BG', cx, 171);

  // Bulgarian registration grouping: two letters, four digits, two letters.
  ctx.fillStyle = '#161a20';
  ctx.font = 'bold 116px Arial, Helvetica, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CB 9107 CH', band + (W - band) / 2, H / 2 + 3);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Find the one body mesh that uses a material with this name prefix. */
function meshWithMaterial(model, prefix) {
  let found = null;
  model.traverse((o) => {
    if (found || !o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.some((m) => m && (m.name || '').toLowerCase().startsWith(prefix))) found = o;
  });
  return found;
}

/** Vertices of one plate cluster (front z>0, rear z<0) in model space. */
function platePoints(mesh, front) {
  const pos = mesh.geometry.getAttribute('position');
  const points = [];
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    if (front ? z > 0 : z < 0) points.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
  }
  return points;
}

/** Centre of a point cloud. */
function centreOf(points) {
  return new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
}

/** The rear plate leans with the tailgate; recover its up direction. */
function rearPlateUp(blueMesh) {
  if (!blueMesh) return new THREE.Vector3(0, 1, 0);
  const pts = platePoints(blueMesh, false);
  if (!pts.length) return new THREE.Vector3(0, 1, 0);
  let zmin = Infinity, zmax = -Infinity;
  for (const p of pts) { if (p.z < zmin) zmin = p.z; if (p.z > zmax) zmax = p.z; }
  const mid = (zmin + zmax) / 2;
  const low = new THREE.Vector3(), high = new THREE.Vector3();
  let nl = 0, nh = 0;
  for (const p of pts) {
    if (p.z < mid) { low.add(p); nl++; } else { high.add(p); nh++; }
  }
  if (!nl || !nh) return new THREE.Vector3(0, 1, 0);
  low.divideScalar(nl); high.divideScalar(nh);
  const up = high.sub(low).normalize();
  return up.lengthSq() > 0.1 ? up : new THREE.Vector3(0, 1, 0);
}

/**
 * Replace the model's "HUMSTER3D" plate text with a Bulgarian plate. The old
 * plate materials are hidden behind a pair of textured planes placed on the
 * front and rear plate clusters.
 */
function addBulgarianPlates(model) {
  const textMesh = meshWithMaterial(model, 'material__2');
  if (!textMesh) return;

  const blueMesh = meshWithMaterial(model, 'material__3');
  const texture = makeBulgarianPlate();
  if (!texture) return;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  const frontPoints = platePoints(textMesh, true);
  const rearPoints = platePoints(textMesh, false);
  if (!frontPoints.length && !rearPoints.length) return;

  // Hide the old white/black/blue/yellow plate pieces; the planes replace them.
  for (const prefix of ['material__1', 'material__2', 'material__3', 'material__4']) {
    const mesh = meshWithMaterial(model, prefix);
    if (mesh) mesh.visible = false;
  }

  const addPlate = (points, up) => {
    if (!points.length) return;
    const centre = centreOf(points);
    const normal = new THREE.Vector3().crossVectors(up, new THREE.Vector3(1, 0, 0)).normalize();
    // The front normal is +Z, the rear normal is -Z plus the tailgate rake.
    if (normal.z * centre.z < 0) normal.negate();
    const right = normal.z > 0 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(-1, 0, 0);
    const plateUp = new THREE.Vector3().crossVectors(normal, right).normalize();
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.11), material);
    plane.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, plateUp, normal));
    plane.position.copy(centre).addScaledVector(normal, 0.003);
    plane.castShadow = false;
    plane.receiveShadow = true;
    plane.userData.noConvert = true; // keep the plate texture out of the car repaint
    model.add(plane);
  };

  addPlate(frontPoints, new THREE.Vector3(0, 1, 0));
  addPlate(rearPoints, rearPlateUp(blueMesh));
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

  // The source car wears a watermark plate. Replace it with the game's
  // Bulgarian registration before the imported materials are repainted.
  addBulgarianPlates(model);

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
    if (o.userData && o.userData.noConvert) return;
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
