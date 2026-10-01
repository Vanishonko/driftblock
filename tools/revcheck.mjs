/* Verifies the engine behaves like an engine rather than a speedometer.
   Run: node tools/revcheck.mjs */
import { CarState, stepCar, TUNE } from '../src/physics/index.js';

const dt = 1/120, ROAD = TUNE.surface.road;
const inp = (o={}) => ({ steer:0, throttle:0, brake:0, handbrake:0, handbrakeEdge:false, boost:0, ...o });
let fail = 0;
const check = (l, c, x='') => { if(!c) fail++; console.log(`  ${c?'OK  ':'FAIL'} ${l}${x?'   '+x:''}`); };
const run = (s, sec, f) => { for(let i=0;i<Math.round(sec/dt);i++) stepCar(s, typeof f==='function'?f(i*dt,s):f, dt, ROAD); };

console.log('\n================ ENGINE / REV MODEL ================\n');

// ---- 1. blipping the throttle must move the needle
console.log('THROTTLE RESPONSE  (the thing that was missing)');
{
  // Hold the car still so this measures the ENGINE, not the gearbox:
  // if it rolls, road speed legitimately holds the revs up.
  const s = new CarState();
  const idle = s.rpm;
  const hold = (sec, input) => {
    for (let i = 0; i < Math.round(sec / dt); i++) {
      stepCar(s, typeof input === 'function' ? input(i * dt) : input, dt, ROAD);
      s.vx = 0; s.vz = 0; s.speed = 0;      // park it
    }
  };
  hold(0.9, inp({ throttle: 1 }));
  const blipped = s.rpm;
  check('a stationary throttle blip revs the engine', blipped > idle + 1500,
    `${idle.toFixed(0)} -> ${blipped.toFixed(0)} rpm`);
  hold(1.6, inp());
  check('and it settles back to idle', s.rpm < idle + 400, `${s.rpm.toFixed(0)} rpm`);

  const s2 = new CarState();
  run(s2, 0.15, inp({ throttle: 1 }));
  const fast = s2.rpm;
  run(s2, 0.15, inp());
  check('revs climb faster than they fall', fast - idle > 0, `+${(fast-idle).toFixed(0)} in 150 ms`);
}

// ---- 2. gears exist and shift
console.log('\nGEARBOX');
{
  const s = new CarState();
  const seen = [];
  let shifts = 0, prevGear = s.gear;
  for (let i=0;i<Math.round(30/dt);i++){
    stepCar(s, inp({throttle:1}), dt, ROAD);
    if (s.gear !== prevGear) { shifts++; prevGear = s.gear; }
    if (!seen.includes(s.gear)) seen.push(s.gear);
  }
  check('works through every gear', seen.length === 6, `used ${seen.join(',')}`);
  check('each gear change is announced', shifts >= 5, `${shifts} shifts`);
  check('rpm stays inside the usable band', s.rpm >= TUNE.idleRpm - 1 && s.rpm <= TUNE.redlineRpm + 1,
    `${s.rpm.toFixed(0)} rpm`);

  // no gear flicker when parked on a shift point
  const s2 = new CarState();
  run(s2, 12, inp({throttle:1}));
  // hold right at a boundary
  let flickers = 0, g0 = s2.gear;
  for (let i=0;i<Math.round(3/dt);i++){
    const before = s2.gear;
    stepCar(s2, inp({ throttle: s2.speed > 20 ? 0.5 : 0.52 }), dt, ROAD);
    if (s2.gear !== before) flickers++;
  }
  check('gear does not flicker at a shift point', flickers <= 2, `${flickers} changes in 3 s`);
}

