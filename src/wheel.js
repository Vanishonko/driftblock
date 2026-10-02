/* ============================================================
   WHEEL — racing wheel / pedal support.

   Wheels almost never report the browser's "standard gamepad"
   mapping, so we can't hardcode an axis layout and trust it. Instead
   this module ships presets for common wheels *and* a learning pass
   that discovers the real layout from the hardware in front of you.

   Nothing here is G29-specific at the core: a preset is just a
   head start on the calibration the wizard would find anyway.
   ============================================================ */

import { FFB_DEFAULTS } from './ffb.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ============================================================
   DEVICE PRESETS
   These pre-fill the calibration so a known wheel usually works
   with zero setup. Every field remains user-overridable.
   ============================================================ */
export const WHEEL_PRESETS = [
  {
    id: 'g29',
    name: 'Logitech G29 / G920 / G923',
    // Confirmed against real hardware on macOS/Chrome. The wheel presents
    // 10 axes and 25 buttons with mapping "none", and the three pedals rest
    // at +1 (released) travelling to -1 (pressed). Note the axis ORDER is
    // not intuitive — throttle and brake are NOT 1 and 2 — and it can shift
    // between PS4/PS5/PC modes, so auto-detect is the reliable route if
    // these do not match your unit.
    match: /g29|g920|g923|logitech.*(wheel|driving)/i,
    axes: { steer: 0, throttle: 2, brake: 5, clutch: 1 },
    // steering axis runs negative-to-the-left, like every other HID axis
    steerInvert: true,
    pedalRest: 1,
    // Face buttons differ between PS4 and PS3 modes; the wizard confirms.
    buttons: { handbrake: 0, boost: 1, camera: 2, reset: 3 },
    rangeDeg: 540,
    hasClutch: true,
  },
  {
    id: 'g27',
    name: 'Logitech G25 / G27',
    match: /g25|g27|logitech.*(wingman|wheel)/i,
    axes: { steer: 0, throttle: 1, brake: 2, clutch: 3 },
    pedalRest: 1,
    buttons: { handbrake: 0, boost: 1, camera: 2, reset: 3 },
    rangeDeg: 540,
    hasClutch: true,
  },
  {
    id: 'thrustmaster',
    name: 'Thrustmaster T150 / T300 / TX',
    match: /thrustmaster|t150|t300|tmx|t500/i,
    axes: { steer: 0, throttle: 1, brake: 2, clutch: 3 },
    pedalRest: 1,
    buttons: { handbrake: 0, boost: 1, camera: 2, reset: 3 },
    rangeDeg: 540,
    hasClutch: true,
  },
  {
    id: 'fanatec',
    name: 'Fanatec CSL / ClubSport',
    match: /fanatec|csl|clubsport|csr elite/i,
    axes: { steer: 0, throttle: 1, brake: 2, clutch: 3 },
    pedalRest: -1,
    buttons: { handbrake: 0, boost: 1, camera: 2, reset: 3 },
    rangeDeg: 540,
    hasClutch: true,
  },
  {
    id: 'generic',
    name: 'Generic / unknown wheel',
    match: null,
    axes: { steer: 0, throttle: 1, brake: 2, clutch: -1 },
    pedalRest: 1,
    buttons: { handbrake: 0, boost: 1, camera: 2, reset: 3 },
    rangeDeg: 540,
    hasClutch: false,
  },
];

/**
 * Bump when a default that gets persisted changes in a way that would leave
 * an existing save behaving wrongly.
 *   1 -> 2 : the steering axis default was inverted the wrong way round.
 */
export const CAL_VERSION = 3;

export function presetFor(id) {
  return WHEEL_PRESETS.find((p) => p.id === id) || WHEEL_PRESETS[WHEEL_PRESETS.length - 1];
}

export function detectPreset(gamepadId = '') {
  for (const p of WHEEL_PRESETS) {
    if (p.match && p.match.test(gamepadId)) return p;
  }
  return null;
}

/* ============================================================
   IS IT A WHEEL?
   Heuristics that work without a name match: a wheel has a
   centred steering axis, often one or more axes parked at an
   extreme (pedals), and few or no analogue triggers.
   ============================================================ */
