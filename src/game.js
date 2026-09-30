/* ============================================================
   GAME — scoring, drift chains, mini-turbo, collisions,
   lap timing and run lifecycle.
   ============================================================ */

import { CarState, stepCar, TUNE, engineRpm01, fireBoost, clamp } from './physics.js';

export const MODES = [
  {
    id: 'drift',
    name: 'DRIFT ATTACK',
    short: 'DRIFT',
    desc: 'Ninety seconds on the clock. Bank every point you can — long, unbroken drifts are worth far more than lots of little ones.',
    meta: '90 SECONDS',
    time: 90,
    laps: 0,
  },
  {
    id: 'lap',
    name: 'TIME TRIAL',
    short: 'LAP',
    desc: 'Three laps against the clock. Drifting is slower than grip driving — but the mini-turbo off a long slide is how records get set.',
    meta: '3 LAPS',
    time: 0,
    laps: 3,
  },
  {
    id: 'free',
    name: 'FREE DRIFT',
    short: 'FREE',
    desc: 'No clock, no target. Just an empty road, a rear-wheel-drive car, and as much tyre smoke as your graphics card can take.',
    meta: 'NO LIMIT',
    time: 0,
    laps: 0,
  },
];

export const SCORE = {
  base: 24,            // points per (m/s * rad-of-slip * second)
  bigAngleBonus: 0.55, // extra multiplier above `bigSlip`
  tierEvery: 2.0,      // seconds of drift per multiplier step
  maxMultiplier: 10,
  bankGrace: 0.45,     // seconds of grip before the chain banks
  chargeTime: 3.2,     // seconds of drift to fully charge the mini-turbo
  chargeTiers: [0.28, 0.62, 1.0],
  nearMissBonus: 220,
  nearMissCooldown: 1.1,
  nearMissWindow: 2.4,
};

const TIER_COLORS = [
  { name: 'MINI-TURBO', color: '#2fe0ff' },
  { name: 'SUPER-TURBO', color: '#ffcc33' },
  { name: 'MAX-TURBO', color: '#ff2e7e' },
];

export class Game {
  constructor({ track, hud, audio, effects, paint }) {
    this.track = track;
    this.hud = hud;
    this.audio = audio;
    this.effects = effects;
    this.paint = paint;

    this.car = new CarState();
    this.mode = MODES[0];
    this.state = 'idle';     // idle | countdown | running | finished | paused
    this.t = 0;
    this.hint = -1;
    this.onGrass = false;

    this.resetRun();
  }

  setTrack(track) {
    this.track = track;
    this.hint = -1;
    this.effects.setPalette(track.palette);
  }

  resetRun() {
    const p = this.track.startPose;
    this.car.reset(p.x, p.z, p.heading);
    this.hint = -1;

    this.timeLeft = this.mode.time;
    this.elapsed = 0;
    this.total = 0;

    // drift chain
    this.drifting = false;
    this.driftTime = 0;
    this.driftScore = 0;
    this.multiplier = 1;
    this.grace = 0;
    this.charge = 0;
    this.boostTier = -1;

    // laps
    this.lap = 1;
    this.lapTime = 0;
    this.laps = [];
    this.bestLap = null;
    this.progress = 0;
    this.prevS = 0;
    this.maxProgress = 0;
    this.lastLapAt = 0;

    // stats
    this.stats = {
      bestDrift: 0, drifts: 0, longestDrift: 0,
      walls: 0, nearMisses: 0, topSpeed: 0, boosts: 0, clutchKicks: 0,
    };

    this.nearMissCd = 0;
    this.wrongWay = 0;
    this.crashed = false;
    this.countdown = 3.0;
    this.finishFlash = 0;
    this.startX = p.x; this.startZ = p.z; this.startYaw = p.heading;
  }

  start(mode) {
    this.mode = mode;
    this.resetRun();
    this.state = 'countdown';
    this.effects.clear();
    this._lastCount = 4;
  }

