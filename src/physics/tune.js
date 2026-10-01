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

  // ---- tyres. See physics/tyres.js: one friction circle decides how the
  // available grip is shared between going and turning. Everything that used
  // to be a separate grip rule — throttle, handbrake, clutch kick — falls out
  // of these numbers instead.
  muLong: 9.2,           // m/s^2 of longitudinal grip on tarmac
  muLat: 30,             // m/s^2 of cornering grip
  tyrePeakSlip: 0.20,    // rad (~11 deg) where cornering force peaks
  tyreFalloff: 0.50,     // how fast cornering force dies past the peak
  tyreMinStiffness: 0.40,// it never reaches zero, or a slide could not be caught
  tyreOverloadSpan: 1.2, // how far past the limit counts as fully overloaded
  lockLatLoss: 0.85,     // lateral budget a fully locked rear gives up
  tyreSlipSpan: 0.55,    // how far past the limit reads as fully spinning
  tyreSlidePeakShift: 0.60, // how far the grip peak drops once sliding
  tyreRegripRate: 0.40,  // how fast a slide re-plants once you stop asking
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

  // ---- cornering
  // The base slip-decay rate: how fast the tyres pull the velocity vector
  // back in line with the car, before the friction circle scales it down.
  gripBase: 8.2,
  // How strongly a lit rear tyre keeps the car rotating into the slide. Fed
  // by the friction circle's overload, so it only applies when the tyres are
  // genuinely out of grip.
  driftSustain: 0.58,
  scrub: 3.5,             // m/s^2 lost at 90 deg of slip (scaled by speed)

  // ---- drivetrain
  yawRampSpeed: 7.0,      // speed at which steering reaches full authority

  // ---- handbrake
  handbrakeDecel: 5.2,

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
    wet: { grip: 0.62, roll: 0.9, power: 0.97, dragAccel: 0.0 },
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
  // A dumped clutch is an event, not a special grip rule: it lands a slug of
  // torque through the drivetrain, and the friction circle turns that into
  // wheelspin and lost cornering grip by itself. Nothing is injected.
  clutchKickMinRpm: 0.30,

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
