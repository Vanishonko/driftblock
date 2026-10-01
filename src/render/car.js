/* ============================================================
   CAR — blocky low-poly chassis + wheels, and the visual layer
   that reads the physics state (body roll, squat, wheel spin,
   steering, brake lights, boost flames).
   ============================================================ */

import * as THREE from '../../vendor/three.module.js';
import { TUNE } from '../physics/index.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const PAINTS = [
  { id: 'magenta', name: 'HOT MAGENTA', body: 0xff2e7e, trim: 0x2b0f1e, accent: 0xffd23f },
  { id: 'cyan', name: 'CYBER CYAN', body: 0x2fe0ff, trim: 0x0a2630, accent: 0xffffff },
  { id: 'orange', name: 'SUNSET ORANGE', body: 0xff7a2f, trim: 0x2e1408, accent: 0xffe9a8 },
  { id: 'lime', name: 'ACID LIME', body: 0xb6ff3d, trim: 0x1c2606, accent: 0x1a1e2e },
  { id: 'purple', name: 'ROYAL PURPLE', body: 0x8b5cf6, trim: 0x1a0f33, accent: 0x2fe0ff },
  { id: 'white', name: 'ARCTIC WHITE', body: 0xf0f4ff, trim: 0x22273a, accent: 0xff2e7e },
  { id: 'midnight', name: 'MIDNIGHT', body: 0x232a3d, trim: 0x0c0f18, accent: 0x2fe0ff },
  { id: 'taxi', name: 'TAXI YELLOW', body: 0xffcc33, trim: 0x1a1a1a, accent: 0x1a1a1a },
];

