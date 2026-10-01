/* ============================================================
   DRIVETRAIN — gearbox, revs, clutch and traction.

   Everything about how much force reaches the road: gear selection,
   the rev model, the clutch, and the traction limit that decides when
   the tyres spin instead of gripping.
   ============================================================ */
import { TUNE } from './tune.js';
import { clamp } from './math.js';

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
