/* ============================================================
   PHYSICS — the public surface.

   Everything outside this folder imports from here, so the internal
   split can change without touching callers. The tuning harnesses in
   tools/ are the main consumer and lean on this contract.
   ============================================================ */

export { TUNE } from './tune.js';
export { clamp, sign } from './math.js';
export { CarState } from './state.js';
export { updateDrivetrain, engineTorque, effectiveTopSpeed, gearMaxSpeed, gearCount, invalidateTopSpeed, engineRpm01 } from './drivetrain.js';
export { stepCar, fireBoost } from './step.js';
