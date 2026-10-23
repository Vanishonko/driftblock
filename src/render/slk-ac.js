/* ============================================================
   IMPORTED R170 — the Assetto Corsa SLK mesh, its wheel pivots,
   brake lamps, grille and chrome star. Loaded once at module scope;
   Node/boot tests fall back to the procedural shell.

   COSMETIC ONLY. Nothing in here affects the simulation.
   ============================================================ */

import * as THREE from '../../vendor/three.module.js';
import { GLTFLoader } from '../../vendor/GLTFLoader.js';

/* The real R170 asset (from the Assetto Corsa mod) is loaded once at
   module scope. In Node/boot tests there is no window, so the original
   procedural mesh stays available as a fallback. */
let acCar = null;
if (typeof window !== 'undefined' && typeof fetch === 'function') {
  try {
    const gltf = await new GLTFLoader().loadAsync(
      new URL('../../assets/mods/slk200/slk-r170-full-game.glb', import.meta.url).href,
    );
    acCar = gltf.scene;
  } catch {
    acCar = null;
  }
}

const AC_SCALE = 2.40 / 2.27;
const AC_GROUND = -0.037 * AC_SCALE;
const AC_CENTRE_Z = -0.235 * AC_SCALE;

/** Build an emissive mask containing only the red lens pixels of a tail-light map. */
function makeRedMask(map) {
  const image = map && map.image;
  if (!image || !image.width || !image.height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  try { ctx.drawImage(image, 0, 0); } catch { return null; }
  const src = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = src.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const red = r > 55 && r > g * 1.35 && r > b * 1.35;
    d[i] = red ? 255 : 0;
    d[i + 1] = red ? 255 : 0;
    d[i + 2] = red ? 255 : 0;
    d[i + 3] = 255;
  }
  ctx.putImageData(src, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = map.flipY;
  tex.wrapS = map.wrapS;
  tex.wrapT = map.wrapT;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}



/** White/silver instrument face with chrome ring and black markings. */
function makeDialFace(kind, showWarn = true) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.translate(256, 256);
  const specs = {
    speed: { max: 260, major: 20, step: 10, label: 'km/h' },
    rpm: { max: 8, major: 1, step: 0.5, label: 'x1000' },
    fuel: { max: 70, major: 10, step: 5, label: 'FUEL' },
    water: { max: 120, minor: 40, major: 20, step: 10, label: '°C' },
  };
  const sp = specs[kind] || specs.speed;
  // dark outer bezel + chrome ring
  g.fillStyle = '#14171b'; g.beginPath(); g.arc(0, 0, 252, 0, Math.PI * 2); g.fill();
  const chrome = g.createLinearGradient(-220, -220, 220, 220);
  chrome.addColorStop(0, '#f0f3f5'); chrome.addColorStop(0.28, '#7b848e');
  chrome.addColorStop(0.55, '#e7ebef'); chrome.addColorStop(1, '#5a636d');
  g.strokeStyle = chrome; g.lineWidth = 14; g.beginPath(); g.arc(0, 0, 238, 0, Math.PI * 2); g.stroke();
  // silver-white face
  const face = g.createRadialGradient(-70, -80, 20, 0, 0, 228);
  face.addColorStop(0, '#33363a'); face.addColorStop(0.62, '#202226'); face.addColorStop(1, '#111215');
  g.fillStyle = face; g.beginPath(); g.arc(0, 0, 229, 0, Math.PI * 2); g.fill();
  const min = sp.minor || 0;
  const a0 = Math.PI * 0.78, sweep = Math.PI * 1.44;
  const tickCount = Math.round((sp.max - min) / sp.step);
  for (let i = 0; i <= tickCount; i++) {
    const a = a0 + sweep * (i / tickCount);
    const value = min + i * sp.step;
    const major = Math.abs((value - min) % sp.major) < 1e-6;
    g.strokeStyle = '#ff9a2e';
    g.lineWidth = major ? 5 : 2.5;
    g.beginPath();
    g.moveTo(Math.cos(a) * 209, Math.sin(a) * 209);
    g.lineTo(Math.cos(a) * (major ? 179 : 194), Math.sin(a) * (major ? 179 : 194));
    g.stroke();
    if (major) {
      g.save(); g.fillStyle = '#ffb45a'; g.font = 'bold 29px Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(Math.round(value)), Math.cos(a) * 143, Math.sin(a) * 143);
      g.restore();
    }
  }
  g.fillStyle = '#ff9a2e'; g.font = 'bold 24px Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(sp.label, 0, -42);
  // odometer / warning for the speedo
  if (kind === 'speed' && showWarn) {
    g.fillStyle = '#ff7a10';
    g.beginPath(); g.moveTo(0, -86); g.lineTo(26, -42); g.lineTo(-26, -42); g.closePath(); g.fill();
    g.fillStyle = '#2a2015'; g.font = 'bold 28px Arial'; g.fillText('!', 0, -54);
    g.fillStyle = '#0a0b0c'; g.fillRect(-75, 92, 150, 32);
    g.fillStyle = '#ffb45a'; g.font = 'bold 22px monospace'; g.textAlign = 'center';
    g.fillText('3938 km', 0, 109);
  }
  if (kind === 'fuel') {
    g.fillStyle = '#ff9a2e'; g.font = 'bold 16px Arial'; g.fillText('min', 0, 66);
  }
  // centre hub under the 3D needle
  g.fillStyle = '#0f1113'; g.beginPath(); g.arc(0, 0, 17, 0, Math.PI * 2); g.fill();
  return new THREE.CanvasTexture(c);
}

