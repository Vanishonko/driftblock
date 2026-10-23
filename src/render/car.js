/* ============================================================
   CAR — the blocky facelift SLK R170 shell (2000-2004), its wheels,
   and the visual layer that reads the physics state (body roll, squat,
   wheel spin, steering, brake lights, boost flames).

   COSMETIC ONLY. The simulation knows nothing about this file: it
   moves a CarState around using TUNE, and updateCarVisual follows it.
   The visible wheelbase and track below match the owner's R170; the
   simulation still uses TUNE, so handling and collision are unchanged.
   ============================================================ */

import * as THREE from '../../vendor/three.module.js';
import { TUNE } from '../physics/index.js';
import { WHEEL_X, WHEEL_Z, WHEEL_RADIUS } from './car-spec.js';
import { buildSlkR170, SLK_EXHAUSTS } from './slk.js';
import { createImportedCar } from './slk-ac.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* Every car is a dark graphite metallic now; the paint choice is the accent it wears.
   Old saved paint ids simply fall through to the first entry. */
export const PAINTS = [
  { id: 'obsidian', name: 'OBSIDIAN BLACK', body: 0x07080a, trim: 0x050506, accent: 0xd3dae5 },
  { id: 'satin', name: 'SATIN BLACK', body: 0x101114, trim: 0x0a0a0c, accent: 0xaab2c0 },
  { id: 'carbon', name: 'CARBON BLACK', body: 0x040506, trim: 0x020203, accent: 0x9aa3b2 },
  { id: 'brabusred', name: 'BLACK / BRABUS RED', body: 0x07080a, trim: 0x050506, accent: 0xd21f2e },
  { id: 'brabusgold', name: 'BLACK / BRABUS GOLD', body: 0x07080a, trim: 0x050506, accent: 0xd6b25c },
  { id: 'midnight', name: 'MIDNIGHT BLACK', body: 0x05070c, trim: 0x040508, accent: 0x2f6cff },
];

/**
 * Build the blocky SLK R170. The visible wheels sit on the real car's
 * 2.40 m wheelbase / 1.54 m visual track; no physics value is read from here.
 * @param {object} paint one of PAINTS
 * @param {{imported?: boolean}} [opts] use the imported AC shell only for the secret car
 * @returns {object} the mesh plus its named parts
 */