function box(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function createCarMesh(paint) {
  const root = new THREE.Group();

  const matBody = new THREE.MeshLambertMaterial({ color: paint.body });
  const matTrim = new THREE.MeshLambertMaterial({ color: paint.trim });
  const matGlass = new THREE.MeshLambertMaterial({ color: 0x0d1220 });
  const matAccent = new THREE.MeshLambertMaterial({ color: paint.accent });

  // chassis group — everything that rolls / squats (wheels stay level)
  const chassis = new THREE.Group();
  chassis.position.y = 0.52;
  root.add(chassis);

  // main body
  const body = box(1.78, 0.52, 3.92, matBody);
  chassis.add(body);

  // lower splitter / skirts
  const skirtL = box(0.14, 0.22, 3.4, matTrim);
  skirtL.position.set(-0.92, -0.26, 0);
  const skirtR = skirtL.clone();
  skirtR.position.x = 0.92;
  chassis.add(skirtL, skirtR);

  // bonnet wedge + rear deck
  const bonnet = box(1.6, 0.22, 1.1, matBody);
  bonnet.position.set(0, 0.30, 1.34);
  const deck = box(1.62, 0.24, 0.95, matBody);
  deck.position.set(0, 0.30, -1.42);
  chassis.add(bonnet, deck);

  // cabin
  const cabin = box(1.48, 0.56, 1.72, matBody);
  cabin.position.set(0, 0.50, -0.20);
  chassis.add(cabin);

  // glass
  const windshield = box(1.36, 0.42, 0.14, matGlass);
  windshield.position.set(0, 0.52, 0.68);
  windshield.rotation.x = -0.34;
  const rearGlass = box(1.34, 0.38, 0.14, matGlass);
  rearGlass.position.set(0, 0.52, -1.06);
  rearGlass.rotation.x = 0.30;
  const sideGlassL = box(0.10, 0.34, 1.5, matGlass);
  sideGlassL.position.set(-0.75, 0.56, -0.20);
  const sideGlassR = sideGlassL.clone();
  sideGlassR.position.x = 0.75;
  chassis.add(windshield, rearGlass, sideGlassL, sideGlassR);

  // racing stripe
  const stripe = box(0.34, 0.06, 3.9, matAccent);
  stripe.position.set(0, 0.28, 0);
  chassis.add(stripe);

  // rear wing
  const wingPostL = box(0.11, 0.42, 0.11, matTrim);
  wingPostL.position.set(-0.62, 0.68, -1.72);
  const wingPostR = wingPostL.clone();
  wingPostR.position.x = 0.62;
  const wing = box(1.72, 0.09, 0.52, matAccent);
  wing.position.set(0, 0.92, -1.80);
  wing.rotation.x = -0.14;
  chassis.add(wingPostL, wingPostR, wing);

  // front splitter lip
  const lip = box(1.86, 0.10, 0.42, matTrim);
  lip.position.set(0, -0.30, 1.94);
  chassis.add(lip);

  // ---- lights
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff6d0 });
  const headL = box(0.44, 0.16, 0.10, headMat);
  headL.position.set(-0.58, 0.10, 1.98);
  const headR = headL.clone();
  headR.position.x = 0.58;
  chassis.add(headL, headR);

  const brakeMat = new THREE.MeshBasicMaterial({ color: 0x5a0d16 });
  const brakeL = box(0.42, 0.15, 0.10, brakeMat);
  brakeL.position.set(-0.58, 0.14, -1.96);
  const brakeR = brakeL.clone();
  brakeR.position.x = 0.58;
  chassis.add(brakeL, brakeR);

  // exhausts
  const exMat = new THREE.MeshLambertMaterial({ color: 0x9aa2b4 });
  const exL = box(0.17, 0.17, 0.22, exMat);
  exL.position.set(-0.38, -0.20, -1.98);
  const exR = exL.clone();
  exR.position.x = 0.38;
  chassis.add(exL, exR);

  // ---- boost flames (two cones, hidden until boosting)
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0x66ddff, transparent: true, opacity: 0.9, depthWrite: false,
  });
  const flameGeo = new THREE.ConeGeometry(0.19, 1.5, 5);
  flameGeo.rotateX(Math.PI / 2);
  flameGeo.translate(0, 0, -0.75);
  const flames = [];
  for (const x of [-0.38, 0.38]) {
    const f = new THREE.Mesh(flameGeo, flameMat.clone());
    f.position.set(x, -0.20, -2.0);
    f.visible = false;
    f.frustumCulled = false;
    chassis.add(f);
    flames.push(f);
  }

  // ---- wheels
  const tyreMat = new THREE.MeshLambertMaterial({ color: 0x14161d });
  const rimMat = new THREE.MeshLambertMaterial({ color: 0xb9c0d0 });
  const tyreGeo = new THREE.CylinderGeometry(TUNE.wheelRadius, TUNE.wheelRadius, 0.30, 9);
  tyreGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(TUNE.wheelRadius * 0.58, TUNE.wheelRadius * 0.58, 0.33, 6);
  rimGeo.rotateZ(Math.PI / 2);

  const wheels = [];
  const wx = TUNE.trackWidth / 2 + 0.06;
  const wz = TUNE.wheelBase / 2;
  for (const [x, z, steer] of [[-wx, wz, true], [wx, wz, true], [-wx, -wz, false], [wx, -wz, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, TUNE.wheelRadius, z);
    const spin = new THREE.Group();
    const tyre = new THREE.Mesh(tyreGeo, tyreMat);
    tyre.castShadow = true;
    const rim = new THREE.Mesh(rimGeo, rimMat);
    spin.add(tyre, rim);
    pivot.add(spin);
    root.add(pivot);
    wheels.push({ pivot, spin, steer });
  }

  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  return {
    root, chassis, body, wheels, flames,
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

  for (const w of car.wheels) {
    if (w.steer) w.pivot.rotation.y = car._steerVis;
    // wheel spin: lock the wheels under braking, spin faster when powering
    let spin = s.wheelSpin;
    if (input.brake > 0.5 && s.speed > 2) spin = w._lockSpin !== undefined ? w._lockSpin : spin;
    w._lockSpin = spin;
    w.spin.rotation.x = spin;
    // squat the tyres slightly under load
    w.pivot.position.y = TUNE.wheelRadius;
  }

  // ---- brake lights
  const braking = input.brake > 0.1 || input.handbrake > 0.5;
  car.brakeMat.color.setHex(braking ? 0xff2233 : 0x5a0d16);

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
