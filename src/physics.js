/* ============================================================
   PHYSICS — arcade drift model.
   Pure math, no renderer dependency, so it can be tuned and
   unit-tested headlessly.

   The model:
     • velocity is decomposed into the car's forward / lateral axes
     • yaw follows steering with a self-aligning torque that
       opposes slip angle (this is what makes drifts *catchable*)
     • lateral grip is an exponential decay rate that collapses
       when the handbrake is pulled or while powering through a slide
     • rotating the car converts forward velocity into lateral
       velocity automatically — that IS the slide
   ============================================================ */

export const TUNE = {
  // ---- drivetrain
  topSpeed: 67,          // m/s
  engineAccel: 4.72,
  torqueCurve: 3.2,      // exponent of the legacy speed taper (auto box only)

  // ---- gearbox ratios.
  // These are what make 1st and 4th feel different: wheel force is the
  // engine torque MULTIPLIED by the ratio, so a tall gear bogs and a short
  // one lights the tyres up. Without them every gear pulled identically.
  gearRatios: [3.40, 2.40, 1.85, 1.50, 1.25, 1.08],
  torquePeakAt: 0.62,    // rpm01 where the engine makes best torque
  torqueFalloff: 0.55,   // how much torque is lost either side of the peak

  // ---- traction. Demand more force than the tyres can take and they spin
  // instead of gripping — which is what a burnout is.
  tractionLimit: 9.2,    // m/s^2 of longitudinal grip on tarmac
  wheelspinGripLoss: 0.42,  // drive lost once the tyres are lit
  wheelspinRise: 3.4,
  wheelspinFall: 2.6,
  burnoutBrake: 0.30,    // brake held past this + throttle = standstill burnout
  burnoutSpeed: 6.0,
  rollingBurnoutSpeed: 34,  // a brake stand keeps the rears lit up to here
  reverseAccel: 4.5,
  maxReverse: 13,
  reverseHoldTime: 1.20,   // brake held this long while stopped selects reverse
  brakeAccel: 22,
  dragQuad: 0.0009,
  rollResist: 1.5,

  // ---- steering
  maxSteer: 0.62,
  steerSpeed: 6.2,       // how fast the wheel turns toward input
  steerReturn: 10.5,     // how fast it self-centres
  maxYawRate: 2.60,
  yawResponse: 8.5,
  alignK: 1.00,          // self-aligning torque per radian of slip
  alignHandbrake: 0.50,  // rear grip gone => almost no self-align
  yawAirDamp: 2.4,

  // ---- grip (exponential decay rate of lateral velocity, 1/s)
  gripNormal: 8.2,
  gripPower: 1.95,
  slideDecay: 0.85,      // how fast a slide re-plants once you stop asking
  driftSustain: 0.56,    // how strongly throttle keeps the car rotating in a slide        // throttle held mid-drift
  gripCoast: 1.80,        // coasting mid-drift
  gripHandbrake: 1.70,
  // The rear tyres start to let go once the driver asks for a lot of yaw
  // *and* a lot of power at speed. Without this the "sliding" grip values
  // could only be reached after you were already sideways, which made the
  // handbrake the only way to start a drift.
  gripDemandLo: 0.26,
  gripDemandHi: 0.78,
  scrub: 9.0,             // m/s^2 lost at 90 deg of slip (scaled by speed)

  // ---- drivetrain
  yawRampSpeed: 7.0,      // speed at which steering reaches full authority

  // ---- handbrake
  handbrakeDecel: 5.2,
  handbrakeKick: 1.15,   // instantaneous yaw flick on pull

  // ---- mini-turbo
  boostTime: 1.6,        // seconds of boost
  boostImpulse: [4.2, 6.4, 8.8],   // m/s added instantly, per tier
  boostAccel: [2.4, 3.6, 5.0],     // extra m/s^2 while boosting, per tier
  boostDragMul: 0.42,

  // ---- thresholds
  driftSlip: 0.21,       // rad of slip to count as "drifting"
  bigSlip: 0.95,
  spinLimit: 1.55,       // ~89 deg — beyond this the car is just spinning
  spinRecover: 3.0,      // how hard we bleed yaw past the limit

  // ---- surfaces
  surface: {
    road: { grip: 1.0, roll: 1.0, power: 1.0, dragAccel: 0.0 },
    grass: { grip: 0.45, roll: 1.9, power: 0.85, dragAccel: 1.5 },
  },

  // ---- engine / drivetrain character
  idleRpm: 880,
  redlineRpm: 7400,
  revUpRate: 8.5,        // how fast the engine gains revs on throttle
  revDownRate: 4.0,      // and how fast it falls away off throttle
  // fraction of top speed at which each gear runs out
  gearTops: [0.155, 0.275, 0.415, 0.575, 0.765, 1.0],
  gearHysteresis: 0.005, // stops gear flicker when sitting on a shift point
  // ---- clutch kick: dump the clutch at revs and the rear tyres break
  // loose. A third way to start a drift, alongside the handbrake and
  // simply using too much throttle.
  clutchEngageLo: 0.35,  // pedal travel below this is fully engaged
  clutchEngageHi: 0.75,  // above this the drivetrain is fully disengaged
  clutchKickTime: 0.50,
  clutchKickGrip: 0.55,  // rear grip multiplier during the kick
  clutchKickYaw: 1.25,
  clutchKickTorque: 11,  // m/s^2 of extra drive while the kick lasts
  clutchKickMinRpm: 0.30,
  clutchKickMinSpeed: 7,

  // Manual gearbox: the driver picks the gear, and shifting without the
  // clutch costs you a jolt and a moment of drive.
  manualShiftCutTime: 0.16,
  clutchlessShiftPenalty: 0.55,   // drive available on a clutchless shift
  moneyShiftRpm: 0.98,            // grabbing a gear past the redline bites

  shiftCutTime: 0.10,    // seconds of reduced power during a gear change
  shiftCutPower: 0.45,   // fraction of drive available mid-shift
  gearFeel: 0.09,        // subtle per-gear shove so each gear pulls

  wheelRadius: 0.37,
  wheelBase: 2.72,
  trackWidth: 1.74,
  mass: 1180,
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

export class CarState {
  constructor() {
    this.reset(0, 0, 0);
  }

  reset(x, z, yaw) {
    this.x = x; this.z = z; this.yaw = yaw;
    this.vx = 0; this.vz = 0;
    this.yawRate = 0;
    this.steer = 0;
    this.wheelSpin = 0;
    // telemetry for visuals / scoring
    this.vf = 0; this.vl = 0;
    this.speed = 0;
    this.slip = 0;         // signed slip angle (rad)
    this.absSlip = 0;
    this.drifting = false;
    this.lateralAccel = 0;
    this.longAccel = 0;
    this.grounded = true;
    this.boost = 0;        // 0..1 remaining boost timer
    this.boostPower = 0;

    // ---- engine state
    this.rpm = TUNE.idleRpm;
    this.rpm01 = 0;
    this.gear = 1;
    this.gearT = 0;
    this.shiftTimer = 0;
    this.shiftUp = false;
    this.justShifted = false;   // true for the single step a shift happens
    this.limiter = false;
    this.overrun = 0;           // set on lift-off, drives exhaust crackle
    this.clutch = 0;
    this.clutchKick = 0;        // seconds of clutch-kick grip loss remaining
    this.wheelspin = 0;         // 0..1 how lit the rear tyres are
    this.slideHold = 0;         // sticky slide state — see stepCar
    this.reverseHold = 0;       // brake held while stopped, to engage reverse
    this.limiterCut = 0;
    this.manual = false;        // false = automatic gearbox
    this.playerGear = 1;        // the gear the driver has selected
    this.shiftBlocked = 0;      // brief lockout so one press is one shift
  }

  get forward() { return { x: Math.sin(this.yaw), z: Math.cos(this.yaw) }; }
  get right() { return { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) }; }
  get speedKmh() { return this.speed * 3.6; }
}