  /* ============================================================
     MAIN STEP
     ============================================================ */
  step(dt, input) {
    if (this.state === 'paused' || this.state === 'idle') return;

    if (this.state === 'countdown') {
      const prev = Math.ceil(this.countdown);
      this.countdown -= dt;
      const now = Math.ceil(this.countdown);
      if (now !== prev && now >= 1) this.audio.ui('count');
      if (this.countdown <= 0) {
        this.state = 'running';
        this.audio.ui('go');
        this.hud.pop('GO!', 'pop-lap');
      }
      // Let the driver rev on the line. The car does not move, but the
      // engine runs, so blipping the throttle sounds and feels right.
      stepCar(this.car, {
        steer: 0, throttle: input.throttle, brake: 0,
        handbrake: 0, handbrakeEdge: false, boost: 0,
      }, dt, TUNE.surface.road);
      this.car.x = this.startX; this.car.z = this.startZ; this.car.yaw = this.startYaw;
      this.car.vx = 0; this.car.vz = 0; this.car.speed = 0;
      this.car.boost = 0;
      return;
    }

    if (this.state === 'finished') {
      // let the car roll to a stop
      stepCar(this.car, { steer: 0, throttle: 0, brake: 0.6, handbrake: 0, handbrakeEdge: false, boost: 0 }, dt, TUNE.surface.road);
      return;
    }

    // ---------------------------------------------------------
    // surfaces + collision
    // ---------------------------------------------------------
    const q = this.track.nearest(this.car.x, this.car.z, this.hint);
    this.hint = q.i;
    const absLat = Math.abs(q.lateral);

    const arena = !!this.track.def.arena;
    this.onGrass = !arena && absLat > this.track.halfWidth;
    const surf = this.onGrass ? TUNE.surface.grass : TUNE.surface.road;

    // wall
    if (absLat > this.track.wallDist) {
      this._hitWall(q, absLat);
    }

    // ---------------------------------------------------------
    // physics
    // ---------------------------------------------------------
    stepCar(this.car, {
      steer: input.steer,
      throttle: input.throttle,
      brake: input.brake,
      handbrake: input.handbrake,
      handbrakeEdge: input.handbrakeEdge,
      clutch: input.clutch || 0,
      manual: !!this.manualGearbox,
      boost: input.boost,
    }, dt, surf);

    this._updateGearbox(input);

    if (input.handbrakeEdge && this.car.speed > 6) this.audio.chirp();

    // a burnout is an event worth counting
    if (this.car.wheelspin > 0.75 && this.car.speed < 4 && !this._wasBurning) {
      this._wasBurning = true;
      this.stats.burnouts = (this.stats.burnouts || 0) + 1;
      this.audio.chirp();
    } else if (this.car.wheelspin < 0.4) {
      this._wasBurning = false;
    }

    // a clutch kick is an event — chirp the tyres and kick the camera
    if (this.car.clutchKicked) {
      this.car.clutchKicked = false;
      this.audio.chirp();
      this.onImpact && this.onImpact(0.34);
    }

    // ---------------------------------------------------------
    // timing
    // ---------------------------------------------------------
    this.elapsed += dt;
    this.lapTime += dt;
    this.stats.topSpeed = Math.max(this.stats.topSpeed, this.car.speed);

    if (this.mode.time > 0) {
      this.timeLeft = Math.max(0, this.mode.time - this.elapsed);
      if (this.timeLeft <= 0) this._finish();
    }

    // ---------------------------------------------------------
    // drift chain + mini-turbo
    // ---------------------------------------------------------
    this._updateDrift(dt, input);

    // ---------------------------------------------------------
    // lap progress
    // ---------------------------------------------------------
    this._updateProgress(dt, q);

    // ---------------------------------------------------------
    // near misses
    // ---------------------------------------------------------
    this.nearMissCd = Math.max(0, this.nearMissCd - dt);
    if (!arena && this.car.speed > 14 && this.nearMissCd <= 0
      && absLat > this.track.wallDist - SCORE.nearMissWindow
      && absLat <= this.track.wallDist) {
      this._nearMiss();
    }

    // ---------------------------------------------------------
    // wrong way
    // ---------------------------------------------------------
    const fwdDot = Math.sin(this.car.yaw) * q.tx + Math.cos(this.car.yaw) * q.tz;
    if (!arena && this.car.speed > 4 && fwdDot < -0.25) {
      this.wrongWay += dt;
      if (this.wrongWay > 1.4 && !this._wrongWarned) {
        this._wrongWarned = true;
        this.hud.toast('WRONG WAY', 1.6);
      }
    } else {
      this.wrongWay = 0;
      this._wrongWarned = false;
    }
  }