export function createCarMesh(paint, opts = {}) {
  if (opts.imported) {
    const imported = createImportedCar(paint);
    if (imported) return imported;
  }
  const root = new THREE.Group();

  const matBody = new THREE.MeshPhongMaterial({
    color: paint.body, shininess: 82, specular: 0x5a626d, flatShading: true,
  });
  const matTrim = new THREE.MeshLambertMaterial({ color: paint.trim, flatShading: true });
  const matGlass = new THREE.MeshPhongMaterial({
    color: 0x152438, shininess: 200, specular: 0xb8d8ff, flatShading: true,
  });
  const matWindshield = new THREE.MeshPhongMaterial({
    color: 0x121f31, shininess: 200, specular: 0xb8d8ff,
    transparent: true, opacity: 0.72, depthWrite: false, flatShading: true,
  });
  const matLens = new THREE.MeshPhongMaterial({
    color: 0xcfe0ee, shininess: 220, specular: 0xffffff,
    transparent: true, opacity: 0.30, depthWrite: false, side: THREE.DoubleSide,
  });
  const matTail = new THREE.MeshPhongMaterial({
    color: 0x3c060b, shininess: 90, specular: 0x9a1a24, flatShading: true,
  });
  const matReflector = new THREE.MeshPhongMaterial({
    color: 0x646d78, shininess: 130, specular: 0xffffff, flatShading: true,
  });
  const matAmber = new THREE.MeshBasicMaterial({ color: 0xff9a2e });
  const matAccent = new THREE.MeshPhongMaterial({
    color: paint.accent, shininess: 110, specular: 0xffffff, flatShading: true,
  });
  const matChrome = new THREE.MeshPhongMaterial({
    color: 0xc6cdd8, shininess: 145, specular: 0xffffff, flatShading: true,
  });
  const matDark = new THREE.MeshLambertMaterial({ color: 0x050506 });
  const matInterior = new THREE.MeshLambertMaterial({ color: 0x090a0d });
  const matReverse = new THREE.MeshBasicMaterial({ color: 0xdde6f2 });
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff6d0 });
  const brakeMat = new THREE.MeshBasicMaterial({ color: 0x8a101c });

  // chassis group — everything that rolls / squats (wheels stay level)
  const chassis = new THREE.Group();
  chassis.position.y = 0.52;
  root.add(chassis);

  const built = buildSlkR170(chassis, {
    body: matBody, trim: matTrim, glass: matGlass, windshield: matWindshield, accent: matAccent,
    chrome: matChrome, dark: matDark, interior: matInterior,
    head: headMat, brake: brakeMat, reverse: matReverse,
    lens: matLens, tail: matTail, reflector: matReflector, amber: matAmber,
  });

  /* ---------------- wheels ----------------
     Blocky five-spoke monoblocks. The tyre is open-ended with flat
     sidewall rings so the spokes are actually visible, and the brake
     disc stops the wheel looking hollow. */
  const tyreMat = new THREE.MeshLambertMaterial({
    color: 0x0b0b0e, side: THREE.DoubleSide, flatShading: true,
  });
  const rimMat = new THREE.MeshPhongMaterial({
    color: 0xb7bec9, shininess: 140, specular: 0xffffff, flatShading: true,
  });
  const discMat = new THREE.MeshLambertMaterial({ color: 0x5b606a, flatShading: true });

  const R = WHEEL_RADIUS;
  const tyreGeo = new THREE.CylinderGeometry(R, R, 0.30, 12, 1, true);
  tyreGeo.rotateZ(Math.PI / 2);
  const sidewallGeo = new THREE.RingGeometry(R * 0.60, R, 12);
  sidewallGeo.rotateY(Math.PI / 2);
  const lipGeo = new THREE.TorusGeometry(R * 0.61, 0.014, 4, 12);
  lipGeo.rotateY(Math.PI / 2);
  const discGeo = new THREE.CylinderGeometry(R * 0.45, R * 0.45, 0.028, 12);
  discGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.064, 0.064, 0.30, 8);
  hubGeo.rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.27, 0.22, 0.075);
  const capGeo = new THREE.CylinderGeometry(0.040, 0.040, 0.32, 10);
  capGeo.rotateZ(Math.PI / 2);
  const lugGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.31, 6);
  lugGeo.rotateZ(Math.PI / 2);

  const wheels = [];
  // Visual R170 dimensions from car-spec; the simulation still uses TUNE.
  const wx = WHEEL_X;
  const wz = WHEEL_Z;
  for (const [x, z, steer] of [[-wx, wz, true], [wx, wz, true], [-wx, -wz, false], [wx, -wz, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, WHEEL_RADIUS, z);
    const spin = new THREE.Group();

    const tread = new THREE.Mesh(tyreGeo, tyreMat);
    tread.castShadow = true;
    spin.add(tread);

    for (const sx of [-0.150, 0.150]) {
      const sidewall = new THREE.Mesh(sidewallGeo, tyreMat);
      sidewall.position.x = sx;
      sidewall.castShadow = true;
      spin.add(sidewall);
    }

    const disc = new THREE.Mesh(discGeo, discMat);
    spin.add(disc);

    for (const sx of [-0.144, 0.144]) {
      const lip = new THREE.Mesh(lipGeo, rimMat);
      lip.position.x = sx;
      spin.add(lip);
    }

    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5;
      const spoke = new THREE.Mesh(spokeGeo, rimMat);
      spoke.position.set(0, Math.cos(a) * 0.105, Math.sin(a) * 0.105);
      spoke.rotation.x = a;
      spoke.castShadow = true;
      spin.add(spoke);
    }

    const hub = new THREE.Mesh(hubGeo, rimMat);
    hub.castShadow = true;
    spin.add(hub);

    const cap = new THREE.Mesh(capGeo, matAccent);
    spin.add(cap);
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5;
      const lug = new THREE.Mesh(lugGeo, matDark);
      lug.position.set(0, Math.cos(a) * 0.085, Math.sin(a) * 0.085);
      spin.add(lug);
    }

    // Brake caliper: on the pivot, so it steers with the wheel but does not spin.
    const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.13, 0.055), matAccent);
    caliper.position.set(0, -0.10, 0.10);
    caliper.castShadow = true;
    pivot.add(spin, caliper);

    root.add(pivot);
    wheels.push({ pivot, spin, steer });
  }

  /* ---------------- boost flames ----------------
     Cones at the exhaust tips, hidden until a mini-turbo fires. */
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0x66ddff, transparent: true, opacity: 0.9, depthWrite: false,
  });
  const flameGeo = new THREE.ConeGeometry(0.17, 1.4, 5);
  flameGeo.rotateX(Math.PI / 2);
  flameGeo.translate(0, 0, -0.70);
  const flames = [];
  for (const e of SLK_EXHAUSTS) {
    const f = new THREE.Mesh(flameGeo, flameMat.clone());
    f.position.set(e.x, e.y, e.z);
    f.visible = false;
    f.frustumCulled = false;
    chassis.add(f);
    flames.push(f);
  }

  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = !o.userData.noShadow;
    o.receiveShadow = !o.userData.noShadow;
  });

  return {
    root, chassis, body: built.body, wheels, flames,
    brakeMat, headMat,
    paint,
    // smoothed visual state
    _roll: 0, _pitch: 0, _steerVis: 0,
  };
}

/**
 * Drive the visuals from physics state.
 * @param {object} car result of createCarMesh
 * @param {import('./physics/index.js').CarState} s
 * @param {object} input
 * @param {number} dt
 * @param {boolean} onGrass
 */
