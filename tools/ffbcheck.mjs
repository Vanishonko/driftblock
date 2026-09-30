/* ============================================================
   Wheel + force-feedback verification.

     node tools/ffbcheck.mjs

   Two things are checked here:

   1. The FFB sign convention. It is very easy to get this
      backwards, and a wheel that fights you instead of helping is
      worse than no FFB at all. Rather than trusting the algebra,
      this actually simulates the car: it puts it into a slide,
      asks the FFB model which way it would push the rim, converts
      that back into a steering input, and confirms the slide
      shrinks. The opposite direction is tested too, to prove the
      test can fail.

   2. The wheel input layer, against synthetic gamepads that
      imitate a G29 in both pedal polarities, plus one deliberately
      unknown wheel for the learning wizard.
   ============================================================ */

import { CarState, stepCar, TUNE, clamp } from '../src/physics.js';
import { computeForce, aligningShape, FFB_DEFAULTS } from '../src/ffb.js';
import {
  WheelInput, WheelLearner, looksLikeWheel, detectPreset,
  defaultCalibration, WHEEL_PRESETS,
} from '../src/wheel.js';
import { Input } from '../src/input.js';

const dt = 1 / 120;
const ROAD = TUNE.surface.road;
let failures = 0;
const ok = (b) => (b ? 'OK  ' : 'FAIL');
function check(label, condition, extra = '') {
  if (!condition) failures++;
  console.log(`  ${ok(condition)} ${label}${extra ? '   ' + extra : ''}`);
}

console.log('\n================ WHEEL + FORCE FEEDBACK ================\n');

/* ============================================================
   1. ALIGNING TORQUE SHAPE
   ============================================================ */
console.log('ALIGNING TORQUE SHAPE');
{
  const peak = FFB_DEFAULTS.alignPeak;
  check('zero slip produces zero torque', Math.abs(aligningShape(0, peak)) < 1e-9);
  check('torque peaks at the peak slip angle',
    Math.abs(aligningShape(peak, peak)) > Math.abs(aligningShape(peak * 0.5, peak))
    && Math.abs(aligningShape(peak, peak)) > Math.abs(aligningShape(peak * 2.2, peak)));
  check('shape is odd (symmetric left/right)',
    Math.abs(aligningShape(0.4, peak) + aligningShape(-0.4, peak)) < 1e-9);
  check('saturates rather than growing without bound',
    Math.abs(aligningShape(50, peak)) <= 1.0);
  console.log(`  peak at ${peak} rad (${(peak * 180 / Math.PI).toFixed(0)} deg), falls to ${(aligningShape(peak * 2.5, peak) * 100).toFixed(0)}% by ${(peak * 2.5 * 180 / Math.PI).toFixed(0)} deg\n`);
}

/* ============================================================
   2. DOES THE FORCE HELP OR HURT?
   ============================================================ */
console.log('FFB SIGN  (does the torque push the wheel the helpful way?)');

/** Build a car in a steady slide at a given speed. */
function slidingCar(speedMs, targetSlip, steerHold) {
  const s = new CarState();
  let v = 0;
  for (let g = 0; g < 4000 && v < speedMs; g++) {
    stepCar(s, { steer: 0, throttle: 1, brake: 0, handbrake: 0, handbrakeEdge: false, boost: 0 }, dt, ROAD);
    v = s.speed;
  }
  // provoke a slide and hold it until the slip settles near the target
  for (let i = 0; i < Math.round(1.2 / dt); i++) {
    stepCar(s, {
      steer: steerHold, throttle: 1, brake: 0,
      handbrake: i < Math.round(0.35 / dt) ? 1 : 0,
      handbrakeEdge: i === 0, boost: 0,
    }, dt, ROAD);
    if (i > Math.round(0.6 / dt) && Math.abs(Math.abs(s.slip) - targetSlip) < 0.08) break;
  }
  return s;
}

/**
 * Push the rim in the direction the FFB asks for, and see what
 * happens to the slide.
 * @param dir +1 = obey the FFB, -1 = fight it
 */
