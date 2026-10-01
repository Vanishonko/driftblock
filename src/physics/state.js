/* ============================================================
   CAR STATE — the numbers that describe one car at one instant.
   ============================================================ */
import { TUNE } from './tune.js';
import { clamp } from './math.js';

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
