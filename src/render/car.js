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
import { createImportedCar } from './slk-ac.js';
import { createOgCarMesh, updateOgCarVisual, OG_PAINTS } from './og-car.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* The default car uses the original DRIFTBLOCK palette. The hidden owner's
   car is a fixed black, independent of the stock paint choice. */
export const PAINTS = OG_PAINTS;
export const SECRET_PAINT = Object.freeze({
  id: 'obsidian', name: 'OBSIDIAN BLACK',
  body: 0x07080a, trim: 0x050506, accent: 0xd3dae5,
});

/** Build the original blocky car, or the hidden imported R170. */
export function createCarMesh(paint, opts = {}) {
  if (opts.imported) {
    const imported = createImportedCar(paint);
    if (imported) return imported;
  }
  return createOgCarMesh(paint);
}

/** Route visual updates to the correct car. */
export function updateCarVisual(car, s, input, dt, onGrass) {
  if (car && car._imported) return updateImportedCarVisual(car, s, input, dt, onGrass);
  return updateOgCarVisual(car, s, input, dt, onGrass);
}

/**
 * Drive the visuals from physics state.
 * @param {object} car result of createCarMesh
 * @param {import('./physics/index.js').CarState} s
 * @param {object} input
 * @param {number} dt
 * @param {boolean} onGrass
 */
export function updateImportedCarVisual(car, s, input, dt, onGrass) {
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
