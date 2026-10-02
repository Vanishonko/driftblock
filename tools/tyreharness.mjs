/* ============================================================
   TYRE MODEL EVALUATION.

   Runs the slip-based bicycle model through the SAME steady-state
   envelope the arcade model is measured on, so the two can be compared
   like for like rather than argued about.

   The question this answers is not "is the tyre model correct" — the
   unit checks in tyrecheck cover that — but "does it produce a car you
   can actually drift", which is a different thing entirely and is the
   reason the last attempt was reverted.

   Run: node tools/tyreharness.mjs
   ============================================================ */

import { TUNE, clamp } from '../src/physics/index.js';
import { bicycleStep } from '../src/physics/tyre.js';

const dt = 1 / 120;
const ROAD = { grip: 1.0 };

/** A car driven by the bicycle model, with a simple engine. */
class TyreCar {
  constructor() {
    this.vf = 0; this.vl = 0; this.yaw = 0; this.yawRate = 0;
    this.steer = 0; this.longAccel = 0;
    this.absSlip = 0; this.slip = 0; this.speed = 0;
    this.wheelspin = 0; this.telemetry = null;
  }
  step(input) {
    const T = TUNE.tyre;
    // steering rate-limited like a real rack, so a step input is not instant
    const rate = input.steer > this.steer ? TUNE.steerRate : TUNE.steerRate * 1.6;
    this.steer += clamp(input.steer - this.steer, -rate * dt, rate * dt);

    this.speed = Math.hypot(this.vf, this.vl);
    const drive = this.driveForce(input.throttle);
    const before = this.vf;

    this.telemetry = bicycleStep(this, input, dt, ROAD, drive);

    this.longAccel = (this.vf - before) / dt;
    this.slip = Math.atan2(this.vl, Math.max(Math.abs(this.vf), 1.2));
    this.absSlip = Math.abs(this.slip);
    this.speed = Math.hypot(this.vf, this.vl);
  }
  driveForce(throttle) {
    if (throttle <= 0) return 0;
    const T = TUNE.tyre;
    // a real engine makes less force the faster it is going; without this
    // the car accelerates without bound and every case ends in a spin
    const fade = clamp(1 - Math.abs(this.vf) / 62, 0, 1);
    return throttle * T.maxDrive * fade;
  }
}

const deg = (r) => r * 180 / Math.PI;

/* ---------------------------------------------------------------
   The same envelope the arcade model is measured on.
   --------------------------------------------------------------- */
console.log('\nSTEADY-STATE DRIFT ANGLE  (entry at 110 km/h, hold 4s)');
console.log('  handbrake  throttle   steer   ->  slip deg   speed km/h   radius m   verdict');
console.log('  ' + '-'.repeat(74));

const rows = [];
for (const hb of [0, 1]) {
  for (const th of [0, 0.5, 1]) {
    for (const st of [0.35, 0.55, 0.75, 1.0]) {
      const car = new TyreCar();
      // build entry speed the same way the baseline does
      let guard = 0;
      while (car.speed < 30.5 && guard++ < 6000) {
        car.step({ steer: 0, throttle: 1, brake: 0, handbrake: 0 });
      }
      const entry = car.speed;

      const slips = [];
      const n = Math.round(3.4 / dt);
      for (let i = 0; i < n; i++) {
        car.step({
          steer: st,
          throttle: th,
          brake: 0,
          handbrake: i * dt < 0.45 ? 1 : hb,
        });
        if (i * dt > 2.4) slips.push(car.absSlip);
      }
      const avg = slips.reduce((a, b) => a + b, 0) / slips.length;
      const kmh = car.speed * 3.6;
      const radius = avg > 0.02 ? car.speed / Math.abs(car.yawRate) : Infinity;
      const verdict = avg > 1.45 ? 'SPIN' : avg > TUNE.driftSlip ? 'drift' : 'grip';
      rows.push({ hb, th, st, avg: deg(avg), kmh, radius, verdict, entry });
      console.log(
        `  ${hb ? '  YES   ' : '    -   '}   ${th.toFixed(1)}    ${st.toFixed(2)}   ->` +
        `  ${deg(avg).toFixed(1).padStart(6)}      ${kmh.toFixed(0).padStart(3)}       ` +
        `${radius === Infinity ? '  inf' : radius.toFixed(0).padStart(5)}   ${verdict}`);
    }
  }
}

/* ---------------------------------------------------------------
   Monotonicity: the failure that got the last attempt reverted.
   More throttle must never mean LESS sliding, and more steering must
   never mean less. A model that breaks this feels broken to drive even
   if every individual case looks plausible.
   --------------------------------------------------------------- */
console.log('\nMONOTONICITY  (more throttle or more steering must not reduce the slide)');
let breaks = 0;
for (const hb of [0, 1]) {
  for (const st of [0.35, 0.55, 0.75, 1.0]) {
    const series = [0, 0.5, 1].map((th) => rows.find((r) => r.hb === hb && r.th === th && r.st === st));
    for (let i = 1; i < series.length; i++) {
      if (series[i].avg < series[i - 1].avg - 1.0) {
        breaks++;
        console.log(`  BREAK  hb=${hb} steer=${st}: throttle ${series[i-1].th} -> ${series[i].th} ` +
          `dropped ${series[i-1].avg.toFixed(1)} -> ${series[i].avg.toFixed(1)} deg`);
      }
    }
  }
}
for (const hb of [0, 1]) {
  for (const th of [0, 0.5, 1]) {
    const series = [0.35, 0.55, 0.75, 1.0].map((st) => rows.find((r) => r.hb === hb && r.th === th && r.st === st));
    for (let i = 1; i < series.length; i++) {
      if (series[i].avg < series[i - 1].avg - 1.0) {
        breaks++;
        console.log(`  BREAK  hb=${hb} throttle=${th}: steer ${series[i-1].st} -> ${series[i].st} ` +
          `dropped ${series[i-1].avg.toFixed(1)} -> ${series[i].avg.toFixed(1)} deg`);
      }
    }
  }
}
console.log(breaks === 0
  ? '  monotonic in both axes — no inversions\n'
  : `  ${breaks} inversion(s)\n`);

/* ---------------------------------------------------------------
   Summary in the terms that actually matter for the game.
   --------------------------------------------------------------- */
const grips = rows.filter((r) => r.verdict === 'grip').length;
const drifts = rows.filter((r) => r.verdict === 'drift').length;
const spins = rows.filter((r) => r.verdict === 'SPIN').length;
console.log(`  ${rows.length} cases: ${grips} grip, ${drifts} drift, ${spins} spin`);
console.log(`  entry speeds reached: ${Math.min(...rows.map(r => r.entry * 3.6)).toFixed(0)}` +
  `-${Math.max(...rows.map(r => r.entry * 3.6)).toFixed(0)} km/h`);
