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
  const slideGrip = input.throttle > 0.35 ? T.gripPower : T.gripCoast;
  // how hard the driver is asking the rear tyres to work
  const demand = Math.abs(s.steer)
    * clamp(Math.abs(vf) / 18, 0, 1)
    * clamp(input.throttle, 0, 1);
  // How far from planted to sliding the car is, from three signals:
  //
  //   1. the slide already happening, so a big angle sustains itself
  //   2. asking for too much — a big handful of steering AND throttle breaks
  //      traction on its own, which makes the handbrake a tool rather than
  //      the only way in
  //   3. throttle with real slip, see below
  //
  // It is sticky: once the rear is loose it stays loose briefly even if the
  // angle dips, so a slide survives a moment of countersteer. It still
  // recovers — lift off, straighten, and it decays back to planted in about
  // a second.
  //
  // `demand` above uses the steering ANGLE as a proxy for how hard the driver
  // is asking the rear to work, and that proxy is unreliable once the car is
  // sideways. Countersteer is opposite in SIGN to the lock that started the
  // slide, but its MAGNITUDE is whatever the slide needs — in a big angle
  // that is routinely most of the available lock, and sometimes more than was
  // used to initiate it. So a blend driven by steering angle alone can read
  // "not drifting" at the exact moment the car is most sideways, and re-plant
  // the tyres.
  //
  // The honest signal is the slip itself plus the throttle: if the rear is
  // already away and the driver is still on the gas, it stays away, whatever
  // the wheel is doing.
  const sustain = clamp((absSlip - 0.07) / 0.25, 0, 1) * clamp(input.throttle, 0, 1) * 0.95;
  const slideNow = clamp(Math.max(
    (absSlip - T.driftSlip * 0.40) / (T.driftSlip * 1.30),
    (demand - T.gripDemandLo) / (T.gripDemandHi - T.gripDemandLo),
    sustain
  ), 0, 1);
  s.slideHold = Math.max(slideNow, (s.slideHold || 0) - h * T.slideDecay);
  const slideBlend = clamp(s.slideHold, 0, 1);
  let grip = hb
    ? T.gripHandbrake
    : T.gripNormal + (slideGrip - T.gripNormal) * slideBlend;
  // a dumped clutch briefly unhooks the rear, like a lighter handbrake
  if (s.clutchKick > 0) {
    const k = s.clutchKick / T.clutchKickTime;
    grip = Math.min(grip, T.gripNormal * (1 - k) + T.gripHandbrake * T.clutchKickGrip * k);
  }
  grip *= surf.grip;

  // ---------------------------------------------------------
  // 4. YAW
  // ---------------------------------------------------------
  const authority = clamp(vf / T.yawRampSpeed, -1, 1);
  const highSpeedDamp = 1 - 0.48 * clamp(Math.abs(vf) / T.topSpeed, 0, 1);

  // Once the car is properly sideways the front tyres are near their own
  // limit, so steering has less and less say over yaw. Without this,
  // countersteering commands the OPPOSITE yaw directly and simply erases
  // the angle — you could never hold a slide on the throttle.
  const yawAuthority = 1 - 0.42 * slideBlend;
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
  const alignFade = 1 - 0.68 * slideBlend;
  targetYaw += slip * T.alignK * alignMul * alignSpeed * alignFade;

  // Power sustains the rotation. In a real drift the car keeps yawing INTO
  // the corner and the countersteer only balances it — the yaw comes from a
  // lit rear tyre, not from the steering. This model commands yaw straight
  // off the steering angle, so without an explicit term the countersteer
  // commands the opposite yaw, flips the rotation and snaps the car straight.
  // slip and yawRate carry opposite signs here, hence the negation.
  const driftSustain = T.driftSustain * clamp(input.throttle, 0, 1) * slideBlend * alignSpeed;
  targetYaw -= clamp(slip / 0.12, -1, 1) * driftSustain * T.maxYawRate;

  // anti-spin limiter — past ~90 deg of slip the car would just
  // pirouette to a dead stop, which feels broken. Bleed the yaw off
  // so a mistake costs you speed and angle, not the whole run.
  if (absSlip > T.spinLimit) {
    const over = absSlip - T.spinLimit;
    targetYaw *= clamp(1 - over / 0.42, 0, 1);
    targetYaw -= sign(slip) * over * T.spinRecover;
  }

  // handbrake flick — snaps the car sideways on pull
  if (input.handbrakeEdge && speed > 7) {
    s.yawRate += s.steer * T.handbrakeKick * clamp(speed / 22, 0, 1.15);
  }

  s.yawRate += (targetYaw - s.yawRate) * (1 - Math.exp(-T.yawResponse * h));
  s.yaw += s.yawRate * h;

  // ---------------------------------------------------------
  // 5. LONGITUDINAL
  // ---------------------------------------------------------
  let accel = 0;
  const power = surf.power;

  // How much force the engine is asking the rear tyres for, in m/s^2.
  // The gear ratio is the whole reason a short gear pulls and a tall one
  // bogs — without it every gear accelerated identically.
  let demanded = 0;
  if (input.throttle > 0.01 && s.gear === -1) {
    // reverse gear: the throttle drives the car backwards
    accel -= clamp(input.throttle, 0, 1) * T.reverseAccel
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

  // ---- traction: what the tyres will actually take
  const gripAvail = T.tractionLimit * surf.grip
    * (1 - 0.25 * clamp(Math.abs(s.absSlip) / 1.0, 0, 1));

  // A brake stand. Standing on the brake with the throttle down overwhelms
  // the REAR brakes long before the fronts give up, so the car keeps rolling
  // while the rear tyres spin — a rolling burnout rather than a stop. The
  // braking force is shared mostly to the front to model that.
  const brakeStand = input.brake > T.burnoutBrake && input.throttle > 0.3;
  const brakeShare = brakeStand ? 0.26 : 1;

  let spinTarget = 0;
  if (demanded > gripAvail) {
    spinTarget = clamp((demanded - gripAvail) / Math.max(1, gripAvail), 0, 1);
  }
  if (brakeStand) {
    // full wheelspin when stationary, easing off as speed builds, but never
    // dropping away to nothing — this is the whole point of the move
    const rolling = 1 - clamp(Math.abs(vf) / T.rollingBurnoutSpeed, 0, 1);
    spinTarget = Math.max(spinTarget, 0.45 + rolling * 0.55);
  }
  // A dumped clutch at a standstill: the engine is spinning the wheels, not
  // the road. The tyres are lit, the engine screams, and the car creeps —
  // then it hooks up and goes as speed builds.
  //
  // This scales the DRIVE ONLY. The lateral grip blend is untouched on
  // purpose: coupling the two is what inverted the drift envelope when it was
  // tried, and the lateral model is tuned, so it stays exactly as it is.
  let launchCut = 0;
  if (s.launch > 0) {
    const hookup = 1 - clamp(Math.abs(vf) / T.launchHookupSpeed, 0, 1);
    spinTarget = Math.max(spinTarget, T.launchSpin * s.launch * hookup);
    launchCut = s.launch * hookup;
  }

  const spinRate = spinTarget > s.wheelspin ? T.wheelspinRise : T.wheelspinFall;
  s.wheelspin += (spinTarget - s.wheelspin) * (1 - Math.exp(-spinRate * h));

  if (demanded > 0) {
    // a spinning tyre pushes less than a gripping one
    accel += Math.min(demanded, gripAvail * 1.35)
      * (1 - T.wheelspinGripLoss * s.wheelspin)
      * (1 - T.launchDriveCut * launchCut);
  }

  // ---- brakes.
  // Reverse is NOT reachable from the brake pedal. Braking to a stop, or
  // standing on the brake to light the tyres up, must never put you in
  // reverse. Reverse is a gear: select it in manual (shift down past 1st,
  // or the R gate on an H-pattern). Auto has no reverse — use reset.
  if (input.brake > 0.01) {
    if (vf > 0.4) accel -= input.brake * T.brakeAccel * brakeShare;
    else if (s.gear === -1 && vf < -0.4) accel += input.brake * T.brakeAccel;
    // otherwise the brakes simply hold the car
  }

  // a burnout should stay put rather than creep: the brakes win
  if (s.wheelspin > 0.35 && input.brake > T.burnoutBrake && Math.abs(vf) < T.burnoutSpeed) {
    vf *= Math.exp(-6 * h);
  }

  if (hb) accel -= sign(vf) * T.handbrakeDecel * input.handbrake;

  // mini-turbo — sustained shove plus massively reduced drag
  // the clutch kick lands a slug of torque the instant it bites
  if (s.clutchKick > 0) accel += T.clutchKickTorque * (s.clutchKick / T.clutchKickTime);

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
