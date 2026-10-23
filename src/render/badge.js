/* ============================================================
   BADGES — the small identity parts of the car: the three-pointed
   star, the BRABUS boot badge, and the Dutch number plate.

   All of it is drawn to a canvas at runtime, so it needs no font
   file and no asset build step. COSMETIC ONLY.
   ============================================================ */

import * as THREE from '../../vendor/three.module.js';

const box = (w, h, d, mat) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};

/**
 * A three-pointed star in a ring, sized for a grille or a bootlid.
 * @param {number} radius
 * @param {THREE.Material} mat
 * @returns {THREE.Group}
 */
export function threePointedStar(radius, mat) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, radius * 0.09, 4, 16), mat);
  g.add(ring);
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + i * Math.PI * 2 / 3;
    const spoke = box(radius * 0.16, radius, radius * 0.11, mat);
    spoke.position.set(Math.cos(a) * radius * 0.5, Math.sin(a) * radius * 0.5, 0);
    spoke.rotation.z = a - Math.PI / 2;
    g.add(spoke);
  }
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      o.receiveShadow = false;
      o.userData.noShadow = true;
    }
  });
  return g;
}

/** Cached boot badge texture — text is drawn at runtime, like everything else. */
let badgeTexture = null;
function brabusTexture() {
  if (badgeTexture) return badgeTexture;
  if (typeof document === 'undefined') return null;

  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 128;
  const c = cv.getContext('2d');
  const font = 'italic 900 100px "Helvetica Neue", "Arial Black", Arial, sans-serif';
  c.clearRect(0, 0, cv.width, cv.height);
  c.font = font;
  c.textAlign = 'center';
  c.textBaseline = 'middle';

  // A dark outline keeps chrome letters readable against black paint.
  c.lineWidth = 9;
  c.strokeStyle = 'rgba(0, 0, 0, 0.9)';
  c.strokeText('BRABUS', 256, 66);

  const chrome = c.createLinearGradient(0, 20, 0, 108);
  chrome.addColorStop(0.00, '#ffffff');
  chrome.addColorStop(0.40, '#eef2f8');
  chrome.addColorStop(0.52, '#9fa9b8');
  chrome.addColorStop(0.64, '#f7f9fc');
  chrome.addColorStop(1.00, '#c5ccd7');
  c.fillStyle = chrome;
  c.fillText('BRABUS', 256, 66);

  // Thin top highlight, so it reads as a metal badge rather than a decal.
  c.lineWidth = 2;
  c.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  c.strokeText('BRABUS', 256, 63);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  badgeTexture = tex;
  return tex;
}

/**
 * Rear boot badge, facing -z. Returns null where there is no DOM.
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {THREE.Mesh|null}
 */
export function brabusBadge(x, y, z) {
  const map = brabusTexture();
  if (!map) return null;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(0.54, 0.135),
    new THREE.MeshBasicMaterial({
      map, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    }),
  );
  m.position.set(x, y, z);
  m.rotation.y = Math.PI;
  m.renderOrder = 4;
  m.userData.noShadow = true;
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

/** Cached number-plate textures, keyed by their text. */
const plateTextures = new Map();
function plateTexture(text) {
  if (plateTextures.has(text)) return plateTextures.get(text);
  if (typeof document === 'undefined') return null;

  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 108;
  const c = cv.getContext('2d');

  c.fillStyle = '#f2c200';
  c.fillRect(0, 0, cv.width, cv.height);

  // NL blue band, with a ring of EU stars above the letters.
  c.fillStyle = '#1d4f9c';
  c.fillRect(0, 0, 62, cv.height);
  c.fillStyle = '#ffd617';
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    c.beginPath();
    c.arc(31 + Math.cos(a) * 17, 30 + Math.sin(a) * 17, 1.7, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = '#ffffff';
  c.font = '700 24px Arial, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('NL', 31, 76);

  // The registration itself: 7-KNJ-43.
  c.fillStyle = '#111111';
  c.font = '700 60px "Arial Narrow", Arial, sans-serif';
  c.fillText(text, 296, 58);

  c.strokeStyle = '#111111';
  c.lineWidth = 6;
  c.strokeRect(3, 3, cv.width - 6, cv.height - 6);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  plateTextures.set(text, tex);
  return tex;
}

/**
 * Dutch yellow number plate, facing +z. Rotate it by PI for the rear.
 * Returns null where there is no DOM.
 * @param {string} text registration, e.g. 7-KNJ-43
 * @returns {THREE.Mesh|null}
 */
export function dutchPlate(text) {
  const map = plateTexture(text);
  if (!map) return null;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(0.52, 0.11),
    new THREE.MeshBasicMaterial({ map, toneMapped: false }),
  );
  m.renderOrder = 4;
  m.userData.noShadow = true;
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

/** Cached grille mesh texture: a dark diamond lattice for the R170 grille. */
let grilleMap = null;
/**
 * Fine black mesh for the front grille, drawn at runtime.
 * @returns {THREE.Texture|null}
 */
export function grilleTexture() {
  if (grilleMap) return grilleMap;
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 128;
  const c = cv.getContext('2d');
  c.fillStyle = '#08080a';
  c.fillRect(0, 0, cv.width, cv.height);
  c.strokeStyle = '#24262b';
  c.lineWidth = 2;
  for (let x = -128; x < 640; x += 18) {
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x + 128, 128);
    c.moveTo(x + 128, 0);
    c.lineTo(x, 128);
    c.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  grilleMap = tex;
  return tex;
}
