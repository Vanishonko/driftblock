/* ============================================================
   FORCE FEEDBACK

   Two very different things get called "force feedback":

   1. Rumble — a vibration motor. The browser can do this through
      Gamepad.vibrationActuator, where it is supported at all.
   2. Real torque — the wheel physically pushes back. Browsers
      cannot do this. It needs a native process talking to the
      wheel over USB HID, which is what the optional bridge in
      tools/ffb/ provides.

   This module computes one signed torque value from the car's
   physics and routes it to whichever backend is available, so the
   game feels alive on a pad and correct on a wheel.
   ============================================================ */

import { clamp } from './physics.js';

/* ============================================================
   TORQUE MODEL
   ============================================================ */

/**
 * Tyre self-aligning torque as a function of slip angle.
 *
 * Real tyres build force roughly linearly with slip, peak, and then
 * fall away as the contact patch saturates. That peak-and-fall shape
 * is the entire reason a wheel "talks" to you: you feel the moment
 * grip starts to go, before the car actually steps out.
 */
export function aligningShape(slip, peak = 0.55) {
  const x = Math.abs(slip) / peak;
  const y = x * Math.exp(1 - x);        // peaks at x = 1 with value 1
  return Math.sign(slip) * Math.min(1, y);
}

export const FFB_DEFAULTS = {
  strength: 0.88,
  invert: false,
  // Rim friction is constant drag: you feel weight but learn nothing from it.
  // Kept deliberately low so the DIRECTIONAL aligning torque dominates — that
  // is the force that tells you which way the tyres are pushing.
  friction: 0.24,
  rumble: 0.7,
  alignPeak: 0.50,
  minSpeed: 2.5,
};

/**
 * @param {object} s car state
 * @param {object} opt { drifting, onGrass, boost }
 * @param {object} cfg tuning
 * @returns {{torque:number, friction:number, rumble:number}}
 *   torque: -1..1, POSITIVE = the wheel is pushed to the RIGHT
 */
export function computeForce(s, opt, cfg) {
  const c = { ...FFB_DEFAULTS, ...cfg };

  const speed = s.speed;
  const speedFactor = clamp((speed - c.minSpeed) / 11, 0, 1);
  const gripFactor = opt.onGrass ? 0.55 : 1.0;

  // --- aligning torque -------------------------------------------------
  // `slip` is measured along the physics yaw-positive axis, so a positive
  // slip is corrected by steering positively, which is LEFT in player
  // space. The wheel is therefore pushed LEFT (negative here) for
  // positive slip.
  const align = aligningShape(s.absSlip ? s.slip : 0, c.alignPeak);
  let torque = -align * speedFactor * gripFactor;

  // The front tyres' own cornering force, felt through the rim. Under
  // steady-state cornering this is what weights the wheel up, and it grows
  // as the slip angle does, so the rim loads before the car actually lets
  // go — the early warning you steer on.
  const cornering = clamp((s.lateralAccel || 0) / 26, -1, 1);
  torque += -cornering * 0.35 * speedFactor;

  // a touch of caster weight so the wheel centres itself when crawling
  const lowSpeedCentre = (1 - speedFactor) * clamp(speed / c.minSpeed, 0, 1);
  torque += -align * lowSpeedCentre * 0.5;

  torque *= c.strength;
  if (c.invert) torque = -torque;
  torque = clamp(torque, -1, 1);

  // --- friction --------------------------------------------------------
  // Weight in the rim at speed, and a big drop in weight once the rear
  // lets go — the single most satisfying cue that you are on a drift.
  const driftRelief = opt.drifting ? clamp(s.absSlip / 0.8, 0, 1) : 0;
  let friction = c.friction * (0.35 + 0.65 * clamp(speed / 20, 0, 1));
  friction *= (1 - 0.72 * driftRelief);
  if (opt.onGrass) friction *= 0.55;
  friction = clamp(friction, 0, 1);

  // --- rumble (for wheel-less pads, and as a seat-of-pants layer) ------
  const lat = clamp(Math.abs(s.lateralAccel) / 30, 0, 1);
  const slipRumble = clamp(s.absSlip / 1.0, 0, 1);
  let rumble = c.rumble * clamp(lat * 0.9 + slipRumble * 0.5, 0, 1);
  if (opt.onGrass) rumble = Math.max(rumble, c.rumble * clamp(speed / 30, 0, 1) * 0.7);
  if (opt.boost > 0) rumble = Math.max(rumble, c.rumble * 0.85);
  rumble = clamp(rumble, 0, 1);

  return { torque, friction, rumble };
}