export function looksLikeWheel(pad) {
  if (!pad) return false;
  if (detectPreset(pad.id || '')) return true;
  const axes = pad.axes || [];
  if (axes.length < 3) return false;
  let centred = 0, parked = 0;
  for (const a of axes) {
    if (Math.abs(a) < 0.22) centred++;
    if (Math.abs(a) > 0.75) parked++;
  }
  // steering (centred) + at least two pedals (parked at an extreme)
  return centred >= 1 && parked >= 2;
}

/* ============================================================
   DEFAULT CALIBRATION
   ============================================================ */
export function defaultCalibration(presetId = 'generic') {
  const p = presetFor(presetId);
  return {
    version: CAL_VERSION,
    preset: p.id,
    steerInvert: p.steerInvert !== undefined ? p.steerInvert : true,
    deviceId: null,
    deviceName: '',

    steerAxis: p.axes.steer,
    steerCenter: 0,
    steerRange: 1,        // half-travel; 1 means the axis already spans -1..1
    // HID/Gamepad steering axes follow the stick convention: turning LEFT
    // reports NEGATIVE. Car space wants positive = left, so the axis is
    // inverted by default. Getting this backwards makes the car steer the
    // wrong way, so auto-detect sets it explicitly from a labelled left hold.
    steerDeadzone: 0.012,
    steerGamma: 1.0,      // <1 = more sensitive near centre
    steerSaturation: 1.0, // fraction of travel that counts as full lock

    throttleAxis: p.axes.throttle,
    throttleInvert: p.pedalRest > 0,
    brakeAxis: p.axes.brake,
    brakeInvert: p.pedalRest > 0,
    clutchAxis: p.hasClutch ? p.axes.clutch : -1,
    clutchInvert: p.pedalRest > 0,

    handbrakeButton: p.buttons.handbrake,
    boostButton: p.buttons.boost,
    shiftUpButton: -1,
    shiftDownButton: -1,
    gearPattern: null,       // [null, [btn...] x6, [btn...] reverse]
    cameraButton: p.buttons.camera,
    resetButton: p.buttons.reset,
    handbrakeAxis: -1,     // some wheels have an analogue handbrake

    rangeDeg: p.rangeDeg,
    // Taken from the force model rather than duplicated here. These two had
    // already drifted apart: this file still said friction 0.5 while
    // FFB_DEFAULTS said 0.24, so a fresh calibration — or one produced by the
    // setup wizard — got exactly the heavy constant friction that masks the
    // directional aligning torque and makes the rim feel like plain
    // resistance. The migration only ever fixed *saved* calibrations.
    ffbStrength: FFB_DEFAULTS.strength,
    ffbInvert: FFB_DEFAULTS.invert,
    ffbFriction: FFB_DEFAULTS.friction,
    ffbEnabled: true,

    // A wheel needs finer steering than a pad, so it gets its own
    // input smoothing and a gentler speed-sensitive falloff.
    steerSmoothing: 0.0,
  };
}

/* ============================================================
   WHEEL INPUT
   ============================================================ */
export class WheelInput {
  constructor() {
    this.devices = [];       // all connected gamepads
    this.wheel = null;       // the gamepad currently treated as the wheel
    this.cal = defaultCalibration('generic');
    this.calibrated = false;

    this.prevButtons = [];
    this.pressed = new Set();  // button indices that went down this frame

    // live raw values, for the setup UI
    this.rawAxes = [];
    this.rawButtons = [];
    this.rawName = '';

    this._connected = false;
  }

  setCalibration(cal) {
    const merged = { ...defaultCalibration(cal.preset), ...cal };

    // Migrate older saves. v1 shipped with the steering axis inverted the
    // wrong way, so anything saved from then steers backwards — re-derive
    // the direction from the preset rather than trusting the stored value.
    if (!cal.version || cal.version < CAL_VERSION) {
      const p = presetFor(merged.preset);
      if (cal.version < 2 && p.steerInvert !== undefined) merged.steerInvert = p.steerInvert;
      // v2 and earlier shipped with heavy constant friction, which masked the
      // directional torque entirely
      if (cal.version < 3) {
        merged.ffbStrength = 0.88;
        merged.ffbFriction = 0.24;
      }
    }
    merged.version = CAL_VERSION;

    this.cal = merged;
    this.calibrated = !!cal.deviceId;
  }