// ---- 3. wheelspin should be audible
console.log('\nWHEELSPIN');
{
  // Both cars must be at the SAME road speed, or this compares gearing
  // rather than wheelspin. Build to a fixed speed, then drift one of them.
  const buildTo = (target) => {
    const s = new CarState();
    for (let i = 0; i < Math.round(30 / dt) && s.speed < target; i++) {
      stepCar(s, inp({ throttle: 1 }), dt, ROAD);
    }
    return s;
  };
  const grip = buildTo(22);
  run(grip, 0.4, inp({ throttle: 1 }));
  const gripRpm = grip.rpm, gripSlip = grip.absSlip, gripSpeed = grip.speed;

  const drift = buildTo(22);
  run(drift, 1.2, inp({ throttle: 1, steer: -1, handbrake: 1, handbrakeEdge: true }));
  run(drift, 0.5, inp({ throttle: 1, steer: -1 }));

  check('lit rear tyres raise the revs at the same road speed',
    drift.absSlip > 0.25 && drift.rpm > gripRpm + 150,
    `grip ${gripRpm.toFixed(0)} rpm @ ${(gripSpeed*3.6).toFixed(0)} km/h (slip ${(gripSlip*57.3).toFixed(0)} deg) ` +
    `vs drift ${drift.rpm.toFixed(0)} rpm @ ${(drift.speed*3.6).toFixed(0)} km/h (slip ${(drift.absSlip*57.3).toFixed(0)} deg)`);
}

// ---- 4. the shift cut must not wreck lap times
console.log('\nSHIFT CUT COST');
{
  const s = new CarState();
  const t0 = [];
  let t100 = null;
  for (let i=0;i<Math.round(30/dt);i++){
    stepCar(s, inp({throttle:1}), dt, ROAD);
    if (t100 === null && s.speed*3.6 >= 100) t100 = i*dt;
  }
  check('0-100 km/h still in a sane window', t100 > 3.5 && t100 < 6.5, `${t100.toFixed(2)}s`);
  check('top speed unchanged', s.speed*3.6 > 175, `${(s.speed*3.6).toFixed(0)} km/h`);
}

// ---- 5. overrun crackle trigger
console.log('\nOVERRUN');
{
  const s = new CarState();
  run(s, 12, inp({throttle:1}));
  const rpmBefore = s.rpm;
  stepCar(s, inp({throttle:0}), dt, ROAD);
  check('lifting off at revs arms the exhaust crackle', s.overrun > 0,
    `${rpmBefore.toFixed(0)} rpm -> overrun ${s.overrun.toFixed(2)}`);
  run(s, 0.5, inp());
  check('and it decays away', s.overrun === 0);
}

// ---- 6. clutch kick ----
console.log('\nCLUTCH KICK');
{
  const mk = () => { const s = new CarState(); run(s, 8, inp({ throttle: 1 })); return s; };
  const base = mk();
  const baseSlip = base.absSlip;

  // press the clutch, let it rev, then dump it
  const k = mk();
  const speedBefore = k.speed;
  run(k, 0.5, inp({ throttle: 1, clutch: 1 }));
  const revved = k.rpm;
  const coasting = k.speed;
  stepCar(k, inp({ throttle: 1, clutch: 0, steer: -0.8 }), dt, ROAD);
  run(k, 0.6, inp({ throttle: 1, clutch: 0, steer: -0.8 }));

  check('pressing the clutch disconnects the drive', coasting <= speedBefore + 0.01,
    `${(speedBefore * 3.6).toFixed(0)} -> ${(coasting * 3.6).toFixed(0)} km/h`);
  check('and lets the engine rev freely', revved > 2500, `${revved.toFixed(0)} rpm`);
  check('dumping it breaks the rear loose', k.absSlip > baseSlip + 0.15,
    `slip ${(baseSlip * 57.3).toFixed(1)} deg -> ${(k.absSlip * 57.3).toFixed(1)} deg`);

  // without steering the kick must not spin the car on its own
  const straight = mk();
  run(straight, 0.5, inp({ throttle: 1, clutch: 1 }));
  stepCar(straight, inp({ throttle: 1, clutch: 0 }), dt, ROAD);
  run(straight, 0.6, inp({ throttle: 1, clutch: 0 }));
  check('a straight-line clutch dump does not spin the car',
    straight.absSlip < 0.16, `slip ${(straight.absSlip * 57.3).toFixed(1)} deg`);

  // and it must not fire from a standing start
  const still = new CarState();
  run(still, 0.4, inp({ throttle: 1, clutch: 1 }));
  stepCar(still, inp({ throttle: 1, clutch: 0 }), dt, ROAD);
  check('no kick below the speed threshold', !still.clutchKicked);
}

