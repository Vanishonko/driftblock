/* ============================================================
   TYRE BEHAVIOUR — the acceptance gate for the tyre model.

   WHY THIS EXISTS
   ---------------
   The grip logic is being replaced: five independent mechanisms
   (throttle blend, handbrake override, a clutch-kick timer, an
   injected drive bonus and two injected yaw terms) collapse into one
   friction circle driven by combined slip. That WILL move the numbers,
   so "the tune is unchanged" is not available as a safety net.

   These are the behaviours worth keeping, measured against the model
   as it stands now. They are deliberately expressed as BANDS, not
   exact values: the point is that a donut still holds a sensible angle
   and a grip line still grips, not that a number matches to three
   decimal places.

   The last three checks are the ones the tyre model is FOR. They fail
   or are meaningless against the current special-cased model, and are
   marked so.

   Run: node tools/tyrecheck.mjs
   ============================================================ */

import { CarState, stepCar, TUNE } from '../src/physics/index.js';
import { applySpec } from '../src/physics/specs.js';

const dt = 1 / 120, ROAD = TUNE.surface.road;
const inp = (o = {}) => ({ steer: 0, throttle: 0, brake: 0, handbrake: 0, handbrakeEdge: false, boost: 0, ...o });
const deg = (r) => (r * 57.2958);
const hold = (s, sec, input, surf = ROAD) => { for (let i = 0; i < Math.round(sec / dt); i++) stepCar(s, input, dt, surf); };

/**
 * Accelerate until a target speed, with a hard cap. A bare `while (v < 30)`
 * hangs forever if the car cannot reach it — which is exactly the kind of
 * thing this suite exists to notice, so it must not hang instead of failing.
 */
function spinUp(target, input = { throttle: 1 }, surf = ROAD) {
  const s = new CarState();
  const cap = Math.round(40 / dt);
  for (let i = 0; i < cap && s.speed < target; i++) stepCar(s, inp(input), dt, surf);
  return s;
}