  /* ---------------- device discovery ---------------- */

  /**
   * Wake up when the browser starts or stops showing us a gamepad.
   *
   * Chrome and Safari keep a gamepad hidden from a page until the driver has
   * physically touched it — pressed a button, turned the wheel, moved a pedal.
   * A wheel that is plugged in and working perfectly is invisible until then,
   * which reads as "it is not detecting my wheel". These events are the
   * reliable signal that it has appeared; polling alone picks it up a frame
   * later but gives no way to explain the wait.
   *
   * @param {(connected: boolean) => void} [onChange]
   * @returns {() => void} unsubscribe
   */
  watch(onChange) {
    if (typeof window === 'undefined' || !window.addEventListener) return () => {};
    const fire = () => {
      this.poll();
      if (onChange) onChange(this.connected);
    };
    window.addEventListener('gamepadconnected', fire);
    window.addEventListener('gamepaddisconnected', fire);
    return () => {
      window.removeEventListener('gamepadconnected', fire);
      window.removeEventListener('gamepaddisconnected', fire);
    };
  }

  /** True once the browser has ever handed us a pad this session. */
  get everSeen() { return this._everSeen === true; }

  poll() {
    if (!navigator.getGamepads) return;
    const pads = Array.from(navigator.getGamepads()).filter((p) => p && p.connected);
    this.devices = pads;

    // prefer an explicitly calibrated device, then a recognised wheel
    let pick = null;
    if (this.cal.deviceId) pick = pads.find((p) => p.id === this.cal.deviceId) || null;
    if (!pick) pick = pads.find(looksLikeWheel) || null;

    if (pick !== this.wheel) {
      this.wheel = pick;
      if (pick) {
        this.cal.deviceName = pick.id;
        // First time we see this device and the driver has never saved a
        // calibration, adopt the matching preset so a known wheel works
        // out of the box.
        if (!this.cal.deviceId) {
          const preset = detectPreset(pick.id);
          if (preset && preset.id !== this.cal.preset) {
            const saved = { ...this.cal };
            this.cal = { ...defaultCalibration(preset.id), deviceName: pick.id };
            // keep anything the driver had already tuned by hand
            for (const k of ['ffbStrength', 'ffbFriction', 'ffbEnabled', 'steerGamma', 'steerDeadzone']) {
              if (saved[k] !== undefined) this.cal[k] = saved[k];
            }
          }
        }
      }
    }

    if (pick) {
      this.rawAxes = Array.from(pick.axes);
      this.rawButtons = pick.buttons.map((b) => (typeof b === 'object' ? b.value : b));
      this.rawName = pick.id;

      // rising-edge detection for mapping buttons
      this.pressed.clear();
      for (let i = 0; i < this.rawButtons.length; i++) {
        const now = this.rawButtons[i] > 0.5;
        const was = this.prevButtons[i] > 0.5;
        if (now && !was) this.pressed.add(i);
      }
      this.prevButtons = this.rawButtons.slice();
    }
    this._connected = !!pick;
    if (pick) this._everSeen = true;
  }

  get connected() { return this._connected; }

  /* ---------------- pedal / steering shaping ---------------- */

  _axis(i) {
    if (i < 0 || i >= this.rawAxes.length) return 0;
    return this.rawAxes[i];
  }