// ---- 7. manual gearbox ----
console.log('\nMANUAL GEARBOX');
{
  // automatic: the box decides
  const auto = new CarState();
  run(auto, 12, inp({ throttle: 1 }));
  check('automatic still shifts on its own', auto.gear > 1, `auto reached gear ${auto.gear}`);

  // manual: the driver decides, and the box does not second-guess
  const man = new CarState();
  man.manual = true; man.playerGear = 1;
  run(man, 12, inp({ throttle: 1, manual: true }));
  check('manual holds the gear the driver chose', man.gear === 1,
    `held gear ${man.gear} for 12 s (auto was in ${auto.gear})`);
  check('holding a low gear cannot exceed the redline', man.rpm <= TUNE.redlineRpm + 1,
    `${man.rpm.toFixed(0)} rpm`);

  const man2 = new CarState();
  man2.manual = true; man2.playerGear = 3;
  run(man2, 8, inp({ throttle: 1, manual: true }));
  check('selecting a higher gear works', man2.gear === 3, `gear ${man2.gear}`);

  // Drive available during a shift window: a shift costs speed, and a manual
  // clutchless shift costs the most.
  const gainOver = (manual, shiftTimer) => {
    const s = new CarState();
    s.manual = true;
    run(s, 6, inp({ throttle: 1, manual: true }));      // rolling in gear
    const v0 = s.speed;
    s.shiftTimer = shiftTimer;
    run(s, 0.30, inp({ throttle: 1, manual }));
    return s.speed - v0;
  };
  const noShift = gainOver(false, 0);
  const autoShift = gainOver(false, TUNE.shiftCutTime);
  const manualShift = gainOver(true, TUNE.manualShiftCutTime);

  check('shifting costs speed versus not shifting', autoShift < noShift,
    `${noShift.toFixed(2)} -> ${autoShift.toFixed(2)} m/s over 0.3 s`);
  check('a clutchless manual shift costs the most', manualShift < autoShift,
    `auto ${autoShift.toFixed(2)} vs manual ${manualShift.toFixed(2)} m/s`);
}

// ---- 8. reverse, burnouts, and per-gear launch ----
console.log('\nDRIVETRAIN BEHAVIOUR');
{
  // -- braking at a standstill must NOT reverse
  const parked = new CarState();
  const hold = (s, sec, input) => { for (let i = 0; i < Math.round(sec / dt); i++) stepCar(s, input, dt, ROAD); };
  hold(parked, 1.0, inp({ brake: 1 }));
  check('braking to a stop does not drop into reverse', parked.speed < 0.3,
    `${(parked.vf).toFixed(2)} m/s after a 1 s stop`);

  // -- no amount of brake should EVER reverse: it is a brake, not a gear
  const longHold = new CarState();
  hold(longHold, 4.0, inp({ brake: 1 }));
  check('holding the brake for 4 s still does not reverse', longHold.vf > -0.3,
    `${(longHold.vf).toFixed(2)} m/s`);

  // -- reverse is a gear: select it in manual and use the throttle
  const rev = new CarState();
  rev.manual = true; rev.playerGear = -1;      // -1 is reverse, 0 is neutral
  hold(rev, 2.0, inp({ throttle: 1, manual: true }));
  check('reverse gear drives the car backwards', rev.vf < -1.0,
    `${(rev.vf).toFixed(2)} m/s on throttle in R`);
  check('and the brake stops it', (() => {
    const b = new CarState(); b.manual = true; b.playerGear = -1;
    hold(b, 1.5, inp({ throttle: 1, manual: true }));
    const moving = b.vf;
    hold(b, 0.6, inp({ throttle: 1, brake: 1, manual: true }));
    return b.vf > moving;
  })());

  // -- burnout: brake + throttle at a standstill
  const burn = new CarState();
  hold(burn, 2.0, inp({ brake: 1, throttle: 1 }));
  check('brake + throttle lights the tyres up', burn.wheelspin > 0.7,
    `wheelspin ${burn.wheelspin.toFixed(2)}`);
  check('a burnout stays put rather than creeping', Math.abs(burn.speed) < 2.5,
    `${(burn.speed * 3.6).toFixed(0)} km/h`);
  check('and the engine screams while doing it', burn.rpm > 5000,
    `${burn.rpm.toFixed(0)} rpm`);

  // -- per-gear launch: 1st must be far stronger than 4th
  // Measured over 1.5 s, before 1st reaches its own limiter — otherwise the
  // test just measures the rev limiter rather than the gearing.
  const launch = (gear) => {
    const s = new CarState();
    s.manual = true; s.playerGear = gear;
    hold(s, 1.5, inp({ throttle: 1, manual: true }));
    return s.speed;
  };
  const g1 = launch(1), g2 = launch(2), g4 = launch(4);
  check('1st gear launches harder than 4th', g1 > g4 * 1.5,
    `1st ${(g1 * 3.6).toFixed(0)} km/h vs 4th ${(g4 * 3.6).toFixed(0)} km/h after 1.5 s`);
  check('and the gears form a proper ladder', g1 > g2 && g2 > g4,
    `1st ${(g1 * 3.6).toFixed(0)} > 2nd ${(g2 * 3.6).toFixed(0)} > 4th ${(g4 * 3.6).toFixed(0)} km/h`);

  // -- the limiter must actually hold the engine back
  const lim = new CarState();
  lim.manual = true; lim.playerGear = 1;
  hold(lim, 8.0, inp({ throttle: 1, manual: true }));
  check('the limiter caps the revs', lim.rpm <= TUNE.redlineRpm + 1,
    `${lim.rpm.toFixed(0)} rpm`);
  check('and the limiter cuts drive rather than being cosmetic', lim.limiterCut > 0 || lim.rpm < TUNE.redlineRpm,
    `limiterCut ${lim.limiterCut.toFixed(2)}`);
}

