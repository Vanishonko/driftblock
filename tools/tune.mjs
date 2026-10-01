/* Headless physics tuning harness.
   Run:  node tools/tune.mjs
   Simulates the car with synthetic inputs and reports the numbers
   that actually decide whether a drift game feels good. */

import { CarState, stepCar, TUNE, engineRpm01, fireBoost } from '../src/physics/index.js';

const ROAD = TUNE.surface.road;
const GRASS = TUNE.surface.grass;
const dt = 1 / 120;

function sim(seconds, inputFn, surf = ROAD, state = null) {
  const s = state || new CarState();
  const n = Math.round(seconds / dt);
  const trace = [];
  for (let i = 0; i < n; i++) {
    const t = i * dt;
    const inp = inputFn(t, s);
    stepCar(s, { handbrake: 0, throttle: 0, brake: 0, steer: 0, handbrakeEdge: false, boost: 0, ...inp }, dt, surf);
    trace.push({ t, speed: s.speed, kmh: s.speed * 3.6, slip: s.slip, yaw: s.yaw, yawRate: s.yawRate, x: s.x, z: s.z });
  }
  return { s, trace };
}

const deg = (r) => (r * 180 / Math.PI);
const pad = (v, n = 8) => String(v).padStart(n);

console.log('\n================ DRIFTBLOCK PHYSICS =================\n');

// ---------- 1. Acceleration ----------
{
  const { trace } = sim(20, () => ({ throttle: 1 }));
  let t100 = null, t200 = null;
  for (const p of trace) {
    if (t100 === null && p.kmh >= 100) t100 = p.t;
    if (t200 === null && p.kmh >= 200) t200 = p.t;
  }
  const top = trace[trace.length - 1].kmh;
  console.log('ACCELERATION');
  console.log('  0-100 km/h :', t100 ? t100.toFixed(2) + 's' : 'n/a');
  console.log('  0-200 km/h :', t200 ? t200.toFixed(2) + 's' : 'n/a');
  console.log('  top speed  :', top.toFixed(1), 'km/h');
}

// ---------- 2. Braking ----------
{
  let { s } = sim(20, () => ({ throttle: 1 }));
  const v0 = s.speed;
  const { trace } = sim(6, () => ({ brake: 1 }), ROAD, s);
  let tStop = null;
  for (const p of trace) if (p.kmh < 1) { tStop = p.t; break; }
  console.log('\nBRAKING');
  console.log('  from', (v0 * 3.6).toFixed(0), 'km/h -> 0 in', tStop ? tStop.toFixed(2) + 's' : '>6s');
  console.log('  distance  :', (v0 * tStop - 0.5 * TUNE.brakeAccel * tStop * tStop).toFixed(1), 'm (approx)');
}

// ---------- 3. Steady-state drift envelope ----------
console.log('\nSTEADY-STATE DRIFT ANGLE  (entry at 110 km/h, hold 4s)');
console.log('  handbrake  throttle   steer   ->  slip deg   speed km/h   radius m   sustain?');
const cases = [];
for (const hb of [0, 1]) {
  for (const th of [0, 0.5, 1]) {
    for (const st of [0.35, 0.55, 0.75, 1.0]) {
      cases.push({ hb, th, st });
    }
  }
}
for (const c of cases) {
  // build entry speed
  const s = new CarState();
  let v = 0;
  for (let g=0; g<3000 && v<30.5; g++) { stepCar(s, { steer: 0, throttle: 1, brake: 0, handbrake: 0, handbrakeEdge: false, boost: 0 }, dt, ROAD); v = s.speed; }
  // 0.35s of handbrake flick to initiate, then hold the case inputs
  let first = true;
  const n = Math.round(3.4 / dt);
  const slips = [];
  for (let i = 0; i < n; i++) {
    const edge = first && c.hb;
    first = false;
    stepCar(s, {
      steer: c.st, throttle: c.th, brake: 0,
      handbrake: i * dt < 0.45 ? 1 : c.hb,
      handbrakeEdge: edge, boost: 0,
    }, dt, ROAD);
    if (i * dt > 2.4) slips.push(s.absSlip);
  }
  const avg = slips.reduce((a, b) => a + b, 0) / slips.length;
  const spinning = avg > 1.45;
  const radius = s.yawRate !== 0 ? s.speed / Math.abs(s.yawRate) : Infinity;
  console.log(
    `  ${pad(c.hb ? 'YES' : '-', 9)} ${pad(c.th.toFixed(1), 9)} ${pad(c.st.toFixed(2), 7)}   ->  ${pad(deg(avg).toFixed(1), 8)}   ${pad((s.speed * 3.6).toFixed(0), 10)}   ${pad(isFinite(radius) ? radius.toFixed(0) : 'inf', 8)}   ${spinning ? 'SPIN' : (avg > 0.21 ? 'drift' : 'grip')}`
  );
}