  /** Steering, already shaped and in player space (+ = left, matching Input.state). */
  _steer() {
    const c = this.cal;
    const v = this._axis(c.steerAxis);

    // Normalise against the measured centre and half-travel FIRST, then
    // flip. Doing it the other way round inverts the centre too, so any
    // wheel whose zero is not exactly 0.0 — which is most of them, and every
    // wheel the wizard calibrates — ends up pinned to full lock.
    let n = (v - c.steerCenter) / (c.steerRange || 1);
    n = clamp(n, -1, 1);
    if (c.steerInvert) n = -n;

    // deadzone, rescaled so there is no step at the edge of it
    const dz = c.steerDeadzone;
    if (dz > 0) {
      if (Math.abs(n) <= dz) n = 0;
      else n = Math.sign(n) * ((Math.abs(n) - dz) / (1 - dz));
    }

    // saturation: let a wheel that cannot quite reach the extremes still
    // achieve full lock
    const sat = c.steerSaturation || 1;
    if (sat < 1) n = clamp(n / sat, -1, 1);

    // gamma
    if (c.steerGamma !== 1) {
      n = Math.sign(n) * Math.pow(Math.abs(n), c.steerGamma);
    }

    // Input.state uses the physics convention, where steer is POSITIVE for
    // LEFT (see the note in input.js). For a standard HID axis a left turn
    // reads negative, so `steerInvert` defaults to true and normalises a
    // left hold to positive. No further flip belongs here.
    return n;
  }

  /** Pedals: 0 released .. 1 fully pressed. */
  _pedal(axisIndex, invert) {
    if (axisIndex < 0) return 0;
    let v = this._axis(axisIndex);
    if (invert) v = -v;

    // A pedal rests at one end of its travel — but WHICH end, and exactly
    // where, depends on the wheel and on the mode it is in. The G29 moves its
    // axis layout between PS4/PS5/PC modes, which this file already warns
    // about further up.
    //
    // Assuming a rest of exactly -1 (or +1 inverted) fails badly on any axis
    // sitting anywhere else: an axis resting at 0.000 converts to a
    // half-pressed pedal that never releases, and the car will not pull away.
    // That is not hypothetical, it is what a G29 was doing here.
    //
    // A released pedal is where the axis sits nearly all of the time, so
    // learn the rest rather than assuming it: ratchet towards whatever the
    // axis is doing, with a slow decay so it recovers if the wheel is
    // re-centred or the mode changes underneath it.
    const rest = this._pedalRest(axisIndex, v);
    // `rest` is the RELEASED end, which is the low end after inversion: the
    // preset says these pedals rest at +1 and travel to -1, and inverting
    // turns that into resting at -1 and rising to +1 as you press. So the
    // span runs from rest up to +1.
    const span = Math.max(0.25, 1 - rest);
    return clamp((v - rest) / span, 0, 1);
  }

  /**
   * The value this axis sits at when the pedal is released.
   * Ratchets up to whatever the axis reaches, decaying slowly so a long
   * press cannot permanently redefine the rest position.
   * @returns {number}
   */
  _pedalRest(axisIndex, v) {
    if (!this._rest) this._rest = new Map();

    // The running MINIMUM of the inverted axis.
    //
    // The released end is the low end, so the lowest value the axis has ever
    // reached IS the released position. That makes this instant rather than
    // gradual — the first released sample establishes it — and it is
    // self-correcting: if the estimate is ever wrong because a pedal was
    // already held when the game started, letting go fixes it immediately.
    //
    // Two earlier attempts are worth not repeating. Converging slowly on the
    // raw value left the brake part-way down for the first seconds of a run,
    // so the car bogged off the line. Converging fast whenever the axis was
    // steady was worse: a driver holding constant brake pressure through a
    // corner would have taught it that "pressed" is rest, and the brakes
    // would release themselves.
    // Seeded at the TOP of the travel, not the bottom: a running minimum can
    // only find the released position if it starts above it, and for a pedal
    // that is the first sample anyway. Seeding at -1 instead would leave a
    // wheel whose pedals rest anywhere above that reading as permanently
    // half-pressed, which is the bug this exists to fix.
    const prev = this._rest.has(axisIndex) ? this._rest.get(axisIndex) : 1;
    const next = Math.min(prev, v);
    this._rest.set(axisIndex, next);
    return next;
  }