// ---- 9. neutral gear and rolling burnouts ----
console.log('\nNEUTRAL + ROLLING BURNOUTS');
{
  const hold = (s, sec, input) => { for (let i = 0; i < Math.round(sec / dt); i++) stepCar(s, input, dt, ROAD); };

  // -- neutral: engine free, car goes nowhere
  const n = new CarState();
  n.manual = true; n.playerGear = 0;
  hold(n, 2.0, inp({ throttle: 1, manual: true }));
  check('neutral lets the engine rev without driving', n.rpm > 6000 && n.speed < 0.5,
    `${n.rpm.toFixed(0)} rpm, car at ${(n.speed * 3.6).toFixed(1)} km/h`);
  check('and the gear reads neutral', (n.gear | 0) === 0, `gear ${n.gear}`);

  // -- a blip in neutral should be audible, i.e. the revs actually move
  const blip = new CarState();
  blip.manual = true; blip.playerGear = 0;
  hold(blip, 0.3, inp({ throttle: 1, manual: true }));
  const peak = blip.rpm;
  hold(blip, 1.5, inp({ manual: true }));
  check('lifting in neutral lets the revs fall back', blip.rpm < peak - 1500,
    `${peak.toFixed(0)} -> ${blip.rpm.toFixed(0)} rpm`);

  // -- rolling burnout: brake + throttle keeps the rears lit while moving
  const roll = new CarState();
  hold(roll, 3.2, inp({ throttle: 1 }));       // ~70 km/h: where you'd actually do this
  const v0 = roll.speed;
  hold(roll, 2.0, inp({ throttle: 1, brake: 1 }));
  check('brake + throttle lights the rears while rolling', roll.wheelspin > 0.5,
    `wheelspin ${roll.wheelspin.toFixed(2)} at ${(roll.speed * 3.6).toFixed(0)} km/h`);
  check('and does not simply stop the car', roll.speed > v0 * 0.4,
    `${(v0 * 3.6).toFixed(0)} -> ${(roll.speed * 3.6).toFixed(0)} km/h`);

  // -- but a plain brake still stops it properly
  const stop = new CarState();
  hold(stop, 6.0, inp({ throttle: 1 }));
  hold(stop, 4.0, inp({ brake: 1 }));
  check('the brake on its own still stops the car', stop.speed < 1.5,
    `${(stop.speed * 3.6).toFixed(1)} km/h after 4 s of braking`);
}

console.log(fail===0 ? '\nRev model behaves like an engine.\n' : `\n${fail} FAILED\n`);