  /* ============================================================
     DRIFT CHAIN
     ============================================================ */
  _updateDrift(dt, input) {
    const s = this.car;
    const activeSlip = s.absSlip > TUNE.driftSlip && s.speed > 7;

    // manual mini-turbo release
    if (input.boost > 0.5 && this.charge >= SCORE.chargeTiers[0] && !this._boostHeld) {
      this._fireTurbo();
      this._boostHeld = true;
    }
    if (input.boost < 0.5) this._boostHeld = false;

    if (activeSlip) {
      this.grace = 0;
      if (!this.drifting) {
        this.drifting = true;
        this.driftTime = 0;
        this.driftScore = 0;
        this.multiplier = 1;
        this._tierShown = 0;
      }

      this.driftTime += dt;

      // ---- points
      const slipFactor = s.absSlip + Math.max(0, s.absSlip - TUNE.bigSlip) * SCORE.bigAngleBonus;
      const gain = s.speed * slipFactor * SCORE.base * this.multiplier * dt;
      this.driftScore += gain;

      // ---- multiplier tiers
      const newMult = Math.min(
        SCORE.maxMultiplier,
        1 + Math.floor(this.driftTime / SCORE.tierEvery)
      );
      if (newMult > this.multiplier) {
        this.multiplier = newMult;
        if (newMult >= 2) {
          this.audio.tierUp(newMult - 2);
          this.hud.pop('x' + newMult, 'pop-tier', this.hud.tierName(newMult));
        }
      }

      // ---- charge
      const prevCharge = this.charge;
      this.charge = Math.min(1, this.charge + dt / SCORE.chargeTime);
      const crossed = SCORE.chargeTiers.findIndex((t, i) => prevCharge < t && this.charge >= t);
      if (crossed >= 0) {
        this.audio.ui('count');
        this.hud.pop(TIER_COLORS[crossed].name + ' READY', 'pop-boost');
      }

      // ---- score ticks
      this._tickAcc = (this._tickAcc || 0) + dt;
      if (this._tickAcc > 0.1) {
        this._tickAcc = 0;
        this.audio.tick(this.multiplier);
      }
    } else {
      if (this.drifting) {
        this.grace += dt;
        if (this.grace > SCORE.bankGrace) this._bank();
      }
    }

    // ---- chain broken by a crash
    if (this.crashed) {
      this.crashed = false;
      if (this.drifting && this.driftScore > 200) {
        this.hud.pop('CHAIN LOST', 'pop-warn', `-${Math.round(this.driftScore).toLocaleString()}`);
        this.audio.chainLost();
      }
      this.drifting = false;
      this.driftScore = 0;
      this.multiplier = 1;
      this.driftTime = 0;
      this.charge = 0;
    }
  }

  _bank() {
    const banked = Math.round(this.driftScore);
    this.drifting = false;
    this.stats.drifts++;

    if (banked > 0) {
      this.total += banked;
      this.stats.bestDrift = Math.max(this.stats.bestDrift, banked);
      this.stats.longestDrift = Math.max(this.stats.longestDrift, this.driftTime);
      this.hud.pop('+' + banked.toLocaleString(), 'pop-bank',
        `x${this.multiplier}  ·  ${this.driftTime.toFixed(1)}s`);
      this.hud.bankFlash();
      this.audio.bank(banked);

      // floating number over the car
      this._pendingFloat = { text: '+' + banked.toLocaleString(), t: 0.9 };
    }

    // auto mini-turbo on exit
    if (this.charge >= SCORE.chargeTiers[0]) this._fireTurbo();

    this.driftTime = 0;
    this.driftScore = 0;
    this.multiplier = 1;
  }