/**
 * Engine / gearbox state.
 *
 * RPM is NOT a function of road speed. It is a state with its own dynamics,
 * because that is the whole difference between an engine that feels alive and
 * one that drones: the note has to answer your right foot, not the tarmac.
 *
 * Three things push the revs around:
 *   · road speed through the current gear (the baseline)
 *   · throttle, whenever the drivetrain is not locked up — pulling away,
 *     or the clutch slipping at low speed
 *   · wheelspin, so the engine screams while the rear tyres are lit
 */
export function updateDrivetrain(s, input, h) {
  const T = TUNE;

  const throttle = clamp(input.throttle, 0, 1);
  const idleR = T.idleRpm, redR = T.redlineRpm;

  // ---- gear selection
  // playerGear / gear convention:  -1 = reverse, 0 = neutral, 1..6 = gears.
  const nGears = T.gearRatios.length;
  let g = clamp((s.gear | 0) - 1, 0, nGears - 1);
  if (s.manual) {
    // The driver is in charge. Nothing shifts on its own — that is the whole
    // point of having a shifter, and it lets you hold a gear through a corner
    // instead of the box deciding for you.
    const pg = s.playerGear | 0;

    if (pg === 0) {
      // NEUTRAL. The drivetrain is open, so the engine is connected to
      // nothing: it answers the throttle and the car just rolls. This is
      // what lets you blip the throttle mid-corner or sit and rev.
      s.gear = 0;
      s.gearT = 0;
      s.clutchEngaged = 0;
      s.wheelspin = Math.max(0, s.wheelspin - h * 3);
      s.clutchKick = Math.max(0, s.clutchKick - h);
      s._prevThrottle = throttle;
      const tgt = idleR + throttle * (redR - idleR);
      s.rpm += (tgt - s.rpm) * (1 - Math.exp(-(throttle > 0.1 ? T.revUpRate : T.revDownRate) * h));
      s.rpm = clamp(s.rpm, idleR, redR);
      s.rpm01 = clamp((s.rpm - idleR) / (redR - idleR), 0, 1);
      s.limiter = s.rpm >= redR - 60;
      s.limiterCut = s.limiter ? 1 : Math.max(0, s.limiterCut - h * 6);
      if (throttle < 0.08 && s._prevThrottle > 0.35 && s.rpm01 > 0.42) s.overrun = 0.34;
      s.overrun = Math.max(0, s.overrun - h);
      return s;
    }

    if (pg < 0) {
      // REVERSE. A short ratio, driven off the throttle like any other gear.
      s.gear = -1;
      s.gearT = clamp(Math.abs(s.speed) / Math.max(1e-3, gearMaxSpeed(0) * 0.5), 0, 1);
      s.clutchEngaged = 1 - clamp(((input.clutch || 0) - T.clutchEngageLo)
        / (T.clutchEngageHi - T.clutchEngageLo), 0, 1);
      s.wheelspin = Math.max(0, s.wheelspin - h * 3);
      s.clutchKick = Math.max(0, s.clutchKick - h);
      const tgt = idleR + s.gearT * (redR - idleR) * 0.45;
      s.rpm += (tgt - s.rpm) * (1 - Math.exp(-T.revUpRate * h));
      s.rpm = clamp(s.rpm, idleR, redR);
      s.rpm01 = clamp((s.rpm - idleR) / (redR - idleR), 0, 1);
      s.limiter = s.rpm >= redR - 60;
      s.limiterCut = s.limiter ? 1 : Math.max(0, s.limiterCut - h * 6);
      s._prevThrottle = throttle;
      return s;
    }

    g = clamp(pg - 1, 0, nGears - 1);
  } else {
    while (g < nGears - 1 && Math.abs(s.speed) > gearMaxSpeed(g) * 0.985) g++;
    while (g > 0 && Math.abs(s.speed) < gearMaxSpeed(g - 1) * 0.86) g--;
  }

  const idle = T.idleRpm, red = T.redlineRpm;
  // revs come straight from road speed and the gear's ratio, exactly as a
  // real drivetrain does
  const gm = gearMaxSpeed(g);
  const gearT = clamp(Math.abs(s.speed) / Math.max(1e-3, gm), 0, 1.25);
  const wheelRpm = idle + clamp(gearT, 0, 1) * (red - idle);

  // How locked-up is the drivetrain? Only a slipping clutch lets the engine
  // outrun the wheels, and that is a low-speed effect: by ~6 m/s the
  // drivetrain is solid and revs are dictated by road speed and the ratio.
  //
  // This ramp used to reach 0.92 and run to 22 m/s, which pinned the engine
  // at the redline from walking pace in EVERY gear — the limiter then cut
  // power and the gear ratios stopped mattering at all, which is why 1st and
  // 4th felt identical.
  const traction = clamp(s.speed / 6, 0, 1);
  const clutchSlip = (1 - traction) * 0.55;
  const slipSpin = clamp(s.absSlip / 0.45, 0, 1) * clamp(s.speed / 14, 0, 1);
  // lit tyres genuinely let the engine run away from road speed — this is
  // what makes a burnout scream instead of sitting at idle
  const spun = clamp(s.wheelspin || 0, 0, 1);
  const freeRev = clutchSlip + slipSpin * 0.5 + spun * 0.85;

  // ---- clutch
  const clutch = clamp(input.clutch || 0, 0, 1);
  // 0 = fully engaged, 1 = fully disengaged, blended across the bite point
  const disengaged = clamp((clutch - T.clutchEngageLo) / (T.clutchEngageHi - T.clutchEngageLo), 0, 1);
  s.clutch = clutch;

  // Dumping the clutch at revs shocks the rear tyres loose.
  const prev = s._prevClutch || 0;
  if (prev > T.clutchEngageHi && clutch < T.clutchEngageLo
      && throttle > 0.4 && s.rpm01 > T.clutchKickMinRpm && s.speed > T.clutchKickMinSpeed) {
    s.clutchKick = T.clutchKickTime;
    s.clutchKicked = true;                      // consumed once by the caller
    s.yawRate += s.steer * T.clutchKickYaw * clamp(s.speed / 20, 0, 1.2);
  }
  s._prevClutch = clutch;
  s.clutchKick = Math.max(0, s.clutchKick - h);

  // A disengaged clutch lets the engine spin freely, so it answers the
  // throttle even at a standstill.
  const freeRevClutch = disengaged * 0.95;

  const throttleRpm = idle + throttle * (red - idle) * Math.max(freeRev, freeRevClutch);

  let target = Math.max(wheelRpm, throttleRpm);
  // closed throttle: engine braking — unless the clutch is in, in which case
  // the engine is disconnected from the wheels entirely
  if (throttle < 0.05 && disengaged < 0.5) target = wheelRpm;

  // ---- gear change
  const newGear = g + 1;
  s.justShifted = false;
  if (newGear !== s.gear) {
    s.shiftUp = newGear > s.gear;
    s.gear = newGear;
    s.shiftTimer = T.shiftCutTime;
    s.justShifted = true;
    // a downshift flares the revs, an upshift drops them
    if (!s.shiftUp) s.rpm = Math.max(s.rpm, wheelRpm);
  }

  // ---- lift-off crackle trigger
  if (throttle < 0.08 && s._prevThrottle > 0.35 && s.rpm01 > 0.42) s.overrun = 0.34;

  const rate = throttle > 0.1 ? T.revUpRate : T.revDownRate;
  s.rpm += (target - s.rpm) * (1 - Math.exp(-rate * h));
  s.rpm = clamp(s.rpm, idle, red);

  s.clutchEngaged = 1 - disengaged;
  s.shiftBlocked = Math.max(0, s.shiftBlocked - h);
  // over-revving in manual lights the limiter rather than the gearbox
  if (s.manual && gearT > 1) s.rpm = Math.min(red, wheelRpm);
  // the limiter is real: it cuts drive while you sit on it
  s.limiter = s.rpm >= red - 60;
  s.limiterCut = s.limiter ? 1 : Math.max(0, s.limiterCut - h * 6);
  s.rpm01 = (s.rpm - idle) / (red - idle);
  s.gearT = gearT;
  s.shiftTimer = Math.max(0, s.shiftTimer - h);
  s.overrun = Math.max(0, s.overrun - h);
  s._prevThrottle = throttle;
  return s;
}

