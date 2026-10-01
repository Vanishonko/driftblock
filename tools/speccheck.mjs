/* Verifies car specs apply safely, including mid-run.
   Run: node tools/speccheck.mjs */
import { CarState, stepCar, TUNE } from '../src/physics/index.js';
import { SPECS, applySpec } from '../src/physics/specs.js';

const dt = 1 / 120, ROAD = TUNE.surface.road;
const inp = (o = {}) => ({ steer: 0, throttle: 0, brake: 0, handbrake: 0, handbrakeEdge: false, boost: 0, ...o });
let fail = 0;
const check = (l, c, x = '') => { if (!c) fail++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${l}${x ? '   ' + x : ''}`); };
const hold = (s, sec, input) => { for (let i = 0; i < Math.round(sec / dt); i++) stepCar(s, input, dt, ROAD); };

console.log('\n================ CAR SPECS ================\n');

// ---- 1. the catalogue
{
  check('there is a spec for every id', SPECS.length >= 4, SPECS.map((s) => s.id).join(', '));
  check('every spec has a name and a description',
    SPECS.every((s) => s.name && s.desc));
  check('ids are unique', new Set(SPECS.map((s) => s.id)).size === SPECS.length);
}

// ---- 2. applying is idempotent and reversible
{
  const base = JSON.parse(JSON.stringify(TUNE));
  const numeric = Object.keys(base).filter((k) => typeof base[k] === 'number');

  applySpec('balanced');
  const balanced = Object.fromEntries(numeric.map((k) => [k, TUNE[k]]));
  check('balanced leaves the base tune alone',
    numeric.every((k) => TUNE[k] === base[k]));

  applySpec('drift');
  const drift = TUNE.gripBase;
  check('drift changes the tune', drift !== base.gripNormal, `gripNormal ${base.gripNormal} -> ${drift}`);

  applySpec('drift');
  check('applying the same spec twice does not compound', TUNE.gripBase === drift, `${TUNE.gripBase}`);

  for (let i = 0; i < 5; i++) applySpec('monster');
  applySpec('drift');
  check('switching back and forth does not drift the numbers', TUNE.gripBase === drift,
    `${TUNE.gripBase} vs ${drift}`);

  applySpec('balanced');
  check('returning to balanced restores every numeric value exactly',
    numeric.every((k) => TUNE[k] === balanced[k]));
}

// ---- 3. every spec produces a drivable car
{
  for (const spec of SPECS) {
    applySpec(spec.id);
    const s = new CarState();
    hold(s, 6, inp({ throttle: 1 }));
    const finite = Number.isFinite(s.speed) && Number.isFinite(s.x) && Number.isFinite(s.z)
      && Number.isFinite(s.yaw) && Number.isFinite(s.rpm);
    check(`${spec.id}: the car drives and stays finite`, finite && s.speed > 20,
      `${(s.speed * 3.6).toFixed(0)} km/h`);
  }
  applySpec('balanced');
}

// ---- 4. the point of the exercise: swap mid-run without losing the car
{
  applySpec('balanced');
  const s = new CarState();
  hold(s, 8, inp({ throttle: 1 }));

  const before = { x: s.x, z: s.z, speed: s.speed, yaw: s.yaw, gear: s.gear };
  applySpec('drift');
  const after = { x: s.x, z: s.z, speed: s.speed, yaw: s.yaw };

  check('a live swap does not move the car',
    after.x === before.x && after.z === before.z && after.yaw === before.yaw);
  check('and does not change its speed', after.speed === before.speed,
    `${(before.speed * 3.6).toFixed(0)} km/h`);

  // and it keeps driving afterwards
  hold(s, 3, inp({ throttle: 1 }));
  check('and it keeps driving after the swap',
    Number.isFinite(s.speed) && s.speed > before.speed * 0.8,
    `${(s.speed * 3.6).toFixed(0)} km/h`);

  // gears must stay in range across every spec change
  let outOfRange = null;
  const maxGear = TUNE.gearRatios.length;
  for (const spec of SPECS) {
    applySpec(spec.id);
    hold(s, 1.5, inp({ throttle: 1 }));
    if (s.gear < 0 || s.gear > maxGear) outOfRange = `${spec.id} -> gear ${s.gear}`;
  }
  check('the gear stays in range across every spec change', !outOfRange, outOfRange || '');

  // manual reverse must survive a swap too
  const m = new CarState();
  m.manual = true; m.playerGear = -1;
  applySpec('monster');
  hold(m, 2, inp({ throttle: 1, manual: true }));
  check('reverse still works after a swap', m.vf < -1, `${m.vf.toFixed(2)} m/s`);
  applySpec('balanced');
}

// ---- 5. the specs are actually different from each other
{
  const measure = (id) => {
    applySpec(id);
    const s = new CarState();
    const t0 = 0;
    let t100 = null;
    let peakSpin = 0;
    for (let i = 0; i < Math.round(30 / dt); i++) {
      stepCar(s, inp({ throttle: 1 }), dt, ROAD);
      peakSpin = Math.max(peakSpin, s.wheelspin);
      if (t100 === null && s.speed * 3.6 >= 100) t100 = i * dt - t0;
    }
    return { to100: t100, top: s.speed * 3.6, grip: TUNE.gripBase, spin: peakSpin };
  };
  const b = measure('balanced');
  const g = measure('grip');
  const m = measure('monster');
  applySpec('balanced');

  // Measure what the spec is FOR: how much it slides under a fixed input.
  const slides = (id) => {
    applySpec(id);
    const s = new CarState();
    const cap = Math.round(40 / dt);
    for (let i = 0; i < cap && s.speed < 30; i++) stepCar(s, inp({ throttle: 1 }), dt, ROAD);
    hold(s, 3.0, inp({ throttle: 0.5, steer: 0.40 }));
    return s.absSlip * 57.2958;
  };
  const slideGrip = slides('grip');
  const slideBal = slides('balanced');
  const slideDrift = slides('drift');
  applySpec('balanced');

  check('grip spec slides less than balanced', slideGrip < slideBal,
    `${slideGrip.toFixed(0)} deg vs ${slideBal.toFixed(0)} deg`);
  check('drift spec slides more than balanced', slideDrift > slideBal,
    `${slideDrift.toFixed(0)} deg vs ${slideBal.toFixed(0)} deg`);
  check('grip reaches a higher top speed than balanced', g.top > b.top,
    `${g.top.toFixed(0)} vs ${b.top.toFixed(0)} km/h`);

  // MONSTER has more power AND less grip, so it is not quicker off the line —
  // it just lights the tyres up. That is the spec's stated character
  // ("absurd power, absurd consequences"), not a bug, so assert the character
  // rather than a lap-time expectation it was never meant to meet.
  check('monster has a much higher top end than balanced', m.top > b.top * 1.15,
    `${m.top.toFixed(0)} vs ${b.top.toFixed(0)} km/h`);
  check('monster lights the tyres up harder off the line', m.spin > b.spin,
    `wheelspin ${m.spin.toFixed(2)} vs ${b.spin.toFixed(2)}`);
  check('and it is quicker to 100 as well', m.to100 < b.to100,
    `${m.to100?.toFixed(2)}s vs ${b.to100?.toFixed(2)}s`);
}

console.log(fail === 0 ? '\nSpecs behave.\n' : `\n${fail} FAILED\n`);
process.exit(fail ? 1 : 0);
