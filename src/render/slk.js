/* ============================================================
   SLK 200 KOMPRESSOR — the owner's facelift R170, rebuilt from
   their photos and the car's own RDW record.

   The visible body is now a narrow central shell plus separate side
   skins with open wheel arches, fender lips and dark wheel wells.
   Lamps live in slk-lights.js; the side skins in slk-fenders.js.

   COSMETIC ONLY. Nothing in this file is read by the simulation.
   ============================================================ */

import * as THREE from '../../vendor/three.module.js';
import { box, profile, plate, oval, strip, bumper } from './slk-geo.js';
import { addFenders } from './slk-fenders.js';
import { addFrontLights, addRearLights } from './slk-lights.js';
import { threePointedStar, brabusBadge, dutchPlate, grilleTexture } from './badge.js';

export const SLK_EXHAUSTS = Object.freeze([
  { x: 0.55, y: -0.27, z: -2.02 },
]);

/**
 * Hang the R170 body on a chassis group.
 * @param {THREE.Group} chassis
 * @param {object} mats body, trim, glass, windshield, accent, chrome, dark,
 *   interior, head, brake, reverse, lens, tail, reflector, amber
 * @returns {{body: THREE.Mesh}}
 */
export function buildSlkR170(chassis, mats) {
  const M = mats;
  const stripMat = M.body.clone();
  stripMat.side = THREE.DoubleSide;
  stripMat.flatShading = false;
  const bumperMat = M.body.clone();
  bumperMat.side = THREE.DoubleSide;
  bumperMat.flatShading = false;

  /* ---------------- central shell ----------------
     Narrower than the outer skins; the side panels give the car its
     1.76 m width and carry the wheel arches. */
  const shell = profile([
    [-1.94, -0.30], [1.94, -0.30], [2.00, -0.18], [2.02, 0.02],
    [1.98, 0.18], [1.82, 0.28], [0.62, 0.38], [0.34, 0.41],
    [-0.96, 0.43], [-1.55, 0.42], [-1.82, 0.40], [-1.95, 0.39],
    [-2.00, 0.38], [-2.00, -0.16],
  ], 1.40, M.body);
  chassis.add(shell);

  const floor = box(1.60, 0.07, 3.50, M.dark);
  floor.position.set(0, -0.335, 0);
  chassis.add(floor);
  addFenders(chassis, M);

  // lofted shoulder surfaces: the body tapers in toward the glass
  const shoulderZ = [2.00, 1.82, 0.62, 0.34, -0.96, -1.55, -1.82, -1.95, -2.00];
  const shoulderTop = [0.18, 0.28, 0.38, 0.41, 0.43, 0.42, 0.40, 0.39, 0.38];
  const shoulderOuter = [0.06, 0.255, 0.355, 0.385, 0.395, 0.385, 0.365, 0.345, 0.315];
  for (const side of [-1, 1]) {
    chassis.add(strip(shoulderZ, side * 0.70, side * 0.88, shoulderTop, shoulderOuter, stripMat));
  }

  /* ---------------- front bumper, intakes, fog lamps, plate ---------------- */
  const frontBumper = bumper(0.87, -0.10, -0.30, 2.06, 1.96, 1.86, bumperMat);
  const lip = box(1.66, 0.035, 0.12, M.dark);
  lip.position.set(0, -0.325, 1.97);
  chassis.add(frontBumper, lip);

  const intakePts = oval(0, -0.20, 0.46, 0.055, 16);
  const intakeShape = new THREE.Shape();
  intakeShape.moveTo(intakePts[0][0], intakePts[0][1]);
  for (let i = 1; i < intakePts.length; i++) intakeShape.lineTo(intakePts[i][0], intakePts[i][1]);
  intakeShape.closePath();
  const intakeGeo = new THREE.ShapeGeometry(intakeShape);
  const ipos = intakeGeo.attributes.position;
  const iuv = intakeGeo.attributes.uv;
  let iminX = Infinity, imaxX = -Infinity, iminY = Infinity, imaxY = -Infinity;
  for (let i = 0; i < ipos.count; i++) {
    iminX = Math.min(iminX, ipos.getX(i)); imaxX = Math.max(imaxX, ipos.getX(i));
    iminY = Math.min(iminY, ipos.getY(i)); imaxY = Math.max(imaxY, ipos.getY(i));
  }
  for (let i = 0; i < iuv.count; i++) {
    iuv.setXY(i, (ipos.getX(i) - iminX) / (imaxX - iminX), (ipos.getY(i) - iminY) / (imaxY - iminY));
  }
  const intake = new THREE.Mesh(intakeGeo, new THREE.MeshLambertMaterial({
    map: grilleTexture(), color: 0xffffff,
  }));
  intake.position.z = 2.075;
  intake.userData.noShadow = true;
  intake.castShadow = false;
  intake.receiveShadow = false;
  chassis.add(plate(oval(0, -0.20, 0.48, 0.06, 14), 0.02, M.dark, 2.06), intake);
  for (const y of [-0.175, -0.225]) {
    const slat = box(0.92, 0.012, 0.02, M.body);
    slat.position.set(0, y, 2.079);
    chassis.add(slat);
  }

  for (const side of [-1, 1]) {
    const fog = new THREE.Mesh(new THREE.CylinderGeometry(0.040, 0.040, 0.02, 10), M.reverse);
    fog.rotation.x = Math.PI / 2;
    fog.position.set(side * 0.66, -0.085, 2.02);
    const fogRing = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.006, 4, 12), M.chrome);
    fogRing.position.set(side * 0.66, -0.085, 2.031);
    chassis.add(fog, fogRing);
  }
  const frontHolder = box(0.58, 0.14, 0.025, M.dark);
  frontHolder.position.set(0, -0.10, 2.075);
  chassis.add(frontHolder);
  const frontPlate = dutchPlate('7-KNJ-43');
  if (frontPlate) {
    frontPlate.position.set(0, -0.10, 2.09);
    chassis.add(frontPlate);
  }
  addFrontLights(chassis, M);

  /* ---------------- bonnet creases, cowl ---------------- */
  for (const x of [-0.50, 0.50]) {
    const crease = box(0.035, 0.012, 1.25, M.body);
    crease.position.set(x, 0.345, 1.15);
    crease.rotation.x = 0.10;
    const hoodLine = box(0.012, 0.008, 1.15, M.dark);
    hoodLine.position.set(x > 0 ? 0.68 : -0.68, 0.343, 1.15);
    hoodLine.rotation.x = 0.10;
    chassis.add(crease, hoodLine);
  }
  const cowl = box(1.30, 0.022, 0.09, M.dark);
  cowl.position.set(0, 0.414, 0.31);
  chassis.add(cowl);

  /* ---------------- hardtop greenhouse + interior ---------------- */
  const core = box(1.24, 0.31, 1.10, M.interior);
  core.position.set(0, 0.55, -0.55);
  chassis.add(core);

  const windshield = box(1.34, 0.46, 0.055, M.windshield);
  const wpos = windshield.geometry.attributes.position;
  for (let i = 0; i < wpos.count; i++) if (wpos.getY(i) > 0) wpos.setX(i, wpos.getX(i) * 0.97);
  windshield.geometry.computeVertexNormals();
  windshield.position.set(0, 0.55, 0.14);
  windshield.rotation.x = -0.95;
  windshield.userData.noShadow = true;
  const matTree = new THREE.MeshLambertMaterial({ color: 0x2f8a4a });
  const matTrunk = new THREE.MeshLambertMaterial({ color: 0x5a3a1e });
  const rearMirror = box(0.16, 0.05, 0.04, M.dark);
  rearMirror.position.set(0, 0.635, 0.07);
  const mirrorStalk = box(0.02, 0.06, 0.06, M.dark);
  mirrorStalk.position.set(0, 0.66, 0.09);
  const string = box(0.006, 0.10, 0.006, M.dark);
  string.position.set(0.19, 0.60, 0.08);
  const tree = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.13, 4), matTree);
  tree.position.set(0.19, 0.53, 0.08);
  tree.castShadow = true;
  const trunk = box(0.014, 0.03, 0.014, matTrunk);
  trunk.position.set(0.19, 0.465, 0.08);
  chassis.add(rearMirror, mirrorStalk, string, tree, trunk);

  const rearGlass = box(1.22, 0.42, 0.055, M.glass);
  const rpos = rearGlass.geometry.attributes.position;
  for (let i = 0; i < rpos.count; i++) if (rpos.getY(i) > 0) rpos.setX(i, rpos.getX(i) * 0.94);
  rearGlass.geometry.computeVertexNormals();
  rearGlass.position.set(0, 0.555, -1.09);
  rearGlass.rotation.x = 0.85;
  chassis.add(windshield, rearGlass);

  // domed hardtop skin: crowned in the middle, tucked at the side glass
  const roofZ = [0.06, -0.04, -0.38, -0.72, -0.86, -0.94];
  const roofTop = [0.665, 0.71, 0.718, 0.712, 0.685, 0.665];
  const roofXs = [-1, -0.78, -0.50, 0, 0.50, 0.78, 1];
  const roofPos = [];
  for (let i = 0; i < roofZ.length; i++) {
    for (const xf of roofXs) {
      const drop = (roofTop[i] - 0.665) * 0.85 * xf * xf;
      roofPos.push(xf * 0.70, roofTop[i] - drop, roofZ[i]);
    }
  }
  const roofIdx = [];
  const rnx = roofXs.length;
  for (let i = 0; i < roofZ.length - 1; i++) {
    for (let j = 0; j < rnx - 1; j++) {
      const a = i * rnx + j, b = a + 1, c = a + rnx, d = c + 1;
      roofIdx.push(a, b, c, b, d, c);
    }
  }
  const roofGeo = new THREE.BufferGeometry();
  roofGeo.setAttribute('position', new THREE.Float32BufferAttribute(roofPos, 3));
  roofGeo.setIndex(roofIdx);
  roofGeo.computeVertexNormals();
  const roof = new THREE.Mesh(roofGeo, stripMat);
  roof.castShadow = true;
  roof.receiveShadow = true;
  chassis.add(roof);

  const sideGlass = [
    [0.30, 0.43], [-0.02, 0.665], [-0.45, 0.665], [-0.55, 0.43],
  ];
  const quarterGlass = [
    [-0.47, 0.43], [-0.55, 0.665], [-0.84, 0.665], [-1.10, 0.43],
  ];
  for (const side of [-1, 1]) {
    const win = profile(sideGlass, 0.035, M.glass, side * 0.675);
    const quarter = profile(quarterGlass, 0.035, M.glass, side * 0.675);
    const aPillar = box(0.055, 0.46, 0.06, M.body);
    aPillar.position.set(side * 0.705, 0.55, 0.16);
    aPillar.rotation.x = -0.95;
    const bPillar = box(0.028, 0.28, 0.045, M.body);
    bPillar.position.set(side * 0.687, 0.555, -0.51);
    const cPillar = box(0.06, 0.32, 0.08, M.body);
    cPillar.position.set(side * 0.697, 0.55, -1.01);
    cPillar.rotation.x = 0.85;
    const belt = box(0.018, 0.022, 1.42, M.chrome);
    belt.position.set(side * 0.688, 0.437, -0.40);
    const roofRail = box(0.018, 0.018, 0.98, M.chrome);
    roofRail.position.set(side * 0.704, 0.661, -0.44);
    const aTrim = box(0.018, 0.46, 0.018, M.chrome);
    aTrim.position.set(side * 0.724, 0.55, 0.16);
    aTrim.rotation.x = -0.95;
    const bTrim = box(0.012, 0.28, 0.018, M.chrome);
    bTrim.position.set(side * 0.69, 0.55, -0.51);
    const rearTrim = box(0.014, 0.42, 0.014, M.chrome);
    rearTrim.position.set(side * 0.613, 0.555, -1.09);
    rearTrim.rotation.x = 0.85;
    chassis.add(win, quarter, aPillar, bPillar, cPillar, belt, roofRail, aTrim, bTrim, rearTrim);
  }
  const rearBaseTrim = box(1.20, 0.016, 0.02, M.chrome);
  rearBaseTrim.position.set(0, 0.437, -1.25);
  chassis.add(rearBaseTrim);

  /* ---------------- mirrors, doors, gills, filler ---------------- */
  for (const side of [-1, 1]) {
    const stalk = box(0.11, 0.028, 0.045, M.dark);
    stalk.position.set(side * 0.84, 0.46, 0.27);
    const mirror = box(0.11, 0.075, 0.14, M.body);
    mirror.position.set(side * 0.91, 0.49, 0.25);
    const glassFace = box(0.025, 0.05, 0.10, M.glass);
    glassFace.position.set(side * 0.968, 0.49, 0.235);
    chassis.add(stalk, mirror, glassFace);

    const recess = box(0.022, 0.22, 0.26, M.dark);
    recess.position.set(side * 0.884, 0.16, 0.64);
    chassis.add(recess);
    for (let i = 0; i < 3; i++) {
      const slat = box(0.012, 0.13, 0.025, M.chrome);
      slat.position.set(side * 0.899, 0.15, 0.56 + i * 0.08);
      chassis.add(slat);
    }
    const sideRepeater = box(0.018, 0.03, 0.12, M.reverse);
    sideRepeater.position.set(side * 0.888, 0.24, 0.60);
    chassis.add(sideRepeater);

    const seam = box(0.012, 0.34, 0.014, M.dark);
    seam.position.set(side * 0.887, 0.14, 0.36);
    const rearSeam = box(0.012, 0.34, 0.014, M.dark);
    rearSeam.position.set(side * 0.887, 0.14, -0.535);
    const handleRecess = box(0.018, 0.05, 0.22, M.dark);
    handleRecess.position.set(side * 0.884, 0.34, -0.02);
    const handle = box(0.024, 0.032, 0.18, M.chrome);
    handle.position.set(side * 0.894, 0.34, -0.02);
    const rocker = box(0.030, 0.040, 2.40, M.trim);
    rocker.position.set(side * 0.885, -0.305, -0.05);
    const shoulder = box(0.06, 0.022, 2.2, M.body);
    shoulder.position.set(side * 0.862, 0.438, -0.35);
    shoulder.rotation.z = -side * 0.5;
    chassis.add(seam, rearSeam, handleRecess, handle, rocker, shoulder);

    if (side < 0) {
      const filler = box(0.02, 0.17, 0.17, M.dark);
      filler.position.set(side * 0.884, 0.33, -0.80);
      const fillerLid = box(0.02, 0.15, 0.15, M.body);
      fillerLid.position.set(side * 0.893, 0.33, -0.80);
      chassis.add(filler, fillerLid);
    }
  }

  /* ---------------- rear deck, bumper, plate ---------------- */
  const bootLid = box(1.44, 0.03, 0.52, M.body);
  bootLid.position.set(0, 0.442, -1.55);
  const trunkTrim = box(1.30, 0.012, 0.02, M.chrome);
  trunkTrim.position.set(0, 0.455, -1.30);
  const rearBumper = bumper(0.89, -0.10, -0.30, -2.02, -1.94, -1.84, bumperMat);
  chassis.add(rearBumper);
  const valance = box(1.70, 0.10, 0.20, M.dark);
  valance.position.set(0, -0.325, -1.95);
  const highBrake = box(0.46, 0.025, 0.02, M.brake);
  highBrake.position.set(0, 0.454, -1.80);
  const plateHolder = box(0.58, 0.14, 0.03, M.dark);
  plateHolder.position.set(0, -0.05, -2.005);
  chassis.add(bootLid, trunkTrim, rearBumper, valance, highBrake, plateHolder);
  const rearPlate = dutchPlate('7-KNJ-43');
  if (rearPlate) {
    rearPlate.position.set(0, -0.05, -2.025);
    rearPlate.rotation.y = Math.PI;
    chassis.add(rearPlate);
  }
  addRearLights(chassis, M);

  const badge = brabusBadge(0.45, 0.30, -2.012);
  if (badge) chassis.add(badge);
  const rearStar = threePointedStar(0.047, M.chrome);
  rearStar.position.set(0, 0.30, -2.015);
  rearStar.rotation.y = Math.PI;
  chassis.add(rearStar);

  /* ---------------- single left exhaust ---------------- */
  for (const e of SLK_EXHAUSTS) {
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.18, 10), M.chrome);
    tip.rotation.x = Math.PI / 2;
    tip.scale.z = 0.7;
    tip.position.set(e.x, e.y, e.z);
    tip.castShadow = true;
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.050, 0.050, 0.02, 10), M.dark);
    hole.rotation.x = Math.PI / 2;
    hole.scale.z = 0.7;
    hole.position.set(e.x, e.y, e.z - 0.095);
    chassis.add(tip, hole);
  }

  return { body: shell };
}
