/* ============================================================
   SLK FENDERS — the actual side skins of the R170: a lower side
   panel with open wheel arches, a rounded body-colour arch lip,
   and a dark inner wheel well. This is what makes the wheels read
   as being under the car rather than stuck to a flat slab.

   Cosmetic only; no physics values are read here.
   ============================================================ */

import * as THREE from '../../vendor/three.module.js';
import { profile, arcPoints, archBandPoints } from './slk-geo.js';
import { WHEEL_Z, WHEEL_Y, WHEEL_RADIUS } from './car-spec.js';

const BOTTOM = -0.30;
const ARCH_R = WHEEL_RADIUS + 0.02; // wheel-arch opening radius
const PHI = Math.asin((WHEEL_Y - BOTTOM) / ARCH_R);
const A_LEFT = Math.PI + PHI;
const A_RIGHT = -PHI;
const FLARE_OUT = ARCH_R + 0.07;

/**
 * Lower side-skinn outline in [z, y], with both wheel arches open
 * into the bottom edge. Concave, so it is a single panel shape.
 */
function sidePanelPts() {
  const pts = [
    [2.00, BOTTOM], [2.00, 0.06], [1.98, 0.18], [1.82, 0.255],
    [0.62, 0.355], [0.34, 0.385], [-0.96, 0.395], [-1.55, 0.385],
    [-1.82, 0.365], [-1.95, 0.345], [-2.00, 0.315], [-2.00, BOTTOM],
  ];
  const rearLeftZ = -WHEEL_Z + Math.cos(A_LEFT) * ARCH_R;
  pts.push([rearLeftZ, BOTTOM]);
  pts.push(...arcPoints(-WHEEL_Z, WHEEL_Y, ARCH_R, A_LEFT, A_RIGHT, 12).slice(1));
  const frontLeftZ = WHEEL_Z + Math.cos(A_LEFT) * ARCH_R;
  pts.push([frontLeftZ, BOTTOM]);
  pts.push(...arcPoints(WHEEL_Z, WHEEL_Y, ARCH_R, A_LEFT, A_RIGHT, 12).slice(1));
  return pts;
}

/**
 * Add the side skins, fender lips and wheel wells to the chassis.
 * @param {THREE.Group} chassis
 * @param {object} mats body material plus dark
 * @returns {void}
 */
export function addFenders(chassis, mats) {
  const panel = sidePanelPts();
  const wellMat = new THREE.MeshLambertMaterial({
    color: 0x070708, side: THREE.DoubleSide,
  });

  for (const side of [-1, 1]) {
    chassis.add(profile(panel, 0.04, mats.body, side * 0.86));

    for (const z of [-WHEEL_Z, WHEEL_Z]) {
      const flare = profile(
        archBandPoints(z, WHEEL_Y, ARCH_R, FLARE_OUT, A_LEFT, A_RIGHT, 14),
        0.025, mats.body, side * 0.8925,
      );
      chassis.add(flare);

      const liner = new THREE.Mesh(
        new THREE.CircleGeometry(ARCH_R - 0.015, 14, 0, Math.PI),
        wellMat,
      );
      liner.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      liner.position.set(side * 0.843, WHEEL_Y, z);
      liner.userData.noShadow = true;
      liner.castShadow = false;
      liner.receiveShadow = false;
      chassis.add(liner);
    }
  }
}
