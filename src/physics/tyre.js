/* ============================================================
   TYRE — a real slip-based contact model.

   The rest of the game models grip as a single exponential decay on
   lateral velocity. That is a fine arcade shortcut and it is what the
   handling was tuned against, but it has no notion of a contact patch:
   the car has one lumped grip number, it does not know which end is
   sliding, and it cannot represent a tyre that loses grip progressively.

   This module is the real thing, as far as a game needs it:

     · slip angle per axle, not per car
     · a force curve that peaks and then FALLS AWAY, which is what makes
       a tyre let go rather than snap
     · load sensitivity — grip per newton drops as the tyre is loaded
     · a friction ellipse sharing one budget between going and turning

   The ellipse is applied as a final scale on two INDEPENDENTLY computed
   forces. That ordering is the whole design. An earlier attempt let the
   longitudinal demand draw down the budget before the lateral force was
   worked out, which coupled the two into a feedback loop and inverted
   the drift envelope — full throttle gripped where half throttle spun.
   Scaling afterwards can only reduce a force, never change which one
   dominates, so that failure mode is structurally impossible here.
   ============================================================ */

import { TUNE } from './tune.js';
import { clamp } from './math.js';

/**
 * Pacejka-style magic formula. Force as a smooth function of slip that
 * rises to a peak and then falls away.
 *
 * The falloff past the peak is the important part. A tyre that simply
 * saturated would be catchable at any angle; a real one keeps losing
 * force once it is past the peak, which is why a big slide is harder to
 * hold than a small one and why lifting off can bring it back.
 *
 * @param {number} slip slip angle (rad) or slip ratio (-)
 * @param {number} B stiffness — how quickly force builds
 * @param {number} C shape — 1.3 lateral, 1.65 longitudinal
 * @param {number} D peak — the most this tyre can make
 * @param {number} E curvature — where the peak sits
 * @returns {number} force, same sign as slip
 */
export function magicFormula(slip, B, C, D, E) {
  const Bs = B * slip;
  return D * Math.sin(C * Math.atan(Bs - E * (Bs - Math.atan(Bs))));
}

/**
 * Grip available per newton of load.
 *
 * A tyre does not make force in proportion to load — doubling the weight
 * on it adds less than double the grip. This is the single reason weight
 * transfer costs total grip, and without it a load-transfer model just
 * moves grip around for free.
 *
 * @param {number} Fz vertical load (N)
 * @param {number} Fz0 the load the reference mu was measured at
 * @param {number} mu0 peak friction at the reference load
 * @param {number} sensitivity how much mu falls per unit of relative load
 * @returns {number} peak friction coefficient at this load
 */
export function loadSensitiveMu(Fz, Fz0, mu0, sensitivity) {
  const ratio = clamp(Fz / Fz0, 0.05, 3);
  return mu0 * (1 - sensitivity * (ratio - 1));
}

/**
 * One tyre's force, with the combined-slip budget applied.
 *
 * Longitudinal and lateral force are computed independently from their
 * own slip, then scaled together if their vector sum exceeds what the
 * contact patch can transmit. Because the scale is applied last and is
 * always <= 1, asking for more drive can only ever take grip away from
 * cornering — it can never make the car corner harder.
 *
 * @param {object} o
 * @param {number} o.alpha   slip angle (rad)
 * @param {number} o.kappa   slip ratio (-), +ve driving, -ve braking
 * @param {number} o.Fz      vertical load (N)
 * @param {number} o.mu      peak friction at this load
 * @returns {{Fx:number, Fy:number, saturation:number}} forces in N and
 *   0..1 how much of the available grip is being used
 */
export function tyreForce({ alpha, kappa, Fz, mu, T = TUNE.tyre }) {
  const peak = mu * Fz;

  // NEGATED, and this is not a detail. The slip angle is measured as
  // (velocity direction - wheel direction), and a tyre pushes OPPOSITE to
  // its slip. Returning the formula directly means steering left produces a
  // rightward force: the car snaps the wrong way and pins against the slide
  // limit on every single input. It looked exactly like a model that was far
  // too loose, and was actually a model with the sign flipped.
  const Fy = -magicFormula(alpha, T.latB, T.latC, peak, T.latE);
  const Fx = magicFormula(kappa, T.lonB, T.lonC, peak, T.lonE);

  // the friction ellipse, as a scale — never a redistribution
  const used = Math.hypot(Fx / peak, Fy / peak);
  const scale = used > 1 ? 1 / used : 1;

  return { Fx: Fx * scale, Fy: Fy * scale, saturation: Math.min(1, used) };
}

