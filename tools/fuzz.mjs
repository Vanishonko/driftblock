/* Fuzz the full Game loop headlessly to catch NaNs / blow-ups.
   Run:  node tools/fuzz.mjs [seconds] [seed]                       */

import { TRACK_DEFS, Track } from '../src/render/track.js';
import { Game, MODES } from '../src/game.js';
import { CarState, stepCar, TUNE } from '../src/physics/index.js';

const stub = () => new Proxy({}, { get: () => () => {} });
const hud = { pop: () => {}, tierName: () => '', bankFlash: () => {}, float: () => {}, toast: () => {}, setMode: () => {}, setLap: () => {}, setTimer: () => {}, show: () => {}, update: () => {} };
const audio = { ui: () => {}, chirp: () => {}, tick: () => {}, tierUp: () => {}, bank: () => {}, chainLost: () => {}, boostFire: () => {}, nearMiss: () => {}, lap: () => {}, impact: () => {}, scrape: () => {} };

const FIXED = 1 / 120;
const SECONDS = Number(process.argv[2]) || 400;
const SEEDS = (process.argv[3] || '12345').split(',').map(Number);

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let failures = 0;

for (const SEED of SEEDS)
for (const def of TRACK_DEFS) {
  const rnd = mulberry32(SEED);
  const track = new Track(def);
  const effects = { setPalette: () => {}, clear: () => {}, boostBlast: () => {}, burst: () => {} };
  const game = new Game({ track, hud, audio, effects, paint: { body: 0 } });

  for (const mode of MODES) {
    game.start(mode);

    // random-but-plausible driver: holds throttle, steers in bursts,
    // yanks the handbrake, occasionally slams into things
    let steer = 0, throttle = 1, brake = 0, handbrake = 0, hbEdge = false;
    let changeIn = 0;

    const steps = Math.round(SECONDS / FIXED);
    for (let i = 0; i < steps; i++) {
      if (changeIn <= 0) {
        changeIn = Math.round((0.15 + rnd() * 1.6) / FIXED);
        const r = rnd();
        steer = rnd() < 0.18 ? 0 : (rnd() * 2 - 1);
        throttle = rnd() < 0.12 ? 0 : 1;
        brake = rnd() < 0.06 ? 1 : 0;
        const wantHb = rnd() < 0.22 ? 1 : 0;
        hbEdge = wantHb === 1 && handbrake === 0;
        handbrake = wantHb;
      }
      changeIn--;

      const input = { steer, throttle, brake, handbrake, handbrakeEdge: hbEdge, boost: 0 };
      hbEdge = false;

      try {
        game.step(FIXED, input);
      } catch (e) {
        console.log(`THROW  ${def.name} / ${mode.id} @ ${(i * FIXED).toFixed(2)}s: ${e.message}`);
        failures++;
        break;
      }

      const s = game.car;
      const bad = [];
      if (!Number.isFinite(s.x)) bad.push('x');
      if (!Number.isFinite(s.z)) bad.push('z');
      if (!Number.isFinite(s.vx)) bad.push('vx');
      if (!Number.isFinite(s.vz)) bad.push('vz');
      if (!Number.isFinite(s.yaw)) bad.push('yaw');
      if (!Number.isFinite(s.yawRate)) bad.push('yawRate');
      if (!Number.isFinite(s.steer)) bad.push('steer');
      if (!Number.isFinite(s.boost)) bad.push('boost');
      if (!Number.isFinite(s.boostPower)) bad.push('boostPower');
      if (!Number.isFinite(s.wheelSpin)) bad.push('wheelSpin');
      if (!Number.isFinite(game.total)) bad.push('game.total');
      if (!Number.isFinite(game.charge)) bad.push('game.charge');
      if (!Number.isFinite(game.driftScore)) bad.push('game.driftScore');
      if (!Number.isFinite(game.multiplier)) bad.push('game.multiplier');

      // positional sanity: the car must stay near the circuit
      if (Number.isFinite(s.x)) {
        const q = track.nearest(s.x, s.z, -1);
        if (Math.abs(q.lateral) > track.wallDist + 6) bad.push('escaped(' + q.lateral.toFixed(1) + 'm)');
      }
      if (Number.isFinite(s.speed) && s.speed > TUNE.topSpeed * 1.4) bad.push('overspeed(' + (s.speed * 3.6).toFixed(0) + 'km/h)');

      if (bad.length) {
        console.log(`NaN    ${def.name} / ${mode.id} @ ${(i * FIXED).toFixed(2)}s -> [${bad.join(', ')}]`);
        console.log(`       speed=${s.speed} slip=${s.slip} steer=${s.steer} hb=${handbrake} throttle=${throttle} brake=${brake}`);
        console.log(`       lateral=${game.hint}`);
        failures++;
        break;
      }
      if (game.state === 'finished') break;
    }
  }
}

console.log(failures === 0
  ? `\nFuzz clean: ${SECONDS}s x ${TRACK_DEFS.length} tracks x ${MODES.length} modes x ${SEEDS.length} seeds, no NaNs, no escapes.\n`
  : `\n${failures} failure(s).\n`);
process.exit(failures ? 1 : 0);