  _fireTurbo() {
    let tier = -1;
    for (let i = SCORE.chargeTiers.length - 1; i >= 0; i--) {
      if (this.charge >= SCORE.chargeTiers[i]) { tier = i; break; }
    }
    if (tier < 0) return;
    fireBoost(this.car, tier);
    this.boostTier = tier;
    this.stats.boosts++;
    this.audio.boostFire(tier);
    this.hud.pop(TIER_COLORS[tier].name, 'pop-boost');
    this.effects.boostBlast(this.car.x, 0.7, this.car.z, this.car.yaw, tier);
    this.charge = 0;
    this.boostTier = tier;
  }

  _nearMiss() {
    this.nearMissCd = SCORE.nearMissCooldown;
    this.stats.nearMisses++;
    const bonus = Math.round(SCORE.nearMissBonus * this.multiplier);
    if (this.drifting) this.driftScore += bonus;
    else this.total += bonus;
    this.audio.nearMiss();
    this.hud.pop('NEAR MISS +' + bonus, 'pop-near');
  }

  /* ============================================================
     GEARBOX
     ============================================================ */
  _updateGearbox(input) {
    const s = this.car;
    s.manual = !!this.manualGearbox;

    if (!s.manual) { s.playerGear = s.gear; return; }
    if (s.shiftBlocked > 0) return;

    const maxGear = TUNE.gearRatios.length;
    const prev = s.gear;

    // An H-pattern shifter names a gear directly; paddles step by one.
    const req = input.gearRequest | 0;
    if (req === 7) {
      s.playerGear = 0;                      // H-pattern reverse gate
    } else if (req > 0 && req <= maxGear) {
      s.playerGear = req;
    } else {
      if (input.shiftUp) s.playerGear = Math.min(maxGear, s.playerGear + 1);
      // shifting down past 1st selects reverse
      if (input.shiftDown) s.playerGear = Math.max(0, s.playerGear - 1);
    }

    if (s.playerGear === prev) return;

    // Changing gear takes a moment, and doing it without the clutch costs
    // drive and shocks the drivetrain.
    const clutched = (input.clutch || 0) > TUNE.clutchEngageLo;
    s.shiftTimer = clutched ? TUNE.shiftCutTime : TUNE.manualShiftCutTime;
    s.shiftUp = s.playerGear > prev;
    s.shiftBlocked = 0.10;
    this.audio.shift(s.shiftUp);
    this.onImpact && this.onImpact(clutched ? 0.10 : 0.24);
    if (clutched) this.stats.cleanShifts = (this.stats.cleanShifts || 0) + 1;
    else this.stats.harshShifts = (this.stats.harshShifts || 0) + 1;
  }

  /* ============================================================
     WALL
     ============================================================ */
  _hitWall(q, absLat) {
    const s = this.car;
    const side = Math.sign(q.lateral) || 1;
    const nx = -side * q.nx, nz = -side * q.nz;   // inward normal
    const push = absLat - this.track.wallDist;
    s.x += nx * push;
    s.z += nz * push;

    const vn = s.vx * nx + s.vz * nz;
    if (vn < 0) {
      const strength = clamp(-vn / 18, 0, 1.4);
      // kill the into-wall component with a little bounce
      s.vx -= nx * vn * 1.45;
      s.vz -= nz * vn * 1.45;
      // scrub speed along the wall
      const scrub = 1 - clamp(strength * 0.55, 0, 0.62);
      s.vx *= scrub; s.vz *= scrub;
      // yaw jolt: the struck corner is pushed away from the wall, so the
      // car pivots *away* from it and gets spat back onto the road
      const tang = (s.vx * q.tx + s.vz * q.tz) >= 0 ? 1 : -1;
      s.yawRate -= side * tang * strength * 2.2;

      if (strength > 0.18) {
        this.stats.walls++;
        this.crashed = true;
        this.audio.impact(strength);
        this.effects.burst(s.x + side * -nx * -1, 0.6, s.z, strength, -nx, -nz);
        this.onImpact && this.onImpact(strength);
      } else {
        if (Math.random() < 0.35) this.audio.scrape();
      }
    }
  }