/**
 * Slip angle of an axle, in radians.
 *
 * Positive means the contact patch is travelling to the left of where
 * the wheel is pointing. The atan2 is against |vf| rather than vf so the
 * sign does not flip through zero speed, which would otherwise make the
 * car spin on the spot at a standstill.
 *
 * @param {number} vl lateral velocity at the axle (m/s)
 * @param {number} vf forward velocity (m/s)
 * @param {number} steer road wheel angle (rad)
 * @returns {number} slip angle (rad)
 */
export function slipAngle(vl, vf, steer) {
  const v = Math.max(Math.abs(vf), 1.2);   // guard: no divide by zero at rest
  return Math.atan2(vl, v) - steer;
}

/**
 * Vertical load on each axle, including longitudinal weight transfer.
 *
 * @param {number} mass kg
 * @param {number} longAccel m/s^2, positive accelerating forward
 * @param {object} T tuning (a, b, cgHeight in metres)
 * @returns {{front:number, rear:number}} newtons
 */
export function axleLoads(mass, longAccel, T = TUNE.tyre) {
  const g = 9.81;
  const L = T.a + T.b;
  const staticF = mass * g * T.b / L;
  const staticR = mass * g * T.a / L;
  // accelerating moves load rearward, braking moves it forward
  const transfer = clamp(mass * longAccel * T.cgHeight / L, -staticR * 0.9, staticF * 0.9);
  return { front: staticF - transfer, rear: staticR + transfer };
}

/**
 * One integration step of a bicycle model.
 *
 * Two axles, slip-driven lateral force at each, yaw from the moment
 * between them. Everything the car does — understeer, oversteer,
 * drifting, catching a slide — falls out of those two contact patches
 * rather than being scripted by a grip blend.
 *
 * @param {object} s car state, mutated in place
 * @param {object} input { throttle, brake, handbrake, steer }
 * @param {number} h timestep (s)
 * @param {object} surf surface { grip }
 * @param {number} drive longitudinal drive force (N)
 * @returns {object} telemetry for this step
 */
export function bicycleStep(s, input, h, surf, drive) {
  const T = TUNE.tyre;
  const m = T.mass;
  const Iz = T.Iz;

  const vf = s.vf;
  const vl = s.vl;
  const r = s.yawRate;

  // ---- axle slip angles
  const steer = s.steer * T.maxSteer;
  const alphaF = slipAngle(vl + T.a * r, vf, steer);
  const alphaR = slipAngle(vl - T.b * r, vf, 0);

  // ---- load, with longitudinal transfer from last frame's acceleration
  const loads = axleLoads(m, s.longAccel || 0, T);
  const g0 = m * 9.81 / 2;                       // reference axle load
  const muF = loadSensitiveMu(loads.front, g0, T.mu, T.loadSensitivity) * surf.grip;
  const muR = loadSensitiveMu(loads.rear, g0, T.mu, T.loadSensitivity) * surf.grip;

  // ---- slip ratio from drive and brake
  const kappaF = -input.brake * T.brakeSlip;
  const kappaR = drive / (T.mu * Math.max(loads.rear, 1)) * T.driveSlip
    - input.brake * T.brakeSlip * (1 - input.handbrake);

  const front = tyreForce({ alpha: alphaF, kappa: kappaF, Fz: loads.front, mu: muF });
  const rear = tyreForce({ alpha: alphaR, kappa: kappaR, Fz: loads.rear, mu: muR });

  const handbrake = input.handbrake > 0.5 ? T.handbrakeGrip : 1;
  const FyF = front.Fy;
  const FyR = rear.Fy * handbrake;
  const FxR = rear.Fx * handbrake;

  // ---- rigid body
  const cosS = Math.cos(steer), sinS = Math.sin(steer);
  const FyTotal = FyF * cosS + FyR;
  const Mz = T.a * FyF * cosS - T.b * FyR;

  const dvf = (drive - FyF * sinS) / m + vl * r;
  const dvl = FyTotal / m - vf * r;
  const dr = Mz / Iz;

  s.vf += dvf * h;
  s.vl += dvl * h;
  s.yawRate += dr * h;
  s.yaw += s.yawRate * h;

  // drag and rolling resistance on the forward axis
  s.vf -= (T.drag * vf * Math.abs(vf) / m + T.roll * vf / m) * h;

  const slip = s.vf === 0 && s.vl === 0 ? 0 : Math.atan2(s.vl, Math.max(Math.abs(s.vf), 1.2));
  if (slip < -0.6) s.vl = -Math.tan(0.6) * Math.max(Math.abs(s.vf), 1.2);
  if (slip > 0.6) s.vl = Math.tan(0.6) * Math.max(Math.abs(s.vf), 1.2);

  return {
    alphaF, alphaR,
    frontSat: front.saturation,
    rearSat: rear.saturation,
    loadFront: loads.front,
    loadRear: loads.rear,
    FyF, FyR, FxR,
    yawMoment: Mz,
  };
}