  /** Which H-pattern gear position is engaged, or 0 for neutral/unknown. */
  _gearFromPattern() {
    const pat = this.cal.gearPattern;
    if (!pat) return 0;
    for (let g = 1; g < pat.length; g++) {
      const combo = pat[g];
      if (combo && combo.length && combo.every((b) => this.rawButtons[b] > 0.5)) return g;
    }
    return 0;
  }

  _hatEdge(i, dir) {
    if (i < 0 || i >= this.rawAxes.length) return false;
    const v = this.rawAxes[i];
    const now = dir > 0 ? v > 0.5 : v < -0.5;
    const key = 'h' + i + dir;
    if (!this._hatPrev) this._hatPrev = {};
    const was = this._hatPrev[key] || false;
    this._hatPrev[key] = now;
    return now && !was;
  }

  _btn(i) {
    if (i < 0 || i >= this.rawButtons.length) return false;
    return this.rawButtons[i] > 0.5;
  }

  /**
   * @returns {null|{steer:number, throttle:number, brake:number, clutch:number,
   *                 handbrake:number, boost:number, camera:boolean, reset:boolean}}
   */
  sample() {
    if (!this.wheel) return null;
    const c = this.cal;

    let handbrake = this._btn(c.handbrakeButton) ? 1 : 0;
    if (c.handbrakeAxis >= 0) {
      handbrake = Math.max(handbrake, this._pedal(c.handbrakeAxis, false));
    }

    return {
      steer: this._steer(),
      throttle: this._pedal(c.throttleAxis, c.throttleInvert),
      brake: this._pedal(c.brakeAxis, c.brakeInvert),
      clutch: this._pedal(c.clutchAxis, c.clutchInvert),
      handbrake,
      boost: this._btn(c.boostButton) ? 1 : 0,
      camera: this.pressed.has(c.cameraButton),
      reset: this.pressed.has(c.resetButton),
      shiftUp: this.pressed.has(c.shiftUpButton) || this._hatEdge(c.shiftUpButton, +1),
      shiftDown: this.pressed.has(c.shiftDownButton) || this._hatEdge(c.shiftDownButton, -1),
      gearRequest: this._gearFromPattern(),
      // true while the driver has the wheel turned past ~90 % of lock,
      // used for the on-screen steering indicator
      atLock: Math.abs(this._steer()) > 0.9,
    };
  }

  /** Which buttons went down this frame (for the setup UI). */
  buttonsPressedThisFrame() { return this.pressed; }

  /** Button indices currently held — used by the H-pattern learner. */
  buttonsHeld() {
    const out = [];
    for (let i = 0; i < this.rawButtons.length; i++) if (this.rawButtons[i] > 0.5) out.push(i);
    return out;
  }

  /**
   * Convert a frame from the native bridge (tools/ffb/bridge.mjs) into
   * the same shape sample() returns. The bridge already normalises, so
   * the user calibration is bypassed — it is not needed.
   * @param {{s:number,a:number,b:number,c:number,k:string}} f
   */
  sampleFromBridge(f) {
    if (!f) return null;
    const k = f.k || '';
    const btn = (i) => (k[i] === '1' ? 1 : 0);
    const c = this.cal;

    return {
      steer: clamp(f.s, -1, 1),      // bridge uses the same sign convention
      throttle: clamp(f.a, 0, 1),
      brake: clamp(f.b, 0, 1),
      clutch: clamp(f.c, 0, 1),
      handbrake: btn(c.handbrakeButton),
      boost: btn(c.boostButton),
      camera: this._bridgeEdge(c.cameraButton, btn),
      reset: this._bridgeEdge(c.resetButton, btn),
      atLock: Math.abs(f.s) > 0.9,
    };
  }

  _bridgeEdge(i, btn) {
    const now = btn(i);
    const key = 'b' + i;
    const was = this._bridgePrev ? this._bridgePrev[key] : 0;
    if (!this._bridgePrev) this._bridgePrev = {};
    this._bridgePrev[key] = now;
    return now === 1 && was === 0;
  }
}

/* ============================================================
   LEARNING WIZARD
   Discovers the real axis layout from live movement. This is what
   makes the feature work on a wheel nobody has written a preset for.
   ============================================================ */