function settle(slip0, sign, dir) {
  // Steering positively yaws the car toward its yaw-positive axis, which
  // develops NEGATIVE slip — so a positive slip needs a negative hold.
  const s = slidingCar(30, Math.abs(slip0), -sign * 0.9);
  // force the sign we want to test
  if (Math.sign(s.slip) !== sign) return null;

  // the model must agree on direction before we test the dynamics:
  // positive slip is corrected by steering left, and left is negative
  // torque (torque is positive = rim pushed right)
  const expectTorque = -sign * 1;
  const fProbe = computeForce(s, { drifting: true, onGrass: false, boost: 0 }, FFB_DEFAULTS);
  if (Math.sign(fProbe.torque) !== Math.sign(expectTorque)) return null;

  const opt = { drifting: true, onGrass: false, boost: 0 };
  const f = computeForce(s, opt, FFB_DEFAULTS);

  // torque is positive = rim pushed RIGHT. In Input.state space, right is
  // NEGATIVE (see the comment in input.js), so a positive torque nudges
  // state.steer downwards.
  // Steer fully to whichever side the rim is pushing (obey) or the opposite
  // way (fight). A small nudge is no longer a fair test: power now sustains
  // the rotation, so it takes real countersteer to bring the slide back.
  const nudge = -Math.sign(f.torque) * 0.85 * dir;

  const before = Math.abs(s.slip);
  for (let i = 0; i < Math.round(0.5 / dt); i++) {
    stepCar(s, {
      steer: clamp(s.steer + nudge, -1, 1), throttle: 0.5, brake: 0,
      handbrake: 0, handbrakeEdge: false, boost: 0,
    }, dt, ROAD);
  }
  return { before, after: Math.abs(s.slip), torque: f.torque, sign };
}

let obeyWins = 0, tested = 0;
for (const sign of [1, -1]) {
  const obey = settle(0.5, sign, +1);
  const fight = settle(0.5, sign, -1);
  if (!obey || !fight) { console.log(`  (could not build a slip of sign ${sign})`); continue; }
  tested++;
  const obeyHelps = obey.after < obey.before;
  const fightHelps = fight.after < fight.before;
  const verdict = obeyHelps && !fightHelps;
  if (verdict) obeyWins++;
  console.log(`  slip ${sign > 0 ? '+' : '-'}${obey.before.toFixed(2)} rad  torque ${obey.torque >= 0 ? '+' : ''}${obey.torque.toFixed(3)}` +
    `  -> obeying: ${obey.after.toFixed(2)}   fighting: ${fight.after.toFixed(2)}   ${verdict ? 'HELPS' : 'WRONG WAY'}`);
}
check('obeying the FFB reduces the slide, fighting it does not', tested > 0 && obeyWins === tested);

/* ============================================================
   3. FRICTION / WEIGHT CUES
   ============================================================ */
console.log('\nFRICTION CUES');
{
  const grip = slidingCar(30, 0.05, 0.3);
  const drift = slidingCar(30, 0.7, 0.9);
  const fGrip = computeForce(grip, { drifting: false, onGrass: false, boost: 0 }, FFB_DEFAULTS);
  const fDrift = computeForce(drift, { drifting: true, onGrass: false, boost: 0 }, FFB_DEFAULTS);
  check('the rim goes lighter once the car is sliding',
    fDrift.friction < fGrip.friction,
    `grip ${fGrip.friction.toFixed(2)} -> drift ${fDrift.friction.toFixed(2)}`);

  const stopped = new CarState();
  const fStop = computeForce(stopped, { drifting: false, onGrass: false, boost: 0 }, FFB_DEFAULTS);
  check('no aligning torque when stationary', Math.abs(fStop.torque) < 1e-6);
  check('torque stays within the -1..1 range the hardware expects',
    [fGrip, fDrift].every((f) => Math.abs(f.torque) <= 1 && f.friction >= 0 && f.friction <= 1));
}

/* ============================================================
   4. WHEEL DETECTION
   ============================================================ */
console.log('\nWHEEL DETECTION');

/** A synthetic gamepad, shaped like the real thing. */
function fakePad({ id, axes, buttons = 16, pressed = {} }) {
  return {
    id, index: 0, connected: true, mapping: '',   // wheels are never "standard"
    axes: axes.slice(),
    buttons: Array.from({ length: buttons }, (_, i) => ({ pressed: !!pressed[i], value: pressed[i] ? 1 : 0 })),
    vibrationActuator: null,
  };
}

/**
 * A G29 as it actually presents on macOS/Chrome: TEN axes with mapping
 * "none", the wheel centred at 0, three pedals parked at +1, several
 * unused centred axes reading 0, and a stray axis overshooting 1.
 * Modelled from a real device rather than from the preset's assumptions.
 */