// ---------- 4. Can you catch a big slide? ----------
console.log('\nSLIDE RECOVERY  (throw it hard, then counter-steer + lift)');
{
  const s = new CarState();
  let v = 0;
  for (let g=0; g<3000 && v<32; g++) { stepCar(s, { steer: 0, throttle: 1, brake: 0, handbrake: 0, handbrakeEdge: false, boost: 0 }, dt, ROAD); v = s.speed; }
  // flick
  for (let i = 0; i < Math.round(0.9 / dt); i++) {
    stepCar(s, { steer: 1, throttle: 0.8, brake: 0, handbrake: 1, handbrakeEdge: i === 0, boost: 0 }, dt, ROAD);
  }
  console.log('  peak slip after flick :', deg(s.absSlip).toFixed(1) + ' deg   @', (s.speed * 3.6).toFixed(0), 'km/h');
  // now catch it
  let caught = -1;
  for (let i = 0; i < Math.round(3.5 / dt); i++) {
    stepCar(s, { steer: -0.5, throttle: 0.45, brake: 0, handbrake: 0, handbrakeEdge: false, boost: 0 }, dt, ROAD);
    if (caught < 0 && s.absSlip < 0.12) caught = i * dt;
  }
  console.log('  recovered to <7 deg in:', caught > 0 ? caught.toFixed(2) + 's' : 'NEVER (spin)');
  console.log('  speed after recovery  :', (s.speed * 3.6).toFixed(0), 'km/h');
}

// ---------- 5. Donut test ----------
console.log('\nDONUT TEST  (full lock + full throttle, 0.6s handbrake to light it, 8s)');
{
  const s = new CarState();
  let v = 0;
  for (let g=0; g<3000 && v<16; g++) { stepCar(s, { steer: 0, throttle: 1, brake: 0, handbrake: 0, handbrakeEdge: false, boost: 0 }, dt, ROAD); v = s.speed; }
  let sumR = 0, sumSlip = 0, sumSpd = 0, n = 0, minSpd = Infinity;
  for (let i = 0; i < Math.round(8 / dt); i++) {
    stepCar(s, { steer: 1, throttle: 1, brake: 0, handbrake: i * dt < 0.6 ? 1 : 0, handbrakeEdge: i === 0, boost: 0 }, dt, ROAD);
    if (i * dt > 2.5 && s.speed > 1) {
      sumR += s.speed / Math.max(1e-3, Math.abs(s.yawRate));
      sumSlip += s.absSlip; sumSpd += s.speed;
      minSpd = Math.min(minSpd, s.speed); n++;
    }
  }
  const avgSlip = sumSlip / n, avgR = sumR / n, avgSpd = sumSpd / n;
  console.log('  path radius  :', avgR.toFixed(1), 'm');
  console.log('  avg slip     :', deg(avgSlip).toFixed(1), 'deg');
  console.log('  held speed   :', (avgSpd * 3.6).toFixed(0), 'km/h  (min ' + (minSpd * 3.6).toFixed(0) + ')');
  console.log('  -> ', (avgSlip > 0.5 && avgSpd > 6) ? 'NICE DONUTS' : (avgSpd <= 6 ? 'BLEEDS ALL SPEED - BAD' : 'TOO GRIPPY'));
}

// ---------- 6. Grass penalty ----------
console.log('\nSURFACE');
{
  const a = new CarState(), b = new CarState();
  for (let i = 0; i < Math.round(12 / dt); i++) {
    stepCar(a, { steer: 0, throttle: 1, brake: 0, handbrake: 0, handbrakeEdge: false, boost: 0 }, dt, ROAD);
    stepCar(b, { steer: 0, throttle: 1, brake: 0, handbrake: 0, handbrakeEdge: false, boost: 0 }, dt, GRASS);
  }
  console.log('  12s full throttle on road :', (a.speed * 3.6).toFixed(0), 'km/h');
  console.log('  12s full throttle on grass:', (b.speed * 3.6).toFixed(0), 'km/h');
  // grip circle on grass
  const g = new CarState();
  let v = 0;
  for (let k2=0; k2<3000 && v<22; k2++) { stepCar(g, { steer: 0, throttle: 1, brake: 0, handbrake: 0, handbrakeEdge: false, boost: 0 }, dt, GRASS); v = g.speed; }
  for (let i = 0; i < Math.round(2 / dt); i++) stepCar(g, { steer: 1, throttle: 1, brake: 0, handbrake: 0, handbrakeEdge: false, boost: 0 }, dt, GRASS);
  console.log('  grass cornering slip      :', deg(g.absSlip).toFixed(1), 'deg (loose = slides a lot)');
}

// ---------- 7. Boost math ----------
console.log('\nMINI-TURBO  (gain measured 2s after firing, at full throttle)');
for (const tier of [0, 1, 2]) {
  const s = new CarState();
  let v = 0;
  for (let g=0; g<3000 && v<25; g++) { stepCar(s, { steer: 0, throttle: 1, brake: 0, handbrake: 0, handbrakeEdge: false, boost: 0 }, dt, ROAD); v = s.speed; }
  const before = s.speed;
  fireBoost(s, tier);
  for (let i = 0; i < Math.round(2.0 / dt); i++) {
    stepCar(s, { steer: 0, throttle: 1, brake: 0, handbrake: 0, handbrakeEdge: false, boost: 0 }, dt, ROAD);
  }
  console.log(`  tier ${tier}:`, (before * 3.6).toFixed(0), '->', (s.speed * 3.6).toFixed(0), 'km/h  (+' + ((s.speed - before) * 3.6).toFixed(0) + ')');
}