export const LEARN_STEPS = [
  {
    id: 'rest',
    title: 'Hands off',
    detail: 'Let go of the wheel and pedals and hold still.',
    seconds: 1.6,
  },
  {
    id: 'steerLeft',
    title: 'Turn fully LEFT',
    detail: 'Turn the wheel all the way to the LEFT and hold it there.',
    seconds: 3.2,
  },
  {
    id: 'steerRight',
    title: 'Turn fully RIGHT',
    detail: 'Now turn it all the way to the RIGHT and hold it there.',
    seconds: 3.2,
  },
  {
    id: 'throttle',
    title: 'Throttle',
    detail: 'Press the throttle pedal all the way down and hold it.',
    seconds: 3.0,
  },
  {
    id: 'brake',
    title: 'Brake',
    detail: 'Now press the brake pedal all the way down and hold it.',
    seconds: 3.0,
  },
  {
    id: 'handbrake',
    title: 'Handbrake button',
    detail: 'Press the button you want to use for the handbrake.',
    seconds: 6.0,
  },
  {
    id: 'boost',
    title: 'Mini-turbo button',
    detail: 'Press the button you want for the mini-turbo.',
    seconds: 6.0,
  },
];

/** Extra steps that only run when the driver asks to learn an H-pattern. */
export const SHIFTER_STEPS = [
  { id: 'shiftNeutral', title: 'Leave it in neutral', detail: 'Let the shifter sit in neutral and hold still. This teaches the game your neutral gate.', seconds: 2.4 },
  { id: 'shift1', title: 'Select 1st', detail: 'Slot the shifter into 1st and hold it there.', seconds: 2.6 },
  { id: 'shift2', title: 'Select 2nd', detail: 'Now 2nd.', seconds: 2.6 },
  { id: 'shift3', title: 'Select 3rd', detail: 'Now 3rd.', seconds: 2.6 },
  { id: 'shift4', title: 'Select 4th', detail: 'Now 4th.', seconds: 2.6 },
  { id: 'shift5', title: 'Select 5th', detail: 'Now 5th.', seconds: 2.6 },
  { id: 'shift6', title: 'Select 6th', detail: 'Now 6th.', seconds: 2.6 },
  { id: 'shiftR', title: 'Select reverse', detail: 'Slot it into reverse and hold it there.', seconds: 2.6 },
];

export class WheelLearner {
  constructor(wheel, { shifter = false } = {}) {
    this.wheel = wheel;
    this.shifter = shifter;
    this.steps = shifter ? SHIFTER_STEPS : LEARN_STEPS;
    this.stepIndex = 0;
    this.t = 0;
    this.done = false;
    this.result = null;
    this.unreliable = false;
    this._reset();
  }

  _reset() {
    this.min = [];
    this.max = [];
    this.rest = null;
    this.restSamples = 0;
    this.restAccum = [];
    this.buttonSeen = new Set();
    this.timeInStep = 0;
    this.gearPattern = new Array(this.steps.length).fill(null);
    this._stepStartAxes = null;
    this.steerAxis = -1;
    this.gearPattern = [];
    this.leftValue = 0;
    this.rightValue = 0;
    this.steerMin = undefined;
    this.steerMax = undefined;
    this.throttleAxis = -1;
    this.brakeAxis = -1;
    this.handbrakeButton = -1;
    this.boostButton = -1;
  }

  get step() { return this.steps[this.stepIndex] || null; }
  get progress() {
    const s = this.step;
    return s ? clamp(this.t / s.seconds, 0, 1) : 1;
  }

