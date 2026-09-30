/* ============================================================
   INPUT — keyboard, gamepad, and touch, unified into one
   analog-ish control state.
   ============================================================ */

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressedThisFrame = new Set();

    // analog state, -1..1 (steer) / 0..1 (pedals)
    this.state = {
      steer: 0,
      throttle: 0,
      brake: 0,
      handbrake: 0,
      boost: 0,
      // raw digital mirrors for edge detection
      handbrakeEdge: false,
      reset: false,
      camToggle: false,
    };

    this.touch = { active: false, x: 0, y: 0, hand: false, boost: false, brake: false };
    this._prevHand = 0;

    // optional racing wheel; when present it is authoritative for the
    // driving controls (see attachWheel)
    this.wheel = null;
    this.ffb = null;
    this.wheelActive = false;
    this.lastWheelSample = null;

    this._bindKeyboard();
    this._bindTouch();
  }

  /**
   * Give the input layer a wheel. Once one is connected the wheel owns
   * steering, pedals and the handbrake — a wheel and a keyboard fighting
   * over the same axis is worse than either alone. Keyboard keeps the
   * view/reset/pause keys.
   */
  attachWheel(wheel, ffb) {
    this.wheel = wheel;
    this.ffb = ffb;
  }

  _bindKeyboard() {
    const down = (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressedThisFrame.add(e.code);
      // stop page scrolling on space/arrows
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    };
    const up = (e) => this.keys.delete(e.code);
    window.addEventListener('keydown', down, { passive: false });
    window.addEventListener('keyup', up);
    window.addEventListener('blur', () => this.keys.clear());
  }

  _bindTouch() {
    const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    this.touch.active = isTouch;
    if (!isTouch) return;
    document.getElementById('touch').classList.remove('hidden');

    const zone = document.getElementById('stickZone');
    const base = document.getElementById('stickBase');
    const nub = document.getElementById('stickNub');
    const btnHand = document.getElementById('btnHand');
    const btnBoost = document.getElementById('btnBoost');
    const btnBrake = document.getElementById('btnBrake');
    let stickId = null;
    let ox = 0, oy = 0;
    const R = 58;

    const place = (x, y) => {
      base.style.left = (x - 65) + 'px';
      base.style.top = (y - 65) + 'px';
    };

    zone.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      stickId = t.identifier;
      const r = zone.getBoundingClientRect();
      ox = t.clientX - r.left; oy = t.clientY - r.top;
      place(ox, oy);
      base.classList.add('on');
      e.preventDefault();
    }, { passive: false });

    zone.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== stickId) continue;
        const r = zone.getBoundingClientRect();
        let dx = (t.clientX - r.left) - ox;
        let dy = (t.clientY - r.top) - oy;
        const len = Math.hypot(dx, dy);
        if (len > R) { dx = dx / len * R; dy = dy / len * R; }
        nub.style.transform = `translate(${dx}px, ${dy}px)`;
        this.touch.x = dx / R;
        this.touch.y = dy / R;
      }
      e.preventDefault();
    }, { passive: false });

    const endStick = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== stickId) continue;
        stickId = null;
        this.touch.x = this.touch.y = 0;
        nub.style.transform = '';
        base.classList.remove('on');
      }
    };
    zone.addEventListener('touchend', endStick);
    zone.addEventListener('touchcancel', endStick);

    const hold = (el, key) => {
      const on = (e) => { this.touch[key] = true; el.classList.add('on'); e.preventDefault(); };
      const off = (e) => { this.touch[key] = false; el.classList.remove('on'); e.preventDefault(); };
      el.addEventListener('touchstart', on, { passive: false });
      el.addEventListener('touchend', off, { passive: false });
      el.addEventListener('touchcancel', off, { passive: false });
    };
    hold(btnHand, 'hand');
    hold(btnBoost, 'boost');
    hold(btnBrake, 'brake');
  }

  /** Read gamepad if present. Returns null when absent. */
  _gamepad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const ax = p.axes[0] || 0;
      const rt = p.buttons[7] ? p.buttons[7].value : 0;
      const lt = p.buttons[6] ? p.buttons[6].value : 0;
      return {
        steer: Math.abs(ax) > 0.12 ? ax : 0,
        throttle: Math.max(rt, p.buttons[0] && p.buttons[0].pressed ? 1 : 0),
        brake: lt,
        handbrake: (p.buttons[1] && p.buttons[1].pressed) || (p.buttons[5] && p.buttons[5].pressed) ? 1 : 0,
        boost: p.buttons[2] && p.buttons[2].pressed ? 1 : 0,
      };
    }
    return null;
  }

  update(dt) {
    const k = this.keys;
    const up = k.has('KeyW') || k.has('ArrowUp');
    const dn = k.has('KeyS') || k.has('ArrowDown');
    const lf = k.has('KeyA') || k.has('ArrowLeft');
    const rt = k.has('KeyD') || k.has('ArrowRight');
    const hb = k.has('Space');
    const bo = k.has('ShiftLeft') || k.has('ShiftRight');

    let steer = (rt ? 1 : 0) - (lf ? 1 : 0);
    let throttle = up ? 1 : 0;
    let brake = dn ? 1 : 0;
    let handbrake = hb ? 1 : 0;
    let boost = bo ? 1 : 0;
    let clutch = 0;      // wheel only; nothing else reports one

    // ==================================================================
    // Where things are in "car space"
    //
    // The car's model faces local +Z, and in a right-handed Y-up system
    // its right-hand side is therefore forward x up = -X. A positive steer
    // value rotates the car toward +X, which reads on screen as turning
    // LEFT. So in the final state, POSITIVE STEER MEANS LEFT.
    //
    // Raw player devices are the other way round (right = positive), so
    // they get flipped exactly once, below. The wheel already produces
    // car-space values, so it must NOT be flipped again — that mistake is
    // easy to make and produces a car that steers backwards.
    // ==================================================================

    // ---- poll the wheel first; it decides whether it owns the controls
    let wheelCam = false, wheelReset = false;
    this.wheelActive = false;
    this.lastWheelSample = null;
    let wheelSample = null;

    if (this.wheel) {
      this.wheel.poll();

      // The browser's Gamepad API is the source of truth for INPUT. The
      // bridge also reports wheel position, but it comes from an
      // unmaintained HID library whose wheel-turn value was measured
      // going stale and drifting on real hardware (reporting a turned
      // wheel while Chrome read it dead centre) — so it is only a
      // fallback for wheels the browser cannot see at all.
      const fromPad = this.wheel.connected ? this.wheel.sample() : null;
      const fromBridge = this.ffb && this.ffb.bridge && this.ffb.bridge.hasInput
        ? this.wheel.sampleFromBridge(this.ffb.bridge.input)
        : null;
      wheelSample = fromPad || fromBridge;
      this.usingBridgeInput = !fromPad && !!fromBridge;
      if (wheelSample && this.wheel.enabled !== false) {
        this.lastWheelSample = wheelSample;
        this.wheelActive = true;
      }
    }

    // ---- raw player devices (right = positive for all of these)
    const pad = this._gamepad();
    if (pad && !this.wheelActive) {
      if (Math.abs(pad.steer) > Math.abs(steer)) steer = pad.steer;
      throttle = Math.max(throttle, pad.throttle);
      brake = Math.max(brake, pad.brake);
      handbrake = Math.max(handbrake, pad.handbrake);
      boost = Math.max(boost, pad.boost);
    }

    if (this.touch.active && !this.wheelActive) {
      if (Math.abs(this.touch.x) > Math.abs(steer)) steer = this.touch.x;
      if (this.touch.y < -0.15) throttle = Math.max(throttle, Math.min(1, -this.touch.y));
      if (this.touch.y > 0.15) brake = Math.max(brake, Math.min(1, this.touch.y));
      handbrake = Math.max(handbrake, this.touch.hand ? 1 : 0);
      boost = Math.max(boost, this.touch.boost ? 1 : 0);
      if (this.touch.brake) brake = 1;
    }

    // deadzone on the raw sources, then flip them into car space
    if (Math.abs(steer) < 0.08) steer = 0;
    steer = -steer;

    // ---- the wheel overrides, already in car space
    if (this.wheelActive && wheelSample) {
      steer = wheelSample.steer;
      throttle = wheelSample.throttle;
      brake = wheelSample.brake;
      handbrake = wheelSample.handbrake;
      boost = wheelSample.boost;
      clutch = wheelSample.clutch || 0;
      wheelCam = !!wheelSample.camera;
      wheelReset = !!wheelSample.reset;
    }

    this.state.steer = Math.max(-1, Math.min(1, steer));
    this.state.throttle = throttle;
    this.state.brake = brake;
    this.state.handbrake = handbrake;
    this.state.boost = boost;
    this.state.clutch = clutch;

    this.state.handbrakeEdge = handbrake > 0.5 && this._prevHand <= 0.5;
    this._prevHand = handbrake;

    // ---- gearbox
    // Keyboard fallback: E / Q shift, and the wheel's paddles or shifter
    // supply their own edges through the wheel sample.
    let shiftUpReq = this.pressedThisFrame.has('KeyE');
    let shiftDownReq = this.pressedThisFrame.has('KeyQ');
    if (this.lastWheelSample) {
      if (this.lastWheelSample.shiftUp) shiftUpReq = true;
      if (this.lastWheelSample.shiftDown) shiftDownReq = true;
    }
    this.state.shiftUp = shiftUpReq;
    this.state.shiftDown = shiftDownReq;
    // H-pattern: a direct gear position, if one is selected
    this.state.gearRequest = this.lastWheelSample ? (this.lastWheelSample.gearRequest ?? 0) : 0;

    this.state.reset = this.pressedThisFrame.has('KeyR') || wheelReset;
    this.state.camToggle = this.pressedThisFrame.has('KeyC') || wheelCam;
    this.state.pause = this.pressedThisFrame.has('Escape') || this.pressedThisFrame.has('KeyP');
    this.state.confirm = this.pressedThisFrame.has('Enter') || this.pressedThisFrame.has('NumpadEnter');
    this.state.any = this.pressedThisFrame.size > 0;
  }

  /** Call at the very end of each frame. */
  endFrame() {
    this.pressedThisFrame.clear();
  }
}
