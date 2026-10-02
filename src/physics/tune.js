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

  // ---- launch. Dropping the clutch at a standstill leaves the tyres
  // spinning against very little load: the car creeps and the engine screams
  // before it hooks up and goes.
  //
  // DELIBERATELY LONGITUDINAL ONLY. An earlier attempt at this coupled the
  // drive and the cornering grip through a shared friction budget, and it
  // inverted the whole drift envelope — full throttle understeered where it
  // used to drift, while half throttle span. The lateral model here is tuned
  // and stays exactly as it is; this only ever scales the drive.
  launchTime: 1.5,          // seconds for the launch state to bleed off
  launchHookupSpeed: 15,    // m/s at which the tyres have fully hooked up
  launchDriveCut: 0.80,     // fraction of drive lost at a standstill
  launchSpin: 0.95,         // wheelspin a standing-start dump produces
  launchMaxSpeed: 8,        // above this a dump is the at-speed kick instead
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

  // ---- tyre model (see tyre.js)
  // A bicycle model with real slip-based contact patches. Kept in its own
  // block because these numbers are physical — metres, kilograms, newtons —
  // where everything above is arcade tuning in game units.
  tyre: {
    // G29-adjacent hatchback, roughly: 1180 kg, 2.45 m wheelbase, front
    // engine so the CG sits forward of centre, and a low-ish CG because it
    // is a game and a tall one makes the transfer model silly.
    mass: 1180,
    a: 1.18,               // CG to front axle (m)
    b: 1.27,               // CG to rear axle (m)
    cgHeight: 0.52,        // m
    // Yaw inertia, measured rather than modelled as a uniform box. A box of
    // this wheelbase gives a radius of gyration of L/sqrt(12) = 0.71 m, about
    // half a real car's ~1.30 m, and therefore less than a third of the real
    // inertia. That is not a small error: it makes the car rotate three times
    // as fast for the same yaw moment, and the first run of this model spun
    // at every single steering input because of it.
    Iz: 1900,              // kg m^2
    maxSteer: 0.62,        // road wheel angle at full lock (rad, ~35 deg)

    mu: 1.05,              // peak friction on warm tarmac
    loadSensitivity: 0.22, // mu lost per unit of relative axle load

    // Pacejka-lite shape factors. Lateral wants a lower shape factor than
    // longitudinal: a tyre makes its best side force at a much larger slip
    // angle than its best drive.
    // Solved for rather than guessed. The peak slip angle is set by B, C and
    // E together and is not obvious from any one of them: the first set tried
    // here put the lateral peak at 30 degrees, which would have made the car
    // feel like it was on ice. These give a lateral peak at 7 degrees with a
    // gentle falloff to 96% by 20, and a longitudinal peak at 12% slip
    // falling to 87% by 40% — both close to a real tyre's shape.
    // B sets the cornering stiffness AND, with C and E, where the peak sits.
    // Those are coupled, and getting it wrong is not a matter of taste: the
    // first set here had a stiffness of 253,000 N/rad against a realistic
    // 50-90,000, which put the yaw mode at 400/s. Explicit Euler at 120 Hz
    // is unstable above 240/s, so the integrator diverged and the car span at
    // every input — the model looked loose when it was actually blowing up.
    //
    // Solved together instead: a realistic 70,000 N/rad AND a peak at 7.5
    // degrees, which needs a negative E. Pacejka allows that and it is what
    // decouples the two. The yaw mode is now 111/s, comfortably stable.
    latB: 8.70, latC: 1.30, latE: -5.19,
    lonB: 104.7, lonC: 1.62, lonE: 1.00,

    brakeSlip: 0.16,       // slip ratio a full brake application asks for
    driveSlip: 0.55,       // and how hard the throttle asks
    handbrakeGrip: 0.34,   // rear grip left with the handbrake up

    drag: 0.42,            // N per (m/s)^2
    roll: 12.0,            // N per (m/s)

    maxDrive: 7600,        // N at the wheels in the lower gears
    steerRate: 2.4,        // rad/s the rack can move: a step input is not instant
  },

  // ---- weight transfer.
  // Braking loads the front and unloads the rear; throttle does the reverse.
  // This is the one piece of a contact model worth having here, and it is a
  // MODIFIER on the existing lumped grip rather than a rewrite of it. The
  // model stays single-body — no per-tyre forces and no contact patch — but
  // the balance now shifts the way a real car's does, which is what makes
  // trail-braking rotate the car into a corner and power-on settle it out.
  transferLong: 0.10,    // grip lost per unit of braking load
  transferLat: 0.06,     // and per unit of cornering load

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