  /** @param dt seconds */
  update(dt) {
    if (this.done) return;
    const s = this.step;
    if (!s) { this.done = true; return; }

    const axes = this.wheel.rawAxes;
    if (axes.length) {
      if (this.min.length !== axes.length) {
        this.min = axes.map((v) => v);
        this.max = axes.map((v) => v);
      } else {
        for (let i = 0; i < axes.length; i++) {
          this.min[i] = Math.min(this.min[i], axes[i]);
          this.max[i] = Math.max(this.max[i], axes[i]);
        }
      }
    }

    for (const b of this.wheel.buttonsPressedThisFrame()) this.buttonSeen.add(b);

    this.t += dt;
    this.timeInStep = this.t;

    // ---- step-specific capture
    if (s.id === 'rest') {
      if (!this.restAccum.length) this.restAccum = axes.map(() => 0);
      for (let i = 0; i < axes.length; i++) this.restAccum[i] += axes[i];
      this.restSamples++;
    }

    if (this.t < s.seconds) return;

    // ---- shifter steps just record whatever is held at the end
    if (s.id.startsWith('shift')) {
      const held = this.wheel.buttonsHeld();
      if (s.id === 'shiftNeutral') this.gearPattern[0] = held;
      else if (s.id === 'shiftR') this.gearPattern[7] = held;
      else this.gearPattern[parseInt(s.id.slice(5), 10)] = held;
      this.stepIndex++;
      this.t = 0;
      this.buttonSeen = new Set();
      if (this.stepIndex >= this.steps.length) this._finish();
      return;
    }

    // ---- step finished: commit what we learned
    switch (s.id) {
      case 'rest': {
        this.rest = this.restAccum.map((a) => a / Math.max(1, this.restSamples));
        this.min = axes.map((v) => v);
        this.max = axes.map((v) => v);
        break;
      }
      case 'steerLeft': {
        // The steering axis is the *centred* axis with the largest swing.
        // Which physical way it runs is unknowable from the numbers alone,
        // so we take the driver at their word: whatever it reads while they
        // hold it left IS left.
        let best = -1, bestSwing = 0;
        for (let i = 0; i < axes.length; i++) {
          const rest = this.rest ? this.rest[i] : 0;
          if (Math.abs(rest) > 0.35) continue;      // pedals rest at an extreme
          const swing = this.max[i] - this.min[i];
          if (swing > bestSwing) { bestSwing = swing; best = i; }
        }
        this.steerAxis = best;
        // They were told to hold it left, so the value *now* is left. Using
        // an extreme from a min/max window is unreliable: at the start of
        // the next step the wheel is still at full lock, so the window ends
        // up containing both ends of the travel.
        if (best >= 0) this.leftValue = axes[best];
        break;
      }
      case 'steerRight': {
        if (this.steerAxis >= 0) {
          this.rightValue = axes[this.steerAxis];
          this.steerMin = Math.min(this.leftValue, this.rightValue);
          this.steerMax = Math.max(this.leftValue, this.rightValue);
        }
        break;
      }
      case 'throttle':
        this.throttleAxis = this._findMovedPedal(axes);
        break;
      case 'brake':
        this.brakeAxis = this._findMovedPedal(axes, this.throttleAxis);
        break;
      case 'handbrake':
        this.handbrakeButton = this._lastNewButton();
        break;
      case 'boost':
        this.boostButton = this._lastNewButton(this.handbrakeButton);
        this._finish();
        return;
    }

    this.stepIndex++;
    this.t = 0;
    this.buttonSeen = new Set();
    // Each step observes only its own window. Without this the two steering
    // steps would share one min/max span, both ends would read as "reached",
    // and left could not be told from right.
    this.min = axes.map((v) => v);
    this.max = axes.map((v) => v);
    if (this.stepIndex >= this.steps.length) this._finish();
  }

  /**
   * Which axis is the pedal the driver just pressed?
   *
   * A pedal axis has to satisfy two things: it rests parked at one END of
   * its travel (never near the centre), and it has moved a long way from
   * that rest. Without the first test a centred axis — of which a G29 has
   * several, sitting at 0.00 — can win, and because a centred axis maps to
   * 0.5 that pedal then reads as permanently half-pressed.
   */
  _findMovedPedal(axes, skip = -1) {
    let best = -1, bestMove = 0.4;
    for (let i = 0; i < axes.length; i++) {
      if (i === skip) continue;
      const rest = this.rest ? this.rest[i] : 0;
      if (Math.abs(rest) < 0.5) continue;          // not parked at an end
      if (i === this.steerAxis) continue;          // never the wheel itself
      const move = Math.abs(axes[i] - rest);
      if (move > bestMove) { bestMove = move; best = i; }
    }
    return best;
  }

