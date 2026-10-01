/* ============================================================
   CAR SPECS

   A spec is a multiplier set applied on top of the base tune, so the
   shipped handling is always the reference point and no spec can drift
   away from it.

   Applying one is cheap and safe mid-run: it touches only grip, yaw,
   engine and brake values. Nothing in the render path depends on those
   — car.js reads wheelRadius/trackWidth/wheelBase when it builds the
   mesh, and no spec modulates those — so the car in the scene keeps
   its geometry and simply behaves differently.
   ============================================================ */

import { TUNE, invalidateTopSpeed } from '../physics.js';

/**
 * A snapshot of the untouched tune. Taken once at import, before any spec has
 * been applied, so `applySpec` can always rebuild from the same reference
 * rather than compounding on whatever was applied last.
 */
const BASE_TUNE = JSON.parse(JSON.stringify(TUNE));

export const SPECS = [
  {
    id: 'balanced', name: 'BALANCED', desc: 'The default. Predictable on entry, forgiving on exit.',
    mods: {},
  },
  {
    id: 'drift', name: 'DRIFT SPEC', desc: 'Loose rear, faster steering, more yaw. Slides start instantly and hold forever.',
    mods: { gripNormal: 0.82, gripPower: 0.86, gripHandbrake: 0.88, maxYawRate: 1.10, alignK: 0.82, engineAccel: 0.96 },
  },
  {
    id: 'grip', name: 'GRIP SPEC', desc: 'More mechanical grip and a higher redline. Quicker lap times, harder to break traction.',
    mods: { gripNormal: 1.16, gripPower: 1.10, gripHandbrake: 1.14, topSpeed: 1.06, engineAccel: 1.06, maxYawRate: 0.94 },
  },
  {
    id: 'monster', name: 'MONSTER', desc: 'Absurd power, absurd top end, absurd consequences. Good luck.',
    mods: { engineAccel: 1.34, topSpeed: 1.14, gripNormal: 0.88, gripPower: 0.92, maxYawRate: 1.06, brakeAccel: 1.08 },
  },
];

/**
 * @param {string} id one of SPECS
 * @returns {object} the spec that was applied
 */
export function applySpec(id) {
  const t = SPECS.find((x) => x.id === id) || SPECS[0];
  for (const k of Object.keys(TUNE)) {
    if (typeof BASE_TUNE[k] === 'number') TUNE[k] = BASE_TUNE[k];
  }
  for (const [k, mul] of Object.entries(t.mods)) {
    if (typeof TUNE[k] === 'number') TUNE[k] = BASE_TUNE[k] * mul;
  }
  // the gearbox is scaled against the achievable top speed, which just moved
  invalidateTopSpeed();
  return t;
}
