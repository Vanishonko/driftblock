/* ============================================================
   TYRES — one friction circle for everything.

   WHY THIS EXISTS
   ---------------
   Grip used to be decided by six independent mechanisms, each with
   its own constants:

     · gripPower / gripCoast, blended by how hard you were steering
     · gripHandbrake, a flat override
     · a clutchKick timer with its own grip multiplier
     · an injected clutchKickTorque drive bonus
     · an injected clutchKickYaw
     · an injected handbrakeKick

   Twenty constants encoded those cases, `wheelspin` was a seventh
   system that never affected cornering at all, and every new situation
   (a wet road, a launch) would have needed another special case.

   There is really only one relationship. A tyre has a limited amount
   of grip, and it has to share it between going and turning. Ask for
   more than exists in either direction and the total is scaled back —
   so a lit rear tyre loses cornering grip at the same moment it loses
   traction, without anyone having to say so.

   That single fact produces, with no special cases:

     clutch dump       engine demand exceeds longitudinal grip, so the
                       tyres spin and cornering grip goes with it
     full throttle     same arithmetic, no clutch required
     wet road          surf.grip lowers both limits, so the same
                       throttle produces a bigger ask
     handbrake         the rear locks, longitudinal slip goes to 1,
                       lateral capacity collapses
     normal cornering  the ask sits under the limit and nothing slides

   NOTHING IS INJECTED. No yaw is added, and there is no random term
   anywhere in the physics. A launch with the wheels straight and no
   existing slip produces exactly zero rotation; the same launch with
   steering steps out, because the grip that would have caught it is
   no longer there.
   ============================================================ */

import { TUNE } from './tune.js';
import { clamp } from './math.js';

/**
 * The cornering stiffness curve.
 *
 * A tyre makes more cornering force as slip angle rises, peaks, and
 * then falls away. Past the peak it is sliding, and the force it can
 * still generate drops sharply. Without this the circle alone would
 * hold a slide at a sensible angle but never let it grow into the big,
 * committed angles the game is about.
 *
 * @param {number} absSlip absolute slip angle in radians
 * @param {number} [peakSlip] where the peak sits; lowered once the tyre is
 *   already sliding, which is what gives the curve its hysteresis
 * @returns {number} multiplier on the available cornering grip, 0..1
 */
export function corneringStiffness(absSlip, peakSlip = TUNE.tyrePeakSlip) {
  const x = absSlip / peakSlip;
  if (x <= 1) return 1;
  return Math.max(TUNE.tyreMinStiffness, 1 / (1 + (x - 1) * TUNE.tyreFalloff));
}

/**
 * Split the available grip between going and turning.
 *
 * @param {object} a
 * @param {number} a.longDemand  acceleration the engine is asking for, m/s^2
 * @param {number} a.latDemand   lateral acceleration the tyres are being asked
 *                               to produce, m/s^2. That is the deceleration
 *                               the cornering grip is applying to the lateral
 *                               velocity, `gripBase * |vl|` — NOT the
 *                               centripetal requirement `yawRate * speed`.
 *                               The two agree in a gentle corner but diverge
 *                               badly in a big slide, where the yaw rate is
 *                               modest and the lateral velocity is enormous.
 *                               It is the lateral velocity the tyres actually
 *                               have to kill, so that is what counts.
 * @param {number} a.absSlip     current slip angle, radians
 * @param {number} a.surfGrip    surface multiplier
 * @param {number} a.lockup      0..1 rear brake lock (handbrake)
 * @param {number} a.slideState  0..1, how far the tyres are already away
 * @returns {{scale:number, load:number, drive:number, gripRate:number, slipTarget:number}}
 *   `scale`     1 when everything asked for is available, less when not
 *   `load`      how far past the limit, 1 = exactly at it
 *   `drive`     longitudinal acceleration actually put down, m/s^2
 *   `gripRate`  slip-decay rate available for cornering, 1/s
 *   `slipTarget` 0..1 longitudinal slip this implies
 */
export function tyreForces({ longDemand, latDemand, absSlip, surfGrip, lockup = 0, slideState = 0 }) {
  const muLong = TUNE.muLong * surfGrip;
  // A locked rear tyre has its friction pointed backwards, so it has almost
  // nothing left for cornering. That is the friction circle's degenerate
  // case, not a separate handbrake rule — the lock eats the lateral budget.
  const lockFrac = clamp(lockup, 0, 1);
  const muLat = TUNE.muLat * surfGrip * (1 - TUNE.lockLatLoss * lockFrac);

  const load = Math.hypot(longDemand / muLong, latDemand / muLat);
  const scale = load > 1 ? 1 / load : 1;

  // A locked rear is longitudinal slip by definition, whatever the engine
  // is doing. It costs cornering grip through the same circle as everything
  // else rather than through a handbrake-shaped special case.
  //
  // The mapping saturates over a narrow band on purpose. `1 - 1/load` is too
  // shallow to read as a real burnout: a launch in first sits at load ~1.5,
  // which that curve calls 0.32 of the way to spinning when in reality the
  // tyres are lit.
  const fromLoad = clamp((load - 1) / TUNE.tyreSlipSpan, 0, 1);
  const slipTarget = Math.max(fromLoad, clamp(lockup, 0, 1));

  // Hysteresis. A tyre that has broken away does not re-grip the instant the
  // load comes off — it stays away until the slip falls well below the peak.
  // That is real behaviour (static against kinetic), and without it a slide
  // collapses the moment you stop asking for it, which is what made holding
  // one on part throttle impossible.
  const peak = TUNE.tyrePeakSlip * (1 - TUNE.tyreSlidePeakShift * clamp(slideState, 0, 1));

  return {
    scale,
    load,
    drive: longDemand * scale,
    gripRate: TUNE.gripBase * scale * corneringStiffness(absSlip, peak),
    slipTarget,
  };
}