  _lastNewButton(skip = -1) {
    let best = -1;
    for (const b of this.buttonSeen) if (b !== skip && b > best) best = b;
    return best;
  }

  _finish() {
    if (this.shifter) {
      const c = { ...this.wheel.cal };
      // Every position must be distinguishable, or the shifter would report
      // two gears at once (or none).
      const seen = new Map();
      let ok = true;
      for (let g = 1; g <= 7; g++) {
        const combo = this.gearPattern[g];
        if (!combo || !combo.length) { ok = false; break; }
        const key = combo.join(',');
        if (seen.has(key)) { ok = false; break; }
        seen.set(key, g);
      }
      c.gearPattern = this.gearPattern.slice(0, 8);
      this.result = c;
      this.unreliable = !ok;
      this.done = true;
      return;
    }
    // Start from what the driver already had, not from a blank preset.
    //
    // This used to be `defaultCalibration(preset)` alone, so a wizard run
    // silently discarded everything it does not itself re-learn: the taught
    // H-pattern gates, force-feedback strength and friction, steering gamma
    // and deadzone, rotation range and the shift-up/down buttons. Redoing a
    // wheel calibration therefore destroyed the shifter setup.
    //
    // The assignments below overwrite exactly the fields the wizard actually
    // measures, so anything it did not measure survives.
    const c = { ...defaultCalibration(this.wheel.cal.preset), ...this.wheel.cal };
    const axes = this.wheel.rawAxes;

    if (this.steerAxis >= 0 && this.steerMin !== undefined) {
      c.steerAxis = this.steerAxis;
      c.steerCenter = (this.steerMin + this.steerMax) / 2;
      c.steerRange = Math.max(0.2, (this.steerMax - this.steerMin) / 2);
      // steer() returns -n, and positive steer means LEFT, so "left" must
      // normalise to a positive n. If the left hold read below centre, the
      // axis runs the other way and needs inverting.
      c.steerInvert = (this.leftValue - c.steerCenter) < 0;
    }
    if (this.throttleAxis >= 0) {
      c.throttleAxis = this.throttleAxis;
      c.throttleInvert = this._axisRestHigh(this.throttleAxis);
    }
    if (this.brakeAxis >= 0) {
      c.brakeAxis = this.brakeAxis;
      c.brakeInvert = this._axisRestHigh(this.brakeAxis);
    }
    if (this.throttleAxis < 0 || this.brakeAxis < 0) this.unreliable = true;
    if (this.handbrakeButton >= 0) c.handbrakeButton = this.handbrakeButton;
    if (this.boostButton >= 0) c.boostButton = this.boostButton;
    c.deviceId = this.wheel.wheel ? this.wheel.wheel.id : null;
    c.deviceName = this.wheel.rawName;
    // clutchAxis is deliberately left alone: the wizard has no step for it,
    // so it keeps whatever the preset or a previous setup decided.

    // If the two holds were nearly the same value the driver probably let go
    // early, or the wheel barely moved. Say so rather than saving a
    // calibration that would feel broken.
    if (!(c.steerRange >= 0.2 && Math.abs(this.rightValue - this.leftValue) >= 0.5)) this.unreliable = true;

    this.result = c;
    this.done = true;
  }

  _axisRestHigh(i) {
    if (!this.rest) return true;
    return this.rest[i] > 0;
  }

  /** Live preview of what the learner has worked out so far. */
  snapshot() {
    return {
      steerAxis: this.steerAxis,
      steerInvert: this.leftValue !== undefined && this.steerMin !== undefined
        ? (this.leftValue - (this.steerMin + this.steerMax) / 2) < 0 : false,
      throttleAxis: this.throttleAxis,
      brakeAxis: this.brakeAxis,
      handbrakeButton: this.handbrakeButton,
      boostButton: this.boostButton,
    };
  }
}