/** Put the imported R170 on the game chassis. */
export function createImportedCar(paint) {
  if (!acCar) return null;
  const root = new THREE.Group();
  const chassis = new THREE.Group();
  chassis.position.y = 0.52;
  root.add(chassis);

  const model = acCar.clone(true);
  model.scale.setScalar(AC_SCALE);
  model.position.set(0, AC_GROUND - chassis.position.y, AC_CENTRE_Z);
  chassis.add(model);

  model.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const next = mats.map((m) => {
      if (!m) return m;
      if (o.name && o.name.startsWith('BRABUS_Badge')) {
        return new THREE.MeshPhongMaterial({
          color: 0x9aa3ad, specular: 0x3d444d, shininess: 45,
          flatShading: true, side: THREE.DoubleSide,
        });
      }
      if (m.name === 'Car_Paint_Graphite' || m.name.startsWith('Car_Paint_Graphite.')) {
        const body = m.clone();
        body.color.setHex(paint.body);
        body.color.lerp(new THREE.Color(0x171b21), 0.18);
        body.roughness = 0.36;
        body.metalness = 0.18;
        body.emissive.setHex(0x0a0d12);
        body.emissiveIntensity = 1.1;
        body.side = THREE.DoubleSide;
        return body;
      }
      if (m.name === 'Lite_Chrome' || m.name.startsWith('Lite_Chrome.')) {
        return new THREE.MeshPhongMaterial({
          color: 0xc4cbd4, specular: 0x7d858f, shininess: 50, side: THREE.DoubleSide,
        });
      }
      if (m.name === 'Lite_Rim' || m.name.startsWith('Lite_Rim.')) {
        return new THREE.MeshPhongMaterial({
          color: 0xc3cad3, specular: 0xffffff, shininess: 105, side: THREE.DoubleSide,
        });
      }
      if (m.name === 'Lite_Glass_Dark' || m.name.startsWith('Lite_Glass_Dark.')) {
        const c = m.clone();
        c.color.setHex(0x04060a);
        c.transparent = true;
        c.opacity = 0.78;
        c.depthWrite = true;
        c.side = THREE.DoubleSide;
        c.polygonOffset = true;
        c.polygonOffsetFactor = -1;
        c.polygonOffsetUnits = -1;
        return c;
      }
      if (m.name === 'Lite_Interior' || m.name.startsWith('Lite_Interior.')) {
        const c = m.clone();
        c.color.setHex(0x1c1712);
        c.roughness = 0.55;
        c.metalness = 0.04;
        return c;
      }
      if (m.name === 'Lite_Dark' || m.name.startsWith('Lite_Dark.')) {
        const c = m.clone();
        c.color.setHex(0x111318);
        c.roughness = 0.48;
        return c;
      }
      if (o.name === 'Rear_Star_Boot') {
        return new THREE.MeshPhongMaterial({
          color: 0xc4cbd4, specular: 0x7d858f, shininess: 50, side: THREE.DoubleSide,
        });
      }
      if (m.name && m.name.startsWith('BRABUS_Badge')) {
        const badge = m.clone();
        badge.side = THREE.DoubleSide;
        badge.transparent = true;
        badge.alphaTest = 0.05;
        badge.depthWrite = false;
        return badge;
      }
      if (m.name && (m.name === 'BRABUS_Chrome_3D' || m.name.startsWith('BRABUS_Edge_Chrome'))) {
        return new THREE.MeshBasicMaterial({ color: 0x454e58, side: THREE.DoubleSide });
      }
      if (m.name && m.name.startsWith('BRABUS_Face_Dark')) {
        return new THREE.MeshPhongMaterial({
          color: 0x1c2026, shininess: 35, specular: 0x2a3038,
          flatShading: true, side: THREE.DoubleSide,
        });
      }
      return m;
    });
    o.material = Array.isArray(o.material) ? next : next[0];
    o.castShadow = false;
    o.receiveShadow = true;
  });

  // imported wheel steer/spin pivots (created in Blender)
  const wheels = [];
  for (const [corner, front] of [['FL', true], ['FR', true], ['RL', false], ['RR', false]]) {
    const pivot = model.getObjectByName('WHEEL_STEER_' + corner);
    const spin = model.getObjectByName('WHEEL_SPIN_' + corner);
    if (pivot && spin) wheels.push({ pivot, spin, steer: front, keepPos: true });
  }

  // imported brake-light materials (Taillight meshes)
  const brakeMats = [];
  model.traverse((o) => {
    if (!o.isMesh || !/taillight/i.test(o.name)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const cloned = mats.map((m) => {
      if (!m) return m;
      const b = m.clone();
      if (b.emissive) {
        const mask = makeRedMask(m.map);
        if (mask) b.emissiveMap = mask;
        b.emissive.setHex(0xff0000);
        b.emissiveIntensity = 0;
      }
      brakeMats.push(b);
      return b;
    });
    o.material = Array.isArray(o.material) ? cloned : cloned[0];
  });

  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff6d0 });
  const brakeMat = new THREE.MeshBasicMaterial({ color: 0x8a101c });

  // Cockpit controls: transform the imported meshes under pivots inside
  // the same model, so the steering wheel and gauge needles can move.
  const cockpit = { steerWheel: null, needles: {}, needle2d: {} };
  const sw = model.getObjectByName('Steeringwheel_Joined');
  if (sw) {
    const pivot = new THREE.Group();
    // Actual column centre and wheel-plane normal measured from the AC wheel.
    pivot.position.set(0.3258, 0.7509, 0.3163);
    pivot.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0.0001, 0.2939, -0.9558).normalize(),
    );
    model.add(pivot);
    pivot.attach(sw);
    cockpit.steerWheel = pivot;
  }
  let hazard = null;
  const gaugeDefs = [
    ['speed', 'Speed_Needle_002', 'Speed_002'],
    ['rpm', 'RPM_Needle_002', 'RPM_002'],
    ['fuel', 'Fuel_Needle_002', 'Fuel_002'],
    ['water', 'Water_Needle_002', 'Water_002'],
  ];
  for (const [key, needleName, gaugeName] of gaugeDefs) {
    const needle = model.getObjectByName(needleName);
    const gauge = model.getObjectByName(gaugeName);
    if (!needle || !gauge) continue;
    const pivot = new THREE.Group();
    pivot.position.copy(gauge.position);
    model.add(pivot);
    pivot.attach(needle);
    needle.position.z -= 0.0070;
    cockpit.needles[key] = pivot;
    const dialSize = { speed: 0.092, rpm: 0.075, fuel: 0.044, water: 0.044 }[key] || 0.1;
    const offMap = makeDialFace(key, false);
    const onMap = key === 'speed' ? makeDialFace('speed', true) : offMap;
    const faceMat = new THREE.MeshBasicMaterial({
      map: key === 'speed' ? offMap : makeDialFace(key),
      transparent: true, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: false,
    });
    if (key === 'speed') hazard = { mat: faceMat, off: offMap, on: onMap, current: null };
    const face = new THREE.Mesh(new THREE.PlaneGeometry(dialSize, dialSize), faceMat);
    face.position.copy(gauge.position);
    face.position.z -= 0.0055;
    face.rotation.y = Math.PI;
    face.renderOrder = 2;
    model.add(face);
    if (key === 'speed' || key === 'rpm') {
      // Flat needle overlay drawn at the exact dial angle. The imported 3-D
      // needle meshes sit at odd local orientations and are unreliable at
      // this angle, so hide them and draw the needle on the face itself.
      needle.visible = false;
      const nc = document.createElement('canvas');
      nc.width = nc.height = 256;
      const nctx = nc.getContext('2d');
      const ntex = new THREE.CanvasTexture(nc);
      const nmat = new THREE.MeshBasicMaterial({
        map: ntex, transparent: true, depthWrite: false,
        side: THREE.DoubleSide, toneMapped: false,
      });
      const nplane = new THREE.Mesh(new THREE.PlaneGeometry(dialSize, dialSize), nmat);
      nplane.position.copy(face.position);
      nplane.position.z -= 0.0004;
      nplane.rotation.y = Math.PI;
      nplane.renderOrder = 3;
      model.add(nplane);
      cockpit.needle2d[key] = {
        draw(t) {
          const k = Math.max(0, Math.min(1, t));
          const a = Math.PI * 0.78 + Math.PI * 1.44 * k;
          nctx.clearRect(0, 0, 256, 256);
          nctx.strokeStyle = '#ff8a1e';
          nctx.lineCap = 'round';
          nctx.lineWidth = 5;
          nctx.beginPath();
          nctx.moveTo(128 + Math.cos(a) * 10, 128 + Math.sin(a) * 10);
          nctx.lineTo(128 + Math.cos(a) * 98, 128 + Math.sin(a) * 98);
          nctx.stroke();
          nctx.fillStyle = '#ff8a1e';
          nctx.beginPath(); nctx.arc(128, 128, 6, 0, Math.PI * 2); nctx.fill();
          ntex.needsUpdate = true;
        },
      };
      cockpit.needle2d[key].draw(0);
    }
    needle.traverse((part) => {
      if (part.isMesh) {
        part.material = new THREE.MeshBasicMaterial({ color: 0xff8a1e, toneMapped: false });
      }
    });
  }

  // Warm cabin/cluster fill so the black interior reads in the cockpit.
  const cabin = new THREE.PointLight(0xffe3c8, 0.24, 1.4, 2);
  cabin.position.set(0.30, 0.96, -0.10);
  model.add(cabin);
  const cluster = new THREE.PointLight(0xff7a1e, 0.10, 0.42, 2);
  cluster.position.set(0.33, 0.84, 0.40);
  model.add(cluster);
  const bodyFill = new THREE.PointLight(0xffe2c0, 2.4, 5.8, 2);
  bodyFill.position.set(0.0, 1.6, 0.2);
  model.add(bodyFill);
  const frontFill = new THREE.PointLight(0xfff0dc, 1.6, 4.6, 2);
  frontFill.position.set(0.0, 1.3, 2.4);
  model.add(frontFill);
  const topFill = new THREE.PointLight(0xfff4e2, 1.1, 5.8, 2);
  topFill.position.set(0.0, 2.6, 0.0);
  model.add(topFill);
  const rearFill = new THREE.PointLight(0xffe8d0, 1.6, 4.8, 2);
  rearFill.position.set(0.0, 1.2, -2.1);
  model.add(rearFill);

  return {
    root, chassis, body: model, wheels, flames: [],
    brakeMat, brakeMats, headMat, paint, steerWheel: cockpit.steerWheel, needles: cockpit.needles, needle2d: cockpit.needle2d, hazard,
    _roll: 0, _pitch: 0, _steerVis: 0,
  };
}