/* ============================================================
   NATIVE BRIDGE CLIENT
   Speaks to tools/ffb/bridge.mjs over a WebSocket on localhost.
   ============================================================ */
export class FfbBridge {
  constructor() {
    this.ws = null;
    this.status = 'off';        // off | connecting | on | failed
    this.message = '';
    this.wheelName = '';
    this.hasInput = false;
    this.input = null;
    this.lastError = '';
  }

  connect(url = `ws://127.0.0.1:${location.port || 8177}/ffb`) {
    if (this.ws) return;
    this.status = 'connecting';
    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      this.status = 'failed';
      this.lastError = e.message;
      return;
    }

    this.ws.onopen = () => {
      this.status = 'on';
      this.message = 'bridge connected';
    };
    this.ws.onclose = () => {
      this.status = 'off';
      this.ws = null;
      this.hasInput = false;
    };
    this.ws.onerror = () => {
      this.status = 'failed';
      this.lastError = 'could not reach the bridge';
    };
    this.ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'hello') {
        this.wheelName = m.wheel || '';
        this.message = m.ffb ? 'force feedback active' : 'connected, no FFB device';
      } else if (m.t === 'input') {
        this.hasInput = true;
        this.input = m;
      }
    };
  }

  disconnect() {
    if (this.ws) { try { this.ws.close(); } catch { /* ignore */ } this.ws = null; }
    this.status = 'off';
  }

  _send(obj) {
    if (!this.ws || this.ws.readyState !== 1) return;
    try { this.ws.send(JSON.stringify(obj)); } catch { /* ignore */ }
  }

  /** torque -1..1 (positive = right), friction 0..1 */
  sendForce(torque, friction) {
    this._send({ t: 'force', v: (clamp(torque, -1, 1) + 1) / 2, f: clamp(friction, 0, 1) });
  }

  setRange(deg) { this._send({ t: 'range', deg }); }
  setLeds(v) { this._send({ t: 'leds', v: clamp(v, 0, 1) }); }
  recenter() { this._send({ t: 'recenter' }); }
}

/* ============================================================
   FORCE FEEDBACK ROUTER
   ============================================================ */
export class ForceFeedback {
  constructor() {
    this.cfg = { ...FFB_DEFAULTS };
    this.enabled = true;
    this.bridge = new FfbBridge();

    this.supported = 'none';     // none | rumble | torque
    this.deviceName = '';
    this.lastTorque = 0;
    this.lastFriction = 0;

    this._kick = 0;
    this._rumbleAcc = 0;
    this._forceAcc = 0;
    this._ledAcc = 0;
    this._pad = null;
    this._actuator = null;
  }

  setConfig(cfg) {
    this.cfg = { ...FFB_DEFAULTS, ...cfg };
    this.enabled = cfg.ffbEnabled !== false;
  }

  /** Look at the connected pad and see what haptics it exposes. */
  probe(pad) {
    this._pad = pad || null;
    this._actuator = null;
    if (!pad) {
      if (this.bridge.status === 'on' && this.bridge.wheelName) {
        this.supported = 'torque';
        this.deviceName = this.bridge.wheelName;
      } else {
        this.supported = 'none';
      }
      return this.supported;
    }

    const act = pad.vibrationActuator;
    if (act && typeof act.playEffect === 'function') {
      const effects = act.effects;
      if (!effects || effects.includes('dual-rumble') || effects.includes('trigger-rumble')) {
        this._actuator = act;
      }
    }

    if (this.bridge.status === 'on' && this.bridge.wheelName) {
      this.supported = 'torque';
      this.deviceName = this.bridge.wheelName;
    } else if (this._actuator) {
      this.supported = 'rumble';
      this.deviceName = pad.id;
    } else {
      this.supported = 'none';
      this.deviceName = pad.id || '';
    }
    return this.supported;
  }