const g29Axes = (steer, throttle = 0, brake = 0, clutch = 0) => {
  const a = new Array(10).fill(0);
  a[0] = steer;
  a[1] = 1 - 2 * clutch;
  a[2] = 1 - 2 * throttle;
  a[5] = 1 - 2 * brake;
  a[9] = 1.286;
  return a;
};

const g29 = fakePad({ id: 'Logitech G29 Driving Force Racing Wheel (Vendor: 046d Product: c24f)', axes: g29Axes(0) });
const genericPad = fakePad({ id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)', axes: [0, 0, 0, 0] });

check('a G29 id matches the G29 preset', detectPreset(g29.id)?.id === 'g29');
check('a G29 is recognised as a wheel', looksLikeWheel(g29));
check('an Xbox pad is NOT mistaken for a wheel', !looksLikeWheel(genericPad));
check('a wheel with no preset is still detected by shape', looksLikeWheel(
  fakePad({ id: 'Acme WheelModel 9000', axes: [0, 1, 1] })));

/* ============================================================
   5. AXIS MAPPING / PEDAL POLARITY
   ============================================================ */
console.log('\nAXIS MAPPING');

function sampleWith(pad, cal) {
  const w = new WheelInput();
  w.cal = cal;
  w.rawAxes = pad.axes;
  w.rawButtons = pad.buttons.map((b) => b.value);
  w.wheel = pad;
  return w.sample();
}

{
  const cal = defaultCalibration('g29');
  const centre = sampleWith(fakePad({ id: g29.id, axes: g29Axes(0) }), cal);
  check('centred wheel reads steer 0', Math.abs(centre.steer) < 0.02, `got ${centre.steer.toFixed(3)}`);
  check('released pedals read 0', centre.throttle < 0.02 && centre.brake < 0.02,
    `thr ${centre.throttle.toFixed(2)} brk ${centre.brake.toFixed(2)}`);

  // HID steering axes follow the stick convention: RIGHT is POSITIVE, LEFT
  // is NEGATIVE. Car space is the opposite (positive = left), so the default
  // calibration inverts the axis.
  const wheelRight = sampleWith(fakePad({ id: g29.id, axes: g29Axes(1) }), cal);
  const wheelLeft = sampleWith(fakePad({ id: g29.id, axes: g29Axes(-1) }), cal);
  check('axis positive (wheel RIGHT) steers right', wheelRight.steer < -0.9, `got ${wheelRight.steer.toFixed(2)}`);
  check('axis negative (wheel LEFT) steers left', wheelLeft.steer > 0.9, `got ${wheelLeft.steer.toFixed(2)}`);

  const notInverted = sampleWith(fakePad({ id: g29.id, axes: g29Axes(-1) }), { ...cal, steerInvert: false });
  check('turning steerInvert off flips the axis', notInverted.steer < -0.9, `got ${notInverted.steer.toFixed(2)}`);

  const half = sampleWith(fakePad({ id: g29.id, axes: g29Axes(0.5) }), cal);
  check('half lock reads about half', Math.abs(half.steer + 0.5) < 0.02, `got ${half.steer.toFixed(2)}`);

  const ped = sampleWith(fakePad({ id: g29.id, axes: g29Axes(0, 1, 0.5) }), cal);
  check('full throttle reads 1', Math.abs(ped.throttle - 1) < 0.02, `got ${ped.throttle.toFixed(2)}`);
  check('half brake reads 0.5', Math.abs(ped.brake - 0.5) < 0.02, `got ${ped.brake.toFixed(2)}`);

  // a wheel whose pedals rest at -1 instead of +1 must still work
  const flipped = { ...defaultCalibration('fanatec'), throttleAxis: 1, brakeAxis: 2, throttleInvert: false, brakeInvert: false };
  const fPed = sampleWith(fakePad({ id: 'Fanatec CSL', axes: [0, -1 + 2 * 0.75, -1] }), flipped);
  check('opposite pedal polarity maps correctly too',
    Math.abs(fPed.throttle - 0.75) < 0.02 && fPed.brake < 0.02,
    `thr ${fPed.throttle.toFixed(2)} brk ${fPed.brake.toFixed(2)}`);
}

/* ============================================================
   6. LEARNING WIZARD  (an unknown wheel, discovered from movement)
   ============================================================ */
console.log('\nLEARNING WIZARD  (unknown wheel, layout discovered live)');
{
  // deliberately includes centred axes at 3/4/6 that a naive detector
  // would happily mistake for pedals
  const pad = fakePad({ id: 'NoName FF Wheel', axes: [0, 1, 1, 0, 0, 1, 0, 0, 0, 1.286], buttons: 16 });
  const wizAxes = (steer, thr = 0, brk = 0) => {
    const a = [0, 1, 1, 0, 0, 1, 0, 0, 0, 1.286];
    a[0] = steer; a[1] = 1 - 2 * thr; a[5] = 1 - 2 * brk;
    return a;
  };
  const w = new WheelInput();
  w.wheel = pad;
  w.cal = defaultCalibration('generic');
  const learn = new WheelLearner(w);

  const live = (axes, pressed = {}) => {
    w.rawAxes = axes;
    w.rawButtons = pad.buttons.map((_, i) => (pressed[i] ? 1 : 0));
    // emulate rising edges
    const prev = w.prevButtons;
    w.pressed.clear();
    w.rawButtons.forEach((v, i) => { if (v > 0.5 && !(prev[i] > 0.5)) w.pressed.add(i); });
    w.prevButtons = w.rawButtons.slice();
  };

  const run = (seconds, axesFn, pressedFn) => {
    for (let i = 0; i < Math.round(seconds / dt); i++) {
      live(axesFn(i * dt), pressedFn ? pressedFn(i * dt) : {});
      learn.update(dt);
      if (learn.done) return;
    }
  };

  run(2.0, () => wizAxes(0), () => ({}));                                  // rest
  run(3.5, () => wizAxes(1), () => ({}));                                  // held fully LEFT
  run(3.5, () => wizAxes(-1), () => ({}));                                 // held fully RIGHT
  run(3.5, () => wizAxes(0, 1), () => ({}));                               // throttle -> axis 1
  run(3.5, () => wizAxes(0, 0, 1), () => ({}));                            // brake    -> axis 5
  run(6.5, () => wizAxes(0), () => ({ 5: 1 }));                            // handbrake = button 5
  run(6.5, () => wizAxes(0), () => ({ 7: 1 }));                            // boost     = button 7

  check('wizard completes', learn.done);
  const r = learn.result;
  if (r) {
    check('found the steering axis', r.steerAxis === 0, `axis ${r.steerAxis}`);
    check('found the throttle axis', r.throttleAxis === 1, `axis ${r.throttleAxis}`);
    check('found the brake axis', r.brakeAxis === 5, `axis ${r.brakeAxis}`);
    check('learned the handbrake button', r.handbrakeButton === 5, `button ${r.handbrakeButton}`);
    check('learned the boost button', r.boostButton === 7, `button ${r.boostButton}`);

    // and the result must actually drive the car correctly
    const s = sampleWith(fakePad({ id: pad.id, axes: wizAxes(0.8, 1) }), r);
    check('learned calibration steers and throttles correctly',
      Math.abs(s.steer) > 0.7 && s.throttle > 0.9,
      `steer ${s.steer.toFixed(2)} thr ${s.throttle.toFixed(2)}`);
  }
}

/* ============================================================
   6b. STEERING DIRECTION IS LEARNED, NOT GUESSED
   The browser cannot tell us which way a wheel's axis runs, so the
   wizard infers it from a labelled full-left hold. Both polarities
   of real hardware must come out the same way.
   ============================================================ */
console.log('\nSTEERING DIRECTION  (both hardware polarities must agree)');
{
  // same real-device shape as above, with centred axes to trap a naive detector
  const ax = (st, thr = 0, brk = 0) => {
    const a = [0, 1, 1, 0, 0, 1];
    a[0] = st; a[1] = 1 - 2 * thr; a[5] = 1 - 2 * brk;
    return a;
  };

  const runWizard = (leftVal, rightVal) => {
    const pad = fakePad({ id: 'Unknown Wheel ' + leftVal, axes: ax(0), buttons: 16 });
    const w = new WheelInput();
    w.wheel = pad;
    w.cal = defaultCalibration('generic');
    const learn = new WheelLearner(w);
    const live = (axes, pressed = {}) => {
      w.rawAxes = axes;
      w.rawButtons = pad.buttons.map((_, i) => (pressed[i] ? 1 : 0));
      const prev = w.prevButtons;
      w.pressed.clear();
      w.rawButtons.forEach((v, i) => { if (v > 0.5 && !(prev[i] > 0.5)) w.pressed.add(i); });
      w.prevButtons = w.rawButtons.slice();
    };
    const run = (sec, fn, pr) => {
      for (let i = 0; i < Math.round(sec / dt); i++) {
        live(fn(i * dt), pr ? pr(i * dt) : {});
        learn.update(dt);
        if (learn.done) return;
      }
    };
    run(2.0, () => ax(0));
    run(3.5, () => ax(leftVal));              // driver holds LEFT
    run(3.5, () => ax(rightVal));             // driver holds RIGHT
    run(3.5, () => ax(0, 1));
    run(3.5, () => ax(0, 0, 1));
    run(6.5, () => ax(0), () => ({ 5: 1 }));
    run(6.5, () => ax(0), () => ({ 7: 1 }));
    return learn.result;
  };

  for (const [leftVal, rightVal, label] of [
    [1, -1, 'axis runs +left / -right'],
    [-1, 1, 'axis runs -left / +right  (inverted hardware)'],
  ]) {
    const r = runWizard(leftVal, rightVal);
    if (!r) { check(label, false, 'wizard did not finish'); continue; }
    const left = sampleWith(fakePad({ id: 'x', axes: ax(leftVal) }), r);
    const right = sampleWith(fakePad({ id: 'x', axes: ax(rightVal) }), r);
    const mid = sampleWith(fakePad({ id: 'x', axes: ax((leftVal + rightVal) / 2) }), r);
    check(label, left.steer > 0.9 && right.steer < -0.9 && Math.abs(mid.steer) < 0.05,
      `left ${left.steer.toFixed(2)} centre ${mid.steer.toFixed(2)} right ${right.steer.toFixed(2)}`);
  }
}

/* ============================================================
   6c. REGRESSION: a missed pedal press must not bind a centred axis
   Reported from real hardware — auto-detect "detected some pedals as
   constantly pressed". Cause: a centred axis (a G29 has several at
   0.00) won the pedal search, and a centred axis maps to 0.5, i.e.
   permanently half pressed.
   ============================================================ */
console.log('\nPEDAL DETECTION SAFETY');
{
  const pad = fakePad({ id: 'Wheel', axes: [0, 1, 1, 0, 0, 1], buttons: 16 });
  const w = new WheelInput();
  w.wheel = pad;
  w.cal = defaultCalibration('generic');
  const learn = new WheelLearner(w);
  const live = (axes, pressed = {}) => {
    w.rawAxes = axes;
    w.rawButtons = pad.buttons.map((_, i) => (pressed[i] ? 1 : 0));
    const prev = w.prevButtons;
    w.pressed.clear();
    w.rawButtons.forEach((v, i) => { if (v > 0.5 && !(prev[i] > 0.5)) w.pressed.add(i); });
    w.prevButtons = w.rawButtons.slice();
  };
  const run = (sec, fn, pr) => {
    for (let i = 0; i < Math.round(sec / dt); i++) {
      live(fn(i * dt), pr ? pr(i * dt) : {});
      learn.update(dt);
      if (learn.done) return;
    }
  };
  // driver never touches the pedals
  const steerOnly = (st) => { const a = [0, 1, 1, 0, 0, 1]; a[0] = st; return a; };
  run(2.0, () => steerOnly(0));
  run(3.5, () => steerOnly(1));
  run(3.5, () => steerOnly(-1));
  run(3.5, () => steerOnly(0));      // "throttle" step, nothing pressed
  run(3.5, () => steerOnly(0));      // "brake" step, nothing pressed
  run(6.5, () => steerOnly(0), () => ({ 5: 1 }));
  run(6.5, () => steerOnly(0), () => ({ 7: 1 }));

  const r = learn.result;

  // The binding may legitimately fall back to the preset. What must NEVER
  // happen is binding a CENTRED axis, because that reads as half pressed.
  const restsAtEnd = (i) => i < 0 || Math.abs(learn.rest[i]) > 0.5;
  check('throttle never binds a centred axis', restsAtEnd(r.throttleAxis), `axis ${r.throttleAxis}`);
  check('brake never binds a centred axis', restsAtEnd(r.brakeAxis), `axis ${r.brakeAxis}`);
  check('the wizard flags an untrustworthy result', learn.unreliable === true);

  // and the symptom the driver actually reported: pedals reading as pressed
  // while nothing is touched
  const released = sampleWith(fakePad({ id: pad.id, axes: steerOnly(0) }), r);
  check('released pedals read as released, not half pressed',
    released.throttle < 0.02 && released.brake < 0.02,
    `thr ${released.throttle.toFixed(2)} brk ${released.brake.toFixed(2)}`);
}

/* ============================================================
   7. STEERING SHAPING
   ============================================================ */
console.log('\nSTEERING SHAPING');
{
  const base = defaultCalibration('g29');

  const dz = { ...base, steerDeadzone: 0.05 };
  const tiny = sampleWith(fakePad({ id: g29.id, axes: g29Axes(0.03) }), dz);
  check('deadzone removes sensor noise at centre', tiny.steer === 0, `got ${tiny.steer.toFixed(4)}`);

  const sat = { ...base, steerSaturation: 0.8, steerRange: 1 };
  const at80 = sampleWith(fakePad({ id: g29.id, axes: g29Axes(0.8) }), sat);
  check('saturation lets a short-travel wheel reach full lock',
    at80.steer < -0.98, `got ${at80.steer.toFixed(3)}`);

  const narrow = { ...base, steerCenter: 0.5, steerRange: 0.5 };
  const nCentre = sampleWith(fakePad({ id: g29.id, axes: g29Axes(0.5) }), narrow);
  const nFull = sampleWith(fakePad({ id: g29.id, axes: g29Axes(0.0) }), narrow);
  check('a badly centred axis is rescaled to the full range',
    Math.abs(nCentre.steer) < 0.02 && nFull.steer > 0.98,
    `centre ${nCentre.steer.toFixed(3)} full ${nFull.steer.toFixed(3)}`);

  const gamma = { ...base, steerGamma: 0.6 };
  const g25 = sampleWith(fakePad({ id: g29.id, axes: g29Axes(0.25) }), gamma);
  const lin25 = sampleWith(fakePad({ id: g29.id, axes: g29Axes(0.25) }), base);
  check('gamma < 1 makes small inputs stronger (helps long-travel wheels)',
    g25.steer < lin25.steer,
    `gamma ${g25.steer.toFixed(3)} vs linear ${lin25.steer.toFixed(3)}`);
}

/* ============================================================
   8. END-TO-END INPUT MERGE
   The unit tests above exercise WheelInput in isolation, which is
   exactly how a sign error survived them: the merge in
   Input.update() flips raw player devices into car space, and the
   wheel was being flipped a second time. These tests drive the
   REAL update() so that seam is covered.
   ============================================================ */
console.log('\nEND-TO-END INPUT MERGE');

/** Drive the real Input.update() with stubbed devices. */
function runUpdate({ keys = [], pads = [], wheel = null, bridgeInput = null }) {
  // Node defines `navigator` as a getter, so patch the method on it
  // rather than replacing the object.
  Object.defineProperty(globalThis.navigator, 'getGamepads', {
    value: () => pads, configurable: true, writable: true,
  });

  const fake = {
    keys: new Set(keys),
    pressedThisFrame: new Set(),
    state: {},
    touch: { active: false, x: 0, y: 0, hand: false, boost: false, brake: false },
    wheel,
    ffb: bridgeInput ? { bridge: { hasInput: true, input: bridgeInput } } : null,
    _prevHand: 0,
    _gamepad: Input.prototype._gamepad,
  };
  Input.prototype.update.call(fake, 1 / 60);
  return fake.state;
}

{
  // ---- keyboard must still steer the right way (the original bug)
  const left = runUpdate({ keys: ['KeyA'] });
  const right = runUpdate({ keys: ['KeyD'] });
  check('keyboard A steers left  (positive in car space)', left.steer > 0.9, `got ${left.steer}`);
  check('keyboard D steers right (negative in car space)', right.steer < -0.9, `got ${right.steer}`);
  check('keyboard throttle/brake still work',
    runUpdate({ keys: ['KeyW'] }).throttle === 1 && runUpdate({ keys: ['KeyS'] }).brake === 1);

  // ---- a gamepad axis is a raw device: pushing the stick right is +1
  const padRight = { id: 'Xbox', connected: true, axes: [1, 0, 0, 0], buttons: [] };
  const padLeft = { id: 'Xbox', connected: true, axes: [-1, 0, 0, 0], buttons: [] };
  check('gamepad stick right steers right',
    runUpdate({ pads: [padRight] }).steer < -0.9,
    `got ${runUpdate({ pads: [padRight] }).steer}`);
  check('gamepad stick left steers left',
    runUpdate({ pads: [padLeft] }).steer > 0.9,
    `got ${runUpdate({ pads: [padLeft] }).steer}`);

  // ---- the wheel already speaks car space and must NOT be flipped again
  const g29 = {
    id: 'Logitech G29 Driving Force Racing Wheel', index: 0, connected: true, mapping: '',
    axes: g29Axes(0), buttons: Array.from({ length: 25 }, () => ({ pressed: false, value: 0 })),
    vibrationActuator: null,
  };
  const w = new WheelInput();
  w.cal = defaultCalibration('g29');
  w.wheel = g29;
  w._connected = true;                     // `connected` is a getter
  w.poll = () => { w.rawAxes = g29.axes; w.rawButtons = g29.buttons.map((b) => b.value); w.pressed.clear(); };

  const setAxes = (a) => { g29.axes = a; w.rawAxes = a; };

  setAxes(g29Axes(-1));             // axis negative = wheel held LEFT
  const wheelLeft2 = runUpdate({ wheel: w });
  check('wheel held LEFT steers left', wheelLeft2.steer > 0.9, `got ${wheelLeft2.steer}`);

  setAxes(g29Axes(1));              // axis positive = wheel held RIGHT
  const wheelRight2 = runUpdate({ wheel: w });
  check('wheel held RIGHT steers right', wheelRight2.steer < -0.9, `got ${wheelRight2.steer}`);

  setAxes(g29Axes(0, 1));           // full throttle (axis 2)
  check('wheel throttle pedal reaches full', runUpdate({ wheel: w }).throttle > 0.9,
    `got ${runUpdate({ wheel: w }).throttle}`);
  setAxes(g29Axes(0, 0, 1));        // full brake (axis 5)
  check('wheel brake pedal reaches full', runUpdate({ wheel: w }).brake > 0.9,
    `got ${runUpdate({ wheel: w }).brake}`);
  setAxes(g29Axes(0, 0, 0, 1));     // clutch is bound but unused by the game
  check('clutch reads full when pressed', runUpdate({ wheel: w }).clutch > 0.9);

  // a wheel overrides the keyboard rather than fighting it
  setAxes(g29Axes(-1));                       // wheel held LEFT
  const both = runUpdate({ keys: ['KeyD'], wheel: w });   // keyboard says right
  check('a connected wheel wins over the keyboard', both.steer > 0.9, `got ${both.steer}`);

  // ---- priority: the browser's Gamepad API must WIN over the bridge.
  // Measured on real hardware, the bridge's wheel position goes stale and
  // drifts, so trusting it over Chrome made the car steer by itself.
  const bridgeFrame = { s: 1, a: 0.5, b: 0, c: 0, k: '00000000000000000000' };
  setAxes(g29Axes(-1));                          // wheel physically held LEFT
  const conflict = runUpdate({ wheel: w, bridgeInput: { ...bridgeFrame, s: -1 } });  // bridge claims RIGHT
  check('gamepad wins over a conflicting bridge reading',
    conflict.steer > 0.9,
    `got ${conflict.steer} (bridge said right, gamepad said left)`);

  // ---- but with no gamepad visible, the bridge is used as a fallback
  const wOnly = new WheelInput();
  wOnly.cal = defaultCalibration('g29');
  wOnly.wheel = null;
  wOnly._connected = false;
  wOnly.poll = () => { wOnly.rawAxes = []; wOnly.rawButtons = []; wOnly.pressed.clear(); };

  const viaBridge = runUpdate({ wheel: wOnly, bridgeInput: bridgeFrame });
  check('with no gamepad, bridge input steers left for s = +1', viaBridge.steer > 0.9, `got ${viaBridge.steer}`);
  const viaBridgeR = runUpdate({ wheel: wOnly, bridgeInput: { ...bridgeFrame, s: -1 } });
  check('with no gamepad, bridge input steers right for s = -1', viaBridgeR.steer < -0.9, `got ${viaBridgeR.steer}`);
  check('bridge throttle is passed through as a fallback',
    Math.abs(runUpdate({ wheel: wOnly, bridgeInput: bridgeFrame }).throttle - 0.5) < 0.01);
}

console.log(failures === 0
  ? '\nAll wheel + FFB checks passed.\n'
  : `\n${failures} check(s) FAILED.\n`);
process.exit(failures ? 1 : 0);