/**
 * Advance the car by dt seconds.
 * @param {CarState} s
 * @param {{steer:number,throttle:number,brake:number,handbrake:number,handbrakeEdge:boolean,boost:number}} input
 * @param {number} dt
 * @param {{grip:number,roll:number,power:number,drag:number}} surf
 */
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
  // blend smoothly from planted to sliding, driven by EITHER an existing
  // slide or simply asking for too much — so a big handful of steering and
  // throttle will break traction on its own, and the handbrake becomes a
  // tool rather than a requirement.
  // Sticky. The instant the rear is loose it stays loose for a moment, even
  // if the angle dips — otherwise grip returns the moment you stop asking,
  // which makes the car snap straight the instant you countersteer and makes
  // a slide impossible to hold on the throttle. It still recovers: lift off,
  // straighten, and it decays back to planted in about a second.
  // Throttle sustains a slide on its own. Countersteer is by definition LESS
  // lock than the slide was initiated with, so a blend driven by steering
  // angle alone reads "not drifting" exactly when you are holding the biggest
  // angle — and re-plants the tyres. Once there is real slip and you are on
  // the gas, the rear stays lit whatever the wheel is doing.
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
  const spinRate = spinTarget > s.wheelspin ? T.wheelspinRise : T.wheelspinFall;
  s.wheelspin += (spinTarget - s.wheelspin) * (1 - Math.exp(-spinRate * h));

  if (demanded > 0) {
    // a spinning tyre pushes less than a gripping one
    accel += Math.min(demanded, gripAvail * 1.35) * (1 - T.wheelspinGripLoss * s.wheelspin);
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
export function engineTorque(rpm01) {
  const x = clamp(rpm01, 0, 1);
  const d = (x - TUNE.torquePeakAt) / Math.max(0.05, TUNE.torquePeakAt);
  return Math.max(0.15, 1 - TUNE.torqueFalloff * d * d);
}

/**
 * The speed the car ACTUALLY reaches, where engine drive balances drag.
 *
 * The gearbox has to be scaled against this rather than against the
 * theoretical `topSpeed` constant. `topSpeed` is the speed at which the
 * torque curve reaches zero, which drag brings forward by about 20% — so
 * scaling gears off it left every ratio a quarter too tall and the engine
 * permanently short-shifting, never getting past ~80% of its rev range.
 * That is most of why it sounded like it was labouring rather than revving.
 */
let _topSpeedCache = null;
export function effectiveTopSpeed() {
  if (_topSpeedCache !== null) return _topSpeedCache;
  const T = TUNE;
  // Terminal speed in the TOP gear, where drive balances drag. It has to be
  // derived from the same gear-ratio model the car actually uses — an earlier
  // version modelled the old speed-taper instead, so the two disagreed and
  // the box shifted up into a gear that could not pull.
  const gi = T.gearRatios.length - 1;
  const drive = T.engineAccel * T.gearRatios[gi] * engineTorque(1.0);
  const v = Math.sqrt(Math.max(1, (drive - T.rollResist) / T.dragQuad));
  // never let it fall below where the top gear band begins, or the ratios
  // and the bands would chase each other
  const tops = T.gearTops;
  _topSpeedCache = Math.max(20, v, 1 / Math.max(1e-4, tops[tops.length - 2]) * 0.5);
  return _topSpeedCache;
}

/**
 * Road speed at which a given gear reaches the redline.
 *
 * This is derived from the ratios rather than being a hand-written table:
 * speed in a gear is inversely proportional to its ratio, so the top gear
 * tops out at the car's terminal speed and every other gear scales from
 * there. Writing the bands by hand is how the ratios and the bands drifted
 * apart, leaving 6th engaging at a speed where it sat at idle and could not
 * pull — the car hunted between 5th and 6th forever.
 *
 * @param {number} i zero-based gear index
 * @returns {number} metres per second
 */
export function gearMaxSpeed(i) {
  const T = TUNE;
  const last = T.gearRatios.length - 1;
  const g = clamp(i | 0, 0, last);
  return effectiveTopSpeed() * (T.gearRatios[last] / T.gearRatios[g]);
}

export function gearCount() { return TUNE.gearRatios.length; }

/** Call after changing TUNE so the gearbox rescales. */
export function invalidateTopSpeed() { _topSpeedCache = null; }

/** Normalized revs for audio + gauge. */
export function engineRpm01(s, gearCount = 6) {
  const kmh = Math.abs(s.speed) * 3.6;
  const topKmh = effectiveTopSpeed() * 3.6;
  // fraction of top speed where each gear tops out
  const tops = [0.155, 0.275, 0.415, 0.575, 0.765, 1.0];
  const x = clamp(kmh / topKmh, 0, 1);
  let g = 0;
  while (g < gearCount - 1 && x > tops[g]) g++;
  const lo = g === 0 ? 0 : tops[g - 1];
  const hi = tops[g];
  let t = (x - lo) / Math.max(1e-4, hi - lo);
  t = clamp(t, 0, 1);
  return { rpm01: 0.14 + t * 0.86, gear: g + 1, gearT: t };
}

export { clamp, sign };