export function updateCarVisual(car, s, input, dt, onGrass) {
  car.root.position.set(s.x, 0, s.z);
  car.root.rotation.y = s.yaw;

  // ---- body roll from lateral acceleration, pitch from longitudinal
  const latG = clamp(s.lateralAccel / 26, -1.1, 1.1);
  const lonG = clamp(s.longAccel / 26, -1.1, 1.1);
  const targetRoll = -latG * 0.20;
  const targetPitch = lonG * 0.055;

  car._roll += (targetRoll - car._roll) * (1 - Math.exp(-9 * dt));
  car._pitch += (targetPitch - car._pitch) * (1 - Math.exp(-7 * dt));

  car.chassis.rotation.z = car._roll;
  car.chassis.rotation.x = car._pitch;
  // a little vertical bob when sliding hard, plus ride height from roll
  car.chassis.position.y = 0.52 + Math.abs(car._roll) * 0.10;

  // ---- steering visual (front wheels only, exaggerated a touch)
  const steerVisTarget = s.steer * TUNE.maxSteer * 1.35;
  car._steerVis += (steerVisTarget - car._steerVis) * (1 - Math.exp(-14 * dt));

  // A stationary burnout: fronts hold the car, rears keep spinning.
  const burnout = input.throttle > 0.55 && s.speed < 7
    && (input.handbrake > 0.3 || input.brake > 0.3);
  if (burnout) car._burnoutSpin = (car._burnoutSpin || 0) + (8 + input.throttle * 20) * dt;

  for (const w of car.wheels) {
    if (w.steer) w.pivot.rotation.y = car._steerVis;
    // wheel spin: lock the wheels under braking, spin faster when powering
    let spin = s.wheelSpin;
    if (input.brake > 0.5 && s.speed > 2) spin = w._lockSpin !== undefined ? w._lockSpin : spin;
    if (burnout) spin = w.steer ? 0 : car._burnoutSpin;
    w._lockSpin = spin;
    w.spin.rotation.x = spin;
    // squat the tyres slightly under load (procedural wheels only)
    if (!w.keepPos) w.pivot.position.y = WHEEL_RADIUS;
  }

  // ---- cockpit: steering wheel + instrument needles
  if (car.steerWheel) {
    if (car._steerWheelVis === undefined) car._steerWheelVis = car._steerVis;
    car._steerWheelVis += (car._steerVis - car._steerWheelVis) * (1 - Math.exp(-12 * dt));
    car.steerWheel.rotation.z = Math.max(-7.85, Math.min(7.85, car._steerWheelVis * 11.6));
  }
  if (car.needles) {
    const speed01 = clamp(s.speed * 3.6 / 260, 0, 1);
    const rpm01 = clamp(s.rpm01 || 0, 0, 1);
    // Speedo/tach needles are 2-D overlays drawn at the exact dial angle.
    if (car.needle2d?.speed) car.needle2d.speed.draw(speed01);
    if (car.needle2d?.rpm) car.needle2d.rpm.draw(rpm01);
  }
  // ESP warning triangle: flashes only when traction is lost.
  if (car.hazard) {
    const burnout = input.throttle > 0.55 && s.speed < 6
      && (input.handbrake > 0.3 || input.brake > 0.3);
    const noTraction = Math.abs(s.absSlip || 0) > 0.32 || burnout;
    if (noTraction) car._hazardT = (car._hazardT || 0) + dt;
    else car._hazardT = 0;
    const show = noTraction && Math.floor((car._hazardT || 0) * 3.2) % 2 === 0;
    const map = show ? car.hazard.on : car.hazard.off;
    if (car.hazard.current !== map) {
      car.hazard.current = map;
      car.hazard.mat.map = map;
      car.hazard.mat.needsUpdate = true;
    }
  }

  // ---- brake lights (red lens only)
  const braking = input.brake > 0.1 || input.handbrake > 0.5;
  if (car.brakeMats && car.brakeMats.length) {
    for (const m of car.brakeMats) {
      if (!m.emissive) continue;
      m.emissive.setHex(braking ? 0xa0000c : 0x000000);
      m.emissiveIntensity = braking ? 1.5 : 0;
    }
  } else {
    car.brakeMat.color.setHex(braking ? 0xff2233 : 0x8a101c);
  }

  // ---- boost flames
  const boosting = s.boost > 0;
  for (let i = 0; i < car.flames.length; i++) {
    const f = car.flames[i];
    f.visible = boosting;
    if (boosting) {
      const p = clamp(s.boost, 0, 1);
      const flick = 0.72 + Math.random() * 0.5;
      f.scale.set(0.85 * flick, 0.85 * flick, (0.7 + p * 0.9) * flick);
      f.material.opacity = 0.5 + 0.45 * p;
      f.material.color.setHex(s.boostPower > 0.8 ? 0xff5ea8 : s.boostPower > 0.45 ? 0xffcc33 : 0x66ddff);
    }
  }

  // ---- headlights dim on grass for no reason other than it looks alive
  car.headMat.color.setHex(onGrass ? 0xcfc9a8 : 0xfff6d0);
}