  resetCar() {
    const q = this.track.nearest(this.car.x, this.car.z, this.hint);
    const p = this.track.posAt(q.s + 4, 0);
    this.car.x = p.x;
    this.car.z = p.z;
    this.car.yaw = p.heading;
    this.car.vx = 0; this.car.vz = 0;
    this.car.yawRate = 0; this.car.steer = 0;
    this.car.boost = 0;
    this.hint = -1;
    this.drifting = false;
    this.driftScore = 0;
    this.multiplier = 1;
    this.charge = 0;
    this.hud.toast('RESET', 1.0);
  }

  /* ============================================================
     LAPS
     ============================================================ */
  _updateProgress(dt, q) {
    const L = this.track.length;
    const d = ((q.s - this.prevS) + L) % L;
    if (d < L * 0.5) this.progress += d;
    this.prevS = q.s;

    if (this.mode.laps > 0) {
      const lapProgress = this.progress - (this.lap - 1) * L;
      if (lapProgress >= L) {
        this._completeLap();
      }
    }
  }

  _completeLap() {
    const t = this.lapTime;
    this.laps.push(t);
    const isBest = this.bestLap === null || t < this.bestLap;
    if (isBest) this.bestLap = t;

    this.audio.lap(isBest);
    this.hud.pop(isBest ? 'BEST LAP' : 'LAP ' + this.lap, 'pop-lap', fmtTime(t));

    this.lap++;
    this.lapTime = 0;

    if (this.lap > this.mode.laps) this._finish();
  }

  /* ============================================================
     RUN END
     ============================================================ */
  _finish() {
    if (this.state === 'finished') return;
    this.state = 'finished';
    this.finishFlash = 1.4;
    // bank whatever is in flight
    if (this.drifting && this.driftScore > 0) {
      this.total += Math.round(this.driftScore);
      this.stats.bestDrift = Math.max(this.stats.bestDrift, Math.round(this.driftScore));
      this.drifting = false;
      this.driftScore = 0;
    }
    this.audio.ui('record');
    this.onFinish && this.onFinish(this.results());
  }

  results() {
    return {
      mode: this.mode,
      track: this.track.def,
      total: Math.round(this.total),
      bestDrift: Math.round(this.stats.bestDrift),
      drifts: this.stats.drifts,
      longestDrift: this.stats.longestDrift,
      walls: this.stats.walls,
      nearMisses: this.stats.nearMisses,
      boosts: this.stats.boosts,
      topSpeed: this.stats.topSpeed,
      laps: this.laps.slice(),
      bestLap: this.bestLap,
      elapsed: this.elapsed,
    };
  }

  /* ============================================================
     HUD FEED
     ============================================================ */
  hudData(dt) {
    const s = this.car;
    const rpm = { rpm01: s.rpm01, gear: s.gear, gearT: s.gearT };
    const chain01 = this.drifting
      ? clamp((this.driftTime % SCORE.tierEvery) / SCORE.tierEvery, 0, 1)
      : 0;

    return {
      speed: s.speed,
      rpm01: rpm.rpm01,
      gear: rpm.gear,
      limiter: !!s.limiter,
      reversing: !!s.reversing,
      wheelspin: s.wheelspin || 0,
      drifting: this.drifting,
      multiplier: this.multiplier,
      driftScore: this.driftScore,
      chain01,
      charge01: this.charge,
      chargeReady: this.charge >= SCORE.chargeTiers[0],
      chargeMax: this.charge >= SCORE.chargeTiers[2],
      total: Math.round(this.total),
      boost: s.boost,
      boostTier: this.boostTier,
    };
  }
}

export function fmtTime(seconds) {
  if (seconds === null || seconds === undefined) return '--:--.--';
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}

export { TIER_COLORS };
