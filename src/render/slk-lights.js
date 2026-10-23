/* ============================================================
   SLK LIGHTS — the facelift R170's lamp units.

   Front: a wide black-mesh grille with a chrome oval surround and
   star, plus one blocky faceted teardrop lamp per side. The lamp's main reflector
   area is inboard, toward the bonnet; a thin clear wrap sits
   at the outer fender edge, split by an off-centre divider.
   Rear: a layered four-bulb lamp — dark red outer housing, bright
   red brake lens, clear reverse band and a triangular tall-outer/pointed-inner lens
   around the rear quarter.

   COSMETIC ONLY.
   ============================================================ */

import * as THREE from '../../vendor/three.module.js';
import { box, plate, oval, profile, mirrorPts, scalePts } from './slk-geo.js';
import { threePointedStar, grilleTexture } from './badge.js';

/** Front grille, star and the pair of teardrop headlamps. */
function frontGrille(chassis, M) {
  const surround = plate(oval(0, 0.06, 0.50, 0.14, 12), 0.02, M.chrome, 2.04);
  const backing = plate(oval(0, 0.06, 0.46, 0.12, 12), 0.02, M.dark, 2.05);
  chassis.add(surround, backing);

  const pts = oval(0, 0.06, 0.445, 0.11, 16);
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    minX = Math.min(minX, pos.getX(i)); maxX = Math.max(maxX, pos.getX(i));
    minY = Math.min(minY, pos.getY(i)); maxY = Math.max(maxY, pos.getY(i));
  }
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (pos.getX(i) - minX) / (maxX - minX), (pos.getY(i) - minY) / (maxY - minY));
  }
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
    map: grilleTexture(), color: 0xffffff,
  }));
  mesh.position.z = 2.062;
  mesh.userData.noShadow = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  chassis.add(mesh);

  const star = threePointedStar(0.078, M.chrome);
  star.position.set(0, 0.06, 2.08);
  chassis.add(star);
}

/** One blocky faceted teardrop lamp assembly per side. */
function headlamps(chassis, M) {
  const lamp = [
    [0.515, 0.085], [0.525, 0.185], [0.610, 0.235], [0.720, 0.245],
    [0.820, 0.215], [0.875, 0.155], [0.885, 0.110], [0.855, 0.060],
    [0.780, 0.030], [0.660, 0.020], [0.560, 0.040],
  ];
  const centre = [0.70, 0.13];

  for (const side of [-1, 1]) {
    const housing = plate(mirrorPts(scalePts(lamp, ...centre, 1.10), side), 0.03, M.dark, 2.01);
    const bezel = plate(mirrorPts(scalePts(lamp, ...centre, 1.055), side), 0.02, M.dark, 2.028);
    const reflector = plate(mirrorPts(scalePts(lamp, ...centre, 0.84), side), 0.012, M.reflector, 2.043);
    chassis.add(housing, bezel, reflector);

    // one large inboard reflector, faceted to keep the blocky read
    const bowlMat = M.chrome.clone();
    bowlMat.side = THREE.DoubleSide;
    const bowl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.115, 0.075, 0.035, 8, 1, true), bowlMat,
    );
    bowl.rotation.x = Math.PI / 2;
    bowl.scale.set(1.25, 1.0, 1.0);
    bowl.position.set(side * 0.665, 0.132, 2.047);
    const bulb = new THREE.Mesh(new THREE.CylinderGeometry(0.040, 0.040, 0.008, 8), M.head);
    bulb.rotation.x = Math.PI / 2;
    bulb.position.set(side * 0.665, 0.132, 2.062);
    chassis.add(bowl, bulb);

    // off-centre divider: 83% of the lens is the inboard reflector,
    // the remaining sliver wraps around the fender edge.
    const divider = box(0.012, 0.18, 0.012, M.dark);
    divider.position.set(side * 0.818, 0.13, 2.076);
    chassis.add(divider);

    const outer = [
      [0.816, 0.060], [0.850, 0.045], [0.872, 0.075], [0.885, 0.110],
      [0.872, 0.165], [0.845, 0.205], [0.816, 0.225],
    ];
    chassis.add(plate(mirrorPts(outer, side), 0.008, M.lens, 2.077));

    const lens = plate(mirrorPts(lamp, side), 0.012, M.lens, 2.073);
    chassis.add(lens);
  }
}

/** Layered triangular rear lamp cluster, one per side. */
function tailLamps(chassis, M) {
  const tail = [
    [0.16, 0.080], [0.22, 0.150], [0.34, 0.170], [0.55, 0.180],
    [0.72, 0.220], [0.82, 0.255], [0.875, 0.240], [0.888, 0.150],
    [0.875, 0.055], [0.820, 0.025], [0.680, 0.015], [0.450, 0.025],
    [0.280, 0.040], [0.180, 0.050],
  ];
  const clear = [
    [0.270, 0.055], [0.780, 0.042], [0.830, 0.062],
    [0.830, 0.105], [0.780, 0.090], [0.270, 0.110],
  ];
  const rearPts = (pts, side) => mirrorPts(pts, side);

  for (const side of [-1, 1]) {
    chassis.add(plate(rearPts(scalePts(tail, 0.53, 0.14, 1.07), side), 0.03, M.dark, -2.004, true));
    chassis.add(plate(rearPts(tail, side), 0.03, M.tail, -2.020, true));
    chassis.add(plate(rearPts(scalePts(tail, 0.53, 0.14, 0.84), side), 0.02, M.brake, -2.034, true));

    const clearBorder = [
      [0.250, 0.040], [0.800, 0.028], [0.850, 0.052],
      [0.850, 0.125], [0.800, 0.108], [0.250, 0.128],
    ];
    chassis.add(plate(rearPts(clearBorder, side), 0.008, M.dark, -2.044, true));
    chassis.add(plate(rearPts(clear, side), 0.008, M.reverse, -2.048, true));


    // triangular quarter-panel wrap, same tall outer / pointed inner form
    const wrap = [
      [-1.78, 0.060], [-1.80, 0.150], [-1.86, 0.230], [-1.95, 0.270],
      [-2.02, 0.270], [-2.05, 0.200], [-2.04, 0.080], [-1.94, 0.030],
      [-1.84, 0.030],
    ];
    const wrapBright = [
      [-1.85, 0.100], [-1.91, 0.160], [-1.99, 0.210], [-2.03, 0.170],
      [-2.01, 0.090], [-1.94, 0.060], [-1.88, 0.070],
    ];
    const wrapClear = [
      [-1.82, 0.075], [-1.95, 0.075], [-2.01, 0.095],
      [-2.01, 0.135], [-1.95, 0.115], [-1.82, 0.115],
    ];
    chassis.add(
      profile(wrap, 0.020, M.dark, side * 0.878),
      profile(wrap, 0.020, M.tail, side * 0.889),
      profile(wrapBright, 0.014, M.brake, side * 0.900),
      profile(wrapClear, 0.008, M.reverse, side * 0.906),
    );
  }
}

/**
 * Add the front lamp units and grille to the chassis.
 * @param {THREE.Group} chassis
 * @param {object} mats
 * @returns {void}
 */
export function addFrontLights(chassis, mats) {
  frontGrille(chassis, mats);
  headlamps(chassis, mats);
}

/**
 * Add the rear lamp units to the chassis.
 * @param {THREE.Group} chassis
 * @param {object} mats
 * @returns {void}
 */
export function addRearLights(chassis, mats) {
  tailLamps(chassis, mats);
}