let fail = 0;
let todo = 0;
const check = (l, c, x = '') => { if (!c) fail++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${l}${x ? '   ' + x : ''}`); };

/**
 * A behaviour the tyre model is being built to provide. Reported as TODO
 * rather than FAIL while it is still outstanding, so this suite can run in
 * the normal rotation without masking real regressions. Stage 6 (the tyre
 * model) flips every one of these to `check`.
 */
const target = (l, c, x = '') => { if (!c) todo++; console.log(`  ${c ? 'OK  ' : 'TODO'} ${l}${x ? '   ' + x : ''}`); };
/** A band. Fails loudly if the value leaves it, with the band in the message. */
const band = (l, v, lo, hi, unit = '') =>
  check(`${l} (${lo}–${hi}${unit})`, v >= lo && v <= hi, `${v.toFixed(1)}${unit}`);

applySpec('balanced');

console.log('\n================ TYRE BEHAVIOUR ================\n');

/* ---- 1. launch from a standing start, full throttle ---------- */
console.log('STANDING START  (full throttle, no clutch)');
{
  const s = new CarState();
  hold(s, 0.5, inp({ throttle: 1 }));
  const half = s.speed * 3.6;
  hold(s, 1.5, inp({ throttle: 1 }));
  const two = s.speed * 3.6;
  hold(s, 4.0, inp({ throttle: 1 }));
  check('gets off the line', half > 5, `${half.toFixed(0)} km/h at 0.5 s`);
  band('is well up to speed by 2 s', two, 45, 110, ' km/h at 2 s');
  band('and is still pulling at 6 s', s.speed * 3.6, 110, 170, ' km/h at 6 s');
}

/* ---- 2. the grip line still grips ---------------------------- */
console.log('\nGRIP LINE  (gentle steering, full throttle, must NOT slide)');
{
  const s = spinUp(30, { throttle: 1 });
  hold(s, 4.0, inp({ throttle: 1, steer: 0.35 }));
  band('holds a small slip angle', deg(s.absSlip), 2, 14, ' deg');
  check('and keeps its speed', s.speed * 3.6 > 110, `${(s.speed * 3.6).toFixed(0)} km/h`);
}

/* ---- 3. donut ------------------------------------------------- */
console.log('\nDONUT  (full lock + throttle, 0.5 s of handbrake to light it)');
{
  const s = spinUp(20, { throttle: 1 });
  hold(s, 0.5, inp({ steer: -1, throttle: 1, handbrake: 1, handbrakeEdge: true }));
  hold(s, 4.0, inp({ steer: -1, throttle: 1 }));
  const slip = deg(s.absSlip);
  band('holds a big angle', slip, 25, 55, ' deg');
  check('without stopping', s.speed * 3.6 > 15, `${(s.speed * 3.6).toFixed(0)} km/h`);
}

/* ---- 4. holding a slide on the throttle ---------------------- */
console.log('\nSLIDE SUSTAIN  (donut, then countersteer and stay on the gas)');
{
  const s = spinUp(20, { throttle: 1 });
  // light it and spin a donut, then release the handbrake — holding it down
  // for the whole time just spins the car onto its side of the limit
  hold(s, 0.5, inp({ steer: -1, throttle: 1, handbrake: 1, handbrakeEdge: true }));
  hold(s, 2.0, inp({ steer: -1, throttle: 1 }));
  const donutSlip = deg(s.absSlip);
  hold(s, 2.5, inp({ steer: 0.55, throttle: 1 }));
  const settled = deg(s.absSlip);
  check('the slide survives countersteer on the throttle', settled > 17,
    `${donutSlip.toFixed(0)} deg donut -> ${settled.toFixed(0)} deg after countersteer`);
}

/* ---- 5. recovery is still possible --------------------------- */
console.log('\nRECOVERY  (throw it in, then countersteer and lift)');
{
  const s = spinUp(28, { throttle: 1 });
  hold(s, 0.5, inp({ steer: -1, throttle: 0.5, handbrake: 1, handbrakeEdge: true }));
  const peak = deg(s.absSlip);
  let t = null;
  for (let i = 0; i < Math.round(3 / dt); i++) {
    stepCar(s, inp({ steer: 0.85, throttle: 0, brake: 0.15 }), dt, ROAD);
    if (t === null && Math.abs(s.absSlip) < 0.12) t = i * dt;
  }
  check('a big slide was provoked', peak > 20, `${peak.toFixed(0)} deg`);
  check('and it comes back under control', t !== null && t < 2.5,
    t === null ? 'never recovered' : `${t.toFixed(2)} s`);
}

/* ---- 6. the anti-piropette guard ----------------------------- */
console.log('\nANTI-SPIN  (absurd entry must not become a pirouette)');
{
  const s = spinUp(34, { throttle: 0.4 });
  hold(s, 1.2, inp({ steer: -1, throttle: 1, handbrake: 1, handbrakeEdge: true }));
  hold(s, 2.0, inp({ steer: -1, throttle: 1 }));
  check('slip stays under the piropette limit', deg(s.absSlip) < 100,
    `${deg(s.absSlip).toFixed(0)} deg`);
  check('and the car is still moving', s.speed * 3.6 > 8, `${(s.speed * 3.6).toFixed(0)} km/h`);
}

/* ---- 7. determinism ------------------------------------------ */
console.log('\nDETERMINISM  (nothing random may be involved)');
{
  const runOnce = () => {
    const s = new CarState();
    hold(s, 0.4, inp({ steer: -0.5, throttle: 1, handbrake: 1, handbrakeEdge: true }));
    hold(s, 1.6, inp({ steer: -0.8, throttle: 1 }));
    return [s.x, s.z, s.yaw, s.speed, s.absSlip, s.wheelspin ?? 0];
  };
  const a = runOnce(), b = runOnce();
  check('identical inputs give identical results',
    a.every((v, i) => v === b[i]),
    a.map((v, i) => (v === b[i] ? '' : `[${i}] ${v} != ${b[i]}`)).filter(Boolean).join(' ') || 'all six state values match');
}

/* ============================================================
   The checks below are what the tyre model is FOR. Against the
   current special-cased model the launch one fails outright and the
   wet one has nothing to test, which is the point.
   ============================================================ */

/* ---- 8. a clutch dump slips BEFORE it goes ------------------- */
console.log('\nCLUTCH DUMP  (1st gear, from rest — slip first, then hook up)');
{
  const build = () => {
    const s = new CarState();
    s.manual = true; s.playerGear = 1;
    hold(s, 1.2, inp({ throttle: 1, clutch: 1, manual: true }));
    return s;
  };
  const s = build();
  const revved = s.rpm;
  stepCar(s, inp({ throttle: 1, clutch: 0, manual: true }), dt, ROAD);
  hold(s, 0.4, inp({ throttle: 1, clutch: 0, manual: true }));
  const early = { speed: s.speed * 3.6, spin: s.wheelspin };
  hold(s, 1.1, inp({ throttle: 1, clutch: 0, manual: true }));
  const late = s.speed * 3.6;

  check('the engine was up on the revs before the dump', revved > 4000, `${revved.toFixed(0)} rpm`);
  target('the tyres are lit immediately after the dump', early.spin > 0.75,
    `wheelspin ${early.spin.toFixed(2)}`);
  target('and the car has barely moved while they spin', early.speed < 12,
    `${early.speed.toFixed(1)} km/h after 0.4 s`);
  check('then it hooks up and goes', late > 35, `${late.toFixed(0)} km/h at 1.5 s`);
}

/* ---- 9. a straight launch tracks straight -------------------- */
console.log('\nSTRAIGHT LAUNCH  (no steering, no existing slip — must not slide)');
{
  const s = new CarState();
  s.manual = true; s.playerGear = 1;
  hold(s, 1.2, inp({ throttle: 1, clutch: 1, manual: true }));
  stepCar(s, inp({ throttle: 1, clutch: 0, manual: true }), dt, ROAD);
  hold(s, 2.0, inp({ throttle: 1, clutch: 0, manual: true }));
  const fwd = { x: Math.sin(s.yaw), z: Math.cos(s.yaw) };
  const rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
  const lateral = Math.abs(s.vx * rx + s.vz * rz);
  check('no yaw was introduced', Math.abs(s.yaw) < 1e-9, `yaw ${s.yaw}`);
  check('and no lateral velocity appeared', lateral < 1e-6, `|vl| ${lateral.toExponential(1)} m/s`);
}

/* ---- 10. a perturbed launch steps out ------------------------ */
console.log('\nPERTURBED LAUNCH  (same, but with steering — should step out)');
{
  const s = new CarState();
  s.manual = true; s.playerGear = 1;
  hold(s, 1.2, inp({ throttle: 1, clutch: 1, manual: true }));
  stepCar(s, inp({ throttle: 1, clutch: 0, steer: 0.25, manual: true }), dt, ROAD);
  hold(s, 1.5, inp({ throttle: 1, clutch: 0, steer: 0.25, manual: true }));
  check('steering during a launch rotates the car', Math.abs(s.yaw) > 0.05,
    `yaw ${s.yaw.toFixed(3)} rad`);
}

/* ---- 11. a wet surface slides where a dry one grips ---------- */
console.log('\nWET SURFACE  (the same gentle input, less grip)');
{
  const wet = TUNE.surface.wet;
  if (!wet) {
    console.log('  SKIP  no wet surface in the tune yet');
  } else {
    // Part throttle on purpose, and measured as a sustained average rather
    // than one instant. At full throttle the dry car is already at the limit
    // of its grip, so there is nothing left for the wet to take away — the
    // difference only shows on an input the dry tyres can actually take. And
    // a single sample lands wherever the slide happens to be in its cycle.
    const run = (surf) => {
      const s = spinUp(30, { throttle: 1 }, surf);
      hold(s, 3.0, inp({ throttle: 0.5, steer: 0.40 }), surf);
      let acc = 0, n = 0;
      for (let i = 0; i < Math.round(1.5 / dt); i++) {
        stepCar(s, inp({ throttle: 0.5, steer: 0.40 }), dt, surf);
        acc += s.absSlip; n++;
      }
      return deg(acc / n);
    };
    const drySlip = run(ROAD);
    const wetSlip = run(wet);
    target('an input the dry tyres take slides in the wet', wetSlip > drySlip + 15,
      `${wetSlip.toFixed(0)} deg wet vs ${drySlip.toFixed(0)} deg dry`);
  }
}

if (fail) {
  console.log(`\n${fail} FAILED\n`);
  process.exit(1);
}
console.log(todo
  ? `\nTyre behaviour is within tolerance. ${todo} target(s) still outstanding\n` +
    '  (these are what the unified tyre model is for — see stage 6)\n'
  : '\nTyre behaviour is within tolerance.\n');
process.exit(0);
