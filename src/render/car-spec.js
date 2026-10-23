/* ============================================================
   CAR SPEC — visible dimensions of the owner's R170.

   These values place the wheel meshes and particle contact points.
   They are NOT read by the physics: the simulation keeps using TUNE.
   ============================================================ */

export const VISUAL_WHEELBASE = 2.40;   // R170: 2400 mm
export const VISUAL_TRACK = 1.54;       // R170: approx. 1490 mm + tyre
export const WHEEL_Z = VISUAL_WHEELBASE / 2;
export const WHEEL_X = VISUAL_TRACK / 2;

export const WHEEL_RADIUS = 0.325;
export const WHEEL_Y = -0.195; // chassis-local wheel centre (chassis sits at y = 0.52)
