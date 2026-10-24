/* ============================================================
   CAMERA — chase rig built for drama.
   Follows the *velocity* direction rather than the heading, so a
   drift automatically frames the side of the car and the smoke.
   ============================================================ */

import * as THREE from '../../vendor/three.module.js';
import { TUNE, effectiveTopSpeed } from '../physics/index.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

/** shortest signed angular difference */
function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export const CAM_MODES = ['CHASE', 'CLOSE', 'FAR', 'HOOD'];

export class ChaseCamera {
  constructor(camera, aspect) {
    this.cam = camera;
    this.mode = 0;
    this.yaw = 0;
    this.pos = new THREE.Vector3(0, 6, -12);
    this.look = new THREE.Vector3();
    this.baseFov = 68;
    this.fovCur = 68;
    this.shake = 0;
    this.shakeDecay = 3.4;
    this._t = 0;
    this._rollCur = 0;
    this.fovPunch = 0;   // 0..1, how hard the view is being pushed right now
    this._lastX = 0; this._lastZ = 0;
    this.track = null;
    this._hint = -1;
    this.cockpitZoom = 0;   // FOV offset, only applied in HOOD
    this.carKind = 'stock'; // stock | brabus | citroen
    this._bindCockpitZoom();
  }

  /** = / - adjust the cockpit lens; ignored outside HOOD. */
  _bindCockpitZoom() {
    window.addEventListener('keydown', (e) => {
      if (CAM_MODES[this.mode] !== 'HOOD') return;
      let d = 0;
      if (e.code === 'Equal' || e.code === 'NumpadAdd') d = -2;
      else if (e.code === 'Minus' || e.code === 'NumpadSubtract') d = 2;
      if (!d) return;
      this.cockpitZoom = clamp(this.cockpitZoom + d, -26, 18);
      e.preventDefault();
    });
  }

  /**
   * Keep the rig inside the circuit corridor. Without this the camera
   * ends up buried in a barrier whenever the car scrapes a wall, which
   * hides the car and looks broken.
   */
  _avoidWalls() {
    const t = this.track;
    if (!t) return 0;
    const q = t.nearest(this.pos.x, this.pos.z, this._hint);
    this._hint = q.i;
    const lim = Math.max(2, t.wallDist - 1.6);
    const over = q.lateral - Math.sign(q.lateral || 1) * lim;
    if (Math.abs(q.lateral) > lim) {
      this.pos.x -= q.nx * over;
      this.pos.z -= q.nz * over;
      // lift slightly so we look over the barrier rather than into it
      this.pos.y = Math.max(this.pos.y, 2.4);
      return Math.min(1, Math.abs(over) / 6);
    }
    return 0;
  }

  cycle() { this.mode = (this.mode + 1) % CAM_MODES.length; return CAM_MODES[this.mode]; }

  addShake(amount) { this.shake = Math.min(1.6, this.shake + amount); }

