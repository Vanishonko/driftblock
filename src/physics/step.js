/* ============================================================
   STEP — one tick of the car.

   Velocity is split into the car's own forward and lateral axes.
   Steering rotates the car rather than the velocity, so forward speed
   is continuously turned into lateral speed and the slide falls out of
   the maths instead of being faked.
   ============================================================ */
import { TUNE } from './tune.js';
import { clamp, sign } from './math.js';
import { updateDrivetrain, engineTorque } from './drivetrain.js';
import { tyreForces } from './tyres.js';

export function stepCar(s, input, dt, surf) {
  const T = TUNE;
  const h = Math.min(dt, 1 / 60);

  const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
  const rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);

  let vf = s.vx * fx + s.vz * fz;
  let vl = s.vx * rx + s.vz * rz;
  const speed = Math.hypot(s.vx, s.vz);

  // ---------------------------------------------------------
  // 1. STEERING (rate-limited toward input)
  // ---------------------------------------------------------
  const steerTarget = clamp(input.steer, -1, 1);
  const turning = Math.abs(steerTarget) > Math.abs(s.steer) + 0.001;
  const sRate = turning ? T.steerSpeed : T.steerReturn;
  s.steer += (steerTarget - s.steer) * (1 - Math.exp(-sRate * h));

  // ---------------------------------------------------------
  // 2. SLIP ANGLE
  // ---------------------------------------------------------
  const slip = Math.atan2(vl, Math.abs(vf) + 0.35);
  const absSlip = Math.abs(slip);
  const drifting = absSlip > T.driftSlip && speed > 5.5;

  // ---------------------------------------------------------
  // 3. LATERAL GRIP
  // ---------------------------------------------------------
  const hb = input.handbrake > 0.5;

  // ---------------------------------------------------------
  // 3. WHAT THE ENGINE IS ASKING THE REAR TYRES FOR
  // ---------------------------------------------------------
  // Computed here, before yaw and before the longitudinal step, because
  // both of them need the answer. The gear ratio is the whole reason a
  // short gear pulls and a tall one bogs; the revs and gear come from last
  // step's drivetrain update, which is one frame of lag at 120 Hz.
  const power = surf.power;
  let demanded = 0;
  if (input.throttle > 0.01 && s.gear === -1) {
    // reverse gear: the throttle drives the car backwards
    demanded = -clamp(input.throttle, 0, 1) * T.reverseAccel
      * (1 - clamp(-vf / T.maxReverse, 0, 1));
  } else if (input.throttle > 0.01) {
    const ratio = T.gearRatios[clamp((s.gear | 0) - 1, 0, T.gearRatios.length - 1)];
    const clutchGate = s.clutchEngaged !== undefined ? s.clutchEngaged : 1;
    // power is briefly cut during a gear change, which gives the drivetrain
    // its rhythm instead of one long elastic pull
    let shifting = s.shiftTimer > 0 ? T.shiftCutPower : 1;
    // a clutchless manual shift bites harder than a clutched one
    if (s.manual && s.shiftTimer > 0 && (input.clutch || 0) <= T.clutchEngageLo) {
      shifting *= T.clutchlessShiftPenalty;
    }
    // the limiter cuts power for real — bouncing off it should cost you
    if (s.limiterCut > 0) shifting *= 0.12;

    demanded = input.throttle * T.engineAccel * ratio * engineTorque(s.rpm01)
      * power * clutchGate * shifting;
  }

  // ---------------------------------------------------------
  // 4. THE FRICTION CIRCLE
  // ---------------------------------------------------------
  // The tyres have a fixed amount of grip and must share it between going
  // and turning. The lateral ask is what the cornering grip is being asked to
  // produce right now: the base rate times how much sideways velocity there
  // is to remove.
  const aLatReq = T.gripBase * Math.abs(vl);
  const tyre = tyreForces({
    longDemand: Math.abs(demanded) + (hb ? T.handbrakeDecel * input.handbrake : 0),
    latDemand: aLatReq,
    absSlip,
    surfGrip: surf.grip,
    lockup: hb ? input.handbrake : 0,
    slideState: s.tyreSlide,
  });

  // How overloaded the tyres are, 0..1. This is the single measure that used
  // to be five: throttle blend, handbrake override, clutch-kick timer and the
  // rest all reduce to "the tyres are being asked for more than they have".
  const overload = clamp((tyre.load - 1) / T.tyreOverloadSpan, 0, 1);

  // Sticky: it rises the instant the tyres are overloaded and bleeds off
  // slowly, so a slide survives the moment of countersteer that used to end it.
  s.tyreSlide = Math.max(overload, s.tyreSlide - h * T.tyreRegripRate);
  const grip = tyre.gripRate;

  // Longitudinal slip follows the load, and is what the smoke, the skid marks,
  // the engine note and the tacho all read.
  const spinRate = tyre.slipTarget > s.wheelspin ? T.wheelspinRise : T.wheelspinFall;
  s.wheelspin += (tyre.slipTarget - s.wheelspin) * (1 - Math.exp(-spinRate * h));
  // A spinning tyre is not a gripping one: keep the two in step so the HUD,
  // the effects and the physics never disagree about what the car is doing.
  s.wheelspin = Math.max(s.wheelspin, (tyre.slipTarget - s.wheelspin) * 0.5);

  // ---------------------------------------------------------
  // 4. YAW
  // ---------------------------------------------------------
  const authority = clamp(vf / T.yawRampSpeed, -1, 1);
  const highSpeedDamp = 1 - 0.48 * clamp(Math.abs(vf) / T.topSpeed, 0, 1);

  // Once the car is properly sideways the front tyres are near their own
  // limit, so steering has less and less say over yaw. Without this,
  // countersteering commands the OPPOSITE yaw directly and simply erases
  // the angle — you could never hold a slide on the throttle.
  const yawAuthority = 1 - 0.42 * s.tyreSlide;
  let targetYaw = s.steer * T.maxYawRate * authority * highSpeedDamp * yawAuthority;

  // Self-aligning torque — the single most important term for making a
  // slide *catchable* instead of an instant spin. Because `vl` is measured
  // along the yaw-positive axis, a car yawing positively develops negative
  // slip, so the restoring term is +slip: it pulls the heading back toward
  // the direction the car is actually travelling.
  const alignMul = hb ? T.alignHandbrake : 1.0;
  const alignSpeed = clamp(speed / 13, 0, 1);
  // A spinning rear tyre generates no restoring force, so the self-aligning
  // term has to fade as the slide develops. Left at full strength it keeps
  // straightening the car using grip that the tyres are no longer providing.
  const alignFade = 1 - 0.68 * s.tyreSlide;
  targetYaw += slip * T.alignK * alignMul * alignSpeed * alignFade;

  // Power sustains the rotation. In a real drift the car keeps yawing INTO
  // the corner and the countersteer only balances it — the yaw comes from a
  // lit rear tyre, not from the steering. This model commands yaw straight
  // off the steering angle, so without an explicit term the countersteer
  // commands the opposite yaw, flips the rotation and snaps the car straight.
  // slip and yawRate carry opposite signs here, hence the negation.
  //
  // Driven by `overload`, which is now the friction circle's own output: the
  // car rotates because the rear tyres are out of grip, not because a
  // separate "drift sustain" constant says so.
  const driftSustain = T.driftSustain * clamp(input.throttle, 0, 1) * s.tyreSlide * alignSpeed;
  targetYaw -= clamp(slip / 0.12, -1, 1) * driftSustain * T.maxYawRate;

  // anti-spin limiter — past ~90 deg of slip the car would just
  // pirouette to a dead stop, which feels broken. Bleed the yaw off
  // so a mistake costs you speed and angle, not the whole run.
  if (absSlip > T.spinLimit) {
    const over = absSlip - T.spinLimit;
    targetYaw *= clamp(1 - over / 0.42, 0, 1);
    targetYaw -= sign(slip) * over * T.spinRecover;
  }

  s.yawRate += (targetYaw - s.yawRate) * (1 - Math.exp(-T.yawResponse * h));
  s.yaw += s.yawRate * h;

  // ---------------------------------------------------------
  // 5. LONGITUDINAL
  // ---------------------------------------------------------
  let accel = 0;

  // The engine's contribution is whatever survived the friction circle. A
  // spinning tyre puts down less than the engine asked for, and that falls
  // out of the same relationship that took its cornering grip away.
  //
  // The circle works in magnitudes — it does not care which way the car is
  // going — so the sign has to be put back on here. Without this, reverse
  // drove forwards.
  accel += demanded < 0 ? -tyre.drive : tyre.drive;

  // ---- brakes.
  // Reverse is NOT reachable from the brake pedal. Braking to a stop, or
  // standing on the brake to light the tyres up, must never put you in
  // reverse. Reverse is a gear: select it in manual (shift down past 1st,
  // or the R gate on an H-pattern). Auto has no reverse — use reset.
  //
  // Standing on the brake with the throttle down overwhelms the REAR brakes
  // long before the fronts give up, so the car keeps rolling while the rear
  // tyres spin. That is a rolling burnout, and it needs no special case: the
  // rear lock is already part of what the circle is asked for.
  if (input.brake > 0.01) {
    if (vf > 0.4) accel -= input.brake * T.brakeAccel;
    else if (s.gear === -1 && vf < -0.4) accel += input.brake * T.brakeAccel;
    // otherwise the brakes simply hold the car
  }

  // a burnout should stay put rather than creep: the brakes win
  if (s.wheelspin > 0.35 && input.brake > T.burnoutBrake && Math.abs(vf) < T.burnoutSpeed) {
    vf *= Math.exp(-6 * h);
  }

  if (hb) accel -= sign(vf) * T.handbrakeDecel * input.handbrake;

  const boosting = s.boost > 0;
  if (boosting) {
    const bt = clamp(s.boost, 0, 1);
    const tier = clamp(Math.round(s.boostPower * 2), 0, 2);
    accel += T.boostAccel[tier] * bt;
  }

  vf += accel * h;

  // resistance
  vf -= vf * Math.abs(vf) * T.dragQuad * (boosting ? T.boostDragMul : 1) * h;
  vf -= sign(vf) * Math.min(Math.abs(vf), T.rollResist * surf.roll * h);
  vf -= sign(vf) * Math.min(Math.abs(vf), surf.dragAccel * h);


  // ---------------------------------------------------------
  // 6. LATERAL FRICTION — the tyres rotate the velocity vector
  //    toward the car's own axis. This is energy conserving by
  //    construction (it only turns the velocity, never scales it),
  //    which is what keeps long slides and donuts alive. The speed
  //    that sliding actually costs comes from `scrub` below.
  // ---------------------------------------------------------
  const vlBefore = vl;
  const mag = Math.hypot(vf, vl);
  const dir = vf >= 0 ? 1 : -1;                    // reverse-safe
  let ang = Math.atan2(vl * dir, Math.abs(vf));    // slip in the travel frame
  ang *= Math.exp(-grip * h);                      // grip pulls it straight

  const slideSin = Math.abs(Math.sin(ang));
  const scrubScale = 0.40 + 0.60 * clamp(mag / 14, 0, 1);
  const magAfter = Math.max(0, mag - slideSin * T.scrub * scrubScale * h);

  vf = dir * magAfter * Math.cos(ang);
  vl = dir * magAfter * Math.sin(ang);

  // ---------------------------------------------------------
  // 7. RECOMPOSE + INTEGRATE
  // ---------------------------------------------------------
  s.vx = vf * fx + vl * rx;
  s.vz = vf * fz + vl * rz;

  s.x += s.vx * h;
  s.z += s.vz * h;

  // ---------------------------------------------------------
  // 8. TELEMETRY
  // ---------------------------------------------------------
  s.vf = vf; s.vl = vl;
  s.speed = Math.hypot(s.vx, s.vz);
  s.slip = slip; s.absSlip = absSlip;
  s.drifting = drifting;
  s.lateralAccel = (vl - vlBefore) / h;
  s.longAccel = accel;
  s.wheelSpin += (vf / T.wheelRadius) * h;
  s.boost = Math.max(0, s.boost - h / T.boostTime);
  if (s.boost <= 0) s.boostPower = 0;

  if (input.manual !== undefined) s.manual = !!input.manual;
  updateDrivetrain(s, input, h);

  return s;
}

/** Fire a mini-turbo. tier 0..2 */

export function fireBoost(s, tier) {
  const t = clamp(tier | 0, 0, 2);
  const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
  const imp = TUNE.boostImpulse[t];
  s.vx += fx * imp;
  s.vz += fz * imp;
  s.boost = 1;
  s.boostPower = (t + 1) / 3;
  return imp;
}

/**
 * Engine torque against revs, normalized to 1.0 at its peak.
 * Real engines make best torque around two-thirds of the redline and less
 * at both ends — that shape is why a gear has a sweet spot.
 */