  /** Fire a short torque pulse — used on impacts. */
  kick(amount = 0.6, sustained = false) {
    this._kick = Math.min(1.2, this._kick + amount);
    if (sustained) this._kick = Math.max(this._kick, amount);
  }

  /**
   * @param {number} dt
   * @param {object} s car state
   * @param {object} opt { drifting, onGrass, boost, active }
   */
  update(dt, s, opt = {}) {
    const { torque, friction, rumble } = computeForce(s, opt, this.cfg);

    // impact kick decays fast
    this._kick = Math.max(0, this._kick - dt * 3.2);
    const kickTorque = this._kick * 0.9 * (Math.random() * 2 - 1) * 0.35;

    const finalTorque = clamp(torque + kickTorque, -1, 1);
    const finalRumble = clamp(rumble + this._kick * 0.8, 0, 1);

    this.lastTorque = finalTorque;
    this.lastFriction = friction;

    if (!this.enabled || !opt.active) {
      this._silence();
      return;
    }

    // ---- torque via the native bridge
    // Sent whenever the bridge is up, even before it has found a wheel: the
    // bridge decides what is actionable, and this way plugging the wheel in
    // mid-session starts force feedback immediately instead of needing a
    // reload. It also makes the path verifiable (see /ffb-status).
    if (this.bridge.status === 'on') {
      this._forceAcc += dt;
      if (this._forceAcc >= 1 / 60) {
        this._forceAcc = 0;
        this.bridge.sendForce(finalTorque, friction);
      }

      // shift lights follow revs
      this._ledAcc += dt;
      if (this._ledAcc >= 1 / 20) {
        this._ledAcc = 0;
        this.bridge.setLeds(opt.rpm01 || 0);
      }
      return;
    }

    // ---- rumble fallback
    if (this._actuator) {
      this._rumbleAcc += dt;
      if (this._rumbleAcc >= 1 / 20) {
        this._rumbleAcc = 0;
        const mag = Math.max(Math.abs(finalTorque), finalRumble);
        if (mag > 0.02) {
          const p = this._actuator.playEffect('dual-rumble', {
            startDelay: 0,
            duration: 160,
            weakMagnitude: clamp(mag * 0.9, 0, 1),
            strongMagnitude: clamp(mag, 0, 1),
          });
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }
      }
    }
  }

  _silence() {
    if (this.bridge.status === 'on') {
      this._forceAcc += 0.02;
      if (this._forceAcc >= 1 / 60) {
        this._forceAcc = 0;
        this.bridge.sendForce(0, 0.25);
      }
    }
    if (this._actuator && this._rumbleAcc >= 0) {
      this._rumbleAcc = 0;
      const p = this._actuator.playEffect('dual-rumble', {
        startDelay: 0, duration: 60, weakMagnitude: 0, strongMagnitude: 0,
      });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  }

  /** Human-readable summary for the setup screen. */
  /**
   * Has the browser handed us a wheel this session? It has not, the wheel is
   * simply invisible to the page until the driver physically touches it.
   */
  get wheelSeen() {
    return !!(this.input && this.input.wheel && this.input.wheel.connected);
  }

  describe() {
    if (this.supported === 'torque') {
      return { label: 'FORCE FEEDBACK ACTIVE', detail: this.deviceName || 'native wheel', level: 'good' };
    }
    if (this.supported === 'rumble') {
      return { label: 'RUMBLE ONLY', detail: 'this device has no torque motors', level: 'warn' };
    }
    return { label: 'NO FORCE FEEDBACK', detail: 'no compatible device detected', level: 'none' };
  }
}