// ---------- 8. Gearbox ----------
console.log('\nGEARBOX (rpm01 / gear across the range)');
for (const kmh of [0, 20, 40, 60, 80, 100, 130, 160, 190, 220]) {
  const st = new CarState();
  st.speed = kmh / 3.6;
  const r = engineRpm01(st);
  console.log(`  ${pad(kmh, 5)} km/h -> gear ${r.gear}  rpm ${(r.rpm01 * 100).toFixed(0)}%`);
}
console.log('');

// ---------- 9. Sustained drift vs grip line ----------
console.log('\nSUSTAINED CORNER (enter 140 km/h, hold 6s, average of the last 3s)');
for (const cfg of [
  { label: 'grip line  (steer .45)', hb: 0.00, th: 1.0, st: 0.45 },
  { label: 'power drift (steer .85)', hb: 0.00, th: 1.0, st: 0.85 },
  { label: 'handbrake  (steer .60)', hb: 1.00, th: 1.0, st: 0.60 },
  { label: 'lift off mid-drift     ', hb: 0.45, th: 0.0, st: 0.85 },
]) {
  const s = new CarState();
  let v = 0;
  for (let g = 0; g < 4000 && v < 38.9; g++) { stepCar(s, { steer: 0, throttle: 1, brake: 0, handbrake: 0, handbrakeEdge: false, boost: 0 }, dt, ROAD); v = s.speed; }
  const v0 = s.speed;
  let sumSpd = 0, sumSlip = 0, n = 0;
  for (let i = 0; i < Math.round(6 / dt); i++) {
    stepCar(s, {
      steer: cfg.st, throttle: cfg.th, brake: 0,
      handbrake: i < Math.round(cfg.hb / dt) ? 1 : 0,
      handbrakeEdge: i === 0 && cfg.hb > 0, boost: 0,
    }, dt, ROAD);
    if (i * dt > 3) { sumSpd += s.speed; sumSlip += s.absSlip; n++; }
  }
  console.log(`  ${cfg.label} : ${(v0 * 3.6).toFixed(0)} -> ${(sumSpd / n * 3.6).toFixed(0)} km/h  (${(sumSpd / n / v0 * 100).toFixed(0)}% kept)  holding ${deg(sumSlip / n).toFixed(0)} deg`);
}
console.log('');

// ---------- 10. slide sustainability (donut -> countersteer + throttle) ----------
console.log('\nSLIDE SUSTAIN  (donut, then countersteer and stay on the gas)');
{
  const s = new CarState();
  let v = 0;
  for (let g = 0; g < 4000 && v < 20; g++) {
    stepCar(s, { steer: 0, throttle: 1, brake: 0, handbrake: 0, handbrakeEdge: false, boost: 0 }, dt, ROAD);
    v = s.speed;
  }
  // light it up and spin a donut for 2.5 s
  for (let i = 0; i < Math.round(2.5 / dt); i++) {
    stepCar(s, {
      steer: -1, throttle: 1, brake: 0, handbrake: i < Math.round(0.5 / dt) ? 1 : 0,
      handbrakeEdge: i === 0, boost: 0,
    }, dt, ROAD);
  }
  const donutSlip = s.absSlip;

  // now unwind and countersteer, still hard on the throttle
  const trace = [];
  for (let i = 0; i < Math.round(2.5 / dt); i++) {
    stepCar(s, { steer: 0.55, throttle: 1, brake: 0, handbrake: 0, handbrakeEdge: false, boost: 0 }, dt, ROAD);
    if (i % Math.round(0.5 / dt) === 0) {
      trace.push(`${(i * dt).toFixed(1)}s ${deg(s.absSlip).toFixed(0)}deg @${(s.speed * 3.6).toFixed(0)}km/h`);
    }
  }
  console.log('  donut slip        :', deg(donutSlip).toFixed(0), 'deg');
  console.log('  after countersteer:', trace.join('   '));
  // hold it longer and report the settled angle, not the transient
  let acc = 0, n = 0;
  for (let i = 0; i < Math.round(2.0 / dt); i++) {
    stepCar(s, { steer: 0.55, throttle: 1, brake: 0, handbrake: 0, handbrakeEdge: false, boost: 0 }, dt, ROAD);
    acc += s.absSlip; n++;
  }
  const settled = acc / n;
  console.log('  settled after 4.5s:', deg(settled).toFixed(0), 'deg @', (s.speed * 3.6).toFixed(0), 'km/h');
  console.log('  ->', settled > 0.30 ? 'SLIDE HOLDS' : settled > 0.18 ? 'weak slide' : 'SNAPS BACK TO GRIP');
}
console.log('');