  /**
   * @param {number} dt
   * @param {import('./physics/index.js').CarState} s
   * @param {object} extra { boost:0..1, tier, reversing }
   */
  update(dt, s, extra = {}) {
    this._t += dt;
    const speed = s.speed;
    const kmh = speed * 3.6;

    // ---- where is the car actually travelling?
    const velYaw = speed > 1.2 ? Math.atan2(s.vx, s.vz) : s.yaw;
    // blend toward the heading as speed drops, so parking is stable
    const velWeight = clamp(speed / 8, 0, 1) * 0.62;
    let targetYaw = s.yaw + angDiff(velYaw, s.yaw) * velWeight;

    // lazily rotate the rig toward the target
    const followRate = 3.2 + clamp(speed / 26, 0, 1) * 3.4;
    this.yaw += angDiff(targetYaw, this.yaw) * (1 - Math.exp(-followRate * dt));

    // ---- rig dimensions per mode
    let dist, height, lookAhead, fovBase, stiffness;
    const brabus = this.carKind === 'brabus';
    const citroen = this.carKind === 'citroen';
    switch (CAM_MODES[this.mode]) {
      case 'CLOSE':
        if (brabus) { dist = 3.4; height = 1.4; lookAhead = 5; fovBase = 66; stiffness = 10; }
        else { dist = 6.6; height = 2.3; lookAhead = 9; fovBase = 74; stiffness = 9; }
        break;
      case 'FAR':
        if (brabus) { dist = 10.4; height = 4.0; lookAhead = 14; fovBase = 63; stiffness = 5; }
        else { dist = 12.6; height = 4.6; lookAhead = 17; fovBase = 63; stiffness = 5; }
        break;
      case 'HOOD':
        dist = -0.15; height = 1.42; lookAhead = 26;
        fovBase = brabus || citroen ? 72 : 74; stiffness = 22; break;
      default:
        if (brabus) { dist = 6.7; height = 2.55; lookAhead = 11; fovBase = 68; stiffness = 7; }
        else { dist = 7.9; height = 2.95; lookAhead = 13; fovBase = 68; stiffness = 7; }
    }

    // Speed pulls the camera back and widens the lens. The lens is the single
    // strongest cue for how fast you are going, so this opens up hard.
    //
    // The reference is the car's ACTUAL top speed, not a constant. It used to
    // be a hardcoded 190 while the car does 241, so everything above 190 km/h
    // looked identical — the sense of speed died exactly where it should have
    // been strongest. It also now follows the spec system, which moves the
    // top speed, so changing car changes the lens with it.
    const topKmh = Math.max(80, effectiveTopSpeed() * 3.6);
    const sf = clamp(kmh / topKmh, 0, 1);
    dist *= 1 + sf * 0.34;
    const boost = clamp(extra.boost || 0, 0, 1);

    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    let tx = s.x - fx * dist;
    let tz = s.z - fz * dist;
    // and it sinks toward the road as you go quicker, so the ground rushes
    // past underneath instead of sitting calmly in the distance
    let ty = height + sf * 0.55 - sf * sf * 0.55;

    // ---- collision-ish: never let the camera sink into the ground
    ty = Math.max(ty, 0.55);

    const k = 1 - Math.exp(-stiffness * dt);
    this.pos.x = lerp(this.pos.x, tx, k);
    this.pos.y = lerp(this.pos.y, ty, k * 0.8);
    this.pos.z = lerp(this.pos.z, tz, k);

    // wall avoidance (soft: the harder we had to push, the more we lift)
    this._clamped = this._avoidWalls();
    if (this._clamped > 0) this.pos.y += this._clamped * 1.1;

    // ---- aim ahead of the car, biased into the slide
    const hx = Math.sin(s.yaw), hz = Math.cos(s.yaw);
    const slipBias = clamp(s.absSlip * 1.1, 0, 0.85);
    const aimX = s.x + hx * lookAhead * (1 - slipBias * 0.55) + (s.vx / Math.max(1, speed)) * lookAhead * slipBias * 0.9;
    const aimZ = s.z + hz * lookAhead * (1 - slipBias * 0.55) + (s.vz / Math.max(1, speed)) * lookAhead * slipBias * 0.9;
    const aimY = 0.95;

    // ---- roll the rig slightly through a drift (pure drama)
    const targetRoll = -clamp(s.slip * 0.16, -0.13, 0.13);
    this._rollCur += (targetRoll - this._rollCur) * (1 - Math.exp(-5 * dt));

    // ---- shake: impacts, plus a constant high-speed tremor so the car
    // never feels like it is gliding on rails
    const speedTremor = sf * sf * 0.085;
    if (this.shake < speedTremor) this.shake = speedTremor;
    this.shake = Math.max(0, this.shake - this.shakeDecay * dt * (0.4 + this.shake));
    const sh = this.shake * this.shake;
    const t = this._t;
    const shX = Math.sin(t * 47.3) * sh * 0.45 + Math.sin(t * 23.1) * sh * 0.30;
    const shY = Math.cos(t * 39.7) * sh * 0.40 + Math.sin(t * 61.2) * sh * 0.20;
    const shZ = Math.sin(t * 53.9) * sh * 0.35;

    if (CAM_MODES[this.mode] === 'HOOD') {
      // A three.js camera looks down its local -Z, so a camera with
      // rotation.y = yaw faces the OPPOSITE way to a model whose forward is
      // +Z. Without the half turn below you end up staring at the back of
      // your own car. The rig yaw also lags the car through a drift, which
      // is wrong for a hood cam, so use the car's own heading here.
      const chx = Math.sin(s.yaw), chz = Math.cos(s.yaw);
      // Sit above the bonnet, far enough back that a strip of it stays in
      // frame — that strip is what makes the view read as a car rather than
      // a floating camera, and it is the reference you judge a drift against.
      // Too far back and the bodywork eats a third of the screen.
      const rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
      // BRABUS: driver-eye cockpit. Original car: a real hood cam, out over
      // the bonnet and centred, otherwise the blocky cabin fills the screen.
      // Citroen Tourer: further forward still — its windscreen base is around
      // z = +1.0 and its bonnet top is just over 1 m, so an eye at +1.55 sits
      // on the bonnet with no cabin in frame and only a slim strip of paint.
      const back = brabus ? -0.38 : citroen ? 1.55 : 0.98;
      const side = brabus ? 0.32 : 0.0;
      const eyeY = brabus ? 0.97 : citroen ? 1.18 : 1.26;
      const pitch = brabus ? -0.030 : citroen ? -0.050 : -0.040;
      this.cam.position.set(
        s.x + chx * back + rx * side + shX * 0.25,
        eyeY + shY * 0.18,
        s.z + chz * back + rz * side + shZ * 0.25
      );
      this.cam.rotation.order = 'YXZ';
      this.cam.rotation.set(
        pitch + shY * 0.05,
        s.yaw + Math.PI + shX * 0.05,
        this._rollCur * (brabus ? 0.45 : 0.28)
      );
      this.look.set(aimX, aimY, aimZ);
    } else {
      this.cam.position.set(
        this.pos.x + shX * 0.85,
        this.pos.y + shY * 0.7,
        this.pos.z + shZ * 0.85
      );
      this.look.set(aimX, aimY + shY * 0.5, aimZ);
      this.cam.up.set(Math.sin(this._rollCur), Math.cos(this._rollCur), 0);
      this.cam.lookAt(this.look);
      this.cam.rotateZ(this._rollCur * 0.35);
    }

    // ---- FOV: speed + boost + drift + the shove in your back
    //
    // Two curves rather than one, because the two halves of this do different
    // jobs. `swell` is the slow widening of speed, on a curved ramp so the
    // first 100 km/h does not already feel like the last 100. `snap` is the
    // transient — the shove in your back, the punch of a boost, the lurch of
    // a big slide — and it hits hard and lets go slowly, which is what makes
    // it read as acceleration rather than as a slightly different FOV.
    const accelKick = clamp((extra.accel || 0) / 22, -1, 1);
    const snap = clamp(accelKick, 0, 1) * 9 + boost * 16 + clamp(s.absSlip * 5.5, 0, 8);
    const swell = Math.pow(sf, 1.35) * 46;

    // Kept so callers read the lens rather than recomputing the curve from
    // the car state. Two copies of a curve drift apart; one cannot.
    const cockpitZoom = CAM_MODES[this.mode] === 'HOOD' ? this.cockpitZoom : 0;
    this.fovSteady = fovBase + swell + cockpitZoom;
    // Capped: past about 125 degrees the perspective distortion stops reading
    // as speed and starts reading as a bug, especially at the edges where
    // the blocky geometry stretches.
    const targetFov = Math.min(125, this.fovSteady + snap);
    // asymmetric: attack fast, release slow. A single rate makes the pull of
    // acceleration and its absence feel identical, which wastes both.
    const rate = targetFov > this.fovCur ? 7.5 : 3.2;
    this.fovCur += (targetFov - this.fovCur) * (1 - Math.exp(-rate * dt));
    this.fovPunch = clamp((this.fovCur - this.fovSteady) / 22, 0, 1);
    this.cam.fov = this.fovCur;
    this.cam.updateProjectionMatrix();

    // ---- hold-to-front showcase (X)
    // A temporary hero view from in front of the nose, looking back at the
    // car. It is deliberately outside the normal rig so it works in every
    // camera mode and the selected mode is still there when the key is let go.
    if (extra.front) {
      const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
      const dist = 5.2;
      this.cam.up.set(0, 1, 0);
      this.cam.position.set(s.x + fx * dist, 1.90, s.z + fz * dist);
      this.cam.lookAt(s.x, 0.85, s.z);
      this.cam.fov = 52;
      this.cam.updateProjectionMatrix();
    }
  }

  /** hard snap, used on reset / spawn */
  snap(s) {
    this.yaw = s.yaw;
    this._hint = -1;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    this.pos.set(s.x - fx * 7.9, 2.95, s.z - fz * 7.9);
    this.cam.position.copy(this.pos);
    this.cam.lookAt(s.x, 1, s.z);
    this.shake = 0;
    this.fovCur = this.baseFov;
  }
}

